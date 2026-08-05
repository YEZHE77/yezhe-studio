// Cloudflare Worker —— 私有 R2 桶的图片只读代理 + 缩略图变体
// 仅做「读取」：解析 /r2/<key> → 读绑定 R2 桶 → 返回图片 + 缓存头
// 禁止列目录 / 禁止删除 / 禁止写入（安全边界）
// 缩略图：上传时后端预生成 thumb_400/thumb_800 等变体，Worker 按路径返回
// 前端在请求后追加 ?w=400 仅用于 CDN 缓存分区标识（不实际裁剪）
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 只允许读操作
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // 只放行 /r2/* 路径
    if (!url.pathname.startsWith('/r2/')) {
      return new Response('Not Found', { status: 404 });
    }

    // 提取 key（去掉 /r2/ 前缀），解码并拦截目录穿越
    const key = decodeURIComponent(url.pathname.slice('/r2/'.length));
    if (!key || key.includes('..') || key.startsWith('/')) {
      return new Response('Bad Request', { status: 400 });
    }

    // 缩略图策略：如果请求带 ?w= 参数，尝试查找预生成的缩略图变体
    // 例如 /r2/biz-works/xxx.jpg?w=400 → 先查 biz-works/thumb_400/xxx.jpg
    const targetWidth = url.searchParams.get('w');
    let object = null;
    if (targetWidth) {
      const thumbKey = buildThumbKey(key, targetWidth);
      try { object = await env.R2.get(thumbKey); } catch (e) {}
    }

    // 降级：无缩略图或未请求缩略 → 原图
    if (!object) {
      try {
        object = await env.R2.get(key);
      } catch (e) {
        return new Response('Upstream Error', { status: 502 });
      }
    }

    if (!object) return new Response('Not Found', { status: 404 });

    const headers = new Headers();
    headers.set('Content-Type', object.httpMetadata?.contentType || guessMime(key));
    headers.set('Cache-Control', 'public, max-age=2592000'); // 30 天
    if (object.etag) headers.set('ETag', object.etag);
    // 跨域（网页端与小程序都从 Worker 域名取图）
    headers.set('Access-Control-Allow-Origin', '*');

    return new Response(object.body, { headers });
  }
};

// 构建缩略图 key：biz-works/xxx.jpg → biz-works/thumb_400/xxx.jpg
function buildThumbKey(key, width) {
  const idx = key.lastIndexOf('/');
  if (idx === -1) return `thumb_${width}/${key}`;
  const dir = key.substring(0, idx);
  const name = key.substring(idx + 1);
  return `${dir}/thumb_${width}/${name}`;
}

function guessMime(key) {
  const ext = key.split('.').pop().toLowerCase();
  const map = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    webp: 'image/webp', gif: 'image/gif', avif: 'image/avif',
    bmp: 'image/bmp', svg: 'image/svg+xml'
  };
  return map[ext] || 'application/octet-stream';
}
