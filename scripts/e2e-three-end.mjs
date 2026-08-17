// scripts/e2e-three-end.mjs —— 三端（移动端 / 桌面端 / C端客户）核心使用路径端到端验证
//
// 覆盖：
//   · 桌面端 B 端工作台：管理员登录 + 套系/订单/档期/预约/移动端消息未读 核心读路径
//   · 移动端工作台：消息未读统计 + 消息列表
//   · C 端客户客户端：未登录态 / 公开套系列表 / 套系详情 / 预约提交校验 / 登录 / 我的预约订单
//   · 异常监控链路：POST /api/client-error 入库 + 管理员 GET 查看（验证三端异常上报→存储→查看闭环）
//
// 用法：
//   1) 先启动后端：cd server && npm run dev   （默认 http://localhost:4000）
//   2) 运行：      node scripts/e2e-three-end.mjs
//      自定义基址：E2E_BASE=http://localhost:4000 node scripts/e2e-three-end.mjs
//      完整写链路：E2E_WRITE=1 node scripts/e2e-three-end.mjs   （额外执行 预约提交→登录→我的业务 真实交易）
//
// 退出码：全部通过 0；任一失败 1。输出含每步状态、HTTP 状态、端标识、摘要。

const BASE = (process.env.E2E_BASE || 'http://localhost:4000').replace(/\/+$/, '');
const E2E_WRITE = process.env.E2E_WRITE === '1';
const ADMIN_USER = process.env.E2E_ADMIN || 'admin';
const ADMIN_PASS = process.env.E2E_ADMIN_PASS || 'admin123';

const results = [];
function rec(name, end, status, detail) {
  results.push({ name, end, status, detail });
  const tag = status === 'PASS' ? '✅' : status === 'SKIP' ? '⚪️' : '❌';
  const line = `${tag} [${end}] ${name}` + (detail ? `  —  ${detail}` : '');
  console.log(line);
}

async function req(method, path, { token, body, headers = {}, expectStatus } = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (token) h['Authorization'] = 'Bearer ' + token;
  const res = await fetch(BASE + path, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch {}
  const ok = expectStatus ? res.status === expectStatus : res.status >= 200 && res.status < 300;
  return { status: res.status, ok, data };
}

async function main() {
  console.log(`\n=== 三端端到端验证 @ ${BASE} ===\n`);

  // ---------- 健康检查 ----------
  try {
    const r = await req('GET', '/api/health');
    rec('后端健康检查', 'system', r.ok ? 'PASS' : 'FAIL', `HTTP ${r.status}`);
    if (!r.ok) { finish(); return; }
  } catch (e) {
    rec('后端健康检查', 'system', 'FAIL', '无法连接后端：' + e.message);
    finish(); return;
  }

  // ---------- 桌面端 B 端工作台 ----------
  let adminToken = null;
  try {
    const r = await req('POST', '/api/auth/login', { body: { username: ADMIN_USER, password: ADMIN_PASS }, expectStatus: 200 });
    adminToken = r.data && r.data.token;
    rec('桌面端·管理员登录', 'desktop', r.ok && adminToken ? 'PASS' : 'FAIL', `HTTP ${r.status}`);
  } catch (e) { rec('桌面端·管理员登录', 'desktop', 'FAIL', e.message); }

  if (adminToken) {
    const reads = [
      ['套系列表', '/api/packages'],
      ['订单列表', '/api/orders'],
      ['档期列表', '/api/schedules'],
      ['预约列表', '/api/reservations'],
      ['移动端消息未读统计', '/api/mobile/message/unread-count'],
    ];
    for (const [name, path] of reads) {
      try {
        const r = await req('GET', path, { token: adminToken });
        const extra = path.includes('unread-count') && r.data ? `count=${r.data.count}` : '';
        rec('桌面端·' + name, 'desktop', r.ok ? 'PASS' : 'FAIL', `HTTP ${r.status} ${extra}`.trim());
      } catch (e) { rec('桌面端·' + name, 'desktop', 'FAIL', e.message); }
    }
    try {
      const r = await req('GET', '/api/mobile/message/list', { token: adminToken });
      rec('移动端·消息列表', 'mobile', r.ok ? 'PASS' : 'FAIL', `HTTP ${r.status} total=${r.data && r.data.total}`);
    } catch (e) { rec('移动端·消息列表', 'mobile', 'FAIL', e.message); }
  } else {
    rec('桌面端·核心读路径', 'desktop', 'SKIP', '登录失败，跳过');
  }

  // ---------- C 端客户客户端（只读核心路径，无需登录）----------
  try {
    const r = await req('GET', '/api/customer/me', { expectStatus: 200 });
    const isLogin = r.data && r.data.isLogin;
    rec('C端·未登录态 me', 'cend', (r.ok && isLogin === false) ? 'PASS' : 'FAIL', `HTTP ${r.status} isLogin=${isLogin}`);
  } catch (e) { rec('C端·未登录态 me', 'cend', 'FAIL', e.message); }

  let firstPkgId = null;
  try {
    const r = await req('GET', '/api/packages/public', { expectStatus: 200 });
    const list = (r.data && (Array.isArray(r.data) ? r.data : r.data.list)) || [];
    firstPkgId = list.length ? (list[0].id || (list[0].data && list[0].data.id)) : null;
    rec('C端·公开套系列表', 'cend', (r.ok && list.length > 0) ? 'PASS' : 'FAIL', `HTTP ${r.status} 套系数=${list.length}`);
  } catch (e) { rec('C端·公开套系列表', 'cend', 'FAIL', e.message); }

  if (firstPkgId) {
    try {
      const r = await req('GET', `/api/packages/public/${firstPkgId}`, { expectStatus: 200 });
      rec('C端·套系详情', 'cend', r.ok ? 'PASS' : 'FAIL', `HTTP ${r.status}`);
    } catch (e) { rec('C端·套系详情', 'cend', 'FAIL', e.message); }
  } else {
    rec('C端·套系详情', 'cend', 'SKIP', '无公开套系，跳过');
  }

  // C 端预约提交：缺手机号应 400（参数校验）。
  // 注意：该接口有「每 IP 1 次/分钟」限流，且限流计数在参数校验之前，
  // 故校验探针与真实写链路互斥（避免同一次运行内互相抢占限流额度）——按运行模式二选一。
  if (!E2E_WRITE) {
    try {
      const r = await req('POST', '/api/customer/reservation-submit', { body: { groom_name: '测试' }, expectStatus: 400 });
      rec('C端·预约提交参数校验', 'cend', r.status === 400 ? 'PASS' : 'FAIL', `HTTP ${r.status} (期望 400)`);
    } catch (e) { rec('C端·预约提交参数校验', 'cend', 'FAIL', e.message); }
  } else {
    rec('C端·预约提交参数校验', 'cend', 'SKIP', '写模式下已由真实提交覆盖（限流避让）');
  }

  // ---------- C 端完整交易链路（可选，E2E_WRITE=1）----------
  if (E2E_WRITE) {
    const phone = '139' + String(Math.floor(10000000 + Math.random() * 89999999));
    try {
      const r = await req('POST', '/api/customer/reservation-submit', {
        body: { groom_name: 'e2e', bride_name: 'e2e', phone, expect_date: '2026-09-09', expect_time: '10:00', shoot_location: '海口', package_id: firstPkgId || null },
        expectStatus: 200
      });
      const rid = r.data && r.data.id;
      rec('C端·预约提交(真实)', 'cend', r.ok ? 'PASS' : 'FAIL', `HTTP ${r.status} 预约id=${rid}`);
      if (r.ok) {
        const lr = await req('POST', '/api/customer/login', { body: { phone }, expectStatus: 200 });
        const sid = lr.data && lr.data.sid;
        rec('C端·手机号登录', 'cend', lr.ok && sid ? 'PASS' : 'FAIL', `HTTP ${lr.status}`);
        if (sid) {
          const mb = await req('GET', '/api/customer/my-business', { token: sid, expectStatus: 200 });
          const resvs = (mb.data && mb.data.reservations) || [];
          const hit = resvs.find((x) => String(x.id) === String(rid));
          rec('C端·我的预约(回查)', 'cend', (mb.ok && hit) ? 'PASS' : 'FAIL', `HTTP ${mb.status} 预约数=${resvs.length}`);
        }
      }
    } catch (e) { rec('C端·完整交易链路', 'cend', 'FAIL', e.message); }
  } else {
    rec('C端·完整交易链路', 'cend', 'SKIP', '设 E2E_WRITE=1 启用（会写入一条测试预约）');
  }

  // ---------- 异常监控链路（验证 上报→入库→查看 闭环）----------
  const probeMsg = 'E2E_PROBE:synthetic-' + Date.now();
  try {
    const r = await req('POST', '/api/client-error', {
      body: { type: 'js', end: 'desktop', message: probeMsg, url: '/e2e', ua: 'e2e-script', appVersion: 'e2e', timestamp: new Date().toISOString() },
      expectStatus: 200
    });
    rec('异常监控·上报入库', 'monitor', r.ok ? 'PASS' : 'FAIL', `HTTP ${r.status} id=${r.data && r.data.id}`);
  } catch (e) { rec('异常监控·上报入库', 'monitor', 'FAIL', e.message); }

  if (adminToken) {
    try {
      const r = await req('GET', '/api/client-error', { token: adminToken, expectStatus: 200 });
      const list = (r.data && r.data.list) || [];
      const hit = list.find((x) => x.message === probeMsg);
      rec('异常监控·管理员查看', 'monitor', (r.ok && hit) ? 'PASS' : 'FAIL', `HTTP ${r.status} total=${r.data && r.data.total} 命中探针=${!!hit}`);
    } catch (e) { rec('异常监控·管理员查看', 'monitor', 'FAIL', e.message); }
  } else {
    rec('异常监控·管理员查看', 'monitor', 'SKIP', '无管理员令牌，跳过');
  }

  finish();
}

function finish() {
  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const skip = results.filter((r) => r.status === 'SKIP').length;
  console.log(`\n=== 结果：通过 ${pass} / 失败 ${fail} / 跳过 ${skip} （共 ${results.length}）===\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  rec('脚本异常', 'system', 'FAIL', e.message);
  finish();
});
