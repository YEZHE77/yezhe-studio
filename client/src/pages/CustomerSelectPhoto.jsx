import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import http from '../api.js';

// ===== 颜色 / 字体常量（玻璃拟态 Soft-UI；禁止字体加粗，仅灰度、字号、间距分层）=====
const TEXT = '#1f2329';
const SUB = '#6b7280';
const MUTED = '#9ca3af';
const BRAND = '#4A9FD8';

function isWechat() {
  try { return /MicroMessenger/i.test(navigator.userAgent); } catch { return false; }
}

function copyText(text, onOk) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(onOk).catch(() => fallbackCopy(text, onOk));
  } else {
    fallbackCopy(text, onOk);
  }
}
function fallbackCopy(text, onOk) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    onOk();
  } catch { onOk(); }
}

// 微信中转引导页（不加载任何选片/订单内容）
function WechatGuide({ fullUrl }) {
  const [copied, setCopied] = useState(false);
  const doCopy = () => {
    copyText(fullUrl, () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };
  return (
    <div style={{ minHeight: '100vh', background: '#f9f8f6', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, boxSizing: 'border-box' }}>
      <div style={{ width: '100%', maxWidth: 360, background: 'rgba(255,255,255,0.72)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderRadius: 20, boxShadow: '0 8px 24px rgba(31,35,41,0.06), 0 1px 3px rgba(31,35,41,0.04)', padding: '28px 22px' }}>
        <div style={{ textAlign: 'center', fontSize: 44, lineHeight: 1 }}>🔔</div>
        <div style={{ textAlign: 'center', fontSize: 17, color: TEXT, marginTop: 14, lineHeight: 1.5 }}>选片页面无法在微信内打开</div>
        <div style={{ textAlign: 'center', fontSize: 13, color: SUB, marginTop: 8, lineHeight: 1.7 }}>请长按复制下方完整链接，粘贴到手机系统浏览器打开</div>

        <div style={{ marginTop: 20, background: 'rgba(31,35,41,0.04)', borderRadius: 12, padding: '14px 12px' }}>
          <div style={{ fontSize: 12, color: MUTED, marginBottom: 6 }}>完整访问链接</div>
          <div style={{ fontSize: 12, color: SUB, lineHeight: 1.6, wordBreak: 'break-all', userSelect: 'all' }}>{fullUrl}</div>
        </div>

        <button
          onClick={doCopy}
          style={{ width: '100%', marginTop: 18, padding: '13px 0', borderRadius: 12, background: copied ? '#5bb5e6' : BRAND, color: '#fff', fontSize: 15, border: 'none', cursor: 'pointer', letterSpacing: 1 }}
        >
          {copied ? '已复制 ✓' : '一键复制链接'}
        </button>

        <div style={{ marginTop: 24, borderTop: '1px solid rgba(31,35,41,0.08)', paddingTop: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, color: '#3aa675' }}>✅ 支持 Safari、Chrome、小米浏览器、华为浏览器</div>
          <div style={{ fontSize: 12, color: '#d97706' }}>⚠️ 微信浏览器存在限制，无法加载图片选片功能</div>
        </div>
      </div>
    </div>
  );
}

// 无权限 / 参数缺失提示页
function NoAccess({ reason }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f9f8f6', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, boxSizing: 'border-box' }}>
      <div style={{ width: '100%', maxWidth: 340, background: '#fff', borderRadius: 16, boxShadow: '0 8px 24px rgba(31,35,41,0.06)', padding: '32px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 40, lineHeight: 1 }}>🔒</div>
        <div style={{ fontSize: 16, color: TEXT, marginTop: 14 }}>无权限访问</div>
        <div style={{ fontSize: 13, color: SUB, marginTop: 8, lineHeight: 1.6 }}>{reason}</div>
      </div>
    </div>
  );
}

export default function CustomerSelectPhoto() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const orderId = params.get('orderId');
  const token = params.get('token');
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    // 微信内置浏览器：只渲染中转引导页，不加载选片业务、不请求任何订单数据
    if (isWechat()) { setChecking(false); return; }
    if (!orderId || !token) {
      setError('链接参数缺失，请联系商家重新发送选片链接');
      setChecking(false);
      return;
    }
    http.get('/api/selection/customer-select/validate', { params: { orderId, token } })
      .then(() => {
        // 校验通过：进入真正的客户选片页面（复用现有 /s/:token 选片业务，token 即 customer_token 强绑定订单）
        nav('/s/' + token, { replace: true });
      })
      .catch((e) => {
        setError((e.response && e.response.data && e.response.data.reason) || '链接无效或已过期，请联系商家重新发送');
        setChecking(false);
      });
  }, [orderId, token, nav]);

  if (isWechat()) {
    return <WechatGuide fullUrl={typeof window !== 'undefined' ? window.location.href : ''} />;
  }
  if (error) return <NoAccess reason={error} />;
  if (checking) {
    return (
      <div style={{ minHeight: '100vh', background: '#f9f8f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="inline-block w-5 h-5 border-2 border-brand/30 border-t-brand rounded-full animate-spin" />
      </div>
    );
  }
  return null;
}
