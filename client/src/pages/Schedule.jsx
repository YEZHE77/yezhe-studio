import React, { useState, useEffect, useRef } from 'react';
import http from '../api.js';
import { useViewState } from '../tabMemory.js';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + ':00');
const HALF = 'half';
const FULL = 'full';
const OPEN_DAYS_LABEL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const SSTATUS = { free: '空闲', booked: '已约', locked: '锁场', closed: '已关闭', shoot: '等待拍摄', pending: '待确认' };

const pad = (n) => String(n).padStart(2, '0');
// 日期聚合着色：closed > unpaid(黄) > wait(绿) > free
function dayState(rows) {
  const hasClosed = rows.some((r) => r.status === 'closed');
  const orderRows = rows.filter((r) => r.order_no && (r.order_customer || r.order_status || r.order_pay_status));
  const hasUnpaid = orderRows.some((r) => r.order_pay_status === 'unpaid');
  const hasWait = orderRows.length > 0;
  let kind = 'free';
  if (hasClosed) kind = 'closed';
  else if (hasUnpaid) kind = 'unpaid';
  else if (hasWait) kind = 'wait';
  return { hasClosed, hasUnpaid, hasWait, orderRows, kind };
}

// 订单状态说明 —— 8 个状态配色（与日历着色/订单中心一致）
const ORDER_STATUS_TIP = [
  { label: '未付定金', bg: '#fff2cc', border: '#e6c200', fg: '#8a6d00' },
  { label: '等待拍摄', bg: '#d5e8d4', border: '#9ccc9c', fg: '#2e7d32' },
  { label: '待上传原片', bg: '#cfe8ff', border: '#9cc8f0', fg: '#1f6fb2' },
  { label: '待选片', bg: '#e6dcff', border: '#c4b5fd', fg: '#6d4bd1' },
  { label: '待精修', bg: '#cdeef0', border: '#8fdfe3', fg: '#127a82' },
  { label: '等待下载', bg: '#cdeee2', border: '#8fd9c2', fg: '#1f8a68' },
  { label: '待评价', bg: '#ffe6cc', border: '#f5c58c', fg: '#b9742a' },
  { label: '订单已完成', bg: '#eceef0', border: '#d6d9dd', fg: '#5b6168' }
];

export default function Schedule() {
  const init = new Date();
  const initMonth = `${init.getFullYear()}-${pad(init.getMonth() + 1)}`;
  const [state, setState] = useViewState('schedule', { month: initMonth, executor: '' });
  const [map, setMap] = useState({});
  const [pendMap, setPendMap] = useState({});
  const [personnel, setPersonnel] = useState([]);
  const [lunarMap, setLunarMap] = useState({});
  const [selDate, setSelDate] = useState('');
  const [err, setErr] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all | unpaid | wait
  const [advOpen, setAdvOpen] = useState(false);
  const [dlg, setDlg] = useState(null); // 编辑档期弹窗（保留原档期编辑逻辑）
  const [orderDlg, setOrderDlg] = useState(null); // 新增订单弹窗（原「添加档期」入口）
  const [booking, setBooking] = useState(null); // 档期及预约设置弹窗
  const [share, setShare] = useState(null); // 分享档期弹窗 { share_url, qr_url }
  const advRef = useRef(null);

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

  return (
    <div className="max-w-6xl mx-auto pb-10">
      {/* 面包屑由全局 <Breadcrumb /> 渲染 */}
      <h1 className="text-xl font-semibold mb-4" style={{ color: '#1f2329' }}>档期</h1>

      {/* 顶部筛选区：平铺在页面容器内（非独立白卡片） */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* 图例 + 订单状态说明悬浮提示 */}
        <StatusLegend />

        <div className="flex items-center gap-2">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2 py-1.5 rounded border border-line bg-white text-sm outline-none" style={{ color: '#1f2329' }}>
            <option value="all">全部档期</option>
            <option value="unpaid">未付定金</option>
            <option value="wait">等待拍摄</option>
          </select>
        </div>

        <div className="flex-1" />

        {/* 年月控件 */}
        <div className="flex items-center gap-1">
          <button onClick={() => shiftMonth(-1)} className="w-8 h-8 rounded border border-line bg-white hover:bg-panel2" style={{ color: '#1f2329' }}>‹</button>
          <select value={y} onChange={(e) => setYM(Number(e.target.value), m)} className="px-2 py-1.5 rounded border border-line bg-white text-sm outline-none" style={{ color: '#1f2329' }}>
            {Array.from({ length: 6 }, (_, i) => y - 2 + i).map((yy) => <option key={yy} value={yy}>{yy}年</option>)}
          </select>
          <select value={m} onChange={(e) => setYM(y, Number(e.target.value))} className="px-2 py-1.5 rounded border border-line bg-white text-sm outline-none" style={{ color: '#1f2329' }}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((mm) => <option key={mm} value={mm}>{mm}月</option>)}
          </select>
          <button onClick={() => shiftMonth(1)} className="w-8 h-8 rounded border border-line bg-white hover:bg-panel2" style={{ color: '#1f2329' }}>›</button>
        </div>

        {/* 筛选账号 */}
        <select value={state.executor} onChange={(e) => setState((s) => ({ ...s, executor: e.target.value }))}
          className="px-2 py-1.5 rounded border border-line bg-white text-sm outline-none" style={{ color: '#1f2329' }}>
          <option value="">筛选账号</option>
          {personnel.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        {/* 高级选项（黑色按钮） */}
        <div className="relative" ref={advRef}>
          <button onClick={() => setAdvOpen((v) => !v)} className="px-3 py-1.5 rounded bg-[#1f2329] text-white text-sm hover:opacity-90">高级选项 ▾</button>
          {advOpen && (
            <div className="absolute right-0 mt-1 w-44 bg-white border border-line rounded-lg shadow-lg z-30 overflow-hidden">
              <button onClick={() => { setAdvOpen(false); setBooking({ open: true, openDays: [0,1,2,3,4,5,6] }); }} className="w-full text-left px-3 py-2.5 text-sm hover:bg-panel2" style={{ color: '#1f2329' }}>档期及预约设置</button>
              <button onClick={async () => { setAdvOpen(false); try { const r = await http.post('/api/schedules/share'); setShare(r.data); } catch (e) { setErr((e.response && e.response.data && e.response.data.error) || '生成分享失败'); } }} className="w-full text-left px-3 py-2.5 text-sm hover:bg-panel2 flex items-center gap-1" style={{ color: '#1f2329' }}>分享档期 <span className="ml-1 text-[10px] bg-brand text-white rounded px-1">new</span></button>
              <button onClick={doExport} className="w-full text-left px-3 py-2.5 text-sm hover:bg-panel2" style={{ color: '#1f2329' }}>导出 Excel</button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* 日历（平铺，无独立白卡片） */}
        <div className="lg:col-span-3">
          <div className="grid grid-cols-7 gap-2 mb-2">
            {WEEK.map((w) => <div key={w} className="text-center text-xs py-1" style={{ color: '#6b7280' }}>{w}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-2">
            {cells.map((day, i) => {
              if (day == null) return <div key={i} />;
              const date = `${y}-${pad(m)}-${pad(day)}`;
              const rows = map[date] || [];
              const pends = pendMap[date] || [];
              const st = dayState(rows);
              const isSel = selDate === date;
              const lunar = lunarMap[date] || '';
              let cellCls = 'bg-panel2 border-line';
              let style = {};
              if (st.kind === 'closed') { cellCls = 'border-line'; style = { background: 'repeating-linear-gradient(45deg,#eee,#eee 6px,#e3e3e3 6px,#e3e3e3 12px)', color: '#888' }; }
              else if (st.kind === 'unpaid' || st.kind === 'wait') { cellCls = 'border border-[#ffb3c8]'; style = { background: '#ffe1e8' }; }

              if (statusFilter !== 'all') {
                const ok = statusFilter === 'unpaid' ? st.kind === 'unpaid' : st.kind === 'wait';
                if (!ok && st.kind !== 'closed') style = { ...style, opacity: 0.35 };
              }

              return (
                <div key={i} onClick={() => setSelDate(date)}
                  className={'min-h-[84px] rounded-lg border p-2 text-left transition cursor-pointer flex flex-col ' + (isSel ? 'ring-2 ring-brand ' : '') + cellCls}
                  style={style}>
                  <div className="flex items-center justify-between">
                    <span className={'text-sm ' + (st.kind === 'closed' ? 'text-[#888]' : 'text-fg')}>{day}</span>
                    {pends.length > 0 && <span className="w-2 h-2 rounded-full bg-amber-400" />}
                  </div>
                  {lunar && <div className={'text-[10px] leading-tight ' + (st.kind === 'closed' ? 'text-[#999]' : 'text-muted')}>{lunar}</div>}
                  {st.kind === 'closed' && <div className="mt-1 text-[11px] text-[#888]">档期已关闭</div>}
                  {st.kind !== 'closed' && st.orderRows[0] && (
                    <div className="mt-1">
                      <div className="text-xs truncate" style={{ color: '#7a1f3d' }}>{st.orderRows[0].order_customer || st.orderRows[0].order_no}</div>
                      <div className="text-[10px] text-muted truncate">{st.orderRows[0].order_no || (st.orderRows[0].periods && st.orderRows[0].periods.join('/'))}</div>
                    </div>
                  )}
                  {st.kind !== 'closed' && !st.orderRows[0] && rows[0] && (
                    <div className="mt-1">
                      <div className="text-xs truncate" style={{ color: '#1f2329' }}>{rows[0].photographer || SSTATUS[rows[0].status] || '档期'}</div>
                      <div className="text-[10px] text-muted truncate">{rows[0].periods && rows[0].periods.length ? rows[0].periods.join('/') : (rows[0].period || '全天')}</div>
                    </div>
                  )}
                  {pends.length > 0 && <div className="mt-1 text-[10px] text-amber-500 truncate">待确认 ×{pends.length}</div>}
                  {rows.length > 1 && <div className="text-[10px] text-muted mt-0.5">+{rows.length - 1} 档期</div>}
                  {/* 底部：左下角 +添加 / 右下角 订单数量 */}
                  <div className="mt-auto flex items-end justify-between gap-1 pt-1">
                    <button onClick={(e) => { e.stopPropagation(); openNew(day); }}
                      className="inline-flex items-center gap-0.5 px-2 py-1 rounded text-white text-[11px] hover:opacity-90"
                      style={{ background: '#2f7cf6' }}>+ 添加</button>
                    {st.orderRows.length > 0 && (
                      <span className="shrink-0 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-medium" style={{ background: '#ff7aa2', color: '#ffffff' }}>{st.orderRows.length}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 右侧固定深色面板 #333 */}
        <div className="lg:sticky lg:top-4 self-start rounded-lg shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-4" style={{ background: '#333333' }}>
          <div className="text-xs mb-2" style={{ color: '#b9bdc4' }}>{selDate ? `${selParts[0]}年${selParts[1]}月` : '未选择日期'}</div>
          <div className="w-16 h-16 rounded-full flex items-center justify-center mb-2" style={{ background: '#ffce3a' }}>
            <span className="text-2xl font-bold" style={{ color: '#333333' }}>{selParts[2] || '--'}</span>
          </div>
          <div className="text-xs mb-3" style={{ color: '#b9bdc4' }}>{selDate ? (lunarMap[selDate] || '') : '点击日历选择日期'}</div>
          <div className="border-t mb-3" style={{ borderColor: 'rgba(255,255,255,0.12)' }} />

          <div className="max-h-[52vh] overflow-auto mb-3">
            {!selDate && <div className="text-xs py-6 text-center" style={{ color: '#b9bdc4' }}>点击左侧日历日期，查看当日档期安排。</div>}
            {selDate && dayRows.length === 0 && dayPends.length === 0 && <div className="text-xs py-6 text-center" style={{ color: '#b9bdc4' }}>无档期安排</div>}

            {dayRows.map((s) => (
              <div key={s.id} className="flex items-start justify-between rounded-lg p-3 mb-2" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                <div className="min-w-0">
                  <div className="text-sm" style={{ color: '#ffffff' }}>{s.periods && s.periods.length ? s.periods.join('、') : (SSTATUS[s.status] || s.period || '全天')}</div>
                  <div className="text-[11px] mt-0.5" style={{ color: '#b9bdc4' }}>
                    {s.order_customer ? `客户：${s.order_customer}` : (s.executor_name || s.photographer || '未指派')}
                    {s.order_no ? ' · ' + s.order_no : ''}
                  </div>
                  {s.order_pay_status === 'unpaid' && <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded" style={{ background: '#fff2cc', color: '#8a6d00' }}>未付定</span>}
                  {s.order_status === 'deposit' && <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded" style={{ background: '#d5e8d4', color: '#2e7d32' }}>等待拍</span>}
                  {s.date_tbd ? <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded ml-1" style={{ background: 'rgba(255,255,255,0.12)', color: '#e5c07b' }}>日期待定</span> : null}
                </div>
                <button onClick={() => openEdit(s)} className="shrink-0 ml-2 px-2 py-1 rounded text-xs hover:opacity-80" style={{ color: '#ffffff', border: '1px solid rgba(255,255,255,0.25)' }}>编辑</button>
              </div>
            ))}

            {dayPends.map((a) => (
              <div key={a.id} className="border rounded-lg p-3 mb-2" style={{ background: 'rgba(251,191,36,0.12)', borderColor: 'rgba(251,191,36,0.4)' }}>
                <div className="flex items-center justify-between">
                  <div className="text-sm truncate" style={{ color: '#ffffff' }}>{a.name} · {a.phone}</div>
                  <div className="text-[11px] shrink-0 ml-2" style={{ color: '#fbbf24' }}>{a.period ? (a.period === 'full' ? '全天' : '半天') : ''}</div>
                </div>
                {a.package_name && <div className="text-[11px]" style={{ color: '#b9bdc4' }}>套系：{a.package_name}</div>}
                {a.remark && <div className="text-[11px]" style={{ color: '#b9bdc4' }}>备注：{a.remark}</div>}
                <div className="flex gap-2 mt-2 justify-end">
                  <button onClick={async () => { if (!confirm(`拒绝「${a.name}」的预约？`)) return; try { await http.post('/api/admin/appointments/' + a.id + '/reject', { reason: '该日期已排满' }); load(); } catch (e) { alert((e.response && e.response.data && e.response.data.error) || '拒绝失败'); } }} className="px-2 py-1 rounded text-xs" style={{ color: '#f87171', border: '1px solid rgba(248,113,113,0.4)' }}>拒绝</button>
                  <button onClick={async () => { if (!a.hope_date) return alert('该预约缺少期望日期'); if (!confirm(`接受「${a.name}」的预约并生成订单、锁定档期？`)) return; try { await http.post('/api/admin/appointments/' + a.id + '/confirm', { date: a.hope_date, period: a.period || 'full', photographer: a.photographer || '' }); alert('已接受：订单已生成并锁定档期'); load(); } catch (e) { alert((e.response && e.response.data && e.response.data.error) || '接受失败'); } }} className="px-2 py-1 rounded text-white text-xs" style={{ background: '#2f7cf6' }}>接受并锁档期</button>
                </div>
              </div>
            ))}
          </div>

          <button onClick={() => openNew(selDate ? Number(selDate.slice(8, 10)) : null)} className="w-full px-3 py-2 rounded text-white text-sm hover:opacity-90" style={{ background: '#2f7cf6' }}>+ 添加档期</button>
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
  );
}

/* ============ 图例 + 订单状态说明悬浮提示框 ============ */
function StatusLegend() {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false); // 窄屏点击固定
  const wrapRef = useRef(null);
  const close = () => { setOpen(false); setPinned(false); };

  const isTouch = () => typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(hover: none)').matches;
  useEffect(() => {
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) close(); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const show = open || pinned;

  return (
    <div className="relative" ref={wrapRef}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => { if (!pinned) setOpen(false); }}
      onClick={(e) => { if (isTouch()) { e.preventDefault(); setPinned((v) => !v); } }}>
      <div className="flex items-center gap-3 text-xs cursor-pointer select-none" style={{ color: '#6b7280' }}>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: '#fff2cc', border: '1px solid #e6c200' }} />未付定</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: '#d5e8d4', border: '1px solid #9ccc9c' }} />等待拍</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: 'repeating-linear-gradient(45deg,#eee,#eee 4px,#cfcfcf 4px,#cfcfcf 8px)' }} />已关闭</span>
        {/* 触发箭头 */}
        <span className="inline-flex items-center gap-0.5 ml-1 px-1.5 py-0.5 rounded hover:bg-panel2">
          订单状态说明
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m6 9 6 6 6-6" /></svg>
        </span>
      </div>

      {show && (
        <div className="absolute left-0 top-full mt-2 z-40 bg-white rounded-md p-3 w-56"
          style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.12)' }}>
          {/* 小三角 */}
          <span className="absolute -top-1.5 left-6 w-3 h-3 rotate-45 bg-white" style={{ boxShadow: '-2px -2px 4px rgba(0,0,0,0.04)' }} />
          <div className="text-xs font-medium mb-2" style={{ color: '#1f2329' }}>订单状态说明</div>
          <div className="space-y-1.5">
            {ORDER_STATUS_TIP.map((s) => (
              <div key={s.label} className="flex items-center gap-2">
                <span className="w-3 h-3 rounded shrink-0" style={{ background: s.bg, border: `1px solid ${s.border}` }} />
                <span className="text-xs" style={{ color: s.fg }}>{s.label}</span>
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
              <button onClick={addExtra} className="text-xs px-2 py-1 rounded" style={{ background: '#2f7cf6', color: '#ffffff' }}>+ 添加</button>
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
              className="inline-block mt-1.5 text-xs hover:underline cursor-pointer" style={{ color: '#2f7cf6' }}>渠道管理 ›</a>
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
                      : <span className="w-4 h-4 rounded-full inline-flex items-center justify-center text-[9px]" style={{ background: '#2f7cf6', color: '#fff' }}>{(ex.name || '?').slice(0, 1)}</span>}
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
                          : <span className="w-5 h-5 rounded-full inline-flex items-center justify-center text-[10px]" style={{ background: '#2f7cf6', color: '#fff' }}>{(p.name || '?').slice(0, 1)}</span>}
                        {p.name}
                        {on && <span className="ml-auto" style={{ color: '#2f7cf6' }}>✓</span>}
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
          <button onClick={save} className="px-10 py-2 rounded text-white text-sm hover:opacity-90" style={{ background: '#2f7cf6' }}>保存</button>
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
          <button onClick={save} className="px-4 py-2 rounded text-white text-sm hover:opacity-90" style={{ background: '#2f7cf6' }}>确认</button>
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
              <button onClick={save} className="px-4 py-2 rounded text-white text-sm hover:opacity-90" style={{ background: '#2f7cf6' }}>保存</button>
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
