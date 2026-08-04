// routes/customer.js —— C 端小程序客户接口（行级隔离：只能访问自己 openid 绑定的数据）
// 所有写/私有读均经 customerRequired 解析可信 openid（来自客户 JWT，不可伪造）。
import { Router } from 'express';
import { query, get, insert, run } from '../db.js';
import { parseRow } from '../schema.js';
import { customerRequired } from '../auth.js';

const router = Router();
const JSON_COLS = ['package_snapshot', 'addons_snapshot', 'logs'];

function nowISO() { return new Date().toISOString(); }

// 取订单并校验归属：openid 不匹配或无绑定 → 403
async function ownOrderOrFail(orderId, openid) {
  const o = await get('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!o) return { status: 404, msg: '订单不存在' };
  if (o.openid && o.openid !== openid) return { status: 403, msg: '无权访问该订单' };
  return { order: o };
}

// 取订单关联的作品（works.order_id = order.id）
async function linkedWorks(orderId) {
  const rows = await query('SELECT id, title, cover_url, allow_download, is_public FROM works WHERE order_id = ? ORDER BY id DESC', [orderId]);
  return rows.map((r) => ({ ...r, allow_download: r.allow_download ? 1 : 0 }));
}

// ===== 1. 预约提交 =====
router.post('/appointment/submit', customerRequired, async (req, res) => {
  try {
    const openid = req.customer.openid;
    const b = req.body || {};
    const name = (b.name || '').trim();
    const phone = (b.phone || '').trim();
    if (!name || !phone) return res.status(400).json({ error: '请填写称呼与联系电话' });
    let pkgName = '';
    if (b.packageId) {
      const p = await get('SELECT name FROM packages WHERE id = ?', [b.packageId]);
      pkgName = p ? p.name : '';
    }
    const id = await insert(
      `INSERT INTO appointments (openid, name, phone, package_id, hope_date, remark, status, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [openid, name, phone, b.packageId || null, b.hopeDate || '', b.remark || '', 'pending', nowISO()]
    );
    res.json({ ok: true, appointmentId: id, packageName: pkgName });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 2. 我的预约列表 =====
router.get('/appointment/list', customerRequired, async (req, res) => {
  try {
    const rows = await query(
      `SELECT a.*, p.name AS package_name FROM appointments a
       LEFT JOIN packages p ON p.id = a.package_id
       WHERE a.openid = ? ORDER BY a.id DESC`,
      [req.customer.openid]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 3. 我的订单列表 =====
router.get('/order/list', customerRequired, async (req, res) => {
  try {
    const rows = await query(
      `SELECT * FROM orders WHERE openid = ? AND cancelled = 0 ORDER BY id DESC`,
      [req.customer.openid]
    );
    const out = [];
    for (const o of rows) {
      const order = parseRow(o, JSON_COLS);
      let pkgName = '';
      if (o.package_id) { const p = await get('SELECT name FROM packages WHERE id = ?', [o.package_id]); pkgName = p ? p.name : ''; }
      const works = await linkedWorks(o.id);
      out.push({ ...order, packageName: pkgName, works, hasAlbum: works.length > 0 });
    }
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 4. 订单详情（含收款流水 + 关联作品 + 选片/评价状态）=====
router.get('/order/:orderId', customerRequired, async (req, res) => {
  try {
    const r = await ownOrderOrFail(req.params.orderId, req.customer.openid);
    if (r.status) return res.status(r.status).json({ error: r.msg });
    const o = r.order;
    const order = parseRow(o, JSON_COLS);
    const payments = await query('SELECT * FROM payments WHERE order_id = ? ORDER BY created_at ASC', [o.id]);
    let pkgName = '';
    if (o.package_id) { const p = await get('SELECT name FROM packages WHERE id = ?', [o.package_id]); pkgName = p ? p.name : ''; }
    const works = await linkedWorks(o.id);
    const sel = await get('SELECT submitted FROM photo_select WHERE order_id = ? AND openid = ? ORDER BY id DESC LIMIT 1', [o.id, req.customer.openid]);
    const ev = await get('SELECT id, status FROM evaluates WHERE order_id = ? AND openid = ? ORDER BY id DESC LIMIT 1', [o.id, req.customer.openid]);
    res.json({
      ...order, payments, packageName: pkgName, works,
      photoSelectSubmitted: !!(sel && sel.submitted),
      evaluated: !!ev, evaluateStatus: ev ? ev.status : null
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 5. 成片相册（只返 sample/final 小样，绝不返 local 原片；越权 403）=====
router.get('/album/:orderId', customerRequired, async (req, res) => {
  try {
    const r = await ownOrderOrFail(req.params.orderId, req.customer.openid);
    if (r.status) return res.status(r.status).json({ error: r.msg });
    const works = await linkedWorks(r.order.id);
    const photos = [];
    let allowDownload = 0;
    for (const w of works) {
      const albums = await query("SELECT id, zone, photo_url, sort FROM albums WHERE work_id = ? AND zone != 'local' ORDER BY zone, sort", [w.id]);
      allowDownload = Math.max(allowDownload, w.allow_download ? 1 : 0);
      for (const a of albums) photos.push({ ...a, workTitle: w.title });
    }
    res.json({ photos, allowDownload, works });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 6. 在线选片 =====
// 保存草稿（submitted=0）
router.post('/photo-select/save', customerRequired, async (req, res) => {
  try {
    const openid = req.customer.openid;
    const b = req.body || {};
    const r = await ownOrderOrFail(b.orderId, openid);
    if (r.status) return res.status(r.status).json({ error: r.msg });
    const marks = Array.isArray(b.marks) ? b.marks : [];
    const draft = JSON.stringify(b.draft !== undefined ? b.draft : marks);
    const existing = await get('SELECT id FROM photo_select WHERE order_id = ? AND openid = ? ORDER BY id DESC LIMIT 1', [b.orderId, openid]);
    if (existing) {
      await run('UPDATE photo_select SET draft = ?, marks = ?, submitted = 0, updated_at = ? WHERE id = ?',
        [draft, JSON.stringify(marks), nowISO(), existing.id]);
    } else {
      await insert('INSERT INTO photo_select (order_id, openid, marks, draft, submitted, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
        [b.orderId, openid, JSON.stringify(marks), draft, 0, nowISO(), nowISO()]);
    }
    res.json({ ok: true, count: marks.length, submitted: false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 提交选片（submitted=1，商户端可见）
router.post('/photo-select/submit', customerRequired, async (req, res) => {
  try {
    const openid = req.customer.openid;
    const b = req.body || {};
    const r = await ownOrderOrFail(b.orderId, openid);
    if (r.status) return res.status(r.status).json({ error: r.msg });
    const marks = Array.isArray(b.marks) ? b.marks : [];
    const existing = await get('SELECT id FROM photo_select WHERE order_id = ? AND openid = ? ORDER BY id DESC LIMIT 1', [b.orderId, openid]);
    if (existing) {
      await run('UPDATE photo_select SET marks = ?, draft = ?, submitted = 1, updated_at = ? WHERE id = ?',
        [JSON.stringify(marks), JSON.stringify(marks), nowISO(), existing.id]);
    } else {
      await insert('INSERT INTO photo_select (order_id, openid, marks, draft, submitted, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
        [b.orderId, openid, JSON.stringify(marks), JSON.stringify(marks), 1, nowISO(), nowISO()]);
    }
    res.json({ ok: true, count: marks.length, submitted: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 读取我的选片（含可选择的 sample 小样照片）
router.get('/photo-select/:orderId', customerRequired, async (req, res) => {
  try {
    const openid = req.customer.openid;
    const r = await ownOrderOrFail(req.params.orderId, openid);
    if (r.status) return res.status(r.status).json({ error: r.msg });
    const sel = await get('SELECT * FROM photo_select WHERE order_id = ? AND openid = ? ORDER BY id DESC LIMIT 1', [req.params.orderId, openid]);
    const works = await linkedWorks(r.order.id);
    const photos = [];
    for (const w of works) {
      const albums = await query("SELECT id, zone, photo_url, sort FROM albums WHERE work_id = ? AND zone = 'sample' ORDER BY sort", [w.id]);
      for (const a of albums) photos.push({ ...a, workTitle: w.title });
    }
    res.json({
      selection: sel ? { marks: sel.marks ? JSON.parse(sel.marks) : [], submitted: !!sel.submitted, draft: sel.draft ? JSON.parse(sel.draft) : [] } : null,
      photos
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 7. 评价 =====
router.post('/evaluate/submit', customerRequired, async (req, res) => {
  try {
    const openid = req.customer.openid;
    const b = req.body || {};
    const r = await ownOrderOrFail(b.orderId, openid);
    if (r.status) return res.status(r.status).json({ error: r.msg });
    const stars = Math.min(5, Math.max(1, parseInt(b.stars) || 5));
    const images = Array.isArray(b.images) ? b.images : [];
    const id = await insert(
      `INSERT INTO evaluates (order_id, openid, stars, text, images, status, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [b.orderId, openid, stars, (b.text || '').trim(), JSON.stringify(images), 'pending', nowISO()]
    );
    res.json({ ok: true, evaluateId: id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 我的评价列表
router.get('/evaluate/list', customerRequired, async (req, res) => {
  try {
    const { orderId } = req.query;
    let sql = 'SELECT * FROM evaluates WHERE openid = ?';
    const params = [req.customer.openid];
    if (orderId) { sql += ' AND order_id = ?'; params.push(orderId); }
    sql += ' ORDER BY id DESC';
    const rows = await query(sql, params);
    res.json(rows.map((r) => ({ ...r, images: r.images ? JSON.parse(r.images) : [] })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 公开好评墙（已审核通过，首页展示用，无需登录）
router.get('/evaluate/public', async (req, res) => {
  try {
    const rows = await query(
      `SELECT e.stars, e.text, e.images, e.created_at, o.customer_name
       FROM evaluates e LEFT JOIN orders o ON o.id = e.order_id
       WHERE e.status = 'approved' ORDER BY e.id DESC LIMIT 20`,
      []
    );
    res.json(rows.map((r) => ({ ...r, images: r.images ? JSON.parse(r.images) : [] })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
