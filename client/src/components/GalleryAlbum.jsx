import React, { useState, useEffect, useRef } from 'react';
import { img } from '../api.js';

// 客片电子相册沉浸式页面（对应零屿 VISION 这类婚礼电子相册 H5）
// 全屏上下滑动浏览照片 + 新人名字/分类/专属文案 + 底部品牌工具栏（播放/投屏/查看更多）
export default function GalleryAlbum({ gallery }) {
  const { title, subtitle, category, blessing, photos = [], brand_name, brand_slogan, brand_logo } = gallery;
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [toast, setToast] = useState('');
  const [showShare, setShowShare] = useState(false);
  const scrollRef = useRef(null);
  const timerRef = useRef(null);
  const winH = typeof window !== 'undefined' ? window.innerHeight : 800;

  // 自动播放（幻灯片模式）：每隔 3.5s 滚动到下一张
  useEffect(() => {
    if (!playing || !photos.length) return;
    timerRef.current = setInterval(() => {
      const el = scrollRef.current;
      if (!el) return;
      const next = (Math.round(el.scrollTop / winH) + 1) % photos.length;
      el.scrollTo({ top: winH * next, behavior: 'smooth' });
    }, 3500);
    return () => clearInterval(timerRef.current);
  }, [playing, photos.length, winH]);

  useEffect(() => {
    const t = setTimeout(() => setToast(''), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) setCurrent(Math.round(el.scrollTop / winH));
  };

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

  const castScreen = () => {
    // H5 无标准投屏 API：引导用户使用系统级屏幕镜像
    showToast('请下拉/上滑手机控制中心 → 屏幕镜像 → 投屏到电视');
  };

  const goMore = () => {
    // 查看更多：返回工作室主页（H5 公开落地页首页）
    const base = window.location.origin;
    window.location.href = base + '/';
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

  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden">
      {/* 顶部导航 */}
      <div className="fixed top-0 left-0 right-0 z-30 flex items-center justify-between px-4 pt-3 pb-6 bg-gradient-to-b from-black/70 to-transparent">
        <button onClick={() => window.history.length > 1 ? window.history.back() : (window.location.href = window.location.origin + '/')}
          className="w-9 h-9 rounded-full bg-black/30 flex items-center justify-center text-white/90 text-lg">‹</button>
        <div className="text-center flex-1">
          <div className="text-sm font-medium truncate">{subtitle || title}</div>
        </div>
        <button onClick={share}
          className="w-9 h-9 rounded-full bg-black/30 flex items-center justify-center text-white/90 text-base">↗</button>
      </div>

      {/* 沉浸式上下滑动照片 */}
      <div ref={scrollRef} onScroll={onScroll}
        className="h-screen overflow-y-scroll snap-y snap-mandatory"
        style={{ scrollBehavior: 'smooth' }}>
        {photos.length === 0 && (
          <div className="h-screen flex items-center justify-center text-white/50">该相册暂未添加照片</div>
        )}
        {photos.map((p, i) => (
          <div key={i} className="h-screen w-full snap-start flex items-center justify-center bg-black relative">
            <img src={img(p)} alt="" className="max-w-full max-h-full object-contain" loading={i <= 1 ? 'eager' : 'lazy'} />
            {/* 首屏叠加：新人名字 + 分类 + 文案 */}
            {i === 0 && (title || category || blessing) && (
              <div className="absolute inset-x-0 bottom-0 px-6 pb-28 pt-24 bg-gradient-to-t from-black/80 via-black/20 to-transparent text-center">
                {category && (
                  <span className="inline-block px-3 py-1 rounded-full border border-white/40 text-[11px] text-white/90 mb-3">
                    {category}
                  </span>
                )}
                {title && <div className="text-2xl font-semibold tracking-wide mb-3">{title}</div>}
                {blessing && <div className="text-sm text-white/85 leading-relaxed max-w-md mx-auto">{blessing}</div>}
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
              {brand_slogan && <div className="text-[10px] text-white/55 truncate">{brand_slogan}</div>}
            </div>
          </div>
          <div className="flex items-center gap-5 shrink-0">
            <button onClick={() => setPlaying(!playing)} className="flex flex-col items-center text-white/90">
              <span className="text-lg leading-none">{playing ? '❚❚' : '▶'}</span>
              <span className="text-[10px] mt-1">{playing ? '暂停' : '播放'}</span>
            </button>
            <button onClick={castScreen} className="flex flex-col items-center text-white/90">
              <span className="text-lg leading-none">📺</span>
              <span className="text-[10px] mt-1">投屏</span>
            </button>
            <button onClick={goMore} className="flex flex-col items-center text-brand-light">
              <span className="text-lg leading-none">＋</span>
              <span className="text-[10px] mt-1 text-white/90">更多</span>
            </button>
          </div>
        </div>
      </div>

      {/* 右下角常驻悬浮分享按钮（H5 点击弹窗，复制相册链接兜底） */}
      <button onClick={() => setShowShare(true)}
        className="fixed bottom-28 right-4 z-50 flex items-center justify-center px-6 h-11 rounded-full bg-white text-neutral-900 text-sm font-semibold shadow-lg">
        分享
      </button>

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
