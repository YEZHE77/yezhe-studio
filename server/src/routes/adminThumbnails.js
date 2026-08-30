// 缩略图批量生成端点（管理员）
// 用途：补齐历史图片的 R2 缩略图变体（thumb_400/thumb_1080），让 Worker ?w= 查询命中后返回小图，
//       解决手机端首屏加载几十秒的问题。
// 用法：登录后台 → 拿 token → POST /api/admin/gen-thumbnails → 后台执行，GET /status 看进度
//
// 设计：单进程串行 + 后台异步，避免阻塞请求 + Render 30 秒超时。
//       幂等：已存在 thumb_400 变体的原图自动跳过；可重复触发。
//       自保活：Render 免费实例 15 分钟无外部请求会休眠并杀掉后台任务，故生成循环内每隔一段时间
//             主动 fetch 自身 RENDER_EXTERNAL_URL，制造外部请求保活，确保长任务能跑完。
// 安全：仅 admin 角色可触发；进度保存在内存（重启即清零，下次再触发会跳过已生成的）。
import express from 'express';
import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { authRequired, requireRole } from '../auth.js';
import { r2Config, activeProvider } from '../storage.js';

const router = express.Router();

// 临时诊断：返回后端实际使用的 R2 配置标识（不含密钥），用于排查缩略图写入桶与 Worker 读取桶不一致问题。
// TODO: 确认后删除本路由。
router.get('/r2-debug', authRequired, requireRole('admin'), (req, res) => {
  const r2 = r2Config();
  if (!r2) return res.json({ configured: false, activeProvider: activeProvider() });
  let endpointHost = '';
  try { endpointHost = new URL(r2.R2_ENDPOINT).host; } catch {}
  res.json({
    configured: true,
    activeProvider: activeProvider(),
    R2_BUCKET: r2.R2_BUCKET,
    R2_ENDPOINT_HOST: endpointHost,
    R2_WORKER_DOMAIN: r2.R2_WORKER_DOMAIN,
  });
});

// 宽度严格对齐前端 img() 用法：网格 thumb=400，预览 preview=1080（不再生成无用的 800，也不生成与前端不匹配的 1200）
const THUMB_WIDTHS = [400, 1080];
const QUALITY = 75;
const PREFIXES = ['biz-works', 'biz-albums', 'biz-orders', 'biz-avatar', 'biz-cover', 'biz-bg', 'biz-other'];
const SKIP_KEY_PARTS = ['/thumb_', '/chunks/'];

// 进度（模块级单例，进程内有效；重启丢失不影响幂等性）
const progress = {
  running: false,
  startedAt: null,
  finishedAt: null,
  totalListed: 0,
  processed: 0,
  generated: 0,
  skipped: 0,
  failed: 0,
  currentKey: '',
  prefix: '',
  error: null,
};

function thumbKeyOf(originalKey, width) {
  const idx = originalKey.lastIndexOf('/');
  if (idx === -1) return `thumb_${width}/${originalKey}`;
  const dir = originalKey.substring(0, idx);
  const name = originalKey.substring(idx + 1);
  return `${dir}/thumb_${width}/${name}`;
}

// 自保活：Render 免费实例 15 分钟无外部请求会休眠（杀掉后台任务）。生成循环内周期性地主动访问自身
// 外部 URL，制造外部流量，保持实例清醒直到任务跑完。失败静默忽略。
let _lastPing = 0;
async function keepAliveIfNeeded() {
  if (!process.env.RENDER_EXTERNAL_URL) return;
  const now = Date.now();
  if (now - _lastPing < 120000) return; // 每 ~2 分钟一次足够（远低于 15 分钟阈值）
  _lastPing = now;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    await fetch(`${process.env.RENDER_EXTERNAL_URL}/api/health`, { signal: ctrl.signal });
    clearTimeout(t);
  } catch (_) { /* 保活失败不影响主流程 */ }
}

async function runGeneration(client, bucket, prefixes) {
  for (const prefix of prefixes) {
    progress.prefix = prefix;
    let token;
    do {
      const list = await client.send(new ListObjectsV2Command({
        Bucket: bucket, Prefix: prefix + '/', ContinuationToken: token, MaxKeys: 1000,
      }));
      const keys = (list.Contents || []).map((o) => o.Key).filter(Boolean);
      progress.totalListed += keys.length;
      for (const key of keys) {
        progress.currentKey = key;
        if (SKIP_KEY_PARTS.some((p) => key.includes(p))) { progress.skipped++; continue; }
        const ext = (key.split('.').pop() || '').toLowerCase();
        if (!['jpg','jpeg','png','webp','gif','avif','tiff'].includes(ext)) { progress.skipped++; continue; }
        try {
          // 幂等标志必须查 thumb_1080 而非 thumb_400：
          // 早期批次曾用 [400,800,1200] 生成，导致有 thumb_400 但缺 thumb_1080（预览大图降级原图）。
          // 查 1080 才能确保「400+1080 两档都齐」才跳过，否则会漏补 1080。
          try {
            await client.send(new HeadObjectCommand({ Bucket: bucket, Key: thumbKeyOf(key, 1080) }));
            progress.skipped++;
            continue;
          } catch {}
          const obj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
          const buf = Buffer.from(await obj.Body.transformToByteArray());
          for (const w of THUMB_WIDTHS) {
            const out = await sharp(buf).rotate()
              .resize({ width: w, withoutEnlargement: true, fit: 'inside' })
              .jpeg({ quality: QUALITY, mozjpeg: true })
              .toBuffer();
            await client.send(new PutObjectCommand({
              Bucket: bucket, Key: thumbKeyOf(key, w), Body: out, ContentType: 'image/jpeg',
            }));
            progress.generated++;
          }
          progress.processed++;
        } catch (e) {
          progress.failed++;
          console.error('[gen-thumbnails] ✗', key, e.message);
        }
        // 周期性自保活，防止 Render 免费实例因无外部请求休眠而杀掉长任务
        await keepAliveIfNeeded();
      }
      token = list.NextContinuationToken;
    } while (token);
  }
}

// 触发生成（后台执行，立刻返回）
router.post('/gen-thumbnails', authRequired, requireRole('admin'), async (req, res) => {
  if (progress.running) return res.status(409).json({ error: '已有任务在运行', progress });
  const r2 = r2Config();
  if (!r2) return res.status(500).json({ error: '未配置 R2（缺少 R2_* 环境变量）' });

  // 重置进度
  Object.assign(progress, {
    running: true, startedAt: new Date().toISOString(), finishedAt: null,
    totalListed: 0, processed: 0, generated: 0, skipped: 0, failed: 0,
    currentKey: '', prefix: '', error: null,
  });

  const client = new S3Client({
    region: 'auto',
    endpoint: r2.R2_ENDPOINT,
    credentials: { accessKeyId: r2.R2_ACCESS_KEY, secretAccessKey: r2.R2_SECRET_KEY },
  });

  // 异步执行（不 await）
  runGeneration(client, r2.R2_BUCKET, PREFIXES).then(() => {
    progress.running = false;
    progress.finishedAt = new Date().toISOString();
    progress.currentKey = '';
    console.log(`[gen-thumbnails] 完成: 列出=${progress.totalListed} 处理=${progress.processed} 生成=${progress.generated} 跳过=${progress.skipped} 失败=${progress.failed}`);
  }).catch((e) => {
    progress.running = false;
    progress.finishedAt = new Date().toISOString();
    progress.error = e.message;
    console.error('[gen-thumbnails] 异常终止', e);
  });

  res.json({ ok: true, message: '后台开始执行，轮询 /status 查看进度', progress });
});

// 查询进度（同一进程内的任何商家角色都能看，便于排查）
router.get('/gen-thumbnails/status', authRequired, requireRole('admin','photographer','finance','selector'), (req, res) => {
  res.json(progress);
});

export default router;