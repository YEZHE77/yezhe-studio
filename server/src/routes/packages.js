// routes/packages.js —— 套系管理（CRUD / 增值定价 / 营销绑定 / 上下架 / 订单溯源）
import { Router } from 'express';
import { query, get, insert, run } from '../db.js';
import { authRequired, requireRole } from '../auth.js';
import { parseRow } from '../schema.js';

const router = Router();
const JSON_COLS = ['addons', 'marketing', 'questionnaire', 'specs', 'details'];

// 列表（状态筛选 + 分类筛选 + 搜索）
router.get('/', authRequired, async (req, res) => {
  try {
    const { status, q, category } = req.query;
    const where = [];
    const params = [];
    if (status && status !== 'all') { where.push('status = ?'); params.push(status); }
    if (category) { where.push('category_id = ?'); params.push(category); }
    if (q) { where.push('(name LIKE ? OR description LIKE ?)'); params.push('%' + q + '%', '%' + q + '%'); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = await query('SELECT * FROM packages ' + w + ' ORDER BY sort ASC, id DESC', params);
    res.json(rows.map((r) => parseRow(r, JSON_COLS)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== 公开接口（C 端小程序，无需登录）=====
// 公开套系列表（仅 status='on'）
router.get('/public', async (req, res) => {
  try {
    const { q, category } = req.query;
    const where = ["status = 'on'"];
    const params = [];
    if (category) { where.push('category_id = ?'); params.push(category); }
    if (q) { where.push('(name LIKE ? OR description LIKE ?)'); params.push('%' + q + '%', '%' + q + '%'); }
    const w = 'WHERE ' + where.join(' AND ');
    const rows = await query('SELECT * FROM packages ' + w + ' ORDER BY sort ASC, id DESC', params);
    res.json(rows.map((r) => parseRow(r, JSON_COLS)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 公开套系详情
router.get('/public/:id', async (req, res) => {
  try {
    const r = await get("SELECT * FROM packages WHERE id = ? AND status = 'on'", [req.params.id]);
    if (!r) return res.status(404).json({ error: '套系不存在或未上架' });
    res.json(parseRow(r, JSON_COLS));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 导出 Excel 备份（CSV，UTF-8 BOM，Excel 原生可开）—— 须置于 /:id 之前避免被拦截
router.get('/export', authRequired, requireRole(['admin', 'photographer']), async (req, res) => {
  try {
    const rows = await query('SELECT * FROM packages ORDER BY sort ASC, id DESC');
    const header = ['ID', '套系名称', '价格', '定金', '分类ID', '状态', '精修张数', '底片政策', '拍摄时长', '上架', '描述', '增值项', '营销', '问卷', '多规格'];
    const esc = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [header.join(',')];
    for (const r of rows) {
      let addons = '', marketing = '', questionnaire = '', specs = '';
      try { addons = JSON.stringify(JSON.parse(r.addons || '[]')); } catch {}
      try { marketing = JSON.stringify(JSON.parse(r.marketing || '{}')); } catch {}
      try { questionnaire = JSON.stringify(JSON.parse(r.questionnaire || '')); } catch {}
      try { specs = JSON.stringify(JSON.parse(r.specs || '[]')); } catch {}
      lines.push([
        r.id, r.name, r.price, r.deposit, r.category_id, r.status, r.retouch_count,
        r.raw_policy, r.duration, r.status === 'on' ? '是' : '否', r.description, addons, marketing, questionnaire, specs
      ].map(esc).join(','));
    }
    const csv = '﻿' + lines.join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="packages-backup.csv"');
    res.send(csv);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 详情
router.get('/:id', authRequired, async (req, res) => {
  try {
    const r = await get('SELECT * FROM packages WHERE id = ?', [req.params.id]);
    if (!r) return res.status(404).json({ error: '套系不存在' });
    res.json(parseRow(r, JSON_COLS));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 订单溯源：引用该套系的订单
router.get('/:id/orders', authRequired, async (req, res) => {
  try {
    const rows = await query(
      `SELECT id, order_no, customer_name, status, total_amount, paid_amount, shoot_date, created_at
       FROM orders WHERE package_id = ? ORDER BY id DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 创建
router.post('/', authRequired, requireRole(['admin', 'photographer']), async (req, res) => {
  try {
    const b = req.body;
    const details = (b.details && typeof b.details === 'object') ? b.details : {};
    // 与既有 questionnaire 文本列保持兼容：4-Tab 页面把问卷模板放在 details.questionnaire
    const questionnaire = Array.isArray(details.questionnaire)
      ? JSON.stringify(details.questionnaire)
      : (b.questionnaire || '');
    const id = await insert(
      `INSERT INTO packages (name, price, category_id, cover_url, description, addons, marketing, status, sort, deposit, retouch_count, raw_policy, duration, questionnaire, specs, details)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        b.name || '未命名套系', parseFloat(b.price) || 0, b.category_id || null,
        b.cover_url || '', b.description || '',
        JSON.stringify(b.addons || []), JSON.stringify(b.marketing || {}),
        b.status || 'on', parseInt(b.sort) || 0,
        parseFloat(b.deposit) || 0, parseInt(b.retouch_count) || 0,
        b.raw_policy || '', b.duration || '', questionnaire,
        JSON.stringify(sanitizeSpecs(b.specs)), JSON.stringify(details)
      ]
    );
    res.json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 更新
router.put('/:id', authRequired, requireRole(['admin', 'photographer']), async (req, res) => {
  try {
    const b = req.body;
    const cur = await get('SELECT * FROM packages WHERE id = ?', [req.params.id]);
    if (!cur) return res.status(404).json({ error: '套系不存在' });
    // 数值字段：前端未传或传空字符串时，回退到当前值，避免 NaN 进数据库
    const toFloat = (v, fallback) => (v === '' || v === null || v === undefined || Number.isNaN(parseFloat(v))) ? fallback : parseFloat(v);
    const toInt = (v, fallback) => (v === '' || v === null || v === undefined || Number.isNaN(parseInt(v, 10))) ? fallback : parseInt(v, 10);
    const curDetails = parseRow(cur, JSON_COLS).details || {};
    const details = (b.details && typeof b.details === 'object') ? b.details : curDetails;
    const questionnaire = Array.isArray(details.questionnaire)
      ? JSON.stringify(details.questionnaire)
      : (b.questionnaire ?? cur.questionnaire);
    await run(
      `UPDATE packages SET name=?, price=?, category_id=?, cover_url=?, description=?, addons=?, marketing=?, status=?, sort=?, deposit=?, retouch_count=?, raw_policy=?, duration=?, questionnaire=?, specs=?, details=?
       WHERE id=?`,
      [
        b.name ?? cur.name, toFloat(b.price, cur.price), b.category_id ?? cur.category_id,
        b.cover_url ?? cur.cover_url, b.description ?? cur.description,
        JSON.stringify(b.addons ?? (cur.addons ? JSON.parse(cur.addons) : [])),
        JSON.stringify(b.marketing ?? (cur.marketing ? JSON.parse(cur.marketing) : {})),
        b.status ?? cur.status, toInt(b.sort, cur.sort),
        toFloat(b.deposit, cur.deposit), toInt(b.retouch_count, cur.retouch_count),
        b.raw_policy ?? cur.raw_policy, b.duration ?? cur.duration, questionnaire,
        JSON.stringify(sanitizeSpecs(b.specs ?? (cur.specs ? JSON.parse(cur.specs) : []))),
        JSON.stringify(details),
        req.params.id
      ]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 多规格清洗：过滤无效项，补齐字段与 id
function sanitizeSpecs(specs) {
  if (!Array.isArray(specs)) return [];
  return specs
    .filter((s) => s && (s.name || '').trim())
    .map((s, i) => ({
      id: s.id || 's' + (i + 1) + '_' + Date.now(),
      name: (s.name || '').trim(),
      price: parseFloat(s.price) || 0,
      deposit: parseFloat(s.deposit) || 0,
      addons: Array.isArray(s.addons) ? s.addons : [],
      duration: s.duration || '',
      raw_policy: s.raw_policy || '',
      remark: s.remark || ''
    }));
}

// 复制套系快速新建（克隆基础信息，状态置下架避免误发）
router.post('/:id/duplicate', authRequired, requireRole(['admin', 'photographer']), async (req, res) => {
  try {
    const cur = await get('SELECT * FROM packages WHERE id = ?', [req.params.id]);
    if (!cur) return res.status(404).json({ error: '套系不存在' });
    const c = parseRow(cur, JSON_COLS);
    const id = await insert(
      `INSERT INTO packages (name, price, category_id, cover_url, description, addons, marketing, status, sort, deposit, retouch_count, raw_policy, duration, questionnaire, specs, details)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        c.name + ' 副本', c.price, c.category_id, c.cover_url, c.description,
        JSON.stringify(c.addons || []), JSON.stringify(c.marketing || {}),
        'off', (parseInt(c.sort) || 0) + 1,
        c.deposit || 0, c.retouch_count || 0, c.raw_policy || '', c.duration || '',
        JSON.stringify(c.questionnaire || ''), JSON.stringify(c.specs || []),
        JSON.stringify(c.details || {})
      ]
    );
    res.json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 排序上下移动（dir: up=提前 / down=置后）
router.post('/:id/move', authRequired, requireRole(['admin', 'photographer']), async (req, res) => {
  try {
    const dir = (req.body && req.body.dir) === 'down' ? 'down' : 'up';
    const cur = await get('SELECT * FROM packages WHERE id = ?', [req.params.id]);
    if (!cur) return res.status(404).json({ error: '套系不存在' });
    const rows = await query('SELECT id, sort FROM packages ORDER BY sort ASC, id DESC');
    const idx = rows.findIndex((r) => r.id === cur.id);
    if (idx < 0) return res.status(404).json({ error: '套系不存在' });
    const swap = dir === 'up' ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= rows.length) return res.json({ ok: true });
    const a = rows[idx], b = rows[swap];
    await run('UPDATE packages SET sort = ? WHERE id = ?', [b.sort, a.id]);
    await run('UPDATE packages SET sort = ? WHERE id = ?', [a.sort, b.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 统计该套系被多少订单引用（package_id 关联 或 历史快照 package_snapshot 内含该 id）
async function usedByOrders(pkgId) {
  const id = Number(pkgId);
  const row = await get(
    `SELECT COUNT(*) AS c FROM orders WHERE package_id = ? OR COALESCE(package_snapshot, '') LIKE ?`,
    [id, '%"id":' + id + ',%']
  );
  return Number(row && row.c) || 0;
}

// 引用检查（前端据此禁用删除按钮 / 提示改为下架）
router.get('/:id/usage', authRequired, async (req, res) => {
  try {
    const count = await usedByOrders(req.params.id);
    res.json({ count, deletable: count === 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 下架 / 上架（下架后 C 端不可见，后台手动录单仍可选 —— 底层强制规则 3）
router.post('/:id/status', authRequired, requireRole(['admin', 'photographer']), async (req, res) => {
  try {
    const cur = await get('SELECT * FROM packages WHERE id = ?', [req.params.id]);
    if (!cur) return res.status(404).json({ error: '套系不存在' });
    const status = (req.body && req.body.status) === 'on' ? 'on' : 'off';
    await run('UPDATE packages SET status = ? WHERE id = ?', [status, cur.id]);
    res.json({ ok: true, status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 批量上架 / 下架（spec：支持批量上下架；下架不删除数据，C 端隐藏、后台录单仍可选）
router.post('/batch-status', authRequired, requireRole(['admin', 'photographer']), async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids)
      ? [...new Set(req.body.ids.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))]
      : [];
    const status = (req.body && req.body.status) === 'on' ? 'on' : 'off';
    if (!ids.length) return res.status(400).json({ error: '请先勾选要操作的套系' });
    const ph = ids.map(() => '?').join(',');
    await run(`UPDATE packages SET status = ? WHERE id IN (${ph})`, [status, ...ids]);
    res.json({ ok: true, updated: ids.length, status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 删除（仅 admin）—— 已被订单关联的套系禁止物理删除，只能下架隐藏（底层强制规则 3 / 验收②）
router.delete('/:id', authRequired, requireRole(['admin']), async (req, res) => {
  try {
    const cur = await get('SELECT * FROM packages WHERE id = ?', [req.params.id]);
    if (!cur) return res.status(404).json({ error: '套系不存在' });
    const count = await usedByOrders(cur.id);
    if (count > 0) {
      return res.status(400).json({
        error: `该套系已关联 ${count} 个订单，无法删除，请改为「下架」隐藏`,
        code: 'PACKAGE_IN_USE', count, suggest: 'off'
      });
    }
    await run('DELETE FROM packages WHERE id = ?', [cur.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
