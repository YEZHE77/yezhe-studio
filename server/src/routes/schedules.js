// routes/schedules.js —— 档期管理（日历 / 冲突拦截 / 团队派单 / 订单双向联动 / 锁场）
import { Router } from 'express';
import { query, get, insert, run } from '../db.js';
import { authRequired, requireRole } from '../auth.js';
import { Solar } from 'lunar-javascript';

const router = Router();

// 由公历日期（YYYY-MM-DD）计算农历，如「六月廿三」
export function lunarOf(dateStr) {
  try {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    const lunar = Solar.fromYmd(y, m, d).getLunar();
    return lunar.getMonthInChinese() + '月' + lunar.getDayInChinese();
  } catch { return ''; }
}

// ===== 公开档期可用性（C 端小程序日历着色用，免登录）=====
// GET /api/schedules/availability?month=YYYY-MM
// 返回：booking(开关+每周开放日)、occupied(红/已占=booked/locked)、closed(灰/关闭=手动closed+非开放日)、pending(黄/待确认预约)
router.get('/availability', async (req, res) => {
  try {
    const month = (req.query.month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month 参数格式应为 YYYY-MM' });

    // 预约全局设置（开放开关 + 每周开放日）
    let bookingCfg = { open: true, openDays: [0, 1, 2, 3, 4, 5, 6] };
    const bRow = await get("SELECT value FROM settings WHERE key = 'booking'");
    if (bRow && bRow.value) { try { const p = JSON.parse(bRow.value); if (p && Array.isArray(p.openDays)) bookingCfg = p; } catch { /* 用默认 */ } }

    // 当月档期
    const schedules = await query('SELECT date, period, status FROM schedules WHERE date LIKE ?', [month + '%']);
    const occupied = schedules
      .filter((s) => s.status === 'booked' || s.status === 'locked')
      .map((s) => ({ date: s.date, period: s.period }));
    const closed = schedules
      .filter((s) => s.status === 'closed')
      .map((s) => ({ date: s.date, period: s.period }));

    // 每周开放日 → 非开放日整日置灰（period=full 表示整日）
    const [yy, mm] = month.split('-').map(Number);
    const daysInMonth = new Date(yy, mm, 0).getDate();
    const openDays = bookingCfg.openDays || [];
    for (let d = 1; d <= daysInMonth; d++) {
      const wd = new Date(yy, mm - 1, d).getDay();
      if (!openDays.includes(wd)) {
        const ds = `${yy}-${String(mm).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        closed.push({ date: ds, period: 'full' });
      }
    }

    // 待确认预约（黄色）—— 小程序提交且 B 端尚未确认的 hope_date+period
    const pendings = await query(
      "SELECT hope_date, period FROM appointments WHERE status = 'pending' AND hope_date LIKE ?",
      [month + '%']
    );
    const pending = pendings
      .filter((p) => p.hope_date)
      .map((p) => ({ date: p.hope_date, period: p.period || 'full' }));

    res.json({ month, booking: bookingCfg, occupied, closed, pending });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

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
      `INSERT INTO schedules (date, period, status, order_no, photographer, note, lunar_date,
        groom_name, bride_name, contact_phone, address)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [b.date, period, status, b.order_no || '', b.photographer || '', b.note || '', lunarOf(b.date),
        b.groom_name || '', b.bride_name || '', b.contact_phone || '', b.address || '']
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
      `UPDATE schedules SET date=?, period=?, status=?, order_no=?, photographer=?, note=?, lunar_date=?,
        groom_name=?, bride_name=?, contact_phone=?, address=? WHERE id=?`,
      [date, period, status, b.order_no ?? cur.order_no, b.photographer ?? cur.photographer, b.note ?? cur.note, lunarOf(date),
        b.groom_name ?? cur.groom_name, b.bride_name ?? cur.bride_name, b.contact_phone ?? cur.contact_phone, b.address ?? cur.address, cur.id]
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
