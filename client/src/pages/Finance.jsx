import React, { useState, useEffect } from 'react';
import http from '../api.js';
import { useViewState } from '../tabMemory.js';

const TYPE_LABEL = { deposit: '定金', balance: '尾款', extra: '加片/增值', refund: '退款' };

export default function Finance() {
  const year = new Date().getFullYear();
  const [state, setState] = useViewState('finance', { year: String(year) });
  const [summary, setSummary] = useState(null);
  const [months, setMonths] = useState([]);
  const [staff, setStaff] = useState([]);
  const [pkgs, setPkgs] = useState([]);
  const [ledger, setLedger] = useState([]);

  useEffect(() => {
    const y = Number(state.year) || new Date().getFullYear();
    // 强制时间筛选：资金流水必须带 from/to 范围（默认当前年），禁止无条件拉全库在前端计算
    const from = `${y}-01-01`;
    const to = `${y}-12-31`;
    http.get('/api/finance/summary').then((r) => setSummary(r.data)).catch(() => {});
    http.get('/api/finance/by-month?year=' + state.year).then((r) => setMonths(r.data)).catch(() => {});
    http.get('/api/finance/staff').then((r) => setStaff(r.data)).catch(() => {});
    http.get('/api/finance/packages').then((r) => setPkgs(r.data)).catch(() => {});
    http.get('/api/finance/ledger?from=' + from + '&to=' + to).then((r) => setLedger(r.data)).catch(() => {});
  }, [state.year]);

  const maxMonth = months.reduce((m, x) => Math.max(m, x.net), 0) || 1;

  return (
    <div style={{ maxWidth: 1050 }}>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-white">财务管理</h1>
        <select value={state.year} onChange={(e) => setState((s) => ({ ...s, year: e.target.value }))}
          className="px-3 py-2 rounded bg-panel border border-line text-white text-sm outline-none">
          {[year, year - 1, year - 2].map((y) => <option key={y} value={y}>{y} 年</option>)}
        </select>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <Kpi label="应收" value={summary ? summary.receivable : '—'} cls="text-white" />
        <Kpi label="实收" value={summary ? summary.received : '—'} cls="text-emerald-400" />
        <Kpi label="退款" value={summary ? summary.refunded : '—'} cls="text-red-400" />
        <Kpi label="线上" value={summary ? summary.online : '—'} cls="text-sky-400" />
        <Kpi label="线下" value={summary ? summary.offline : '—'} cls="text-amber-400" />
      </div>

      {/* 周期报表 */}
      <Panel title="月度营收报表">
        <div className="space-y-2">
          {months.map((m) => (
            <div key={m.ym} className="flex items-center gap-3 text-sm">
              <div className="w-16 text-muted">{m.ym}</div>
              <div className="flex-1 bg-panel2 rounded-full h-4 overflow-hidden">
                <div className="h-full bg-brand" style={{ width: (Math.max(0, m.net) / maxMonth * 100) + '%' }} />
              </div>
              <div className={'w-28 text-right ' + (m.net < 0 ? 'text-red-400' : 'text-white')}>¥{m.net.toLocaleString()}</div>
            </div>
          ))}
          {months.length === 0 && <div className="text-muted text-sm py-4 text-center">本年暂无收款记录</div>}
        </div>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        {/* 员工业绩 */}
        <Panel title="员工业绩">
          <table className="w-full text-sm">
            <thead><tr className="text-muted text-left"><th className="p-2">执行人</th><th className="p-2">单数</th><th className="p-2">应收</th><th className="p-2">实收</th></tr></thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.executor} className="border-t border-line">
                  <td className="p-2 text-white">{s.executor}</td>
                  <td className="p-2 text-muted">{s.orderCount}</td>
                  <td className="p-2 text-muted">¥{s.totalAmount.toLocaleString()}</td>
                  <td className="p-2 text-emerald-400">¥{s.paidAmount.toLocaleString()}</td>
                </tr>
              ))}
              {staff.length === 0 && <tr><td colSpan="4" className="p-4 text-center text-muted">暂无数据</td></tr>}
            </tbody>
          </table>
        </Panel>

        {/* 套系销量 */}
        <Panel title="套系销量">
          <table className="w-full text-sm">
            <thead><tr className="text-muted text-left"><th className="p-2">套系</th><th className="p-2">售出</th><th className="p-2">营收</th></tr></thead>
            <tbody>
              {pkgs.map((p) => (
                <tr key={p.packageId} className="border-t border-line">
                  <td className="p-2 text-white">{p.name}</td>
                  <td className="p-2 text-muted">{p.sold}</td>
                  <td className="p-2 text-emerald-400">¥{p.revenue.toLocaleString()}</td>
                </tr>
              ))}
              {pkgs.length === 0 && <tr><td colSpan="3" className="p-4 text-center text-muted">暂无数据</td></tr>}
            </tbody>
          </table>
        </Panel>
      </div>

      {/* 资金流水 */}
      <Panel title="资金流水" cls="mt-4">
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-muted text-left"><th className="p-2">时间</th><th className="p-2">订单</th><th className="p-2">类型</th><th className="p-2">方式</th><th className="p-2">备注</th><th className="p-2 text-right">金额</th></tr></thead>
            <tbody>
              {ledger.map((l) => (
                <tr key={l.id} className="border-t border-line">
                  <td className="p-2 text-muted whitespace-nowrap">{new Date(l.created_at).toLocaleString('zh-CN')}</td>
                  <td className="p-2 text-muted">{l.order_no}</td>
                  <td className="p-2 text-white">{TYPE_LABEL[l.type]}</td>
                  <td className="p-2 text-muted">{l.method === 'online' ? '线上' : '线下'}</td>
                  <td className="p-2 text-muted truncate max-w-[160px]">{l.note}</td>
                  <td className={'p-2 text-right ' + (l.type === 'refund' ? 'text-red-400' : 'text-emerald-400')}>{l.type === 'refund' ? '-' : '+'}¥{Number(l.amount).toLocaleString()}</td>
                </tr>
              ))}
              {ledger.length === 0 && <tr><td colSpan="6" className="p-4 text-center text-muted">暂无流水</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function Kpi({ label, value, cls }) {
  return (
    <div className="bg-panel border border-line rounded-xl2 p-4">
      <div className="text-muted text-xs mb-1">{label}</div>
      <div className={'text-xl font-semibold ' + cls}>¥{typeof value === 'number' ? value.toLocaleString() : value}</div>
    </div>
  );
}
function Panel({ title, children, cls }) {
  return (
    <div className={'bg-panel border border-line rounded-xl2 p-4 ' + (cls || '')}>
      <div className="text-sm text-white font-medium mb-3">{title}</div>
      {children}
    </div>
  );
}
