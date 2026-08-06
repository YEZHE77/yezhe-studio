import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import http, { img } from '../api.js';

const TEAL = '#7ecdbb';
const TEAL_DARK = '#5bbca8';
const CARD = '#faf8f3';
const PAGE_BG = '#f3f1ec';

export default function Home() {
  const nav = useNavigate();
  const [studio, setStudio] = useState({ name: '', logo: '', intro: '', address: '', contact: {} });
  const [banners, setBanners] = useState([]);
  const [categories, setCategories] = useState([]);
  const [activeCat, setActiveCat] = useState(0);
  const [works, setWorks] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [storyOpen, setStoryOpen] = useState(false);
  const reqRef = useRef(0);

  // 工作室信息（含轮播图）+ 分类
  useEffect(() => {
    http.get('/api/settings/studio').then((r) => {
      const s = r.data || {};
      setStudio(s);
      const hero = (s.heroImages || []).map((u) => img(u, 'thumb')).filter(Boolean);
      setBanners(hero);
    }).catch(() => {});
    http.get('/api/categories').then((r) => setCategories(r.data || [])).catch(() => {});
  }, []);

  // 作品列表
  const loadWorks = (reset) => {
    if (loading) return;
    setLoading(true);
    const p = reset ? 1 : page + 1;
    const params = ['page=' + p, 'pageSize=8'];
    if (activeCat) params.push('category=' + activeCat);
    const my = ++reqRef.current;
    http.get('/api/works/public?' + params.join('&')).then((r) => {
      if (my !== reqRef.current) return;
      const data = r.data || {};
      const items = (data.items || []).map((w) => ({ ...w, cover: img(w.cover_url, 'thumb') }));
      setWorks((prev) => (reset ? items : prev.concat(items)));
      setPage(p);
      setHasMore(items.length < (data.total || 0));
    }).catch(() => {}).finally(() => { if (my === reqRef.current) setLoading(false); });
  };

  useEffect(() => { loadWorks(true); /* eslint-disable-next-line */ }, [activeCat]);

  const selectCat = (id) => {
    if (id === activeCat) return;
    setActiveCat(id);
    setWorks([]);
    setPage(1);
    setHasMore(true);
  };

  const copyWechat = () => {
    const wxid = studio.contact?.wechat || 'yezhe-studio';
    if (navigator.clipboard) navigator.clipboard.writeText(wxid).then(() => alert('已复制微信号：' + wxid)).catch(() => {});
    else alert('微信号：' + wxid);
  };

  return (
    <div className="min-h-screen" style={{ background: PAGE_BG }}>
      {/* ① Banner 区块 */}
      <div className="px-3 pt-3">
        <div className="rounded-3xl overflow-hidden bg-black" style={{ boxShadow: '0 4px 18px rgba(0,0,0,0.04)' }}>
          {banners.length ? (
            <div className="flex overflow-x-auto snap-x snap-mandatory" style={{ scrollbarWidth: 'none' }}>
              {banners.map((b, i) => (
                <img key={i} src={b} alt="" className="w-full flex-shrink-0 snap-center h-52 object-cover" />
              ))}
            </div>
          ) : (
            <div className="h-52 flex flex-col items-center justify-center text-white" style={{ background: '#111' }}>
              <div className="text-lg tracking-[10px] opacity-90">YEZHE STUDIO</div>
              <div className="mt-4 text-sm opacity-60 tracking-[4px]">海口婚礼 / 人像摄影</div>
            </div>
          )}
        </div>
      </div>

      {/* ② 品牌介绍区块 */}
      <div className="px-3 mt-6">
        <div className="rounded-3xl p-9 text-center" style={{ background: CARD, boxShadow: '0 4px 18px rgba(0,0,0,0.04)' }}>
          {studio.logo && <img src={img(studio.logo, 'thumb')} alt="" className="w-28 h-28 rounded-full mx-auto object-cover border border-[#e5e5e5]" />}
          <div className="mt-4 text-2xl font-semibold tracking-[4px]" style={{ color: '#2c2c2c' }}>{studio.name || '叶哲 STUDIO'}</div>

          <div className="mt-6 flex justify-center gap-3">
            <button onClick={() => setContactOpen(true)}
              className="flex-1 max-w-[240px] h-11 rounded-lg text-base font-medium text-white"
              style={{ background: TEAL }}>预约咨询</button>
            <button onClick={copyWechat}
              className="flex-1 max-w-[240px] h-11 rounded-lg text-base font-medium"
              style={{ background: '#fff', color: TEAL, border: '2px solid ' + TEAL }}>+ 关注</button>
          </div>

          {studio.address && (
            <div className="mt-6 text-sm flex items-center justify-center" style={{ color: '#999' }}>
              <span className="mr-1">📍</span>{studio.address}
            </div>
          )}
          <div className="mt-2 text-sm leading-relaxed px-4" style={{ color: '#888' }}>{studio.intro || '拍摄有温度的照片，记录平凡生活中的美好。'}</div>
          <div className="mt-4 text-sm" style={{ color: TEAL, cursor: 'pointer' }} onClick={() => setStoryOpen(true)}>查看品牌故事 ›</div>
        </div>
      </div>

      {/* ③ 作品展示区块（仅此处加大与上方品牌模块的上下间距，露出页面底色形成视觉断开；其余间距不变） */}
      <div className="px-3 mt-12">
        <div className="rounded-3xl px-6 py-10" style={{ background: CARD, boxShadow: '0 4px 18px rgba(0,0,0,0.04)' }}>
          <div className="text-center text-xs tracking-[6px] uppercase" style={{ color: '#999' }}>GALLERY</div>
          <div className="text-center mt-1 text-2xl font-semibold tracking-[4px]" style={{ color: '#2c2c2c' }}>作品展示</div>

          {/* 分类标签（横向滑动） */}
          <div className="mt-4 overflow-x-auto whitespace-nowrap" style={{ scrollbarWidth: 'none' }}>
            <div className="inline-flex gap-6 pb-4">
              <button onClick={() => selectCat(0)}
                className="relative text-base pb-1"
                style={{ color: activeCat === 0 ? '#2c2c2c' : '#999', fontWeight: activeCat === 0 ? 600 : 400 }}>
                全部
                {activeCat === 0 && <span className="absolute left-0 right-0 -bottom-0.5 h-1 rounded" style={{ background: TEAL }} />}
              </button>
              {categories.map((c) => (
                <button key={c.id} onClick={() => selectCat(c.id)}
                  className="relative text-base pb-1"
                  style={{ color: activeCat === c.id ? '#2c2c2c' : '#999', fontWeight: activeCat === c.id ? 600 : 400 }}>
                  {c.name}
                  {activeCat === c.id && <span className="absolute left-0 right-0 -bottom-0.5 h-1 rounded" style={{ background: TEAL }} />}
                </button>
              ))}
            </div>
          </div>

          {/* 作品网格 */}
          {works.length > 0 && (
            <div className="flex flex-wrap -mx-1.5 mt-1">
              {works.map((w) => (
                <div key={w.id} onClick={() => nav('/w/' + w.id)}
                  className="w-[calc(50%-12px)] mx-1.5 mb-3 relative rounded-2xl overflow-hidden bg-[#eee] cursor-pointer">
                  <img src={w.cover} alt="" className="w-full block" style={{ aspectRatio: '4 / 5' }} loading="lazy" />
                  {w.live && <span className="absolute top-2 right-2 text-white text-xs px-2 py-1 rounded" style={{ background: 'rgba(126,205,187,0.95)' }}>图片直播</span>}
                  <div className="absolute left-0 right-0 bottom-0 px-3 py-4" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.55), transparent)' }}>
                    <div className="text-white text-sm font-medium truncate">{w.customer_name || w.title}</div>
                    <div className="text-white/85 text-xs mt-1">#{w.category_name || '作品'}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {!works.length && !loading && (
            <div className="py-16 text-center text-sm" style={{ color: '#999' }}>暂无作品</div>
          )}
          {works.length > 0 && hasMore && (
            <button onClick={() => loadWorks(false)}
              className="mx-auto mt-9 w-[260px] h-[76px] text-base rounded-lg border"
              style={{ borderColor: '#ccc', color: '#666' }}>MORE</button>
          )}
          {works.length > 0 && !hasMore && (
            <div className="mt-9 text-center text-sm" style={{ color: '#bbb' }}>— 没有更多了 —</div>
          )}
        </div>
      </div>

      {/* 底部联系区块 */}
      <div className="px-3 mt-6 pb-24">
        <div className="rounded-3xl px-9 py-10" style={{ background: CARD, boxShadow: '0 4px 18px rgba(0,0,0,0.04)' }}>
          <div className="text-center text-lg font-semibold tracking-[4px] mb-6" style={{ color: '#2c2c2c' }}>联系我们</div>
          {studio.contact?.wechat && (
            <div className="flex items-center mb-3 text-sm" style={{ color: '#555' }}>
              <span className="w-20" style={{ color: '#999' }}>微信</span>
              <span className="flex-1" style={{ color: '#333' }}>{studio.contact.wechat}</span>
              <span className="cursor-pointer" style={{ color: TEAL }} onClick={copyWechat}>复制</span>
            </div>
          )}
          {studio.contact?.phone && (
            <div className="flex items-center mb-3 text-sm" style={{ color: '#555' }}>
              <span className="w-20" style={{ color: '#999' }}>电话</span>
              <span className="flex-1" style={{ color: '#333' }}>{studio.contact.phone}</span>
              <span className="cursor-pointer" style={{ color: TEAL }} onClick={() => window.location.href = 'tel:' + studio.contact.phone}>拨打</span>
            </div>
          )}
          {studio.contact?.address && (
            <div className="flex items-center text-sm" style={{ color: '#555' }}>
              <span className="w-20" style={{ color: '#999' }}>地址</span>
              <span className="flex-1" style={{ color: '#333' }}>{studio.contact.address}</span>
            </div>
          )}
          <div className="mt-6 text-center text-xs" style={{ color: '#aaa' }}>叶哲 STUDIO · 用影像记录时光</div>
        </div>
      </div>

      {/* 右侧固定悬浮按钮组（关注 / 预约 / 我的） */}
      <div className="fixed right-5 top-1/2 -translate-y-1/2 z-50 flex flex-col gap-4">
        <button onClick={copyWechat}
          className="w-14 h-14 rounded-full flex flex-col items-center justify-center shadow-lg" style={{ background: '#fff', color: '#2c2c2c' }}>
          <span className="text-base leading-none mb-0.5">♡</span><span className="text-[10px] font-medium leading-none">关注</span>
        </button>
        <button onClick={() => setContactOpen(true)}
          className="w-14 h-14 rounded-full flex flex-col items-center justify-center shadow-lg" style={{ background: TEAL, color: '#fff' }}>
          <span className="text-base leading-none mb-0.5">✉</span><span className="text-[10px] font-medium leading-none">预约</span>
        </button>
        <button onClick={() => nav('/my')}
          className="w-14 h-14 rounded-full flex flex-col items-center justify-center shadow-lg" style={{ background: '#fff', color: '#2c2c2c' }}>
          <span className="text-base leading-none mb-0.5">☺</span><span className="text-[10px] font-medium leading-none">我的</span>
        </button>
      </div>

      {/* 预约联系弹窗 */}
      {contactOpen && (
        <div className="fixed inset-0 z-[100] flex items-end bg-black/45" onClick={() => setContactOpen(false)}>
          <div className="w-full bg-white rounded-t-3xl p-10" onClick={(e) => e.stopPropagation()}>
            <div className="text-center text-lg font-semibold mb-8" style={{ color: '#2c2c2c' }}>预约咨询</div>
            <div className="text-sm mb-2" style={{ color: '#888' }}>添加微信，预约您的拍摄</div>
            <div className="flex items-center justify-between mb-5">
              <span className="text-base" style={{ color: '#2c2c2c' }}>{studio.contact?.wechat || 'yezhe-studio'}</span>
              <button onClick={copyWechat} className="px-4 py-1.5 rounded text-sm text-white" style={{ background: TEAL }}>复制</button>
            </div>
            {studio.contact?.phone && (
              <button onClick={() => window.location.href = 'tel:' + studio.contact.phone}
                className="w-full h-11 rounded-lg text-white text-base" style={{ background: TEAL }}>拨打电话</button>
            )}
          </div>
        </div>
      )}

      {/* 品牌故事弹窗 */}
      {storyOpen && (
        <div className="fixed inset-0 z-[100] flex items-end bg-black/45" onClick={() => setStoryOpen(false)}>
          <div className="w-full bg-white rounded-t-3xl p-10" onClick={(e) => e.stopPropagation()}>
            <div className="text-center text-lg font-semibold mb-6" style={{ color: '#2c2c2c' }}>{studio.name || '叶哲 STUDIO'}</div>
            <div className="text-sm leading-relaxed" style={{ color: '#555' }}>{studio.intro || '拍摄有温度的照片，记录平凡生活中的美好。'}</div>
            <button onClick={() => setStoryOpen(false)}
              className="mt-8 w-full h-11 rounded-lg text-white text-base" style={{ background: TEAL }}>知道了</button>
          </div>
        </div>
      )}
    </div>
  );
}
