// storage.js —— 图片存储适配（Render 只做「中转」，绝不本地持久化图片二进制）
// 设计：前端图片二进制直传 Cloudflare 上传 Worker（密钥只在 Worker，可选）；
// 未部署 Worker 时回退 Render /api/upload，由本文件用 S3 兼容 SDK 服务端写入对象存储。
// 支持两种 S3 兼容后端：腾讯云 COS（优先）、Cloudflare R2（兜底）。
// 代码全环境变量驱动：填 COS_* 即切 COS；未填 COS 但填 R2_* 走 R2；都未填则明确报错。
// 业务 URL 形态：
//   COS → ${COS_CDN_DOMAIN}/${key}      （COS 国内 CDN 域名 + 对象 key）
//   R2  → ${R2_WORKER_DOMAIN}/r2/${key} （Worker 只读代理 + 对象 key）
// 无论哪条路径，Render 本地磁盘都不持久保存任何业务图片（无 UPLOAD_DIR、无 /uploads 静态目录）。
// DB 只存储 CDN URL 字符串（绝不存 base64 / blob）。Render 重启图片不丢失、不裂图。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { run, dataDir } from './db.js';

// 分片临时缓冲目录（仅 dev / 云存储不可用时回退使用，瞬态，合并后立即删除，绝不持久化业务图片）
const chunkTmpDir = path.join(dataDir, 'tmp', 'chunks');
try { fs.mkdirSync(chunkTmpDir, { recursive: true }); } catch {}
// 统一云端临时分片前缀（生产环境分片也落在对象存储，实例重启不丢、不落地本地磁盘）
const CHUNK_PREFIX = 'chunks';

// ============ 存储 provider 配置 ============

// 腾讯云 COS（S3 兼容接口）：五项齐全才启用（优先于 R2）
export function cosConfig() {
  const { COS_SECRET_ID, COS_SECRET_KEY, COS_BUCKET, COS_REGION, COS_CDN_DOMAIN } = process.env;
  if (COS_SECRET_ID && COS_SECRET_KEY && COS_BUCKET && COS_REGION && COS_CDN_DOMAIN) {
    return {
      secretId: COS_SECRET_ID,
      secretKey: COS_SECRET_KEY,
      bucket: COS_BUCKET,
      region: COS_REGION,
      cdnDomain: COS_CDN_DOMAIN.replace(/\/$/, '')
    };
  }
  return null;
}

// Cloudflare R2（私有桶 + Worker 代理）：五项齐全才启用（COS 优先于 R2）
export function r2Config() {
  const { R2_ENDPOINT, R2_BUCKET, R2_WORKER_DOMAIN, R2_ACCESS_KEY, R2_SECRET_KEY } = process.env;
  if (R2_ENDPOINT && R2_BUCKET && R2_WORKER_DOMAIN && R2_ACCESS_KEY && R2_SECRET_KEY) {
    return { R2_ENDPOINT, R2_BUCKET, R2_WORKER_DOMAIN: R2_WORKER_DOMAIN.replace(/\/$/, ''), R2_ACCESS_KEY, R2_SECRET_KEY };
  }
  return null;
}

// 当前生效的存储 provider：'cos' | 'r2' | null（COS 优先）
export function activeProvider() {
  if (cosConfig()) return 'cos';
  if (r2Config()) return 'r2';
  return null;
}

// 是否接入任意云端存储（COS 或 R2）
export function isCloudStorageEnabled() {
  return activeProvider() !== null;
}

// 兼容旧名：R2 是否为「当前生效」provider（COS 生效时为 false）
export function isR2Enabled() {
  return activeProvider() === 'r2';
}

// R2 凭据是否填齐（无论是否生效，用于 R2 专用增强展示判断）
export function isR2Configured() {
  return !!r2Config();
}

export function getActiveProviderName() {
  return activeProvider();
}

// 取某 provider 的配置对象
function providerConfig(provider) {
  return provider === 'cos' ? cosConfig() : r2Config();
}

// 取某 provider 的桶名
export function bucketOf(provider) {
  const c = providerConfig(provider);
  return provider === 'cos' ? c.bucket : c.R2_BUCKET;
}

// 根据 provider 构造 S3 客户端（COS 用 region 化 endpoint，R2 用 auto + 自定义 endpoint）
export async function makeS3Client(provider) {
  const { S3Client } = await import('@aws-sdk/client-s3');
  if (provider === 'cos') {
    const c = cosConfig();
    return new S3Client({
      region: c.region,
      endpoint: `https://cos.${c.region}.myqcloud.com`,
      credentials: { accessKeyId: c.secretId, secretAccessKey: c.secretKey }
    });
  }
  const c = r2Config();
  return new S3Client({
    region: 'auto',
    endpoint: c.R2_ENDPOINT,
    credentials: { accessKeyId: c.R2_ACCESS_KEY, secretAccessKey: c.R2_SECRET_KEY }
  });
}

// 由 provider + key 拼出对外 URL
export function objectUrl(provider, key) {
  const c = providerConfig(provider);
  return provider === 'cos' ? `${c.cdnDomain}/${key}` : `${c.R2_WORKER_DOMAIN}/r2/${key}`;
}

// 缩略图尺寸规格：列表卡片 / 详情预览 / 高清预览（按需取用，命中 Worker ?w=<width> 路径）
// 改这里时必须同时检查 cloudflare/worker.js 的 buildThumbKey（路径规则一致）
const THUMB_WIDTHS = [400, 800, 1200];
const THUMB_QUALITY = 75; // JPEG quality，75 视觉无损 + 体积小

// 由原始 key 推算缩略图 key：biz-works/xxx.jpg → biz-works/thumb_400/xxx.jpg
function thumbKey(originalKey, width) {
  const idx = originalKey.lastIndexOf('/');
  if (idx === -1) return `thumb_${width}/${originalKey}`;
  const dir = originalKey.substring(0, idx);
  const name = originalKey.substring(idx + 1);
  return `${dir}/thumb_${width}/${name}`;
}

// 由已存 URL 拼出指定宽度的缩略图 URL（前端 thumb()/img('thumb') 共用此规则）
// 仅对 R2 Worker 域名有意义（COS 可走 CDN image processing 或 Cloudflare Image Resizing）
export function thumbnailUrl(originalUrl, width) {
  if (!originalUrl || !width) return originalUrl || '';
  // R2 Worker: 拼 ?w=<width>，Worker 内部会查 thumb_<width>/ 变体
  const r2 = r2Config();
  if (r2 && originalUrl.startsWith(r2.R2_WORKER_DOMAIN + '/r2/')) {
    const u = new URL(originalUrl);
    u.searchParams.set('w', String(width));
    return u.toString();
  }
  // COS: 直接拼 thumb_<width>/ 子路径（前提是后端上传时生成了对应变体）
  const cos = cosConfig();
  if (cos && originalUrl.startsWith(cos.cdnDomain + '/')) {
    return originalUrl.replace(/^(.+?)\/([^/]+)$/, `$1/thumb_${width}/$2`);
  }
  return originalUrl;
}

// 用 sharp 生成三个尺寸缩略图，返回 [{key, buffer}]；输入 buffer + 原 key
// 失败抛出，由调用方决定是否降级（不影响主上传）
async function generateThumbnailVariants(buffer, originalKey) {
  let sharpLib;
  try {
    sharpLib = (await import('sharp')).default;
  } catch (e) {
    throw new Error('sharp 模块不可用: ' + (e && e.message));
  }
  const ext = (originalKey.split('.').pop() || '').toLowerCase();
  // 跳过非图片格式（无法 decode）
  if (!['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'tiff'].includes(ext)) return [];
  const out = [];
  for (const w of THUMB_WIDTHS) {
    try {
      const t = sharpLib(buffer).rotate(); // 按 EXIF 自动旋正
      const resized = await t.resize({ width: w, withoutEnlargement: true, fit: 'inside' })
        .jpeg({ quality: THUMB_QUALITY, mozjpeg: true })
        .toBuffer();
      out.push({ key: thumbKey(originalKey, w), buffer: resized, width: w });
    } catch (e) {
      console.warn('[storage] 生成缩略图失败', originalKey, 'w=' + w, e.message);
    }
  }
  return out;
}

// 上传缩略图变体到对象存储（best-effort；失败仅记录，不影响主上传）
async function uploadThumbnailVariants(zone, name, variants, provider) {
  if (!variants || !variants.length) return;
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const client = await makeS3Client(provider);
  for (const v of variants) {
    try {
      await client.send(new PutObjectCommand({
        Bucket: bucketOf(provider),
        Key: v.key,
        Body: v.buffer,
        ContentType: 'image/jpeg'
      }));
    } catch (e) {
      console.warn('[storage] 上传缩略图失败', v.key, e.message);
    }
  }
}

// 删除原图时同步清理其缩略图变体（best-effort）
async function destroyThumbnailVariants(originalKey, provider) {
  try {
    const { DeleteObjectsCommand } = await import('@aws-sdk/client-s3');
    const client = await makeS3Client(provider);
    const objs = THUMB_WIDTHS.map((w) => ({ Key: thumbKey(originalKey, w) }));
    await client.send(new DeleteObjectsCommand({ Bucket: bucketOf(provider), Delete: { Objects: objs } }));
  } catch (e) {
    console.warn('[storage] 删除缩略图失败', originalKey, e.message);
  }
}

// 由已存 URL 反推 provider（用于删除 / 迁移）
export function matchProviderByUrl(url) {
  if (!url) return null;
  const cos = cosConfig();
  if (cos && url.startsWith(cos.cdnDomain + '/')) return 'cos';
  const r2 = r2Config();
  if (r2 && url.startsWith(r2.R2_WORKER_DOMAIN + '/r2/')) return 'r2';
  return null;
}

// 记录媒资元数据（用于容量管理「按业务分类统计」）—— 同步写入（同步上传模式：
// 必须在上传接口返回前完成 hash + 元数据），失败仅记录，不影响上传主流程
async function recordMedia({ url, category, bytes, isPublic, r2Key, hash }) {
  try {
    await run(
      `INSERT INTO media (url, category, bytes, is_public, r2_key, hash, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'ready', ?)`,
      [url, category || 'uncategorized', Number(bytes) || 0, isPublic ? 1 : 0, r2Key || null, hash || null, new Date().toISOString()]
    );
  } catch (e) {
    // 唯一索引冲突（重复写入）视为成功，忽略
    if (!/unique|duplicate/i.test(e && e.message || '')) {
      console.error('[storage] 记录 media 失败', url, e.message);
    }
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

  const provider = activeProvider();
  if (!provider) {
    // 未配置 COS 或 R2 时明确报错，绝不悄悄写本地磁盘。
    throw new Error('未配置云端存储（COS / R2），无法持久化图片；请在 Render 配置 COS_*（推荐）或 R2_* 环境变量。');
  }
  let url, storeKey = null;
  // 同步计算内容 hash（内容级去重，best-effort）—— 在删除临时文件前完成
  let hash = null;
  const body = fs.readFileSync(file.path);
  try {
    hash = crypto.createHash('sha256').update(body).digest('hex');
  } catch (e) {
    console.warn('[storage] hash 计算失败（不影响上传）', e.message);
  }
  {
    // 懒加载 S3 SDK（启用对象存储时才需安装 @aws-sdk/client-s3）
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await makeS3Client(provider);
    const key = `${zone}/${name}`;
    await client.send(new PutObjectCommand({
      Bucket: bucketOf(provider),
      Key: key,
      Body: body,
      ContentType: file.mimetype || 'image/jpeg'
    }));
    fs.unlinkSync(file.path);
    // 返回对外完整 URL（绝不返回原始桶地址）
    url = objectUrl(provider, key);
    storeKey = key;
  }

  // 同步生成缩略图变体（best-effort；失败仅记录，不影响主上传；前端列表用 thumb_400 提速 5-10 倍）
  try {
    const variants = await generateThumbnailVariants(body, storeKey);
    if (variants.length) await uploadThumbnailVariants(zone, name, variants, provider);
  } catch (e) {
    console.warn('[storage] 缩略图生成/上传失败（原图不受影响）', e.message);
  }

  // 同步登记媒资（容量统计 + hash），在上传响应前完成（同步模式，不再走异步队列）
  await recordMedia({ url, category: meta.category, bytes: file.size, isPublic: meta.isPublic, r2Key: storeKey, hash });
  return { url, r2Key: storeKey, name, hash };
}

// 真正删除底层对象（COS / R2），不碰 media 表。
async function destroyMediaObject(url) {
  const provider = matchProviderByUrl(url);
  if (!provider) return;
  const cfg = providerConfig(provider);
  if (!cfg) return;
  const prefix = provider === 'cos' ? `${cfg.cdnDomain}/` : `${cfg.R2_WORKER_DOMAIN}/r2/`;
  if (!url.startsWith(prefix)) return;
  const key = url.slice(prefix.length);
  if (!key || key.includes('..')) return;
  const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
  const client = await makeS3Client(provider);
  await client.send(new DeleteObjectCommand({ Bucket: bucketOf(provider), Key: key }));
  // 同步删除缩略图变体（best-effort；不影响主删除流程）
  await destroyThumbnailVariants(key, provider);
}

// 从数据库保存的 URL 提取对象 key 并删除（fire-and-forget，失败仅记录）。provider 无关。
export async function deleteFromR2(url) {
  try {
    await destroyMediaObject(url);
    await removeMedia(url);
  } catch (e) {
    console.error('[storage] 删除对象失败', url, e.message);
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

// 保存 Buffer 到对象存储（复用 PutObject 写入），返回对外 URL + storeKey
export async function saveBuffer(buffer, ext, zone = 'biz-works', meta = {}) {
  const provider = activeProvider();
  if (!provider) {
    throw new Error('未配置云端存储（COS / R2），无法持久化图片；请在 Render 配置 COS_*（推荐）或 R2_* 环境变量。');
  }
  const name = Date.now() + '-' + Math.random().toString(36).slice(2) + (ext || '.jpg');
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const client = await makeS3Client(provider);
  const key = `${zone}/${name}`;
  await client.send(new PutObjectCommand({
    Bucket: bucketOf(provider),
    Key: key,
    Body: buffer,
    ContentType: meta.contentType || 'image/jpeg'
  }));
  const url = objectUrl(provider, key);
  const storeKey = key;
  // 同步计算 hash + 登记媒资（同步上传模式，分片合并路径同样适用）
  let hash = null;
  try { hash = crypto.createHash('sha256').update(buffer).digest('hex'); } catch (e) {}
  // 同步生成缩略图变体（best-effort；失败仅记录）
  try {
    const variants = await generateThumbnailVariants(buffer, storeKey);
    if (variants.length) await uploadThumbnailVariants(zone, name, variants, provider);
  } catch (e) {
    console.warn('[storage] 缩略图生成/上传失败（原图不受影响）', e.message);
  }
  await recordMedia({ url, category: meta.category, bytes: buffer.length, isPublic: meta.isPublic, r2Key: storeKey, hash });
  return { url, name, r2Key: storeKey, hash };
}

// ---- 需求 D：分片上传（压缩小样 >2MB 时启用） ----
// 原生 R2/S3 multipart 要求每片 ≥5MB，spec 用 512KB 分片无法走原生 multipart；
// 故后端在对象存储临时 key 缓冲分片（任意片大小均可），全部到达后顺序合并为单一对象落库。
// 未配置任何云存储时本地 tmp 兜底（合并即删，仅回退路径使用），但业务图片最终仍需云存储落库，
// 故 saveBuffer（合并落库）仍要求 provider，否则报错。

// 写入单个分片（云存储落临时 key，未配置时本地 tmp）
export async function putChunk(uploadId, partNo, buffer) {
  const provider = activeProvider();
  if (provider) {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await makeS3Client(provider);
    const key = `${CHUNK_PREFIX}/${uploadId}/${partNo}`;
    await client.send(new PutObjectCommand({ Bucket: bucketOf(provider), Key: key, Body: buffer }));
  } else {
    const dir = path.join(chunkTmpDir, String(uploadId));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, String(partNo)), buffer);
  }
}

// 列出某 uploadId 已存在的分片序号（升序，用于断点续传）
export async function listChunks(uploadId) {
  const provider = activeProvider();
  if (provider) {
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    const client = await makeS3Client(provider);
    const prefix = `${CHUNK_PREFIX}/${uploadId}/`;
    const out = await client.send(new ListObjectsV2Command({ Bucket: bucketOf(provider), Prefix: prefix }));
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
  const provider = activeProvider();
  if (provider) {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await makeS3Client(provider);
    const key = `${CHUNK_PREFIX}/${uploadId}/${partNo}`;
    const r = await client.send(new GetObjectCommand({ Bucket: bucketOf(provider), Key: key }));
    return Buffer.from(await r.Body.transformToByteArray());
  }
  return fs.readFileSync(path.join(chunkTmpDir, String(uploadId), String(partNo)));
}

// 删除某 uploadId 的全部分片（合并成功后清理）
export async function deleteChunks(uploadId) {
  const provider = activeProvider();
  if (provider) {
    const parts = await listChunks(uploadId);
    if (!parts.length) return;
    const { DeleteObjectsCommand } = await import('@aws-sdk/client-s3');
    const client = await makeS3Client(provider);
    await client.send(new DeleteObjectsCommand({
      Bucket: bucketOf(provider),
      Delete: { Objects: parts.map((p) => ({ Key: `${CHUNK_PREFIX}/${uploadId}/${p}` })) }
    }));
  } else {
    fs.rmSync(path.join(chunkTmpDir, String(uploadId)), { recursive: true, force: true });
  }
}

// 顺序合并分片 → 落库对象存储 → 清分片；返回 { url, name, r2Key }
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
  // 单张硬性限制 15M：分片合并后再次校验（兜底），超限则不存储并清理分片
  if (total > 15 * 1024 * 1024) {
    await deleteChunks(uploadId);
    throw new Error('文件超过15M限制');
  }
  const result = await saveBuffer(merged, ext, zone, meta);
  await deleteChunks(uploadId);
  return result;
}

// ===== 私有对象读写（合同文件走私有存储 + 后端鉴权中转，不通过公开 Worker 代理） =====

// 按对象 key 读取完整二进制（合同下载鉴权中转用）
export async function getObjectBuffer(key) {
  const provider = activeProvider();
  if (!provider) throw new Error('未配置云端存储');
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const client = await makeS3Client(provider);
  const r = await client.send(new GetObjectCommand({ Bucket: bucketOf(provider), Key: key }));
  return Buffer.from(await r.Body.transformToByteArray());
}

// 按对象 key 删除（合同作废 / 销毁时物理删除底层对象）
export async function deleteObjectByKey(key) {
  const provider = activeProvider();
  if (!provider) return;
  const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
  const client = await makeS3Client(provider);
  await client.send(new DeleteObjectCommand({ Bucket: bucketOf(provider), Key: key }));
}
