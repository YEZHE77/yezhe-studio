// routes/admin.js —— 商户后台：C 端客户数据管理（预约转订单 / 选片结果查看修改 / 评价审核）
// 全部需要商户登录（authRequired）；与 /api/customer 的行级隔离互补：此处为管理视角，可看全部。
import { Router } from 'express';
import { query, get, insert, run } from '../db.js';
import { authRequired } from '../auth.js';

const router = Router();
router.use(authRequired);

function nowISO() { return new Date().toISOString(); }

// ===== 1. 预约管理 =====
// 列表（含套系名，状态 pending/converted）
router.get('/appointments', async (req, res) => {
  try {
    const rows = await query(
      `SELECT a.*, p.name AS package_name
       FROM appointments a
       LEFT JOIN packages p ON p.id = a.package_id
       ORDER BY a.id DESC`,
      []
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 转订单：创建订单并绑定客户 openid，预约标记 converted
router.post('/appointments/:id/convert', async (req, res) => {
  try {
    const a = await get('SELECT * FROM appointments WHERE id = ?', [req.params.id]);
    if (!a) return res.status(404).json({ error: '预约不存在' });
    if (a.status === 'converted') return res.status(400).json({ error: '该预约已转订单' });
    let package_snapshot = null, total = 0;
    if (a.package_id) {
      const p = await get('SELECT * FROM packages WHERE id = ?', [a.package_id]);
      if (p) {
        package_snapshot = { id: p.id, name: p.name, price: p.price };
        total = parseFloat(p.price) || 0;
      }
    }
    const order_no = 'NO' + Date.now();
    const logs = JSON.stringify([{ t: nowISO(), text: '由预约 #' + a.id + ' 转单' }]);
    const orderId = await insert(
      `INSERT INTO orders (order_no, customer_name, customer_phone, package_id, package_snapshot,
        status, deposit, balance, total_amount, paid_amount, openid, remark, logs)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        order_no, a.name, a.phone, a.package_id || null, JSON.stringify(package_snapshot),
        'unpaid', 0, total, total, 0, a.openid || null, a.remark || '', logs
      ]
    );
    await run("UPDATE appointments SET status = 'converted' WHERE id = ?", [a.id]);
    res.json({ ok: true, orderId, order_no });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== 2. 选片结果（管理端查看 / 修改）=====
async function linkedSamplePhotos(orderId) {
  const works = await query('SELECT id, title FROM works WHERE order_id = ? ORDER BY id DESC', [orderId]);
  const photos = [];
  for (const w of works) {
    const albums = await query("SELECT id, zone, photo_url, sort FROM albums WHERE work_id = ? AND zone = 'sample' ORDER BY sort", [w.id]);
    for (const a of albums) photos.push({ ...a, workTitle: w.title });
  }
  return photos;
}

// 查看客户提交的选片（含可勾选的 sample 小样）
router.get('/photo-select/:orderId', async (req, res) => {
  try {
    const o = await get('SELECT id FROM orders WHERE id = ?', [req.params.orderId]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    const sel = await get('SELECT * FROM photo_select WHERE order_id = ? ORDER BY id DESC LIMIT 1', [req.params.orderId]);
    const photos = await linkedSamplePhotos(req.params.orderId);
    res.json({
      selection: sel
        ? { marks: sel.marks ? JSON.parse(sel.marks) : [], submitted: !!sel.submitted, draft: sel.draft ? JSON.parse(sel.draft) : [] }
        : null,
      photos
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 修改选片结果（保留原 openid，submitted 置 1）
router.post('/photo-select/:orderId', async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const o = await get('SELECT id FROM orders WHERE id = ?', [orderId]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    const marks = Array.isArray(req.body.marks) ? req.body.marks : [];
    const existing = await get('SELECT * FROM photo_select WHERE order_id = ? ORDER BY id DESC LIMIT 1', [orderId]);
    if (!existing) return res.status(400).json({ error: '该订单暂无客户选片，无法由后台修改' });
    await run('UPDATE photo_select SET marks = ?, submitted = 1, updated_at = ? WHERE id = ?',
      [JSON.stringify(marks), nowISO(), existing.id]);
    res.json({ ok: true, count: marks.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== 3. 评价审核 =====
// 列表（按状态筛选；含订单客户名/单号）
router.get('/evaluates', async (req, res) => {
  try {
    const { status } = req.query;
    const where = [];
    const params = [];
    if (status) { where.push('e.status = ?'); params.push(status); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = await query(
      `SELECT e.*, o.customer_name, o.order_no
       FROM evaluates e
       LEFT JOIN orders o ON o.id = e.order_id ${w}
       ORDER BY e.id DESC`,
      params
    );
    res.json(rows.map((r) => ({ ...r, images: r.images ? JSON.parse(r.images) : [] })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 审核：approve → approved（进好评墙）/ reject → rejected
router.post('/evaluates/:id/review', async (req, res) => {
  try {
    const e0 = await get('SELECT * FROM evaluates WHERE id = ?', [req.params.id]);
    if (!e0) return res.status(404).json({ error: '评价不存在' });
    const action = req.body.action;
    if (action !== 'approve' && action !== 'reject') return res.status(400).json({ error: '无效操作' });
    const status = action === 'approve' ? 'approved' : 'rejected';
    await run('UPDATE evaluates SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ ok: true, status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
