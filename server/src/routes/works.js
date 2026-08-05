// routes/works.js —— 作品管理（对标拾光盒子【客片/在线选片】核心）
import { Router } from 'express';
import { query, get, insert, run } from '../db.js';
import { parseRow } from '../schema.js';
import { authRequired } from '../auth.js';
import { deleteFromR2 } from '../storage.js';

const router = Router();

// 列表（筛选 + 分页 + Tab 记忆所需参数）
// query: category, q(搜索标题/客户), is_public(0/1), page, pageSize
router.get('/', async (req, res) => {
  try {
    const { category, q, is_public, page = 1, pageSize = 12 } = req.query;
    const where = [];
    const params = [];
    if (category) { where.push('category_id = ?'); params.push(category); }
    if (is_public !== undefined && is_public !== '') { where.push('is_public = ?'); params.push(is_public); }
    if (q) { where.push('(title LIKE ? OR customer_name LIKE ?)'); params.push('%' + q + '%', '%' + q + '%'); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = (await get('SELECT COUNT(*) AS c FROM works ' + w, params)).c;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(pageSize);
    const rows = await query(
      'SELECT * FROM works ' + w + ' ORDER BY id DESC LIMIT ? OFFSET ?',
      [...params, parseInt(pageSize), offset]
    );
    const items = rows.map((r) => parseRow(r, ['tags']));
    res.json({ items, total, page: parseInt(page), pageSize: parseInt(pageSize) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 公开接口（C 端小程序，无需登录）=====
// 公开作品列表（仅 is_public=1）
router.get('/public', async (req, res) => {
  try {
    const { category, q, page = 1, pageSize = 12 } = req.query;
    const where = ['w.is_public = 1'];
    const params = [];
    if (category) { where.push('w.category_id = ?'); params.push(category); }
    if (q) { where.push('(w.title LIKE ? OR w.customer_name LIKE ?)'); params.push('%' + q + '%', '%' + q + '%'); }
    const w = 'WHERE ' + where.join(' AND ');
    const total = (await get('SELECT COUNT(*) AS c FROM works w ' + w, params)).c;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(pageSize);
    const rows = await query(
      `SELECT w.*, c.name AS category_name FROM works w LEFT JOIN categories c ON c.id = w.category_id ${w} ORDER BY w.id DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(pageSize), offset]
    );
    res.json({ items: rows.map((r) => parseRow(r, ['tags'])), total, page: parseInt(page), pageSize: parseInt(pageSize) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 公开作品详情（只返 sample/final 小样，绝不返回 local 原片分区）
router.get('/public/:id', async (req, res) => {
  try {
    const w = await get('SELECT * FROM works WHERE id = ? AND is_public = 1', [req.params.id]);
    if (!w) return res.status(404).json({ error: '作品不存在或未公开' });
    const work = parseRow(w, ['tags']);
    const albums = await query("SELECT * FROM albums WHERE work_id = ? AND zone != 'local' ORDER BY zone, sort", [w.id]);
    res.json({ work, albums });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 详情（含相册三分区 + 最新选片）
router.get('/:id', async (req, res) => {
  try {
    const w = await get('SELECT * FROM works WHERE id = ?', [req.params.id]);
    if (!w) return res.status(404).json({ error: '作品不存在' });
    const work = parseRow(w, ['tags']);
    const albums = await query('SELECT * FROM albums WHERE work_id = ? ORDER BY zone, sort', [w.id]);
    const sel = await get('SELECT * FROM selections WHERE work_id = ? ORDER BY id DESC LIMIT 1', [w.id]);
    res.json({ work, albums, selection: sel ? parseRow(sel, ['selected']) : null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 新建
router.post('/', authRequired, async (req, res) => {
  try {
    const b = req.body;
    const id = await insert(
      'INSERT INTO works (title, category_id, is_public, is_private, cover_url, description, blessing, tags, live, customer_name, order_id, allow_download) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [
        b.title, b.category_id || null, b.is_public ? 1 : 0, b.is_private ? 1 : 0,
        b.cover_url || '', b.description || '', b.blessing || '',
        JSON.stringify(b.tags || []), b.live ? 1 : 0, b.customer_name || '', b.order_id || null, b.allow_download ? 1 : 0
      ]
    );
    res.json({ id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 更新
router.put('/:id', authRequired, async (req, res) => {
  try {
    const b = req.body;
    await run(
      `UPDATE works SET title=?, category_id=?, is_public=?, is_private=?, cover_url=?, description=?, blessing=?, tags=?, live=?, customer_name=?, order_id=?, allow_download=? WHERE id=?`,
      [
        b.title, b.category_id || null, b.is_public ? 1 : 0, b.is_private ? 1 : 0,
        b.cover_url || '', b.description || '', b.blessing || '',
        JSON.stringify(b.tags || []), b.live ? 1 : 0, b.customer_name || '', b.order_id || null, b.allow_download ? 1 : 0, req.params.id
      ]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 删除
router.delete('/:id', authRequired, async (req, res) => {
  try {
    const rows = await query('SELECT photo_url FROM albums WHERE work_id = ?', [req.params.id]);
    for (const r of rows) if (r.photo_url) deleteFromR2(r.photo_url);
    await run('DELETE FROM works WHERE id = ?', [req.params.id]);
    await run('DELETE FROM albums WHERE work_id = ?', [req.params.id]);
    await run('DELETE FROM selections WHERE work_id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 相册管理（支持 500 张批量） =====
// 查询某作品全部相册
router.get('/:id/albums', authRequired, async (req, res) => {
  try {
    const albums = await query('SELECT * FROM albums WHERE work_id = ? ORDER BY zone, sort, id', [req.params.id]);
    res.json({ items: albums });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 批量添加照片到作品相册
router.post('/:id/albums', authRequired, async (req, res) => {
  try {
    const { urls, zone = 'sample' } = req.body;
    if (!Array.isArray(urls) || !urls.length) return res.status(400).json({ error: 'urls 数组不能为空' });
    // 取当前最大 sort，追加到末尾
    const max = await get('SELECT COALESCE(MAX(sort), -1) AS m FROM albums WHERE work_id = ? AND zone = ?', [req.params.id, zone]);
    let sort = (max.m ?? -1) + 1;
    const inserted = [];
    for (const url of urls) {
      const id = await insert('INSERT INTO albums (work_id, zone, photo_url, sort) VALUES (?,?,?,?)', [req.params.id, zone, url, sort++]);
      inserted.push(id);
    }
    res.json({ ok: true, ids: inserted });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 更新单张照片排序
router.put('/albums/:id/sort', authRequired, async (req, res) => {
  try {
    const { sort } = req.body;
    if (typeof sort !== 'number') return res.status(400).json({ error: 'sort 必须为数字' });
    await run('UPDATE albums SET sort = ? WHERE id = ?', [sort, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 删除单张照片（联动删除 R2 对象）
router.delete('/albums/:id', authRequired, async (req, res) => {
  try {
    const row = await get('SELECT photo_url FROM albums WHERE id = ?', [req.params.id]);
    if (row && row.photo_url) deleteFromR2(row.photo_url);
    await run('DELETE FROM albums WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 设置作品封面
router.put('/:id/cover', authRequired, async (req, res) => {
  try {
    const { cover_url } = req.body;
    await run('UPDATE works SET cover_url = ? WHERE id = ?', [cover_url || '', req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
