import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { customerHttp } from '../utils/customerAuth.js';

// ===== C 端免验证码手机号登录（/customer/login）=====
// 非开放注册。提交手机号 → 后端校验该手机号是否有订单记录 → 有则创建 24h cookie 会话并跳 /customer/mine；没有则提示。
// Glassmorphism 玻璃拟态 + Soft-UI 柔性拟态；禁加粗，靠灰度/字号/间距分层
const TEXT = '#1D1D1F';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';
const BRAND = '#7ECDBB';

const glass = { background: 'rgba(255,255,255,0.66)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' };
const softCard = { background: '#fff', borderRadius: 20, boxShadow: '0 8px 24px rgba(31,35,41,0.06)' };

export default function CustomerLogin() {
  const nav = useNavigate();
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    setErr('');
    if (!/^1\d{10}$/.test(phone.trim())) { setErr('请输入正确的 11 位手机号'); return; }
    setBusy(true);
    try {
      const r = await customerHttp.post('/api/customer/login', { phone: phone.trim() });
      if (r.data && r.data.ok) {
        nav('/customer/mine', { replace: true });
      }
    } catch (e) {
      setErr((e.response && e.response.data && e.response.data.error) || '登录失败');
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = {
    width: '100%', boxSizing: 'border-box', padding: '14px 16px', borderRadius: 14,
    border: '1px solid #E8E8EA', background: '#fff', fontSize: 15, color: TEXT, outline: 'none'
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg,#F2F2F5,#EAF4F1)', color: TEXT, display: 'flex', flexDirection: 'column' }}>
      <div style={{ ...glass, position: 'sticky', top: 0, zIndex: 20, display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
        <button onClick={() => nav(-1)} style={{ background: 'none', border: 'none', fontSize: 16, color: TEXT, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ fontSize: 20, lineHeight: 1 }}>‹</span>登录
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 20px' }}>
        <div style={{ ...softCard, padding: 28, width: '100%', maxWidth: 360 }}>
          <div style={{ fontSize: 20, color: TEXT, marginBottom: 4 }}>手机号登录</div>
          <div style={{ fontSize: 13, color: FAINT, marginBottom: 22 }}>仅限已有订单的客户登录</div>

          <label style={{ display: 'block', fontSize: 13, color: SUB, marginBottom: 20 }}>
            手机号
            <input type="tel" inputMode="numeric" maxLength={11} value={phone} placeholder="请输入 11 位手机号"
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              style={{ ...inputStyle, marginTop: 6 }} />
          </label>

          {err && <div style={{ fontSize: 13, color: '#E5484D', marginBottom: 12 }}>{err}</div>}

          <button onClick={submit} disabled={busy}
            style={{ width: '100%', padding: '14px 0', borderRadius: 14, border: 'none', background: BRAND, color: '#fff', fontSize: 15, cursor: 'pointer', opacity: busy ? 0.6 : 1, boxShadow: '0 8px 20px rgba(126,205,187,0.32)' }}>
            {busy ? '校验中…' : '登录'}
          </button>

          <div style={{ textAlign: 'center', fontSize: 12, color: FAINT, marginTop: 18 }}>仅校验手机号下是否存在订单记录，不开放注册</div>
        </div>
      </div>
    </div>
  );
}