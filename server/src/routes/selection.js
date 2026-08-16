// routes/selection.js —— 选片模块 V2（四表架构 + 状态机 + 鉴权分层 + 事务）
// 数据模型：
//   order_photo                底片元数据（属订单，跨轮次持久）
//   order_select_task          本轮选片任务状态机 + 缓存统计（每订单一行）
//   order_select_mark          单张标记 + 备注（status: keep 保留 / reject 淘汰；无行 = 未标记）
//   order_select_submit_history 提交快照归档（只增不改，仅允许更新 pay_status/流水）
// 鉴权：
//   设备枚举 device = pc / mobile_b(商家手机) / mobile_c(客户手机)；商家角色 admin/photographer/selector/finance
//   底片上传/删除、重置选片 = 商家 + PC（admin 主账号）；手机端 403；客户 403
//   C 端 token = orders.customer_token（强绑定 order_id），选片访问密码为可选二重校验
// 状态机：not_started(未开启) → selecting(选片中) → submitted(已提交) → 重置回到 selecting
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { query, get, insert, run, withTransaction } from '../db.js';
import { authRequired, requireRole } from '../auth.js';
import { emitMessage } from './message.js';
import { generateEventTodo } from '../todo.js';
import {
  TASK_STATUS, MARK_STATUS, PAY_STATUS,
  calcExtra, calcStats, summarizeMarks, selectionSummary, parsePrice
} from '../selectionCompute.js';

const router = Router();
const SECRET = process.env.JWT_SECRET || 'change_me_to_a_long_random_secret';
const STAFF_ROLES = ['admin', 'photographer', 'selector', 'finance'];
// 高危操作（上传底片 / 删除底片 / 重置选片）= 主账号 admin
const SELECTION_ADMIN_ROLES = ['admin'];
// 线下收款录入 = 主账号 + 财务
const PAY_ROLES = ['admin', 'finance'];
// 允许客户写操作（标记/提交）的订单状态：已拍摄 shot / 选片中 selecting
const WRITABLE_ORDER_STATUS = ['shot', 'selecting'];
const MARK_STATUS_LIST = [MARK_STATUS.KEEP, MARK_STATUS.REJECT];

function nowISO() { return new Date().toISOString(); }
function isExpired(expireAt) {
  if (!expireAt) return false;
  const t = new Date(expireAt).getTime();
  return !Number.isNaN(t) && t < Date.now();
}

// ===== 设备枚举：优先显式 header/query，缺失时按 UA 兜底 =====
function deviceOf(req) {
  const h = (req.headers['x-device'] || '').toString().toLowerCase();
  if (['pc', 'mobile_b', 'mobile_c'].includes(h)) return h;
  const q = (req.query.device || '').toString().toLowerCase();
  if (['pc', 'mobile_b', 'mobile_c'].includes(q)) return q;
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  const isMobile = /android|iphone|ipad|ipod|mobile/i.test(ua);
  // 商家手机 vs 客户手机无法从 UA 精确区分，兜底按「有商家 token 且移动」判断在调用方处理
  return isMobile ? 'mobile_b' : 'pc';
}

// ===== 选片访问令牌（密码通过后签发，2 小时有效；免密任务可不带） =====
function signSelectToken(taskId, orderId) {
  return jwt.sign({ kind: 'select', taskId, orderId }, SECRET, { expiresIn: '2h' });
}
function verifySelectToken(token) {
  try { const p = jwt.verify(token, SECRET); return p && p.kind === 'select' ? p : null; } catch { return null; }
}

// ===== C 端上下文：customer_token → order + task =====
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
// 返回 { writable, reason, expired, submitted }
async function accessControl(order, task) {
  if (!order) return { writable: false, reason: '选片链接无效' };
  if (order.cancelled || order.is_deleted) return { writable: false, reason: '订单已关闭' };
  if (!task) return { writable: false, reason: '选片尚未开启' };
  if (task.status === TASK_STATUS.NOT_STARTED) return { writable: false, reason: '选片尚未开启' };
  const expired = isExpired(task.expire_at);
  if (expired) return { writable: false, reason: '选片已过期', expired: true };
  if (task.status === TASK_STATUS.SUBMITTED) return { writable: false, reason: '选片已提交，无法修改', submitted: true };
  if (task.status === TASK_STATUS.RESET) return { writable: false, reason: '选片已重置，等待商家重新开启' };
  // 待定金/待拍摄等订单状态拦截写操作（过期订单仅只读）
  if (!WRITABLE_ORDER_STATUS.includes(order.status)) {
    return { writable: false, reason: '尚未进入选片阶段' };
  }
  // 可配置：基础尾款未结清禁止进入选片
  try {
    const s = await get("SELECT value FROM settings WHERE key = 'selection_require_balance'");
    if (s && String(s.value) === '1' && Number(order.balance) > 0) {
      return { writable: false, reason: '尾款未结清，暂不能选片' };
    }
  } catch {}
  return { writable: true, reason: '' };
}

// 密码校验（可选二重校验）
function passwordOk(task, plain) {
  if (!task.password_hash) return true;
  if (!plain) return false;
  return bcrypt.compare(String(plain), task.password_hash);
}

// ===== 通用返回装配 =====
function markMap(marks) {
  const m = {};
  for (const r of marks) m[r.photo_id] = r;
  return m;
}

// 快照生成（后端读取 mark，绝不接收前端传入快照数据）
async function buildSnapshot(task, order, marks, photos) {
  const pmap = {};
  for (const p of photos) pmap[p.id] = p;
  return marks.map((m) => ({
    photo_id: m.photo_id,
    photo_key: (pmap[m.photo_id] && pmap[m.photo_id].photo_key) || '',
    url: (pmap[m.photo_id] && pmap[m.photo_id].url) || '',
    status: m.status,
    remark: m.remark || ''
  }));
}

// 客户侧公开数据（绝不返回密码哈希）
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
      version: Number(task.version) || 0
    },
    order: { order_no: order.order_no || '', package_name: pkgName, customer_name: order.customer_name || '' },
    photos: photos.map((p) => ({ id: p.id, key: p.photo_key, url: p.url, thumb_url: p.thumb_url || p.url })),
    marks: marks.map((m) => ({ photo_id: m.photo_id, status: m.status, remark: m.remark || '' })),
    stats: summary.stats,
    extra: summary.extra
  };
}

// 选片结果清单列（导出/快照展示统一）
function snapshotRows(snapshot) {
  return Array.isArray(snapshot) ? snapshot.filter((x) => x.status === MARK_STATUS.KEEP) : [];
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
    if (!task) return res.json({ ok: true, not_started: true, meta });
    if (task.status === TASK_STATUS.NOT_STARTED) return res.json({ ok: true, not_started: true, meta });
    const locked = !!(task.password_hash);
    const base = {
      ok: true, not_started: false, meta,
      task: {
        status: task.status,
        min_retouch: Number(task.min_retouch) || 0,
        expire_at: task.expire_at || null,
        expired: isExpired(task.expire_at),
        watermark_enabled: !!Number(task.watermark_enabled)
      },
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
    // 可选密码校验：header 带密码或 select_token
    if (task.password_hash) {
      const st = verifySelectToken((req.headers['x-select-token'] || '').toString());
      if (!(st && st.taskId === task.id && st.orderId === order.id)) {
        return res.status(401).json({ error: '请先验证访问密码' });
      }
    }
    let photos = await loadPhotos(order.id);
    if (Number(task.shuffle_enabled)) photos = shufflePhotos(photos, Number(task.version) || 0);
    const marks = await loadMarks(task.id);
    const total = photos.length;
    // 分页
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const size = Math.max(1, parseInt(req.query.size, 10) || 60);
    const paged = photos.slice((page - 1) * size, page * size);
    const summary = selectionSummary(marks, total, task.min_retouch, task.extra_price);
    res.json({
      ok: true,
      photos: paged.map((p) => ({ id: p.id, key: p.photo_key, thumb_url: p.thumb_url || p.url, url: p.url })),
      marks: marks.map((m) => ({ photo_id: m.photo_id, status: m.status, remark: m.remark || '' })),
      stats: summary.stats,
      extra: summary.extra,
      page, size, total,
      watermark_enabled: !!Number(task.watermark_enabled),
      expire_at: task.expire_at || null,
      writable: (await accessControl(order, task)).writable
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 单张标记回写（keep/reject；status=null 取消标记回未标记；仅保留可带备注）
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
      if (!(st && st.taskId === task.id && st.orderId === order.id)) {
        return res.status(401).json({ error: '请先验证访问密码' });
      }
    }
    const photoId = parseInt((req.body && req.body.photoId), 10);
    const status = (req.body && req.body.status) || null; // keep / reject / null(取消)
    if (!photoId) return res.status(400).json({ error: '缺少照片标识' });
    if (status !== null && !MARK_STATUS_LIST.includes(status)) return res.status(400).json({ error: '非法标记状态' });
    const photo = await get('SELECT id FROM order_photo WHERE id = ? AND order_id = ? AND deleted = 0', [photoId, order.id]);
    if (!photo) return res.status(404).json({ error: '照片不存在' });
    let remark = (req.body && req.body.remark) || '';
    if (status !== MARK_STATUS.KEEP) remark = ''; // 仅保留可编辑备注，淘汰/取消置空

    const existing = await get('SELECT id FROM order_select_mark WHERE task_id = ? AND photo_id = ?', [task.id, photoId]);
    if (status === null) {
      if (existing) await run('DELETE FROM order_select_mark WHERE id = ?', [existing.id]);
    } else if (existing) {
      await run('UPDATE order_select_mark SET status = ?, remark = ?, updated_at = ? WHERE id = ?', [status, remark, nowISO(), existing.id]);
    } else {
      await insert('INSERT INTO order_select_mark (task_id, photo_id, status, remark, updated_at) VALUES (?,?,?,?,?)', [task.id, photoId, status, remark, nowISO()]);
    }
    // 后台重算统计（缓存）
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
      if (!(st && st.taskId === task.id && st.orderId === order.id)) {
        return res.status(401).json({ error: '请先验证访问密码' });
      }
    }
    await run('DELETE FROM order_select_mark WHERE task_id = ?', [task.id]);
    await run('UPDATE order_select_task SET like_count = 0, exclude_count = 0, extra_count = 0, extra_fee = 0, updated_at = ? WHERE id = ?', [nowISO(), task.id]);
    const total = await totalPhotos(order.id);
    const stats = calcStats(0, 0, total);
    const extra = calcExtra(0, task.min_retouch, task.extra_price);
    res.json({ ok: true, stats, extra });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 提交选片：生成快照 + 锁定标记 + 待办通知；不修改订单尾款（事务）
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
      if (!(st && st.taskId === task.id && st.orderId === order.id)) {
        return res.status(401).json({ error: '请先验证访问密码' });
      }
    }
    const photos = await loadPhotos(order.id);
    const marks = await loadMarks(task.id);
    const total = photos.length;
    const summary = selectionSummary(marks, total, task.min_retouch, task.extra_price);
    const version = Number(task.version) + 1;
    const submittedAt = nowISO();

    const historyId = await withTransaction(async (tx) => {
      const snapshot = await buildSnapshot(task, order, marks, photos);
      const hid = await tx.insert(
        'INSERT INTO order_select_submit_history (order_id, task_id, version, snapshot, retouch_count, extra_count, extra_fee, pay_status, submitted_at) VALUES (?,?,?,?,?,?,?,?,?)',
        [order.id, task.id, version, JSON.stringify(snapshot), summary.stats.keep, summary.extra.extraCount, summary.extra.extraFee, PAY_STATUS.UNPAID, submittedAt]
      );
      await tx.run('UPDATE order_select_task SET status = ?, submitted_at = ?, like_count = ?, exclude_count = ?, extra_count = ?, extra_fee = ?, version = ?, updated_at = ? WHERE id = ?',
        [TASK_STATUS.SUBMITTED, submittedAt, summary.stats.keep, summary.stats.reject, summary.extra.extraCount, summary.extra.extraFee, version, submittedAt, task.id]);
      return hid;
    });

    // 待办 + 消息（辅助通知，异常不阻塞主业务）
    try {
      await generateEventTodo(order.id, 'select_submitted', '客户已提交选片', `客户「${order.customer_name || ''}」已完成选片（保留 ${summary.stats.keep} 张，加选 ${summary.extra.extraCount} 张）`, `submit_${historyId}`);
      await emitMessage({
        message_type: 'order_msg', business_event: 'select_finish',
        title: '客户完成选片', content: `${order.customer_name || '客户'} 已完成选片（保留 ${summary.stats.keep} 张，加选 ${summary.extra.extraCount} 张）`,
        rel_id: String(order.id), rel_model: 'order'
      });
    } catch (e) { console.error('[selection] 提交后通知失败', e.message); }

    res.json({ ok: true, historyId, version, stats: summary.stats, extra: summary.extra, submitted: true });
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
      submitted: task.status === TASK_STATUS.SUBMITTED,
      writable: ac.writable,
      writable_reason: ac.reason,
      stats: summary.stats,
      extra: summary.extra,
      expire_at: task.expire_at || null
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 我的提交记录（只读，客户可查看每一次提交快照版本）
router.get('/c/:token/history', async (req, res) => {
  try {
    const ctx = await resolveContext(req.params.token);
    if (!ctx) return res.status(404).json({ error: '选片链接无效' });
    const { order, task } = ctx;
    if (!task) return res.json({ ok: true, items: [] });
    if (task.password_hash) {
      const st = verifySelectToken((req.headers['x-select-token'] || '').toString());
      if (!(st && st.taskId === task.id && st.orderId === order.id)) {
        return res.status(401).json({ error: '请先验证访问密码' });
      }
    }
    const rows = await query('SELECT id, version, retouch_count, extra_count, extra_fee, pay_status, submitted_at FROM order_select_submit_history WHERE order_id = ? ORDER BY version DESC', [order.id]);
    res.json({
      ok: true,
      items: rows.map((r) => ({
        id: r.id, version: r.version, retouch_count: Number(r.retouch_count) || 0,
        extra_count: Number(r.extra_count) || 0, extra_fee: Number(r.extra_fee) || 0,
        pay_status: r.pay_status || PAY_STATUS.UNPAID, submitted_at: r.submitted_at
      }))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===================== B 端管理接口（需登录） =====================

// 设备 + 角色双鉴权：底片上传/删除/重置 仅「商家 + PC」
function requireMerchantPc() {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '未登录' });
    if (!STAFF_ROLES.includes(req.user.role)) return res.status(403).json({ error: '仅商家可操作' });
    const d = deviceOf(req);
    if (d !== 'pc') return res.status(403).json({ error: '该操作仅限电脑端（商家手机端已隐藏）' });
    next();
  };
}

function clientUrl(req, token) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('host') || '';
  return `${proto}://${host}/s/${token}`;
}

// 订单的选片任务总览（状态 + 统计摘要 + pay_status + 底片数 + C 端链接）
router.get('/orders/:orderId/task', authRequired, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.orderId]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    const task = await get('SELECT * FROM order_select_task WHERE order_id = ?', [o.id]);
    const photos = task ? await loadPhotos(o.id) : [];
    const marks = task ? await loadMarks(task.id) : [];
    const total = photos.length;
    const summary = task ? selectionSummary(marks, total, task.min_retouch, task.extra_price) : { stats: calcStats(0, 0, 0), extra: calcExtra(0, 0, 0) };
    const lastHistory = task ? await get('SELECT id, version, pay_status, submitted_at FROM order_select_submit_history WHERE order_id = ? ORDER BY version DESC LIMIT 1', [o.id]) : null;
    res.json({
      ok: true,
      task: task ? {
        id: task.id, status: task.status, min_retouch: Number(task.min_retouch) || 0,
        extra_price: Number(task.extra_price) || 0, watermark_enabled: !!Number(task.watermark_enabled),
        shuffle_enabled: !!Number(task.shuffle_enabled), has_password: !!task.password_hash,
        expire_at: task.expire_at || null, expired: isExpired(task.expire_at), version: Number(task.version) || 0,
        submitted_at: task.submitted_at || null, reset_at: task.reset_at || null
      } : null,
      stats: summary.stats,
      extra: summary.extra,
      photo_total: total,
      pay_status: lastHistory ? lastHistory.pay_status : null,
      customer_token: o.customer_token || null,
      share_url: o.customer_token ? clientUrl(req, o.customer_token) : null,
      history_count: task ? Number((await get('SELECT COUNT(*) AS c FROM order_select_submit_history WHERE order_id = ?', [o.id])).c) || 0 : 0
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
    // 密码：undefined 不改；空串清除；非空设置
    let passwordHash = task ? task.password_hash : null;
    if (b.password !== undefined) {
      passwordHash = b.password ? await bcrypt.hash(String(b.password), 10) : null;
    }
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

// 批量上传底片（仅商家 PC）；上传即开启选片（not_started→selecting）
router.post('/orders/:orderId/photos', authRequired, requireRole(...SELECTION_ADMIN_ROLES), requireMerchantPc(), async (req, res) => {
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
      // 重传幂等：同 key 已存在则更新 url
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

// 删除底片（仅商家 PC，前端二次强确认）；自动清除该照片全部 mark + 后台重算统计
router.delete('/orders/:orderId/photos/:photoId', authRequired, requireRole(...SELECTION_ADMIN_ROLES), requireMerchantPc(), async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.orderId]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    const photoId = parseInt(req.params.photoId, 10);
    const photo = await get('SELECT id FROM order_photo WHERE id = ? AND order_id = ? AND deleted = 0', [photoId, o.id]);
    if (!photo) return res.status(404).json({ error: '底片不存在' });
    const task = await get('SELECT * FROM order_select_task WHERE order_id = ?', [o.id]);
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
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 实时监控（B 端）：客户 mark + 备注 + 筛选 + 实时统计
router.get('/orders/:orderId/monitor', authRequired, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.orderId]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    const task = await get('SELECT * FROM order_select_task WHERE order_id = ?', [o.id]);
    if (!task) return res.json({ ok: true, photos: [], marks: [], stats: calcStats(0, 0, 0), extra: calcExtra(0, 0, 0) });
    const photos = await loadPhotos(o.id);
    const marks = await loadMarks(task.id);
    const mmap = markMap(marks);
    const filter = (req.query.filter || '').toString(); // all/keep/reject/unmarked
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
    res.json({ ok: true, photos: list, stats: summary.stats, extra: summary.extra, task: { status: task.status, version: Number(task.version) || 0 } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 重置选片（仅商家 PC，二次强确认在前端）；清空本轮 mark、统计清零、历史快照保留、生成待办（事务）
router.post('/orders/:orderId/reset', authRequired, requireRole(...SELECTION_ADMIN_ROLES), requireMerchantPc(), async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.orderId]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    const task = await get('SELECT * FROM order_select_task WHERE order_id = ?', [o.id]);
    if (!task) return res.status(404).json({ error: '选片任务不存在' });
    if (task.status === TASK_STATUS.SELECTING) return res.status(400).json({ error: '当前选片中，无需重置' });
    const version = Number(task.version) + 1;
    const resetAt = nowISO();
    await withTransaction(async (tx) => {
      await tx.run('DELETE FROM order_select_mark WHERE task_id = ?', [task.id]);
      await tx.run('UPDATE order_select_task SET status = ?, like_count = 0, exclude_count = 0, extra_count = 0, extra_fee = 0, version = ?, reset_at = ?, updated_at = ? WHERE id = ?',
        [TASK_STATUS.SELECTING, version, resetAt, resetAt, task.id]);
    });
    try {
      await generateEventTodo(o.id, 'select_reset', '待客户重新选片', `商家已重置选片（第 ${version} 轮），客户需重新选片`, `reset_${resetAt}`);
      await emitMessage({
        message_type: 'order_msg', business_event: 'select_reset',
        title: '选片已重置', content: `订单 ${o.order_no || o.id} 选片已重置，客户需重新选片`,
        rel_id: String(o.id), rel_model: 'order'
      });
    } catch (e) { console.error('[selection] 重置后通知失败', e.message); }
    res.json({ ok: true, version, status: TASK_STATUS.SELECTING });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 提交历史列表（永久展示每一次提交版本）
router.get('/orders/:orderId/history', authRequired, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.orderId]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    const rows = await query('SELECT id, version, retouch_count, extra_count, extra_fee, pay_status, pay_flow_no, submitted_at FROM order_select_submit_history WHERE order_id = ? ORDER BY version DESC', [o.id]);
    res.json({
      ok: true,
      items: rows.map((r) => ({
        id: r.id, version: r.version, retouch_count: Number(r.retouch_count) || 0,
        extra_count: Number(r.extra_count) || 0, extra_fee: Number(r.extra_fee) || 0,
        pay_status: r.pay_status || PAY_STATUS.UNPAID, pay_flow_no: r.pay_flow_no || '', submitted_at: r.submitted_at
      }))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 单条提交快照详情（完整快照只读回溯）
router.get('/orders/:orderId/history/:historyId', authRequired, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const h = await get('SELECT * FROM order_select_submit_history WHERE id = ? AND order_id = ?', [req.params.historyId, req.params.orderId]);
    if (!h) return res.status(404).json({ error: '提交记录不存在' });
    let snapshot = [];
    try { snapshot = JSON.parse(h.snapshot || '[]'); } catch {}
    res.json({
      ok: true,
      item: {
        id: h.id, version: h.version, retouch_count: Number(h.retouch_count) || 0,
        extra_count: Number(h.extra_count) || 0, extra_fee: Number(h.extra_fee) || 0,
        pay_status: h.pay_status || PAY_STATUS.UNPAID, pay_flow_no: h.pay_flow_no || '',
        submitted_at: h.submitted_at, snapshot
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 线下收款录入（admin/finance）：更新 pay_status + 流水号 + 订单尾款（事务）
// 说明：线上缴费自动入账走 pay-callback；线下收款由商家手动录入增值费用
router.post('/orders/:orderId/history/:historyId/pay', authRequired, requireRole(...PAY_ROLES), async (req, res) => {
  try {
    const h = await get('SELECT * FROM order_select_submit_history WHERE id = ? AND order_id = ?', [req.params.historyId, req.params.orderId]);
    if (!h) return res.status(404).json({ error: '提交记录不存在' });
    const b = req.body || {};
    const flowNo = String(b.pay_flow_no || '').trim();
    const paidAt = nowISO();
    await withTransaction(async (tx) => {
      await tx.run('UPDATE order_select_submit_history SET pay_status = ?, pay_flow_no = ?, paid_at = ? WHERE id = ?', [PAY_STATUS.PAID, flowNo, paidAt, h.id]);
      // 订单尾款入账：加选金额计入 payments 流水（线下）+ 更新订单 balance
      if (Number(h.extra_fee) > 0) {
        const o = await tx.get('SELECT balance, order_no FROM orders WHERE id = ?', [h.order_id]);
        await tx.insert('INSERT INTO payments (order_id, order_no, type, amount, method, channel, note) VALUES (?,?,?,?,?,?,?)',
          [h.order_id, o.order_no || '', 'extra', Number(h.extra_fee), 'offline', (b.channel || 'cash'), `选片加选缴费（提交版本 V${h.version}）`]);
        const newBalance = Math.max(0, Number(o.balance) - Number(h.extra_fee));
        await tx.run('UPDATE orders SET balance = ? WHERE id = ?', [newBalance, h.order_id]);
      }
    });
    res.json({ ok: true, pay_status: PAY_STATUS.PAID });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 预留：线上支付回调（成功更新 pay_status + 流水 + 订单尾款；失败维持待支付不改任务主状态）
router.post('/orders/:orderId/history/:historyId/pay-callback', async (req, res) => {
  try {
    const h = await get('SELECT * FROM order_select_submit_history WHERE id = ? AND order_id = ?', [req.params.historyId, req.params.orderId]);
    if (!h) return res.status(404).json({ error: '提交记录不存在' });
    const b = req.body || {};
    const success = String(b.status) === 'success' || String(b.result_code) === 'SUCCESS';
    if (!success) return res.json({ ok: true, pay_status: PAY_STATUS.UNPAID, message: '支付未成功，维持待支付' });
    const flowNo = String(b.transaction_id || b.pay_flow_no || '').trim();
    await withTransaction(async (tx) => {
      await tx.run('UPDATE order_select_submit_history SET pay_status = ?, pay_flow_no = ?, paid_at = ? WHERE id = ?', [PAY_STATUS.PAID, flowNo, nowISO(), h.id]);
      if (Number(h.extra_fee) > 0) {
        const o = await tx.get('SELECT balance, order_no FROM orders WHERE id = ?', [h.order_id]);
        await tx.insert('INSERT INTO payments (order_id, order_no, type, amount, method, channel, note) VALUES (?,?,?,?,?,?,?)',
          [h.order_id, o.order_no || '', 'extra', Number(h.extra_fee), 'online', 'online', `选片加选线上缴费（提交版本 V${h.version}）`]);
        await tx.run('UPDATE orders SET balance = ? WHERE id = ?', [Math.max(0, Number(o.balance) - Number(h.extra_fee)), h.order_id]);
      }
    });
    res.json({ ok: true, pay_status: PAY_STATUS.PAID });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 导出交付清单（数据源 = submit_history 提交快照，非草稿 mark；自动过滤淘汰；TXT / Excel 两种）
router.get('/orders/:orderId/export', authRequired, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.orderId]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    const fmt = (req.query.format || 'txt').toString().toLowerCase();
    // 取最新一条提交快照（交付以正式提交为准，不取草稿 mark）
    const h = await get('SELECT * FROM order_select_submit_history WHERE order_id = ? ORDER BY version DESC LIMIT 1', [o.id]);
    if (!h) return res.status(404).json({ error: '尚无提交记录，无法导出' });
    let snapshot = [];
    try { snapshot = JSON.parse(h.snapshot || '[]'); } catch {}
    const rows = snapshotRows(snapshot); // 已自动过滤淘汰
    const orderNo = o.order_no || o.id;
    const submittedAt = (h.submitted_at || '').slice(0, 19).replace('T', ' ');
    if (fmt === 'excel' || fmt === 'xls') {
      const xml = [
        '<?xml version="1.0"?>',
        '<?mso-application progid="Excel.Sheet"?>',
        '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
        '<Worksheet ss:Name="选片清单"><Table>',
        '<Row>' + ['照片ID', '标记类型', '客户修图备注'].map((c) => `<Cell><Data ss:Type="String">${xmlEscape(c)}</Data></Cell>`).join('') + '</Row>'
      ];
      for (const r of rows) {
        xml.push('<Row>' + [r.photo_key || r.photo_id || '', '保留', r.remark || ''].map((c) => `<Cell><Data ss:Type="String">${xmlEscape(String(c))}</Data></Cell>`).join('') + '</Row>');
      }
      xml.push('</Table></Worksheet></Workbook>');
      res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="selection_${orderNo}_${submittedAt.replace(/[: ]/g, '')}.xls"`);
      return res.send('\ufeff' + xml.join(''));
    }
    const lines = [];
    lines.push('========================================');
    lines.push('选片交付清单');
    lines.push('订单编号：' + orderNo);
    lines.push('客户姓名：' + (o.customer_name || ''));
    lines.push('提交版本：V' + h.version);
    lines.push('提交时间：' + submittedAt);
    lines.push('========================================');
    lines.push(`保留精修：${Number(h.retouch_count) || 0} 张　加选：${Number(h.extra_count) || 0} 张　加选金额：¥${Number(h.extra_fee).toFixed(2)}`);
    lines.push('');
    lines.push('---- 明细（已过滤淘汰）----');
    rows.forEach((r, i) => {
      lines.push(`第${i + 1}张　[保留]　${r.photo_key || r.photo_id || ''}　${r.remark ? '备注：' + r.remark : ''}`);
    });
    const txt = '\ufeff' + lines.join('\r\n');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="selection_${orderNo}_${submittedAt.replace(/[: ]/g, '')}.txt"`);
    res.send(txt);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== 工具 =====
// 确定性洗牌（同 seed 结果稳定，用于「底片随机打乱」且 C 端多设备一致）
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
