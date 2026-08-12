// utils/imageUrl.js —— 云端图片 URL 工具（小程序端）
// ⚠️ workers.dev 域名在国内被 GFW 封锁（DNS 污染），手机端无法访问。
//    所有 R2 图片 URL 统一重写到 yezhe-studio.pages.dev（国内可直连），
//    由 Cloudflare Pages Function 内部代理到 R2 Worker（CF 内网不受 GFW 影响）。
//
// Pages Function 代理路径：yezhe-studio.pages.dev/r2/xxx → 内部 fetch Worker → 返回图片
// Worker 支持 ?w= 宽度缩放参数。按场景取不同宽度，降低流量与内存占用：
//   thumb   —— ?w=420  列表缩略图（作品/套系列表、选片网格）
//   preview —— ?w=1080 相册滑动浏览中等画质
//   original—— 不追加参数，返回原始原图（查看原图 / 保存）
//
// 异常兜底：入参为空 / 非 http 绝对地址（如旧 /uploads 相对路径）/ URL 解析失败时，
// 一律原样返回 src，绝不产生裂图。

var WORKERS_HOST = 'yezhe-img-proxy.yezhe128627.workers.dev';
var PAGES_HOST = 'yezhe-studio.pages.dev';

// 把 workers.dev 域名重写为 pages.dev，绕过 GFW 封锁
function rewriteHost(url) {
  if (!url || url.indexOf(WORKERS_HOST) === -1) return url;
  return url.replace(WORKERS_HOST, PAGES_HOST);
}

function getImageUrl(src, mode) {
  if (!src) return '';
  if (typeof src !== 'string') return src;
  // 相对路径（旧的 /uploads/...）无法走云端缩放，原样返回，避免裂图
  if (src.indexOf('http') !== 0) return src;
  // workers.dev → pages.dev（绕过 GFW 封锁）
  src = rewriteHost(src);
  try {
    var u = new URL(src);
    // 先清除旧的 w 参数，避免重复/冲突
    u.searchParams.delete('w');
    if (mode === 'thumb') {
      u.searchParams.set('w', '420');
    } else if (mode === 'preview') {
      u.searchParams.set('w', '1080');
    }
    // original 不追加任何参数
    return u.toString();
  } catch (e) {
    // URL 解析失败（极端情况）原样返回，避免裂图
    return src;
  }
}

module.exports = { getImageUrl, rewriteHost };
