// storage.js —— 图片存储适配（Render 只做「中转」，绝不本地持久化图片二进制）
// 设计（T-01）：前端图片二进制直传 Cloudflare 上传 Worker（密钥只在 Worker）；
// 未部署 Worker 时回退 Render /api/upload，由本文件用 R2 SDK 服务端写入私有 R2 桶。
// 无论哪条路径，Render 本地磁盘都不持久保存任何图片（无 UPLOAD_DIR、无 /uploads 静态目录）。
// DB 只存储 CDN URL 字符串（绝不存 base64 / blob）。Render 重启图片不丢失、不裂图。
import fs from 'node:fs';
import path from 'node:path';
import { run, dataDir } from './db.js';

// 分片临时缓冲目录（仅 dev / Worker 不可用回退时使用，瞬态，合并后立即删除，绝不持久化业务图片）
const chunkTmpDir = path.join(dataDir, 'tmp', 'chunks');
try { fs.mkdirSync(chunkTmpDir, { recursive: true }); } catch {}
// 统一 R2 临时分片前缀（生产环境分片也落在 R2，实例重启不丢、不落地本地磁盘）
const CHUNK_PREFIX = 'chunks';

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

// ---- 需求 D：分片上传（压缩小样 >2MB 时启用） ----
// 原生 R2/S3 multipart 要求每片 ≥5MB，spec 用 512KB 分片无法走原生 multipart；
// 故后端在 R2 临时 key 缓冲分片（任意片大小均可），全部到达后顺序合并为单一对象落库。
// dev 无 R2 时本地 tmp 兜底（合并即删，仅回退路径使用），prod 无 R2 仍报错不写本地业务图片。

// 保存 Buffer 到 R2（复用 PutObject 写入），返回 Worker 代理 URL + r2Key
export async function saveBuffer(buffer, ext, zone = 'biz-works', meta = {}) {
  const cfg = r2Config();
  if (!cfg) {
    throw new Error('未配置 R2 或上传 Worker，无法持久化图片；请在 Render 配置 R2_* 环境变量，或部署上传 Worker 并设置 VITE_UPLOAD_WORKER_URL。');
  }
  const name = Date.now() + '-' + Math.random().toString(36).slice(2) + (ext || '.jpg');
  const { PutObjectCommand, S3Client } = await import('@aws-sdk/client-s3');
  const client = new S3Client({
    region: 'auto',
    endpoint: cfg.R2_ENDPOINT,
    credentials: { accessKeyId: cfg.R2_ACCESS_KEY, secretAccessKey: cfg.R2_SECRET_KEY }
  });
  const key = `${zone}/${name}`;
  await client.send(new PutObjectCommand({
    Bucket: cfg.R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: meta.contentType || 'image/jpeg'
  }));
  const url = `${cfg.R2_WORKER_DOMAIN}/r2/${key}`;
  const r2Key = key;
  await recordMedia({
    url,
    category: meta.category || 'uncategorized',
    bytes: buffer.length || 0,
    isPublic: !!meta.isPublic,
    r2Key
  });
  return { url, name, r2Key };
}

// 写入单个分片（dev 落本地 tmp，prod 落 R2 临时 key）
export async function putChunk(uploadId, partNo, buffer) {
  const cfg = r2Config();
  if (cfg) {
    const { PutObjectCommand, S3Client } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region: 'auto',
      endpoint: cfg.R2_ENDPOINT,
      credentials: { accessKeyId: cfg.R2_ACCESS_KEY, secretAccessKey: cfg.R2_SECRET_KEY }
    });
    const key = `${CHUNK_PREFIX}/${uploadId}/${partNo}`;
    await client.send(new PutObjectCommand({ Bucket: cfg.R2_BUCKET, Key: key, Body: buffer }));
  } else {
    const dir = path.join(chunkTmpDir, String(uploadId));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, String(partNo)), buffer);
  }
}

// 列出某 uploadId 已存在的分片序号（升序，用于断点续传）
export async function listChunks(uploadId) {
  const cfg = r2Config();
  if (cfg) {
    const { ListObjectsV2Command, S3Client } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region: 'auto',
      endpoint: cfg.R2_ENDPOINT,
      credentials: { accessKeyId: cfg.R2_ACCESS_KEY, secretAccessKey: cfg.R2_SECRET_KEY }
    });
    const prefix = `${CHUNK_PREFIX}/${uploadId}/`;
    const out = await client.send(new ListObjectsV2Command({ Bucket: cfg.R2_BUCKET, Prefix: prefix }));
    return (out.Contents || [])
      .map((o) => Number(o.Key.slice(prefix.length)))
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => a - b);
  }
  const dir = path.join(chunkTmpDir, String(uploadId));
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map(Number).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
}

// 读取单个分片二进制
export async function getChunkBuffer(uploadId, partNo) {
  const cfg = r2Config();
  if (cfg) {
    const { GetObjectCommand, S3Client } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region: 'auto',
      endpoint: cfg.R2_ENDPOINT,
      credentials: { accessKeyId: cfg.R2_ACCESS_KEY, secretAccessKey: cfg.R2_SECRET_KEY }
    });
    const key = `${CHUNK_PREFIX}/${uploadId}/${partNo}`;
    const r = await client.send(new GetObjectCommand({ Bucket: cfg.R2_BUCKET, Key: key }));
    return Buffer.from(await r.Body.transformToByteArray());
  }
  return fs.readFileSync(path.join(chunkTmpDir, String(uploadId), String(partNo)));
}

// 删除某 uploadId 的全部分片（合并成功后清理）
export async function deleteChunks(uploadId) {
  const cfg = r2Config();
  if (cfg) {
    const parts = await listChunks(uploadId);
    if (!parts.length) return;
    const { DeleteObjectsCommand, S3Client } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region: 'auto',
      endpoint: cfg.R2_ENDPOINT,
      credentials: { accessKeyId: cfg.R2_ACCESS_KEY, secretAccessKey: cfg.R2_SECRET_KEY }
    });
    await client.send(new DeleteObjectsCommand({
      Bucket: cfg.R2_BUCKET,
      Delete: { Objects: parts.map((p) => ({ Key: `${CHUNK_PREFIX}/${uploadId}/${p}` })) }
    }));
  } else {
    fs.rmSync(path.join(chunkTmpDir, String(uploadId)), { recursive: true, force: true });
  }
}

// 顺序合并分片 → 落库 R2 → 清分片；返回 { url, name, r2Key }
export async function mergeChunks(uploadId, ext, zone = 'biz-works', meta = {}) {
  const parts = await listChunks(uploadId);
  if (!parts.length) throw new Error('未找到任何分片，无法合并');
  const buffers = [];
  let total = 0;
  for (const p of parts) {
    const b = await getChunkBuffer(uploadId, p);
    buffers.push(b);
    total += b.length;
  }
  const merged = Buffer.concat(buffers, total);
  // 单张硬性限制 3M：分片合并后再次校验（兜底），超限则不存储并清理分片
  if (total > 3 * 1024 * 1024) {
    await deleteChunks(uploadId);
    throw new Error('文件超过3M限制');
  }
  const result = await saveBuffer(merged, ext, zone, meta);
  await deleteChunks(uploadId);
  return result;
}
