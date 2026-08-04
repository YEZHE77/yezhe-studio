// routes/categories.js —— 作品分类
import { Router } from 'express';
import { query, get, insert, run } from '../db.js';
import { authRequired, requireRole } from '../auth.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM categories ORDER BY sort, id');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const id = await insert('INSERT INTO categories (name, kind, sort) VALUES (?,?,?)',
      [req.body.name, req.body.kind || 'work', req.body.sort || 0]);
    res.json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', authRequired, requireRole('admin'), async (req, res) => {
  try {
    await run('UPDATE categories SET name=?, sort=? WHERE id=?', [req.body.name, req.body.sort || 0, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', authRequired, requireRole('admin'), async (req, res) => {
  try {
    await run('DELETE FROM categories WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
