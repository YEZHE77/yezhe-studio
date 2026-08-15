import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import http from '../api.js';

// ===== C 端客户订单查看页（/customer-order?token=customer_token）=====
// customer_token 鉴权，只能查看该 token 绑定订单；全部只读，无任何编辑/删除/保存按钮
const TEXT = '#1D1D1F';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';
const BRAND = '#7ECDBB';

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '13px 0', borderBottom: '1px solid #F0F0F2' }}>
      <span style={{ fontSize: 13, color: SUB }}>{label}</span>
      <span style={{ fontSize: 14, color: TEXT, textAlign: 'right', maxWidth: '65%' }}>{value || '—'}</span>
    </div>
  );
}

export default function CustomerOrder() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const token = params.get('token') || '';
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) { setErr('无权限访问'); setLoading(false); return; }
    http.get('/api/public/order/' + token)
      .then((r) => setData(r.data))
      .catch((e) => setErr((e.response && e.response.data && e.response.data.error) || '加载失败'))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div style={{ minHeight: '100vh', background: '#F5F5F7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: FAINT, fontSize: 14 }}>加载中…</div>;

  if (err || !data) {
    return (
      <div style={{ minHeight: '100vh', background: '#F5F5F7', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
        <div style={{ fontSize: 16, color: TEXT, marginBottom: 6 }}>{err || '无权限访问该订单'}</div>
        <div style={{ fontSize: 13, color: FAINT }}>该链接无效或已失效，请联系摄影师。</div>
      </div>
    );
  }

  const paidLabel = { unpaid: '未付定金', deposit: '已付定金', paid: '已付全款' }[data.payment_status] || data.payment_status;

  return (
    <div style={{ minHeight: '100vh', background: '#F5F5F7', padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 1px 6px rgba(0,0,0,0.05)' }}>
        <div style={{ fontSize: 19, color: TEXT }}>{data.customer_name || '客户'}</div>
        <div style={{ fontSize: 12, color: FAINT, marginTop: 4 }}>订单编号 {data.order_no}</div>
        <div style={{ marginTop: 12, display: 'inline-block', padding: '4px 12px', borderRadius: 10, background: 'rgba(126,205,187,0.15)', color: '#3E9C8B', fontSize: 13 }}>{data.status_label}</div>
      </div>

      <div style={{ background: '#fff', borderRadius: 16, padding: '4px 20px', marginTop: 12, boxShadow: '0 1px 6px rgba(0,0,0,0.05)' }}>
        <Row label="拍摄档期" value={data.date_tbd ? '日期待定' : (data.shoot_date || '未排期')} />
        <Row label="套系" value={data.package_name} />
        <Row label="精修张数" value={data.retouch_count ? data.retouch_count + ' 张' : ''} />
        <Row label="支付状态" value={paidLabel} />
        <Row label="订单金额" value={'¥' + Number(data.total_amount || 0).toFixed(2)} />
        <Row label="已付金额" value={'¥' + Number(data.paid_amount || 0).toFixed(2)} />
        <Row label="待付金额" value={'¥' + Number(data.balance || 0).toFixed(2)} />
      </div>

      {data.selection_url && (
        <button onClick={() => nav(data.selection_url)}
          style={{ width: '100%', marginTop: 16, padding: '14px 0', borderRadius: 14, background: BRAND, color: '#fff', fontSize: 15, border: 'none', cursor: 'pointer', boxShadow: '0 8px 20px rgba(126,205,187,0.35)' }}>
          进入选片
        </button>
      )}

      <div style={{ textAlign: 'center', fontSize: 12, color: FAINT, marginTop: 24 }}>YEZHE WORKSHOP · 订单信息仅供查看</div>
    </div>
  );
}
