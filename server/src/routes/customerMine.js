// routes/customerMine.js —— C 端客户业务（套系 / 预约 / 双手机号登录 / 我的预约订单）
// 核心约束：
//  ①非开放注册——手机号必须在 reservations(phone/phone_two) 或 orders(customer_phone/phone_two) 有记录才允许登录
//  ②IP 限流：登录 3/分，预约提交 1/分
//  ③会话（c_session + customer_user 表）：登录返回 sid，前端存 localStorage 并以 Bearer 发送（跨站持久），cookie 兜底；有效期 30 天
//  ④只读 + 行级隔离：登录后只能读自己手机号（phone 或 phone_two）的预约/订单，无任何写业务数据接口
//  ⑤预约提交游客可提交（主手机号必填）；accessToken 仅访问单条订单
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { query, get, insert, run } from '../db.js';
import { buildCustomerOrderDetail } from './orderDetailHelper.js';
import { emitBizToStaff, BIZ_TYPE } from './mobileMessage.js';

const router = Router();

const COOKIE_NAME = 'c_session';
// 会话有效期：30 天（H5 端登录态需跨站持久，刷新不丢；仅退出登录/切换账号才失效）
const SESSION_HOURS = 30 * 24;
const COOKIE_TTL = SESSION_HOURS * 3600 * 1000;

// 内存态限流（单实例够用；Render 重启失效可接受）
const loginRate = new Map(); // ip -> [timestamps]
const LOGIN_MAX = 3;
const LOGIN_WINDOW = 60 * 1000;
const reserveRate = new Map();
const RESERVE_MAX = 1;
const RESERVE_WINDOW = 60 * 1000;

const RESERVATION_STATUS = { pending: '待确认', contacted: '已沟通', rejected: '已拒绝', converted: '已转订单' };
const ORDER_STATUS = { pending_deposit: '待付定金', deposit_paid: '已付定金', shot_done: '拍摄完成', completed: '已完结', cancelled: '已取消' };

function nowISO() { return new Date().toISOString(); }

function getIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '');
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : (req.ip || 'unknown');
}

function rateHit(store, ip, max, window) {
  const now = Date.now();
  const arr = (store.get(ip) || []).filter((t) => now - t < window);
  if (arr.length >= max) return true;
  arr.push(now);
  store.set(ip, arr);
  return false;
}

function setSessionCookie(res, sid) {
  const secure = process.env.NODE_ENV === 'production';
  const sameSite = secure ? 'None' : 'Lax';
  const attrs = [`${COOKIE_NAME}=${sid}`, 'Path=/', `Max-Age=${SESSION_HOURS * 3600}`, 'HttpOnly', `SameSite=${sameSite}`];
  if (secure) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}
function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production';
  const sameSite = secure ? 'None' : 'Lax';
  const attrs = [`${COOKIE_NAME}=`, 'Path=/', 'Max-Age=0', 'HttpOnly', `SameSite=${sameSite}`];
  if (secure) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

// 从请求提取 session_id：优先 Authorization: Bearer <sid>（localStorage 持久，可跨站，解决第三方 cookie 被拦导致刷新掉登录），cookie 兜底
function extractSid(req) {
  const auth = String(req.headers['authorization'] || '');
  if (auth.startsWith('Bearer ')) {
    const t = auth.slice(7).trim();
    if (t) return t;
  }
  const cookie = String(req.headers.cookie || '');
  const m = cookie.match(new RegExp('(?:^|;\\s*)' + COOKIE_NAME + '=([^;]+)'));
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

// 解析 session_id 并校验有效性，返回绑定的手机号；无效/过期返回 null
async function resolveSession(req) {
  const sid = extractSid(req);
  if (!sid) return null;
  const row = await get('SELECT * FROM customer_user WHERE session_id = ?', [sid]);
  if (!row) return null;
  if (row.session_expire_at && new Date(row.session_expire_at).getTime() < Date.now()) return null;
  return row.phone;
}

function maskPhone(p) {
  const s = String(p || '').trim();
  if (/^1\d{10}$/.test(s)) return s.slice(0, 3) + '****' + s.slice(7);
  return s;
}

function pickText(...vals) { for (const v of vals) { if (v) return String(v); } return ''; }

// ===== 2. 提交预约（游客可提交；主手机号必填；IP 限流 1 分钟最多 1 次）=====
router.post('/reservation-submit', async (req, res) => {
  try {
    const ip = getIp(req);
    if (rateHit(reserveRate, ip, RESERVE_MAX, RESERVE_WINDOW)) {
      return res.status(429).json({ error: '提交过于频繁，请稍后再试' });
    }
    const b = req.body || {};
    const groomName = String(b.groom_name || '').trim();
    const brideName = String(b.bride_name || '').trim();
    const phone = String(b.phone || '').trim();
    const phoneTwo = String(b.phone_two || '').trim();
    const expectDate = String(b.expect_date || '').trim();
    const expectTime = String(b.expect_time || '').trim();
    const shootLocation = String(b.shoot_location || '').trim();
    const remark = String(b.remark || '').trim();
    const packageId = (b.package_id === null || b.package_id === undefined || b.package_id === '') ? null : parseInt(b.package_id, 10);

    if (!phone) return res.status(400).json({ error: '请填写主联系手机号' });
    if (!/^1\d{10}$/.test(phone)) return res.status(400).json({ error: '请输入正确的 11 位手机号' });
    if (phoneTwo && !/^1\d{10}$/.test(phoneTwo)) return res.status(400).json({ error: '第二联系手机号格式不正确' });
    if (!expectDate) return res.status(400).json({ error: '请选择意向拍摄日期' });
    if (expectTime && !/^\d{2}:\d{2}$/.test(expectTime)) return res.status(400).json({ error: '拍摄时间格式不正确' });

    const id = await insert(
      `INSERT INTO reservations (groom_name, bride_name, phone, phone_two, package_id, expect_date, expect_time, shoot_location, remark, status, order_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [groomName, brideName, phone, phoneTwo, packageId, expectDate, expectTime, shootLocation, remark, 'pending', null]
    );

    // 通知商家（预约消息，sub_type=reserve，已整合到「消息」Tab 的预约消息分类）
    const pkgName = packageId ? (await get('SELECT name FROM packages WHERE id = ?', [packageId]) || {}).name || '' : '';
    try {
      await emitBizToStaff({
        title: '新预约',
        content: `${groomName || brideName || '客户'}（${phone}）提交了预约${pkgName ? '，套系 ' + pkgName : ''}${expectDate ? '，意向日期 ' + expectDate : ''}${expectTime ? '，时间 ' + expectTime : ''}${shootLocation ? '，地点 ' + shootLocation : ''}`,
        biz_type: BIZ_TYPE.ORDER, biz_id: id, sub_type: 'reserve',
        biz_extra: JSON.stringify({ reservationId: id })
      });
    } catch (e) { console.error('[customerMine] 预约 biz 消息失败：', e.message); }

    res.json({ ok: true, id, message: '提交成功，请等待摄影师确认' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 3. 免验证码手机号登录（非开放注册，双手机号匹配预约/订单；IP 限流 3/分）=====
router.post('/login', async (req, res) => {
  try {
    const ip = getIp(req);
    if (rateHit(loginRate, ip, LOGIN_MAX, LOGIN_WINDOW)) {
      return res.status(429).json({ error: '访问过于频繁，请稍后再试' });
    }
    const phone = String((req.body && req.body.phone) || '').trim();
    if (!/^1\d{10}$/.test(phone)) return res.status(400).json({ error: '请输入正确的 11 位手机号' });

    // 命中预约表：phone 或 phone_two
    const rsv = await get('SELECT id FROM reservations WHERE phone = ? OR phone_two = ? LIMIT 1', [phone, phone]);
    // 命中订单表：主手机号(customer_phone)或第二手机号(phone_two)
    const ord = await get(
      'SELECT id FROM orders WHERE (customer_phone = ? OR phone_two = ?) AND cancelled = 0 AND is_deleted = 0 LIMIT 1',
      [phone, phone]
    );
    if (!rsv && !ord) {
      return res.status(403).json({ error: '未找到该手机号对应的预约或订单，请确认手机号或联系摄影师' });
    }

    const now = nowISO();
    const sid = randomBytes(32).toString('hex');
    const expireAt = new Date(Date.now() + COOKIE_TTL).toISOString();
    const existUser = await get('SELECT id FROM customer_user WHERE phone = ?', [phone]);
    if (existUser) {
      await run('UPDATE customer_user SET last_login_at = ?, session_id = ?, session_expire_at = ? WHERE id = ?', [now, sid, expireAt, existUser.id]);
    } else {
      await insert('INSERT INTO customer_user (phone, last_login_at, session_id, session_expire_at) VALUES (?,?,?,?)', [phone, now, sid, expireAt]);
    }
    setSessionCookie(res, sid);
    // 返回 sid：前端存入 localStorage 并以 Authorization: Bearer 随请求发送，刷新后登录态持久（第三方 cookie 被拦也不丢）
    res.json({ ok: true, phone: maskPhone(phone), sid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 4. 退出登录 =====
router.post('/logout', async (req, res) => {
  try {
    // 优先用 Bearer token（跨站场景 cookie 可能被拦，无法随请求到达）；cookie 兜底
    const sid = extractSid(req);
    if (sid) {
      await run('UPDATE customer_user SET session_id = NULL, session_expire_at = NULL WHERE session_id = ?', [sid]);
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 5. 当前登录信息（脱敏手机号 + 回填用原手机号；未登录返回未登录标识）=====
router.get('/me', async (req, res) => {
  try {
    const phone = await resolveSession(req);
    if (!phone) return res.json({ isLogin: false, phone: '' });
    // phone 用于展示脱敏；rawPhone 用于预约页回填（仅本人可见，非敏感）
    res.json({ isLogin: true, phone: maskPhone(phone), rawPhone: phone });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 6. 我的预约 + 订单（双手机号匹配，行级隔离只读）=====
router.get('/my-business', async (req, res) => {
  try {
    const phone = await resolveSession(req);
    if (!phone) return res.status(401).json({ error: '未登录' });

    // 预约：phone 或 phone_two（已转订单的预约附带对应订单 accessToken，供「查看对应订单」跳转）
    const resvRows = await query(
      `SELECT r.*, (SELECT p.name FROM packages p WHERE p.id = r.package_id LIMIT 1) AS package_name,
              (SELECT o.customer_token FROM orders o WHERE o.id = r.order_id LIMIT 1) AS order_token
       FROM reservations r WHERE r.phone = ? OR r.phone_two = ? ORDER BY r.id DESC`,
      [phone, phone]
    );

    // 订单：customer_phone 或 phone_two
    const orderRows = await query(
      `SELECT o.id, o.order_no, o.customer_phone, o.phone_two, o.shoot_date, o.date_tbd, o.status, o.order_status,
              o.package_name, o.package_snapshot, o.customer_token, o.total_amount
       FROM orders o
       WHERE (o.customer_phone = ? OR o.phone_two = ?) AND o.cancelled = 0 AND o.is_deleted = 0
       ORDER BY o.id DESC`,
      [phone, phone]
    );

    res.json({
      reservations: resvRows.map((r) => ({
        id: r.id,
        groom_name: r.groom_name || '',
        bride_name: r.bride_name || '',
        phone: maskPhone(r.phone || ''),
        phone_two: maskPhone(r.phone_two || ''),
        package_id: r.package_id,
        package_name: r.package_name || '',
        expect_date: r.expect_date || '',
        expect_time: r.expect_time || '',
        shoot_location: r.shoot_location || '',
        remark: r.remark || '',
        status: r.status,
        status_label: RESERVATION_STATUS[r.status] || r.status,
        order_id: r.order_id || null,
        order_token: r.order_token || '', // 已转订单的 accessToken（跳详情页用）
        create_time: r.create_time || ''
      })),
      orders: orderRows.map((o) => {
        const pkg = (() => { try { return JSON.parse(o.package_snapshot || '{}') || {}; } catch { return {}; } })();
        return {
          id: o.id,
          order_no: o.order_no || '',
          package_name: pickText(o.package_name, pkg.name),
          expect_date: o.date_tbd ? '日期待定' : (o.shoot_date || '未排期'),
          status: o.order_status || o.status,
          status_label: ORDER_STATUS[o.order_status] || o.status || '进行中',
          customer_token: o.customer_token || '', // accessToken
          price: Number(o.total_amount) || 0
        };
      })
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 7. 单订单详情（accessToken 校验，仅返回该 token 绑定的单条订单；无效返回 404）=====
router.get('/order-detail', async (req, res) => {
  try {
    const token = String(req.query.accessToken || '').trim();
    if (!token) return res.status(400).json({ error: '缺少 accessToken' });
    const o = await get('SELECT * FROM orders WHERE customer_token = ?', [token]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    if (o.cancelled || o.is_deleted) return res.status(404).json({ error: '订单不存在或已关闭' });
    if (o.customer_token_expire_at) {
      const exp = new Date(o.customer_token_expire_at).getTime();
      if (!Number.isNaN(exp) && exp < Date.now()) return res.status(403).json({ error: '访问链接已过期，请联系商家' });
    }
    res.json(await buildCustomerOrderDetail(o));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
