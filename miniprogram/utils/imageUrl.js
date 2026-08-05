// utils/imageUrl.js —— 云端图片 URL 工具（小程序端）
// Worker 支持 ?w= 宽度缩放参数（CDN 域名 yezhe-img-proxy.yezhe128627.workers.dev）。
// 按场景取不同宽度，降低流量与内存占用：
//   thumb   —— ?w=420  列表缩略图（作品/套系列表、选片网格）
//   preview —— ?w=1080 相册滑动浏览中等画质
//   original—— 不追加参数，返回原始原图（查看原图 / 保存）
//
// 异常兜底：入参为空 / 非 http 绝对地址（如旧 /uploads 相对路径）/ URL 解析失败时，
// 一律原样返回 src，绝不产生裂图。

function getImageUrl(src, mode) {
  if (!src) return '';
  if (typeof src !== 'string') return src;
  // 相对路径（旧的 /uploads/...）无法走云端缩放，原样返回，避免裂图
  if (src.indexOf('http') !== 0) return src;
  try {
    const u = new URL(src);
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

module.exports = { getImageUrl };
