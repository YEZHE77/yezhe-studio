import React, { useState, useEffect, useRef } from 'react';
import http from '../api.js';
import { useViewState } from '../tabMemory.js';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + ':00');
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
  const [advOpen, setAdvOpen] = useState(false);
  const [dlg, setDlg] = useState(null); // 档期弹窗 { id, date, periods, date_tbd, executor_id, executor_name, status, order_no, note, photographer, groom_name, bride_name, contact_phone, address }
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
    setErr(''); setDlg({ id: null, date, periods: [], date_tbd: 0, executor_id: '', executor_name: '', status: 'free', order_no: '', note: '', photographer: '', groom_name: '', bride_name: '', contact_phone: '', address: '' });
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

  return (
    <div className="max-w-6xl mx-auto">
      {/* 面包屑由全局 <Breadcrumb /> 渲染 */}
      <h1 className="text-xl font-semibold text-white mb-3">档期日历</h1>

      {/* 顶部工具栏 */}
      <div className="bg-panel rounded-lg shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* 状态图例 */}
          <div className="flex items-center gap-3 text-xs text-muted mr-2">
            <Legend cls="border border-[#e6c200]" bg="#fff2cc" label="黄=未付定" />
            <Legend cls="border border-[#9ccc9c]" bg="#d5e8d4" label="绿=等待拍" />
            <Legend cls="border border-line" striped label="灰=档期已关闭" />
          </div>

          <div className="flex-1" />

          {/* 年月控件 */}
          <div className="flex items-center gap-1">
            <button onClick={() => shiftMonth(-1)} className="w-8 h-8 rounded border border-line bg-panel2 text-white hover:bg-black/5">‹</button>
            <select value={y} onChange={(e) => setYM(Number(e.target.value), m)} className="px-2 py-1.5 rounded border border-line bg-panel2 text-white text-sm outline-none">
              {Array.from({ length: 6 }, (_, i) => y - 2 + i).map((yy) => <option key={yy} value={yy}>{yy}年</option>)}
            </select>
            <select value={m} onChange={(e) => setYM(y, Number(e.target.value))} className="px-2 py-1.5 rounded border border-line bg-panel2 text-white text-sm outline-none">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((mm) => <option key={mm} value={mm}>{mm}月</option>)}
            </select>
            <button onClick={() => shiftMonth(1)} className="w-8 h-8 rounded border border-line bg-panel2 text-white hover:bg-black/5">›</button>
          </div>

          {/* 执行人筛选 */}
          <select value={state.executor} onChange={(e) => setState((s) => ({ ...s, executor: e.target.value }))}
            className="px-2 py-1.5 rounded border border-line bg-panel2 text-white text-sm outline-none">
            <option value="">全部执行人</option>
            {personnel.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          {/* 高级选项 */}
          <div className="relative" ref={advRef}>
            <button onClick={() => setAdvOpen((v) => !v)} className="px-3 py-1.5 rounded border border-line bg-panel2 text-white text-sm hover:bg-black/5">高级选项 ▾</button>
            {advOpen && (
              <div className="absolute right-0 mt-1 w-44 bg-panel border border-line rounded-lg shadow-lg z-30 overflow-hidden">
                <button onClick={() => { setAdvOpen(false); setBooking({ open: true, openDays: [0,1,2,3,4,5,6] }); }} className="w-full text-left px-3 py-2.5 text-sm text-white hover:bg-panel2">档期及预约设置</button>
                <button onClick={async () => { setAdvOpen(false); try { const r = await http.post('/api/schedules/share'); setShare(r.data); } catch (e) { setErr((e.response && e.response.data && e.response.data.error) || '生成分享失败'); } }} className="w-full text-left px-3 py-2.5 text-sm text-white hover:bg-panel2">分享档期 <span className="ml-1 text-[10px] bg-brand text-white rounded px-1">new</span></button>
                <button onClick={doExport} className="w-full text-left px-3 py-2.5 text-sm text-white hover:bg-panel2">导出 Excel</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* 日历 */}
        <div className="lg:col-span-3 bg-panel rounded-lg shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-4">
          <div className="grid grid-cols-7 gap-2 mb-2">
            {WEEK.map((w) => <div key={w} className="text-center text-xs text-muted py-1">{w}</div>)}
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
              else if (st.kind === 'unpaid') { cellCls = 'border border-[#e6c200]'; style = { background: '#fff2cc' }; }
              else if (st.kind === 'wait') { cellCls = 'border border-[#9ccc9c]'; style = { background: '#d5e8d4' }; }
              return (
                <button key={i} onClick={() => setSelDate(date)}
                  className={'min-h-[84px] rounded-lg border p-2 text-left transition ' + (isSel ? 'ring-2 ring-brand ' : '') + cellCls}
                  style={style}>
                  <div className="flex items-center justify-between">
                    <span className={'text-sm ' + (st.kind === 'closed' ? 'text-[#888]' : 'text-white')}>{day}</span>
                    {pends.length > 0 && <span className="w-2 h-2 rounded-full bg-amber-400" />}
                  </div>
                  {lunar && <div className={'text-[10px] leading-tight ' + (st.kind === 'closed' ? 'text-[#999]' : 'text-muted')}>{lunar}</div>}
                  {st.kind === 'closed' && <div className="mt-1 text-[11px] text-[#888]">档期已关闭</div>}
                  {st.kind !== 'closed' && st.orderRows[0] && (
                    <div className="mt-1">
                      <div className="text-xs text-white truncate">{st.orderRows[0].order_customer || st.orderRows[0].order_no}</div>
                      <div className="text-[10px] text-muted truncate">{st.orderRows[0].order_no || (st.orderRows[0].periods && st.orderRows[0].periods.join('/'))}</div>
                    </div>
                  )}
                  {st.kind !== 'closed' && !st.orderRows[0] && rows[0] && (
                    <div className="mt-1">
                      <div className="text-xs text-white truncate">{rows[0].photographer || SSTATUS[rows[0].status] || '档期'}</div>
                      <div className="text-[10px] text-muted truncate">{rows[0].periods && rows[0].periods.length ? rows[0].periods.join('/') : (rows[0].period || '全天')}</div>
                    </div>
                  )}
                  {pends.length > 0 && <div className="mt-1 text-[10px] text-amber-500 truncate">待确认 ×{pends.length}</div>}
                  {rows.length > 1 && <div className="text-[10px] text-muted mt-0.5">+{rows.length - 1} 档期</div>}
                </button>
              );
            })}
          </div>
        </div>

        {/* 右侧固定悬浮面板 */}
        <div className="lg:sticky lg:top-4 self-start bg-panel rounded-lg shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-4">
          <div className="text-sm text-white font-medium mb-1">{selDate ? selDate : '未选择日期'}</div>
          <div className="text-xs text-muted mb-3">{selDate ? (lunarMap[selDate] || '') : '点击日历选择日期'}</div>

          <div className="max-h-[52vh] overflow-auto mb-3">
            {!selDate && <div className="text-xs text-muted">点击左侧日历日期，查看当日档期安排。</div>}
            {selDate && dayRows.length === 0 && dayPends.length === 0 && <div className="text-xs text-muted py-6 text-center">无档期安排</div>}

            {dayRows.map((s) => (
              <div key={s.id} className="flex items-start justify-between bg-panel2 border border-line rounded-lg p-3 mb-2">
                <div className="min-w-0">
                  <div className="text-white text-sm">{s.periods && s.periods.length ? s.periods.join('、') : (SSTATUS[s.status] || s.period || '全天')}</div>
                  <div className="text-[11px] text-muted mt-0.5">
                    {s.order_customer ? `客户：${s.order_customer}` : (s.executor_name || s.photographer || '未指派')}
                    {s.order_no ? ' · ' + s.order_no : ''}
                  </div>
                  {s.order_pay_status === 'unpaid' && <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded" style={{ background: '#fff2cc', color: '#8a6d00' }}>未付定</span>}
                  {s.order_status === 'deposit' && <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded" style={{ background: '#d5e8d4', color: '#2e7d32' }}>等待拍</span>}
                  {s.date_tbd ? <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 ml-1">日期待定</span> : null}
                </div>
                <button onClick={() => openEdit(s)} className="shrink-0 ml-2 px-2 py-1 rounded border border-line text-white text-xs hover:bg-black/5">编辑</button>
              </div>
            ))}

            {dayPends.map((a) => (
              <div key={a.id} className="bg-amber-400/10 border border-amber-400/40 rounded-lg p-3 mb-2">
                <div className="flex items-center justify-between">
                  <div className="text-white text-sm truncate">{a.name} · {a.phone}</div>
                  <div className="text-[11px] text-amber-500 shrink-0 ml-2">{a.period ? (a.period === 'full' ? '全天' : '半天') : ''}</div>
                </div>
                {a.package_name && <div className="text-[11px] text-muted">套系：{a.package_name}</div>}
                {a.remark && <div className="text-[11px] text-muted">备注：{a.remark}</div>}
                <div className="flex gap-2 mt-2 justify-end">
                  <button onClick={async () => { if (!confirm(`拒绝「${a.name}」的预约？`)) return; try { await http.post('/api/admin/appointments/' + a.id + '/reject', { reason: '该日期已排满' }); load(); } catch (e) { alert((e.response && e.response.data && e.response.data.error) || '拒绝失败'); } }} className="px-2 py-1 rounded border border-line text-red-500 text-xs">拒绝</button>
                  <button onClick={async () => { if (!a.hope_date) return alert('该预约缺少期望日期'); if (!confirm(`接受「${a.name}」的预约并生成订单、锁定档期？`)) return; try { await http.post('/api/admin/appointments/' + a.id + '/confirm', { date: a.hope_date, period: a.period || 'full', photographer: a.photographer || '' }); alert('已接受：订单已生成并锁定档期'); load(); } catch (e) { alert((e.response && e.response.data && e.response.data.error) || '接受失败'); } }} className="px-2 py-1 rounded bg-brand text-white text-xs">接受并锁档期</button>
                </div>
              </div>
            ))}
          </div>

          <button onClick={() => openNew(selDate ? Number(selDate.slice(8, 10)) : null)} className="w-full px-3 py-2 rounded bg-brand text-white text-sm hover:opacity-90">+ 添加档期</button>
        </div>
      </div>

      {err && <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-red-500 text-white text-sm px-4 py-2 rounded shadow-lg z-50">{err}</div>}

      {/* 档期弹窗 */}
      {dlg && <ScheduleDialog dlg={dlg} personnel={personnel} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); load(); }} />}

      {/* 档期及预约设置 */}
      {booking && <BookingDialog onClose={() => setBooking(null)} />}

      {/* 分享档期 */}
      {share && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-sm bg-panel rounded-lg p-6">
            <div className="flex items-center justify-between mb-3">
              <div className="text-white font-medium">分享档期</div>
              <button onClick={() => setShare(null)} className="text-muted text-sm hover:text-white">✕</button>
            </div>
            <img src={share.qr_url} className="w-40 h-40 rounded bg-white mx-auto" alt="qr" />
            <div className="text-[11px] text-muted break-all mt-3">{share.share_url}</div>
            <button onClick={() => navigator.clipboard && navigator.clipboard.writeText(share.share_url)} className="w-full mt-3 px-3 py-2 rounded border border-line text-white text-sm hover:bg-panel2">复制链接</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Legend({ cls, bg, striped, label }) {
  const style = striped
    ? { background: 'repeating-linear-gradient(45deg,#eee,#eee 4px,#cfcfcf 4px,#cfcfcf 8px)' }
    : bg ? { background: bg } : {};
  return (
    <span className="flex items-center gap-1">
      <span className={'w-3 h-3 rounded ' + (cls || '')} style={style} />
      {label}
    </span>
  );
}

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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-panel rounded-lg p-6 max-h-[88vh] overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="text-white font-medium">{dlg.id ? '编辑档期' : '添加档期'}</div>
          <button onClick={onClose} className="text-muted text-sm hover:text-white">✕</button>
        </div>

        {/* 日期选择器 */}
        <label className="text-xs text-muted">拍摄日期</label>
        <input type="date" value={date} disabled={dateTbd} onChange={(e) => setDate(e.target.value)}
          className="w-full mb-3 px-2 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none disabled:opacity-50" />

        {/* 选择场次 */}
        <label className="flex items-center gap-2 text-sm text-white cursor-pointer mb-2">
          <input type="checkbox" checked={chooseSession} onChange={(e) => onChooseSession(e.target.checked)} />
          选择场次（可多选小时时间段）
        </label>
        {chooseSession && (
          <div className="flex flex-wrap gap-2 mb-3">
            {HOURS.map((h) => {
              const on = periods.includes(h);
              return (
                <button key={h} onClick={() => togglePeriod(h)}
                  className={'px-2.5 py-1 rounded-lg text-xs border transition ' + (on ? 'bg-brand text-white border-brand' : 'bg-[#d5e8d4] text-[#2e7d32] border-[#bcdcbe]')}>
                  {h}
                </button>
              );
            })}
          </div>
        )}

        {/* 日期待定（互斥） */}
        <label className="flex items-center gap-2 text-sm text-white cursor-pointer mb-2">
          <input type="checkbox" checked={dateTbd} onChange={(e) => onDateTbd(e.target.checked)} />
          日期待定（不占具体日历日，仅作意向登记）
        </label>
        {dateTbd && <div className="text-[11px] text-amber-600 mb-3 rounded px-2 py-1.5" style={{ background: '#fff9e6' }}>该档期标记为日期待定，日期与场次已置灰，仅记录意向。</div>}

        {/* 执行人 */}
        <label className="text-xs text-muted">绑定执行人</label>
        <select value={executorId} onChange={(e) => { setExecutorId(e.target.value); const p = personnel.find((x) => String(x.id) === e.target.value); setExecutorName(p ? p.name : ''); }}
          className="w-full mb-3 px-2 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none">
          <option value="">未指派</option>
          {personnel.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <label className="text-xs text-muted">备注</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="如 婚礼跟拍 / 备注"
          className="w-full mb-3 px-2 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />

        {localErr && <div className="text-xs text-red-500 mb-2">{localErr}</div>}

        <div className="flex gap-2 justify-end mt-2">
          <button onClick={onClose} className="px-4 py-2 rounded border border-line text-muted text-sm hover:bg-panel2">取消</button>
          <button onClick={save} className="px-4 py-2 rounded bg-brand text-white text-sm hover:opacity-90">确认</button>
        </div>
      </div>
    </div>
  );
}

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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="w-full max-w-sm bg-panel rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="text-white font-medium">档期及预约设置</div>
          <button onClick={onClose} className="text-muted text-sm hover:text-white">✕</button>
        </div>
        {loading ? <div className="text-xs text-muted">加载中…</div> : (
          <>
            <label className="flex items-center justify-between text-sm text-white mb-4">
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
              <button onClick={save} className="px-4 py-2 rounded bg-brand text-white text-sm hover:opacity-90">保存</button>
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
