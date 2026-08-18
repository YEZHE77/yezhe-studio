import React, { useState, useEffect, useRef } from 'react';
import { img } from '../api.js';
import GalleryAlbum from './GalleryAlbum.jsx';

const TEAL = 'var(--brand-green)';
const MRED = '#FA5151';
const MGRAY = '#999999';
const MBORDER = '#F0F0F0';

// 幻灯片背景音乐：留空则使用前端本地打包的默认 BGM（public/bgm/bgm.mp3，
// 默认曲《Kiss The Rain - Yiruma》）。如需自有曲子，可在此填真实 HTTPS URL
// （建议上传 MP3 至 R2 私有桶，通过 yezhe-img-proxy.yezhe128627.workers.dev 代理；
// 小程序端需在微信公众平台 downloadFile 合法域名添加该域名）。
const BGM_URL = '';
const bgmSrc = BGM_URL || '/bgm/bgm.mp3';

// 客片电子相册 —— 视觉/交互对齐「后端预览（WorkPreview）小程序风」+ 参照歪猫公社小程序：
// 浅色底 + 原比例封面（横版/竖版/方版均按图本身比例 100% 宽自适应）+ 顶部渐变悬浮导航 + 信息区 + 照片「单列大图纵向滑动（默认）↔ 2列 multi-column（DOM顺序=后台排序，列内紧贴2px无大量空白）」切换 +
// 底部品牌栏（头像+品牌名/Slogan 上下结构 ｜ 播放 ｜ 预约服务，两道竖线分隔，参照歪猫底部分隔感）；
// 「播放」按钮独立跳转黑底幻灯片（3s 自动轮播 + 暂停 + 进度点 + BGM）。
// 保留 C 端全部真实功能：分享(微信/朋友圈/二维码)、投屏、预约、全屏查看、返回。
export default function AlbumGrid({ gallery, onBack, albumId }) {
  const { title, subtitle, category, albumCopy, cover_url, photos = [], brand_name, brand_slogan, brand_intro, brand_logo, views } = gallery;
  const [view, setView] = useState('single'); // single 单列大图纵向滑动（默认） | grid 网格总览
  const [full, setFull] = useState(-1);     // >=0 打开全屏查看的起始索引
  const [toast, setToast] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  // 幻灯片：独立黑底播放 + BGM
  const [slideOpen, setSlideOpen] = useState(false);
  const [slideIdx, setSlideIdx] = useState(0);
  const [slidePaused, setSlidePaused] = useState(false);
  const slideTimerRef = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => {
    if (toast) return;
    const t = setTimeout(() => setToast(''), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  // 幻灯片自动轮播（3s）
  useEffect(() => {
    if (!slideOpen || slidePaused || photos.length < 2) {
      if (slideTimerRef.current) { clearInterval(slideTimerRef.current); slideTimerRef.current = null; }
      return;
    }
    slideTimerRef.current = setInterval(() => setSlideIdx((i) => (i + 1) % photos.length), 3000);
    return () => { if (slideTimerRef.current) clearInterval(slideTimerRef.current); };
  }, [slideOpen, slidePaused, photos.length]);

  // 幻灯片 BGM：打开播放 / 暂停暂停 / 关闭停止
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !slideOpen) return;
    if (slidePaused) {
      audio.pause();
    } else {
      audio.play().catch(() => {});
    }
    return () => { audio.pause(); };
  }, [slideOpen, slidePaused]);

  // 退出页面：停止轮播与音乐
  useEffect(() => {
    return () => {
      if (slideTimerRef.current) { clearInterval(slideTimerRef.current); slideTimerRef.current = null; }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current = null;
      }
    };
  }, []);

  const cover = cover_url || photos[0] || '';

  const ensureAudio = () => {
    if (audioRef.current) return audioRef.current;
    try {
      const a = new Audio(bgmSrc);
      a.loop = true;
      audioRef.current = a;
      // 在用户手势内先尝试播放（iOS 需要解锁音频）
      a.play().catch(() => {});
    } catch { /* 忽略音频初始化失败 */ }
    return audioRef.current;
  };

  const startSlide = () => {
    if (!photos.length) return;
    ensureAudio();
    setSlideIdx(0);
    setSlidePaused(false);
    setSlideOpen(true);
  };
  const stopSlide = () => {
    setSlideOpen(false);
    setSlidePaused(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  };

  const goBack = () => {
    if (onBack) { onBack(); return; }
    if (window.history.length > 1) window.history.back();
    else window.location.href = window.location.origin + '/';
  };

  // 分享弹窗：微信好友/朋友圈（H5 受浏览器限制，引导在微信内操作）；下载二维码（扫码直达相册）
  const shareUrl = (typeof window !== 'undefined')
    ? (albumId ? window.location.origin + '/w/' + albumId : window.location.href)
    : '';
  const openShare = () => setShareOpen(true);
  const closeShare = () => setShareOpen(false);
  // 分享文案：固定话术 + 真实链接替换（）内文字（与订单分享默认备注同款口径）
  const shareNote = `这是我们团队开发的软件，此链接为专属访问地址，受微信环境限制，请复制链接（${shareUrl}），在手机浏览器打开查看详情。`;
  const copyShareNote = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(shareNote);
      } else {
        const ta = document.createElement('textarea');
        ta.value = shareNote;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setToast('分享文案已复制，可粘贴发送给客户');
    } catch {
      setToast('复制失败，请手动长按复制');
    }
    setShareOpen(false);
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
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (typeof window !== 'undefined') window.scrollTo({ top: lastTop, behavior: 'auto' });
      }, 50);
    });
  };

  return (
    <div className="min-h-screen bg-white" style={{ minHeight: '100vh', paddingBottom: 'calc(70px + env(safe-area-inset-bottom))' }}>
      {/* 顶部渐变悬浮导航：左侧返回，右侧分享 */}
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-3"
        style={{ paddingTop: 'calc(8px + env(safe-area-inset-top))', paddingBottom: 8, background: 'linear-gradient(to bottom, rgba(0,0,0,0.35), transparent)' }}>
        <button onClick={goBack} style={{ background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <button onClick={openShare} aria-label="分享" style={{ width: 32, height: 32, borderRadius: '50%', background: MRED, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
        </button>
      </div>

      {/* 封面：原比例适配显示（横版/竖版/方版均按图本身比例，宽 100%、高 auto；极端长竖图以 85vh 兜底，contain 居中不裁切） */}
      <div className="w-full" style={{ background: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', maxHeight: '85vh', overflow: 'hidden' }}>
        {cover ? (
          <img src={img(cover)} alt="" style={{ width: '100%', height: 'auto', maxHeight: '85vh', objectFit: 'contain', display: 'block' }} />
        ) : (
          <div style={{ width: '100%', height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: 14 }}>暂无封面</div>
        )}
      </div>

      {/* 信息区：标题（右侧同排 列表/宫格 切换按钮）+ 标题下方标签 + 文案 */}
      <div style={{ padding: '16px 16px 4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ fontSize: 18, color: '#1f2329', lineHeight: 1.4, fontWeight: 600, flex: 1, minWidth: 0 }}>{title || '作品相册'}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <button onClick={() => switchView('single')} aria-pressed={view === 'single'} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 16, border: 'none', fontSize: 12, lineHeight: 1, background: view === 'single' ? '#1f2329' : '#f5f5f5', color: view === 'single' ? '#fff' : '#666' }}>
              ☰ 列表
            </button>
            <button onClick={() => switchView('grid')} aria-pressed={view === 'grid'} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 16, border: 'none', fontSize: 12, lineHeight: 1, background: view === 'grid' ? '#1f2329' : '#f5f5f5', color: view === 'grid' ? '#fff' : '#666' }}>
              ▦ 宫格
            </button>
          </div>
        </div>
        {category && (
          <span style={{ marginTop: 8, display: 'inline-block', fontSize: 12, color: MGRAY, background: '#f5f5f5', padding: '3px 10px', borderRadius: 4 }}>{category}</span>
        )}
        {albumCopy && (
          <div style={{ marginTop: 12, fontSize: 14, color: '#555', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{albumCopy}</div>
        )}
        {typeof views === 'number' && views > 0 && (
          <div style={{ marginTop: 8, fontSize: 11, color: '#bbb' }}>已被浏览 {views} 次</div>
        )}
      </div>

      {/* 照片区：参照歪猫小程序——2列不等高规则网格/单列大图纵向滑动（无小标题） */}
      <div style={{ padding: '8px 0 20px' }}>
        {view === 'grid' ? (
          // 网格总览：2 列 CSS multi-column（DOM 顺序严格 = photos = 后台排序，未被重排；列内紧贴 2px 无大量空白；div 容器避免 button UA 灰底）
          <div style={{ columnCount: 2, columnGap: 2 }}>
            {photos.map((p, i) => (
              <div key={i} role="button" tabIndex={0} onClick={() => setFull(i)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFull(i); } }} style={{ display: 'block', width: '100%', padding: 0, border: 'none', borderRadius: 0, overflow: 'hidden', marginBottom: 2, background: '#f5f5f5', cursor: 'pointer', breakInside: 'avoid' }}>
                <img src={img(p, 'thumb')} alt="" style={{ width: '100%', height: 'auto', display: 'block' }} loading="lazy" />
              </div>
            ))}
          </div>
        ) : (
          // 单列大图纵向滑动（默认）：整张铺满屏宽、原图直角、照片间距 2px、横竖版自适应；div 容器避免 button UA 灰底
          <div>
            {photos.map((p, i) => (
              <div key={i} role="button" tabIndex={0} onClick={() => setFull(i)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFull(i); } }} style={{ display: 'block', width: '100%', padding: 0, border: 'none', borderRadius: 0, overflow: 'hidden', marginBottom: 2, background: '#f5f5f5', cursor: 'pointer' }}>
                <img src={img(p, 'preview')} alt="" style={{ width: '100%', height: 'auto', display: 'block' }} loading="lazy" />
              </div>
            ))}
          </div>
        )}
        {!photos.length && <div style={{ textAlign: 'center', color: '#999', fontSize: 14, padding: '48px 0' }}>该相册暂未添加照片</div>}
      </div>

      {/* 底部品牌栏（白底，后端预览同款） */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white flex items-center justify-between px-4"
        style={{ borderTop: '1px solid ' + MBORDER, paddingTop: 10, paddingBottom: 'calc(10px + env(safe-area-inset-bottom))' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          {brand_logo ? (
            <img src={img(brand_logo)} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', background: '#f2f2f2', flexShrink: 0 }} />
          ) : (
            <div style={{ width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 600, flexShrink: 0, background: TEAL }}>YE</div>
          )}
          {/* 品牌名 + Slogan 上下结构（参照歪猫底部） */}
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1 }}>
            <div style={{ fontSize: 13, color: '#333', fontWeight: 600, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{brand_name || 'YEZHE STUDIO'}</div>
            {(brand_slogan || brand_intro) && (
              <div style={{ fontSize: 10, color: MGRAY, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{brand_slogan || brand_intro}</div>
            )}
          </div>
        </div>
        {/* 竖线分隔线：品牌区与操作区之间（参照歪猫/picbling 底部） */}
        <div style={{ width: 1, height: 26, background: MBORDER, flexShrink: 0, marginRight: 16 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexShrink: 0 }}>
          <button onClick={startSlide} disabled={!photos.length} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, background: 'none', border: 'none', color: photos.length ? '#666' : '#ccc', minWidth: 44 }}>
            <span style={{ fontSize: 17, lineHeight: 1 }}>▶</span>
            <span style={{ fontSize: 10, marginTop: 2 }}>播放</span>
          </button>
          {/* 竖线分隔线：播放与预约服务之间 */}
          <div style={{ width: 1, height: 22, background: MBORDER, margin: '0 12px' }} />
          <button onClick={goAppointment} style={{ height: 34, padding: '0 14px', borderRadius: 8, border: 'none', background: MRED, color: '#fff', fontSize: 14 }}>
            预约服务
          </button>
        </div>
      </div>

      {/* 幻灯片：独立黑底播放 + BGM（3s 自动轮播 / 暂停 / 进度点 / 计数） */}
      {slideOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: '#000' }}>
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px', paddingTop: 'calc(12px + env(safe-area-inset-top))',
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.55), transparent)'
          }}>
            <button onClick={stopSlide} style={{ background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <span style={{ color: '#fff', fontSize: 13 }}>{slideIdx + 1} / {photos.length}</span>
            <button onClick={() => setSlidePaused(!slidePaused)} style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13 }}>
              {slidePaused ? '▶' : '❚❚'}
            </button>
          </div>
          <div onClick={() => setSlidePaused(!slidePaused)} style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            {photos.length ? (
              <img src={img(photos[slideIdx])} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            ) : (
              <span style={{ color: '#666', fontSize: 14 }}>暂无照片</span>
            )}
          </div>
          <div style={{ position: 'absolute', bottom: 'calc(24px + env(safe-area-inset-bottom))', left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 6 }}>
            {photos.map((_, i) => (
              <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: i === slideIdx ? '#fff' : 'rgba(255,255,255,0.35)', transition: 'background 0.2s' }} />
            ))}
          </div>
        </div>
      )}

      {/* 轻提示 */}
      {toast && (
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[60]" style={{ background: 'rgba(0,0,0,0.8)', color: '#fff', fontSize: 12, padding: '10px 16px', borderRadius: 8, maxWidth: '80%', textAlign: 'center' }}>
          {toast}
        </div>
      )}

      {/* 分享弹窗（底部滑入）：只保留复制分享文案（固定话术+链接） */}
      {shareOpen && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40" onClick={closeShare}>
          <div className="w-full max-w-md rounded-t-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 text-center text-base font-medium" style={{ color: '#2c2c2c' }}>分享相册</div>
            {/* 分享文案预览：链接已替换进括号 */}
            <div className="mb-5 max-h-40 overflow-auto rounded-lg p-3 text-xs leading-relaxed" style={{ background: '#f7f7f7', color: '#555', wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
              {shareNote}
            </div>
            <button onClick={copyShareNote} className="w-full rounded-lg py-3 text-sm text-white" style={{ background: MRED }}>
              复制分享文案
            </button>
            <button onClick={closeShare} className="mt-2 w-full rounded-lg bg-gray-100 py-3 text-sm text-gray-600">取消</button>
          </div>
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
