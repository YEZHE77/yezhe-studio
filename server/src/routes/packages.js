// routes/packages.js —— 套系管理（CRUD / 增值定价 / 营销绑定 / 上下架 / 订单溯源）
import { Router } from 'express';
import { query, get, insert, run } from '../db.js';
import { authRequired, requireRole } from '../auth.js';
import { parseRow } from '../schema.js';

const router = Router();
const JSON_COLS = ['addons', 'marketing'];

// 列表（状态筛选 + 搜索）
router.get('/', authRequired, async (req, res) => {
  try {
    const { status, q } = req.query;
    const where = [];
    const params = [];
    if (status && status !== 'all') { where.push('status = ?'); params.push(status); }
    if (q) { where.push('(name LIKE ? OR description LIKE ?)'); params.push('%' + q + '%', '%' + q + '%'); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = await query('SELECT * FROM packages ' + w + ' ORDER BY sort ASC, id DESC', params);
    res.json(rows.map((r) => parseRow(r, JSON_COLS)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== 公开接口（C 端小程序，无需登录）=====
// 公开套系列表（仅 status='on'）
router.get('/public', async (req, res) => {
  try {
    const { q } = req.query;
    const where = ["status = 'on'"];
    const params = [];
    if (q) { where.push('(name LIKE ? OR description LIKE ?)'); params.push('%' + q + '%', '%' + q + '%'); }
    const w = 'WHERE ' + where.join(' AND ');
    const rows = await query('SELECT * FROM packages ' + w + ' ORDER BY sort ASC, id DESC', params);
    res.json(rows.map((r) => parseRow(r, JSON_COLS)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 公开套系详情
router.get('/public/:id', async (req, res) => {
  try {
    const r = await get("SELECT * FROM packages WHERE id = ? AND status = 'on'", [req.params.id]);
    if (!r) return res.status(404).json({ error: '套系不存在或未上架' });
    res.json(parseRow(r, JSON_COLS));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 详情
router.get('/:id', authRequired, async (req, res) => {
  try {
    const r = await get('SELECT * FROM packages WHERE id = ?', [req.params.id]);
    if (!r) return res.status(404).json({ error: '套系不存在' });
    res.json(parseRow(r, JSON_COLS));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 订单溯源：引用该套系的订单
router.get('/:id/orders', authRequired, async (req, res) => {
  try {
    const rows = await query(
      `SELECT id, order_no, customer_name, status, total_amount, paid_amount, shoot_date, created_at
       FROM orders WHERE package_id = ? ORDER BY id DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 创建
router.post('/', authRequired, requireRole(['admin', 'photographer']), async (req, res) => {
  try {
    const b = req.body;
    const id = await insert(
      `INSERT INTO packages (name, price, category_id, cover_url, description, addons, marketing, status, sort)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        b.name || '未命名套系', parseFloat(b.price) || 0, b.category_id || null,
        b.cover_url || '', b.description || '',
        JSON.stringify(b.addons || []), JSON.stringify(b.marketing || {}),
        b.status || 'on', parseInt(b.sort) || 0
      ]
    );
    res.json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 更新
router.put('/:id', authRequired, requireRole(['admin', 'photographer']), async (req, res) => {
  try {
    const b = req.body;
    const cur = await get('SELECT * FROM packages WHERE id = ?', [req.params.id]);
    if (!cur) return res.status(404).json({ error: '套系不存在' });
    await run(
      `UPDATE packages SET name=?, price=?, category_id=?, cover_url=?, description=?, addons=?, marketing=?, status=?, sort=?
       WHERE id=?`,
      [
        b.name ?? cur.name, parseFloat(b.price) ?? cur.price, b.category_id ?? cur.category_id,
        b.cover_url ?? cur.cover_url, b.description ?? cur.description,
        JSON.stringify(b.addons ?? (cur.addons ? JSON.parse(cur.addons) : [])),
        JSON.stringify(b.marketing ?? (cur.marketing ? JSON.parse(cur.marketing) : {})),
        b.status ?? cur.status, parseInt(b.sort) ?? cur.sort,
        req.params.id
      ]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 删除（仅 admin）
router.delete('/:id', authRequired, requireRole(['admin']), async (req, res) => {
  try {
    await run('DELETE FROM packages WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
