import React, { useState, useEffect, useRef, useCallback } from 'react';
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
      { label: '新手引导', icon: BookOpen, color: MINT, to: '/settings' },
      { label: '资料', icon: FileText, color: MINT, to: '/settings' },
      { label: '作品', icon: Image, color: MINT, to: '/works' },
      { label: '套系', icon: Layers, color: MINT, to: '/packages' }
    ]
  },
  {
    title: '工具',
    items: [
      { label: '档期', icon: CalendarDays, color: MINT, to: '/schedule' },
      { label: '订单', icon: ClipboardList, color: MINT, to: '/orders' },
      { label: '客资', icon: Users, color: MINT, to: '/customers' },
      { label: '选片工具', icon: Images, color: MINT, to: '/selections' },
      { label: '团队管理', icon: UserCog, color: MINT, to: '/settings' },
      { label: '评价管理', icon: MessageSquare, color: MINT, to: '/reviews' },
      { label: '图片直播', icon: Video, color: MINT, to: '/settings' },
      { label: 'AI修图', icon: Sparkles, color: MINT, to: '/settings' }
    ]
  },
  {
    title: '其他功能',
    items: [
      { label: '相册印刷', icon: Printer, color: MINT, to: '/settings', tag: 'NEW' },
      { label: '存储空间', icon: HardDrive, color: MINT, to: '/capacity' },
      { label: '容量管理', icon: Gauge, color: MINT, to: '/capacity' },
      { label: '访客', icon: User, color: MINT, to: '/datacharts' },
      { label: '统计', icon: BarChart3, color: MINT, to: '/datacharts' },
      { label: '关联公众号', icon: MessageCircle, color: MINT, to: '/settings' }
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
  const [miniOpen, setMiniOpen] = useState(false);
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

  const refreshStats = useCallback(() => {
    http.get('/api/stats')
      .then((r) => setStats(r.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    refreshStats();
    setLoading(false);
    // 页面重新可见时刷新（从订单/档期等页面返回后数字实时更新）
    const onVis = () => {
      if (document.visibilityState === 'visible') refreshStats();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refreshStats]);

  // 工作室名称（编辑资料可改，存于 settings/studio.name）
  useEffect(() => {
    http.get('/api/settings/studio')
      .then((r) => setStudio(r.data))
      .catch(() => setStudio({}));
  }, []);

  // 「小程序」入口：微信内尝试直接跳转客户小程序（H5 处于小程序 web-view 时生效），
  // 不可用时降级为小程序码弹层（微信内长按识别进入）
  const handleMiniProgram = () => {
    const isWechat = /MicroMessenger/i.test(navigator.userAgent || '');
    if (isWechat) {
      const wxSdk = window.wx;
      if (wxSdk && wxSdk.miniProgram && typeof wxSdk.miniProgram.navigateTo === 'function') {
        try {
          wxSdk.miniProgram.navigateTo({ url: '/pages/index/index' });
          return;
        } catch (e) { /* 降级弹层 */ }
      }
    }
    setMiniOpen(true);
  };
  const closeMini = () => setMiniOpen(false);

  const pb = stats && stats.pendingBlocks ? stats.pendingBlocks : {};
  const todo = stats && stats.todo ? stats.todo : {};
  const safe = (v) => (typeof v === 'number' ? v : 0);
  // 待办事项角标：所有活跃中的订单（未付定金、已付定金、等待拍摄、选片中、精修中、已交片）
  const followTotal = safe(pb.unpaid) + safe(pb.deposit) + safe(pb.shoot) + safe(pb.selecting) + safe(pb.retouching) + safe(pb.delivered);
  // 已付定金：优先与订单页「已付定金」Tab 同口径（stats.todo），后端未更新时回退到旧待办总数量
  const depositCount = (stats && typeof todo.deposit === 'number') ? todo.deposit : followTotal;
  // 等待拍摄：优先与订单页「等待拍摄」Tab 同口径（stats.todo），后端未更新时回退到旧 pendingBlocks.deposit
  const shootCount = (stats && typeof todo.waitingShoot === 'number') ? todo.waitingShoot : (pb.deposit || 0);

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
      <div style={{ background: '#fff', borderTop: '1px solid ' + LINE }}>
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
          {/* 已付定金：点击跳待办事项并定位到「已付定金」Tab（进度条未到等待拍摄节点） */}
          <button
            type="button"
            onClick={() => nav('/todo?tab=deposit')}
            style={{ flex: 1, textAlign: 'center', padding: '14px 0 12px', background: 'none', border: 'none' }}
          >
            <div style={{ fontSize: 24, color: TEXT, lineHeight: 1 }}>{depositCount}</div>
            <div style={{ fontSize: 11, color: '#BBBBBB', marginTop: 6 }}>已付定金</div>
          </button>
          <div style={{ width: 1, background: LINE, margin: '14px 0' }} />
          {/* 等待拍摄：跳转待办事项页并自动定位到「等待拍摄」Tab */}
          <button
            type="button"
            onClick={() => nav('/todo?tab=waiting')}
            style={{ flex: 1, textAlign: 'center', padding: '14px 0 12px', background: 'none', border: 'none' }}
          >
            <div style={{ fontSize: 24, color: TEXT, lineHeight: 1 }}>{shootCount}</div>
            <div style={{ fontSize: 11, color: '#BBBBBB', marginTop: 6 }}>等待拍摄</div>
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
            <Crown className="w-8 h-8" strokeWidth={1.4} style={{ color: MINT }} />
          </div>
        </button>
        <button
          type="button"
          onClick={() => nav('/todo')}
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
            <Printer className="w-8 h-8" strokeWidth={1.4} style={{ color: MINT }} />
          </div>
        </button>
      </div>

      {/* 大容器卡片：外部展示（粉色强调）+ 功能（无标题）+ 工具 + 拓客引流 + 其他功能 */}
      <div style={{ background: '#fff' }}>
        <GroupBlock title="外部展示" last>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <button
              type="button"
              onClick={handleMiniProgram}
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

      {/* 小程序码弹层：进入客户小程序（微信内长按识别，非微信/未配置时展示 H5 备用入口） */}
      {miniOpen && (
        <div
          onClick={closeMini}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 90, padding: 24 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 16, padding: '24px 20px 20px', width: '100%', maxWidth: 320, textAlign: 'center' }}
          >
            <div style={{ fontSize: 16, fontWeight: 600, color: TEXT }}>进入客户小程序</div>
            {studio && studio.miniProgram && studio.miniProgram.qr ? (
              <>
                <img
                  src={img(studio.miniProgram.qr)}
                  alt="小程序码"
                  style={{ width: 190, height: 190, margin: '16px auto 8px', objectFit: 'contain', borderRadius: 10, border: '1px solid ' + LINE }}
                />
                <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.7 }}>
                  在微信中<b style={{ color: TEXT }}>长按识别二维码</b>
                  <br />
                  即可进入客户小程序
                </div>
              </>
            ) : (
              <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.7, margin: '18px 0 6px' }}>
                尚未上传小程序码
                <br />
                请在 B 端「资料设置」→「小程序码」中上传后，即可扫码进入客户小程序
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button
                type="button"
                onClick={() => { closeMini(); nav('/home'); }}
                style={{ flex: 1, padding: '11px 0', borderRadius: 10, border: '1px solid ' + LINE, background: '#fff', fontSize: 14, color: TEXT }}
              >
                打开 H5 版
              </button>
              <button
                type="button"
                onClick={closeMini}
                style={{ flex: 1, padding: '11px 0', borderRadius: 10, border: 'none', background: CORAL, fontSize: 14, color: '#fff' }}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
