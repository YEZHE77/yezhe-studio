import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import http, { img } from '../api.js';
import { useVisitorGate } from '../hooks/useVisitorGate.js';
import { VisitorBlockedView } from '../components/VisitorGateViews.jsx';

const TEAL = 'var(--brand-green)';
const PAGE_BG = '#f9f8f6'; // 与小程序首页底色一致

// 扁平风格 H5 客户首页 —— 结构与小程序 pages/index 完全一致
// 改动点（按需求）：
//  ① 分割线 →「作品展示」标题固定 100rpx(50px) 垂直外边距，仅露底色
//  ② 删除 GALLERY，作品展示下方居中新增浅灰小字 Works Exhibition
//  ③ 右下角悬浮按钮组 right:12px(24rpx) / bottom:50px(100rpx) / 间距12px(24rpx)
//  ④「查看品牌故事」相对按钮下移 20rpx(10px)
export default function Home() {
  const nav = useNavigate();
  const gate = useVisitorGate({ page: '/home', source: 'h5', needPassword: false });
  const [studio, setStudio] = useState({ name: '', logo: '', intro: '', contact: {} });
  const [categories, setCategories] = useState([]);
  const [activeCat, setActiveCat] = useState(0);
  const [works, setWorks] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [banners, setBanners] = useState([]);
  const reqRef = useRef(0);
  const [currentBanner, setCurrentBanner] = useState(0);
  const bannerRef = useRef(null);
  const bannerTimerRef = useRef(null);

  // 轮播图自动播放（与小程序 swiper 等效：interval 4000ms、circular、indicator-dots）
  useEffect(() => {
    if (banners.length <= 1) return;
    const start = () => {
      bannerTimerRef.current = setInterval(() => {
        setCurrentBanner((prev) => {
          const next = (prev + 1) % banners.length;
          return next;
        });
      }, 4000);
    };
    start();
    return () => clearInterval(bannerTimerRef.current);
  }, [banners.length]);

  useEffect(() => {
    if (bannerRef.current) {
      bannerRef.current.scrollTo({
        left: currentBanner * bannerRef.current.clientWidth,
        behavior: 'smooth'
      });
    }
  }, [currentBanner]);
  const [storyOpen, setStoryOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [showServiceQr, setShowServiceQr] = useState(false);
  const [toast, setToast] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [syncing, setSyncing] = useState(true);

  // 异步加载作品，返回 Promise 供首次同步状态聚合
  const loadWorksAsync = (p, cat, reset) => {
    return new Promise((resolve) => {
      if (loading) { resolve(); return; }
      setLoading(true);
      const params = ['page=' + p, 'pageSize=8'];
      if (cat) params.push('category=' + cat);
      const myReq = ++reqRef.current;
      http.get('/api/works/public?' + params.join('&'))
        .then((r) => {
          if (myReq !== reqRef.current) return;
          const data = r.data || {};
          const items = (data.items || []).map((w) => ({ ...w, cover: img(w.cover_url || '', 'thumb') }));
          setWorks((prev) => (reset ? items : prev.concat(items)));
          setPage(p);
          setHasMore(items.length < (data.total || 0));
        })
        .catch(() => {})
        .finally(() => { setLoading(false); resolve(); });
    });
  };

  const loadWorks = (p, cat, reset) => { loadWorksAsync(p, cat, reset); };

  useEffect(() => {
    let mounted = true;
    setSyncing(true);
    const fetchStudio = http.get('/api/settings/studio').then((r) => {
      if (!mounted) return;
      const s = r.data || {};
      setStudio(s);
      const hero = (s.heroImages || []).map((u) => img(u, 'thumb')).filter(Boolean);
      if (hero.length) setBanners(hero);
    }).catch(() => {});
    const fetchCats = http.get('/api/categories').then((r) => {
      if (!mounted) return;
      setCategories(r.data || []);
    }).catch(() => {});
    Promise.all([fetchStudio, fetchCats, loadWorksAsync(1, 0, true)]).finally(() => {
      if (mounted) setSyncing(false);
    });
    return () => { mounted = false; };
  }, []);

  const selectCat = (id) => {
    if (id === activeCat) return;
    setActiveCat(id);
    setWorks([]);
    setHasMore(true);
    loadWorks(1, id, true);
  };

  const loadMore = () => { if (hasMore && !loading) loadWorks(page + 1, activeCat, false); };

  const copyWechat = () => {
    const w = studio.contact && studio.contact.wechat;
    if (!w) { setToast('未配置微信号'); return; }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(w).then(() => setToast('已复制微信号')).catch(() => setToast('微信号：' + w));
    } else {
      setToast('微信号：' + w);
    }
  };

  const callPhone = () => {
    const p = studio.contact && studio.contact.phone;
    if (p) window.location.href = 'tel:' + p;
  };

  // 抽屉菜单：滚动到指定区块（H5 公共端无独立作品/套系页，作品/联系滚动到对应区块）
  const scrollTo = (id) => {
    setDrawerOpen(false);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  if (gate.status === 'blocked') return <VisitorBlockedView />;

  return (
    <div className="min-h-screen" style={{ background: PAGE_BG, color: '#2c2c2c' }}>
      {/* 顶部白色自定义导航栏：左侧头像 + 品牌名，右侧小程序胶囊栏（··· ⊙） */}
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center h-11 px-3 bg-white text-[#2c2c2c]">
        <div className="flex items-center min-w-0">
          <div className="mr-2 h-8 w-8 shrink-0 overflow-hidden rounded-full bg-[#333]">
            {studio.logo ? (
              <img src={img(studio.logo, 'thumb')} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-xs text-white">{(studio.name || '')[0]}</span>
            )}
          </div>
          <span className="truncate text-[17px] tracking-[1px]">{studio.name || ''}</span>
        </div>
        {/* 右侧小程序胶囊栏：··· ⊙（··· 打开抽屉菜单，⊙ 返回顶部） */}
        <div className="ml-auto flex h-[22px] items-center rounded-full border border-gray-200 bg-white px-[6px]">
          <button onClick={() => setDrawerOpen(true)} className="flex items-center gap-[2px] pr-[6px]" aria-label="菜单">
            <span className="block h-[3px] w-[3px] rounded-full bg-[#2c2c2c]"></span>
            <span className="block h-[3px] w-[3px] rounded-full bg-[#2c2c2c]"></span>
            <span className="block h-[3px] w-[3px] rounded-full bg-[#2c2c2c]"></span>
          </button>
          <div className="h-[12px] w-px bg-gray-200" />
          <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="flex h-[14px] w-[14px] items-center justify-center pl-[6px]" aria-label="返回顶部">
            <span className="block h-[10px] w-[10px] rounded-full border-[1.5px] border-[#2c2c2c]" />
          </button>
        </div>
      </div>
      <div className="h-11" />

      {/* 首次进入同步提示：完成后自动消失 */}
      {syncing && (
        <div className="flex items-center justify-center gap-2 bg-[#f9f8f6] py-1.5 text-xs text-gray-400">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border border-gray-300 border-t-[var(--brand-green)]" />
          正在同步 C 端内容…
        </div>
      )}

      {/* 顶部轮播 Banner：自动播放 / 指示器 / 循环，与小程序 swiper 一致 */}
      <div className="relative w-full aspect-[16/9] overflow-hidden">
        {banners.length ? (
          <>
            <div ref={bannerRef} className="flex h-full overflow-x-auto snap-x snap-mandatory scroll-smooth" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
              {banners.map((b, i) => (
                <img key={i} src={b} alt="" className="h-full w-full flex-shrink-0 object-cover snap-center" />
              ))}
            </div>
            {/* 指示器 */}
            <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-2">
              {banners.map((_, i) => (
                <span
                  key={i}
                  className={`block h-2 w-2 rounded-full transition-all duration-300 ${i === currentBanner ? 'bg-white' : 'bg-white/50'}`}
                  style={{ width: i === currentBanner ? 16 : 8 }}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center" style={{ background: '#111', color: '#fff' }}>
            <div className="text-2xl tracking-[10px] opacity-90">YEZHE STUDIO</div>
            <div className="mt-4 text-sm tracking-[4px] opacity-60">海口婚礼 / 人像摄影</div>
          </div>
        )}
      </div>

      {/* 品牌简介（扁平流式：间距全部用 margin，禁止容器 padding 制造空白） */}
      <div className="mt-[25px] px-5 sm:px-8 text-center">
        {studio.logo && (
          <div className="mx-auto h-[120px] w-[120px] overflow-hidden rounded-full border border-gray-200 bg-gray-100">
            <img src={img(studio.logo, 'thumb')} alt="" className="h-full w-full object-cover" />
          </div>
        )}
        <div className="mt-4 text-2xl tracking-[4px]">{studio.name || ''}</div>
        {studio.address && (
          <div className="mt-2 flex items-center justify-center text-xs text-gray-400">
            <span className="mr-1">📍</span>{studio.address}
          </div>
        )}
        {studio.slogan && (
          <div className="mt-2 text-xs leading-relaxed text-gray-400">{studio.slogan}</div>
        )}
        <div className="mt-4 flex justify-center gap-3">
          <button onClick={() => setContactOpen(true)} className="h-[44px] min-w-[120px] rounded-lg text-sm" style={{ background: TEAL, color: '#fff' }}>
            预约咨询
          </button>
          <button onClick={copyWechat} className="h-[44px] min-w-[120px] rounded-lg border-2 text-sm" style={{ background: '#fff', color: TEAL, borderColor: TEAL }}>
            + 关注
          </button>
        </div>
        <div className="mb-8 mt-[22px] cursor-pointer text-sm" style={{ color: TEAL }} onClick={() => setStoryOpen(true)}>
          查看品牌故事 &gt;
        </div>
      </div>

      {/* 资料区块结束后的浅灰色分割线（高度 8rpx=4px，通栏） */}
      <div className="h-1 w-full bg-gray-100" />

      {/* 作品展示 —— 与上方分割线之间固定 100rpx(50px) 垂直外边距，仅露底色 */}
      <div id="gallery-section" className="mt-[50px] px-5 sm:px-8">
        <div className="text-center text-2xl tracking-[4px]">作品展示</div>
        <div className="mt-1 text-center text-xs tracking-[2px] text-gray-400">Works Exhibition</div>

        {/* 分类标签横滑 */}
        <div className="mt-4 overflow-x-auto whitespace-nowrap">
          <div className="inline-flex gap-6 pb-4">
            <button onClick={() => selectCat(0)} className={'relative pb-2 text-base ' + (activeCat === 0 ? 'text-[#2c2c2c]' : 'text-gray-400')}>
              全部
              {activeCat === 0 && <span className="absolute -bottom-0.5 left-0 right-0 h-1 rounded bg-[var(--brand-green)]" />}
            </button>
            {categories.filter(Boolean).map((c) => (
              <button key={c.id} onClick={() => selectCat(c.id)} className={'relative pb-2 text-base ' + (activeCat === c.id ? 'text-[#2c2c2c]' : 'text-gray-400')}>
                {c.name || '未命名'}
                {activeCat === c.id && <span className="absolute -bottom-0.5 left-0 right-0 h-1 rounded bg-[var(--brand-green)]" />}
              </button>
            ))}
          </div>
        </div>

        {/* 作品网格：两列瀑布流，封面统一 7:5 横版，标题/标签在图片下方（与小程序一致） */}
        <div className="flex flex-wrap -mx-1.5">
          {works.map((w) => (
            <div key={w.id} onClick={() => nav('/w/' + w.id)} className="mb-4 ml-1.5 mr-1.5 w-[calc(50%-12px)] overflow-hidden rounded-2xl bg-gray-100" style={{ borderRadius: '16px' }}>
              <div className="relative w-full overflow-hidden bg-gray-100" style={{ paddingBottom: '71.43%' }}>
                {w.cover ? (
                  <img src={w.cover} alt="" loading="lazy" className="absolute top-0 left-0 w-full h-full object-cover"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center bg-gray-200">
                    <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="#ccc" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="9" cy="9" r="2" />
                      <path d="M21 15l-5-5L5 21" />
                    </svg>
                  </div>
                )}
                {w.live && (
                  <span className="absolute right-2 top-2 rounded px-2 py-1 text-[10px] text-white" style={{ background: 'rgba(126,204,187,0.95)' }}>图片直播</span>
                )}
              </div>
              <div className="p-3">
                <div className="truncate text-sm font-medium text-[#333]">{(w.customer_name || w.title) || ''}</div>
                <div className="mt-1 text-xs text-gray-400">#{w.category_name || '作品'}</div>
              </div>
            </div>
          ))}
        </div>

        {works.length === 0 && !loading && !syncing && (
          <div className="py-16 text-center">
            <div className="text-sm text-gray-400">暂无作品</div>
            <div className="mt-2 text-xs text-gray-300">请在「作品管理」中发布作品并设为公开</div>
          </div>
        )}
        {works.length > 0 && hasMore && (
          <button onClick={loadMore} className="mx-auto mt-8 block h-[44px] w-[200px] rounded-lg border border-gray-300 text-sm text-gray-500">MORE</button>
        )}
        {works.length > 0 && !hasMore && <div className="mt-8 text-center text-sm text-gray-300">— 没有更多了 —</div>}
      </div>

      {/* 底部联系卡片：左侧信息 + 居中添加客服 + 右侧悬浮浮层按钮组（关注/预约/我的）+ 底部 slogan */}
      <div id="footer-section" className="relative m-4 mt-[70px] rounded-2xl p-5 text-white sm:m-8 sm:rounded-3xl sm:p-8" style={{ background: '#2c2c2c' }}>
        <div style={{ textAlign: 'center', fontSize: 19, fontWeight: 400, letterSpacing: 4, marginBottom: 20 }}>联系我们</div>
        {/* 信息行：右侧预留 60px 给悬浮按钮，不被遮挡 */}
        <div style={{ paddingRight: 60 }}>
          {studio.contact && studio.contact.wechat && (
            <div style={{ display: 'flex', alignItems: 'center', fontSize: 13, marginBottom: 10, gap: 8 }}>
              <span style={{ width: 36, color: '#aaa', flexShrink: 0 }}>微信</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14 }}>{studio.contact.wechat}</span>
              <span style={{ color: '#7ecdbb', fontSize: 12, cursor: 'pointer', flexShrink: 0 }} onClick={copyWechat}>复制</span>
            </div>
          )}
          {studio.contact && studio.contact.phone && (
            <div style={{ display: 'flex', alignItems: 'center', fontSize: 13, marginBottom: 10, gap: 8 }}>
              <span style={{ width: 36, color: '#aaa', flexShrink: 0 }}>电话</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14 }}>{studio.contact.phone}</span>
            </div>
          )}
          {studio.contact && studio.contact.address && (
            <div style={{ display: 'flex', alignItems: 'center', fontSize: 13, marginBottom: 0, gap: 8 }}>
              <span style={{ width: 36, color: '#aaa', flexShrink: 0 }}>地址</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14 }}>{studio.contact.address}</span>
            </div>
          )}
        </div>
        {/* 添加客服按钮：居中 */}
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
          <button onClick={() => setShowServiceQr(true)}
            style={{ padding: '7px 22px', borderRadius: 22, border: '1px solid #7ecdbb', color: '#7ecdbb', fontSize: 14, background: 'transparent', display: 'flex', alignItems: 'center', gap: 4 }}>
            添加客服 <span style={{ fontSize: 10 }}>&gt;</span>
          </button>
        </div>
        <div style={{ textAlign: 'center', fontSize: 11, color: '#888', marginTop: 16 }}>{studio.slogan || '记录婚礼，也记录爱发生的样子'}</div>

        {/* 右侧悬浮浮层按钮组：绝对定位浮在卡片表面右缘（紧贴，视觉叠在卡片上） */}
        <div className="absolute flex flex-col items-center" style={{ right: -4, top: 52, gap: 8 }}>
          {/* 关注：白底 + 空心爱心灰 + 文字灰 */}
          <button onClick={copyWechat}
            style={{ width: 44, height: 44, borderRadius: '50%', background: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: 9, boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }} aria-label="关注">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
              <path d="M12 20.3l-1.45-1.32C5.4 14.24 2 11.16 2 7.5 2 4.42 4.42 2 7.5 2c1.74 0 3.41.81 4.5 2.09C13.09 2.81 14.76 2 16.5 2 19.58 2 22 4.42 22 7.5c0 3.66-3.4 6.74-8.55 11.49L12 20.3z" />
            </svg>
            <span style={{ marginTop: 1, fontSize: 9 }}>关注</span>
          </button>
          {/* 预约：青绿底 + 白色对话气泡(三点) + 文字白 */}
          <button onClick={() => setContactOpen(true)}
            style={{ width: 44, height: 44, borderRadius: '50%', background: '#7ecdbb', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, boxShadow: '0 2px 8px rgba(96,196,170,0.35)' }} aria-label="预约">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
              <path d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-4 3v-3H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
              <circle cx="9" cy="11" r="1" fill="currentColor" stroke="none" />
              <circle cx="12" cy="11" r="1" fill="currentColor" stroke="none" />
              <circle cx="15" cy="11" r="1" fill="currentColor" stroke="none" />
            </svg>
            <span style={{ marginTop: 1, fontSize: 9 }}>预约</span>
          </button>
          {/* 我的：白底 + 灰色人形轮廓 + 文字灰 */}
          <button onClick={() => nav('/my')}
            style={{ width: 44, height: 44, borderRadius: '50%', background: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: 9, boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }} aria-label="我的">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <circle cx="12" cy="8" r="3.2" />
              <path d="M5 20a7 7 0 0 1 14 0" />
            </svg>
            <span style={{ marginTop: 1, fontSize: 9 }}>我的</span>
          </button>
        </div>
      </div>

      {/* 提示 / 弹层 */}
      {toast && <div className="fixed left-1/2 top-20 z-50 -translate-x-1/2 rounded bg-black/70 px-4 py-2 text-xs text-white">{toast}</div>}

      {contactOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setContactOpen(false)}>
          <div className="max-w-md w-full rounded-t-2xl bg-white p-6 text-[#2c2c2c]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 text-center text-lg">预约咨询</div>
            {studio.contact && studio.contact.wechat && (
              <div className="flex items-center justify-between border-b py-3">
                <span className="text-gray-500">微信</span><span>{studio.contact.wechat}</span>
                <span className="cursor-pointer" style={{ color: TEAL }} onClick={copyWechat}>复制</span>
              </div>
            )}
            {studio.contact && studio.contact.phone && (
              <div className="flex items-center justify-between py-3">
                <span className="text-gray-500">电话</span><span>{studio.contact.phone}</span>
                <span className="cursor-pointer" style={{ color: TEAL }} onClick={callPhone}>拨打</span>
              </div>
            )}
            <button onClick={() => setContactOpen(false)} className="mt-4 w-full rounded-lg py-3 text-sm text-white" style={{ background: TEAL }}>关闭</button>
          </div>
        </div>
      )}

      {storyOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setStoryOpen(false)}>
          <div className="max-h-[70vh] max-w-md w-full overflow-auto rounded-t-2xl bg-white p-6 text-[#2c2c2c]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 text-center text-lg">品牌故事</div>
            <div className="whitespace-pre-line text-sm leading-relaxed text-gray-600">{studio.intro || '用影像记录时光。'}</div>
            <button onClick={() => setStoryOpen(false)} className="mt-4 w-full rounded-lg py-3 text-sm text-white" style={{ background: TEAL }}>关闭</button>
          </div>
        </div>
      )}

      {/* 客服二维码弹窗 */}
      {showServiceQr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowServiceQr(false)}>
          <div className="max-w-xs w-full rounded-2xl bg-white p-6 text-center text-[#2c2c2c]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 text-lg font-medium">添加客服</div>
            {studio.serviceQr ? (
              <>
                <img src={img(studio.serviceQr)} alt="客服微信" className="mx-auto w-48 h-48 object-contain rounded-lg" />
                <p className="mt-3 text-xs text-gray-500">长按二维码识别添加客服微信</p>
              </>
            ) : (
              <div className="py-8 text-sm text-gray-400">暂未配置客服二维码<br />请在 B 端「资料设置」中上传</div>
            )}
            <button onClick={() => setShowServiceQr(false)} className="mt-4 w-full rounded-lg py-2.5 text-sm text-white" style={{ background: TEAL }}>关闭</button>
          </div>
        </div>
      )}

      {/* 侧边抽屉菜单（右侧滑出，与小程序一致） */}
      <div className="fixed inset-0 z-[60] pointer-events-none">
        <div
          className={'absolute inset-0 bg-black/45 transition-opacity duration-300 ' + (drawerOpen ? 'opacity-100' : 'opacity-0')}
          style={{ pointerEvents: drawerOpen ? 'auto' : 'none' }}
          onClick={() => setDrawerOpen(false)}
        />
        <div className={'absolute top-0 right-0 bottom-0 w-[280px] bg-white text-[#2c2c2c] flex flex-col transition-transform duration-300 ' + (drawerOpen ? 'translate-x-0' : 'translate-x-full')}>
          <div className="px-6 py-6 border-b border-gray-100 flex items-center">
            <span className="text-base truncate">{studio.name || ''}</span>
          </div>
          <nav className="flex-1">
            <button onClick={() => { setDrawerOpen(false); nav('/home'); }} className="w-full text-left px-6 py-4 border-b border-gray-100">主页</button>
            <button onClick={() => scrollTo('gallery-section')} className="w-full text-left px-6 py-4 border-b border-gray-100">作品</button>
            <button onClick={() => { setDrawerOpen(false); nav('/package-center'); }} className="w-full text-left px-6 py-4 border-b border-gray-100">套系</button>
            <button onClick={() => { setDrawerOpen(false); nav('/customer/mine'); }} className="w-full text-left px-6 py-4 border-b border-gray-100">我的</button>
            <button onClick={() => scrollTo('footer-section')} className="w-full text-left px-6 py-4 border-b border-gray-100">联系我们</button>
          </nav>
        </div>
      </div>
    </div>
  );
}
