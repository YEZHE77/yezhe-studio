import { NavLink } from 'react-router-dom';
import Icon from '../components/Icon.jsx';

/* ==========================================================================
   B 端左侧固定侧边导航（1:1 复刻档期页 spec）
   宽 220px · 白底 · 右边框 #E8E8EB · padding 32px 12px
   菜单项 高40 圆角6 padding 0 14px
   普通 文字#444444 图标#888888 · 激活 背景#E6F7FF 文字/图标#2998EB · hover #F4F7FB
   —— 仅视觉复刻，路由与业务逻辑保持不变。
   ========================================================================== */

// 有 to 的可点击跳转；无 to 的为占位项（暂未开放）。expandable 为可折叠项（右侧箭头）。
const ITEMS = [
  { label: '工作台', to: '/', icon: 'dashboard' },
  { label: '小程序', icon: 'miniapp', expandable: true },
  { label: '网站', icon: 'website', expandable: true },
  { label: '资料设置', to: '/settings', icon: 'settings', expandable: true },
  { label: '套系', to: '/packages', icon: 'package' },
  { label: '客片', to: '/works', icon: 'photo' },
  { label: '档期', to: '/schedule', icon: 'calendar' },
  { label: '订单中心', to: '/orders', icon: 'order' },
  { label: '营销工具', icon: 'marketing' },
  { label: '在线选片', to: '/selections', icon: 'select' },
  { label: '图片直播', icon: 'live' },
  { label: 'AI修图', icon: 'ai' },
  { label: '客户管理', to: '/customers', icon: 'customer' },
  { label: '团队管理', icon: 'team' },
  { label: '评论管理', to: '/reviews', icon: 'review' },
  { label: '容量管理', to: '/capacity', icon: 'storage', expandable: true },
  { label: '数据统计', to: '/datacharts', icon: 'finance' },
  { label: '相册印刷', icon: 'album' }
];

const ITEM_STYLE = {
  height: 40,
  borderRadius: 6,
  padding: '0 14px',
  gap: 10,
  fontSize: 14,
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
  return (
    <aside
      className="w-[220px] bg-white flex flex-col h-full shrink-0"
      style={{ borderRight: '1px solid #E8E8EB', padding: '32px 12px' }}
    >
      {/* 菜单 */}
      <nav className="flex-1 overflow-y-auto">
        {ITEMS.map((m) => {
          if (m.to) {
            return (
              <NavLink
                key={m.label}
                to={m.to}
                end={m.to === '/'}
                className={({ isActive }) =>
                  'flex items-center transition-colors ' +
                  (isActive ? 'bg-[#E6F7FF] text-[#2998EB]' : 'text-[#444444] hover:bg-[#F4F7FB]')
                }
                style={ITEM_STYLE}
              >
                {({ isActive }) => (
                  <>
                    <span className="shrink-0 flex items-center" style={{ color: isActive ? '#2998EB' : '#888888' }}>
                      <Icon name={m.icon} className="w-[18px] h-[18px]" />
                    </span>
                    <span className="truncate">{m.label}</span>
                    {m.expandable && <Caret />}
                  </>
                )}
              </NavLink>
            );
          }
          return (
            <div
              key={m.label}
              title="敬请期待"
              className="flex items-center cursor-default select-none text-[#444444] hover:bg-[#F4F7FB] transition-colors"
              style={ITEM_STYLE}
            >
              <span className="shrink-0 flex items-center" style={{ color: '#888888' }}>
                <Icon name={m.icon} className="w-[18px] h-[18px]" />
              </span>
              <span className="truncate">{m.label}</span>
              {m.expandable && <Caret />}
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
      <div className="hidden lg:block h-full"><SidebarContent /></div>
    </>
  );
}
