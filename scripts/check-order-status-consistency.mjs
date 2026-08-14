#!/usr/bin/env node
/* ==========================================================================
   check-order-status-consistency.mjs — 订单状态/路由「跨端一致性」校验
   —— 防止三类反复出现的错位事故：
     ① 双壳路由漏注册：B 端业务路由只在 AppShell 注册、漏了 MobileShell（手机端点新建→跳"订单不存在"）
     ② 状态关键词分叉：后端 stats/orders 的 LIKE 关键词与前端 OrderDetail 的 ORDER_STEPS_11 kws 不一致
        （详情页进度条显示「等待拍摄」，后端待办 Tab 却查不到 → 计数为 0）
     ③ 渲染层一刀切映射：STATUS_LABEL.deposit 被映射为「等待拍摄」而非「已付定金」
        （「已付定金」筛选/Tab 里的订单却显示「等待拍摄」）
   —— 用法：node scripts/check-order-status-consistency.mjs（在 monorepo 根目录执行）
   —— 规则：
     路由不一致 = 硬失败（会真实 404/白屏）
     deposit 一刀切映射 = 硬失败（语义与后端过滤分叉）
     关键词不一致 = 警告（提示人工复核，可能是有意用 label 或历史兼容）
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

// ========== 检查 2：状态关键词一致性（警告） ==========
const detailSrc = read(DETAIL);

// 提取 ORDER_STEPS_11 的每个步骤 label 与 kws
const stepKws = new Set();
for (const m of detailSrc.matchAll(/kws:\s*\[([^\]]+)\]/g)) {
  for (const kw of m[1].matchAll(/['"]([^'"]+)['"]/g)) stepKws.add(kw[1]);
}

// 提取后端 SQL 里所有 LIKE '%...%' 关键词（仅中文——订单状态边界词均为中文，
// 排除 package_snapshot 的 JSON 字段匹配如 "%\"type\":\"normal\"%"）
const backendKws = new Set();
for (const src of [read(STATS), read(ORDERS)]) {
  for (const m of src.matchAll(/LIKE\s*'%([^%]+)%'/g)) {
    const kw = m[1];
    if (/[\u4e00-\u9fff]/.test(kw)) backendKws.add(kw);
  }
}

// 后端关键词若不在 ORDER_STEPS_11 的 kws 里 → 疑似分叉，提示人工复核
const orphan = [...backendKws].filter((kw) => !stepKws.has(kw)).sort();
if (orphan.length) {
  console.warn('⚠ 后端 SQL 关键词未在 ORDER_STEPS_11.kws 中定义（可能是 label 或历史兼容，请人工确认一致性）:');
  for (const kw of orphan) console.warn(`   - ${kw}`);
} else {
  console.log('✓ 状态关键词一致（后端 LIKE ↔ 前端 ORDER_STEPS_11.kws）');
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

if (failed) {
  console.error('\n校验失败：存在双壳路由漏注册或 deposit 一刀切映射，提交前必须修复！');
  process.exit(1);
}
console.log('\n校验通过 ✔');
