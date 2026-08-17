import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import http from '../api.js';

// ===== C 端预约提交页（/customer/book）=====
// 客户填写信息提交（姓名/手机号/拍摄类型/意向日期/意向风格/拍摄地点/预算/备注）；提交后不可修改；
// 写入预约表（status=pending 待确认）+ 客资 + B 端收到顾客咨询消息。
// 禁加粗，灰度/字号/间距分层，卡片圆角 + 柔和阴影，移动端优先。
const TEXT = '#1D1D1F';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';
const BRAND = '#7ECDBB';

const inputStyle = { width: '100%', padding: '13px 16px', borderRadius: 14, border: '1px solid #E4E4E7', background: '#fff', fontSize: 15, color: TEXT, boxSizing: 'border-box', outline: 'none' };
const labelStyle = { fontSize: 13, color: SUB, marginBottom: 8, display: 'block' };

const SHOOT_TYPES = ['婚纱照', '写真', '亲子照', '婚礼跟拍', '活动跟拍', '其他'];
const STYLES = ['纪实', '胶片', '户外', '室内', '唯美', '复古', '简约'];
const BUDGETS = ['面议', '3000 以下', '3000-5000', '5000-8000', '8000-12000', '12000 以上'];

export default function AppointmentForm() {
  const nav = useNavigate();
  const [form, setForm] = useState({ name: '', phone: '', shoot_type: '', hope_date: '', style_req: '', location: '', budget: '', remark: '' });
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) { setErr('请填写姓名与手机号'); return; }
    if (!/^1\d{10}$/.test(form.phone.trim())) { setErr('请输入正确的 11 位手机号'); return; }
    setBusy(true); setErr('');
    try {
      await http.post('/api/customer/reservation-submit', {
        name: form.name.trim(),
        phone: form.phone.trim(),
        shoot_type: form.shoot_type,
        hope_date: form.hope_date,
        style_req: form.style_req,
        location: form.location.trim(),
        budget: form.budget,
        remark: form.remark.trim()
      });
      setDone(true);
    } catch (e2) { setErr((e2.response && e2.response.data && e2.response.data.error) || '提交失败'); }
    finally { setBusy(false); }
  };

  if (done) {
    return (
      <div style={{ minHeight: '100vh', background: '#F5F5F7', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
        <div style={{ fontSize: 18, color: TEXT, marginBottom: 8 }}>提交完成，请等待摄影师确认</div>
        <div style={{ fontSize: 13, color: FAINT, marginBottom: 24 }}>我们会在确认后尽快与您联系。</div>
        <button onClick={() => nav('/home')} style={{ padding: '12px 32px', borderRadius: 14, background: BRAND, color: '#fff', fontSize: 14, border: 'none', cursor: 'pointer' }}>返回首页</button>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg,#F7FAF9 0%,#EEF4F1 100%)', padding: 24, display: 'flex', flexDirection: 'column' }}>
      {/* 顶部返回键 */}
      <button onClick={() => nav('/home')} style={{ background: 'none', border: 'none', fontSize: 16, color: TEXT, cursor: 'pointer', alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 2, padding: '0 0 16px' }}>
        <span style={{ fontSize: 20, lineHeight: 1 }}>‹</span>返回
      </button>
      <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: 400, background: 'rgba(255,255,255,0.72)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderRadius: 24, padding: '28px 22px', boxShadow: '0 20px 50px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.7)' }}>
          <div style={{ fontSize: 20, color: TEXT, marginBottom: 4 }}>预约拍摄</div>
          <div style={{ fontSize: 13, color: SUB, marginBottom: 20 }}>填写信息，摄影师将尽快与您确认</div>
          <form onSubmit={submit}>
            <input style={{ ...inputStyle, marginBottom: 14 }} value={form.name} onChange={(e) => set('name')(e.target.value)} placeholder="您的称呼" />
            <input style={{ ...inputStyle, marginBottom: 14 }} type="tel" inputMode="numeric" maxLength={11} value={form.phone} onChange={(e) => set('phone')(e.target.value.replace(/\D/g, ''))} placeholder="联系电话" />

            <div style={{ marginBottom: 14 }}>
              <span style={labelStyle}>拍摄类型</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {SHOOT_TYPES.map((s) => (
                  <button key={s} type="button" onClick={() => set('shoot_type')(form.shoot_type === s ? '' : s)}
                    style={{ padding: '7px 14px', borderRadius: 16, border: '1px solid ' + (form.shoot_type === s ? BRAND : '#E4E4E7'), background: form.shoot_type === s ? 'rgba(126,205,187,0.14)' : '#fff', color: form.shoot_type === s ? BRAND : SUB, fontSize: 13, cursor: 'pointer' }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <span style={labelStyle}>意向日期</span>
              <input style={inputStyle} type="date" value={form.hope_date} onChange={(e) => set('hope_date')(e.target.value)} />
            </div>

            <div style={{ marginBottom: 14 }}>
              <span style={labelStyle}>意向风格</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {STYLES.map((s) => (
                  <button key={s} type="button" onClick={() => set('style_req')(form.style_req === s ? '' : s)}
                    style={{ padding: '7px 14px', borderRadius: 16, border: '1px solid ' + (form.style_req === s ? BRAND : '#E4E4E7'), background: form.style_req === s ? 'rgba(126,205,187,0.14)' : '#fff', color: form.style_req === s ? BRAND : SUB, fontSize: 13, cursor: 'pointer' }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <span style={labelStyle}>拍摄地点</span>
              <input style={inputStyle} value={form.location} onChange={(e) => set('location')(e.target.value)} placeholder="意向拍摄地点（选填）" />
            </div>

            <div style={{ marginBottom: 14 }}>
              <span style={labelStyle}>预算</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {BUDGETS.map((s) => (
                  <button key={s} type="button" onClick={() => set('budget')(form.budget === s ? '' : s)}
                    style={{ padding: '7px 14px', borderRadius: 16, border: '1px solid ' + (form.budget === s ? BRAND : '#E4E4E7'), background: form.budget === s ? 'rgba(126,205,187,0.14)' : '#fff', color: form.budget === s ? BRAND : SUB, fontSize: 13, cursor: 'pointer' }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <span style={labelStyle}>备注</span>
              <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={form.remark} onChange={(e) => set('remark')(e.target.value)} placeholder="其他需求（选填）" />
            </div>

            {err && <div style={{ color: '#FF5A5F', fontSize: 12, marginBottom: 10 }}>{err}</div>}
            <button type="submit" disabled={busy}
              style={{ width: '100%', padding: '14px 0', borderRadius: 14, background: BRAND, color: '#fff', fontSize: 15, border: 'none', cursor: 'pointer', opacity: busy ? 0.5 : 1, boxShadow: '0 8px 20px rgba(126,205,187,0.35)' }}>
              {busy ? '提交中…' : '提交预约'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
