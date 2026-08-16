// routes/selection.js —— 选片模块 V2（100% 原版复刻 + 架构稳定防护）
// 数据模型（贴合原版，不新增快照表）：
//   order_photo       底片元数据（属订单，跨轮次持久）
//   order_select_task 本轮选片任务状态机 + 缓存统计（每订单一行）
//   order_select_mark 单张标记 + 备注（status: keep 保留 / reject 淘汰；无行=未标记）
// 状态机（原版 5 态）：
//   not_started 未开启 → selecting 选片中 →（提交）→ pending_payment 待支付加片费 / completed 已完成 → reset 已重置
// 原版核心逻辑：
//   - 有加片费提交 → pending_payment，选片不锁定，客户可继续改标记；
//   - 无加片费提交 → completed，直接锁定；
//   - 支付成功 → completed，锁定标记 + 更新订单尾款；
//   - 商家重置 → 清空全部 mark，丢弃历史草稿，回到选片中（无系统回溯）；
// 鉴权（原版）：商家 PC/手机均可上传删除底片；子账号摄影师仅查看/预览/导出，禁止删除底片/重置。
// 架构稳定：所有多表写入强制事务、计算逻辑全局收敛（selectionCompute）、接口幂等、状态机后端强校验、异步通知不阻塞。
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { query, get, insert, run, withTransaction } from '../db.js';
import { authRequired, requireRole } from '../auth.js';
import { emitMessage } from './message.js';
import { generateEventTodo } from '../todo.js';
import { exportSelectionBackup } from '../backup.js';
import { emitBizMessage, emitBizToStaff, BIZ_TYPE } from './mobileMessage.js';
import {
  TASK_STATUS, MARK_STATUS,
  calcExtra, calcStats, summarizeMarks, selectionSummary, parsePrice
} from '../selectionCompute.js';

const router = Router();
const SECRET = process.env.JWT_SECRET || 'change_me_to_a_long_random_secret';
const STAFF_ROLES = ['admin', 'photographer', 'selector', 'finance'];
// 高危操作（上传底片/删除底片/重置选片）= 主账号 admin（原版：子账号摄影师禁止）
const SELECTION_ADMIN_ROLES = ['admin'];
// 线下收款录入 / 标记支付成功 = 主账号 + 财务
const PAY_ROLES = ['admin', 'finance'];
// 允许客户写操作（标记/提交）的订单状态：已拍摄 shot / 选片中 selecting
const WRITABLE_ORDER_STATUS = ['shot', 'selecting'];
// 可编辑的选片任务状态（原版：选片中 + 待支付加片费均可继续改标记）
const WRITABLE_TASK_STATUS = [TASK_STATUS.SELECTING, TASK_STATUS.PENDING_PAYMENT];
const MARK_STATUS_LIST = [MARK_STATUS.KEEP, MARK_STATUS.REJECT];

function nowISO() { return new Date().toISOString(); }
function isExpired(expireAt) {
  if (!expireAt) return false;
  const t = new Date(expireAt).getTime();
  return !Number.isNaN(t) && t < Date.now();
}

// 写订单变更记录（orders.logs，与订单详情底部「订单变更记录」同一数据源）；失败不阻塞主业务
async function appendOrderLog(orderId, text) {
  try {
    const cur = await get('SELECT logs FROM orders WHERE id = ?', [orderId]);
    let logs = [];
    if (cur && cur.logs) { try { logs = JSON.parse(cur.logs); } catch { logs = []; } }
    logs.push({ t: nowISO(), text });
    await run('UPDATE orders SET logs = ? WHERE id = ?', [JSON.stringify(logs), orderId]);
  } catch (e) { console.error('[selection] 写订单变更记录失败：', e.message); }
}

// ===== 选片访问令牌（密码通过后签发，2 小时有效；免密任务可不带） =====
function signSelectToken(taskId, orderId) {
  return jwt.sign({ kind: 'select', taskId, orderId }, SECRET, { expiresIn: '2h' });
}
function verifySelectToken(token) {
  try { const p = jwt.verify(token, SECRET); return p && p.kind === 'select' ? p : null; } catch { return null; }
}

async function resolveContext(token) {
  const order = await get('SELECT * FROM orders WHERE customer_token = ?', [token]);
  if (!order) return null;
  const task = await get('SELECT * FROM order_select_task WHERE order_id = ?', [order.id]);
  return { order, task };
}

async function loadPhotos(orderId) {
  return query('SELECT id, photo_key, url, thumb_url, sort FROM order_photo WHERE order_id = ? AND deleted = 0 ORDER BY sort ASC, id ASC', [orderId]);
}
async function loadMarks(taskId) {
  return query('SELECT id, photo_id, status, remark FROM order_select_mark WHERE task_id = ?', [taskId]);
}
async function totalPhotos(orderId) {
  const r = await get('SELECT COUNT(*) AS c FROM order_photo WHERE order_id = ? AND deleted = 0', [orderId]);
  return Number(r.c) || 0;
}

// 订单准入 + 写操作控制（统一判定，所有 C 端写接口前置）
// 原版：仅【已拍摄/开启选片】可操作；未开拍、已过期、已作废禁止写；已完成锁定只读
async function accessControl(order, task) {
  if (!order) return { writable: false, reason: '选片链接无效' };
  if (order.cancelled || order.is_deleted) return { writable: false, reason: '订单已关闭' };
  if (!task) return { writable: false, reason: '选片尚未开启' };
  if (task.status === TASK_STATUS.NOT_STARTED) return { writable: false, reason: '选片尚未开启' };
  const expired = isExpired(task.expire_at);
  if (expired) return { writable: false, reason: '选片已过期', expired: true };
  if (task.status === TASK_STATUS.RESET) return { writable: false, reason: '选片已重置，等待商家重新开启' };
  if (!WRITABLE_ORDER_STATUS.includes(order.status)) return { writable: false, reason: '尚未进入选片阶段' };
  if (task.status === TASK_STATUS.COMPLETED) return { writable: false, reason: '选片已完成，标记已锁定', completed: true };
  return { writable: true, reason: '' };
}

function passwordOk(task, plain) {
  if (!task.password_hash) return true;
  if (!plain) return false;
  return bcrypt.compare(String(plain), task.password_hash);
}

function markMap(marks) {
  const m = {};
  for (const r of marks) m[r.photo_id] = r;
  return m;
}

function clientPayload(order, task, photos, marks, total) {
  const summary = selectionSummary(marks, total, task.min_retouch, task.extra_price);
  const pkgName = (() => { try { const s = JSON.parse(order.package_snapshot || '{}'); return s.name || order.order_name || ''; } catch { return order.order_name || ''; } })();
  return {
    task: {
      status: task.status,
      min_retouch: Number(task.min_retouch) || 0,
      extra_price: Number(task.extra_price) || 0,
      watermark_enabled: !!Number(task.watermark_enabled),
      shuffle_enabled: !!Number(task.shuffle_enabled),
      expire_at: task.expire_at || null,
      pending_fee: Number(task.pending_fee) || 0,
      pending_count: Number(task.pending_count) || 0
    },
    order: { order_no: order.order_no || '', package_name: pkgName, customer_name: order.customer_name || '' },
    photos: photos.map((p) => ({ id: p.id, key: p.photo_key, url: p.url, thumb_url: p.thumb_url || p.url })),
    marks: marks.map((m) => ({ photo_id: m.photo_id, status: m.status, remark: m.remark || '' })),
    stats: summary.stats,
    extra: summary.extra
  };
}

// ===================== C 端公开接口（token 即凭证） =====================

// 任务元信息（含密码锁判断）；未解锁时仍返回项目名/免费张数/倒计时
router.get('/c/:token', async (req, res) => {
  try {
    const ctx = await resolveContext(req.params.token);
    if (!ctx) return res.status(404).json({ error: '选片链接无效或已失效' });
    const { order, task } = ctx;
    if (order.cancelled || order.is_deleted) return res.status(403).json({ error: '订单已关闭' });
    const meta = { order_no: order.order_no || '', package_name: order.order_name || '', customer_name: order.customer_name || '' };
    if (!task || task.status === TASK_STATUS.NOT_STARTED) return res.json({ ok: true, not_started: true, meta });
    const locked = !!(task.password_hash);
    const base = {
      ok: true, not_started: false, meta,
      task: { status: task.status, min_retouch: Number(task.min_retouch) || 0, expire_at: task.expire_at || null, expired: isExpired(task.expire_at), watermark_enabled: !!Number(task.watermark_enabled) },
      locked
    };
    if (locked) return res.json(base);
    const photos = await loadPhotos(order.id);
    const marks = await loadMarks(task.id);
    const total = await totalPhotos(order.id);
    res.json({ ...base, data: clientPayload(order, task, photos, marks, total) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 密码校验：通过返回完整数据 + select_token（写接口凭证）
router.post('/c/:token/verify', async (req, res) => {
  try {
    const ctx = await resolveContext(req.params.token);
    if (!ctx) return res.status(404).json({ error: '选片链接无效或已失效' });
    const { order, task } = ctx;
    if (!task) return res.status(404).json({ error: '选片尚未开启' });
    const ok = await passwordOk(task, (req.body && req.body.password) || '');
    if (!ok) return res.status(401).json({ error: '密码错误' });
    const photos = await loadPhotos(order.id);
    const marks = await loadMarks(task.id);
    const total = await totalPhotos(order.id);
    const ac = await accessControl(order, task);
    res.json({
      ok: true,
      select_token: signSelectToken(task.id, order.id),
      writable: ac.writable,
      writable_reason: ac.reason,
      data: clientPayload(order, task, photos, marks, total)
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 底片列表（缩略图分页）+ 标记 + 实时统计
router.get('/c/:token/photos', async (req, res) => {
  try {
    const ctx = await resolveContext(req.params.token);
    if (!ctx) return res.status(404).json({ error: '选片链接无效' });
    const { order, task } = ctx;
    if (!task) return res.status(404).json({ error: '选片尚未开启' });
    if (task.password_hash) {
      const st = verifySelectToken((req.headers['x-select-token'] || '').toString());
      if (!(st && st.taskId === task.id && st.orderId === order.id)) return res.status(401).json({ error: '请先验证访问密码' });
    }
    let photos = await loadPhotos(order.id);
    if (Number(task.shuffle_enabled)) photos = shufflePhotos(photos, Number(task.version) || 0);
    const marks = await loadMarks(task.id);
    const total = photos.length;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const size = Math.max(1, parseInt(req.query.size, 10) || 60);
    const paged = photos.slice((page - 1) * size, page * size);
    const summary = selectionSummary(marks, total, task.min_retouch, task.extra_price);
    const ac = await accessControl(order, task);
    res.json({
      ok: true,
      photos: paged.map((p) => ({ id: p.id, key: p.photo_key, thumb_url: p.thumb_url || p.url, url: p.url })),
      marks: marks.map((m) => ({ photo_id: m.photo_id, status: m.status, remark: m.remark || '' })),
      stats: summary.stats,
      extra: summary.extra,
      page, size, total,
      watermark_enabled: !!Number(task.watermark_enabled),
      expire_at: task.expire_at || null,
      status: task.status,
      writable: ac.writable
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 单张标记回写（keep/reject；status=null 取消标记回未标记；仅保留可带备注）
// 原版：选片中 + 待支付加片费 均可继续改标记；已完成/过期拦截
router.post('/c/:token/mark', async (req, res) => {
  try {
    const ctx = await resolveContext(req.params.token);
    if (!ctx) return res.status(404).json({ error: '选片链接无效' });
    const { order, task } = ctx;
    if (!task) return res.status(404).json({ error: '选片尚未开启' });
    const ac = await accessControl(order, task);
    if (!ac.writable) return res.status(403).json({ error: ac.reason });
    if (task.password_hash) {
      const st = verifySelectToken((req.headers['x-select-token'] || '').toString());
      if (!(st && st.taskId === task.id && st.orderId === order.id)) return res.status(401).json({ error: '请先验证访问密码' });
    }
    const photoId = parseInt((req.body && req.body.photoId), 10);
    const status = (req.body && req.body.status) || null;
    if (!photoId) return res.status(400).json({ error: '缺少照片标识' });
    if (status !== null && !MARK_STATUS_LIST.includes(status)) return res.status(400).json({ error: '非法标记状态' });
    const photo = await get('SELECT id FROM order_photo WHERE id = ? AND order_id = ? AND deleted = 0', [photoId, order.id]);
    if (!photo) return res.status(404).json({ error: '照片不存在' });
    let remark = (req.body && req.body.remark) || '';
    if (status !== MARK_STATUS.KEEP) remark = '';

    const existing = await get('SELECT id FROM order_select_mark WHERE task_id = ? AND photo_id = ?', [task.id, photoId]);
    if (status === null) {
      if (existing) await run('DELETE FROM order_select_mark WHERE id = ?', [existing.id]);
    } else if (existing) {
      await run('UPDATE order_select_mark SET status = ?, remark = ?, updated_at = ? WHERE id = ?', [status, remark, nowISO(), existing.id]);
    } else {
      await insert('INSERT INTO order_select_mark (task_id, photo_id, status, remark, updated_at) VALUES (?,?,?,?,?)', [task.id, photoId, status, remark, nowISO()]);
    }
    const marks = await loadMarks(task.id);
    const total = await totalPhotos(order.id);
    const summary = selectionSummary(marks, total, task.min_retouch, task.extra_price);
    await run('UPDATE order_select_task SET like_count = ?, exclude_count = ?, extra_count = ?, extra_fee = ?, updated_at = ? WHERE id = ?',
      [summary.stats.keep, summary.stats.reject, summary.extra.extraCount, summary.extra.extraFee, nowISO(), task.id]);
    res.json({ ok: true, stats: summary.stats, extra: summary.extra });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 批量清空全部标记（轻确认在前端）
router.post('/c/:token/clear', async (req, res) => {
  try {
    const ctx = await resolveContext(req.params.token);
    if (!ctx) return res.status(404).json({ error: '选片链接无效' });
    const { order, task } = ctx;
    if (!task) return res.status(404).json({ error: '选片尚未开启' });
    const ac = await accessControl(order, task);
    if (!ac.writable) return res.status(403).json({ error: ac.reason });
    if (task.password_hash) {
      const st = verifySelectToken((req.headers['x-select-token'] || '').toString());
      if (!(st && st.taskId === task.id && st.orderId === order.id)) return res.status(401).json({ error: '请先验证访问密码' });
    }
    await run('DELETE FROM order_select_mark WHERE task_id = ?', [task.id]);
    await run('UPDATE order_select_task SET like_count = 0, exclude_count = 0, extra_count = 0, extra_fee = 0, updated_at = ? WHERE id = ?', [nowISO(), task.id]);
    const total = await totalPhotos(order.id);
    res.json({ ok: true, stats: calcStats(0, 0, total), extra: calcExtra(0, task.min_retouch, task.extra_price) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 提交选片（原版核心逻辑）：
//   有加片费 → pending_payment，选片不锁定，客户可继续改标记；
//   无加片费 → completed，直接锁定。
// 幂等：重复提交不重复入账，仅在 pending_payment 态刷新待支付金额。
router.post('/c/:token/submit', async (req, res) => {
  try {
    const ctx = await resolveContext(req.params.token);
    if (!ctx) return res.status(404).json({ error: '选片链接无效' });
    const { order, task } = ctx;
    if (!task) return res.status(404).json({ error: '选片尚未开启' });
    const ac = await accessControl(order, task);
    if (!ac.writable) return res.status(403).json({ error: ac.reason });
    if (task.password_hash) {
      const st = verifySelectToken((req.headers['x-select-token'] || '').toString());
      if (!(st && st.taskId === task.id && st.orderId === order.id)) return res.status(401).json({ error: '请先验证访问密码' });
    }
    const photos = await loadPhotos(order.id);
    const marks = await loadMarks(task.id);
    const total = photos.length;
    const summary = selectionSummary(marks, total, task.min_retouch, task.extra_price);
    const submittedAt = nowISO();
    const hasFee = summary.extra.extraCount > 0;
    const nextStatus = hasFee ? TASK_STATUS.PENDING_PAYMENT : TASK_STATUS.COMPLETED;

    await withTransaction(async (tx) => {
      await tx.run('UPDATE order_select_task SET status = ?, like_count = ?, exclude_count = ?, extra_count = ?, extra_fee = ?, pending_fee = ?, pending_count = ?, submitted_at = ?, updated_at = ? WHERE id = ?',
        [nextStatus, summary.stats.keep, summary.stats.reject, summary.extra.extraCount, summary.extra.extraFee,
         hasFee ? summary.extra.extraFee : 0, hasFee ? summary.extra.extraCount : 0, submittedAt, submittedAt, task.id]);
    });

    // 通知（异步，不阻塞核心）
    try {
      const label = hasFee ? `待支付加片费 ¥${summary.extra.extraFee.toFixed(2)}` : '已完成';
      await generateEventTodo(order.id, hasFee ? 'select_pending_pay' : 'select_finish', hasFee ? '客户已提交选片待支付' : '客户完成选片',
        `客户「${order.customer_name || ''}」提交选片（保留 ${summary.stats.keep} 张，加选 ${summary.extra.extraCount} 张，${label}）`, `submit_${submittedAt}`);
      await emitMessage({
        message_type: 'order_msg', business_event: hasFee ? 'select_pending_pay' : 'select_finish',
        title: hasFee ? '客户提交选片（待支付）' : '客户完成选片',
        content: `${order.customer_name || '客户'} 提交选片（保留 ${summary.stats.keep} 张，加选 ${summary.extra.extraCount} 张，${label}）`,
        rel_id: String(order.id), rel_model: 'order'
      });
    } catch (e) { console.error('[selection] 提交后通知失败', e.message); }

    // 写入订单变更记录（客户提交）
    await appendOrderLog(order.id, `客户提交选片：保留 ${summary.stats.keep} 张、加选 ${summary.extra.extraCount} 张，进入「${nextStatus === TASK_STATUS.PENDING_PAYMENT ? '待支付加片费' : '已完成'}」`);
    // 移动端业务消息（与待办独立：同一事件同时生成消息 + 待办）
    try {
      await emitBizToStaff({
        title: '新选片提交',
        content: `客户「${order.customer_name || ''}」提交选片（保留 ${summary.stats.keep} 张，加选 ${summary.extra.extraCount} 张）`,
        biz_type: BIZ_TYPE.SELECT_PHOTO, biz_id: order.id
      });
    } catch (e) { console.error('[selection] 选片消息生成失败', e.message); }

    res.json({ ok: true, status: nextStatus, stats: summary.stats, extra: summary.extra, pending_fee: hasFee ? summary.extra.extraFee : 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 实时轮询（多人同 token 状态同步）
router.get('/c/:token/state', async (req, res) => {
  try {
    const ctx = await resolveContext(req.params.token);
    if (!ctx) return res.status(404).json({ error: '选片链接无效' });
    const { order, task } = ctx;
    if (!task) return res.json({ ok: true, not_started: true });
    const photos = await loadPhotos(order.id);
    const marks = await loadMarks(task.id);
    const summary = selectionSummary(marks, photos.length, task.min_retouch, task.extra_price);
    const ac = await accessControl(order, task);
    res.json({
      ok: true,
      status: task.status,
      completed: task.status === TASK_STATUS.COMPLETED,
      pending_payment: task.status === TASK_STATUS.PENDING_PAYMENT,
      pending_fee: Number(task.pending_fee) || 0,
      writable: ac.writable,
      writable_reason: ac.reason,
      stats: summary.stats,
      extra: summary.extra,
      expire_at: task.expire_at || null
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===================== B 端管理接口（需登录） =====================

function clientUrl(req, token) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('host') || '';
  return `${proto}://${host}/s/${token}`;
}

// 订单的选片任务总览（状态 + 统计摘要 + 待支付金额 + 底片数 + C 端链接）
router.get('/orders/:orderId/task', authRequired, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.orderId]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    const task = await get('SELECT * FROM order_select_task WHERE order_id = ?', [o.id]);
    const photos = task ? await loadPhotos(o.id) : [];
    const marks = task ? await loadMarks(task.id) : [];
    const total = photos.length;
    const summary = task ? selectionSummary(marks, total, task.min_retouch, task.extra_price) : { stats: calcStats(0, 0, 0), extra: calcExtra(0, 0, 0) };
    res.json({
      ok: true,
      task: task ? {
        id: task.id, status: task.status, min_retouch: Number(task.min_retouch) || 0,
        extra_price: Number(task.extra_price) || 0, watermark_enabled: !!Number(task.watermark_enabled),
        shuffle_enabled: !!Number(task.shuffle_enabled), has_password: !!task.password_hash,
        expire_at: task.expire_at || null, expired: isExpired(task.expire_at),
        pending_fee: Number(task.pending_fee) || 0, pending_count: Number(task.pending_count) || 0,
        paid_at: task.paid_at || null, pay_flow_no: task.pay_flow_no || '',
        submitted_at: task.submitted_at || null, reset_at: task.reset_at || null
      } : null,
      stats: summary.stats,
      extra: summary.extra,
      photo_total: total,
      customer_token: o.customer_token || null,
      share_url: o.customer_token ? clientUrl(req, o.customer_token) : null
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 开启 / 更新选片任务配置（密码/有效期/打乱/水印/免费张数/加片单价）；不存在则创建
router.post('/orders/:orderId/config', authRequired, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.orderId]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    const b = req.body || {};
    let task = await get('SELECT * FROM order_select_task WHERE order_id = ?', [o.id]);
    const init = (() => {
      let minRetouch = Number(o.retouch_count) || 0;
      let extraPrice = 0;
      try { const s = JSON.parse(o.package_snapshot || '{}'); const d = (s && s.details) || {};
        if (d.retouch_count != null && d.retouch_count !== '') minRetouch = Number(d.retouch_count) || minRetouch;
        if (d.extra_photo_fee != null && d.extra_photo_fee !== '') extraPrice = parsePrice(d.extra_photo_fee);
      } catch {}
      return { minRetouch: Math.max(0, minRetouch), extraPrice: Math.max(0, extraPrice) };
    })();
    const minRetouch = (b.min_retouch !== undefined) ? Math.max(0, parseInt(b.min_retouch, 10) || 0) : (task ? Number(task.min_retouch) : init.minRetouch);
    const extraPrice = (b.extra_price !== undefined) ? Math.max(0, parseFloat(b.extra_price) || 0) : (task ? Number(task.extra_price) : init.extraPrice);
    const watermark = (b.watermark_enabled !== undefined) ? (b.watermark_enabled ? 1 : 0) : (task ? Number(task.watermark_enabled) : 0);
    const shuffle = (b.shuffle_enabled !== undefined) ? (b.shuffle_enabled ? 1 : 0) : (task ? Number(task.shuffle_enabled) : 0);
    const expireAt = (b.expire_at !== undefined) ? (b.expire_at || null) : (task ? task.expire_at : null);
    let passwordHash = task ? task.password_hash : null;
    if (b.password !== undefined) passwordHash = b.password ? await bcrypt.hash(String(b.password), 10) : null;
    if (task) {
      await run('UPDATE order_select_task SET min_retouch = ?, extra_price = ?, watermark_enabled = ?, shuffle_enabled = ?, expire_at = ?, password_hash = ?, updated_at = ? WHERE id = ?',
        [minRetouch, extraPrice, watermark, shuffle, expireAt, passwordHash, nowISO(), task.id]);
    } else {
      const id = await insert(
        'INSERT INTO order_select_task (order_id, status, min_retouch, extra_price, watermark_enabled, shuffle_enabled, expire_at, password_hash) VALUES (?,?,?,?,?,?,?,?)',
        [o.id, TASK_STATUS.NOT_STARTED, minRetouch, extraPrice, watermark, shuffle, expireAt, passwordHash]
      );
      task = await get('SELECT * FROM order_select_task WHERE id = ?', [id]);
    }
    res.json({ ok: true, task: { id: task.id, status: task.status, min_retouch: minRetouch, extra_price: extraPrice, watermark_enabled: !!watermark, shuffle_enabled: !!shuffle, has_password: !!passwordHash, expire_at: expireAt } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 批量上传底片（原版：商家 PC/手机均可，无设备拦截）；上传即开启选片（not_started→selecting）
router.post('/orders/:orderId/photos', authRequired, requireRole(...SELECTION_ADMIN_ROLES), async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.orderId]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    const b = req.body || {};
    const rawPhotos = Array.isArray(b.photos) ? b.photos : [];
    const cleaned = rawPhotos.map((p, i) => ({
      key: (p && p.key) || ('p_' + Date.now() + '_' + i),
      url: (p && p.url) || '',
      thumb_url: (p && p.thumb_url) || (p && p.url) || ''
    })).filter((p) => p.url);
    if (!cleaned.length) return res.status(400).json({ error: '未收到有效底片' });

    let task = await get('SELECT * FROM order_select_task WHERE order_id = ?', [o.id]);
    if (!task) {
      const init = (() => { let m = Number(o.retouch_count) || 0; try { const s = JSON.parse(o.package_snapshot || '{}'); const d = (s && s.details) || {}; if (d.retouch_count != null && d.retouch_count !== '') m = Number(d.retouch_count) || m; } catch {} return Math.max(0, m); })();
      const id = await insert('INSERT INTO order_select_task (order_id, status, min_retouch, extra_price) VALUES (?,?,?,0)', [o.id, TASK_STATUS.SELECTING, init]);
      task = await get('SELECT * FROM order_select_task WHERE id = ?', [id]);
    } else if (task.status === TASK_STATUS.NOT_STARTED) {
      await run('UPDATE order_select_task SET status = ?, updated_at = ? WHERE id = ?', [TASK_STATUS.SELECTING, nowISO(), task.id]);
    }

    let nextSort = Number((await get('SELECT COALESCE(MAX(sort),0) AS m FROM order_photo WHERE order_id = ?', [o.id])).m) || 0;
    let added = 0;
    for (const p of cleaned) {
      nextSort += 1;
      const exist = await get('SELECT id FROM order_photo WHERE order_id = ? AND photo_key = ?', [o.id, p.key]);
      if (exist) {
        await run('UPDATE order_photo SET url = ?, thumb_url = ?, deleted = 0, updated_at = ? WHERE id = ?', [p.url, p.thumb_url, nowISO(), exist.id]);
      } else {
        await insert('INSERT INTO order_photo (order_id, photo_key, url, thumb_url, sort) VALUES (?,?,?,?,?)', [o.id, p.key, p.url, p.thumb_url, nextSort]);
        added += 1;
      }
    }
    const total = await totalPhotos(o.id);
    res.json({ ok: true, added, total });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 删除底片（原版：商家全设备，前端二次强确认）；自动清除该照片全部 mark + 后台重算统计
router.delete('/orders/:orderId/photos/:photoId', authRequired, requireRole(...SELECTION_ADMIN_ROLES), async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.orderId]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    const photoId = parseInt(req.params.photoId, 10);
    const photo = await get('SELECT id FROM order_photo WHERE id = ? AND order_id = ? AND deleted = 0', [photoId, o.id]);
    if (!photo) return res.status(404).json({ error: '底片不存在' });
    const task = await get('SELECT * FROM order_select_task WHERE order_id = ?', [o.id]);
    // 兜底防护：删除底片前自动导出订单选片备份（失败不阻塞主业务）
    let backup = null;
    try { backup = await exportSelectionBackup(o.id); } catch (e) { console.error('[selection] 删除底片前备份失败：', e.message); }
    await withTransaction(async (tx) => {
      await tx.run('UPDATE order_photo SET deleted = 1 WHERE id = ?', [photoId]);
      await tx.run('DELETE FROM order_select_mark WHERE photo_id = ?', [photoId]);
      if (task) {
        const marks = await tx.query('SELECT status FROM order_select_mark WHERE task_id = ?', [task.id]);
        const total = Number((await tx.get('SELECT COUNT(*) AS c FROM order_photo WHERE order_id = ? AND deleted = 0', [o.id])).c) || 0;
        const summary = selectionSummary(marks, total, task.min_retouch, task.extra_price);
        await tx.run('UPDATE order_select_task SET like_count = ?, exclude_count = ?, extra_count = ?, extra_fee = ?, updated_at = ? WHERE id = ?',
          [summary.stats.keep, summary.stats.reject, summary.extra.extraCount, summary.extra.extraFee, nowISO(), task.id]);
      }
    });
    // 写入订单变更记录（删除底片）
    await appendOrderLog(o.id, `删除底片（photo_id=${photoId}）`);
    // 移动端业务消息（删底片 + 备份导出）
    if (backup && backup.ok) { try { await emitBizToStaff({ title: '底片删除：备份文件已生成', content: `订单 ${o.order_no || o.id} 已删除底片，自动备份 ${backup.filename} 已生成`, biz_type: BIZ_TYPE.SYSTEM, biz_id: null }); } catch {} }
    res.json({ ok: true, backup: backup && backup.ok ? { filename: backup.filename, localPath: backup.localPath } : null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 实时监控（B 端）：客户 mark + 备注 + 筛选 + 实时统计
router.get('/orders/:orderId/monitor', authRequired, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.orderId]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    const task = await get('SELECT * FROM order_select_task WHERE order_id = ?', [o.id]);
    if (!task) return res.json({ ok: true, photos: [], stats: calcStats(0, 0, 0), extra: calcExtra(0, 0, 0) });
    const photos = await loadPhotos(o.id);
    const marks = await loadMarks(task.id);
    const mmap = markMap(marks);
    const filter = (req.query.filter || '').toString();
    const total = photos.length;
    const summary = selectionSummary(marks, total, task.min_retouch, task.extra_price);
    let list = photos.map((p) => ({
      id: p.id, key: p.photo_key, url: p.url, thumb_url: p.thumb_url || p.url,
      status: (mmap[p.id] && mmap[p.id].status) || null,
      remark: (mmap[p.id] && mmap[p.id].remark) || ''
    }));
    if (filter === 'keep') list = list.filter((x) => x.status === MARK_STATUS.KEEP);
    else if (filter === 'reject') list = list.filter((x) => x.status === MARK_STATUS.REJECT);
    else if (filter === 'unmarked') list = list.filter((x) => !x.status);
    res.json({ ok: true, photos: list, stats: summary.stats, extra: summary.extra, task: { status: task.status, pending_fee: Number(task.pending_fee) || 0 } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 重置选片（原版：商家执行，二次强确认在前端）；清空全部 mark、丢弃历史草稿、回到选片中（事务）
router.post('/orders/:orderId/reset', authRequired, requireRole(...SELECTION_ADMIN_ROLES), async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.orderId]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    const task = await get('SELECT * FROM order_select_task WHERE order_id = ?', [o.id]);
    if (!task) return res.status(404).json({ error: '选片任务不存在' });
    if (task.status === TASK_STATUS.SELECTING) return res.status(400).json({ error: '当前选片中，无需重置' });
    const version = Number(task.version) + 1;
    const resetAt = nowISO();
    // 兜底防护：重置前自动导出订单选片备份（弥补原版无历史快照；失败不阻塞）
    let backup = null;
    try { backup = await exportSelectionBackup(o.id); } catch (e) { console.error('[selection] 重置前备份失败：', e.message); }
    await withTransaction(async (tx) => {
      await tx.run('DELETE FROM order_select_mark WHERE task_id = ?', [task.id]);
      await tx.run('UPDATE order_select_task SET status = ?, like_count = 0, exclude_count = 0, extra_count = 0, extra_fee = 0, pending_fee = 0, pending_count = 0, version = ?, reset_at = ?, updated_at = ? WHERE id = ?',
        [TASK_STATUS.SELECTING, version, resetAt, resetAt, task.id]);
    });
    // 写入订单变更记录（重置选片）
    await appendOrderLog(o.id, `商家重置选片（第 ${version} 轮），清空全部草稿标记`);
    try {
      await generateEventTodo(o.id, 'select_reset', '待客户重新选片', `商家已重置选片（第 ${version} 轮），客户需重新选片`, `reset_${resetAt}`);
      await emitMessage({ message_type: 'order_msg', business_event: 'select_reset', title: '选片已重置', content: `订单 ${o.order_no || o.id} 选片已重置，客户需重新选片`, rel_id: String(o.id), rel_model: 'order' });
      // 移动端业务消息（重置选片 + 备份导出）
      if (backup && backup.ok) await emitBizToStaff({ title: '重置选片：备份文件已生成', content: `订单 ${o.order_no || o.id} 选片已重置，自动备份 ${backup.filename} 已生成`, biz_type: BIZ_TYPE.SYSTEM, biz_id: null });
    } catch (e) { console.error('[selection] 重置后通知失败', e.message); }
    res.json({ ok: true, version, status: TASK_STATUS.SELECTING, backup: backup && backup.ok ? { filename: backup.filename, localPath: backup.localPath } : null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 标记支付成功（线下收款录入 / 线上回调统一入口）：pending_payment → completed，锁定标记 + 更新订单尾款（事务）
// 原版：仅支付成功才更新订单尾款；待支付金额仅预览。
async function markPaid(orderId, flowNo, channel, method) {
  const task = await get('SELECT * FROM order_select_task WHERE order_id = ?', [orderId]);
  if (!task) throw new Error('选片任务不存在');
  if (task.status === TASK_STATUS.COMPLETED) return { already: true, fee: 0 };
  if (task.status !== TASK_STATUS.PENDING_PAYMENT) throw new Error('当前状态不可支付');
  const fee = Number(task.pending_fee) || 0;
  const paidAt = nowISO();
  await withTransaction(async (tx) => {
    await tx.run('UPDATE order_select_task SET status = ?, paid_at = ?, pay_flow_no = ?, updated_at = ? WHERE id = ?',
      [TASK_STATUS.COMPLETED, paidAt, flowNo, paidAt, task.id]);
    if (fee > 0) {
      const o = await tx.get('SELECT balance, order_no FROM orders WHERE id = ?', [orderId]);
      await tx.insert('INSERT INTO payments (order_id, order_no, type, amount, method, channel, note) VALUES (?,?,?,?,?,?,?)',
        [orderId, o.order_no || '', 'extra', fee, method, channel, '选片加片缴费']);
      await tx.run('UPDATE orders SET balance = ? WHERE id = ?', [Math.max(0, Number(o.balance) - fee), orderId]);
    }
  });
  return { already: false, fee };
}

// 线下收款录入（admin/finance）：标记支付成功
router.post('/orders/:orderId/pay', authRequired, requireRole(...PAY_ROLES), async (req, res) => {
  try {
    const b = req.body || {};
    const r = await markPaid(req.params.orderId, String(b.pay_flow_no || '').trim(), b.channel || 'cash', 'offline');
    // 审计：支付成功（操作人 + 状态变更前后值）
    if (!r.already) await appendOrderLog(req.params.orderId, `选片加片费已支付 ¥${Number(r.fee || 0).toFixed(2)}（${b.channel || 'cash'}）`);
    // 移动端业务消息（支付成功）
    if (!r.already) { try { await emitBizToStaff({ title: '选片-客户已完成付款', content: `订单 ${req.params.orderId} 选片加片费已支付 ¥${Number(r.fee || 0).toFixed(2)}`, biz_type: BIZ_TYPE.SELECT_PHOTO, biz_id: req.params.orderId }); } catch {} }
    try {
      await emitMessage({ message_type: 'order_msg', business_event: 'select_paid', title: '选片加片费已支付', content: `订单 ${req.params.orderId} 选片加片费已支付`, rel_id: String(req.params.orderId), rel_model: 'order' });
    } catch {}
    res.json({ ok: true, status: TASK_STATUS.COMPLETED, already: r.already });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// 预留：线上支付回调（成功更新状态 + 流水 + 尾款；失败维持待支付不改任务状态）
router.post('/orders/:orderId/pay-callback', async (req, res) => {
  try {
    const b = req.body || {};
    const success = String(b.status) === 'success' || String(b.result_code) === 'SUCCESS';
    if (!success) return res.json({ ok: true, status: TASK_STATUS.PENDING_PAYMENT, message: '支付未成功，维持待支付' });
    const r = await markPaid(req.params.orderId, String(b.transaction_id || b.pay_flow_no || '').trim(), 'online', 'online');
    if (!r.already) await appendOrderLog(req.params.orderId, `选片加片费线上支付成功（流水号 ${b.transaction_id || b.pay_flow_no || ''}）`);
    res.json({ ok: true, status: TASK_STATUS.COMPLETED, already: r.already });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// 导出交付清单（原版：仅已完成状态可正式交付导出；待支付仅预览；数据源=当前标记，自动过滤淘汰；TXT/Excel）
router.get('/orders/:orderId/export', authRequired, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.orderId]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    const task = await get('SELECT * FROM order_select_task WHERE order_id = ?', [o.id]);
    if (!task) return res.status(404).json({ error: '选片任务不存在' });
    if (task.status !== TASK_STATUS.COMPLETED) {
      return res.status(400).json({ error: task.status === TASK_STATUS.PENDING_PAYMENT ? '选片待支付加片费，仅可预览，不可正式交付导出' : '选片未完成，不可导出' });
    }
    const fmt = (req.query.format || 'txt').toString().toLowerCase();
    const photos = await loadPhotos(o.id);
    const marks = await loadMarks(task.id);
    const mmap = markMap(marks);
    const rows = photos.filter((p) => mmap[p.id] && mmap[p.id].status === MARK_STATUS.KEEP).map((p) => ({ photo_key: p.photo_key, url: p.url, remark: (mmap[p.id] && mmap[p.id].remark) || '' }));
    const orderNo = o.order_no || o.id;
    const paidAt = (task.paid_at || task.submitted_at || '').slice(0, 19).replace('T', ' ');
    const extraFee = Number(task.extra_fee) || 0;
    if (fmt === 'excel' || fmt === 'xls') {
      const xml = [
        '<?xml version="1.0"?>', '<?mso-application progid="Excel.Sheet"?>',
        '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
        '<Worksheet ss:Name="选片清单"><Table>',
        '<Row>' + ['照片ID', '标记类型', '客户修图备注'].map((c) => `<Cell><Data ss:Type="String">${xmlEscape(c)}</Data></Cell>`).join('') + '</Row>'
      ];
      for (const r of rows) xml.push('<Row>' + [r.photo_key || '', '保留', r.remark || ''].map((c) => `<Cell><Data ss:Type="String">${xmlEscape(String(c))}</Data></Cell>`).join('') + '</Row>');
      xml.push('</Table></Worksheet></Workbook>');
      res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="selection_${orderNo}_${paidAt.replace(/[: ]/g, '')}.xls"`);
      return res.send('\ufeff' + xml.join(''));
    }
    const lines = [];
    lines.push('========================================');
    lines.push('选片交付清单');
    lines.push('订单编号：' + orderNo);
    lines.push('客户姓名：' + (o.customer_name || ''));
    lines.push('交付时间：' + paidAt);
    lines.push('========================================');
    lines.push(`保留精修：${Number(task.like_count) || 0} 张　加选：${Number(task.extra_count) || 0} 张　加选金额：¥${extraFee.toFixed(2)}`);
    lines.push('');
    lines.push('---- 明细（已过滤淘汰）----');
    rows.forEach((r, i) => { lines.push(`第${i + 1}张　[保留]　${r.photo_key || ''}　${r.remark ? '备注：' + r.remark : ''}`); });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="selection_${orderNo}_${paidAt.replace(/[: ]/g, '')}.txt"`);
    res.send('\ufeff' + lines.join('\r\n'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== 工具 =====
function shufflePhotos(photos, seed) {
  const arr = photos.slice();
  arr.sort((a, b) => hashInt(a.id, seed) - hashInt(b.id, seed));
  return arr;
}
function hashInt(id, seed) {
  let x = (Number(id) * 2654435761 + Number(seed) * 40503 + 97531) % 2147483647;
  x = (x * 1103515245 + 12345) & 0x7fffffff;
  return x;
}
function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default router;
