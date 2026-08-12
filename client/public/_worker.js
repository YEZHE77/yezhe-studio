// Cloudflare Pages _worker.js — R2 图片代理（绕过 workers.dev GFW 封锁）
// 原理：workers.dev 域名在国内被 GFW 封锁，pages.dev 可直连
// /r2/* 请求 → Pages Function 内部 fetch Worker（Cloudflare 内网，不受 GFW 影响）→ 返回图片
// 其他请求 → env.ASSETS 静态资源（_redirects / _headers 仍自动生效）

const R2_WORKER_ORIGIN = 'https://yezhe-img-proxy.yezhe128627.workers.dev';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // R2 图片代理：/r2/<key> → 转发到 Worker
    if (url.pathname.startsWith('/r2/')) {
      const target = R2_WORKER_ORIGIN + url.pathname + url.search;
      try {
        const upstream = await fetch(target, {
          method: 'GET',
          headers: { 'Accept': 'image/*' },
        });
        const headers = new Headers(upstream.headers);
        headers.set('Cache-Control', 'public, max-age=2592000');
        headers.set('Access-Control-Allow-Origin', '*');

        if (request.method === 'HEAD') {
          return new Response(null, { status: upstream.status, headers });
        }
        return new Response(upstream.body, { status: upstream.status, headers });
      } catch (e) {
        return new Response('Image proxy error', {
          status: 502,
          headers: { 'Access-Control-Allow-Origin': '*' },
        });
      }
    }

    // 其他请求：静态资源（_redirects SPA fallback + _headers 缓存策略自动生效）
    return env.ASSETS.fetch(request);
  },
};
