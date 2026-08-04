import { NavLink } from 'react-router-dom';

// 深色左侧菜单栏顺序（1:1 复刻拾光盒子）
const MENU = [
  { to: '/', label: '工作台', icon: '▦' },
  { to: '/works', label: '作品', icon: '▣' },
  { to: '/packages', label: '套系', icon: '◆' },
  { to: '/schedule', label: '档期', icon: '▤' },
  { to: '/orders', label: '订单中心', icon: '▥' },
  { to: '/appointments', label: '预约管理', icon: '✎' },
  { to: '/reviews', label: '评价审核', icon: '★' },
  { to: '/finance', label: '财务管理', icon: '¥' }
];

export default function Sidebar() {
  return (
    <aside className="w-56 bg-ink border-r border-line flex flex-col shrink-0">
      <div className="h-16 flex items-center px-5 border-b border-line">
        <div className="w-8 h-8 rounded-lg bg-brand mr-3" />
        <div className="font-semibold text-white">叶哲 Studio</div>
      </div>
      <nav className="flex-1 py-3">
        {MENU.map((m) => (
          <NavLink
            key={m.to}
            to={m.to}
            end={m.to === '/'}
            className={({ isActive }) =>
              'flex items-center gap-3 px-5 py-3 text-sm transition ' +
              (isActive ? 'bg-panel2 text-white border-l-2 border-brand' : 'text-muted hover:bg-panel hover:text-white')
            }
          >
            <span className="w-4 text-center">{m.icon}</span>
            {m.label}
          </NavLink>
        ))}
      </nav>
      <div className="p-4 text-xs text-muted border-t border-line">零成本 · 公网部署</div>
    </aside>
  );
}
