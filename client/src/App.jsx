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
const WorkDetail = React.lazy(() => import('./pages/WorkDetail.jsx'));
const Packages = React.lazy(() => import('./pages/Packages.jsx'));
const PackageEdit = React.lazy(() => import('./pages/PackageEdit.jsx'));
const PackagePreview = React.lazy(() => import('./pages/PackagePreview.jsx'));
const Schedule = React.lazy(() => import('./pages/Schedule.jsx'));
const ScheduleNewOrder = React.lazy(() => import('./pages/ScheduleNewOrder.jsx'));
const Orders = React.lazy(() => import('./pages/Orders.jsx'));
const OrdersNew = React.lazy(() => import('./pages/OrdersNew.jsx'));
const OrderDetail = React.lazy(() => import('./pages/OrderDetail.jsx'));
const OrderNotes = React.lazy(() => import('./pages/OrderNotes.jsx'));
const Todo = React.lazy(() => import('./pages/Todo.jsx'));
const Finance = React.lazy(() => import('./pages/Finance.jsx'));
const Appointments = React.lazy(() => import('./pages/Appointments.jsx'));
const Reservations = React.lazy(() => import('./pages/Reservations.jsx'));
const Reviews = React.lazy(() => import('./pages/Reviews.jsx'));
const Settings = React.lazy(() => import('./pages/Settings.jsx'));
const Customers = React.lazy(() => import('./pages/Customers.jsx'));
const DataCharts = React.lazy(() => import('./pages/DataCharts.jsx'));
const BusinessCard = React.lazy(() => import('./pages/BusinessCard.jsx'));
const SelectionAdmin = React.lazy(() => import('./pages/SelectionAdmin.jsx'));
const ShareAlbum = React.lazy(() => import('./pages/ShareAlbum.jsx'));
const SelectionClient = React.lazy(() => import('./pages/SelectionClient.jsx'));
const CustomerSelectPhoto = React.lazy(() => import('./pages/CustomerSelectPhoto.jsx'));
const WorksAlbumEdit = React.lazy(() => import('./pages/WorksAlbumEdit.jsx'));
const CapacityManagement = React.lazy(() => import('./pages/CapacityManagement.jsx'));
const Channels = React.lazy(() => import('./pages/Channels.jsx'));
const Team = React.lazy(() => import('./pages/Team.jsx'));
const MessageCenter = React.lazy(() => import('./pages/MessageCenter.jsx'));
const PhotoPackages = React.lazy(() => import('./pages/PhotoPackages.jsx'));
const PackagePublic = React.lazy(() => import('./pages/PackagePublic.jsx'));
const PackageCenter = React.lazy(() => import('./pages/PackageCenter.jsx'));
const CustomerOrder = React.lazy(() => import('./pages/CustomerOrder.jsx'));
const QueryOrder = React.lazy(() => import('./pages/QueryOrder.jsx'));
const CustomerLogin = React.lazy(() => import('./pages/CustomerLogin.jsx'));
const CustomerMine = React.lazy(() => import('./pages/CustomerMine.jsx'));
const AppointmentForm = React.lazy(() => import('./pages/AppointmentForm.jsx'));
const ContractTemplates = React.lazy(() => import('./pages/ContractTemplates.jsx'));
const ContractAudit = React.lazy(() => import('./pages/ContractAudit.jsx'));
const ConsistencyCheck = React.lazy(() => import('./pages/ConsistencyCheck.jsx'));
const MiniProgramPreview = React.lazy(() => import('./pages/MiniProgramPreview.jsx'));
const CustomerAgreement = React.lazy(() => import('./pages/CustomerAgreement.jsx'));
const CustomerAgreementEdit = React.lazy(() => import('./pages/CustomerAgreementEdit.jsx'));
const RefundPolicyEdit = React.lazy(() => import('./pages/RefundPolicyEdit.jsx'));
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
        <main className="flex-1 p-3 md:p-4 lg:p-6 min-w-0 overflow-x-hidden" style={{ background: '#F8F8F8', position: 'relative' }}>
          <Breadcrumb />
          <ErrorBoundary resetKeys={[location.pathname]}>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/works" element={<Works />} />
                <Route path="/categories" element={<Categories />} />
                <Route path="/works/:id/edit" element={<WorkDetail />} />
                <Route path="/works/:id/album-edit" element={<WorksAlbumEdit />} />
                <Route path="/works/new" element={<WorkDetail />} />
                <Route path="/works/:id" element={<WorkPreview />} />
                <Route path="/packages" element={<Packages />} />
                <Route path="/packages/new" element={<PackageEdit />} />
                <Route path="/packages/:id" element={<PackagePreview />} />
                <Route path="/packages/:id/agreement" element={<CustomerAgreement />} />
                <Route path="/packages/:id/agreement/edit" element={<CustomerAgreementEdit />} />
                <Route path="/packages/:id/refund/edit" element={<RefundPolicyEdit />} />
                <Route path="/packages/:id/edit" element={<PackageEdit />} />
                <Route path="/schedule" element={<Schedule />} />
                <Route path="/schedule/new" element={<ScheduleNewOrder />} />
                <Route path="/orders" element={<Orders />} />
                <Route path="/orders/new" element={<OrdersNew />} />
                <Route path="/orders/:id" element={<OrderDetail />} />
                <Route path="/orders/:id/notes" element={<OrderNotes />} />
<Route path="/todo" element={<Todo />} />
                <Route path="/appointments" element={<Appointments />} />
                <Route path="/reservations" element={<Reservations />} />
                <Route path="/reviews" element={<Reviews />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/customers" element={<Customers />} />
                <Route path="/datacharts" element={<DataCharts />} />
                <Route path="/card" element={<BusinessCard />} />
                <Route path="/selections" element={<SelectionAdmin />} />
                <Route path="/photo-packages" element={<PhotoPackages />} />
                <Route path="/contract-templates" element={<ContractTemplates />} />
                <Route path="/contract-audit" element={<ContractAudit />} />
                <Route path="/consistency-check" element={<ConsistencyCheck />} />
                <Route path="/m/msg" element={<MessageCenter />} />
                <Route path="/channels" element={<Channels />} />
                <Route path="/finance" element={<Finance />} />
                <Route path="/capacity" element={<CapacityManagement />} />
                <Route path="/mini-program-preview" element={<MiniProgramPreview />} />
                <Route path="/team" element={<Team />} />
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
  const location = useLocation();
  if (!ready) return <div className="p-10 text-muted">加载中…</div>;
  return (
    <ErrorBoundary resetKeys={[location.pathname]}>
    <Routes>
      {/* 客户影集分享：公开页面，无需登录即可访问 */}
      <Route path="/share/:token" element={
        <Suspense fallback={<PageLoader />}><ShareAlbum /></Suspense>
      } />
      {/* 客户在线选片：公开页面，无需登录（token + 可选密码），完全隐藏 B 端菜单 */}
      <Route path="/s/:token" element={
        <Suspense fallback={<PageLoader />}><SelectionClient /></Suspense>
      } />
      {/* 客户选片分享链接入口（/customer/select-photo?orderId=&token=）：微信内→中转引导页；普通浏览器→校验后进入选片 */}
      <Route path="/customer/select-photo" element={
        <Suspense fallback={<PageLoader />}><CustomerSelectPhoto /></Suspense>
      } />
      {/* C 端套系预览（/package?token=share_token）· 公开，无编辑 */}
      <Route path="/package" element={
        <Suspense fallback={<PageLoader />}><PackagePublic /></Suspense>
      } />
      {/* C 端客户订单查看（/customer-order?token=customer_token）· 公开，只读（历史分享链接兼容） */}
      <Route path="/customer-order" element={
        <Suspense fallback={<PageLoader />}><CustomerOrder /></Suspense>
      } />
      {/* C 端订单 token 详情页（/customer/order?accessToken=）· 公开，只读，与 /customer-order 同一组件 */}
      <Route path="/customer/order" element={
        <Suspense fallback={<PageLoader />}><CustomerOrder /></Suspense>
      } />
      {/* C 端客户自助查订单（/customer/query-order）· 手机号+图形验证码，只读，与 token 专属访问并行 */}
      <Route path="/customer/query-order" element={
        <Suspense fallback={<PageLoader />}><QueryOrder /></Suspense>
      } />
      {/* C 端客户免验证码手机号登录（/customer/login）· 仅校验有订单才允许，会话 24h cookie */}
      <Route path="/customer/login" element={
        <Suspense fallback={<PageLoader />}><CustomerLogin /></Suspense>
      } />
      {/* C 端【我的】页面（/customer/mine）· 未登录态显示灰色头像+去登录；登录后展示脱敏手机号+菜单（不含商家管理后台） */}
      <Route path="/customer/mine" element={
        <Suspense fallback={<PageLoader />}><CustomerMine /></Suspense>
      } />
      {/* C 端预约提交页（/customer/book）· 公开，写入预约表待确认 */}
      <Route path="/customer/book" element={
        <Suspense fallback={<PageLoader />}><AppointmentForm /></Suspense>
      } />
      {/* C 端公开预约表单（历史路径兼容，与 /customer/book 同一组件） */}
      <Route path="/appointment-form" element={
        <Suspense fallback={<PageLoader />}><AppointmentForm /></Suspense>
      } />
      {/* C 端微官网首页 / 作品 / 套系中心：公开可访问，与登录态无关（顾客手机端所见即此；
          小程序预览 iframe 也加载这些路径，确保电脑端预览 = 顾客端 100% 一致） */}
      <Route path="/home" element={
        <Suspense fallback={<PageLoader />}><Home /></Suspense>
      } />
      <Route path="/my" element={
        <Suspense fallback={<PageLoader />}><My /></Suspense>
      } />
      <Route path="/w/:id" element={
        <Suspense fallback={<PageLoader />}><WorkPublic /></Suspense>
      } />
      <Route path="/package-center" element={
        <Suspense fallback={<PageLoader />}><PackageCenter /></Suspense>
      } />
      {!user && (
        <>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </>
      )}
      {user && (isMobile
        ? <Route path="/*" element={<MobileShell />} />
        : <Route path="/*" element={<AppShell />} />)}
    </Routes>
    </ErrorBoundary>
  );
}
