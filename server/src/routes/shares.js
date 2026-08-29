// routes/shares.js —— 统一分享内核：管理端接口（创建 / 列表 / 启停 / 删除 / 留痕）
// 与公开网关 share.js 区别：本文件需要商家登录(authRequired)，用于 B 端生成与管控分享令牌。
import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { query, get, insert, run } from '../db.js';
import { authRequired, requireRole } from '../auth.js';
import { buildShareUrl, genQr } from '../shareUtil.js';
import { serverError } from '../httpError.js';

const router = Router();

const TYPES = ['order', 'work', 'package', 'schedule', 'bill', 'album'];

// 校验 ref_id 指向的业务记录是否存在（按类型）
async function validateRef(type, refId) {
  switch (type) {
    case 'order':
      return get('SELECT id, customer_name FROM orders WHERE id = ? AND is_deleted = 0 AND cancelled = 0', [refId]);
    case 'bill':
      return get('SELECT id, customer_name FROM orders WHERE id = ? AND is_deleted = 0 AND cancelled = 0', [refId]);
    case 'work':
      return get('SELECT id, title FROM works WHERE id = ?', [refId]);
    case 'package':
      return get('SELECT id, name FROM packages WHERE id = ?', [refId]);
    case 'schedule':
      return get('SELECT id, date FROM schedules WHERE id = ?', [refId]);
    case 'album':
      return get('SELECT id, title FROM galleries WHERE id = ?', [refId]);
    default:
      return null;
  }
}

// 根据业务记录推导默认分享标题
async function defaultTitle(type, refId, row) {
  if (!row) return '';
  switch (type) {
    case 'order':
    case 'bill':
      return `客户影集账单 · ${row.customer_name || ''}`;
    case 'work':
      return row.title || '作品分享';
    case 'package':
      return row.name || '套系分享';
    case 'schedule':
      return `婚礼档期 · ${row.date || ''}`;
    case 'album':
      return row.title || '客片相册';
    default:
      return '';
  }
}

// 创建分享（令牌 + 可选密码 + 可选有效期 + 二维码）
router.post('/', authRequired, requireRole(['admin', 'photographer', 'finance']), async (req, res) => {
  try {
    const { type, ref_id, title, password, expire_at } = req.body || {};
    if (!TYPES.includes(type)) return res.status(400).json({ error: '分享类型不支持：' + type });
    const refId = parseInt(ref_id, 10);
    if (!refId || refId <= 0) return res.status(400).json({ error: '请传入有效的业务 ID（ref_id）' });

    const row = await validateRef(type, refId);
    if (!row) return res.status(404).json({ error: '关联的业务记录不存在或已失效' });

    const token = crypto.randomBytes(16).toString('hex');
    const password_hash = password ? await bcrypt.hash(String(password), 10) : null;
    const finalTitle = title || (await defaultTitle(type, refId, row));
    const created_by = req.user && req.user.username ? req.user.username : '';

    await insert(
      `INSERT INTO shares (token, type, ref_id, title, password_hash, expire_at, disabled, created_by)
       VALUES (?,?,?,?,?,?,0,?)`,
      [token, type, refId, finalTitle, password_hash, expire_at || null, created_by]
    );

    // 二维码（公开落地页）
    const shareUrl = buildShareUrl(token, req);
    const qr_url = await genQr(shareUrl);

    res.json({
      ok: true,
      token,
      type,
      ref_id: refId,
      title: finalTitle,
      share_url: shareUrl,
      qr_url,
      expire_at: expire_at || null,
      has_password: !!password_hash,
      disabled: 0
    });
  } catch (e) {
    serverError(res, e);
  }
});

// 列表（可按 type / ref_id 过滤）
router.get('/', authRequired, async (req, res) => {
  try {
    const { type, ref_id } = req.query;
    const where = [];
    const params = [];
    if (type) { where.push('type = ?'); params.push(type); }
    if (ref_id) { where.push('ref_id = ?'); params.push(ref_id); }
    const rows = await query(
      'SELECT * FROM shares' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY created_at DESC',
      params
    );
    res.json(rows.map((r) => ({
      ...r,
      has_password: !!r.password_hash,
      password_hash: undefined
    })));
  } catch (e) {
    serverError(res, e);
  }
});

// 启停（toggle disabled）
router.post('/:token/toggle', authRequired, requireRole(['admin', 'photographer', 'finance']), async (req, res) => {
  try {
    const s = await get('SELECT * FROM shares WHERE token = ?', [req.params.token]);
    if (!s) return res.status(404).json({ error: '分享不存在' });
    const disabled = s.disabled ? 0 : 1;
    await run('UPDATE shares SET disabled = ? WHERE token = ?', [disabled, req.params.token]);
    res.json({ ok: true, disabled });
  } catch (e) {
    serverError(res, e);
  }
});

// 重置 share-key（验收清单 3.4 / 七.3，黑名单第 6 条）
// ⚠️ 与「关闭分享」是两个完全独立的语义，不可混淆：
//   关闭分享（toggle） = 链接仍然存在，访客打开提示「该合集已关闭对外分享」，商家可随时再打开；
//   重置密钥（reset）  = 旧链接【立即失效】（再打开提示「该分享链接已失效，请向摄影师获取最新链接」），
//                        并返回一条全新链接；适用于链接已外泄、需要作废旧地址的场景。
router.post('/:token/reset', authRequired, requireRole(['admin', 'photographer', 'finance']), async (req, res) => {
  try {
    const oldToken = req.params.token;
    const s = await get('SELECT * FROM shares WHERE token = ?', [oldToken]);
    if (!s) return res.status(404).json({ error: '分享不存在' });

    const newToken = crypto.randomBytes(16).toString('hex');
    await run('UPDATE shares SET token = ? WHERE token = ?', [newToken, oldToken]);
    // 访问留痕随分享记录迁移到新 token：后台仍能翻看该分享的历史访问记录（清单 3.7）
    try { await run('UPDATE share_logs SET token = ? WHERE token = ?', [newToken, oldToken]); } catch { /* 留痕迁移失败不阻断重置 */ }
    // 旧版订单分享字段同步（历史数据兼容）
    if (s.type === 'order' && s.ref_id) {
      try { await run('UPDATE orders SET share_token = ? WHERE id = ?', [newToken, s.ref_id]); } catch { /* 老字段不存在则忽略 */ }
    }

    const shareUrl = buildShareUrl(newToken, req);
    let qr_url = '';
    try { qr_url = await genQr(shareUrl); } catch { /* 二维码失败不影响返回链接 */ }
    res.json({ ok: true, token: newToken, share_url: shareUrl, qr_url, title: s.title || '' });
  } catch (e) {
    serverError(res, e);
  }
});

// 删除分享
router.delete('/:token', authRequired, requireRole(['admin', 'photographer', 'finance']), async (req, res) => {
  try {
    const s = await get('SELECT * FROM shares WHERE token = ?', [req.params.token]);
    if (!s) return res.status(404).json({ error: '分享不存在' });
    await run('DELETE FROM share_logs WHERE token = ?', [req.params.token]);
    await run('DELETE FROM shares WHERE token = ?', [req.params.token]);
    // 若关联订单，清掉旧字段，使其公开链接一并失效
    if (s.type === 'order' && s.ref_id) {
      await run('UPDATE orders SET share_token = NULL, qr_url = NULL WHERE id = ?', [s.ref_id]);
    }
    res.json({ ok: true });
  } catch (e) {
    serverError(res, e);
  }
});

// 访问留痕（管理端查看）
router.get('/:token/logs', authRequired, async (req, res) => {
  try {
    const rows = await query(
      'SELECT * FROM share_logs WHERE token = ? ORDER BY created_at DESC',
      [req.params.token]
    );
    res.json(rows);
  } catch (e) {
    serverError(res, e);
  }
});

export default router;
