import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

// 移动端「消息」页 —— 1:1 复刻参考图 IMG_7602
// 顶部：导航 + VIP 卡片（粉色背景渐变区）
// 主体：咨询消息（3 列）/ 更多（4 行列表）/ 惊喜任务
const TEXT = '#1f2329';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';
const DIV = '#F0F0F2';

// 三个咨询消息分类（参考图：顾客咨询 🔔 / 订单消息 � / 系统通知 📧）
const CONSULT = [
  { key: 'customer_consult', label: '顾客咨询', icon: '🔔' },
  { key: 'order', label: '订单消息', icon: '📋' },
  { key: 'system', label: '系统通知', icon: '📧' }
];

// 更多列表（参考图 4 项）
const MORE = [
  { key: 'visitor', icon: '👤', title: '访客', subtitle: 'A z 游览了主页', date: '08-12', onClick: '/datacharts' },
  { key: 'announce', icon: '📢', title: '活动公告', subtitle: 'V4.3.2 | 功能更新', date: '07-21', onClick: '/messages?type=announce' },
  { key: 'storage', icon: '📊', title: '已用空间', subtitle: '管理存储空间和流量', alert: true, onClick: '/capacity' },
  { key: 'help', icon: '❓', title: '帮助中心', subtitle: '', date: '刚刚', onClick: '/help' }
];

// 顶部导航图标
const NavScan = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#1f2329" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
  </svg>
);
const NavBell = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#1f2329" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);
const NavSetting = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#1f2329" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

// 区块标题
function SectionTitle({ title }) {
  return <div style={{ fontSize: 13, color: SUB, padding: '14px 16px 8px', letterSpacing: 0.5 }}>{title}</div>;
}

export default function MobileMessage() {
  const nav = useNavigate();
  const [wechatBound] = useState(true); // 参考图显示「已绑定」

  const openConsult = (key) => {
    nav('/m/messages?type=' + key);
  };

  return (
    <div style={{ minHeight: '100vh', background: '#F5F5F7', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部粉色渐变区（容纳导航栏；VIP 卡已按要求删除，背景仍保留） */}
      <div style={{ background: 'linear-gradient(180deg, #FCE5E5 0%, #FAF0F0 60%, #F5F5F7 100%)' }}>
        {/* 导航栏 */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 44, padding: '0 12px' }}>
          <button aria-label="扫码" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center' }}><NavScan /></button>
          <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', fontSize: 17, color: TEXT, fontWeight: 500 }}>消息</div>
          <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <button aria-label="通知" style={{ background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center' }}><NavBell /></button>
            <button aria-label="设置" style={{ background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center' }}><NavSetting /></button>
          </div>
        </div>
      </div>

      {/* 咨询消息（3 列卡片） */}
      <SectionTitle title="咨询消息" />
      <div style={{ background: '#fff', margin: '0 12px', borderRadius: 12, padding: '16px 8px', display: 'flex', justifyContent: 'space-around' }}>
        {CONSULT.map((c) => (
          <button key={c.key} onClick={() => openConsult(c.key)} style={{ background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '4px 12px', cursor: 'pointer' }}>
            <span style={{ fontSize: 22, lineHeight: 1 }}>{c.icon}</span>
            <span style={{ fontSize: 12, color: TEXT }}>{c.label}</span>
          </button>
        ))}
      </div>

      {/* 更多（4 行列表） */}
      <SectionTitle title="更多" />
      <div style={{ background: '#fff', margin: '0 12px', borderRadius: 12, overflow: 'hidden' }}>
        {MORE.map((r, i) => (
          <button key={r.key} onClick={() => nav(r.onClick)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', padding: '14px 14px', border: 'none', background: '#fff', borderBottom: i < MORE.length - 1 ? `1px solid ${DIV}` : 'none', textAlign: 'left', cursor: 'pointer', gap: 12 }}>
            <span style={{ fontSize: 20, lineHeight: 1, color: FAINT, width: 28, textAlign: 'center' }}>{r.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, color: TEXT }}>{r.title}</div>
              {r.subtitle && <div style={{ fontSize: 12, color: FAINT, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.subtitle}</div>}
            </div>
            {r.alert && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#FF4D4F', marginRight: 8 }} />}
            {r.date && <span style={{ fontSize: 12, color: FAINT }}>{r.date}</span>}
          </button>
        ))}
      </div>

      {/* 惊喜任务（绑定微信） */}
      <SectionTitle title="惊喜任务" />
      <div style={{ background: '#fff', margin: '0 12px 16px', borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, color: TEXT, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 18, lineHeight: 1 }}>💬</span>
            绑定微信
          </div>
          <div style={{ fontSize: 12, color: FAINT, marginTop: 4 }}>接收客户咨询提醒</div>
        </div>
        <button disabled={wechatBound}
          style={{ padding: '6px 14px', borderRadius: 16, border: `1px solid ${DIV}`, background: '#fff', color: wechatBound ? '#C7C7CC' : TEXT, fontSize: 12, cursor: wechatBound ? 'default' : 'pointer', flexShrink: 0 }}>
          {wechatBound ? '已绑定' : '去绑定'}
        </button>
      </div>
    </div>
  );
}
