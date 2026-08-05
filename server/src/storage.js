// storage.js —— 图片存储适配
// 未配置 R2 → 存本地 server/data/uploads，返回 /uploads/xxx（兜底，零账号）
// 配置齐全 R2 → 上传到私有 R2 桶，返回 Worker 代理域名 URL（前端从不直连 R2 桶）
//
// 目录规划（zone）：
//   biz-works/     公开工作室作品（小程序作品页展示）
//   customer-demo/ 客户相册选片小样（订单、在线选片、成片相册）
//   temp-upload/   临时上传文件
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './db.js';

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(dataDir, 'uploads');
const PUBLIC_BASE = process.env.PUBLIC_UPLOAD_BASE || '/uploads';

// R2（私有桶 + Worker 代理）开关：五项齐全才启用
function r2Config() {
  const { R2_ENDPOINT, R2_BUCKET, R2_WORKER_DOMAIN, R2_ACCESS_KEY, R2_SECRET_KEY } = process.env;
  if (R2_ENDPOINT && R2_BUCKET && R2_WORKER_DOMAIN && R2_ACCESS_KEY && R2_SECRET_KEY) {
    return { R2_ENDPOINT, R2_BUCKET, R2_WORKER_DOMAIN: R2_WORKER_DOMAIN.replace(/\/$/, ''), R2_ACCESS_KEY, R2_SECRET_KEY };
  }
  return null;
}

export function isR2Enabled() {
  return !!r2Config();
}

export function uploadDir() {
  return UPLOAD_DIR;
}

export async function saveImage(file, zone = 'biz-works') {
  const ext = path.extname(file.originalname || '') || '.jpg';
  const name = Date.now() + '-' + Math.random().toString(36).slice(2) + ext;

  const cfg = r2Config();
  if (cfg) {
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
    return `${cfg.R2_WORKER_DOMAIN}/r2/${key}`;
  }

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.renameSync(file.path, path.join(UPLOAD_DIR, name));
  return PUBLIC_BASE + '/' + name;
}

// 从数据库保存的 Worker URL 提取 R2 key 并删除对象（fire-and-forget，失败仅记录）
export async function deleteFromR2(url) {
  const cfg = r2Config();
  if (!cfg || !url || !url.startsWith(cfg.R2_WORKER_DOMAIN + '/r2/')) return;
  const key = url.slice((cfg.R2_WORKER_DOMAIN + '/r2/').length);
  if (!key || key.includes('..')) return;
  try {
    const { DeleteObjectCommand, S3Client } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region: 'auto',
      endpoint: cfg.R2_ENDPOINT,
      credentials: { accessKeyId: cfg.R2_ACCESS_KEY, secretAccessKey: cfg.R2_SECRET_KEY }
    });
    await client.send(new DeleteObjectCommand({ Bucket: cfg.R2_BUCKET, Key: key }));
    console.log('[storage] 已删除 R2 对象', key);
  } catch (e) {
    console.error('[storage] 删除 R2 对象失败', key, e.message);
  }
}
