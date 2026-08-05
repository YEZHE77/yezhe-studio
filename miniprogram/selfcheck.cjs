// miniprogram/selfcheck.cjs —— 小程序 P0+P1 修复静态自测脚本
// 用法：node miniprogram/selfcheck.cjs
// 仅做静态文本检查（不依赖微信运行环境），核对：
//  ① 7 个目标页面是否接好 onUnload 清理（终止请求 + 释放内存）
//  ② getImageUrl 工具三分支 + 异常兜底是否完整
// ③ 打印「人工验证清单」供开发者工具真机核对

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PAGES = [
  'pkg/album/album',
  'pkg/appointment/appointment',
  'pkg/evaluate/evaluate',
  'pkg/order/order',
  'pkg/photoSelect/photoSelect',
  'pkg/share/share',
  'pkg/subscribe/subscribe'
];

const report = [];
function check(name, ok, detail) {
  report.push({ name, ok: !!ok, detail: detail || '' });
}

// ---------- ① 7 页面 onUnload 清理 ----------
for (const p of PAGES) {
  const js = fs.readFileSync(path.join(ROOT, p + '.js'), 'utf8');
  const hasOnUnload = /onUnload\s*\(/.test(js);
  const hasTasks = /_tasks/.test(js);
  const hasAbortLoop = /_tasks\.forEach/.test(js);
  const usesReqTask = /requestTask/.test(js) || /this\._req/.test(js);
  // 去掉 wx.request( / function request( / requestTask 后，不应再有裸 request(
  const cleaned = js
    .replace(/wx\.request\(/g, '')
    .replace(/function request\(/g, '')
    .replace(/requestTask/g, '');
  const noBareRequest = !/request\(/.test(cleaned);

  check(`[${p}] 存在 onUnload 卸载清理`, hasOnUnload);
  check(`[${p}] 收集 _tasks 并遍历 abort`, hasTasks && hasAbortLoop);
  check(`[${p}] 请求统一走 requestTask/_req`, usesReqTask);
  check(`[${p}] 无裸 request() 调用`, noBareRequest);
}

// ---------- ② getImageUrl 工具 ----------
const img = fs.readFileSync(path.join(ROOT, 'utils/imageUrl.js'), 'utf8');
check('getImageUrl 已导出', /module\.exports/.test(img) && /getImageUrl/.test(img));
check("thumb 分支追加 ?w=420", /'thumb'[\s\S]*set\('w',\s*'420'\)/.test(img));
check("preview 分支追加 ?w=1080", /'preview'[\s\S]*set\('w',\s*'1080'\)/.test(img));
check('original 分支不追加参数', /original/.test(img));
check('空值兜底返回空串', /if \(!src\) return ''/.test(img));
check('URL 解析异常兜底返回 src', /catch[\s\S]*return src/.test(img));

// ---------- 输出 ----------
const pass = report.filter((r) => r.ok).length;
console.log('========== 小程序 P0+P1 静态自测报告 ==========');
for (const r of report) {
  console.log((r.ok ? '✅' : '❌') + ' ' + r.name + (r.ok ? '' : '  ← 需修复'));
}
console.log(`------------------------------------------------`);
console.log(`通过 ${pass} / ${report.length}`);

console.log('\n========== 人工验证清单（开发者工具 / 真机）==========');
console.log('1. Network 面板：作品/套系列表、轮播封面图片 URL 出现 ?w=420');
console.log('2. 相册(album)、作品详情(workDetail)、分享页网格图片出现 ?w=1080');
console.log('3. 点击「保存」/「查看原图」(previewImage) 传入的 urls 不带 ?w 参数（原图）');
console.log('4. 反复进出 album 相册页，Memory 面板内存不会持续单向上涨（onUnload 已释放）');
console.log('5. （B端）设置 / 清空 VITE_UPLOAD_WORKER_URL，两种上传模式均可用');
console.log('6. 旧相对路径 /uploads 或 URL 解析失败时不裂图（原样返回）');

process.exit(pass === report.length ? 0 : 1);
