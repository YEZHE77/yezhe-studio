import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import http from '../api.js';
import OrderDialog from '../components/OrderDialog.jsx';

export default function ScheduleNewOrder() {
  const nav = useNavigate();
  const location = useLocation();
  const date = location.state?.date || '';
  const [personnel, setPersonnel] = useState([]);

  useEffect(() => {
    http.get('/api/admin/personnel').then((r) => setPersonnel(r.data || [])).catch(() => {});
  }, []);

  return (
    <OrderDialog
      mode="page"
      orderDlg={{ date }}
      personnel={personnel}
      onClose={() => nav('/schedule')}
      onSaved={() => nav('/schedule')}
    />
  );
}
