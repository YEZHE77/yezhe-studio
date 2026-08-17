import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import http, { img, BASE } from '../api.js';
import { getRefundParagraphs, normalizePolicy } from '../utils/refundPolicy.js';
import { getServiceAgreement, toParagraphs } from '../utils/customerAgreement.js';
import { DEFAULT_SERVICE_DETAIL } from '../utils/serviceDetail.js';

// ===== C 端客户订单查看页（/customer-order?token=customer_token）=====
// customer_token 鉴权，与 B 端订单详情同口径：套系详细内容 + 拍摄档期/时间/地点 + 执行人 + 消费明细 + 选片入口
// 完全只读，无任何编辑/删除/上传按钮
const TEXT = '#1D1D1F';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';
const LINE = '#F0F0F2';
const BRAND = '#7ECDBB';
// 套系预览对齐色板（与后台 PackagePreview / C端 PackagePublic 一致）
const MRED = '#FA5151';
const MGRAY = '#999999';
const MBORDER = '#F0F0F0';
const MGREEN = '#07C160';

function Card({ children, style }) {
  return <div style={{ background: '#fff', borderRadius: 16, padding: 16, boxShadow: '0 1px 6px rgba(0,0,0,0.04)', ...style }}>{children}</div>;
}
function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid ' + LINE }}>
      <span style={{ fontSize: 13, color: SUB }}>{label}</span>
      <span style={{ fontSize: 14, color: TEXT, textAlign: 'right', maxWidth: '60%' }}>{value || '—'}</span>
    </div>
  );
}

function fmtTime(t) {
  if (!t) return '';
  const d = new Date(t);
  if (isNaN(d.getTime())) return t;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
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

// 内联 SVG 图标（与后台 PackagePreview / C端 PackagePublic 一致，用于三列规格网格 + 更多服务弹窗）
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

export default function CustomerOrder() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const token = params.get('accessToken') || params.get('token') || '';
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  // 改期/取消申请
  const [reqOpen, setReqOpen] = useState(false);
  const [reqType, setReqType] = useState('reschedule');
  const [reqReason, setReqReason] = useState('');
  const [reqDate, setReqDate] = useState('');
  const [reqBusy, setReqBusy] = useState(false);
  // 电子服务协议签署
  const [agreement, setAgreement] = useState({ force_agreement: false, agreement_signed: false, history: [] });
  const [signOpen, setSignOpen] = useState(false);
  const [signBusy, setSignBusy] = useState(false);
  const signCanvasRef = useRef(null);
  const signDrawingRef = useRef(false);
  // 套系预览交互态（对齐后台套系预览：更多服务全屏弹窗 + 弹窗内展开 + 须知查看详情）
  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const [serviceDetailOpen, setServiceDetailOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [agreementOpen, setAgreementOpen] = useState(false);
  const [refundDetailOpen, setRefundDetailOpen] = useState(false);

  useEffect(() => {
    if (!token) { setErr('无权限访问'); setLoading(false); return; }
    http.get('/api/customer/order-detail', { params: { accessToken: token } })
      .then((r) => setData(r.data))
      .catch((e) => setErr((e.response && e.response.data && e.response.data.error) || '加载失败'))
      .finally(() => setLoading(false));
    // 拉取协议签署状态（不阻塞订单数据展示）
    http.get('/api/public/order/' + token + '/agreement')
      .then((r) => setAgreement(r.data))
      .catch(() => {});
  }, [token]);

  // 手写签名 canvas（pointer 事件，兼容触屏 + 鼠标）
  const signStart = (e) => { signDrawingRef.current = true; const c = signCanvasRef.current; const r = c.getBoundingClientRect(); const ctx = c.getContext('2d'); ctx.beginPath(); ctx.moveTo(e.clientX - r.left, e.clientY - r.top); };
  const signMove = (e) => {
    if (!signDrawingRef.current) return;
    const c = signCanvasRef.current; const r = c.getBoundingClientRect(); const ctx = c.getContext('2d');
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#1D1D1F';
    ctx.lineTo(e.clientX - r.left, e.clientY - r.top); ctx.stroke();
  };
  const signEnd = () => { signDrawingRef.current = false; };
  const clearSign = () => { const c = signCanvasRef.current; if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height); };

  const submitSign = async () => {
    const c = signCanvasRef.current;
    if (!c) return;
    const dataUrl = c.toDataURL('image/png');
    // 检测是否为空签名（canvas 全透明）
    const ctx = c.getContext('2d');
    const imgData = ctx.getImageData(0, 0, c.width, c.height).data;
    let hasInk = false;
    for (let i = 3; i < imgData.length; i += 4) { if (imgData[i] > 0) { hasInk = true; break; } }
    if (!hasInk) { alert('请先在签名区手写签名'); return; }
    setSignBusy(true);
    try {
      const content = getServiceAgreement(data && data.package ? data.package.details || {} : {});
      await http.post('/api/public/order/' + token + '/agreement/sign', {
        signature: dataUrl, content_snapshot: content,
        customer_name: data && data.customer_name ? data.customer_name : ''
      });
      setSignOpen(false);
      setAgreement((a) => ({ ...a, agreement_signed: true }));
      alert('签署成功，感谢确认');
    } catch (e) { alert((e.response && e.response.data && e.response.data.error) || '签署失败'); }
    finally { setSignBusy(false); }
  };

  const openReq = (type) => { setReqType(type); setReqReason(''); setReqDate(''); setReqOpen(true); };
  const submitReq = async () => {
    if (!reqReason.trim()) { alert('请填写申请原因'); return; }
    if (reqType === 'reschedule' && !reqDate) { alert('请选择期望拍摄日期'); return; }
    setReqBusy(true);
    try {
      await http.post('/api/public/order/' + token + '/request', {
        type: reqType, reason: reqReason.trim(), desired_date: reqDate
      });
      setReqOpen(false);
      alert('申请已提交，摄影师会尽快处理并与您联系');
    } catch (e) {
      alert((e.response?.data?.error) || '提交失败，请稍后重试');
    } finally {
      setReqBusy(false);
    }
  };

  if (loading) return <div style={{ minHeight: '100vh', background: '#F5F5F7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: FAINT, fontSize: 14 }}>加载中…</div>;

  if (err || !data) {
    return (
      <div style={{ minHeight: '100vh', background: '#F5F5F7', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
        <div style={{ fontSize: 16, color: TEXT, marginBottom: 6 }}>{err || '无权限访问该订单'}</div>
        <div style={{ fontSize: 13, color: FAINT }}>该链接无效或已失效，请联系摄影师。</div>
      </div>
    );
  }

  const pkg = data.package || {};
  const d = { ...defaultDetails(), ...(pkg.details && typeof pkg.details === 'object' ? pkg.details : {}) };
  // legacy 旧订单兜底：details 缺失时回退到套系快照顶层 other_service / notice
  if (!d.service_detail_text) d.service_detail_text = pkg.other_service || '';
  if (!d.warm_tips) d.warm_tips = pkg.notice || '';
  const exes = data.executors || [];
  const extra = data.extra_items || [];
  const timeSlots = data.time_slots || [];
  // 三列规格网格项（与后台套系预览一致）
  const gridItems = [];
  if (d.duration) gridItems.push({ icon: <IconClock />, label: d.duration });
  if (d.raw_count) gridItems.push({ icon: <IconImage />, label: `拍摄${d.raw_count}张` });
  if (d.retouch_count) gridItems.push({ icon: <IconWand />, label: `${d.retouch_count}张精修` });
  gridItems.push({ icon: <IconShirt />, label: d.raw_all_included ? '全部原片' : '仅送精修' });
  const clothMap = { not: '服装自备', yes: '提供服装', extra: '服装另购' };
  gridItems.push({ icon: <IconFace />, label: clothMap[d.cloth_provide] || '服装自备' });

  return (
    <div style={{ minHeight: '100vh', background: '#F5F5F7', paddingBottom: 40 }}>
      {/* 顶部导航：返回键 + 标题 */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: '#fff', borderBottom: '1px solid #EEF0F3' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 44, padding: '0 12px' }}>
          <button onClick={() => nav(-1)} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center', color: '#1D1D1F' }} aria-label="返回">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', fontSize: 17, color: '#1D1D1F' }}>订单详情</div>
        </div>
      </div>

      <div style={{ padding: 16 }}>
      {/* 订单分享备注（系统/单订单配置；仅可读，展示在详情页顶部；为空则不渲染） */}
      {data.share_note ? (
        <div style={{ marginBottom: 12, background: '#F2F2F4', borderRadius: 12, padding: '14px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: 13, color: '#888', marginBottom: 6 }}>温馨提示</div>
          <div style={{ fontSize: 14, color: '#444', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{data.share_note}</div>
        </div>
      ) : null}
      {/* 顶部：客户 + 订单号 + 状态 */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 17, color: TEXT }}>{data.customer_name || '客户'}</div>
            <div style={{ fontSize: 12, color: FAINT, marginTop: 4 }}>订单编号 {data.order_no}</div>
          </div>
          <span style={{ padding: '5px 12px', borderRadius: 12, background: 'rgba(126,205,187,0.15)', color: '#3E9C8B', fontSize: 13 }}>{data.status_label}</span>
        </div>
        <div style={{ fontSize: 12, color: FAINT, marginTop: 10 }}>下单时间 {fmtTime(data.create_time)}</div>
      </Card>

      {/* 套系预览（对齐后台套系预览 / C端套系预览：封面 + 价格 + 三列网格 + 更多服务全屏弹窗 + 服务详情 + 温馨提示 + 须知） */}
      <Card style={{ marginTop: 12, padding: 0, overflow: 'hidden' }}>
        {/* 封面 16/10 */}
        <div style={{ width: '100%', aspectRatio: '16/10', background: '#f5f5f5', overflow: 'hidden' }}>
          {pkg.cover ? (
            <img src={img(pkg.cover)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ccc', fontSize: 14 }}>暂无封面</div>
          )}
        </div>
        {/* 标题 + 价格 */}
        <div style={{ padding: '16px 16px 14px', borderBottom: '1px solid ' + MBORDER }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#1f2329', lineHeight: 1.4 }}>{pkg.name || '套系'}</div>
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ color: MRED, display: 'flex', alignItems: 'baseline', gap: 1 }}>
              <span style={{ fontSize: 16 }}>¥</span>
              <span style={{ fontSize: 28, fontWeight: 700 }}>{Number(pkg.price || 0).toLocaleString()}</span>
            </span>
            {pkg.deposit ? <span style={{ fontSize: 13, color: '#999' }}>定金: ¥ {Number(pkg.deposit).toLocaleString()}</span> : null}
          </div>
        </div>
        {/* 三列规格网格 + 更多服务 */}
        <div style={{ padding: '12px 16px 16px' }}>
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
        <div style={{ padding: '16px 16px 16px', borderTop: '1px solid ' + MBORDER }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#333', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 3, height: 14, background: MRED, borderRadius: 2, display: 'inline-block' }} />
            服务详情：
          </div>
          <div style={{ fontSize: 14, color: '#555', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{d.service_detail_text || DEFAULT_SERVICE_DETAIL}</div>
        </div>
        {/* 温馨提示 */}
        {d.warm_tips ? (
          <div style={{ padding: '16px 16px 24px', borderTop: '1px solid ' + MBORDER }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#333', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 3, height: 14, background: MRED, borderRadius: 2, display: 'inline-block' }} />
              温馨提示：
            </div>
            <div style={{ fontSize: 14, color: '#555', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{d.warm_tips}</div>
          </div>
        ) : null}
        {/* 须知：退订政策 */}
        {!d.hide_refund && (() => {
          const policy = normalizePolicy(d.refund_policy);
          return (
            <div style={{ padding: '16px 16px 16px', borderTop: '1px solid ' + MBORDER }}>
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
      </Card>

      {/* 套系服务详情全屏弹窗（对齐后台套系预览） */}
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
                <span style={{ fontSize: 14, color: '#666', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.value}</span>
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
                <div style={{ marginTop: 10, fontSize: 13, color: '#666', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{d.service_detail_text || DEFAULT_SERVICE_DETAIL}</div>
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
                      return <div key={i} style={{ marginTop: isHeading && i > 0 ? 8 : 0, marginBottom: 4, fontSize: isHeading ? 14 : 13 }}>{p}</div>;
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
          </div>
          <div style={{ padding: '20px 20px calc(20px + env(safe-area-inset-bottom))', display: 'flex', justifyContent: 'center', borderTop: `1px solid ${MBORDER}`, flexShrink: 0 }}>
            <button onClick={() => { setServiceModalOpen(false); setServiceDetailOpen(false); setRefundOpen(false); setAgreementOpen(false); }} style={{ width: 44, height: 44, borderRadius: '50%', border: '1px solid #ddd', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <IconCloseX />
            </button>
          </div>
        </div>
      )}

      {/* 拍摄信息 */}
      <Card style={{ marginTop: 12 }}>
        <Row label="拍摄日期" value={data.date_tbd ? '日期待定' : (data.shoot_date || '未排期')} />
        <Row label="拍摄时间" value={timeSlots.length ? timeSlots.join('、') : (data.date_tbd ? '待定' : '未填写')} />
        <Row label="拍摄地点" value={data.address || '未填写'} />
        {exes.length > 0 && (
          <Row label="执行人" value={exes.map((e) => e.name).join('、')} />
        )}
      </Card>

      {/* 消费明细 */}
      {extra.length > 0 && (
        <Card style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, color: SUB, marginBottom: 10 }}>消费明细</div>
          {extra.map((x, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: i > 0 ? '1px solid ' + LINE : 'none' }}>
              <div style={{ fontSize: 14, color: TEXT }}>
                <div>{x.label || x.name || x.type || '其他消费'}</div>
                {x.note && <div style={{ fontSize: 12, color: FAINT, marginTop: 2 }}>{x.note}</div>}
              </div>
              <div style={{ fontSize: 14, color: x.amount < 0 ? '#3E9C8B' : TEXT }}>¥{Number(x.amount || 0).toFixed(2)}</div>
            </div>
          ))}
        </Card>
      )}

      {/* 金额 */}
      <Card style={{ marginTop: 12 }}>
        <Row label="支付状态" value={data.payment_status_label} />
        <Row label="订单金额" value={'¥' + Number(data.total_amount || 0).toFixed(2)} color="#FF5A5F" />
        <Row label="已付金额" value={'¥' + Number(data.paid_amount || 0).toFixed(2)} />
        <Row label="待付金额" value={'¥' + Number(data.balance || 0).toFixed(2)} color={data.balance > 0 ? '#F5A623' : TEXT} />
      </Card>

      {/* 合同预览 / 下载（走后端鉴权中转，customer_token 鉴权，不暴露公开 URL） */}
      {data.contract_available && (
        <Card style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, color: SUB, marginBottom: 10 }}>合同</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <a href={BASE + '/api/contract/download/' + data.order_id + '?customer_token=' + token} target="_blank" rel="noreferrer"
              style={{ flex: 1, textAlign: 'center', padding: '12px 0', borderRadius: 12, background: '#fff', color: BRAND, fontSize: 14, border: '1px solid ' + BRAND, textDecoration: 'none' }}>预览合同</a>
            <a href={BASE + '/api/contract/download/' + data.order_id + '?customer_token=' + token + '&dl=1'}
              style={{ flex: 1, textAlign: 'center', padding: '12px 0', borderRadius: 12, background: BRAND, color: '#fff', fontSize: 14, textDecoration: 'none' }}>下载合同 PDF</a>
          </div>
        </Card>
      )}
      {!data.contract_available && data.contract_invalid && (
        <Card style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, color: '#FF4D4F' }}>合同已作废</div>
        </Card>
      )}

      {/* 电子服务协议签署（订单维度强制签署；手写签名绑定订单） */}
      {(agreement.force_agreement || agreement.agreement_signed) && (
        <Card style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 13, color: TEXT }}>电子服务协议</div>
              <div style={{ fontSize: 12, color: agreement.agreement_signed ? BRAND : '#F5A623', marginTop: 4 }}>
                {agreement.agreement_signed ? '已签署' : '待签署（商家要求签署后交付）'}
              </div>
            </div>
            {!agreement.agreement_signed && (
              <button type="button" onClick={() => setSignOpen(true)}
                style={{ padding: '9px 18px', borderRadius: 12, border: 'none', background: BRAND, color: '#fff', fontSize: 13, cursor: 'pointer' }}>
                去签署
              </button>
            )}
          </div>
          {agreement.history && agreement.history.length > 0 && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid ' + LINE, fontSize: 12, color: SUB }}>
              {agreement.history.map((h) => (
                <div key={h.id} style={{ padding: '3px 0' }}>签署记录：{h.customer_name || '客户'} · {fmtTime(h.signed_at)}</div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* 选片入口 */}
      {data.selection_url && (
        <button onClick={() => nav(data.selection_url)}
          style={{ width: '100%', marginTop: 16, padding: '14px 0', borderRadius: 14, background: BRAND, color: '#fff', fontSize: 15, border: 'none', cursor: 'pointer', boxShadow: '0 8px 20px rgba(126,205,187,0.35)' }}>
          进入选片
        </button>
      )}

      {/* 改期/取消申请（仅提交申请，由商家审核操作，不直接改订单） */}
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button type="button" onClick={() => openReq('reschedule')}
          style={{ flex: 1, padding: '12px 0', borderRadius: 12, background: '#fff', color: BRAND, fontSize: 14, border: '1px solid ' + BRAND }}>
          申请改期
        </button>
        <button type="button" onClick={() => openReq('cancel')}
          style={{ flex: 1, padding: '12px 0', borderRadius: 12, background: '#fff', color: '#FF4D4F', fontSize: 14, border: '1px solid #FF4D4F' }}>
          申请取消
        </button>
      </div>

      {/* 申请弹窗 */}
      {reqOpen && (
        <div onClick={() => setReqOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: '20px', width: '100%', maxWidth: 340 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: TEXT, marginBottom: 4 }}>{reqType === 'reschedule' ? '申请改期' : '申请取消'}</div>
            <div style={{ fontSize: 12, color: FAINT, marginBottom: 16 }}>提交后摄影师会审核处理，不会自动变更订单</div>
            {reqType === 'reschedule' && (
              <label style={{ display: 'block', fontSize: 13, color: SUB, marginBottom: 12 }}>
                期望拍摄日期
                <input type="date" value={reqDate} onChange={(e) => setReqDate(e.target.value)}
                  style={{ width: '100%', marginTop: 6, padding: '10px 12px', borderRadius: 10, border: '1px solid #E8E8EA', fontSize: 14, boxSizing: 'border-box', outline: 'none' }} />
              </label>
            )}
            <label style={{ display: 'block', fontSize: 13, color: SUB, marginBottom: 16 }}>
              申请原因
              <textarea value={reqReason} onChange={(e) => setReqReason(e.target.value)} rows={3} placeholder="请填写原因"
                style={{ width: '100%', marginTop: 6, padding: '10px 12px', borderRadius: 10, border: '1px solid #E8E8EA', fontSize: 14, boxSizing: 'border-box', outline: 'none', resize: 'none' }} />
            </label>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={() => setReqOpen(false)} disabled={reqBusy}
                style={{ flex: 1, padding: '11px 0', borderRadius: 10, background: '#F0F0F2', color: SUB, fontSize: 14, border: 'none' }}>取消</button>
              <button type="button" onClick={submitReq} disabled={reqBusy}
                style={{ flex: 1, padding: '11px 0', borderRadius: 10, background: reqType === 'cancel' ? '#FF4D4F' : BRAND, color: '#fff', fontSize: 14, border: 'none', opacity: reqBusy ? 0.6 : 1 }}>
                {reqBusy ? '提交中…' : '提交申请'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 电子服务协议签署弹窗（协议内容 + 手写签名） */}
      {signOpen && (
        <div onClick={() => setSignOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: '20px', width: '100%', maxWidth: 420, maxHeight: '86vh', overflowY: 'auto' }}>
            <div style={{ fontSize: 16, color: TEXT, marginBottom: 4 }}>签署电子服务协议</div>
            <div style={{ fontSize: 12, color: FAINT, marginBottom: 12 }}>请阅读下方协议后，在签名区手写签名确认</div>
            <div style={{ maxHeight: '40vh', overflowY: 'auto', fontSize: 12, color: SUB, lineHeight: 1.7, whiteSpace: 'pre-wrap', background: '#FAFAFA', borderRadius: 10, padding: 12 }}>
              {(() => { const paras = toParagraphs(getServiceAgreement(data && data.package ? data.package.details || {} : {})); return paras.map((p, i) => <div key={i} style={{ marginBottom: 4 }}>{p}</div>); })()}
            </div>
            <div style={{ fontSize: 13, color: SUB, margin: '14px 0 8px' }}>手写签名区</div>
            <canvas ref={signCanvasRef} width={380} height={140}
              onPointerDown={signStart} onPointerMove={signMove} onPointerUp={signEnd} onPointerLeave={signEnd}
              style={{ width: '100%', height: 140, border: '1px solid #E8E8EA', borderRadius: 10, background: '#fff', touchAction: 'none', display: 'block' }} />
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button type="button" onClick={clearSign} style={{ flex: 1, padding: '11px 0', borderRadius: 10, background: '#F0F0F2', color: SUB, fontSize: 14, border: 'none' }}>清除</button>
              <button type="button" onClick={submitSign} disabled={signBusy}
                style={{ flex: 2, padding: '11px 0', borderRadius: 10, background: BRAND, color: '#fff', fontSize: 14, border: 'none', opacity: signBusy ? 0.6 : 1 }}>
                {signBusy ? '提交中…' : '确认签署'}
              </button>
            </div>
            <button type="button" onClick={() => setSignOpen(false)} style={{ width: '100%', marginTop: 10, padding: '10px 0', borderRadius: 10, background: 'none', color: SUB, fontSize: 13, border: 'none' }}>取消</button>
          </div>
        </div>
      )}

      <div style={{ textAlign: 'center', fontSize: 12, color: FAINT, marginTop: 24 }}>YEZHE WORKSHOP · 订单信息仅供查看</div>
      </div>
    </div>
  );
}