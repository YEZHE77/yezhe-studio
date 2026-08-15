import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import http from '../api.js';
import OrderCreateModal from '../components/OrderCreateModal.jsx';

// 路由 /orders/new 对应的全屏「新建订单」页面（复用 OrderCreateModal 组件）
export default function OrdersNew() {
  const nav = useNavigate();
  const [pkgs, setPkgs] = useState([]);
  useEffect(() => {
    http.get('/api/packages?status=all').then((r) => setPkgs(r.data || [])).catch(() => {});
  }, []);
  return (
    <OrderCreateModal
      visible
      pageMode
      packages={pkgs}
      onClose={() => nav('/orders')}
      onAfterCreate={() => nav('/orders')}
    />
  );
}