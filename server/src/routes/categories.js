// routes/categories.js —— 作品分类（多分类 / 软删 / 预设保护）
import { Router } from 'express';
import { query, get, insert, run } from '../db.js';
import { authRequired, requireRole } from '../auth.js';

const router = Router();

// 公开列表：仅返回「启用且未删除」的分类（Web/小程序两端共用，禁用与已删均不展示）
router.get('/', async (req, res) => {
  try {
    const rows = await query(
      `SELECT id, name, kind, sort, preset FROM categories WHERE deleted=0 AND is_active=1 ORDER BY sort, id`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 管理列表：登录商户可见「全部未删除」分类（含被禁用的，便于重新启用），预设分类带 preset 标记
router.get('/manage', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const rows = await query(
      `SELECT id, name, kind, sort, is_active, preset FROM categories WHERE deleted=0 ORDER BY sort, id`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 新增自定义分类：默认启用、非预设
router.post('/', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: '分类名称不能为空' });
    const kind = req.body.kind || 'work';
    const sort = Number(req.body.sort) || 0;
    const id = await insert(
      `INSERT INTO categories (name, kind, sort, is_active, deleted, preset) VALUES (?,?,?,1,0,0)`,
      [name, kind, sort]
    );
    res.json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 编辑分类：可改名 / 调整排序 / 启停；预设分类允许改名与禁用，但不在此处被删除
router.put('/:id', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const fields = [];
    const params = [];
    if (req.body.name !== undefined) { fields.push('name=?'); params.push((req.body.name || '').trim()); }
    if (req.body.sort !== undefined) { fields.push('sort=?'); params.push(Number(req.body.sort) || 0); }
    if (req.body.is_active !== undefined) { fields.push('is_active=?'); params.push(req.body.is_active ? 1 : 0); }
    if (fields.length === 0) return res.json({ ok: true });
    params.push(id);
    await run(`UPDATE categories SET ${fields.join(', ')} WHERE id=?`, params);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 删除分类：预设分类禁止删除；自定义分类软删（deleted=1），已绑定作品不删除，可重新分配
router.delete('/:id', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const cat = await get('SELECT id, preset FROM categories WHERE id=? AND deleted=0', [id]);
    if (!cat) return res.status(404).json({ error: '分类不存在' });
    if (cat.preset === 1) return res.status(400).json({ error: '预设分类不可删除，可禁用代替删除' });
    await run('UPDATE categories SET deleted=1 WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
