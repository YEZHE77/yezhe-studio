import React, { useEffect, useState } from 'react';

// 单张大图预览（Web 管理后台 · 作品相册网格单击）
// 与幻灯片(Slideshow)的区别：纯手动浏览，无 BGM、无自动播放，仅用于「看大图」。
export default function Lightbox({ photos = [], index = 0, open, onClose, title = '' }) {
  const [idx, setIdx] = useState(index || 0);
  const total = photos.length;

  // 打开 / 切换起点时同步索引
  useEffect(() => {
    if (open) setIdx(index || 0);
  }, [open, index]);

  // 键盘：←→ 切换，ESC 关闭
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'ArrowLeft') setIdx((i) => (total ? (i - 1 + total) % total : i));
      else if (e.key === 'ArrowRight') setIdx((i) => (total ? (i + 1) % total : i));
      else if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, total, onClose]);

  if (!open || !total) return null;
  const cur = typeof photos[idx] === 'string'
    ? photos[idx]
    : (photos[idx] && (photos[idx].url || photos[idx].preview)) || '';

  const go = (dir) => setIdx((i) => (total ? (i + dir + total) % total : i));

  return (
    <div className="fixed inset-0 z-[9998] bg-black/95 flex items-center justify-center" onClick={onClose}>
      {/* 顶部计数 / 标题 */}
      <div className="absolute top-0 left-0 right-0 flex flex-col items-center pt-4 pointer-events-none">
        {title && <div className="text-white/70 text-xs mb-1">{title}</div>}
        <span className="text-white/90 text-sm px-3 py-1 rounded-full bg-black/40">{idx + 1} / {total}</span>
      </div>

      {/* 关闭 */}
      <button
        className="absolute top-4 right-4 text-white/80 hover:text-white text-2xl leading-none w-10 h-10 flex items-center justify-center"
        onClick={onClose}
        aria-label="关闭"
      >✕</button>

      {/* 上一张 / 下一张 */}
      <button
        className="absolute left-3 sm:left-6 top-1/2 -translate-y-1/2 text-white/80 hover:text-white text-4xl sm:text-5xl w-12 h-12 flex items-center justify-center"
        onClick={(e) => { e.stopPropagation(); go(-1); }}
        aria-label="上一张"
      >‹</button>
      <button
        className="absolute right-3 sm:right-6 top-1/2 -translate-y-1/2 text-white/80 hover:text-white text-4xl sm:text-5xl w-12 h-12 flex items-center justify-center"
        onClick={(e) => { e.stopPropagation(); go(1); }}
        aria-label="下一张"
      >›</button>

      {/* 图片：阻止冒泡到蒙层 */}
      <img
        src={cur}
        alt=""
        onClick={(e) => e.stopPropagation()}
        className="max-w-[92vw] max-h-[86vh] object-contain select-none"
        draggable={false}
      />
    </div>
  );
}
