#!/usr/bin/env node
/* ==========================================================================
   check-lazy-imports.mjs — 校验路由引用组件均有对应 import
   —— 防止「React.lazy 未定义的组件引用构建期不报错、运行时全站白屏」事故
   —— 用法：node scripts/check-lazy-imports.mjs client/src/App.jsx client/src/layout/MobileShell.jsx
   —— 白名单：从 react / react-router-dom 直接导入的（Navigate、Suspense 等）与文件内定义的组件
   ========================================================================== */
import fs from 'node:fs';

// 组件在文件内已有定义（函数/箭头函数/const 数组等）——这些无需 import
function collectLocalDefs(src) {
  const defs = new Set();
  // 同步 import 具名/默认：import X from / import { A, B } from
  for (const m of src.matchAll(/import\s+(?:[\w*]+\s*,?\s*)?\{?([^}]+?)\}?\s*from\s*['"]/g)) {
    const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    for (const n of names) {
      const base = n.split(/\s+as\s+/).pop().trim();
      if (/^[A-Z]\w*$/.test(base)) defs.add(base);
    }
  }
  // 默认导入：import X from '...'
  for (const m of src.matchAll(/import\s+([A-Z]\w*)\s+from\s*['"]/g)) defs.add(m[1]);
  // React.lazy
  for (const m of src.matchAll(/const\s+([A-Z]\w*)\s*=\s*React\.lazy/g)) defs.add(m[1]);
  // 函数声明 / 箭头函数 / const 数组
  for (const m of src.matchAll(/(?:function|const)\s+([A-Z]\w*)\s*(?:=|\()/g)) defs.add(m[1]);
  return defs;
}

function collectRouteRefs(src) {
  const refs = new Set();
  for (const m of src.matchAll(/element=\{<([A-Z]\w*)/g)) refs.add(m[1]);
  for (const m of src.matchAll(/element\s*=\s*<([A-Z]\w*)\s*\/>/g)) refs.add(m[1]);
  return refs;
}

let failed = false;
for (const file of process.argv.slice(2)) {
  if (!fs.existsSync(file)) { console.error(`✗ 文件不存在: ${file}`); failed = true; continue; }
  const src = fs.readFileSync(file, 'utf8');
  const defs = collectLocalDefs(src);
  const refs = collectRouteRefs(src);
  const missing = [...refs].filter((r) => !defs.has(r));
  if (missing.length) {
    console.error(`✗ ${file} 路由引用了未定义的组件: ${missing.join(', ')}`);
    console.error('  可能原因：懒加载 import 被误删/覆盖。请补回对应 React.lazy 或 import。');
    failed = true;
  } else {
    console.log(`✓ ${file} 全部路由组件均已定义 (${refs.size} 个引用)`);
  }
}

if (failed) {
  console.error('\n校验失败：存在未定义的组件引用，提交前必须修复！');
  process.exit(1);
}
console.log('\n校验通过 ✔');
