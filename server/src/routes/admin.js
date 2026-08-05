// routes/admin.js —— 商户后台：C 端客户数据管理（预约转订单 / 选片结果查看修改 / 评价审核）
// 全部需要商户登录（authRequired）；与 /api/customer 的行级隔离互补：此处为管理视角，可看全部。
import { Router } from 'express';
import { query, get, insert, run } from '../db.js';
import { authRequired } from '../auth.js';
import { lunarOf } from './schedules.js';

const router = Router();
router.use(authRequired);

function nowISO() { return new Date().toISOString(); }

// ===== 1. 预约管理 =====
// 列表（含套系名，状态 pending/converted）
router.get('/appointments', async (req, res) => {
  try {
    const rows = await query(
      `SELECT a.*, p.name AS package_name
       FROM appointments a
       LEFT JOIN packages p ON p.id = a.package_id
       ORDER BY a.id DESC`,
      []
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 接受预约 → 生成订单并锁定档期（双向绑定 schedule_id / order_id）
// 文档关键规则：客户提交预约 ≠ 锁定档期，必须 B 端确认才真正占用时间。
async function doConfirm(req, res) {
  try {
    const a = await get('SELECT * FROM appointments WHERE id = ?', [req.params.id]);
    if (!a) return res.status(404).json({ error: '预约不存在' });
    if (a.status !== 'pending') return res.status(400).json({ error: '仅「待确认」预约可被接受' });
    const b = req.body || {};
    const date = b.date || a.hope_date;
    const period = ['full', 'am', 'pm', 'night'].includes(b.period) ? b.period : (a.period || 'full');
    if (!date) return res.status(400).json({ error: '请指定拍摄日期' });

    // 冲突检测：同 date+period 已 booked/locked 视为冲突（不可重复占用）
    const conflictRow = await query(
      "SELECT * FROM schedules WHERE date = ? AND period = ? AND status IN ('booked','locked')",
      [date, period]
    );
    if (conflictRow.length) return res.status(409).json({ error: '该日期同时段已被占用或锁定，无法确认' });

    // 绑定 / 创建档期（booked 占用，锁定时间）
    let scheduleId = b.schedule_id ? Number(b.schedule_id) : null;
    if (!scheduleId) {
      const lunar = lunarOf(date);
      scheduleId = await insert(
        `INSERT INTO schedules (date, period, status, order_no, photographer, note, lunar_date)
         VALUES (?,?,?,?,?,?,?)`,
        [date, period, 'booked', '', b.photographer || '', a.remark || '', lunar]
      );
    } else {
      await run("UPDATE schedules SET status = 'booked', photographer = ? WHERE id = ?", [b.photographer || '', scheduleId]);
    }

    // 生成订单并绑定 openid + schedule
    let package_snapshot = null, total = 0;
    if (a.package_id) {
      const p = await get('SELECT * FROM packages WHERE id = ?', [a.package_id]);
      if (p) {
        let price = parseFloat(p.price) || 0;
        let deposit = parseFloat(p.deposit) || 0;
        let questionnaire = '';
        try { questionnaire = p.questionnaire ? JSON.parse(p.questionnaire) : ''; } catch { questionnaire = p.questionnaire || ''; }
        let spec = null;
        if (a.spec_id) {
          try {
            const specs = p.specs ? JSON.parse(p.specs) : [];
            spec = specs.find((s) => s.id === a.spec_id) || null;
          } catch { spec = null; }
        }
        if (spec) { price = parseFloat(spec.price) || price; deposit = parseFloat(spec.deposit) || deposit; }
        package_snapshot = {
          id: p.id, name: p.name, price, deposit,
          spec: spec ? { id: spec.id, name: spec.name, price: parseFloat(spec.price) || 0, deposit: parseFloat(spec.deposit) || 0 } : null,
          questionnaire
        };
        total = price;
      }
    }
    const order_no = 'NO' + Date.now();
    const logs = JSON.stringify([{ t: nowISO(), text: '由预约 #' + a.id + ' 确认转单' }]);
    const orderId = await insert(
      `INSERT INTO orders (order_no, customer_name, customer_phone, package_id, package_snapshot,
        status, deposit, balance, total_amount, paid_amount, openid, remark, logs, shoot_date)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [order_no, a.name, a.phone, a.package_id || null, JSON.stringify(package_snapshot),
        'unpaid', 0, total, total, 0, a.openid || null, a.remark || '', logs, date]
    );

    await run(
      "UPDATE appointments SET status = 'confirmed', schedule_id = ?, order_id = ?, period = ?, handled_at = ? WHERE id = ?",
      [scheduleId, orderId, period, nowISO(), a.id]
    );
    res.json({ ok: true, orderId, order_no, scheduleId });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// 接受（兼容旧调用命名 convert）
router.post('/appointments/:id/convert', (req, res) => doConfirm(req, res));
// 接受（新语义）
router.post('/appointments/:id/confirm', (req, res) => doConfirm(req, res));

// 拒绝预约 → 填拒绝原因，状态置 rejected（不直接删除，保留留痕）
router.post('/appointments/:id/reject', async (req, res) => {
  try {
    const a = await get('SELECT * FROM appointments WHERE id = ?', [req.params.id]);
    if (!a) return res.status(404).json({ error: '预约不存在' });
    if (a.status !== 'pending') return res.status(400).json({ error: '仅「待确认」预约可被拒绝' });
    const reason = (req.body && req.body.reason) || '';
    await run("UPDATE appointments SET status = 'rejected', reject_reason = ?, handled_at = ? WHERE id = ?",
      [reason, nowISO(), a.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 编辑预约（修改称呼/电话/意向套系/期望日期/时段/备注/状态）
router.put('/appointments/:id', async (req, res) => {
  try {
    const a = await get('SELECT * FROM appointments WHERE id = ?', [req.params.id]);
    if (!a) return res.status(404).json({ error: '预约不存在' });
    const b = req.body;
    await run(
      'UPDATE appointments SET name=?, phone=?, package_id=?, hope_date=?, period=?, remark=?, status=? WHERE id=?',
      [b.name ?? a.name, b.phone ?? a.phone, b.package_id ?? a.package_id,
       b.hope_date ?? a.hope_date, b.period ?? a.period, b.remark ?? a.remark, b.status ?? a.status, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 删除预约
router.delete('/appointments/:id', async (req, res) => {
  try {
    await run('DELETE FROM appointments WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== 2. 选片结果（管理端查看 / 修改）=====
async function linkedSamplePhotos(orderId) {
  const works = await query('SELECT id, title FROM works WHERE order_id = ? ORDER BY id DESC', [orderId]);
  const photos = [];
  for (const w of works) {
    const albums = await query("SELECT id, zone, photo_url, sort FROM albums WHERE work_id = ? AND zone = 'sample' ORDER BY sort", [w.id]);
    for (const a of albums) photos.push({ ...a, workTitle: w.title });
  }
  return photos;
}

// 查看客户提交的选片（含可勾选的 sample 小样）
router.get('/photo-select/:orderId', async (req, res) => {
  try {
    const o = await get('SELECT id FROM orders WHERE id = ?', [req.params.orderId]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    const sel = await get('SELECT * FROM photo_select WHERE order_id = ? ORDER BY id DESC LIMIT 1', [req.params.orderId]);
    const photos = await linkedSamplePhotos(req.params.orderId);
    res.json({
      selection: sel
        ? { marks: sel.marks ? JSON.parse(sel.marks) : [], submitted: !!sel.submitted, draft: sel.draft ? JSON.parse(sel.draft) : [] }
        : null,
      photos
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 修改选片结果（保留原 openid，submitted 置 1）
router.post('/photo-select/:orderId', async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const o = await get('SELECT id FROM orders WHERE id = ?', [orderId]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    const marks = Array.isArray(req.body.marks) ? req.body.marks : [];
    const existing = await get('SELECT * FROM photo_select WHERE order_id = ? ORDER BY id DESC LIMIT 1', [orderId]);
    if (!existing) return res.status(400).json({ error: '该订单暂无客户选片，无法由后台修改' });
    await run('UPDATE photo_select SET marks = ?, submitted = 1, updated_at = ? WHERE id = ?',
      [JSON.stringify(marks), nowISO(), existing.id]);
    res.json({ ok: true, count: marks.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== 3. 评价审核 =====
// 列表（按状态筛选；含订单客户名/单号）
router.get('/evaluates', async (req, res) => {
  try {
    const { status } = req.query;
    const where = [];
    const params = [];
    if (status) { where.push('e.status = ?'); params.push(status); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = await query(
      `SELECT e.*, o.customer_name, o.order_no
       FROM evaluates e
       LEFT JOIN orders o ON o.id = e.order_id ${w}
       ORDER BY e.id DESC`,
      params
    );
    res.json(rows.map((r) => ({ ...r, images: r.images ? JSON.parse(r.images) : [] })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 审核：approve → approved（进好评墙）/ reject → rejected
router.post('/evaluates/:id/review', async (req, res) => {
  try {
    const e0 = await get('SELECT * FROM evaluates WHERE id = ?', [req.params.id]);
    if (!e0) return res.status(404).json({ error: '评价不存在' });
    const action = req.body.action;
    if (action !== 'approve' && action !== 'reject') return res.status(400).json({ error: '无效操作' });
    const status = action === 'approve' ? 'approved' : 'rejected';
    await run('UPDATE evaluates SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ ok: true, status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 删除评价
router.delete('/evaluates/:id', async (req, res) => {
  try {
    await run('DELETE FROM evaluates WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== 4. 客户管理（按 openid 聚合，贯穿订单/预约）=====
router.get('/customers', async (req, res) => {
  try {
    const cs = await query('SELECT * FROM customers');
    const custMap = new Map(cs.map((c) => [c.openid, c]));
    const orderAgg = await query(
      "SELECT openid, COUNT(*) c, COALESCE(SUM(paid_amount),0) spent FROM orders WHERE openid IS NOT NULL AND openid <> '' AND cancelled = 0 GROUP BY openid"
    );
    const appAgg = await query(
      "SELECT openid, COUNT(*) c FROM appointments WHERE openid IS NOT NULL AND openid <> '' GROUP BY openid"
    );
    const lastOrd = await query(
      "SELECT openid, MAX(created_at) m FROM orders WHERE openid IS NOT NULL AND openid <> '' GROUP BY openid"
    );
    const lastApp = await query(
      "SELECT openid, MAX(created_at) m FROM appointments WHERE openid IS NOT NULL AND openid <> '' GROUP BY openid"
    );
    const phoneRows = await query(
      "SELECT openid, customer_phone phone FROM orders WHERE openid IS NOT NULL AND openid <> '' AND customer_phone IS NOT NULL AND customer_phone <> '' " +
      "UNION SELECT openid, phone FROM appointments WHERE openid IS NOT NULL AND openid <> '' AND phone IS NOT NULL AND phone <> ''"
    );
    const phoneMap = new Map();
    for (const r of phoneRows) if (!phoneMap.has(r.openid)) phoneMap.set(r.openid, r.phone);

    const openids = new Set([...custMap.keys(), ...orderAgg.map((r) => r.openid), ...appAgg.map((r) => r.openid)]);
    const out = [];
    for (const oid of openids) {
      const c = custMap.get(oid) || {};
      const oa = orderAgg.find((r) => r.openid === oid);
      const aa = appAgg.find((r) => r.openid === oid);
      const lo = lastOrd.find((r) => r.openid === oid);
      const la = lastApp.find((r) => r.openid === oid);
      const lastActive = [lo && lo.m, la && la.m].filter(Boolean).sort().pop() || null;
      out.push({
        openid: oid,
        nickname: c.nickname || '',
        avatar: c.avatar || '',
        phone: c.phone || phoneMap.get(oid) || '',
        orderCount: oa ? Number(oa.c) : 0,
        appointmentCount: aa ? Number(aa.c) : 0,
        spent: oa ? Math.round(parseFloat(oa.spent) * 100) / 100 : 0,
        lastActive
      });
    }
    out.sort((a, b) => String(b.lastActive || '').localeCompare(String(a.lastActive || '')));
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/customers/:openid', async (req, res) => {
  try {
    const openid = req.params.openid;
    const c = await get('SELECT * FROM customers WHERE openid = ?', [openid]);
    const orders = await query('SELECT * FROM orders WHERE openid = ? AND cancelled = 0 ORDER BY id DESC', [openid]);
    const appointments = await query('SELECT * FROM appointments WHERE openid = ? ORDER BY id DESC', [openid]);
    for (const o of orders) {
      if (o.package_id) { const p = await get('SELECT name FROM packages WHERE id = ?', [o.package_id]); o.packageName = p ? p.name : ''; }
      else o.packageName = '';
      o.logs = o.logs ? JSON.parse(o.logs) : [];
    }
    res.json({ customer: c || { openid }, orders, appointments });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== 5. 在线选片管理（列出 selecting 状态订单及其选片摘要）=====
router.get('/selections', async (req, res) => {
  try {
    const rows = await query(
      `SELECT o.id, o.order_no, o.customer_name, o.customer_phone, o.status,
              (SELECT COUNT(*) FROM photo_select ps WHERE ps.order_id = o.id) AS sel_count,
              (SELECT submitted FROM photo_select ps WHERE ps.order_id = o.id ORDER BY id DESC LIMIT 1) AS submitted
       FROM orders o WHERE o.status = 'selecting' AND o.cancelled = 0 ORDER BY o.id DESC`
    );
    res.json(rows.map((r) => ({ ...r, selCount: Number(r.sel_count), submitted: !!r.submitted })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== 6. 数据导出（CSV，Excel 可直接打开，零依赖）=====
const STATUS_MAP = {
  unpaid: '待付定金', deposit: '已付定金', shot: '已拍摄', selecting: '选片中',
  retouching: '精修中', delivered: '已交付', completed: '已完成', cancelled: '已作废'
};
function num(v) { return Math.round((parseFloat(v) || 0) * 100) / 100; }
function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(headers, rows) {
  const head = headers.map((h) => csvCell(h.label)).join(',');
  const body = rows.map((r) => headers.map((h) => csvCell(r[h.key])).join(',')).join('\r\n');
  return head + '\r\n' + body;
}

router.get('/orders/export', async (req, res) => {
  try {
    const rows = await query(
      `SELECT o.*, p.name AS package_name FROM orders o LEFT JOIN packages p ON p.id = o.package_id WHERE o.cancelled = 0 ORDER BY o.id DESC`
    );
    const headers = [
      { key: 'order_no', label: '订单号' }, { key: 'customer_name', label: '客户' }, { key: 'customer_phone', label: '电话' },
      { key: 'package_name', label: '套系' }, { key: 'status', label: '状态' }, { key: 'deposit', label: '定金' },
      { key: 'balance', label: '尾款' }, { key: 'total_amount', label: '应收总额' }, { key: 'paid_amount', label: '已收' },
      { key: 'shoot_date', label: '拍摄日期' }, { key: 'executor', label: '负责人' }, { key: 'created_at', label: '创建时间' }
    ];
    const data = rows.map((r) => ({
      ...r,
      status: STATUS_MAP[r.status] || r.status,
      deposit: num(r.deposit), balance: num(r.balance),
      total_amount: num(r.total_amount), paid_amount: num(r.paid_amount)
    }));
    const csv = toCsv(headers, data);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="orders.csv"');
    res.send('﻿' + csv);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/schedules/export', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM schedules ORDER BY date ASC, id ASC');
    const headers = [
      { key: 'date', label: '日期' }, { key: 'period', label: '时段' }, { key: 'status', label: '状态' },
      { key: 'order_no', label: '订单号' }, { key: 'photographer', label: '摄影师' }, { key: 'note', label: '备注' }
    ];
    const PERIOD = { full: '全天', am: '上午', pm: '下午' };
    const SSTATUS = { free: '空闲', booked: '已约', locked: '锁场' };
    const data = rows.map((r) => ({
      ...r,
      period: PERIOD[r.period] || r.period,
      status: SSTATUS[r.status] || r.status
    }));
    const csv = toCsv(headers, data);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="schedules.csv"');
    res.send('﻿' + csv);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
