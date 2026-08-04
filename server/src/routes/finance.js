// routes/finance.js —— 财务管理（营收汇总 / 分项拆解 / 周期报表 / 员工业绩 / 套系销量 / 资金流水）
import { Router } from 'express';
import { query, get } from '../db.js';
import { authRequired } from '../auth.js';
import { parseRow } from '../schema.js';

const router = Router();

// 营收汇总：实收（来自 payments）/ 应收（来自 orders）/ 退款 / 线上线下
router.get('/summary', authRequired, async (req, res) => {
  try {
    const p = await get(`
      SELECT
        COALESCE(SUM(CASE WHEN type IN ('deposit','balance','extra') THEN amount ELSE 0 END),0) AS received,
        COALESCE(SUM(CASE WHEN type='refund' THEN amount ELSE 0 END),0) AS refunded,
        COALESCE(SUM(CASE WHEN type='deposit' THEN amount ELSE 0 END),0) AS deposit,
        COALESCE(SUM(CASE WHEN type='balance' THEN amount ELSE 0 END),0) AS balance,
        COALESCE(SUM(CASE WHEN type='extra' THEN amount ELSE 0 END),0) AS extra,
        COALESCE(SUM(CASE WHEN type IN ('deposit','balance','extra') AND method='online' THEN amount ELSE 0 END),0) AS online,
        COALESCE(SUM(CASE WHEN type IN ('deposit','balance','extra') AND method='offline' THEN amount ELSE 0 END),0) AS offline
      FROM payments`);
    const o = await get(`
      SELECT COALESCE(SUM(deposit),0) AS deposit_sum, COALESCE(SUM(balance),0) AS balance_sum
      FROM orders WHERE cancelled = 0`);
    const receivable = parseFloat(o.deposit_sum) + parseFloat(o.balance_sum);
    const received = parseFloat(p.received) - parseFloat(p.refunded);
    res.json({
      receivable: Math.round(receivable * 100) / 100,
      received: Math.round(received * 100) / 100,
      refunded: Math.round(parseFloat(p.refunded) * 100) / 100,
      online: Math.round(parseFloat(p.online) * 100) / 100,
      offline: Math.round(parseFloat(p.offline) * 100) / 100,
      incomeBreakdown: {
        deposit: Math.round(parseFloat(p.deposit || 0) * 100) / 100,
        balance: Math.round(parseFloat(p.balance || 0) * 100) / 100,
        extra: Math.round(parseFloat(p.extra || 0) * 100) / 100
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 周期报表：按月聚合实收/退款（?year=YYYY）
router.get('/by-month', authRequired, async (req, res) => {
  try {
    const year = req.query.year || new Date().getFullYear();
    let rows;
    if (process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('postgres')) {
      rows = await query(`
        SELECT TO_CHAR(created_at, 'YYYY-MM') AS ym,
               SUM(CASE WHEN type IN ('deposit','balance','extra') THEN amount ELSE 0 END) AS received,
               SUM(CASE WHEN type='refund' THEN amount ELSE 0 END) AS refunded
        FROM payments WHERE EXTRACT(YEAR FROM created_at) = $1
        GROUP BY ym ORDER BY ym`, [year]);
    } else {
      rows = await query(`
        SELECT substr(created_at,1,7) AS ym,
               SUM(CASE WHEN type IN ('deposit','balance','extra') THEN amount ELSE 0 END) AS received,
               SUM(CASE WHEN type='refund' THEN amount ELSE 0 END) AS refunded
        FROM payments WHERE substr(created_at,1,4) = ?
        GROUP BY ym ORDER BY ym`, [String(year)]);
    }
    res.json(rows.map((r) => ({
      ym: r.ym,
      received: Math.round(parseFloat(r.received) * 100) / 100,
      refunded: Math.round(parseFloat(r.refunded) * 100) / 100,
      net: Math.round((parseFloat(r.received) - parseFloat(r.refunded)) * 100) / 100
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 员工业绩：按执行人聚合订单数与实收
router.get('/staff', authRequired, async (req, res) => {
  try {
    const rows = await query(`
      SELECT o.executor,
             COUNT(*) AS order_count,
             COALESCE(SUM(o.total_amount),0) AS total_amount,
             COALESCE(SUM(o.paid_amount),0) AS paid_amount
      FROM orders o WHERE o.cancelled = 0 AND o.executor != ''
      GROUP BY o.executor ORDER BY paid_amount DESC`);
    res.json(rows.map((r) => ({
      executor: r.executor,
      orderCount: r.order_count,
      totalAmount: Math.round(parseFloat(r.total_amount) * 100) / 100,
      paidAmount: Math.round(parseFloat(r.paid_amount) * 100) / 100
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 套系销量：按套系聚合订单数与营收
router.get('/packages', authRequired, async (req, res) => {
  try {
    const rows = await query(`
      SELECT o.package_id, p.name,
             COUNT(*) AS sold,
             COALESCE(SUM(o.paid_amount),0) AS revenue
      FROM orders o LEFT JOIN packages p ON p.id = o.package_id
      WHERE o.cancelled = 0 AND o.package_id IS NOT NULL
      GROUP BY o.package_id ORDER BY sold DESC`);
    res.json(rows.map((r) => ({
      packageId: r.package_id,
      name: r.name || '已删除套系',
      sold: r.sold,
      revenue: Math.round(parseFloat(r.revenue) * 100) / 100
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 资金流水（明细）
router.get('/ledger', authRequired, async (req, res) => {
  try {
    const { type, method, from, to } = req.query;
    const where = [];
    const params = [];
    if (type) { where.push('type = ?'); params.push(type); }
    if (method) { where.push('method = ?'); params.push(method); }
    if (from && to) { where.push('created_at >= ? AND created_at <= ?'); params.push(from, to); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = await query('SELECT * FROM payments ' + w + ' ORDER BY created_at DESC, id DESC', params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
