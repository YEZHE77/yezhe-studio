import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import http, { BASE } from '../api.js';

// ===== C 端客户自助查订单（/customer/query-order）=====
// Glassmorphism 玻璃拟态 + Soft-UI 柔性拟态；禁止字体加粗，靠灰度/字号/间距区分层级
// 流程：手机号 + 图形验证码 → 查询 → 订单列表 → 订单详情（可预览合同）→ 跳转作品集 H5
const TEXT = '#1D1D1F';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';
const LINE = '#F0F0F2';
const BRAND = '#7ECDBB';

// 玻璃容器：半透明白 + 背景模糊
const glass = { background: 'rgba(255,255,255,0.66)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' };
// Soft-UI 卡片：白底 + 柔和阴影
const softCard = { background: '#fff', borderRadius: 16, boxShadow: '0 8px 24px rgba(31,35,41,0.06)' };

function Field({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '13px 0', borderBottom: '1px solid ' + LINE }}>
      <span style={{ fontSize: 13, color: SUB, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 14, color: value ? TEXT : FAINT, textAlign: 'right', maxWidth: '62%', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{value || '—'}</span>
    </div>
  );
}

export default function QueryOrder() {
  const nav = useNavigate();
  const [phone, setPhone] = useState('');
  const [captcha, setCaptcha] = useState({ id: '', image: '' });
  const [captchaCode, setCaptchaCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [portfolioUrl, setPortfolioUrl] = useState('');
  const [token, setToken] = useState('');
  const [showPrice, setShowPrice] = useState(false);
  const [orders, setOrders] = useState(null);   // null=未查询 / [] 空 / [...] 有结果
  const [detail, setDetail] = useState(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [toast, setToast] = useState('');

  const flashToast = (m) => { setToast(m); setTimeout(() => setToast(''), 1600); };

  const refreshCaptcha = () => {
    http.get('/api/query-order/captcha')
      .then((r) => setCaptcha({ id: r.data.captchaId, image: r.data.image }))
      .catch(() => {});
  };

  useEffect(() => {
    refreshCaptcha();
    // 作品集 H5 链接 + 价格开关（来自工作室设置）
    http.get('/api/settings/studio')
      .then((r) => {
        const s = r.data || {};
        setPortfolioUrl(s.portfolioUrl || '');
        setShowPrice(!!s.showPriceToCustomer);
      })
      .catch(() => {});
  }, []);

  const submit = async () => {
    setErr('');
    if (!/^1\d{10}$/.test(phone.trim())) { setErr('请输入正确的 11 位手机号'); return; }
    if (!captchaCode.trim()) { setErr('请输入验证码'); return; }
    setBusy(true);
    try {
      const r = await http.post('/api/query-order/search', { phone: phone.trim(), captchaId: captcha.id, captchaCode: captchaCode.trim() });
      setToken(r.data.token);
      setShowPrice(!!r.data.showPrice);
      setOrders(r.data.orders || []);
      setDetail(null);
      if (!(r.data.orders && r.data.orders.length)) {
        setErr('未查询到该手机号对应的订单，请核对手机号');
      }
    } catch (e) {
      setErr((e.response && e.response.data && e.response.data.error) || (e.message || '查询失败'));
    } finally {
      setBusy(false);
      refreshCaptcha();
      setCaptchaCode('');
    }
  };

  const openDetail = async (id) => {
    setDetailBusy(true);
    try {
      const r = await http.get('/api/query-order/order/' + id, { params: { query_token: token } });
      setDetail(r.data);
      setDetailBusy(false);
    } catch (e) {
      setDetailBusy(false);
      flashToast((e.response && e.response.data && e.response.data.error) || '加载失败');
    }
  };

  const backToList = () => { setDetail(null); };

  const inputStyle = {
    width: '100%', boxSizing: 'border-box', padding: '13px 14px', borderRadius: 12,
    border: '1px solid #E8E8EA', background: '#fff', fontSize: 15, color: TEXT, outline: 'none'
  };

  return (
    <div style={{ minHeight: '100vh', background: '#F2F2F5', color: TEXT, paddingBottom: 40 }}>
      {/* 玻璃顶栏 */}
      <div style={{ ...glass, position: 'sticky', top: 0, zIndex: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
        <button onClick={() => nav(-1)} style={{ background: 'none', border: 'none', fontSize: 16, color: TEXT, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ fontSize: 20, lineHeight: 1 }}>‹</span>订单查询
        </button>
        <span style={{ fontSize: 12, color: FAINT }}>仅限本人订单</span>
      </div>

      <div style={{ padding: '20px 18px' }}>
        {/* 查询表单卡片 */}
        {!detail && (
          <div style={{ ...softCard, padding: 20 }}>
            <div style={{ fontSize: 16, color: TEXT, marginBottom: 4 }}>客户自助查订单</div>
            <div style={{ fontSize: 12, color: FAINT, marginBottom: 18 }}>输入下单时预留的手机号，核验后查询本人订单</div>

            <label style={{ display: 'block', fontSize: 13, color: SUB, marginBottom: 10 }}>
              手机号
              <input type="tel" inputMode="numeric" maxLength={11} value={phone} placeholder="请输入 11 位手机号"
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                style={{ ...inputStyle, marginTop: 6 }} />
            </label>

            <label style={{ display: 'block', fontSize: 13, color: SUB, marginBottom: 18 }}>
              图形验证码
              <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                <input value={captchaCode} placeholder="输入验证码" maxLength={4}
                  onChange={(e) => setCaptchaCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                  style={{ ...inputStyle, flex: 1, letterSpacing: 2 }} />
                <button onClick={refreshCaptcha} style={{ flexShrink: 0, padding: 0, border: '1px solid #E8E8EA', borderRadius: 12, background: '#fff', overflow: 'hidden', cursor: 'pointer', lineHeight: 0 }}>
                  {captcha.image ? <img src={captcha.image} alt="验证码" style={{ width: 110, height: 46, display: 'block' }} /> : <span style={{ width: 110, height: 46, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: FAINT }}>加载中</span>}
                </button>
              </div>
              <div style={{ fontSize: 11, color: FAINT, marginTop: 6 }}>看不清？点击图片刷新</div>
            </label>

            {err && <div style={{ fontSize: 13, color: '#E5484D', marginBottom: 12 }}>{err}</div>}

            <button onClick={submit} disabled={busy}
              style={{ width: '100%', padding: '14px 0', borderRadius: 14, border: 'none', background: BRAND, color: '#fff', fontSize: 15, cursor: 'pointer', opacity: busy ? 0.6 : 1, boxShadow: '0 8px 20px rgba(126,205,187,0.32)' }}>
              {busy ? '查询中…' : '查询订单'}
            </button>
          </div>
        )}

        {/* 订单列表 */}
        {!detail && orders !== null && orders.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 13, color: SUB, marginBottom: 10 }}>共 {orders.length} 个订单</div>
            {orders.map((o) => (
              <div key={o.id} onClick={() => openDetail(o.id)} style={{ ...softCard, padding: 16, marginBottom: 12, cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 15, color: TEXT }}>{o.package_name || '订单 ' + (o.order_no || o.id)}</span>
                  <span style={{ fontSize: 12, padding: '4px 10px', borderRadius: 10, background: 'rgba(126,205,187,0.15)', color: '#3E9C8B' }}>{o.status_label}</span>
                </div>
                <div style={{ fontSize: 12, color: FAINT, marginTop: 8 }}>订单号 {o.order_no || '—'}</div>
                <div style={{ fontSize: 13, color: SUB, marginTop: 6 }}>拍摄日期 {o.shoot_date}</div>
                {o.style && <div style={{ fontSize: 13, color: SUB, marginTop: 4 }}>拍摄风格 {o.style}</div>}
                <div style={{ fontSize: 12, color: FAINT, marginTop: 8, textAlign: 'right' }}>查看详情 ›</div>
              </div>
            ))}
          </div>
        )}

        {/* 空结果提示 */}
        {!detail && orders !== null && orders.length === 0 && (
          <div style={{ ...softCard, padding: 40, marginTop: 16, textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
            <div style={{ fontSize: 15, color: TEXT }}>未查询到该手机号对应的订单</div>
            <div style={{ fontSize: 13, color: FAINT, marginTop: 6 }}>请核对手机号是否为下单时预留的号码</div>
            <button onClick={() => setOrders(null)} style={{ marginTop: 18, padding: '10px 24px', borderRadius: 12, border: '1px solid ' + BRAND, background: '#fff', color: BRAND, fontSize: 14, cursor: 'pointer' }}>重新查询</button>
          </div>
        )}

        {/* 订单详情 */}
        {detail && (
          <div>
            <div style={{ ...softCard, padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 16, color: TEXT }}>{detail.package_name || '订单详情'}</span>
                <span style={{ fontSize: 12, padding: '4px 10px', borderRadius: 10, background: 'rgba(126,205,187,0.15)', color: '#3E9C8B' }}>{detail.status_label}</span>
              </div>
              <div style={{ fontSize: 12, color: FAINT }}>订单号 {detail.order_no || '—'}</div>
              <div style={{ marginTop: 8 }}>
                <Field label="拍摄日期" value={detail.shoot_date} />
                <Field label="套系名称" value={detail.package_name} />
                <Field label="拍摄风格" value={detail.style} />
                <Field label="拍摄进度" value={detail.status_label} />
                <Field label="预约备注" value={detail.remark} />
                {showPrice && (
                  <>
                    <Field label="订单金额" value={'¥' + Number(detail.total_amount || 0).toFixed(2)} />
                    <Field label="已付金额" value={'¥' + Number(detail.paid_amount || 0).toFixed(2)} />
                    <Field label="待付金额" value={'¥' + Number(detail.balance || 0).toFixed(2)} />
                  </>
                )}
              </div>
            </div>

            {detail.contract_available && (
              <a href={BASE + '/api/contract/download/' + detail.id + '?query_token=' + encodeURIComponent(token)} target="_blank" rel="noreferrer"
                style={{ display: 'block', marginTop: 12, textAlign: 'center', padding: '13px 0', borderRadius: 14, background: '#fff', color: BRAND, fontSize: 14, border: '1px solid ' + BRAND, textDecoration: 'none' }}>
                预览合同
              </a>
            )}

            <button onClick={backToList} style={{ width: '100%', marginTop: 12, padding: '13px 0', borderRadius: 14, border: 'none', background: '#E8E8EA', color: SUB, fontSize: 14, cursor: 'pointer' }}>
              返回列表
            </button>
          </div>
        )}

        {/* 跳转公开作品集 H5 */}
        {portfolioUrl && (
          <a href={portfolioUrl} target="_blank" rel="noreferrer"
            style={{ display: 'block', marginTop: 20, textAlign: 'center', padding: '14px 0', borderRadius: 14, background: '#fff', color: SUB, fontSize: 14, textDecoration: 'none', boxShadow: '0 8px 24px rgba(31,35,41,0.06)' }}>
            查看作品集 ›
          </a>
        )}

        <div style={{ textAlign: 'center', fontSize: 12, color: FAINT, marginTop: 28 }}>订单信息仅供本人核验查询，不可修改</div>
      </div>

      {toast && <div style={{ position: 'fixed', left: '50%', top: 70, transform: 'translateX(-50%)', zIndex: 100, background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 12, padding: '8px 14px', borderRadius: 8 }}>{toast}</div>}
    </div>
  );
}
