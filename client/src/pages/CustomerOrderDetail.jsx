import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { customerHttp } from '../utils/customerAuth.js';

// ===== C 端订单详情页（/customer/order/:id）=====
// 只读：仅展示订单号/拍摄日期/套系名称/拍摄进度，不展示备注与订单变更记录。
// 顶部深色导航 + 白色返回键（返回 /customer/mine）。
const TEXT = '#1D1D1F';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';
const LINE = '#F0F0F2';

function Field({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '13px 0', borderBottom: '1px solid ' + LINE }}>
      <span style={{ fontSize: 13, color: SUB, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 14, color: value ? TEXT : FAINT, textAlign: 'right', maxWidth: '60%', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{value || '—'}</span>
    </div>
  );
}

export default function CustomerOrderDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    setLoading(true);
    customerHttp.get('/api/customer/order-detail', { params: { id } })
      .then((r) => setDetail(r.data))
      .catch((e) => {
        if (e.response && e.response.status === 401) {
          nav('/customer/mine', { replace: true }); // 未登录/会话过期，回我的页
        } else {
          setErr((e.response && e.response.data && e.response.data.error) || '加载失败');
        }
      })
      .finally(() => setLoading(false));
  }, [id, nav]);

  return (
    <div style={{ minHeight: '100vh', background: '#F2F2F5', color: TEXT, paddingBottom: 40 }}>
      {/* 顶部深色导航栏：左上角返回键（白色），返回我的页 */}
      <div style={{ background: '#1f1f1f', position: 'sticky', top: 0, zIndex: 20, display: 'flex', alignItems: 'center', padding: '14px 18px' }}>
        <button onClick={() => nav('/customer/mine')} style={{ background: 'none', border: 'none', fontSize: 16, color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ fontSize: 20, lineHeight: 1 }}>‹</span>订单详情
        </button>
      </div>

      <div style={{ padding: '20px 18px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: FAINT, padding: 40, fontSize: 14 }}>加载中…</div>
        ) : err ? (
          <div style={{ background: '#fff', borderRadius: 16, padding: 40, textAlign: 'center', color: FAINT, fontSize: 14, boxShadow: '0 8px 24px rgba(31,35,41,0.06)' }}>{err}</div>
        ) : detail ? (
          <div style={{ background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 8px 24px rgba(31,35,41,0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 16, color: TEXT }}>{detail.package_name || '订单详情'}</span>
              <span style={{ fontSize: 12, padding: '4px 10px', borderRadius: 10, background: 'rgba(126,205,187,0.15)', color: '#3E9C8B' }}>{detail.status_label}</span>
            </div>
            <div style={{ fontSize: 12, color: FAINT }}>订单号 {detail.order_no || '—'}</div>
            <div style={{ marginTop: 8, borderTop: '1px solid ' + LINE }}>
              <Field label="拍摄日期" value={detail.shoot_date} />
              <Field label="套系名称" value={detail.package_name} />
              <Field label="拍摄进度" value={detail.status_label} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
