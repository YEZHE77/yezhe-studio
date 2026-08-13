#!/usr/bin/env node
/**
 * 防白屏检查：扫描 JSX/JS 组件中「引用了但未定义」的标识符。
 * 背景：`setStudio` 未定义却在 useEffect 中调用 → ReferenceError → 组件崩溃 → 白屏，
 *       而 vite build 与 check-lazy-imports 都检测不到（运行时才抛错）。
 * 策略：对每个文件提取
 *   1) 已定义标识符集合：useState/useRef/useMemo/useCallback 返回值、const/let/var 声明、
 *      import 的具名导入、函数参数、组件 props 解构；
 *   2) 引用集合：出现在表达式/调用位置的大写驼峰标识符（setXxx / Xxx 组件变量等）；
 *   3) 报出「引用但未定义」的候选，供人工复核（可能误报 props，需看上下文）。
 * 用法：node scripts/check-undefined-refs.mjs [文件...]  （默认扫描 client/src/pages 全部 jsx/js）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_DIR = path.join(ROOT, 'client/src/pages');

const args = process.argv.slice(2);
let targets;
if (args.length) {
  targets = args.map((a) => (path.isAbsolute(a) ? a : path.resolve(ROOT, a)));
} else {
  targets = fs.readdirSync(DEFAULT_DIR)
    .filter((f) => /\.(jsx|js)$/.test(f))
    .map((f) => path.join(DEFAULT_DIR, f));
}

// 常见内置全局，避免误报
const GLOBALS = new Set([
  'window', 'document', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage',
  'fetch', 'FormData', 'File', 'FileReader', 'Blob', 'URL', 'URLSearchParams', 'Image', 'Audio',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'requestAnimationFrame',
  'console', 'JSON', 'Math', 'Date', 'Promise', 'Object', 'Array', 'String', 'Number', 'Boolean',
  'RegExp', 'Error', 'Map', 'Set', 'WeakMap', 'Symbol', 'parseInt', 'parseFloat', 'isNaN', 'encodeURIComponent',
  'React', 'alert', 'confirm', 'navigator', 'globalThis', 'structuredClone', 'crypto', 'btoa', 'atob',
  'AbortController', 'AbortSignal', 'Uint8Array', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Int16Array',
  'Int32Array', 'Float32Array', 'Float64Array', 'ArrayBuffer', 'DataView', 'TextEncoder', 'TextDecoder',
  'WebSocket', 'XMLHttpRequest', 'EventSource', 'IntersectionObserver', 'ResizeObserver', 'MutationObserver',
  'getComputedStyle', 'getSelection', 'requestIdleCallback', 'cancelIdleCallback', 'devicePixelRatio',
  'innerWidth', 'innerHeight', 'screen', 'BroadcastChannel', 'Fragment', 'matchMedia', 'Element', 'Node',
  'HTMLElement', 'SVGElement', 'Event', 'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'TouchEvent',
  'createElement', 'appendChild', 'removeChild', 'querySelector', 'querySelectorAll', 'getElementById'
]);

const ISSUES = [];

for (const file of targets) {
  if (!fs.existsSync(file)) { console.log(`✗ 文件不存在: ${file}`); continue; }
  const src = fs.readFileSync(file, 'utf8');
  // 去掉注释，避免注释里的标识符误报
  let code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  // 去掉字符串字面量（单双引号 + 模板串），避免文本内容误报
  code = code.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""').replace(/`[^`]*`/g, '``');
  // 去掉 JSX 文本节点（<tag>文本</），避免「Cloudflare CDN」等文案误报；
  // 只匹配「标签开 → 文本 → 标签闭」结构，绝不跨越 `);` 等代码边界
  code = code.replace(/(<(?!\/)[^>]+>)[^<{}]*(<\/?)/g, '$1$2');

  const defined = new Set(GLOBALS);

  // import 具名/默认导入
  for (const m of code.matchAll(/import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:{([^}]+)})?\s*from/g)) {
    if (m[1]) defined.add(m[1]);
    if (m[2]) m[2].split(',').map((s) => s.trim().split(/\s+as\s+/).pop().replace(/^type\s+/, '')).filter(Boolean).forEach((n) => defined.add(n));
  }
  for (const m of code.matchAll(/import\s+([A-Za-z_$][\w$]*)\s*from/g)) defined.add(m[1]);

  // hooks 返回值：const [x, setX] = useState(...) / useRef / useMemo / useCallback
  for (const m of code.matchAll(/const\s*\[\s*([\w$]+)\s*,\s*([\w$]+)\s*\]\s*=\s*use(?:State|Ref|Memo|Callback|Reducer)\(/g)) {
    defined.add(m[1]); defined.add(m[2]);
  }
  // 数组解构 const [a, b] = ...
  for (const m of code.matchAll(/const\s*\[\s*([\w$]+(?:\s*,\s*[\w$]+)*)\s*\]\s*=\s*(?!use)/g)) {
    m[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((n) => defined.add(n));
  }
  // const/let/var 声明（含解构对象）
  for (const m of code.matchAll(/const\s*\{([^}]+)\}\s*=\s*/g)) {
    m[1].split(',').map((s) => s.trim().split(/\s*:\s*/)[0].split(/\s+as\s+/)[0].replace(/^\?/, '')).filter(Boolean).forEach((n) => defined.add(n));
  }
  for (const m of code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) defined.add(m[1]);
  // 函数声明 / 类
  for (const m of code.matchAll(/(?:function|class)\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);
  // 函数参数（function x(a, b) 与箭头函数参数）
  for (const m of code.matchAll(/function\s+[\w$]*\s*\(([^)]*)\)/g)) {
    m[1].split(',').map((s) => s.trim().replace(/^\.\.\./, '')).filter(Boolean).forEach((n) => defined.add(n.split(/\s*[:=]/)[0]));
  }
  for (const m of code.matchAll(/=>\s*\{/g)) { /* 忽略，箭头参数难精确，靠下方排除 */ }

  // 引用的标识符候选：\b(setXxx|xxx)\b 大写开头的驼峰，或在调用位置的 setXxx
  const refs = new Map(); // name -> count
  // 过滤：颜色值(F0F0F0)、SVG 命令(M12)、全大写 token(CDN/VIP/API/STUDIO 等多为文本/常量)
  const isNoise = (n) => /^[A-F0-9]{3,6}$/.test(n) || /^M\d{1,3}$/.test(n) || /^[A-Z][A-Z0-9_]{2,}$/.test(n);
  const isComponentLike = (n) => /^[A-Z][a-z]/.test(n) || /^set[A-Z]/.test(n);
  // 1) setXxx 样式（setter）引用 —— 排除方法调用(\.setXxx)、CSS 属性键(setXxx:)、属性访问(setXxx.)
  for (const m of code.matchAll(/\bset[A-Z][\w$]*\b/g)) {
    const i = m.index;
    const prev = i > 0 ? code[i - 1] : '';
    const next = code[i + m[0].length] || '';
    if (prev === '.' || next === ':' || next === '.') continue; // 方法/属性/对象键
    if (!defined.has(m[0])) refs.set(m[0], (refs.get(m[0]) || 0) + 1);
  }
  // 2) 驼峰 PascalCase 标识符（组件/变量引用）—— 排除对象键(Key:)、方法调用(.Key)、JSX 文本
  for (const m of code.matchAll(/\b([A-Z][a-zA-Z0-9_$]{2,})\b/g)) {
    const i = m.index;
    const prev = i > 0 ? code[i - 1] : '';
    const next = code[i + m[0].length] || '';
    if (prev === '.' || next === ':' || next === '.') continue;
    if (!defined.has(m[1]) && !isNoise(m[1]) && isComponentLike(m[1])) refs.set(m[1], (refs.get(m[1]) || 0) + 1);
  }

  for (const [name, cnt] of [...refs.entries()].sort((a, b) => b[1] - a[1])) {
    ISSUES.push({ file: path.relative(ROOT, file), name, cnt });
  }
}

if (ISSUES.length) {
  console.log('\n⚠ 发现「引用但可能未定义」的标识符（需人工复核，props 传入的属正常）：');
  for (const { file, name, cnt } of ISSUES) console.log(`  ${file}  →  ${name}  (${cnt} 处)`);
  process.exitCode = 1;
} else {
  console.log('✓ 未发现引用未定义的标识符');
}
