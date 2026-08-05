// backup.js —— 业务数据双重备份
// 1) 全量业务 JSON 导出（手动下载 + 写入 R2 /backup 目录定时备份）
// 2) 所有图片二进制已在 R2，不重复备份；此处仅备份结构化业务数据。
import fs from 'node:fs';
import path from 'node:path';
import { query } from './db.js';
import { r2Config } from './storage.js';

// 需要备份的业务表（与 schema.js 对齐；任意表缺失则跳过，不中断）
const BACKUP_TABLES = [
  'users', 'works', 'albums', 'selections', 'orders', 'payments',
  'packages', 'categories', 'schedules', 'appointments', 'photo_select',
  'evaluates', 'customers', 'shares', 'share_logs', 'media', 'settings'
];

// 导出全量业务数据为 JS 对象（绝不包含任何密钥/密码明文，password_hash 属不可逆哈希，一并保留以便还原登录）
export async function buildFullBackup() {
  const tables = {};
  for (const t of BACKUP_TABLES) {
    try {
      tables[t] = await query(`SELECT * FROM ${t}`);
    } catch (e) {
      tables[t] = { _error: String(e && e.message || e) };
    }
  }
  return {
    product: 'yezhe-studio',
    version: 1,
    exportedAt: new Date().toISOString(),
    dialectNote: '兼容 PG / SQLite；还原时按表 INSERT 即可。',
    tables
  };
}

// 触发全量备份并写入 R2 /backup/ 目录（仅 R2 配置时可用）。返回对象信息或 null。
export async function writeBackupToR2() {
  const cfg = r2Config();
  if (!cfg) return { ok: false, reason: 'R2 未配置，无法写入云端备份' };
  const data = await buildFullBackup();
  const json = JSON.stringify(data);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16); // YYYY-MM-DDTHH-mm
  const key = `backup/yezhe-backup-${ts}.json`;
  try {
    const { PutObjectCommand, S3Client } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region: 'auto',
      endpoint: cfg.R2_ENDPOINT,
      credentials: { accessKeyId: cfg.R2_ACCESS_KEY, secretAccessKey: cfg.R2_SECRET_KEY }
    });
    await client.send(new PutObjectCommand({
      Bucket: cfg.R2_BUCKET,
      Key: key,
      Body: json,
      ContentType: 'application/json'
    }));
    return { ok: true, key, bytes: json.length, url: `${cfg.R2_WORKER_DOMAIN}/r2/${key}` };
  } catch (e) {
    return { ok: false, reason: String(e && e.message || e) };
  }
}

// 启动每日定时备份（Render 免费档重启后由启动逻辑重新调度）。每日 03:10（服务时区）执行一次。
let _timer = null;
export function scheduleDailyBackup() {
  if (_timer) return;
  const run = async () => {
    const r = await writeBackupToR2();
    if (r.ok) console.log('[backup] 已写入 R2 备份', r.key);
    else console.log('[backup] 定时备份跳过：', r.reason);
  };
  // 立即做一次（可选），之后每 24h
  const ms = 24 * 60 * 60 * 1000;
  // 计算到下一个 03:10 的毫秒数
  const now = new Date();
  const next = new Date(now);
  next.setHours(3, 10, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const delay = next - now;
  setTimeout(() => {
    run();
    _timer = setInterval(run, ms);
  }, delay);
  console.log('[backup] 已调度每日 R2 备份，首次于', next.toISOString());
}
