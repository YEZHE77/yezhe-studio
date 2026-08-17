// routes/icon.js —— PWA 「添加到主屏」图标（动态跟随工作室 logo）
// 公开：GET /api/icon —— 返回当前 studio.logo 的图片字节（代理 R2/COS 图床）
// 未配置 logo 或代理拉取失败时，返回品牌色 +「叶」的 SVG 兜底
// 缓存 5 分钟：admin 后台更新 logo 后，PWA 主屏图标至多 5 分钟自动刷新
import { Router } from 'express';
import { get } from '../db.js';

const router = Router();
const BRAND = '#2998EB';

function safeParse(v) { try { return JSON.parse(v); } catch { return null; } }

function fallbackSvg(size) {
  const fontSize = Math.round(size * 0.52);
  const y = Math.round(size * 0.68);
  const r = Math.round(size * 0.21);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="${r}" fill="${BRAND}"/><text x="${size / 2}" y="${y}" font-size="${fontSize}" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC','Helvetica Neue',sans-serif" fill="white" text-anchor="middle">叶</text></svg>`;
}

router.get('/', async (req, res) => {
  let logo = null;
  try {
    const r = await get("SELECT value FROM settings WHERE key = 'studio'");
    const studio = r && r.value ? safeParse(r.value) : null;
    if (studio && typeof studio.logo === 'string' && /^https?:\/\//.test(studio.logo)) {
      logo = studio.logo;
    }
  } catch (_) { /* ignore */ }

  if (logo) {
    try {
      const upstream = await fetch(logo, { signal: AbortSignal.timeout(8000) });
      if (upstream.ok) {
        const ct = (upstream.headers.get('content-type') || 'image/png').split(';')[0].trim();
        const buf = Buffer.from(await upstream.arrayBuffer());
        res.set('Content-Type', ct || 'image/png');
        res.set('Cache-Control', 'public, max-age=300');
        return res.send(buf);
      }
    } catch (_) { /* fall through */ }
  }
  res.set('Content-Type', 'image/svg+xml');
  res.set('Cache-Control', 'public, max-age=300');
  res.send(fallbackSvg(512));
});

export default router;
