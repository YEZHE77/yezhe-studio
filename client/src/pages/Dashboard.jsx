import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import http, { formatBytes } from '../api.js';
import Icon from '../components/Icon.jsx';

// 待处理订单：5 灰块（参考拾光盒子，数字 28px/500，块间无间距，底部 5px 彩色线，悬停色块上扩填满+文字变白）
const PENDING = [
  { key: 'unpaid', label: '未支付定金', line: '#FA7D77' },
  { key: 'shoot', label: '等待拍摄', line: '#49C5AE' },
  { key: 'delivered', label: '未交片', line: '#FAC054' },
  { key: 'selecting', label: '待选片', line: '#6DB3E2' },
  { key: 'retouching', label: '待精修', line: '#FAC054' }
];

// 快捷链接（参考图：教程黑 / 资料青 / 作品蓝 / 套系金）
const QUICK = [
  { label: '教程', bg: '#333333', to: '/datacharts' },
  { label: '资料', bg: '#53CBC4', to: '/settings' },
  { label: '作品', bg: '#2DB7F5', to: '/works' },
  { label: '套系', bg: '#CFBB90', to: '/packages' }
];

// 右侧信息列（参考图：w=205 卡片，pad 30/15/30/20）
const INFO_CARDS = [
  { title: '我的小程序', desc: '一键更换模板，即时生效', to: '/settings' },
  { title: '我的网站', desc: '支持独立域名，全网搜索', to: '/settings' },
  { title: '叶哲 Studio × 公告', desc: '公告及功能更新' }
];

// 品牌管理（对外展示 / 获客）
const BRAND_CARDS = [
  { icon: 'settings', title: '资料设置', desc: '上传封面，编辑姓名、简介、成员等', btn: '立即编辑', to: '/settings' },
  { icon: 'miniapp', title: '小程序', desc: '可定制专属小程序，并关联公众号', btn: '立即使用', onClick: () => alert('C 端为微信原生小程序：在开发者工具勾选「不校验合法域名」后编译即可真机预览；正式发布需自备备案域名。') },
  { icon: 'website', title: '我的网站', desc: '打造专属工作室品牌和独立域名', btn: '立即使用', to: '/settings' },
  { icon: 'link', title: '关联公众号', desc: '设置公众号菜单和顾客提醒', btn: '点击查看', onClick: () => alert('公众号关联功能规划中：后续可在「资料设置」中配置公众号菜单与顾客提醒。') },
  { icon: 'marketing', title: '生成名片', desc: '朋友圈名片海报，更好的传播方式', btn: 'APP端使用', to: '/card' }
];

// 日常管理（内部运营）
const OPS_CARDS = [
  { icon: 'calendar', title: '档期排期', desc: '拍摄档期管理与冲突拦截', to: '/schedule' },
  { icon: 'order', title: '订单中心', desc: '订单全生命周期与收款流水', to: '/orders' },
  { icon: 'select', title: '在线选片', desc: '客户选片进度双向同步', to: '/orders?status=selecting' },
  { icon: 'finance', title: '财务管理', desc: '营收汇总 / 月度对账报表', to: '/finance' },
  { icon: 'dashboard', title: '数据看板', desc: '经营概览与待办分布', to: '/datacharts' }
];

// 大卡片（参考图：高 259、1px #E6E9EF 边框、顶部 30px 灰色图标、标题 15px、描述 2 行、底部蓝色圆角按钮）
function BigCard({ icon, title, desc, btn, to, onClick }) {
  const nav = useNavigate();
  const go = () => { if (onClick) onClick(); else if (to) nav(to); };
  return (
    <div
      onClick={go}
      className="bg-white border cursor-pointer hover:shadow-sm hover:border-brand/30 transition text-center"
      style={{ borderRadius: 4, borderColor: '#E6E9EF', padding: '38px 15px', height: 259 }}
    >
      <div className="flex items-center justify-center" style={{ color: '#666666' }}>
        <Icon name={icon} className="w-8 h-8" strokeWidth={1.4} />
      </div>
      <div className="text-[15px] mt-1" style={{ color: '#333333' }}>{title}</div>
      <div className="text-xs mt-[10px] leading-[21px]" style={{ color: '#AAAAAA' }}>{desc}</div>
      <div className="mt-[25px]">
        <span className="inline-flex items-center px-[15px] h-[30px] rounded-full text-xs font-medium" style={{ color: '#2DB7F6', background: '#fff', border: '1px solid #ABE2FB' }}>{btn || '进入'}</span>
      </div>
    </div>
  );
}

function EyeIcon({ off }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {off ? (
        <>
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </>
      ) : (
        <>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#DDDDDD" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="13" fill="none" stroke="#CCCCCC" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [storage, setStorage] = useState(null);
  const [showAlert, setShowAlert] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hiddenMoney, setHiddenMoney] = useState(false); // 账户概览：眼睛图标切换金额显隐
  const nav = useNavigate();

  useEffect(() => {
    setLoading(true);
    Promise.all([
      http.get('/api/stats').then((r) => setStats(r.data)).catch(() => {}),
      http.get('/api/admin/storage/stats')
        .then((r) => { setStorage(r.data); setShowAlert(!r.data.cloudEnabled); })
        .catch(() => { setStorage(null); setShowAlert(false); })
    ]).finally(() => setLoading(false));
  }, []);

  // 存储容量告警等级：≥90% 严重 / 70-90% 警示 / <70% 正常
  const storageRatio = storage && storage.limitBytes ? storage.totalUsedBytes / storage.limitBytes : 0;
  const storagePct = Math.min(100, Math.round(storageRatio * 100));
  const storageCritical = !!(storage && storage.cloudEnabled && storageRatio >= 0.9);

  const safeNum = (v) => (typeof v === 'number' ? v : 0);
  const overview = [
    { label: '商户余额 (元)', value: stats ? safeNum(stats.balance).toLocaleString() : '—' },
    { label: '线上收入 (元)', value: stats ? safeNum(stats.onlineIncome).toLocaleString() : '—' },
    { label: '线下收入 (元)', value: stats ? safeNum(stats.offlineIncome).toLocaleString() : '—' }
  ];

  const alertStyle = { background: 'rgba(244,113,117,0.08)', color: '#999999' };

  return (
    <div className="mx-auto" style={{ maxWidth: 1050 }}>
      {/* ===== 顶部：品牌 + 快捷链接（左） + 信息列（右） ===== */}
      <div className="flex items-start gap-[61px]">
        <div className="flex-1 min-w-0">
          <div style={{ paddingLeft: 90 }}>
            <div className="text-[20px]" style={{ color: '#222222', lineHeight: 1.4 }}>叶哲 Studio</div>
            <div className="flex flex-wrap items-center text-xs mt-5" style={{ color: 'rgba(34,34,34,0.6)' }}>
              <span>会员专享：独立网站、小程序、档期管理</span>
              <button type="button" className="ml-2" style={{ color: '#222222', background: '#fff', padding: '3px 5px' }}>查看更多会员权益 &gt;</button>
            </div>
            <div className="flex flex-wrap gap-[15px] mt-6">
              {QUICK.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => nav(q.to)}
                  className="text-xs text-white leading-none"
                  style={{ background: q.bg, padding: '0 28px', height: 24, borderRadius: 2 }}
                >{q.label} &gt;</button>
              ))}
            </div>
          </div>

          {/* 告警横幅（参考图 VIP 横幅样式：浅粉底 + 灰字 + 彩色操作） */}
          {storageCritical && (
            <div className="flex items-center gap-2 px-[15px] mt-5 text-xs" style={alertStyle}>
              <div className="flex-1">存储容量告警：已用 {storagePct}%（{formatBytes(storage.totalUsedBytes)} / {formatBytes(storage.limitBytes)}），请尽快清理避免超限。</div>
              <button type="button" className="shrink-0" style={{ color: '#F47175' }} onClick={() => nav('/capacity')}>去清理 &gt;</button>
            </div>
          )}
          {showAlert && !storageCritical && (
            <div className="flex items-center gap-2 px-[15px] mt-5 text-xs" style={alertStyle}>
              <div className="flex-1">图片存储提示：当前后端未配置永久云存储（R2），建议尽快配置，避免重启后图片丢失。</div>
              <button type="button" className="shrink-0" style={{ color: '#F47175' }} onClick={() => setShowAlert(false)}>知道了</button>
            </div>
          )}
        </div>

        {/* 右侧信息列 */}
        <div className="w-[205px] shrink-0 space-y-[11px]">
          {INFO_CARDS.map((c) => (
            <button
              key={c.title}
              type="button"
              onClick={() => c.to && nav(c.to)}
              className="w-full text-left bg-white border hover:shadow-sm transition"
              style={{ borderRadius: 4, borderColor: '#F0F0F0', padding: '30px 15px 30px 20px', height: 100 }}
            >
              <div className="text-[14px]" style={{ color: '#333333' }}>{c.title}</div>
              <div className="text-xs mt-2" style={{ color: '#999999' }}>{c.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 加载中占位 */}
      {loading && (
        <div className="bg-panel border border-line rounded-xl2 p-8 text-center text-muted text-sm mt-8">
          <div className="inline-block w-5 h-5 border-2 border-brand/30 border-t-brand rounded-full animate-spin mr-2 align-middle"></div>
          正在连接服务器，首次启动约需 10 秒…
        </div>
      )}

      {/* 账户概览（参考图：4 等分居中 + 区间竖线，标签后跟帮助/编辑图标，金额眼睛已删除） */}
      <div className={'bg-white border mt-8 ' + (loading ? 'opacity-50' : '')} style={{ borderRadius: 4, borderColor: '#F0F0F0', padding: '25px 0 38px' }}>
        <div className="grid grid-cols-4 divide-x divide-[#F0F0F0]">
          <div className="text-center">
            <div className="flex items-center justify-center gap-2">
              <span className="text-[16px] font-medium" style={{ color: '#333333' }}>账户概览</span>
              <button
                type="button"
                onClick={() => setHiddenMoney((h) => !h)}
                title={hiddenMoney ? '显示金额' : '隐藏金额'}
                style={{ color: '#999999', cursor: 'pointer', background: 'none', border: 'none', padding: 0, display: 'flex' }}
              >
                <EyeIcon off={hiddenMoney} />
              </button>
              <button type="button" className="text-xs" style={{ color: '#00BAFB' }} onClick={() => nav('/finance')}>进入</button>
            </div>
          </div>
          {overview.map((o, i) => (
            <div key={o.label} className="text-center">
              <div className="flex items-center justify-center gap-1.5 text-xs" style={{ color: '#999999' }}>
                <span>{o.label}</span>
                <span title="帮助"><HelpIcon /></span>
                {i === 0 && <span title="编辑" style={{ cursor: 'pointer', display: 'flex' }} onClick={() => nav('/finance')}><EditIcon /></span>}
              </div>
              <div className="mt-1" style={{ fontSize: 25, color: '#333333' }}>{hiddenMoney ? '¥••••' : '¥' + o.value}</div>
              <button type="button" className="mt-1 text-xs" style={{ color: '#00BAFB' }} onClick={() => nav('/finance')}>明细</button>
            </div>
          ))}
        </div>
      </div>

      {/* 待处理订单（参考图：5 灰块紧贴 + 数字 28px） */}
      <div className="bg-white border mt-4" style={{ borderRadius: 4, borderColor: '#F0F0F0', padding: '38px 50px' }}>
        <div className="text-[16px] font-medium mb-6" style={{ color: '#333333' }}>待处理订单</div>
        <div className="grid grid-cols-5">
          {PENDING.map((b) => {
            const n = stats && stats.pendingBlocks ? (stats.pendingBlocks[b.key] || 0) : '—';
            return (
              <button
                key={b.key}
                type="button"
                onClick={() => nav('/orders?status=' + (b.key === 'unpaid' ? 'unpaid' : b.key))}
                className="relative text-center overflow-hidden group cursor-pointer flex flex-col items-center justify-center"
                style={{ background: '#F6F6F6', height: 110 }}
              >
                <div className="absolute left-0 right-0 bottom-0 h-[5px] group-hover:h-full transition-all duration-300 pointer-events-none" style={{ background: b.line }} />
                <div className="relative z-10 flex flex-col items-center justify-center">
                  <div className="text-xs pb-[2px] transition-colors text-[#333333] group-hover:text-[#ffffff]">{b.label}</div>
                  <div className="text-[28px] font-medium leading-none transition-colors text-[#333333] group-hover:text-[#ffffff]">{n}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 品牌管理 + 日常管理（合并成一个大卡片，纯白底 + #E6E9EF 边框更清晰；内部卡片设计保持不变） */}
      <div className="bg-white border mt-4" style={{ borderRadius: 8, borderColor: '#E6E9EF', padding: '22px 50px 28px' }}>
        <div className="text-[16px] font-medium mb-6" style={{ color: '#333333' }}>品牌管理</div>
        <div className="grid grid-cols-5 gap-[10px]">
          {BRAND_CARDS.map((c) => <BigCard key={c.title} {...c} />)}
        </div>
        <div style={{ height: 1, background: '#E6E9EF', margin: '16px 0' }} />
        <div className="text-[16px] font-medium mb-6" style={{ color: '#333333' }}>日常管理</div>
        <div className="grid grid-cols-5 gap-[10px]">
          {OPS_CARDS.map((c) => <BigCard key={c.title} {...c} />)}
        </div>
      </div>
    </div>
  );
}
