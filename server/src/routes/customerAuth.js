// routes/customerAuth.js —— C 端客户手机号验证码登录体系（与管理员 users 完全隔离）
// 会话：登录成功签发 session_id（随机），写入 customer_user 表 + HttpOnly cookie，有效期 7 天。
// 安全：①验证码发送限流（IP 5/分 + 手机号 1/分，防刷）②登录接口限流 ③订单/档期严格按会话手机号行级隔离，只读无写。
import { Router } from 'express';
import crypto from 'node:crypto';
import { query, get, insert, run } from '../db.js';
import { maskPhone } from '../auth.js';

const router = Router();

const COOKIE_NAME = 'c_session';
const SESSION_DAYS = 7;
const SMS_TTL = 5 * 60 * 1000;   // 验证码 5 分钟有效
const SMS_MIN_INTERVAL = 60 * 1000; // 同手机号 60 秒只能发一次

// ===== 内存态：短信验证码 + 限流（单实例够用；Render 重启失效可接受）=====
const smsStore = new Map();      // phone -> { code, expires, lastSent, attempts }
const smsIpRate = new Map();     // ip -> [timestamps]
const loginIpRate = new Map();   // ip -> [timestamps]

const STATUS_LABEL = {
  deposit: '已付定金', waiting: '等待拍摄', shot: '拍摄中', selecting: '待选片',
  retouching: '精修中', deliver: '待交付', delivered: '已交付', completed: '已完成', cancelled: '已关闭'
};

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
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const attrs = [`${COOKIE_NAME}=${sid}`, 'Path=/', `Max-Age=${maxAge}`, 'HttpOnly', `SameSite=${sameSite}`];
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
    remark: pickText(o.appointment_remark, o.external_remark, o.remark)
  };
}

// ===== 1. 发送短信验证码 =====
router.post('/sms/send', async (req, res) => {
  try {
    const ip = getIp(req);
    if (rateHit(smsIpRate, ip, 5, 60 * 1000)) return res.status(429).json({ error: '发送过于频繁，请稍后再试' });
    const phone = String((req.body && req.body.phone) || '').trim();
    if (!/^1\d{10}$/.test(phone)) return res.status(400).json({ error: '请输入正确的 11 位手机号' });

    const existing = smsStore.get(phone);
    if (existing && Date.now() - existing.lastSent < SMS_MIN_INTERVAL) {
      return res.status(429).json({ error: '验证码已发送，请 60 秒后重试' });
    }
    const code = String(Math.floor(100000 + Math.random() * 900000)); // 6 位数字
    smsStore.set(phone, { code, expires: Date.now() + SMS_TTL, lastSent: Date.now(), attempts: 0 });
    // 零成本：无短信供应商。开发环境返回 dev_code 供联调；生产环境绝不返回，防止验证码泄露。
    const payload = { ok: true, message: '验证码已发送' };
    if (process.env.NODE_ENV !== 'production') payload.dev_code = code;
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 2. 手机号验证码登录 =====
router.post('/login', async (req, res) => {
  try {
    const ip = getIp(req);
    if (rateHit(loginIpRate, ip, 10, 60 * 1000)) return res.status(429).json({ error: '操作过于频繁，请稍后再试' });

    const b = req.body || {};
    const phone = String(b.phone || '').trim();
    const code = String(b.code || '').trim();
    if (!/^1\d{10}$/.test(phone)) return res.status(400).json({ error: '请输入正确的 11 位手机号' });
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: '请输入 6 位验证码' });

    const sms = smsStore.get(phone);
    if (!sms || sms.expires < Date.now()) return res.status(400).json({ error: '验证码已过期，请重新获取' });
    if (sms.attempts >= 5) { smsStore.delete(phone); return res.status(429).json({ error: '尝试次数过多，请重新获取验证码' }); }
    if (code !== sms.code) {
      sms.attempts += 1;
      return res.status(400).json({ error: '验证码错误' });
    }
    smsStore.delete(phone); // 一次性消费

    const now = nowISO();
    const sessionId = crypto.randomBytes(32).toString('hex');
    const expireAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const exist = await get('SELECT id FROM customer_user WHERE phone = ?', [phone]);
    if (exist) {
      await run('UPDATE customer_user SET last_login_at = ?, session_id = ?, session_expire_at = ? WHERE id = ?', [now, sessionId, expireAt, exist.id]);
    } else {
      await insert('INSERT INTO customer_user (phone, last_login_at, session_id, session_expire_at) VALUES (?,?,?,?)', [phone, now, sessionId, expireAt]);
    }
    setSessionCookie(res, sessionId);
    res.json({ ok: true, phone: maskPhone(phone) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 3. 退出登录（清除会话）=====
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

// ===== 4. 当前登录客户信息（脱敏手机号；未登录返回未登录标识）=====
router.get('/me', async (req, res) => {
  try {
    const phone = await resolveSession(req);
    if (!phone) return res.json({ logged_in: false });
    res.json({ logged_in: true, phone: maskPhone(phone) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 5. 我的订单（会话手机号行级隔离，只读，仅限本人）=====
router.get('/orders', async (req, res) => {
  try {
    const phone = await resolveSession(req);
    if (!phone) return res.status(401).json({ error: '未登录' });
    const rows = await query(
      `SELECT o.id, o.order_no, o.shoot_date, o.date_tbd, o.status, o.remark,
              o.appointment_remark, o.external_remark, o.package_snapshot,
              (SELECT p.name FROM packages p WHERE p.id = o.package_id LIMIT 1) AS package_name
       FROM orders o
       WHERE o.customer_phone = ? AND o.cancelled = 0 AND o.is_deleted = 0
       ORDER BY o.id DESC`,
      [phone]
    );
    res.json(rows.map(buildOrder));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 6. 我的订单详情（会话手机号行级隔离）=====
router.get('/orders/:orderId', async (req, res) => {
  try {
    const phone = await resolveSession(req);
    if (!phone) return res.status(401).json({ error: '未登录' });
    const o = await get(
      `SELECT o.*, (SELECT p.name FROM packages p WHERE p.id = o.package_id LIMIT 1) AS package_name
       FROM orders o WHERE o.id = ? AND o.cancelled = 0 AND o.is_deleted = 0`,
      [req.params.orderId]
    );
    if (!o) return res.status(404).json({ error: '订单不存在' });
    if (String(o.customer_phone || '') !== phone) return res.status(403).json({ error: '无权查看该订单' });
    res.json(buildOrder(o));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 7. 我的拍摄档期（会话手机号行级隔离）=====
router.get('/schedules', async (req, res) => {
  try {
    const phone = await resolveSession(req);
    if (!phone) return res.status(401).json({ error: '未登录' });
    const rows = await query(
      `SELECT id, date, period, status, note, photographer, groom_name, bride_name, address
       FROM schedules WHERE contact_phone = ? ORDER BY date DESC`,
      [phone]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
