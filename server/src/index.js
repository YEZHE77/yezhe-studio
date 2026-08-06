// index.js —— Express 入口
import './env.js';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { dialect, dataDir } from './db.js';
import { initSchema } from './schema.js';
import { saveImage } from './storage.js';
import { scheduleDailyBackup } from './backup.js';
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
import settingsRoutes from './routes/settings.js';
import shareRoutes from './routes/share.js';
import sharesRoutes from './routes/shares.js';
import galleriesRoutes from './routes/galleries.js';

const app = express();
const PORT = process.env.PORT || 4000;
const CORS_ORIGIN = (process.env.CORS_ORIGIN || 'https://yezhe-studio.pages.dev').split(',').map((s) => s.trim());

app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '20mb' }));

// 上传（仅临时落盘做中转，单文件 15MB 硬上限；T-01：Render 本地不持久化任何图片，最终落入 R2）
const tmpDir = path.join(dataDir, 'tmp');
fs.mkdirSync(tmpDir, { recursive: true });
const upload = multer({ dest: tmpDir, limits: { fileSize: 15 * 1024 * 1024 } });

app.post('/api/upload', authRequired, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未收到文件' });
    // 单图上传多为封面/样片（默认公开）；前端可显式传 category（type 枚举）/ isPublic
    const meta = {
      category: req.body.category || 'cover',
      isPublic: req.body.isPublic === undefined
        ? true
        : (req.body.isPublic === '1' || req.body.isPublic === 'true' || req.body.isPublic === true)
    };
    const url = await saveImage(req.file, 'biz-works', meta);
    res.json({ url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 批量上传（作品相册等场景，3 张并发一组，避免压垮服务器）
app.post('/api/upload-multiple', authRequired, upload.array('files', 500), async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: '未收到文件' });
    // 批量多为客片/底片/精修（默认非公开）；前端可显式传 category（type 枚举）/ isPublic
    const meta = {
      category: req.body.category || 'client',
      isPublic: req.body.isPublic === '1' || req.body.isPublic === 'true' || req.body.isPublic === true
    };
    const urls = [];
    for (let i = 0; i < files.length; i += 3) {
      const batch = files.slice(i, i + 3);
      const batchUrls = await Promise.all(batch.map((f) => saveImage(f, 'customer-demo', meta)));
      urls.push(...batchUrls);
    }
    res.json({ urls });
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
app.use('/api/settings', settingsRoutes);
app.use('/api/share', shareRoutes);
app.use('/api/shares', sharesRoutes);
app.use('/api/galleries', galleriesRoutes);

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
  // 双重备份：启动后调度每日 R2 /backup 写入（Render 免费档重启会自动重新调度）
  try { scheduleDailyBackup(); } catch (e) { console.error('[backup] 调度失败', e.message); }
  app.listen(PORT, () => {
    console.log(`[server] 已启动 → http://localhost:${PORT}`);
    console.log(`[server] CORS 放行: ${CORS_ORIGIN.join(', ')}`);
    console.log(`[server] 数据库方言: ${dialect}`);
    // 生产环境护栏：未配置 DATABASE_URL 时会落到 Render 临时磁盘的本地 SQLite，
    // 实例休眠/重启/重新部署即清空数据（作品、相册、订单、财务全部丢失）。绝不允许静默发生。
    const isProdLike = process.env.NODE_ENV === 'production' || process.env.RENDER || process.env.RENDER_EXTERNAL_URL;
    if (dialect !== 'pg' && isProdLike) {
      console.error('');
      console.error('╔══════════════════════════════════════════════════════════════════════════╗');
      console.error('║  ⚠️  严重：生产环境未检测到 DATABASE_URL，当前使用临时本地 SQLite！          ║');
      console.error('║  所有数据（作品/相册/订单/财务）将随实例重启或重新部署丢失。                  ║');
      console.error('║  立即在 Render 环境变量中添加 DATABASE_URL = postgresql://<Neon连接串> 并重新部署。║');
      console.error('╚══════════════════════════════════════════════════════════════════════════╝');
      console.error('');
    }
  });
});
