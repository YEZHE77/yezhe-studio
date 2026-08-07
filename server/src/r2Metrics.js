// r2Metrics.js —— 真实对象存储桶用量统计（容量管理「存储空间」核心数据源）
//
// 设计取舍（重要）：
//   原方案依赖 Cloudflare GraphQL analytics 读取存储用量，但数据集/字段名根本不存在，
//   导致永远读不到数据。现改为：直接用【已在 Render 配置好的对象存储凭据】分页 listObjectsV2
//   累加真实桶大小。COS 与 R2 均为 S3 兼容，共用同一套逻辑。
//
//   - 优点：零额外令牌、部署即生效、反映桶的真实占用（含备份/系统文件等全部对象），
//           直接对标配额监控，是真正的配额监控。
//   - 代价：属于桶遍历（Class B 操作），故做 5 分钟内存缓存，不在每次请求时遍历。
//
//   密钥只在后端环境变量，前端绝不接触。
import { activeProvider, makeS3Client, bucketOf } from './storage.js';

const CACHE_TTL = 5 * 60 * 1000; // 5 分钟
let cache = { at: 0, data: null };

// 返回 { totalBytes, objectCount, provider, fetchedAt } 或 null（未接入云存储时降级）
export async function getStorageUsage() {
  const provider = activeProvider();
  if (!provider) return null;
  const now = Date.now();
  if (cache.at && now - cache.at < CACHE_TTL && cache.data) return cache.data;

  const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  const client = await makeS3Client(provider);
  const bucket = bucketOf(provider);

  let totalBytes = 0;
  let objectCount = 0;
  let token;
  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      ContinuationToken: token
    }));
    for (const o of res.Contents || []) {
      totalBytes += Number(o.Size) || 0;
      objectCount += 1;
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);

  const data = { totalBytes, objectCount, provider, fetchedAt: new Date().toISOString() };
  cache = { at: now, data };
  return data;
}

// 仅供测试 / 手动刷新：清空缓存
export function clearStorageCache() {
  cache = { at: 0, data: null };
}
