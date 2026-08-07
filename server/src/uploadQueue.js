// uploadQueue.js —— 上传异步队列（需求：上传接口零阻塞）
// 设计目标：HTTP 上传接口只负责「收流 → 基础校验 → 写入存储(R2) → 立即返回 200」，
// 所有 heavy 任务（内容 hash 计算、媒资元数据写入、相册状态联动）全部后台异步执行，
// 绝不阻塞前端上传响应。Render 免费档单实例内存队列即可；任务丢失仅影响容量统计，
// 图片本身已落 R2，不裂图。
import { run } from './db.js';
import { r2Config } from './storage.js';
import crypto from 'node:crypto';

const queue = [];
const CONCURRENCY = 4; // 后台并发处理数（与上传并发解耦）
let poolStarted = false;

// enqueue 立即返回，绝不 await 任何 IO
export function enqueueUploadJob(task) {
  queue.push(task);
  ensurePool();
}

export function queueStats() {
  return { pending: queue.length, concurrency: CONCURRENCY };
}

// 固定大小的常驻工作池：每个 worker 循环取任务，天然限制并发、串行处理不积压
function ensurePool() {
  if (poolStarted) return;
  poolStarted = true;
  for (let i = 0; i < CONCURRENCY; i++) {
    (async () => {
      while (queue.length) {
        const task = queue.shift();
        try {
          await processTask(task);
        } catch (e) {
          // 进程级兜底：任何未捕获异常都写错误日志，并把相册标记为 failed（若仍可定位）
          console.error('[uploadQueue] 任务异常（未捕获）', task && task.url, e && (e.stack || e.message || e));
          try {
            if (task && task.url) {
              await run(`UPDATE albums SET status = 'failed' WHERE photo_url = ? AND status = 'processing'`, [task.url]);
            }
          } catch {}
        }
      }
    })();
  }
}

// 单个上传任务：hash 计算(可选) → 写 media(容量统计) → 联动相册状态翻转
async function processTask({ url, r2Key, category, bytes, isPublic }) {
  console.log('[uploadQueue] 开始处理任务', { url, r2Key, category, bytes, isPublic });
  let failed = false;
  let failReason = '';

  // 1) 内容 hash（用于内容级去重，best-effort；从 R2 拉字节计算，失败忽略）
  let hash = null;
  try {
    const buf = await fetchObject(r2Key);
    if (buf && buf.length) hash = crypto.createHash('sha256').update(buf).digest('hex');
  } catch (e) {
    console.warn('[uploadQueue] hash 计算跳过', url, e && e.message);
  }

  // 2) 写媒资元数据（容量统计唯一来源，零 R2 遍历）—— 后台异步，绝不在上传响应路径
  try {
    await run(
      `INSERT INTO media (url, category, bytes, is_public, r2_key, hash, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'ready', ?)`,
      [url, category || 'uncategorized', Number(bytes) || 0, isPublic ? 1 : 0, r2Key || null, hash || null, new Date().toISOString()]
    );
  } catch (e) {
    // 唯一索引冲突（重复写入）视为成功，忽略
    if (!/unique|duplicate/i.test(e && e.message || '')) {
      console.error('[uploadQueue] recordMedia 失败', url, e && e.message);
      failed = true;
      failReason = 'media 写入失败: ' + (e && e.message || e);
    }
  }

  // 3) 联动相册：把仍处于 processing 的相册行翻为 ready（图片已可用，仅元数据待补全）
  //    若翻转失败（异步任务真正报错），将该相册标记为 failed，前端可见红色「处理失败」提示
  try {
    await run(`UPDATE albums SET status = 'ready' WHERE photo_url = ? AND status = 'processing'`, [url]);
  } catch (e) {
    failed = true;
    failReason = '相册状态翻转失败: ' + (e && e.message || e);
    console.error('[uploadQueue] 相册状态翻转失败', url, e && e.message);
    try {
      await run(`UPDATE albums SET status = 'failed' WHERE photo_url = ? AND status = 'processing'`, [url]);
      console.error('[uploadQueue] 已将相册标记为 failed', url);
    } catch (e2) {
      console.error('[uploadQueue] 相册标记 failed 亦失败', url, e2 && e2.message);
    }
  }

  if (failed) {
    console.error('[uploadQueue] 任务处理存在错误（已尽量补救）', { url, failReason });
  } else {
    console.log('[uploadQueue] 任务处理完成', { url });
  }
}

// 从 R2 取回对象字节（仅用于 hash 计算，best-effort）
async function fetchObject(r2Key) {
  const cfg = r2Config();
  if (!cfg || !r2Key) return null;
  try {
    const { GetObjectCommand, S3Client } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region: 'auto',
      endpoint: cfg.R2_ENDPOINT,
      credentials: { accessKeyId: cfg.R2_ACCESS_KEY, secretAccessKey: cfg.R2_SECRET_KEY }
    });
    const r = await client.send(new GetObjectCommand({ Bucket: cfg.R2_BUCKET, Key: r2Key }));
    return Buffer.from(await r.Body.transformToByteArray());
  } catch (e) {
    return null;
  }
}
