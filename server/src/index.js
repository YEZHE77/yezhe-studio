// index.js —— Express 入口
import './env.js';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import QRCode from 'qrcode';
import path from 'node:path';
import fs from 'node:fs';
import { dialect, dataDir } from './db.js';
import { initSchema } from './schema.js';
import { saveImage } from './storage.js';
import { scheduleConsistencyCheck } from './consistencyCheck.js';
import { scheduleReminders } from './reminder.js';
import { authRequired } from './auth.js';
import { seedIfNeeded } from './seed.js';

import authRoutes from './routes/auth.js';
import worksRoutes from './routes/works.js';
import categoriesRoutes from './routes/categories.js';
import channelsRoutes from './routes/channels.js';
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
import uploadChunkRoutes from './routes/uploadChunk.js';
import uploadFileRoutes from './routes/uploadFile.js';
import adminThumbnailsRoutes from './routes/adminThumbnails.js';
import messageRoutes from './routes/message.js';
import mobileMessageRoutes from './routes/mobileMessage.js';
import photoPackageRoutes from './routes/photoPackage.js';
import publicRoutes from './routes/public.js';
import contractRoutes from './routes/contract.js';
import todoRoutes from './routes/todo.js';
import usersRoutes from './routes/users.js';

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
    // 单张硬性限制 15M（与 multer 一致）；前端已压缩，此处为安全兜底
    if (req.file.size > 15 * 1024 * 1024) {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(400).json({ error: '文件超过15M限制' });
    }
    // 单图上传多为封面/样片（默认公开）；前端可显式传 category（type 枚举）/ isPublic
    const meta = {
      category: req.body.category || 'cover',
      isPublic: req.body.isPublic === undefined
        ? true
        : (req.body.isPublic === '1' || req.body.isPublic === 'true' || req.body.isPublic === true)
    };
    const { url, r2Key } = await saveImage(req.file, 'biz-works', meta);
    // 同步模式：saveImage 内部已同步完成「存储 + hash + 媒资登记」，接口直接返回 url
    res.json({ url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 批量上传（作品相册等场景，3 张并发一组，避免压垮服务器）
app.post('/api/upload-multiple', authRequired, upload.array('files', 500), async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: '未收到文件' });
    // 单张硬性限制 15M（与 multer 一致）
    const tooBig = files.find((f) => f.size > 15 * 1024 * 1024);
    if (tooBig) {
      files.forEach((f) => { try { fs.unlinkSync(f.path); } catch {} });
      return res.status(400).json({ error: '文件超过15M限制' });
    }
    // 批量多为客片/底片/精修（默认非公开）；前端可显式传 category（type 枚举）/ isPublic
    const meta = {
      category: req.body.category || 'client',
      isPublic: req.body.isPublic === '1' || req.body.isPublic === 'true' || req.body.isPublic === true
    };
    const urls = [];
    for (let i = 0; i < files.length; i += 3) {
      const batch = files.slice(i, i + 3);
      const batchRes = await Promise.all(batch.map((f) => saveImage(f, 'customer-demo', meta)));
      for (let k = 0; k < batch.length; k++) {
        urls.push(batchRes[k].url);
      }
    }
    // 同步模式：saveImage 内部已逐张完成「存储 + hash + 媒资登记」，接口直接返回所有 url
    res.json({ urls });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 生成分享二维码（公开）：GET /api/qrcode?text=URL 或 ?albumId=ID → 返回 PNG dataURL
// 三端共用（小程序 qrcode 页 + 网页 AlbumGrid 分享），逻辑与 /api/settings/qrcode 一致
app.get('/api/qrcode', async (req, res) => {
  try {
    let text = (req.query.text || '').toString();
    if (!text && req.query.albumId) {
      text = 'https://yezhe-studio.pages.dev/w/' + req.query.albumId;
    }
    if (!text) return res.status(400).json({ error: 'missing text or albumId' });
    const dataUrl = await QRCode.toDataURL(text, { width: 480, margin: 2, color: { dark: '#1a1a1a', light: '#ffffff' } });
    res.json({ dataUrl });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/works', worksRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/channels', channelsRoutes);
app.use('/api/albums', albumsRoutes);
app.use('/api/selection', selectionRoutes);
app.use('/api/message', messageRoutes);
app.use('/api/mobile/message', mobileMessageRoutes);
app.use('/api/photo-package', photoPackageRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/contract', contractRoutes);
app.use('/api/todo', todoRoutes);
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
app.use('/api/admin', adminThumbnailsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/share', shareRoutes);
app.use('/api/shares', sharesRoutes);
app.use('/api/galleries', galleriesRoutes);
app.use('/api/upload', uploadChunkRoutes);
app.use('/api/files', uploadFileRoutes);

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
  // 备份由外部 Mac mini + rclone 独立完成，业务层不做自动备份（安全需求第7条）
  // 数据一致性巡检：每日凌晨 02:00 批量校验（档期冲突/精修超额/合同快照不匹配/套系未绑模板），异常入库 + 推送提醒
  try { scheduleConsistencyCheck(); } catch (e) { console.error('[check] 调度失败', e.message); }
  // 业务提醒扫描：每日 08:00（选片任务到期 / 摄影日程临近 → 生成移动端消息）
  try { scheduleReminders(); } catch (e) { console.error('[reminder] 调度失败', e.message); }
  const server = app.listen(PORT, () => {
    console.log(`[server] 已启动 → http://localhost:${PORT}`);
    console.log(`[server] CORS 放行: ${CORS_ORIGIN.join(', ')}`);
    console.log(`[server] 数据库方言: ${dialect}`);
  });
  // 需求 D：上传接口超时放大到 60 秒（分片小、连接多，单请求远超默认短超时，
  // 避免弱网下大图/多分片被过早掐断）。Node 默认 server.timeout=0（无限），此处显式设为 60s。
  server.setTimeout(60000);
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
