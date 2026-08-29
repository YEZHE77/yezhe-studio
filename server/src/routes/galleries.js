// routes/galleries.js —— 客片电子相册（C 端对外分享）
// 管理端：创建 / 列表 / 详情 / 更新 / 删除 / 生成分享令牌
// 公开网关见 share.js 的 album 类型（/api/share/:token）
import { Router } from 'express';
import crypto from 'node:crypto';
import { query, get, insert, run } from '../db.js';
import { authRequired, requireRole } from '../auth.js';
import { buildShareUrl, genQr } from '../shareUtil.js';
import { serverError } from '../httpError.js';

const router = Router();

function parsePhotos(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean);
  try { const a = JSON.parse(v); return Array.isArray(a) ? a.filter(Boolean) : []; } catch { return []; }
}

// 列表（B 端管理）
router.get('/', authRequired, async (req, res) => {
  try {
    const rows = await query('SELECT * FROM galleries ORDER BY created_at DESC');
    res.json(rows.map((r) => ({ ...r, photos: parsePhotos(r.photos) })));
  } catch (e) { serverError(res, e); }
});

// 创建相册（同时生成 album 类型分享令牌 + 二维码）
router.post('/', authRequired, requireRole(['admin', 'photographer']), async (req, res) => {
  try {
    const b = req.body || {};
    let photos = Array.isArray(b.photos) ? b.photos.filter(Boolean) : [];
    // 未显式传照片时，若绑定了订单，自动抓取该订单 final 分区精修照片
    if (photos.length === 0 && b.order_id) {
      const works = await query('SELECT id FROM works WHERE order_id = ?', [Number(b.order_id)]);
      for (const w of works) {
        const al = await query("SELECT photo_url FROM albums WHERE work_id = ? AND zone = 'final' ORDER BY sort ASC", [w.id]);
        photos.push(...al.map((a) => a.photo_url).filter(Boolean));
      }
    }
    const cover_url = b.cover_url || (photos[0] || '');
    const token = crypto.randomBytes(16).toString('hex');
    const id = await insert(
      `INSERT INTO galleries (title, subtitle, category, blessing, cover_url, photos, brand_name, brand_slogan, brand_logo, order_id, share_token, is_public)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`,
      [
        b.title || '',
        b.subtitle || '',
        b.category || '婚礼',
        b.blessing || '',
        cover_url,
        JSON.stringify(photos),
        b.brand_name || '',
        b.brand_slogan || '',
        b.brand_logo || '',
        b.order_id ? Number(b.order_id) : null,
        token
      ]
    );
    // 同步一条 shares 记录，复用统一分享内核（留痕 / 启停 / 二维码）
    await insert(
      `INSERT INTO shares (token, type, ref_id, title, disabled, created_by) VALUES (?,?,?,?,0,?)`,
      [token, 'album', id, b.title || '客片相册', (req.user && req.user.username) || '']
    );
    const shareUrl = buildShareUrl(token, req);
    const qr_url = await genQr(shareUrl);
    res.json({ ok: true, id, token, share_url: shareUrl, qr_url });
  } catch (e) { serverError(res, e); }
});

// 详情
router.get('/:id', authRequired, async (req, res) => {
  try {
    const r = await get('SELECT * FROM galleries WHERE id = ?', [req.params.id]);
    if (!r) return res.status(404).json({ error: '相册不存在' });
    res.json({ ...r, photos: parsePhotos(r.photos) });
  } catch (e) { serverError(res, e); }
});

// 更新
router.put('/:id', authRequired, requireRole(['admin', 'photographer']), async (req, res) => {
  try {
    const b = req.body || {};
    const sets = [];
    const params = [];
    // 普通字段
    for (const f of ['title', 'subtitle', 'category', 'blessing', 'cover_url', 'brand_name', 'brand_slogan', 'brand_logo', 'order_id', 'is_public', 'disabled']) {
      if (b[f] !== undefined) { sets.push(`${f} = ?`); params.push(b[f]); }
    }
    // 照片数组（特殊处理 JSON）
    if (Array.isArray(b.photos)) {
      sets.push('photos = ?');
      params.push(JSON.stringify(b.photos.filter(Boolean)));
    }
    if (!sets.length) return res.json({ ok: true });
    params.push(req.params.id);
    await run('UPDATE galleries SET ' + sets.join(', ') + ' WHERE id = ?', params);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// 删除（同时清理关联的 shares / share_logs）
router.delete('/:id', authRequired, requireRole(['admin', 'photographer']), async (req, res) => {
  try {
    const r = await get('SELECT * FROM galleries WHERE id = ?', [req.params.id]);
    if (!r) return res.status(404).json({ error: '相册不存在' });
    if (r.share_token) {
      await run('DELETE FROM share_logs WHERE token = ?', [r.share_token]);
      await run('DELETE FROM shares WHERE token = ?', [r.share_token]);
    }
    await run('DELETE FROM galleries WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

export default router;
