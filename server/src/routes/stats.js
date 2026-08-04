// routes/stats.js —— 首页工作台数据看板
import { Router } from 'express';
import { get, query } from '../db.js';
import { authRequired } from '../auth.js';

const router = Router();

router.get('/', authRequired, async (req, res) => {
  try {
    const total = await get(`SELECT
      COALESCE(SUM(deposit),0) AS deposit_sum,
      COALESCE(SUM(balance),0) AS balance_sum,
      COALESCE(SUM(CASE WHEN deposit_method='online' THEN deposit ELSE 0 END),0) AS deposit_online,
      COALESCE(SUM(CASE WHEN balance_method='online' THEN balance ELSE 0 END),0) AS balance_online
      FROM orders WHERE status != 'cancelled'`);

    const balance = parseFloat(total.deposit_sum) + parseFloat(total.balance_sum);
    const onlineIncome = parseFloat(total.deposit_online) + parseFloat(total.balance_online);
    const offlineIncome = balance - onlineIncome;

    // 实收（来自收款流水，含退款抵扣）
    const pay = await get(`
      SELECT
        COALESCE(SUM(CASE WHEN type IN ('deposit','balance','extra') THEN amount ELSE 0 END),0) AS received,
        COALESCE(SUM(CASE WHEN type='refund' THEN amount ELSE 0 END),0) AS refunded
      FROM payments`);
    const received = parseFloat(pay.received) - parseFloat(pay.refunded);
    const refunded = parseFloat(pay.refunded);

    // 待处理订单彩色块（按状态计数）
    const statusRows = await query(`SELECT status, COUNT(*) AS c FROM orders WHERE status != 'cancelled' GROUP BY status`);
    const pending = {};
    for (const r of statusRows) pending[r.status] = r.c;
    const pendingBlocks = {
      unpaid: pending.unpaid || 0,      // 未支付定金
      shoot: pending.shoot || 0,        // 等待拍摄
      selecting: pending.selecting || 0,// 待选片
      retouching: pending.retouching || 0, // 待精修
      delivered: pending.delivered || 0 // 未交片
    };

    res.json({
      balance: Math.round(balance * 100) / 100,
      received: Math.round(received * 100) / 100,
      refunded: Math.round(refunded * 100) / 100,
      onlineIncome: Math.round(onlineIncome * 100) / 100,
      offlineIncome: Math.round(offlineIncome * 100) / 100,
      pendingBlocks,
      finance: {
        packageIncome: Math.round(balance * 100) / 100,
        extraIncome: 0,
        albumIncome: 0
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
