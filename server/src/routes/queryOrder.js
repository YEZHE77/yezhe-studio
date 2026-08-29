// routes/queryOrder.js —— C 端客户自助查订单（手机号 + 图形验证码，只读）
// 安全约束：
//  ① 图形验证码：提交必须携带 captchaId + captchaCode，错误/过期直接拦截，一次性使用
//  ② 限流：同一 IP 1 分钟最多 5 次查询，超出返回 429
//  ③ 只返回手机号完全匹配的订单，绝不返回他人数据；只读，无任何写接口
//  ④ C 端只暴露：拍摄日期 / 套系名称 / 拍摄风格 / 拍摄进度 / 预约备注（价格按开关）
//  ⑤ 验证码通过后签发 30 分钟查询会话 token，用于订单详情 + 合同预览（免重复验证码）
import { Router } from 'express';
import { query, get } from '../db.js';
import { signQueryToken, verifyQueryToken } from '../auth.js';
import { serverError, forbiddenView } from '../httpError.js';

const router = Router();

// ===== 内存态：验证码 + IP 限流（单实例够用；Render 重启即失效，可接受）=====
const captchaStore = new Map(); // captchaId -> { code, expires }
const rateStore = new Map();    // ip -> [timestamp,...]
const CAPTCHA_TTL = 5 * 60 * 1000; // 验证码 5 分钟有效
const RATE_MAX = 5;               // 每分钟最多 5 次
const RATE_WINDOW = 60 * 1000;

const STATUS_LABEL = {
  deposit: '已付定金', waiting: '等待拍摄', shot: '拍摄中', selecting: '待选片',
  retouching: '精修中', deliver: '待交付', delivered: '已交付', completed: '已完成', cancelled: '已关闭'
};

function nowISO() { return new Date().toISOString(); }

function randomCaptcha(len = 4) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆 0O1I
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function captchaSvg(code) {
  const w = 120, h = 40;
  let chars = '';
  for (let i = 0; i < code.length; i++) {
    const x = 22 + i * 24;
    const y = 27 + (Math.random() * 8 - 4);
    const rot = (Math.random() * 30 - 15).toFixed(1);
    const color = ['#2c3e50', '#1D9E75', '#534AB7', '#993C1D'][i % 4];
    chars += `<text x="${x}" y="${y}" font-size="24" font-family="monospace" font-weight="700" fill="${color}" transform="rotate(${rot} ${x} ${y})">${code[i]}</text>`;
  }
  let lines = '';
  for (let i = 0; i < 3; i++) {
    const x1 = Math.random() * w, y1 = Math.random() * h, x2 = Math.random() * w, y2 = Math.random() * h;
    lines += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#cbd5e1" stroke-width="1"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" rx="6" fill="#f6f8fa"/>${lines}${chars}</svg>`;
}

function getIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '');
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : (req.ip || 'unknown');
}

function rateLimited(ip) {
  const now = Date.now();
  const arr = (rateStore.get(ip) || []).filter((t) => now - t < RATE_WINDOW);
  if (arr.length >= RATE_MAX) return true;
  arr.push(now);
  rateStore.set(ip, arr);
  return false;
}

// 读取工作室设置（价格开关 / 作品集 H5 链接）
async function readStudioSetting() {
  const r = await get("SELECT value FROM settings WHERE key = 'studio'");
  try { return JSON.parse(r && r.value) || {}; } catch { return {}; }
}

function pickText(...vals) {
  for (const v of vals) { if (v) return String(v); }
  return '';
}

// 组装订单摘要（只暴露 5 个字段 + 可选价格；绝不含内部备注/其他客户数据）
function buildSummary(o, showPrice) {
  const pkg = (() => { try { return JSON.parse(o.package_snapshot || '{}') || {}; } catch { return {}; } })();
  const s = {
    id: o.id,
    order_no: o.order_no || '',
    shoot_date: o.date_tbd ? '日期待定' : (o.shoot_date || '未排期'),
    package_name: pickText(pkg.name, o.package_name),
    style: pickText(o.style_req),
    status: o.status || '',
    status_label: STATUS_LABEL[o.status] || o.status || '进行中',
    remark: pickText(o.appointment_remark, o.external_remark, o.remark)
  };
  if (showPrice) {
    s.total_amount = Number(o.total_amount || 0);
    s.deposit = Number(o.deposit || 0);
    s.balance = Number(o.balance || 0);
    s.paid_amount = Number(o.paid_amount || 0);
    s.payment_status = o.payment_status || '';
  }
  return s;
}

// ===== 1. 获取图形验证码 =====
router.get('/captcha', (req, res) => {
  const code = randomCaptcha(4);
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  captchaStore.set(id, { code, expires: Date.now() + CAPTCHA_TTL });
  const svg = captchaSvg(code);
  res.json({ captchaId: id, image: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64') });
});

// ===== 2. 手机号 + 验证码查询订单 =====
router.post('/search', async (req, res) => {
  try {
    const ip = getIp(req);
    if (rateLimited(ip)) return res.status(429).json({ error: '访问过于频繁，请稍后再试' });

    const b = req.body || {};
    const phone = String(b.phone || '').trim();
    const captchaId = String(b.captchaId || '');
    const captchaCode = String(b.captchaCode || '').trim();

    // 验证码校验（一次性，无论对错都消费，防暴力试错）
    const cap = captchaStore.get(captchaId);
    if (cap) captchaStore.delete(captchaId);
    if (!cap || cap.expires < Date.now()) return res.status(400).json({ error: '验证码已过期，请刷新重试' });
    if (!captchaCode || captchaCode.toUpperCase() !== cap.code) return res.status(400).json({ error: '验证码错误' });

    if (!/^1\d{10}$/.test(phone)) return res.status(400).json({ error: '请输入正确的 11 位手机号' });

    const rows = await query(
      `SELECT o.id, o.order_no, o.shoot_date, o.date_tbd, o.status, o.remark,
              o.appointment_remark, o.external_remark, o.customer_phone, o.package_id,
              o.package_snapshot, o.total_amount, o.deposit, o.balance, o.paid_amount, o.payment_status,
              (SELECT a.style_req FROM appointments a WHERE a.order_id = o.id AND a.style_req IS NOT NULL AND a.style_req <> '' ORDER BY a.id DESC LIMIT 1) AS style_req,
              (SELECT p.name FROM packages p WHERE p.id = o.package_id LIMIT 1) AS package_name
       FROM orders o
       WHERE o.customer_phone = ? AND o.cancelled = 0 AND o.is_deleted = 0
       ORDER BY o.id DESC`,
      [phone]
    );

    const studio = await readStudioSetting();
    const showPrice = !!studio.showPriceToCustomer;
    const token = signQueryToken(phone);
    const orders = rows.map((o) => buildSummary(o, showPrice));
    res.json({ token, phone, showPrice, portfolioUrl: studio.portfolioUrl || '', orders, count: orders.length });
  } catch (e) {
    serverError(res, e);
  }
});

// ===== 3. 订单详情（query_token 鉴权，只读字段 + 合同可用标记）=====
router.get('/order/:orderId', async (req, res) => {
  try {
    const phone = verifyQueryToken(req.query.query_token);
    if (!phone) return res.status(403).json({ error: '查询会话已失效，请重新验证' });

    const o = await get(
      `SELECT o.id, o.order_no, o.shoot_date, o.date_tbd, o.status, o.remark,
              o.appointment_remark, o.external_remark, o.customer_phone, o.package_id,
              o.package_snapshot, o.total_amount, o.deposit, o.balance, o.paid_amount, o.payment_status,
              o.contract_file_key, o.contract_invalid,
              (SELECT a.style_req FROM appointments a WHERE a.order_id = o.id AND a.style_req IS NOT NULL AND a.style_req <> '' ORDER BY a.id DESC LIMIT 1) AS style_req,
              (SELECT p.name FROM packages p WHERE p.id = o.package_id LIMIT 1) AS package_name
       FROM orders o
       WHERE o.id = ? AND o.cancelled = 0 AND o.is_deleted = 0`,
      [req.params.orderId]
    );
    // 查不到 与 非本人：返回完全相同的文案与状态码，避免「订单是否存在」被探测（清单 2.4 / 黑名单）
    // 行级隔离仍然生效：订单手机号必须与查询会话绑定手机号完全一致
    if (!o) return forbiddenView(res);
    if (String(o.customer_phone || '') !== phone) return forbiddenView(res);

    const studio = await readStudioSetting();
    const showPrice = !!studio.showPriceToCustomer;
    const summary = buildSummary(o, showPrice);
    summary.contract_available = !!(o.contract_file_key && !Number(o.contract_invalid));
    res.json(summary);
  } catch (e) {
    serverError(res, e);
  }
});

export default router;
