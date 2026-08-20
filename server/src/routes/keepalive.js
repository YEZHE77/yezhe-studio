// routes/keepalive.js —— 保活接口（供 Cloudflare Worker Cron 每 5 分钟触库 ping）
// 与 /api/health 的区别：health 不触库（Render 健康检查专用，避免频繁 DB 往返）；
// keepalive 执行 SELECT 1 预热 Neon 连接，避免实例休眠恢复后首个业务查询重新做 TLS 握手。
import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, db: true, time: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({ ok: false, db: false, error: e.message });
  }
});

export default router;
