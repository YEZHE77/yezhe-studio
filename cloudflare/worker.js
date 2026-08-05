// Cloudflare Worker —— 私有 R2 桶的图片只读代理
// 仅做「读取」：解析 /r2/<key> → 读绑定 R2 桶 → 返回图片 + 缓存头
// 禁止列目录 / 禁止删除 / 禁止写入（安全边界）
// 绑定：wrangler.toml 里 binding = "R2"（指向你的私有桶名）
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

    let object;
    try {
      object = await env.R2.get(key);
    } catch (e) {
      return new Response('Upstream Error', { status: 502 });
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

function guessMime(key) {
  const ext = key.split('.').pop().toLowerCase();
  const map = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    webp: 'image/webp', gif: 'image/gif', avif: 'image/avif',
    bmp: 'image/bmp', svg: 'image/svg+xml'
  };
  return map[ext] || 'application/octet-stream';
}
