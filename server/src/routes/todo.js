// routes/todo.js —— 独立待办系统接口（B 端）
// GET /api/todo          待办列表（JOIN 订单客户名/日期）+ pending/done 计数
//                        自动 syncAllOrderTodos 确保待办表与订单 stage 一致（防不同步）
// POST /api/todo/:id/done  标记单条待办完成（仅归档，不改订单业务数据）
import { Router } from 'express';
import { query } from '../db.js';
import { authRequired } from '../auth.js';
import { listTodos, markTodoDone, syncOrderTodos, orderStage } from '../todo.js';

const router = Router();
router.use(authRequired);

// 数据补齐：扫描所有 active 订单，确保每单当前 stage 都有对应 pending todo_items
// 幂等：syncOrderTodos 内部 UPDATE 归档旧阶段 + 新增/激活当前阶段，重复调用安全
// 性能：N+1，但单个订单 sync 是 3-4 条 SQL；订单数 < 1000 时毫秒级
// 缓存：1 分钟内不重复跑（同一请求/短时间内重复 GET 不会重复触发）
let lastSyncAt = 0;
let lastSyncOrdersCount = 0;
async function syncAllOrderTodos() {
  const now = Date.now();
  const orders = await query("SELECT id FROM orders WHERE cancelled = 0 AND is_deleted = 0");
  // 1 分钟内 + 订单数无变化 → 跳过（避免每次 GET 都跑）
  if (now - lastSyncAt < 60000 && orders.length === lastSyncOrdersCount) return;
  for (const o of orders) {
    try { await syncOrderTodos(o.id); } catch (e) { /* 单订单失败不阻断整体 */ }
  }
  lastSyncAt = now;
  lastSyncOrdersCount = orders.length;
}

router.get('/', async (req, res) => {
  try {
    // 数据补齐：保证 todo_items 表与订单 stage 一致（用户看到的「订单不同步」根因修复）
    await syncAllOrderTodos();
    const { items, counts } = await listTodos();
    // JOIN 订单，附客户名 / 拍摄日期，前端展示无需再查
    const rows = await query(
      `SELECT t.*, o.customer_name, o.groom_name, o.bride_name, o.shoot_date, o.status AS order_status, o.order_no
       FROM todo_items t LEFT JOIN orders o ON o.id = t.order_id
       ORDER BY (t.status = 'pending') DESC, t.id DESC`
    );
    res.json({ list: rows, counts });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/done', async (req, res) => {
  try {
    const ok = await markTodoDone(req.params.id);
    if (!ok) return res.status(404).json({ error: '待办不存在' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;