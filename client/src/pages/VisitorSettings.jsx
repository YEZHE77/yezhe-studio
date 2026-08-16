import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import http from '../api.js';

// 移动端「访客设置」页 —— Glassmorphism + Soft-UI，禁止字体加粗
// 已移除：访客微信授权、仅显示有昵称记录、手机验证、微信额度提示（H5 无小程序接口）
// 保留：黑名单 / 免打扰 / 访客密码 / 导出访客Excel
const TEXT = '#1f2329';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';
const DIV = '#EEF0F3';
const BRAND = '#4A9FD8';

const BackIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#1f2329" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);
const Chevron = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#AEAEB2" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export default function VisitorSettings() {
  const nav = useNavigate();
  const [blackCount, setBlackCount] = useState(0);
  const [noDisturbCount, setNoDisturbCount] = useState(0);
  const [pwdEnabled, setPwdEnabled] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdInput, setPwdInput] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdTip, setPwdTip] = useState('');

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
        // 清除密码
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

  const Row = ({ icon, title, subtitle, right, onClick }) => (
    <button onClick={onClick}
      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '15px 16px', border: 'none', background: '#fff', textAlign: 'left', cursor: 'pointer', borderBottom: `1px solid ${DIV}` }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: '#EAF3FB', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 18 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, color: TEXT }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: FAINT, marginTop: 2 }}>{subtitle}</div>}
      </div>
      {right !== undefined && <span style={{ fontSize: 13, color: SUB, flexShrink: 0 }}>{right}</span>}
      <Chevron />
    </button>
  );

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #EEF1F5 0%, #F5F7FA 100%)', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部玻璃栏 */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'rgba(255,255,255,0.66)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.6)' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 44, padding: '0 12px' }}>
          <button onClick={() => nav(-1)} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center' }}><BackIcon /></button>
          <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', fontSize: 17, color: TEXT }}>访客设置</div>
        </div>
      </div>

      {/* 功能列表 */}
      <div style={{ background: '#FFFFFF', margin: '12px', borderRadius: 16, overflow: 'hidden', boxShadow: '0 8px 24px rgba(31,35,41,0.06), 0 1px 3px rgba(31,35,41,0.04)' }}>
        <Row icon="🚫" title="黑名单" subtitle="黑名单访客访问微官网将被直接拦截" right={`${blackCount} 人`} onClick={() => nav('/visitor-blacklist?type=blacklist')} />
        <Row icon="🔕" title="免打扰" subtitle="免打扰访客不产生消息提醒，保留访问日志" right={`${noDisturbCount} 人`} onClick={() => nav('/visitor-blacklist?type=no-disturb')} />
        <Row icon="🔒" title="访客密码" subtitle="开启后访问作品主页需输入密码" right={pwdEnabled ? '已开启' : '未开启'} onClick={() => { setPwdOpen(true); setPwdTip(''); }} />
        <button onClick={exportExcel}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '15px 16px', border: 'none', background: '#fff', textAlign: 'left', cursor: 'pointer' }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: '#E5F5F2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 18 }}>📥</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, color: TEXT }}>导出访客 Excel</div>
            <div style={{ fontSize: 12, color: FAINT, marginTop: 2 }}>导出全部访客记录，无条数限制</div>
          </div>
          <Chevron />
        </button>
      </div>

      <div style={{ fontSize: 12, color: FAINT, padding: '0 20px', lineHeight: 1.6 }}>
        说明：本项目为 H5 网页，无微信企业小程序环境，无法获取访客微信昵称与手机号，访客以设备标识展示。所有功能均无 VIP 付费限制。
      </div>

      {/* 访客密码设置弹窗 */}
      {pwdOpen && (
        <div onClick={() => setPwdOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 320, boxShadow: '0 16px 48px rgba(0,0,0,0.16)' }}>
            <div style={{ fontSize: 15, color: TEXT, marginBottom: 12 }}>{pwdEnabled ? '访客密码' : '开启访客密码'}</div>
            {pwdEnabled && <div style={{ fontSize: 12, color: FAINT, marginBottom: 12 }}>输入新密码修改，留空并确认则清除密码</div>}
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
