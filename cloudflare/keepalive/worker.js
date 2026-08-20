// Cloudflare Worker —— Render 后端保活
// Cron 每 5 分钟触发 scheduled()，请求 /api/keepalive（触库 SELECT 1）：
// 1) 让 Render free 实例不进入 15 分钟休眠；
// 2) 顺带预热 Neon 数据库连接，冷启动后首个业务查询无需重新 TLS 握手。
export default {
  async scheduled(event, env, ctx) {
    const started = Date.now();
    let status = 0;
    try {
      const res = await fetch(env.TARGET_URL, { method: 'GET' });
      status = res.status;
      const body = await res.text().catch(() => '');
      console.log(`[keepalive] ${res.status} ${res.ok ? 'OK' : 'FAIL'} ${Date.now() - started}ms ${body.slice(0, 80)}`);
    } catch (e) {
      status = 0;
      console.error('[keepalive] fetch error', e.message);
    }
    // 让 scheduled 任务有机会完整跑完（等待 fetch 完成）
    ctx.waitUntil(Promise.resolve());
  },

  // 手动触发入口：浏览器直接访问 Worker 域名时也 ping 一次，方便测试
  async fetch(request, env) {
    try {
      const res = await fetch(env.TARGET_URL);
      return new Response(`keepalive -> ${res.status}`, { status: 200 });
    } catch (e) {
      return new Response('keepalive error: ' + e.message, { status: 502 });
    }
  },
};
