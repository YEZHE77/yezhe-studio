import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import http, { img, formatBytes } from '../api.js';

// 移动端「消息」页 —— 拾光盒子 B 端 H5 复刻（Glassmorphism 玻璃拟态 + Soft-UI 柔性拟态）
// 规范：禁止字体加粗，仅用灰度 / 字号 / 间距区分层级；无 VIP 付费体系（已彻底移除 VIP 横幅/续费/鉴权）
const TEXT = '#1f2329';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';
const DIV = '#EEF0F3';

// ===== 顶部导航图标（细线 1.8 stroke，深灰描边）=====
const NavScan = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#1f2329" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" />
    <path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    <line x1="7" y1="12" x2="17" y2="12" />
  </svg>
);
const NavService = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#1f2329" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 13a9 9 0 0 1 18 0" />
    <rect x="2.5" y="13" width="4" height="6" rx="1.5" />
    <rect x="17.5" y="13" width="4" height="6" rx="1.5" />
    <path d="M20 19a3 3 0 0 1-3 3h-2" />
  </svg>
);
const NavSetting = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#1f2329" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

// ===== 咨询消息图标（Bell / ClipboardList / Mail）=====
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

// ===== 更多列表图标（Database / HelpCircle）=====
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
const IconUser = ({ color }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

// 圆形彩色背景图标（Soft-UI：柔和色底 + 同色描边）
function RoundIcon({ Icon, color, bg, size = 36 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: size / 2, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <Icon color={color} />
    </div>
  );
}

// 消息分类（柔和莫兰迪配色；顾客咨询已移除，预约消息整合到消息 Tab）
const CONSULT = [
  { key: 'reserve', label: '预约消息', Icon: ConsultBell, color: '#E86A5E', bg: '#FBEAE7' },
  { key: 'order', label: '订单消息', Icon: ConsultOrder, color: '#4A9FD8', bg: '#EAF3FB' },
  { key: 'system', label: '系统通知', Icon: ConsultMail, color: '#8A7BC8', bg: '#F0ECF9' }
];

// 区块标题（禁止加粗，用字号 + 灰度区分）
function SectionTitle({ title }) {
  return <div style={{ fontSize: 13, color: SUB, padding: '16px 16px 8px', letterSpacing: 0.5 }}>{title}</div>;
}

export default function MobileMessage() {
  const nav = useNavigate();
  const [storage, setStorage] = useState(null); // { totalUsedBytes, alertThreshold, exceeded }
  const [studio, setStudio] = useState(null);   // { serviceQr }
  const [serviceOpen, setServiceOpen] = useState(false);
  const [byCategory, setByCategory] = useState({ reserve: 0, order: 0, system: 0 });  // 消息分类未读（reserve/order/system），叠加显示到 3 宫格右上角小红点，让用户知道底部 Tab 的未读具体是哪类
  const isWechat = typeof navigator !== 'undefined' && /MicroMessenger/i.test(navigator.userAgent);

  useEffect(() => {
    // 存储用量（真实桶大小 + 自定义阈值 + 告警）
    http.get('/api/admin/storage/stats').then((r) => setStorage(r.data)).catch(() => {});
    // 工作室资料（客服二维码）
    http.get('/api/settings/studio').then((r) => setStudio(r.data)).catch(() => {});
    // 消息分类未读（reserve/order/system）—— 与 MobileShell 底部 Tab 共用同一个接口，读取 byCategory 字段叠加到 3 宫格
    http.get('/api/mobile/message/unread-count').then((r) => {
      if (r.data && r.data.byCategory) setByCategory(r.data.byCategory);
    }).catch(() => {});
  }, []);

  const openConsult = (key) => {
    // 预约消息直达预约管理页（订单消息页已不再展示预约消息 Tab）；订单消息走二级页；其余走通用消息列表
    if (key === 'reserve') nav('/m/reserve-messages');
    else if (key === 'order') nav('/m/order-messages');
    else nav('/m/messages?type=' + key);
  };

  const used = storage ? formatBytes(storage.totalUsedBytes || 0) : '--';
  const limit = storage && storage.alertThreshold ? formatBytes(storage.alertThreshold) : '';
  const exceeded = !!(storage && storage.exceeded);

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #EEF1F5 0%, #F5F7FA 100%)', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部玻璃栏（Glassmorphism：半透明白 + 背景模糊） */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'rgba(255,255,255,0.66)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.6)' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 44, padding: '0 12px' }}>
          <button aria-label="扫码" onClick={() => nav('/home')} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center' }}><NavScan /></button>
          <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', fontSize: 17, color: TEXT }}>消息</div>
          <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', gap: 14 }}>
            <button aria-label="客服" onClick={() => setServiceOpen(true)} style={{ background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center' }}><NavService /></button>
            <button aria-label="设置" onClick={() => nav('/settings')} style={{ background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center' }}><NavSetting /></button>
          </div>
        </div>

        {/* 微信浏览器降级提示（非阻塞；微信内 Notification 不可用，静默降级并给轻提示） */}
        {isWechat && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 16px', background: 'rgba(255,244,224,0.7)', fontSize: 11, color: '#9A6A1F' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#E8A33D', flexShrink: 0 }} />
            当前在微信内打开，消息通知可能受限，建议在浏览器中打开
          </div>
        )}
      </div>

      {/* 消息分类（3 宫格 Soft-UI 卡片） */}
      <SectionTitle title="消息分类" />
      <div style={{ background: '#FFFFFF', margin: '0 12px', borderRadius: 16, padding: '20px 8px', display: 'flex', justifyContent: 'space-around', boxShadow: '0 8px 24px rgba(31,35,41,0.06), 0 1px 3px rgba(31,35,41,0.04)' }}>
        {CONSULT.map((c) => {
          const cnt = (byCategory && byCategory[c.key]) || 0;
          return (
            <button key={c.key} onClick={() => openConsult(c.key)} style={{ background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '4px 12px', cursor: 'pointer' }}>
              <div style={{ position: 'relative' }}>
                <RoundIcon Icon={c.Icon} color={c.color} bg={c.bg} size={46} />
                {cnt > 0 && (
                  <span style={{ position: 'absolute', top: -4, right: -6, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: '#E5484D', color: '#fff', fontSize: 11, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 2px #fff' }}>
                    {cnt > 99 ? '99+' : cnt}
                  </span>
                )}
              </div>
              <span style={{ fontSize: 12, color: TEXT }}>{c.label}</span>
            </button>
          );
        })}
      </div>

      {/* 更多（Soft-UI 列表：访客 / 已用空间 / 帮助中心） */}
      <SectionTitle title="更多" />
      <div style={{ background: '#FFFFFF', margin: '0 12px', borderRadius: 16, overflow: 'hidden', boxShadow: '0 8px 24px rgba(31,35,41,0.06), 0 1px 3px rgba(31,35,41,0.04)' }}>
        {/* 访客（V2 上线） */}
        <button onClick={() => nav('/visitors')}
          style={{ width: '100%', display: 'flex', alignItems: 'center', padding: '14px 14px', border: 'none', background: '#fff', borderBottom: `1px solid ${DIV}`, textAlign: 'left', cursor: 'pointer', gap: 12 }}>
          <RoundIcon Icon={IconUser} color="#1baea2" bg="#E6F6F3" size={36} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, color: TEXT }}>访客</div>
            <div style={{ fontSize: 12, color: FAINT, marginTop: 2 }}>访客列表与访问记录</div>
          </div>
          <span style={{ fontSize: 12, color: FAINT }}>&gt;</span>
        </button>

        {/* 已用空间（读 R2 实际用量 + 自定义阈值告警红点） */}
        <button onClick={() => nav('/capacity')}
          style={{ width: '100%', display: 'flex', alignItems: 'center', padding: '14px 14px', border: 'none', background: '#fff', borderBottom: `1px solid ${DIV}`, textAlign: 'left', cursor: 'pointer', gap: 12 }}>
          <RoundIcon Icon={IconDatabase} color="#3EB7A8" bg="#E5F5F2" size={36} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, color: TEXT }}>已用空间</div>
            <div style={{ fontSize: 12, color: FAINT, marginTop: 2 }}>
              {limit ? `${used} / ${limit}` : used}
            </div>
          </div>
          {exceeded && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#E5484D', marginRight: 8 }} />}
          <span style={{ fontSize: 12, color: FAINT }}>&gt;</span>
        </button>

        {/* 帮助中心 */}
        <button onClick={() => nav('/help')}
          style={{ width: '100%', display: 'flex', alignItems: 'center', padding: '14px 14px', border: 'none', background: '#fff', textAlign: 'left', cursor: 'pointer', gap: 12 }}>
          <RoundIcon Icon={IconHelp} color="#4A9FD8" bg="#EAF3FB" size={36} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, color: TEXT }}>帮助中心</div>
          </div>
          <span style={{ fontSize: 12, color: FAINT }}>&gt;</span>
        </button>
      </div>

      {/* 客服二维码弹窗 */}
      {serviceOpen && (
        <div onClick={() => setServiceOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 320, textAlign: 'center', boxShadow: '0 16px 48px rgba(0,0,0,0.16)' }}>
            <div style={{ fontSize: 15, color: TEXT }}>添加客服</div>
            {studio && studio.serviceQr ? (
              <>
                <img src={img(studio.serviceQr)} alt="客服微信" style={{ width: 200, height: 200, objectFit: 'contain', margin: '16px auto', borderRadius: 12 }} />
                <div style={{ fontSize: 12, color: FAINT }}>长按二维码识别添加客服微信</div>
              </>
            ) : (
              <div style={{ padding: '28px 0', fontSize: 13, color: FAINT }}>暂未配置客服二维码<br />请在 B 端「资料设置」中上传</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
