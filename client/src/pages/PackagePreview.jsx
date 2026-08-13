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
const MGREEN = '#07C160';

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

// 新增：服务详情弹窗图标
function IconScissors() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>;
}
function IconDollar() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>;
}
function IconMakeup() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 0 1 10 10c0 5.523-4.477 10-10 10S2 17.523 2 12 2 2 12 2z"/><path d="M9 9h.01"/><path d="M15 9h.01"/><path d="M8 13a4 4 0 0 0 8 0"/></svg>;
}
function IconCheckOn() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={MGREEN} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="9 12 12 15 17 9"/></svg>;
}
function IconCheckOff() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ddd" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/></svg>;
}
function IconCloseX() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
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
  const [studio, setStudio] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareData, setShareData] = useState(null);
  const [shareBusy, setShareBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      http.get('/api/packages/' + id),
      http.get('/api/settings/studio').catch(() => null)
    ])
      .then(([pkgRes, studioRes]) => {
        const p = pkgRes.data || {};
        const d = { ...defaultDetails(), ...(p.details && typeof p.details === 'object' ? p.details : {}) };
        setData({ ...p, details: d });
        setStudio(studioRes?.data || null);
      }).catch(() => {
        setData(null);
      }).finally(() => setLoading(false));
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
  gridItems.push({ icon: <IconFace />, label: clothMap[d.cloth_provide] || '服装自备' });

  // 服务详情弹窗数据行
  const serviceRows = [
    { icon: <IconClock />, label: '时长', value: d.duration || '未设置' },
    { icon: <IconImage />, label: '拍摄', value: d.raw_count ? `${d.raw_count}张` : '未设置' },
    { icon: <IconScissors />, label: '精修', value: d.retouch_count ? `${d.retouch_count}张` : '未设置' },
    { icon: <IconDollar />, label: '加片费', value: d.extra_photo_fee ? `${d.extra_photo_fee}元/张` : '未设置' },
    { icon: <IconImage />, label: '仅送精修片', value: d.raw_all_included, type: 'toggle' },
    { icon: <IconMakeup />, label: '化妆', value: d.makeup_provide !== 'not', type: 'toggle' },
    { icon: <IconShirt />, label: '服装', value: d.cloth_provide !== 'not', type: 'toggle' },
  ];


  const handleOff = async () => {
    setActionSheetOpen(false);
    if (!window.confirm('确认下架该套系？下架后 C 端不可见')) return;
    try {
      await http.post('/api/packages/' + id + '/status', { status: 'off' });
      alert('已下架');
      nav('/packages');
    } catch (e) {
      alert(e?.response?.data?.error || '下架失败');
    }
  };

  const handleOn = async () => {
    setActionSheetOpen(false);
    if (!window.confirm('确认上架该套系？上架后 C 端可见')) return;
    try {
      await http.post('/api/packages/' + id + '/status', { status: 'on' });
      alert('已上架');
      // 刷新当前页数据
      const pkgRes = await http.get('/api/packages/' + id);
      const p = pkgRes.data || {};
      const d = { ...defaultDetails(), ...(p.details && typeof p.details === 'object' ? p.details : {}) };
      setData({ ...p, details: d });
    } catch (e) {
      alert(e?.response?.data?.error || '上架失败');
    }
  };

  const handleShare = async () => {
    if (shareData) { setShareModalOpen(true); return; }
    setShareBusy(true);
    try {
      const r = await http.post('/api/shares', { type: 'package', ref_id: parseInt(id, 10) });
      setShareData(r.data);
      setShareModalOpen(true);
    } catch (e) {
      alert(e?.response?.data?.error || '生成分享失败');
    } finally {
      setShareBusy(false);
    }
  };

  const copyShareLink = () => {
    if (!shareData?.share_url) return;
    navigator.clipboard?.writeText(shareData.share_url);
    alert('链接已复制');
  };

  const handleDelete = async () => {
    setActionSheetOpen(false);
    if (!window.confirm('确认删除该套系？删除后不可恢复')) return;
    try {
      await http.delete('/api/packages/' + id);
      alert('已删除');
      nav('/packages');
    } catch (e) {
      const err = e?.response?.data;
      if (err?.code === 'PACKAGE_IN_USE') {
        alert('该套系已被订单关联，不能直接删除。如需隐藏，请使用「下架」。');
      } else {
        alert(err?.error || '删除失败');
      }
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#fff', overflowY: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 'calc(80px + env(safe-area-inset-bottom))' }}>
      {/* 顶部导航 */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50, background: '#fff', height: 48, display: 'flex', alignItems: 'center', padding: '0 12px', borderBottom: '1px solid ' + MBORDER }}>
        <button onClick={() => nav('/packages')} style={{ background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center' }}><IconBack /></button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 16, fontWeight: 500, color: '#333' }}>套系预览</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={handleShare} disabled={shareBusy} style={{ background: 'none', border: 'none', padding: 4, display: 'flex', opacity: shareBusy ? 0.5 : 1 }}><IconShare /></button>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setActionSheetOpen(true)} style={{ background: 'none', border: 'none', padding: 4, display: 'flex' }}><IconMore /></button>
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
          <div onClick={() => setServiceModalOpen(true)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}><IconMoreService /></div>
            <div style={{ fontSize: 12, color: MRED }}>更多服务</div>
          </div>
        </div>
      </div>

      {/* 服务详情 */}
      <div style={{ padding: '0 16px 24px' }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#333', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 3, height: 14, background: MRED, borderRadius: 2, display: 'inline-block' }} />
          服务详情：
        </div>
        <div style={{ fontSize: 14, color: '#555', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
          {d.service_detail_text || data.description || '暂无服务详情'}
        </div>
      </div>

      {/* 温馨提示 */}
      {d.warm_tips ? (
        <div style={{ padding: '0 16px 24px' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#333', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 3, height: 14, background: MRED, borderRadius: 2, display: 'inline-block' }} />
            温馨提示：
          </div>
          <div style={{ fontSize: 14, color: '#555', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
            {d.warm_tips}
          </div>
        </div>
      ) : null}


      {/* 底部固定栏 */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
        background: '#fff', borderTop: '1px solid ' + MBORDER,
        display: 'flex', alignItems: 'center', height: 56,
        paddingBottom: 'env(safe-area-inset-bottom)'
      }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 12, overflow: 'hidden' }}>
          {studio?.logo ? (
            <img src={img(studio.logo)} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
          ) : (
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#eee', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', overflow: 'hidden' }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#333', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{studio?.name || '岛像工作室'}</div>
            <div style={{ fontSize: 11, color: '#999', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{studio?.slogan || ''}</div>
          </div>
        </div>
        <button onClick={() => nav('/schedule', { state: { openNew: true } })} style={{
          width: 140, height: 40, borderRadius: 20, background: MRED, color: '#fff',
          fontSize: 15, fontWeight: 500, border: 'none', marginRight: 12, display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          立即预约
        </button>
      </div>

      {/* 套系服务详情弹窗 */}
      {serviceModalOpen && (
        <>
          <div onClick={() => setServiceModalOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.5)' }} />
          <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 101, background: '#fff', borderRadius: '16px 16px 0 0', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '16px 0', textAlign: 'center', fontSize: 16, fontWeight: 500, color: '#333', borderBottom: `1px solid ${MBORDER}` }}>套系服务详情</div>
            <div style={{ overflowY: 'auto', padding: '8px 20px 20px', flex: 1 }}>
              {serviceRows.map((row, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '14px 0', borderBottom: i < serviceRows.length - 1 ? `1px solid ${MBORDER}` : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                    {row.icon}
                    <span style={{ fontSize: 14, color: '#333' }}>{row.label}</span>
                  </div>
                  {row.type === 'toggle' ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, color: row.value ? MGREEN : '#999' }}>{row.value ? '是' : '否'}</span>
                      {row.value ? <IconCheckOn /> : <IconCheckOff />}
                    </div>
                  ) : (
                    <span style={{ fontSize: 14, color: '#666' }}>{row.value}</span>
                  )}
                </div>
              ))}
            </div>
            <div style={{ padding: '12px 20px calc(16px + env(safe-area-inset-bottom))', display: 'flex', justifyContent: 'center' }}>
              <button onClick={() => setServiceModalOpen(false)} style={{ width: 44, height: 44, borderRadius: '50%', border: '1px solid #ddd', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <IconCloseX />
              </button>
            </div>
          </div>
        </>
      )}

      {/* 右上角操作弹窗（Action Sheet） */}
      {actionSheetOpen && (
        <>
          <div onClick={() => setActionSheetOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 110, background: 'rgba(0,0,0,0.5)' }} />
          <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 111, background: '#fff', borderRadius: '16px 16px 0 0', paddingBottom: 'calc(12px + env(safe-area-inset-bottom))' }}>
            <div style={{ padding: '16px 0', textAlign: 'center', fontSize: 15, fontWeight: 500, color: '#333', borderBottom: `1px solid ${MBORDER}` }}>编辑</div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 40, padding: '24px 20px' }}>
              <div onClick={() => { setActionSheetOpen(false); nav('/packages/' + id + '/edit', { state: { from: 'preview' } }); }} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </div>
                <span style={{ fontSize: 13, color: '#666' }}>编辑</span>
              </div>
              <div onClick={data.status === 'off' ? handleOn : handleOff} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {data.status === 'off' ? (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
                  ) : (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
                  )}
                </div>
                <span style={{ fontSize: 13, color: '#666' }}>{data.status === 'off' ? '上架' : '下架'}</span>
              </div>
              <div onClick={handleDelete} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                </div>
                <span style={{ fontSize: 13, color: '#666' }}>删除</span>
              </div>
            </div>
            <button onClick={() => setActionSheetOpen(false)} style={{ display: 'block', width: 'calc(100% - 32px)', margin: '0 16px', padding: '12px 0', borderRadius: 8, border: 'none', background: '#f5f5f5', fontSize: 15, color: '#333', textAlign: 'center' }}>
              取消
            </button>
          </div>
        </>
      )}

      {/* 分享弹窗 */}
      {shareModalOpen && (
        <>
          <div onClick={() => setShareModalOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,0.5)' }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 121, width: 'calc(100% - 48px)', maxWidth: 320, background: '#fff', borderRadius: 16, padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 500, color: '#333', marginBottom: 8 }}>分享套系</div>
            <div style={{ fontSize: 12, color: '#999', marginBottom: 16 }}>扫码或复制链接分享给客户</div>
            {shareData?.qr_url ? (
              <>
                <img src={shareData.qr_url} alt="分享二维码" style={{ width: 180, height: 180, margin: '0 auto', borderRadius: 8, background: '#fff', padding: 8, border: '1px solid ' + MBORDER }} />
                <div style={{ fontSize: 12, color: '#666', marginTop: 12, wordBreak: 'break-all' }}>{shareData.share_url}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'center' }}>
                  <button onClick={copyShareLink} style={{ padding: '8px 16px', borderRadius: 20, border: 'none', background: MRED, color: '#fff', fontSize: 14 }}>复制链接</button>
                  <button onClick={() => setShareModalOpen(false)} style={{ padding: '8px 16px', borderRadius: 20, border: '1px solid ' + MBORDER, background: '#fff', color: '#333', fontSize: 14 }}>关闭</button>
                </div>
              </>
            ) : (
              <div style={{ color: '#999', fontSize: 14, padding: 32 }}>生成中…</div>
            )}
          </div>
        </>
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
