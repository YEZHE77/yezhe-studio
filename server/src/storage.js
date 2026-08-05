// storage.js —— 图片存储适配（Render 只做「中转」，绝不本地持久化图片二进制）
// 设计（T-01）：前端图片二进制直传 Cloudflare 上传 Worker（密钥只在 Worker）；
// 未部署 Worker 时回退 Render /api/upload，由本文件用 R2 SDK 服务端写入私有 R2 桶。
// 无论哪条路径，Render 本地磁盘都不持久保存任何图片（无 UPLOAD_DIR、无 /uploads 静态目录）。
// DB 只存储 CDN URL 字符串（绝不存 base64 / blob）。Render 重启图片不丢失、不裂图。
import fs from 'node:fs';
import path from 'node:path';
import { run } from './db.js';

// R2（私有桶 + Worker 代理）开关：五项齐全才启用
export function r2Config() {
  const { R2_ENDPOINT, R2_BUCKET, R2_WORKER_DOMAIN, R2_ACCESS_KEY, R2_SECRET_KEY } = process.env;
  if (R2_ENDPOINT && R2_BUCKET && R2_WORKER_DOMAIN && R2_ACCESS_KEY && R2_SECRET_KEY) {
    return { R2_ENDPOINT, R2_BUCKET, R2_WORKER_DOMAIN: R2_WORKER_DOMAIN.replace(/\/$/, ''), R2_ACCESS_KEY, R2_SECRET_KEY };
  }
  return null;
}

export function isR2Enabled() {
  return !!r2Config();
}

// 记录媒资元数据（用于容量管理「按业务分类统计」）—— 失败仅记录，不影响上传主流程
async function recordMedia({ url, category, bytes, isPublic, r2Key }) {
  try {
    await run(
      `INSERT INTO media (url, category, bytes, is_public, r2_key, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [url, category || 'uncategorized', Number(bytes) || 0, isPublic ? 1 : 0, r2Key || null, new Date().toISOString()]
    );
  } catch (e) {
    console.error('[storage] 记录 media 失败', e.message);
  }
}

// 删除 media 元数据行（最佳努力）
export async function removeMedia(url) {
  try {
    await run(`DELETE FROM media WHERE url = ?`, [url]);
  } catch (e) {
    console.error('[storage] 删除 media 记录失败', e.message);
  }
}

export async function saveImage(file, zone = 'biz-works', meta = {}) {
  const ext = path.extname(file.originalname || '') || '.jpg';
  const name = Date.now() + '-' + Math.random().toString(36).slice(2) + ext;

  const cfg = r2Config();
  if (!cfg) {
    // T-01：移除本地磁盘存储。未配置 R2 且没有上传 Worker 时明确报错，绝不悄悄写本地磁盘。
    throw new Error('未配置 R2 或上传 Worker，无法持久化图片；请在 Render 配置 R2_* 环境变量，或部署上传 Worker 并设置 VITE_UPLOAD_WORKER_URL。');
  }
  let url, r2Key = null;
  {
    // 懒加载 S3 SDK（启用 R2 时才需安装 @aws-sdk/client-s3）
    const { PutObjectCommand, S3Client } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region: 'auto',
      endpoint: cfg.R2_ENDPOINT,
      credentials: { accessKeyId: cfg.R2_ACCESS_KEY, secretAccessKey: cfg.R2_SECRET_KEY }
    });
    const key = `${zone}/${name}`;
    const body = fs.readFileSync(file.path);
    await client.send(new PutObjectCommand({
      Bucket: cfg.R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: file.mimetype || 'image/jpeg'
    }));
    fs.unlinkSync(file.path);
    // 返回 Worker 代理的完整 URL，绝不返回原始 R2 桶地址
    url = `${cfg.R2_WORKER_DOMAIN}/r2/${key}`;
    r2Key = key;
  }

  // 记录媒资元数据（业务分类 / 字节数 / 是否公开）—— 容量统计来源，零 R2 遍历
  await recordMedia({
    url,
    category: meta.category || 'uncategorized',
    bytes: file.size || 0,
    isPublic: !!meta.isPublic,
    r2Key
  });
  return url;
}

// 真正删除底层对象（仅 R2），不碰 media 表。T-01：不再有本地磁盘对象。
async function destroyMediaObject(url) {
  const cfg = r2Config();
  if (!cfg || !url || !url.startsWith(cfg.R2_WORKER_DOMAIN + '/r2/')) return;
  const key = url.slice((cfg.R2_WORKER_DOMAIN + '/r2/').length);
  if (!key || key.includes('..')) return;
  const { DeleteObjectCommand, S3Client } = await import('@aws-sdk/client-s3');
  const client = new S3Client({
    region: 'auto',
    endpoint: cfg.R2_ENDPOINT,
    credentials: { accessKeyId: cfg.R2_ACCESS_KEY, secretAccessKey: cfg.R2_SECRET_KEY }
  });
  await client.send(new DeleteObjectCommand({ Bucket: cfg.R2_BUCKET, Key: key }));
}

// 从数据库保存的 Worker URL 提取 R2 key 并删除对象（fire-and-forget，失败仅记录）
export async function deleteFromR2(url) {
  try {
    await destroyMediaObject(url);
    await removeMedia(url);
  } catch (e) {
    console.error('[storage] 删除 R2 对象失败', url, e.message);
  }
}

// 显式删除（容量清理用）：删除底层对象 + media 记录，返回结果供端点上报成败
export async function deleteMediaByUrl(url) {
  try {
    await destroyMediaObject(url);
    await removeMedia(url);
    return { url, ok: true };
  } catch (e) {
    return { url, ok: false, error: String(e && e.message || e) };
  }
}
