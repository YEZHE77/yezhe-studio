import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import http, { img } from '../api.js';
import { useAuth } from '../auth.jsx';
import {
  Crown,
  ClipboardList,
  Printer,
  BookOpen,
  FileText,
  Image,
  Layers,
  CalendarDays,
  Users,
  Images,
  UserCog,
  MessageSquare,
  Video,
  Sparkles,
  Ticket,
  Diamond,
  Tag,
  Users2,
  Coins,
  IdCard,
  LayoutGrid,
  HardDrive,
  Gauge,
  User,
  BarChart3,
  MessageCircle,
  ChevronRight,
  Monitor,
  Smartphone
} from 'lucide-react';

// 截图色板
const CORAL = '#FF8A8A';
const ORANGE = '#F5A623';
const MINT = '#7ECDBB';
const TEXT = '#1f2329';
const MUTED = '#999999';
const LINE = '#EFEFEF';

const SECTIONS = [
  {
    title: '功能',
    items: [
      { label: '新手引导', icon: BookOpen, color: ORANGE, to: '/settings' },
      { label: '资料', icon: FileText, color: CORAL, to: '/settings' },
      { label: '作品', icon: Image, color: ORANGE, to: '/works' },
      { label: '套系', icon: Layers, color: CORAL, to: '/packages' }
    ]
  },
  {
    title: '工具',
    items: [
      { label: '档期', icon: CalendarDays, color: ORANGE, to: '/schedule' },
      { label: '订单', icon: ClipboardList, color: ORANGE, to: '/orders' },
      { label: '客资', icon: Users, color: ORANGE, to: '/customers' },
      { label: '选片工具', icon: Images, color: ORANGE, to: '/selections' },
      { label: '团队管理', icon: UserCog, color: CORAL, to: '/settings' },
      { label: '评价管理', icon: MessageSquare, color: ORANGE, to: '/reviews' },
      { label: '图片直播', icon: Video, color: '#FF6B6B', to: '/settings' },
      { label: 'AI修图', icon: Sparkles, color: ORANGE, to: '/settings' }
    ]
  },
  {
    title: '拓客引流',
    items: [
      { label: '优惠券', icon: Ticket, color: CORAL, to: '/settings' },
      { label: '促销套系', icon: Diamond, color: CORAL, to: '/packages' },
      { label: '优惠码', icon: Tag, color: ORANGE, to: '/settings' },
      { label: '拼团活动', icon: Users2, color: CORAL, to: '/settings' },
      { label: '客户积分', icon: Coins, color: ORANGE, to: '/settings' },
      { label: '生成名片', icon: IdCard, color: ORANGE, to: '/card' },
      { label: '九图海报', icon: LayoutGrid, color: ORANGE, to: '/settings' },
      { label: '摄影日历', icon: CalendarDays, color: CORAL, to: '/schedule' }
    ]
  },
  {
    title: '其他功能',
    items: [
      { label: '相册印刷', icon: Printer, color: CORAL, to: '/settings', tag: 'NEW' },
      { label: '存储空间', icon: HardDrive, color: ORANGE, to: '/capacity' },
      { label: '容量管理', icon: Gauge, color: CORAL, to: '/capacity' },
      { label: '访客', icon: User, color: ORANGE, to: '/datacharts' },
      { label: '统计', icon: BarChart3, color: ORANGE, to: '/datacharts' },
      { label: '关联公众号', icon: MessageCircle, color: ORANGE, to: '/settings' }
    ]
  }
];

function Cell({ item, onClick }) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center justify-center relative"
      style={{ padding: '14px 4px', background: 'none', border: 'none' }}
    >
      <Icon className="w-6 h-6" strokeWidth={1.5} style={{ color: item.color }} />
      <span className="mt-2" style={{ fontSize: 12, color: TEXT }}>{item.label}</span>
      {item.tag && (
        <span
          style={{
            position: 'absolute',
            top: 8,
            right: '50%',
            marginRight: -26,
            background: '#FF6B6B',
            color: '#fff',
            fontSize: 9,
            padding: '1px 4px',
            borderRadius: 4,
            lineHeight: 1
          }}
        >
          {item.tag}
        </span>
      )}
    </button>
  );
}

function GroupBlock({ title, children, last }) {
  return (
    <div
      style={{
        padding: '16px',
        borderBottom: last ? 'none' : '1px solid ' + LINE
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 600, color: TEXT, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

export default function MobileWorkbench() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    http.get('/api/stats')
      .then((r) => setStats(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const pb = stats && stats.pendingBlocks ? stats.pendingBlocks : {};
  const safe = (v) => (typeof v === 'number' ? v : 0);
  const followTotal = safe(pb.deposit) + safe(pb.shoot) + safe(pb.selecting) + safe(pb.retouching);
  const shootCount = safe(pb.shoot);

  return (
    <div style={{ background: '#fff', minHeight: '100vh', paddingBottom: 28 }}>
      {/* 深色头部（全宽铺满） */}
      <div style={{ background: '#1A1A1A', padding: '20px 16px', color: '#fff' }}>
        <div className="flex items-center" style={{ justifyContent: 'space-between' }}>
          <div className="flex items-center" style={{ gap: 12 }}>
            <div
              style={{
                width: 50,
                height: 50,
                borderRadius: '50%',
                overflow: 'hidden',
                background: '#333',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
            >
              {user?.avatar ? (
                <img src={img(user.avatar)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span style={{ fontSize: 20 }}>岛</span>
              )}
            </div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 500 }}>岛像微电影</div>
              <div style={{ fontSize: 12, color: '#999', marginTop: 4, display: 'flex', alignItems: 'center' }}>
                定制版已过期 <ChevronRight className="w-3 h-3" style={{ color: '#999' }} />
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => nav('/settings')}
            style={{
              fontSize: 12,
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.35)',
              borderRadius: 14,
              padding: '6px 12px',
              background: 'transparent'
            }}
          >
            编辑资料
          </button>
        </div>
      </div>

      {/* 三列统计（全宽，上下分隔线） */}
      <div style={{ background: '#fff', borderTop: '1px solid ' + LINE, borderBottom: '1px solid ' + LINE, display: 'flex' }}>
        <div style={{ flex: 1, textAlign: 'center', padding: '16px 0' }}>
          <div style={{ fontSize: 20, color: CORAL, lineHeight: 1.1 }}>¥0.00</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>余额</div>
        </div>
        <div style={{ width: 1, background: LINE, margin: '12px 0' }} />
        <div style={{ flex: 1, textAlign: 'center', padding: '16px 0' }}>
          <div style={{ fontSize: 20, color: TEXT, lineHeight: 1.1 }}>{followTotal}</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>待跟进</div>
        </div>
        <div style={{ width: 1, background: LINE, margin: '12px 0' }} />
        <div style={{ flex: 1, textAlign: 'center', padding: '16px 0' }}>
          <div style={{ fontSize: 20, color: TEXT, lineHeight: 1.1 }}>{shootCount || 2}</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>待拍摄</div>
        </div>
      </div>

      {/* 三个快捷卡（铺满，内部小卡保留圆角） */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, padding: 12 }}>
        <button
          type="button"
          onClick={() => nav('/settings')}
          style={{ background: '#FBF4E4', borderRadius: 12, padding: 14, border: 'none', textAlign: 'left', position: 'relative', minHeight: 82 }}
        >
          <div style={{ fontSize: 14, color: TEXT }}>会员中心</div>
          <div style={{ position: 'absolute', right: 10, bottom: 10 }}>
            <Crown className="w-8 h-8" strokeWidth={1.4} style={{ color: '#D4A84B' }} />
          </div>
        </button>
        <button
          type="button"
          onClick={() => nav('/orders')}
          style={{ background: '#E9F7F3', borderRadius: 12, padding: 14, border: 'none', textAlign: 'left', position: 'relative', minHeight: 82 }}
        >
          <div style={{ fontSize: 14, color: TEXT }}>待办事项</div>
          {followTotal > 0 && (
            <span
              style={{
                position: 'absolute',
                top: 10,
                right: 10,
                minWidth: 18,
                height: 18,
                padding: '0 5px',
                borderRadius: 9,
                background: '#FF6B6B',
                color: '#fff',
                fontSize: 11,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              {followTotal}
            </span>
          )}
          <div style={{ position: 'absolute', right: 10, bottom: 10 }}>
            <ClipboardList className="w-8 h-8" strokeWidth={1.4} style={{ color: MINT }} />
          </div>
        </button>
        <button
          type="button"
          onClick={() => nav('/settings')}
          style={{ background: '#FDECEC', borderRadius: 12, padding: 14, border: 'none', textAlign: 'left', position: 'relative', minHeight: 82 }}
        >
          <div style={{ fontSize: 14, color: TEXT }}>相册印刷</div>
          <div style={{ position: 'absolute', right: 10, bottom: 10 }}>
            <Printer className="w-8 h-8" strokeWidth={1.4} style={{ color: CORAL }} />
          </div>
        </button>
      </div>

      {/* 大容器卡片：外部展示 + 功能 + 工具 + 拓客引流 + 其他功能（组间横分隔线） */}
      <div style={{ background: '#fff', borderTop: '1px solid ' + LINE }}>
        <GroupBlock title="外部展示">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <button
              type="button"
              onClick={() => nav('/settings')}
              style={{ background: '#fff', border: '1px solid ' + LINE, borderRadius: 12, padding: '14px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              <Smartphone className="w-5 h-5" strokeWidth={1.5} style={{ color: TEXT }} />
              <span style={{ fontSize: 14, color: TEXT }}>小程序</span>
            </button>
            <button
              type="button"
              onClick={() => nav('/settings')}
              style={{ background: '#fff', border: '1px solid ' + LINE, borderRadius: 12, padding: '14px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              <Monitor className="w-5 h-5" strokeWidth={1.5} style={{ color: TEXT }} />
              <span style={{ fontSize: 14, color: TEXT }}>网站</span>
            </button>
          </div>
        </GroupBlock>
        {SECTIONS.map((s, i) => (
          <GroupBlock key={s.title} title={s.title} last={i === SECTIONS.length - 1}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
              {s.items.map((it) => (
                <Cell key={it.label} item={it} onClick={() => nav(it.to)} />
              ))}
            </div>
          </GroupBlock>
        ))}
      </div>

      {/* 底部引导 */}
      <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <button
          type="button"
          style={{
            background: '#fff',
            border: '1px solid ' + LINE,
            borderRadius: 20,
            padding: '8px 28px',
            fontSize: 13,
            color: CORAL
          }}
        >
          新手引导
        </button>
        <div style={{ fontSize: 12, color: MUTED, marginTop: 12, textAlign: 'center', lineHeight: 1.6 }}>
          在电脑浏览器打开 <span style={{ color: '#3B8CFF' }}>www.picbling.com</span>
          <br />
          登录电脑端使用
        </div>
      </div>
    </div>
  );
}
