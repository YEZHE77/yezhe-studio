// routes/orders.js —— 订单中心（全生命周期 / 客户档案 / 收款款项 / 操作日志 / 作废 / 退款）
import { Router } from 'express';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { query, get, insert, run } from '../db.js';
import { shareBaseUrl } from '../shareUtil.js';
import { generateMiniProgramQr } from '../miniQr.js';
import { authRequired, requireRole } from '../auth.js';
import { parseRow } from '../schema.js';
import { scheduleConflict, occupySchedule, releaseSchedule, conflictText, capacityConflict } from './schedules.js';

const router = Router();
const JSON_COLS = ['package_snapshot', 'addons_snapshot', 'logs', 'phones', 'time_slots', 'extra_items', 'executors', 'order_photos'];

function nowISO() { return new Date().toISOString(); }

// —— 状态筛选 → SQL OR 条件片段（列表 GET / 与导出 export 共用，避免两处口径分叉） ——
// 业务节点口径与前端 OrderDetail/Todo/Orders 筛选一致：
//   未付定金 unpaid / 已付定金 deposit_pending / 等待拍摄 waiting_shoot / 待选片 todo_selecting(shot+selecting)
//   精修中 todo_retouch / 待交付 todo_deliver / 已交付 delivered / 已完成 completed
function buildStatusOrs(statusList) {
  const ors = [];
  const params = [];
  for (const s of statusList) {
    if (s === 'all' || s === '') continue;
    if (s === 'unpaid') { ors.push('payment_status = ?'); params.push('unpaid'); }
    else if (s === 'pending_confirm') { ors.push('(status = ? AND date_tbd = 1)'); params.push('deposit'); }
    else if (s === 'tbd_date') { ors.push('date_tbd = 1'); }
    else if (s === 'unpaid_deposit') { ors.push('payment_status = ?'); params.push('unpaid'); }
    else if (s === 'has_balance') { ors.push('balance > 0'); }
    else if (s === 'waiting_shoot') { ors.push("payment_status = 'deposit' AND status = 'deposit' AND (logs LIKE '%沟通确认%' OR logs LIKE '%等待拍摄%' OR logs LIKE '%拍摄执行%')"); }
    else if (s === 'deposit_pending') { ors.push("payment_status = 'deposit' AND status = 'deposit' AND (logs IS NULL OR logs = '' OR (logs NOT LIKE '%沟通确认%' AND logs NOT LIKE '%等待拍摄%' AND logs NOT LIKE '%拍摄执行%'))"); }
    else if (s === 'waiting_raw') { ors.push('status = ?'); params.push('shot'); }
    else if (s === 'selecting') { ors.push('status = ?'); params.push('selecting'); }
    else if (s === 'todo_selecting') { ors.push("status IN ('shot', 'selecting')"); }
    else if (s === 'retouching') { ors.push('status = ?'); params.push('retouching'); }
    else if (s === 'todo_retouch') { ors.push("status = 'retouching' AND (logs IS NULL OR logs = '' OR (logs NOT LIKE '%精修完成%' AND logs NOT LIKE '%全部精修完成%' AND logs NOT LIKE '%底片打包%' AND logs NOT LIKE '%原片打包%'))"); }
    else if (s === 'todo_deliver') { ors.push("status = 'retouching' AND (logs LIKE '%精修完成%' OR logs LIKE '%全部精修完成%' OR logs LIKE '%底片打包%' OR logs LIKE '%原片打包%')"); }
    else if (s === 'waiting_retouch') { ors.push('status = ?'); params.push('retouching'); }
    else if (s === 'downloading') { ors.push('status = ?'); params.push('delivered'); }
    else if (s === 'pending_review') { ors.push('status = ?'); params.push('completed'); }
    else if (s === 'completed') { ors.push('status = ?'); params.push('completed'); }
    else if (s === 'cancelled') { ors.push('status = ?'); params.push('cancelled'); }
    else if (s === 'deposit_paid') { ors.push('payment_status = ?'); params.push('deposit'); }
    else { ors.push('status = ?'); params.push(s); }
  }
  return { ors, params };
}

// —— 收款渠道（线下区分微信/支付宝/现金/银行转账；线上统一 online） ——
const CHANNEL_LABEL = { wechat: '微信', alipay: '支付宝', cash: '现金', bank: '银行转账', online: '线上' };
function normChannel(method, channel) {
  const m = method === 'online' ? 'online' : 'offline';
  if (m === 'online') return 'online';
  return ['wechat', 'alipay', 'cash', 'bank'].includes(channel) ? channel : 'cash';
}
function channelLabel(method, channel) {
  const m = method === 'online' ? 'online' : 'offline';
  if (m === 'online') return '线上';
  const name = CHANNEL_LABEL[normChannel(m, channel)] || '其他';
  return '线下·' + name;
}

// —— 新增订单弹窗字段的规范化助手（多值字段统一 JSON 文本落库） ——
const PAYMENT_STATUS = ['unpaid', 'deposit', 'paid']; // 未付定金 / 已付定金 / 已付全款
function normPhones(v) {
  const arr = Array.isArray(v) ? v : (v ? [v] : []);
  return arr.map((x) => String(x || '').trim()).filter(Boolean);
}
function normSlots(v) {
  const arr = Array.isArray(v) ? v : [];
  return arr.map((x) => String(x || '').trim()).filter(Boolean);
}
function normExtras(v) {
  const arr = Array.isArray(v) ? v : [];
  return arr
    .map((x) => ({ name: String((x && x.name) || '').trim(), amount: parseFloat(x && x.amount) || 0 }))
    .filter((x) => x.name || x.amount);
}
function normExecutors(v) {
  const arr = Array.isArray(v) ? v : [];
  return arr
    .map((x) => (typeof x === 'object' && x
      ? { id: x.id ?? null, name: String(x.name || '').trim(), avatar: String(x.avatar || '') }
      : { id: null, name: String(x || '').trim(), avatar: '' }))
    .filter((x) => x.name || x.id);
}

async function appendLog(orderId, text) {
  const cur = await get('SELECT logs FROM orders WHERE id = ?', [orderId]);
  let logs = [];
  if (cur && cur.logs) { try { logs = JSON.parse(cur.logs); } catch { logs = []; } }
  logs.push({ t: nowISO(), text });
  await run('UPDATE orders SET logs = ? WHERE id = ?', [JSON.stringify(logs), orderId]);
}

// 列表（分页 + 搜索 + 状态/执行人/排序/时间范围筛选；全部后端过滤）
router.get('/', authRequired, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 12));
    const { status, statuses, q, executor, executorIds, types, sort, shootFrom, shootTo, orderFrom, orderTo } = req.query;
    const where = ['cancelled = 0', 'is_deleted = 0'];
    const params = [];
    // 状态过滤：单选（status）兼容旧链接；多选（statuses）逗号分隔，每个元素按同样的映射规则处理
    const statusList = [];
    if (statuses) statusList.push(...String(statuses).split(',').filter(Boolean));
    if (status) statusList.push(String(status));
    if (statusList.length) {
      const { ors, params: sp } = buildStatusOrs(statusList);
      if (ors.length) { where.push('(' + ors.join(' OR ') + ')'); params.push(...sp); }
    }
    if (q) {
      // 搜索：客户姓名 / 订单编号 / 订单名称 / 套系名(package_snapshot 内含 name)
      where.push('(customer_name LIKE ? OR order_no LIKE ? OR COALESCE(order_name, \'\') LIKE ? OR COALESCE(package_snapshot, \'\') LIKE ?)');
      params.push('%' + q + '%', '%' + q + '%', '%' + q + '%', '%' + q + '%');
    }
    // 执行人过滤：单选（executor）兼容旧；多选（executorIds）逗号分隔，按 executors JSON 中的 id 精准匹配
    const execList = [];
    if (executorIds) execList.push(...String(executorIds).split(',').filter(Boolean));
    if (executor) execList.push(String(executor));
    if (execList.length) {
      const ors = [];
      for (const eid of execList) {
        const num = Number(eid);
        if (!Number.isFinite(num)) continue;
        ors.push('executors LIKE ?');
        params.push('%"id":' + num + ',"name"%');
      }
      if (ors.length) where.push('(' + ors.join(' OR ') + ')');
    }
    // 订单类型过滤（普通/促销/拼团）：前端多选逗号分隔；尚未落库该字段时存根为全部匹配
    const typeList = types ? String(types).split(',').filter(Boolean) : [];
    if (typeList.length && !typeList.includes('all')) {
      // 套系级营销字段 marketing JSON 含 type（normal/promo/group）；无字段时不过滤
      // 暂以 package_snapshot LIKE 兼容：normal → 'normal'；promo → 'promo'；group → 'group'
      const ors = [];
      for (const t of typeList) {
        if (t === 'normal') ors.push("COALESCE(package_snapshot,'') LIKE '%\"type\":\"normal\"%'");
        else if (t === 'promo') ors.push("COALESCE(package_snapshot,'') LIKE '%\"type\":\"promo\"%'");
        else if (t === 'group') ors.push("COALESCE(package_snapshot,'') LIKE '%\"type\":\"group\"%'");
      }
      if (ors.length) where.push('(' + ors.join(' OR ') + ')');
    }
    // 子账号权限：摄影师仅看到分配给自己的订单（executors JSON 按 name 匹配）；管理员全部可见
    if (req.user && req.user.role === 'photographer') {
      const me = await get('SELECT name FROM users WHERE id = ?', [req.user.uid]);
      if (me && me.name) {
        const esc = String(me.name).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        where.push('executors LIKE ?');
        params.push('%"name":"' + esc + '"%');
      }
    }
    if (shootFrom) { where.push('shoot_date >= ?'); params.push(shootFrom); }
    if (shootTo) { where.push('shoot_date <= ?'); params.push(shootTo); }
    if (orderFrom) { where.push('created_at >= ?'); params.push(orderFrom + 'T00:00:00Z'); }
    if (orderTo) { where.push('created_at <= ?'); params.push(orderTo + 'T23:59:59Z'); }
    const whereSql = where.join(' AND ');

    const totalRow = await get('SELECT COUNT(*) AS c FROM orders WHERE ' + whereSql, params);
    const total = Number(totalRow.c) || 0;

    let orderSql = 'id DESC';
    if (sort === 'shoot_date') orderSql = "(shoot_date IS NULL OR shoot_date = '') ASC, shoot_date ASC";
    else if (sort === 'amount') orderSql = 'total_amount DESC';
    else if (sort === 'order_time') orderSql = 'id DESC';
    else if (sort === 'recent' || sort === 'updated') orderSql = 'id DESC';

    const rows = await query(
      `SELECT *,
        (SELECT c.name FROM packages p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = orders.package_id) AS category_name,
        (SELECT stars FROM evaluates WHERE order_id = orders.id ORDER BY created_at DESC LIMIT 1) AS eval_stars,
        (SELECT created_at FROM evaluates WHERE order_id = orders.id ORDER BY created_at DESC LIMIT 1) AS eval_at,
        (SELECT submitted FROM photo_select WHERE order_id = orders.id ORDER BY updated_at DESC LIMIT 1) AS selection_submitted
       FROM orders WHERE ${whereSql} ORDER BY ${orderSql} LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    );
    res.json({
      list: rows.map((r) => parseRow(r, JSON_COLS)),
      total, page, pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 到期 / 选片超时统计（顶部预警栏）
router.get('/stats', authRequired, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const exp = await get(
      `SELECT COUNT(*) AS c FROM orders WHERE cancelled = 0 AND is_deleted = 0
        AND ((raw_expire_at IS NOT NULL AND raw_expire_at <> '' AND raw_expire_at > ? AND raw_expire_at <= ?)
          OR (retouch_expire_at IS NOT NULL AND retouch_expire_at <> '' AND retouch_expire_at > ? AND retouch_expire_at <= ?))`,
      [today, soon, today, soon]
    );
    const sel = await get(
      `SELECT COUNT(*) AS c FROM orders WHERE cancelled = 0 AND is_deleted = 0
        AND shoot_date IS NOT NULL AND shoot_date <> '' AND shoot_date < ?
        AND NOT EXISTS (SELECT 1 FROM photo_select ps WHERE ps.order_id = orders.id AND ps.submitted = 1)`,
      [today]
    );
    // 订单总数（筛选栏「所有订单 (N)」用，后端动态返回，前端禁止硬编码）
    const tot = await get('SELECT COUNT(*) AS c FROM orders WHERE cancelled = 0 AND is_deleted = 0');

    // 工作台「待办事项」分类统计（与详情页 build11Steps 一致：以「沟通确认」是否已完成为分界）
    //   已付定金 = 已付定金但「沟通确认」未完成；等待拍摄 = 已付定金且「沟通确认」已完成
    //   待选片 = shot/selecting；精修中 = retouching 且未精修完成；待交付 = retouching 且已精修完成/底片打包
    const todoWhere = 'WHERE cancelled = 0 AND is_deleted = 0';
    const [depositRow, waitingShootRow, selectingRow, retouchingRow, toDeliverRow] = await Promise.all([
      get(`SELECT COUNT(*) AS c FROM orders ${todoWhere} AND payment_status = 'deposit' AND status = 'deposit' AND (logs IS NULL OR logs = '' OR (logs NOT LIKE '%沟通确认%' AND logs NOT LIKE '%等待拍摄%' AND logs NOT LIKE '%拍摄执行%'))`),
      get(`SELECT COUNT(*) AS c FROM orders ${todoWhere} AND payment_status = 'deposit' AND status = 'deposit' AND (logs LIKE '%沟通确认%' OR logs LIKE '%等待拍摄%' OR logs LIKE '%拍摄执行%')`),
      get(`SELECT COUNT(*) AS c FROM orders ${todoWhere} AND status IN ('shot', 'selecting')`),
      get(`SELECT COUNT(*) AS c FROM orders ${todoWhere} AND status = 'retouching' AND (logs IS NULL OR logs = '' OR (logs NOT LIKE '%精修完成%' AND logs NOT LIKE '%全部精修完成%' AND logs NOT LIKE '%底片打包%' AND logs NOT LIKE '%原片打包%'))`),
      get(`SELECT COUNT(*) AS c FROM orders ${todoWhere} AND status = 'retouching' AND (logs LIKE '%精修完成%' OR logs LIKE '%全部精修完成%' OR logs LIKE '%底片打包%' OR logs LIKE '%原片打包%')`)
    ]);

    res.json({
      expiringSoon: Number(exp.c) || 0,
      selectionTimeout: Number(sel.c) || 0,
      total: Number(tot.c) || 0,
      todo: {
        deposit: Number(depositRow.c) || 0,
        waitingShoot: Number(waitingShootRow.c) || 0,
        selecting: Number(selectingRow.c) || 0,
        retouching: Number(retouchingRow.c) || 0,
        toDeliver: Number(toDeliverRow.c) || 0
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 回收站列表（仅管理员可见）
router.get('/recycle', authRequired, requireRole(['admin']), async (req, res) => {
  try {
    const rows = await query('SELECT * FROM orders WHERE is_deleted = 1 ORDER BY deleted_at DESC');
    res.json(rows.map((r) => parseRow(r, JSON_COLS)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 导出 Excel 兼容 CSV（UTF-8 BOM，Excel 中文正常；字段对齐 spec 订单列表列）
router.get('/export', authRequired, async (req, res) => {
  try {
    const { status, statuses, q, executor, shootFrom, shootTo } = req.query;
    const where = ['cancelled = 0', 'is_deleted = 0'];
    const params = [];
    // 状态过滤：与列表 GET / 共用 buildStatusOrs（前端导出传 statuses，逗号分隔）
    const statusList = [];
    if (statuses) statusList.push(...String(statuses).split(',').filter(Boolean));
    if (status) statusList.push(String(status));
    if (statusList.length) {
      const { ors, params: sp } = buildStatusOrs(statusList);
      if (ors.length) { where.push('(' + ors.join(' OR ') + ')'); params.push(...sp); }
    }
    if (q) {
      where.push('(customer_name LIKE ? OR order_no LIKE ? OR COALESCE(order_name, \'\') LIKE ? OR COALESCE(package_snapshot, \'\') LIKE ?)');
      params.push('%' + q + '%', '%' + q + '%', '%' + q + '%', '%' + q + '%');
    }
    if (executor) { where.push('executors LIKE ?'); params.push('%"id":' + Number(executor) + ',"name"%'); }
    if (req.user && req.user.role === 'photographer') {
      const me = await get('SELECT name FROM users WHERE id = ?', [req.user.uid]);
      if (me && me.name) {
        const esc = String(me.name).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        where.push('executors LIKE ?');
        params.push('%"name":"' + esc + '"%');
      }
    }
    if (shootFrom) { where.push('shoot_date >= ?'); params.push(shootFrom); }
    if (shootTo) { where.push('shoot_date <= ?'); params.push(shootTo); }
    const rows = await query(
      'SELECT * FROM orders WHERE ' + where.join(' AND ') + ' ORDER BY id DESC',
      params
    );
    const STATUS_LABEL = { deposit: '已付定金', shot: '已拍摄', selecting: '选片中', retouching: '精修中', delivered: '已交付', completed: '已完成', cancelled: '已关闭' };
    const PAY_LABEL = { unpaid: '未付定金', deposit: '已付定金', paid: '全款已付' };
    const safeParse = (v) => { try { return v ? JSON.parse(v) : null; } catch { return null; } };
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const header = ['订单编号', '客户姓名', '联系电话', '套系（规格）', '拍摄日期', '摄影师', '订单状态', '支付状态', '实付金额', '创建时间'];
    const lines = [header.map(esc).join(',')];
    for (const r of rows) {
      const snap = safeParse(r.package_snapshot);
      const pkgName = snap
        ? [snap.name, snap.spec_name || (snap.spec && snap.spec.name) || ''].filter(Boolean).join('｜')
        : '';
      const statusLabel = (() => {
        const s = r.status;
        // deposit / retouching 按 logs 细分（与前端 stageLabel / 待办 Tab 口径一致）
        if (s === 'deposit' || s === 'retouching') {
          let logs = [];
          try { logs = r.logs ? JSON.parse(r.logs) : []; } catch { logs = []; }
          if (s === 'deposit') {
            const hasConfirm = logs.some((l) => (l && l.text || '').includes('沟通确认'));
            return hasConfirm ? '等待拍摄' : '已付定金';
          }
          const hasFinish = logs.some((l) => (l && l.text || '').match(/精修完成|全部精修完成|底片打包|原片打包/));
          return hasFinish ? '待交付' : '精修中';
        }
        return STATUS_LABEL[s] || s || '';
      })();
      const payLabel = (Number(r.refund_amount) > 0 ? '已退款' : (PAY_LABEL[r.payment_status] || r.payment_status || ''));
      lines.push([
        r.order_no, r.customer_name || r.order_name || '', r.customer_phone || '',
        pkgName, r.shoot_date || '待定', r.executor || '',
        statusLabel, payLabel, r.paid_amount != null ? Number(r.paid_amount).toFixed(2) : '0.00',
        (r.created_at || '').toString().slice(0, 10)
      ].map(esc).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="orders.csv"');
    res.send('\ufeff' + lines.join('\r\n'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 详情（含收款流水）
router.get('/:id', authRequired, async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    const order = parseRow(o, JSON_COLS);
    const payments = await query('SELECT * FROM payments WHERE order_id = ? ORDER BY created_at ASC', [o.id]);
    let pkgName = '';
    if (o.package_id) { const p = await get('SELECT name FROM packages WHERE id = ?', [o.package_id]); pkgName = p ? p.name : ''; }
    res.json({ ...order, payments, packageName: pkgName });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 创建（自动套系快照 + 计算应收）
router.post('/', authRequired, requireRole(['admin', 'photographer', 'finance']), async (req, res) => {
  try {
    const b = req.body;
    let package_snapshot = null, total = 0, addons = [];
    const safeParse = (v, fallback = '') => { try { return v ? JSON.parse(v) : fallback; } catch { return v || fallback; } };
    // 手动改价：前端可覆盖套系价格 / 定金，未传则用套系库默认值
    const overridePrice = b.package_price !== undefined && b.package_price !== null && b.package_price !== '';
    if (b.package_id) {
      const p = await get('SELECT * FROM packages WHERE id = ?', [b.package_id]);
      if (p) {
        const usePrice = overridePrice ? (parseFloat(b.package_price) || 0) : (parseFloat(p.price) || 0);
        package_snapshot = {
          id: p.id, name: p.name, price: usePrice, list_price: parseFloat(p.price) || 0, deposit: p.deposit,
          description: p.description || '', retouch_count: p.retouch_count,
          raw_policy: p.raw_policy || '', duration: p.duration || '', cover_url: p.cover_url || '',
          category_id: p.category_id,
          addons: safeParse(p.addons, []), marketing: safeParse(p.marketing, {}),
          specs: safeParse(p.specs, []), questionnaire: safeParse(p.questionnaire, ''),
          // details 含加片费 / 加片优惠 / 服务模板等，必须一并快照，选片核算加片费只读快照（验收⑦）
          details: safeParse(p.details, {}),
          snapshot_at: nowISO()
        };
        total += usePrice;
        if (b.addons && b.addons.length) {
          addons = b.addons;
          total += addons.reduce((s, a) => s + (parseFloat(a.price) || 0), 0);
        }
      }
    }
    // 其他消费计入应收总额
    const extra_items = normExtras(b.extra_items);
    const extraTotal = extra_items.reduce((s, x) => s + x.amount, 0);

    const payment_status = PAYMENT_STATUS.includes(b.payment_status) ? b.payment_status : 'deposit';
    const deposit = parseFloat(b.deposit) || 0;
    // 「未付定金」= 意向订单，允许定金为 0；其余收款状态仍要求定金大于 0
    if (payment_status === 'deposit' && deposit <= 0) {
      return res.status(400).json({ error: '收款状态为「已付定金」时，定金必须大于 0' });
    }
    if (!package_snapshot) total = deposit + (parseFloat(b.balance) || 0);
    total += extraTotal;
    // 实收金额由收款状态推导：未付=0 / 已付定金=定金 / 已付全款=应收总额
    const paid = payment_status === 'unpaid' ? 0 : (payment_status === 'paid' ? total : deposit);
    const balance = Math.max(0, total - paid);

    const order_no = b.order_no || ('NO' + Date.now());
    const logs = JSON.stringify([{ t: nowISO(), text: '创建订单' }]);
    const groom = (b.groom_name || '').trim();
    const bride = (b.bride_name || '').trim();
    const phones = normPhones(b.customerPhoneList ?? b.phones ?? b.customer_phone);
    const time_slots = normSlots(b.time_slots);
    const executors = normExecutors(b.executors);
    const date_tbd = b.date_tbd ? 1 : 0;
    const shoot_date = date_tbd ? '' : (b.shoot_date || '');
    // 档期时长类型 full 全天 / half 半天（默认 full，与 schedules.period 一致）
    const period = ['full', 'half'].includes(b.period) ? b.period : 'full';
    const customer_name = groom || bride
      ? [groom, bride].filter(Boolean).join(' & ')
      : (b.customerName ?? b.customer_name ?? '');
    const order_name = (b.order_name || '').trim() || (customer_name ? customer_name + ' 拍摄订单' : '未命名订单');
    // 【订单 → 档期】建单前冲突检测：所选拍摄日期若已被其它订单占用或手动锁场，返回 409 供前端弹冲突警告（验收③）
    // 前端二次确认后可带 force=true 强行占用
    const force = !!b.force;
    if (shoot_date && !date_tbd && !force) {
      const hit = await scheduleConflict(shoot_date, order_no);
      if (hit) {
        return res.status(409).json({
          error: conflictText(hit), code: 'CONFLICT', forcible: true,
          conflict: { id: hit.id, date: hit.date, status: hit.status, order_no: hit.order_no || '' }
        });
      }
      // 单日接单上限：已约满的日期同样返回 409，前端弹窗提示（可 force 强行占用）
      const capHit = await capacityConflict(shoot_date, order_no, executors[0] && executors[0].id);
      if (capHit) {
        return res.status(409).json({
          error: `${shoot_date} 当日已约满（${capHit.count}/${capHit.limit}${capHit.perPhotographer ? '，按摄影师隔离' : ''}），无法继续预约`,
          code: 'CAPACITY_FULL', forcible: true, capacity: capHit
        });
      }
    }
    const id = await insert(
      `INSERT INTO orders (order_no, customer_name, customer_phone, package_id, package_snapshot, addons_snapshot, status,
        deposit, balance, deposit_method, balance_method, shoot_date, executor, total_amount, paid_amount, remark, logs,
        groom_name, bride_name, address,
        order_name, phones, time_slots, extra_items, executors, channel, channel_id, date_tbd, period, payment_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        order_no, customer_name, phones[0] || '', b.package_id || null,
        JSON.stringify(package_snapshot), JSON.stringify(addons), 'deposit',
        deposit, balance, b.deposit_method || 'offline', b.balance_method || 'offline',
        shoot_date, executors.map((x) => x.name).filter(Boolean).join('、'), total, paid, b.remark || '', logs,
        groom, bride, b.address || '',
        order_name, JSON.stringify(phones), JSON.stringify(time_slots), JSON.stringify(extra_items),
        JSON.stringify(executors), b.channel || '', b.channel_id || null, date_tbd, period, payment_status
      ]
    );
    // 按收款状态登记流水：已付定金→定金一笔；已付全款→定金 + 尾款；未付定金→不登记
    if (payment_status !== 'unpaid') {
      if (deposit > 0) {
        await insert(
          `INSERT INTO payments (order_id, order_no, type, amount, method, channel, note) VALUES (?,?,?,?,?,?,?)`,
          [id, order_no, 'deposit', deposit, b.deposit_method || 'offline', normChannel(b.deposit_method, b.deposit_channel), '创建订单时收取定金']
        );
      }
      if (payment_status === 'paid') {
        const rest = Math.max(0, total - deposit);
        if (rest > 0) {
          await insert(
            `INSERT INTO payments (order_id, order_no, type, amount, method, channel, note) VALUES (?,?,?,?,?,?,?)`,
            [id, order_no, 'balance', rest, b.balance_method || 'offline', normChannel(b.balance_method, b.balance_channel), '创建订单时结清全款']
          );
        }
      }
    }
    // 【订单 → 档期】建单成功即占用档期（日期待定不占；验收③④的基础）
    if (shoot_date && !date_tbd) {
      try {
        await occupySchedule(shoot_date, order_no, {
          period: ['full', 'half'].includes(b.period) ? b.period : 'full',
          periods: time_slots, photographer: executors.map((x) => x.name).filter(Boolean).join('、'),
          executor_id: executors[0] && executors[0].id, executor_name: (executors[0] && executors[0].name) || '',
          groom_name: groom, bride_name: bride, contact_phone: phones[0] || '', address: b.address || '',
          note: order_name
        }, force);
        await appendLog(id, `占用档期 ${shoot_date}`);
      } catch (err) {
        if (err.code !== 'CONFLICT') throw err;
        await appendLog(id, `档期占用失败：${err.message}`);
      }
    }
    res.json({ id, order_no });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// —— 进度条控制：追加订单操作日志（下一步·日志步；日志文本与 11 步关键词对应） ——
router.post('/:id/logs', authRequired, requireRole(['admin', 'photographer', 'finance']), async (req, res) => {
  try {
    const text = String((req.body && req.body.text) || '').trim();
    if (!text) return res.status(400).json({ error: '日志内容不能为空' });
    const cur = await get('SELECT id FROM orders WHERE id = ?', [req.params.id]);
    if (!cur) return res.status(404).json({ error: '订单不存在' });
    await appendLog(req.params.id, text);
    const updated = await get('SELECT logs FROM orders WHERE id = ?', [req.params.id]);
    let logs = [];
    if (updated && updated.logs) { try { logs = JSON.parse(updated.logs); } catch { logs = []; } }
    res.json({ logs });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// —— 进度条控制：撤销最后一条日志（上一步·日志步） ——
router.post('/:id/logs/undo', authRequired, requireRole(['admin', 'photographer', 'finance']), async (req, res) => {
  try {
    const cur = await get('SELECT logs FROM orders WHERE id = ?', [req.params.id]);
    if (!cur) return res.status(404).json({ error: '订单不存在' });
    let logs = [];
    if (cur.logs) { try { logs = JSON.parse(cur.logs); } catch { logs = []; } }
    logs.pop();
    await run('UPDATE orders SET logs = ? WHERE id = ?', [JSON.stringify(logs), req.params.id]);
    res.json({ logs });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 更新字段（推进阶段 / 改派 / 备注）
router.put('/:id', authRequired, requireRole(['admin', 'photographer', 'finance']), async (req, res) => {
  try {
    const b = req.body;
    const cur = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!cur) return res.status(404).json({ error: '订单不存在' });
    const status = b.status ?? cur.status;
    if (status === 'unpaid') return res.status(400).json({ error: '预约转单已统一为「已付定金」，不可使用待付定金状态' });
    const groom = (b.groom_name ?? cur.groom_name ?? '').trim();
    const bride = (b.bride_name ?? cur.bride_name ?? '').trim();
    const customer_name = groom || bride ? [groom, bride].filter(Boolean).join(' & ') : (b.customer_name ?? cur.customer_name);
    // 新增订单弹窗新增字段：未传则保留原值（JSON 列按原文本回写）
    const keepJSON = (val, normalize, curText) => (val === undefined ? (curText ?? null) : JSON.stringify(normalize(val)));
    const phonesText = keepJSON(b.phones, normPhones, cur.phones);
    const slotsText = keepJSON(b.time_slots, normSlots, cur.time_slots);
    const extrasText = keepJSON(b.extra_items, normExtras, cur.extra_items);
    const execsText = keepJSON(b.executors, normExecutors, cur.executors);
    const firstPhone = b.phones !== undefined ? (normPhones(b.phones)[0] || '') : (b.customer_phone ?? cur.customer_phone);
    const execText = b.executors !== undefined
      ? normExecutors(b.executors).map((x) => x.name).filter(Boolean).join('、')
      : (b.executor ?? cur.executor);
    const date_tbd = b.date_tbd === undefined ? cur.date_tbd : (b.date_tbd ? 1 : 0);
    const shoot_date = date_tbd ? '' : (b.shoot_date ?? cur.shoot_date);
    const payment_status = PAYMENT_STATUS.includes(b.payment_status) ? b.payment_status : (cur.payment_status || 'deposit');
    // 档期时长类型 full 全天 / half 半天（默认 'full'，与 schedule.period 一致）
    const period = ['full', 'half'].includes(b.period) ? b.period : (cur.period || 'full');
    // 订单图片管理（原片 / 精修片 URL 列表），前端传字符串或对象统一转 JSON 文本落库
    const orderPhotosText = b.order_photos === undefined
      ? (cur.order_photos ?? null)
      : (typeof b.order_photos === 'string' ? b.order_photos : JSON.stringify(b.order_photos));
    // 分组备注字段：生日/纪念日、预约备注、内部备注、外部备注（备注主字段沿用 remark）
    const birthdayText = b.birthday === undefined ? (cur.birthday ?? null) : (b.birthday || null);
    const appointmentText = b.appointment_remark === undefined ? (cur.appointment_remark ?? null) : (b.appointment_remark || null);
    const internalText = b.internal_remark === undefined ? (cur.internal_remark ?? null) : (b.internal_remark || null);
    const externalText = b.external_remark === undefined ? (cur.external_remark ?? null) : (b.external_remark || null);
    // 调查问卷答案（已有 questionnaire_answers 列，PUT 时允许前端覆盖）
    const questionnaireText = b.questionnaire_answers === undefined
      ? (cur.questionnaire_answers ?? null)
      : (typeof b.questionnaire_answers === 'string' ? b.questionnaire_answers : JSON.stringify(b.questionnaire_answers));
    // 【订单 ↔ 档期】改拍摄日期前先做冲突检测（验收④）；force=true 由前端二次确认后强行占用
    const oldDate = cur.date_tbd ? '' : (cur.shoot_date || '');
    const newDate = date_tbd ? '' : (shoot_date || '');
    const dateChanged = String(oldDate) !== String(newDate);
    const force = !!b.force;
    if (dateChanged && newDate && !force) {
      const hit = await scheduleConflict(newDate, cur.order_no);
      if (hit) {
        return res.status(409).json({
          error: conflictText(hit), code: 'CONFLICT', forcible: true,
          conflict: { id: hit.id, date: hit.date, status: hit.status, order_no: hit.order_no || '' }
        });
      }
      let firstExecId = null;
      try {
        const execArr = JSON.parse(execsText || '[]');
        if (Array.isArray(execArr) && execArr[0]) firstExecId = execArr[0].id ?? null;
      } catch { /* 无执行人 */ }
      const capHit = await capacityConflict(newDate, cur.order_no, firstExecId);
      if (capHit) {
        return res.status(409).json({
          error: `${newDate} 当日已约满（${capHit.count}/${capHit.limit}${capHit.perPhotographer ? '，按摄影师隔离' : ''}），无法继续预约`,
          code: 'CAPACITY_FULL', forcible: true, capacity: capHit
        });
      }
    }
    await run(
      `UPDATE orders SET customer_name=?, customer_phone=?, shoot_date=?, executor=?, remark=?, status=?,
        groom_name=?, bride_name=?, address=?, period=?,
        order_name=?, phones=?, time_slots=?, extra_items=?, executors=?, channel=?, channel_id=?, date_tbd=?, payment_status=?,
        order_photos=?, birthday=?, appointment_remark=?, internal_remark=?, external_remark=?, questionnaire_answers=?
       WHERE id=?`,
      [customer_name, firstPhone,
       shoot_date, execText, b.remark ?? cur.remark, status,
       groom, bride, b.address ?? cur.address, period,
       b.order_name ?? cur.order_name, phonesText, slotsText, extrasText, execsText,
       b.channel ?? cur.channel, b.channel_id ?? cur.channel_id, date_tbd, payment_status,
       orderPhotosText, birthdayText, appointmentText, internalText, externalText, questionnaireText,
       cur.id]
    );
    if (b.status && b.status !== cur.status) {
      const MAP = { deposit: '已付定金', shot: '已拍摄', selecting: '选片中', retouching: '精修中', delivered: '已交付', completed: '已完成' };
      await appendLog(cur.id, '阶段推进 → ' + (MAP[status] || status));
    }
    // 【订单 ↔ 档期】同步档期：有日期→占用/迁移（自动释放旧日期）；改为日期待定→释放档期（验收④）
    const jsonArr = (t) => { try { const a = JSON.parse(t || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
    if (!cur.cancelled && !cur.is_deleted) {
      if (newDate) {
        const execArr = jsonArr(execsText);
        try {
          await occupySchedule(newDate, cur.order_no, {
            period, periods: jsonArr(slotsText), photographer: execText || '',
            executor_id: execArr[0] && execArr[0].id, executor_name: (execArr[0] && execArr[0].name) || '',
            groom_name: groom, bride_name: bride, contact_phone: firstPhone || '',
            address: b.address ?? cur.address ?? '', note: b.order_name ?? cur.order_name ?? ''
          }, force);
          if (dateChanged) await appendLog(cur.id, `拍摄日期 ${oldDate || '待定'} → ${newDate}，档期已同步（旧档期释放 / 新档期占用）`);
        } catch (err) {
          if (err.code !== 'CONFLICT') throw err;
          await appendLog(cur.id, `档期占用失败：${err.message}`);
        }
      } else if (oldDate) {
        await releaseSchedule(cur.order_no);
        await appendLog(cur.id, `拍摄日期改为待定，已释放档期 ${oldDate}`);
      }
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 更换套系（仅更新当前订单的套系快照，不影响其它订单；验收⑥）
// body: { package_id, package_price?, spec_id?, addons?, reason? }
router.post('/:id/change-package', authRequired, requireRole(['admin', 'photographer', 'finance']), async (req, res) => {
  try {
    const b = req.body || {};
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    if (o.cancelled) return res.status(400).json({ error: '订单已作废，无法更换套系' });
    if (!b.package_id) return res.status(400).json({ error: '请选择要更换的套系' });
    const p = await get('SELECT * FROM packages WHERE id = ?', [b.package_id]);
    if (!p) return res.status(404).json({ error: '套系不存在' });

    const safeParse = (v, fallback = '') => { try { return v ? JSON.parse(v) : fallback; } catch { return v || fallback; } };
    const overridePrice = b.package_price !== undefined && b.package_price !== null && b.package_price !== '';
    let usePrice = overridePrice ? (parseFloat(b.package_price) || 0) : (parseFloat(p.price) || 0);
    const specs = safeParse(p.specs, []);
    let specName = '';
    if (b.spec_id && Array.isArray(specs)) {
      const sp = specs.find((s) => String(s.id) === String(b.spec_id));
      if (sp) { specName = sp.name || ''; if (!overridePrice) usePrice = parseFloat(sp.price) || usePrice; }
    }
    // 重新生成快照 —— 读取【当前最新】套系配置，只写入本订单
    const snapshot = {
      id: p.id, name: p.name, price: usePrice, list_price: parseFloat(p.price) || 0, deposit: p.deposit,
      description: p.description || '', retouch_count: p.retouch_count,
      raw_policy: p.raw_policy || '', duration: p.duration || '', cover_url: p.cover_url || '',
      category_id: p.category_id, spec_id: b.spec_id || '', spec_name: specName,
      addons: safeParse(p.addons, []), marketing: safeParse(p.marketing, {}),
      specs, questionnaire: safeParse(p.questionnaire, ''),
      details: safeParse(p.details, {}),
      snapshot_at: nowISO()
    };
    const addons = Array.isArray(b.addons) ? b.addons : (safeParse(o.addons_snapshot, []) || []);
    const addonTotal = addons.reduce((s, a) => s + (parseFloat(a && a.price) || 0), 0);
    const extraTotal = normExtras(safeParse(o.extra_items, [])).reduce((s, x) => s + x.amount, 0);
    const total = usePrice + addonTotal + extraTotal;
    const paid = parseFloat(o.paid_amount) || 0;
    const balance = Math.max(0, total - paid);

    const oldSnap = safeParse(o.package_snapshot, null);
    const oldName = (oldSnap && oldSnap.name) || '（无套系）';
    await run(
      'UPDATE orders SET package_id = ?, package_snapshot = ?, addons_snapshot = ?, total_amount = ?, balance = ? WHERE id = ?',
      [p.id, JSON.stringify(snapshot), JSON.stringify(addons), total, balance, o.id]
    );
    await appendLog(o.id, `更换套系：${oldName} → ${p.name}${specName ? '（' + specName + '）' : ''}，应收总额 ¥${o.total_amount || 0} → ¥${total}` + (b.reason ? '；原因：' + b.reason : ''));
    res.json({ ok: true, package_snapshot: snapshot, total_amount: total, balance });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 加收款（写入 payments 流水，更新 paid_amount）
router.post('/:id/payments', authRequired, requireRole(['admin', 'photographer', 'finance']), async (req, res) => {
  try {
    const b = req.body;
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    const type = ['deposit', 'balance', 'extra', 'refund'].includes(b.type) ? b.type : 'deposit';
    const amount = parseFloat(b.amount) || 0;
    if (amount <= 0) return res.status(400).json({ error: '金额必须大于 0' });
    const pid = await insert(
      `INSERT INTO payments (order_id, order_no, type, amount, method, channel, note) VALUES (?,?,?,?,?,?,?)`,
      [o.id, o.order_no, type, amount, b.method || 'offline', normChannel(b.method, b.channel), b.note || '']
    );
    // 重算 paid_amount（应收类加、退款减）
    const agg = await get(
      `SELECT
         COALESCE(SUM(CASE WHEN type IN ('deposit','balance','extra') THEN amount ELSE 0 END),0) AS received,
         COALESCE(SUM(CASE WHEN type='refund' THEN amount ELSE 0 END),0) AS refunded
       FROM payments WHERE order_id = ?`,
      [o.id]
    );
    const paid = (parseFloat(agg.received) - parseFloat(agg.refunded));
    await run('UPDATE orders SET paid_amount = ? WHERE id = ?', [paid, o.id]);
    const TYPE_LABEL = { deposit: '定金', balance: '尾款', extra: '加片/增值', refund: '退款' };
    await appendLog(o.id, `收款登记：${TYPE_LABEL[type]} ¥${amount}（${channelLabel(b.method, b.channel)}）`);
    // 收到定金确保订单处于「已付定金」状态（兼容旧数据由 unpaid 归一）
    if (type === 'deposit' && o.status !== 'deposit') {
      await run("UPDATE orders SET status = 'deposit' WHERE id = ?", [o.id]);
    }
    res.json({ ok: true, paymentId: pid, paid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 软删除订单（进入回收站，可恢复；保留收款流水与选片记录，不破坏数据）
router.delete('/:id', authRequired, requireRole(['admin']), async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    await run('UPDATE orders SET is_deleted = 1, deleted_at = ? WHERE id = ?', [nowISO(), o.id]);
    await appendLog(o.id, '订单移入回收站（软删除）');
    // 【订单 → 档期】删除自动释放所占档期（验收⑤）
    await releaseSchedule(o.order_no);
    if (o.shoot_date) await appendLog(o.id, `订单删除，已释放档期 ${o.shoot_date}`);
    res.json({ ok: true, scheduleReleased: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 恢复订单（移出回收站）
router.post('/:id/restore', authRequired, requireRole(['admin']), async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    await run('UPDATE orders SET is_deleted = 0, deleted_at = NULL WHERE id = ?', [o.id]);
    await appendLog(o.id, '订单已从回收站恢复');
    // 恢复订单时尝试重新占用原档期；若该日期已被他人占用则仅记录日志，不阻断恢复
    let scheduleOccupied = false, scheduleWarn = '';
    if (o.shoot_date && !o.date_tbd && !o.cancelled) {
      try {
        await occupySchedule(o.shoot_date, o.order_no, {
          photographer: o.executor || '', groom_name: o.groom_name || '', bride_name: o.bride_name || '',
          contact_phone: o.customer_phone || '', address: o.address || '', note: o.order_name || ''
        });
        scheduleOccupied = true;
        await appendLog(o.id, `恢复订单，重新占用档期 ${o.shoot_date}`);
      } catch (err) {
        if (err.code !== 'CONFLICT') throw err;
        scheduleWarn = err.message;
        await appendLog(o.id, `恢复订单，但档期未能占用：${err.message}`);
      }
    }
    res.json({ ok: true, scheduleOccupied, scheduleWarn });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 彻底删除（管理员，物理删除并级联收款流水与选片记录）
router.post('/:id/purge', authRequired, requireRole(['admin']), async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    await run('DELETE FROM payments WHERE order_id = ?', [o.id]);
    await run('DELETE FROM photo_select WHERE order_id = ?', [o.id]);
    await releaseSchedule(o.order_no); // 彻底删除同步释放档期
    await run('DELETE FROM orders WHERE id = ?', [o.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 作废（仅标记 cancelled，禁止物理删除）
router.post('/:id/cancel', authRequired, requireRole(['admin']), async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    await run("UPDATE orders SET cancelled = 1, status = 'cancelled' WHERE id = ?", [o.id]);
    await appendLog(o.id, '订单作废' + (req.body.reason ? '：' + req.body.reason : ''));
    // 【订单 → 档期】作废自动释放所占档期（验收⑤）
    await releaseSchedule(o.order_no);
    if (o.shoot_date) await appendLog(o.id, `订单作废，已释放档期 ${o.shoot_date}`);
    res.json({ ok: true, scheduleReleased: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 退款（登记退款流水 + 记录退款额）
router.post('/:id/refund', authRequired, requireRole(['admin', 'finance']), async (req, res) => {
  try {
    const b = req.body;
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    const amount = parseFloat(b.amount) || 0;
    if (amount <= 0) return res.status(400).json({ error: '退款金额必须大于 0' });
    await insert(
      `INSERT INTO payments (order_id, order_no, type, amount, method, channel, note) VALUES (?,?,?,?,?,?,?)`,
      [o.id, o.order_no, 'refund', amount, 'offline', normChannel('offline', b.channel), b.note || '退款']
    );
    const agg = await get(
      `SELECT COALESCE(SUM(CASE WHEN type='refund' THEN amount ELSE 0 END),0) AS refunded FROM payments WHERE order_id = ?`,
      [o.id]
    );
    await run('UPDATE orders SET refund_amount = ? WHERE id = ?', [parseFloat(agg.refunded), o.id]);
    await appendLog(o.id, `退款 ¥${amount}` + (b.note ? '：' + b.note : ''));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 设置存储期限（原片/精修保存天数）并自动计算到期时间
router.post('/:id/storage', authRequired, requireRole(['admin', 'photographer', 'finance']), async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    const raw = parseInt(req.body.raw_storage_days, 10) || o.raw_storage_days || 30;
    const retouch = parseInt(req.body.retouch_storage_days, 10) || o.retouch_storage_days || 180;
    const now = new Date();
    const rawExp = new Date(now.getTime() + raw * 86400000).toISOString().slice(0, 10);
    const retouchExp = new Date(now.getTime() + retouch * 86400000).toISOString().slice(0, 10);
    await run(
      'UPDATE orders SET raw_storage_days = ?, retouch_storage_days = ?, raw_expire_at = ?, retouch_expire_at = ? WHERE id = ?',
      [raw, retouch, rawExp, retouchExp, o.id]
    );
    await appendLog(o.id, `设置存储期限：原片 ${raw} 天 / 精修 ${retouch} 天`);
    res.json({ ok: true, raw_expire_at: rawExp, retouch_expire_at: retouchExp });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 生成 / 刷新客户影集分享二维码（公开访问，无需登录）
router.post('/:id/share', authRequired, requireRole(['admin', 'photographer', 'finance']), async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    let token = o.share_token;
    if (!token) token = crypto.randomBytes(16).toString('hex');

    // 分享落地页基准地址：统一走 shareUtil（默认前端 Cloudflare Pages 域名）
    const base = shareBaseUrl(req);
    const shareUrl = `${base}/share/${token}`;
    const qrUrl = await QRCode.toDataURL(shareUrl, { width: 480, margin: 1 });
    await run('UPDATE orders SET share_token = ?, qr_url = ? WHERE id = ?', [token, qrUrl, o.id]);
    await appendLog(o.id, '生成客户影集分享二维码');
    res.json({ ok: true, share_token: token, share_url: shareUrl, qr_url: qrUrl });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 生成微信小程序风格订单二维码（用于后台「分享订单」悬浮弹窗）
router.post('/:id/mini-qr', authRequired, requireRole(['admin', 'photographer', 'finance']), async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    let token = o.share_token;
    if (!token) token = crypto.randomBytes(16).toString('hex');

    const base = shareBaseUrl(req);
    const shareUrl = `${base}/share/${token}`;
    // 先生成/复用网页分享 token，再生成小程序风格二维码（SVG 数据 URL）
    if (!o.share_token) {
      await run('UPDATE orders SET share_token = ? WHERE id = ?', [token, o.id]);
    }
    const miniQrUrl = await generateMiniProgramQr(shareUrl);
    res.json({ ok: true, order_id: o.id, qr_url: miniQrUrl });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 关闭分享（清空令牌，使公开链接失效）
router.post('/:id/unshare', authRequired, requireRole(['admin', 'photographer', 'finance']), async (req, res) => {
  try {
    const o = await get('SELECT id FROM orders WHERE id = ?', [req.params.id]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    await run('UPDATE orders SET share_token = NULL, qr_url = NULL WHERE id = ?', [o.id]);
    await appendLog(o.id, '关闭客户影集分享');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
