// routes/schedules.js —— 档期管理（日历 / 冲突拦截 / 团队派单 / 订单双向联动 / 锁场）
import { Router } from 'express';
import crypto from 'node:crypto';
import { query, get, insert, run } from '../db.js';
import { authRequired, requireRole } from '../auth.js';
import { emitBizToStaff, BIZ_TYPE } from './mobileMessage.js';
import { Solar } from 'lunar-javascript';
import { buildShareUrl, genQr } from '../shareUtil.js';
import { serverError } from '../httpError.js';

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

// 由公历日期（YYYY-MM-DD）计算农历（含干支年+节日），如「甲辰 八月十五 中秋」
export function lunarOf(dateStr) {
  try {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    const lunar = Solar.fromYmd(y, m, d).getLunar();
    const gz = lunar.getYearInGanZhi ? lunar.getYearInGanZhi() : '';
    const md = lunar.getMonthInChinese() + '月' + lunar.getDayInChinese();
    // 取节日名（如中秋、春节、清明、端午）
    const festivals = [
      ...(lunar.getFestivals ? lunar.getFestivals() : []),
      ...(lunar.getOtherFestivals ? lunar.getOtherFestivals() : [])
    ];
    // 节日名去后缀「节」字（更紧凑）：中秋、清明、端阳
    const festival = (festivals[0] || '').replace(/节$/, '');
    return [gz, md, festival].filter(Boolean).join(' ');
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

    // 单日接单上限：booked 数量 >= daily 上限的日期视为「已约满」，C 端预约禁用（与 locked/closed 同等不可约）
    const capCfg = await getCapacityCfg();
    const full = [];
    if (capCfg.daily > 0) {
      const bookedCounts = {};
      for (const s of schedules) {
        if (s.status === 'booked') bookedCounts[s.date] = (bookedCounts[s.date] || 0) + 1;
      }
      for (const [date, c] of Object.entries(bookedCounts)) {
        if (c >= capCfg.daily) full.push({ date, period: 'full', count: c, limit: capCfg.daily });
      }
    }

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

    res.json({ month, booking: bookingCfg, occupied, closed, full, pending });
  } catch (e) { serverError(res, e); }
});

// 单日接单上限：读取 / 保存（仅管理员可改；必须放在 GET / 与 /:id 之前避免被吞路由）
router.get('/capacity', authRequired, requireRole(['admin', 'photographer']), async (req, res) => {
  try {
    res.json(await getCapacityCfg());
  } catch (e) { serverError(res, e); }
});
router.put('/capacity', authRequired, requireRole(['admin']), async (req, res) => {
  try {
    const daily = Math.max(0, parseInt(req.body.daily, 10) || 0);
    const perPhotographer = !!req.body.perPhotographer;
    const value = JSON.stringify({ daily, perPhotographer });
    const exists = await get("SELECT key FROM settings WHERE key = 'schedule_capacity'");
    if (exists) await run("UPDATE settings SET value = ? WHERE key = 'schedule_capacity'", [value]);
    else await insert("INSERT INTO settings (key, value) VALUES (?, ?)", ['schedule_capacity', value]);
    res.json({ ok: true, capacity: { daily, perPhotographer } });
  } catch (e) { serverError(res, e); }
});

// 列表：支持 ?month=YYYY-MM 或 ?from=&to= ；?executor= 按执行人( personel.id )过滤
// 关联 orders 返回 order_customer / order_pay_status / order_status 用于日历着色（未付定/等待拍）
router.get('/', authRequired, async (req, res) => {
  try {
    const { month, executor, from, to, package_id, status } = req.query;
    const where = [];
    const params = [];
    if (month) { where.push('s.date LIKE ?'); params.push(month + '%'); }
    else if (from && to) { where.push('s.date >= ? AND s.date <= ?'); params.push(from, to); }
    if (executor) {
      where.push('(s.executor_id = ? OR s.executor_name = (SELECT name FROM users WHERE id = ?))');
      params.push(Number(executor), Number(executor));
    }
    // 套系筛选：档期行通过订单关联套系（套系不直接占用档期，通过订单间接关联）
    if (package_id) {
      where.push('o.package_id = ?');
      params.push(Number(package_id));
    }
    // 档期状态筛选：free / booked / locked / closed / shoot / pending
    if (status && status !== 'all') {
      where.push('s.status = ?');
      params.push(status);
    }
    // 子账号权限（验收：摄影师仅看到分配给自己的档期与订单；管理员全部可见）
    if (req.user && req.user.role === 'photographer') {
      const me = await get('SELECT name FROM users WHERE id = ?', [req.user.uid]);
      if (me && me.name) {
        where.push('(s.executor_name = ? OR s.executor_id IN (SELECT id FROM users WHERE name = ?))');
        params.push(me.name, me.name);
      }
    }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = await query(
      `SELECT s.*, o.id AS order_id, o.customer_name AS order_customer, o.payment_status AS order_pay_status, o.status AS order_status,
              o.package_id AS order_package_id, p.name AS order_package,
              o.customer_phone AS order_phone, o.phones AS order_phones, o.balance AS order_balance,
              o.total_amount AS order_price, o.deposit AS order_deposit,
              o.time_slots AS order_time_slots, o.executors AS order_executors
       FROM schedules s
       LEFT JOIN orders o ON o.order_no = s.order_no
       LEFT JOIN packages p ON p.id = o.package_id ${w} ORDER BY s.date ASC, s.id ASC`,
      params
    );
    res.json(rows.map((r) => ({ ...r, periods: parsePeriods(r.periods) })));
  } catch (e) { serverError(res, e); }
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
  } catch (e) { serverError(res, e); }
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
  } catch (e) { serverError(res, e); }
});

// 详情
router.get('/:id', authRequired, async (req, res) => {
  try {
    const r = await get('SELECT * FROM schedules WHERE id = ?', [req.params.id]);
    if (!r) return res.status(404).json({ error: '档期不存在' });
    res.json(r);
  } catch (e) { serverError(res, e); }
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

// ===== 订单 ↔ 档期 双向联动助手（供 orders.js 调用，禁止简化业务规则）=====
// 冲突检测：同一日期已被【其它订单占用(booked)】或【手动锁场(locked)】视为冲突。
// excludeOrderNo：本订单自身占用的档期不算冲突（编辑订单时用）。
export async function scheduleConflict(date, excludeOrderNo) {
  if (!date) return null;
  const rows = await query(
    "SELECT * FROM schedules WHERE date = ? AND status IN ('booked','locked') ORDER BY id ASC",
    [date]
  );
  const hit = rows.find((r) => !(excludeOrderNo && r.order_no && String(r.order_no) === String(excludeOrderNo)));
  return hit || null;
}

// 冲突文案（前端 409 直接展示）
export function conflictText(hit) {
  if (!hit) return '';
  if (hit.status === 'locked') return `${hit.date} 已被手动锁场${hit.note ? '（' + hit.note + '）' : ''}，无法占用`;
  return `${hit.date} 已被订单 ${hit.order_no || ''}${hit.groom_name || hit.bride_name ? ' / ' + [hit.groom_name, hit.bride_name].filter(Boolean).join('&') : ''} 占用，无法重复预约`;
}

// 占用档期：先冲突检测（命中抛 err.code='CONFLICT'），通过则写入/复用该订单的 booked 记录。
// 同一订单号只保留一条 booked 档期，改日期时自动迁移（= 释放旧日期 + 占用新日期）。
// force=true 时跳过冲突拦截（B 端二次确认「仍要占用」场景），仍照常写入占用记录
export async function occupySchedule(date, orderNo, meta = {}, force = false) {
  if (!date || !orderNo) return null;
  const hit = force ? null : await scheduleConflict(date, orderNo);
  if (hit) {
    const err = new Error(conflictText(hit));
    err.code = 'CONFLICT';
    err.conflict = { id: hit.id, date: hit.date, status: hit.status, order_no: hit.order_no || '' };
    throw err;
  }
  const periods = Array.isArray(meta.periods) ? meta.periods.filter(Boolean) : [];
  // 档期时长类型：meta.period 传入（full 全天 / half 半天），未传默认 full
  const period = ['full', 'half'].includes(meta.period) ? meta.period : 'full';
  const exist = await get("SELECT * FROM schedules WHERE order_no = ? AND status = 'booked' ORDER BY id ASC", [orderNo]);
  const vals = [
    date, period, JSON.stringify(periods), 'booked', 0, String(orderNo),
    meta.photographer || meta.executor_name || '', meta.executor_id != null && meta.executor_id !== '' ? Number(meta.executor_id) : null,
    meta.executor_name || '', meta.note || '', lunarOf(date),
    meta.groom_name || '', meta.bride_name || '', meta.contact_phone || '', meta.address || ''
  ];
  if (exist) {
    // 同订单多余的 booked 行清理（历史脏数据兜底），只保留 exist
    await run("DELETE FROM schedules WHERE order_no = ? AND status = 'booked' AND id != ?", [String(orderNo), exist.id]);
    await run(
      `UPDATE schedules SET date=?, period=?, periods=?, status=?, date_tbd=?, order_no=?, photographer=?, executor_id=?, executor_name=?,
        note=?, lunar_date=?, groom_name=?, bride_name=?, contact_phone=?, address=? WHERE id=?`,
      [...vals, exist.id]
    );
    return exist.id;
  }
  return await insert(
    `INSERT INTO schedules (date, period, periods, status, date_tbd, order_no, photographer, executor_id, executor_name, note, lunar_date,
      groom_name, bride_name, contact_phone, address) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    vals
  );
}

// 释放档期：订单作废/删除/改为日期待定时，删除该订单占用的 booked 记录（不影响 locked/closed）
export async function releaseSchedule(orderNo) {
  if (!orderNo) return 0;
  await run("DELETE FROM schedules WHERE order_no = ? AND status = 'booked'", [String(orderNo)]);
  return 1;
}

// ===== 单日接单上限（容量）：订单 ↔ 档期 联动核心规则之一 =====
// settings['schedule_capacity'] = { daily: 单日最大接单数(0=不限), perPhotographer: 是否按摄影师维度隔离 }
export async function getCapacityCfg() {
  const row = await get("SELECT value FROM settings WHERE key = 'schedule_capacity'");
  let cfg = { daily: 0, perPhotographer: false };
  if (row && row.value) {
    try {
      const p = JSON.parse(row.value);
      cfg = { daily: Math.max(0, Number(p.daily) || 0), perPhotographer: !!p.perPhotographer };
    } catch { /* 用默认 */ }
  }
  return cfg;
}

// 容量冲突检测：返回 { count, limit } | null。
// excludeOrderNo：本订单自身占用的档期不计入（编辑订单时用）；
// executorId：perPhotographer=true 时按该摄影师当日已占数量计数（A摄影师约满不影响B摄影师）。
export async function capacityConflict(date, excludeOrderNo, executorId) {
  if (!date) return null;
  const cfg = await getCapacityCfg();
  if (!cfg.daily || cfg.daily <= 0) return null;
  const rows = await query("SELECT * FROM schedules WHERE date = ? AND status = 'booked'", [date]);
  let booked = rows;
  if (cfg.perPhotographer && executorId != null && executorId !== '') {
    booked = rows.filter((r) => r.executor_id != null && String(r.executor_id) === String(executorId));
  }
  let count = booked.length;
  if (excludeOrderNo) {
    count = booked.filter((r) => !(r.order_no && String(r.order_no) === String(excludeOrderNo))).length;
  }
  if (count >= cfg.daily) return { count, limit: cfg.daily, perPhotographer: cfg.perPhotographer };
  return null;
}

// 创建（支持 时间段数组 periods / 日期待定 date_tbd / 绑定执行人 executor）
// 手动锁档/新增档期时做冲突拦截：已被订单占用或已锁场的日期不允许覆盖（验收⑩）
router.post('/', authRequired, requireRole(['admin', 'photographer']), async (req, res) => {
  try {
    const b = req.body;
    if (!b.date) return res.status(400).json({ error: '日期必填' });
    const periods = Array.isArray(b.periods) ? b.periods.filter(Boolean) : [];
    const dateTbd = b.date_tbd ? 1 : 0;
    const status = b.status || 'free';
    // 仅占用型状态（booked/locked）需要冲突检测；free/closed 不拦截
    if ((status === 'booked' || status === 'locked') && !dateTbd) {
      const hit = await conflict(b.date, 'full', null);
      // 同订单号重复提交视为幂等更新，不算冲突
      if (hit && !(b.order_no && hit.order_no && String(hit.order_no) === String(b.order_no))) {
        return res.status(409).json({ error: conflictText(hit), code: 'CONFLICT', conflict: { id: hit.id, date: hit.date, status: hit.status, order_no: hit.order_no || '' } });
      }
    }
    const id = await insert(
      `INSERT INTO schedules (date, period, periods, status, date_tbd, order_no, photographer, executor_id, executor_name, note, lunar_date,
        groom_name, bride_name, contact_phone, address)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [b.date, 'full', JSON.stringify(periods), status, dateTbd, b.order_no || '',
       b.photographer || b.executor_name || '', Number(b.executor_id) || null, b.executor_name || '', b.note || '', lunarOf(b.date),
       b.groom_name || '', b.bride_name || '', b.contact_phone || '', b.address || '']
    );
    res.json({ id });
    // 移动端业务消息（新增摄影日程）
    if (status === 'booked' || status === 'locked') {
      try { await emitBizToStaff({ title: '新增摄影日程', content: `新增摄影日程 ${b.date}（${(b.groom_name && b.bride_name) ? `${b.groom_name} & ${b.bride_name}` : (b.order_no || '客户')}）`, biz_type: BIZ_TYPE.SCHEDULE, biz_id: id }); } catch {}
    }
  } catch (e) { serverError(res, e); }
});

// 关闭 / 开放指定日期（仅限制 C 端预约；B 端仍可手动新增档期）
// 关闭 = 插入一条 status='closed' 的全天占位；开放 = 删除该占位（不影响已存在订单档期）
router.post('/close', authRequired, requireRole(['admin', 'photographer']), async (req, res) => {
  try {
    const { date } = req.body;
    if (!date) return res.status(400).json({ error: '日期必填' });
    // 手动锁档不能覆盖已有订单/已锁场日期（验收⑨：弹窗提示冲突，需先处理订单）
    const hit = await scheduleConflict(date, null);
    if (hit) {
      return res.status(409).json({
        error: conflictText(hit), code: 'CONFLICT',
        conflict: { id: hit.id, date: hit.date, status: hit.status, order_no: hit.order_no || '' }
      });
    }
    await run('DELETE FROM schedules WHERE date = ? AND status = ?', [date, 'closed']);
    const id = await insert("INSERT INTO schedules (date, period, status, lunar_date, note) VALUES (?,?,?,?,?)", [date, 'full', 'closed', lunarOf(date), '档期已关闭']);
    res.json({ id, closed: true });
  } catch (e) { serverError(res, e); }
});
router.post('/open', authRequired, requireRole(['admin', 'photographer']), async (req, res) => {
  try {
    const { date } = req.body;
    if (!date) return res.status(400).json({ error: '日期必填' });
    await run('DELETE FROM schedules WHERE date = ? AND status = ?', [date, 'closed']);
    res.json({ ok: true, closed: false });
  } catch (e) { serverError(res, e); }
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
  } catch (e) { serverError(res, e); }
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
    // 改到占用型状态或换日期时做冲突拦截（排除自身；同订单号不算冲突）
    if ((status === 'booked' || status === 'locked') && !dateTbd) {
      const hit = await conflict(date, 'full', cur.id);
      const selfOrder = b.order_no ?? cur.order_no;
      if (hit && !(selfOrder && hit.order_no && String(hit.order_no) === String(selfOrder))) {
        return res.status(409).json({ error: conflictText(hit), code: 'CONFLICT', conflict: { id: hit.id, date: hit.date, status: hit.status, order_no: hit.order_no || '' } });
      }
    }
    await run(
      `UPDATE schedules SET date=?, period=?, periods=?, status=?, date_tbd=?, order_no=?, photographer=?, executor_id=?, executor_name=?, note=?, lunar_date=?,
        groom_name=?, bride_name=?, contact_phone=?, address=? WHERE id=?`,
      [date, 'full', JSON.stringify(periods), status, dateTbd, b.order_no ?? cur.order_no,
       b.photographer ?? cur.photographer, Number(b.executor_id) ?? cur.executor_id ?? null, b.executor_name ?? cur.executor_name ?? '',
       b.note ?? cur.note, lunarOf(date), b.groom_name ?? cur.groom_name, b.bride_name ?? cur.bride_name,
       b.contact_phone ?? cur.contact_phone, b.address ?? cur.address, cur.id]
    );
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// 删除
router.delete('/:id', authRequired, requireRole(['admin', 'photographer']), async (req, res) => {
  try {
    const s = await get('SELECT date, order_no, groom_name, bride_name, status FROM schedules WHERE id = ?', [req.params.id]);
    await run('DELETE FROM schedules WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
    // 移动端业务消息（日程删除，仅占用型日程通知）
    if (s && (s.status === 'booked' || s.status === 'locked')) {
      try { await emitBizToStaff({ title: '日程删除', content: `摄影日程 ${s.date}（${(s.groom_name && s.bride_name) ? `${s.groom_name} & ${s.bride_name}` : (s.order_no || '客户')}）已删除`, biz_type: BIZ_TYPE.SCHEDULE, biz_id: req.params.id }); } catch {}
    }
  } catch (e) { serverError(res, e); }
});

// 一键档期校准：根据全部有效订单重建 booked 占用 + 清理孤儿 booked（兜底修复脏数据）
// 触发场景：档期日历出现「占用但订单已取消」或「订单已排期但日历未占用」等不一致时
router.post('/reconcile', authRequired, requireRole(['admin']), async (req, res) => {
  try {
    // ① 清理孤儿 booked：order_no 为空，或对应订单已不存在/已作废/已删除
    const orphans = await query(
      `SELECT s.id, s.order_no FROM schedules s
       WHERE s.status = 'booked'
         AND (s.order_no IS NULL OR s.order_no = ''
              OR NOT EXISTS (SELECT 1 FROM orders o WHERE o.order_no = s.order_no AND o.cancelled = 0 AND o.is_deleted = 0))`
    );
    for (const row of orphans) {
      await run('DELETE FROM schedules WHERE id = ?', [row.id]);
    }
    // ② 遍历全部有效订单，重建/修正 booked 记录（force=true 跳过冲突，occupySchedule 内部处理「同订单去重 + 日期迁移」）
    const orders = await query(
      `SELECT id, order_no, shoot_date, date_tbd, executors, groom_name, bride_name, customer_phone, address, executor
       FROM orders WHERE cancelled = 0 AND is_deleted = 0 AND shoot_date IS NOT NULL AND shoot_date != '' AND date_tbd = 0`
    );
    let rebuilt = 0;
    for (const o of orders) {
      const meta = {
        groom_name: o.groom_name || '', bride_name: o.bride_name || '',
        contact_phone: o.customer_phone || '', address: o.address || '',
        photographer: o.executor || ''
      };
      try {
        const execs = JSON.parse(o.executors || '[]');
        if (Array.isArray(execs) && execs.length) {
          meta.executor_id = execs[0].id;
          meta.executor_name = execs[0].name;
        }
      } catch { /* executors 非法则用 executor 兜底 */ }
      try { await occupySchedule(o.shoot_date, o.order_no, meta, true); rebuilt++; }
      catch { /* 单个失败不阻断整体校准 */ }
    }
    res.json({ ok: true, removed_orphans: orphans.length, rebuilt, total_orders: orders.length });
  } catch (e) { serverError(res, e); }
});

export default router;
