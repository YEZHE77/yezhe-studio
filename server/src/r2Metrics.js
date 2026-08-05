// r2Metrics.js —— 真实 R2 桶用量统计（容量管理「存储空间」核心数据源）
//
// 设计取舍（重要）：
//   原方案依赖 Cloudflare GraphQL analytics（r2StorageAdaptiveGroups）读取存储用量，
//   但该方法：(1) 需要单独创建带 analytics 只读权限的 API 令牌；(2) 官方 R2 analytics
//   仅有 operations / storage 两个数据集，且存储是「按日快照」有 5-15 分钟延迟；
//   (3) 之前写的查询数据集/字段名（r2StorageUsedAdaptiveGroups / sum{storageUsed}）
//   根本不存在，导致永远读不到数据。
//
//   现改为：直接用【已在 Render 配置好的 R2 凭据】分页 listObjectsV2 累加真实桶大小。
//   - 优点：零额外令牌、部署即生效、反映桶的真实占用（含备份/系统文件等全部对象），
//           直接对标「10GB 免费存储硬限额」，是真正的配额监控。
//   - 代价：属于桶遍历（Class B 操作，免费档 10M/月内无忧），故做 5 分钟内存缓存，
//           不在每次请求时遍历，兼顾性能与准确性。
//
//   密钥只在后端环境变量，前端绝不接触。
import { r2Config } from './storage.js';

const CACHE_TTL = 5 * 60 * 1000; // 5 分钟
let cache = { at: 0, data: null };

// 返回 { totalBytes, objectCount, fetchedAt } 或 null（未配置 R2 时降级）
export async function getR2Storage() {
  const cfg = r2Config();
  if (!cfg) return null;
  const now = Date.now();
  if (cache.at && now - cache.at < CACHE_TTL && cache.data) return cache.data;

  const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  const client = new S3Client({
    region: 'auto',
    endpoint: cfg.R2_ENDPOINT,
    credentials: { accessKeyId: cfg.R2_ACCESS_KEY, secretAccessKey: cfg.R2_SECRET_KEY }
  });

  let totalBytes = 0;
  let objectCount = 0;
  let token;
  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: cfg.R2_BUCKET,
      ContinuationToken: token
    }));
    for (const o of res.Contents || []) {
      totalBytes += Number(o.Size) || 0;
      objectCount += 1;
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);

  const data = { totalBytes, objectCount, fetchedAt: new Date().toISOString() };
  cache = { at: now, data };
  return data;
}

// 仅供测试 / 手动刷新：清空缓存
export function clearR2StorageCache() {
  cache = { at: 0, data: null };
}
