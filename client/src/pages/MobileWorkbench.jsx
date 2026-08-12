import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import http, { img, uploadImage } from '../api.js';
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
  Link,
  Eye,
  EyeOff
} from 'lucide-react';

// 截图色板（主色统一珊瑚红 #FF7A8A，与底部 TabBar/+ 按钮同色）
const CORAL = '#FF7A8A';
const MINT = '#7ECDBB';
const TEXT = '#1f2329';
const MUTED = '#999999';
const LINE = '#EFEFEF';

// 本地开发兜底：把头像压缩成 base64 dataURI 直接存用户表，避免无云存储时上传失败
function compressImageToBase64(file, maxWidth = 400, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, maxWidth / Math.max(img.width, img.height));
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const SECTIONS = [
  {
    title: '功能',
    items: [
      { label: '新手引导', icon: BookOpen, color: CORAL, to: '/settings' },
      { label: '资料', icon: FileText, color: CORAL, to: '/settings' },
      { label: '作品', icon: Image, color: CORAL, to: '/works' },
      { label: '套系', icon: Layers, color: CORAL, to: '/packages' }
    ]
  },
  {
    title: '工具',
    items: [
      { label: '档期', icon: CalendarDays, color: CORAL, to: '/schedule' },
      { label: '订单', icon: ClipboardList, color: CORAL, to: '/orders' },
      { label: '客资', icon: Users, color: CORAL, to: '/customers' },
      { label: '选片工具', icon: Images, color: CORAL, to: '/selections' },
      { label: '团队管理', icon: UserCog, color: CORAL, to: '/settings' },
      { label: '评价管理', icon: MessageSquare, color: CORAL, to: '/reviews' },
      { label: '图片直播', icon: Video, color: CORAL, to: '/settings' },
      { label: 'AI修图', icon: Sparkles, color: CORAL, to: '/settings' }
    ]
  },
  {
    title: '拓客引流',
    items: [
      { label: '优惠券', icon: Ticket, color: CORAL, to: '/settings' },
      { label: '促销套系', icon: Diamond, color: CORAL, to: '/packages' },
      { label: '优惠码', icon: Tag, color: CORAL, to: '/settings' },
      { label: '拼团活动', icon: Users2, color: CORAL, to: '/settings' },
      { label: '客户积分', icon: Coins, color: CORAL, to: '/settings' },
      { label: '生成名片', icon: IdCard, color: CORAL, to: '/card' },
      { label: '九图海报', icon: LayoutGrid, color: CORAL, to: '/settings' },
      { label: '摄影日历', icon: CalendarDays, color: CORAL, to: '/schedule' }
    ]
  },
  {
    title: '其他功能',
    items: [
      { label: '相册印刷', icon: Printer, color: CORAL, to: '/settings', tag: 'NEW' },
      { label: '存储空间', icon: HardDrive, color: CORAL, to: '/capacity' },
      { label: '容量管理', icon: Gauge, color: CORAL, to: '/capacity' },
      { label: '访客', icon: User, color: CORAL, to: '/datacharts' },
      { label: '统计', icon: BarChart3, color: CORAL, to: '/datacharts' },
      { label: '关联公众号', icon: MessageCircle, color: CORAL, to: '/settings' }
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
      <Icon className="w-7 h-7" strokeWidth={1.5} style={{ color: item.color }} />
      <span className="mt-2" style={{ fontSize: 13, color: TEXT }}>{item.label}</span>
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

function GroupBlock({ title, children, last, pink }) {
  return (
    <div
      style={{
        padding: '16px',
        background: pink ? '#FFF5F5' : '#fff',
        borderBottom: last ? 'none' : '1px solid ' + LINE
      }}
    >
      <div style={{ fontSize: 17, color: TEXT, marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );
}

export default function MobileWorkbench() {
  const nav = useNavigate();
  const { user, updateUser } = useAuth();
  const [stats, setStats] = useState(null);
  const [studio, setStudio] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hideBalance, setHideBalance] = useState(false);
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const handleAvatar = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      setUploading(true);
      // 先尝试云端上传（线上有 COS/R2 配置时走正常路径）
      try {
        const r = await uploadImage(file, { category: 'avatar', isPublic: true });
        await updateUser({ avatar: r.url });
        return;
      } catch (cloudErr) {
        // 本地开发未配置云存储时会失败，降级为压缩后 base64 直接存用户表
        console.warn('云端上传不可用，降级为 base64 头像', cloudErr);
        const dataUrl = await compressImageToBase64(file);
        await updateUser({ avatar: dataUrl });
      }
    } catch (err) {
      console.warn('头像保存失败', err);
      alert('头像保存失败，请重试');
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    http.get('/api/stats')
      .then((r) => setStats(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // 工作室名称（编辑资料可改，存于 settings/studio.name）
  useEffect(() => {
    http.get('/api/settings/studio')
      .then((r) => setStudio(r.data))
      .catch(() => setStudio({}));
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
            <button
              type="button"
              onClick={() => fileRef.current && fileRef.current.click()}
              disabled={uploading}
              style={{ width: 50, height: 50, borderRadius: '50%', overflow: 'hidden', background: '#333', border: 'none', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative', cursor: 'pointer' }}
            >
              {user?.avatar ? (
                <img src={img(user.avatar)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span style={{ fontSize: 20, color: '#fff' }}>岛</span>
              )}
              {uploading && (
                <span style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', color: '#fff', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  上传中
                </span>
              )}
              <span
                style={{
                  position: 'absolute',
                  right: 0,
                  bottom: 0,
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  background: '#7ECDBB',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '2px solid #1A1A1A'
                }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
                  <circle cx="12" cy="13" r="3" />
                </svg>
              </span>
            </button>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatar} />
            <div>
              <div style={{ fontSize: 17 }}>{studio?.name || user?.name || '岛像微电影'}</div>
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

      {/* 统计区（一行 3 功能横版：余额 / 待跟进 / 待拍摄） */}
      <div style={{ background: '#fff', borderTop: '1px solid ' + LINE, borderBottom: '1px solid ' + LINE }}>
        <div style={{ display: 'flex' }}>
          {/* 余额：与网页版后台「商户余额」同步，使用 stats.balance，点击跳财务管理 */}
          <div
            onClick={() => nav('/finance')}
            style={{ flex: 1, textAlign: 'center', padding: '14px 0 12px', cursor: 'pointer' }}
          >
            <div className="flex items-center justify-center" style={{ color: CORAL, lineHeight: 1 }}>
              <span style={{ fontSize: hideBalance ? 18 : 24 }}>
                {hideBalance ? '¥ ***' : (stats && typeof stats.balance === 'number' ? '¥' + stats.balance.toLocaleString() : '--')}
              </span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setHideBalance((v) => !v); }}
                style={{ background: 'none', border: 'none', padding: 4, marginLeft: 2, display: 'flex', alignItems: 'center', color: '#D0D0D0' }}
              >
                {hideBalance ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <div style={{ fontSize: 11, color: '#BBBBBB', marginTop: 6 }}>余额</div>
          </div>
          <div style={{ width: 1, background: LINE, margin: '14px 0' }} />
          {/* 待跟进 */}
          <button
            type="button"
            onClick={() => nav('/orders')}
            style={{ flex: 1, textAlign: 'center', padding: '14px 0 12px', background: 'none', border: 'none' }}
          >
            <div style={{ fontSize: 24, color: TEXT, lineHeight: 1 }}>{followTotal}</div>
            <div style={{ fontSize: 11, color: '#BBBBBB', marginTop: 6 }}>待跟进</div>
          </button>
          <div style={{ width: 1, background: LINE, margin: '14px 0' }} />
          {/* 待拍摄：跳转待办事项页并自动定位到「等待拍摄」Tab */}
          <button
            type="button"
            onClick={() => nav('/orders?tab=waitingShoot')}
            style={{ flex: 1, textAlign: 'center', padding: '14px 0 12px', background: 'none', border: 'none' }}
          >
            <div style={{ fontSize: 24, color: TEXT, lineHeight: 1 }}>{shootCount}</div>
            <div style={{ fontSize: 11, color: '#BBBBBB', marginTop: 6 }}>待拍摄</div>
          </button>
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

      {/* 大容器卡片：外部展示（粉色强调）+ 功能（无标题）+ 工具 + 拓客引流 + 其他功能 */}
      <div style={{ background: '#fff', borderTop: '1px solid ' + LINE }}>
        <GroupBlock title="外部展示" pink last>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <button
              type="button"
              onClick={() => nav('/home')}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '16px 0', background: '#fff', border: '1px solid ' + LINE, borderRadius: 12 }}
            >
              <Link className="w-5 h-5" strokeWidth={1.5} style={{ color: TEXT }} />
              <span style={{ fontSize: 14, color: TEXT }}>小程序</span>
            </button>
            <button
              type="button"
              onClick={() => nav('/settings')}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '16px 0', background: '#fff', border: '1px solid ' + LINE, borderRadius: 12 }}
            >
              <Monitor className="w-5 h-5" strokeWidth={1.5} style={{ color: TEXT }} />
              <span style={{ fontSize: 14, color: TEXT }}>网站</span>
            </button>
          </div>
        </GroupBlock>
        {/* 功能：无标题、无下边框，与工具视觉连为一体 */}
        <div style={{ padding: '16px 16px 8px', background: '#fff' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
            {SECTIONS[0].items.map((it) => (
              <Cell key={it.label} item={it} onClick={() => nav(it.to)} />
            ))}
          </div>
        </div>
        {SECTIONS.slice(1).map((s, i) => (
          <GroupBlock key={s.title} title={s.title} last={i === SECTIONS.slice(1).length - 1}>
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
          在电脑浏览器打开{' '}
          <a href="https://yezhe-studio.pages.dev" target="_blank" rel="noreferrer" style={{ color: '#3B8CFF', textDecoration: 'none' }}>
            yezhe-studio.pages.dev
          </a>
          <br />
          登录电脑端后台使用
        </div>
      </div>
    </div>
  );
}
