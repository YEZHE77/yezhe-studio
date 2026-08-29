// routes/share.js —— 公开分享网关（无需登录）
// 职责：校验令牌 / 有效期 / 可选密码，按 type 返回业务数据；访问留痕写 share_logs。
// 安全约束：作品 album 仅返回 sample / final 分区，绝不返回 local 原片；仅返回未软删除、未作废的订单。
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query, get, insert } from '../db.js';
import { peekUser } from '../auth.js';
import { serverError } from '../httpError.js';

const router = Router();

// ===== 分享链接错误文案（严格对齐验收清单三.2 / 三.3 / 三.4 / 三.5）=====
// 这三个语义必须分开，不能混用：
//   SHARE_INVALID_MSG     链接失效：token 被篡改 / 已重置 / 合集已删除 / 已过期
//   SHARE_CLOSED_MSG      合集已关闭对外分享（链接仍然存在，只是被商家关掉了）
//   SHARE_BAD_FORMAT_MSG  链接格式不正确：参数丢失、被截断、乱码
export const SHARE_INVALID_MSG = '该分享链接已失效，请向摄影师获取最新链接';
export const SHARE_CLOSED_MSG = '该合集已关闭对外分享';
export const SHARE_BAD_FORMAT_MSG = '链接格式不正确，请复制完整链接打开';

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

// 取工作室品牌信息（用于相册底部品牌工具栏）
async function fetchStudioBrand() {
  const r = await get("SELECT value FROM settings WHERE key = 'studio'");
  let s = {};
  if (r && r.value) { try { s = JSON.parse(r.value); } catch { s = {}; } }
  return {
    brand_name: s.name || 'YEZHE WORKSHOP',
    brand_slogan: s.slogan || '',
    brand_intro: s.intro || '',
    brand_logo: s.logo || ''
  };
}

// 作品 → 沉浸式相册数据（公开，仅 sample/final，绝不返回 local 原片）
// 单独导出，供 works.js 的公开相册接口复用（小程序作品详情「查看相册」直连）。
export async function buildWorkAlbum(workId) {
  const w = await get('SELECT * FROM works WHERE id = ?', [workId]);
  if (!w) return null;
  let catName = '';
  const firstCatId = w.category_id || (w.category_ids ? String(w.category_ids).split(',')[0] : '');
  if (firstCatId) {
    const c = await get('SELECT name FROM categories WHERE id = ?', [firstCatId]);
    catName = c ? c.name : '';
  }
  // 优先 sample 区（对外展示），无则回退 final，绝不取 local 原片
  let photos = (await query(
    "SELECT photo_url FROM albums WHERE work_id = ? AND zone = 'sample' ORDER BY sort ASC",
    [w.id]
  )).map((a) => a.photo_url).filter(Boolean);
  if (!photos.length) {
    photos = (await query(
      "SELECT photo_url FROM albums WHERE work_id = ? AND zone = 'final' ORDER BY sort ASC",
      [w.id]
    )).map((a) => a.photo_url).filter(Boolean);
  }
  const brand = await fetchStudioBrand();
  // 自定义相册文案（album_copy）取代旧的 description/blessing：客户相册正文由商家自定义
  const albumCopy = w.album_copy || w.blessing || '';
  return {
    title: w.title || '',
    subtitle: catName || '',
    category: catName || '',
    blessing: albumCopy,
    albumCopy,
    cover_url: w.cover_url || '',
    photos,
    brand_name: brand.brand_name,
    brand_slogan: brand.brand_slogan,
    brand_intro: brand.brand_intro,
    brand_logo: brand.brand_logo
  };
}

// 相册锁状态：是否开启密码 + 是否过期（不返回密码本身）
export async function albumLockState(workId) {
  const w = await get('SELECT album_password_enabled, album_expires_at FROM works WHERE id = ?', [workId]);
  if (!w) return { enabled: false, expired: false };
  let expired = false;
  if (w.album_expires_at) {
    const exp = new Date(w.album_expires_at).getTime();
    if (!Number.isNaN(exp)) expired = exp < Date.now();
  }
  return { enabled: !!Number(w.album_password_enabled), expired };
}

async function buildWorkPayload(workId) {
  const gallery = await buildWorkAlbum(workId);
  if (!gallery) return null;
  return { gallery };
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

// ===== 安全约束（验收清单 C端 1.9 / 4.2，后台 2.3，两端黑名单第 3 条）=====
// 客户专属相册【禁止】通过 share-key 访问，只能手机号登录进入。
// 原因：share-key 是随机公开密钥，一旦客户影集可被 share-key 直开，
// 等于把客户底片/成片暴露给任何拿到链接的人（转发、泄露、爬虫皆可直接查看）。
// 因此：
//   1) buildPayload 不再支持 'order' 类型（返回 null → 走统一的「链接失效」提示）；
//   2) 旧版 orders.share_token 兜底（legacyOrderShare）一并移除；
//   3) 客户查看自己的订单与影集，请走 /customer/login 手机号登录，或 /customer-order?token=customer_token。
// 注：orders.customer_token 是订单专属令牌（与 share-key 不同体系），由商家主动发给该客户，
//     仍按原逻辑在 customerMine.js /order-detail 中校验，不受此处影响。
async function buildPayload(type, refId) {
  switch (type) {
    case 'work': return buildWorkPayload(refId);
    case 'package': return buildPackagePayload(refId);
    case 'schedule': return buildSchedulePayload(refId);
    case 'bill': return buildBillPayload(refId);
    case 'album': return buildAlbumPayload(refId);
    default: return null;
  }
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
    const token = String(req.params.token || '').trim();
    // 参数缺失 / 乱码 / 被截断：统一提示「链接格式不正确，请复制完整链接打开」（清单 3.5）
    if (!token || token === 'undefined' || token === 'null' || !/^[A-Za-z0-9_-]{6,64}$/.test(token)) {
      return res.status(400).json({ error: SHARE_BAD_FORMAT_MSG });
    }

    const share = await get('SELECT * FROM shares WHERE token = ?', [token]);
    // 查不到（链接被篡改 / 已重置 / 合集已删除）→ 统一「链接失效」文案（清单 3.2 / 3.4 / 3.5）
    // 注：旧版 orders.share_token 兜底已移除（客户相册禁止 share-key 访问）
    if (!share) return res.status(404).json({ error: SHARE_INVALID_MSG });

    // 关闭分享（后台 is_share_open=false 语义，底层存 shares.disabled）
    if (share.disabled) return res.status(403).json({ error: SHARE_CLOSED_MSG });
    if (isExpired(share.expire_at)) return res.status(403).json({ error: SHARE_INVALID_MSG });

    const isStaff = !!peekUser(req); // 商家后台进入 → 跳过相册密码锁

    // 相册级密码锁（仅 type=work；订单/套系等分享仍走 share.password_hash）
    if (share.type === 'work' && !isStaff) {
      const w = await get('SELECT id, title, album_password_enabled, album_expires_at FROM works WHERE id = ?', [share.ref_id]);
      if (w) {
        let expired = false;
        if (w.album_expires_at) {
          const exp = new Date(w.album_expires_at).getTime();
          if (!Number.isNaN(exp)) expired = exp < Date.now();
        }
        if (expired) return res.status(403).json({ error: '该相册已过期' });
        if (Number(w.album_password_enabled)) {
          // 相册锁：返回 locked 信封（meta.albumLock 标记），不含数据
          return res.json({
            ok: true,
            locked: true,
            meta: {
              token: share.token,
              type: share.type,
              ref_id: share.ref_id || null,
              title: w.title || '',
              expire_at: share.expire_at || null,
              albumLock: true
            },
            data: null
          });
        }
      }
    }

    const data = await buildPayload(share.type, share.ref_id);
    if (!data) return res.status(404).json({ error: '分享内容不存在或已失效' });

    if (share.password_hash) {
      // 需要密码：返回 locked 信封，不含数据
      return res.json(envelope(share, null, true));
    }
    await logAccess(token, 'view', null, req);
    res.json(envelope(share, data, false));
  } catch (e) {
    serverError(res, e);
  }
});

// POST /api/share/:token/verify —— 密码校验（无登录）
router.post('/:token/verify', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token || token === 'undefined' || token === 'null' || !/^[A-Za-z0-9_-]{6,64}$/.test(token)) {
      return res.status(400).json({ error: SHARE_BAD_FORMAT_MSG });
    }
    const share = await get('SELECT * FROM shares WHERE token = ?', [token]);
    if (!share) return res.status(404).json({ error: SHARE_INVALID_MSG });
    if (share.disabled) return res.status(403).json({ error: SHARE_CLOSED_MSG });
    if (isExpired(share.expire_at)) return res.status(403).json({ error: SHARE_INVALID_MSG });

    const password = (req.body && req.body.password) || '';
    // 优先 share 级密码；否则若 type=work 且开启相册锁，则校验相册密码
    if (share.password_hash) {
      const ok = await bcrypt.compare(String(password), share.password_hash);
      if (!ok) {
        await logAccess(token, 'deny', null, req);
        return res.status(401).json({ error: '密码错误' });
      }
    } else if (share.type === 'work') {
      const w = await get('SELECT album_password_enabled, album_password FROM works WHERE id = ?', [share.ref_id]);
      const locked = w && Number(w.album_password_enabled) && w.album_password;
      if (locked) {
        const ok = await bcrypt.compare(String(password), w.album_password);
        if (!ok) {
          await logAccess(token, 'deny', 'album', req);
          return res.status(401).json({ error: '密码错误' });
        }
      }
    }

    const data = await buildPayload(share.type, share.ref_id);
    if (!data) return res.status(404).json({ error: SHARE_INVALID_MSG });
    await logAccess(token, 'view', 'password', req);
    res.json(envelope(share, data, false));
  } catch (e) {
    serverError(res, e);
  }
});

export default router;
