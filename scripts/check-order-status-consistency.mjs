#!/usr/bin/env node
/* ==========================================================================
   check-order-status-consistency.mjs — 订单状态/路由「跨端一致性」校验
   —— 防止四类反复出现的错位事故：
     ① 双壳路由漏注册：B 端业务路由只在 AppShell 注册、漏了 MobileShell（手机端点新建→跳"订单不存在"）
     ② 状态关键词分叉：前端 currentStageIndex 的关键词与后端 stats/orders 的 LIKE 不一致
        （详情页进度条显示「等待拍摄」，后端待办 Tab 却查不到 → 计数为 0）
     ③ 渲染层一刀切映射：STATUS_LABEL.deposit 被映射为「等待拍摄」而非「已付定金」
        （「已付定金」筛选/Tab 里的订单却显示「等待拍摄」）
     ④ 非法 status 枚举：STAGE_NEXT / STAGE_PREV 用了不存在的 status 值（合法仅 6 阶段），各端不认识该状态
   —— 用法：node scripts/check-order-status-consistency.mjs（在 monorepo 根目录执行）
   —— 规则：
     路由不一致 = 硬失败（会真实 404/白屏）
     deposit 一刀切映射 = 硬失败（语义与后端过滤分叉）
     非法 status 枚举 = 硬失败（各端不认识该状态）
     关键词不一致 = 硬失败（前端关键词必须在后端 LIKE 里）
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';

const APP = 'client/src/App.jsx';
const MOBILE = 'client/src/layout/MobileShell.jsx';
const DETAIL = 'client/src/pages/OrderDetail.jsx';
const STATS = 'server/src/routes/stats.js';
const ORDERS = 'server/src/routes/orders.js';

const read = (p) => {
  if (!fs.existsSync(p)) { console.error(`✗ 文件不存在: ${p}`); process.exit(1); }
  return fs.readFileSync(p, 'utf8');
};

let failed = false;

// ========== 检查 1：双壳路由一致性（硬失败） ==========
const appPaths = new Set([...read(APP).matchAll(/path="([^"]+)"/g)].map((m) => m[1]));
const mobPaths = new Set([...read(MOBILE).matchAll(/path="([^"]+)"/g)].map((m) => m[1]));

// B 端鉴权业务前缀：这些前缀下的路由必须同时注册在 AppShell 与 MobileShell
const BIZ_PREFIXES = [
  '/works', '/categories', '/packages', '/schedule', '/orders', '/appointments',
  '/reviews', '/settings', '/customers', '/datacharts', '/card', '/selections',
  '/channels', '/finance', '/capacity', '/todo'
];

const inPrefix = (p, prefix) => p === prefix || p.startsWith(prefix + '/');

for (const prefix of BIZ_PREFIXES) {
  const appSub = [...appPaths].filter((p) => inPrefix(p, prefix));
  const mobSub = [...mobPaths].filter((p) => inPrefix(p, prefix));
  const onlyApp = appSub.filter((p) => !mobPaths.has(p));
  const onlyMob = mobSub.filter((p) => !appPaths.has(p));
  if (onlyApp.length) {
    console.error(`✗ 双壳路由漏注册：AppShell 有、MobileShell 缺 → ${onlyApp.join(', ')}`);
    failed = true;
  }
  if (onlyMob.length) {
    console.error(`✗ 双壳路由漏注册：MobileShell 有、AppShell 缺 → ${onlyMob.join(', ')}`);
    failed = true;
  }
}
if (!failed) console.log('✓ 双壳路由一致（AppShell ↔ MobileShell）');

// ========== 检查 2：状态关键词一致性（硬失败） ==========
// 前端 currentStageIndex / STAGE_NEXT 用到的中文关键词，必须在后端 stats/orders 的 LIKE 里出现
// （反之不要求——后端有历史兼容冗余关键词如「等待拍摄」「拍摄执行」）
const detailSrc = read(DETAIL);
const FRONT_KWS = ['沟通确认', '精修完成', '全部精修完成', '底片打包', '原片打包'];
const backendKws = new Set();
for (const src of [read(STATS), read(ORDERS)]) {
  for (const m of src.matchAll(/LIKE\s*'%([^%]+)%'/g)) {
    const kw = m[1];
    if (/[\u4e00-\u9fff]/.test(kw)) backendKws.add(kw);
  }
}
const missing = FRONT_KWS.filter((kw) => !backendKws.has(kw)).sort();
if (missing.length) {
  console.error(`✗ 前端状态关键词未在后端 LIKE 中定义: ${missing.join(', ')}`);
  failed = true;
} else {
  console.log('✓ 状态关键词一致（前端 currentStageIndex ↔ 后端 LIKE）');
}

// ========== 检查 3：渲染层 deposit 一刀切映射（硬失败） ==========
// deposit 状态必须映射为「已付定金」；细分的「等待拍摄」必须由 logs 是否含「沟通确认」动态判断。
// 若 STATUS_LABEL.deposit = '等待拍摄' 一刀切，会与后端 waiting_shoot 过滤语义分叉
// （「已付定金」筛选/Tab 里的订单却显示「等待拍摄」）。
function walkJsx(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push(...walkJsx(p));
    else if (f.endsWith('.jsx')) out.push(p);
  }
  return out;
}

for (const file of walkJsx('client/src')) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/deposit\s*:\s*['"]等待拍摄['"]/g)) {
    console.error(`✗ ${file} 中 deposit 一刀切映射为「等待拍摄」，应改为「已付定金」（细分靠 logs 含「沟通确认」判断）`);
    failed = true;
  }
}

// ========== 检查 4：STAGE_NEXT / STAGE_PREV 的 status 枚举合法性（硬失败） ==========
// status 只有 6 个合法阶段值。若出现不存在的值（如 retouch_done），各端不认识该状态。
const LEGAL_STATUS = new Set(['deposit', 'shot', 'selecting', 'retouching', 'delivered', 'completed']);
const usedStatus = new Set();
// 负向后顾：排除 payment_status / paymentStatus 等（前面是 _ 或字母则不是订单 status 字段）
for (const m of detailSrc.matchAll(/(?<![a-zA-Z_])status:\s*['"]([^'"]+)['"]/g)) usedStatus.add(m[1]);
const illegal = [...usedStatus].filter((s) => !LEGAL_STATUS.has(s));
if (illegal.length) {
  console.error(`✗ OrderDetail.jsx 出现非法的 status 值: ${illegal.join(', ')}（合法: ${[...LEGAL_STATUS].join('/')}）`);
  failed = true;
} else {
  console.log('✓ STAGE_NEXT / STAGE_PREV status 枚举合法');
}

if (failed) {
  console.error('\n校验失败：存在双壳路由漏注册 / deposit 一刀切映射 / 非法 status 枚举 / 关键词分叉，提交前必须修复！');
  process.exit(1);
}
console.log('\n校验通过 ✔');
