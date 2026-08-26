// routes/media.js —— 自媒体工作台（灵感库 / 状态列 / 选题看板 / 草稿 / 分发记录 / 复盘 / 标签）
// 单人使用，无需权限细分（authRequired 即可）。
// 约定：JSON 字段（tags / pain_points / alt_titles / hashtags / image_ideas / material_ref / record_ids）
// 一律以字符串形式存取，读写处 JSON.parse/stringify，空值保护：null/undefined/'' → [] 或 null。
import { Router } from 'express';
import { query, get, run, insert } from '../db.js';
import { authRequired } from '../auth.js';

const router = Router();
router.use(authRequired);

// ---------- 工具 ----------
function jarr(v) {
  if (v == null || v === '') return [];
  try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch { return []; }
}
function jstr(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return JSON.stringify(v);
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}
function num(v, d = 0) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; }
function str(v, d = '') { return v == null ? d : String(v); }
function escLike(s) { return String(s).replace(/[\\%_]/g, (c) => '\\' + c); }

// 从动态参数中读标签数组（body.tags 可能是数组或 JSON 字符串）
function tagsOf(body) {
  const t = body.tags;
  if (t == null) return [];
  if (Array.isArray(t)) return t.map(String);
  try { const a = JSON.parse(t); return Array.isArray(a) ? a.map(String) : []; } catch { return []; }
}

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

// ---------- 状态列 ----------
// GET /api/media/status-columns
router.get('/status-columns', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM media_status_column ORDER BY sort ASC, id ASC');
    const cnt = await query('SELECT status_id, COUNT(*) AS c FROM media_topic WHERE deleted = 0 GROUP BY status_id');
    const cntMap = {};
    cnt.forEach((r) => { cntMap[String(r.status_id)] = Number(r.c); });
    res.json(rows.map((r) => ({ ...r, topicCount: cntMap[String(r.id)] || 0 })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/media/status-columns  { name }
router.post('/status-columns', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: '列名不能为空' });
    const last = await get('SELECT MAX(sort) AS m FROM media_status_column');
    const sort = (last && Number(last.m)) != null ? Number(last.m) + 1 : 0;
    const id = await insert('INSERT INTO media_status_column (name, sort, is_default) VALUES (?,?,0)', [name, sort]);
    res.json({ ok: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/media/status-columns/:id  { name }
router.put('/status-columns/:id', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: '列名不能为空' });
    await run('UPDATE media_status_column SET name = ? WHERE id = ?', [name, num(req.params.id)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/media/status-columns/order  { ids: [..] }  —— 拖拽调整列顺序
router.put('/status-columns/order', async (req, res) => {
  try {
    const ids = (req.body.ids || []).map((x) => Number(x)).filter((x) => Number.isFinite(x));
    for (let i = 0; i < ids.length; i++) await run('UPDATE media_status_column SET sort = ? WHERE id = ?', [i, ids[i]]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/media/status-columns/:id  —— 删除列，其下选题移动到第一个非归档列
router.delete('/status-columns/:id', async (req, res) => {
  try {
    const id = num(req.params.id);
    const first = await get('SELECT id FROM media_status_column WHERE id <> ? ORDER BY sort ASC, id ASC LIMIT 1', [id]);
    const fallback = first ? first.id : null;
    await run('UPDATE media_topic SET status_id = ? WHERE status_id = ? AND deleted = 0', [fallback, id]);
    await run('DELETE FROM media_status_column WHERE id = ?', [id]);
    res.json({ ok: true, fallback });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- 标签 ----------
// GET /api/media/tags  —— 列表 + 关联统计（灵感 + 选题）
router.get('/tags', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM media_tag ORDER BY id ASC');
    const ins = await query("SELECT tags FROM media_inspiration WHERE deleted = 0");
    const top = await query('SELECT tags FROM media_topic WHERE deleted = 0');
    const countOf = {};
    const inc = (tagId) => { countOf[String(tagId)] = (countOf[String(tagId)] || 0) + 1; };
    ins.forEach((r) => jarr(r.tags).forEach(inc));
    top.forEach((r) => jarr(r.tags).forEach(inc));
    res.json(rows.map((r) => ({ ...r, count: countOf[String(r.id)] || 0 })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/media/tags  { name, color? }
router.post('/tags', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: '标签名不能为空' });
    const ex = await get('SELECT id FROM media_tag WHERE name = ?', [name]);
    if (ex) return res.json({ ok: true, id: ex.id, existed: true });
    const id = await insert('INSERT INTO media_tag (name, color) VALUES (?,?)', [name, str(req.body.color, '#2DB7F5')]);
    res.json({ ok: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/media/tags/:id  { name?, color? }
router.put('/tags/:id', async (req, res) => {
  try {
    const id = num(req.params.id);
    const name = req.body.name != null ? String(req.body.name).trim() : null;
    if (name === '') return res.status(400).json({ error: '标签名不能为空' });
    if (name) await run('UPDATE media_tag SET name = ? WHERE id = ?', [name, id]);
    if (req.body.color != null) await run('UPDATE media_tag SET color = ? WHERE id = ?', [str(req.body.color), id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/media/tags/merge  { fromId, toId }  —— 合并：from 关联全部改指 to
router.post('/tags/merge', async (req, res) => {
  try {
    const fromId = String(num(req.body.fromId));
    const toId = String(num(req.body.toId));
    if (!fromId || !toId || fromId === toId) return res.status(400).json({ error: '合并参数无效' });
    const fromTag = await get('SELECT id FROM media_tag WHERE id = ?', [num(fromId)]);
    const toTag = await get('SELECT id FROM media_tag WHERE id = ?', [num(toId)]);
    if (!fromTag || !toTag) return res.status(400).json({ error: '标签不存在' });
    // 遍历灵感/选题的 tags JSON，把 fromId 替换成 toId 并去重
    for (const tbl of ['media_inspiration', 'media_topic']) {
      const rows = await query(`SELECT id, tags FROM ${tbl} WHERE tags IS NOT NULL AND tags <> '' AND deleted = 0`);
      for (const r of rows) {
        const arr = jarr(r.tags);
        const changed = arr.includes(fromId);
        const next = [...new Set(arr.map((t) => (String(t) === fromId ? toId : String(t))))];
        if (changed) await run(`UPDATE ${tbl} SET tags = ? WHERE id = ?`, [jstr(next), r.id]);
      }
    }
    await run('DELETE FROM media_tag WHERE id = ?', [num(fromId)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/media/tags/:id  —— 删除标签并清空关联
router.delete('/tags/:id', async (req, res) => {
  try {
    const id = String(num(req.params.id));
    for (const tbl of ['media_inspiration', 'media_topic']) {
      const rows = await query(`SELECT id, tags FROM ${tbl} WHERE tags IS NOT NULL AND tags <> '' AND deleted = 0`);
      for (const r of rows) {
        const arr = jarr(r.tags).filter((t) => String(t) !== id);
        await run(`UPDATE ${tbl} SET tags = ? WHERE id = ?`, [jstr(arr), r.id]);
      }
    }
    await run('DELETE FROM media_tag WHERE id = ?', [num(id)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- 灵感库 ----------
// GET /api/media/inspirations?search=&tag=&page=&pageSize=
router.get('/inspirations', async (req, res) => {
  try {
    const search = str(req.query.search).trim();
    const tag = String(req.query.tag || '').trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 50));
    const where = ['deleted = 0'];
    const params = [];
    if (search) { where.push('(title LIKE ? OR content LIKE ?)'); const lk = '%' + escLike(search) + '%'; params.push(lk, lk); }
    const whereSql = 'WHERE ' + where.join(' AND ');
    let total = (await get(`SELECT COUNT(*) AS c FROM media_inspiration ${whereSql}`, params)).c;
    let rows = await query(
      `SELECT * FROM media_inspiration ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    );
    // 标签筛选在内存做（标签存 JSON 数组，PG/SQLite 通用最简单路径）
    if (tag) {
      rows = rows.filter((r) => jarr(r.tags).includes(tag));
      total = (await query(`SELECT * FROM media_inspiration ${whereSql}`, params)).filter((r) => jarr(r.tags).includes(tag)).length;
    }
    res.json({ total, page, pageSize, list: rows.map(decorInspiration) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

function decorInspiration(r) {
  return {
    ...r,
    tags: jarr(r.tags),
    painPoints: jarr(r.pain_points),
    pain_strength: num(r.pain_strength, 3)
  };
}

// POST /api/media/inspirations/parse  { url } —— 抖音/小红书链接解析（标题 + 评论痛点）
// 说明：为遵守「禁止爬虫抓取平台数据」，不做自动抓取；根据链接结构解析标题语义，解析失败返回错误。
// 用户复制常不带 https:// 前缀（如微信分享 xhslink.cn/o/xxx），自动补协议后再次尝试。
router.post('/inspirations/parse', async (req, res) => {
  try {
    let url = String(req.body.url || '').trim();
    if (!url) return res.status(400).json({ error: '请先粘贴抖音 / 小红书链接' });
    let host = '';
    try { host = new URL(url).hostname; } catch {
        // 自动补 https:// 再试一次（兼容用户复制不带协议头的短链）
        try { url = 'https://' + url.replace(/^\/+/, ''); host = new URL(url).hostname; }
        catch { return res.status(400).json({ error: '链接格式无效，需以 http:// 或 https:// 开头的完整 URL' }); }
      }
    const isDouyin = /douyin\.com/.test(host) || /iesdouyin\.com/.test(host);
    const isXhs = /xiaohongshu\.com/.test(host) || /xhslink\.com/.test(host);
    if (!isDouyin && !isXhs) return res.status(400).json({ error: '仅支持抖音 / 小红书链接（当前域名：' + host + '）' });
    // 从 URL 中提取笔记/视频短 id 作为占位标题语义（不抓取正文）；兼容 explore/（小红书笔记直链）
    const m = url.match(/(?:note|video|discovery\/item|share\/video|explore)\/([A-Za-z0-9]+)/) || url.match(/\/video\/([A-Za-z0-9]+)/);
    const id = m ? m[1] : '';
    if (!id) return res.status(400).json({ error: '链接中未找到笔记 / 视频 ID，无法解析' });
    const platform = isXhs ? '小红书' : '抖音';
    const title = `【${platform}】待补充标题（ID: ${id}）`;
    res.json({ ok: true, source_type: isXhs ? 'xiaohongshu' : 'douyin', source_url: url, title, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/media/inspirations —— 新增灵感（title/content 至少其一）
router.post('/inspirations', async (req, res) => {
  try {
    const b = req.body || {};
    const title = String(b.title || '').trim();
    const content = String(b.content || '').trim();
    if (!title && !content) return res.status(400).json({ error: '标题和内容不能同时为空' });
    const id = await insert(
      `INSERT INTO media_inspiration (title, content, source_type, source_url, pain_points, pain_strength, tags, card_color)
       VALUES (?,?,?,?,?,?,?,?)`,
      [title, content, str(b.source_type, 'manual'), str(b.source_url), jstr(b.painPoints || b.pain_points), num(b.pain_strength, 3), jstr(tagsOf(b)), str(b.card_color, '#2DB7F5')]
    );
    res.json({ ok: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/media/inspirations/:id
router.put('/inspirations/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const title = String(b.title || '').trim();
    const content = String(b.content || '').trim();
    if (!title && !content) return res.status(400).json({ error: '标题和内容不能同时为空' });
    await run(
      `UPDATE media_inspiration SET title=?, content=?, source_type=?, source_url=?, pain_points=?, pain_strength=?, tags=?, card_color=? WHERE id=?`,
      [title, content, str(b.source_type, 'manual'), str(b.source_url), jstr(b.painPoints || b.pain_points), num(b.pain_strength, 3), jstr(tagsOf(b)), str(b.card_color, '#2DB7F5'), num(req.params.id)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/media/inspirations/:id
router.delete('/inspirations/:id', async (req, res) => {
  try { await run('UPDATE media_inspiration SET deleted = 1 WHERE id = ?', [num(req.params.id)]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/media/inspirations/:id/to-topic —— 一键复制生成选题（两份数据互相独立）
router.post('/inspirations/:id/to-topic', async (req, res) => {
  try {
    const ins = await get('SELECT * FROM media_inspiration WHERE id = ? AND deleted = 0', [num(req.params.id)]);
    if (!ins) return res.status(404).json({ error: '灵感不存在' });
    const firstCol = await get('SELECT id FROM media_status_column ORDER BY sort ASC, id ASC LIMIT 1');
    const topicId = await insert(
      `INSERT INTO media_topic (title, core_pain, status_id, card_color, inspiration_id, tags)
       VALUES (?,?,?,?,?,?)`,
      [ins.title || '未命名选题', ins.content || '', firstCol ? firstCol.id : null, ins.card_color || '#2DB7F5', ins.id, jstr(jarr(ins.tags))]
    );
    res.json({ ok: true, id: topicId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- 选题 ----------
function decorTopic(r) {
  let status_id = r.status_id != null ? Number(r.status_id) : null;
  const mt = { ...r, status_id, tags: jarr(r.tags), materialRef: null };
  try { mt.materialRef = r.material_ref ? JSON.parse(r.material_ref) : null; } catch { mt.materialRef = null; }
  return mt;
}

// GET /api/media/topics?includeArchived=1 —— 全量列表（前端按状态列分组）
router.get('/topics', async (req, res) => {
  try {
    const includeArchived = req.query.includeArchived === '1';
    const sql = includeArchived
      ? 'SELECT * FROM media_topic WHERE deleted = 0 ORDER BY sort ASC, id ASC'
      : `SELECT t.* FROM media_topic t JOIN media_status_column c ON t.status_id = c.id WHERE t.deleted = 0 AND c.name <> '归档' ORDER BY t.sort ASC, t.id ASC`;
    const rows = await query(sql);
    res.json(rows.map(decorTopic));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/media/topics/overview —— 首页待处理概览（过滤归档；高优先级优先，其次预计发布时间由近到远；最多 8 张）
router.get('/topics/overview', async (req, res) => {
  try {
    const rows = await query(
      `SELECT t.* FROM media_topic t JOIN media_status_column c ON t.status_id = c.id
       WHERE t.deleted = 0 AND c.name <> '归档'
       ORDER BY t.priority ASC, COALESCE(t.expect_publish_time, '9999-12-31') ASC, t.sort ASC, t.id ASC`
    );
    // priority 高优先在前（high<medium<low 按字典序正好 high<low<medium? 不，h<m<l 字典序是 high, low, medium）
    // 用显式优先级权重排序，保证 高 > 中 > 低
    const sorted = rows.slice().sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] != null ? PRIORITY_ORDER[a.priority] : 1;
      const pb = PRIORITY_ORDER[b.priority] != null ? PRIORITY_ORDER[b.priority] : 1;
      if (pa !== pb) return pa - pb;
      const ta = a.expect_publish_time || '9999-12-31';
      const tb = b.expect_publish_time || '9999-12-31';
      if (ta !== tb) return ta < tb ? -1 : 1;
      return (a.sort || 0) - (b.sort || 0);
    });
    res.json(sorted.slice(0, 8).map(decorTopic));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/media/topics/:id
router.get('/topics/:id', async (req, res) => {
  try {
    const r = await get('SELECT * FROM media_topic WHERE id = ? AND deleted = 0', [num(req.params.id)]);
    if (!r) return res.status(404).json({ error: '选题不存在' });
    res.json(decorTopic(r));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/media/topics —— 新建选题
router.post('/topics', async (req, res) => {
  try {
    const b = req.body || {};
    const title = String(b.title || '').trim();
    if (!title) return res.status(400).json({ error: '选题标题不能为空' });
    let statusId = b.status_id != null ? num(b.status_id) : null;
    // 未指定状态列 → 默认第一个状态列（保证在首页概览/看板可见）
    if (statusId == null) {
      const first = await get('SELECT id FROM media_status_column ORDER BY sort ASC, id ASC LIMIT 1');
      statusId = first ? first.id : null;
    }
    const maxSort = await get('SELECT MAX(sort) AS m FROM media_topic WHERE status_id = ? AND deleted = 0', [statusId]);
    const sort = (maxSort && maxSort.m != null) ? Number(maxSort.m) + 1 : 0;
    const id = await insert(
      `INSERT INTO media_topic (title, core_pain, target_platform, content_form, priority, expect_publish_time, reference_url,
        status_id, sort, card_color, material_ref, inspiration_id, tags)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [title, str(b.core_pain), str(b.target_platform), str(b.content_form), str(b.priority, 'medium'),
        str(b.expect_publish_time), str(b.reference_url), statusId, sort,
        str(b.card_color, '#2DB7F5'), b.material_ref ? jstr(b.material_ref) : null,
        b.inspiration_id != null ? num(b.inspiration_id) : null, jstr(tagsOf(b))]
    );
    res.json({ ok: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/media/topics/:id
router.put('/topics/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const title = String(b.title || '').trim();
    if (!title) return res.status(400).json({ error: '选题标题不能为空' });
    await run(
      `UPDATE media_topic SET title=?, core_pain=?, target_platform=?, content_form=?, priority=?, expect_publish_time=?,
        reference_url=?, card_color=?, material_ref=?, tags=? WHERE id=?`,
      [title, str(b.core_pain), str(b.target_platform), str(b.content_form), str(b.priority, 'medium'),
        str(b.expect_publish_time), str(b.reference_url), str(b.card_color, '#2DB7F5'),
        b.material_ref ? jstr(b.material_ref) : null, jstr(tagsOf(b)), num(req.params.id)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/media/topics/:id/status —— 拖拽换列 { status_id, sort? }
router.put('/topics/:id/status', async (req, res) => {
  try {
    const id = num(req.params.id);
    const statusId = num(req.body.status_id);
    const col = await get('SELECT id FROM media_status_column WHERE id = ?', [statusId]);
    if (!col) return res.status(400).json({ error: '目标状态列不存在' });
    let sort = req.body.sort != null ? num(req.body.sort) : null;
    if (sort == null) {
      const maxSort = await get('SELECT MAX(sort) AS m FROM media_topic WHERE status_id = ? AND deleted = 0', [statusId]);
      sort = (maxSort && maxSort.m != null) ? Number(maxSort.m) + 1 : 0;
    }
    await run('UPDATE media_topic SET status_id = ?, sort = ? WHERE id = ?', [statusId, sort, id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/media/topics/:id/sort —— 同列内排序 { sort }
router.put('/topics/:id/sort', async (req, res) => {
  try {
    await run('UPDATE media_topic SET sort = ? WHERE id = ?', [num(req.body.sort), num(req.params.id)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/media/topics/:id
router.delete('/topics/:id', async (req, res) => {
  try {
    const id = num(req.params.id);
    await run('UPDATE media_topic SET deleted = 1 WHERE id = ?', [id]);
    await run('DELETE FROM media_draft WHERE topic_id = ?', [id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- 草稿（单选题最多 5 版，超出自动删最旧） ----------
// GET /api/media/drafts?topic_id=
router.get('/drafts', async (req, res) => {
  try {
    const topicId = num(req.query.topic_id);
    const rows = await query('SELECT * FROM media_draft WHERE topic_id = ? ORDER BY version ASC', [topicId]);
    res.json(rows.map((r) => ({
      ...r,
      alt_titles: jarr(r.alt_titles),
      hashtags: jarr(r.hashtags),
      image_ideas: jarr(r.image_ideas)
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/media/drafts —— 保存草稿 { topic_id, content, alt_titles?, hashtags?, image_ideas? }
router.post('/drafts', async (req, res) => {
  try {
    const b = req.body || {};
    const topicId = num(b.topic_id);
    if (!topicId) return res.status(400).json({ error: '缺少选题' });
    const topic = await get('SELECT id FROM media_topic WHERE id = ? AND deleted = 0', [topicId]);
    if (!topic) return res.status(404).json({ error: '选题不存在' });
    const maxV = await get('SELECT MAX(version) AS m FROM media_draft WHERE topic_id = ?', [topicId]);
    const version = (maxV && maxV.m != null) ? Number(maxV.m) + 1 : 1;
    const id = await insert(
      `INSERT INTO media_draft (topic_id, version, content, alt_titles, hashtags, image_ideas) VALUES (?,?,?,?,?,?)`,
      [topicId, version, str(b.content), jstr(b.alt_titles), jstr(b.hashtags), jstr(b.image_ideas)]
    );
    // 最多保留 5 版：删除最旧的（版本号最小）
    const all = await query('SELECT id, version FROM media_draft WHERE topic_id = ? ORDER BY version ASC', [topicId]);
    if (all.length > 5) {
      const del = all.slice(0, all.length - 5);
      for (const d of del) await run('DELETE FROM media_draft WHERE id = ?', [d.id]);
    }
    res.json({ ok: true, id, version });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/media/drafts/:id —— 覆盖单版（编辑器回退后编辑）
router.put('/drafts/:id', async (req, res) => {
  try {
    const b = req.body || {};
    await run('UPDATE media_draft SET content=?, alt_titles=?, hashtags=?, image_ideas=? WHERE id=?',
      [str(b.content), jstr(b.alt_titles), jstr(b.hashtags), jstr(b.image_ideas), num(req.params.id)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/media/drafts/:id
router.delete('/drafts/:id', async (req, res) => {
  try { await run('DELETE FROM media_draft WHERE id = ?', [num(req.params.id)]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- 分发记录 ----------
// GET /api/media/publish-records?topic_id=
router.get('/publish-records', async (req, res) => {
  try {
    const topicId = req.query.topic_id ? num(req.query.topic_id) : null;
    const rows = topicId
      ? await query('SELECT * FROM media_publish_record WHERE topic_id = ? ORDER BY COALESCE(publish_time, created_at) DESC, id DESC', [topicId])
      : await query('SELECT * FROM media_publish_record ORDER BY COALESCE(publish_time, created_at) DESC, id DESC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/media/publish-records
router.post('/publish-records', async (req, res) => {
  try {
    const b = req.body || {};
    if (!str(b.publish_url) && !str(b.platform)) return res.status(400).json({ error: '请填写发布平台或发布链接' });
    const id = await insert(
      `INSERT INTO media_publish_record (topic_id, platform, publish_url, publish_time, likes, favorites, comments, inquiries, note)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [b.topic_id != null ? num(b.topic_id) : null, str(b.platform), str(b.publish_url), str(b.publish_time),
        num(b.likes), num(b.favorites), num(b.comments), num(b.inquiries), str(b.note)]
    );
    res.json({ ok: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/media/publish-records/:id
router.put('/publish-records/:id', async (req, res) => {
  try {
    const b = req.body || {};
    await run(
      `UPDATE media_publish_record SET topic_id=?, platform=?, publish_url=?, publish_time=?, likes=?, favorites=?, comments=?, inquiries=?, note=? WHERE id=?`,
      [b.topic_id != null ? num(b.topic_id) : null, str(b.platform), str(b.publish_url), str(b.publish_time),
        num(b.likes), num(b.favorites), num(b.comments), num(b.inquiries), str(b.note), num(req.params.id)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/media/publish-records/:id
router.delete('/publish-records/:id', async (req, res) => {
  try { await run('DELETE FROM media_publish_record WHERE id = ?', [num(req.params.id)]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- 复盘报告 ----------
// GET /api/media/reviews
router.get('/reviews', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM media_review ORDER BY id DESC');
    res.json(rows.map((r) => ({ ...r, record_ids: jarr(r.record_ids), pain_points: jarr(r.pain_points) })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/media/reviews —— 生成复盘 { record_ids: [..], content }
router.post('/reviews', async (req, res) => {
  try {
    const b = req.body || {};
    const ids = (b.record_ids || []).map((x) => Number(x)).filter((x) => Number.isFinite(x));
    if (!ids.length) return res.status(400).json({ error: '请先勾选已发布的分发记录' });
    if (!str(b.content)) return res.status(400).json({ error: '复盘内容不能为空' });
    const id = await insert('INSERT INTO media_review (record_ids, content, pain_points) VALUES (?,?,?)',
      [jstr(ids), str(b.content), jstr(b.pain_points)]);
    res.json({ ok: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/media/reviews/:id
router.delete('/reviews/:id', async (req, res) => {
  try { await run('DELETE FROM media_review WHERE id = ?', [num(req.params.id)]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/media/reviews/:id/backflow —— 回流：复盘识别出的痛点生成新灵感 + 「高转化」标签
router.post('/reviews/:id/backflow', async (req, res) => {
  try {
    const rev = await get('SELECT * FROM media_review WHERE id = ?', [num(req.params.id)]);
    if (!rev) return res.status(404).json({ error: '复盘报告不存在' });
    const pains = jarr(rev.pain_points);
    if (!pains.length) return res.status(400).json({ error: '该复盘没有可回流的痛点' });
    // 确保「高转化」标签存在
    let tag = await get('SELECT id FROM media_tag WHERE name = ?', ['高转化']);
    let tagId = tag ? tag.id : await insert('INSERT INTO media_tag (name, color) VALUES (?,?)', ['高转化', '#FF8F1F']);
    let created = 0;
    for (const p of pains) {
      const title = String(p.title || p).trim();
      if (!title) continue;
      const id = await insert(
        'INSERT INTO media_inspiration (title, content, source_type, pain_points, pain_strength, tags, card_color) VALUES (?,?,?,?,?,?,?)',
        [title, str(p.content || ''), 'backflow', jstr([String(p.content || '')]), 4, jstr([String(tagId)]), '#FF8F1F']
      );
      if (id) created++;
    }
    res.json({ ok: true, created, tagId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
