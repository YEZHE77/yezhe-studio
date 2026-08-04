// routes/schedules.js —— 档期管理（日历 / 冲突拦截 / 团队派单 / 订单双向联动 / 锁场）
import { Router } from 'express';
import { query, get, insert, run } from '../db.js';
import { authRequired, requireRole } from '../auth.js';

const router = Router();

// 列表：支持 ?month=YYYY-MM 或 ?from=&to=
router.get('/', authRequired, async (req, res) => {
  try {
    const { month, from, to } = req.query;
    let w = '';
    const params = [];
    if (month) { w = 'WHERE date LIKE ?'; params.push(month + '%'); }
    else if (from && to) { w = 'WHERE date >= ? AND date <= ?'; params.push(from, to); }
    const rows = await query('SELECT * FROM schedules ' + w + ' ORDER BY date ASC, period ASC', params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 详情
router.get('/:id', authRequired, async (req, res) => {
  try {
    const r = await get('SELECT * FROM schedules WHERE id = ?', [req.params.id]);
    if (!r) return res.status(404).json({ error: '档期不存在' });
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 冲突检测：同一 date + period 已 booked/locked 视为冲突
async function conflict(date, period, excludeId) {
  const rows = await query(
    'SELECT * FROM schedules WHERE date = ? AND period = ? AND status != ?' + (excludeId ? ' AND id != ?' : ''),
    excludeId ? [date, period, 'free', excludeId] : [date, period, 'free']
  );
  return rows.find((r) => r.status === 'booked' || r.status === 'locked') || null;
}

// 创建
router.post('/', authRequired, requireRole(['admin', 'photographer']), async (req, res) => {
  try {
    const b = req.body;
    if (!b.date) return res.status(400).json({ error: '日期必填' });
    const period = b.period || 'full';
    const status = b.status || 'free';
    if ((status === 'booked' || status === 'locked') && (await conflict(b.date, period))) {
      return res.status(409).json({ error: '该日期同时段已被占用或锁定，无法重复排期' });
    }
    const id = await insert(
      `INSERT INTO schedules (date, period, status, order_no, photographer, note)
       VALUES (?,?,?,?,?,?)`,
      [b.date, period, status, b.order_no || '', b.photographer || '', b.note || '']
    );
    res.json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 更新
router.put('/:id', authRequired, requireRole(['admin', 'photographer']), async (req, res) => {
  try {
    const b = req.body;
    const cur = await get('SELECT * FROM schedules WHERE id = ?', [req.params.id]);
    if (!cur) return res.status(404).json({ error: '档期不存在' });
    const date = b.date ?? cur.date;
    const period = b.period ?? cur.period;
    const status = b.status ?? cur.status;
    if ((status === 'booked' || status === 'locked') && (await conflict(date, period, cur.id))) {
      return res.status(409).json({ error: '该日期同时段已被占用或锁定，无法重复排期' });
    }
    await run(
      `UPDATE schedules SET date=?, period=?, status=?, order_no=?, photographer=?, note=? WHERE id=?`,
      [date, period, status, b.order_no ?? cur.order_no, b.photographer ?? cur.photographer, b.note ?? cur.note, cur.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 删除
router.delete('/:id', authRequired, requireRole(['admin', 'photographer']), async (req, res) => {
  try {
    await run('DELETE FROM schedules WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
