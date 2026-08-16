import React from 'react';

const TEXT = '#1f2329';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';
const BRAND = '#4A9FD8';

// 黑名单拦截视图
export function VisitorBlockedView() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(180deg, #EEF1F5 0%, #F5F7FA 100%)', padding: 24 }}>
      <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#FBEAE7', color: '#E86A5E', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30 }}>🚫</div>
      <div style={{ fontSize: 17, color: TEXT, marginTop: 20 }}>访问受限</div>
      <div style={{ fontSize: 13, color: SUB, marginTop: 8, textAlign: 'center', lineHeight: 1.7 }}>该设备已被限制访问，如有疑问请联系客服</div>
    </div>
  );
}

// 访客密码输入视图
export function VisitorPasswordView({ gate }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(180deg, #EEF1F5 0%, #F5F7FA 100%)', padding: 24 }}>
      <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#EAF3FB', color: BRAND, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30 }}>🔒</div>
      <div style={{ fontSize: 17, color: TEXT, marginTop: 20 }}>内容已加密</div>
      <div style={{ fontSize: 13, color: SUB, marginTop: 8, textAlign: 'center' }}>请输入访问密码以查看作品</div>
      <input type="password" value={gate.pwd} onChange={(e) => gate.setPwd(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') gate.submitPassword(); }} placeholder="访问密码"
        style={{ width: '100%', maxWidth: 280, boxSizing: 'border-box', border: '1px solid #EEF0F3', borderRadius: 12, padding: '12px 14px', fontSize: 15, color: TEXT, outline: 'none', marginTop: 20, background: '#fff' }} />
      {gate.pwdError && <div style={{ fontSize: 12, color: '#E5484D', marginTop: 8 }}>{gate.pwdError}</div>}
      <button onClick={gate.submitPassword} disabled={gate.pwdBusy}
        style={{ width: '100%', maxWidth: 280, marginTop: 14, padding: '12px', borderRadius: 12, border: 'none', background: BRAND, color: '#fff', fontSize: 15, opacity: gate.pwdBusy ? 0.6 : 1 }}>
        {gate.pwdBusy ? '验证中…' : '进入查看'}
      </button>
      <div style={{ fontSize: 11, color: FAINT, marginTop: 16 }}>访客密码由工作室设置，可联系客服获取</div>
    </div>
  );
}
