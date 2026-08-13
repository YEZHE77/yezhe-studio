import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import http, { img } from '../api.js';

/* ==========================================================================
   作品预览页（1:1 复刻小程序风格）
   —— 点击作品相册后先进入预览，右上角 ⋯ 菜单可选编辑
   ========================================================================== */

const MRED = '#FA5151';
const MGRAY = '#999999';
const MBORDER = '#F0F0F0';

// 内联 SVG 图标
function IconBack() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>;
}
function IconGrid() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
}
function IconShare() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>;
}
function IconMore() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>;
}
function IconComment() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>;
}
function IconChart() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>;
}
function IconPlay() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>;
}

export default function WorkPreview() {
  const { id } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showGrid, setShowGrid] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    http.get('/api/works/' + id).then((r) => {
      setData(r.data || null);
    }).catch(() => { setData(null); }).finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 28, height: 28, border: '3px solid rgba(255,255,255,0.2)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }
  if (!data || !data.work) {
    return (
      <div style={{ minHeight: '100vh', background: '#fff', paddingTop: 80, textAlign: 'center' }}>
        <div style={{ fontSize: 14, color: '#999' }}>作品不存在或已删除</div>
        <button onClick={() => nav('/works')} style={{ marginTop: 16, fontSize: 14, color: MRED, background: 'none', border: 'none' }}>返回作品列表</button>
      </div>
    );
  }

  const w = data.work || {};
  const albums = (data.albums || []).filter((a) => a.zone === 'sample');
  const cover = w.cover_url;
  const catName = w.category_name || (w.category_id ? '作品' : '');

  return (
    <div style={{ minHeight: '100vh', background: '#fff', paddingBottom: 'calc(70px + env(safe-area-inset-bottom))' }}>
      {/* 顶部导航（透明背景，悬浮在图片上） */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', paddingTop: 'calc(8px + env(safe-area-inset-top))',
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.35), transparent)'
      }}>
        <button onClick={() => nav('/works')} style={{ background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center' }}>
          <IconBack />
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => setShowGrid(!showGrid)} style={{ width: 32, height: 32, borderRadius: '50%', background: MRED, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <IconGrid />
          </button>
          <button onClick={() => { /* 分享 */ }} style={{ width: 32, height: 32, borderRadius: '50%', background: MRED, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <IconShare />
          </button>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setMenuOpen(!menuOpen)} style={{ background: 'none', border: 'none', padding: 4, display: 'flex' }}>
              <IconMore />
            </button>
            {menuOpen && (
              <>
                <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                <div style={{
                  position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 50,
                  background: '#fff', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                  minWidth: 140, padding: '6px 0'
                }}>
                  <button onClick={() => { setMenuOpen(false); nav('/works/' + id + '/edit'); }} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 14px', background: 'none', border: 'none', fontSize: 14, color: '#333', textAlign: 'left' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    编辑
                  </button>
                  <button onClick={() => { setMenuOpen(false); /* 删除 */ }} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 14px', background: 'none', border: 'none', fontSize: 14, color: '#e4393c', textAlign: 'left' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e4393c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    删除
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 封面大图 */}
      <div style={{ width: '100%', aspectRatio: '3/4', background: '#1a1a1a', position: 'relative', overflow: 'hidden' }}>
        {cover ? (
          <img src={img(cover)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : albums[0] ? (
          <img src={img(albums[0].url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: 14 }}>暂无封面</div>
        )}
      </div>

      {/* 标题 + 分类 + 描述 */}
      <div style={{ padding: '16px 16px 12px' }}>
        <div style={{ fontSize: 20, fontWeight: 600, color: '#1f2329', lineHeight: 1.4 }}>{w.title || '未命名作品'}</div>
        {catName && (
          <div style={{ marginTop: 8, display: 'inline-block', fontSize: 12, color: '#999', background: '#f5f5f5', padding: '3px 10px', borderRadius: 4 }}>{catName}</div>
        )}
        {w.description && (
          <div style={{ marginTop: 12, fontSize: 14, color: '#555', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{w.description}</div>
        )}
      </div>

      {/* 相册样片网格 */}
      {albums.length > 0 && (
        <div style={{ padding: '0 16px 20px' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#333', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 3, height: 14, background: MRED, borderRadius: 2, display: 'inline-block' }} />
            作品相册
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: showGrid ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)', gap: 4 }}>
            {albums.map((a, i) => (
              <div key={a.id || i} style={{ aspectRatio: '1', background: '#f5f5f5', borderRadius: 4, overflow: 'hidden' }}>
                <img src={img(a.thumbnail_url || a.url, 'thumb')} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 底部品牌栏（模拟截图底部） */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
        background: '#fff', borderTop: '1px solid ' + MBORDER,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', paddingBottom: 'calc(10px + env(safe-area-inset-bottom))'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#1a1a1a', overflow: 'hidden' }}>
            {w.cover_url ? <img src={img(w.cover_url, 'thumb')} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#333' }}>岛像微电影</div>
            <div style={{ fontSize: 11, color: '#999' }}>婚纱照 · 婚礼跟拍 · 人物肖像</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <IconComment />
          <IconChart />
          <IconPlay />
        </div>
      </div>

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
