import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import http from '../api.js';
import OrderDialog from '../components/OrderDialog.jsx';

// 路由 /schedule/new 对应的全屏「创建带档期的订单」页面（复用 OrderDialog 组件）
// 标题支持自定义：state.topTitle 传入，默认为「新增订单」；主页底部「+ 新建档期」入口传「新建档期」
export default function ScheduleNewOrder() {
  const nav = useNavigate();
  const location = useLocation();
  const date = location.state?.date || '';
  const topTitle = location.state?.topTitle || '新增订单';
  const [personnel, setPersonnel] = useState([]);

  useEffect(() => {
    http.get('/api/admin/personnel').then((r) => setPersonnel(r.data || [])).catch(() => {});
  }, []);

  return (
    <OrderDialog
      mode="page"
      topTitle={topTitle}
      orderDlg={{ date }}
      personnel={personnel}
      onClose={() => nav('/schedule')}
      onSaved={() => nav('/schedule')}
    />
  );
}
