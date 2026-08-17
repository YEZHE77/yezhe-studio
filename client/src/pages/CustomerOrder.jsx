import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import http, { img, BASE } from '../api.js';
import { getRefundText, getRefundParagraphs, normalizePolicy } from '../utils/refundPolicy.js';
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
function InfoRow({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0' }}>
      <span style={{ fontSize: 13, color: SUB }}>{label}</span>
      <span style={{ fontSize: 14, color: color || TEXT, textAlign: 'right', maxWidth: '60%', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{value || '—'}</span>
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
  // 套系服务详情展开（交付时间/交付备注/顾客协议等）
  const [serviceDetailOpen, setServiceDetailOpen] = useState(false);
  const [agreementOpen, setAgreementOpen] = useState(false);

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
  const exes = data.executors || [];
  const extra = data.extra_items || [];
  const timeSlots = data.time_slots || [];

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

      {/* 套系详情 */}
      {pkg.name && (
        <Card style={{ marginTop: 12 }}>
          {pkg.cover && <img src={img(pkg.cover)} alt="" style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', borderRadius: 12, marginBottom: 12 }} />}
          <div style={{ fontSize: 17, color: TEXT }}>{pkg.name}</div>
          <div style={{ fontSize: 22, color: '#FF5A5F', marginTop: 6 }}>¥{Number(pkg.price || 0).toFixed(0)}</div>
          {pkg.desc && <div style={{ fontSize: 13, color: SUB, marginTop: 8, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{pkg.desc}</div>}
          <div style={{ marginTop: 12, borderTop: '1px solid ' + LINE, paddingTop: 12 }}>
            <InfoRow label="定金" value={'¥' + Number(pkg.deposit || 0).toFixed(0)} />
            {Number(pkg.additional_price) > 0 && <InfoRow label="加片单价" value={'¥' + Number(pkg.additional_price).toFixed(0) + '/张'} />}
            {pkg.shoot_duration && <InfoRow label="拍摄时长" value={pkg.shoot_duration} />}
            {pkg.shoot_scope && <InfoRow label="拍摄范围" value={pkg.shoot_scope} />}
            <InfoRow label="照片总数" value={pkg.photo_total ? pkg.photo_total + ' 张' : ''} />
            <InfoRow label="精修张数" value={pkg.retouch_count ? pkg.retouch_count + ' 张' : ''} />
            {pkg.original_file && <InfoRow label="原片文件" value={pkg.original_file} />}
          </div>
        </Card>
      )}

      {/* 套系服务详情（与后台套系预览一致：完整字段清单 + 服务详情 + 顾客协议） */}
      <Card style={{ marginTop: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: TEXT, marginBottom: 4 }}>套系服务详情</div>
        <div>
          {[
            { label: '拍摄时长', value: d.duration || '' },
            { label: '原片', value: d.raw_count ? `${d.raw_count}张` : '' },
            { label: '精修片', value: d.retouch_count ? `${d.retouch_count}张` : '' },
            { label: '加片费', value: d.extra_photo_fee || '' },
            { label: '快修费', value: d.quick_repair_cost || '' },
            { label: '交付时间', value: d.delivery_time || '' },
            { label: '交付备注', value: d.delivery_remark || '' },
            { label: '底片', value: d.raw_all_included ? '全部原片' : '仅送精修' },
            { label: '化妆服装', value: `${d.cloth_provide === 'provide' ? '提供服装' : '不提供服装'} · ${d.makeup_provide === 'provide' ? '提供化妆' : '不提供化妆'}` },
            { label: '提供相册', value: d.album_provide === 'provide' ? '是' : d.album_provide === 'extra' ? '相册另购' : '否' },
            { label: '服务地点', value: d.service_location || '' }
          ].filter((r) => r.value).map((r, i) => (
            <InfoRow key={i} label={r.label} value={r.value} />
          ))}
        </div>
        {d.warm_tips && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid ' + LINE }}>
            <div style={{ fontSize: 13, color: SUB, marginBottom: 6 }}>温馨提示</div>
            <div style={{ fontSize: 14, color: TEXT, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{d.warm_tips}</div>
          </div>
        )}
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid ' + LINE }}>
          <div onClick={() => setServiceDetailOpen((v) => !v)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
            <span style={{ fontSize: 14, color: TEXT }}>服务详情</span>
            <span style={{ fontSize: 14, color: BRAND }}>{serviceDetailOpen ? '收起' : '展开'}</span>
          </div>
          {serviceDetailOpen && (
            <div style={{ marginTop: 10, fontSize: 14, color: TEXT, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{d.service_detail_text || DEFAULT_SERVICE_DETAIL}</div>
          )}
        </div>
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid ' + LINE }}>
          <div onClick={() => setAgreementOpen((v) => !v)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
            <span style={{ fontSize: 14, color: TEXT }}>顾客协议</span>
            <span style={{ fontSize: 14, color: BRAND }}>{agreementOpen ? '收起' : '展开'}</span>
          </div>
          {agreementOpen && (
            <div style={{ marginTop: 10, fontSize: 13, color: SUB, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{getServiceAgreement(d)}</div>
          )}
        </div>
      </Card>

      {/* 服务详情 / 温馨提示 */}
      {(pkg.other_service || pkg.notice) && (
        <Card style={{ marginTop: 12 }}>
          {pkg.other_service && (
            <div style={{ marginBottom: pkg.notice ? 14 : 0 }}>
              <div style={{ fontSize: 13, color: SUB, marginBottom: 6 }}>其他服务</div>
              <div style={{ fontSize: 14, color: TEXT, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{pkg.other_service}</div>
            </div>
          )}
          {pkg.notice && (
            <div>
              <div style={{ fontSize: 13, color: SUB, marginBottom: 6 }}>温馨提示</div>
              <div style={{ fontSize: 14, color: TEXT, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{pkg.notice}</div>
            </div>
          )}
        </Card>
      )}

      {/* 退订政策（本订单所属套系的退改规则，客户只读） */}
      <Card style={{ marginTop: 12 }}>
        <div style={{ fontSize: 13, color: SUB, marginBottom: 8 }}>退订政策</div>
        {(() => {
          const rp = normalizePolicy(pkg.refund_policy);
          const paras = getRefundParagraphs(pkg, rp);
          return (
            <div style={{ fontSize: 14, color: TEXT, lineHeight: 1.7 }}>
              {paras.length ? paras.map((line, i) => (
                <div key={i} style={{ marginBottom: i < paras.length - 1 ? 6 : 0 }}>{line}</div>
              )) : <div style={{ color: SUB }}>暂无退订政策</div>}
            </div>
          );
        })()}
      </Card>

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