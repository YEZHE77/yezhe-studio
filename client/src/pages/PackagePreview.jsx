import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import http, { img } from '../api.js';

/* ==========================================================================
   套系预览页（1:1 复刻小程序风格）
   —— 点击套系卡片后先进入预览，右上角 ⋯ 菜单可选编辑
   ========================================================================== */

const MRED = '#FA5151';
const MGRAY = '#999999';
const MBORDER = '#F0F0F0';

// 内联 SVG 图标
function IconBack() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>;
}
function IconShare() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>;
}
function IconMore() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>;
}
function IconClock() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
}
function IconImage() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>;
}
function IconWand() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-9 9-4-4-6 6"/><path d="M21 2l-2 2"/><path d="M3 21l4-4"/><path d="M15 6l4 4"/></svg>;
}
function IconShirt() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/></svg>;
}
function IconFace() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
}
function IconMoreService() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FA5151" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>;
}
function IconHome() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>;
}
function IconHeart() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>;
}
function IconService() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>;
}

function defaultDetails() {
  return {
    detail_images: [], video_url: '', service_params: '单规格服务', hide_price: false, hide_deposit: false,
    deposit_is_full: false, show_currency: true, refund_policy: '严格', hide_refund: false,
    raw_storage: '', prepay_enabled: false, questionnaire_visibility: 'none', questionnaire_verify_phone: false,
    questionnaire: [], shoot_template: 'photo', duration: '全天', raw_count: '', raw_all_included: false,
    retouch_count: '', extra_photo_fee: '', extra_photo_discount: '', cloth_provide: 'not',
    makeup_provide: 'not', album_provide: 'not', service_location: '', show_service_content: true,
    service_detail_text: '', public_all_visible: false, public_visible: '全部可见', consult_reminder: false,
    warm_tips: '', tags: [], customer_agreement: ''
  };
}

export default function PackagePreview() {
  const { id } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    http.get('/api/packages/' + id).then((r) => {
      const p = r.data || {};
      const d = { ...defaultDetails(), ...(p.details && typeof p.details === 'object' ? p.details : {}) };
      setData({ ...p, details: d });
    }).catch(() => { setData(null); }).finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 28, height: 28, border: '3px solid #eee', borderTopColor: MRED, borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }
  if (!data) {
    return (
      <div style={{ minHeight: '100vh', background: '#fff', paddingTop: 80, textAlign: 'center' }}>
        <div style={{ fontSize: 14, color: '#999' }}>套系不存在或已删除</div>
        <button onClick={() => nav('/packages')} style={{ marginTop: 16, fontSize: 14, color: MRED, background: 'none', border: 'none' }}>返回套系列表</button>
      </div>
    );
  }

  const d = data.details || {};
  const price = data.price ?? '';
  const deposit = data.deposit ?? '';

  // 信息网格项
  const gridItems = [];
  if (d.duration) gridItems.push({ icon: <IconClock />, label: d.duration });
  if (d.raw_count) gridItems.push({ icon: <IconImage />, label: `拍摄${d.raw_count}张` });
  if (d.retouch_count) gridItems.push({ icon: <IconWand />, label: `${d.retouch_count}张精修` });
  gridItems.push({
    icon: <IconShirt />,
    label: d.raw_all_included ? '全部原片' : '仅送精修'
  });
  const clothMap = { not: '服装自备', yes: '提供服装', extra: '服装另购' };
  const makeupMap = { not: '化妆自备', yes: '提供化妆', extra: '化妆另购' };
  gridItems.push({ icon: <IconFace />, label: clothMap[d.cloth_provide] || '服装自备' });
  // 更多服务作为可点击项

  return (
    <div style={{ minHeight: '100vh', background: '#fff', paddingBottom: 'calc(60px + env(safe-area-inset-bottom))' }}>
      {/* 顶部导航 */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50, background: '#fff', height: 48, display: 'flex', alignItems: 'center', padding: '0 12px', borderBottom: '1px solid ' + MBORDER }}>
        <button onClick={() => nav('/packages')} style={{ background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center' }}><IconBack /></button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 16, fontWeight: 500, color: '#333' }}>套系预览</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => { /* 分享 */ }} style={{ background: 'none', border: 'none', padding: 4, display: 'flex' }}><IconShare /></button>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setMenuOpen(!menuOpen)} style={{ background: 'none', border: 'none', padding: 4, display: 'flex' }}><IconMore /></button>
            {menuOpen && (
              <>
                <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 50, background: '#fff', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', minWidth: 140, padding: '6px 0' }}>
                  <button onClick={() => { setMenuOpen(false); nav('/packages/' + id + '/edit'); }} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 14px', background: 'none', border: 'none', fontSize: 14, color: '#333', textAlign: 'left' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    编辑
                  </button>
                  <button onClick={() => { setMenuOpen(false); /* 复制/其他 */ }} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 14px', background: 'none', border: 'none', fontSize: 14, color: '#333', textAlign: 'left' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    复制套系
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 封面大图 */}
      <div style={{ width: '100%', aspectRatio: '16/10', background: '#f5f5f5', overflow: 'hidden' }}>
        {data.cover_url ? (
          <img src={img(data.cover_url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ccc', fontSize: 14 }}>暂无封面</div>
        )}
      </div>

      {/* 标题 + 价格 */}
      <div style={{ padding: '16px 16px 12px' }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: '#1f2329', lineHeight: 1.4 }}>{data.name || '未命名套系'}</div>
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 24, fontWeight: 700, color: MRED }}>¥{Number(price || 0).toLocaleString()}</span>
          {deposit ? <span style={{ fontSize: 13, color: '#999' }}>定金: ¥ {Number(deposit).toLocaleString()}</span> : null}
        </div>
      </div>

      {/* 信息网格 */}
      <div style={{ padding: '0 16px 16px' }}>
        <div style={{ background: '#fafafa', borderRadius: 12, padding: '16px 12px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px 8px', textAlign: 'center' }}>
          {gridItems.map((item, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>{item.icon}</div>
              <div style={{ fontSize: 12, color: '#666' }}>{item.label}</div>
            </div>
          ))}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}><IconMoreService /></div>
            <div style={{ fontSize: 12, color: MRED }}>更多服务</div>
          </div>
        </div>
      </div>

      {/* 服务详情 */}
      <div style={{ padding: '0 16px 20px' }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#333', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 3, height: 14, background: MRED, borderRadius: 2, display: 'inline-block' }} />
          服务详情
        </div>
        <div style={{ fontSize: 14, color: '#555', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
          {d.service_detail_text || data.description || '暂无服务详情'}
        </div>
        {d.service_detail_text && d.service_detail_text.length > 80 && (
          <button onClick={() => setShowMore(!showMore)} style={{ marginTop: 6, fontSize: 13, color: MRED, background: 'none', border: 'none', padding: 0 }}>
            {showMore ? '收起' : '展开更多'}
          </button>
        )}
      </div>

      {/* 额外信息折叠（更多服务） */}
      {showMore && (
        <div style={{ padding: '0 16px 20px' }}>
          <div style={{ background: '#fafafa', borderRadius: 12, padding: 14, fontSize: 13, color: '#666', lineHeight: 1.8 }}>
            {d.shoot_template === 'photo' ? '摄影类' : '摄像类'} · {d.service_params}
            {d.service_location ? ` · 服务地点：${d.service_location}` : ''}
            {d.album_provide === 'yes' ? ' · 提供相册' : d.album_provide === 'extra' ? ' · 相册另购' : ' · 无相册'}
            {d.makeup_provide !== 'not' ? ` · ${makeupMap[d.makeup_provide]}` : ''}
            {d.raw_storage ? ` · 底片保存：${d.raw_storage}` : ''}
            {d.warm_tips ? `\n温馨提示：${d.warm_tips}` : ''}
          </div>
        </div>
      )}

      {/* 底部固定栏 */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
        background: '#fff', borderTop: '1px solid ' + MBORDER,
        display: 'flex', alignItems: 'center', height: 56,
        paddingBottom: 'env(safe-area-inset-bottom)'
      }}>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'space-around', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <IconHome />
            <span style={{ fontSize: 10, color: '#999' }}>主页</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <IconHeart />
            <span style={{ fontSize: 10, color: '#999' }}>喜欢</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <IconService />
            <span style={{ fontSize: 10, color: '#999' }}>客服</span>
          </div>
        </div>
        <button style={{
          width: 140, height: 40, borderRadius: 20, background: MRED, color: '#fff',
          fontSize: 15, fontWeight: 500, border: 'none', marginRight: 12, display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          立即预约
        </button>
      </div>

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
