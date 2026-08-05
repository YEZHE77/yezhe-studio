import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import http, { formatBytes } from '../api.js';
import Icon from '../components/Icon.jsx';

// 待处理订单：白底卡片 + 底部彩色细线 + hover 高亮（参考拾光盒子）
const PENDING = [
  { key: 'unpaid', label: '未支付定金', bar: 'bg-red-400', tx: 'text-red-500' },
  { key: 'shoot', label: '等待拍摄', bar: 'bg-teal-400', tx: 'text-teal-500' },
  { key: 'selecting', label: '待选片', bar: 'bg-sky-400', tx: 'text-sky-500' },
  { key: 'retouching', label: '待精修', bar: 'bg-amber-400', tx: 'text-amber-500' },
  { key: 'delivered', label: '未交片', bar: 'bg-orange-400', tx: 'text-orange-500' }
];

// 品牌管理（对外展示 / 获客）
const BRAND_CARDS = [
  { icon: 'photo', title: '作品库', desc: '上传 / 编辑对外客片，实时同步 C 端小程序', to: '/works' },
  { icon: 'package', title: '套系管理', desc: '上下架拍摄套餐与增值项定价', to: '/packages' },
  { icon: 'review', title: '评价审核', desc: '审核客户口碑，通过后公开展示', to: '/reviews' },
  { icon: 'appointment', title: '预约管理', desc: '客户预约转订单，跟踪每条线索', to: '/appointments' },
  { icon: 'link', title: '小程序 C 端', desc: '微信原生小程序（体验版预览）', onClick: () => alert('C 端为微信原生小程序：在开发者工具勾选「不校验合法域名」后编译即可真机预览；正式发布需自备备案域名。') }
];

// 日常管理（内部运营）
const OPS_CARDS = [
  { icon: 'calendar', title: '档期排期', desc: '拍摄档期管理与冲突拦截', to: '/schedule' },
  { icon: 'order', title: '订单中心', desc: '订单全生命周期与收款流水', to: '/orders' },
  { icon: 'select', title: '在线选片', desc: '客户选片进度双向同步', to: '/orders?status=selecting' },
  { icon: 'finance', title: '财务管理', desc: '营收汇总 / 月度对账报表', to: '/finance' },
  { icon: 'dashboard', title: '数据看板', desc: '经营概览与待办分布', to: '/' }
];

function FuncCard({ icon, title, desc, to, onClick }) {
  const nav = useNavigate();
  const go = () => { if (onClick) onClick(); else if (to) nav(to); };
  return (
    <div onClick={go} className="group bg-panel border border-line rounded-xl2 p-5 cursor-pointer hover:shadow-sm hover:border-brand/30 transition flex flex-col items-center text-center h-full">
      <div className="w-10 h-10 rounded-lg text-fg/70 flex items-center justify-center mb-3">
        <Icon name={icon} className="w-6 h-6" />
      </div>
      <div className="text-[15px] font-semibold text-fg">{title}</div>
      <div className="text-xs text-muted mt-1.5 leading-relaxed flex-1">{desc}</div>
      <div className="mt-4 w-full">
        <span className="inline-block px-4 py-1.5 rounded-full border border-brand text-brand text-xs group-hover:bg-brand/5 transition">进入</span>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [storage, setStorage] = useState(null);
  const [showAlert, setShowAlert] = useState(false);
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();
  const now = new Date();
  const greet = now.getHours() < 12 ? '早上好' : now.getHours() < 18 ? '下午好' : '晚上好';
  const date = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

  useEffect(() => {
    setLoading(true);
    Promise.all([
      http.get('/api/stats').then((r) => setStats(r.data)).catch(() => {}),
      http.get('/api/admin/storage/stats')
        .then((r) => { setStorage(r.data); setShowAlert(!r.data.r2Enabled); })
        .catch(() => { setStorage(null); setShowAlert(false); })
    ]).finally(() => setLoading(false));
  }, []);

  // 存储容量告警等级：≥90% 严重（持续红）/ 70-90% 警示（黄）/ <70% 正常
  const storageRatio = storage && storage.limitBytes ? storage.totalUsedBytes / storage.limitBytes : 0;
  const storagePct = Math.min(100, Math.round(storageRatio * 100));
  const storageCritical = !!(storage && storage.r2Enabled && storageRatio >= 0.9);
  const storageLevel = storageCritical ? 'critical' : storageRatio >= 0.7 ? 'warning' : 'normal';
  const storageBar = storageLevel === 'critical' ? 'bg-red-500' : storageLevel === 'warning' ? 'bg-amber-400' : 'bg-emerald-500';
  const storageTx = storageLevel === 'critical' ? 'text-red-600' : storageLevel === 'warning' ? 'text-amber-600' : 'text-emerald-600';

  const overview = [
    { label: '商户余额（应收）', value: stats ? stats.balance.toLocaleString() : '—' },
    { label: '线上收入', value: stats ? stats.onlineIncome.toLocaleString() : '—' },
    { label: '线下收入', value: stats ? stats.offlineIncome.toLocaleString() : '—' }
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">{greet}，叶哲</h1>
        <p className="text-muted text-xs mt-0.5">{date} · 今日经营概览</p>
      </div>

      {/* 品牌头部卡片 */}
      <div className="bg-panel border border-line rounded-xl2 p-5 flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-brand flex items-center justify-center text-white text-xl font-semibold shrink-0">叶</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-fg">叶哲 Studio</span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600">已上线</span>
          </div>
          <div className="text-xs text-muted mt-0.5">摄影工作室全链路管理系统 · 海口婚礼 / 人像摄影</div>
        </div>
        <button onClick={() => nav('/works')} className="hidden sm:block px-4 py-2 rounded-lg border border-line text-sm text-muted hover:text-brand hover:border-brand transition shrink-0">管理对外作品</button>
      </div>

      {/* 告警横幅：存储严重超额（≥90%，持续） */}
      {storageCritical && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl2 px-5 py-3">
          <span className="w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center text-xs font-bold shrink-0">!</span>
          <div className="flex-1 text-sm text-red-800">
            存储容量告警：R2 已用 {storagePct}%（{formatBytes(storage.totalUsedBytes)} / {formatBytes(storage.limitBytes)}）。免费额度仅 10GB，请尽快清理废弃图片或归档历史客片，避免超出免费额度产生费用。
          </div>
          <button onClick={() => nav('/capacity')} className="text-red-600 hover:text-red-800 text-sm shrink-0 font-medium">去清理 →</button>
        </div>
      )}

      {/* 告警横幅：未配置 R2（可关闭） */}
      {showAlert && !storageCritical && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl2 px-5 py-3">
          <span className="w-5 h-5 rounded-full bg-amber-500 text-white flex items-center justify-center text-xs font-bold shrink-0">!</span>
          <div className="flex-1 text-sm text-amber-800">
            图片存储提示：当前后端未配置永久云存储（Cloudflare R2），Render 服务重启可能导致已上传图片丢失。建议尽快配置 R2，或避免依赖临时存储。
          </div>
          <button onClick={() => setShowAlert(false)} className="text-amber-600 hover:text-amber-800 text-sm shrink-0">知道了</button>
        </div>
      )}

      {/* 加载中占位 */}
      {loading && (
        <div className="bg-panel border border-line rounded-xl2 p-8 text-center text-muted text-sm">
          <div className="inline-block w-5 h-5 border-2 border-brand/30 border-t-brand rounded-full animate-spin mr-2 align-middle"></div>
          正在连接服务器，首次启动约需 10 秒…
        </div>
      )}

      {/* 账户概览 3 列 */}
      <div className={'grid grid-cols-1 sm:grid-cols-3 gap-4 ' + (loading ? 'opacity-50' : '')}>
        {overview.map((o) => (
          <div key={o.label} className="bg-panel border border-line rounded-xl2 p-5 flex flex-col">
            <div className="text-xs text-muted">{o.label}</div>
            <div className="text-2xl font-bold text-fg mt-2">¥{o.value}</div>
            <button onClick={() => nav('/finance')} className="mt-auto pt-3 text-xs text-brand hover:underline self-start">明细 →</button>
          </div>
        ))}
      </div>

      {/* 待处理订单：白底等宽卡片 + 底部彩色线 + hover 高亮 */}
      <div className="bg-panel border border-line rounded-xl2 p-5">
        <div className="text-[15px] font-semibold text-fg mb-4">待处理订单</div>
        <div className="grid grid-cols-5 gap-3">
          {PENDING.map((b) => {
            const n = stats ? (stats.pendingBlocks[b.key] || 0) : '—';
            return (
              <button
                key={b.key}
                onClick={() => nav('/orders?status=' + b.key)}
                className="relative bg-panel border border-line rounded-xl2 pt-5 pb-4 text-center hover:shadow-sm hover:border-brand/30 transition overflow-hidden group"
              >
                <div className={'text-2xl font-bold ' + b.tx}>{n}</div>
                <div className="text-xs text-fg/80 mt-1.5">{b.label}</div>
                <div className={'absolute bottom-0 left-0 right-0 h-1 ' + b.bar} />
                <div className={'absolute inset-0 opacity-0 group-hover:opacity-10 transition pointer-events-none ' + b.bar.replace('bg-', 'bg-')} />
              </button>
            );
          })}
        </div>
      </div>

      {/* 品牌管理 */}
      <div>
        <div className="text-[15px] font-semibold text-fg mb-3">品牌管理（对外展示）</div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {BRAND_CARDS.map((c) => <FuncCard key={c.title} {...c} />)}
        </div>
      </div>

      {/* 日常管理 */}
      <div>
        <div className="text-[15px] font-semibold text-fg mb-3">日常管理（内部运营）</div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {OPS_CARDS.map((c) => <FuncCard key={c.title} {...c} />)}
        </div>
      </div>
    </div>
  );
}
