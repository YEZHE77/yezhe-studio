// 待办事项页（首页「待办事项」入口跳转）
// 顶部日期卡片（公历 + 农历）+ 横向滚动分类 Tab（订单状态） + 过滤后的订单列表
// 数据源：GET /api/stats（计数）+ GET /api/orders?statuses=...（列表）+ GET /api/schedules/lunar?month=YYYY-MM（农历）
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import http from '../api.js';

const GREEN = '#7ECDBB';
const TEXT = '#1f2329';
const MUTED = '#999999';
const LINE = '#F0F0F0';

// 横向 Tab 配置（key 对应后端 statuses / status / payment_status 过滤；color 为下划线色；选中底色固定青绿）
const TAB_DEFS = [
  { key: 'deposit',    label: '已付定金', filterKey: 'status', value: 'deposit_pending', accent: '#FE2C55' },
  { key: 'waiting',    label: '等待拍摄', filterKey: 'status', value: 'waiting_shoot',   accent: GREEN },
  { key: 'selecting',  label: '待选片',   filterKey: 'status', value: 'todo_selecting', accent: '#2DB7F5' },
  { key: 'retouching', label: '精修中',   filterKey: 'status', value: 'todo_retouch',   accent: '#FFB900' },
  { key: 'delivered',  label: '待交付',   filterKey: 'status', value: 'todo_deliver',   accent: '#8C8C8C' },
];

// 状态文本映射（与 Orders.jsx 卡片 STATUS_LABEL 同步）
const STATUS_LABEL = {
  unpaid: '未付定金',
  deposit: '等待拍摄',
  shot: '已拍摄',
  selecting: '选片中',
  retouching: '精修中',
  delivered: '已交付',
  completed: '已完成',
  cancelled: '已关闭',
};

// 头像颜色兜底（首字符色块）
function avatarColor(name) {
  const palette = ['#7ECDBB', '#2DB7F5', '#FFA940', '#FE2C55', '#9B7ED8', '#52C41A', '#EB2F96', '#13C2C2'];
  if (!name) return palette[0];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

function pad2(n) { return String(n).padStart(2, '0'); }

function todayInfo() {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const dow = ['周日','周一','周二','周三','周四','周五','周六'][d.getDay()];
  return {
    ymd: `${y}-${pad2(m)}-${pad2(day)}`,
    monthKey: `${y}-${pad2(m)}`,
    big: pad2(day),
    monthName: ['January','February','March','April','May','June','July','August','September','October','November','December'][m - 1],
    weekDay: dow,
  };
}

export default function Todo() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab');
  const [counts, setCounts] = useState({ deposit: 0, waiting: 0, selecting: 0, retouching: 0, delivered: 0 });
  const [activeKey, setActiveKey] = useState(TAB_DEFS.some((t) => t.key === initialTab) ? initialTab : 'waiting');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lunar, setLunar] = useState('');
  const abortRef = useRef(null);
  const tabsScrollRef = useRef(null);
  const tabRefs = useRef({});

  const today = useMemo(() => todayInfo(), []);

  // 拉取计数（轮询 + 事件触发，确保与订单状态进度条实时同步）
  const fetchCounts = useCallback(() => {
    let alive = true;
    return http.get('/api/stats')
      .then((r) => {
        if (!alive) return;
        const d = r.data || {};
        const t = d.todo || {};
        setCounts({
          deposit: Number(t.deposit) || 0,
          waiting: Number(t.waitingShoot) || 0,
          selecting: Number(t.selecting) || 0,
          retouching: Number(t.retouching) || 0,
          delivered: Number(t.toDeliver) || 0,
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchCounts();
    // 8s 轮询（轻量接口，避免移动端耗电）
    const timer = setInterval(fetchCounts, 8000);
    // 监听订单状态变化（OrderDetail stepNext/stepPrev 后触发事件）
    const onChange = () => fetchCounts();
    window.addEventListener('order-status-changed', onChange);
    // App 切回前台时立即刷新
    const onVisibility = () => { if (document.visibilityState === 'visible') fetchCounts(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      window.removeEventListener('order-status-changed', onChange);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchCounts]);

  // 拉取今日农历（按月拉映射表，再取当天 key）
  useEffect(() => {
    let alive = true;
    http.get('/api/schedules/lunar?month=' + today.monthKey)
      .then((r) => {
        if (!alive) return;
        const map = r.data || {};
        setLunar(map[today.ymd] || '');
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [today.monthKey, today.ymd]);

  // 按当前 Tab 拉订单列表
  const loadItems = useCallback(async (key) => {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      const tab = TAB_DEFS.find((t) => t.key === key) || TAB_DEFS[0];
      // statuses 同时覆盖 status 与 payment_status 两种语义（按后端 SQL 映射）
      const params = new URLSearchParams();
      params.set('statuses', tab.value);
      params.set('page', '1');
      params.set('pageSize', '50');
      const r = await http.get('/api/orders?' + params.toString(), { signal: ctrl.signal });
      setItems(r.data.list || []);
    } catch (e) {
      if (e && e.type !== 'cancel') setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadItems(activeKey); }, [activeKey, loadItems]);

  // 切换 Tab 时，将激活 Tab 滚动到视口中央（让整块色块可见，不被裁切）
  useEffect(() => {
    const el = tabRefs.current[activeKey];
    const scroller = tabsScrollRef.current;
    if (!el || !scroller) return;
    // 等待布局（list 加载或首次渲染）
    const id = requestAnimationFrame(() => {
      const elRect = el.getBoundingClientRect();
      const scRect = scroller.getBoundingClientRect();
      const elCenter = elRect.left + elRect.width / 2;
      const scCenter = scRect.left + scRect.width / 2;
      const delta = elCenter - scCenter;
      scroller.scrollBy({ left: delta, behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(id);
  }, [activeKey]);

  return (
    <div style={{ minHeight: '100vh', background: '#F7F7F7', display: 'flex', flexDirection: 'column', width: '100%', maxWidth: 720, margin: '0 auto', boxShadow: '0 0 30px rgba(0,0,0,0.04)' }}>
      {/* 顶部标题栏（深色背景 + 返回 + 标题） */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 20,
        background: '#1f1f1f', color: '#fff',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        display: 'flex', alignItems: 'center', height: 44, padding: '0 12px'
      }}>
        <button
          onClick={() => nav(-1)}
          aria-label="返回"
          style={{ background: 'transparent', border: 0, padding: 6, marginRight: 4, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 16, fontWeight: 500, marginRight: 28 }}>待办事项</div>
      </div>

      {/* 日期卡片（公历 + 农历 + 周几） */}
      <div style={{
        background: 'linear-gradient(135deg, #2a2a2a 0%, #3a3a3a 100%)',
        color: '#fff', padding: '14px 16px 18px', display: 'flex', alignItems: 'center', gap: 14
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 36, fontWeight: 600, lineHeight: 1, letterSpacing: -1 }}>{today.big}</span>
          <span style={{ fontSize: 13, color: '#cfcfcf' }}>{today.monthName}</span>
        </div>
        <div style={{ width: 1, height: 30, background: 'rgba(255,255,255,0.18)' }} />
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: 13, color: '#cfcfcf', lineHeight: 1.6 }}>
          <span>{lunar || '加载中…'}</span>
          <span>{today.weekDay}</span>
        </div>
      </div>

      {/* 横向滚动分类 Tab（每个 Tab 顶部色条；选中态青绿底白字 + 上方更粗色条） */}
      <div style={{ background: '#fff', borderBottom: '1px solid ' + LINE }}>
        <div
          ref={tabsScrollRef}
          style={{
            display: 'flex', overflowX: 'auto', WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none', msOverflowStyle: 'none'
          }}
          className="todo-tabs-scroll"
        >
          {TAB_DEFS.map((t) => {
            const isActive = activeKey === t.key;
            return (
              <button
                key={t.key}
                ref={(el) => { tabRefs.current[t.key] = el; }}
                type="button"
                onClick={() => setActiveKey(t.key)}
                style={{
                  flex: '0 0 auto', minWidth: 86,
                  padding: '12px 6px 10px', margin: 0, border: 0, background: 'transparent',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                  position: 'relative', cursor: 'pointer', color: isActive ? '#fff' : TEXT
                }}
              >
                <span style={{
                  fontSize: 18, fontWeight: 600, lineHeight: 1
                }}>{counts[t.key] || 0}</span>
                <span style={{ fontSize: 12, opacity: isActive ? 0.9 : 0.7 }}>{t.label}</span>
                {/* 选中态：青绿底色块（覆盖整列） */}
                {isActive && (
                  <span style={{
                    position: 'absolute', inset: 0,
                    background: GREEN, borderRadius: 0,
                    zIndex: -1
                  }} />
                )}
                {/* 非选中态：底部 3px 色条 */}
                {!isActive && (
                  <span style={{
                    position: 'absolute', left: '20%', right: '20%', bottom: 0,
                    height: 3, background: t.accent, borderRadius: 2
                  }} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 订单列表 */}
      <div style={{ flex: 1, padding: '8px 12px 24px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: MUTED, padding: '40px 0', fontSize: 13 }}>加载中…</div>
        ) : items.length === 0 ? (
          <div style={{ textAlign: 'center', color: MUTED, padding: '40px 0', fontSize: 13 }}>暂无待办</div>
        ) : (
          <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden' }}>
            {items.map((o, idx) => {
              const name = (o.customer_name || o.name || '客户').toString();
              const first = name.slice(0, 1);
              const statusKey = o.status || '';
              // deposit 状态细分：logs 含「沟通确认」=「等待拍摄」（已和客户敲定拍摄细节），否则 =「已付定金」（仅定金到账、尚未沟通）
              // 与后端 stats / orders 的 waiting_shoot 分界一致，消除卡片显示与 Tab 名错位
              let statusText;
              if (statusKey === 'deposit') {
                let logsArr = [];
                try { logsArr = Array.isArray(o.logs) ? o.logs : (typeof o.logs === 'string' ? JSON.parse(o.logs || '[]') : []); } catch {}
                const hasConfirm = logsArr.some((l) => (l && l.text || '').includes('沟通确认'));
                statusText = hasConfirm ? '等待拍摄' : '已付定金';
              } else {
                statusText = STATUS_LABEL[statusKey] || (o.payment_status === 'unpaid' ? '未付定金' : '等待拍摄');
              }
              const dateStr = o.shoot_date || o.order_date || '';
              const timeStr = (o.time_slots && o.time_slots[0]) || '';
              const dt = (dateStr || '') + (timeStr ? ' ' + timeStr : '');
              return (
                <button
                  key={o.id || idx}
                  type="button"
                  onClick={() => nav('/orders/' + o.id)}
                  style={{
                    width: '100%', textAlign: 'left', background: '#fff', border: 0, padding: '14px 14px',
                    display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
                    borderBottom: idx === items.length - 1 ? 'none' : '1px solid ' + LINE
                  }}
                >
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: avatarColor(name), color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 500, flexShrink: 0
                  }}>{first}</div>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ fontSize: 14, color: TEXT, fontWeight: 500 }}>{name}</div>
                    <div style={{ fontSize: 12, color: MUTED }}>{statusText}</div>
                  </div>
                  <div style={{ fontSize: 12, color: MUTED, whiteSpace: 'nowrap', flexShrink: 0, textAlign: 'right' }}>
                    {(dateStr || '').replace(/-/g, '.')}<br/>
                    {timeStr}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 隐藏滚动条（仅作用于横向 Tab 容器） */}
      <style>{`.todo-tabs-scroll::-webkit-scrollbar{ display:none; }`}</style>
    </div>
  );
}