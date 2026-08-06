// routes/share.js —— 公开分享网关（无需登录）
// 职责：校验令牌 / 有效期 / 可选密码，按 type 返回业务数据；访问留痕写 share_logs。
// 安全约束：作品 album 仅返回 sample / final 分区，绝不返回 local 原片；仅返回未软删除、未作废的订单。
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query, get, insert } from '../db.js';

const router = Router();

// 访问留痕
async function logAccess(token, action, detail, req) {
  try {
    await insert(
      'INSERT INTO share_logs (token, action, detail, ip, ua) VALUES (?,?,?,?,?)',
      [token, action, detail || null, (req && req.ip) || '', (req && req.get && req.get('user-agent')) || '']
    );
  } catch { /* 留痕失败不影响主流程 */ }
}

// 当前时间戳（用于有效期比较）
function nowISO() { return new Date().toISOString(); }

// 是否过期
function isExpired(expireAt) {
  if (!expireAt) return false;
  const exp = new Date(expireAt).getTime();
  if (Number.isNaN(exp)) return false;
  return exp < Date.now();
}

// ===== 各类型 payload 构造 =====
async function buildOrderPayload(orderId) {
  const o = await get(
    'SELECT * FROM orders WHERE id = ? AND is_deleted = 0 AND cancelled = 0',
    [orderId]
  );
  if (!o) return null;
  let pkgName = '';
  if (o.package_id) {
    const p = await get('SELECT name FROM packages WHERE id = ?', [o.package_id]);
    pkgName = p ? p.name : '';
  }
  const works = await query(
    'SELECT id, title, cover_url FROM works WHERE order_id = ? ORDER BY id ASC',
    [o.id]
  );
  const out = [];
  for (const w of works) {
    const albums = await query(
      "SELECT photo_url, zone FROM albums WHERE work_id = ? AND zone IN ('sample','final') ORDER BY sort ASC",
      [w.id]
    );
    out.push({
      id: w.id,
      title: w.title,
      cover_url: w.cover_url,
      photos: albums.map((a) => ({ url: a.photo_url, zone: a.zone }))
    });
  }
  return {
    order: {
      id: o.id,
      order_no: o.order_no,
      customer_name: o.customer_name,
      packageName: pkgName,
      status: o.status,
      raw_expire_at: o.raw_expire_at,
      retouch_expire_at: o.retouch_expire_at
    },
    works: out
  };
}

async function buildWorkPayload(workId) {
  const w = await get('SELECT * FROM works WHERE id = ?', [workId]);
  if (!w) return null;
  const albums = await query(
    "SELECT photo_url, zone FROM albums WHERE work_id = ? AND zone IN ('sample','final') ORDER BY sort ASC",
    [w.id]
  );
  return {
    work: {
      id: w.id,
      title: w.title,
      cover_url: w.cover_url,
      description: w.description || '',
      blessing: w.blessing || ''
    },
    photos: albums.map((a) => ({ url: a.photo_url, zone: a.zone }))
  };
}

async function buildPackagePayload(packageId) {
  const p = await get('SELECT * FROM packages WHERE id = ?', [packageId]);
  if (!p) return null;
  let addons = [], specs = [], questionnaire = '';
  try { addons = p.addons ? JSON.parse(p.addons) : []; } catch { addons = []; }
  try { specs = p.specs ? JSON.parse(p.specs) : []; } catch { specs = []; }
  try { questionnaire = p.questionnaire ? JSON.parse(p.questionnaire) : ''; } catch { questionnaire = p.questionnaire || ''; }
  return {
    package: {
      id: p.id,
      name: p.name,
      price: p.price,
      cover_url: p.cover_url,
      description: p.description || '',
      addons,
      specs,
      questionnaire,
      marketing: p.marketing || '',
      deposit: p.deposit || 0,
      retouch_count: p.retouch_count || 0,
      duration: p.duration || ''
    }
  };
}

async function buildSchedulePayload(scheduleId) {
  const s = await get('SELECT * FROM schedules WHERE id = ?', [scheduleId]);
  if (!s) return null;
  return {
    schedule: {
      id: s.id,
      date: s.date,
      period: s.period,
      status: s.status,
      photographer: s.photographer || '',
      note: s.note || '',
      lunar_date: s.lunar_date || '',
      groom_name: s.groom_name || '',
      bride_name: s.bride_name || '',
      contact_phone: s.contact_phone || '',
      address: s.address || ''
    }
  };
}

async function buildBillPayload(orderId) {
  const o = await get(
    'SELECT * FROM orders WHERE id = ? AND is_deleted = 0 AND cancelled = 0',
    [orderId]
  );
  if (!o) return null;
  let pkgName = '';
  if (o.package_id) {
    const p = await get('SELECT name FROM packages WHERE id = ?', [o.package_id]);
    pkgName = p ? p.name : '';
  }
  const payments = await query(
    'SELECT * FROM payments WHERE order_id = ? ORDER BY created_at ASC',
    [o.id]
  );
  const received = payments.filter((p) => ['deposit', 'balance', 'extra'].includes(p.type)).reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
  const refunded = payments.filter((p) => p.type === 'refund').reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
  const total = parseFloat(o.total_amount) || 0;
  const paid = parseFloat(o.paid_amount) || 0;
  return {
    order: {
      id: o.id,
      order_no: o.order_no,
      customer_name: o.customer_name,
      packageName: pkgName,
      status: o.status
    },
    payments,
    summary: {
      total,
      paid,
      refunded,
      balance_unpaid: Math.max(0, total - paid + refunded)
    }
  };
}

async function buildAlbumPayload(galleryId) {
  const g = await get('SELECT * FROM galleries WHERE id = ?', [galleryId]);
  if (!g) return null;
  let photos = [];
  try { photos = JSON.parse(g.photos || '[]'); } catch { photos = []; }
  if (!Array.isArray(photos)) photos = [];
  photos = photos.filter(Boolean);
  return {
    gallery: {
      id: g.id,
      title: g.title || '',
      subtitle: g.subtitle || '',
      category: g.category || '',
      blessing: g.blessing || '',
      cover_url: g.cover_url || '',
      photos,
      brand_name: g.brand_name || '',
      brand_slogan: g.brand_slogan || '',
      brand_logo: g.brand_logo || ''
    }
  };
}

async function buildPayload(type, refId) {
  switch (type) {
    case 'order': return buildOrderPayload(refId);
    case 'work': return buildWorkPayload(refId);
    case 'package': return buildPackagePayload(refId);
    case 'schedule': return buildSchedulePayload(refId);
    case 'bill': return buildBillPayload(refId);
    case 'album': return buildAlbumPayload(refId);
    default: return null;
  }
}

// 兜底：旧订单分享（orders.share_token 字段仍存在的旧链接）仍可用
async function legacyOrderShare(token) {
  const o = await get(
    'SELECT * FROM orders WHERE share_token = ? AND is_deleted = 0 AND cancelled = 0',
    [token]
  );
  if (!o) return null;
  const data = await buildOrderPayload(o.id);
  if (!data) return null;
  return { type: 'order', title: `${data.order.customer_name} 的专属影集`, expire_at: null, locked: false, data };
}

// 统一信封
function envelope(share, data, locked) {
  return {
    ok: true,
    locked: !!locked,
    meta: {
      token: share.token,
      type: share.type,
      ref_id: share.ref_id || null,
      title: share.title || '',
      expire_at: share.expire_at || null
    },
    data
  };
}

// GET /api/share/:token —— 公开访问（无密码或已前置校验）
router.get('/:token', async (req, res) => {
  try {
    const token = req.params.token;
    let share = await get('SELECT * FROM shares WHERE token = ?', [token]);

    // 兜底旧订单分享链接
    if (!share) {
      const legacy = await legacyOrderShare(token);
      if (!legacy) return res.status(404).json({ error: '分享链接无效或已失效' });
      await logAccess(token, 'view', 'legacy-order', req);
      return res.json(envelope({ token, type: legacy.type, title: legacy.title, expire_at: null }, legacy.data, false));
    }

    if (share.disabled) return res.status(403).json({ error: '该分享已被关闭' });
    if (isExpired(share.expire_at)) return res.status(403).json({ error: '该分享已过期' });

    const data = await buildPayload(share.type, share.ref_id);
    if (!data) return res.status(404).json({ error: '分享内容不存在或已失效' });

    if (share.password_hash) {
      // 需要密码：返回 locked 信封，不含数据
      return res.json(envelope(share, null, true));
    }
    await logAccess(token, 'view', null, req);
    res.json(envelope(share, data, false));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/share/:token/verify —— 密码校验（无登录）
router.post('/:token/verify', async (req, res) => {
  try {
    const token = req.params.token;
    const share = await get('SELECT * FROM shares WHERE token = ?', [token]);
    if (!share) return res.status(404).json({ error: '分享链接无效或已失效' });
    if (share.disabled) return res.status(403).json({ error: '该分享已被关闭' });
    if (isExpired(share.expire_at)) return res.status(403).json({ error: '该分享已过期' });

    const password = (req.body && req.body.password) || '';
    if (share.password_hash) {
      const ok = await bcrypt.compare(String(password), share.password_hash);
      if (!ok) {
        await logAccess(token, 'deny', null, req);
        return res.status(401).json({ error: '密码错误' });
      }
    }

    const data = await buildPayload(share.type, share.ref_id);
    if (!data) return res.status(404).json({ error: '分享内容不存在或已失效' });
    await logAccess(token, 'view', 'password', req);
    res.json(envelope(share, data, false));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
