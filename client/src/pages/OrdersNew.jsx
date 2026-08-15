import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import http from '../api.js';
import OrderDialog from '../components/OrderDialog.jsx';

// 路由 /orders/new 对应的全屏「新建订单」页面（复用 OrderDialog 组件，与新建档期 ScheduleNewOrder 完全一致）
export default function OrdersNew() {
  const nav = useNavigate();
  const location = useLocation();
  const topTitle = location.state?.topTitle || '新增订单';
  const [personnel, setPersonnel] = useState([]);

  useEffect(() => {
    http.get('/api/admin/personnel').then((r) => setPersonnel(r.data || [])).catch(() => {});
  }, []);

  return (
    <OrderDialog
      mode="page"
      topTitle={topTitle}
      personnel={personnel}
      onClose={() => nav('/orders')}
      onSaved={() => nav('/orders')}
    />
  );
}