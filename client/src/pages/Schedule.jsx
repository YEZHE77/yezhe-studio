import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import http from '../api.js';
import { useViewState } from '../tabMemory.js';
import OrderCreateModal from '../components/OrderCreateModal.jsx';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const WEEK_FULL = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + ':00');
const HALF = 'half';
const FULL = 'full';
const OPEN_DAYS_LABEL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const SSTATUS = { free: '空闲', booked: '已约', locked: '锁场', closed: '已关闭', shoot: '等待拍摄', pending: '待确认' };

// 弹窗/次级控件沿用色号（主内容区色板见下方 G_* 常量）
const BLUE = '#2196F3';             // 编辑档期/预约设置等旧弹窗的链接蓝
const ADV_BG = '#333333';           // 高级选项按钮（PicBling 实测 #333）

/* ===================== 档期页主内容区（需求 G）色板 =====================
   浅灰底 #F7F7F7 ／ 边框 #E8E8E8 ／ 深灰侧栏 #3A3A3A ／ 日期黄块 #FFB900
   主蓝 #2DB7F5 ／ 选中浅蓝 #EAF6FD ／ 已预约粉 #FFD3D3 ／ 今日红 #FF7777
   注：左侧全局导航不在本页范围内，禁止改动。                                */
const G_PAGE_BG = '#F8F8F8';
const G_BORDER = '#D8D8D8';
const G_PANEL = '#444444';
const G_YELLOW = '#FFBB01';
const G_BLUE = '#2DB7F5';
const G_SEL = '#EAF6FD';
const G_BOOKED = '#FF949C';
const G_TODAY = '#FF7777';

// 8 色订单状态（顶部图例 + hover 说明气泡 + 单元格状态点，色号与订单中心阶段机一一对应）
const G_STATUS = [
  { key: 'unpaid', label: '未付定金', color: '#FFF2B3', desc: '订单已建立、定金未到账，需尽快催缴' },
  { key: 'deposit', label: '等待拍摄', color: '#B7E8BC', desc: '定金已收，档期已锁定，等待拍摄当天' },
  { key: 'shot', label: '已拍摄', color: '#BFE3FF', desc: '拍摄已完成，等待客户进入选片环节' },
  { key: 'selecting', label: '选片中', color: '#D8CBF7', desc: '客户正在在线选片，注意选片超时提醒' },
  { key: 'retouching', label: '精修中', color: '#FFD8A8', desc: '选片已确认，修图师正在精修出片' },
  { key: 'delivered', label: '已交付', color: '#BEEDE6', desc: '成片已交付客户，等待尾款结清/确认' },
  { key: 'completed', label: '已完成', color: '#D9D9D9', desc: '全流程结束、尾款已结清，订单归档' },
  { key: 'cancelled', label: '已作废', color: '#FFC2C8', desc: '订单已作废或退单，档期同步释放' }
];
const G_STATUS_MAP = G_STATUS.reduce((o, s) => { o[s.key] = s; return o; }, {});

// 档期行 → 8 色状态 key（首阶段 deposit 且未付定金时展示为「未付定金」，与订单中心一致）
function statusKeyOf(r) {
  if (!r || !r.order_no) return null;
  if (r.order_status === 'deposit' && r.order_pay_status === 'unpaid') return 'unpaid';
  return G_STATUS_MAP[r.order_status] ? r.order_status : 'deposit';
}

// 档期行携带的顾客电话：优先取 JSON 数组 order_phones，回退 order_phone 单值（字段见后端 #583 扩展）
function orderPhones(r) {
  if (!r) return '';
  try {
    const a = r.order_phones ? JSON.parse(r.order_phones) : null;
    if (Array.isArray(a) && a.length) return a.filter(Boolean).join(' / ');
  } catch (e) { /* ignore */ }
  return r.order_phone || '';
}

const pad = (n) => String(n).padStart(2, '0');

const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// 档期开关判定（业务规则，三元 → 三态渲染）：
//  - 有预约订单(order_no 存在) → 自动标记 booked（粉红 #FFD6D6，仍显示 +添加）
//  - 手动关闭(status==='closed' 且无订单) → 斜纹关闭，隐藏 +添加
//  - 其余 → 空闲白底 + 添加
// 优先级：手动关闭(无订单) > 有预约订单 > 空闲（同天不会同时出现）
function dayState(rows, pends) {
  const orderRows = rows.filter((r) => r.order_no);
  const hasBooked = orderRows.length > 0 || (pends && pends.length > 0);
  const manualClosed = rows.some((r) => r.status === 'closed' && !r.order_no);
  let kind = 'free';
  if (hasBooked) kind = 'booked';
  else if (manualClosed) kind = 'closed';
  return { orderRows, hasBooked, manualClosed, kind };
}


export default function Schedule() {
  const nav = useNavigate();
  const location = useLocation();
  const init = new Date();
  const initMonth = `${init.getFullYear()}-${pad(init.getMonth() + 1)}`;
  const [state, setState] = useViewState('schedule', { month: initMonth, executor: '', package_id: '', status: '', view: 'month' });
  const [map, setMap] = useState({});
  const [pendMap, setPendMap] = useState({});
  const [personnel, setPersonnel] = useState([]);
  const [pkgList, setPkgList] = useState([]);
  const [lunarMap, setLunarMap] = useState({});
  const [showLunar, setShowLunar] = useState(false);
  const [selDate, setSelDate] = useState(`${init.getFullYear()}-${pad(init.getMonth() + 1)}-${pad(init.getDate())}`);
  const [isMobileView, setIsMobileView] = useState(() => (window.innerWidth || 1200) < 768);
  const [err, setErr] = useState('');
  const [advOpen, setAdvOpen] = useState(false);
  const [accOpen, setAccOpen] = useState(false);
  const [dlg, setDlg] = useState(null);
  const [booking, setBooking] = useState(null);
  const [share, setShare] = useState(null);
  // 手机端订单卡底部操作面板（选中档期行）
  const [orderSheet, setOrderSheet] = useState(null);
  // 电脑端「新建订单」弹窗（替代跳 /schedule/new 全屏路由）：存日期，未传表示弹窗关闭
  const [newOrderDlg, setNewOrderDlg] = useState(null);
  // 日历单元格 Tooltip 悬浮气泡（spec：200ms 延迟显示 / 300ms 淡出 / 边缘箭头翻转）
  // hoverTooltip: { date, rect, visible } —— visible=false 时仍渲染但 opacity=0（淡出动画）
  const [hoverTooltip, setHoverTooltip] = useState(null);
  const hoverTimerRef = useRef(null);
  const fadeTimerRef = useRef(null);
  const advRef = useRef(null);
  const accRef = useRef(null);

  const [y, m] = state.month.split('-').map(Number);
  const monthStr = state.month;
  const todayStr = ymd(init);

  const load = () => {
    const params = new URLSearchParams();
    params.set('month', state.month);
    if (state.executor) params.set('executor', state.executor);
    if (state.package_id) params.set('package_id', state.package_id);
    if (state.status && state.status !== 'all') params.set('status', state.status);
    http.get('/api/schedules?' + params.toString()).then((r) => {
      const nm = {};
      for (const s of (r.data || [])) { (nm[s.date] = nm[s.date] || []).push(s); }
      setMap(nm);
    }).catch(() => {});
    http.get('/api/admin/appointments?status=pending').then((r) => {
      const pm = {};
      for (const a of (r.data || [])) if (a.hope_date) { (pm[a.hope_date] = pm[a.hope_date] || []).push(a); }
      setPendMap(pm);
    }).catch(() => {});
  };
  useEffect(load, [state.month, state.executor, state.package_id, state.status]);
  useEffect(() => {
    http.get('/api/admin/personnel').then((r) => setPersonnel(r.data || [])).catch(() => {});
  }, []);
  useEffect(() => {
    http.get('/api/packages?status=all').then((r) => setPkgList(r.data || [])).catch(() => {});
  }, []);
  useEffect(() => {
    http.get('/api/schedules/lunar?month=' + encodeURIComponent(state.month)).then((r) => setLunarMap(r.data || {})).catch(() => {});
  }, [state.month]);
  useEffect(() => {
    const onResize = () => setIsMobileView((window.innerWidth || 1200) < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => {
    const onDown = (e) => { if (advRef.current && !advRef.current.contains(e.target)) setAdvOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);
  useEffect(() => {
    const onDown = (e) => { if (accRef.current && !accRef.current.contains(e.target)) setAccOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // 切换月份 / 打开弹窗时关闭 tooltip
  useEffect(() => {
    clearTimeout(hoverTimerRef.current);
    clearTimeout(fadeTimerRef.current);
    setHoverTooltip(null);
  }, [state.month, dlg, booking, share]);

  // Tooltip 淡出结束（visible=false 持续）后从 DOM 移除
  useEffect(() => {
    if (!hoverTooltip || hoverTooltip.visible) return;
    const t = setTimeout(() => setHoverTooltip(null), 350);
    return () => clearTimeout(t);
  }, [hoverTooltip]);

  // 组件卸载：清理所有 timer
  useEffect(() => {
    return () => {
      clearTimeout(hoverTimerRef.current);
      clearTimeout(fadeTimerRef.current);
    };
  }, []);

  // 从其他页面跳转过来要求打开新建订单（电脑端弹窗 / 移动端跳转独立页）
  useEffect(() => {
    if (location.state?.openNew) {
      const date = selDate || todayStr;
      setErr('');
      // 电脑端：直接打开 OrderCreateModal 弹窗（与「订单中心 + 新建订单」风格一致）；移动端走 /schedule/new 路由（<768）
      if (window.innerWidth >= 768) {
        setNewOrderDlg({ date });
        // 清掉 history state，避免反复触发
        window.history.replaceState({}, '');
      } else {
        nav('/schedule/new', { state: { date } });
      }
      return;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const cells = buildMonth(y, m - 1);
  const view = state.view || 'month';

  const rowsOf = (date) => map[date] || [];
  const pendsOf = (date) => pendMap[date] || [];

  const addDays = (ds, n) => {
    const d = new Date(ds + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return ymd(d);
  };
  const weekDaysOf = (ds) => {
    const d = new Date(ds + 'T00:00:00');
    const mon = addDays(ds, -((d.getDay() + 6) % 7));
    return [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(mon, i));
  };

  const shiftMonth = (delta) => {
    const total = y * 12 + (m - 1) + delta;
    const ny = Math.floor(total / 12);
    const nm = (total % 12) + 1;
    setState((s) => ({ ...s, month: `${ny}-${pad(nm)}` }));
  };
  const setYM = (ny, nm) => setState((s) => ({ ...s, month: `${ny}-${pad(nm)}` }));
  // 视图导航：月=翻月 / 周=±7 天 / 日=±1 天，并同步月份与选中日期
  const gotoDate = (ds) => {
    setSelDate(ds);
    setState((s) => ({ ...s, month: ds.slice(0, 7) }));
  };
  const shiftView = (delta) => {
    if (view === 'week') gotoDate(addDays(selDate || todayStr, delta * 7));
    else if (view === 'day') gotoDate(addDays(selDate || todayStr, delta));
    else shiftMonth(delta);
  };
  const setView = (v) => {
    setState((s) => ({ ...s, view: v }));
    if (v !== 'month' && !selDate) setSelDate(todayStr);
  };

  const openNew = (day) => {
    let date;
    if (typeof day === 'string' && day.includes('-')) date = day;
    else if (day) date = `${y}-${pad(m)}-${pad(day)}`;
    else date = selDate || todayStr;
    setErr('');
    // 电脑端（>=768）：直接打开 OrderCreateModal 弹窗，不再跳路由；移动端（<768）：走 /schedule/new 全屏路由
    if (window.innerWidth >= 768) {
      setNewOrderDlg({ date });
    } else {
      nav('/schedule/new', { state: { date } });
    }
  };
  const openEdit = (row) => {
    setErr('');
    setDlg({
      id: row.id, date: row.date, periods: Array.isArray(row.periods) ? row.periods : [],
      date_tbd: row.date_tbd ? 1 : 0, executor_id: row.executor_id || '', executor_name: row.executor_name || row.photographer || '',
      status: row.status, order_no: row.order_no || '', note: row.note || '', photographer: row.photographer || '',
      groom_name: row.groom_name || '', bride_name: row.bride_name || '', contact_phone: row.contact_phone || '', address: row.address || ''
    });
  };

  const doExport = () => {
    const base = (http.defaults.baseURL || '').replace(/\/+$/, '');
    window.open(base + '/api/admin/schedules/export?month=' + encodeURIComponent(monthStr), '_blank');
    setAdvOpen(false);
  };

  // 一键档期校准：根据有效订单重建占用 + 清理孤儿 booked（修复脏数据）
  const reconcile = async () => {
    if (!window.confirm('一键校准档期？\n\n将根据当前所有有效订单重新刷新日历占用状态，清理已取消订单残留的占用记录。')) return;
    try {
      const r = await http.post('/api/schedules/reconcile');
      const d = r.data || {};
      alert(`校准完成：清理孤儿占用 ${d.removed_orphans} 条，重建档期 ${d.rebuilt} 条（共 ${d.total_orders} 个有效订单）。`);
      load();
    } catch (e) {
      alert('校准失败：' + (e.response?.data?.error || e.message));
    }
  };

  const dayRows = selDate ? rowsOf(selDate) : [];
  const dayPends = selDate ? pendsOf(selDate) : [];
  const selParts = selDate ? selDate.split('-') : [];
  const selClosed = selDate ? (map[selDate] || []).some((r) => r.status === 'closed' && !(r.order_no)) : false;
  const selState = selDate ? dayState(dayRows, dayPends) : null;
  const selCustomerRows = selState && selState.orderRows ? selState.orderRows.filter((r) => (r.order_customer || orderPhones(r))) : [];

  let sideStatus = '';
  if (!selDate) sideStatus = '请选择日期';
  else if (selState.kind === 'closed') sideStatus = '档期已关闭';
  else if (selState.kind === 'booked') sideStatus = `${selState.orderRows.length} 单`;
  else sideStatus = '档期开放，可预约';

  // 日期单元格渲染（月/周/日视图共用；maxRows 控制单格展示订单条数，日视图全部展示）
  const renderDateCell = (date, maxRows = 2, minHeight = 120) => {
    const day = Number(date.slice(8));
    const rows = rowsOf(date);
    const pends = pendsOf(date);
    const st = dayState(rows, pends);
    const lunar = lunarMap[date] || '';
    const selected = selDate === date;
    const isToday = date === todayStr;
    const isClosed = st.kind === 'closed';

    let cellBg = '#FFFFFF';
    if (isClosed) cellBg = 'repeating-linear-gradient(-45deg, rgba(150,150,150,0.22) 0px, rgba(150,150,150,0.22) 1px, transparent 1px, transparent 8px), #F7F7F7';
    else if (st.kind === 'booked') cellBg = '#FF949C';
    else if (selected) cellBg = G_SEL;
    const booked = st.kind === 'booked';

    return (
      <div key={date} onClick={() => setSelDate(date)}
        onMouseEnter={(e) => {
          clearTimeout(hoverTimerRef.current);
          clearTimeout(fadeTimerRef.current);
          hoverTimerRef.current = setTimeout(() => {
            setHoverTooltip({ date, rect: e.currentTarget.getBoundingClientRect(), visible: true });
          }, 200);
        }}
        onMouseLeave={() => {
          clearTimeout(hoverTimerRef.current);
          fadeTimerRef.current = setTimeout(() => {
            setHoverTooltip((prev) => prev ? { ...prev, visible: false } : null);
          }, 300);
        }}
        className={'relative cursor-pointer flex flex-col ' + (!selected && !isClosed ? 'hover:bg-[#FAFCFE]' : '')}
        style={{ minHeight, background: cellBg, padding: 8, boxShadow: selected ? `inset 0 0 0 1px ${G_BLUE}` : 'none' }}>
        <div className="flex items-start justify-between gap-1">
          <div className="flex flex-col" style={{ gap: 2 }}>
            <span className="inline-flex items-center justify-center"
              style={isToday
                ? { width: 24, height: 24, borderRadius: '50%', background: G_YELLOW, color: '#FFFFFF', fontSize: 16, fontWeight: 500 }
                : { fontSize: 16, color: booked ? '#FFFFFF' : (isToday ? G_TODAY : '#333333') }}>{day}</span>
            {lunar && <span style={{ fontSize: 10, color: booked ? 'rgba(255,255,255,0.9)' : '#999999' }}>{lunar}</span>}
          </div>
          {pends.length > 0 && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#F0A020' }} />}
        </div>

        {!isClosed && (
          <div className="mt-1.5 flex flex-col" style={{ gap: 3 }}>
            {st.orderRows.slice(0, maxRows).map((r) => {
              const sk = statusKeyOf(r);
              return (
                <div key={r.id} onClick={(e) => { e.stopPropagation(); if (r.order_id) nav('/orders/' + r.order_id); }}
                  className="flex items-center truncate hover:opacity-85"
                  style={{ background: booked ? 'rgba(255,255,255,0.28)' : G_BOOKED, borderRadius: 2, height: 20, padding: '0 5px', gap: 4 }}>
                  {sk && <span style={{ width: 6, height: 6, borderRadius: '50%', background: G_STATUS_MAP[sk].color }} />}
                  <span className="truncate" style={{ fontSize: 11, color: booked ? '#FFFFFF' : '#5A2730' }}>{r.order_customer || r.executor_name || r.photographer || '已预约'}</span>
                </div>
              );
            })}
            {st.orderRows.length > maxRows && <div style={{ fontSize: 11, color: booked ? '#FFFFFF' : '#888888' }}>+{st.orderRows.length - maxRows} 更多</div>}
          </div>
        )}

        {isClosed ? (
          <div className="mt-auto flex items-end justify-center pt-1">
            <span style={{ fontSize: 12, color: '#999999' }}>档期已关闭</span>
          </div>
        ) : (
          <div className="mt-auto flex items-end justify-between gap-1 pt-1">
            <button onClick={(e) => { e.stopPropagation(); openNew(date); }} className="hover:opacity-80" style={{ color: G_BLUE, fontSize: 12 }}>+ 添加</button>
            {st.orderRows.length > 0 && <span style={{ fontSize: 11, color: booked ? '#FFFFFF' : '#888888' }}>{st.orderRows.length}单</span>}
          </div>
        )}
      </div>
    );
  };

  // ========== 手机端档期视图（工作台「档期」进入）==========
  // ========== 手机端档期视图（工作台「档期」进入）==========
  function MobileView() {
    const cells = buildMonth(y, m - 1);
    const selRows = rowsOf(selDate);
    const selPends = pendsOf(selDate);
    const isCurMonth = state.month === todayStr.slice(0, 7);
    const [mobileMode, setMobileMode] = useState('calendar');
    const [menuOpen, setMenuOpen] = useState(false);
    const [filterOpen, setFilterOpen] = useState(false);
    const menuRef = useRef(null);
    const filterRef = useRef(null);

    useEffect(() => {
      const onDown = (e) => {
        if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
        if (filterRef.current && !filterRef.current.contains(e.target)) setFilterOpen(false);
      };
      document.addEventListener('mousedown', onDown);
      return () => document.removeEventListener('mousedown', onDown);
    }, []);

    const monthLabel = `${['一','二','三','四','五','六','七','八','九','十','十一','十二'][m-1]}月 ${y}`;

    // 列表视图数据：所有有订单的日期
    const listDates = Object.keys(map)
      .filter((d) => map[d].some((r) => r.order_no))
      .sort();
    const listTotalCount = listDates.reduce((sum, d) => sum + map[d].filter((r) => r.order_no).length, 0);
    const listTotalAmount = listDates.reduce((sum, d) => sum + map[d].filter((r) => r.order_no).reduce((s, r) => s + (parseFloat(r.order_price) || 0), 0), 0);

    const mobileCell = (date) => {
      const day = Number(date.slice(8));
      const rows = rowsOf(date);
      const pends = pendsOf(date);
      const st = dayState(rows, pends);
      const selected = selDate === date;
      const isToday = date === todayStr;
      const isClosed = st.kind === 'closed';
      const hasOrder = st.orderRows.length > 0;
      const lunar = lunarMap[date] || '';

      let bg = '#FFFFFF';
      if (isClosed) bg = 'repeating-linear-gradient(-45deg, rgba(150,150,150,0.22) 0px, rgba(150,150,150,0.22) 1px, transparent 1px, transparent 8px), #F7F7F7';
      else if (st.kind === 'booked') bg = '#FFF0F0';
      else if (selected) bg = G_SEL;

      return (
        <button
          key={date}
          type="button"
          onClick={() => setSelDate(date)}
          style={{
            aspectRatio: '1 / 1',
            background: bg,
            border: 'none',
            padding: 4,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
            position: 'relative',
            boxShadow: selected ? `inset 0 0 0 2px ${G_BLUE}` : 'inset 0 0 0 1px #EFEFEF'
          }}
        >
          <span style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            fontWeight: isToday ? 600 : 400,
            background: isToday ? G_TODAY : 'transparent',
            color: isToday ? '#fff' : (isClosed ? '#999' : '#333')
          }}>{day}</span>
          {showLunar && lunar && (
            <span style={{ fontSize: 10, color: '#999', lineHeight: 1, whiteSpace: 'nowrap' }}>{lunar}</span>
          )}
          {hasOrder && (
            <span style={{
              position: 'absolute',
              top: 4,
              right: 4,
              fontSize: 10,
              color: '#fff',
              background: '#FF4D4F',
              borderRadius: 4,
              padding: '1px 4px',
              lineHeight: 1
            }}>{st.orderRows.length}单</span>
          )}
        </button>
      );
    };

    const EmptyState = () => (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 0', color: '#BBBBBB' }}>
        <svg width="80" height="80" viewBox="0 0 80 80" fill="none" style={{ marginBottom: 12 }}>
          <rect x="24" y="20" width="32" height="40" rx="4" fill="#F0F0F0" stroke="#D8D8D8" strokeWidth="1.5"/>
          <line x1="30" y1="32" x2="50" y2="32" stroke="#D8D8D8" strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="30" y1="40" x2="46" y2="40" stroke="#D8D8D8" strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="30" y1="48" x2="42" y2="48" stroke="#D8D8D8" strokeWidth="1.5" strokeLinecap="round"/>
          <circle cx="18" cy="28" r="5" fill="#F5F5F5" stroke="#E0E0E0" strokeWidth="1"/>
          <circle cx="62" cy="50" r="6" fill="#F5F5F5" stroke="#E0E0E0" strokeWidth="1"/>
          <circle cx="14" cy="52" r="3" fill="#F5F5F5" stroke="#E0E0E0" strokeWidth="1"/>
        </svg>
        <div style={{ fontSize: 14 }}>档期已关闭</div>
      </div>
    );

    const DateDetailHeader = () => {
      const d = new Date(selDate + 'T00:00:00');
      const week = WEEK_FULL[d.getDay()];
      const lunar = lunarMap[selDate] || '';
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: '#fff' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 500, color: '#1f2329' }}>{selDate.replace(/-/g, '.')}</div>
            <div style={{ fontSize: 12, color: '#999', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>{week}</span>
              {showLunar && lunar && <span>&lt;农历 {lunar}&gt;</span>}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button type="button" onClick={() => openNew(selDate)} style={{ background: 'none', border: 'none', padding: 4 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
            </button>
            <button type="button" onClick={() => setBooking({ open: true, openDays: [0,1,2,3,4,5,6] })} style={{ background: 'none', border: 'none', padding: 4 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
          </div>
        </div>
      );
    };

    const MobileMenu = () => (
      <div ref={menuRef} className="absolute right-0 mt-2 bg-white rounded-lg" style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.12)', minWidth: 160, zIndex: 50 }}>
        <button onClick={() => { setMenuOpen(false); openNew(); }} className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-gray-50" style={{ fontSize: 14, color: '#333' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
          添加档期
        </button>
        <button onClick={() => { setMenuOpen(false); setBooking({ open: true, openDays: [0,1,2,3,4,5,6] }); }} className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-gray-50" style={{ fontSize: 14, color: '#333', borderTop: '1px solid #F2F2F2' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          预约设置
        </button>
        <button onClick={() => { setMenuOpen(false); reconcile(); }} className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-gray-50" style={{ fontSize: 14, color: '#333', borderTop: '1px solid #F2F2F2' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-9-9"/><path d="M21 3v6h-6"/></svg>
          校准档期
        </button>
      </div>
    );

    const ListItem = ({ r }) => {
      const sk = statusKeyOf(r);
      const payMap = { unpaid: '未付款', deposit: '已付定金', paid: '已付全款' };
      const payLabel = payMap[r.order_pay_status] || '';
      // 优先显示订单 time_slots 第一个具体时间（"00:00" 这种），回退到 period（"全天/半天"）
      let slots = [];
      try { slots = Array.isArray(r.order_time_slots) ? r.order_time_slots : (typeof r.order_time_slots === 'string' ? JSON.parse(r.order_time_slots || '[]') : []); } catch {}
      const timeText = (slots && slots[0]) || (r.period === 'half' ? '半天' : (r.period === 'full' ? '全天' : (r.period || '全天')));
      return (
        <div onClick={() => { if (r.order_id) nav('/orders/' + r.order_id); }} className="hover:bg-gray-50"
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#fff', cursor: 'pointer' }}>
          <div style={{ fontSize: 14, color: '#666', minWidth: 40, textAlign: 'right', paddingTop: 2 }}>{timeText}</div>
          <div style={{ width: 2, flexShrink: 0, alignSelf: 'stretch', background: '#52C41A', borderRadius: 1 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 500, color: '#1f2329' }}>{r.order_customer || '未知客户'}</div>
            <div style={{ fontSize: 12, color: '#999', marginTop: 4, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
              <span>{r.order_package || r.executor_name || '未分配'}</span>
              <span>|</span>
              <span>¥{r.order_price ?? '—'}</span>
              {payLabel && (
                <span style={{ fontSize: 11, color: '#52C41A', background: '#F6FFED', border: '1px solid #B7EB8F', borderRadius: 4, padding: '1px 6px' }}>
                  {payLabel}
                </span>
              )}
            </div>
          </div>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#CCC" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
        </div>
      );
    };

    const statusDot = (key) => (
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: G_STATUS_MAP[key]?.color || '#ccc', flexShrink: 0 }} />
    );

    return (
      <div style={{ minHeight: '100%', background: '#F8F8F8', paddingBottom: 40 }}>
        {/* 顶部栏 */}
        <div style={{ position: 'sticky', top: 0, zIndex: 20, background: '#fff', borderBottom: '1px solid #EFEFEF' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px' }}>
            <button type="button" onClick={() => nav('/')} style={{ display: 'flex', alignItems: 'center', background: 'none', border: 'none', padding: 4, color: '#333' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            {/* 药丸 Tab */}
            <div style={{ display: 'flex', alignItems: 'center', background: '#F2F2F2', borderRadius: 16, padding: 3, gap: 2 }}>
              <button type="button" onClick={() => setMobileMode('calendar')}
                style={{
                  padding: '5px 18px', borderRadius: 14, border: 'none', fontSize: 14,
                  background: mobileMode === 'calendar' ? '#fff' : 'transparent',
                  color: mobileMode === 'calendar' ? '#1f2329' : '#999',
                  fontWeight: mobileMode === 'calendar' ? 500 : 400,
                  boxShadow: mobileMode === 'calendar' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none'
                }}>日历</button>
              <button type="button" onClick={() => setMobileMode('list')}
                style={{
                  padding: '5px 18px', borderRadius: 14, border: 'none', fontSize: 14,
                  background: mobileMode === 'list' ? '#fff' : 'transparent',
                  color: mobileMode === 'list' ? '#1f2329' : '#999',
                  fontWeight: mobileMode === 'list' ? 500 : 400,
                  boxShadow: mobileMode === 'list' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none'
                }}>列表</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button type="button" onClick={() => setFilterOpen((v) => !v)} style={{ background: 'none', border: 'none', padding: 4 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
              </button>
              <div className="relative">
                <button type="button" onClick={() => setMenuOpen((v) => !v)} style={{ background: 'none', border: 'none', padding: 4 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
                </button>
                {menuOpen && <MobileMenu />}
              </div>
            </div>
          </div>
          {filterOpen && (
            <div ref={filterRef} style={{ padding: '8px 12px 12px', borderTop: '1px solid #F5F5F5', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <select value={state.executor} onChange={(e) => setState((s) => ({ ...s, executor: e.target.value }))} style={{ height: 34, borderRadius: 6, border: '1px solid #E5E5E5', padding: '0 8px', fontSize: 13, color: '#333', background: '#fff' }}>
                <option value="">全部摄影师</option>
                {personnel.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select value={state.package_id} onChange={(e) => setState((s) => ({ ...s, package_id: e.target.value }))} style={{ height: 34, borderRadius: 6, border: '1px solid #E5E5E5', padding: '0 8px', fontSize: 13, color: '#333', background: '#fff' }}>
                <option value="">全部套系</option>
                {pkgList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select value={state.status} onChange={(e) => setState((s) => ({ ...s, status: e.target.value }))} style={{ height: 34, borderRadius: 6, border: '1px solid #E5E5E5', padding: '0 8px', fontSize: 13, color: '#333', background: '#fff' }}>
                <option value="">全部状态</option>
                <option value="unpaid">未付定金</option>
                <option value="deposit">等待拍摄</option>
                <option value="shot">已拍摄</option>
                <option value="selecting">选片中</option>
                <option value="retouching">精修中</option>
                <option value="delivered">已交付</option>
                <option value="completed">已完成</option>
                <option value="cancelled">已作废</option>
              </select>
            </div>
          )}
        </div>

        {mobileMode === 'calendar' && (
          <>
            {/* 月份导航 + 星期表头 */}
            <div style={{ position: 'sticky', top: 54, zIndex: 15, background: '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button type="button" onClick={() => shiftMonth(-1)} style={{ background: 'none', border: 'none', padding: 2, color: '#666' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
                  </button>
                  <div style={{ fontSize: 17, fontWeight: 500, color: '#1f2329' }}>{monthLabel}</div>
                  <button type="button" onClick={() => shiftMonth(1)} style={{ background: 'none', border: 'none', padding: 2, color: '#666' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
                  </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button type="button" onClick={() => setShowLunar((v) => !v)} style={{ fontSize: 12, color: showLunar ? G_BLUE : '#666', background: showLunar ? '#EAF6FD' : '#F5F5F5', border: 'none', borderRadius: 4, padding: '3px 8px' }}>农</button>
                  <button type="button" onClick={() => gotoDate(todayStr)} style={{ fontSize: 12, color: '#666', background: '#F5F5F5', border: 'none', borderRadius: 4, padding: '3px 8px' }}>今</button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', padding: '6px 0', borderTop: '1px solid #F5F5F5' }}>
                {WEEK.map((w) => (
                  <div key={w} style={{ textAlign: 'center', fontSize: 13, color: '#666' }}>{w}</div>
                ))}
              </div>
            </div>

            {/* 月历 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, background: '#EFEFEF', padding: 1 }}>
              {cells.map((day, i) => (
                day == null
                  ? <div key={i} style={{ aspectRatio: '1 / 1', background: '#FAFAFA' }} />
                  : mobileCell(`${y}-${pad(m)}-${pad(day)}`)
              ))}
            </div>

            {/* 选中日期详情 */}
            <div style={{ marginTop: 8, background: '#fff' }}>
              <DateDetailHeader />
              {selPends.length > 0 && (
                <div style={{ padding: '0 16px 12px' }}>
                  <div style={{ fontSize: 12, color: '#F0A020', marginBottom: 6, fontWeight: 500 }}>待确认预约 {selPends.length} 条</div>
                  {selPends.map((a) => (
                    <button key={a.id} type="button" onClick={() => nav('/appointments')}
                      style={{ width: '100%', textAlign: 'left', background: '#fff', borderRadius: 10, padding: '12px 14px', marginBottom: 8, border: '1px solid #FFE9C7' }}>
                      <div style={{ fontSize: 14, color: '#1f2329' }}>{a.name || a.customer_name || '未知客户'}</div>
                      <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>{a.hope_time || '时间待定'} · {a.package_name || '未选套系'}</div>
                      <div className="flex items-center justify-between" style={{ marginTop: 8 }}>
                        <span style={{ fontSize: 12, color: '#F0A020' }}>待确认</span>
                        <span style={{ fontSize: 12, color: G_BLUE }}>去处理 ›</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {selRows.filter((r) => r.order_no).length === 0 && selPends.length === 0 && <EmptyState />}
              <div style={{ padding: '0 16px 16px' }}>
                {selRows.filter((r) => r.order_no).map((r) => {
                  const sk = statusKeyOf(r);
                  const label = G_STATUS_MAP[sk]?.label || '等待拍摄';
                  return (
                    <button key={r.id} type="button" onClick={() => setOrderSheet(r)}
                      style={{ width: '100%', background: '#fff', borderRadius: 12, padding: '14px 16px 10px', marginBottom: 10, border: '1px solid #F2F2F2', textAlign: 'left' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ fontSize: 15, fontWeight: 500, color: '#1f2329' }}>{r.order_customer || '未知客户'}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#666' }}>
                          {statusDot(sk)}{label}
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: '#999', marginTop: 8 }}>{r.period || '全天'} · {r.executor_name || r.photographer || '未分配'}</div>
                      {r.note && <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>备注：{r.note}</div>}
                      <div className="flex items-center justify-between" style={{ borderTop: '1px solid #F2F2F2', marginTop: 10, paddingTop: 8 }}>
                        <span style={{ fontSize: 11, color: '#BBB' }}>{r.order_no}</span>
                        <span style={{ fontSize: 12, color: G_BLUE }}>查看详情 ›</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {mobileMode === 'list' && (
          <div style={{ background: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px' }}>
              <div style={{ fontSize: 18, fontWeight: 600, color: '#1f2329' }}>{m}月</div>
              <div style={{ fontSize: 12, color: '#999' }}>共计 {listTotalCount} 单  金额：{listTotalAmount.toFixed(2)}元</div>
            </div>
            {listDates.length === 0 && (
              <div style={{ textAlign: 'center', color: '#BBBBBB', fontSize: 14, padding: '60px 0' }}>本月暂无订单</div>
            )}
            {listDates.map((date) => {
              const dayRows = rowsOf(date).filter((r) => r.order_no);
              const d = new Date(date + 'T00:00:00');
              const week = WEEK_FULL[d.getDay()];
              const lunar = lunarMap[date] || '';
              return (
                <div key={date}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: '#F8F8F8' }}>
                    <div style={{ fontSize: 13, color: '#666' }}>{date} {week.slice(2)}</div>
                    {showLunar && lunar && <div style={{ fontSize: 11, color: '#bbb' }}>农历 {lunar}</div>}
                  </div>
                  {dayRows.map((r) => <ListItem key={r.id} r={r} />)}
                </div>
              );
            })}
          </div>
        )}

        {/* 弹窗挂载 */}
        {dlg && <ScheduleDialog dlg={dlg} personnel={personnel} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); load(); }} />}
        {booking && <BookingDialog onClose={() => setBooking(null)} />}
        {orderSheet && <OrderSheet row={orderSheet} onClose={() => setOrderSheet(null)} />}
      </div>
    );
  }

  if (isMobileView) return <MobileView />;

  return (
    <div className="w-full min-h-screen flex items-stretch overflow-x-auto" style={{ background: G_PAGE_BG }}>
      {/* 白色日历大卡 */}
      <div className="bg-white shrink-0" style={{ border: `1px solid ${G_BORDER}`, borderRadius: 6, width: 890, minHeight: 'calc(100vh - 44px)' }}>
        {/* 模块 B：顶部操作栏 */}
        <div className="flex items-center justify-between relative" style={{ padding: '14px 16px', borderBottom: `1px solid ${G_BORDER}` }}>
          {/* 状态图例下拉 */}
          <StatusLegend />

          {/* 日期导航（居中，参考图：仅年份/月份下拉 + 前后翻月） */}
          <div className="flex items-center" style={{ gap: 8, position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>
            <button onClick={() => shiftView(-1)} style={{ width: 28, height: 28, border: `1px solid ${G_BORDER}`, borderRadius: 4, color: '#888888', background: '#FFFFFF', fontSize: 16 }}>‹</button>
            {view === 'month' ? (
              <>
                <select value={y} onChange={(e) => setYM(Number(e.target.value), m)} style={{ height: 28, border: `1px solid ${G_BORDER}`, borderRadius: 4, padding: '0 8px', fontSize: 13, color: '#333333', background: '#FFFFFF', outline: 'none' }}>
                  {Array.from({ length: 21 }, (_, i) => y - 10 + i).map((yy) => <option key={yy} value={yy}>{yy}年</option>)}
                </select>
                <select value={m} onChange={(e) => setYM(y, Number(e.target.value))} style={{ height: 28, border: `1px solid ${G_BORDER}`, borderRadius: 4, padding: '0 8px', fontSize: 13, color: '#333333', background: '#FFFFFF', outline: 'none' }}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((mm) => <option key={mm} value={mm}>{mm}月</option>)}
                </select>
              </>
            ) : (
              <div style={{ fontSize: 13, color: '#333333', minWidth: 150, textAlign: 'center' }}>
                {view === 'week'
                  ? (() => { const wds = weekDaysOf(selDate || todayStr); return `${wds[0].slice(5)} ~ ${wds[6].slice(5)}`; })()
                  : (selDate || todayStr)}
              </div>
            )}
            <button onClick={() => shiftView(1)} style={{ width: 28, height: 28, border: `1px solid ${G_BORDER}`, borderRadius: 4, color: '#888888', background: '#FFFFFF', fontSize: 16 }}>›</button>
          </div>

          {/* 右侧按钮组 */}
          <div className="flex items-center" style={{ gap: 10 }}>
            <div className="relative" ref={accRef}>
              <button onClick={() => setAccOpen((v) => !v)} className="flex items-center" style={{ gap: 6, height: 28, padding: '0 12px', border: `1px solid ${G_BORDER}`, borderRadius: 4, background: '#FFFFFF', fontSize: 12, fontWeight: 500, color: '#666666' }}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h12M3 18h6" /></svg>
                筛选账号
              </button>
              {accOpen && (
                <div className="absolute right-0 mt-1 w-44 bg-white rounded z-30 overflow-hidden" style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.12)' }}>
                  <button onClick={() => { setState((s) => ({ ...s, executor: '' })); setAccOpen(false); }} className="w-full text-left px-4 text-sm hover:bg-[#F3F4F6]" style={{ height: 34, color: state.executor === '' ? G_BLUE : '#333333' }}>全部账号</button>
                  {personnel.map((p) => (
                    <button key={p.id} onClick={() => { setState((s) => ({ ...s, executor: String(p.id) })); setAccOpen(false); }} className="w-full text-left px-4 text-sm hover:bg-[#F3F4F6]" style={{ height: 34, color: state.executor === String(p.id) ? G_BLUE : '#333333' }}>{p.name}</button>
                  ))}
                </div>
              )}
            </div>

            <div className="relative" ref={advRef}>
              <button onClick={() => setAdvOpen((v) => !v)} className="flex items-center" style={{ gap: 6, height: 28, padding: '0 12px', borderRadius: 2, border: `1px solid ${ADV_BG}`, background: ADV_BG, fontSize: 12, fontWeight: 500, color: '#FFFFFF' }}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
                高级选项
              </button>
              {advOpen && (
                <div className="absolute right-0 mt-1 w-44 bg-white rounded z-30 overflow-hidden" style={{ boxShadow: '0 2px 14px rgba(0,0,0,0.14)', minWidth: 180 }}>
                  <button onClick={() => { setAdvOpen(false); setBooking({ open: true, openDays: [0, 1, 2, 3, 4, 5, 6] }); }} className="w-full text-left px-4 text-sm hover:bg-[#F3F4F6] flex items-center gap-2" style={{ height: 34, color: '#333333' }}>档期及预约设置</button>
                  <button onClick={async () => { setAdvOpen(false); try { const r = await http.post('/api/schedules/share'); setShare(r.data); } catch (e) { setErr((e.response && e.response.data && e.response.data.error) || '生成分享失败'); } }} className="w-full text-left px-4 text-sm hover:bg-[#F3F4F6] flex items-center gap-2" style={{ height: 34, color: '#333333' }}>分享档期 <span className="ml-1 text-[10px] text-white px-1" style={{ background: BLUE }}>NEW</span></button>
                  <button onClick={doExport} className="w-full text-left px-4 text-sm hover:bg-[#F3F4F6]" style={{ height: 34, color: '#333333' }}>导出 excel</button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 模块 C：档期日历（月 / 周 / 日视图） */}
        <div className="flex" style={{ minHeight: 620 }}>
          <div className="flex-1 flex flex-col">
            {/* 星期表头 */}
            <div className="grid grid-cols-7">
              {WEEK.map((w) => (
                <div key={w} className="text-center" style={{ fontSize: 12, color: '#3D3D3D', height: 36, lineHeight: '36px', borderBottom: `1px solid ${G_BORDER}` }}>{w}</div>
              ))}
            </div>

            {view === 'month' && (
              <div className="grid grid-cols-7 flex-1" style={{ gap: 1, background: G_BORDER, gridAutoRows: 'minmax(120px, 1fr)' }}>
                {cells.map((day, i) => (
                  day == null
                    ? <div key={i} style={{ minHeight: 120, background: '#FAFAFA' }} />
                    : renderDateCell(`${y}-${pad(m)}-${pad(day)}`, 2, 120)
                ))}
              </div>
            )}

            {view === 'week' && (
              <div className="grid grid-cols-7 flex-1" style={{ gap: 1, background: G_BORDER, gridAutoRows: 'minmax(160px, 1fr)' }}>
                {weekDaysOf(selDate || todayStr).map((date) => renderDateCell(date, 2, 160))}
              </div>
            )}

            {view === 'day' && (
              <div className="flex-1 p-2" style={{ gap: 1, background: G_BORDER }}>
                {renderDateCell(selDate || todayStr, 999, 480)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 日历单元格 Tooltip 悬浮气泡（spec：200ms 延迟 / 300ms 淡出 / 620rpx 等宽容器 / 箭头边缘翻转） */}
      {hoverTooltip && (() => {
        const hRows = rowsOf(hoverTooltip.date).filter((r) => r.order_no);
        if (!hRows.length) return null;
        const r = hRows[0]; // 取首个订单
        const sk = statusKeyOf(r);
        const stColor = sk ? G_STATUS_MAP[sk].color : '#B1E89C';
        const rect = hoverTooltip.rect;
        const W = Math.min(310, (window.innerWidth || 375) - 24); // 620rpx，窄屏收缩
        const ARROW = 12; // 24rpx
        const GAP = 8;

        // 定位：默认在单元格右侧，箭头在左；溢出则翻转到左侧，箭头在右
        let left = rect.right + GAP;
        let arrowSide = 'left'; // 箭头在 tooltip 左侧 → 指向左（即指向单元格）

        if (left + W > (window.innerWidth || 1200) - 4) {
          left = rect.left - W - GAP;
          arrowSide = 'right'; // 箭头翻到右侧 → 指向右（即指向单元格）
        }
        if (left < 4) left = 4;

        // 垂直定位：对齐单元格顶部
        const top = rect.top;

        // 拍摄时间格式化
        const timeSlots = (() => {
          try {
            let ts = r.order_time_slots;
            if (typeof ts === 'string') ts = JSON.parse(ts);
            return Array.isArray(ts) && ts.length ? ts.join(' / ') : '';
          } catch (e) { return ''; }
        })();

        // 付款信息
        const payMap = { unpaid: '未付款', deposit: '已付定金', paid: '已付全款' };
        const payLabel = payMap[r.order_pay_status] || '';
        const balance = r.order_balance ? parseFloat(r.order_balance) : 0;
        const payTx = payLabel + (balance > 0 ? ` · 尾款 ¥${balance}` : '');

        return (
          <div className="fixed z-50" style={{
            left, top,
            width: W,
            background: '#FFFFFF',
            borderRadius: 8,
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            padding: 20,
            opacity: hoverTooltip.visible ? 1 : 0,
            transition: 'opacity 0.25s ease',
            pointerEvents: 'none'
          }}>
            {/* 箭头三角形 */}
            <div style={{
              position: 'absolute',
              top: 20,
              [arrowSide]: -ARROW,
              width: 0, height: 0,
              ...(arrowSide === 'left'
                ? { borderTop: '6px solid transparent', borderBottom: '6px solid transparent', borderRight: `${ARROW}px solid #FFFFFF` }
                : { borderTop: '6px solid transparent', borderBottom: '6px solid transparent', borderLeft: `${ARROW}px solid #FFFFFF` })
            }} />

            {/* 标题：客户姓名 */}
            <div style={{ fontSize: 22, color: '#222222', fontWeight: 500, marginBottom: 12 }}>
              {r.order_customer || '未命名客户'}
            </div>

            {/* 分隔线 */}
            <div style={{ height: 1, background: '#E5E5E5', marginBottom: 12 }} />

            {/* 状态块 */}
            {sk && G_STATUS_MAP[sk] && (
              <div className="flex items-center" style={{ gap: 8 }}>
                <span style={{ width: 18, height: 18, borderRadius: 3, background: stColor, flexShrink: 0 }} />
                <span style={{ fontSize: 18, color: '#333333' }}>{G_STATUS_MAP[sk].label}</span>
              </div>
            )}

            {/* 拍摄时间 */}
            {timeSlots && (
              <div style={{ fontSize: 18, color: '#444444', marginTop: 10 }}>{timeSlots}</div>
            )}

            {/* 套系信息 */}
            {r.order_package && (
              <div style={{ fontSize: 18, color: '#444444', marginTop: 10 }}>{r.order_package}</div>
            )}

            {/* 付款信息 */}
            {payTx && (
              <div style={{ fontSize: 18, color: '#444444', marginTop: 10 }}>{payTx}</div>
            )}
          </div>
        );
      })()}

      {/* 模块 D：右侧档期详情面板（流式布局，与日历主体紧挨着，参考图比例 w=150） */}
      <div className="flex flex-col shrink-0" style={{ width: 150, background: G_PANEL, color: '#FFFFFF', padding: '20px 14px', minHeight: 'calc(100vh - 44px)' }}>
        <div className="text-center" style={{ fontSize: 12, color: '#FFFFFF', marginBottom: 16 }}>{selDate ? `${Number(selParts[0])}年${Number(selParts[1])}月` : `${y}年${m}月`}</div>
        <div className="flex justify-center">
          <div className="flex items-center justify-center" style={{ background: G_YELLOW, width: 80, height: 80, borderRadius: 3, marginBottom: 14 }}>
            <span style={{ fontSize: 55, fontWeight: 400, lineHeight: 1, color: '#FFFFFF' }}>{selParts[2] ? Number(selParts[2]) : '--'}</span>
          </div>
        </div>
        <div className="text-center" style={{ fontSize: 12, color: '#FFFFFF', marginBottom: 4 }}>{selDate ? (lunarMap[selDate] || '') : ''}</div>
        <div className="text-center" style={{ fontSize: 12, color: '#DCDCDC', marginBottom: 16 }}>{selDate ? WEEK_FULL[new Date(selDate).getDay()] : ''}{selDate === todayStr ? ' · 今天' : ''}</div>

        <div style={{ borderTop: '1px solid #555555', margin: '12px 0' }} />
        <div className="text-center" style={{ fontSize: 13, color: '#CCCCCC', padding: '8px 0' }}>{sideStatus}</div>
        <div style={{ borderTop: '1px solid #555555', margin: '12px 0' }} />

        {/* 选中日期有客户数据：展示姓名/手机号（无数据隐藏，#586 修改点4） */}
        {selCustomerRows.length > 0 && (
          <div style={{ overflowY: 'auto', maxHeight: 240, marginTop: 4 }}>
            {selCustomerRows.map((r) => {
              const ph = orderPhones(r);
              const sk = statusKeyOf(r);
              return (
                <div key={r.id} style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 4, padding: '8px 10px', marginBottom: 8 }}>
                  <div className="flex items-center" style={{ gap: 6 }}>
                    {sk && <span style={{ width: 8, height: 8, borderRadius: '50%', background: G_STATUS_MAP[sk].color, flexShrink: 0 }} />}
                    {r.order_customer && <span style={{ fontSize: 13, color: '#FFFFFF', fontWeight: 500 }}>{r.order_customer}</span>}
                  </div>
                  {ph && <div style={{ fontSize: 12, color: '#BBBBBB', marginTop: 3 }}>{ph}</div>}
                  {r.order_package && <div style={{ fontSize: 12, color: '#999999', marginTop: 2 }}>{r.order_package}{sk ? ' · ' + G_STATUS_MAP[sk].label : ''}</div>}
                </div>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: 'auto', marginBottom: 'auto', display: 'flex', justifyContent: 'center', width: '100%' }}>
          <button onClick={selClosed ? undefined : () => openNew(selDate)} disabled={selClosed}
            className="w-full text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ maxWidth: 170, height: 38, background: G_BLUE, borderRadius: 4, fontSize: 14 }}>+ 添加档期</button>
        </div>
      </div>

      {err && <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-red-500 text-white text-sm px-4 py-2 rounded shadow-lg z-50">{err}</div>}

      {dlg && <ScheduleDialog dlg={dlg} personnel={personnel} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); load(); }} />}
      {/* 「+新建档期」走路由 /schedule/new（与移动端一致，复用 ScheduleNewOrder 组件）；删除桌面端直接调 OrderDialog 的旧入口 */}
      {booking && <BookingDialog onClose={() => setBooking(null)} />}
      {share && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="w-full max-w-sm bg-white rounded-lg p-6">
            <div className="flex items-center justify-between mb-3">
              <div className="font-medium" style={{ color: '#1f2329' }}>分享档期</div>
              <button onClick={() => setShare(null)} className="text-muted text-sm hover:text-fg">✕</button>
            </div>
            <img src={share.qr_url} className="w-40 h-40 rounded bg-white mx-auto" alt="qr" />
            <div className="text-[11px] text-muted break-all mt-3">{share.share_url}</div>
            <button onClick={() => navigator.clipboard && navigator.clipboard.writeText(share.share_url)} className="w-full mt-3 px-3 py-2 rounded border border-[#E5E5E5] text-sm hover:bg-panel2" style={{ color: '#1f2329' }}>复制链接</button>
          </div>
        </div>
      )}

      <FloatingTools />

      {/* 电脑端「新建订单」弹窗（替代 /schedule/new 全屏路由；与订单中心 OrderCreateModal 共用同一组件，字段/校验/保存逻辑一致） */}
      <OrderCreateModal
        visible={!!newOrderDlg}
        pageMode={false}
        packages={pkgList}
        initialDate={newOrderDlg ? newOrderDlg.date : ''}
        onClose={() => setNewOrderDlg(null)}
        onAfterCreate={() => { setNewOrderDlg(null); load(); }}
      />
    </div>
  );
}


/* ============ 右下角悬浮工具条（4 个 40×40 圆形白底按钮，bottom24 / right20 / z900） ============ */
const FLOAT_TOOLS = [
  { key: 'bind', label: '绑定', icon: <><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" /></> },
  { key: 'mail', label: '邮箱', icon: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></> },
  { key: 'box', label: '咨询箱', icon: <><path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M3 9l2-4h14l2 4" /><path d="M10 13h4" /></> },
  { key: 'service', label: '客服', icon: <><path d="M4 13a8 8 0 0 1 16 0" /><rect x="2.5" y="13" width="4" height="6" rx="1.5" /><rect x="17.5" y="13" width="4" height="6" rx="1.5" /><path d="M20 19a3 3 0 0 1-3 3h-2" /></> }
];

function FloatingTools() {
  return (
    <div className="fixed flex flex-col" style={{ right: 20, bottom: 24, zIndex: 900, gap: 8 }}>
      {FLOAT_TOOLS.map((t) => (
        <button
          key={t.key}
          type="button"
          title={t.label}
          aria-label={t.label}
          className="flex items-center justify-center bg-white rounded-full transition-colors hover:text-[#2998EB]"
          style={{ width: 40, height: 40, boxShadow: '0 2px 8px rgba(0,0,0,0.12)', color: '#666666' }}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{t.icon}</svg>
        </button>
      ))}
    </div>
  );
}

/* ============ 状态图例（默认展示 2 个标签，点击展开「订单状态说明」） ============ */
function StatusLegend() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((v) => !v)} className="flex items-center" style={{ gap: 10, height: 28, padding: '0 10px', border: `1px solid ${G_BORDER}`, borderRadius: 4, background: '#FFFFFF' }}>
        <span className="flex items-center" style={{ gap: 4, fontSize: 12, color: '#888888' }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: G_STATUS_MAP['unpaid'].color }} />
          未付定金
        </span>
        <span className="flex items-center" style={{ gap: 4, fontSize: 12, color: '#888888' }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: G_STATUS_MAP['deposit'].color }} />
          等待拍摄
        </span>
        <span style={{ fontSize: 10, color: '#999999', marginLeft: 2 }}>▾</span>
      </button>
      {open && (
        <div className="absolute bg-white" style={{ top: 'calc(100% + 4px)', left: 0, width: 280, border: `1px solid ${G_BORDER}`, borderRadius: 4, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', padding: '12px 14px', zIndex: 40 }}>
          <div style={{ fontSize: 13, color: '#333333', marginBottom: 10, fontWeight: 500 }}>订单状态说明</div>
          <div className="grid grid-cols-4" style={{ gap: '10px 12px' }}>
            {G_STATUS.map((s) => (
              <div key={s.key} className="flex items-center" style={{ gap: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color }} />
                <span style={{ fontSize: 12, color: '#666666' }}>{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


/* ============ 手机端档期订单操作面板（底部抽屉，替代直接跳订单页） ============ */
function OrderSheet({ row, onClose }) {
  const nav = useNavigate();
  const sk = statusKeyOf(row);
  const label = G_STATUS_MAP[sk]?.label || '等待拍摄';
  const color = G_STATUS_MAP[sk]?.color || '#ccc';
  const phone = orderPhones(row);
  const fallbackCopy = (text) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('信息已复制'); }
    catch (e) { toast('复制失败'); }
    document.body.removeChild(ta);
  };
  const copyInfo = () => {
    const parts = [
      row.order_customer ? `客户：${row.order_customer}` : '',
      `状态：${label}`,
      `日期：${row.date || ''} ${row.period || '全天'}`,
      `执行人：${row.executor_name || row.photographer || '未分配'}`,
      phone ? `电话：${phone}` : '',
      row.note ? `备注：${row.note}` : ''
    ].filter(Boolean);
    const text = parts.join('\n');
    if (!text) return toast('暂无可复制信息');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => toast('信息已复制')).catch(() => fallbackCopy(text));
    } else fallbackCopy(text);
  };
  return (
    <div className="fixed inset-0" style={{ background: 'rgba(0,0,0,0.4)', zIndex: 60, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: '20px 16px calc(20px + env(safe-area-inset-bottom))' }}>
        {/* 头部：客户名 + 状态 */}
        <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
          <div className="flex items-center" style={{ gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 16, fontWeight: 600, color: '#1f2329', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.order_customer || '未知客户'}</span>
            <span className="inline-flex items-center shrink-0" style={{ gap: 5, fontSize: 11, padding: '2px 8px', borderRadius: 10, background: color }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />
              {label}
            </span>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" style={{ background: 'none', border: 'none', fontSize: 22, lineHeight: 1, color: '#999', padding: 4 }}>×</button>
        </div>

        {/* 订单信息 */}
        <div style={{ fontSize: 13, color: '#666', lineHeight: 2 }}>
          <div>日期：{row.date} {row.period || '全天'}</div>
          <div>执行人：{row.executor_name || row.photographer || '未分配'}</div>
          {phone && <div>电话：{phone}</div>}
          {row.note && <div>备注：{row.note}</div>}
        </div>

        {/* 操作按钮 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 18 }}>
          <button type="button" onClick={() => { if (row.order_id) { onClose(); nav('/orders/' + row.order_id); } }}
            className="flex items-center justify-center"
            style={{ height: 42, borderRadius: 8, border: '1px solid #E5E5E5', background: '#fff', color: '#333', fontSize: 14 }}>查看详情</button>
          <button type="button" onClick={copyInfo}
            className="flex items-center justify-center"
            style={{ height: 42, borderRadius: 8, border: '1px solid #E5E5E5', background: '#fff', color: '#333', fontSize: 14 }}>复制信息</button>
          <a href={phone ? 'tel:' + phone.replace(/\s+/g, '') : undefined} onClick={phone ? undefined : (e) => e.preventDefault()}
            className="flex items-center justify-center"
            style={{ height: 42, borderRadius: 8, border: 'none', background: G_BLUE, color: '#fff', fontSize: 14, textDecoration: 'none' }}>拨打电话</a>
        </div>
      </div>
    </div>
  );
}

/* ============ 新增订单弹窗（原「添加档期」入口） ============ */
const PHONE_RE = /^1[3-9]\d{9}$/;
function toast(msg) {
  let el = document.getElementById('__schedule_toast__');
  if (!el) {
    el = document.createElement('div');
    el.id = '__schedule_toast__';
    el.style.cssText = 'position:fixed;left:50%;top:18%;transform:translateX(-50%);background:rgba(0,0,0,.8);color:#fff;padding:8px 16px;border-radius:6px;font-size:14px;z-index:3000;transition:opacity .3s;pointer-events:none;white-space:nowrap;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el.__t);
  el.__t = setTimeout(() => { el.style.opacity = '0'; }, 2400);
}

/* ============ 编辑档期弹窗（保留原档期业务逻辑，不改动） ============ */
function ScheduleDialog({ dlg, personnel, onClose, onSaved }) {
  const [date, setDate] = useState(dlg.date || '');
  const [chooseSession, setChooseSession] = useState((dlg.periods || []).length > 0);
  const [dateTbd, setDateTbd] = useState(!!dlg.date_tbd);
  const [periods, setPeriods] = useState(dlg.periods || []);
  const [executorId, setExecutorId] = useState(dlg.executor_id || '');
  const [executorName, setExecutorName] = useState(dlg.executor_name || '');
  const [note, setNote] = useState(dlg.note || '');
  const [status, setStatus] = useState(dlg.status || 'free');
  const [localErr, setLocalErr] = useState('');
  const fromOrder = !!dlg.order_no; // 订单占用的档期，状态由订单驱动，禁止手动改

  const togglePeriod = (h) => setPeriods((p) => p.includes(h) ? p.filter((x) => x !== h) : [...p, h]);
  const onChooseSession = (v) => { setChooseSession(v); if (v) setDateTbd(false); };
  const onDateTbd = (v) => { setDateTbd(v); if (v) setChooseSession(false); };

  const save = async () => {
    setLocalErr('');
    if (!dateTbd && !date) return setLocalErr('请选择拍摄日期');
    const ex = personnel.find((p) => String(p.id) === String(executorId));
    const payload = {
      date, periods, date_tbd: dateTbd ? 1 : 0,
      executor_id: executorId ? Number(executorId) : null,
      executor_name: executorName || (ex ? ex.name : ''),
      photographer: executorName || (ex ? ex.name : ''),
      note, status: fromOrder ? (dlg.status || 'booked') : status, order_no: dlg.order_no || ''
    };
    try {
      if (dlg.id) await http.put('/api/schedules/' + dlg.id, payload);
      else await http.post('/api/schedules', payload);
      onSaved();
    } catch (e) {
      // 409：手动锁档不能覆盖已有订单占用的日期（验收⑩）
      setLocalErr((e && e.message) || (e.response && e.response.data && e.response.data.error) || '保存失败');
    }
  };

  return (
    <div onClick={onClose} className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-2xl bg-white rounded-lg flex flex-col" style={{ maxHeight: '85vh', overflow: 'hidden' }}>
      {/* 标题栏：左侧返回 + 居中标题 + 右侧保存 */}
      <div className="relative flex items-center justify-center px-5 py-4 border-b shrink-0" style={{ borderColor: '#EEEEEE', background: '#fff', borderTopLeftRadius: 8, borderTopRightRadius: 8 }}>
        <button onClick={onClose} aria-label="返回"
          className="absolute left-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-md flex items-center justify-center"
          style={{ color: '#666666', background: 'none', border: 'none', cursor: 'pointer' }}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <div className="text-base" style={{ color: '#333333' }}>{dlg.id ? '编辑档期' : '添加档期'}</div>
        <button onClick={save} className="absolute right-4 top-1/2 -translate-y-1/2 text-sm"
          style={{ color: BLUE, background: 'none', border: 'none', padding: '4px 8px', cursor: 'pointer' }}>
          保存
        </button>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ padding: 16 }}>
          {/* 拍摄日期 */}
          <div style={{ background: '#fff', border: '1px solid #EEEEEE', borderRadius: 6, padding: 16, marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 13, color: '#666666', marginBottom: 8 }}>拍摄日期</label>
            <input type="date" value={date} disabled={dateTbd} onChange={(e) => setDate(e.target.value)}
              className="w-full px-2 py-2 rounded border outline-none disabled:opacity-50" style={{ borderColor: '#D8D8D8', color: '#1f2329', fontSize: 13 }} />
          </div>

          {/* 档期状态：订单占用的档期由订单驱动不可手改；空档可手动锁场 */}
          <div style={{ background: '#fff', border: '1px solid #EEEEEE', borderRadius: 6, padding: 16, marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 13, color: '#666666', marginBottom: 8 }}>档期状态</label>
            <select value={fromOrder ? 'booked' : status} disabled={fromOrder} onChange={(e) => setStatus(e.target.value)}
              className="w-full px-2 py-2 rounded border outline-none disabled:opacity-50" style={{ borderColor: '#D8D8D8', color: '#1f2329', fontSize: 13 }}>
              {fromOrder ? <option value="booked">已约（订单 {dlg.order_no} 占用）</option> : (
                <>
                  <option value="free">空闲（仅登记，不占用）</option>
                  <option value="locked">锁场（手动锁档，占用该日期）</option>
                  <option value="closed">关闭（C 端不可预约）</option>
                </>
              )}
            </select>
            <div style={{ fontSize: 11, color: '#999999', marginTop: 8 }}>
              {fromOrder ? '该档期由订单自动占用，改期 / 作废 / 删除订单会自动同步释放。' : '手动锁场不能覆盖已被订单占用或已锁场的日期。'}
            </div>
          </div>

          {/* 选择场次 */}
          <div style={{ background: '#fff', border: '1px solid #EEEEEE', borderRadius: 6, padding: 16, marginBottom: 12 }}>
            <label className="flex items-center" style={{ gap: 8, fontSize: 13, color: '#1f2329', cursor: 'pointer', marginBottom: 10 }}>
              <input type="checkbox" checked={chooseSession} onChange={(e) => onChooseSession(e.target.checked)} />
              选择场次（可多选小时时间段）
            </label>
            {chooseSession && (
              <div className="flex flex-wrap" style={{ gap: 6 }}>
                {HOURS.map((h) => {
                  const on = periods.includes(h);
                  return (
                    <button key={h} onClick={() => togglePeriod(h)}
                      style={{ width: 50, height: 25, fontSize: 12, lineHeight: '25px', padding: 0, border: 'none', borderRadius: 3, cursor: 'pointer', background: on ? '#333333' : '#8DDBB3', color: '#FFFFFF' }}>
                      {h}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 日期待定 */}
          <div style={{ background: '#fff', border: '1px solid #EEEEEE', borderRadius: 6, padding: 16, marginBottom: 12 }}>
            <label className="flex items-center" style={{ gap: 8, fontSize: 13, color: '#1f2329', cursor: 'pointer' }}>
              <input type="checkbox" checked={dateTbd} onChange={(e) => onDateTbd(e.target.checked)} />
              日期待定（不占具体日历日，仅作意向登记）
            </label>
            {dateTbd && <div style={{ fontSize: 12, color: '#C2A773', background: '#FFF9EB', borderRadius: 4, padding: '8px 10px', marginTop: 10 }}>该档期标记为日期待定，日期与场次已置灰，仅记录意向。</div>}
          </div>

          {/* 绑定执行人 */}
          <div style={{ background: '#fff', border: '1px solid #EEEEEE', borderRadius: 6, padding: 16, marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 13, color: '#666666', marginBottom: 8 }}>绑定执行人</label>
            <select value={executorId} onChange={(e) => { setExecutorId(e.target.value); const p = personnel.find((x) => String(x.id) === e.target.value); setExecutorName(p ? p.name : ''); }}
              className="w-full px-2 py-2 rounded border outline-none" style={{ borderColor: '#D8D8D8', color: '#1f2329', fontSize: 13 }}>
              <option value="">未指派</option>
              {personnel.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          {/* 备注 */}
          <div style={{ background: '#fff', border: '1px solid #EEEEEE', borderRadius: 6, padding: 16 }}>
            <label style={{ display: 'block', fontSize: 13, color: '#666666', marginBottom: 8 }}>备注</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="如 婚礼跟拍 / 备注"
              className="w-full px-2 py-2 rounded border outline-none" style={{ borderColor: '#D8D8D8', color: '#1f2329', fontSize: 13 }} />
          </div>

          {localErr && <div style={{ fontSize: 12, color: '#F53F3F', marginTop: 8 }}>{localErr}</div>}
        </div>
      </div>
    </div>
  );
}

/* ============ 档期及预约设置 ============ */
function BookingDialog({ onClose }) {
  const [cfg, setCfg] = useState({ open: true, openDays: [0, 1, 2, 3, 4, 5, 6] });
  const [cap, setCap] = useState({ daily: 0, perPhotographer: false });
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    Promise.all([
      http.get('/api/settings/booking').catch(() => null),
      http.get('/api/schedules/capacity').catch(() => null)
    ]).then(([b, c]) => {
      if (b && b.data) setCfg({ open: b.data.open !== false, openDays: Array.isArray(b.data.openDays) ? b.data.openDays : [0, 1, 2, 3, 4, 5, 6] });
      if (c && c.data) setCap({ daily: Number(c.data.daily) || 0, perPhotographer: !!c.data.perPhotographer });
    }).finally(() => setLoading(false));
  }, []);
  const toggleDay = (d) => setCfg((c) => ({ ...c, openDays: c.openDays.includes(d) ? c.openDays.filter((x) => x !== d) : [...c.openDays, d].sort((a, b) => a - b) }));
  const save = async () => {
    try {
      await http.put('/api/settings/booking', cfg);
      await http.put('/api/schedules/capacity', cap);
      setSaved(true); setTimeout(onClose, 800);
    } catch (e) { alert((e.response && e.response.data && e.response.data.error) || '保存失败'); }
  };
  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="w-full max-w-sm bg-white rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="font-medium" style={{ color: '#1f2329' }}>档期及预约设置</div>
          <button onClick={onClose} className="text-muted text-sm hover:text-fg">✕</button>
        </div>
        {loading ? <div className="text-xs text-muted">加载中…</div> : (
          <>
            <label className="flex items-center justify-between text-sm mb-4" style={{ color: '#1f2329' }}>
              <span>开放客户在线预约</span>
              <input type="checkbox" checked={cfg.open} onChange={(e) => setCfg((c) => ({ ...c, open: e.target.checked }))} />
            </label>
            <div className="text-xs text-muted mb-2">每周可预约日</div>
            <div className="grid grid-cols-4 gap-2 mb-4">
              {OPEN_DAYS_LABEL.map((lab, d) => (
                <button key={d} onClick={() => toggleDay(d)}
                  className={'px-2 py-1.5 rounded text-xs border ' + (cfg.openDays.includes(d) ? 'bg-brand text-white border-brand' : 'bg-panel2 text-muted border-[#E5E5E5]')}>{lab}</button>
              ))}
            </div>
            <div className="text-xs text-muted mb-1">单日最大接单数（0 = 不限）</div>
            <input type="number" min="0" value={cap.daily}
              onChange={(e) => setCap((c) => ({ ...c, daily: Math.max(0, parseInt(e.target.value, 10) || 0) }))}
              className="w-full border rounded px-3 py-2 text-sm mb-3" style={{ borderColor: '#E5E5E5', color: '#1f2329' }} />
            <label className="flex items-center justify-between text-sm mb-1" style={{ color: '#1f2329' }}>
              <span>按摄影师隔离容量（A 摄影师约满不影响 B 摄影师同天接单）</span>
              <input type="checkbox" checked={cap.perPhotographer}
                onChange={(e) => setCap((c) => ({ ...c, perPhotographer: e.target.checked }))} />
            </label>
            <div className="text-[11px] text-muted mb-4">达到上限后，C 端预约该日期自动禁用；B 端录单会弹出约满警告，仍可强行占用。</div>
            {saved && <div className="text-xs text-emerald-500 mb-2">已保存</div>}
            <div className="flex gap-2 justify-end">
              <button onClick={onClose} className="px-4 py-2 rounded border border-[#E5E5E5] text-muted text-sm hover:bg-panel2">取消</button>
              <button onClick={save} className="px-4 py-2 rounded text-white text-sm hover:opacity-90" style={{ background: BLUE }}>保存</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function buildMonth(year, month0) {
  const first = new Date(year, month0, 1);
  const startDay = first.getDay(); // 周日=0
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
