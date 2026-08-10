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
   浅灰底 #F7F7F7 ／ 边框 #E8E8E8 ／ 深灰侧栏 #3A3A3A ／ 日期黄块 #FFB900
   主蓝 #2DB7F5 ／ 选中浅蓝 #EAF6FD ／ 已预约粉 #FFD3D3 ／ 今日红 #FF7777
   注：左侧全局导航不在本页范围内，禁止改动。                                */
const G_PAGE_BG = '#F7F7F7';
const G_BORDER = '#E8E8E8';
const G_PANEL = '#3A3A3A';
const G_YELLOW = '#FFB900';
const G_BLUE = '#2DB7F5';
const G_SEL = '#EAF6FD';
const G_BOOKED = '#FFD3D3';
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
  const [accOpen, setAccOpen] = useState(false);
  const [dlg, setDlg] = useState(null);
  const [orderDlg, setOrderDlg] = useState(null);
  const [booking, setBooking] = useState(null);
  const [share, setShare] = useState(null);
  const advRef = useRef(null);
  const accRef = useRef(null);

  const [y, m] = state.month.split('-').map(Number);
  const monthStr = state.month;
  const todayStr = ymd(init);

  const load = () => {
    const params = new URLSearchParams();
    params.set('month', state.month);
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
  useEffect(load, [state.month, state.executor]);
  useEffect(() => {
    http.get('/api/admin/personnel').then((r) => setPersonnel(r.data || [])).catch(() => {});
  }, []);
  useEffect(() => {
    http.get('/api/schedules/lunar?month=' + encodeURIComponent(state.month)).then((r) => setLunarMap(r.data || {})).catch(() => {});
  }, [state.month]);
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

  const rowsOf = (date) => map[date] || [];
  const pendsOf = (date) => pendMap[date] || [];

  const shiftMonth = (delta) => {
    const total = y * 12 + (m - 1) + delta;
    const ny = Math.floor(total / 12);
    const nm = (total % 12) + 1;
    setState((s) => ({ ...s, month: `${ny}-${pad(nm)}` }));
  };
  const setYM = (ny, nm) => setState((s) => ({ ...s, month: `${ny}-${pad(nm)}` }));

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
  const selClosed = selDate ? (map[selDate] || []).some((r) => r.status === 'closed' && !(r.order_no)) : false;
  const selState = selDate ? dayState(dayRows, dayPends) : null;

  let sideStatus = '';
  if (!selDate) sideStatus = '请选择日期';
  else if (selState.kind === 'closed') sideStatus = '档期已关闭';
  else if (selState.kind === 'booked') sideStatus = `${selState.orderRows.length} 单`;
  else sideStatus = '档期开放，可预约';

  return (
    <div className="w-full min-h-screen" style={{ background: G_PAGE_BG, paddingRight: 220 }}>
      {/* 模块 A：面包屑 */}
      <div style={{ padding: '12px 12px 8px', fontSize: 12, color: '#666666' }}>
        工作台 &gt; 档期
      </div>

      {/* 白色日历大卡 */}
      <div className="bg-white" style={{ border: `1px solid ${G_BORDER}`, borderRadius: 6, margin: '0 12px 12px', minHeight: 'calc(100vh - 44px)' }}>
        {/* 模块 B：顶部操作栏 */}
        <div className="flex items-center justify-between relative" style={{ padding: '14px 16px', borderBottom: `1px solid ${G_BORDER}` }}>
          {/* 状态图例下拉 */}
          <StatusLegend />

          {/* 年月切换（居中） */}
          <div className="flex items-center" style={{ gap: 8, position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>
            <button onClick={() => shiftMonth(-1)} style={{ width: 28, height: 28, border: `1px solid ${G_BORDER}`, borderRadius: 4, color: '#888888', background: '#FFFFFF', fontSize: 16 }}>‹</button>
            <select value={y} onChange={(e) => setYM(Number(e.target.value), m)} style={{ height: 28, border: `1px solid ${G_BORDER}`, borderRadius: 4, padding: '0 8px', fontSize: 13, color: '#333333', background: '#FFFFFF', outline: 'none' }}>
              {Array.from({ length: 21 }, (_, i) => y - 10 + i).map((yy) => <option key={yy} value={yy}>{yy}年</option>)}
            </select>
            <select value={m} onChange={(e) => setYM(y, Number(e.target.value))} style={{ height: 28, border: `1px solid ${G_BORDER}`, borderRadius: 4, padding: '0 8px', fontSize: 13, color: '#333333', background: '#FFFFFF', outline: 'none' }}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((mm) => <option key={mm} value={mm}>{mm}月</option>)}
            </select>
            <button onClick={() => shiftMonth(1)} style={{ width: 28, height: 28, border: `1px solid ${G_BORDER}`, borderRadius: 4, color: '#888888', background: '#FFFFFF', fontSize: 16 }}>›</button>
          </div>

          {/* 右侧按钮组 */}
          <div className="flex items-center" style={{ gap: 10 }}>
            <div className="relative" ref={accRef}>
              <button onClick={() => setAccOpen((v) => !v)} className="flex items-center" style={{ gap: 6, height: 28, padding: '0 12px', border: `1px solid ${G_BORDER}`, borderRadius: 4, background: '#FFFFFF', fontSize: 13, color: '#333333' }}>
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
              <button onClick={() => setAdvOpen((v) => !v)} className="flex items-center" style={{ gap: 6, height: 28, padding: '0 12px', borderRadius: 4, background: ADV_BG, fontSize: 13, color: '#FFFFFF' }}>
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

        {/* 模块 C：月视图日历网格 */}
        <div className="flex" style={{ minHeight: 620 }}>
          <div className="flex-1 flex flex-col">
            {/* 星期表头 */}
            <div className="grid grid-cols-7">
              {WEEK.map((w) => (
                <div key={w} className="text-center" style={{ fontSize: 13, color: '#666666', height: 36, lineHeight: '36px', borderBottom: `1px solid ${G_BORDER}` }}>{w}</div>
              ))}
            </div>
            {/* 日期格 */}
            <div className="grid grid-cols-7 flex-1" style={{ gap: 1, background: G_BORDER, gridAutoRows: 'minmax(120px, 1fr)' }}>
              {cells.map((day, i) => {
                if (day == null) return <div key={i} style={{ minHeight: 120, background: '#FAFAFA' }} />;
                const date = `${y}-${pad(m)}-${pad(day)}`;
                const rows = rowsOf(date);
                const pends = pendsOf(date);
                const st = dayState(rows, pends);
                const lunar = lunarMap[date] || '';
                const selected = selDate === date;
                const isToday = date === todayStr;
                const isClosed = st.kind === 'closed';

                let cellBg = '#FFFFFF';
                if (isClosed) cellBg = 'repeating-linear-gradient(-45deg, rgba(150,150,150,0.22) 0px, rgba(150,150,150,0.22) 1px, transparent 1px, transparent 8px), #F7F7F7';
                else if (selected) cellBg = G_SEL;

                return (
                  <div key={i} onClick={() => setSelDate(date)}
                    className={'relative cursor-pointer flex flex-col ' + (!selected && !isClosed ? 'hover:bg-[#FAFCFE]' : '')}
                    style={{ minHeight: 120, background: cellBg, padding: 8, boxShadow: selected ? `inset 0 0 0 1px ${G_BLUE}` : 'none' }}>
                    <div className="flex items-start justify-between gap-1">
                      <div className="flex flex-col" style={{ gap: 2 }}>
                        <span className="inline-flex items-center justify-center"
                          style={isToday
                            ? { width: 22, height: 22, borderRadius: 4, background: G_YELLOW, color: G_TODAY, fontSize: 14, fontWeight: 500 }
                            : { fontSize: 14, color: isToday ? G_TODAY : '#333333' }}>{day}</span>
                        {lunar && <span style={{ fontSize: 11, color: '#999999' }}>{lunar}</span>}
                      </div>
                      {pends.length > 0 && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#F0A020' }} />}
                    </div>

                    {!isClosed && (
                      <div className="mt-1.5 flex flex-col" style={{ gap: 3 }}>
                        {st.orderRows.slice(0, 2).map((r) => {
                          const sk = statusKeyOf(r);
                          return (
                            <div key={r.id} onClick={(e) => { e.stopPropagation(); if (r.order_id) nav('/orders/' + r.order_id); }}
                              className="flex items-center truncate hover:opacity-85"
                              style={{ background: G_BOOKED, borderRadius: 2, height: 20, padding: '0 5px', gap: 4 }}>
                              {sk && <span style={{ width: 6, height: 6, borderRadius: '50%', background: G_STATUS_MAP[sk].color }} />}
                              <span className="truncate" style={{ fontSize: 11, color: '#5A2730' }}>{r.order_customer || r.executor_name || r.photographer || '已预约'}</span>
                            </div>
                          );
                        })}
                        {st.orderRows.length > 2 && <div style={{ fontSize: 11, color: '#888888' }}>+{st.orderRows.length - 2} 更多</div>}
                      </div>
                    )}

                    {isClosed ? (
                      <div className="mt-auto flex items-end justify-center pt-1">
                        <span style={{ fontSize: 12, color: '#999999' }}>档期已关闭</span>
                      </div>
                    ) : (
                      <div className="mt-auto flex items-end justify-between gap-1 pt-1">
                        <button onClick={(e) => { e.stopPropagation(); openNew(date); }} className="hover:opacity-80" style={{ color: G_BLUE, fontSize: 12 }}>+ 添加</button>
                        {st.orderRows.length > 0 && <span style={{ fontSize: 11, color: '#888888' }}>{st.orderRows.length}单</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 模块 D：右侧深色悬浮面板 */}
      <div className="fixed top-0 right-0 bottom-0 flex flex-col" style={{ width: 220, background: G_PANEL, color: '#FFFFFF', zIndex: 20, padding: '20px 14px' }}>
        <div className="text-center" style={{ fontSize: 12, color: '#BBBBBB', marginBottom: 16 }}>{selDate ? `${Number(selParts[0])}年${Number(selParts[1])}月` : `${y}年${m}月`}</div>
        <div className="flex justify-center">
          <div className="flex items-center justify-center" style={{ background: G_YELLOW, width: 96, height: 96, borderRadius: 6, marginBottom: 14 }}>
            <span style={{ fontSize: 58, fontWeight: 700, lineHeight: 1, color: '#FFFFFF' }}>{selParts[2] ? Number(selParts[2]) : '--'}</span>
          </div>
        </div>
        <div className="text-center" style={{ fontSize: 13, color: '#CCCCCC', marginBottom: 4 }}>{selDate ? (lunarMap[selDate] || '') : ''}</div>
        <div className="text-center" style={{ fontSize: 12, color: '#999999', marginBottom: 16 }}>{selDate ? WEEK_FULL[new Date(selDate).getDay()] : ''}{selDate === todayStr ? ' · 今天' : ''}</div>

        <div style={{ borderTop: '1px solid #555555', margin: '12px 0' }} />
        <div className="text-center" style={{ fontSize: 13, color: '#CCCCCC', padding: '8px 0' }}>{sideStatus}</div>
        <div style={{ borderTop: '1px solid #555555', margin: '12px 0' }} />

        <div style={{ marginTop: 'auto', marginBottom: 'auto', display: 'flex', justifyContent: 'center', width: '100%' }}>
          <button onClick={selClosed ? undefined : () => openNew(selDate)} disabled={selClosed}
            className="w-full text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ maxWidth: 170, height: 38, background: G_BLUE, borderRadius: 4, fontSize: 14 }}>+ 添加档期</button>
        </div>
      </div>

      {err && <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-red-500 text-white text-sm px-4 py-2 rounded shadow-lg z-50">{err}</div>}

      {dlg && <ScheduleDialog dlg={dlg} personnel={personnel} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); load(); }} />}
      {orderDlg && <OrderDialog orderDlg={orderDlg} personnel={personnel} onClose={() => setOrderDlg(null)} onSaved={() => { setOrderDlg(null); load(); }} />}
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
        <span className="flex items-center" style={{ gap: 4, fontSize: 12, color: '#666666' }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: G_STATUS_MAP['unpaid'].color }} />
          未付定金
        </span>
        <span className="flex items-center" style={{ gap: 4, fontSize: 12, color: '#666666' }}>
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
  // 套系默认配置（选中后同步回填，验收⑤）
  const [pkgDuration, setPkgDuration] = useState('');
  const [pkgRawCount, setPkgRawCount] = useState('');
  const [pkgRetouch, setPkgRetouch] = useState('');
  const [pkgExtraFee, setPkgExtraFee] = useState('');
  const [payStatus, setPayStatus] = useState('deposit');
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
    if (p) {
      setPkgPrice(String(p.price ?? ''));
      setDeposit(String(p.deposit ?? ''));
      // 同步默认配置：拍摄时长 / 底片数量 / 精修片数量 / 加片费用
      const d = (p.details && typeof p.details === 'object') ? p.details : {};
      setPkgDuration(p.duration || d.duration || '');
      setPkgRawCount(d.raw_count || '');
      setPkgRetouch(p.retouch_count || d.retouch_count || '');
      setPkgExtraFee(d.extra_photo_fee || '');
    }
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
      executors,
      package_defaults: {
        duration: pkgDuration || null,
        raw_count: pkgRawCount ? Number(pkgRawCount) : null,
        retouch_count: pkgRetouch ? Number(pkgRetouch) : null,
        extra_photo_fee: pkgExtraFee || null
      }
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
  const isDirty = () => !!(orderName.trim() || customerName.trim() || phones.some((p) => p.trim()) || shootDate || pkgId || pkgPrice || deposit || payStatus !== 'deposit' || remark.trim() || location.trim() || channelId || executors.length || extras.length || slots.length || dateTbd);
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

        {/* ===== 区块 1：顾客信息 ===== */}
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
              {[HALF, FULL].map((k) => {
                const on = slots.includes(k);
                return (
                  <button key={k} onClick={() => toggleSlot(k)} type="button"
                    className="transition-opacity hover:opacity-90"
                    style={{
                      height: 30, borderRadius: 15, padding: '0 14px', fontSize: 14,
                      background: on ? MODAL_SLOT_SEL : MODAL_SLOT_FREE,
                      color: '#FFFFFF'
                    }}>
                    {on ? '✓ ' : ''}{slotLabel(k)}
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

          {/* 套系（必填） */}
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 13, color: '#666666', marginBottom: 6 }}><Star />套系名称</div>
            <PackagePicker pkgList={pkgList} value={pkgId} onPick={onPickPackage} />
            <div style={{ fontSize: 13, color: '#666666', marginBottom: 6, marginTop: 12 }}><Star />套系价格</div>
            <input value={pkgPrice} onChange={(e) => setPkgPrice(e.target.value)} placeholder="套系价格" className="placeholder-[#B5B5B5]" style={{ ...FIELD, borderColor: MODAL_BORDER }} />
            <div style={{ fontSize: 13, color: '#666666', marginBottom: 6, marginTop: 12 }}><Star />套系定金</div>
            <input value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="套系定金" className="placeholder-[#B5B5B5]" style={{ ...FIELD, borderColor: MODAL_BORDER }} />
            {pkgList.find((p) => String(p.id) === String(pkgId)) && (
              <div style={{ marginTop: 10, fontSize: 12, color: '#999999' }}>
                已同步默认配置：拍摄时长 {pkgDuration || '—'} · 底片数量 {pkgRawCount || '—'} · 精修片 {pkgRetouch || '—'} · 加片费 {pkgExtraFee || '—'}
              </div>
            )}
          </div>
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
