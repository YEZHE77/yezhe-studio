// routes/channels.js —— 渠道来源（新增订单弹窗「渠道来源」下拉的数据源）
// 后端可配置：增 / 改 / 启停 / 软删；前端下拉实时读取，绝不写死。
import { Router } from 'express';
import { query, get, insert, run } from '../db.js';
import { authRequired, requireRole } from '../auth.js';
import { serverError } from '../httpError.js';

const router = Router();
const MANAGE_ROLES = ['admin', 'photographer', 'finance'];

// 下拉列表：仅返回「启用且未删除」的渠道
router.get('/', authRequired, async (req, res) => {
  try {
    const rows = await query(
      `SELECT id, name, sort FROM channels WHERE deleted=0 AND is_active=1 ORDER BY sort, id`
    );
    res.json(rows);
  } catch (e) { serverError(res, e); }
});

// 管理列表：含被禁用的渠道，便于重新启用
router.get('/manage', authRequired, requireRole(MANAGE_ROLES), async (req, res) => {
  try {
    const rows = await query(
      `SELECT id, name, sort, is_active FROM channels WHERE deleted=0 ORDER BY sort, id`
    );
    res.json(rows);
  } catch (e) { serverError(res, e); }
});

// 新增渠道
router.post('/', authRequired, requireRole(MANAGE_ROLES), async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: '渠道名称不能为空' });
    const dup = await get('SELECT id FROM channels WHERE name=? AND deleted=0', [name]);
    if (dup) return res.status(400).json({ error: '该渠道已存在' });
    let sort = Number(req.body.sort);
    if (!sort) {
      const max = await get('SELECT COALESCE(MAX(sort),0) AS m FROM channels WHERE deleted=0');
      sort = Number(max.m) + 1;
    }
    const id = await insert(
      'INSERT INTO channels (name, sort, is_active, deleted) VALUES (?,?,1,0)',
      [name, sort]
    );
    res.json({ id });
  } catch (e) { serverError(res, e); }
});

// 编辑渠道（改名 / 排序 / 启停）
router.put('/:id', authRequired, requireRole(MANAGE_ROLES), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const cur = await get('SELECT id FROM channels WHERE id=? AND deleted=0', [id]);
    if (!cur) return res.status(404).json({ error: '渠道不存在' });
    const fields = [], params = [];
    if (req.body.name !== undefined) {
      const name = (req.body.name || '').trim();
      if (!name) return res.status(400).json({ error: '渠道名称不能为空' });
      const dup = await get('SELECT id FROM channels WHERE name=? AND deleted=0 AND id<>?', [name, id]);
      if (dup) return res.status(400).json({ error: '该渠道已存在' });
      fields.push('name=?'); params.push(name);
    }
    if (req.body.sort !== undefined) { fields.push('sort=?'); params.push(Number(req.body.sort) || 0); }
    if (req.body.is_active !== undefined) { fields.push('is_active=?'); params.push(req.body.is_active ? 1 : 0); }
    if (!fields.length) return res.json({ ok: true });
    params.push(id);
    await run(`UPDATE channels SET ${fields.join(', ')} WHERE id=?`, params);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// 删除渠道：软删，历史订单已存渠道名称快照，不受影响
router.delete('/:id', authRequired, requireRole(MANAGE_ROLES), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const cur = await get('SELECT id FROM channels WHERE id=? AND deleted=0', [id]);
    if (!cur) return res.status(404).json({ error: '渠道不存在' });
    await run('UPDATE channels SET deleted=1 WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

export default router;
