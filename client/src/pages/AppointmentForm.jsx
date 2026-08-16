import React, { useState } from 'react';
import http from '../api.js';

// ===== C 端公开预约表单 =====
// 客户填写信息提交；提交后不可修改；写入客资 + B 端收到顾客咨询消息
const TEXT = '#1D1D1F';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';
const BRAND = '#7ECDBB';

const inputStyle = { width: '100%', padding: '13px 16px', borderRadius: 14, border: '1px solid #E4E4E7', background: '#fff', fontSize: 15, color: TEXT, boxSizing: 'border-box', outline: 'none' };

export default function AppointmentForm() {
  const [form, setForm] = useState({ name: '', phone: '', hope_date: '', style_req: '', remark: '' });
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const STYLES = ['纪实', '胶片', '户外', '室内', '唯美', '复古', '简约'];

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) { setErr('请填写称呼与联系电话'); return; }
    setBusy(true); setErr('');
    try {
      await http.post('/api/public/appointment', form);
      setDone(true);
    } catch (e2) { setErr((e2.response && e2.response.data && e2.response.data.error) || '提交失败'); }
    finally { setBusy(false); }
  };

  if (done) {
    return (
      <div style={{ minHeight: '100vh', background: '#F5F5F7', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
        <div style={{ fontSize: 18, color: TEXT, marginBottom: 8 }}>提交完成，请等待摄影师确认</div>
        <div style={{ fontSize: 13, color: FAINT }}>我们会在确认后尽快与您联系。</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg,#F7FAF9 0%,#EEF4F1 100%)', padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 400, background: 'rgba(255,255,255,0.72)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderRadius: 24, padding: '28px 22px', boxShadow: '0 20px 50px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.7)' }}>
        <div style={{ fontSize: 20, color: TEXT, marginBottom: 4 }}>预约拍摄</div>
        <div style={{ fontSize: 13, color: SUB, marginBottom: 20 }}>填写信息，摄影师将尽快与您确认</div>
        <form onSubmit={submit}>
          <input style={{ ...inputStyle, marginBottom: 12 }} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="您的称呼" />
          <input style={{ ...inputStyle, marginBottom: 12 }} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="联系电话" />
          <input style={{ ...inputStyle, marginBottom: 12 }} type="date" value={form.hope_date} onChange={(e) => setForm((f) => ({ ...f, hope_date: e.target.value }))} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {STYLES.map((s) => (
              <button key={s} type="button" onClick={() => setForm((f) => ({ ...f, style_req: f.style_req === s ? '' : s }))}
                style={{ padding: '7px 14px', borderRadius: 16, border: '1px solid ' + (form.style_req === s ? BRAND : '#E4E4E7'), background: form.style_req === s ? 'rgba(126,205,187,0.14)' : '#fff', color: form.style_req === s ? BRAND : SUB, fontSize: 13, cursor: 'pointer' }}>
                {s}
              </button>
            ))}
          </div>
          <textarea style={{ ...inputStyle, marginBottom: 12, minHeight: 70 }} value={form.remark} onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value }))} placeholder="备注（选填）" />
          {err && <div style={{ color: '#FF5A5F', fontSize: 12, marginBottom: 10 }}>{err}</div>}
          <button type="submit" disabled={busy}
            style={{ width: '100%', padding: '14px 0', borderRadius: 14, background: BRAND, color: '#fff', fontSize: 15, border: 'none', cursor: 'pointer', opacity: busy ? 0.5 : 1, boxShadow: '0 8px 20px rgba(126,205,187,0.35)' }}>
            {busy ? '提交中…' : '提交预约'}
          </button>
        </form>
      </div>
    </div>
  );
}
