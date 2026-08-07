// migrate-r2-to-cos.mjs —— 存量 R2 图片批量迁移到腾讯云 COS
//
// 作用：扫描业务库中所有指向 R2 Worker 代理域的图片 URL，把对应对象从 R2 桶下载、
// 按「相同 key」上传到 COS 桶，并把数据库里的 URL 改写为 COS CDN 域名。幂等、可重跑。
//
// 前置：server/.env（或进程环境）需同时具备：
//   R2_ENDPOINT / R2_ACCESS_KEY / R2_SECRET_KEY / R2_BUCKET / R2_WORKER_DOMAIN  （源）
//   COS_SECRET_ID / COS_SECRET_KEY / COS_BUCKET / COS_REGION / COS_CDN_DOMAIN    （目标）
//   另：DATABASE_URL 留空走本地 SQLite(server/data/app.db)，填了走 Postgres。
//
// 用法：
//   node scripts/migrate-r2-to-cos.mjs            # 正式迁移（先 dry 确认）
//   node scripts/migrate-r2-to-cos.mjs --dry      # 只扫描统计，不下载/不改库
//
// 说明：
//   - 仅处理形如 ${R2_WORKER_DOMAIN}/r2/<key> 的 URL；其它 URL（本地 /uploads、COS 已迁移）跳过。
//   - 同一 key 在 COS 已存在则跳过下载（幂等）；DB URL 已是 COS 域则跳过改写。
//   - 不改变对象 key，仅换存储后端与对外域名，前端/小程序无需改动。
import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { query, run } from '../server/src/db.js';

const DRY = process.argv.includes('--dry');
const R2_DOMAIN = (process.env.R2_WORKER_DOMAIN || '').replace(/\/$/, '');
const COS_DOMAIN = (process.env.COS_CDN_DOMAIN || '').replace(/\/$/, '');

function fail(msg) { console.error('[migrate] ' + msg); process.exit(1); }
if (!R2_DOMAIN) fail('缺少 R2_WORKER_DOMAIN（源）');
if (!COS_DOMAIN) fail('缺少 COS_CDN_DOMAIN（目标）');
if (!(process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY && process.env.R2_SECRET_KEY && process.env.R2_BUCKET)) fail('缺少 R2_* 源配置');
if (!(process.env.COS_SECRET_ID && process.env.COS_SECRET_KEY && process.env.COS_BUCKET && process.env.COS_REGION)) fail('缺少 COS_* 目标配置');

const R2_PREFIX = `${R2_DOMAIN}/r2/`;

const r2 = new S3Client({ region: 'auto', endpoint: process.env.R2_ENDPOINT, credentials: { accessKeyId: process.env.R2_ACCESS_KEY, secretAccessKey: process.env.R2_SECRET_KEY } });
const cos = new S3Client({ region: process.env.COS_REGION, endpoint: `https://cos.${process.env.COS_REGION}.myqcloud.com`, credentials: { accessKeyId: process.env.COS_SECRET_ID, secretAccessKey: process.env.COS_SECRET_KEY } });

// (表, 列) 列表：所有存放图片 URL 的文本列
const COLUMNS = [
  ['works', 'cover_url'],
  ['packages', 'cover_url'],
  ['galleries', 'cover_url'],
  ['albums', 'photo_url'],
  ['albums', 'thumb_url'],
  ['customers', 'avatar'],
  ['media', 'url']
];

async function existsInCos(key) {
  try { await cos.send(new HeadObjectCommand({ Bucket: process.env.COS_BUCKET, Key: key })); return true; }
  catch (e) { if (e && e.name === 'NotFound') return false; throw e; }
}

async function getR2Buffer(key) {
  const r = await r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
  return Buffer.from(await r.Body.transformToByteArray());
}

async function putCos(key, body, contentType) {
  await cos.send(new PutObjectCommand({ Bucket: process.env.COS_BUCKET, Key: key, Body: body, ContentType: contentType || 'image/jpeg' }));
}

async function main() {
  // 1) 收集所有 R2 URL 及出现位置
  const urlLocations = new Map(); // url -> [{table, column, count}]
  for (const [table, column] of COLUMNS) {
    let rows;
    try { rows = await query(`SELECT ${column} FROM ${table} WHERE ${column} IS NOT NULL AND ${column} <> ''`); }
    catch (e) { console.warn(`[migrate] 跳过表 ${table}.${column}（查询失败：${e.message}）`); continue; }
    for (const row of rows) {
      const url = (row[column] || '').trim();
      if (!url.startsWith(R2_PREFIX)) continue;
      if (!urlLocations.has(url)) urlLocations.set(url, []);
      urlLocations.get(url).push({ table, column });
    }
  }

  const urls = [...urlLocations.keys()];
  console.log(`[migrate] 扫描到 ${urls.length} 个 R2 图片 URL（去重），分布于 ${urlLocations.size} 个唯一地址。`);

  let copied = 0, skippedExists = 0, updatedRows = 0, errors = 0;

  for (const url of urls) {
    const key = url.slice(R2_PREFIX.length);
    if (!key || key.includes('..')) { console.warn('[migrate] 跳过非法 key:', url); continue; }
    const newUrl = `${COS_DOMAIN}/${key}`;
    const locs = urlLocations.get(url);

    // 若所有出现位置已是新 URL（理论上不会，因我们按 R2 前缀筛），跳过
    if (url === newUrl) continue;

    if (DRY) {
      console.log(`[dry] 将迁移 key=${key} → ${newUrl}（${locs.length} 处）`);
      continue;
    }

    try {
      // 2) 幂等：COS 已存在则跳过下载上传
      if (await existsInCos(key)) {
        skippedExists++;
      } else {
        const body = await getR2Buffer(key);
        await putCos(key, body);
        copied++;
      }
      // 3) 改写 DB（相同 key 多行/多列一并更新）
      for (const { table, column } of locs) {
        const r = await run(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`, [newUrl, url]);
        updatedRows += (r && r.changes) || 0;
      }
    } catch (e) {
      errors++;
      console.error(`[migrate] 处理失败 key=${key}:`, e.message);
    }
  }

  console.log('[migrate] 完成。');
  console.log(`  复制新对象: ${copied}`);
  console.log(`  已存在跳过: ${skippedExists}`);
  console.log(`  改写 DB 行: ${updatedRows}`);
  console.log(`  出错: ${errors}`);
  if (DRY) console.log('（--dry 模式：未实际复制 / 改库）');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
