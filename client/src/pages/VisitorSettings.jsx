import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import http from '../api.js';

// 移动端「访客设置」页 —— iOS 设置风格复刻（白底 + 浅分隔线 + 分组标题 + 圆形 emoji 图标）
// 规范：禁止字体加粗，仅灰度 / 字号 / 间距区分层级
// 已按需求移除：访客微信授权 / 仅显示有昵称记录 / 访客手机验证 / 微信额度提示（H5 无小程序接口）
// 保留：黑名单 / 免打扰 / 访客密码 / 导出访客Excel
const TEXT = '#1f2329';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';
const MUTED = '#8E8E93';
const DIV = '#EFEFF1';
const BRAND = '#007AFF';

// ===== 帮助图标 =====
const HelpIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#AEAEB2" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);
const Chevron = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#C8C8CC" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

// 圆形 emoji 图标（参考图风格：emoji 在柔和彩色圆形里，字号=圆形直径的50%）
function RoundIcon({ emoji, bg, size = 30 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: size / 2, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: Math.round(size * 0.5), lineHeight: 1 }}>{emoji}</div>
  );
}

// ===== 列表项（iOS 风格：白底 + 1px 浅分隔线 + 圆形 emoji 图标 + chevron）=====
function Row({ emoji, bg, title, subtitle, right, onClick, last }) {
  return (
    <button onClick={onClick}
      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', border: 'none', background: '#fff', textAlign: 'left', cursor: 'pointer', borderBottom: last ? 'none' : `1px solid ${DIV}` }}>
      <RoundIcon emoji={emoji} bg={bg} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, color: TEXT }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: MUTED, marginTop: 3, lineHeight: 1.5 }}>{subtitle}</div>}
      </div>
      {right !== undefined && <span style={{ fontSize: 14, color: SUB, flexShrink: 0, marginRight: 2 }}>{right}</span>}
      <Chevron />
    </button>
  );
}

export default function VisitorSettings() {
  const nav = useNavigate();
  const [blackCount, setBlackCount] = useState(0);
  const [noDisturbCount, setNoDisturbCount] = useState(0);
  const [pwdEnabled, setPwdEnabled] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdInput, setPwdInput] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdTip, setPwdTip] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    http.get('/api/visitor/blacklist').then((r) => setBlackCount(r.data.count || 0)).catch(() => {});
    http.get('/api/visitor/no-disturb').then((r) => setNoDisturbCount(r.data.count || 0)).catch(() => {});
    http.get('/api/visitor/password').then((r) => setPwdEnabled(!!r.data.enabled)).catch(() => {});
  }, []);

  const savePassword = async () => {
    setPwdBusy(true);
    setPwdTip('');
    try {
      if (pwdEnabled && !pwdInput) {
        await http.put('/api/visitor/password', { password: '' });
        setPwdEnabled(false);
        setPwdOpen(false);
        setPwdInput('');
      } else {
        if (!pwdInput) { setPwdTip('请输入访问密码'); setPwdBusy(false); return; }
        if (pwdInput.length < 4) { setPwdTip('密码至少 4 位'); setPwdBusy(false); return; }
        await http.put('/api/visitor/password', { password: pwdInput });
        setPwdEnabled(true);
        setPwdOpen(false);
        setPwdInput('');
      }
    } catch (e) { setPwdTip('保存失败：' + (e.response?.data?.error || e.message)); }
    setPwdBusy(false);
  };

  const exportExcel = async () => {
    try {
      const r = await http.get('/api/visitor/export', { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'visitors.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch {}
  };

  return (
    <div style={{ minHeight: '100vh', background: '#F2F2F4', display: 'flex', flexDirection: 'column' }}>
      {/* 页面首行标题（全局 MobileShell 已有「< 返回 马亚」，页面只显示标题 + 帮助，不再做返回按钮） */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 6px' }}>
        <div style={{ fontSize: 22, color: TEXT }}>访客设置</div>
        <button onClick={() => setHelpOpen(true)} style={{ background: 'none', border: 'none', padding: '4px 6px', display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
          <HelpIcon />
          <span style={{ fontSize: 14, color: BRAND }}>帮助</span>
        </button>
      </div>

      {/* 分组标题 */}
      <div style={{ fontSize: 13, color: MUTED, padding: '14px 16px 8px', letterSpacing: 0.2 }}>访客名单</div>

      {/* 列表卡（白底 + 圆角 12 + 每项 1px 浅分隔线；底部分隔线由 last 控制） */}
      <div style={{ margin: '0 12px', background: '#fff', borderRadius: 12, overflow: 'hidden' }}>
        <Row emoji="🚫" bg="#FDEBEB" title="黑名单" subtitle="黑名单访客访问微官网将被直接拦截" right={`${blackCount} 人`} onClick={() => nav('/visitor-blacklist?type=blacklist')} />
        <Row emoji="🔕" bg="#FFF4E5" title="免打扰" subtitle="免打扰访客不产生消息提醒，保留访问日志" right={`${noDisturbCount} 人`} onClick={() => nav('/visitor-blacklist?type=no-disturb')} />
        <Row emoji="🔒" bg="#EAF3FB" title="访客密码" subtitle="开启后访问作品主页需输入密码" right={pwdEnabled ? '已开启' : '未开启'} onClick={() => { setPwdOpen(true); setPwdTip(''); }} />
        <Row emoji="📥" bg="#E5F5F2" title="导出访客 Excel" subtitle="导出全部访客记录，无条数限制" onClick={exportExcel} last />
      </div>

      {/* 底部说明 */}
      <div style={{ fontSize: 12, color: MUTED, padding: '14px 20px 24px', lineHeight: 1.6 }}>
        说明：本项目为 H5 网页，无微信企业小程序环境，无法获取访客微信昵称与手机号，访客以设备标识展示。所有功能均无 VIP 付费限制。
      </div>

      {/* 帮助弹窗 */}
      {helpOpen && (
        <div onClick={() => setHelpOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 20, width: '100%', maxWidth: 320, boxShadow: '0 16px 48px rgba(0,0,0,0.16)' }}>
            <div style={{ fontSize: 15, color: TEXT, marginBottom: 10 }}>访客设置说明</div>
            <div style={{ fontSize: 13, color: SUB, lineHeight: 1.7 }}>
              在这里管理访客访问权限：黑名单拦截不受欢迎访客；免打扰抑制消息提醒但保留访问日志；访客密码保护作品内容；导出 Excel 备份完整访问记录。所有功能无条数限制、无 VIP 付费。
            </div>
            <button onClick={() => setHelpOpen(false)} style={{ width: '100%', marginTop: 16, padding: '10px', borderRadius: 10, border: 'none', background: BRAND, color: '#fff', fontSize: 15 }}>知道了</button>
          </div>
        </div>
      )}

      {/* 访客密码弹窗 */}
      {pwdOpen && (
        <div onClick={() => setPwdOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 20, width: '100%', maxWidth: 320, boxShadow: '0 16px 48px rgba(0,0,0,0.16)' }}>
            <div style={{ fontSize: 15, color: TEXT, marginBottom: 12 }}>{pwdEnabled ? '访客密码' : '开启访客密码'}</div>
            {pwdEnabled && <div style={{ fontSize: 12, color: MUTED, marginBottom: 12 }}>输入新密码修改，留空并确认则清除密码</div>}
            <input type="password" value={pwdInput} onChange={(e) => setPwdInput(e.target.value)} placeholder={pwdEnabled ? '留空清除密码' : '设置访问密码（至少4位）'}
              style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${DIV}`, borderRadius: 10, padding: '11px 12px', fontSize: 14, color: TEXT, outline: 'none', marginBottom: 8 }} />
            {pwdTip && <div style={{ fontSize: 12, color: '#E5484D', marginBottom: 8 }}>{pwdTip}</div>}
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button onClick={() => setPwdOpen(false)} style={{ flex: 1, padding: '10px', borderRadius: 10, border: `1px solid ${DIV}`, background: '#fff', color: SUB, fontSize: 14 }}>取消</button>
              <button onClick={savePassword} disabled={pwdBusy} style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: BRAND, color: '#fff', fontSize: 14, opacity: pwdBusy ? 0.6 : 1 }}>{pwdBusy ? '保存中…' : '确认'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
