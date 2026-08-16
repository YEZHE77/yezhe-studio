import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

// 移动端「消息」页 —— 1:1 复刻参考图（图标升级版：emoji → lucide-style 细线 SVG + 主题色圆形底）
// 顶部：导航 + VIP 卡片（粉色背景渐变区）
// 主体：咨询消息（3 列彩色圆形图标）/ 更多（4 行列表 + 圆形图标）/ 惊喜任务（绑定微信）
const TEXT = '#1f2329';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';
const DIV = '#F0F0F2';

// ===== 顶部导航图标（细线 1.8 stroke，黑色描边）=====
const NavScan = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#1f2329" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" />
    <path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    <line x1="7" y1="12" x2="17" y2="12" />
  </svg>
);
const NavBell = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#1f2329" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);
const NavSetting = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#1f2329" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

// ===== 咨询消息图标（lucide 风格：Bell / ClipboardList / Mail）=====
const ConsultBell = ({ color }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);
const ConsultOrder = ({ color }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="8" y="2" width="8" height="4" rx="1" />
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <path d="M9 12h6M9 16h4" />
  </svg>
);
const ConsultMail = ({ color }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="M22 6 12 13 2 6" />
  </svg>
);

// ===== 更多列表图标（lucide 风格：User / Megaphone / Database / HelpCircle）=====
const IconUser = ({ color }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);
const IconMegaphone = ({ color }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 11l18-5v12L3 14v-3z" />
    <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
  </svg>
);
const IconDatabase = ({ color }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
    <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3" />
  </svg>
);
const IconHelp = ({ color }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);
const IconWechat = ({ color }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
);

// 圆形彩色背景图标（主题色 12% 底色 + 主题色描边）
function RoundIcon({ Icon, color, bg, size = 36 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: size / 2, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <Icon color={color} />
    </div>
  );
}

// 咨询消息分类（每项自带主题色：顾客咨询 橙红 / 订单 蓝 / 系统 紫）
const CONSULT = [
  { key: 'customer_consult', label: '顾客咨询', Icon: ConsultBell, color: '#FF4D4F', bg: '#FFEDEC' },
  { key: 'order', label: '订单消息', Icon: ConsultOrder, color: '#2DB7F5', bg: '#E8F6FE' },
  { key: 'system', label: '系统通知', Icon: ConsultMail, color: '#722ED1', bg: '#F4ECFE' }
];

// 更多列表（每项主题色：访客 青绿 / 活动 橙 / 已用空间 紫 / 帮助中心 蓝）
const MORE = [
  { key: 'visitor', Icon: IconUser, color: '#1baea2', bg: '#E6F6F3', title: '访客', subtitle: 'A z 游览了主页', date: '08-12', onClick: '/datacharts' },
  { key: 'announce', Icon: IconMegaphone, color: '#FA8C16', bg: '#FFF4E5', title: '活动公告', subtitle: 'V4.3.2 | 功能更新', date: '07-21', onClick: '/m/messages?type=announce' },
  { key: 'storage', Icon: IconDatabase, color: '#722ED1', bg: '#F4ECFE', title: '已用空间', subtitle: '管理存储空间和流量', alert: true, onClick: '/capacity' },
  { key: 'help', Icon: IconHelp, color: '#2DB7F5', bg: '#E8F6FE', title: '帮助中心', subtitle: '', date: '刚刚', onClick: '/help' }
];

// 区块标题
function SectionTitle({ title }) {
  return <div style={{ fontSize: 13, color: SUB, padding: '14px 16px 8px', letterSpacing: 0.5, fontWeight: 500 }}>{title}</div>;
}

export default function MobileMessage() {
  const nav = useNavigate();
  const [wechatBound] = useState(true); // 参考图显示「已绑定」

  const openConsult = (key) => {
    nav('/m/messages?type=' + key);
  };

  return (
    <div style={{ minHeight: '100vh', background: '#F5F5F7', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部粉色渐变区（容纳导航栏 + VIP 卡） */}
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

        {/* VIP 卡片（金棕渐变 + 黑底白字按钮，参考图还原） */}
        <div style={{ margin: '6px 12px 18px', padding: '14px 16px', borderRadius: 12, background: 'linear-gradient(135deg, #C9A876 0%, #B5915F 100%)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 4px 12px rgba(184, 149, 106, 0.22)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, color: '#fff', fontWeight: 500 }}>开通 VIP</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.82)', marginTop: 3 }}>定制版 VIP 已过期，续费后自动恢复</div>
          </div>
          <button style={{ padding: '6px 14px', borderRadius: 16, border: 'none', background: '#2A2622', color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer', flexShrink: 0 }}>VIP 续费</button>
        </div>
      </div>

      {/* 咨询消息（3 列卡片 + 彩色圆形图标） */}
      <SectionTitle title="咨询消息" />
      <div style={{ background: '#fff', margin: '0 12px', borderRadius: 12, padding: '18px 8px', display: 'flex', justifyContent: 'space-around', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
        {CONSULT.map((c) => (
          <button key={c.key} onClick={() => openConsult(c.key)} style={{ background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '4px 12px', cursor: 'pointer' }}>
            <RoundIcon Icon={c.Icon} color={c.color} bg={c.bg} size={44} />
            <span style={{ fontSize: 12, color: TEXT }}>{c.label}</span>
          </button>
        ))}
      </div>

      {/* 更多（4 行列表 + 圆形彩色图标） */}
      <SectionTitle title="更多" />
      <div style={{ background: '#fff', margin: '0 12px', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
        {MORE.map((r, i) => (
          <button key={r.key} onClick={() => nav(r.onClick)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', padding: '14px 14px', border: 'none', background: '#fff', borderBottom: i < MORE.length - 1 ? `1px solid ${DIV}` : 'none', textAlign: 'left', cursor: 'pointer', gap: 12 }}>
            <RoundIcon Icon={r.Icon} color={r.color} bg={r.bg} size={36} />
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
      <div style={{ background: '#fff', margin: '0 12px 16px', borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
          <RoundIcon Icon={IconWechat} color="#07C160" bg="#E8FBF1" size={36} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, color: TEXT }}>绑定微信</div>
            <div style={{ fontSize: 12, color: FAINT, marginTop: 2 }}>接收客户咨询提醒</div>
          </div>
        </div>
        <button disabled={wechatBound}
          style={{ padding: '6px 14px', borderRadius: 16, border: `1px solid ${DIV}`, background: '#fff', color: wechatBound ? '#C7C7CC' : TEXT, fontSize: 12, cursor: wechatBound ? 'default' : 'pointer', flexShrink: 0 }}>
          {wechatBound ? '已绑定' : '去绑定'}
        </button>
      </div>
    </div>
  );
}
