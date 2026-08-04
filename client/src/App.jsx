import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Sidebar from './layout/Sidebar.jsx';
import Topbar from './layout/Topbar.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Works from './pages/Works.jsx';
import Packages from './pages/Packages.jsx';
import Schedule from './pages/Schedule.jsx';
import Orders from './pages/Orders.jsx';
import Finance from './pages/Finance.jsx';
import Appointments from './pages/Appointments.jsx';
import Reviews from './pages/Reviews.jsx';

export default function App() {
  const { user, ready } = useAuth();
  if (!ready) return <div className="p-10 text-muted">加载中…</div>;
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar />
        <main className="flex-1 overflow-auto p-6 bg-ink">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/works" element={<Works />} />
            <Route path="/packages" element={<Packages />} />
            <Route path="/schedule" element={<Schedule />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/appointments" element={<Appointments />} />
            <Route path="/reviews" element={<Reviews />} />
            <Route path="/finance" element={<Finance />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
