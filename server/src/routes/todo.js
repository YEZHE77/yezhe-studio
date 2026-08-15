// routes/todo.js —— 独立待办系统接口（B 端）
// GET /api/todo          待办列表（JOIN 订单客户名/日期）+ pending/done 计数
// POST /api/todo/:id/done  标记单条待办完成（仅归档，不改订单业务数据）
import { Router } from 'express';
import { query } from '../db.js';
import { authRequired } from '../auth.js';
import { listTodos, markTodoDone } from '../todo.js';

const router = Router();
router.use(authRequired);

router.get('/', async (req, res) => {
  try {
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
