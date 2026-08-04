// storage.js —— 图片存储适配
// 未配置 R2 → 存本地 server/data/uploads，返回 /uploads/xxx（兜底，零账号）
// 配置齐全 R2 → 自动上传 Cloudflare R2，返回公网 HTTPS 地址（切换无需改业务代码）
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './db.js';

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(dataDir, 'uploads');
const PUBLIC_BASE = process.env.PUBLIC_UPLOAD_BASE || '/uploads';

export function uploadDir() {
  return UPLOAD_DIR;
}

export async function saveImage(file) {
  const ext = path.extname(file.originalname || '') || '.jpg';
  const name = Date.now() + '-' + Math.random().toString(36).slice(2) + ext;

  const useR2 = process.env.R2_ENDPOINT && process.env.R2_BUCKET && process.env.R2_PUBLIC_URL;
  if (useR2) {
    // 懒加载 S3 SDK（启用 R2 时才需安装 @aws-sdk/client-s3）
    const { PutObjectCommand, S3Client } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: { accessKeyId: process.env.R2_ACCESS_KEY, secretAccessKey: process.env.R2_SECRET_KEY }
    });
    const key = 'works/' + name;
    const body = fs.readFileSync(file.path);
    await client.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: file.mimetype || 'image/jpeg'
    }));
    fs.unlinkSync(file.path);
    return process.env.R2_PUBLIC_URL.replace(/\/$/, '') + '/' + key;
  }

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.renameSync(file.path, path.join(UPLOAD_DIR, name));
  return PUBLIC_BASE + '/' + name;
}
