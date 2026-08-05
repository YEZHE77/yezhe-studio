// cf.js —— Cloudflare 用量查询（仅用于「图片流量 / 出流量」增强展示）
//
// 说明（重要）：
//   Cloudflare R2 官方 analytics 只有两个 GraphQL 数据集：
//     - r2OperationsAdaptiveGroups（操作：含 responseBytes / requests）
//     - r2StorageAdaptiveGroups（存储：max{payloadSize, metadataSize} 按日快照）
//   并没有「r2StorageEgressAdaptiveGroups」「r2StorageUsedAdaptiveGroups」这类数据集，
//   旧代码使用的查询字段全部不存在，必然读不到数据，已废弃。
//
//   本文件只负责「出流量（CDN 出流量）」的近似统计：
//   用 r2OperationsAdaptiveGroups 的 sum(responseBytes) 按月累加，作为出流量近似值。
//   该查询需要单独创建带「Account Analytics : Read」权限的 API 令牌（CF_API_TOKEN + CF_ACCOUNT_ID）。
//   未配置令牌时优雅降级（返回 null），由调用方提示用户按需配置。
//
//   存储空间（10GB 免费硬限额）的真实监控不依赖本文件，而是由 r2Metrics.js 直接读取真实桶大小。
//
//   密钥只存后端环境变量，前端绝不触碰；仅只读 analytics，绝不做任何写操作。
import https from 'node:https';

const CF_API = 'https://api.cloudflare.com/client/v4/graphql';
const CACHE_TTL = 5 * 60 * 1000; // 5 分钟
let cache = { at: 0, data: null };

export function cfConfigured() {
  return !!(process.env.CF_API_TOKEN && process.env.CF_ACCOUNT_ID);
}

function postGraphQL(query, variables) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const req = https.request(CF_API, {
      method: 'POST',
      timeout: 10000,
      headers: {
        Authorization: `Bearer ${process.env.CF_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Cloudflare API 超时')));
    req.write(body);
    req.end();
  });
}

// 当月第一天 00:00:00 UTC 的 ISO 字符串
function monthStartISO() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}
function nowISO() {
  return new Date().toISOString();
}

// 出流量近似：累加当月所有 R2 操作的响应字节（responseBytes）
const EGRESS_QUERY = `
query R2Egress($accountTag: String!, $start: String!, $end: String!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      r2OperationsAdaptiveGroups(limit: 10000, filter: { datetime_geq: $start, datetime_leq: $end }) {
        sum { responseBytes requests }
      }
    }
  }
}`;

// 返回 { bytes, fetchedAt, note } 或 null（降级）
export async function getR2Egress() {
  if (!cfConfigured()) return null;
  const now = Date.now();
  if (cache.at && now - cache.at < CACHE_TTL && cache.data) return cache.data;

  const accountTag = process.env.CF_ACCOUNT_ID;
  const vars = { accountTag, start: monthStartISO(), end: nowISO() };
  try {
    const res = await postGraphQL(EGRESS_QUERY, vars);
    let bytes = 0;
    const groups = res?.data?.viewer?.accounts?.[0]?.r2OperationsAdaptiveGroups || [];
    for (const g of groups) bytes += Number(g?.sum?.responseBytes) || 0;

    const data = {
      bytes,
      fetchedAt: new Date().toISOString(),
      note: 'Cloudflare 指标存在 5-15 分钟延迟；出流量按操作响应字节近似统计。'
    };
    cache = { at: now, data };
    return data;
  } catch (e) {
    console.error('[cf] 查询 R2 出流量失败', e.message);
    return null;
  }
}
