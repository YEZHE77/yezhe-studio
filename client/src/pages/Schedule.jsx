import React, { useState, useEffect, useRef } from 'react';
import http from '../api.js';
import { useViewState } from '../tabMemory.js';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + ':00');
const HALF = 'half';
const FULL = 'full';
const OPEN_DAYS_LABEL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const SSTATUS = { free: '空闲', booked: '已约', locked: '锁场', closed: '已关闭', shoot: '等待拍摄', pending: '待确认' };

// 第8版色号清单
const PAGE_BG = '#F5F5F5';
const CLOSED_BG = '#F8F8F8';
const BOOKED_BG = '#FFC8CB';
const PANEL_BG = '#333333';
const DATE_CIRCLE = '#FFC125';
const BLUE = '#2890F0';
const ADV_BG = '#222222';
const LEGEND_UNPAID = '#FFE880';
const LEGEND_WAIT = '#90DD90';

// 订单状态说明（全部 8 状态色块，严格按 spec 色号）
const STATUS_LEGEND = [
  { label: '未付定金', color: '#FFE880' },
  { label: '等待拍摄', color: '#90DD90' },
  { label: '待上传原片', color: '#92D8E0' },
  { label: '待选片', color: '#D6B8E8' },
  { label: '待精修', color: '#72C8D0' },
  { label: '等待下载', color: '#20A8B0' },
  { label: '待评价', color: '#FFB870' },
  { label: '订单已完成', color: '#D0D0D0' }
];

const pad = (n) => String(n).padStart(2, '0');
// 档期开关判定（业务规则）：
// 默认全部日期开放可预约；仅当该日存在预约记录/已安排订单（或手动关闭 status==='closed'）时自动关闭（标为档期已关闭）。
// 手动关闭优先级最高：无论有无订单，status==='closed' 即视为关闭。
// 三元状态：手动关闭=closed(斜纹)；有预约/待确认=booked(粉色预订卡片)；其余=free(开放白底)
function dayState(rows, pends) {
  const hasManualClosed = rows.some((r) => r.status === 'closed');
  const orderRows = rows.filter((r) => r.order_no && (r.order_customer || r.order_status || r.order_pay_status));
  const hasBooked = orderRows.length > 0 || (pends && pends.length > 0);
  let kind = 'free';
  if (hasManualClosed) kind = 'closed';
  else if (hasBooked) kind = 'booked';
  return { hasManualClosed, orderRows, hasBooked, kind };
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
  // 仅“手动关闭(无预约的关闭档期)”禁用面板 +添加档期；有预约的粉色预订卡片仍可在格子内 +添加
  const selClosed = selDate ? (map[selDate] || []).some((r) => r.status === 'closed' && !(r.order_no)) : false;

  return (
    <div className="-mx-6 -my-6 min-h-screen" style={{ background: PAGE_BG }}>
      <div className="max-w-6xl mx-auto px-6 pt-6 pb-10">
      {/* 面包屑由全局 <Breadcrumb /> 渲染 */}

      {/* 顶部控制栏（PC）：图例（最左）｜ 翻页控件（居中）｜ 筛选账号 + 高级选项（靠右）；白色控件容器背景 #FFFFFF */}
      <div className="flex items-center gap-3 mb-4 px-4 py-2 bg-white border border-line">
        {/* ① 状态图例（最左侧） */}
        <StatusLegend />

        {/* ③ 翻页控件组（页面中间，紧凑居中） */}
        <div className="flex-1 flex justify-center">
          <div className="flex items-center gap-1">
            <button onClick={() => shiftMonth(-1)} className="w-8 h-8 rounded border border-line bg-white hover:bg-panel2" style={{ color: '#888888' }}>‹</button>
            <select value={y} onChange={(e) => setYM(Number(e.target.value), m)} className="px-2 py-1.5 rounded border border-[#DDDDDD] bg-white text-sm outline-none" style={{ color: '#333333' }}>
              {Array.from({ length: 21 }, (_, i) => y - 10 + i).map((yy) => <option key={yy} value={yy}>{yy}年</option>)}
            </select>
            <select value={m} onChange={(e) => setYM(y, Number(e.target.value))} className="px-2 py-1.5 rounded border border-[#DDDDDD] bg-white text-sm outline-none" style={{ color: '#333333' }}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((mm) => <option key={mm} value={mm}>{mm}月</option>)}
            </select>
            <button onClick={() => shiftMonth(1)} className="w-8 h-8 rounded border border-line bg-white hover:bg-panel2" style={{ color: '#888888' }}>›</button>
          </div>
        </div>

        {/* ④ 右上角控件组（筛选账号 + 高级选项，紧贴） */}
        <div className="flex items-center">
          {/* 筛选账号（按钮唤起弹窗） */}
          <div className="relative" ref={accRef}>
            <button onClick={() => setAccOpen((v) => !v)} className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#DDDDDD] bg-white text-sm outline-none hover:bg-panel2" style={{ color: '#333333' }}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h12M3 18h6" /></svg>
              筛选账号 <span style={{ color: '#999999' }}>▾</span>
            </button>
            {accOpen && (
              <div className="absolute right-0 mt-1 w-44 bg-white border border-line rounded-none z-30 overflow-hidden" style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.12)' }}>
                <button onClick={() => { setState((s) => ({ ...s, executor: '' })); setAccOpen(false); }} className="w-full text-left px-3 py-2.5 text-sm hover:bg-panel2" style={{ color: state.executor === '' ? BLUE : '#1f2329' }}>全部账号</button>
                {personnel.map((p) => (
                  <button key={p.id} onClick={() => { setState((s) => ({ ...s, executor: String(p.id) })); setAccOpen(false); }} className="w-full text-left px-3 py-2.5 text-sm hover:bg-panel2" style={{ color: state.executor === String(p.id) ? BLUE : '#1f2329' }}>{p.name}</button>
                ))}
              </div>
            )}
          </div>

          {/* 高级选项（黑色按钮） */}
          <div className="relative" ref={advRef}>
            <button onClick={() => setAdvOpen((v) => !v)} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-white text-sm hover:opacity-90" style={{ background: ADV_BG }}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
              高级选项 <span>▾</span>
            </button>
            {advOpen && (
              <div className="absolute right-0 mt-1 w-44 bg-white border border-line rounded-none z-30 overflow-hidden" style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.12)' }}>
                <button onClick={() => { setAdvOpen(false); setBooking({ open: true, openDays: [0,1,2,3,4,5,6] }); }} className="w-full text-left px-3 py-2.5 text-sm hover:bg-panel2" style={{ color: '#1f2329' }}>档期及预约设置</button>
                <button onClick={async () => { setAdvOpen(false); try { const r = await http.post('/api/schedules/share'); setShare(r.data); } catch (e) { setErr((e.response && e.response.data && e.response.data.error) || '生成分享失败'); } }} className="w-full text-left px-3 py-2.5 text-sm hover:bg-panel2 flex items-center gap-1" style={{ color: '#1f2329' }}>分享档期 <span className="ml-1 text-[10px] text-white rounded-none px-1" style={{ background: BLUE }}>NEW</span></button>
                <button onClick={doExport} className="w-full text-left px-3 py-2.5 text-sm hover:bg-panel2" style={{ color: '#1f2329' }}>导出 Excel</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-start gap-4">
        {/* 日历主体：直接渲染在白色主内容容器内（直角网格，无卡片包裹） */}
        <div className="lg:flex-1 min-w-0">
          <div className="bg-white border border-line overflow-x-auto">
            <div className="min-w-[680px]">
              {/* 星期表头 */}
              <div className="grid grid-cols-7">
                {WEEK.map((w) => <div key={w} className="text-center text-xs py-2 border-r border-b border-line" style={{ color: '#888888', background: '#fafafa' }}>{w}</div>)}
              </div>
              {/* 日期格（直角网格单元） */}
              <div className="grid grid-cols-7">
                {cells.map((day, i) => {
                  if (day == null) return <div key={i} className="border-r border-b border-line min-h-[88px]" />;
                  const date = `${y}-${pad(m)}-${pad(day)}`;
                  const rows = map[date] || [];
                  const pends = pendMap[date] || [];
                  const st = dayState(rows, pends);
                  const lunar = lunarMap[date] || '';
                  const selected = selDate === date;
                  const isClosed = st.kind === 'closed';
                  let cellCls = 'border-r border-b border-line';
                  let style = {};
                  if (isClosed) {
                    style = { background: 'repeating-linear-gradient(45deg,' + CLOSED_BG + ',' + CLOSED_BG + ' 6px,#e8e8e8 6px,#e8e8e8 12px)', color: '#999999' };
                  } else if (st.kind === 'booked') {
                    style = { background: BOOKED_BG, borderColor: '#f3a6ad' };
                  }
                  const orderRow = st.orderRows[0];
                  const statusColor = orderRow ? (orderRow.order_pay_status === 'unpaid' ? LEGEND_UNPAID : LEGEND_WAIT) : null;
                  return (
                    <div key={i} onClick={() => setSelDate(date)}
                      className={'min-h-[88px] p-2 cursor-pointer transition flex flex-col hover:ring-1 hover:ring-inset hover:ring-[#2890F0] ' + cellCls + (selected ? ' ring-2 ring-inset ring-[#2890F0]' : '')}
                      style={style}>
                      {/* 公历日期 + 状态色块 + 待确认点 */}
                      <div className="flex items-start justify-between gap-1">
                        <div className="flex items-center gap-1.5">
                          {statusColor && <span className="w-2.5 h-2.5 mt-0.5 inline-block" style={{ background: statusColor }} />}
                          <span className={'text-sm ' + (isClosed ? 'text-[#999999]' : 'text-[#333333]')}>{day}</span>
                        </div>
                        {pends.length > 0 && <span className="w-2 h-2 mt-1 inline-block" style={{ background: '#f0a020' }} />}
                      </div>
                      {/* 农历 */}
                      {lunar && <div className={'text-[10px] leading-tight ' + (isClosed ? 'text-[#999999]' : 'text-[#888888]')}>{lunar}</div>}
                      {/* 关闭态：底部灰色文字，无 +添加 按钮 */}
                      {isClosed && <div className="mt-auto text-[11px] text-[#999999]">档期已关闭</div>}
                      {/* 预约信息（粉色预订卡片） */}
                      {!isClosed && st.orderRows[0] && (
                        <div className="mt-1"><div className="text-xs truncate" style={{ color: '#7a1f3d' }}>{st.orderRows[0].order_customer || st.orderRows[0].order_no}</div></div>
                      )}
                      {!isClosed && !st.orderRows[0] && rows[0] && (
                        <div className="mt-1"><div className="text-xs truncate" style={{ color: '#333333' }}>{rows[0].photographer || SSTATUS[rows[0].status] || '档期'}</div></div>
                      )}
                      {/* 底部：左下角 +添加 / 右下角 订单数量「X单」（关闭格不渲染） */}
                      {!isClosed && (
                        <div className="mt-auto flex items-end justify-between gap-1 pt-1">
                          <button onClick={(e) => { e.stopPropagation(); openNew(day); }}
                            className="inline-flex items-center gap-0.5 px-2 py-1 text-white text-[11px] hover:opacity-90"
                            style={{ background: BLUE }}>+ 添加</button>
                          {st.orderRows.length > 0 && (
                            <span className="shrink-0 text-[11px] font-medium" style={{ color: '#333333' }}>{st.orderRows.length}单</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* 右侧固定悬浮深色侧边面板（非卡片，直角；flex 列布局使 +添加档期 固定在底部） */}
        <div className="w-full lg:w-[280px] lg:flex-none lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] flex flex-col border border-[#222]" style={{ background: PANEL_BG }}>
          <div className="p-4">
            <div className="text-sm mb-2 text-center" style={{ color: '#ffffff' }}>{y}年{m}月</div>
            <div className="flex justify-center mb-3">
              <div className="w-16 h-16 flex items-center justify-center" style={{ background: DATE_CIRCLE }}>
                <span className="text-2xl font-bold" style={{ color: '#ffffff' }}>{selParts[2] || '--'}</span>
              </div>
            </div>
            <div className="text-xs mb-3 text-center" style={{ color: '#ffffff' }}>{selDate ? (lunarMap[selDate] || '') : ''}</div>
            <div className="border-t" style={{ borderColor: 'rgba(255,255,255,0.25)' }} />
          </div>

          <div className="px-4 flex-1 overflow-auto mb-3">
            {dayRows.length === 0 && dayPends.length === 0 && <div className="text-xs py-6 text-center" style={{ color: '#ffffff' }}>无档期安排</div>}

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

          <div className="p-4">
            <button onClick={selClosed ? undefined : () => openNew(selDate ? Number(selDate.slice(8, 10)) : null)} disabled={selClosed} className="w-full px-3 py-2 text-white text-sm hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed" style={{ background: BLUE }}>+ 添加档期</button>
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
            <button onClick={() => navigator.clipboard && navigator.clipboard.writeText(share.share_url)} className="w-full mt-3 px-3 py-2 rounded border border-line text-sm hover:bg-panel2" style={{ color: '#1f2329' }}>复制链接</button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

/* ============ 图例 + 订单状态说明浮层（8 状态全色号） ============ */
function StatusLegend() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  useEffect(() => {
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);
  return (
    <div className="relative inline-block" ref={wrapRef}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-3 text-xs cursor-pointer select-none rounded px-3 py-1.5"
        style={{ color: '#333333' }}>
        <span className="flex items-center gap-1"><span className="w-3 h-3" style={{ background: LEGEND_UNPAID }} />未付定金</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3" style={{ background: LEGEND_WAIT }} />等待拍摄</span>
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#2890F0" strokeWidth="2.5"><path d="m6 9 6 6 6-6" /></svg>
      </button>

      {open && (
        <div className="absolute left-0 mt-1 w-44 bg-white border border-line rounded-none z-40" style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.12)' }}>
          <div className="px-3 py-2 text-sm font-medium border-b border-line" style={{ color: '#333333' }}>订单状态说明</div>
          <div className="py-1">
            {STATUS_LEGEND.map((s) => (
              <div key={s.label} className="flex items-center gap-2 px-3 py-1.5 text-sm" style={{ color: '#333333' }}>
                <span className="w-3 h-3 shrink-0" style={{ background: s.color }} />
                <span>{s.label}</span>
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

  const [orderName, setOrderName] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [phones, setPhones] = useState(['']);
  const [chooseSession, setChooseSession] = useState(false);
  const [dateTbd, setDateTbd] = useState(false);
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
    if (!dateTbd && !orderDlg.date) return setLocalErr('请选择拍摄日期');
    if (!customerName.trim()) return setLocalErr('请填写顾客姓名');
    if (!pkgId) return setLocalErr('请选择套系名称');
    if (!pkgPrice || parseFloat(pkgPrice) <= 0) return setLocalErr('请填写套系价格');
    if (!deposit || parseFloat(deposit) <= 0) return setLocalErr('请填写套系定金');
    if (payStatus === 'deposit' && parseFloat(deposit) <= 0) return setLocalErr('收款状态为「已付定金」时，定金必须大于 0');
    const payload = {
      order_name: orderName.trim(),
      customer_name: customerName.trim(),
      phones: phones.map((p) => p.trim()).filter(Boolean),
      shoot_date: dateTbd ? '' : orderDlg.date,
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
      if (!dateTbd && orderDlg.date) {
        const periods = slots.length ? slots : ['full'];
        const exec = executors[0] || {};
        try {
          await http.post('/api/schedules', {
            date: orderDlg.date,
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

  return (
    <div onClick={onClose} className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-xl bg-white rounded-lg p-6 max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="font-medium" style={{ color: '#1f2329' }}>新增订单</div>
          <button onClick={onClose} className="text-muted text-sm hover:text-fg">✕</button>
        </div>

        <div className="space-y-4">
          {/* 1. 顾客信息 */}
          <section>
            <div className="text-sm font-medium mb-2" style={{ color: '#1f2329' }}>顾客信息</div>
            <input value={orderName} onChange={(e) => setOrderName(e.target.value)} placeholder="请输入订单名称"
              className="w-full mb-2 px-3 py-2 rounded bg-panel2 border border-line text-sm outline-none" style={{ color: '#1f2329' }} />
            <div className="flex items-center gap-2 mb-2">
              <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="顾客姓名"
                className="flex-1 px-3 py-2 rounded bg-panel2 border border-line text-sm outline-none" style={{ color: '#1f2329' }} />
              {phones.map((p, i) => (
                <div key={i} className="flex items-center gap-1">
                  <input value={p} onChange={(e) => setPhoneAt(i, e.target.value)} placeholder="添加电话"
                    className="w-32 px-3 py-2 rounded bg-panel2 border border-line text-sm outline-none" style={{ color: '#1f2329' }} />
                  {phones.length > 1 && <button onClick={() => removePhoneAt(i)} className="text-muted hover:text-fg text-xs px-1">✕</button>}
                </div>
              ))}
              <button onClick={addPhone} className="w-8 h-8 rounded border border-line bg-panel2 text-sm hover:bg-black/5" style={{ color: '#1f2329' }}>+</button>
            </div>
          </section>

          {/* 2. 日期 & 场次 */}
          <section>
            <div className="text-sm font-medium mb-2" style={{ color: '#1f2329' }}>日期 & 场次</div>
            <div className="text-xs mb-2 px-3 py-2 rounded bg-panel2 border border-line" style={{ color: '#1f2329' }}>
              {dateTbd ? '日期待定' : (orderDlg.date || '未选择日期')}
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer mb-2" style={{ color: '#1f2329' }}>
              <input type="checkbox" checked={chooseSession} onChange={(e) => onChooseSession(e.target.checked)} />
              选择场次（可多选）
            </label>
            {chooseSession && (
              <div className="flex flex-wrap gap-2 mb-2">
                {HOURS.map((h) => {
                  const on = slots.includes(h);
                  return (
                    <button key={h} onClick={() => toggleSlot(h)}
                      className={'px-2.5 py-1 rounded-lg text-xs border transition ' + (on ? 'bg-[#2e7d32] text-white border-[#2e7d32]' : 'bg-[#d5e8d4] text-[#2e7d32] border-[#bcdcbe]')}>
                      {h}
                    </button>
                  );
                })}
                {/* 半天 / 全天（样式与小时块一致，紧跟 23:00 之后） */}
                {[HALF, FULL].map((k) => {
                  const on = slots.includes(k);
                  return (
                    <button key={k} onClick={() => toggleSlot(k)}
                      className={'px-2.5 py-1 rounded-lg text-xs border transition ' + (on ? 'bg-[#2e7d32] text-white border-[#2e7d32]' : 'bg-[#d5e8d4] text-[#2e7d32] border-[#bcdcbe]')}>
                      {slotLabel(k)}
                    </button>
                  );
                })}
              </div>
            )}
            <label className="flex items-center gap-2 text-sm cursor-pointer mb-2" style={{ color: '#1f2329' }}>
              <input type="checkbox" checked={dateTbd} onChange={(e) => onDateTbd(e.target.checked)} />
              日期待定（不占具体日历日，仅作意向登记）
            </label>
            {dateTbd && <div className="text-[11px] mb-2 rounded px-2 py-1.5" style={{ background: '#fff9e6', color: '#b9742a' }}>该订单标记为日期待定，日期与场次已置灰，仅记录意向。</div>}
          </section>

          {/* 3. 套系相关 */}
          <section>
            <div className="text-sm font-medium mb-2" style={{ color: '#1f2329' }}>套系相关</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <select value={pkgId} onChange={(e) => onPickPackage(e.target.value)}
                className="px-3 py-2 rounded bg-panel2 border border-line text-sm outline-none" style={{ color: pkgId ? '#1f2329' : '#9ca3af' }}>
                <option value="">* 请选择套系名称</option>
                {pkgList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input value={pkgPrice} onChange={(e) => setPkgPrice(e.target.value)} placeholder="* 套系价格"
                className="px-3 py-2 rounded bg-panel2 border border-line text-sm outline-none" style={{ color: '#1f2329' }} />
              <input value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="* 套系定金"
                className="px-3 py-2 rounded bg-panel2 border border-line text-sm outline-none" style={{ color: '#1f2329' }} />
            </div>
          </section>

          {/* 4. 收款状态 */}
          <section>
            <div className="text-sm font-medium mb-2" style={{ color: '#1f2329' }}>收款状态 <span style={{ color: '#e4393c' }}>*</span></div>
            <select value={payStatus} onChange={(e) => setPayStatus(e.target.value)}
              className="w-full px-3 py-2 rounded bg-panel2 border border-line text-sm outline-none" style={{ color: '#1f2329' }}>
              <option value="unpaid">未付款</option>
              <option value="deposit">已付定金</option>
              <option value="paid">已付全款</option>
            </select>
          </section>

          {/* 5. 其他消费 */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium" style={{ color: '#1f2329' }}>其他消费</div>
              <button onClick={addExtra} className="text-xs px-2 py-1 rounded" style={{ background: '#2890F0', color: '#ffffff' }}>+ 添加</button>
            </div>
            {extras.map((e, i) => (
              <div key={i} className="flex items-center gap-2 mb-2">
                <input value={e.name} onChange={(ev) => setExtraAt(i, 'name', ev.target.value)} placeholder="消费名称"
                  className="flex-1 px-3 py-2 rounded bg-panel2 border border-line text-sm outline-none" style={{ color: '#1f2329' }} />
                <input value={e.amount} onChange={(ev) => setExtraAt(i, 'amount', ev.target.value)} placeholder="金额"
                  className="w-28 px-3 py-2 rounded bg-panel2 border border-line text-sm outline-none" style={{ color: '#1f2329' }} />
                <button onClick={() => removeExtraAt(i)} className="text-muted hover:text-fg text-xs px-1">✕</button>
              </div>
            ))}
          </section>

          {/* 6. 拍摄地点 */}
          <section>
            <div className="text-sm font-medium mb-2" style={{ color: '#1f2329' }}>拍摄地点</div>
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="如 三亚 / 工作室"
              className="w-full px-3 py-2 rounded bg-panel2 border border-line text-sm outline-none" style={{ color: '#1f2329' }} />
          </section>

          {/* 7. 备注 */}
          <section>
            <div className="text-sm font-medium mb-2" style={{ color: '#1f2329' }}>备注</div>
            <input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="如 婚礼跟拍 / 特殊要求"
              className="w-full px-3 py-2 rounded bg-panel2 border border-line text-sm outline-none" style={{ color: '#1f2329' }} />
          </section>

          {/* 8. 渠道来源 */}
          <section>
            <div className="text-sm font-medium mb-2" style={{ color: '#1f2329' }}>渠道来源</div>
            <select value={channelId} onChange={(e) => { const o = chList.find((x) => String(x.id) === e.target.value); onPickChannel(e.target.value, o ? o.name : ''); }}
              className="w-full px-3 py-2 rounded bg-panel2 border border-line text-sm outline-none" style={{ color: channelId ? '#1f2329' : '#9ca3af' }}>
              <option value="">请选择渠道来源</option>
              {chList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {/* 下拉最底部蓝色文字链接【渠道管理】 */}
            <a href="#/channels"
              onClick={(e) => { e.preventDefault(); window.location.hash = '#/channels'; }}
              className="inline-block mt-1.5 text-xs hover:underline cursor-pointer" style={{ color: '#2890F0' }}>渠道管理 ›</a>
          </section>

          {/* 9. 执行人 */}
          <section>
            <div className="text-sm font-medium mb-2" style={{ color: '#1f2329' }}>执行人</div>
            <div className="relative" ref={execPopRef}>
              <div className="flex flex-wrap items-center gap-2 min-h-[40px] px-3 py-2 rounded bg-panel2 border border-line">
                {executors.length === 0 && <span className="text-xs text-muted">未指派</span>}
                {executors.map((ex) => (
                  <span key={ex.id ?? ex.name} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs" style={{ background: '#eaf2fe', color: '#1d6fe0' }}>
                    {ex.avatar
                      ? <img src={ex.avatar} className="w-4 h-4 rounded-full" alt="" />
                      : <span className="w-4 h-4 rounded-full inline-flex items-center justify-center text-[9px]" style={{ background: '#2890F0', color: '#fff' }}>{(ex.name || '?').slice(0, 1)}</span>}
                    {ex.name}
                    <button onClick={() => removeExec(ex.id)} className="hover:opacity-70">✕</button>
                  </span>
                ))}
                <button onClick={() => setExecPop((v) => !v)} className="w-6 h-6 rounded-full border border-line text-sm hover:bg-black/5 flex items-center justify-center" style={{ color: '#1f2329' }}>+</button>
              </div>
              {execPop && (
                <div className="absolute left-0 mt-1 w-56 bg-white border border-line rounded-lg shadow-lg z-30 max-h-52 overflow-auto">
                  {personnel.length === 0 && <div className="px-3 py-2 text-xs text-muted">暂无人员</div>}
                  {personnel.map((p) => {
                    const on = executors.find((x) => String(x.id) === String(p.id));
                    return (
                      <button key={p.id} onClick={() => toggleExec(p)}
                        className={'w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-panel2 ' + (on ? 'bg-panel2' : '')} style={{ color: '#1f2329' }}>
                        {p.avatar
                          ? <img src={p.avatar} className="w-5 h-5 rounded-full" alt="" />
                          : <span className="w-5 h-5 rounded-full inline-flex items-center justify-center text-[10px]" style={{ background: '#2890F0', color: '#fff' }}>{(p.name || '?').slice(0, 1)}</span>}
                        {p.name}
                        {on && <span className="ml-auto" style={{ color: '#2890F0' }}>✓</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>

        {localErr && <div className="text-xs text-red-500 mt-3">{localErr}</div>}

        <div className="flex justify-center mt-5">
          <button onClick={save} className="px-10 py-2 rounded text-white text-sm hover:opacity-90" style={{ background: '#2890F0' }}>保存</button>
        </div>
      </div>
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
          className="w-full mb-3 px-2 py-2 rounded bg-panel2 border border-line text-sm outline-none disabled:opacity-50" style={{ color: '#1f2329' }} />

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
          className="w-full mb-3 px-2 py-2 rounded bg-panel2 border border-line text-sm outline-none" style={{ color: '#1f2329' }}>
          <option value="">未指派</option>
          {personnel.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <label className="text-xs text-muted">备注</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="如 婚礼跟拍 / 备注"
          className="w-full mb-3 px-2 py-2 rounded bg-panel2 border border-line text-sm outline-none" style={{ color: '#1f2329' }} />

        {localErr && <div className="text-xs text-red-500 mb-2">{localErr}</div>}

        <div className="flex gap-2 justify-end mt-2">
          <button onClick={onClose} className="px-4 py-2 rounded border border-line text-muted text-sm hover:bg-panel2">取消</button>
          <button onClick={save} className="px-4 py-2 rounded text-white text-sm hover:opacity-90" style={{ background: '#2890F0' }}>确认</button>
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
    http.get('/api/settings/booking').then((r) => { if (r.data) setCfg({ open: r.data.open !== false, openDays: Array.isArray(r.data.openDays) ? r.data.openDays : [0,1,2,3,4,5,6] }); }).catch(() => {}).finally(() => setLoading(false));
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
                  className={'px-2 py-1.5 rounded text-xs border ' + (cfg.openDays.includes(d) ? 'bg-brand text-white border-brand' : 'bg-panel2 text-muted border-line')}>{lab}</button>
              ))}
            </div>
            {saved && <div className="text-xs text-emerald-500 mb-2">已保存</div>}
            <div className="flex gap-2 justify-end">
              <button onClick={onClose} className="px-4 py-2 rounded border border-line text-muted text-sm hover:bg-panel2">取消</button>
              <button onClick={save} className="px-4 py-2 rounded text-white text-sm hover:opacity-90" style={{ background: '#2890F0' }}>保存</button>
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
