// routes/stats.js —— 首页工作台数据看板
import { Router } from 'express';
import { get, query } from '../db.js';
import { authRequired } from '../auth.js';

const router = Router();

router.get('/', authRequired, async (req, res) => {
  try {
    // 统计口径与订单页一致：作废(cancelled=1)与软删除(is_deleted=1)一律排除，绝不虚增余额/计数
    const total = await get(`SELECT
      COALESCE(SUM(deposit),0) AS deposit_sum,
      COALESCE(SUM(balance),0) AS balance_sum,
      COALESCE(SUM(CASE WHEN deposit_method='online' THEN deposit ELSE 0 END),0) AS deposit_online,
      COALESCE(SUM(CASE WHEN balance_method='online' THEN balance ELSE 0 END),0) AS balance_online
      FROM orders WHERE cancelled = 0 AND is_deleted = 0`);

    const balance = parseFloat(total.deposit_sum) + parseFloat(total.balance_sum);
    const onlineIncome = parseFloat(total.deposit_online) + parseFloat(total.balance_online);
    const offlineIncome = balance - onlineIncome;

    // 待收尾款：订单尾款应收合计 − 已收尾款流水（payments type='balance'）
    const balPaid = await get(`SELECT COALESCE(SUM(amount),0) AS paid FROM payments WHERE type='balance'`);
    const pendingBalance = Math.round((parseFloat(total.balance_sum) - parseFloat(balPaid.paid)) * 100) / 100;

    // 实收（来自收款流水，含退款抵扣）
    const pay = await get(`
      SELECT
        COALESCE(SUM(CASE WHEN type IN ('deposit','balance','extra') THEN amount ELSE 0 END),0) AS received,
        COALESCE(SUM(CASE WHEN type='refund' THEN amount ELSE 0 END),0) AS refunded
      FROM payments`);
    const received = parseFloat(pay.received) - parseFloat(pay.refunded);
    const refunded = parseFloat(pay.refunded);

    // 待处理订单彩色块（按状态计数，排除作废/软删除）
    const statusRows = await query(`SELECT status, COUNT(*) AS c FROM orders WHERE cancelled = 0 AND is_deleted = 0 GROUP BY status`);
    const pending = {};
    for (const r of statusRows) pending[r.status] = r.c;
    const unpaidRow = await get(`SELECT COUNT(*) AS c FROM orders WHERE cancelled = 0 AND is_deleted = 0 AND payment_status = 'unpaid'`);
    const pendingBlocks = {
      unpaid: Number(unpaidRow.c) || 0, // 未支付定金
      deposit: pending.deposit || 0,    // 已支付定金（等待拍摄）
      shoot: pending.shoot || 0,        // 已拍摄
      selecting: pending.selecting || 0,// 待选片
      retouching: pending.retouching || 0, // 待精修
      delivered: pending.delivered || 0 // 未交片
    };

    // 待办事项 Tab 计数（与 /api/orders/stats 完全同口径）
    // 口径：已付定金 = 已付定金且未拍摄、且进度条还没推进到「等待拍摄」节点；
    //       等待拍摄 = 已付定金且未拍摄、且进度条已推进到「等待拍摄」节点（logs 含「等待拍摄」/「拍摄执行」）
    const todoWhere = 'WHERE cancelled = 0 AND is_deleted = 0';
    const [depositRow, waitingShootRow, unDeliveredRow, selectingRow, retouchingRow] = await Promise.all([
      get(`SELECT COUNT(*) AS c FROM orders ${todoWhere} AND payment_status = 'deposit' AND status = 'deposit' AND (logs IS NULL OR logs = '' OR (logs NOT LIKE '%等待拍摄%' AND logs NOT LIKE '%拍摄执行%'))`),
      get(`SELECT COUNT(*) AS c FROM orders ${todoWhere} AND payment_status = 'deposit' AND status = 'deposit' AND (logs LIKE '%等待拍摄%' OR logs LIKE '%拍摄执行%')`),
      get(`SELECT COUNT(*) AS c FROM orders ${todoWhere} AND status = 'shot'`),
      get(`SELECT COUNT(*) AS c FROM orders ${todoWhere} AND status = 'selecting'`),
      get(`SELECT COUNT(*) AS c FROM orders ${todoWhere} AND status = 'retouching'`)
    ]);
    const todo = {
      deposit: Number(depositRow.c) || 0,
      waitingShoot: Number(waitingShootRow.c) || 0,
      unDelivered: Number(unDeliveredRow.c) || 0,
      selecting: Number(selectingRow.c) || 0,
      retouching: Number(retouchingRow.c) || 0
    };

    res.json({
      balance: Math.round(balance * 100) / 100,
      received: Math.round(received * 100) / 100,
      refunded: Math.round(refunded * 100) / 100,
      pendingBalance,
      onlineIncome: Math.round(onlineIncome * 100) / 100,
      offlineIncome: Math.round(offlineIncome * 100) / 100,
      pendingBlocks,
      todo,
      finance: {
        packageIncome: Math.round(balance * 100) / 100,
        extraIncome: 0,
        albumIncome: 0
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
