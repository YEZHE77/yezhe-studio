// backup.js —— 业务数据双重备份
// 1) 全量业务 JSON 导出（手动下载 + 写入对象存储 /backup 目录定时备份）
// 2) 所有图片二进制已在对象存储，不重复备份；此处仅备份结构化业务数据。
// 支持 COS（优先）/ R2（兜底），由 storage 的 activeProvider 决定落桶。
import fs from 'node:fs';
import path from 'node:path';
import { query, dataDir } from './db.js';
import { activeProvider, makeS3Client, bucketOf, objectUrl } from './storage.js';

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

// 触发全量备份并写入对象存储 /backup/ 目录（仅接入云存储时可用）。返回对象信息或 null。
export async function writeBackupToCloud() {
  const provider = activeProvider();
  if (!provider) return { ok: false, reason: '未配置云端存储（COS / R2），无法写入云端备份' };
  const data = await buildFullBackup();
  const json = JSON.stringify(data);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16); // YYYY-MM-DDTHH-mm
  const key = `backup/yezhe-backup-${ts}.json`;
  try {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await makeS3Client(provider);
    await client.send(new PutObjectCommand({
      Bucket: bucketOf(provider),
      Key: key,
      Body: json,
      ContentType: 'application/json'
    }));
    return { ok: true, key, bytes: json.length, provider, url: objectUrl(provider, key) };
  } catch (e) {
    return { ok: false, reason: String(e && e.message || e) };
  }
}

// 兼容旧名（曾仅写 R2）；现统一写当前生效 provider。
export const writeBackupToR2 = writeBackupToCloud;

// 单订单选片快照备份（重置选片 / 删除底片等破坏性操作前自动调用）。
// 不新增数据库快照表（贴合原版「无快照」），仅导出 JSON 文件：
//   1) 本地 server/data/selection_backup/order_{id}_{ts}.json（dev 无云端也生效）
//   2) 云端 backup/selection/order_{id}_{ts}.json（COS/R2，可选）
// 返回 { ok, localPath, filename, bytes, cloud }，失败也尽量落本地（兜底不阻塞主业务）。
export async function exportSelectionBackup(orderId) {
  const oid = Number(orderId);
  const orderRows = await query('SELECT * FROM orders WHERE id = ?', [oid]);
  if (!orderRows.length) return { ok: false, reason: '订单不存在' };
  const task = (await query('SELECT * FROM order_select_task WHERE order_id = ?', [oid]))[0] || null;
  const photos = await query('SELECT * FROM order_photo WHERE order_id = ?', [oid]);
  let marks = [];
  if (task) marks = await query('SELECT * FROM order_select_mark WHERE task_id = ?', [task.id]);
  const payload = {
    kind: 'selection_backup',
    order_id: oid,
    exportedAt: new Date().toISOString(),
    order: orderRows[0],
    task,
    photos,
    marks
  };
  const json = JSON.stringify(payload);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', ''); // 毫秒级，避免同秒操作文件名碰撞
  const filename = `order_${oid}_${ts}.json`;
  // 1) 本地文件兜底（无云端也可还原）
  let localPath = null;
  try {
    const localDir = path.join(dataDir, 'selection_backup');
    fs.mkdirSync(localDir, { recursive: true });
    localPath = path.join(localDir, filename);
    fs.writeFileSync(localPath, json);
  } catch (e) {
    console.error('[backup] 选片本地备份写入失败：', e.message);
  }
  // 2) 云端（可选，失败不阻塞）
  let cloud = null;
  const provider = activeProvider();
  if (provider) {
    try {
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      const client = await makeS3Client(provider);
      const key = `backup/selection/${filename}`;
      await client.send(new PutObjectCommand({ Bucket: bucketOf(provider), Key: key, Body: json, ContentType: 'application/json' }));
      cloud = { key, url: objectUrl(provider, key) };
    } catch (e) {
      cloud = { error: String((e && e.message) || e) };
    }
  }
  return { ok: true, localPath, filename, bytes: json.length, cloud };
}

// 启动每日定时备份（Render 免费档重启后由启动逻辑重新调度）。每日 03:10（服务时区）执行一次。
let _timer = null;
export function scheduleDailyBackup() {
  if (_timer) return;
  const run = async () => {
    const r = await writeBackupToCloud();
    if (r.ok) console.log('[backup] 已写入云端备份', r.key);
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
  console.log('[backup] 已调度每日云端备份，首次于', next.toISOString());
}
