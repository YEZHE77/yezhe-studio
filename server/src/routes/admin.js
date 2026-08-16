// routes/admin.js —— 商户后台：C 端客户数据管理（预约转订单 / 选片结果查看修改 / 评价审核）
// 全部需要商户登录（authRequired）；与 /api/customer 的行级隔离互补：此处为管理视角，可看全部。
import { Router } from 'express';
import { query, get, insert, run } from '../db.js';
import { authRequired, requirePerm, PERMISSIONS } from '../auth.js';
import { lunarOf } from './schedules.js';
import { isR2Enabled, isCloudStorageEnabled, getActiveProviderName, deleteMediaByUrl } from '../storage.js';
import { cfConfigured, getR2Egress } from '../cf.js';
import { getStorageUsage } from '../r2Metrics.js';
import { buildFullBackup, writeBackupToCloud } from '../backup.js';
import { runConsistencyCheck } from '../consistencyCheck.js';

const router = Router();
router.use(authRequired);

function nowISO() { return new Date().toISOString(); }

// ===== 0. 人员列表（订单执行人多选组件的数据源，复用 users 表） =====
// 返回 id / 姓名 / 角色 / 头像；头像可为空，前端用姓名首字兜底。
router.get('/personnel', async (req, res) => {
  try {
    const rows = await query(
      `SELECT id, username, name, role, avatar FROM users ORDER BY id ASC`
    );
    res.json(rows.map((u) => ({
      id: u.id,
      name: u.name || u.username,
      role: u.role || 'photographer',
      avatar: u.avatar || ''
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

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
    const period = ['full', 'half'].includes(b.period) ? b.period : (a.period || 'full');
    if (!date) return res.status(400).json({ error: '请指定拍摄日期' });

    // 定金是建立订单 + 锁定档期的前置硬条件：未收定金不得建单、不得占档期
    const deposit = parseFloat(b.deposit) || 0;
    const deposit_method = b.deposit_method || 'offline';
    if (deposit <= 0) return res.status(400).json({ error: '必须先收取定金才能建立订单并锁定档期' });

    // 冲突检测：全天(full) 与任何时段冲突；半天(half) 与全天或其它半天冲突
    const conflictRows = await query(
      "SELECT * FROM schedules WHERE date = ? AND status IN ('booked','locked')",
      [date]
    );
    const hasConflict = conflictRows.some((r) => {
      if (period === 'full' || r.period === 'full') return true;
      return r.period === period;
    });
    if (hasConflict) return res.status(409).json({ error: '该日期同时段已被占用或锁定，无法确认' });

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
    const safeParse = (v, fallback = '') => { try { return v ? JSON.parse(v) : fallback; } catch { return v || fallback; } };
    if (a.package_id) {
      const p = await get('SELECT * FROM packages WHERE id = ?', [a.package_id]);
      if (p) {
        let price = parseFloat(p.price) || 0;
        let pkgDeposit = parseFloat(p.deposit) || 0;
        let spec = null;
        if (a.spec_id) {
          try {
            const specs = p.specs ? JSON.parse(p.specs) : [];
            spec = specs.find((s) => s.id === a.spec_id) || null;
          } catch { spec = null; }
        }
        if (spec) { price = parseFloat(spec.price) || price; pkgDeposit = parseFloat(spec.deposit) || pkgDeposit; }
        package_snapshot = {
          id: p.id, name: p.name, price, deposit: pkgDeposit,
          description: p.description || '', retouch_count: p.retouch_count,
          raw_policy: p.raw_policy || '', duration: p.duration || '', cover_url: p.cover_url || '',
          category_id: p.category_id,
          spec: spec ? { id: spec.id, name: spec.name, price: parseFloat(spec.price) || 0, deposit: parseFloat(spec.deposit) || 0 } : null,
          addons: safeParse(p.addons, []), marketing: safeParse(p.marketing, {}),
          specs: safeParse(p.specs, []), questionnaire: safeParse(p.questionnaire, '')
        };
        total = price;
      }
    }
    const order_no = 'NO' + Date.now();
    const logs = JSON.stringify([{ t: nowISO(), text: '由预约 #' + a.id + ' 确认转单' }]);
    const orderName = (a.name ? a.name + ' ' : '') + (package_snapshot ? package_snapshot.name : '拍摄订单');
    const orderId = await insert(
      `INSERT INTO orders (order_no, customer_name, customer_phone, package_id, package_snapshot,
        status, deposit, balance, total_amount, paid_amount, deposit_method, openid, remark, logs, shoot_date,
        order_name, phones, time_slots, extra_items, executors, channel, date_tbd, payment_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [order_no, a.name, a.phone, a.package_id || null, JSON.stringify(package_snapshot),
        'deposit', deposit, Math.max(0, total - deposit), total, deposit, deposit_method,
        a.openid || null, a.remark || '', logs, date,
        orderName, JSON.stringify(a.phone ? [a.phone] : []), JSON.stringify([]), JSON.stringify([]),
        JSON.stringify(b.photographer ? [{ id: null, name: b.photographer, avatar: '' }] : []),
        a.source || '小程序', 0, 'deposit']
    );

    // 建单即视为已收定金，登记定金收款流水（channel：线上 online / 线下默认 cash）
    await insert(
      `INSERT INTO payments (order_id, order_no, type, amount, method, channel, note) VALUES (?,?,?,?,?,?,?)`,
      [orderId, order_no, 'deposit', deposit, deposit_method, deposit_method === 'online' ? 'online' : 'cash', '接受预约时收取定金']
    );

    await run(
      "UPDATE appointments SET status = 'confirmed', schedule_id = ?, order_id = ?, period = ?, handled_at = ? WHERE id = ?",
      [scheduleId, orderId, period, nowISO(), a.id]
    );
    // 归档该预约的「待确认」待办（预约已转订单处理完毕）
    try { await run("UPDATE todo_items SET status='done', done_at=? WHERE biz_key=? AND status='pending'", [nowISO(), `appointment_${a.id}`]); } catch (e) { console.error('[admin] 归档预约待办失败', e.message); }
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
    // 归档该预约的「待确认」待办
    try { await run("UPDATE todo_items SET status='done', done_at=? WHERE biz_key=? AND status='pending'", [nowISO(), `appointment_${a.id}`]); } catch (e) { console.error('[admin] 归档预约待办失败', e.message); }
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
// 客户资料（含手机号）敏感：需「导出客户资料」权限
router.get('/customers', requirePerm(PERMISSIONS.EXPORT_CUSTOMERS), async (req, res) => {
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
  deposit: '已付定金', shot: '已拍摄', selecting: '选片中',
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
    const { month } = req.query;
    const w = month ? 'WHERE date LIKE ?' : '';
    const rows = await query('SELECT * FROM schedules ' + w + ' ORDER BY date ASC, id ASC', month ? [month + '%'] : []);
    const headers = [
      { key: 'date', label: '日期' }, { key: 'period', label: '时段' }, { key: 'status', label: '状态' },
      { key: 'order_no', label: '订单号' }, { key: 'photographer', label: '摄影师' }, { key: 'note', label: '备注' }
    ];
    const PERIOD = { full: '全天', half: '半天' };
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

// 存储状态（Dashboard 告警横幅依据）
router.get('/storage', async (req, res) => {
  try {
    res.json({
      cloudEnabled: isCloudStorageEnabled(),
      provider: getActiveProviderName() || 'local',
      r2Enabled: isR2Enabled()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== 7. 容量管理 =====
// 业务分类标签（与上传时传入的 type 对应；保留旧命名以兼容历史 media 行）
const CATEGORY_LABELS = {
  // 新枚举（T-07）：服务端 Worker 直传与前端统一使用
  'negative': '底片',
  'retouch': '精修片',
  'client': '客片',
  'cover': '封面套系样片',
  'set': '套系样片',
  'backup': '系统备份',
  // 旧命名（历史兼容）
  'raw-negative': '底片',
  'retouched': '精修片',
  'customer': '客片',
  'cover-sample': '封面套系样片',
  'system-backup': '系统备份',
  'uncategorized': '未分类'
};
const R2_FREE_STORAGE = 10 * 1024 * 1024 * 1024; // R2 免费额度 10GB
const R2_FREE_EGRESS = 100 * 1024 * 1024 * 1024; // 免费额度 100GB/月 出流量

// COS 可选存储限额（字节，来自 COS_STORAGE_LIMIT 环境变量），未设置则为 null（不限）
function cloudLimitBytes(provider) {
  if (provider === 'r2') return R2_FREE_STORAGE;
  if (provider === 'cos') {
    const v = parseInt(process.env.COS_STORAGE_LIMIT || '', 10);
    return Number.isFinite(v) && v > 0 ? v : null;
  }
  return null;
}

// 存储告警阈值（字节）：后台可自定义（settings 表 key=storage_threshold），默认 10GB。
// 与付费套餐无关，纯业务告警开关；超阈值 → 消息页「已用空间」展示红色告警圆点。
const DEFAULT_STORAGE_THRESHOLD = 10 * 1024 * 1024 * 1024;
async function getStorageThreshold() {
  try {
    const r = await get("SELECT value FROM settings WHERE key = 'storage_threshold'");
    if (r && r.value) {
      const v = parseInt(r.value, 10);
      if (Number.isFinite(v) && v > 0) return v;
    }
  } catch (e) { /* 忽略，回退默认 */ }
  return DEFAULT_STORAGE_THRESHOLD;
}

// 按业务分类汇总（来自 media 元数据表，零 R2 遍历）
async function categoryBreakdown() {
  const rows = await query(
    `SELECT category, COUNT(*) c, COALESCE(SUM(bytes),0) b, MAX(is_public) pub
     FROM media GROUP BY category ORDER BY b DESC`
  );
  return rows.map((r) => ({
    category: r.category,
    label: CATEGORY_LABELS[r.category] || r.category,
    count: Number(r.c),
    bytes: Number(r.b),
    isPublic: !!Number(r.pub)
  }));
}

// 存储用量统计（Tab1）
router.get('/storage/stats', async (req, res) => {
  try {
    const provider = getActiveProviderName() || 'local';
    const cloud = isCloudStorageEnabled();
    const r2 = isR2Enabled();
    const cfOk = cfConfigured();
    const categories = await categoryBreakdown();

    // 总量：接入云存储 → 直接用凭据 listObjectsV2 读取「真实桶大小」（零额外令牌，每 5 分钟刷新）。
    // 未接入（本地模式）→ 回退 media 汇总并标注为估算。
    let totalUsedBytes = categories.reduce((s, c) => s + c.bytes, 0);
    let totalEstimated = !cloud;
    let objectCount = null;
    let updatedAt = new Date().toISOString();
    let delayNote = cloud ? '按对象存储真实桶大小统计（每 5 分钟刷新一次）。' : '本地临时存储，无配额概念。';
    if (cloud) {
      const st = await getStorageUsage();
      if (st) {
        totalUsedBytes = st.totalBytes;
        objectCount = st.objectCount;
        totalEstimated = false;
        updatedAt = st.fetchedAt;
      } else {
        // 已配置但读取失败（如凭据临时失效）：退回 media 估算并提示
        delayNote = '真实桶大小读取失败，暂按已登记媒资估算。';
      }
    }

    // 出流量（可选增强）：仅 R2 + 配置了 CF analytics 令牌时显示
    let egress = null;
    if (r2 && cfOk) {
      const eg = await getR2Egress();
      if (eg) egress = { usedBytes: eg.bytes, limitBytes: R2_FREE_EGRESS, delayNote: eg.note };
    }

    res.json({
      provider,
      cloudEnabled: cloud,
      r2Enabled: r2,
      cfConfigured: cfOk,
      limitBytes: cloudLimitBytes(provider), // 本地 / 未设限额则为 null
      totalUsedBytes,
      totalEstimated,
      objectCount,
      categories,
      egress,
      delayNote,
      updatedAt,
      alertThreshold: await getStorageThreshold(), // 自定义告警阈值（字节，后台可配）
      exceeded: totalUsedBytes > (await getStorageThreshold()) // 是否已超阈值（驱动告警红点）
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 存储告警阈值配置（后台「容量管理」页读写；存 settings 表 key=storage_threshold，单位字节）
router.put('/storage/threshold', async (req, res) => {
  try {
    const v = parseInt(req.body && req.body.threshold, 10);
    if (!Number.isFinite(v) || v <= 0) return res.status(400).json({ error: '阈值需为正整数（字节）' });
    const exists = await get("SELECT key FROM settings WHERE key = 'storage_threshold'");
    if (exists) await run("UPDATE settings SET value = ? WHERE key = 'storage_threshold'", [String(v)]);
    else await insert("INSERT INTO settings (key, value) VALUES (?, ?)", ['storage_threshold', String(v)]);
    res.json({ ok: true, threshold: v });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 图片流量（Tab2）—— CDN 出流量（近似，需 CF analytics 令牌）
router.get('/storage/traffic', async (req, res) => {
  try {
    const provider = getActiveProviderName() || 'local';
    const r2 = isR2Enabled();
    const cfOk = cfConfigured();
    let usedBytes = null;
    let fetchedAt = null;
    let note = null;
    if (r2 && cfOk) {
      const eg = await getR2Egress();
      if (eg) { usedBytes = eg.bytes; fetchedAt = eg.fetchedAt; note = eg.note; }
    }
    res.json({
      provider,
      cloudEnabled: isCloudStorageEnabled(),
      r2Enabled: r2,
      cfConfigured: cfOk,
      limitBytes: r2 ? R2_FREE_EGRESS : null,
      usedBytes,
      delayNote: note || (r2
        ? '统计当月累计出流量；需配置 CF_API_TOKEN + CF_ACCOUNT_ID（仅只读 analytics 权限）方可显示。'
        : '当前存储后端非 Cloudflare R2，出流量请在对应云厂商（如腾讯云 COS）控制台查看。'),
      updatedAt: fetchedAt
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 废弃图片清单（未被任何作品/套系封面或相册引用）—— 供「快速清理空间」勾选
router.get('/storage/orphans', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
    const rows = await query(
      `SELECT m.id, m.url, m.category, m.bytes, m.is_public, m.created_at
       FROM media m
       WHERE m.url NOT IN (
         SELECT cover_url FROM works WHERE cover_url IS NOT NULL AND cover_url <> ''
         UNION SELECT cover_url FROM packages WHERE cover_url IS NOT NULL AND cover_url <> ''
         UNION SELECT photo_url FROM albums WHERE photo_url IS NOT NULL AND photo_url <> ''
       )
       ORDER BY m.bytes DESC LIMIT ?`,
      [limit]
    );
    const list = rows.map((r) => ({
      id: r.id,
      url: r.url,
      category: r.category,
      label: CATEGORY_LABELS[r.category] || r.category,
      bytes: Number(r.bytes),
      isPublic: !!Number(r.is_public),
      createdAt: r.created_at
    }));
    res.json({
      list,
      totalBytes: list.reduce((s, x) => s + x.bytes, 0),
      note: '以下图片未被任何封面/相册引用，可安全清理；删除前请确认无业务依赖（公开图片尤其谨慎）。'
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 显式删除（容量清理用）：仅接受管理员勾选的 URL 列表，绝不自动后台删除
router.post('/storage/delete', async (req, res) => {
  try {
    const urls = Array.isArray(req.body && req.body.urls) ? req.body.urls.slice(0, 200) : [];
    if (!urls.length) return res.status(400).json({ error: '未提供任何待删除 URL' });
    const results = [];
    for (const u of urls) {
      if (typeof u !== 'string' || !u) continue;
      results.push(await deleteMediaByUrl(u));
    }
    res.json({
      ok: true,
      deleted: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 上传令牌下发（管理员登录后）；仅用于直传 Worker 闸门，不等于 R2 凭证。未配置则返回 null。
router.get('/upload-token', async (req, res) => {
  try {
    res.json({ token: process.env.UPLOAD_TOKEN || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 媒资元数据登记（Worker 直传路径绕过了 /api/upload，需前端回调登记；唯一索引保证幂等）
router.post('/media/register', async (req, res) => {
  try {
    const { url, category, bytes, isPublic } = req.body || {};
    if (!url) return res.status(400).json({ error: '缺少 url' });
    await run(
      `INSERT INTO media (url, category, bytes, is_public, created_at) VALUES (?, ?, ?, ?, ?)`,
      [url, category || 'uncategorized', Number(bytes) || 0, isPublic ? 1 : 0, new Date().toISOString()]
    );
    res.json({ ok: true });
  } catch (e) {
    // 唯一冲突（重复登记）等一律视为成功，保证幂等
    console.error('[admin] media/register 忽略', e.message);
    res.json({ ok: true });
  }
});

// ===== 17. 双重备份 =====
// 17.1 手动导出全量业务 JSON（管理员下载到本地）。绝不含任何明文密钥。
router.get('/backup/export', async (req, res) => {
  try {
    const data = await buildFullBackup();
    const json = JSON.stringify(data, null, 2);
    const fname = `yezhe-backup-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.send(json);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 17.2 立即触发一次云端 /backup 目录写入（定时任务之外的手动兜底）
router.post('/backup/run', async (req, res) => {
  try {
    if (!isCloudStorageEnabled()) return res.status(400).json({ error: '未配置云端存储（COS / R2），无法写入云端备份' });
    const r = await writeBackupToCloud();
    if (r.ok) res.json(r);
    else res.status(500).json({ error: r.reason });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 18. 数据一致性巡检：手动触发一次（与每日凌晨定时任务同一套逻辑）
router.post('/consistency-check', async (req, res) => {
  try {
    const r = await runConsistencyCheck();
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 18.1 查询最近一次巡检异常清单（consistency_issues 只存最近一次，故直接全量返回）
router.get('/consistency-check/issues', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM consistency_issues ORDER BY id ASC');
    const lastRun = rows.length ? rows[0].check_run : null;
    res.json({ check_run: lastRun, total: rows.length, issues: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
