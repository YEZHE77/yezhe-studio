import React, { useState, useEffect } from 'react';
import { img } from '../api.js';
import GalleryAlbum from './GalleryAlbum.jsx';

// 客片电子相册（网格 / 流式大图 双视图）—— 与小程序「相册详情页」UI/交互保持一致
// 顶部：返回 + 标题 + 网格/大图切换；右下角常驻青绿色悬浮【分享】；点击图片全屏查看（复用沉浸式画廊）
export default function AlbumGrid({ gallery }) {
  const { title, subtitle, category, albumCopy, cover_url, photos = [] } = gallery;
  const [view, setView] = useState('grid'); // grid | flow
  const [full, setFull] = useState(-1); // >=0 打开全屏查看的起始索引
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const goBack = () => {
    if (window.history.length > 1) window.history.back();
    else window.location.href = window.location.origin + '/';
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setToast('链接已复制，可粘贴给亲友 / 微信转发');
    } catch {
      setToast('复制失败，请手动复制浏览器地址栏链接');
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      {/* 顶部栏 */}
      <div className="fixed top-0 left-0 right-0 z-30 flex items-center justify-between px-2 h-14 bg-[#111111] text-white">
        <button onClick={goBack} className="w-10 h-10 flex items-center justify-center text-2xl leading-none">‹</button>
        <div className="flex-1 text-center text-sm font-medium truncate px-2">{title || subtitle || '作品相册'}</div>
        <div className="flex bg-white/15 rounded-full p-0.5 text-xs shrink-0">
          <button onClick={() => setView('grid')}
            className={'px-3 py-1 rounded-full transition ' + (view === 'grid' ? 'bg-brand text-[#111] font-semibold' : 'text-white/80')}>网格</button>
          <button onClick={() => setView('flow')}
            className={'px-3 py-1 rounded-full transition ' + (view === 'flow' ? 'bg-brand text-[#111] font-semibold' : 'text-white/80')}>大图</button>
        </div>
      </div>
      <div className="h-14" />

      {/* 自定义相册文案模块 */}
      {albumCopy && (
        <div className="mx-4 mt-4 p-4 bg-white rounded-2xl text-sm leading-relaxed text-neutral-600 whitespace-pre-line shadow-sm">
          {albumCopy}
        </div>
      )}

      {/* 两列网格视图 */}
      {view === 'grid' ? (
        <div className="grid grid-cols-2 gap-2 p-3">
          {photos.map((p, i) => (
            <button key={i} onClick={() => setFull(i)}
              className="block aspect-[3/4] rounded-xl overflow-hidden bg-neutral-200 active:opacity-90">
              <img src={img(p)} alt="" className="w-full h-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      ) : (
        /* 流式大图视图 */
        <div className="p-2">
          {photos.map((p, i) => (
            <button key={i} onClick={() => setFull(i)}
              className="block w-full mb-2 rounded-xl overflow-hidden bg-neutral-200 active:opacity-90">
              <img src={img(p)} alt="" className="w-full block" loading="lazy" />
            </button>
          ))}
        </div>
      )}

      {!photos.length && <div className="text-center text-neutral-400 py-24">该相册暂未添加照片</div>}

      {/* 右下角常驻青绿色【分享】按钮 */}
      <button onClick={copyLink}
        className="fixed bottom-6 right-4 z-40 flex items-center justify-center px-6 h-11 rounded-full bg-brand text-[#111] text-sm font-semibold shadow-lg active:opacity-90">
        分享
      </button>

      {/* 轻提示 */}
      {toast && (
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[60] bg-black/80 text-white text-xs px-4 py-2.5 rounded-lg max-w-[80%] text-center">
          {toast}
        </div>
      )}

      {/* 全屏查看（复用沉浸式画廊） */}
      {full >= 0 && (
        <div className="fixed inset-0 z-50">
          <GalleryAlbum gallery={gallery} startIndex={full} onClose={() => setFull(-1)} />
        </div>
      )}
    </div>
  );
}
