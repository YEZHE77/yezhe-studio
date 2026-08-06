import { NavLink } from 'react-router-dom';
import Icon from '../components/Icon.jsx';

// 浅色侧边导航：分组（获客→上架→履约→售后→数据），蓝色高亮选中
const GROUPS = [
  { title: '概览', items: [{ to: '/', label: '工作台', icon: 'dashboard' }] },
  {
    title: '内容管理',
    items: [
      { to: '/works', label: '作品', icon: 'photo' },
      { to: '/packages', label: '套系', icon: 'package' },
      { to: '/schedule', label: '档期', icon: 'calendar' },
      { to: '/settings', label: '资料设置', icon: 'settings' },
      { to: '/customers', label: '客户管理', icon: 'customer' }
    ]
  },
  {
    title: '业务运营',
    items: [
      { to: '/orders', label: '订单中心', icon: 'order' },
      { to: '/appointments', label: '预约管理', icon: 'appointment' },
      { to: '/selections', label: '在线选片', icon: 'select' },
      { to: '/reviews', label: '评价审核', icon: 'review' }
    ]
  },
  {
    title: '获客工具',
    items: [
      { to: '/card', label: '生成名片', icon: 'link' }
    ]
  },
  {
    title: '容量管理',
    items: [
      { to: '/capacity', label: '容量管理', icon: 'storage' }
    ]
  },
  { title: '数据', items: [{ to: '/finance', label: '财务管理', icon: 'finance' }, { to: '/datacharts', label: '数据统计', icon: 'dashboard' }] }
];

export default function Sidebar() {
  return (
    <aside className="w-60 bg-panel border-r border-line flex flex-col shrink-0">
      <div className="h-[72px] flex items-center gap-3 px-5 border-b border-line">
        <div className="w-9 h-9 rounded-lg bg-brand flex items-center justify-center text-white font-semibold">叶</div>
        <div>
          <div className="font-semibold text-fg leading-tight">叶哲 Studio</div>
          <div className="text-[11px] text-faint leading-tight">商家管理后台</div>
        </div>
      </div>

      <nav className="flex-1 py-3 overflow-y-auto">
        {GROUPS.map((g) => (
          <div key={g.title} className="mb-2">
            <div className="px-5 pb-1 text-[11px] font-medium text-faint tracking-wide">{g.title}</div>
            {g.items.map((m) => (
              <NavLink
                key={m.to + m.label}
                to={m.to}
                end={m.to === '/'}
                className={({ isActive }) =>
                  'flex items-center gap-3 px-5 py-2.5 text-sm transition border-l-2 ' +
                  (isActive
                    ? 'bg-brand/10 text-brand border-brand font-medium'
                    : 'text-muted border-transparent hover:bg-panel2 hover:text-fg')
                }
              >
                <Icon name={m.icon} className="w-[18px] h-[18px]" />
                {m.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="p-4 text-[11px] text-faint border-t border-line">零成本 · 公网私有化部署</div>
    </aside>
  );
}
