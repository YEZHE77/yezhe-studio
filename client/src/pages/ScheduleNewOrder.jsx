import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import http from '../api.js';
import OrderCreateModal from '../components/OrderCreateModal.jsx';

// 路由 /schedule/new 对应的全屏「新建档期」页面（复用 OrderCreateModal 组件，与新建订单 OrdersNew 完全一致）
export default function ScheduleNewOrder() {
  const nav = useNavigate();
  const location = useLocation();
  const date = location.state?.date || '';
  const [pkgs, setPkgs] = useState([]);

  useEffect(() => {
    http.get('/api/packages?status=all').then((r) => setPkgs(r.data || [])).catch(() => {});
  }, []);

  return (
    <OrderCreateModal
      visible
      pageMode
      packages={pkgs}
      initialDate={date}
      onClose={() => nav('/schedule')}
      onAfterCreate={() => nav('/schedule')}
    />
  );
}