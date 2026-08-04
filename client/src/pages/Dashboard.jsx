import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import http from '../api.js';

// 待处理订单彩色块（横向）
const PENDING = [
  { key: 'unpaid', label: '未支付定金', color: 'bg-red-500' },
  { key: 'shoot', label: '等待拍摄', color: 'bg-amber-500' },
  { key: 'selecting', label: '待选片', color: 'bg-sky-500' },
  { key: 'retouching', label: '待精修', color: 'bg-purple-500' },
  { key: 'delivered', label: '未交片', color: 'bg-emerald-500' }
];

// 两行 8 个功能卡片
const CARDS = [
  { label: '作品库', to: '/works', icon: '▣' },
  { label: '套系', to: '/packages', icon: '◆' },
  { label: '档期', to: '/schedule', icon: '▤' },
  { label: '订单中心', to: '/orders', icon: '▥' },
  { label: '财务管理', to: '/finance', icon: '¥' },
  { label: '预约管理', to: '/appointments', icon: '✎' },
  { label: '评价审核', to: '/reviews', icon: '★' },
  { label: '数据备份', to: '/', icon: '⇩' },
  { label: '营销工具', to: '/', icon: '✉' }
];

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const nav = useNavigate();
  const now = new Date();
  const greet = now.getHours() < 12 ? '早上好' : now.getHours() < 18 ? '下午好' : '晚上好';
  const date = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

  useEffect(() => {
    http.get('/api/stats').then((r) => setStats(r.data)).catch(() => {});
  }, []);

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold text-white mb-1">{greet}，叶哲</h1>
      <p className="text-muted text-sm mb-6">{date} · 今日经营概览</p>

      {/* 经营看板 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-panel border border-line rounded-xl2 p-5">
          <div className="text-muted text-xs mb-2">应收余额</div>
          <div className="text-2xl font-semibold text-white">¥{stats ? stats.balance.toLocaleString() : '—'}</div>
        </div>
        <div className="bg-panel border border-line rounded-xl2 p-5">
          <div className="text-muted text-xs mb-2">实收金额</div>
          <div className="text-2xl font-semibold text-emerald-400">¥{stats ? stats.received.toLocaleString() : '—'}</div>
        </div>
        <div className="bg-panel border border-line rounded-xl2 p-5">
          <div className="text-muted text-xs mb-2">线上 / 线下</div>
          <div className="text-lg font-semibold text-sky-400">¥{stats ? stats.onlineIncome.toLocaleString() : '—'} <span className="text-muted text-sm">/ {stats ? stats.offlineIncome.toLocaleString() : '—'}</span></div>
        </div>
        <div className="bg-panel border border-line rounded-xl2 p-5">
          <div className="text-muted text-xs mb-2">退款</div>
          <div className="text-2xl font-semibold text-red-400">¥{stats ? stats.refunded.toLocaleString() : '—'}</div>
        </div>
      </div>

      {/* 待处理订单横向彩色块 */}
      <div className="bg-panel border border-line rounded-xl2 p-5 mb-6">
        <div className="text-sm text-white mb-4 font-medium">待处理订单</div>
        <div className="grid grid-cols-5 gap-3">
          {PENDING.map((b) => (
            <div key={b.key} className="rounded-lg p-4 bg-panel2 border border-line">
              <div className={"inline-block w-2 h-2 rounded-full " + b.color + " mb-2"} />
              <div className="text-2xl font-semibold text-white">{stats ? (stats.pendingBlocks[b.key] || 0) : '—'}</div>
              <div className="text-xs text-muted mt-1">{b.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 两行 8 个功能卡片 */}
      <div className="grid grid-cols-4 gap-4">
        {CARDS.map((c) => (
          <button key={c.label} onClick={() => nav(c.to)}
            className="bg-panel border border-line rounded-xl2 p-5 text-left hover:border-brand transition group">
            <div className="w-9 h-9 rounded-lg bg-panel2 flex items-center justify-center text-brand mb-3 group-hover:bg-brand group-hover:text-white">{c.icon}</div>
            <div className="text-sm text-white">{c.label}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
