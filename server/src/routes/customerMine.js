// routes/customerMine.js —— C 端免验证码手机号登录（不是开放注册）+ 我的页面数据
// 核心约束：①非开放注册——手机号必须在订单表(cancelled=0 & is_deleted=0)有记录才允许登录 ②IP 限流 3/分
//  ③cookie 会话 24h（与原 customerAuth 共用 c_session + customer_user 表，互斥覆盖）
//  ④只读+行级隔离：登录后只能读自己手机号的订单/预约/档期，无任何写接口
//  ⑤与原有 customer_token 单订单链接方式并行（不取代）
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { query, get, insert, run } from '../db.js';
import { buildCustomerOrderDetail } from './orderDetailHelper.js';
import { emitMessage } from './message.js';
import { emitBizToStaff, BIZ_TYPE } from './mobileMessage.js';

const router = Router();

const COOKIE_NAME = 'c_session';
const SESSION_HOURS = 24;
const COOKIE_TTL = SESSION_HOURS * 3600 * 1000;

// 内存态限流（单实例够用；Render 重启失效可接受）
const loginRate = new Map(); // ip -> [timestamps]
const RATE_MAX = 3;
const RATE_WINDOW = 60 * 1000;
// 预约提交限流：同一 IP 1 分钟最多 1 次
const reserveRate = new Map();
const RESERVE_MAX = 1;
const RESERVE_WINDOW = 60 * 1000;

const STATUS_LABEL = {
  deposit: '已付定金', waiting: '等待拍摄', shot: '拍摄中', selecting: '待选片',
  retouching: '精修中', deliver: '待交付', delivered: '已交付', completed: '已完成', cancelled: '已关闭'
};
const SCHEDULE_STATUS = { free: '空闲', booked: '已预约', locked: '已锁定', done: '已完成' };

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

// 从 cookie 解析 session_id 并校验有效性，返回绑定的手机号；无效/过期返回 null
async function resolveSession(req) {
  const cookie = String(req.headers.cookie || '');
  const m = cookie.match(new RegExp('(?:^|;\\s*)' + COOKIE_NAME + '=([^;]+)'));
  if (!m) return null;
  let sid;
  try { sid = decodeURIComponent(m[1]); } catch { sid = m[1]; }
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

function buildOrder(o) {
  const pkg = (() => { try { return JSON.parse(o.package_snapshot || '{}') || {}; } catch { return {}; } })();
  return {
    id: o.id,
    order_no: o.order_no || '',
    shoot_date: o.date_tbd ? '日期待定' : (o.shoot_date || '未排期'),
    package_name: pickText(pkg.name, o.package_name),
    status: o.status || '',
    status_label: STATUS_LABEL[o.status] || o.status || '进行中',
    // 单订单访问令牌（用于跳 /customer/order?accessToken= 详情页，与 B 端分享链接同一令牌）
    customer_token: o.customer_token || ''
    // 安全：不返回备注(remark/appointment_remark/external_remark)与订单变更记录(logs)，C 端客户不可见
  };
}

// ===== 1. 免验证码手机号登录（不是开放注册）=====
router.post('/login', async (req, res) => {
  try {
    const ip = getIp(req);
    if (rateHit(loginRate, ip, RATE_MAX, RATE_WINDOW)) {
      return res.status(429).json({ error: '访问过于频繁，请稍后再试' });
    }
    const phone = String((req.body && req.body.phone) || '').trim();
    if (!/^1\d{10}$/.test(phone)) return res.status(400).json({ error: '请输入正确的 11 位手机号' });

    // 非开放注册：必须有有效订单（cancelled=0 & is_deleted=0）才允许登录
    const exists = await get(
      'SELECT id FROM orders WHERE customer_phone = ? AND cancelled = 0 AND is_deleted = 0 LIMIT 1',
      [phone]
    );
    if (!exists) {
      return res.status(403).json({ error: '未找到该手机号对应的订单，请确认手机号或联系摄影师' });
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
    res.json({ ok: true, phone: maskPhone(phone) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 2. 退出登录 =====
router.post('/logout', async (req, res) => {
  try {
    const cookie = String(req.headers.cookie || '');
    const m = cookie.match(new RegExp('(?:^|;\\s*)' + COOKIE_NAME + '=([^;]+)'));
    if (m) {
      let sid; try { sid = decodeURIComponent(m[1]); } catch { sid = m[1]; }
      await run('UPDATE customer_user SET session_id = NULL, session_expire_at = NULL WHERE session_id = ?', [sid]);
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 3. 当前登录信息（脱敏手机号；未登录返回未登录标识）=====
router.get('/me', async (req, res) => {
  try {
    const phone = await resolveSession(req);
    if (!phone) return res.json({ isLogin: false, phone: '' });
    res.json({ isLogin: true, phone: maskPhone(phone) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 4. 我的业务数据（预约 + 订单 + 档期，全部按会话手机号行级隔离只读）=====
router.get('/my-business', async (req, res) => {
  try {
    const phone = await resolveSession(req);
    if (!phone) return res.status(401).json({ error: '未登录' });

    // 订单
    const orderRows = await query(
      `SELECT o.id, o.order_no, o.shoot_date, o.date_tbd, o.status, o.remark,
              o.appointment_remark, o.external_remark, o.package_snapshot, o.customer_token,
              (SELECT p.name FROM packages p WHERE p.id = o.package_id LIMIT 1) AS package_name
       FROM orders o
       WHERE o.customer_phone = ? AND o.cancelled = 0 AND o.is_deleted = 0
       ORDER BY o.id DESC`,
      [phone]
    );

    // 预约
    const apptRows = await query(
      `SELECT id, package_id, hope_date, status, remark, style_req, source, created_at
       FROM appointments WHERE phone = ? ORDER BY id DESC`,
      [phone]
    );

    // 档期（拍摄日程）
    const scheduleRows = await query(
      `SELECT id, date, period, status, photographer, groom_name, bride_name, address, note
       FROM schedules WHERE contact_phone = ? ORDER BY date DESC`,
      [phone]
    );

    res.json({
      orders: orderRows.map(buildOrder),
      appointments: apptRows,
      schedules: scheduleRows
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 5. 单订单详情（accessToken 校验，仅返回该 token 绑定的单条订单；无效返回 404）=====
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

// ===== 6. C 端预约提交（只读提交，写入预约表 status=pending；IP 限流 1 分钟最多 1 次）=====
router.post('/reservation-submit', async (req, res) => {
  try {
    const ip = getIp(req);
    if (rateHit(reserveRate, ip, RESERVE_MAX, RESERVE_WINDOW)) {
      return res.status(429).json({ error: '提交过于频繁，请稍后再试' });
    }
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const phone = String(b.phone || '').trim();
    if (!name || !phone) return res.status(400).json({ error: '请填写姓名与手机号' });
    if (!/^1\d{10}$/.test(phone)) return res.status(400).json({ error: '请输入正确的 11 位手机号' });

    // H5 匿名访问拿不到微信 openid，用手机号派生稳定标识，同一手机号归并到同一客资
    const openid = 'h5_' + phone;
    const shootType = String(b.shoot_type || '').trim();
    const hopeDate = String(b.hope_date || '').trim();
    const styleReq = String(b.style_req || '').trim();
    const location = String(b.location || '').trim();
    const budget = String(b.budget || '').trim();
    const remark = String(b.remark || '').trim();

    // 写入客资（upsert：同一手机号更新，否则新建）
    const existCust = await get('SELECT id FROM customers WHERE openid = ?', [openid]);
    if (existCust) {
      await run('UPDATE customers SET nickname = ?, phone = ?, updated_at = ? WHERE openid = ?', [name, phone, nowISO(), openid]);
    } else {
      await insert('INSERT INTO customers (openid, nickname, phone, created_at, updated_at) VALUES (?,?,?,?,?)', [openid, name, phone, nowISO(), nowISO()]);
    }

    // 写入预约（status=pending 待确认）
    const id = await insert(
      `INSERT INTO appointments (openid, name, phone, package_id, hope_date, remark, status, source, style_req, shoot_type, location, budget, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [openid, name, phone, null, hopeDate, remark, 'pending', 'h5', styleReq, shootType, location, budget, nowISO()]
    );

    // 消息中心：客资新增 → customer_consult
    await emitMessage({
      message_type: 'customer_consult', business_event: 'customer_consult',
      title: '新顾客咨询',
      content: `${name}（${phone}）提交了预约${shootType ? '，拍摄类型 ' + shootType : ''}${hopeDate ? '，意向日期 ' + hopeDate : ''}${styleReq ? '，风格 ' + styleReq : ''}${location ? '，地点 ' + location : ''}${budget ? '，预算 ' + budget : ''}`,
      rel_id: openid, rel_model: 'customer'
    });

    // 订单消息子类型：预约消息 reserve
    try {
      await emitBizToStaff({
        title: '新预约',
        content: `${name}（${phone}）提交了预约${shootType ? '，拍摄类型 ' + shootType : ''}${hopeDate ? '，意向日期 ' + hopeDate : ''}${styleReq ? '，风格 ' + styleReq : ''}${location ? '，地点 ' + location : ''}${budget ? '，预算 ' + budget : ''}`,
        biz_type: BIZ_TYPE.ORDER, biz_id: id, sub_type: 'reserve',
        biz_extra: JSON.stringify({ appointmentId: id })
      });
    } catch (e) { console.error('[customerMine] 生成预约消息失败：', e.message); }

    // 待办：新预约待确认
    try {
      await insert(
        'INSERT INTO todo_items (order_id, todo_type, title, content, status, biz_key) VALUES (?,?,?,?,?,?)',
        [0, 'appointment', '新预约待确认', `${name}（${phone}）提交预约${shootType ? '，拍摄类型 ' + shootType : ''}${hopeDate ? '，意向日期 ' + hopeDate : ''}${styleReq ? '，风格 ' + styleReq : ''}${location ? '，地点 ' + location : ''}${budget ? '，预算 ' + budget : ''}${remark ? '，备注：' + remark : ''}`, 'pending', `appointment_${id}`]
      );
    } catch (e) { console.error('[customerMine] 生成预约待办失败：', e.message); }

    res.json({ ok: true, message: '提交成功，请等待摄影师确认' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;