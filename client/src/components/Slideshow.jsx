import React, { useEffect, useRef, useState } from 'react';
import http from '../api.js';
import bgm from '../bgm.js';

// 全屏幻灯片（Web 管理后台 · 作品相册 / 订单相册 共用）
// 交互与微信小程序端完全统一：
//  - 仅当父页面在用户点击【播放】手势内调用 bgm.play() 后才出声
//  - 图片切换：Web 电脑端左右箭头 + 键盘 ←→ ；ESC 关闭
//  - 内置自动轮播开关：开启后每张停留 5 秒，手动切图重置倒计时，可随时关闭
//  - 悬浮控件：静音切换 / 自动播放开关 / 关闭
//  - 退出：关闭按钮 / 点击黑色蒙层 / ESC；退出时父页面负责 pause BGM
//  - 切图不中断 BGM；缓冲中展示「音乐加载中」
export default function Slideshow({ photos = [], open, onClose, title = '' }) {
  const [index, setIndex] = useState(0);
  const [autoplay, setAutoplay] = useState(false);
  const [muted, setMuted] = useState(false);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);

  const total = photos.length;

  // 挂载时拉取 BGM 地址并初始化单例；订阅状态（loading / muted）
  useEffect(() => {
    let alive = true;
    http.get('/api/settings/studio').then((r) => {
      if (alive && r && r.data && r.data.bgmUrl) bgm.init(r.data.bgmUrl);
    }).catch(() => {});
    const unsub = bgm.subscribe((s) => { setLoading(s.loading); setMuted(s.muted); });
    return () => { alive = false; unsub(); };
  }, []);

  // 打开时重置到第一张并开启自动播放；关闭时清理定时器
  useEffect(() => {
    if (open) { setIndex(0); setAutoplay(true); }
    else if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, [open]);

  // 键盘：←→ 切换，ESC 关闭
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 自动播放定时器：依赖 index，手动切图会重置倒计时
  useEffect(() => {
    if (!open || !autoplay) return;
    timerRef.current = setInterval(() => {
      setIndex((i) => (total ? (i + 1) % total : i));
    }, 5000);
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [open, autoplay, total, index]);

  function goNext() { if (total) setIndex((i) => (i + 1) % total); }
  function goPrev() { if (total) setIndex((i) => (i - 1 + total) % total); }
  function toggleAutoplay() { setAutoplay((v) => !v); }
  function toggleMute() { setMuted(bgm.toggleMute()); }

  if (!open || !total) return null;

  const cur = photos[index] ? (photos[index].preview || photos[index].url) : '';

  return (
    <div className="fixed inset-0 z-[9999] bg-black flex items-center justify-center" onClick={onClose}>
      {/* 顶部计数 / 标题 */}
      <div className="absolute top-0 left-0 right-0 flex flex-col items-center pt-4 pointer-events-none">
        {title && <div className="text-white/70 text-xs mb-1">{title}</div>}
        <span className="text-white/90 text-sm px-3 py-1 rounded-full bg-black/40">{index + 1} / {total}</span>
      </div>

      {/* 图片：阻止冒泡到蒙层 */}
      <img
        src={cur}
        alt=""
        className="max-w-full max-h-full object-contain select-none"
        onClick={(e) => e.stopPropagation()}
        draggable={false}
      />

      {/* 缓冲提示 */}
      {loading && (
        <div className="absolute top-16 left-0 right-0 text-center text-white/80 text-sm">音乐加载中…</div>
      )}

      {/* 左右箭头（Web 电脑端） */}
      <button
        className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white text-2xl flex items-center justify-center"
        onClick={(e) => { e.stopPropagation(); goPrev(); }}
        aria-label="上一张"
      >‹</button>
      <button
        className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white text-2xl flex items-center justify-center"
        onClick={(e) => { e.stopPropagation(); goNext(); }}
        aria-label="下一张"
      >›</button>

      {/* 底部悬浮控件（阻止冒泡） */}
      <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-8" onClick={(e) => e.stopPropagation()}>
        <button className="flex flex-col items-center text-white" onClick={toggleMute}>
          <span className="text-2xl">{muted ? '🔇' : '🔊'}</span>
          <span className="text-xs mt-1">{muted ? '已静音' : '音乐'}</span>
        </button>
        <button className={'flex flex-col items-center ' + (autoplay ? 'text-brand' : 'text-white')} onClick={toggleAutoplay}>
          <span className="text-2xl">{autoplay ? '⏩' : '⏯'}</span>
          <span className="text-xs mt-1">{autoplay ? '自动播放' : '手动'}</span>
        </button>
        <button className="flex flex-col items-center text-white" onClick={onClose}>
          <span className="text-2xl">✕</span>
          <span className="text-xs mt-1">关闭</span>
        </button>
      </div>
    </div>
  );
}
