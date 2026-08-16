// routes/photoPackage.js —— 套系对外分享（C 端浏览报价，独立于 B 端内部 packages）
// share_token 随机不可猜测字符串鉴权；is_enable 控制外部访问；客户访问自动写 system 消息。
import { Router } from 'express';
import crypto from 'node:crypto';
import { query, get, insert, run } from '../db.js';
import { authRequired, requireRole } from '../auth.js';
import { emitMessage } from './message.js';

const router = Router();
const STAFF_ROLES = ['admin', 'photographer', 'finance'];

function nowISO() { return new Date().toISOString(); }
function newToken() { return crypto.randomBytes(16).toString('hex'); }

// ===================== B 端管理 =====================

// 列表
router.get('/', authRequired, async (req, res) => {
  try {
    const rows = await query('SELECT * FROM photo_package ORDER BY id DESC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 新增
router.post('/', authRequired, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const b = req.body || {};
    const token = newToken();
    const id = await insert(
      `INSERT INTO photo_package (package_name, cover_image, package_desc, shoot_duration, shoot_scope,
        photo_total, retouch_count, original_file, price, additional_price, other_service, notice,
        share_token, is_enable, create_time, update_time)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
      [b.package_name || '', b.cover_image || '', b.package_desc || '', b.shoot_duration || '', b.shoot_scope || '',
        parseInt(b.photo_total, 10) || 0, parseInt(b.retouch_count, 10) || 0, b.original_file || '',
        parseFloat(b.price) || 0, parseFloat(b.additional_price) || 0, b.other_service || '', b.notice || '',
        token, nowISO(), nowISO()]
    );
    res.json({ ok: true, id, share_token: token });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 编辑
router.put('/:id', authRequired, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const b = req.body || {};
    await run(
      `UPDATE photo_package SET package_name=?, cover_image=?, package_desc=?, shoot_duration=?, shoot_scope=?,
        photo_total=?, retouch_count=?, original_file=?, price=?, additional_price=?, other_service=?, notice=?, update_time=?
       WHERE id=?`,
      [b.package_name || '', b.cover_image || '', b.package_desc || '', b.shoot_duration || '', b.shoot_scope || '',
        parseInt(b.photo_total, 10) || 0, parseInt(b.retouch_count, 10) || 0, b.original_file || '',
        parseFloat(b.price) || 0, parseFloat(b.additional_price) || 0, b.other_service || '', b.notice || '',
        nowISO(), req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 启用 / 禁用
router.post('/:id/toggle', authRequired, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const r = await get('SELECT is_enable FROM photo_package WHERE id = ?', [req.params.id]);
    if (!r) return res.status(404).json({ error: '套系不存在' });
    const next = r.is_enable ? 0 : 1;
    await run('UPDATE photo_package SET is_enable = ?, update_time = ? WHERE id = ?', [next, nowISO(), req.params.id]);
    res.json({ ok: true, is_enable: !!next });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 删除（物理删除；外部访问将提示「该套系不存在」）
router.delete('/:id', authRequired, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    await run('DELETE FROM photo_package WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 重新生成分享链接（重置 share_token）
router.post('/:id/share', authRequired, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const r = await get('SELECT id FROM photo_package WHERE id = ?', [req.params.id]);
    if (!r) return res.status(404).json({ error: '套系不存在' });
    const token = newToken();
    await run('UPDATE photo_package SET share_token = ?, update_time = ? WHERE id = ?', [token, nowISO(), req.params.id]);
    res.json({ ok: true, share_token: token });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===================== C 端公开预览 =====================

// GET /api/photo-package/public/:token —— share_token 鉴权，无效/禁用友好提示
// 公开套系列表（C 端首页「套系/价目」区块，仅返回已启用的套系）
router.get('/public-list', async (req, res) => {
  try {
    const rows = await query('SELECT id, package_name, cover_image, package_desc, shoot_duration, shoot_scope, photo_total, retouch_count, original_file, price, additional_price, other_service, notice FROM photo_package WHERE is_enable = 1 ORDER BY id ASC');
    res.json({ list: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/public/:token', async (req, res) => {
  try {
    const r = await get('SELECT * FROM photo_package WHERE share_token = ?', [req.params.token]);
    if (!r) return res.status(404).json({ error: '该套系不存在' });
    if (!Number(r.is_enable)) return res.status(403).json({ error: '该套系已暂停查看' });
    // 客户访问套系 → 自动生成 system 消息（去重 5 分钟）
    await emitMessage({
      message_type: 'system', business_event: 'package_view',
      title: '客户访问了套系', content: `客户访问了「${r.package_name}」套系报价`, rel_id: String(r.id), rel_model: 'package'
    });
    res.json({
      package_name: r.package_name, cover_image: r.cover_image, package_desc: r.package_desc,
      shoot_duration: r.shoot_duration, shoot_scope: r.shoot_scope, photo_total: r.photo_total,
      retouch_count: r.retouch_count, original_file: r.original_file, price: r.price,
      additional_price: r.additional_price, other_service: r.other_service, notice: r.notice
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
