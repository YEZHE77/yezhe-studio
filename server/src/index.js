// index.js —— Express 入口
import './env.js';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { dialect, dataDir } from './db.js';
import { initSchema } from './schema.js';
import { uploadDir, saveImage } from './storage.js';
import { authRequired } from './auth.js';
import { seedIfNeeded } from './seed.js';

import authRoutes from './routes/auth.js';
import worksRoutes from './routes/works.js';
import categoriesRoutes from './routes/categories.js';
import albumsRoutes from './routes/albums.js';
import selectionRoutes from './routes/selection.js';
import ordersRoutes from './routes/orders.js';
import packagesRoutes from './routes/packages.js';
import schedulesRoutes from './routes/schedules.js';
import paymentsRoutes from './routes/payments.js';
import financeRoutes from './routes/finance.js';
import statsRoutes from './routes/stats.js';
import healthRoutes from './routes/health.js';
import wxRoutes from './routes/wx.js';
import customerRoutes from './routes/customer.js';
import adminRoutes from './routes/admin.js';

const app = express();
const PORT = process.env.PORT || 4000;
const CORS_ORIGIN = (process.env.CORS_ORIGIN || 'https://yezhe-studio.netlify.app').split(',').map((s) => s.trim());

app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '20mb' }));

// 上传（磁盘临时 + 单文件 15MB 硬上限，原片超阈值被拦截）
const tmpDir = path.join(dataDir, 'tmp');
fs.mkdirSync(tmpDir, { recursive: true });
const upload = multer({ dest: tmpDir, limits: { fileSize: 15 * 1024 * 1024 } });
const UP = uploadDir();
fs.mkdirSync(UP, { recursive: true });
app.use('/uploads', express.static(UP));

app.post('/api/upload', authRequired, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未收到文件' });
    const url = await saveImage(req.file);
    res.json({ url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.use('/api/auth', authRoutes);
app.use('/api/works', worksRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/albums', albumsRoutes);
app.use('/api/selection', selectionRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/packages', packagesRoutes);
app.use('/api/schedules', schedulesRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/wx', wxRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/admin', adminRoutes);

// multer / 通用错误
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: '图片超过 15MB 上限，原片请勿上传，仅传压缩小样' });
  }
  res.status(500).json({ error: err.message || '服务器错误' });
});

app.use((req, res) => res.status(404).json({ error: '接口不存在' }));

initSchema().then(async () => {
  await seedIfNeeded();
  app.listen(PORT, () => {
    console.log(`[server] 已启动 → http://localhost:${PORT}`);
    console.log(`[server] CORS 放行: ${CORS_ORIGIN.join(', ')}`);
    console.log(`[server] 数据库方言: ${dialect}`);
  });
});
