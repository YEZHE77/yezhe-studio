import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { customerHttp } from '../utils/customerAuth.js';

// ===== C 端免验证码手机号登录（/customer/login）=====
// 完整登录流程（修复「点击无反应」）：
//  1) <form onSubmit> + button type="submit"：点击与回车都走同一提交；preventDefault 防页面刷新
//  2) 校验：空手机号 / 非 11 位 → 内联红字提示
//  3) 调用 POST /api/customer/login（24h cookie 会话）
//  4) 加载中：按钮禁用 + 文案「登录中…」，输入框同时禁用，杜绝重复提交
//  5) 成功：跳转 /customer/mine；失败：按后端 message / 429 限流 / 无网络 / 超时分类提示
//  6) catch-all 兜底：任何同步/异步异常都落到界面提示，绝不静默
const TEXT = '#1D1D1F';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';
const BRAND = '#7ECDBB';
const DANGER = '#E5484D';

const glass = { background: 'rgba(255,255,255,0.66)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' };
const softCard = { background: '#fff', borderRadius: 20, boxShadow: '0 8px 24px rgba(31,35,41,0.06)' };

// 把登录请求异常翻译成用户可读提示（customerHttp 无全局拦截器，需在此处理）
function loginErrorText(ex) {
  if (!ex) return '登录失败，请稍后重试';
  const status = ex.response && ex.response.status;
  const data = ex.response && ex.response.data;
  if (data && data.error) return String(data.error);           // 后端业务错误（403 无记录 / 400 格式 / 429 限流）
  if (!ex.response) {
    if (ex.code === 'ECONNABORTED') return '请求超时，请检查网络后重试';
    return '网络连接失败，请检查网络后重试';
  }
  if (status === 429) return '访问过于频繁，请稍后再试';
  return '登录失败，请稍后重试';
}

export default function CustomerLogin() {
  const nav = useNavigate();
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    if (e && e.preventDefault) e.preventDefault(); // 防表单默认提交导致页面刷新
    const p = phone.trim();
    setErr('');
    if (!p) { setErr('请输入手机号'); return; }
    if (!/^1\d{10}$/.test(p)) { setErr('请输入正确的 11 位手机号'); return; }
    setBusy(true);
    try {
      const r = await customerHttp.post('/api/customer/login', { phone: p }, { timeout: 15000 });
      if (r.data && r.data.ok) {
        nav('/customer/mine', { replace: true });
        return;
      }
      setErr('登录失败，请稍后重试');
    } catch (ex) {
      setErr(loginErrorText(ex));
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

          <form onSubmit={submit} noValidate>
            <label style={{ display: 'block', fontSize: 13, color: SUB, marginBottom: 20 }}>
              手机号
              <input type="tel" inputMode="numeric" maxLength={11} value={phone} placeholder="请输入 11 位手机号" disabled={busy}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                style={{ ...inputStyle, marginTop: 6, opacity: busy ? 0.6 : 1 }} />
            </label>

            {/* 校验 / 登录失败提示（任何异常都会落到这里，保证界面有响应） */}
            {err && (
              <div role="alert" style={{ fontSize: 13, color: DANGER, marginBottom: 12, background: 'rgba(229,72,77,0.06)', border: '1px solid rgba(229,72,77,0.18)', borderRadius: 10, padding: '10px 12px', lineHeight: 1.5 }}>{err}</div>
            )}

            <button type="submit" disabled={busy} aria-busy={busy}
              style={{ width: '100%', padding: '14px 0', borderRadius: 14, border: 'none', background: BRAND, color: '#fff', fontSize: 15, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, boxShadow: '0 8px 20px rgba(126,205,187,0.32)' }}>
              {busy ? '登录中…' : '登录'}
            </button>
          </form>

          <div style={{ textAlign: 'center', fontSize: 12, color: FAINT, marginTop: 18 }}>仅校验手机号下是否存在订单记录，不开放注册</div>
        </div>
      </div>
    </div>
  );
}