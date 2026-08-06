import React, { useState, useEffect } from 'react';
import { img } from '../api.js';
import GalleryAlbum from './GalleryAlbum.jsx';

// 客片电子相册（纵向长图流式 / 缩略图网格 双视图）—— 与小程序「相册详情页」UI/交互保持一致
// 封面右上悬浮青绿色胶囊「分享」；标题栏右侧视图切换；底部品牌工具栏（播放/投屏/预约服务）
export default function AlbumGrid({ gallery }) {
  const { title, subtitle, category, albumCopy, cover_url, photos = [], brand_name, brand_slogan, brand_logo } = gallery;
  const [view, setView] = useState('flow'); // flow 纵向长图（默认） | grid 缩略网格
  const [full, setFull] = useState(-1);     // >=0 打开全屏查看的起始索引
  const [toast, setToast] = useState('');
  const [playing, setPlaying] = useState(false);
  const playTimerRef = useRef(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  // 幻灯片播放：自动向下滚动
  useEffect(() => {
    if (!playing || !photos.length) {
      if (playTimerRef.current) { clearInterval(playTimerRef.current); playTimerRef.current = null; }
      return;
    }
    playTimerRef.current = setInterval(() => {
      if (typeof window === 'undefined') return;
      const viewH = window.innerHeight;
      const next = window.scrollY + viewH * 0.88;
      window.scrollTo({ top: next, behavior: 'smooth' });
    }, 2400);
    return () => { if (playTimerRef.current) clearInterval(playTimerRef.current); };
  }, [playing, photos.length]);

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

  const castScreen = () => {
    setToast('请下拉/上滑手机控制中心 → 屏幕镜像 → 投屏到电视');
  };

  const goAppointment = () => {
    window.location.href = window.location.origin + '/schedule';
  };

  // 切换视图并尽量保留滚动位置（整页滚动，用 window.scrollY）
  const switchView = (v) => {
    if (v === view) return;
    const lastTop = typeof window !== 'undefined' ? window.scrollY : 0;
    setView(v);
    // DOM 更新后恢复近似滚动位置
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (typeof window !== 'undefined') window.scrollTo({ top: lastTop, behavior: 'auto' });
      }, 50);
    });
  };

  const cover = cover_url || photos[0] || '';

  return (
    <div className="min-h-screen bg-[#f7f7f5] text-neutral-900 pb-24">
      {/* 顶部栏：返回 + 标题 + 播放/投屏 */}
      <div className="fixed top-0 left-0 right-0 z-30 flex items-center justify-between px-3 h-14 bg-[#111111] text-white">
        <button onClick={goBack} className="w-10 h-10 flex items-center justify-center text-3xl leading-none">‹</button>
        <div className="flex-1 text-center text-sm font-medium truncate px-2">{title || subtitle || '作品相册'}</div>
        <div className="flex items-center gap-1">
          <button onClick={() => setPlaying(!playing)} className="w-10 h-10 flex items-center justify-center text-lg leading-none">
            {playing ? '⏸' : '▶'}
          </button>
          <button onClick={castScreen} className="w-10 h-10 flex items-center justify-center text-lg leading-none">⍟</button>
        </div>
      </div>
      <div className="h-14" />

      {/* 封面图 + 右上悬浮分享胶囊 */}
      <div className="relative w-full h-[65vw] max-h-[520px] bg-neutral-200">
        {cover && <img src={img(cover)} alt="" className="w-full h-full object-cover" />}
        <button onClick={copyLink}
          className="fixed top-20 right-4 z-40 h-9 px-6 rounded-full bg-brand text-white text-sm font-medium shadow-lg active:opacity-90">
          分享
        </button>
      </div>

      {/* 相册信息区 */}
      <div className="px-5 pt-5 pb-3">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-[#2c2c2c] tracking-wide truncate pr-4">{title || '作品相册'}</h1>
          <div className="flex items-center gap-4 shrink-0">
            <button onClick={() => switchView('flow')}
              className={'text-2xl leading-none ' + (view === 'flow' ? 'text-[#2c2c2c]' : 'text-neutral-400')}>
              ≡
            </button>
            <button onClick={() => switchView('grid')}
              className={'text-xl leading-none ' + (view === 'grid' ? 'text-[#2c2c2c]' : 'text-neutral-400')}>
              ▦
            </button>
          </div>
        </div>
        {category && <span className="inline-block mt-2 px-3 py-1 bg-neutral-200 text-neutral-600 text-xs rounded">{category}</span>}
        {albumCopy && <div className="mt-3 text-sm leading-7 text-neutral-600 whitespace-pre-line">{albumCopy}</div>}
      </div>

      {/* 照片内容：流式 / 网格 */}
      <div>
        {view === 'flow' ? (
          <div className="px-0">
            {photos.map((p, i) => (
              <button key={i} onClick={() => setFull(i)}
                className="block w-full mb-2 bg-neutral-200 active:opacity-90">
                <img src={img(p)} alt="" className="w-full block" loading="lazy" />
              </button>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5 px-2">
            {photos.map((p, i) => (
              <button key={i} onClick={() => setFull(i)}
                className="block aspect-[3/4] overflow-hidden bg-neutral-200 active:opacity-90">
                <img src={img(p, 'thumb')} alt="" className="w-full h-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        )}
        {!photos.length && <div className="text-center text-neutral-400 py-24">该相册暂未添加照片</div>}
      </div>

      {/* 底部品牌工具栏 */}
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-[#2c2c2c] px-5 py-3 flex items-center justify-between">
        <div className="flex items-center min-w-0">
          {brand_logo ? (
            <img src={img(brand_logo)} alt="" className="w-10 h-10 rounded-full object-cover bg-white shrink-0" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-brand flex items-center justify-center text-white text-xs font-semibold shrink-0">YE</div>
          )}
          <div className="ml-3 min-w-0">
            <div className="text-sm font-medium text-white truncate">{brand_name || 'YEZHE WORKSHOP'}</div>
            {brand_slogan && <div className="text-[11px] text-neutral-400 truncate">{brand_slogan}</div>}
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <button onClick={() => setPlaying(!playing)} className="flex flex-col items-center text-white/90 min-w-[48px]">
            <span className="text-lg leading-none">{playing ? '⏸' : '▶'}</span>
            <span className="text-[10px] mt-0.5">{playing ? '暂停' : '播放'}</span>
          </button>
          <button onClick={castScreen} className="flex flex-col items-center text-white/90 min-w-[48px]">
            <span className="text-lg leading-none">⍟</span>
            <span className="text-[10px] mt-0.5">投屏</span>
          </button>
          <button onClick={goAppointment}
            className="h-9 px-4 rounded-md bg-brand text-white text-sm font-medium active:opacity-90">
            预约服务
          </button>
        </div>
      </div>

      {/* 轻提示 */}
      {toast && (
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[60] bg-black/80 text-white text-xs px-4 py-2.5 rounded-lg max-w-[80%] text-center">
          {toast}
        </div>
      )}

      {/* 全屏查看（复用沉浸式画廊，隐藏分享按钮） */}
      {full >= 0 && (
        <div className="fixed inset-0 z-50">
          <GalleryAlbum gallery={gallery} startIndex={full} onClose={() => setFull(-1)} />
        </div>
      )}
    </div>
  );
}