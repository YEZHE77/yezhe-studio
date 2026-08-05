import React, { useState, useEffect } from 'react';
import http from '../api.js';
import { BarChart, LineChart } from '../components/Chart.jsx';

const yuan = (v) => '¥' + (v ?? 0).toLocaleString();

export default function DataCharts() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [summary, setSummary] = useState(null);
  const [byMonth, setByMonth] = useState([]);
  const [packages, setPackages] = useState([]);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    http.get('/api/finance/summary').then((r) => setSummary(r.data)).catch(() => {});
    http.get('/api/finance/by-month?year=' + year).then((r) => setByMonth(r.data)).catch(() => {});
    http.get('/api/finance/packages').then((r) => setPackages(r.data)).catch(() => {});
    http.get('/api/stats').then((r) => setStats(r.data)).catch(() => {});
  }, [year]);

  const months = byMonth.map((m) => m.ym.slice(5));
  const netSeries = [{ name: '净收入', color: '#2f7cf6', values: byMonth.map((m) => m.net) }];
  const recvSeries = [{ name: '实收', color: '#2f7cf6', values: byMonth.map((m) => m.received) },
  { name: '退款', color: '#e53e3e', values: byMonth.map((m) => m.refunded) }];

  const sumCards = summary
    ? [
        { label: '累计实收', value: yuan(summary.received), bar: 'bg-brand' },
        { label: '应收余额', value: yuan(summary.receivable), bar: 'bg-teal-400' },
        { label: '累计退款', value: yuan(summary.refunded), bar: 'bg-red-400' },
        { label: '线上收入', value: yuan(summary.online), bar: 'bg-sky-400' },
        { label: '线下收入', value: yuan(summary.offline), bar: 'bg-amber-400' }
      ]
    : [];

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg">数据统计</h1>
          <p className="text-xs text-muted mt-0.5">经营数据可视化 · 实时取自收款流水与订单</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">年度</span>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}
            className="border border-line rounded-lg px-3 py-1.5 text-sm bg-panel text-fg focus:border-brand outline-none">
            {[2024, 2025, 2026, 2027].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* 汇总卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {sumCards.map((c) => (
          <div key={c.label} className="bg-panel border border-line rounded-xl2 p-4 relative overflow-hidden">
            <div className="text-xs text-muted">{c.label}</div>
            <div className="text-xl font-bold text-fg mt-2">{c.value}</div>
            <div className={'absolute bottom-0 left-0 right-0 h-1 ' + c.bar} />
          </div>
        ))}
      </div>

      {/* 月度净收入折线 */}
      <div className="bg-panel border border-line rounded-xl2 p-5">
        <div className="text-[15px] font-semibold text-fg mb-1">月度净收入趋势</div>
        <div className="text-xs text-muted mb-3">{year} 年 · 实收减去退款</div>
        {byMonth.length
          ? <LineChart labels={months} series={netSeries} valueFormat={(v) => '¥' + (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v)} />
          : <Empty />}
      </div>

      {/* 实收 / 退款对比 */}
      <div className="bg-panel border border-line rounded-xl2 p-5">
        <div className="text-[15px] font-semibold text-fg mb-1">月度实收 / 退款</div>
        <div className="text-xs text-muted mb-3">{year} 年</div>
        {byMonth.length
          ? <LineChart labels={months} series={recvSeries} valueFormat={(v) => '¥' + (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v)} />
          : <Empty />}
      </div>

      {/* 套系销量 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-panel border border-line rounded-xl2 p-5">
          <div className="text-[15px] font-semibold text-fg mb-1">套系销量（单）</div>
          <div className="text-xs text-muted mb-3">按订单数排序</div>
          {packages.length
            ? <BarChart data={packages.map((p) => ({ label: p.name, value: p.sold }))} color="#2f7cf6" />
            : <Empty />}
        </div>
        <div className="bg-panel border border-line rounded-xl2 p-5">
          <div className="text-[15px] font-semibold text-fg mb-1">套系营收（¥）</div>
          <div className="text-xs text-muted mb-3">实收金额</div>
          {packages.length
            ? <BarChart data={packages.map((p) => ({ label: p.name, value: p.revenue }))} color="#16a34a" valueFormat={(v) => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v} />
            : <Empty />}
        </div>
      </div>

      {/* 待处理分布 */}
      {stats && (
        <div className="bg-panel border border-line rounded-xl2 p-5">
          <div className="text-[15px] font-semibold text-fg mb-3">待处理订单分布</div>
          <div className="grid grid-cols-5 gap-3">
            {[
              { k: 'unpaid', label: '待付定金', c: 'text-red-500', b: 'bg-red-400' },
              { k: 'shoot', label: '等待拍摄', c: 'text-teal-500', b: 'bg-teal-400' },
              { k: 'selecting', label: '待选片', c: 'text-sky-500', b: 'bg-sky-400' },
              { k: 'retouching', label: '待精修', c: 'text-amber-500', b: 'bg-amber-400' },
              { k: 'delivered', label: '未交片', c: 'text-orange-500', b: 'bg-orange-400' }
            ].map((x) => (
              <div key={x.k} className="relative bg-panel border border-line rounded-xl2 pt-5 pb-4 text-center">
                <div className={'text-2xl font-bold ' + x.c}>{stats.pendingBlocks[x.k] || 0}</div>
                <div className="text-xs text-fg/80 mt-1.5">{x.label}</div>
                <div className={'absolute bottom-0 left-0 right-0 h-1 ' + x.b} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Empty() {
  return <div className="h-40 flex items-center justify-center text-xs text-faint">暂无数据</div>;
}
