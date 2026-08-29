// routes/visitor.js —— 访客埋点模块（V2；B 端管理视角）
// visitor_log 访问日志 / visitor_blacklist 黑名单 / visitor_no_disturb 免打扰 / visitor_setting 访客密码
// H5 无微信环境，nickname/phone 恒为空，visitor_id 由浏览器 localStorage uuid 生成
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query, get, insert, run } from '../db.js';
import { authRequired } from '../auth.js';
import { serverError } from '../httpError.js';

const router = Router();
router.use(authRequired);

function toCsv(headers, rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const head = headers.map((h) => esc(h.label)).join(',');
  const body = rows.map((r) => headers.map((h) => esc(r[h.key])).join(',')).join('\n');
  return head + '\n' + body;
}

// 访客访问日志列表（分页 + 搜索 visitor_id；返回扁平日志，前端按日期分组）
router.get('/list', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
    const q = String(req.query.q || '').trim();
    const where = [];
    const params = [];
    if (q) { where.push('visitor_id LIKE ?'); params.push('%' + q + '%'); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = (await get(`SELECT COUNT(*) AS c FROM visitor_log ${whereSql}`, params)).c;
    const rows = await query(
      `SELECT vl.*,
         (SELECT COUNT(*) FROM visitor_blacklist b WHERE b.visitor_id = vl.visitor_id) > 0 AS is_blacklist,
         (SELECT COUNT(*) FROM visitor_no_disturb n WHERE n.visitor_id = vl.visitor_id) > 0 AS is_no_disturb
       FROM visitor_log vl ${whereSql} ORDER BY vl.created_at DESC, vl.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    );
    res.json({ list: rows, total: Number(total) || 0, page, pageSize });
  } catch (e) { serverError(res, e); }
});

// 导出全部访客记录（CSV，无条数限制）
router.get('/export', async (req, res) => {
  try {
    const rows = await query('SELECT visitor_id, visit_time, visit_page, source FROM visitor_log ORDER BY created_at DESC, id DESC');
    const headers = [
      { key: 'visitor_id', label: '访客ID' },
      { key: 'visit_time', label: '访问时间' },
      { key: 'visit_page', label: '访问页面' },
      { key: 'source', label: '来源' }
    ];
    const csv = toCsv(headers, rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="visitors.csv"');
    res.send('\uFEFF' + csv);
  } catch (e) { serverError(res, e); }
});

// 黑名单列表
router.get('/blacklist', async (req, res) => {
  try {
    const rows = await query(
      `SELECT b.visitor_id, b.created_at, (SELECT MAX(created_at) FROM visitor_log l WHERE l.visitor_id = b.visitor_id) AS last_visit
       FROM visitor_blacklist b ORDER BY b.created_at DESC`
    );
    res.json({ list: rows, count: rows.length });
  } catch (e) { serverError(res, e); }
});

// 加入黑名单
router.post('/blacklist', async (req, res) => {
  try {
    const vid = String((req.body && req.body.visitor_id) || '').trim();
    if (!vid) return res.status(400).json({ error: 'visitor_id 缺失' });
    const exists = await get('SELECT visitor_id FROM visitor_blacklist WHERE visitor_id = ?', [vid]);
    if (!exists) await insert('INSERT INTO visitor_blacklist (visitor_id) VALUES (?)', [vid]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// 移除黑名单
router.delete('/blacklist/:visitorId', async (req, res) => {
  try {
    await run('DELETE FROM visitor_blacklist WHERE visitor_id = ?', [req.params.visitorId]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// 免打扰列表
router.get('/no-disturb', async (req, res) => {
  try {
    const rows = await query(
      `SELECT n.visitor_id, n.created_at, (SELECT MAX(created_at) FROM visitor_log l WHERE l.visitor_id = n.visitor_id) AS last_visit
       FROM visitor_no_disturb n ORDER BY n.created_at DESC`
    );
    res.json({ list: rows, count: rows.length });
  } catch (e) { serverError(res, e); }
});

// 加入免打扰
router.post('/no-disturb', async (req, res) => {
  try {
    const vid = String((req.body && req.body.visitor_id) || '').trim();
    if (!vid) return res.status(400).json({ error: 'visitor_id 缺失' });
    const exists = await get('SELECT visitor_id FROM visitor_no_disturb WHERE visitor_id = ?', [vid]);
    if (!exists) await insert('INSERT INTO visitor_no_disturb (visitor_id) VALUES (?)', [vid]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// 移除免打扰
router.delete('/no-disturb/:visitorId', async (req, res) => {
  try {
    await run('DELETE FROM visitor_no_disturb WHERE visitor_id = ?', [req.params.visitorId]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// 访客密码状态
router.get('/password', async (req, res) => {
  try {
    const setting = await get('SELECT visitor_password FROM visitor_setting WHERE business_uid = 0');
    res.json({ enabled: !!(setting && setting.visitor_password) });
  } catch (e) { serverError(res, e); }
});

// 设置 / 清除访客密码（传空密码 = 关闭）
router.put('/password', async (req, res) => {
  try {
    const password = String((req.body && req.body.password) || '');
    const hash = password ? await bcrypt.hash(password, 10) : null;
    const exists = await get('SELECT business_uid FROM visitor_setting WHERE business_uid = 0');
    if (exists) await run('UPDATE visitor_setting SET visitor_password = ? WHERE business_uid = 0', [hash]);
    else await insert('INSERT INTO visitor_setting (business_uid, visitor_password) VALUES (0, ?)', [hash]);
    res.json({ ok: true, enabled: !!hash });
  } catch (e) { serverError(res, e); }
});

// 访客详情（完整访问轨迹 + 黑名单/免打扰状态）
router.get('/:visitorId', async (req, res) => {
  try {
    const vid = req.params.visitorId;
    const logs = await query('SELECT * FROM visitor_log WHERE visitor_id = ? ORDER BY created_at DESC, id DESC', [vid]);
    const bl = await get('SELECT visitor_id FROM visitor_blacklist WHERE visitor_id = ?', [vid]);
    const nd = await get('SELECT visitor_id FROM visitor_no_disturb WHERE visitor_id = ?', [vid]);
    res.json({ visitor_id: vid, is_blacklist: !!bl, is_no_disturb: !!nd, count: logs.length, logs });
  } catch (e) { serverError(res, e); }
});

export default router;
