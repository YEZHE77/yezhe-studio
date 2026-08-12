import React, { Suspense, useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { useAuth } from '../auth.jsx';
import MobileWorkbench from '../pages/MobileWorkbench.jsx';

// 复用现有 B 端页面组件（独立懒加载，不触碰桌面 AppShell 路由表）
const Works = React.lazy(() => import('../pages/Works.jsx'));
const Categories = React.lazy(() => import('../pages/Categories.jsx'));
const WorkDetail = React.lazy(() => import('../pages/WorkDetail.jsx'));
const Packages = React.lazy(() => import('../pages/Packages.jsx'));
const PackageEdit = React.lazy(() => import('../pages/PackageEdit.jsx'));
const Schedule = React.lazy(() => import('../pages/Schedule.jsx'));
const Orders = React.lazy(() => import('../pages/Orders.jsx'));
const OrderDetail = React.lazy(() => import('../pages/OrderDetail.jsx'));
const Appointments = React.lazy(() => import('../pages/Appointments.jsx'));
const Reviews = React.lazy(() => import('../pages/Reviews.jsx'));
const Settings = React.lazy(() => import('../pages/Settings.jsx'));
const Customers = React.lazy(() => import('../pages/Customers.jsx'));
const DataCharts = React.lazy(() => import('../pages/DataCharts.jsx'));
const BusinessCard = React.lazy(() => import('../pages/BusinessCard.jsx'));
const SelectionAdmin = React.lazy(() => import('../pages/SelectionAdmin.jsx'));
const CapacityManagement = React.lazy(() => import('../pages/CapacityManagement.jsx'));
const Channels = React.lazy(() => import('../pages/Channels.jsx'));
const Finance = React.lazy(() => import('../pages/Finance.jsx'));
// C 端微官网（H5 客户首页，与小程序 pages/index 结构一致）——工作台「小程序」入口预览
const Home = React.lazy(() => import('../pages/Home.jsx'));

const GREEN = '#7ECDBB';
const GREEN_DARK = '#5FBBA6';
const PINK = '#FF7A8A';
const PINK_DARK = '#FF6B6B';
const TEXT = '#1f2329';
const MUTED = '#999999';
const BAR_BG = '#ffffff';

// 轻量占位页（公告 / 消息 / 微官网）——无对应后端接口，仅提供清晰空状态，杜绝付费营销
function Placeholder({ title, hint }) {
  const nav = useNavigate();
  return (
    <div style={{ minHeight: '100vh', background: '#F8F8F8', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <span style={{ width: 64, height: 64, borderRadius: 16, background: 'rgba(96,196,170,0.12)', color: GREEN_DARK, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
        <Icon name="dashboard" className="w-8 h-8" />
      </span>
      <div style={{ fontSize: 15, color: TEXT }}>{title}</div>
      <div style={{ fontSize: 13, color: MUTED, marginTop: 8, textAlign: 'center', lineHeight: 1.6 }}>{hint}</div>
      <button type="button" onClick={() => nav('/')} style={{ marginTop: 20, fontSize: 13, color: GREEN_DARK, background: '#fff', border: '1px solid ' + GREEN, borderRadius: 6, padding: '8px 18px' }}>返回工作台</button>
    </div>
  );
}

function MobileSite() {
  const { user } = useAuth();
  const name = user?.studioName || user?.name || user?.username || '叶哲 Studio';
  return (
    <div style={{ minHeight: '100vh', background: '#F8F8F8', padding: 12 }}>
      <div style={{ background: 'linear-gradient(135deg,#60C4AA,#4BB399)', borderRadius: 12, padding: 20, color: '#fff' }}>
        <div style={{ fontSize: 18 }}>{name}</div>
        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 6 }}>工作室微官网 · 对外展示</div>
      </div>
      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #EFEFEF', marginTop: 12, padding: 16, fontSize: 13, color: MUTED, lineHeight: 1.7 }}>
        微官网用于在微信中向客户展示作品与套系。可在「资料」中编辑封面、简介与成员，并配置独立域名与小程序。
      </div>
      <Placeholder title="微官网预览" hint="完整预览将在「资料设置」配置完成后开放。" />
    </div>
  );
}

function PageLoader() {
  return (
    <div className="flex items-center justify-center" style={{ minHeight: '60vh', color: MUTED, fontSize: 13, gap: 8 }}>
      <span className="inline-block w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'rgba(96,196,170,0.3)', borderTopColor: GREEN }} />
      加载中…
    </div>
  );
}

// 顶部返回条（仅在进入深层业务页时显示，tab 首页不显示）
function TopBack({ title }) {
  const nav = useNavigate();
  return (
    <div className="flex items-center" style={{ background: BAR_BG, borderBottom: '1px solid #EFEFEF', padding: '12px 12px', position: 'sticky', top: 0, zIndex: 5 }}>
      <button type="button" onClick={() => nav('/')} className="flex items-center" style={{ background: 'none', border: 'none', padding: 0, color: TEXT }}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke={TEXT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
        <span style={{ fontSize: 14, marginLeft: 2 }}>返回</span>
      </button>
      <span className="flex-1 text-center" style={{ fontSize: 15, color: TEXT }}>{title}</span>
      <span style={{ width: 40 }} />
    </div>
  );
}

// 底部 Tab（工作台 / 微官网 / + / 公告 / 消息）
const TABS = [
  { key: 'home', label: '工作台', icon: 'monitor', to: '/' },
  { key: 'site', label: '微官网', icon: 'home', to: '/m/site' },
  { key: 'plus', label: '', icon: 'plus', to: '' },
  { key: 'notice', label: '公告', icon: 'compass', to: '/m/notice' },
  { key: 'msg', label: '消息', icon: 'bell', to: '/m/msg', badge: 2 }
];

// + 快捷新建
const QUICK_CREATE = [
  { label: '新建作品', icon: 'photo', to: '/works' },
  { label: '新建套系', icon: 'package', to: '/packages/new' },
  { label: '新建订单', icon: 'order', to: '/orders' },
  { label: '新建档期', icon: 'calendar', to: '/schedule' }
];

function ActionSheet({ open, onClose }) {
  const nav = useNavigate();
  if (!open) return null;
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 50, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#F8F8F8', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingBottom: 28 }}>
        <div style={{ fontSize: 13, color: MUTED, textAlign: 'center', marginBottom: 12 }}>快捷新建</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', background: '#fff', borderRadius: 12, border: '1px solid #EFEFEF' }}>
          {QUICK_CREATE.map((q) => (
            <button key={q.label} type="button" onClick={() => { onClose(); nav(q.to); }} className="flex flex-col items-center justify-center" style={{ padding: '16px 4px' }}>
              <span style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(96,196,170,0.10)', color: GREEN_DARK, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={q.icon} className="w-6 h-6" />
              </span>
              <span className="mt-2" style={{ fontSize: 12, color: TEXT }}>{q.label}</span>
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose} style={{ marginTop: 12, width: '100%', background: '#fff', border: '1px solid #EFEFEF', borderRadius: 12, padding: '13px 0', fontSize: 15, color: TEXT }}>取消</button>
      </div>
    </div>
  );
}

function TabBar({ active, onTab, onPlus }) {
  return (
    <div className="flex items-stretch" style={{ background: BAR_BG, borderTop: '1px solid #EFEFEF', height: 56, paddingBottom: 'env(safe-area-inset-bottom)', position: 'sticky', bottom: 0, zIndex: 10 }}>
      {TABS.map((t) => {
        if (t.key === 'plus') {
          return (
            <button key={t.key} type="button" onClick={onPlus} style={{ flex: 1, background: 'none', border: 'none', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 10 }}>
              <span style={{ width: 38, height: 38, borderRadius: 10, background: PINK, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(255,122,138,0.4)' }}>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
              </span>
            </button>
          );
        }
        const isActive = active === t.key;
        const color = isActive ? PINK : MUTED;
        return (
          <button key={t.key} type="button" onClick={() => onTab(t.to)} className="flex-1 flex flex-col items-center justify-center" style={{ background: 'none', border: 'none', position: 'relative' }}>
            <Icon name={t.icon} className="w-5 h-5" strokeWidth={1.6} style={{ color }} />
            <span className="mt-0.5" style={{ fontSize: 11, color }}>{t.label}</span>
            {!!t.badge && (
              <span style={{ position: 'absolute', top: 6, right: '22%', minWidth: 16, height: 16, borderRadius: 8, background: '#FF4D4F', color: '#fff', fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', border: '2px solid #fff' }}>
                {t.badge > 99 ? '99+' : t.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// 深层业务页顶部标题
function getPageTitle(path) {
  if (path === '/home') return '微官网';
  if (path === '/finance') return '财务管理';
  if (path === '/settings') return '资料设置';
  if (path === '/orders') return '待办事项';
  if (path.startsWith('/orders/')) return '订单详情';
  if (path === '/schedule') return '档期管理';
  if (path === '/works') return '作品管理';
  if (path.startsWith('/works/')) return '作品详情';
  if (path === '/packages') return '套系管理';
  if (path.startsWith('/packages/')) return '套系详情';
  if (path === '/customers') return '客资管理';
  if (path === '/datacharts') return '数据统计';
  if (path === '/card') return '名片';
  if (path === '/capacity') return '容量管理';
  if (path === '/channels') return '渠道管理';
  if (path === '/reviews') return '评价管理';
  if (path === '/selections') return '选片工具';
  if (path === '/appointments') return '预约管理';
  return '工作台';
}

export default function MobileShell() {
  const location = useLocation();
  const nav = useNavigate();
  const [sheetOpen, setSheetOpen] = useState(false);

  const tabRoots = ['/', '/m/site', '/m/notice', '/m/msg'];
  const hideTopBackRoutes = ['/works'];
  const isTab = tabRoots.includes(location.pathname);
  // /works/:id 与 /works/new 等子路由由页面内自带顶部导航，避免双层 TopBack
  const hideTopBack = hideTopBackRoutes.includes(location.pathname) || location.pathname.startsWith('/works/');
  const pageTitle = getPageTitle(location.pathname);
  const activeKey = (() => {
    if (location.pathname === '/') return 'home';
    if (location.pathname.startsWith('/m/site')) return 'site';
    if (location.pathname.startsWith('/m/notice')) return 'notice';
    if (location.pathname.startsWith('/m/msg')) return 'msg';
    return '';
  })();

  // 进入深层业务页时，锁定背景滚动由内容区处理；此处仅保证挂载
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);

  return (
    <div className="flex flex-col" style={{ height: '100dvh', overflow: 'hidden', background: '#F8F8F8' }}>
      <div className="flex-1 min-w-0 flex flex-col" style={{ minHeight: 0 }}>
        {!isTab && !hideTopBack && <TopBack title={pageTitle} />}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<MobileWorkbench />} />
              <Route path="/home" element={<Home />} />
              <Route path="/m/site" element={<MobileSite />} />
              <Route path="/m/notice" element={<Placeholder title="公告" hint="暂无新公告。" />} />
              <Route path="/m/msg" element={<Placeholder title="消息" hint="暂无新消息。" />} />
              {/* 复用现有 B 端页面，保持与桌面端同一套业务逻辑 */}
              <Route path="/works" element={<Works />} />
              <Route path="/categories" element={<Categories />} />
              <Route path="/works/:id" element={<WorkDetail />} />
              <Route path="/packages" element={<Packages />} />
              <Route path="/packages/new" element={<PackageEdit />} />
              <Route path="/packages/:id/edit" element={<PackageEdit />} />
              <Route path="/schedule" element={<Schedule />} />
              <Route path="/orders" element={<Orders />} />
              <Route path="/orders/:id" element={<OrderDetail />} />
              <Route path="/appointments" element={<Appointments />} />
              <Route path="/reviews" element={<Reviews />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/customers" element={<Customers />} />
              <Route path="/datacharts" element={<DataCharts />} />
              <Route path="/card" element={<BusinessCard />} />
              <Route path="/selections" element={<SelectionAdmin />} />
              <Route path="/channels" element={<Channels />} />
              <Route path="/finance" element={<Finance />} />
              <Route path="/capacity" element={<CapacityManagement />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </div>
      </div>
      <TabBar active={activeKey} onTab={(to) => nav(to)} onPlus={() => setSheetOpen(true)} />
      <ActionSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </div>
  );
}
