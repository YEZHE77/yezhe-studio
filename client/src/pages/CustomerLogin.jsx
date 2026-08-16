import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { customerHttp } from '../utils/customerAuth.js';

// ===== C 端客户手机号验证码登录（/customer/login）=====
// Glassmorphism 玻璃拟态 + Soft-UI 柔性拟态；禁止字体加粗，靠灰度/字号/间距区分层级
// 登录成功写入 HttpOnly 会话 cookie（后端 Set-Cookie），自动跳转回作品集 H5
const TEXT = '#1D1D1F';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';
const BRAND = '#7ECDBB';

const glass = { background: 'rgba(255,255,255,0.66)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' };
const softCard = { background: '#fff', borderRadius: 20, boxShadow: '0 8px 24px rgba(31,35,41,0.06)' };

export default function CustomerLogin() {
  const nav = useNavigate();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const [tip, setTip] = useState('');

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const sendCode = async () => {
    setErr('');
    if (!/^1\d{10}$/.test(phone.trim())) { setErr('请输入正确的 11 位手机号'); return; }
    setSending(true);
    try {
      const r = await customerHttp.post('/api/customer-auth/sms/send', { phone: phone.trim() });
      setCountdown(60);
      // 开发环境后端返回 dev_code，便于联调；生产接入短信后不再返回
      setTip(r.data && r.data.dev_code ? ('验证码已发送（测试码 ' + r.data.dev_code + '）') : '验证码已发送');
    } catch (e) {
      setErr((e.response && e.response.data && e.response.data.error) || '发送失败');
    } finally {
      setSending(false);
    }
  };

  const submit = async () => {
    setErr('');
    if (!/^1\d{10}$/.test(phone.trim())) { setErr('请输入正确的 11 位手机号'); return; }
    if (!/^\d{6}$/.test(code.trim())) { setErr('请输入 6 位验证码'); return; }
    setBusy(true);
    try {
      await customerHttp.post('/api/customer-auth/login', { phone: phone.trim(), code: code.trim() });
      nav('/home', { replace: true }); // 登录成功自动跳回作品集 H5
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
      {/* 玻璃顶栏 */}
      <div style={{ ...glass, position: 'sticky', top: 0, zIndex: 20, display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
        <button onClick={() => nav(-1)} style={{ background: 'none', border: 'none', fontSize: 16, color: TEXT, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ fontSize: 20, lineHeight: 1 }}>‹</span>登录
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 20px' }}>
        <div style={{ ...softCard, padding: 28, width: '100%', maxWidth: 360 }}>
          <div style={{ fontSize: 20, color: TEXT, marginBottom: 4 }}>手机号登录</div>
          <div style={{ fontSize: 13, color: FAINT, marginBottom: 22 }}>登录后可查看自己的订单与拍摄档期</div>

          <label style={{ display: 'block', fontSize: 13, color: SUB, marginBottom: 14 }}>
            手机号
            <input type="tel" inputMode="numeric" maxLength={11} value={phone} placeholder="请输入 11 位手机号"
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
              style={{ ...inputStyle, marginTop: 6 }} />
          </label>

          <label style={{ display: 'block', fontSize: 13, color: SUB, marginBottom: 20 }}>
            验证码
            <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
              <input inputMode="numeric" maxLength={6} value={code} placeholder="6 位验证码"
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                style={{ ...inputStyle, flex: 1, letterSpacing: 2 }} />
              <button onClick={sendCode} disabled={sending || countdown > 0}
                style={{ flexShrink: 0, padding: '0 16px', borderRadius: 14, border: '1px solid ' + BRAND, background: '#fff', color: (sending || countdown > 0) ? FAINT : BRAND, fontSize: 14, cursor: (sending || countdown > 0) ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
                {sending ? '发送中' : (countdown > 0 ? countdown + 's' : '获取验证码')}
              </button>
            </div>
          </label>

          {tip && <div style={{ fontSize: 12, color: BRAND, marginBottom: 12 }}>{tip}</div>}
          {err && <div style={{ fontSize: 13, color: '#E5484D', marginBottom: 12 }}>{err}</div>}

          <button onClick={submit} disabled={busy}
            style={{ width: '100%', padding: '14px 0', borderRadius: 14, border: 'none', background: BRAND, color: '#fff', fontSize: 15, cursor: 'pointer', opacity: busy ? 0.6 : 1, boxShadow: '0 8px 20px rgba(126,205,187,0.32)' }}>
            {busy ? '登录中…' : '登录'}
          </button>

          <div style={{ textAlign: 'center', fontSize: 12, color: FAINT, marginTop: 18 }}>未注册手机号将自动创建客户账号</div>
        </div>
      </div>
    </div>
  );
}
