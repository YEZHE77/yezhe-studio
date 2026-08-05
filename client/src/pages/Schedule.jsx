import React, { useState, useEffect } from 'react';
import http from '../api.js';
import { useViewState } from '../tabMemory.js';

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];
const STATUS = {
  free: { label: '空闲', dot: 'bg-emerald-500', cls: 'border-line' },
  unpaid: { label: '未付定金', dot: 'bg-amber-500', cls: 'border-amber-500/40 bg-amber-500/5' },
  shoot: { label: '等待拍摄', dot: 'bg-sky-500', cls: 'border-sky-500/40 bg-sky-500/5' },
  closed: { label: '档期关闭', dot: 'bg-line', cls: 'border-line bg-black/20 opacity-60' },
  booked: { label: '已排', dot: 'bg-red-500', cls: 'border-red-500/40 bg-red-500/5' },
  locked: { label: '锁场', dot: 'bg-red-500', cls: 'border-red-500/40 bg-red-500/5' },
  pending: { label: '待确认预约', dot: 'bg-amber-400', cls: 'border-amber-400/50 bg-amber-400/10' }
};
const PERIOD_LABEL = { full: '全天', am: '上午', pm: '下午', night: '晚上' };

export default function Schedule() {
  const initMonth = new Date().toISOString().slice(0, 7);
  const [state, setState] = useViewState('schedule', { month: initMonth, sel: '' });
  const [map, setMap] = useState({}); // date -> [schedules]
  const [pendMap, setPendMap] = useState({}); // date -> [pending appointments]
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(null);
  const [dayOpen, setDayOpen] = useState(''); // 选中的日期（日面板）
  const [share, setShare] = useState(null); // 当前编辑档期的分享 {share_url, qr_url, token, disabled}

  const [y, m] = state.month.split('-').map(Number);

  const load = () => {
    http.get('/api/schedules?month=' + state.month).then((r) => {
      const nm = {};
      for (const s of r.data) { (nm[s.date] = nm[s.date] || []).push(s); }
      setMap(nm);
    }).catch(() => {});
    // 待确认预约（用于日历黄色着色 + 日面板处理）
    http.get('/api/admin/appointments?status=pending').then((r) => {
      const pm = {};
      for (const a of (r.data || [])) {
        if (a.hope_date) { (pm[a.hope_date] = pm[a.hope_date] || []).push(a); }
      }
      setPendMap(pm);
    }).catch(() => {});
  };
  useEffect(load, [state.month]);

  const cells = buildMonth(y, m - 1);

  const shiftMonth = (delta) => {
    const total = (y * 12 + (m - 1)) + delta;
    const ny = Math.floor(total / 12);
    const nm = (total % 12) + 1;
    setState((s) => ({ ...s, month: `${ny}-${String(nm).padStart(2, '0')}`, sel: '' }));
  };

  const openNew = (day) => {
    const date = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    setErr(''); setShare(null);
    setEditing({ id: null, date, period: 'full', status: 'booked', photographer: '', note: '', order_no: '', groom_name: '', bride_name: '', contact_phone: '', address: '' });
  };
  const openEdit = (row) => {
    setErr(''); setShare(null);
    setEditing({ id: row.id, date: row.date, period: row.period, status: row.status, photographer: row.photographer || '', note: row.note || '', order_no: row.order_no || '', groom_name: row.groom_name || '', bride_name: row.bride_name || '', contact_phone: row.contact_phone || '', address: row.address || '' });
  };

  async function save() {
    setErr('');
    const payload = {
      date: editing.date, period: editing.period, status: editing.status,
      photographer: editing.photographer, note: editing.note, order_no: editing.order_no,
      groom_name: editing.groom_name, bride_name: editing.bride_name,
      contact_phone: editing.contact_phone, address: editing.address
    };
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

  // 档期分享（统一内核 type=schedule）
  async function genShare() {
    if (!editing.id) return;
    try {
      const r = await http.post('/api/shares', { type: 'schedule', ref_id: editing.id });
      setShare({ share_url: r.data.share_url, qr_url: r.data.qr_url, token: r.data.token, disabled: 0, has_password: r.data.has_password });
    } catch (e) { setErr((e.response && e.response.data && e.response.data.error) || '生成分享失败'); }
  }
  async function toggleShare() {
    if (!share) return;
    await http.post('/api/shares/' + share.token + '/toggle');
    setShare({ ...share, disabled: share.disabled ? 0 : 1 });
    load();
  }

  // 日面板：接受 / 拒绝预约（复用后端 /confirm /reject）
  async function acceptAppt(a) {
    if (!a.hope_date) return alert('该预约缺少期望日期，请先在预约管理中补充');
    if (!confirm(`接受「${a.name}」的预约并生成订单、锁定档期？（${a.hope_date} ${PERIOD_LABEL[a.period] || ''}）`)) return;
    try {
      await http.post('/api/admin/appointments/' + a.id + '/confirm', { date: a.hope_date, period: a.period || 'full', photographer: a.photographer || '' });
      alert('已接受：订单已生成并锁定档期');
      load();
      setDayOpen('');
    } catch (e) { alert((e.response && e.response.data && e.response.data.error) || '接受失败'); }
  }
  async function rejectAppt(a) {
    const reason = prompt('拒绝原因（将同步给客户）：', '该日期已排满，建议改期');
    if (reason === null) return;
    try {
      await http.post('/api/admin/appointments/' + a.id + '/reject', { reason });
      alert('已拒绝该预约');
      load();
      setDayOpen('');
    } catch (e) { alert((e.response && e.response.data && e.response.data.error) || '拒绝失败'); }
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

      {/* 图例 */}
      <div className="flex flex-wrap gap-3 mb-3 text-xs text-muted">
        <Legend cls="border-red-500/40 bg-red-500/5" label="红=已被订单占用" />
        <Legend cls="border-amber-400/50 bg-amber-400/10" label="黄=待确认预约" />
        <Legend cls="border-line bg-black/20" label="灰=关闭不可约" />
        <Legend cls="border-line" label="白=空闲" />
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
              const pends = pendMap[date] || [];
              const pendingCount = pends.length;
              const hasBooked = rows.some((r) => r.status === 'booked' || r.status === 'locked');
              const hasClosed = rows.some((r) => r.status === 'closed');
              let st;
              if (hasBooked) st = STATUS.booked;
              else if (hasClosed) st = STATUS.closed;
              else if (pendingCount > 0) st = STATUS.pending;
              else if (rows.length) st = STATUS[rows[0].status] || STATUS.free;
              else st = STATUS.free;
              const isSel = state.sel === date;
              return (
                <button key={i} onClick={() => { setState((s) => ({ ...s, sel: date })); setDayOpen(date); }}
                  className={'min-h-[78px] rounded-lg border p-2 text-left transition ' + (isSel ? 'border-brand ' : '') + st.cls}>
                  <div className="flex items-center justify-between">
                    <span className={'text-sm ' + (rows.length || pendingCount ? 'text-white' : 'text-muted')}>{day}</span>
                    <span className={'w-2 h-2 rounded-full ' + st.dot} />
                  </div>
                  {rows[0] && rows[0].lunar_date && <div className="text-[10px] text-muted leading-tight">{rows[0].lunar_date}</div>}
                  {rows[0] && (
                    <div className="mt-1">
                      <div className="text-xs text-white truncate">{rows[0].photographer || st.label}</div>
                      <div className="text-[10px] text-muted truncate">{rows[0].order_no || (PERIOD_LABEL[rows[0].period] || '全天')}</div>
                    </div>
                  )}
                  {pendingCount > 0 && (
                    <div className="mt-1 text-[10px] text-amber-300 truncate">待确认 ×{pendingCount}</div>
                  )}
                  {rows.length > 1 && <div className="text-[10px] text-muted mt-0.5">+{rows.length - 1} 档期</div>}
                </button>
              );
            })}
          </div>
        </div>

        {/* 右侧编辑面板 */}
        <div className="bg-panel border border-line rounded-xl2 p-4">
          <div className="text-sm text-white font-medium mb-3">档期详情</div>
          {!editing && <div className="text-xs text-muted">点击日历日期查看当日档期与预约，或新增排期。</div>}
          {editing && (
            <div>
              <div className="text-xs text-muted mb-3">{editing.date}{editing.id ? '（编辑）' : '（新增）'}</div>
              <label className="text-xs text-muted">时段</label>
              <select value={editing.period} onChange={(e) => setEditing({ ...editing, period: e.target.value })}
                className="w-full mb-3 px-2 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none">
                <option value="full">全天</option>
                <option value="am">上午</option>
                <option value="pm">下午</option>
                <option value="night">晚上</option>
              </select>
              <label className="text-xs text-muted">状态</label>
              <div className="flex gap-2 mb-3 flex-wrap">
                {['free', 'booked', 'locked', 'closed'].map((k) => (
                  <button key={k} onClick={() => setEditing({ ...editing, status: k })}
                    className={'flex-1 px-2 py-1.5 rounded text-xs border min-w-[64px] ' + (editing.status === k ? 'border-brand text-white bg-brand/10' : 'border-line text-muted')}>{STATUS[k].label}</button>
                ))}
              </div>
              <label className="text-xs text-muted">执行人 / 团队</label>
              <input value={editing.photographer} onChange={(e) => setEditing({ ...editing, photographer: e.target.value })} placeholder="如 叶哲 / 小李"
                className="w-full mb-3 px-2 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
              <label className="text-xs text-muted">关联订单号</label>
              <input value={editing.order_no} onChange={(e) => setEditing({ ...editing, order_no: e.target.value })} placeholder="如 NO20260801（选填）"
                className="w-full mb-3 px-2 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
              <label className="text-xs text-muted">新郎姓名</label>
              <input value={editing.groom_name} onChange={(e) => setEditing({ ...editing, groom_name: e.target.value })} placeholder="新郎姓名"
                className="w-full mb-3 px-2 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
              <label className="text-xs text-muted">新娘姓名</label>
              <input value={editing.bride_name} onChange={(e) => setEditing({ ...editing, bride_name: e.target.value })} placeholder="新娘姓名"
                className="w-full mb-3 px-2 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
              <label className="text-xs text-muted">联系方式</label>
              <input value={editing.contact_phone} onChange={(e) => setEditing({ ...editing, contact_phone: e.target.value })} placeholder="手机号 / 微信"
                className="w-full mb-3 px-2 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
              <label className="text-xs text-muted">婚礼地址</label>
              <input value={editing.address} onChange={(e) => setEditing({ ...editing, address: e.target.value })} placeholder="婚礼举办地址"
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

              {/* 档期分享（统一内核） */}
              {editing.id && (
                <div className="mt-4 pt-3 border-t border-line">
                  <div className="text-xs text-muted mb-2">档期分享（独立二维码 + 可选密码/有效期）</div>
                  {!share && <button onClick={genShare} className="px-3 py-2 rounded border border-line text-white text-xs hover:bg-panel2">生成分享二维码</button>}
                  {share && (
                    <div>
                      <img src={share.qr_url} className="w-32 h-32 rounded bg-white mx-auto" />
                      <div className="text-[10px] text-muted break-all mt-2">{share.share_url}</div>
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => navigator.clipboard && navigator.clipboard.writeText(share.share_url)} className="flex-1 px-2 py-1.5 rounded border border-line text-xs text-white">复制链接</button>
                        <button onClick={toggleShare} className={'flex-1 px-2 py-1.5 rounded border border-line text-xs ' + (share.disabled ? 'text-emerald-400' : 'text-red-400')}>{share.disabled ? '已关闭·开启' : '关闭分享'}</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 日面板：当日档期 + 待确认预约 */}
      {dayOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setDayOpen('')}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg bg-panel border border-line rounded-xl2 p-6 max-h-[80vh] overflow-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="text-white font-medium">{dayOpen} · 当日明细</div>
              <button onClick={() => setDayOpen('')} className="text-muted text-sm">✕</button>
            </div>

            <div className="text-xs text-muted mb-2">档期（{ (map[dayOpen] || []).length }）</div>
            {(map[dayOpen] || []).length === 0 && <div className="text-xs text-muted mb-3">无排期</div>}
            {(map[dayOpen] || []).map((s) => (
              <div key={s.id} className="flex items-center justify-between bg-panel2 border border-line rounded-lg p-3 mb-2">
                <div>
                  <div className="text-white text-sm">{PERIOD_LABEL[s.period] || s.period} · <span className={(STATUS[s.status] || STATUS.free).label}>{STATUS[s.status] ? STATUS[s.status].label : s.status}</span></div>
                  <div className="text-[11px] text-muted">{s.photographer || '未指派'}{s.order_no ? ' · ' + s.order_no : ''}</div>
                </div>
                <button onClick={() => { setDayOpen(''); openEdit(s); }} className="px-3 py-1.5 rounded border border-line text-white text-xs">编辑</button>
              </div>
            ))}

            <div className="text-xs text-muted mb-2 mt-4">待确认预约（{ (pendMap[dayOpen] || []).length }）</div>
            {(pendMap[dayOpen] || []).length === 0 && <div className="text-xs text-muted mb-3">无待确认预约</div>}
            {(pendMap[dayOpen] || []).map((a) => (
              <div key={a.id} className="bg-amber-400/5 border border-amber-400/30 rounded-lg p-3 mb-2">
                <div className="flex items-center justify-between">
                  <div className="text-white text-sm">{a.name} · {a.phone}</div>
                  <div className="text-[11px] text-amber-300">{a.hope_date} {a.period ? PERIOD_LABEL[a.period] : ''}</div>
                </div>
                {a.package_name && <div className="text-[11px] text-muted">套系：{a.package_name}</div>}
                {a.remark && <div className="text-[11px] text-muted">备注：{a.remark}</div>}
                <div className="flex gap-2 mt-2 justify-end">
                  <button onClick={() => rejectAppt(a)} className="px-3 py-1.5 rounded border border-line text-red-400 text-xs">拒绝</button>
                  <button onClick={() => acceptAppt(a)} className="px-3 py-1.5 rounded bg-brand text-white text-xs">接受并锁档期</button>
                </div>
              </div>
            ))}

            <button onClick={() => { setDayOpen(''); openNew(parseInt(dayOpen.slice(8), 10)); }} className="w-full mt-3 px-3 py-2 rounded bg-brand text-white text-sm">+ 在该日新增档期</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Legend({ cls, label }) {
  return (
    <span className="flex items-center gap-1">
      <span className={'w-3 h-3 rounded border ' + cls} />
      {label}
    </span>
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
