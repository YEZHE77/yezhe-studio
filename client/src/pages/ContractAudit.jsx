import React, { useState, useEffect } from 'react';
import http, { BASE } from '../api.js';

/* ============================================================
   合同操作审计日志页（B 端管理员）
   —— 生成/重生成/下载/作废/恢复合同全流程留痕，支持筛选 + 分页 + 导出 CSV
   ============================================================ */

const BRAND = '#7ECDBB';
const TEXT = '#1D1D1F';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';
const LINE = '#EFEFEF';

const ACTION_LABEL = {
  upload: '生成合同', update: '重新生成', download: '下载合同',
  invalidate: '作废合同', restore: '恢复合同'
};

function fmtTime(t) {
  if (!t) return '';
  const d = new Date(t);
  if (isNaN(d.getTime())) return String(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export default function ContractAudit() {
  const [list, setList] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState('');
  const [orderId, setOrderId] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const load = () => {
    setLoading(true);
    const params = { page, page_size: pageSize };
    if (action) params.action = action;
    if (orderId) params.order_id = orderId;
    http.get('/api/contract/audit', { params })
      .then((r) => { setList(r.data.list || []); setTotal(r.data.total || 0); })
      .catch(() => { setList([]); setTotal(0); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [page, action]);

  const exportCsv = () => {
    const params = {};
    if (action) params.action = action;
    if (orderId) params.order_id = orderId;
    const qs = new URLSearchParams(params).toString();
    window.open(BASE + '/api/contract/audit/export' + (qs ? '?' + qs : ''), '_blank');
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '16px 16px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 500, color: TEXT, margin: 0 }}>合同审计日志</h1>
          <p style={{ fontSize: 13, color: FAINT, margin: '4px 0 0' }}>生成 / 重生成 / 下载 / 作废 / 恢复合同全流程留痕</p>
        </div>
        <button onClick={exportCsv} style={{ padding: '9px 18px', borderRadius: 12, background: '#fff', color: BRAND, fontSize: 14, border: '1px solid ' + BRAND, cursor: 'pointer' }}>导出 CSV</button>
      </div>

      {/* 筛选栏 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}
          style={{ flex: 1, minWidth: 120, padding: '9px 12px', borderRadius: 10, border: '1px solid #E8E8EA', fontSize: 14, background: '#fff', outline: 'none' }}>
          <option value="">全部操作类型</option>
          {Object.keys(ACTION_LABEL).map((k) => (<option key={k} value={k}>{ACTION_LABEL[k]}</option>))}
        </select>
        <input value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="订单ID"
          style={{ flex: 1, minWidth: 100, padding: '9px 12px', borderRadius: 10, border: '1px solid #E8E8EA', fontSize: 14, outline: 'none' }} />
        <button onClick={() => { setPage(1); load(); }} style={{ padding: '9px 18px', borderRadius: 10, background: BRAND, color: '#fff', fontSize: 14, border: 'none', cursor: 'pointer' }}>查询</button>
      </div>

      {/* 列表 */}
      {loading ? (
        <div style={{ textAlign: 'center', color: FAINT, fontSize: 14, padding: '40px 0' }}>加载中…</div>
      ) : list.length === 0 ? (
        <div style={{ textAlign: 'center', color: FAINT, fontSize: 14, padding: '60px 0', background: '#fff', borderRadius: 16 }}>暂无审计记录</div>
      ) : (
        <>
          {list.map((a) => (
            <div key={a.id} style={{ background: '#fff', borderRadius: 14, padding: '14px 16px', marginBottom: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 8, background: 'rgba(126,205,187,0.15)', color: '#3E9C8B' }}>{ACTION_LABEL[a.action] || a.action}</span>
                <span style={{ fontSize: 14, color: TEXT }}>{a.customer_name || '—'}</span>
                {a.order_no && <span style={{ fontSize: 12, color: FAINT }}>#{a.order_no}</span>}
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 12, color: FAINT }}>{fmtTime(a.created_at)}</span>
              </div>
              <div style={{ fontSize: 13, color: SUB, lineHeight: 1.6 }}>{a.detail || '—'}</div>
              <div style={{ fontSize: 12, color: FAINT, marginTop: 6 }}>
                操作人：{a.operator_name || '—'}　·　订单ID：{a.order_id}　·　IP：{a.ip || '—'}
              </div>
            </div>
          ))}
          {/* 分页 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 16 }}>
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
              style={{ padding: '6px 16px', borderRadius: 8, border: '1px solid #E8E8EA', background: '#fff', color: page <= 1 ? FAINT : SUB, fontSize: 13, cursor: page <= 1 ? 'not-allowed' : 'pointer' }}>上一页</button>
            <span style={{ fontSize: 13, color: SUB }}>{page} / {totalPages}（共 {total} 条）</span>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}
              style={{ padding: '6px 16px', borderRadius: 8, border: '1px solid #E8E8EA', background: '#fff', color: page >= totalPages ? FAINT : SUB, fontSize: 13, cursor: page >= totalPages ? 'not-allowed' : 'pointer' }}>下一页</button>
          </div>
        </>
      )}
    </div>
  );
}
