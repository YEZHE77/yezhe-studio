import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Sidebar from './layout/Sidebar.jsx';
import Topbar from './layout/Topbar.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Works from './pages/Works.jsx';
import WorkDetail from './pages/WorkDetail.jsx';
import Packages from './pages/Packages.jsx';
import Schedule from './pages/Schedule.jsx';
import Orders from './pages/Orders.jsx';
import Finance from './pages/Finance.jsx';
import Appointments from './pages/Appointments.jsx';
import Reviews from './pages/Reviews.jsx';
import Settings from './pages/Settings.jsx';
import Customers from './pages/Customers.jsx';
import DataCharts from './pages/DataCharts.jsx';
import BusinessCard from './pages/BusinessCard.jsx';
import SelectionAdmin from './pages/SelectionAdmin.jsx';
import ShareAlbum from './pages/ShareAlbum.jsx';

// 已登录后的主框架（侧边栏 + 顶栏 + 业务路由）
function AppShell() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar />
        <main className="flex-1 overflow-auto p-6 bg-ink">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/works" element={<Works />} />
            <Route path="/works/:id" element={<WorkDetail />} />
            <Route path="/packages" element={<Packages />} />
            <Route path="/schedule" element={<Schedule />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/appointments" element={<Appointments />} />
            <Route path="/reviews" element={<Reviews />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/datacharts" element={<DataCharts />} />
            <Route path="/card" element={<BusinessCard />} />
            <Route path="/selections" element={<SelectionAdmin />} />
            <Route path="/finance" element={<Finance />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const { user, ready } = useAuth();
  if (!ready) return <div className="p-10 text-muted">加载中…</div>;
  return (
    <Routes>
      {/* 客户影集分享：公开页面，无需登录即可访问 */}
      <Route path="/share/:token" element={<ShareAlbum />} />
      {!user && (
        <>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </>
      )}
      {user && <Route path="/*" element={<AppShell />} />}
    </Routes>
  );
}
