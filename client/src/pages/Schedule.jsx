import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import http, { conflictOf } from '../api.js';
import { useViewState } from '../tabMemory.js';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const WEEK_FULL = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + ':00');
const HALF = 'half';
const FULL = 'full';
const OPEN_DAYS_LABEL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const SSTATUS = { free: '空闲', booked: '已约', locked: '锁场', closed: '已关闭', shoot: '等待拍摄', pending: '待确认' };

// 弹窗/次级控件沿用色号（主内容区色板见下方 G_* 常量）
const BLUE = '#2196F3';             // 编辑档期/预约设置等旧弹窗的链接蓝
const ADV_BG = '#222222';           // 高级选项按钮（白字白图标）
const ADD_BTN = '#2998EB';          // 日历选择器选中日蓝

// 新增订单弹窗色号（1:1 复刻 spec）
const DLG_BLOCK_BORDER = '#E5E7EB';  // 区块边框
const DLG_FIELD_BORDER = '#D8D8D8';  // 表单控件边框
const SLOT_BG = '#91DDB0';           // 时间标签（可用）背景
const SLOT_TX = '#206038';           // 时间标签（可用）文字
const SLOT_FULL = '#C8C8C8';         // 时间标签（已满）
const TBD_BG = '#FFFBE6';            // 日期待定提示底色
const REQ_RED = '#F53F3F';           // 必填星号红
const POP_HOVER = '#F0F7FF';         // 下拉浮层 hover
const POP_SEL = '#E6F4FF';           // 下拉浮层选中

// ===== 新增订单弹窗（补充规范）色号 =====
const MODAL_BLUE = '#2DB7F5';        // 主蓝（保存/添加/选中/链接）
const MODAL_BORDER = '#DDDDDD';      // 区块/输入框边框
const MODAL_PLACE = '#B5B5B5';       // 占位文字
const MODAL_RED = '#FF5B5B';         // 必填星号红
const MODAL_POP_HOVER = '#EAFBFC';   // 下拉 hover/选中
const MODAL_TBD = '#FFF9E8';         // 日期待定提示底色
const MODAL_TBD_BORDER = '#FFF0C2';  // 日期待定提示边框
const MODAL_SLOT_FREE = '#8BDCB8';   // 时间段(可选)绿底
const MODAL_SLOT_SEL = '#333333';    // 时间段(选中)深灰底
const MODAL_SLOT_DIS = '#E5E5E5';    // 时间段(禁用)灰底
const MODAL_SLOT_DIS_TX = '#BFBFBF'; // 时间段(禁用)灰字
const MODAL_ACTIVE = '#BFEFFF';      // 输入框激活边框（收款/渠道）
const MODAL_DIV = '#EEEEEE';         // 分割线

/* ===================== 档期页主内容区（需求 G）色板 =====================
   浅灰底 #F7F7F7 ／ 边框 #E5E5E5 ／ 深灰侧栏 #3F3F3F ／ 日期黄块 #FFB900
   主蓝 #2DB7F5 ／ 选中浅蓝 #EAF6FD ／ 已预约粉 #F9A8B2 ／ 今日红 #FF7777
   注：左侧全局导航不在本页范围内，禁止改动。                                */
const G_PAGE_BG = '#F7F7F7';
const G_BORDER = '#E5E5E5';
const G_PANEL = '#3F3F3F';
const G_YELLOW = '#FFB900';
const G_BLUE = '#2DB7F5';
const G_SEL = '#EAF6FD';
const G_BOOKED = '#F9A8B2';
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

const VIEWS = [{ k: 'month', t: '月' }, { k: 'week', t: '周' }, { k: 'day', t: '日' }];

const pad = (n) => String(n).padStart(2, '0');

const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// 指定日期所在自然周（周日起）的 7 个日期字符串
function weekOf(dateStr) {
  const [yy, mm, dd] = String(dateStr).split('-').map(Number);
  const base = new Date(yy, mm - 1, dd);
  base.setDate(base.getDate() - base.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(base);
    x.setDate(base.getDate() + i);
    return ymd(x);
  });
}

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
  const init = new Date();
  const initMonth = `${init.getFullYear()}-${pad(init.getMonth() + 1)}`;
  const [state, setState] = useViewState('schedule', { month: initMonth, executor: '' });
  const [map, setMap] = useState({});
  const [pendMap, setPendMap] = useState({});
  const [personnel, setPersonnel] = useState([]);
  const [lunarMap, setLunarMap] = useState({});
  const [selDate, setSelDate] = useState(`${init.getFullYear()}-${pad(init.getMonth() + 1)}-${pad(init.getDate())}`);
  const [err, setErr] = useState('');
  const [advOpen, setAdvOpen] = useState(false);
  const [accOpen, setAccOpen] = useState(false); // 筛选账号弹窗
  const [dlg, setDlg] = useState(null); // 编辑档期弹窗（保留原档期编辑逻辑）
  const [orderDlg, setOrderDlg] = useState(null); // 新增订单弹窗（原「添加档期」入口）
  const [booking, setBooking] = useState(null); // 档期及预约设置弹窗
  const [share, setShare] = useState(null); // 分享档期弹窗 { share_url, qr_url }
  // 需求 G：视图切换（月/周/日）+ 三项筛选（摄影师 / 套系 / 订单状态）
  const [view, setView] = useState('month');
  const [pkgList, setPkgList] = useState([]);
  const [fPhotog, setFPhotog] = useState('');
  const [fPkg, setFPkg] = useState('');
  const [fStatus, setFStatus] = useState('');
  const advRef = useRef(null);
  const accRef = useRef(null);

  const [y, m] = state.month.split('-').map(Number);
  const monthStr = state.month;
  const todayStr = ymd(init);
  // 视图对应的数据区间键（月视图按月加载，周/日视图按 from~to 加载，跨月自然周也能取全）
  const weekDates = weekOf(selDate || todayStr);
  const rangeKey = view === 'month' ? state.month : (view === 'week' ? weekDates[0] : selDate);

  const load = () => {
    const params = new URLSearchParams();
    if (view === 'week') { params.set('from', weekDates[0]); params.set('to', weekDates[6]); }
    else if (view === 'day') { params.set('from', selDate); params.set('to', selDate); }
    else params.set('month', state.month);
    if (state.executor) params.set('executor', state.executor);
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
  useEffect(load, [state.month, state.executor, view, rangeKey]);
  useEffect(() => {
    http.get('/api/admin/personnel').then((r) => setPersonnel(r.data || [])).catch(() => {});
    http.get('/api/packages').then((r) => setPkgList(Array.isArray(r.data) ? r.data : (r.data && r.data.list) || [])).catch(() => {});
  }, []);
  useEffect(() => {
    // 周视图可能跨月，农历按涉及到的所有月份合并加载
    const months = new Set([state.month]);
    if (view === 'week') { months.add(weekDates[0].slice(0, 7)); months.add(weekDates[6].slice(0, 7)); }
    if (view === 'day' && selDate) months.add(selDate.slice(0, 7));
    Promise.all([...months].map((mo) => http.get('/api/schedules/lunar?month=' + encodeURIComponent(mo)).then((r) => r.data || {}).catch(() => ({}))))
      .then((list) => setLunarMap(Object.assign({}, ...list)));
  }, [state.month, view, rangeKey]);
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

  const cells = buildMonth(y, m - 1);

  // 三项筛选（摄影师 / 套系 / 订单状态）在前端对已加载档期做过滤，空值=全部
  const matchFilter = (r) => {
    if (fPhotog && String(r.executor_id || '') !== String(fPhotog) && (r.executor_name || r.photographer || '') !== fPhotog) return false;
    if (fPkg && String(r.order_package_id || '') !== String(fPkg)) return false;
    if (fStatus && statusKeyOf(r) !== fStatus) return false;
    return true;
  };
  const rowsOf = (date) => (map[date] || []).filter(matchFilter);
  const filtering = !!(fPhotog || fPkg || fStatus);
  const pendsOf = (date) => (filtering ? [] : (pendMap[date] || []));

  const shiftMonth = (delta) => {
    const total = y * 12 + (m - 1) + delta;
    const ny = Math.floor(total / 12);
    const nm = (total % 12) + 1;
    setState((s) => ({ ...s, month: `${ny}-${pad(nm)}` }));
  };
  const setYM = (ny, nm) => setState((s) => ({ ...s, month: `${ny}-${pad(nm)}` }));

  // day 可传日号（月视图）或完整日期串（周/日视图），空则取当前选中日
  const openNew = (day) => {
    let date;
    if (typeof day === 'string' && day.includes('-')) date = day;
    else if (day) date = `${y}-${pad(m)}-${pad(day)}`;
    else date = selDate || todayStr;
    setErr(''); setOrderDlg({ date });
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

  const dayRows = selDate ? rowsOf(selDate) : [];
  const dayPends = selDate ? pendsOf(selDate) : [];
  const selParts = selDate ? selDate.split('-') : [];
  // 仅“手动关闭(无预约的关闭档期)”禁用面板 +添加档期；有订单的粉色占用格仍可在面板 +添加
  const selClosed = selDate ? (map[selDate] || []).some((r) => r.status === 'closed' && !(r.order_no)) : false;

  return (
    <div className="w-full" style={{ background: G_PAGE_BG }}>
      {/* 唯一外层白色日历大卡：头部（图例 / 年月+视图 / 筛选） + 主体（日历 + 右侧深灰栏） */}
      <div className="w-full bg-white" style={{ border: `1px solid ${G_BORDER}`, borderRadius: 6, padding: 20 }}>
        {/* ===================== 头部第一行：8 色状态图例（hover 出说明气泡） + 视图/账号/高级选项 ===================== */}
        <div className="flex items-center justify-between flex-wrap" style={{ gap: 12, marginBottom: 14 }}>
          {/* 左：状态图例标签组（8 色，hover 弹出说明气泡） */}
          <StatusLegend />

          {/* 右：月/周/日视图切换 + 筛选账号 + 高级选项 */}
          <div className="flex items-center" style={{ gap: 12 }}>
            {/* 视图切换段控 */}
            <div className="flex items-center overflow-hidden shrink-0" style={{ border: `1px solid ${G_BORDER}`, borderRadius: 4, height: 32 }}>
              {VIEWS.map((v) => (
                <button key={v.k} onClick={() => setView(v.k)}
                  style={{ width: 44, height: '100%', fontSize: 13, background: view === v.k ? G_BLUE : '#FFFFFF', color: view === v.k ? '#FFFFFF' : '#666666', borderLeft: v.k === 'month' ? 'none' : `1px solid ${G_BORDER}` }}>{v.t}</button>
              ))}
            </div>

            <div className="relative" ref={accRef}>
              <button onClick={() => setAccOpen((v) => !v)} className="flex items-center gap-1.5 bg-white text-sm outline-none shrink-0" style={{ height: 32, border: `1px solid ${G_BORDER}`, borderRadius: 4, padding: '0 12px', color: '#333333' }}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h12M3 18h6" /></svg>
                筛选账号 <span style={{ color: '#999999' }}>▾</span>
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
              <button onClick={() => setAdvOpen((v) => !v)} className="flex items-center gap-1.5 rounded text-white text-sm shrink-0" style={{ height: 32, background: ADV_BG, padding: '0 14px' }}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
                高级选项 <span>▾</span>
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

        {/* ===================== 头部第二行：年月切换 + 摄影师/套系/订单状态 三项筛选 ===================== */}
        <div className="flex items-center justify-between flex-wrap" style={{ gap: 12, marginBottom: 14, paddingBottom: 14, borderBottom: `1px solid ${G_BORDER}` }}>
          <div className="flex items-center" style={{ gap: 6 }}>
            <button onClick={() => shiftMonth(-1)} className="flex items-center justify-center bg-white shrink-0" style={{ width: 32, height: 32, border: `1px solid ${G_BORDER}`, borderRadius: 4, color: '#888888' }}>‹</button>
            <select value={y} onChange={(e) => setYM(Number(e.target.value), m)} className="bg-white outline-none shrink-0" style={{ height: 32, border: `1px solid ${G_BORDER}`, borderRadius: 4, padding: '0 8px', color: '#333333', fontSize: 14 }}>
              {Array.from({ length: 21 }, (_, i) => y - 10 + i).map((yy) => <option key={yy} value={yy}>{yy}年</option>)}
            </select>
            <select value={m} onChange={(e) => setYM(y, Number(e.target.value))} className="bg-white outline-none shrink-0" style={{ height: 32, border: `1px solid ${G_BORDER}`, borderRadius: 4, padding: '0 8px', color: '#333333', fontSize: 14 }}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((mm) => <option key={mm} value={mm}>{mm}月</option>)}
            </select>
            <button onClick={() => shiftMonth(1)} className="flex items-center justify-center bg-white shrink-0" style={{ width: 32, height: 32, border: `1px solid ${G_BORDER}`, borderRadius: 4, color: '#888888' }}>›</button>
            <button onClick={() => { setState((s) => ({ ...s, month: `${init.getFullYear()}-${pad(init.getMonth() + 1)}` })); setSelDate(todayStr); }}
              className="bg-white shrink-0" style={{ height: 32, border: `1px solid ${G_BORDER}`, borderRadius: 4, padding: '0 12px', color: '#666666', fontSize: 13, marginLeft: 4 }}>今天</button>
          </div>

          {/* 三项筛选：摄影师 / 套系 / 订单状态（空值=全部，前端过滤已加载档期） */}
          <div className="flex items-center flex-wrap" style={{ gap: 10 }}>
            <select value={fPhotog} onChange={(e) => setFPhotog(e.target.value)} className="bg-white outline-none shrink-0" style={{ height: 32, minWidth: 120, border: `1px solid ${G_BORDER}`, borderRadius: 4, padding: '0 8px', color: fPhotog ? '#333333' : '#999999', fontSize: 13 }}>
              <option value="">全部摄影师</option>
              {personnel.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select value={fPkg} onChange={(e) => setFPkg(e.target.value)} className="bg-white outline-none shrink-0" style={{ height: 32, minWidth: 130, border: `1px solid ${G_BORDER}`, borderRadius: 4, padding: '0 8px', color: fPkg ? '#333333' : '#999999', fontSize: 13 }}>
              <option value="">全部套系</option>
              {pkgList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="bg-white outline-none shrink-0" style={{ height: 32, minWidth: 130, border: `1px solid ${G_BORDER}`, borderRadius: 4, padding: '0 8px', color: fStatus ? '#333333' : '#999999', fontSize: 13 }}>
              <option value="">全部订单状态</option>
              {G_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            {(fPhotog || fPkg || fStatus) && (
              <button onClick={() => { setFPhotog(''); setFPkg(''); setFStatus(''); }} style={{ height: 32, padding: '0 10px', fontSize: 13, color: G_BLUE }}>清除筛选</button>
            )}
          </div>
        </div>

      {/* ===================== 日历主体 + 右侧面板（同处一个白色大卡片内） ===================== */}
      <div className="flex items-stretch" style={{ gap: 0 }}>
        {/* 左侧日历区（月/周/日三视图切换，flex:1 填满剩余宽度） */}
        <div className="flex-1 min-w-0 flex flex-col" style={{ minHeight: 700 }}>
          {view === 'month' && (
            <>
              {/* 星期表头 */}
              <div className="grid grid-cols-7">
                {WEEK.map((w) => (
                  <div key={w} className="text-center" style={{ fontSize: 13, color: '#666666', height: 36, lineHeight: '36px', borderBottom: `1px solid ${G_BORDER}` }}>{w}</div>
                ))}
              </div>
              {/* 日期格（7 列网格，1px 分割线 #E5E5E5；flex-1 + minmax 让行拉伸填满容器） */}
              <div className="grid grid-cols-7 flex-1" style={{ gap: 1, background: G_BORDER, gridAutoRows: 'minmax(112px, 1fr)' }}>
                {cells.map((day, i) => {
                  if (day == null) return <div key={i} style={{ minHeight: 112, background: '#FAFAFA' }} />;
                  const date = `${y}-${pad(m)}-${pad(day)}`;
                  const rows = rowsOf(date);
                  const pends = pendsOf(date);
                  const st = dayState(rows, pends);
                  const lunar = lunarMap[date] || '';
                  const selected = selDate === date;
                  const isToday = date === todayStr;
                  const isClosed = st.kind === 'closed';

                  // 单元格底色：关闭斜纹 > 选中浅蓝 #EAF6FD > 空闲白（已预约用粉色标签表达，不铺满整格）
                  let cellBg = '#FFFFFF';
                  if (isClosed) cellBg = 'repeating-linear-gradient(-45deg, rgba(150,150,150,0.28) 0px, rgba(150,150,150,0.28) 1px, transparent 1px, transparent 8px), #F7F7F7';
                  else if (selected) cellBg = G_SEL;

                  return (
                    <div key={i} onClick={() => setSelDate(date)}
                      className={'relative cursor-pointer transition flex flex-col ' + (!selected && !isClosed ? 'hover:bg-[#FAFCFE]' : '')}
                      style={{ minHeight: 112, background: cellBg, padding: 8, boxShadow: selected ? `inset 0 0 0 1px ${G_BLUE}` : 'none' }}>
                      {/* 公历日期（今日红圆底白字 #FF7777）+ 农历 + 待确认点 */}
                      <div className="flex items-start justify-between gap-1">
                        <div className="flex items-center" style={{ gap: 6 }}>
                          <span className="inline-flex items-center justify-center"
                            style={isToday
                              ? { width: 22, height: 22, borderRadius: '50%', background: G_TODAY, color: '#FFFFFF', fontSize: 13 }
                              : { fontSize: 14, color: '#333333' }}>{day}</span>
                          {lunar && <span style={{ fontSize: 11, color: '#999999' }}>{lunar}</span>}
                        </div>
                        {pends.length > 0 && <span className="inline-block mt-1" style={{ width: 6, height: 6, borderRadius: '50%', background: '#F0A020' }} />}
                      </div>

                      {/* 中部：已预约条（最多 2 条，粉底 #F9A8B2 + 8 色状态点），超出折叠计数 */}
                      {!isClosed && (
                        <div className="mt-1.5 flex flex-col" style={{ gap: 3 }}>
                          {st.orderRows.slice(0, 2).map((r) => {
                            const sk = statusKeyOf(r);
                            return (
                              <div key={r.id} onClick={(e) => { e.stopPropagation(); if (r.order_id) nav('/orders/' + r.order_id); }}
                                className="flex items-center truncate hover:opacity-85"
                                style={{ background: G_BOOKED, borderRadius: 2, height: 20, padding: '0 5px', gap: 4 }}>
                                {sk && <span className="inline-block shrink-0" style={{ width: 6, height: 6, borderRadius: '50%', background: G_STATUS_MAP[sk].color }} />}
                                <span className="truncate" style={{ fontSize: 11, color: '#5A2730' }}>{r.order_customer || r.executor_name || r.photographer || '已预约'}</span>
                              </div>
                            );
                          })}
                          {st.orderRows.length > 2 && <div style={{ fontSize: 11, color: '#888888' }}>+{st.orderRows.length - 2} 更多</div>}
                        </div>
                      )}

                      {/* 底部：关闭格→档期已关闭（居中）；其余→左下 +添加，右下 N单 */}
                      {isClosed ? (
                        <div className="mt-auto flex items-end justify-center pt-1">
                          <span style={{ fontSize: 12, color: '#999999' }}>档期已关闭</span>
                        </div>
                      ) : (
                        <div className="mt-auto flex items-end justify-between gap-1 pt-1">
                          <button onClick={(e) => { e.stopPropagation(); openNew(date); }} className="hover:opacity-80" style={{ color: G_BLUE, fontSize: 12 }}>+ 添加</button>
                          {st.orderRows.length > 0 && <span className="shrink-0" style={{ fontSize: 11, color: '#888888' }}>{st.orderRows.length}单</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {view === 'week' && (
            <>
              {/* 周视图表头：星期 + 日期（今日红圆） */}
              <div className="grid grid-cols-7">
                {weekDates.map((d, i) => {
                  const dd = Number(d.slice(8, 10));
                  const isToday = d === todayStr;
                  return (
                    <div key={d} className="text-center" style={{ height: 46, borderBottom: `1px solid ${G_BORDER}`, paddingTop: 4 }}>
                      <div style={{ fontSize: 12, color: '#999999' }}>{WEEK[i]}</div>
                      <span className="inline-flex items-center justify-center"
                        style={isToday ? { width: 20, height: 20, borderRadius: '50%', background: G_TODAY, color: '#FFFFFF', fontSize: 12 } : { fontSize: 13, color: '#333333' }}>{dd}</span>
                    </div>
                  );
                })}
              </div>
              {/* 周视图 7 列：每列纵向铺满，列出当日全部档期 */}
              <div className="grid grid-cols-7 flex-1" style={{ gap: 1, background: G_BORDER, gridAutoRows: 'minmax(560px, 1fr)' }}>
                {weekDates.map((d) => {
                  const rows = rowsOf(d);
                  const st = dayState(rows, pendsOf(d));
                  const selected = selDate === d;
                  const isClosed = st.kind === 'closed';
                  return (
                    <div key={d} onClick={() => setSelDate(d)} className="cursor-pointer flex flex-col"
                      style={{ background: isClosed ? '#F7F7F7' : (selected ? G_SEL : '#FFFFFF'), padding: 8, boxShadow: selected ? `inset 0 0 0 1px ${G_BLUE}` : 'none' }}>
                      <div style={{ fontSize: 11, color: '#999999', marginBottom: 6 }}>{lunarMap[d] || ''}</div>
                      {isClosed ? (
                        <div style={{ fontSize: 12, color: '#999999' }}>档期已关闭</div>
                      ) : rows.length === 0 ? (
                        <div style={{ fontSize: 12, color: '#BBBBBB' }}>暂无档期</div>
                      ) : rows.map((r) => {
                        const sk = statusKeyOf(r);
                        return (
                          <div key={r.id} onClick={(e) => { e.stopPropagation(); if (r.order_id) nav('/orders/' + r.order_id); }}
                            className="mb-1.5 hover:opacity-85" style={{ background: r.order_no ? G_BOOKED : '#F0F0F0', borderRadius: 3, padding: '5px 6px' }}>
                            <div className="flex items-center" style={{ gap: 4 }}>
                              {sk && <span className="inline-block shrink-0" style={{ width: 6, height: 6, borderRadius: '50%', background: G_STATUS_MAP[sk].color }} />}
                              <span className="truncate" style={{ fontSize: 12, color: '#5A2730' }}>{r.order_customer || '已预约'}</span>
                            </div>
                            <div className="truncate" style={{ fontSize: 11, color: '#7A4A52', marginTop: 2 }}>{(r.periods && r.periods.length ? r.periods.join('、') : '全天')}{r.order_package ? ' · ' + r.order_package : ''}</div>
                          </div>
                        );
                      })}
                      {!isClosed && <button onClick={(e) => { e.stopPropagation(); openNew(d); }} className="mt-auto text-left hover:opacity-80" style={{ color: G_BLUE, fontSize: 12 }}>+ 添加</button>}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {view === 'day' && (
            <div className="flex-1 flex flex-col" style={{ border: `1px solid ${G_BORDER}`, borderRadius: 4 }}>
              <div className="flex items-center justify-between" style={{ height: 46, padding: '0 14px', borderBottom: `1px solid ${G_BORDER}` }}>
                <div className="flex items-center" style={{ gap: 10 }}>
                  <span style={{ fontSize: 15, color: '#333333' }}>{selDate}</span>
                  <span style={{ fontSize: 12, color: '#999999' }}>{lunarMap[selDate] || ''}</span>
                  {selDate === todayStr && <span style={{ fontSize: 11, color: '#FFFFFF', background: G_TODAY, borderRadius: 9, padding: '2px 8px' }}>今天</span>}
                </div>
                <div className="flex items-center" style={{ gap: 6 }}>
                  <button onClick={() => { const d = new Date(selDate); d.setDate(d.getDate() - 1); setSelDate(ymd(d)); setState((s) => ({ ...s, month: ymd(d).slice(0, 7) })); }}
                    style={{ width: 28, height: 28, border: `1px solid ${G_BORDER}`, borderRadius: 4, color: '#888888' }}>‹</button>
                  <button onClick={() => { const d = new Date(selDate); d.setDate(d.getDate() + 1); setSelDate(ymd(d)); setState((s) => ({ ...s, month: ymd(d).slice(0, 7) })); }}
                    style={{ width: 28, height: 28, border: `1px solid ${G_BORDER}`, borderRadius: 4, color: '#888888' }}>›</button>
                </div>
              </div>
              {/* 24 小时时间轴：按档期 periods 落位（无时段的记为全天，置顶展示） */}
              <div className="flex-1 overflow-auto" style={{ maxHeight: 620 }}>
                {dayRows.filter((r) => !(r.periods && r.periods.length)).map((r) => (
                  <div key={'all-' + r.id} className="flex items-center justify-between" style={{ padding: '10px 14px', borderBottom: `1px solid ${G_BORDER}`, background: r.order_no ? G_BOOKED : '#F7F7F7' }}>
                    <span style={{ fontSize: 13, color: '#5A2730' }}>全天 · {r.order_customer || r.executor_name || '已预约'}{r.order_package ? ' · ' + r.order_package : ''}</span>
                    {r.order_id ? <button onClick={() => nav('/orders/' + r.order_id)} style={{ fontSize: 12, color: '#FFFFFF', background: G_BLUE, borderRadius: 3, padding: '3px 10px' }}>查看订单</button> : null}
                  </div>
                ))}
                {HOURS.map((h) => {
                  const hits = dayRows.filter((r) => (r.periods || []).includes(h));
                  return (
                    <div key={h} className="flex" style={{ minHeight: 40, borderBottom: `1px solid ${G_BORDER}` }}>
                      <div className="shrink-0 text-right" style={{ width: 66, padding: '10px 10px 0 0', fontSize: 12, color: '#999999' }}>{h}</div>
                      <div className="flex-1" style={{ borderLeft: `1px solid ${G_BORDER}`, padding: 6 }}>
                        {hits.map((r) => (
                          <div key={r.id + h} onClick={() => r.order_id && nav('/orders/' + r.order_id)}
                            className="cursor-pointer hover:opacity-85" style={{ background: G_BOOKED, borderRadius: 3, padding: '5px 8px', marginBottom: 4 }}>
                            <span style={{ fontSize: 12, color: '#5A2730' }}>{r.order_customer || '已预约'}{r.order_package ? ' · ' + r.order_package : ''}{r.executor_name ? ' · ' + r.executor_name : ''}</span>
                          </div>
                        ))}
                        {hits.length === 0 && (
                          <button onClick={() => openNew(selDate)} className="opacity-0 hover:opacity-100 transition" style={{ fontSize: 12, color: G_BLUE }}>+ 添加</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* 右侧深灰信息面板 #3F3F3F：年月 + 黄块日期 #FFB900 + 农历 + 当日档期 + 添加按钮 */}
        <div className="calendar-side-info shrink-0 flex flex-col" style={{ width: 220, minHeight: 620, marginLeft: 16, background: G_PANEL, color: '#FFFFFF', borderRadius: 6, padding: '18px 14px' }}>
          {/* 顶部内容：年月 + 黄色日期块 + 农历 + 档期列表（保持靠上、左对齐） */}
          <div className="side-info-top" style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="text-center" style={{ fontSize: 12, color: '#BBBBBB', marginBottom: 14 }}>{selDate ? `${Number(selParts[0])}年${Number(selParts[1])}月` : `${y}年${m}月`}</div>
            <div className="flex justify-center">
              <div className="flex items-center justify-center" style={{ background: G_YELLOW, width: 96, height: 96, borderRadius: 6, margin: '0 auto 14px' }}>
                <span style={{ fontSize: 58, fontWeight: 700, lineHeight: 1, color: '#FFFFFF' }}>{selParts[2] ? Number(selParts[2]) : '--'}</span>
              </div>
            </div>
            <div className="text-center" style={{ fontSize: 13, color: '#CCCCCC', marginBottom: 6 }}>{selDate ? (lunarMap[selDate] || '') : ''}</div>
            <div className="text-center" style={{ fontSize: 12, color: '#999999' }}>{selDate ? WEEK_FULL[new Date(selDate).getDay()] : ''}{selDate === todayStr ? ' · 今天' : ''}</div>

            <div style={{ borderTop: '1px solid #555555', margin: '16px 0' }} />

            <div className="flex-1">
              {dayRows.length === 0 && dayPends.length === 0 && (
                <div className="text-center" style={{ fontSize: 13, color: '#AAAAAA' }}>无档期安排</div>
              )}

              {dayRows.map((s) => {
                const sk = statusKeyOf(s);
                return (
                <div key={s.id} className="flex items-start justify-between p-3 mb-2" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4 }}>
                  <div className="min-w-0">
                    <div className="text-sm" style={{ color: '#ffffff' }}>{s.periods && s.periods.length ? s.periods.join('、') : (SSTATUS[s.status] || s.period || '全天')}</div>
                    <div className="text-[11px] mt-0.5" style={{ color: '#b9bdc4' }}>
                      {s.order_customer ? `客户：${s.order_customer}` : (s.executor_name || s.photographer || '未指派')}
                      {s.order_no ? ' · ' + s.order_no : ''}
                    </div>
                    {s.order_package && <div className="text-[11px]" style={{ color: '#9CA3AF' }}>套系：{s.order_package}</div>}
                    {sk && <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5" style={{ background: G_STATUS_MAP[sk].color, color: '#4A4A4A', borderRadius: 2 }}>{G_STATUS_MAP[sk].label}</span>}
                    {s.date_tbd ? <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 ml-1" style={{ background: 'rgba(255,255,255,0.12)', color: '#e5c07b' }}>日期待定</span> : null}
                  </div>
                  <div className="shrink-0 ml-2 flex flex-col items-end gap-1">
                    {/* 验收⑨：日历上点击已约档期可跳转对应订单详情 */}
                    {s.order_id ? (
                      <button onClick={() => nav('/orders/' + s.order_id)} className="px-2 py-1 text-xs hover:opacity-80"
                        style={{ color: '#ffffff', background: G_BLUE, borderRadius: 3 }}>查看订单</button>
                    ) : null}
                    <button onClick={() => openEdit(s)} className="px-2 py-1 text-xs hover:opacity-80" style={{ color: '#ffffff', border: '1px solid rgba(255,255,255,0.25)', borderRadius: 3 }}>编辑</button>
                  </div>
                </div>
                );
              })}

              {dayPends.map((a) => (
                <div key={a.id} className="border p-3 mb-2" style={{ background: 'rgba(251,191,36,0.12)', borderColor: 'rgba(251,191,36,0.4)' }}>
                  <div className="flex items-center justify-between">
                    <div className="text-sm truncate" style={{ color: '#ffffff' }}>{a.name} · {a.phone}</div>
                    <div className="text-[11px] shrink-0 ml-2" style={{ color: '#fbbf24' }}>{a.period ? (a.period === 'full' ? '全天' : '半天') : ''}</div>
                  </div>
                  {a.package_name && <div className="text-[11px]" style={{ color: '#b9bdc4' }}>套系：{a.package_name}</div>}
                  {a.remark && <div className="text-[11px]" style={{ color: '#b9bdc4' }}>备注：{a.remark}</div>}
                  <div className="flex gap-2 mt-2 justify-end">
                    <button onClick={async () => { if (!confirm(`拒绝「${a.name}」的预约？`)) return; try { await http.post('/api/admin/appointments/' + a.id + '/reject', { reason: '该日期已排满' }); load(); } catch (e) { alert((e.response && e.response.data && e.response.data.error) || '拒绝失败'); } }} className="px-2 py-1 text-xs" style={{ color: '#f87171', border: '1px solid rgba(248,113,113,0.4)' }}>拒绝</button>
                    <button onClick={async () => { if (!a.hope_date) return alert('该预约缺少期望日期'); if (!confirm(`接受「${a.name}」的预约并生成订单、锁定档期？`)) return; try { await http.post('/api/admin/appointments/' + a.id + '/confirm', { date: a.hope_date, period: a.period || 'full', photographer: a.photographer || '' }); alert('已接受：订单已生成并锁定档期'); load(); } catch (e) { alert((e.response && e.response.data && e.response.data.error) || '接受失败'); } }} className="px-2 py-1 text-white text-xs" style={{ background: G_BLUE }}>接受并锁档期</button>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ borderTop: '1px solid #555555', margin: '16px 0' }} />
          </div>

          {/* 按钮容器：上下 auto → 在面板剩余空间内纵向居中（不再贴底） */}
          <div className="side-info-button-wrapper" style={{ marginTop: 'auto', marginBottom: 'auto', display: 'flex', justifyContent: 'center', width: '100%' }}>
            <button onClick={selClosed ? undefined : () => openNew(selDate)} disabled={selClosed}
              className="btn-add-schedule w-full text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ maxWidth: 170, height: 38, background: G_BLUE, borderRadius: 4, fontSize: 14 }}>+ 添加档期</button>
          </div>
        </div>
      </div>

      {err && <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-red-500 text-white text-sm px-4 py-2 rounded shadow-lg z-50">{err}</div>}

      {/* 编辑档期弹窗（保留原档期编辑业务逻辑） */}
      {dlg && <ScheduleDialog dlg={dlg} personnel={personnel} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); load(); }} />}

      {/* 新增订单弹窗（原「添加档期」入口，复用订单中心建单接口） */}
      {orderDlg && <OrderDialog orderDlg={orderDlg} personnel={personnel} onClose={() => setOrderDlg(null)} onSaved={() => { setOrderDlg(null); load(); }} />}

      {/* 档期及预约设置 */}
      {booking && <BookingDialog onClose={() => setBooking(null)} />}

      {/* 分享档期 */}
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
    </div>

    {/* ===================== 右下角悬浮客服按钮组（fixed，纯展示） ===================== */}
    <FloatingTools />
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

/* ============ 状态图例（8 色行内标签；hover 任一项弹出「订单状态说明」气泡） ============ */
function StatusLegend() {
  const [hover, setHover] = useState(false);
  return (
    <div className="relative" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="flex items-center flex-wrap" style={{ gap: '8px 18px' }}>
        {G_STATUS.map((s) => (
          <div key={s.key} className="flex items-center cursor-default" style={{ gap: 6, fontSize: 13, color: '#666666' }}>
            <span className="inline-block shrink-0" style={{ width: 12, height: 12, borderRadius: 2, background: s.color }} />
            <span>{s.label}</span>
          </div>
        ))}
      </div>
      {hover && (
        <div className="absolute bg-white" style={{ top: 'calc(100% + 8px)', left: 0, width: 320, border: `1px solid ${G_BORDER}`, borderRadius: 4, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', padding: '12px 14px', zIndex: 40 }}>
          <div style={{ fontSize: 13, color: '#333333', marginBottom: 8 }}>订单状态说明</div>
          {G_STATUS.map((s) => (
            <div key={s.key} className="flex items-start" style={{ gap: 8, marginBottom: 6 }}>
              <span className="inline-block shrink-0" style={{ width: 10, height: 10, borderRadius: 2, background: s.color, marginTop: 3 }} />
              <div className="min-w-0">
                <span style={{ fontSize: 12, color: '#333333' }}>{s.label}</span>
                <span style={{ fontSize: 12, color: '#999999' }}> —— {s.desc}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============ 新增订单弹窗（原「添加档期」入口） ============ */
function OrderDialog({ orderDlg, personnel, onClose, onSaved }) {
  const [pkgList, setPkgList] = useState([]);
  const [chList, setChList] = useState([]);
  const [execPop, setExecPop] = useState(false);
  const execPopRef = useRef(null);
  // 自定义下拉（收款状态 / 渠道来源）与「添加备注」展开态 —— 仅 UI 交互
  const [payPop, setPayPop] = useState(false);
  const [chPop, setChPop] = useState(false);
  const [showRemark, setShowRemark] = useState(false);
  const payPopRef = useRef(null);
  const chPopRef = useRef(null);

  const [orderName, setOrderName] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [phones, setPhones] = useState(['']);
  const [chooseSession, setChooseSession] = useState(false);
  const [dateTbd, setDateTbd] = useState(false);
  const [shootDate, setShootDate] = useState(orderDlg.date || ''); // 可自由编辑的拍摄日期（不写死）
  const [slots, setSlots] = useState([]);
  const [pkgId, setPkgId] = useState('');
  const [pkgPrice, setPkgPrice] = useState('');
  const [deposit, setDeposit] = useState('');
  const [payStatus, setPayStatus] = useState('');
  const [extras, setExtras] = useState([]); // { name, amount }
  const [location, setLocation] = useState('');
  const [remark, setRemark] = useState('');
  const [channelId, setChannelId] = useState('');
  const [channelName, setChannelName] = useState('');
  const [executors, setExecutors] = useState([]); // { id, name, avatar }
  const [localErr, setLocalErr] = useState('');
  const [conflictBox, setConflictBox] = useState(null); // 档期冲突二次确认（验收③）

  useEffect(() => {
    http.get('/api/packages').then((r) => setPkgList(r.data || [])).catch(() => {});
    http.get('/api/channels').then((r) => {
      const rows = r.data || [];
      if (rows.length) setChList(rows);
      else setChList([
        { id: 1, name: '抖音' }, { id: 2, name: '小红书' }, { id: 3, name: '美团' },
        { id: 4, name: '小程序' }, { id: 5, name: '客户推荐' }, { id: 6, name: '自然进店' }, { id: 7, name: '其他来源' }
      ]);
    }).catch(() => {});
  }, []);
  useEffect(() => {
    const onDown = (e) => {
      if (execPopRef.current && !execPopRef.current.contains(e.target)) setExecPop(false);
      if (payPopRef.current && !payPopRef.current.contains(e.target)) setPayPop(false);
      if (chPopRef.current && !chPopRef.current.contains(e.target)) setChPop(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const toggleSlot = (h) => setSlots((p) => p.includes(h) ? p.filter((x) => x !== h) : [...p, h]);
  const onChooseSession = (v) => { setChooseSession(v); if (v) setDateTbd(false); };
  const onDateTbd = (v) => { setDateTbd(v); if (v) setChooseSession(false); };

  const onPickPackage = (id) => {
    setPkgId(id);
    const p = pkgList.find((x) => String(x.id) === String(id));
    if (p) { setPkgPrice(String(p.price ?? '')); setDeposit(String(p.deposit ?? '')); }
  };
  const onPickChannel = (id, name) => { setChannelId(id); setChannelName(name); setChPop(false); };

  const addPhone = () => setPhones((p) => [...p, '']);
  const setPhoneAt = (i, v) => setPhones((p) => p.map((x, idx) => idx === i ? v : x));
  const removePhoneAt = (i) => setPhones((p) => (p.length > 1 ? p.filter((_, idx) => idx !== i) : ['']));

  const addExtra = () => setExtras((e) => [...e, { name: '', amount: '' }]);
  const setExtraAt = (i, key, v) => setExtras((e) => e.map((x, idx) => idx === i ? { ...x, [key]: v } : x));
  const removeExtraAt = (i) => setExtras((e) => e.filter((_, idx) => idx !== i));

  const toggleExec = (p) => {
    setExecutors((cur) => {
      const exists = cur.find((x) => String(x.id) === String(p.id));
      if (exists) return cur.filter((x) => String(x.id) !== String(p.id));
      return [...cur, { id: p.id, name: p.name, avatar: p.avatar || '' }];
    });
  };
  const removeExec = (id) => setExecutors((cur) => cur.filter((x) => String(x.id) !== String(id)));

  const save = async () => {
    setLocalErr('');
    if (!dateTbd && !shootDate) return setLocalErr('请选择拍摄日期');
    if (!customerName.trim()) return setLocalErr('请填写顾客姓名');
    if (!pkgId) return setLocalErr('请选择套系名称');
    if (!pkgPrice || parseFloat(pkgPrice) <= 0) return setLocalErr('请填写套系价格');
    if (!deposit || parseFloat(deposit) <= 0) return setLocalErr('请填写套系定金');
    if (!payStatus) return setLocalErr('请选择收款状态');
    if (payStatus === 'deposit' && parseFloat(deposit) <= 0) return setLocalErr('收款状态为「已付定金」时，定金必须大于 0');
    if (chooseSession && slots.length === 0) return setLocalErr('请选择场次时间段');
    const payload = {
      order_name: orderName.trim(),
      customer_name: customerName.trim(),
      phones: phones.map((p) => p.trim()).filter(Boolean),
      shoot_date: dateTbd ? '' : shootDate,
      date_tbd: dateTbd ? 1 : 0,
      time_slots: slots,
      package_id: pkgId ? Number(pkgId) : null,
      package_price: parseFloat(pkgPrice) || 0,
      deposit: parseFloat(deposit) || 0,
      payment_status: payStatus,
      extra_items: extras.filter((e) => e.name || e.amount).map((e) => ({ name: (e.name || '').trim(), amount: parseFloat(e.amount) || 0 })),
      address: location.trim(),
      remark: remark.trim(),
      channel: channelName,
      channel_id: channelId ? Number(channelId) : null,
      executors
    };
    await postOrder(payload, false);
  };

  // 建单：档期由后端 /api/orders 自动占用（禁止前端重复写 schedules，否则同一订单会占两条）
  // 冲突时后端返回 409，前端二次确认后带 force 重提（验收③）
  const postOrder = async (payload, force) => {
    try {
      await http.post('/api/orders', { ...payload, force: force ? 1 : 0 });
      setConflictBox(null);
      onSaved();
    } catch (e) {
      const cf = conflictOf(e);
      if (cf && cf.forcible && !force) { setConflictBox({ message: cf.message, payload }); return; }
      setLocalErr((e && e.message) || (e.response && e.response.data && e.response.data.error) || '保存失败');
    }
  };

  const slotLabel = (s) => s === HALF ? '半天' : s === FULL ? '全天' : s;

  // 关闭逻辑（规范 十五）：遮罩不关闭；X 点击时若已填内容则二次确认
  const isDirty = () => !!(orderName.trim() || customerName.trim() || phones.some((p) => p.trim()) || shootDate || pkgId || pkgPrice || deposit || payStatus !== '' || remark.trim() || location.trim() || channelId || executors.length || extras.length || slots.length || dateTbd);
  const requestClose = () => {
    if (isDirty()) {
      if (!window.confirm('确定放弃当前填写的内容吗？')) return;
    }
    onClose();
  };

  // —— 弹窗内统一样式令牌（严格按 1:1 复刻 spec）——
  const BLOCK = { border: `1px solid ${DLG_BLOCK_BORDER}`, borderRadius: 6, padding: 16, marginBottom: 16 };
  const BLOCK_TITLE = { fontSize: 14, fontWeight: 500, color: '#333333', marginBottom: 12 };
  const FIELD = {
    height: 38, width: '100%', background: '#FFFFFF',
    border: `1px solid ${DLG_FIELD_BORDER}`, borderRadius: 4,
    padding: '0 12px', fontSize: 14, color: '#333333', outline: 'none'
  };
  const payLabel = { unpaid: '未付款', deposit: '已付定金', paid: '已付全款' }[payStatus] || '请选择收款状态';
  const PAY_OPTIONS = [
    { v: 'unpaid', label: '未付款' },
    { v: 'deposit', label: '已付定金' },
    { v: 'paid', label: '已付全款' }
  ];
  const Caret = ({ rotate }) => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#999999" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="shrink-0"
      style={{ transform: rotate ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}><path d="m6 9 6 6 6-6" /></svg>
  );
  const Star = () => <span style={{ color: MODAL_RED, marginRight: 2 }}>*</span>;

  return (
    <div className="fixed inset-0" style={{ background: 'rgba(0,0,0,0.45)', zIndex: 999, overflowY: 'auto' }}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white"
        style={{
          width: 700, minHeight: 1080, margin: '40px auto',
          borderRadius: 4, boxShadow: '0 4px 18px rgba(0,0,0,0.18)',
          padding: '38px 42px', position: 'relative', zIndex: 1000
        }}
      >
        {/* ===== 头部：居中标题 + 右上角关闭 ===== */}
        <div className="relative" style={{ marginBottom: 24 }}>
          <div className="text-center" style={{ fontSize: 16, fontWeight: 500, color: '#333333' }}>新增订单</div>
          <button onClick={requestClose} aria-label="关闭"
            className="absolute top-0 hover:text-[#333333] transition-colors"
            style={{ right: 0, fontSize: 24, lineHeight: 1, color: '#999999' }}>×</button>
        </div>

        {/* ===== 区块 1：顾客信息卡片 ===== */}
        <div style={{ border: `1px solid ${MODAL_BORDER}`, borderRadius: 3, padding: '18px 20px', marginBottom: 16, minHeight: 90 }}>
          <div className="flex items-center" style={{ gap: 12 }}>
            {/* 默认头像 48×48 */}
            <div className="shrink-0 rounded-full flex items-center justify-center"
              style={{ width: 48, height: 48, background: '#D8D8D8', color: '#FFFFFF' }}>
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="3.4" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
              </svg>
            </div>
            <input value={orderName} onChange={(e) => setOrderName(e.target.value)} placeholder="请输入订单名称"
              className="placeholder-[#B5B5B5]" style={{ ...FIELD, flex: 1, width: 'auto', borderColor: MODAL_BORDER }} />
            {/* 加号 18×18 */}
            <button onClick={addPhone} aria-label="添加电话"
              className="shrink-0 flex items-center justify-center"
              style={{ width: 18, height: 18, border: `1px solid ${MODAL_BORDER}`, borderRadius: '50%', color: '#999999', fontSize: 14, lineHeight: 1 }}>+</button>
          </div>
          <div className="flex items-center" style={{ gap: 12, marginTop: 12 }}>
            <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="顾客姓名"
              className="placeholder-[#B5B5B5]"
              style={{ ...FIELD, flex: 1, width: 'auto', borderColor: MODAL_BORDER }} />
            <div className="flex items-center" style={{ gap: 8, flex: 1 }}>
              {phones.map((p, i) => (
                <div key={i} className="relative" style={{ flex: 1 }}>
                  <input value={p} onChange={(e) => setPhoneAt(i, e.target.value)} placeholder="添加电话" className="placeholder-[#B5B5B5]" style={{ ...FIELD, borderColor: MODAL_BORDER }} />
                  {phones.length > 1 && (
                    <button onClick={() => removePhoneAt(i)} className="absolute top-1/2 -translate-y-1/2 hover:text-[#666666]"
                      style={{ right: 8, fontSize: 12, color: '#BBBBBB' }}>×</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ===== 区块 2：日期 & 场次 + 套系 ===== */}
        <div style={{ border: `1px solid ${MODAL_BORDER}`, borderRadius: 3, padding: '18px 20px', marginBottom: 16 }}>
          <div className="flex items-center" style={{ gap: 12 }}>
            <DatePicker value={shootDate} onChange={setShootDate} disabled={dateTbd} />
            <label className="flex items-center cursor-pointer shrink-0" style={{ gap: 6, fontSize: 14, color: '#999999' }}>
              <input type="checkbox" checked={chooseSession} onChange={(e) => onChooseSession(e.target.checked)} style={{ width: 16, height: 16, accentColor: MODAL_BLUE }} />
              选择场次
            </label>
          </div>

          {chooseSession && (
            <div className="flex flex-wrap" style={{ gap: '10px 8px', marginTop: 12 }}>
              {HOURS.map((k) => {
                const on = slots.includes(k);
                return (
                  <button key={k} onClick={() => toggleSlot(k)} type="button"
                    className="transition-opacity hover:opacity-90"
                    style={{
                      height: 30, borderRadius: 15, padding: '0 14px', fontSize: 14,
                      background: on ? MODAL_SLOT_SEL : MODAL_SLOT_FREE,
                      color: '#FFFFFF'
                    }}>
                    {on ? '✓ ' : ''}{k}
                  </button>
                );
              })}
            </div>
          )}

          {/* 日期待定 */}
          <div style={{ marginTop: 12, background: MODAL_TBD, border: `1px solid ${MODAL_TBD_BORDER}`, borderRadius: 3, height: 36, display: 'flex', alignItems: 'center', padding: '0 8px' }}>
            <label className="flex items-center cursor-pointer" style={{ gap: 6, fontSize: 14, color: '#666666' }}>
              <input type="checkbox" checked={dateTbd} onChange={(e) => onDateTbd(e.target.checked)} style={{ width: 16, height: 16, accentColor: MODAL_BLUE }} />
              日期待定
            </label>
          </div>
        </div>

        {/* ===== 套系选择（独立区块） ===== */}
        <div style={{ border: `1px solid ${MODAL_BORDER}`, borderRadius: 3, padding: '18px 20px', marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: '#666666', marginBottom: 6 }}><Star />套系名称</div>
          <PackagePicker pkgList={pkgList} value={pkgId} onPick={onPickPackage} />
          <div className="grid grid-cols-2" style={{ gap: 16, marginTop: 12 }}>
            <div>
              <div style={{ fontSize: 13, color: '#666666', marginBottom: 6 }}><Star />套系价格</div>
              <input value={pkgPrice} onChange={(e) => setPkgPrice(e.target.value)} placeholder="套系价格" className="placeholder-[#B5B5B5]" style={{ ...FIELD, borderColor: MODAL_BORDER }} />
            </div>
            <div>
              <div style={{ fontSize: 13, color: '#666666', marginBottom: 6 }}><Star />套系定金</div>
              <input value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="套系定金" className="placeholder-[#B5B5B5]" style={{ ...FIELD, borderColor: MODAL_BORDER }} />
            </div>
          </div>
          {pkgList.find((p) => String(p.id) === String(pkgId)) && (
            <div style={{ marginTop: 10, fontSize: 12, color: '#999999' }}>
              已同步默认配置：拍摄时长 {pkgList.find((p) => String(p.id) === String(pkgId)).duration || '—'} · 精修片 {pkgList.find((p) => String(p.id) === String(pkgId)).retouch_count || '—'}
            </div>
          )}
        </div>

        {/* ===== 区块 3：收款状态 + 其他消费 ===== */}
        <div style={{ border: `1px solid ${MODAL_BORDER}`, borderRadius: 3, padding: '18px 20px', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#333333', marginBottom: 12 }}><Star />收款状态</div>
          <div className="relative" ref={payPopRef}>
            <button onClick={() => setPayPop((v) => !v)}
              className="flex items-center justify-between"
              style={{ height: 44, width: 150, background: '#FFFFFF', border: `1px solid ${payPop ? MODAL_ACTIVE : MODAL_BORDER}`, borderRadius: 4, padding: '0 12px', fontSize: 14, color: payStatus ? '#666666' : '#AAAAAA', outline: 'none' }}>
              <span>{payLabel}</span>
              <Caret rotate={payPop} />
            </button>
            {payPop && (
              <div className="absolute left-0 bg-white overflow-hidden"
                style={{ top: 50, width: 150, borderRadius: 4, boxShadow: '0 2px 8px rgba(0,0,0,0.12)', zIndex: 30 }}>
                {PAY_OPTIONS.map((o) => {
                  const on = payStatus === o.v;
                  return (
                    <button key={o.v} onClick={() => { setPayStatus(o.v); setPayPop(false); }}
                      className="w-full text-left transition-colors"
                      style={{ height: 44, padding: '0 12px', fontSize: 14, color: on ? MODAL_BLUE : '#666666', background: on ? MODAL_POP_HOVER : 'transparent' }}>
                      {o.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ borderTop: `1px solid ${MODAL_DIV}`, marginTop: 16 }} />
          <div className="flex items-center justify-between" style={{ height: 50 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: '#666666' }}>其他消费</div>
            <button onClick={addExtra} className="hover:opacity-80" style={{ fontSize: 14, color: MODAL_BLUE }}>添加</button>
          </div>
          <div style={{ borderBottom: `1px solid ${MODAL_DIV}`, marginBottom: 4 }} />
          {extras.map((e, i) => (
            <div key={i} className="flex items-center" style={{ gap: 12, marginBottom: 8 }}>
              <input value={e.name} onChange={(ev) => setExtraAt(i, 'name', ev.target.value)} placeholder="消费名称"
                className="placeholder-[#B5B5B5]" style={{ ...FIELD, flex: 1, width: 'auto', borderColor: MODAL_BORDER }} />
              <input value={e.amount} onChange={(ev) => setExtraAt(i, 'amount', ev.target.value)} placeholder="金额"
                className="placeholder-[#B5B5B5]" style={{ ...FIELD, width: 120, borderColor: MODAL_BORDER }} />
              <button onClick={() => removeExtraAt(i)} className="shrink-0 hover:text-[#666666]" style={{ fontSize: 14, color: '#BBBBBB' }}>×</button>
            </div>
          ))}
        </div>

        {/* ===== 区块 4：拍摄地点 + 备注 ===== */}
        <div style={{ border: `1px solid ${MODAL_BORDER}`, borderRadius: 3, padding: '18px 20px', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#333333', marginBottom: 12 }}>拍摄地点</div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#B5B5B5', pointerEvents: 'none' }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z" /><circle cx="12" cy="10" r="3" /></svg>
            </span>
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="输入拍摄地点"
              className="placeholder-[#B5B5B5]" style={{ ...FIELD, height: 60, paddingLeft: 38, borderColor: MODAL_BORDER }} />
          </div>
          {!showRemark && !remark && (
            <button onClick={() => setShowRemark(true)} className="hover:opacity-80 flex items-center gap-1.5" style={{ height: 42, fontSize: 14, color: MODAL_BLUE }}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
              添加备注
            </button>
          )}
          {(showRemark || remark) && (
            <textarea value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="备注：如 婚礼跟拍 / 特殊要求"
              className="placeholder-[#B5B5B5]" rows={3}
              style={{ ...FIELD, height: 'auto', marginTop: 12, padding: '10px 12px', resize: 'vertical', borderColor: MODAL_BORDER }} />
          )}
        </div>

        {/* ===== 区块 5：渠道来源 ===== */}
        <div style={{ border: `1px solid ${MODAL_BORDER}`, borderRadius: 3, padding: '18px 20px', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#333333', marginBottom: 12 }}>渠道来源</div>
          <div className="relative" ref={chPopRef}>
            <button onClick={() => setChPop((v) => !v)}
              className="flex items-center justify-between"
              style={{ ...FIELD, color: channelName ? '#666666' : MODAL_PLACE, borderColor: MODAL_BORDER }}>
              <span>{channelName || '请选择渠道来源'}</span>
              <Caret rotate={chPop} />
            </button>
            {chPop && (
              <div className="absolute left-0 bg-white overflow-hidden"
                style={{ top: 50, width: 170, borderRadius: 4, boxShadow: '0 2px 10px rgba(0,0,0,0.12)', zIndex: 30, maxHeight: 280, overflowY: 'auto' }}>
                {chList.map((c) => {
                  const on = String(channelId) === String(c.id);
                  return (
                    <button key={c.id} onClick={() => onPickChannel(c.id, c.name)}
                      className="w-full flex items-center text-left transition-colors"
                      style={{ height: 44, padding: '0 12px', gap: 8, fontSize: 14, color: on ? MODAL_BLUE : '#666666', background: on ? MODAL_POP_HOVER : 'transparent' }}>
                      <span className="shrink-0 rounded-full inline-flex items-center justify-center"
                        style={{ width: 20, height: 20, background: '#EAF2FE', color: MODAL_BLUE, fontSize: 11 }}>{(c.name || '?').slice(0, 1)}</span>
                      {c.name}
                    </button>
                  );
                })}
                <button
                  onClick={() => { setChPop(false); window.location.hash = '#/channels'; }}
                  className="w-full text-left transition-colors"
                  style={{ height: 44, padding: '0 12px', fontSize: 13, color: MODAL_BLUE, borderTop: `1px solid ${MODAL_DIV}` }}>
                  渠道管理
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ===== 区块 6：执行人 ===== */}
        <div style={{ border: `1px solid ${MODAL_BORDER}`, borderRadius: 3, padding: '0 20px', height: 52, marginBottom: 0, display: 'flex', alignItems: 'center' }}>
          <div className="relative flex-1" ref={execPopRef}>
            <div className="flex flex-wrap items-center" style={{ gap: 10 }}>
              <span style={{ fontSize: 14, color: '#333333', fontWeight: 500, marginRight: 4 }}>执行人</span>
              {executors.map((ex) => (
                <span key={ex.id ?? ex.name} className="inline-flex items-center"
                  style={{ gap: 6, height: 32, padding: '0 8px 0 4px', borderRadius: 16, background: '#F2F2F2', color: '#333333', fontSize: 13 }}>
                  {ex.avatar
                    ? <img src={ex.avatar} className="rounded-full" style={{ width: 24, height: 24 }} alt="" />
                    : <span className="rounded-full inline-flex items-center justify-center" style={{ width: 24, height: 24, background: '#333333', color: '#fff', fontSize: 11 }}>{(ex.name || '?').slice(0, 1)}</span>}
                  {ex.name}
                  <button onClick={() => removeExec(ex.id)} className="hover:opacity-70" style={{ fontSize: 12 }}>×</button>
                </span>
              ))}
              {/* 蓝色 26×26 实心加号 */}
              <button onClick={() => setExecPop((v) => !v)} aria-label="添加执行人"
                className="shrink-0 flex items-center justify-center"
                style={{ width: 26, height: 26, borderRadius: '50%', background: MODAL_BLUE, color: '#fff', fontSize: 16, lineHeight: 1 }}>＋</button>
            </div>
            {execPop && (
              <div className="absolute left-0 bg-white overflow-auto"
                style={{ top: 40, width: 220, maxHeight: 208, borderRadius: 4, boxShadow: '0 2px 12px rgba(0,0,0,0.12)', zIndex: 30 }}>
                {personnel.length === 0 && <div style={{ padding: '10px 12px', fontSize: 12, color: '#999999' }}>暂无人员</div>}
                {personnel.map((p) => {
                  const on = !!executors.find((x) => String(x.id) === String(p.id));
                  return (
                    <button key={p.id} onClick={() => toggleExec(p)}
                      className="w-full flex items-center text-left transition-colors"
                      style={{ height: 44, padding: '0 12px', gap: 8, fontSize: 14, color: on ? MODAL_BLUE : '#666666', background: on ? MODAL_POP_HOVER : 'transparent' }}>
                      {p.avatar
                        ? <img src={p.avatar} className="rounded-full" style={{ width: 20, height: 20 }} alt="" />
                        : <span className="rounded-full inline-flex items-center justify-center" style={{ width: 20, height: 20, background: '#333333', color: '#fff', fontSize: 10 }}>{(p.name || '?').slice(0, 1)}</span>}
                      {p.name}
                      {on && <span className="ml-auto">✓</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {localErr && <div style={{ marginTop: 12, fontSize: 12, color: REQ_RED }}>{localErr}</div>}

        {/* ===== 底部保存 ===== */}
        <div className="flex justify-center" style={{ marginTop: 36 }}>
          <button onClick={save} className="text-white hover:opacity-90 transition-opacity"
            style={{ width: 100, height: 40, background: MODAL_BLUE, borderRadius: 2, fontSize: 16 }}>保存</button>
        </div>
      </div>

      {/* 档期冲突警告（验收③）：所选日期已被订单占用或手动锁场 */}
      {conflictBox && (
        <div className="fixed inset-0 flex items-center justify-center z-[95] p-4" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={(e) => e.stopPropagation()}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 380, background: '#fff', borderRadius: 8, padding: 24 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#222222', marginBottom: 8 }}>档期冲突</div>
            <div style={{ fontSize: 14, color: '#333333', lineHeight: 1.7 }}>{conflictBox.message}</div>
            <div style={{ fontSize: 12, color: '#888888', marginTop: 8 }}>继续保存会在同一天产生重复占用，请确认是否由不同执行人分别承接。</div>
            <div className="flex justify-end" style={{ gap: 8, marginTop: 20 }}>
              <button onClick={() => setConflictBox(null)}
                style={{ height: 34, padding: '0 14px', borderRadius: 4, border: '1px solid #DDDDDD', background: '#fff', fontSize: 14, color: '#333333' }}>换个日期</button>
              <button onClick={() => postOrder(conflictBox.payload, true)}
                style={{ height: 34, padding: '0 14px', borderRadius: 4, border: 'none', background: '#FF8A34', color: '#fff', fontSize: 14 }}>仍要占用</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============ 可编辑日期选择器（弹窗内日历浮层，支持自由修改任意日期） ============ */
function DatePicker({ value, onChange, disabled }) {
  const init = value ? new Date(value + 'T00:00:00') : new Date();
  const [view, setView] = useState({ y: init.getFullYear(), m: init.getMonth() + 1 });
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  const cells = buildMonth(view.y, view.m - 1);
  const shift = (d) => { const t = view.y * 12 + (view.m - 1) + d; setView({ y: Math.floor(t / 12), m: (t % 12) + 1 }); };
  const pick = (day) => { onChange(`${view.y}-${pad(view.m)}-${pad(day)}`); setOpen(false); };
  return (
    <div className="relative" ref={ref} style={{ flex: 1, minWidth: 0 }}>
      <button type="button" disabled={disabled} onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between"
        style={{ height: 38, width: '100%', background: '#FFFFFF', border: `1px solid ${MODAL_BORDER}`, borderRadius: 4, padding: '0 12px', fontSize: 15, color: disabled ? '#999999' : (value ? '#666666' : MODAL_PLACE), cursor: disabled ? 'not-allowed' : 'pointer', outline: 'none' }}>
        <span>{value ? value : '未选择日期'}</span>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 bg-white" style={{ top: 44, width: 264, borderRadius: 6, border: `1px solid ${DLG_BLOCK_BORDER}`, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', padding: 12, zIndex: 40 }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
            <button type="button" onClick={() => shift(-1)} className="flex items-center justify-center rounded hover:bg-[#F4F7FB]" style={{ width: 28, height: 28, color: '#666666', border: '1px solid #E5E7EB' }}>‹</button>
            <span style={{ fontSize: 13, color: '#333333' }}>{view.y}年{view.m}月</span>
            <button type="button" onClick={() => shift(1)} className="flex items-center justify-center rounded hover:bg-[#F4F7FB]" style={{ width: 28, height: 28, color: '#666666', border: '1px solid #E5E7EB' }}>›</button>
          </div>
          <div className="grid grid-cols-7" style={{ gap: 2 }}>
            {WEEK.map((w) => <div key={w} className="text-center" style={{ fontSize: 11, color: '#999999', height: 24, lineHeight: '24px' }}>{w}</div>)}
            {cells.map((day, i) => {
              if (day == null) return <div key={i} style={{ height: 30 }} />;
              const ds = `${view.y}-${pad(view.m)}-${pad(day)}`;
              const on = ds === value;
              return (
                <button key={i} type="button" onClick={() => pick(day)}
                  className="flex items-center justify-center rounded transition-colors hover:bg-[#F0F7FF]"
                  style={{ height: 30, fontSize: 13, color: on ? '#FFFFFF' : '#333333', background: on ? ADD_BTN : 'transparent' }}>{day}</button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============ 套系选择下拉（新增订单弹窗用：列出已有套系并回填默认配置） ============ */
function PackagePicker({ pkgList, value, onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const sel = pkgList.find((p) => String(p.id) === String(value));
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center justify-between w-full text-left"
        style={{ height: 38, width: '100%', background: '#FFFFFF', border: `1px solid ${MODAL_BORDER}`, borderRadius: 4, padding: '0 12px', fontSize: 14, color: sel ? '#333333' : MODAL_PLACE, outline: 'none' }}>
        <span className="truncate">{sel ? sel.name : '请选择套系名称'}</span>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#999999" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" className="shrink-0"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="absolute left-0 bg-white z-30" style={{ top: 44, width: 320, maxHeight: 320, overflowY: 'auto', borderRadius: 4, border: `1px solid ${MODAL_BORDER}`, boxShadow: '0 2px 10px rgba(0,0,0,0.12)' }}>
          {pkgList.length === 0 && <div style={{ padding: '12px', fontSize: 14, color: '#999999' }}>暂无套系</div>}
          {pkgList.map((p) => {
            const on = String(p.id) === String(value);
            return (
              <button key={p.id} type="button" onClick={() => { onPick(String(p.id)); setOpen(false); }}
                className="w-full text-left transition-colors"
                style={{ padding: '10px 12px', fontSize: 14, color: '#666666', background: on ? MODAL_POP_HOVER : 'transparent', borderBottom: '1px solid #F2F2F2' }}>
                <div style={{ fontWeight: 500, color: '#333333' }}>{p.name}</div>
                <div style={{ fontSize: 12, color: '#999999', marginTop: 2 }}>
                  ¥{p.price ?? '—'} · 定金 ¥{p.deposit ?? '—'} · 时长 {p.duration || '—'} · 精修 {p.retouch_count ?? '—'}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
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
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-white rounded-lg p-6 max-h-[88vh] overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="font-medium" style={{ color: '#1f2329' }}>{dlg.id ? '编辑档期' : '添加档期'}</div>
          <button onClick={onClose} className="text-muted text-sm hover:text-fg">✕</button>
        </div>

        <label className="text-xs text-muted">拍摄日期</label>
        <input type="date" value={date} disabled={dateTbd} onChange={(e) => setDate(e.target.value)}
          className="w-full mb-3 px-2 py-2 rounded bg-panel2 border border-[#E5E5E5] text-sm outline-none disabled:opacity-50" style={{ color: '#1f2329' }} />

        {/* 档期状态：订单占用的档期由订单驱动不可手改；空档可手动锁场 */}
        <label className="text-xs text-muted">档期状态</label>
        <select value={fromOrder ? 'booked' : status} disabled={fromOrder} onChange={(e) => setStatus(e.target.value)}
          className="w-full mb-1 px-2 py-2 rounded bg-panel2 border border-[#E5E5E5] text-sm outline-none disabled:opacity-50" style={{ color: '#1f2329' }}>
          {fromOrder ? <option value="booked">已约（订单 {dlg.order_no} 占用）</option> : (
            <>
              <option value="free">空闲（仅登记，不占用）</option>
              <option value="locked">锁场（手动锁档，占用该日期）</option>
              <option value="closed">关闭（C 端不可预约）</option>
            </>
          )}
        </select>
        <div className="text-[11px] mb-3" style={{ color: '#999999' }}>
          {fromOrder ? '该档期由订单自动占用，改期 / 作废 / 删除订单会自动同步释放。' : '手动锁场不能覆盖已被订单占用或已锁场的日期。'}
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer mb-2" style={{ color: '#1f2329' }}>
          <input type="checkbox" checked={chooseSession} onChange={(e) => onChooseSession(e.target.checked)} />
          选择场次（可多选小时时间段）
        </label>
        {chooseSession && (
          <div className="flex flex-wrap gap-2 mb-3">
            {HOURS.map((h) => {
              const on = periods.includes(h);
              return (
                <button key={h} onClick={() => togglePeriod(h)}
                  className={'px-2.5 py-1 rounded-lg text-xs border transition ' + (on ? 'bg-[#2e7d32] text-white border-[#2e7d32]' : 'bg-[#d5e8d4] text-[#2e7d32] border-[#bcdcbe]')}>
                  {h}
                </button>
              );
            })}
          </div>
        )}

        <label className="flex items-center gap-2 text-sm cursor-pointer mb-2" style={{ color: '#1f2329' }}>
          <input type="checkbox" checked={dateTbd} onChange={(e) => onDateTbd(e.target.checked)} />
          日期待定（不占具体日历日，仅作意向登记）
        </label>
        {dateTbd && <div className="text-[11px] mb-3 rounded px-2 py-1.5" style={{ background: '#fff9e6', color: '#b9742a' }}>该档期标记为日期待定，日期与场次已置灰，仅记录意向。</div>}

        <label className="text-xs text-muted">绑定执行人</label>
        <select value={executorId} onChange={(e) => { setExecutorId(e.target.value); const p = personnel.find((x) => String(x.id) === e.target.value); setExecutorName(p ? p.name : ''); }}
          className="w-full mb-3 px-2 py-2 rounded bg-panel2 border border-[#E5E5E5] text-sm outline-none" style={{ color: '#1f2329' }}>
          <option value="">未指派</option>
          {personnel.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <label className="text-xs text-muted">备注</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="如 婚礼跟拍 / 备注"
          className="w-full mb-3 px-2 py-2 rounded bg-panel2 border border-[#E5E5E5] text-sm outline-none" style={{ color: '#1f2329' }} />

        {localErr && <div className="text-xs text-red-500 mb-2">{localErr}</div>}

        <div className="flex gap-2 justify-end mt-2">
          <button onClick={onClose} className="px-4 py-2 rounded border border-[#E5E5E5] text-muted text-sm hover:bg-panel2">取消</button>
          <button onClick={save} className="px-4 py-2 rounded text-white text-sm hover:opacity-90" style={{ background: BLUE }}>确认</button>
        </div>
      </div>
    </div>
  );
}

/* ============ 档期及预约设置 ============ */
function BookingDialog({ onClose }) {
  const [cfg, setCfg] = useState({ open: true, openDays: [0, 1, 2, 3, 4, 5, 6] });
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    http.get('/api/settings/booking').then((r) => { if (r.data) setCfg({ open: r.data.open !== false, openDays: Array.isArray(r.data.openDays) ? r.data.openDays : [0, 1, 2, 3, 4, 5, 6] }); }).catch(() => {}).finally(() => setLoading(false));
  }, []);
  const toggleDay = (d) => setCfg((c) => ({ ...c, openDays: c.openDays.includes(d) ? c.openDays.filter((x) => x !== d) : [...c.openDays, d].sort((a, b) => a - b) }));
  const save = async () => {
    try { await http.put('/api/settings/booking', cfg); setSaved(true); setTimeout(onClose, 800); } catch (e) { alert((e.response && e.response.data && e.response.data.error) || '保存失败'); }
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
