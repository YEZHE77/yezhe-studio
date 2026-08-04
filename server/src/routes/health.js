// routes/health.js —— 健康检查（Render 保活）
import { Router } from 'express';
import { dialect } from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  res.json({ ok: true, dialect, time: new Date().toISOString() });
});

export default router;
