import React, { useState, useEffect } from 'react';
import http from '../api.js';

const STATUS = { deposit: '已付定金', shot: '已拍摄', selecting: '选片中', retouching: '精修中', delivered: '已交付', completed: '已完成', cancelled: '已作废' };
const APP_STATUS = { pending: '待跟进', converted: '已转单' };

export default function Customers() {
  const [list, setList] = useState([]);
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    http.get('/api/admin/customers').then((r) => setList(r.data)).catch(() => setList([]));
  }, []);

  const filtered = list.filter((c) =>
    (c.nickname || '').includes(q) || (c.phone || '').includes(q) || (c.openid || '').includes(q)
  );

  async function open(openid) {
    setLoadingDetail(true); setDetail(null);
    try {
      const r = await http.get('/api/admin/customers/' + encodeURIComponent(openid));
      setDetail(r.data);
    } catch (e) { setDetail({ error: e.message }); }
    setLoadingDetail(false);
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg">客户管理</h1>
          <p className="text-xs text-muted mt-0.5">按微信 openid 聚合的客户档案 · 贯穿订单与预约</p>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索昵称 / 电话"
          className="border border-line rounded-lg px-3 py-2 text-sm bg-panel text-fg outline-none focus:border-brand w-56" />
      </div>

      <div className="bg-panel border border-line rounded-xl2 overflow-hidden">
        <div className="grid grid-cols-12 px-4 py-3 text-xs text-muted border-b border-line">
          <div className="col-span-3">昵称</div>
          <div className="col-span-3">电话</div>
          <div className="col-span-2 text-center">订单</div>
          <div className="col-span-2 text-center">预约</div>
          <div className="col-span-2 text-right">累计消费</div>
        </div>
        {filtered.filter(Boolean).map((c) => (
          <div key={c.openid} onClick={() => open(c.openid)}
            className="grid grid-cols-12 px-4 py-3 text-sm items-center border-b border-line last:border-0 hover:bg-panel2 cursor-pointer transition">
            <div className="col-span-3 flex items-center gap-2 text-fg">
              {c.avatar
                ? <img src={c.avatar} className="w-7 h-7 rounded-full object-cover" />
                : <div className="w-7 h-7 rounded-full bg-brand/10 text-brand flex items-center justify-center text-xs">{(c.nickname || '客').slice(0, 1)}</div>}
              <span className="truncate">{c.nickname || '微信客户'}</span>
            </div>
            <div className="col-span-3 text-muted">{c.phone || '—'}</div>
            <div className="col-span-2 text-center text-fg">{c.orderCount}</div>
            <div className="col-span-2 text-center text-fg">{c.appointmentCount}</div>
            <div className="col-span-2 text-right text-fg font-medium">¥{c.spent.toLocaleString()}</div>
          </div>
        ))}
        {!filtered.length && <div className="py-10 text-center text-xs text-faint">暂无客户</div>}
      </div>

      {detail && (
        <div className="fixed inset-0 bg-black/40 flex justify-end z-50" onClick={() => setDetail(null)}>
          <div className="w-full max-w-md bg-panel h-full overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-fg">客户详情</h2>
              <button onClick={() => setDetail(null)} className="text-muted hover:text-fg">✕</button>
            </div>
            {loadingDetail && <div className="text-sm text-muted">加载中…</div>}
            {detail && !detail.error && (
              <div className="space-y-5">
                <div className="text-sm text-muted">openid：<span className="text-fg">{detail.customer?.openid || '—'}</span></div>

                <div>
                  <div className="text-[15px] font-semibold text-fg mb-2">订单记录（{detail.orders.length}）</div>
                  <div className="space-y-2">
                    {detail.orders.map((o) => (
                      <div key={o.id} className="border border-line rounded-lg p-3 text-sm">
                        <div className="flex justify-between">
                          <span className="text-fg font-medium">{o.packageName || '自定义订单'}</span>
                          <span className="text-brand">{STATUS[o.status] || o.status}</span>
                        </div>
                        <div className="text-xs text-muted mt-1">单号 {o.order_no} · 应收 ¥{Number(o.total_amount || 0).toLocaleString()} · 已收 ¥{Number(o.paid_amount || 0).toLocaleString()}</div>
                        {o.shoot_date && <div className="text-xs text-muted">拍摄日期 {o.shoot_date}</div>}
                      </div>
                    ))}
                    {!detail.orders.length && <div className="text-xs text-faint">无订单</div>}
                  </div>
                </div>

                <div>
                  <div className="text-[15px] font-semibold text-fg mb-2">预约记录（{detail.appointments.length}）</div>
                  <div className="space-y-2">
                    {detail.appointments.map((a) => (
                      <div key={a.id} className="border border-line rounded-lg p-3 text-sm">
                        <div className="flex justify-between">
                          <span className="text-fg">{a.name}</span>
                          <span className="text-teal-600">{APP_STATUS[a.status] || a.status}</span>
                        </div>
                        <div className="text-xs text-muted mt-1">{a.phone} · 期望 {a.hope_date || '—'}</div>
                        {a.remark && <div className="text-xs text-muted">备注：{a.remark}</div>}
                      </div>
                    ))}
                    {!detail.appointments.length && <div className="text-xs text-faint">无预约</div>}
                  </div>
                </div>
              </div>
            )}
            {detail && detail.error && <div className="text-sm text-red-500">{detail.error}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
