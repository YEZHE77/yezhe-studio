import React, { Suspense, useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Sidebar from './layout/Sidebar.jsx';
import Topbar from './layout/Topbar.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import Breadcrumb from './components/Breadcrumb.jsx';
import MobileShell from './layout/MobileShell.jsx';

// 移动端判定：视口宽度 < 768 视为手机；监听 resize 实时切换，不改动桌面端任何逻辑
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return isMobile;
}

// 首屏必须同步加载（Login + Dashboard + Sidebar）
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';

// 路由级懒加载——按需拉取，削减首屏 bundle
const Works = React.lazy(() => import('./pages/Works.jsx'));
const Categories = React.lazy(() => import('./pages/Categories.jsx'));
const WorkPreview = React.lazy(() => import('./pages/WorkPreview.jsx'));
const Packages = React.lazy(() => import('./pages/Packages.jsx'));
const PackagePreview = React.lazy(() => import('./pages/PackagePreview.jsx'));
const Schedule = React.lazy(() => import('./pages/Schedule.jsx'));
const Orders = React.lazy(() => import('./pages/Orders.jsx'));
const OrderDetail = React.lazy(() => import('./pages/OrderDetail.jsx'));
const Finance = React.lazy(() => import('./pages/Finance.jsx'));
const Appointments = React.lazy(() => import('./pages/Appointments.jsx'));
const Reviews = React.lazy(() => import('./pages/Reviews.jsx'));
const Settings = React.lazy(() => import('./pages/Settings.jsx'));
const Customers = React.lazy(() => import('./pages/Customers.jsx'));
const DataCharts = React.lazy(() => import('./pages/DataCharts.jsx'));
const BusinessCard = React.lazy(() => import('./pages/BusinessCard.jsx'));
const SelectionAdmin = React.lazy(() => import('./pages/SelectionAdmin.jsx'));
const ShareAlbum = React.lazy(() => import('./pages/ShareAlbum.jsx'));
const CapacityManagement = React.lazy(() => import('./pages/CapacityManagement.jsx'));
const Channels = React.lazy(() => import('./pages/Channels.jsx'));
// 客户前端（公开，无需登录）：首页 / 我的 / 公开作品相册
const Home = React.lazy(() => import('./pages/Home.jsx'));
const My = React.lazy(() => import('./pages/My.jsx'));
const WorkPublic = React.lazy(() => import('./pages/WorkPublic.jsx'));

// 通用加载占位
function PageLoader() {
  return <div className="p-10 text-muted text-sm flex items-center gap-2">
    <span className="inline-block w-4 h-4 border-2 border-brand/30 border-t-brand rounded-full animate-spin" />
    加载中…
  </div>;
}

// 已登录后的主框架（侧边栏 + 顶栏 + 业务路由）
function AppShell() {
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => { setNavOpen(false); }, [location.pathname]);
  // 档期页按 spec 为「侧边栏 + 主内容区」两栏结构，不显示顶部条
  const hideTopbar = location.pathname === '/schedule';
  return (
    <div className="flex min-h-screen">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        {!hideTopbar && <Topbar onMenu={() => setNavOpen(true)} />}
        <main className="flex-1 p-3 lg:p-6" style={{ background: '#F8F8F8' }}>
          <Breadcrumb />
          <ErrorBoundary resetKeys={[location.pathname]}>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/works" element={<Works />} />
                <Route path="/categories" element={<Categories />} />
                <Route path="/works/:id/edit" element={<WorkDetail />} />
                <Route path="/works/new" element={<WorkDetail />} />
                <Route path="/works/:id" element={<WorkPreview />} />
                <Route path="/packages" element={<Packages />} />
                <Route path="/packages/new" element={<PackageEdit />} />
                <Route path="/packages/:id" element={<PackagePreview />} />
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
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const { user, ready } = useAuth();
  const isMobile = useIsMobile();
  if (!ready) return <div className="p-10 text-muted">加载中…</div>;
  return (
    <Routes>
      {/* 客户影集分享：公开页面，无需登录即可访问 */}
      <Route path="/share/:token" element={
        <Suspense fallback={<PageLoader />}><ShareAlbum /></Suspense>
      } />
      {!user && (
        <>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/home" element={<Suspense fallback={<PageLoader />}><Home /></Suspense>} />
          <Route path="/my" element={<Suspense fallback={<PageLoader />}><My /></Suspense>} />
          <Route path="/w/:id" element={<Suspense fallback={<PageLoader />}><WorkPublic /></Suspense>} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </>
      )}
      {user && (isMobile
        ? <Route path="/*" element={<MobileShell />} />
        : <Route path="/*" element={<AppShell />} />)}
    </Routes>
  );
}
