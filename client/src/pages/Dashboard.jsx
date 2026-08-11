import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import http, { formatBytes } from '../api.js';
import Icon from '../components/Icon.jsx';

// 待处理订单：白底卡片 + 底部彩色细线 + hover 高亮（参考拾光盒子）
const PENDING = [
  { key: 'unpaid', label: '未支付定金', bar: 'bg-amber-400', tx: 'text-amber-500' },
  { key: 'shoot', label: '等待拍摄', bar: 'bg-teal-400', tx: 'text-teal-500' },
  { key: 'selecting', label: '待选片', bar: 'bg-sky-400', tx: 'text-sky-500' },
  { key: 'retouching', label: '待精修', bar: 'bg-amber-400', tx: 'text-amber-500' },
  { key: 'delivered', label: '未交片', bar: 'bg-orange-400', tx: 'text-orange-500' }
];

// 品牌管理（对外展示 / 获客）——参考图：资料设置/小程序/我的网站/关联公众号/生成名片
const BRAND_CARDS = [
  { title: '资料设置', desc: '上传封面，编辑姓名、简介、成员等', btn: '立即编辑', to: '/settings' },
  { title: '小程序', desc: '可定制专属小程序，并关联公众号', btn: '立即使用', onClick: () => alert('C 端为微信原生小程序：在开发者工具勾选「不校验合法域名」后编译即可真机预览；正式发布需自备备案域名。') },
  { title: '我的网站', desc: '打造专属工作室品牌和独立域名', btn: '立即使用', to: '/settings' },
  { title: '关联公众号', desc: '设置公众号菜单和顾客提醒', btn: '点击查看', onClick: () => alert('公众号关联功能规划中：后续可在「资料设置」中配置公众号菜单与顾客提醒。') },
  { title: '生成名片', desc: '朋友圈名片海报，更好的传播方式', btn: 'APP端使用', to: '/card' }
];

// 日常管理（内部运营）
const OPS_CARDS = [
  { icon: 'calendar', title: '档期排期', desc: '拍摄档期管理与冲突拦截', to: '/schedule' },
  { icon: 'order', title: '订单中心', desc: '订单全生命周期与收款流水', to: '/orders' },
  { icon: 'select', title: '在线选片', desc: '客户选片进度双向同步', to: '/orders?status=selecting' },
  { icon: 'finance', title: '财务管理', desc: '营收汇总 / 月度对账报表', to: '/finance' },
  { icon: 'dashboard', title: '数据看板', desc: '经营概览与待办分布', to: '/' }
];

function FuncCard({ icon, title, desc, btn, to, onClick }) {
  const nav = useNavigate();
  const go = () => { if (onClick) onClick(); else if (to) nav(to); };
  return (
    <div onClick={go} className="group bg-white border border-line rounded-lg p-4 cursor-pointer hover:shadow-sm hover:border-brand/30 transition h-full" style={{ borderRadius: 4 }}>
      {icon && (
        <div className="w-9 h-9 rounded-lg text-fg/70 flex items-center justify-center mb-2">
          <Icon name={icon} className="w-5 h-5" />
        </div>
      )}
      <div className="text-[15px] font-normal text-fg">{title}</div>
      <div className="text-xs mt-1.5 leading-relaxed" style={{ color: '#AAAAAA' }}>{desc}</div>
      <div className="mt-4">
        <span className="inline-block px-4 py-1 rounded-full text-xs font-medium" style={{ color: '#2DB7F6', background: '#fff', border: '1px solid #2DB7F6' }}>{btn || '进入'}</span>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [storage, setStorage] = useState(null);
  const [showAlert, setShowAlert] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hiddenMoney, setHiddenMoney] = useState({}); // 账户概览：眼睛图标切换金额显隐
  const nav = useNavigate();
  const now = new Date();
  const date = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

  useEffect(() => {
    setLoading(true);
    Promise.all([
      http.get('/api/stats').then((r) => setStats(r.data)).catch(() => {}),
      http.get('/api/admin/storage/stats')
        .then((r) => { setStorage(r.data); setShowAlert(!r.data.cloudEnabled); })
        .catch(() => { setStorage(null); setShowAlert(false); })
    ]).finally(() => setLoading(false));
  }, []);

  // 存储容量告警等级：≥90% 严重（持续红）/ 70-90% 警示（黄）/ <70% 正常
  const storageRatio = storage && storage.limitBytes ? storage.totalUsedBytes / storage.limitBytes : 0;
  const storagePct = Math.min(100, Math.round(storageRatio * 100));
  const storageCritical = !!(storage && storage.cloudEnabled && storageRatio >= 0.9);
  const storageLevel = storageCritical ? 'critical' : storageRatio >= 0.7 ? 'warning' : 'normal';
  const storageBar = storageLevel === 'critical' ? 'bg-red-500' : storageLevel === 'warning' ? 'bg-amber-400' : 'bg-emerald-500';
  const storageTx = storageLevel === 'critical' ? 'text-red-600' : storageLevel === 'warning' ? 'text-amber-600' : 'text-emerald-600';

  const safeNum = (v) => (typeof v === 'number' ? v : 0);
  const overview = [
    { label: '商户余额（应收）', value: stats ? safeNum(stats.balance).toLocaleString() : '—' },
    { label: '线上收入', value: stats ? safeNum(stats.onlineIncome).toLocaleString() : '—' },
    { label: '线下收入', value: stats ? safeNum(stats.offlineIncome).toLocaleString() : '—' }
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      {/* 顶部：品牌 + 会员提示 + 快捷链接 + 右侧信息列（参考图） */}
      <div className="flex gap-6">
        <div className="flex-1 min-w-0">
          <div className="text-xl" style={{ color: '#222222' }}>叶哲 Studio</div>
          <div className="text-xs mt-1" style={{ color: 'rgba(34,34,34,0.6)' }}>{date} · 今日经营概览</div>
          <div className="flex flex-wrap gap-2 mt-4">
            <button onClick={() => nav('/settings')} className="px-4 py-1.5 rounded text-xs" style={{ background: '#333333', color: '#fff' }}>资料 &gt;</button>
            <button onClick={() => nav('/works')} className="px-4 py-1.5 rounded text-xs" style={{ background: '#2DB7F5', color: '#fff' }}>作品 &gt;</button>
            <button onClick={() => nav('/packages')} className="px-4 py-1.5 rounded text-xs" style={{ background: '#CFBB90', color: '#fff' }}>套系 &gt;</button>
            <button onClick={() => nav('/datacharts')} className="px-4 py-1.5 rounded text-xs" style={{ background: '#53CBC4', color: '#fff' }}>统计 &gt;</button>
          </div>
        </div>
        {/* 右侧信息列 */}
        <div className="w-[220px] shrink-0 space-y-4">
          <button onClick={() => nav('/settings')} className="w-full text-left bg-white border border-line rounded-lg px-4 py-6 hover:shadow-sm transition" style={{ borderRadius: 4 }}>
            <div className="text-sm text-fg">我的小程序</div>
            <div className="text-xs mt-1" style={{ color: '#999999' }}>一键更换模板，即时生效</div>
          </button>
          <button onClick={() => nav('/settings')} className="w-full text-left bg-white border border-line rounded-lg px-4 py-6 hover:shadow-sm transition" style={{ borderRadius: 4 }}>
            <div className="text-sm text-fg">我的网站</div>
            <div className="text-xs mt-1" style={{ color: '#999999' }}>支持独立域名，全网搜索</div>
          </button>
          <div className="bg-white border border-line rounded-lg px-4 py-6" style={{ borderRadius: 4 }}>
            <div className="text-sm text-fg">叶哲 Studio × 公告</div>
            <div className="text-xs mt-1" style={{ color: '#999999' }}>公告及功能更新</div>
          </div>
        </div>
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

      {/* 账户概览（参考图：标题 + 进入 + 3 列金额 + 眼睛显隐） */}
      <div className={'bg-white border border-line px-8 pt-6 pb-8 ' + (loading ? 'opacity-50' : '')} style={{ borderRadius: 4 }}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <span className="text-base font-medium" style={{ color: '#333333' }}>账户概览</span>
            <button onClick={() => nav('/finance')} className="text-xs" style={{ color: '#00BAFB' }}>进入</button>
          </div>
          <button
            type="button"
            onClick={() => setHiddenMoney((h) => ({ ...h, all: !h.all }))}
            title={hiddenMoney.all ? '显示金额' : '隐藏金额'}
            style={{ color: '#999999', cursor: 'pointer', background: 'none', border: 'none', padding: 0, display: 'flex' }}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {hiddenMoney.all
                ? <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                : <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />}
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {overview.map((o) => (
            <div key={o.label}>
              <div className="text-xs" style={{ color: '#999999' }}>{o.label}</div>
              <div className="text-2xl mt-1" style={{ color: '#333333' }}>{hiddenMoney.all ? '¥••••' : '¥' + o.value}</div>
              <button onClick={() => nav('/finance')} className="mt-1 text-xs" style={{ color: '#00BAFB' }}>明细</button>
            </div>
          ))}
        </div>
      </div>

      {/* 待处理订单（参考图：5 灰块 + 数字 28px） */}
      <div className="bg-white border border-line px-10 py-8" style={{ borderRadius: 4 }}>
        <div className="text-base font-medium mb-6" style={{ color: '#333333' }}>待处理订单</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {PENDING.map((b) => {
            const n = stats && stats.pendingBlocks ? (stats.pendingBlocks[b.key] || 0) : '—';
            return (
              <button
                key={b.key}
                onClick={() => nav('/orders?status=' + (b.key === 'unpaid' ? 'unpaid' : b.key))}
                className="relative text-center px-4 py-5 overflow-hidden group cursor-pointer"
                style={{ background: '#F6F6F6' }}
              >
                <div className="text-xs pb-1" style={{ color: '#333333' }}>{b.label}</div>
                <div className="text-[28px] font-medium" style={{ color: '#333333' }}>{n}</div>
                <div className={'absolute inset-0 pointer-events-none -translate-y-full group-hover:translate-y-0 transition-transform duration-300 ' + b.bar + '/15'} />
              </button>
            );
          })}
        </div>
      </div>

      {/* 品牌管理 */}
      <div>
        <div className="text-base font-medium mb-4" style={{ color: '#333333' }}>品牌管理</div>
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
