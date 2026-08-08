// routes/schedules.js —— 档期管理（日历 / 冲突拦截 / 团队派单 / 订单双向联动 / 锁场）
import { Router } from 'express';
import crypto from 'node:crypto';
import { query, get, insert, run } from '../db.js';
import { authRequired, requireRole } from '../auth.js';
import { Solar } from 'lunar-javascript';
import { buildShareUrl, genQr } from '../shareUtil.js';

// 解析 periods（JSON 数组容错）
function parsePeriods(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch { return []; }
}

// CSV 序列化（UTF-8 BOM 由调用方拼接，Excel 中文正常）
function toCsv(headers, rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [headers.map((h) => esc(h.label)).join(',')];
  for (const r of rows) lines.push(headers.map((h) => esc(r[h.key])).join(','));
  return lines.join('\r\n');
}

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
    // 仅做格式校验 YYYY-MM；允许任意年份（含未来 1~N 年、历史月份），
    // 禁止写死「不能大于当前月」的硬编码拦截，未来年份正常返回当月档期状态
    const m = /^(\d{4})-(\d{2})$/.exec(month);
    if (!m) return res.status(400).json({ error: 'month 参数格式应为 YYYY-MM' });
    const yy = Number(m[1]);
    const mm = Number(m[2]);
    if (mm < 1 || mm > 12) return res.status(400).json({ error: 'month 月份必须在 01-12 之间' });

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
    // yy / mm 已由上方解析（mm 为 1-12，与入参一致）
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

// 列表：支持 ?month=YYYY-MM 或 ?from=&to= ；?executor= 按执行人( personel.id )过滤
// 关联 orders 返回 order_customer / order_pay_status / order_status 用于日历着色（未付定/等待拍）
router.get('/', authRequired, async (req, res) => {
  try {
    const { month, executor, from, to } = req.query;
    const where = [];
    const params = [];
    if (month) { where.push('s.date LIKE ?'); params.push(month + '%'); }
    else if (from && to) { where.push('s.date >= ? AND s.date <= ?'); params.push(from, to); }
    if (executor) {
      where.push('(s.executor_id = ? OR s.executor_name = (SELECT name FROM users WHERE id = ?))');
      params.push(Number(executor), Number(executor));
    }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = await query(
      `SELECT s.*, o.customer_name AS order_customer, o.payment_status AS order_pay_status, o.status AS order_status
       FROM schedules s LEFT JOIN orders o ON o.order_no = s.order_no ${w} ORDER BY s.date ASC, s.id ASC`,
      params
    );
    res.json(rows.map((r) => ({ ...r, periods: parsePeriods(r.periods) })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 农历映射：返回当月每日 公历->农历，前端日历统一取用（避免前端重复引入 lunar 库）
router.get('/lunar', authRequired, async (req, res) => {
  try {
    const month = (req.query.month || '').trim();
    const m = /^(\d{4})-(\d{2})$/.exec(month);
    if (!m) return res.status(400).json({ error: 'month 格式应为 YYYY-MM' });
    const yy = Number(m[1]); const mm = Number(m[2]);
    const days = new Date(yy, mm, 0).getDate();
    const out = {};
    for (let d = 1; d <= days; d++) {
      const ds = `${yy}-${String(mm).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      out[ds] = lunarOf(ds);
    }
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 导出当月档期 CSV（Excel 可直接打开）；?month=YYYY-MM 缺省导出全部
router.get('/export', authRequired, async (req, res) => {
  try {
    const { month } = req.query;
    const w = month ? 'WHERE date LIKE ?' : '';
    const rows = await query('SELECT * FROM schedules ' + w + ' ORDER BY date ASC, id ASC', month ? [month + '%'] : []);
    const headers = [
      { key: 'date', label: '日期' }, { key: 'period', label: '时段' }, { key: 'periods', label: '具体时段' },
      { key: 'status', label: '状态' }, { key: 'order_no', label: '订单号' }, { key: 'photographer', label: '摄影师' },
      { key: 'executor_name', label: '执行人' }, { key: 'note', label: '备注' }
    ];
    const SSTATUS = { free: '空闲', booked: '已约', locked: '锁场', closed: '已关闭', shoot: '等待拍摄', pending: '待确认' };
    const data = rows.map((r) => ({
      ...r,
      periods: parsePeriods(r.periods).join('、') || '',
      status: SSTATUS[r.status] || r.status
    }));
    // 复用 admin 的 toCsv（同进程可直接 import）
    const csv = toCsv(headers, data);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="schedules_${month || 'all'}.csv"`);
    res.send('﻿' + csv);
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

// 冲突检测：同一 date + period 已 booked/locked 视为冲突。
// 全天(full) 与任何时段冲突；半天(half) 与全天或其它半天冲突。
async function conflict(date, period, excludeId) {
  const rows = await query(
    'SELECT * FROM schedules WHERE date = ? AND status IN (?,?)' + (excludeId ? ' AND id != ?' : ''),
    excludeId ? [date, 'booked', 'locked', excludeId] : [date, 'booked', 'locked']
  );
  return rows.find((r) => {
    if (period === 'full' || r.period === 'full') return true;
    return r.period === period;
  }) || null;
}

// 创建（支持 时间段数组 periods / 日期待定 date_tbd / 绑定执行人 executor）
router.post('/', authRequired, requireRole(['admin', 'photographer']), async (req, res) => {
  try {
    const b = req.body;
    if (!b.date) return res.status(400).json({ error: '日期必填' });
    const periods = Array.isArray(b.periods) ? b.periods.filter(Boolean) : [];
    const dateTbd = b.date_tbd ? 1 : 0;
    const status = b.status || 'free';
    const id = await insert(
      `INSERT INTO schedules (date, period, periods, status, date_tbd, order_no, photographer, executor_id, executor_name, note, lunar_date,
        groom_name, bride_name, contact_phone, address)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [b.date, 'full', JSON.stringify(periods), status, dateTbd, b.order_no || '',
       b.photographer || b.executor_name || '', Number(b.executor_id) || null, b.executor_name || '', b.note || '', lunarOf(b.date),
       b.groom_name || '', b.bride_name || '', b.contact_phone || '', b.address || '']
    );
    res.json({ id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 关闭 / 开放指定日期（仅限制 C 端预约；B 端仍可手动新增档期）
// 关闭 = 插入一条 status='closed' 的全天占位；开放 = 删除该占位（不影响已存在订单档期）
router.post('/close', authRequired, requireRole(['admin', 'photographer']), async (req, res) => {
  try {
    const { date } = req.body;
    if (!date) return res.status(400).json({ error: '日期必填' });
    await run('DELETE FROM schedules WHERE date = ? AND status = ?', [date, 'closed']);
    const id = await insert("INSERT INTO schedules (date, period, status, lunar_date, note) VALUES (?,?,?,?,?)", [date, 'full', 'closed', lunarOf(date), '档期已关闭']);
    res.json({ id, closed: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/open', authRequired, requireRole(['admin', 'photographer']), async (req, res) => {
  try {
    const { date } = req.body;
    if (!date) return res.status(400).json({ error: '日期必填' });
    await run('DELETE FROM schedules WHERE date = ? AND status = ?', [date, 'closed']);
    res.json({ ok: true, closed: false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 生成公开档期分享链接（整库/整月可约档期，C 端小程序扫码查看）
router.post('/share', authRequired, requireRole(['admin', 'photographer', 'finance']), async (req, res) => {
  try {
    const token = crypto.randomBytes(16).toString('hex');
    const created_by = req.user && req.user.username ? req.user.username : '';
    await insert("INSERT INTO shares (token, type, ref_id, title, password_hash, expire_at, disabled, created_by) VALUES (?,?,?,?,?,?,0,?)",
      [token, 'schedule', 0, '婚礼档期预约', null, null, created_by]);
    const shareUrl = buildShareUrl(token, req);
    const qr_url = await genQr(shareUrl);
    res.json({ ok: true, token, share_url: shareUrl, qr_url, title: '婚礼档期预约' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 更新（支持 periods / date_tbd / 执行人）
router.put('/:id', authRequired, requireRole(['admin', 'photographer']), async (req, res) => {
  try {
    const b = req.body;
    const cur = await get('SELECT * FROM schedules WHERE id = ?', [req.params.id]);
    if (!cur) return res.status(404).json({ error: '档期不存在' });
    const date = b.date ?? cur.date;
    const periods = Array.isArray(b.periods) ? b.periods.filter(Boolean) : parsePeriods(cur.periods);
    const dateTbd = b.date_tbd != null ? (b.date_tbd ? 1 : 0) : (cur.date_tbd || 0);
    const status = b.status ?? cur.status;
    await run(
      `UPDATE schedules SET date=?, period=?, periods=?, status=?, date_tbd=?, order_no=?, photographer=?, executor_id=?, executor_name=?, note=?, lunar_date=?,
        groom_name=?, bride_name=?, contact_phone=?, address=? WHERE id=?`,
      [date, 'full', JSON.stringify(periods), status, dateTbd, b.order_no ?? cur.order_no,
       b.photographer ?? cur.photographer, Number(b.executor_id) ?? cur.executor_id ?? null, b.executor_name ?? cur.executor_name ?? '',
       b.note ?? cur.note, lunarOf(date), b.groom_name ?? cur.groom_name, b.bride_name ?? cur.bride_name,
       b.contact_phone ?? cur.contact_phone, b.address ?? cur.address, cur.id]
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
