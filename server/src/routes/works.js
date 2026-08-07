// routes/works.js —— 作品管理（对标拾光盒子【客片/在线选片】核心）
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query, get, insert, run } from '../db.js';
import { parseRow } from '../schema.js';
import { authRequired, hashPassword, peekUser } from '../auth.js';
import { buildWorkAlbum, albumLockState } from './share.js';
import { deleteFromR2 } from '../storage.js';

const router = Router();

// 去掉相册密码明文（仅留「是否已设置」标记），避免任何接口把哈希返回给前端
function safeWork(w) {
  if (!w) return w;
  const { album_password, ...rest } = w;
  return { ...rest, album_password_set: !!album_password };
}

// 规范化多分类入参：数组或逗号字符串 → 逗号分隔字符串（去空、保序）。空值返回 ''。
function normalizeCategoryIds(v) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean).join(',');
  if (typeof v === 'string') return v.split(',').map((x) => x.trim()).filter(Boolean).join(',');
  return '';
}

// 解析并校验相册级配置（自定义文案 / 密码开关 / 6 位数字密码 / 可选有效期）
// existingHash：更新时传入旧密码哈希——前端未传新密码则沿用旧值；新建时为 null。
// 校验失败抛出带中文说明的错误，由调用方转成 400。
async function resolveAlbumFields(b, existingHash) {
  const album_copy = b.album_copy != null ? String(b.album_copy) : '';
  const enabled = b.album_password_enabled ? 1 : 0;
  let album_password = existingHash || null;
  const pw = b.album_password != null ? String(b.album_password) : '';
  if (pw) {
    if (!/^\d{6}$/.test(pw)) throw new Error('相册密码必须是 6 位数字');
    album_password = await hashPassword(pw); // bcrypt 哈希存储，绝不存明文
  }
  if (enabled && !album_password) {
    throw new Error('开启相册密码保护前，请先设置 6 位数字密码');
  }
  let album_expires_at = b.album_expires_at || null;
  if (album_expires_at) {
    const exp = new Date(album_expires_at).getTime();
    if (Number.isNaN(exp)) throw new Error('相册有效期格式不正确');
    // 原样保留（date 输入 YYYY-MM-DD 可直接回显），仅做可解析性校验
    album_expires_at = String(album_expires_at);
  }
  return { album_copy, album_password_enabled: enabled, album_password, album_expires_at };
}

// 列表（筛选 + 分页 + Tab 记忆所需参数）
// query: category, q(搜索标题/客户), is_public(0/1), page, pageSize
router.get('/', async (req, res) => {
  try {
    const { category, q, is_public, page = 1, pageSize = 12 } = req.query;
    const where = [];
    const params = [];
    if (category) {
      where.push(`(category_id = ? OR ',' || COALESCE(category_ids,'') || ',' LIKE '%,' || ? || ',%')`);
      params.push(category, category);
    }
    if (is_public !== undefined && is_public !== '') { where.push('is_public = ?'); params.push(is_public); }
    if (q) { where.push('(title LIKE ? OR customer_name LIKE ?)'); params.push('%' + q + '%', '%' + q + '%'); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = (await get('SELECT COUNT(*) AS c FROM works ' + w, params)).c;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(pageSize);
    const rows = await query(
      'SELECT * FROM works ' + w + ' ORDER BY id DESC LIMIT ? OFFSET ?',
      [...params, parseInt(pageSize), offset]
    );
    const items = rows.map((r) => safeWork(parseRow(r, ['tags'])));
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
    if (category) {
      where.push(`(w.category_id = ? OR ',' || COALESCE(w.category_ids,'') || ',' LIKE '%,' || ? || ',%')`);
      params.push(category, category);
    }
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

// 公开作品相册（沉浸式电子相册数据，无需登录）—— C 端小程序作品详情「查看相册」直连
router.get('/public/:id/album', async (req, res) => {
  try {
    const w = await get('SELECT * FROM works WHERE id = ? AND is_public = 1', [req.params.id]);
    if (!w) return res.status(404).json({ error: '作品不存在或未公开' });
    const isStaff = !!peekUser(req); // 商家后台进入 → 跳过相册密码锁
    const lock = await albumLockState(w.id);
    if (lock.enabled && !isStaff) {
      if (lock.expired) return res.status(403).json({ error: '该相册已过期' });
      // 相册锁：返回 locked 信封，不含 gallery
      return res.json({ locked: true, albumLock: true, workId: w.id });
    }
    const gallery = await buildWorkAlbum(w.id);
    if (!gallery) return res.status(404).json({ error: '作品相册不存在' });
    res.json({ gallery });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 公开作品相册解锁：校验相册密码后返回 gallery（C 端小程序/H5 访客输入密码后调用）
router.post('/public/:id/album/verify', async (req, res) => {
  try {
    const w = await get('SELECT * FROM works WHERE id = ? AND is_public = 1', [req.params.id]);
    if (!w) return res.status(404).json({ error: '作品不存在或未公开' });
    const lock = await albumLockState(w.id);
    if (!lock.enabled) {
      // 未开启密码：直接返回 gallery（无需解锁）
      const gallery = await buildWorkAlbum(w.id);
      return res.json({ gallery });
    }
    if (lock.expired) return res.status(403).json({ error: '该相册已过期' });
    const password = (req.body && req.body.password) || '';
    const ok = w.album_password ? await bcrypt.compare(String(password), w.album_password) : false;
    if (!ok) return res.status(401).json({ error: '密码错误' });
    const gallery = await buildWorkAlbum(w.id);
    if (!gallery) return res.status(404).json({ error: '作品相册不存在' });
    res.json({ gallery });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 详情（含相册三分区 + 最新选片）
router.get('/:id', async (req, res) => {
  try {
    const w = await get('SELECT * FROM works WHERE id = ?', [req.params.id]);
    if (!w) return res.status(404).json({ error: '作品不存在' });
    const work = safeWork(parseRow(w, ['tags']));
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
    let album;
    try { album = await resolveAlbumFields(b, null); }
    catch (err) { return res.status(400).json({ error: err.message }); }
    const categoryIds = normalizeCategoryIds(b.category_ids);
    const categoryId = categoryIds ? Number(categoryIds.split(',')[0]) : (b.category_id || null);
    const id = await insert(
      'INSERT INTO works (title, category_id, category_ids, is_public, is_private, cover_url, description, blessing, tags, live, customer_name, order_id, allow_download, album_copy, album_password_enabled, album_password, album_expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [
        b.title, categoryId, categoryIds, b.is_public ? 1 : 0, b.is_private ? 1 : 0,
        b.cover_url || '', b.description || '', b.blessing || '',
        JSON.stringify(b.tags || []), b.live ? 1 : 0, b.customer_name || '', b.order_id || null, b.allow_download ? 1 : 0,
        album.album_copy, album.album_password_enabled, album.album_password, album.album_expires_at
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
    const existing = await get('SELECT album_password FROM works WHERE id = ?', [req.params.id]);
    let album;
    try { album = await resolveAlbumFields(b, existing ? existing.album_password : null); }
    catch (err) { return res.status(400).json({ error: err.message }); }
    const categoryIds = normalizeCategoryIds(b.category_ids);
    const categoryId = categoryIds ? Number(categoryIds.split(',')[0]) : (b.category_id || null);
    await run(
      `UPDATE works SET title=?, category_id=?, category_ids=?, is_public=?, is_private=?, cover_url=?, description=?, blessing=?, tags=?, live=?, customer_name=?, order_id=?, allow_download=?, album_copy=?, album_password_enabled=?, album_password=?, album_expires_at=? WHERE id=?`,
      [
        b.title, categoryId, categoryIds, b.is_public ? 1 : 0, b.is_private ? 1 : 0,
        b.cover_url || '', b.description || '', b.blessing || '',
        JSON.stringify(b.tags || []), b.live ? 1 : 0, b.customer_name || '', b.order_id || null, b.allow_download ? 1 : 0,
        album.album_copy, album.album_password_enabled, album.album_password, album.album_expires_at, req.params.id
      ]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 删除
router.delete('/:id', authRequired, async (req, res) => {
  const workId = req.params.id;
  try {
    // 1) 先读相册 URL（用于后续清理 R2）
    const rows = await query('SELECT photo_url FROM albums WHERE work_id = ?', [workId]);

    // 2) 先删子表，再删主表；避免未来加外键时冲突，也更符合常理
    await run('DELETE FROM albums WHERE work_id = ?', [workId]);
    await run('DELETE FROM selections WHERE work_id = ?', [workId]);
    await run('DELETE FROM works WHERE id = ?', [workId]);

    // 3) 异步清理 R2 对象；失败只记录日志，不阻塞数据库删除
    const r2Tasks = rows
      .filter((r) => r.photo_url && typeof r.photo_url === 'string' && r.photo_url.trim())
      .map((r) =>
        deleteFromR2(r.photo_url.trim()).catch((err) =>
          console.error('[works] 删除 R2 对象失败', r.photo_url, err && err.message)
        )
      );
    await Promise.all(r2Tasks);

    res.json({ ok: true });
  } catch (e) {
    console.error('[works] 删除作品失败 id=' + workId, e);
    res.status(500).json({ error: e.message || '删除失败' });
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
// 入参二选一：
//   items: [{ url, originalName?, size? }]  —— 携带去重签名元数据（推荐）
//   urls:  [url, ...]                        —— 仅 URL（旧调用 / 兼容）
router.post('/:id/albums', authRequired, async (req, res) => {
  try {
    let items = req.body.items;
    const zone = req.body.zone || 'sample';
    if (!Array.isArray(items)) {
      const urls = req.body.urls;
      if (!Array.isArray(urls) || !urls.length) return res.status(400).json({ error: 'urls / items 数组不能为空' });
      items = urls.map((u) => (typeof u === 'string' ? { url: u } : u));
    }
    if (!items.length) return res.status(400).json({ error: 'items 数组不能为空' });
    // 取当前最大 sort，追加到末尾
    const max = await get('SELECT COALESCE(MAX(sort), -1) AS m FROM albums WHERE work_id = ? AND zone = ?', [req.params.id, zone]);
    let sort = (max.m ?? -1) + 1;
    const inserted = [];
    // 相册分区 → Worker type 枚举（与前端 ZONE_CAT 对齐）
    const ZONE_TYPE = { sample: 'client', local: 'negative', final: 'retouched' };
    const ZONE_PUB = { sample: true, local: false, final: false };
    for (const it of items) {
      const url = typeof it === 'string' ? it : it.url;
      if (!url) continue;
      const originalName = (it && it.originalName != null) ? String(it.originalName) : null;
      const originalSize = (it && it.size != null) ? Number(it.size) : null;
      // 同步上传模式：图片已由上传接口（/api/upload*）同步完成存储+hash+媒资登记，
      // 相册直接以 normal 状态落库，不再有 processing/失败态、不再依赖异步队列。
      const id = await insert(
        'INSERT INTO albums (work_id, zone, photo_url, thumb_url, sort, original_name, original_size, status) VALUES (?,?,?,?,?,?,?,?)',
        [req.params.id, zone, url, url, sort++, originalName, originalSize, 'normal']
      );
      inserted.push(id);
    }
    res.json({ ok: true, ids: inserted });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 去重签名列表：传入相册（作品）ID，返回该相册全部已上传图片签名数组
// 签名 key = `${original_name}_${original_size}`；小程序端 original_name 为文件 digest。
router.get('/:id/albums/exist-signs', authRequired, async (req, res) => {
  try {
    const rows = await query(
      'SELECT original_name, original_size FROM albums WHERE work_id = ? AND original_name IS NOT NULL',
      [req.params.id]
    );
    const existSignList = rows
      .filter((r) => r.original_name)
      .map((r) => `${r.original_name}_${r.original_size != null ? r.original_size : ''}`);
    res.json({ existSignList });
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

// 批量拖拽排序：接收当前分区照片 id 的有序数组，按顺序重写 sort
router.post('/:id/albums/reorder', authRequired, async (req, res) => {
  try {
    const { orders, zone = 'sample' } = req.body;
    if (!Array.isArray(orders) || !orders.length) return res.status(400).json({ error: 'orders 数组不能为空' });
    // 校验所有权：这些照片必须属于该作品且属于同一分区
    const placeholders = orders.map(() => '?').join(',');
    const rows = await query(`SELECT id FROM albums WHERE work_id = ? AND zone = ? AND id IN (${placeholders})`, [req.params.id, zone, ...orders]);
    const valid = new Set(rows.map((r) => r.id));
    for (const id of orders) if (!valid.has(id)) return res.status(400).json({ error: '存在非法照片 id' });
    // 按传入顺序更新 sort
    for (let i = 0; i < orders.length; i++) {
      await run('UPDATE albums SET sort = ? WHERE id = ?', [i, orders[i]]);
    }
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
