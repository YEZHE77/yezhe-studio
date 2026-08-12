// 数据迁移脚本：枚举 R2 桶里的所有原图 → 下载 → sharp 生成 thumb_400/800/1200 → 上传回 R2
// 用途：解决「手机加载图片延迟严重、照片无法显示」——历史数据没有缩略图变体，
//       Worker 的 ?w= 查询会降级到原图（200-400KB），导致首屏几十秒。
// 幂等：已存在 thumb_<w>/<name> 的对象自动跳过。
// 用法：
//   node scripts/gen-thumbnails.mjs            # 处理所有原图
//   node scripts/gen-thumbnails.mjs --dry      # 仅打印统计不上传
//   node scripts/gen-thumbnails.mjs --prefix biz-works  # 仅处理指定 prefix
//
// 必须设置 R2_* 环境变量（同 server 启动所需），不要 COS_* 混用——本脚本只看 R2。

import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const THUMB_WIDTHS = [400, 800, 1200];
const QUALITY = 75;
const PREFIXES_DEFAULT = ['biz-works', 'biz-albums', 'biz-orders', 'biz-avatar', 'biz-cover', 'biz-bg', 'biz-other'];
const SKIP_PREFIXES = ['thumb_', 'chunks/']; // 跳过缩略图自身 + 临时分片

function thumbKeyOf(originalKey, width) {
  const idx = originalKey.lastIndexOf('/');
  if (idx === -1) return `thumb_${width}/${originalKey}`;
  const dir = originalKey.substring(0, idx);
  const name = originalKey.substring(idx + 1);
  return `${dir}/thumb_${width}/${name}`;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry');
  const prefixArg = args.indexOf('--prefix');
  const onlyPrefix = prefixArg >= 0 ? args[prefixArg + 1] : null;

  const need = ['R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY', 'R2_SECRET_KEY'];
  for (const k of need) {
    if (!process.env[k]) { console.error('缺少环境变量', k); process.exit(1); }
  }
  const client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY, secretAccessKey: process.env.R2_SECRET_KEY }
  });

  const prefixes = onlyPrefix ? [onlyPrefix] : PREFIXES_DEFAULT;
  console.log(`[thumb] mode=${dryRun ? 'DRY' : 'WRITE'} prefixes=${prefixes.join(',')}`);

  let totalListed = 0, totalSkipped = 0, totalGenerated = 0, totalFailed = 0;
  const startTime = Date.now();

  for (const prefix of prefixes) {
    let token = undefined;
    do {
      const list = await client.send(new ListObjectsV2Command({
        Bucket: process.env.R2_BUCKET,
        Prefix: prefix + '/',
        ContinuationToken: token,
        MaxKeys: 1000
      }));
      const keys = (list.Contents || []).map((o) => o.Key).filter(Boolean);
      totalListed += keys.length;
      for (const key of keys) {
        // 跳过缩略图自身 + 临时分片
        if (SKIP_PREFIXES.some((p) => key.includes('/' + p) || key.startsWith(p + '/') || key.includes('/' + p + '/'))) {
          totalSkipped++;
          continue;
        }
        const ext = (key.split('.').pop() || '').toLowerCase();
        if (!['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'tiff'].includes(ext)) {
          totalSkipped++;
          continue;
        }
        try {
          // 检查 thumb_400 是否已存在（幂等）
          if (!dryRun) {
            try {
              await client.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: thumbKeyOf(key, 400) }));
              totalSkipped++;
              continue;
            } catch (e) { /* not exist → 继续生成 */ }
          }
          // 下载原图
          const obj = await client.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
          const buf = Buffer.from(await obj.Body.transformToByteArray());
          // 生成三档
          for (const w of THUMB_WIDTHS) {
            const t = sharp(buf).rotate();
            const out = await t.resize({ width: w, withoutEnlargement: true, fit: 'inside' })
              .jpeg({ quality: QUALITY, mozjpeg: true })
              .toBuffer();
            const tk = thumbKeyOf(key, w);
            if (dryRun) {
              console.log(`  [DRY] would upload ${tk} (${out.length}B)`);
            } else {
              await client.send(new PutObjectCommand({
                Bucket: process.env.R2_BUCKET,
                Key: tk,
                Body: out,
                ContentType: 'image/jpeg'
              }));
            }
            totalGenerated++;
          }
          process.stdout.write(`✓ ${key} → ${THUMB_WIDTHS.join('/')}  (${buf.length}B → ${THUMB_WIDTHS.length} variants)\n`);
        } catch (e) {
          totalFailed++;
          console.error(`✗ ${key}:`, e.message);
        }
      }
      token = list.NextContinuationToken;
    } while (token);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n========== 汇总 ==========');
  console.log(`原图总数:        ${totalListed}`);
  console.log(`跳过(已是缩略图/分片/非图片): ${totalSkipped}`);
  console.log(`生成缩略图变体:   ${totalGenerated} (${THUMB_WIDTHS.length} 尺寸/原图)`);
  console.log(`失败:            ${totalFailed}`);
  console.log(`耗时:            ${elapsed}s`);
  console.log(`模式:            ${dryRun ? 'DRY（未实际写入）' : 'WRITE'}`);
}

main().catch((e) => { console.error(e); process.exit(1); });