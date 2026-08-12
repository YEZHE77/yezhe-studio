import React, { useState, useEffect } from 'react';
import http from '../api.js';
import { useViewState } from '../tabMemory.js';

const TYPE_LABEL = { deposit: '定金', balance: '尾款', extra: '加片/增值', refund: '退款' };

const TEXT = '#1f2329';
const MUTED = '#999999';
const LINE = '#EFEFEF';
const BRAND = '#2DB7F5';
const MINT = '#7ECDBB';

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 768 : false);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return isMobile;
}

export default function Finance() {
  const year = new Date().getFullYear();
  const [state, setState] = useViewState('finance', { year: String(year) });
  const [summary, setSummary] = useState(null);
  const [stats, setStats] = useState(null);
  const [months, setMonths] = useState([]);
  const [staff, setStaff] = useState([]);
  const [pkgs, setPkgs] = useState([]);
  const [ledger, setLedger] = useState([]);
  const isMobile = useIsMobile();

  useEffect(() => {
    const y = Number(state.year) || new Date().getFullYear();
    // 强制时间筛选：资金流水必须带 from/to 范围（默认当前年），禁止无条件拉全库在前端计算
    const from = `${y}-01-01`;
    const to = `${y}-12-31`;
    http.get('/api/finance/summary').then((r) => setSummary(r.data)).catch(() => {});
    http.get('/api/stats').then((r) => setStats(r.data)).catch(() => {});
    http.get('/api/finance/by-month?year=' + state.year).then((r) => setMonths(r.data)).catch(() => {});
    http.get('/api/finance/staff').then((r) => setStaff(r.data)).catch(() => {});
    http.get('/api/finance/packages').then((r) => setPkgs(r.data)).catch(() => {});
    http.get('/api/finance/ledger?from=' + from + '&to=' + to).then((r) => setLedger(r.data)).catch(() => {});
  }, [state.year]);

  if (isMobile) {
    return <MobileView summary={summary} stats={stats} months={months} staff={staff} pkgs={pkgs} ledger={ledger} year={Number(state.year) || year} onYearChange={(y) => setState((s) => ({ ...s, year: String(y) }))} />;
  }

  return <DesktopView summary={summary} months={months} staff={staff} pkgs={pkgs} ledger={ledger} year={Number(state.year) || year} onYearChange={(y) => setState((s) => ({ ...s, year: String(y) }))} />;
}

function MobileView({ summary, stats, months, staff, pkgs, ledger, year, onYearChange }) {
  const maxMonth = months.reduce((m, x) => Math.max(m, x.net), 0) || 1;

  const kpiItems = [
    { label: '应收', value: summary ? summary.receivable : null, color: TEXT },
    { label: '实收', value: summary ? summary.received : null, color: MINT },
    { label: '退款', value: summary ? summary.refunded : null, color: '#FF4D4F' },
    { label: '线上', value: summary ? summary.online : null, color: BRAND },
    { label: '线下', value: summary ? summary.offline : null, color: '#F5A623' },
    { label: '尾款待收', value: stats ? stats.pendingBalance : null, color: '#FF7A8A' }
  ];

  const fmt = (v) => typeof v === 'number' ? v.toLocaleString() : '—';

  return (
    <div style={{ minHeight: '100%', background: '#F8F8F8', padding: '12px 12px 24px', paddingTop: 'calc(12px + env(safe-area-inset-top))' }}>
      {/* 年份选择 */}
      <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: TEXT }}>财务概览</span>
        <select
          value={year}
          onChange={(e) => onYearChange(e.target.value)}
          style={{ fontSize: 13, color: TEXT, background: '#fff', border: '1px solid ' + LINE, borderRadius: 8, padding: '6px 10px', outline: 'none' }}
        >
          {[year, year - 1, year - 2].map((y) => <option key={y} value={y}>{y} 年</option>)}
        </select>
      </div>

      {/* KPI 卡片 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 12 }}>
        {kpiItems.map((it) => (
          <div
            key={it.label}
            style={{
              background: '#fff',
              borderRadius: 12,
              padding: '14px 12px',
              boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
            }}
          >
            <div style={{ fontSize: 12, color: MUTED, marginBottom: 6 }}>{it.label}</div>
            <div style={{ fontSize: 22, fontWeight: 600, color: it.color, lineHeight: 1 }}>¥{fmt(it.value)}</div>
          </div>
        ))}
      </div>

      {/* 月度营收报表 */}
      <MobilePanel title="月度营收报表">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {months.map((m) => (
            <div key={m.ym} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 52, fontSize: 12, color: MUTED, flexShrink: 0 }}>{m.ym}</div>
              <div style={{ flex: 1, minWidth: 0, height: 6, background: '#F0F0F0', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: (Math.max(0, m.net) / maxMonth * 100) + '%', background: BRAND, borderRadius: 3 }} />
              </div>
              <div style={{ width: 72, fontSize: 13, color: TEXT, textAlign: 'right', flexShrink: 0, fontWeight: 500 }}>¥{m.net.toLocaleString()}</div>
            </div>
          ))}
          {months.length === 0 && <div style={{ fontSize: 13, color: MUTED, textAlign: 'center', padding: '16px 0' }}>本年暂无收款记录</div>}
        </div>
      </MobilePanel>

      {/* 员工业绩 */}
      <MobilePanel title="员工业绩">
        <div style={{ overflowX: 'auto', margin: '-12px -16px', padding: '0 16px' }}>
          <table style={{ minWidth: 320, width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: MUTED, textAlign: 'left' }}>
                <th style={{ padding: '8px 6px', fontWeight: 500 }}>执行人</th>
                <th style={{ padding: '8px 6px', fontWeight: 500 }}>单数</th>
                <th style={{ padding: '8px 6px', fontWeight: 500 }}>应收</th>
                <th style={{ padding: '8px 6px', fontWeight: 500 }}>实收</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.executor} style={{ borderTop: '1px solid ' + LINE }}>
                  <td style={{ padding: '10px 6px', color: TEXT }}>{s.executor}</td>
                  <td style={{ padding: '10px 6px', color: MUTED }}>{s.orderCount}</td>
                  <td style={{ padding: '10px 6px', color: MUTED }}>¥{s.totalAmount.toLocaleString()}</td>
                  <td style={{ padding: '10px 6px', color: MINT }}>¥{s.paidAmount.toLocaleString()}</td>
                </tr>
              ))}
              {staff.length === 0 && <tr><td colSpan="4" style={{ padding: 16, textAlign: 'center', color: MUTED }}>暂无数据</td></tr>}
            </tbody>
          </table>
        </div>
      </MobilePanel>

      {/* 套系销量 */}
      <MobilePanel title="套系销量">
        <div style={{ overflowX: 'auto', margin: '-12px -16px', padding: '0 16px' }}>
          <table style={{ minWidth: 260, width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: MUTED, textAlign: 'left' }}>
                <th style={{ padding: '8px 6px', fontWeight: 500 }}>套系</th>
                <th style={{ padding: '8px 6px', fontWeight: 500 }}>售出</th>
                <th style={{ padding: '8px 6px', fontWeight: 500 }}>营收</th>
              </tr>
            </thead>
            <tbody>
              {pkgs.map((p) => (
                <tr key={p.packageId} style={{ borderTop: '1px solid ' + LINE }}>
                  <td style={{ padding: '10px 6px', color: TEXT }}>{p.name}</td>
                  <td style={{ padding: '10px 6px', color: MUTED }}>{p.sold}</td>
                  <td style={{ padding: '10px 6px', color: MINT }}>¥{p.revenue.toLocaleString()}</td>
                </tr>
              ))}
              {pkgs.length === 0 && <tr><td colSpan="3" style={{ padding: 16, textAlign: 'center', color: MUTED }}>暂无数据</td></tr>}
            </tbody>
          </table>
        </div>
      </MobilePanel>

      {/* 资金流水 */}
      <MobilePanel title="资金流水">
        <div style={{ overflowX: 'auto', margin: '-12px -16px', padding: '0 16px' }}>
          <table style={{ minWidth: 520, width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: MUTED, textAlign: 'left' }}>
                <th style={{ padding: '8px 6px', fontWeight: 500 }}>时间</th>
                <th style={{ padding: '8px 6px', fontWeight: 500 }}>订单</th>
                <th style={{ padding: '8px 6px', fontWeight: 500 }}>类型</th>
                <th style={{ padding: '8px 6px', fontWeight: 500 }}>方式</th>
                <th style={{ padding: '8px 6px', fontWeight: 500, textAlign: 'right' }}>金额</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((l) => (
                <tr key={l.id} style={{ borderTop: '1px solid ' + LINE }}>
                  <td style={{ padding: '10px 6px', color: MUTED, whiteSpace: 'nowrap' }}>{new Date(l.created_at).toLocaleString('zh-CN')}</td>
                  <td style={{ padding: '10px 6px', color: MUTED }}>{l.order_no}</td>
                  <td style={{ padding: '10px 6px', color: TEXT }}>{TYPE_LABEL[l.type]}</td>
                  <td style={{ padding: '10px 6px', color: MUTED }}>{l.method === 'online' ? '线上' : '线下'}</td>
                  <td style={{ padding: '10px 6px', textAlign: 'right', color: l.type === 'refund' ? '#FF4D4F' : MINT, whiteSpace: 'nowrap' }}>
                    {l.type === 'refund' ? '-' : '+'}¥{Number(l.amount).toLocaleString()}
                  </td>
                </tr>
              ))}
              {ledger.length === 0 && <tr><td colSpan="5" style={{ padding: 16, textAlign: 'center', color: MUTED }}>暂无流水</td></tr>}
            </tbody>
          </table>
        </div>
      </MobilePanel>
    </div>
  );
}

function MobilePanel({ title, children }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: '14px 16px', marginBottom: 12, boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: TEXT, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function DesktopView({ summary, months, staff, pkgs, ledger, year, onYearChange }) {
  const maxMonth = months.reduce((m, x) => Math.max(m, x.net), 0) || 1;

  return (
    <div style={{ maxWidth: 1050 }}>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h1 className="text-xl text-white">财务管理</h1>
        <select value={year} onChange={(e) => onYearChange(e.target.value)}
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
              <div className="w-16 shrink-0 text-muted">{m.ym}</div>
              <div className="flex-1 min-w-0 bg-panel2 rounded-full h-4 overflow-hidden">
                <div className="h-full bg-brand" style={{ width: (Math.max(0, m.net) / maxMonth * 100) + '%' }} />
              </div>
              <div className={'w-28 shrink-0 text-right whitespace-nowrap ' + (m.net < 0 ? 'text-red-400' : 'text-white')}>¥{m.net.toLocaleString()}</div>
            </div>
          ))}
          {months.length === 0 && <div className="text-muted text-sm py-4 text-center">本年暂无收款记录</div>}
        </div>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        {/* 员工业绩 */}
        <Panel title="员工业绩">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
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
          </div>
        </Panel>

        {/* 套系销量 */}
        <Panel title="套系销量">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
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
          </div>
        </Panel>
      </div>

      {/* 资金流水 */}
      <Panel title="资金流水" cls="mt-4">
        <div className="overflow-x-auto">
        <div className="max-h-80 overflow-auto">
          <table className="w-full min-w-[640px] text-sm">
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
        </div>
      </Panel>
    </div>
  );
}

function Kpi({ label, value, cls }) {
  return (
    <div className="bg-panel border border-line rounded-xl2 p-4">
      <div className="text-muted text-xs mb-1">{label}</div>
      <div className={'text-xl ' + cls}>¥{typeof value === 'number' ? value.toLocaleString() : value}</div>
    </div>
  );
}
function Panel({ title, children, cls }) {
  return (
    <div className={'bg-panel border border-line rounded-xl2 p-4 ' + (cls || '')}>
      <div className="text-sm text-white mb-3">{title}</div>
      {children}
    </div>
  );
}
