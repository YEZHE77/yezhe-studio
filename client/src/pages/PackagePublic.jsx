import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import http, { img } from '../api.js';
import { getRefundParagraphs, normalizePolicy } from '../utils/refundPolicy.js';
import { getServiceAgreement } from '../utils/customerAgreement.js';
import { DEFAULT_SERVICE_DETAIL } from '../utils/serviceDetail.js';

/* ==========================================================================
   C 端套系预览页（/package?id= 主链路读 B 端 packages；/package?token= 兼容旧 photo_package 分享链接）
   —— 与后台「套系预览」(PackagePreview.jsx) 保持完全一致的功能效果与交互：
      顶部白底导航 + 16/10 封面 + 标题价格 + 3 列规格网格 + 服务详情 + 温馨提示
      + 须知/退订政策 + 全屏「套系服务详情」弹窗（字段清单 + 服务详情 + 退订政策 + 顾客协议）
      + 后端生成的分享二维码弹窗。
   差异仅限：①数据来自公开接口 ②无管理员操作(编辑/上架/下架/删除) ③分享走公开二维码接口 ④「立即预约」跳转 C 端预约页。
   ========================================================================== */

const MRED = '#FA5151';
const MGRAY = '#999999';
const MBORDER = '#F0F0F0';
const MGREEN = '#07C160';

// 内联 SVG 图标（与后台 PackagePreview 一致）
function IconBack() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>;
}
function IconShare() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>;
}
function IconClock() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
}
function IconImage() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>;
}
function IconWand() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-9 9-4-4-6 6"/><path d="M21 2l-2 2"/><path d="M3 21l4-4"/><path d="M15 6l4 4"/></svg>;
}
function IconShirt() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/></svg>;
}
function IconFace() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
}
function IconMoreService() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FA5151" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>;
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

export default function PackagePublic() {
  const [params] = useSearchParams();
  const id = params.get('id') || '';
  const token = params.get('token') || '';
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [studio, setStudio] = useState(null);
  const [loading, setLoading] = useState(true);
  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const [serviceDetailOpen, setServiceDetailOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [agreementOpen, setAgreementOpen] = useState(false);
  const [refundDetailOpen, setRefundDetailOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareData, setShareData] = useState(null);
  const [shareBusy, setShareBusy] = useState(false);

  const back = () => { if (window.history.length > 1) nav(-1); else nav('/package-center'); };
  const goBook = () => { nav('/customer/book?packageId=' + (data ? (data.id || id || '') : (id || ''))); };

  useEffect(() => {
    setLoading(true);
    Promise.all([
      id
        ? http.get('/api/packages/public/' + id)
        : token
          ? http.get('/api/photo-package/public/' + token)
          : Promise.reject(new Error('invalid')),
      http.get('/api/settings/studio').catch(() => null)
    ])
      .then(([pkgRes, studioRes]) => {
        let p = pkgRes.data || {};
        // 旧 photo_package 分享链接（无 details JSON）：映射到统一 details 字段，保证规格网格/弹窗正常渲染
        if (token && !p.details) {
          const legacy = p;
          p = {
            id: null,
            name: legacy.package_name,
            price: legacy.price,
            deposit: 0,
            cover_url: legacy.cover_image,
            description: legacy.package_desc,
            details: {
              duration: legacy.shoot_duration || '',
              raw_count: legacy.negative_count || '',
              retouch_count: legacy.retouch_count || '',
              raw_all_included: false,
              cloth_provide: legacy.clothing === 'provide' ? 'provide' : 'not',
              makeup_provide: 'not',
              album_provide: 'not',
              service_detail_text: legacy.other_service || '',
              warm_tips: legacy.notice || '',
              refund_policy: '',
              hide_refund: false,
              service_location: '',
              quick_repair_cost: '',
              delivery_time: '',
              delivery_remark: '',
              customer_agreement: ''
            }
          };
        }
        const d = { ...defaultDetails(), ...(p.details && typeof p.details === 'object' ? p.details : {}) };
        setData({ ...p, details: d });
        setStudio(studioRes?.data || null);
      })
      .catch(() => {
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [id, token]);

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
        <div style={{ fontSize: 14, color: '#999' }}>套系不存在或链接已失效</div>
        <button onClick={back} style={{ marginTop: 16, fontSize: 14, color: MRED, background: 'none', border: 'none' }}>返回</button>
      </div>
    );
  }

  const d = data.details || {};
  const price = data.price ?? '';
  const deposit = data.deposit ?? '';

  // 信息网格项（与后台完全一致）
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

  // 分享：公开二维码接口（GET /api/settings/qrcode?text=URL）
  const shareUrl = window.location.origin + '/package?id=' + encodeURIComponent(data.id || id || '');
  const handleShare = async () => {
    if (shareData) { setShareModalOpen(true); return; }
    setShareBusy(true);
    try {
      const r = await http.get('/api/settings/qrcode?text=' + encodeURIComponent(shareUrl));
      setShareData({ qr_url: r.data.dataUrl, share_url: shareUrl });
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

  return (
    <div style={{ minHeight: '100vh', background: '#fff', overflowY: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 'calc(56px + env(safe-area-inset-bottom))' }}>
      {/* 顶部导航（与后台一致：白底 sticky，居中标题） */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50, background: '#fff', height: 48, display: 'flex', alignItems: 'center', padding: '0 12px', borderBottom: '1px solid ' + MBORDER }}>
        <button onClick={back} style={{ background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center' }}><IconBack /></button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 16, fontWeight: 500, color: '#333' }}>套系预览</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={handleShare} disabled={shareBusy} style={{ background: 'none', border: 'none', padding: 4, display: 'flex', opacity: shareBusy ? 0.5 : 1 }}><IconShare /></button>
        </div>
      </div>

      {/* 封面大图（16/10） */}
      <div style={{ width: '100%', aspectRatio: '16/10', background: '#f5f5f5', overflow: 'hidden' }}>
        {data.cover_url ? (
          <img src={img(data.cover_url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ccc', fontSize: 14 }}>暂无封面</div>
        )}
      </div>

      {/* 标题 + 价格 */}
      <div style={{ padding: '16px 16px 14px', background: '#fff', borderBottom: '1px solid ' + MBORDER }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: '#1f2329', lineHeight: 1.4 }}>{data.name || '未命名套系'}</div>
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ color: MRED, display: 'flex', alignItems: 'baseline', gap: 1 }}>
            <span style={{ fontSize: 16 }}>¥</span>
            <span style={{ fontSize: 28, fontWeight: 700 }}>{Number(price || 0).toLocaleString()}</span>
          </span>
          {deposit ? <span style={{ fontSize: 13, color: '#999' }}>定金: ¥ {Number(deposit).toLocaleString()}</span> : null}
        </div>
      </div>

      {/* 信息网格 */}
      <div style={{ padding: '12px 16px 16px', background: '#fff' }}>
        <div style={{ background: '#fafafa', borderRadius: 12, padding: '20px 16px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px 8px', textAlign: 'center' }}>
          {gridItems.map((item, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{item.icon}</div>
              <div style={{ fontSize: 12, color: '#666' }}>{item.label}</div>
            </div>
          ))}
          <div onClick={() => setServiceModalOpen(true)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}><IconMoreService /></div>
            <div style={{ fontSize: 12, color: MRED }}>更多服务</div>
          </div>
        </div>
      </div>

      {/* 服务详情 */}
      <div style={{ padding: '16px 16px 16px', background: '#fff', borderTop: '1px solid ' + MBORDER }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#333', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 3, height: 14, background: MRED, borderRadius: 2, display: 'inline-block' }} />
          服务详情：
        </div>
        <div style={{ fontSize: 14, color: '#555', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
          {d.service_detail_text || DEFAULT_SERVICE_DETAIL}
        </div>
      </div>

      {/* 温馨提示 */}
      {d.warm_tips ? (
        <div style={{ padding: '16px 16px 24px', background: '#fff', borderTop: '1px solid ' + MBORDER }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#333', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 3, height: 14, background: MRED, borderRadius: 2, display: 'inline-block' }} />
            温馨提示：
          </div>
          <div style={{ fontSize: 14, color: '#555', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
            {d.warm_tips}
          </div>
        </div>
      ) : null}

      {/* 退订政策（hide_refund=false 时显示；与套系编辑退订政策编辑页共用文案） */}
      {!d.hide_refund && (() => {
        const policy = normalizePolicy(d.refund_policy);
        return (
          <div style={{ padding: '16px 16px 16px', background: '#fff', borderTop: '1px solid ' + MBORDER }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#333', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 3, height: 14, background: MRED, borderRadius: 2, display: 'inline-block' }} />
              须知：
            </div>
            <div onClick={() => setRefundDetailOpen((v) => !v)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
              <span style={{ fontSize: 14, color: '#333' }}>退订政策</span>
              <span style={{ fontSize: 14, color: MGREEN }}>{refundDetailOpen ? '收起' : '展开'}</span>
            </div>
            {refundDetailOpen && (
              <div style={{ marginTop: 10, fontSize: 14, color: '#555', lineHeight: 1.8 }}>
                {(() => {
                  const paras = getRefundParagraphs(d, policy);
                  return paras.length ? paras.map((line, i) => (
                    <div key={i} style={{ marginBottom: i < paras.length - 1 ? 6 : 0 }}>{line}</div>
                  )) : <div style={{ color: MGRAY, fontSize: 13 }}>未填写</div>;
                })()}
              </div>
            )}
          </div>
        );
      })()}

      {/* 套系服务详情全屏页 */}
      {serviceModalOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 101, background: '#fff', display: 'flex', flexDirection: 'column' }}>
          <div style={{ paddingTop: 'env(safe-area-inset-top, 0px)', height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: `1px solid ${MBORDER}`, flexShrink: 0 }}>
            <span style={{ fontSize: 16, fontWeight: 500, color: '#333' }}>套系服务详情</span>
          </div>
          <div style={{ overflowY: 'auto', flex: 1, padding: '8px 20px' }}>
            {[
              { label: '拍摄时长', value: d.duration || '未设置', chevron: true },
              { label: '原片', value: d.raw_count ? `${d.raw_count}张` : '未设置', chevron: true },
              { label: '精修片', value: d.retouch_count ? `${d.retouch_count}张` : '未设置', chevron: true },
              { label: '加片费', value: d.extra_photo_fee || '未设置', chevron: true },
              { label: '快修费', value: d.quick_repair_cost || '未设置', chevron: true },
              { label: '交付时间', value: d.delivery_time || '未设置', chevron: true },
              { label: '交付备注', value: d.delivery_remark || '未设置', chevron: true, fullWidth: true },
              { label: '化妆服装', value: `${d.cloth_provide === 'provide' ? '提供服装' : '不提供服装'} · ${d.makeup_provide === 'provide' ? '提供化妆' : '不提供化妆'}`, chevron: true },
              { label: '提供相册', value: d.album_provide === 'provide' ? '是' : d.album_provide === 'extra' ? '相册另购' : '否', chevron: true },
              { label: '服务地点', value: d.service_location || '未设置', chevron: true }
            ].map((row, i, arr) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '14px 0', borderBottom: i < arr.length - 1 ? `1px solid ${MBORDER}` : 'none' }}>
                <span style={{ fontSize: 14, color: '#333', flex: 1 }}>{row.label}</span>
                <span style={{ fontSize: 14, color: '#666', maxWidth: row.fullWidth ? '60%' : '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.value}</span>
                {row.chevron && <span style={{ color: '#82C8AE', marginLeft: 6 }}>›</span>}
              </div>
            ))}

            <div style={{ height: 1, background: MBORDER, margin: '12px -20px' }} />

            <div style={{ padding: '14px 0' }}>
              <div onClick={() => setServiceDetailOpen((v) => !v)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                <span style={{ fontSize: 14, color: '#333' }}>服务详情</span>
                <span style={{ fontSize: 14, color: MGREEN }}>{serviceDetailOpen ? '收起' : '展开'}</span>
              </div>
              {serviceDetailOpen && (
                <div style={{ marginTop: 10, fontSize: 13, color: '#666', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                  {d.service_detail_text || DEFAULT_SERVICE_DETAIL}
                </div>
              )}
            </div>

            <div style={{ padding: '14px 0', borderTop: `1px solid ${MBORDER}` }}>
              <div onClick={() => setRefundOpen((v) => !v)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                <span style={{ fontSize: 14, color: '#333' }}>退订政策</span>
                <span style={{ fontSize: 14, color: d.hide_refund ? '#999' : MGREEN }}>{d.hide_refund ? '该套系已设置为隐藏退订政策' : (refundOpen ? '收起' : '展开')}</span>
              </div>
              {!d.hide_refund && refundOpen && (() => {
                const paras = getRefundParagraphs(d, normalizePolicy(d.refund_policy));
                if (!paras.length) return <div style={{ marginTop: 10, fontSize: 13, color: '#666', lineHeight: 1.6 }}>未设置</div>;
                return (
                  <div style={{ marginTop: 10, fontSize: 13, color: '#666', lineHeight: 1.6 }}>
                    {paras.map((p, i) => {
                      const isHeading = /^[一二三四五六七八九十]+、|退订/.test(p);
                      return (
                        <div key={i} style={{ marginTop: isHeading && i > 0 ? 8 : 0, marginBottom: 4, fontSize: isHeading ? 14 : 13 }}>{p}</div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            <div style={{ padding: '14px 0', borderTop: `1px solid ${MBORDER}` }}>
              <div onClick={() => setAgreementOpen((v) => !v)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                <span style={{ fontSize: 14, color: '#333' }}>顾客协议</span>
                <span style={{ fontSize: 14, color: MGREEN }}>{agreementOpen ? '收起' : '展开'}</span>
              </div>
              {agreementOpen && (
                <div style={{ marginTop: 10, fontSize: 13, color: '#666', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{getServiceAgreement(d)}</div>
              )}
            </div>

            <div style={{ marginTop: 24, padding: '10px 14px', background: '#f5f9fa', borderRadius: 6, fontSize: 12, color: '#999', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>💡</span>
              <span>修改订单将同步更新以上数据</span>
            </div>
          </div>
          <div style={{ padding: '20px 20px calc(20px + env(safe-area-inset-bottom))', display: 'flex', justifyContent: 'center', borderTop: `1px solid ${MBORDER}`, flexShrink: 0 }}>
            <button onClick={() => { setServiceModalOpen(false); setServiceDetailOpen(false); setRefundOpen(false); setAgreementOpen(false); }} style={{ width: 44, height: 44, borderRadius: '50%', border: '1px solid #ddd', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <IconCloseX />
            </button>
          </div>
        </div>
      )}

      {/* 分享弹窗（公开二维码接口） */}
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
        <button onClick={goBook} style={{
          width: 140, height: 40, borderRadius: 20, background: MRED, color: '#fff',
          fontSize: 15, fontWeight: 500, border: 'none', marginRight: 12, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          立即预约
        </button>
      </div>

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
