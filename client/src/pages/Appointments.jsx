import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import http from '../api.js';
import { useViewState } from '../tabMemory.js';

// 档期预约模块状态语义：pending(待确认) / confirmed(已确认生成订单) / rejected(已拒绝) / cancelled(已取消)
const STATUS_LABEL = {
  pending: '待确认',
  confirmed: '已确认·已转单',
  rejected: '已拒绝',
  cancelled: '已取消'
};
const PERIOD_LABEL = { full: '全天', half: '半天' };

export default function Appointments() {
  const [state, setState] = useViewState('appointments', { status: '', q: '' });
  const [list, setList] = useState([]);
  const [pkgs, setPkgs] = useState([]);
  const [detail, setDetail] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [conv, setConv] = useState(null); // 接受转单结果弹层
  const [confirming, setConfirming] = useState(null); // 接受弹层 {a, date, period, photographer}
  const [rejecting, setRejecting] = useState(null); // 拒绝弹层 {a, reason}
  const nav = useNavigate();

  function emptyForm() {
    return { id: null, name: '', phone: '', package_id: '', hope_date: '', period: 'full', remark: '', status: 'pending' };
  }

  const load = () => {
    const p = new URLSearchParams();
    if (state.status) p.set('status', state.status);
    if (state.q) p.set('q', state.q);
    http.get('/api/admin/appointments?' + p.toString()).then((r) => setList(r.data)).catch(() => {});
  };
  useEffect(load, [state]);
  useEffect(() => { http.get('/api/packages?status=all').then((r) => setPkgs(r.data)).catch(() => {}); }, []);

  // 接受预约 → 生成订单并锁定档期（双向绑定）
  function openConfirm(a) {
    setDetail(null);
    const pkg = pkgs.find((p) => String(p.id) === String(a.package_id));
    const defDeposit = pkg ? (parseFloat(pkg.deposit) || 0) : 0;
    setConfirming({ a, date: a.hope_date || '', period: a.period || 'full', photographer: '', deposit: defDeposit, deposit_method: 'offline' });
  }
  async function doConfirm() {
    const { a, date, period, photographer, deposit, deposit_method } = confirming;
    if (!date) return alert('请指定拍摄日期');
    if (!(parseFloat(deposit) > 0)) return alert('请填写已收取的定金金额（必须大于 0，未收定金不能建立订单）');
    try {
      const r = await http.post('/api/admin/appointments/' + a.id + '/confirm', { date, period, photographer, deposit: parseFloat(deposit) || 0, deposit_method });
      setConv({ name: a.name, ...r.data });
      setConfirming(null);
      load();
    } catch (e) {
      alert((e.response && e.response.data && e.response.data.error) || '接受失败');
    }
  }
  // 拒绝预约 → 填原因
  function openReject(a) {
    setDetail(null);
    setRejecting({ a, reason: '' });
  }
  async function doReject() {
    try {
      await http.post('/api/admin/appointments/' + rejecting.a.id + '/reject', { reason: rejecting.reason });
      setRejecting(null);
      load();
    } catch (e) {
      alert((e.response && e.response.data && e.response.data.error) || '拒绝失败');
    }
  }

  const openDetail = (a) => { setEditing(null); setDetail(a); };
  const openEdit = (a) => {
    setDetail(null);
    setEditing({ id: a.id, name: a.name, phone: a.phone, package_id: a.package_id || '', hope_date: a.hope_date || '', period: a.period || 'full', remark: a.remark || '', status: a.status });
    setForm({ id: a.id, name: a.name, phone: a.phone, package_id: a.package_id || '', hope_date: a.hope_date || '', period: a.period || 'full', remark: a.remark || '', status: a.status });
  };

  async function saveEdit(e) {
    e.preventDefault();
    try {
      await http.put('/api/admin/appointments/' + editing.id, {
        name: form.name, phone: form.phone, package_id: form.package_id || null,
        hope_date: form.hope_date, period: form.period, remark: form.remark, status: form.status
      });
      setEditing(null);
      load();
    } catch (e2) {
      alert((e2.response && e2.response.data && e2.response.data.error) || '保存失败');
    }
  }

  async function remove(a) {
    if (!confirm(`确认删除预约「${a.name}」？此操作不可恢复。`)) return;
    try {
      await http.delete('/api/admin/appointments/' + a.id);
      setDetail(null);
      load();
    } catch (e2) {
      alert((e2.response && e2.response.data && e2.response.data.error) || '删除失败');
    }
  }

  const canProcess = (a) => a.status === 'pending';

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-white">预约管理</h1>
        <span className="text-xs text-muted">来自 C 端小程序客户提交的预约 · 接受后自动生成订单并锁定档期</span>
      </div>

      {/* 状态筛选 + 搜索 */}
      <div className="flex gap-2 mb-3 flex-wrap">
        <button onClick={() => setState((s) => ({ ...s, status: '' }))} className={btn(state.status === '', '全部')}>全部</button>
        <button onClick={() => setState((s) => ({ ...s, status: 'pending' }))} className={btn(state.status === 'pending', '待确认')}>待确认</button>
        <button onClick={() => setState((s) => ({ ...s, status: 'confirmed' }))} className={btn(state.status === 'confirmed', '已确认')}>已确认</button>
        <button onClick={() => setState((s) => ({ ...s, status: 'rejected' }))} className={btn(state.status === 'rejected', '已拒绝')}>已拒绝</button>
        <button onClick={() => setState((s) => ({ ...s, status: 'cancelled' }))} className={btn(state.status === 'cancelled', '已取消')}>已取消</button>
        <input value={state.q} onChange={(e) => setState((s) => ({ ...s, q: e.target.value }))} placeholder="搜索称呼 / 电话"
          className="ml-auto w-56 px-3 py-2 rounded bg-panel border border-line text-white text-sm outline-none" />
      </div>

      <div className="bg-panel border border-line rounded-xl2 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted text-left border-b border-line">
              <th className="p-3 font-medium">称呼</th>
              <th className="p-3 font-medium">联系电话</th>
              <th className="p-3 font-medium">意向套系</th>
              <th className="p-3 font-medium">期望日期 / 时段</th>
              <th className="p-3 font-medium">备注</th>
              <th className="p-3 font-medium">状态</th>
              <th className="p-3 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id} onClick={() => openDetail(a)} className="border-b border-line last:border-0 cursor-pointer hover:bg-panel2">
                <td className="p-3 text-white">{a.name}</td>
                <td className="p-3 text-white">{a.phone}</td>
                <td className="p-3 text-muted">{a.package_name || '—'}</td>
                <td className="p-3 text-muted">{a.hope_date || '—'}{a.period ? ' · ' + (PERIOD_LABEL[a.period] || a.period) : ''}</td>
                <td className="p-3 text-muted max-w-[180px] truncate">{a.remark || '—'}</td>
                <td className="p-3"><span className={'px-2 py-1 rounded-full text-xs ' + badge(a.status)}>{STATUS_LABEL[a.status] || a.status}</span></td>
                <td className="p-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  {canProcess(a) ? (
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => openConfirm(a)} className="px-3 py-1.5 rounded bg-brand text-white text-xs hover:opacity-90">接受</button>
                      <button onClick={() => openReject(a)} className="px-3 py-1.5 rounded border border-line text-red-400 text-xs hover:bg-red-500/10">拒绝</button>
                    </div>
                  ) : (
                    <span className="text-xs text-muted">{STATUS_LABEL[a.status] || a.status}</span>
                  )}
                </td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan="7" className="p-8 text-center text-muted">暂无预约</td></tr>}
          </tbody>
        </table>
      </div>

      {/* 详情弹窗 */}
      {detail && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setDetail(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-panel border border-line rounded-xl2 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="text-white font-medium">预约详情</div>
              <button onClick={() => setDetail(null)} className="text-muted text-sm">✕</button>
            </div>
            <div className="space-y-2 text-sm mb-4">
              <Row label="称呼" value={detail.name} />
              <Row label="电话" value={detail.phone} />
              <Row label="意向套系" value={detail.package_name || '—'} />
              <Row label="期望日期" value={detail.hope_date || '—'} />
              <Row label="时段" value={PERIOD_LABEL[detail.period] || detail.period || '—'} />
              <Row label="备注" value={detail.remark || '—'} />
              <Row label="状态" value={STATUS_LABEL[detail.status] || detail.status} />
              {detail.status === 'rejected' && <Row label="拒绝原因" value={detail.reject_reason || '—'} />}
              {detail.schedule_id ? <Row label="关联档期" value={'#' + detail.schedule_id} /> : null}
              {detail.order_id ? <Row label="关联订单" value={'#' + detail.order_id} /> : null}
              {detail.handled_at ? <Row label="处理时间" value={fmt(detail.handled_at)} /> : null}
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => remove(detail)} className="px-3 py-1.5 rounded border border-line text-red-400 text-xs hover:bg-red-500/10">删除</button>
              <button onClick={() => openEdit(detail)} className="px-3 py-1.5 rounded border border-line text-white text-xs">编辑</button>
              {canProcess(detail) && (
                <>
                  <button onClick={() => openReject(detail)} className="px-3 py-1.5 rounded border border-line text-red-400 text-xs">拒绝</button>
                  <button onClick={() => openConfirm(detail)} className="px-3 py-1.5 rounded bg-brand text-white text-xs">接受</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 接受（生成订单 + 锁档期）弹窗 */}
      {confirming && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4" onClick={() => setConfirming(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-panel border border-line rounded-xl2 p-6">
            <div className="text-white font-medium mb-1">接受预约并生成订单</div>
            <div className="text-xs text-muted mb-4">客户「{confirming.a.name}」· {confirming.a.package_name || '未选套系'} · 接受后将自动占用档期并创建订单绑定其小程序账号</div>
            <label className="text-xs text-muted">拍摄日期</label>
            <input value={confirming.date} onChange={(e) => setConfirming({ ...confirming, date: e.target.value })} type="date"
              className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
            <label className="text-xs text-muted">时段</label>
            <select value={confirming.period} onChange={(e) => setConfirming({ ...confirming, period: e.target.value })}
              className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none">
              <option value="full">全天</option>
              <option value="half">半天</option>
            </select>
            <label className="text-xs text-muted">执行人 / 团队</label>
            <input value={confirming.photographer} onChange={(e) => setConfirming({ ...confirming, photographer: e.target.value })} placeholder="如 叶哲 / 小李"
              className="w-full mb-4 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
            <label className="text-xs text-muted">已收定金（建立订单的前提，必须大于 0）</label>
            <input value={confirming.deposit} onChange={(e) => setConfirming({ ...confirming, deposit: e.target.value })} type="number" placeholder="定金金额"
              className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
            <label className="text-xs text-muted">定金收取方式</label>
            <select value={confirming.deposit_method} onChange={(e) => setConfirming({ ...confirming, deposit_method: e.target.value })}
              className="w-full mb-4 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none">
              <option value="offline">线下收取</option>
              <option value="online">线上收取</option>
            </select>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirming(null)} className="px-4 py-2 rounded text-sm text-muted">取消</button>
              <button onClick={doConfirm} className="px-4 py-2 rounded bg-brand text-white text-sm">确认接受</button>
            </div>
          </div>
        </div>
      )}

      {/* 拒绝弹窗 */}
      {rejecting && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4" onClick={() => setRejecting(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-panel border border-line rounded-xl2 p-6">
            <div className="text-white font-medium mb-1">拒绝预约</div>
            <div className="text-xs text-muted mb-4">客户「{rejecting.a.name}」</div>
            <label className="text-xs text-muted">拒绝原因（将同步给客户）</label>
            <textarea value={rejecting.reason} onChange={(e) => setRejecting({ ...rejecting, reason: e.target.value })} placeholder="如 该日期已排满，建议改期…"
              className="w-full mb-4 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none h-20" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setRejecting(null)} className="px-4 py-2 rounded text-sm text-muted">取消</button>
              <button onClick={doReject} className="px-4 py-2 rounded bg-red-500 text-white text-sm">确认拒绝</button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑弹窗 */}
      {editing && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4" onClick={() => setEditing(null)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={saveEdit} className="w-full max-w-md bg-panel border border-line rounded-xl2 p-6">
            <div className="text-white font-medium mb-4">编辑预约</div>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="称呼"
              className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
            <input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="联系电话"
              className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
            <select value={form.package_id} onChange={(e) => setForm({ ...form, package_id: e.target.value })}
              className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none">
              <option value="">未选套系</option>
              {pkgs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input value={form.hope_date} onChange={(e) => setForm({ ...form, hope_date: e.target.value })} type="date" placeholder="期望日期"
              className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
            <label className="text-xs text-muted">时段</label>
            <select value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })}
              className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none">
              <option value="full">全天</option>
              <option value="half">半天</option>
            </select>
            <textarea value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} placeholder="备注"
              className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none h-16" />
            <div className="flex gap-2 mb-4">
              <span className="text-xs text-muted self-center">状态</span>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="flex-1 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none">
                <option value="pending">待确认</option>
                <option value="confirmed">已确认</option>
                <option value="rejected">已拒绝</option>
                <option value="cancelled">已取消</option>
              </select>
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 rounded text-sm text-muted">取消</button>
              <button type="submit" className="px-4 py-2 rounded bg-brand text-white text-sm">保存</button>
            </div>
          </form>
        </div>
      )}

      {/* 接受结果 */}
      {conv && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4" onClick={() => setConv(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm bg-panel border border-line rounded-xl2 p-6 text-center">
            <div className="text-emerald-400 text-2xl mb-2">✓</div>
            <div className="text-white font-medium mb-1">已接受并生成订单</div>
            <div className="text-sm text-muted mb-4">客户「{conv.name}」的订单已创建并锁定档期，已绑定其小程序账号</div>
            <div className="flex gap-2 justify-center">
              <button onClick={() => { setConv(null); nav('/orders'); }} className="px-4 py-2 rounded bg-panel2 border border-line text-white text-sm">去订单中心</button>
              <button onClick={() => setConv(null)} className="px-4 py-2 rounded bg-brand text-white text-sm">知道了</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function fmt(s) { try { return new Date(s).toLocaleString('zh-CN'); } catch { return s; } }
function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted">{label}</span>
      <span className="text-white text-right">{value}</span>
    </div>
  );
}
function btn(active, label) {
  return 'px-3 py-2 rounded-full text-sm border ' + (active ? 'bg-brand text-white border-brand' : 'bg-panel border-line text-muted');
}
function badge(status) {
  return {
    pending: 'bg-amber-500/15 text-amber-400',
    confirmed: 'bg-emerald-500/15 text-emerald-400',
    rejected: 'bg-red-500/15 text-red-400',
    cancelled: 'bg-line text-muted'
  }[status] || 'bg-line text-muted';
}
