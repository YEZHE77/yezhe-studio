// routes/selection.js —— 在线选片工具（对标拾光盒子 Lite）
// C 端公开接口（token 即凭证，无需登录）+ B 端管理接口（需登录）
// 数据模型：
//   selection_tasks  —— 选片任务（订单绑定 + 业务配置 + 图片 URL JSON）
//   selection_marks  —— 逐张三态标记（like 喜欢 / exclude 排除 / pending 待定）
//   shares(type='selection', ref_id=task.id) —— 复用统一分享内核（token / 密码 / 有效期 / 启停）
// 约束：图片只存 R2 URL，网页不存二进制；不加价不做微信推送；H5 匿名访问拿不到微信身份。
import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { query, get, insert, run } from '../db.js';
import { authRequired, requireRole } from '../auth.js';
import { buildShareUrl } from '../shareUtil.js';

const router = Router();
const STAFF_ROLES = ['admin', 'photographer', 'finance'];
const MARK_STATUS = ['like', 'exclude', 'pending'];

function nowISO() { return new Date().toISOString(); }

function parsePhotos(raw) {
  try { const p = JSON.parse(raw || '[]'); return Array.isArray(p) ? p : []; } catch { return []; }
}

// 读取任务全部标记 → { photoKey: status }
async function loadMarks(taskId) {
  const rows = await query('SELECT photo_key, status FROM selection_marks WHERE task_id = ?', [taskId]);
  const m = {};
  for (const r of rows) m[r.photo_key] = r.status;
  return m;
}

// 三态统计（按 photos 遍历，未标记记 pending）
function markStats(marks, photos) {
  let like = 0, exclude = 0, pending = 0;
  for (const p of photos) {
    const s = marks[p.key] || 'pending';
    if (s === 'like') like++;
    else if (s === 'exclude') exclude++;
    else pending++;
  }
  return { like, exclude, pending, total: photos.length };
}

// 加片计费：超出保底 × 单价（简单线性）
function calcExtraFee(likeCount, minRetouch, extraPrice) {
  const n = Math.max(0, likeCount - minRetouch);
  return { extraCount: n, extraFee: Math.round(n * (parseFloat(extraPrice) || 0) * 100) / 100 };
}

// token → { share, task }（仅 type=selection）
async function resolveByToken(token) {
  const share = await get('SELECT * FROM shares WHERE token = ?', [token]);
  if (!share || share.type !== 'selection') return null;
  const task = await get('SELECT * FROM selection_tasks WHERE id = ?', [share.ref_id]);
  if (!task) return null;
  return { share, task };
}

function isExpired(expireAt) {
  if (!expireAt) return false;
  const t = new Date(expireAt).getTime();
  return !Number.isNaN(t) && t < Date.now();
}

// C 端返回的选片数据（绝不返回密码）
function clientData(task, marks, photos, share) {
  const stats = markStats(marks, photos);
  const extra = calcExtraFee(stats.like, task.min_retouch, task.extra_price);
  return {
    task: {
      min_retouch: Number(task.min_retouch) || 0,
      extra_price: Number(task.extra_price) || 0,
      watermark_enabled: !!Number(task.watermark_enabled),
      submitted: !!Number(task.submitted),
      expire_at: share.expire_at || null
    },
    photos,
    marks,
    stats,
    extra
  };
}

// 订单日志追加（与 orders.js appendLog 同语义）
async function appendLog(orderId, text) {
  const cur = await get('SELECT logs FROM orders WHERE id = ?', [orderId]);
  if (!cur) return;
  let logs = [];
  if (cur.logs) { try { logs = JSON.parse(cur.logs); } catch { logs = []; } }
  logs.push({ t: nowISO(), text });
  await run('UPDATE orders SET logs = ? WHERE id = ?', [JSON.stringify(logs), orderId]);
}

// ===================== C 端公开接口（token 即凭证） =====================

// 获取选片任务（含密码锁判断）
router.get('/c/:token', async (req, res) => {
  try {
    const r = await resolveByToken(req.params.token);
    if (!r) return res.status(404).json({ error: '选片链接无效或已失效' });
    const { share, task } = r;
    if (share.disabled) return res.status(403).json({ error: '该选片链接已被关闭' });
    if (isExpired(share.expire_at)) return res.status(403).json({ error: '该选片链接已过期' });
    const meta = { token: share.token, type: share.type, ref_id: share.ref_id, title: share.title || '选片', expire_at: share.expire_at || null };
    if (share.password_hash) return res.json({ ok: true, locked: true, meta, data: null });
    const photos = parsePhotos(task.photos);
    const marks = await loadMarks(task.id);
    res.json({ ok: true, locked: false, meta, data: clientData(task, marks, photos, share) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 密码校验
router.post('/c/:token/verify', async (req, res) => {
  try {
    const r = await resolveByToken(req.params.token);
    if (!r) return res.status(404).json({ error: '选片链接无效或已失效' });
    const { share, task } = r;
    if (share.disabled) return res.status(403).json({ error: '该选片链接已被关闭' });
    if (isExpired(share.expire_at)) return res.status(403).json({ error: '该选片链接已过期' });
    if (share.password_hash) {
      const ok = await bcrypt.compare(String((req.body && req.body.password) || ''), share.password_hash);
      if (!ok) return res.status(401).json({ error: '密码错误' });
    }
    const meta = { token: share.token, type: share.type, ref_id: share.ref_id, title: share.title || '选片', expire_at: share.expire_at || null };
    const photos = parsePhotos(task.photos);
    const marks = await loadMarks(task.id);
    res.json({ ok: true, locked: false, meta, data: clientData(task, marks, photos, share) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 单张标记回写（实时）
router.post('/c/:token/mark', async (req, res) => {
  try {
    const r = await resolveByToken(req.params.token);
    if (!r) return res.status(404).json({ error: '选片链接无效' });
    const { share, task } = r;
    if (share.disabled || isExpired(share.expire_at)) return res.status(403).json({ error: '选片链接已关闭或过期' });
    if (Number(task.submitted)) return res.status(400).json({ error: '选片已提交，无法修改' });
    const photoKey = String((req.body && req.body.photoKey) || '');
    const status = String((req.body && req.body.status) || '');
    if (!MARK_STATUS.includes(status)) return res.status(400).json({ error: '非法标记状态' });
    const existing = await get('SELECT id FROM selection_marks WHERE task_id = ? AND photo_key = ?', [task.id, photoKey]);
    if (existing) {
      await run('UPDATE selection_marks SET status = ?, updated_at = ? WHERE id = ?', [status, nowISO(), existing.id]);
    } else {
      await insert('INSERT INTO selection_marks (task_id, photo_key, status, updated_at) VALUES (?,?,?,?)', [task.id, photoKey, status, nowISO()]);
    }
    const photos = parsePhotos(task.photos);
    const marks = await loadMarks(task.id);
    const stats = markStats(marks, photos);
    res.json({ ok: true, stats, extra: calcExtraFee(stats.like, task.min_retouch, task.extra_price) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 提交选片（更新任务提交态 + 订单日志标记「客户已完成选片」）
router.post('/c/:token/submit', async (req, res) => {
  try {
    const r = await resolveByToken(req.params.token);
    if (!r) return res.status(404).json({ error: '选片链接无效' });
    const { share, task } = r;
    if (share.disabled || isExpired(share.expire_at)) return res.status(403).json({ error: '选片链接已关闭或过期' });
    const photos = parsePhotos(task.photos);
    const marks = await loadMarks(task.id);
    const stats = markStats(marks, photos);
    await run('UPDATE selection_tasks SET submitted = 1, submitted_at = ? WHERE id = ?', [nowISO(), task.id]);
    await appendLog(task.order_id, '客户已完成选片');
    res.json({ ok: true, stats, extra: calcExtraFee(stats.like, task.min_retouch, task.extra_price) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 实时轮询（多人同 token 状态同步：前端按此全量拉取最新标记）
router.get('/c/:token/state', async (req, res) => {
  try {
    const r = await resolveByToken(req.params.token);
    if (!r) return res.status(404).json({ error: '选片链接无效' });
    const { task } = r;
    const photos = parsePhotos(task.photos);
    const marks = await loadMarks(task.id);
    const stats = markStats(marks, photos);
    res.json({ ok: true, marks, stats, extra: calcExtraFee(stats.like, task.min_retouch, task.extra_price), submitted: !!Number(task.submitted) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===================== B 端管理接口（需登录） =====================

// 获取订单的选片任务（含分享链接信息）
router.get('/tasks/:orderId', authRequired, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const o = await get('SELECT id, customer_name, order_no FROM orders WHERE id = ?', [req.params.orderId]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    const task = await get('SELECT * FROM selection_tasks WHERE order_id = ? ORDER BY id DESC LIMIT 1', [o.id]);
    if (!task) return res.json({ ok: true, task: null, share: null });
    const share = await get('SELECT token, title, password_hash, expire_at, disabled FROM shares WHERE type = ? AND ref_id = ?', ['selection', task.id]);
    const photos = parsePhotos(task.photos);
    const marks = await loadMarks(task.id);
    const stats = markStats(marks, photos);
    const extra = calcExtraFee(stats.like, task.min_retouch, task.extra_price);
    res.json({
      ok: true,
      task: {
        id: task.id, order_id: task.order_id,
        min_retouch: Number(task.min_retouch) || 0, extra_price: Number(task.extra_price) || 0,
        watermark_enabled: !!Number(task.watermark_enabled), photos,
        submitted: !!Number(task.submitted), submitted_at: task.submitted_at
      },
      share: share ? {
        token: share.token,
        share_url: buildShareUrl(share.token, req),
        has_password: !!share.password_hash,
        expire_at: share.expire_at || null,
        disabled: !!Number(share.disabled),
        title: share.title || ''
      } : null,
      marks, stats, extra
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 创建 / 更新选片任务（含 token 生成、密码、有效期、图片 URL）
router.post('/tasks/:orderId', authRequired, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const o = await get('SELECT id, customer_name, order_no FROM orders WHERE id = ?', [req.params.orderId]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    const b = req.body || {};
    const minRetouch = Math.max(0, parseInt(b.min_retouch, 10) || 0);
    const extraPrice = Math.max(0, parseFloat(b.extra_price) || 0);
    const watermark = b.watermark_enabled ? 1 : 0;
    // photos：前端传入 [{key,url}]，缺失 key 时按数组下标补 p_N，保留原始顺序
    const rawPhotos = Array.isArray(b.photos) ? b.photos : [];
    const photos = rawPhotos.map((p, i) => ({
      key: (p && p.key) || ('p_' + i),
      url: (p && p.url) || ''
    })).filter((p) => p.url);

    let task = await get('SELECT * FROM selection_tasks WHERE order_id = ? ORDER BY id DESC LIMIT 1', [o.id]);
    if (task) {
      await run('UPDATE selection_tasks SET min_retouch = ?, extra_price = ?, watermark_enabled = ?, photos = ?, updated_at = ? WHERE id = ?',
        [minRetouch, extraPrice, watermark, JSON.stringify(photos), nowISO(), task.id]);
    } else {
      const id = await insert(
        'INSERT INTO selection_tasks (order_id, min_retouch, extra_price, watermark_enabled, photos, submitted, created_at, updated_at) VALUES (?,?,?,?,?,0,?,?)',
        [o.id, minRetouch, extraPrice, watermark, JSON.stringify(photos), nowISO(), nowISO()]
      );
      task = await get('SELECT * FROM selection_tasks WHERE id = ?', [id]);
    }

    // 复用 shares 表：生成/更新 token 记录
    let share = await get('SELECT * FROM shares WHERE type = ? AND ref_id = ?', ['selection', task.id]);
    const title = `${o.customer_name || '客户'} 的选片`;
    // 密码处理：b.password === undefined 不改；空串清除；非空设置
    let passwordHash = share ? share.password_hash : null;
    if (b.password !== undefined) {
      passwordHash = b.password ? await bcrypt.hash(String(b.password), 10) : null;
    }
    const expireAt = b.expire_at !== undefined ? (b.expire_at || null) : (share ? share.expire_at : null);
    if (share) {
      await run('UPDATE shares SET title = ?, password_hash = ?, expire_at = ?, disabled = ? WHERE token = ?',
        [title, passwordHash, expireAt, b.disabled ? 1 : Number(share.disabled), share.token]);
    } else {
      const token = crypto.randomBytes(16).toString('hex');
      await insert(
        'INSERT INTO shares (token, type, ref_id, title, password_hash, expire_at, disabled, created_by) VALUES (?,?,?,?,?,?,?,?)',
        [token, 'selection', task.id, title, passwordHash, expireAt, b.disabled ? 1 : 0, (req.user && req.user.uid) || '']
      );
      share = await get('SELECT * FROM shares WHERE token = ?', [token]);
    }

    res.json({
      ok: true,
      task: { id: task.id, order_id: task.order_id, min_retouch: minRetouch, extra_price: extraPrice, watermark_enabled: watermark, photos },
      share: {
        token: share.token,
        share_url: buildShareUrl(share.token, req),
        has_password: !!passwordHash,
        expire_at: expireAt,
        disabled: !!Number(share.disabled),
        title
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 启用 / 禁用 token 访客链接
router.post('/tasks/:orderId/toggle', authRequired, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const task = await get('SELECT * FROM selection_tasks WHERE order_id = ? ORDER BY id DESC LIMIT 1', [req.params.orderId]);
    if (!task) return res.status(404).json({ error: '选片任务不存在' });
    const share = await get('SELECT * FROM shares WHERE type = ? AND ref_id = ?', ['selection', task.id]);
    if (!share) return res.status(404).json({ error: '访客链接不存在' });
    const next = Number(share.disabled) ? 0 : 1;
    await run('UPDATE shares SET disabled = ? WHERE token = ?', [next, share.token]);
    res.json({ ok: true, disabled: !!next });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 实时统计（B 端查看客户标记进度）
router.get('/tasks/:orderId/stats', authRequired, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const task = await get('SELECT * FROM selection_tasks WHERE order_id = ? ORDER BY id DESC LIMIT 1', [req.params.orderId]);
    if (!task) return res.json({ ok: true, marks: {}, stats: { like: 0, exclude: 0, pending: 0, total: 0 }, extra: { extraCount: 0, extraFee: 0 } });
    const photos = parsePhotos(task.photos);
    const marks = await loadMarks(task.id);
    const stats = markStats(marks, photos);
    res.json({ ok: true, marks, stats, extra: calcExtraFee(stats.like, task.min_retouch, task.extra_price), submitted: !!Number(task.submitted) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 导出选片结果清单（txt，供本地后期分片）
router.get('/tasks/:orderId/export', authRequired, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const o = await get('SELECT id, customer_name, order_no FROM orders WHERE id = ?', [req.params.orderId]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    const task = await get('SELECT * FROM selection_tasks WHERE order_id = ? ORDER BY id DESC LIMIT 1', [o.id]);
    if (!task) return res.status(404).json({ error: '选片任务不存在' });
    const photos = parsePhotos(task.photos);
    const marks = await loadMarks(task.id);
    const stats = markStats(marks, photos);
    const extra = calcExtraFee(stats.like, task.min_retouch, task.extra_price);
    const STATUS_TXT = { like: '喜欢', exclude: '排除', pending: '待定' };
    const lines = [];
    lines.push('========================================');
    lines.push('选片结果清单');
    lines.push('订单编号：' + (o.order_no || ''));
    lines.push('客户姓名：' + (o.customer_name || ''));
    lines.push('导出时间：' + nowISO().slice(0, 19).replace('T', ' '));
    lines.push('========================================');
    lines.push(`图片总数：${stats.total}`);
    lines.push(`喜欢：${stats.like} 张　排除：${stats.exclude} 张　待定：${stats.pending} 张`);
    lines.push(`保底精修：${Number(task.min_retouch) || 0} 张　加片单价：¥${Number(task.extra_price) || 0}`);
    lines.push(`超出保底：${extra.extraCount} 张　预估加片：¥${extra.extraFee.toFixed(2)}`);
    lines.push('');
    lines.push('---- 明细 ----');
    photos.forEach((p, i) => {
      const st = STATUS_TXT[marks[p.key] || 'pending'] || '待定';
      lines.push(`[${st}] 第${i + 1}张 ${p.url}`);
    });
    const txt = '\ufeff' + lines.join('\r\n');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="selection_${o.order_no || o.id}.txt"`);
    res.send(txt);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
