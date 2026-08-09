import { NavLink } from 'react-router-dom';
import Icon from '../components/Icon.jsx';

// B端完整菜单（对标档期页 spec：白底、激活浅蓝高亮、完整 18 项）
// 有 to 的可点击跳转；无 route 的项为灰色占位（敬请期待），不激活。
const ITEMS = [
  { label: '工作台', to: '/', icon: 'dashboard' },
  { label: '小程序', icon: 'miniapp' },
  { label: '网站', icon: 'website' },
  { label: '资料设置', to: '/settings', icon: 'settings' },
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
  { label: '容量管理', to: '/capacity', icon: 'storage' },
  { label: '数据统计', to: '/datacharts', icon: 'finance' },
  { label: '相册印刷', icon: 'album' }
];

function SidebarContent() {
  return (
    <aside className="w-60 bg-white border-r border-line flex flex-col h-full">
      <div className="h-[72px] flex items-center gap-3 px-5 border-b border-line shrink-0">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center text-white font-semibold" style={{ background: '#2890F0' }}>叶</div>
        <div>
          <div className="font-semibold leading-tight" style={{ color: '#1f2329' }}>叶哲 Studio</div>
          <div className="text-[11px] leading-tight" style={{ color: '#999999' }}>商家管理后台</div>
        </div>
      </div>

      <nav className="flex-1 py-3 overflow-y-auto">
        {ITEMS.map((m) => {
          if (m.to) {
            return (
              <NavLink
                key={m.label}
                to={m.to}
                end={m.to === '/'}
                className={({ isActive }) =>
                  'flex items-center gap-3 px-5 py-2.5 text-sm transition border-l-2 ' +
                  (isActive
                    ? 'bg-[#e8f3ff] text-[#2890F0] border-[#2890F0] font-medium'
                    : 'text-[#333333] border-transparent hover:bg-[#f5f7fa] hover:text-[#1f2329]')
                }
              >
                <Icon name={m.icon} className="w-[18px] h-[18px]" />
                {m.label}
              </NavLink>
            );
          }
          return (
            <div key={m.label} className="flex items-center gap-3 px-5 py-2.5 text-sm cursor-default select-none" style={{ color: '#999999' }}>
              <Icon name={m.icon} className="w-[18px] h-[18px]" />
              {m.label}
            </div>
          );
        })}
      </nav>

      <div className="p-4 text-[11px] border-t border-line" style={{ color: '#999999' }}>零成本 · 公网私有化部署</div>
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
