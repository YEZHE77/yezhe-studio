// routes/albums.js —— 订单相册三分区（本地原片路径 / 选片小样 / 精修成品）
import { Router } from 'express';
import { query, insert, run } from '../db.js';
import { authRequired } from '../auth.js';
import { serverError } from '../httpError.js';

const router = Router();

// 某作品的相册（按分区）
router.get('/work/:workId', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM albums WHERE work_id = ? ORDER BY zone, sort', [req.params.workId]);
    res.json(rows);
  } catch (e) { serverError(res, e); }
});

// 新增一张（zone: local=仅存本地路径文本；sample/final=存网络图片URL）
router.post('/work/:workId', authRequired, async (req, res) => {
  try {
    const b = req.body;
    const zone = b.zone || 'sample';
    if (zone === 'local' && !b.local_path) return res.status(400).json({ error: '本地原片需填写存储路径' });
    if (zone !== 'local' && !b.photo_url) return res.status(400).json({ error: '请先上传图片' });
    const id = await insert(
      'INSERT INTO albums (work_id, zone, photo_url, local_path, sort) VALUES (?,?,?,?,?)',
      [req.params.workId, zone, b.photo_url || '', b.local_path || '', b.sort || 0]
    );
    res.json({ id });
  } catch (e) { serverError(res, e); }
});

router.delete('/:id', authRequired, async (req, res) => {
  try {
    await run('DELETE FROM albums WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

export default router;
