import React, { useState, useEffect } from 'react';
import http from '../api.js';
import { useViewState } from '../tabMemory.js';

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];
const STATUS = {
  free: { label: '空闲', dot: 'bg-emerald-500', cls: 'border-line' },
  booked: { label: '已排', dot: 'bg-amber-500', cls: 'border-amber-500/40 bg-amber-500/5' },
  locked: { label: '锁场', dot: 'bg-red-500', cls: 'border-red-500/40 bg-red-500/5' }
};

export default function Schedule() {
  const initMonth = new Date().toISOString().slice(0, 7);
  const [state, setState] = useViewState('schedule', { month: initMonth, sel: '' });
  const [map, setMap] = useState({}); // date -> [rows]
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(null); // {id?, date, period, status, photographer, note, order_no}

  const [y, m] = state.month.split('-').map(Number);

  const load = () => {
    http.get('/api/schedules?month=' + state.month).then((r) => {
      const nm = {};
      for (const s of r.data) { (nm[s.date] = nm[s.date] || []).push(s); }
      setMap(nm);
    }).catch(() => {});
  };
  useEffect(load, [state.month]);

  const cells = buildMonth(y, m - 1);

  const shiftMonth = (delta) => {
    const d = new Date(y, m - 1 + delta, 1);
    setState((s) => ({ ...s, month: d.toISOString().slice(0, 7), sel: '' }));
  };

  const openNew = (day) => {
    const date = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    setErr('');
    setEditing({ id: null, date, period: 'full', status: 'booked', photographer: '', note: '', order_no: '' });
  };
  const openEdit = (row) => {
    setErr('');
    setEditing({ id: row.id, date: row.date, period: row.period, status: row.status, photographer: row.photographer || '', note: row.note || '', order_no: row.order_no || '' });
  };

  async function save() {
    setErr('');
    const payload = { date: editing.date, period: editing.period, status: editing.status, photographer: editing.photographer, note: editing.note, order_no: editing.order_no };
    try {
      if (editing.id) await http.put('/api/schedules/' + editing.id, payload);
      else await http.post('/api/schedules', payload);
      setEditing(null);
      load();
    } catch (e) {
      setErr((e.response && e.response.data && e.response.data.error) || '保存失败');
    }
  }
  async function remove() {
    if (!editing.id) return;
    if (!confirm('确认删除该档期？')) return;
    await http.delete('/api/schedules/' + editing.id);
    setEditing(null);
    load();
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-white">档期管理</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => shiftMonth(-1)} className="w-8 h-8 rounded bg-panel border border-line text-white">‹</button>
          <span className="text-white w-28 text-center">{state.month}</span>
          <button onClick={() => shiftMonth(1)} className="w-8 h-8 rounded bg-panel border border-line text-white">›</button>
          <button onClick={() => openNew(new Date().getDate())} className="ml-3 px-3 py-2 rounded bg-brand text-white text-sm hover:opacity-90">+ 新增档期</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* 日历 */}
        <div className="lg:col-span-3 bg-panel border border-line rounded-xl2 p-4">
          <div className="grid grid-cols-7 gap-2 mb-2">
            {WEEK.map((w) => <div key={w} className="text-center text-xs text-muted py-1">{w}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-2">
            {cells.map((day, i) => {
              if (day == null) return <div key={i} />;
              const date = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const rows = map[date] || [];
              const top = rows[0];
              const st = top ? STATUS[top.status] : STATUS.free;
              const isSel = state.sel === date;
              return (
                <button key={i} onClick={() => { setState((s) => ({ ...s, sel: date })); if (top) openEdit(top); else openNew(day); }}
                  className={'min-h-[78px] rounded-lg border p-2 text-left transition ' + (isSel ? 'border-brand ' : '') + st.cls}>
                  <div className="flex items-center justify-between">
                    <span className={'text-sm ' + (top ? 'text-white' : 'text-muted')}>{day}</span>
                    <span className={'w-2 h-2 rounded-full ' + st.dot} />
                  </div>
                  {top && (
                    <div className="mt-1">
                      <div className="text-xs text-white truncate">{top.photographer || st.label}</div>
                      <div className="text-[10px] text-muted truncate">{top.order_no || (top.period === 'am' ? '上午' : top.period === 'pm' ? '下午' : '全天')}</div>
                    </div>
                  )}
                  {rows.length > 1 && <div className="text-[10px] text-muted mt-0.5">+{rows.length - 1}</div>}
                </button>
              );
            })}
          </div>
        </div>

        {/* 右侧编辑面板 */}
        <div className="bg-panel border border-line rounded-xl2 p-4">
          <div className="text-sm text-white font-medium mb-3">档期详情</div>
          {!editing && <div className="text-xs text-muted">点击日历日期新增或编辑排期。</div>}
          {editing && (
            <div>
              <div className="text-xs text-muted mb-3">{editing.date}{editing.id ? '（编辑）' : '（新增）'}</div>
              <label className="text-xs text-muted">时段</label>
              <select value={editing.period} onChange={(e) => setEditing({ ...editing, period: e.target.value })}
                className="w-full mb-3 px-2 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none">
                <option value="full">全天</option>
                <option value="am">上午</option>
                <option value="pm">下午</option>
              </select>
              <label className="text-xs text-muted">状态</label>
              <div className="flex gap-2 mb-3">
                {Object.keys(STATUS).map((k) => (
                  <button key={k} onClick={() => setEditing({ ...editing, status: k })}
                    className={'flex-1 px-2 py-1.5 rounded text-xs border ' + (editing.status === k ? 'border-brand text-white bg-brand/10' : 'border-line text-muted')}>{STATUS[k].label}</button>
                ))}
              </div>
              <label className="text-xs text-muted">执行人 / 团队</label>
              <input value={editing.photographer} onChange={(e) => setEditing({ ...editing, photographer: e.target.value })} placeholder="如 叶哲 / 小李"
                className="w-full mb-3 px-2 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
              <label className="text-xs text-muted">关联订单号</label>
              <input value={editing.order_no} onChange={(e) => setEditing({ ...editing, order_no: e.target.value })} placeholder="如 NO20260801（选填）"
                className="w-full mb-3 px-2 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
              <label className="text-xs text-muted">备注</label>
              <input value={editing.note} onChange={(e) => setEditing({ ...editing, note: e.target.value })} placeholder="如 婚礼跟拍"
                className="w-full mb-3 px-2 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
              {err && <div className="text-xs text-red-400 mb-2">{err}</div>}
              <div className="flex gap-2 justify-end">
                {editing.id && <button onClick={remove} className="px-3 py-2 rounded text-xs text-red-400 hover:underline">删除</button>}
                <button onClick={() => setEditing(null)} className="px-3 py-2 rounded text-sm text-muted">取消</button>
                <button onClick={save} className="px-4 py-2 rounded bg-brand text-white text-sm">保存</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function buildMonth(year, month0) {
  const first = new Date(year, month0, 1);
  const startDay = (first.getDay() + 6) % 7; // 周一为一周起点
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
