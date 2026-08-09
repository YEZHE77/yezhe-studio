import React, { useState, useEffect, useRef } from 'react';
import http from '../api.js';
import { useViewState } from '../tabMemory.js';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + ':00');
const HALF = 'half';
const FULL = 'full';
const OPEN_DAYS_LABEL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const SSTATUS = { free: '空闲', booked: '已约', locked: '锁场', closed: '已关闭', shoot: '等待拍摄', pending: '待确认' };

// 档期页色号（对齐 1:1 复刻 spec）
const PAGE_BG = '#F7F8FA';
const PANEL_BG = '#3A3A3A';         // 右侧面板深色
const DATE_CIRCLE = '#FFBC00';      // 右侧面板日期黄块（白字）
const BLUE = '#2196F3';             // 弹窗/链接蓝
const ADD_BLUE = '#1677ff';         // 单元格内「+添加」按钮蓝
const ADV_BG = '#222222';           // 高级选项按钮（白字白图标）
const ADD_BTN = '#2998EB';          // 添加档期按钮蓝
const BOOKED_BG = '#FFD6D6';        // 有订单占用日期粉红底色（保留业务可见性）
const SEL_BG = '#FFA8A8';            // 选中日期单元格背景（粉红）
const CELL_BORDER = '#E8E8E8';       // 日期单元格边框

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

// 订单状态说明色块（右侧面板 badge 使用）
const LEGEND_UNPAID = '#FFF2CC';    // 未付定金
const LEGEND_WAIT = '#D5E8B7';      // 等待拍摄

// 顶部图例（默认 2 项，严格按 spec 色号，静态行内展示）
const LEGEND_ITEMS = [
  { label: '未付定金', color: '#FFF2B3' },
  { label: '等待拍摄', color: '#B7E8BC' }
];

const pad = (n) => String(n).padStart(2, '0');

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
  const advRef = useRef(null);
  const accRef = useRef(null);

  const [y, m] = state.month.split('-').map(Number);
  const monthStr = state.month;

  const load = () => {
    const params = new URLSearchParams({ month: state.month });
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

  const shiftMonth = (delta) => {
    const total = y * 12 + (m - 1) + delta;
    const ny = Math.floor(total / 12);
    const nm = (total % 12) + 1;
    setState((s) => ({ ...s, month: `${ny}-${pad(nm)}` }));
  };
  const setYM = (ny, nm) => setState((s) => ({ ...s, month: `${ny}-${pad(nm)}` }));

  const openNew = (day) => {
    const date = day ? `${y}-${pad(m)}-${pad(day)}` : (selDate || `${y}-${pad(m)}-${pad(init.getDate())}`);
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

  const dayRows = selDate ? (map[selDate] || []) : [];
  const dayPends = selDate ? (pendMap[selDate] || []) : [];
  const selParts = selDate ? selDate.split('-') : [];
  // 仅“手动关闭(无预约的关闭档期)”禁用面板 +添加档期；有订单的粉色占用格仍可在面板 +添加
  const selClosed = selDate ? (map[selDate] || []).some((r) => r.status === 'closed' && !(r.order_no)) : false;

  return (
    <div className="w-full" style={{ background: PAGE_BG }}>
      {/* 唯一外层白色总卡片：头部筛选栏 + flex 主体（左日历网格 + 右深色面板） */}
      <div className="w-full bg-white rounded-lg" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.08)', padding: 24 }}>
        {/* ===================== 顶部筛选操作栏（三区 space-between，垂直居中） ===================== */}
        <div className="flex items-center justify-between" style={{ marginBottom: 20 }}>
          {/* 左：状态图例标签组 */}
          <StatusLegend />

          {/* 中：年月选择器（左右箭头 + 年/月下拉） */}
          <div className="flex items-center" style={{ gap: 6 }}>
            <button onClick={() => shiftMonth(-1)} className="flex items-center justify-center rounded bg-white shrink-0" style={{ width: 32, height: 32, border: '1px solid #D9D9D9', color: '#888888' }}>‹</button>
            <select value={y} onChange={(e) => setYM(Number(e.target.value), m)} className="rounded bg-white outline-none shrink-0" style={{ height: 32, border: '1px solid #D9D9D9', padding: '0 8px', color: '#333333', fontSize: 14 }}>
              {Array.from({ length: 21 }, (_, i) => y - 10 + i).map((yy) => <option key={yy} value={yy}>{yy}年</option>)}
            </select>
            <select value={m} onChange={(e) => setYM(y, Number(e.target.value))} className="rounded bg-white outline-none shrink-0" style={{ height: 32, border: '1px solid #D9D9D9', padding: '0 8px', color: '#333333', fontSize: 14 }}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((mm) => <option key={mm} value={mm}>{mm}月</option>)}
            </select>
            <button onClick={() => shiftMonth(1)} className="flex items-center justify-center rounded bg-white shrink-0" style={{ width: 32, height: 32, border: '1px solid #D9D9D9', color: '#888888' }}>›</button>
          </div>

          {/* 右：筛选账号 + 高级选项 */}
          <div className="flex items-center" style={{ gap: 12 }}>
            <div className="relative" ref={accRef}>
              <button onClick={() => setAccOpen((v) => !v)} className="flex items-center gap-1.5 rounded bg-white text-sm outline-none shrink-0" style={{ height: 32, border: '1px solid #D9D9D9', padding: '0 12px', color: '#333333' }}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h12M3 18h6" /></svg>
                筛选账号 <span style={{ color: '#999999' }}>▾</span>
              </button>
              {accOpen && (
                <div className="absolute left-0 mt-1 w-44 bg-white rounded z-30 overflow-hidden" style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.12)' }}>
                  <button onClick={() => { setState((s) => ({ ...s, executor: '' })); setAccOpen(false); }} className="w-full text-left px-4 text-sm hover:bg-[#F3F4F6]" style={{ height: 34, color: state.executor === '' ? BLUE : '#333333' }}>全部账号</button>
                  {personnel.map((p) => (
                    <button key={p.id} onClick={() => { setState((s) => ({ ...s, executor: String(p.id) })); setAccOpen(false); }} className="w-full text-left px-4 text-sm hover:bg-[#F3F4F6]" style={{ height: 34, color: state.executor === String(p.id) ? BLUE : '#333333' }}>{p.name}</button>
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
                  <button onClick={doExport} className="w-full text-left px-4 text-sm hover:bg-[#F3F4F6]" style={{ height: 34, color: '#333333' }}>导出 Excel</button>
                </div>
              )}
            </div>
          </div>
        </div>

      {/* ===================== 日历主体 + 右侧面板（同处一个白色大卡片内） ===================== */}
      <div className="flex items-stretch" style={{ gap: 0 }}>
        {/* 左侧日历网格（flex:1，不另起白色卡片，直接在大卡片内；flex 列布局让网格填充容器高度） */}
        <div className="flex-1 min-w-0 flex flex-col" style={{ minHeight: 700 }}>
          {/* 星期表头 */}
          <div className="grid grid-cols-7">
            {WEEK.map((w) => (
              <div key={w} className="text-center" style={{ fontSize: 13, color: '#666666', height: 36, lineHeight: '36px', borderBottom: '1px solid #E5E7EB' }}>{w}</div>
            ))}
          </div>
          {/* 日期格（7 列网格，单元格 1px 分割线 #E8E8E8；flex-1 + minmax 让单元格行拉伸填满容器，消除下方空白） */}
          <div className="grid grid-cols-7 flex-1" style={{ gap: 1, background: CELL_BORDER, gridAutoRows: 'minmax(110px, 1fr)' }}>
            {cells.map((day, i) => {
              if (day == null) return <div key={i} style={{ minHeight: 110, background: '#ffffff' }} />;
              const date = `${y}-${pad(m)}-${pad(day)}`;
              const rows = map[date] || [];
              const pends = pendMap[date] || [];
              const st = dayState(rows, pends);
              const lunar = lunarMap[date] || '';
              const selected = selDate === date;
              const isClosed = st.kind === 'closed';
              const isBooked = st.kind === 'booked';

              // 单元格底色：选中 #FFA8A8 > 关闭斜纹 #F7F7F7 > 有订单粉红 #FFD6D6 > 空闲白
              let cellBg = '#ffffff';
              let dateColor = '#333333';
              let lunarColor = '#888888';
              let closedColor = '#999999';
              if (selected) {
                cellBg = SEL_BG; dateColor = '#ffffff'; lunarColor = '#fefefe'; closedColor = '#ffffff';
              } else if (isClosed) {
                cellBg = 'repeating-linear-gradient(-45deg, rgba(120,120,120,0.4) 0px, rgba(120,120,120,0.4) 1px, transparent 1px, transparent 8px), #F7F7F7';
              } else if (isBooked) {
                cellBg = BOOKED_BG;
              }
              const hoverCls = !selected && !isBooked ? 'hover:bg-[#F9FAFB]' : '';
              const orderRow = st.orderRows[0];
              const statusColor = orderRow ? (orderRow.order_pay_status === 'unpaid' ? LEGEND_UNPAID : LEGEND_WAIT) : null;

              return (
                <div
                  key={i}
                  onClick={() => setSelDate(date)}
                  className={'relative cursor-pointer transition flex flex-col ' + hoverCls}
                  style={{ minHeight: 110, background: cellBg, padding: 8 }}
                >
                  {/* 公历日期 + 状态色块 + 待确认点 */}
                  <div className="flex items-start justify-between gap-1">
                    <div className="flex items-center gap-1.5">
                      {statusColor && <span className="inline-block mt-0.5" style={{ width: 10, height: 10, background: statusColor }} />}
                      <span style={{ fontSize: 14, color: dateColor }}>{day}</span>
                    </div>
                    {pends.length > 0 && <span className="w-2 h-2 mt-1 inline-block" style={{ background: '#f0a020' }} />}
                  </div>
                  {/* 农历 */}
                  {lunar && <div style={{ fontSize: 12, color: lunarColor }}>{lunar}</div>}

                  {/* 底部：关闭格→档期已关闭（居中）；其余→左下 +添加，右下 1单 */}
                  {isClosed ? (
                    <div className="mt-auto flex items-end justify-center pt-1">
                      <span style={{ fontSize: 12, opacity: 0.8, color: closedColor }}>档期已关闭</span>
                    </div>
                  ) : (
                    <div className="mt-auto flex items-end justify-between gap-1 pt-1">
                      <button onClick={(e) => { e.stopPropagation(); openNew(day); }} className="hover:opacity-80" style={{ color: ADD_BLUE, fontSize: 12 }}>+ 添加</button>
                      {st.orderRows.length > 0 && <span className="shrink-0" style={{ fontSize: 11, color: '#444444' }}>{st.orderRows.length}单</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 右侧深色信息面板（在大卡片 flex 内；按钮在剩余空间内纵向居中，不贴底） */}
        <div className="calendar-side-info shrink-0 flex flex-col" style={{ width: 200, minHeight: 620, marginLeft: 20, background: PANEL_BG, color: '#FFFFFF', borderRadius: 8, padding: '16px 12px' }}>
          {/* 顶部内容：年月 + 黄色日期块 + 农历 + 档期列表（保持靠上、左对齐） */}
          <div className="side-info-top" style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="text-center" style={{ fontSize: 12, color: '#bbbbbb', marginBottom: 14 }}>{y}年{m}月</div>
            <div className="flex justify-center">
              <div className="flex items-center justify-center" style={{ background: DATE_CIRCLE, width: 84, height: 84, borderRadius: 6, margin: '0 auto 14px' }}>
                <span style={{ fontSize: 48, fontWeight: 700, color: '#ffffff' }}>{selParts[2] || '--'}</span>
              </div>
            </div>
            <div className="text-center" style={{ fontSize: 14, color: '#cccccc', marginBottom: 20 }}>{selDate ? (lunarMap[selDate] || '') : ''}</div>

            <div style={{ borderTop: '1px solid #555555', margin: '16px 0' }} />

            <div className="flex-1">
              {dayRows.length === 0 && dayPends.length === 0 && (
                <div className="text-center" style={{ fontSize: 14, color: '#eeeeee' }}>无档期安排</div>
              )}

              {dayRows.map((s) => (
                <div key={s.id} className="flex items-start justify-between p-3 mb-2" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <div className="min-w-0">
                    <div className="text-sm" style={{ color: '#ffffff' }}>{s.periods && s.periods.length ? s.periods.join('、') : (SSTATUS[s.status] || s.period || '全天')}</div>
                    <div className="text-[11px] mt-0.5" style={{ color: '#b9bdc4' }}>
                      {s.order_customer ? `客户：${s.order_customer}` : (s.executor_name || s.photographer || '未指派')}
                      {s.order_no ? ' · ' + s.order_no : ''}
                    </div>
                    {s.order_pay_status === 'unpaid' && <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5" style={{ background: LEGEND_UNPAID, color: '#8a6d00' }}>未付定</span>}
                    {s.order_status === 'deposit' && <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5" style={{ background: LEGEND_WAIT, color: '#2e7d32' }}>等待拍</span>}
                    {s.date_tbd ? <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 ml-1" style={{ background: 'rgba(255,255,255,0.12)', color: '#e5c07b' }}>日期待定</span> : null}
                  </div>
                  <button onClick={() => openEdit(s)} className="shrink-0 ml-2 px-2 py-1 text-xs hover:opacity-80" style={{ color: '#ffffff', border: '1px solid rgba(255,255,255,0.25)' }}>编辑</button>
                </div>
              ))}

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
                    <button onClick={async () => { if (!a.hope_date) return alert('该预约缺少期望日期'); if (!confirm(`接受「${a.name}」的预约并生成订单、锁定档期？`)) return; try { await http.post('/api/admin/appointments/' + a.id + '/confirm', { date: a.hope_date, period: a.period || 'full', photographer: a.photographer || '' }); alert('已接受：订单已生成并锁定档期'); load(); } catch (e) { alert((e.response && e.response.data && e.response.data.error) || '接受失败'); } }} className="px-2 py-1 text-white text-xs" style={{ background: BLUE }}>接受并锁档期</button>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ borderTop: '1px solid #555555', margin: '16px 0' }} />
          </div>

          {/* 按钮容器：上下 auto → 在面板剩余空间内纵向居中（不再贴底） */}
          <div className="side-info-button-wrapper" style={{ marginTop: 'auto', marginBottom: 'auto', display: 'flex', justifyContent: 'center', width: '100%' }}>
            <button onClick={selClosed ? undefined : () => openNew(selDate ? Number(selDate.slice(8, 10)) : null)} disabled={selClosed}
              className="btn-add-schedule w-full text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ maxWidth: 160, height: 36, background: ADD_BTN, borderRadius: 4, fontSize: 13 }}>+ 添加档期</button>
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

/* ============ 状态图例（行内静态 2 项，无外壳/无弹窗，严格按 spec 色号） ============ */
function StatusLegend() {
  return (
    <div className="flex items-center shrink-0" style={{ gap: 24 }}>
      {LEGEND_ITEMS.map((s) => (
        <div key={s.label} className="flex items-center" style={{ gap: 8, fontSize: 13, fontWeight: 400, color: '#666666' }}>
          <span className="inline-block shrink-0" style={{ width: 12, height: 12, borderRadius: 2, background: s.color }} />
          <span>{s.label}</span>
        </div>
      ))}
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
  const [payStatus, setPayStatus] = useState('deposit');
  const [extras, setExtras] = useState([]); // { name, amount }
  const [location, setLocation] = useState('');
  const [remark, setRemark] = useState('');
  const [channelId, setChannelId] = useState('');
  const [channelName, setChannelName] = useState('');
  const [executors, setExecutors] = useState([]); // { id, name, avatar }
  const [localErr, setLocalErr] = useState('');

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
    if (payStatus === 'deposit' && parseFloat(deposit) <= 0) return setLocalErr('收款状态为「已付定金」时，定金必须大于 0');
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
    try {
      const r = await http.post('/api/orders', payload);
      const orderNo = (r.data && r.data.order_no) || '';
      // 同步落一条日历档期（仅当指定了具体拍摄日期；与订单号关联，日历按订单着色）
      if (!dateTbd && shootDate) {
        const periods = slots.length ? slots : ['full'];
        const exec = executors[0] || {};
        try {
          await http.post('/api/schedules', {
            date: shootDate,
            periods,
            date_tbd: 0,
            status: 'booked',
            order_no: orderNo,
            photographer: exec.name || '',
            executor_id: exec.id || null,
            executor_name: exec.name || '',
            note: remark.trim()
          });
        } catch (se) {
          // 档期建档失败不影响订单本身（订单已在订单中心生成）
          console.warn('档期建档失败', se);
          setLocalErr('订单已创建，但日历档期写入失败：' + ((se.response && se.response.data && se.response.data.error) || '未知错误'));
          return;
        }
      }
      onSaved();
    } catch (e) { setLocalErr((e.response && e.response.data && e.response.data.error) || '保存失败'); }
  };

  const slotLabel = (s) => s === HALF ? '半天' : s === FULL ? '全天' : s;

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
  const Caret = () => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#999999" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="m6 9 6 6 6-6" /></svg>
  );
  const Star = () => <span style={{ color: REQ_RED, marginRight: 2 }}>*</span>;

  return (
    <div onClick={onClose} className="fixed inset-0" style={{ background: 'rgba(0,0,0,0.45)', zIndex: 999 }}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="fixed bg-white"
        style={{
          top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: 620, maxHeight: '90vh', overflowY: 'auto',
          borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          padding: '28px 32px', zIndex: 1000
        }}
      >
        {/* ===== 头部：居中标题 + 右上角关闭 ===== */}
        <div className="relative" style={{ marginBottom: 24 }}>
          <div className="text-center" style={{ fontSize: 18, fontWeight: 500, color: '#222222' }}>新增订单</div>
          <button onClick={onClose} aria-label="关闭"
            className="absolute top-0 hover:text-[#333333] transition-colors"
            style={{ right: 0, fontSize: 20, lineHeight: 1, color: '#888888' }}>×</button>
        </div>

        {/* ===== 区块 1：顾客信息 ===== */}
        <div style={BLOCK}>
          <div style={BLOCK_TITLE}>顾客信息</div>
          <div className="flex items-center" style={{ gap: 12 }}>
            {/* 头像占位 44×44 */}
            <div className="shrink-0 rounded-full flex items-center justify-center"
              style={{ width: 44, height: 44, background: '#E8E8E8', color: '#BBBBBB' }}>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="3.4" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
              </svg>
            </div>
            <input value={orderName} onChange={(e) => setOrderName(e.target.value)} placeholder="请输入订单名称" className="placeholder-[#AAAAAA]" style={FIELD} />
          </div>
          <div className="flex items-center" style={{ gap: 12, marginTop: 12 }}>
            <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="顾客姓名"
              className="placeholder-[#AAAAAA]"
              style={{ ...FIELD, flex: 1, width: 'auto' }} />
            <div className="flex items-center" style={{ gap: 8, flex: 1 }}>
              {phones.map((p, i) => (
                <div key={i} className="relative" style={{ flex: 1 }}>
                  <input value={p} onChange={(e) => setPhoneAt(i, e.target.value)} placeholder="添加电话" className="placeholder-[#AAAAAA]" style={FIELD} />
                  {phones.length > 1 && (
                    <button onClick={() => removePhoneAt(i)} className="absolute top-1/2 -translate-y-1/2 hover:text-[#666666]"
                      style={{ right: 8, fontSize: 12, color: '#BBBBBB' }}>×</button>
                  )}
                </div>
              ))}
            </div>
            {/* 加号 28×28 */}
            <button onClick={addPhone} aria-label="添加电话"
              className="shrink-0 flex items-center justify-center hover:bg-[#F4F7FB] transition-colors"
              style={{ width: 28, height: 28, border: `1px solid ${DLG_FIELD_BORDER}`, borderRadius: 4, color: '#666666', fontSize: 16, lineHeight: 1 }}>+</button>
          </div>
        </div>

        {/* ===== 区块 2：日期 & 场次 + 套系 ===== */}
        <div style={BLOCK}>
          <div style={BLOCK_TITLE}>日期 & 场次</div>
          <div className="flex items-center" style={{ gap: 12 }}>
            <DatePicker value={shootDate} onChange={setShootDate} disabled={dateTbd} />
            <label className="flex items-center cursor-pointer shrink-0" style={{ gap: 6, fontSize: 13, color: '#666666' }}>
              <input type="checkbox" checked={chooseSession} onChange={(e) => onChooseSession(e.target.checked)} />
              选择场次
            </label>
          </div>

          {chooseSession && (
            <div className="flex flex-wrap" style={{ gap: '8px 10px', marginTop: 12 }}>
              {[...HOURS, HALF, FULL].map((k) => {
                const on = slots.includes(k);
                return (
                  <button key={k} onClick={() => toggleSlot(k)}
                    className="transition-opacity hover:opacity-90"
                    style={{
                      height: 36, borderRadius: 20, padding: '0 14px', fontSize: 13,
                      background: on ? SLOT_TX : SLOT_BG,
                      color: on ? '#FFFFFF' : SLOT_TX
                    }}>
                    {slotLabel(k)}
                  </button>
                );
              })}
            </div>
          )}

          <label className="flex items-center cursor-pointer" style={{ gap: 6, fontSize: 13, color: '#666666', marginTop: 12 }}>
            <input type="checkbox" checked={dateTbd} onChange={(e) => onDateTbd(e.target.checked)} />
            日期待定（不占具体日历日，仅作意向登记）
          </label>
          {dateTbd && (
            <div style={{ marginTop: 12, background: TBD_BG, borderRadius: 4, padding: '8px 12px', fontSize: 12, color: '#B9742A' }}>
              该订单标记为日期待定，日期与场次已置灰，仅记录意向。
            </div>
          )}

          {/* 套系（必填，双栏 + 下拉） */}
          {/* 套系（必填，双栏：左=名称+价格，右=定金） */}
          <div className="flex items-start" style={{ marginTop: 16, gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: '#666666', marginBottom: 6 }}><Star />套系名称</div>
              <select value={pkgId} onChange={(e) => onPickPackage(e.target.value)}
                style={{ ...FIELD, color: pkgId ? '#333333' : '#AAAAAA' }}>
                <option value="">请选择套系名称</option>
                {pkgList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <div style={{ fontSize: 13, color: '#666666', marginBottom: 6, marginTop: 12 }}><Star />套系价格</div>
              <input value={pkgPrice} onChange={(e) => setPkgPrice(e.target.value)} placeholder="套系价格" className="placeholder-[#AAAAAA]" style={FIELD} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: '#666666', marginBottom: 6 }}><Star />套系定金</div>
              <input value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="套系定金" className="placeholder-[#AAAAAA]" style={FIELD} />
            </div>
          </div>
        </div>

        {/* ===== 区块 3：收款状态 + 其他消费 ===== */}
        <div style={BLOCK}>
          <div style={BLOCK_TITLE}><Star />收款状态</div>
          <div className="relative" ref={payPopRef}>
            <button onClick={() => setPayPop((v) => !v)}
              className="flex items-center justify-between"
              style={{ ...FIELD, color: payStatus ? '#333333' : '#AAAAAA' }}>
              <span>{payLabel}</span>
              <Caret />
            </button>
            {payPop && (
              <div className="absolute left-0 right-0 bg-white overflow-hidden"
                style={{ top: 42, borderRadius: 4, boxShadow: '0 3px 8px rgba(0,0,0,0.12)', zIndex: 30 }}>
                {PAY_OPTIONS.map((o) => {
                  const on = payStatus === o.v;
                  return (
                    <button key={o.v} onClick={() => { setPayStatus(o.v); setPayPop(false); }}
                      className="w-full text-left hover:bg-[#F0F7FF] transition-colors"
                      style={{ height: 36, padding: '0 12px', fontSize: 14, color: on ? '#2998EB' : '#333333', background: on ? POP_SEL : 'transparent' }}>
                      {o.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between" style={{ marginTop: 16, marginBottom: extras.length ? 12 : 0 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: '#333333' }}>其他消费</div>
            <button onClick={addExtra} className="hover:opacity-80" style={{ fontSize: 14, color: ADD_BTN }}>【添加】</button>
          </div>
          {extras.map((e, i) => (
            <div key={i} className="flex items-center" style={{ gap: 12, marginBottom: 8 }}>
              <input value={e.name} onChange={(ev) => setExtraAt(i, 'name', ev.target.value)} placeholder="消费名称"
                className="placeholder-[#AAAAAA]" style={{ ...FIELD, flex: 1, width: 'auto' }} />
              <input value={e.amount} onChange={(ev) => setExtraAt(i, 'amount', ev.target.value)} placeholder="金额"
                className="placeholder-[#AAAAAA]" style={{ ...FIELD, width: 120 }} />
              <button onClick={() => removeExtraAt(i)} className="shrink-0 hover:text-[#666666]" style={{ fontSize: 14, color: '#BBBBBB' }}>×</button>
            </div>
          ))}
        </div>

        {/* ===== 区块 4：拍摄地点 + 备注 ===== */}
        <div style={BLOCK}>
          <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: '#333333' }}>拍摄地点</div>
            {!showRemark && (
              <button onClick={() => setShowRemark(true)} className="hover:opacity-80" style={{ fontSize: 14, color: ADD_BTN }}>【添加备注】</button>
            )}
          </div>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="输入拍摄地点" className="placeholder-[#AAAAAA]" style={FIELD} />
          {(showRemark || remark) && (
            <input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="备注：如 婚礼跟拍 / 特殊要求"
              className="placeholder-[#AAAAAA]" style={{ ...FIELD, marginTop: 12 }} />
          )}
        </div>

        {/* ===== 区块 5：渠道来源 ===== */}
        <div style={BLOCK}>
          <div style={BLOCK_TITLE}>渠道来源</div>
          <div className="relative" ref={chPopRef}>
            <button onClick={() => setChPop((v) => !v)}
              className="flex items-center justify-between"
              style={{ ...FIELD, color: channelName ? '#333333' : '#AAAAAA' }}>
              <span>{channelName || '请选择渠道来源'}</span>
              <Caret />
            </button>
            {chPop && (
              <div className="absolute left-0 right-0 bg-white overflow-hidden"
                style={{ top: 42, borderRadius: 4, boxShadow: '0 3px 8px rgba(0,0,0,0.12)', zIndex: 30, maxHeight: 240, overflowY: 'auto' }}>
                {chList.map((c) => {
                  const on = String(channelId) === String(c.id);
                  return (
                    <button key={c.id} onClick={() => onPickChannel(c.id, c.name)}
                      className="w-full flex items-center text-left hover:bg-[#F0F7FF] transition-colors"
                      style={{ height: 36, padding: '0 12px', gap: 8, fontSize: 14, color: on ? '#2998EB' : '#333333', background: on ? POP_SEL : 'transparent' }}>
                      <span className="shrink-0 rounded-full inline-flex items-center justify-center"
                        style={{ width: 20, height: 20, background: '#EAF2FE', color: '#2998EB', fontSize: 11 }}>{(c.name || '?').slice(0, 1)}</span>
                      {c.name}
                    </button>
                  );
                })}
                <button
                  onClick={() => { setChPop(false); window.location.hash = '#/channels'; }}
                  className="w-full text-left hover:bg-[#F0F7FF] transition-colors"
                  style={{ height: 36, padding: '0 12px', fontSize: 13, color: ADD_BTN, borderTop: `1px solid ${DLG_BLOCK_BORDER}` }}>
                  渠道管理
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ===== 区块 6：执行人 ===== */}
        <div style={{ ...BLOCK, marginBottom: 0 }}>
          <div style={BLOCK_TITLE}>执行人</div>
          <div className="relative" ref={execPopRef}>
            <div className="flex flex-wrap items-center" style={{ gap: 10 }}>
              {executors.map((ex) => (
                <span key={ex.id ?? ex.name} className="inline-flex items-center"
                  style={{ gap: 6, height: 32, padding: '0 10px 0 4px', borderRadius: 16, background: '#EAF2FE', color: '#1D6FE0', fontSize: 13 }}>
                  {ex.avatar
                    ? <img src={ex.avatar} className="rounded-full" style={{ width: 24, height: 24 }} alt="" />
                    : <span className="rounded-full inline-flex items-center justify-center" style={{ width: 24, height: 24, background: ADD_BTN, color: '#fff', fontSize: 11 }}>{(ex.name || '?').slice(0, 1)}</span>}
                  {ex.name}
                  <button onClick={() => removeExec(ex.id)} className="hover:opacity-70" style={{ fontSize: 12 }}>×</button>
                </span>
              ))}
              {/* 蓝色 32×32 加号 */}
              <button onClick={() => setExecPop((v) => !v)} aria-label="添加执行人"
                className="shrink-0 flex items-center justify-center hover:bg-[#E6F4FF] transition-colors"
                style={{ width: 32, height: 32, borderRadius: '50%', border: `1px dashed ${ADD_BTN}`, color: ADD_BTN, fontSize: 18, lineHeight: 1 }}>+</button>
            </div>
            {execPop && (
              <div className="absolute left-0 bg-white overflow-auto"
                style={{ top: 40, width: 220, maxHeight: 208, borderRadius: 4, boxShadow: '0 2px 12px rgba(0,0,0,0.12)', zIndex: 30 }}>
                {personnel.length === 0 && <div style={{ padding: '10px 12px', fontSize: 12, color: '#999999' }}>暂无人员</div>}
                {personnel.map((p) => {
                  const on = !!executors.find((x) => String(x.id) === String(p.id));
                  return (
                    <button key={p.id} onClick={() => toggleExec(p)}
                      className="w-full flex items-center text-left hover:bg-[#F0F7FF] transition-colors"
                      style={{ height: 36, padding: '0 12px', gap: 8, fontSize: 14, color: on ? '#2998EB' : '#333333', background: on ? POP_SEL : 'transparent' }}>
                      {p.avatar
                        ? <img src={p.avatar} className="rounded-full" style={{ width: 20, height: 20 }} alt="" />
                        : <span className="rounded-full inline-flex items-center justify-center" style={{ width: 20, height: 20, background: ADD_BTN, color: '#fff', fontSize: 10 }}>{(p.name || '?').slice(0, 1)}</span>}
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
        <div className="flex justify-center" style={{ marginTop: 28 }}>
          <button onClick={save} className="text-white hover:opacity-90 transition-opacity"
            style={{ width: 140, height: 42, background: ADD_BTN, borderRadius: 4, fontSize: 15, fontWeight: 500 }}>保存</button>
        </div>
      </div>
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
        style={{ height: 38, width: '100%', background: '#FFFFFF', border: `1px solid ${DLG_FIELD_BORDER}`, borderRadius: 4, padding: '0 12px', fontSize: 14, color: disabled ? '#999999' : (value ? '#333333' : '#AAAAAA'), cursor: disabled ? 'not-allowed' : 'pointer', outline: 'none' }}>
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

/* ============ 编辑档期弹窗（保留原档期业务逻辑，不改动） ============ */
function ScheduleDialog({ dlg, personnel, onClose, onSaved }) {
  const [date, setDate] = useState(dlg.date || '');
  const [chooseSession, setChooseSession] = useState((dlg.periods || []).length > 0);
  const [dateTbd, setDateTbd] = useState(!!dlg.date_tbd);
  const [periods, setPeriods] = useState(dlg.periods || []);
  const [executorId, setExecutorId] = useState(dlg.executor_id || '');
  const [executorName, setExecutorName] = useState(dlg.executor_name || '');
  const [note, setNote] = useState(dlg.note || '');
  const [localErr, setLocalErr] = useState('');

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
      note, status: dlg.status || 'free', order_no: dlg.order_no || ''
    };
    try {
      if (dlg.id) await http.put('/api/schedules/' + dlg.id, payload);
      else await http.post('/api/schedules', payload);
      onSaved();
    } catch (e) { setLocalErr((e.response && e.response.data && e.response.data.error) || '保存失败'); }
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
