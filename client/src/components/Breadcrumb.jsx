import { useLocation, useNavigate, matchPath } from 'react-router-dom';

/* ==========================================================================
   全局通用面包屑（B 端后台）
   —— 单一组件，所有子页面生效；工作台首页（/）不渲染。
   —— 层级文本由「当前路由」对照下方配置自动生成，禁止写死页面文本。
   —— 点击上级路径走真实路由跳转（navigate），禁止 history.back 回退。
   —— 固定首级「工作台」，无论入口如何都能准确到达。
   —— 每层：{ label, to }；to 为 null 表示当前页（不可点击、黑色）。
   分隔符统一「 > 」，颜色 #BBBBBB；上级 #666666 hover #2998EB；当前页 #222222；字号 14px。
   ========================================================================== */

// 路由 → 面包屑层级配置（首级「工作台」统一追加，不在此声明）
const CRUMB_CONFIG = [
  { pattern: '/works', crumbs: [{ label: '作品管理', to: '/works' }] },
  { pattern: '/works/:id', crumbs: [{ label: '作品管理', to: '/works' }, { label: '作品详情', to: null }] },
  { pattern: '/categories', crumbs: [{ label: '分类管理', to: '/categories' }] },
  { pattern: '/packages', crumbs: [{ label: '套系', to: '/packages' }] },
  { pattern: '/packages/new', crumbs: [{ label: '套系', to: '/packages' }, { label: '新建套系', to: null }], ret: { label: '返回', to: '/packages' } },
  { pattern: '/packages/:id/edit', crumbs: [{ label: '套系', to: '/packages' }, { label: '套系编辑', to: null }], ret: { label: '返回', to: '/packages' } },
  { pattern: '/schedule', crumbs: [{ label: '档期', to: '/schedule' }] },
  { pattern: '/orders', crumbs: [{ label: '订单中心', to: '/orders' }] },
  { pattern: '/orders/:id', crumbs: [{ label: '订单中心', to: '/orders' }, { label: '订单详情', to: null }] },
  { pattern: '/appointments', crumbs: [{ label: '预约管理', to: '/appointments' }] },
  { pattern: '/reviews', crumbs: [{ label: '评价审核', to: '/reviews' }] },
  { pattern: '/settings', crumbs: [{ label: '资料设置', to: '/settings' }] },
  { pattern: '/customers', crumbs: [{ label: '客户管理', to: '/customers' }] },
  { pattern: '/datacharts', crumbs: [{ label: '数据统计', to: '/datacharts' }] },
  { pattern: '/card', crumbs: [{ label: '生成名片', to: '/card' }] },
  { pattern: '/selections', crumbs: [{ label: '在线选片', to: '/selections' }] },
  { pattern: '/channels', crumbs: [{ label: '渠道管理', to: '/channels' }] },
  { pattern: '/finance', crumbs: [{ label: '财务管理', to: '/finance' }] },
  { pattern: '/capacity', crumbs: [{ label: '容量管理', to: '/capacity' }] },
];

export default function Breadcrumb() {
  const location = useLocation();
  const navigate = useNavigate();
  const { pathname } = location;

  // 工作台首页不渲染
  if (pathname === '/') return null;

  // 选取最匹配的路由配置（pattern 越长越具体）
  let matched = null;
  let bestLen = -1;
  for (const c of CRUMB_CONFIG) {
    const m = matchPath(c.pattern, pathname);
    if (m && c.pattern.length > bestLen) {
      matched = c;
      bestLen = c.pattern.length;
    }
  }
  if (!matched) return null;

  // 组装层级：固定首级「工作台」+ 配置层级
  const items = [{ label: '工作台', to: '/' }, ...matched.crumbs];
  const ret = matched.ret;

  return (
    <nav aria-label="breadcrumb"
      className="relative z-10 flex items-center flex-wrap gap-x-1.5 gap-y-1 text-xs leading-5 mb-2 select-none">
      {ret && (
        <a href={ret.to}
          onClick={(e) => { e.preventDefault(); navigate(ret.to); }}
          className="inline-flex items-center gap-1 mr-1 text-[#666666] hover:text-[#111111] cursor-pointer transition-colors">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          返回
        </a>
      )}
      {items.map((it, i) => {
        const isLast = i === items.length - 1;
        const isClickable = !!it.to && !isLast;
        return (
          <span key={i} className="inline-flex items-center gap-1.5">
            {isClickable ? (
              <a
                href={it.to}
                onClick={(e) => { e.preventDefault(); navigate(it.to); }}
                className="hover:text-[#2998EB] cursor-pointer transition-colors"
                style={{ color: 'rgba(0,0,0,0.45)' }}
              >
                {it.label}
              </a>
            ) : (
              <span style={{ color: isLast ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.45)' }}>{it.label}</span>
            )}
            {!isLast && <span style={{ color: 'rgba(0,0,0,0.3)' }}> &gt; </span>}
          </span>
        );
      })}
    </nav>
  );
}
