// routes/payments.js —— 资金流水读取（供财务管理与订单收款记录）
import { Router } from 'express';
import { query } from '../db.js';
import { authRequired } from '../auth.js';

const router = Router();

router.get('/', authRequired, async (req, res) => {
  try {
    const { type, method, order_no, from, to } = req.query;
    const where = [];
    const params = [];
    if (type) { where.push('type = ?'); params.push(type); }
    if (method) { where.push('method = ?'); params.push(method); }
    if (order_no) { where.push('order_no LIKE ?'); params.push('%' + order_no + '%'); }
    if (from && to) { where.push('created_at >= ? AND created_at <= ?'); params.push(from, to); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = await query('SELECT * FROM payments ' + w + ' ORDER BY created_at DESC, id DESC', params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
