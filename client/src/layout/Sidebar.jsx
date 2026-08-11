import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import http, { img } from '../api.js';
import Icon from '../components/Icon.jsx';

/* ==========================================================================
   B 端左侧固定侧边导航（1:1 复刻档期页 spec）
   宽 220px · 白底 · 右边框 #E8E8EB · padding 32px 12px
   菜单项 高40 圆角6 padding 0 14px
   普通 文字#444444 图标#888888 · 激活 背景#E6F7FF 文字/图标#2998EB · hover #F4F7FB
   —— 仅视觉复刻，路由与业务逻辑保持不变。
   ========================================================================== */

// 有 to 的可点击跳转；无 to 的为占位项（暂未开放）。expandable 为可折叠项（右侧箭头）。
// sep: 该项后插入分组分隔线
const ITEMS = [
  { label: '工作台', to: '/', icon: 'dashboard', sep: true },
  { label: '小程序', icon: 'miniapp', expandable: true },
  { label: '网站', icon: 'website', expandable: true },
  { label: '资料设置', to: '/settings', icon: 'settings', expandable: true, sep: true },
  { label: '套系', to: '/packages', icon: 'package' },
  { label: '客片', to: '/works', icon: 'photo' },
  { label: '档期', to: '/schedule', icon: 'calendar' },
  { label: '订单中心', to: '/orders', icon: 'order', sep: true },
  { label: '在线选片', to: '/selections', icon: 'select' },
  { label: '客户管理', to: '/customers', icon: 'customer', sep: true },
  { label: '团队管理', icon: 'team' },
  { label: '容量管理', to: '/capacity', icon: 'storage', expandable: true },
  { label: '数据统计', to: '/datacharts', icon: 'finance', sep: true }
];

const ITEM_STYLE = {
  height: 40,
  borderRadius: 6,
  padding: '0 14px',
  gap: 10,
  fontSize: 13,
  fontWeight: 400,
  marginBottom: 2
};

// 折叠箭头（右侧，#999999）
function Caret() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#999999"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-auto shrink-0">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function SidebarContent() {
  const [studio, setStudio] = useState(null);
  const fileRef = useRef(null);
  useEffect(() => {
    http.get('/api/settings/studio').then((r) => setStudio(r.data || null)).catch(() => {});
  }, []);
  // 头像：点击上传更换（/api/upload → 存入 settings.studio.avatar）
  const onPickAvatar = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('category', 'avatar');
      fd.append('isPublic', '1');
      const r = await http.post('/api/upload', fd);
      await http.put('/api/settings/studio', { avatar: r.data.url });
      setStudio((s) => ({ ...(s || {}), avatar: r.data.url }));
    } catch (err) { alert('头像上传失败'); }
  };
  return (
    <aside
      className="w-[300px] flex flex-col min-h-screen shrink-0"
      style={{ background: '#F8F8F8', borderRight: '1px solid #E8E8EB', padding: '20px 16px 12px' }}
    >
      {/* 品牌区：可编辑头像 + 工作室名称（位于工作台上方，参考图） */}
      <div className="flex items-center gap-3 px-2 pb-5" style={{ borderBottom: '1px solid #F0F0F0' }}>
        <button
          type="button"
          onClick={() => fileRef.current && fileRef.current.click()}
          title="点击更换头像"
          className="shrink-0 overflow-hidden"
          style={{ width: 44, height: 44, borderRadius: '50%', background: '#2998EB', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 18, cursor: 'pointer', border: 'none', padding: 0 }}
        >
          {studio && studio.avatar
            ? <img src={img(studio.avatar)} alt="头像" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : '叶'}
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickAvatar} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: '#111111', lineHeight: 1.3 }}>叶哲 Studio</span>
          <span style={{ fontSize: 11, color: '#999999', lineHeight: 1.3 }}>商家管理后台</span>
        </div>
      </div>

      {/* 菜单 */}
      <nav className="flex-1">
        {ITEMS.map((m) => {
          if (m.to) {
            return (
              <div key={m.label}>
                <NavLink
                  to={m.to}
                  end={m.to === '/'}
                  className={({ isActive }) =>
                    'flex items-center transition-colors ' +
                    (isActive ? 'bg-[#F0FDFF] text-[#2998EB]' : 'text-[#444444] hover:bg-[#EDF0F3]')
                  }
                  style={ITEM_STYLE}
                >
                  {({ isActive }) => (
                    <>
                      <span className="shrink-0 flex items-center" style={{ color: isActive ? '#2998EB' : '#888888' }}>
                        <Icon name={m.icon} className="w-4 h-4" />
                      </span>
                      <span className="truncate">{m.label}</span>
                      {m.expandable && <Caret />}
                    </>
                  )}
                </NavLink>
                {m.sep && <div style={{ height: 1, background: '#F0F0F0', margin: '6px 8px' }} />}
              </div>
            );
          }
          return (
            <div key={m.label}>
              <div
                title="敬请期待"
                className="flex items-center cursor-default select-none text-[#444444] hover:bg-[#EDF0F3] transition-colors"
                style={ITEM_STYLE}
              >
                <span className="shrink-0 flex items-center" style={{ color: '#888888' }}>
                  <Icon name={m.icon} className="w-4 h-4" />
                </span>
                <span className="truncate">{m.label}</span>
                {m.expandable && <Caret />}
              </div>
              {m.sep && <div style={{ height: 1, background: '#F0F0F0', margin: '6px 8px' }} />}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

export default function Sidebar({ open = false, onClose }) {
  return (
    <>
      {/* 移动端抽屉浮层 */}
      <div className={'lg:hidden fixed inset-0 z-50 ' + (open ? '' : 'hidden')}>
        <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose} />
        <div className="absolute left-0 top-0 bottom-0"><SidebarContent /></div>
      </div>
      {/* 桌面静态侧栏 */}
      <div className="hidden lg:block"><SidebarContent /></div>
    </>
  );
}
