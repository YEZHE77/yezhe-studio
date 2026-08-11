import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import http, { formatBytes, img } from '../api.js';
import Icon from '../components/Icon.jsx';
import { useAuth } from '../auth.jsx';

// 品牌色（与 index.css :root 对齐）
const GREEN = '#60C4AA';
const GREEN_DARK = '#4BB399';
const LINE = '#EFEFEF';
const TEXT = '#1f2329';
const MUTED = '#999999';
const SUB = '#AAAAAA';
const GREEN_LIGHT_BG = '#E8F6F1';

// 对外展示（小程序 / 网站）——复用现有 /settings 中的配置入口，杜绝付费营销模块
const EXTERNAL = [
  { icon: 'miniapp', title: '我的小程序', desc: '可定制专属小程序，关联公众号', to: '/settings' },
  { icon: 'website', title: '我的网站', desc: '打造专属工作室品牌与独立域名', to: '/settings' }
];

// 常用工具九宫格——仅跳转真实存在的路由，规避死链
const TOOLS = [
  { icon: 'settings', label: '资料', to: '/settings' },
  { icon: 'photo', label: '作品', to: '/works' },
  { icon: 'package', label: '套系', to: '/packages' },
  { icon: 'calendar', label: '档期', to: '/schedule' },
  { icon: 'order', label: '订单', to: '/orders' },
  { icon: 'customer', label: '客资', to: '/customers' },
  { icon: 'select', label: '选片', to: '/selections' },
  { icon: 'review', label: '评价', to: '/reviews' },
  { icon: 'finance', label: '财务', to: '/finance' },
  { icon: 'dashboard', label: '数据', to: '/datacharts' },
  { icon: 'storage', label: '容量', to: '/capacity' },
  { icon: 'link', label: '渠道', to: '/channels' }
];

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke={MUTED} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

// 顶部工作室卡片（参考图1：圆形头像 + 名称 + 灰字 + 编辑资料按钮）
function StudioHeader({ user, onEdit }) {
  const name = user?.studioName || user?.name || user?.username || '叶哲 Studio';
  const avatar = user?.avatar ? img(user.avatar) : '';
  const initial = (name || 'S').slice(0, 1);
  return (
    <div className="flex items-center gap-3" style={{ background: '#fff', borderRadius: 10, padding: 16, border: '1px solid ' + LINE }}>
      <div className="shrink-0" style={{ width: 56, height: 56, borderRadius: '50%', overflow: 'hidden', background: GREEN_LIGHT_BG, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {avatar ? (
          <img src={avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontSize: 22, color: GREEN_DARK }}>{initial}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div style={{ fontSize: 17, color: TEXT, lineHeight: 1.3 }}>{name}</div>
        <div className="mt-1" style={{ fontSize: 12, color: SUB }}>工作室管理后台</div>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="shrink-0"
        style={{ fontSize: 12, color: GREEN_DARK, background: '#fff', border: '1px solid ' + GREEN, borderRadius: 4, padding: '6px 10px', lineHeight: 1 }}
      >编辑资料</button>
    </div>
  );
}

// 三列数据（余额 / 待跟进 / 待拍摄）
function StatRow({ balance, follow, shoot }) {
  const cols = [
    { label: '余额', value: '¥' + (typeof balance === 'number' ? balance.toLocaleString() : '0.00'), accent: true },
    { label: '待跟进', value: typeof follow === 'number' ? String(follow) : '0' },
    { label: '待拍摄', value: typeof shoot === 'number' ? String(shoot) : '0' }
  ];
  return (
    <div className="flex" style={{ background: '#fff', borderRadius: 10, border: '1px solid ' + LINE, marginTop: 10 }}>
      {cols.map((c, i) => (
        <div
          key={c.label}
          className="flex-1 text-center"
          style={{
            padding: '16px 4px',
            borderLeft: i === 0 ? 'none' : '1px solid ' + LINE
          }}
        >
          <div style={{ fontSize: 20, color: c.accent ? GREEN_DARK : TEXT, lineHeight: 1.1 }}>{c.value}</div>
          <div className="mt-1" style={{ fontSize: 12, color: MUTED }}>{c.label}</div>
        </div>
      ))}
    </div>
  );
}

// 快捷横幅（待办事项 + 存储空间），角标数字来自真实数据
function QuickBanner({ todo, storagePct, onTodo, onStorage }) {
  return (
    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <button type="button" onClick={onTodo} className="flex items-center w-full text-left" style={{ background: '#fff', borderRadius: 10, border: '1px solid ' + LINE, padding: '12px 14px' }}>
        <span style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(96,196,170,0.12)', color: GREEN_DARK, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="order" className="w-5 h-5" />
        </span>
        <span className="flex-1 ml-3" style={{ fontSize: 14, color: TEXT }}>待办事项</span>
        {todo > 0 && (
          <span style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: '#FA7D77', color: '#fff', fontSize: 11, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginRight: 6 }}>{todo}</span>
        )}
        <Chevron />
      </button>
      <button type="button" onClick={onStorage} className="flex items-center w-full text-left" style={{ background: '#fff', borderRadius: 10, border: '1px solid ' + LINE, padding: '12px 14px' }}>
        <span style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(96,196,170,0.12)', color: GREEN_DARK, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="storage" className="w-5 h-5" />
        </span>
        <span className="flex-1 ml-3" style={{ fontSize: 14, color: TEXT }}>存储空间 {storagePct}%</span>
        <Chevron />
      </button>
    </div>
  );
}

// 中性信息条（替代原「体验版」付费提示，给出真实存储配置建议，非营销）
function InfoBar({ onDetail, critical }) {
  return (
    <div className="flex items-center" style={{ background: critical ? 'rgba(244,113,117,0.08)' : 'rgba(96,196,170,0.08)', borderRadius: 8, padding: '10px 12px', marginTop: 10 }}>
      <div className="flex-1" style={{ fontSize: 12, color: MUTED, lineHeight: 1.4 }}>
        {critical ? '存储容量告警：使用率偏高，请尽快清理避免超限。' : '图片存储提示：建议配置云存储，避免服务重启后图片丢失。'}
      </div>
      <button type="button" onClick={onDetail} className="shrink-0 ml-2" style={{ fontSize: 12, color: GREEN_DARK, background: 'none', border: 'none', padding: 0, display: 'flex', alignItems: 'center' }}>
        查看详情 <Chevron />
      </button>
    </div>
  );
}

// 区块标题
function SectionTitle({ children }) {
  return <div className="mt-5 mb-2 px-1" style={{ fontSize: 13, color: MUTED }}>{children}</div>;
}

function ExternalCard({ item, onClick }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center w-full text-left" style={{ background: '#fff', borderRadius: 10, border: '1px solid ' + LINE, padding: '12px 14px' }}>
      <span style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(96,196,170,0.12)', color: GREEN_DARK, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={item.icon} className="w-5 h-5" />
      </span>
      <span className="flex-1 ml-3 min-w-0">
        <span style={{ fontSize: 14, color: TEXT, display: 'block' }}>{item.title}</span>
        <span style={{ fontSize: 12, color: SUB, display: 'block', marginTop: 2 }} className="truncate">{item.desc}</span>
      </span>
      <Chevron />
    </button>
  );
}

function ToolCell({ item, onClick }) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center justify-center" style={{ padding: '14px 4px' }}>
      <span style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(96,196,170,0.10)', color: GREEN_DARK, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={item.icon} className="w-6 h-6" />
      </span>
      <span className="mt-2" style={{ fontSize: 12, color: TEXT }}>{item.label}</span>
    </button>
  );
}

export default function MobileWorkbench() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [storage, setStorage] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      http.get('/api/stats').then((r) => setStats(r.data)).catch(() => {}),
      http.get('/api/admin/storage/stats').then((r) => setStorage(r.data)).catch(() => setStorage(null))
    ]).finally(() => setLoading(false));
  }, []);

  const pb = stats && stats.pendingBlocks ? stats.pendingBlocks : {};
  const safe = (v) => (typeof v === 'number' ? v : 0);
  const followTotal = safe(pb.deposit) + safe(pb.shoot) + safe(pb.delivered) + safe(pb.selecting) + safe(pb.retouching);
  const storageRatio = storage && storage.limitBytes ? storage.totalUsedBytes / storage.limitBytes : 0;
  const storagePct = Math.min(100, Math.round(storageRatio * 100));
  const storageCritical = !!(storage && storage.cloudEnabled && storageRatio >= 0.9);
  const todoCount = followTotal;

  return (
    <div style={{ background: '#F8F8F8', minHeight: '100vh', padding: 12, paddingBottom: 24 }}>
      <StudioHeader user={user} onEdit={() => nav('/settings')} />

      <StatRow
        balance={stats ? safe(stats.balance) : 0}
        follow={followTotal}
        shoot={safe(pb.shoot)}
      />

      <QuickBanner
        todo={todoCount}
        storagePct={storagePct}
        onTodo={() => nav('/orders')}
        onStorage={() => nav('/capacity')}
      />

      <InfoBar onDetail={() => nav('/capacity')} critical={storageCritical} />

      <SectionTitle>对外展示</SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {EXTERNAL.map((e) => (
          <ExternalCard key={e.title} item={e} onClick={() => nav(e.to)} />
        ))}
      </div>

      <SectionTitle>常用工具</SectionTitle>
      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid ' + LINE }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {TOOLS.map((t) => (
            <ToolCell key={t.label} item={t} onClick={() => nav(t.to)} />
          ))}
        </div>
      </div>
    </div>
  );
}
