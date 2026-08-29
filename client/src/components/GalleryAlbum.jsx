import React, { useState, useEffect, useRef } from 'react';
import { img } from '../api.js';

// 客片电子相册沉浸式全屏查看（灯箱）
// 验收清单 6.4：手机端【左右滑动】切换 + 【双指捏合缩放】；电脑端【方向键 ←/→】翻页 + 滚轮/双击缩放 + ESC 关闭。
// 保留：顶部导航、进度指示点、底部品牌工具栏（播放[带BGM]/更多）、分享；首屏叠加新人名字/分类/文案。
export default function GalleryAlbum({ gallery, startIndex = 0, onClose }) {
  const { title, subtitle, category, blessing, albumCopy, photos = [], brand_name, brand_slogan, brand_intro, brand_logo } = gallery;
  // 自定义相册文案（albumCopy）优先级高于旧 blessing，作为相册正文文案模块
  const copy = albumCopy || blessing || '';
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(startIndex || 0);
  const [toast, setToast] = useState('');
  const [showShare, setShowShare] = useState(false);
  // 缩放 / 平移（仅作用于当前张）
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [animating, setAnimating] = useState(false); // 切换张时的滑动过渡
  const trackRef = useRef(null);
  const timerRef = useRef(null);
  const audioRef = useRef(null);
  // 手势状态机
  const g = useRef({ mode: null, startX: 0, startY: 0, startTx: 0, startTy: 0, dragOffset: 0, pinchStartDist: 0, startScale: 1, lastTapTime: 0, lastTapX: 0, lastTapY: 0, mouseDown: false });

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  const clampPan = (s, x, y) => {
    const maxX = (typeof window !== 'undefined' ? window.innerWidth : 800) * (s - 1) / 2;
    const maxY = (typeof window !== 'undefined' ? window.innerHeight : 800) * (s - 1) / 2;
    return [clamp(x, -maxX, maxX), clamp(y, -maxY, maxY)];
  };
  // 将轨道平移到指定索引（extra 为像素级实时偏移，用于拖拽跟手）
  const applyTrack = (idx, extra = 0) => {
    if (trackRef.current) trackRef.current.style.transform = `translateX(calc(${-idx * 100}vw + ${extra}px))`;
  };

  // BGM：与 AlbumGrid 幻灯片同一来源（/bgm/bgm.mp3），保持品牌统一
  const BGM_SRC = '/bgm/bgm.mp3';
  const ensureAudio = () => {
    if (audioRef.current) return audioRef.current;
    try { const a = new Audio(BGM_SRC); a.loop = true; audioRef.current = a; } catch { /* 忽略音频初始化失败 */ }
    return audioRef.current;
  };

  // 自动播放（幻灯片模式）：每隔 3.5s 切到下一张
  useEffect(() => {
    if (!playing || !photos.length) return;
    timerRef.current = setInterval(() => {
      setCurrent((i) => { const ni = (i + 1) % photos.length; resetView(ni); return ni; });
    }, 3500);
    return () => clearInterval(timerRef.current);
  }, [playing, photos.length]);

  // 组件卸载：清理 BGM（关闭全屏预览/切到其它页时停止音乐）
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current = null;
      }
    };
  }, []);

  // 键盘：←/→ 翻页（未缩放时）、+/- 缩放、ESC 关闭
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { if (onClose) onClose(); return; }
      if (e.key === 'ArrowLeft') { if (scale === 1) goTo(current - 1); }
      else if (e.key === 'ArrowRight') { if (scale === 1) goTo(current + 1); }
      else if (e.key === '+' || e.key === '=') { setScale((s) => clamp(s * 1.3, 1, 5)); setTx(0); setTy(0); }
      else if (e.key === '-' || e.key === '_') { setScale((s) => clamp(s / 1.3, 1, 5)); setTx(0); setTy(0); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, scale, onClose]);

  // 进入指定张：重置缩放/平移，带滑动过渡
  const resetView = (idx) => {
    setScale(1); setTx(0); setTy(0);
    setAnimating(true);
    applyTrack(idx, 0);
    setTimeout(() => setAnimating(false), 320);
  };
  const goTo = (i) => {
    const ni = clamp(i, 0, photos.length - 1);
    setCurrent(ni);
    resetView(ni);
  };

  // 双击/双指点击切换 2x 缩放（以点击位置为中心，简化：居中放大）
  const toggleZoom = (cx, cy) => {
    if (scale > 1) { setScale(1); setTx(0); setTy(0); }
    else {
      setScale(2);
      // 以点击点为中心调整平移（让点击处大致保持在原位）
      const w = typeof window !== 'undefined' ? window.innerWidth : 800;
      const h = typeof window !== 'undefined' ? window.innerHeight : 800;
      const ox = cx != null ? (cx - w / 2) * (2 - 1) : 0;
      const oy = cy != null ? (cy - h / 2) * (2 - 1) : 0;
      const [nx, ny] = clampPan(2, -ox, -oy);
      setTx(nx); setTy(ny);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => setToast(''), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  // 首屏定位到 startIndex
  useEffect(() => {
    applyTrack(startIndex || 0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showToast = (msg) => setToast(msg);

  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: subtitle || title, url: window.location.href });
        return;
      }
    } catch { /* 用户取消，忽略 */ }
    // 兜底：复制链接
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast('链接已复制，可粘贴给亲友 / 微信转发');
    } catch {
      showToast('请点击右上角「···」转发给好友');
    }
  };

  const togglePlay = () => {
    const next = !playing;
    setPlaying(next);
    if (next) {
      // iOS 需用户手势内解锁音频：开启播放时立即触发 audio.play()
      const a = ensureAudio();
      if (a) a.play().catch(() => {});
    } else {
      const a = audioRef.current;
      if (a) a.pause();
    }
  };

  const goMore = () => {
    // 查看更多：返回 C 端主页（公开落地页），绝不落管理后台
    const base = window.location.origin;
    window.location.href = base + '/home';
  };

  const copyAlbumLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShowShare(false);
      showToast('链接已复制，可粘贴给亲友 / 微信转发');
    } catch {
      showToast('复制失败，请手动复制浏览器地址栏链接');
    }
  };

  // ===== 触摸手势（手机端：左右滑动切换 / 双指捏合缩放 / 单指拖动平移）=====
  const onTouchStart = (e) => {
    const t = e.touches;
    if (t.length === 2) {
      g.current.mode = 'pinch';
      g.current.pinchStartDist = dist(t[0], t[1]);
      g.current.startScale = scale;
    } else if (t.length === 1) {
      const x = t[0].clientX, y = t[0].clientY;
      // 双击放大检测
      const now = Date.now();
      if (g.current.lastTapTime && now - g.current.lastTapTime < 300 && Math.abs(x - g.current.lastTapX) < 30 && Math.abs(y - g.current.lastTapY) < 30) {
        g.current.mode = 'none';
        toggleZoom(x, y);
        g.current.lastTapTime = 0;
        return;
      }
      g.current.lastTapTime = now; g.current.lastTapX = x; g.current.lastTapY = y;
      if (scale > 1) {
        g.current.mode = 'pan';
        g.current.startTx = tx; g.current.startTy = ty; g.current.startX = x; g.current.startY = y;
      } else {
        g.current.mode = 'swipe';
        g.current.startX = x; g.current.dragOffset = 0;
        setAnimating(false);
      }
    }
  };
  const onTouchMove = (e) => {
    const t = e.touches;
    if (g.current.mode === 'pinch' && t.length === 2) {
      const d = dist(t[0], t[1]);
      const ns = clamp(g.current.startScale * (d / (g.current.pinchStartDist || d)), 1, 5);
      setScale(ns);
      if (ns === 1) { setTx(0); setTy(0); }
    } else if (g.current.mode === 'pan' && t.length === 1) {
      const x = t[0].clientX, y = t[0].clientY;
      const [nx, ny] = clampPan(scale, g.current.startTx + (x - g.current.startX), g.current.startTy + (y - g.current.startY));
      setTx(nx); setTy(ny);
    } else if (g.current.mode === 'swipe' && t.length === 1) {
      const dx = t[0].clientX - g.current.startX;
      g.current.dragOffset = dx;
      applyTrack(current, dx); // 直接操作 DOM，跟手更顺滑
    }
  };
  const onTouchEnd = () => {
    if (g.current.mode === 'swipe') {
      const dx = g.current.dragOffset || 0;
      const w = typeof window !== 'undefined' ? window.innerWidth : 800;
      setAnimating(true);
      if (dx <= -w * 0.22 && current < photos.length - 1) goTo(current + 1);
      else if (dx >= w * 0.22 && current > 0) goTo(current - 1);
      else applyTrack(current, 0); // 回弹
    } else if (g.current.mode === 'pan') {
      const [nx, ny] = clampPan(scale, tx, ty);
      setTx(nx); setTy(ny);
    }
    g.current.mode = null;
  };

  // ===== 鼠标（电脑端：双击缩放 / 滚轮缩放 / 拖拽平移）=====
  const onWheel = (e) => {
    const ns = clamp(scale * (e.deltaY < 0 ? 1.12 : 0.89), 1, 5);
    setScale(ns);
    if (ns === 1) { setTx(0); setTy(0); }
    else { const [nx, ny] = clampPan(ns, tx, ty); setTx(nx); setTy(ny); }
  };
  const onMouseDown = (e) => {
    if (scale > 1) {
      g.current.mouseDown = true;
      g.current.startX = e.clientX; g.current.startY = e.clientY;
      g.current.startTx = tx; g.current.startTy = ty;
    }
  };
  const onMouseMove = (e) => {
    if (g.current.mouseDown && scale > 1) {
      const [nx, ny] = clampPan(scale, g.current.startTx + (e.clientX - g.current.startX), g.current.startTy + (e.clientY - g.current.startY));
      setTx(nx); setTy(ny);
    }
  };
  const onMouseUp = () => { g.current.mouseDown = false; };

  const activeTransform = `translate(${tx}px, ${ty}px) scale(${scale})`;

  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden" style={{ touchAction: 'none' }}>
      {/* 顶部导航 */}
      <div className="fixed top-0 left-0 right-0 z-30 flex items-center justify-between px-4 pt-3 pb-6 bg-gradient-to-b from-black/70 to-transparent">
        {onClose ? (
          <button onClick={onClose}
            className="w-9 h-9 rounded-full bg-black/30 flex items-center justify-center text-white/90 text-xl">×</button>
        ) : (
          <button onClick={() => window.history.length > 1 ? window.history.back() : (window.location.href = window.location.origin + '/home')}
            className="w-9 h-9 rounded-full bg-black/30 flex items-center justify-center text-white/90 text-lg">‹</button>
        )}
        <div className="text-center flex-1">
          <div className="text-sm font-medium truncate">{subtitle || title}</div>
          <div className="text-[10px] text-white/50 mt-0.5">{photos.length ? `${current + 1} / ${photos.length}` : ''}</div>
        </div>
        {!onClose && (
          <button onClick={share}
            className="w-9 h-9 rounded-full bg-black/30 flex items-center justify-center text-white/90 text-base">↗</button>
        )}
      </div>

      {/* 横向滑动灯箱：轨道 = photos.length 屏宽，每张 100% */}
      <div
        ref={trackRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onDoubleClick={(e) => toggleZoom(e.clientX, e.clientY)}
        className="h-screen w-full flex"
        style={{ transform: `translateX(-${current * 100}vw)`, transition: animating ? 'transform 0.32s cubic-bezier(0.22,0.61,0.36,1)' : 'none', willChange: 'transform' }}
      >
        {photos.length === 0 && (
          <div className="h-screen w-screen flex items-center justify-center text-white/50">该相册暂未添加照片</div>
        )}
        {photos.map((p, i) => (
          <div key={i} className="h-screen w-screen flex-shrink-0 flex items-center justify-center bg-black relative" style={{ overflow: 'hidden' }}>
            <img
              src={img(p, 'preview')}
              alt=""
              draggable={false}
              loading={i <= 1 ? 'eager' : 'lazy'}
              style={{
                maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
                transform: i === current ? activeTransform : 'none',
                transition: (g.current.mode === 'swipe' || g.current.mode === 'pinch' || g.current.mode === 'pan' || g.current.mouseDown) ? 'none' : 'transform 0.2s ease-out',
                cursor: scale > 1 ? 'grab' : 'default',
                userSelect: 'none', WebkitUserSelect: 'none'
              }}
            />
            {/* 首屏叠加：新人名字 + 分类 + 自定义文案模块 */}
            {i === 0 && (title || category || copy) && (
              <div className="absolute inset-x-0 bottom-0 px-6 pb-28 pt-24 bg-gradient-to-t from-black/80 via-black/20 to-transparent text-center pointer-events-none">
                {category && (
                  <span className="inline-block px-3 py-1 rounded-full border border-white/40 text-[11px] text-white/90 mb-3">
                    {category}
                  </span>
                )}
                {title && <div className="text-2xl font-semibold tracking-wide mb-3">{title}</div>}
                {copy && <div className="text-sm text-white/85 leading-relaxed max-w-md mx-auto whitespace-pre-line">{copy}</div>}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 进度指示（小圆点） */}
      {photos.length > 1 && (
        <div className="fixed top-1/2 right-2 z-20 -translate-y-1/2 flex flex-col gap-1.5">
          {photos.map((_, i) => (
            <span key={i} className={'block w-1.5 h-1.5 rounded-full ' + (i === current ? 'bg-white' : 'bg-white/30')} />
          ))}
        </div>
      )}

      {/* 底部品牌工具栏 */}
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-gradient-to-t from-black/90 to-transparent px-4 pt-8 pb-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            {brand_logo ? (
              <img src={img(brand_logo)} alt="" className="w-9 h-9 rounded-full object-cover border border-white/20 shrink-0" />
            ) : (
              <div className="w-9 h-9 rounded-full bg-brand/80 flex items-center justify-center text-white text-xs font-semibold shrink-0">YE</div>
            )}
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{brand_name || 'YEZHE WORKSHOP'}</div>
              {(brand_slogan || brand_intro) && <div className="text-[10px] text-white/55 truncate">{brand_slogan || brand_intro}</div>}
            </div>
          </div>
          <div className="flex items-center gap-5 shrink-0">
            <button onClick={togglePlay} className="flex flex-col items-center text-white/90">
              <span className="text-lg leading-none">{playing ? '❚❚' : '▶'}</span>
              <span className="text-[10px] mt-1">{playing ? '暂停' : '播放'}</span>
            </button>
            <button onClick={goMore} className="flex flex-col items-center text-brand-light">
              <span className="text-lg leading-none">＋</span>
              <span className="text-[10px] mt-1 text-white/90">更多</span>
            </button>
          </div>
        </div>
      </div>

      {/* 缩放提示（仅未缩放时） */}
      {scale === 1 && photos.length > 0 && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-24 z-20 text-[11px] text-white/40 pointer-events-none">
          左右滑动浏览 · 双指/双击放大
        </div>
      )}

      {/* 右下角常驻悬浮分享按钮（H5 点击弹窗，复制相册链接兜底）；overlay 模式已在外层提供分享入口，故隐藏 */}
      {!onClose && (
        <button onClick={() => setShowShare(true)}
          className="fixed bottom-28 right-4 z-50 flex items-center justify-center px-6 h-11 rounded-full bg-white text-neutral-900 text-sm font-semibold shadow-lg">
          分享
        </button>
      )}

      {/* 分享弹窗：复制相册链接 */}
      {showShare && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6" onClick={() => setShowShare(false)}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm text-neutral-900" onClick={(e) => e.stopPropagation()}>
            <div className="text-base font-semibold mb-1">分享电子相册</div>
            <div className="text-xs text-neutral-500 mb-4">复制链接后，可粘贴到微信 / 发送给亲友</div>
            <div className="text-xs text-neutral-400 break-all bg-neutral-100 rounded-lg p-3 mb-4 leading-relaxed">{window.location.href}</div>
            <button onClick={copyAlbumLink} className="w-full py-3 rounded-full bg-neutral-900 text-white text-sm font-semibold">复制相册链接</button>
            <button onClick={() => setShowShare(false)} className="w-full py-2 mt-2 text-xs text-neutral-400">取消</button>
          </div>
        </div>
      )}

      {/* 轻提示 */}
      {toast && (
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40 bg-black/80 text-white text-xs px-4 py-2.5 rounded-lg max-w-[80%] text-center">
          {toast}
        </div>
      )}
    </div>
  );
}
