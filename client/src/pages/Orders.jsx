import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import http, { img } from '../api.js';
import { useViewState } from '../tabMemory.js';

const STATUS_LABEL = {
  unpaid: '待付定金', deposit: '已付定金', shot: '已拍摄', selecting: '选片中',
  retouching: '精修中', delivered: '已交付', completed: '已完成', cancelled: '已作废'
};
const STAGE_SEQ = ['unpaid', 'deposit', 'shot', 'selecting', 'retouching', 'delivered', 'completed'];
const STAGE_COLOR = {
  unpaid: 'bg-red-500', deposit: 'bg-amber-500', shot: 'bg-sky-500', selecting: 'bg-indigo-500',
  retouching: 'bg-purple-500', delivered: 'bg-teal-500', completed: 'bg-emerald-500', cancelled: 'bg-line'
};
const TYPE_LABEL = { deposit: '定金', balance: '尾款', extra: '加片/增值', refund: '退款' };

export default function Orders() {
  const [params, setParams] = useSearchParams();
  const [state, setState] = useViewState('orders', { status: '', q: '' });
  const [list, setList] = useState([]);
  const [pkgs, setPkgs] = useState([]);
  const [detail, setDetail] = useState(null);
  const [sel, setSel] = useState(null); // 选片结果 {selection, photos}
  const [selSaving, setSelSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [pay, setPay] = useState(null); // {type, amount, method, note}
  const [err, setErr] = useState('');

  function emptyForm() {
    return { customer_name: '', customer_phone: '', package_id: '', deposit: '', balance: '', deposit_method: 'offline', balance_method: 'offline', shoot_date: '', executor: '', remark: '' };
  }

  const load = () => {
    const p = new URLSearchParams();
    if (state.status) p.set('status', state.status);
    if (state.q) p.set('q', state.q);
    http.get('/api/orders?' + p.toString()).then((r) => setList(r.data)).catch(() => {});
  };
  useEffect(load, [state]);
  useEffect(() => { http.get('/api/packages?status=all').then((r) => setPkgs(r.data)).catch(() => {}); }, []);

  // 套系复用开单：从 /orders?pkg= 进入自动打开新建并预选套系
  useEffect(() => {
    const pkg = params.get('pkg');
    if (pkg) {
      setForm({ ...emptyForm(), package_id: pkg });
      setShowForm(true);
      params.delete('pkg');
      setParams(params, { replace: true });
    }
    // eslint-disable-next-line
  }, []);

  // 工作台「待处理订单」进度条点击跳转：读取 ?status= 预筛选
  useEffect(() => {
    const s = params.get('status');
    if (s) setState((x) => ({ ...x, status: s }));
    // eslint-disable-next-line
  }, []);

  const openDetail = async (id) => {
    const r = await http.get('/api/orders/' + id);
    setDetail(r.data);
    loadSel(id);
  };
  const closeDetail = () => { setDetail(null); setSel(null); };

  // 加载该订单的选片结果（客户在小程序提交 / 后台可修改）
  const loadSel = (id) => {
    http.get('/api/admin/photo-select/' + id).then((r) => setSel(r.data)).catch(() => setSel(null));
  };
  const toggleSel = (url) => {
    if (!sel || !sel.selection) return;
    const set = new Set(sel.selection.marks);
    if (set.has(url)) set.delete(url); else set.add(url);
    const marks = [...set];
    setSel({ ...sel, selection: { ...sel.selection, marks } });
  };
  const saveSel = async () => {
    if (!sel || !detail) return;
    setSelSaving(true);
    try {
      await http.post('/api/admin/photo-select/' + detail.id, { marks: sel.selection.marks });
      loadSel(detail.id);
    } catch (e) {
      alert((e.response && e.response.data && e.response.data.error) || '保存失败');
    } finally {
      setSelSaving(false);
    }
  };

  const openNew = () => { setForm(emptyForm()); setErr(''); setShowForm(true); };

  // 编辑订单（基本信息；金额通过收款/退款调整，不在本处改）
  const [edit, setEdit] = useState(null);
  const [editForm, setEditForm] = useState({ customer_name: '', customer_phone: '', shoot_date: '', executor: '', remark: '', status: '' });
  const openEdit = () => {
    if (!detail) return;
    setEditForm({
      customer_name: detail.customer_name || '', customer_phone: detail.customer_phone || '',
      shoot_date: detail.shoot_date || '', executor: detail.executor || '',
      remark: detail.remark || '', status: detail.status
    });
    setEdit(true);
  };
  async function saveEdit(e) {
    e.preventDefault();
    try {
      await http.put('/api/orders/' + detail.id, editForm);
      setEdit(false);
      openDetail(detail.id); load();
    } catch (e2) { alert((e2.response && e2.response.data && e2.response.data.error) || '保存失败'); }
  }
  async function removeOrder() {
    if (!confirm('确认删除该订单？\n订单及其收款流水、选片记录将一并永久删除，不可恢复。')) return;
    try {
      await http.delete('/api/orders/' + detail.id);
      setDetail(null); load();
    } catch (e2) { alert((e2.response && e2.response.data && e2.response.data.error) || '删除失败'); }
  }

  async function submit(e) {
    e.preventDefault();
    setErr('');
    const pkg = pkgs.find((p) => String(p.id) === String(form.package_id));
    const payload = {
      customer_name: form.customer_name, customer_phone: form.customer_phone, package_id: form.package_id || null,
      deposit: parseFloat(form.deposit) || 0, balance: parseFloat(form.balance) || 0,
      deposit_method: form.deposit_method, balance_method: form.balance_method,
      shoot_date: form.shoot_date, executor: form.executor, remark: form.remark
    };
    if (!pkg) { setErr('请选择套系（或填写定金/尾款金额）'); return; }
    try {
      await http.post('/api/orders', payload);
      setShowForm(false);
      load();
    } catch (e) { setErr((e.response && e.response.data && e.response.data.error) || '创建失败'); }
  }

  async function advance() {
    if (!detail) return;
    const idx = STAGE_SEQ.indexOf(detail.status);
    if (idx < 0 || idx >= STAGE_SEQ.length - 1) return;
    const next = STAGE_SEQ[idx + 1];
    await http.put('/api/orders/' + detail.id, { status: next });
    openDetail(detail.id);
    load();
  }
  async function setStatus(s) {
    await http.put('/api/orders/' + detail.id, { status: s });
    openDetail(detail.id); load();
  }
  async function cancel() {
    const reason = prompt('作废原因（选填）');
    if (reason === null) return;
    await http.post('/api/orders/' + detail.id + '/cancel', { reason });
    openDetail(detail.id); load();
  }
  async function refund() {
    const amt = prompt('退款金额');
    if (amt === null || !amt) return;
    await http.post('/api/orders/' + detail.id + '/refund', { amount: parseFloat(amt), note: '手动退款' });
    openDetail(detail.id); load();
  }
  async function savePay() {
    setErr('');
    try {
      await http.post('/api/orders/' + detail.id + '/payments', pay);
      setPay(null);
      openDetail(detail.id); load();
    } catch (e) { setErr((e.response && e.response.data && e.response.data.error) || '登记失败'); }
  }

  const total = detail ? Number(detail.total_amount || 0) : 0;
  const paid = detail ? Number(detail.paid_amount || 0) : 0;
  const refundAmt = detail ? Number(detail.refund_amount || 0) : 0;
  const remain = total - paid;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-white">订单中心</h1>
        <button onClick={openNew} className="px-4 py-2 rounded bg-brand text-white text-sm hover:opacity-90">+ 新建订单</button>
      </div>

      {/* 状态筛选 + 搜索 */}
      <div className="flex gap-2 mb-3 flex-wrap">
        <button onClick={() => setState((s) => ({ ...s, status: '' }))} className={btn(state.status === '', '全部')}>全部</button>
        {STAGE_SEQ.map((s) => (
          <button key={s} onClick={() => setState((x) => ({ ...x, status: s }))} className={btn(state.status === s, STATUS_LABEL[s])}>{STATUS_LABEL[s]}</button>
        ))}
        <input value={state.q} onChange={(e) => setState((s) => ({ ...s, q: e.target.value }))} placeholder="搜索客户 / 订单号"
          className="ml-auto w-56 px-3 py-2 rounded bg-panel border border-line text-white text-sm outline-none" />
      </div>

      {/* 列表 */}
      <div className="bg-panel border border-line rounded-xl2 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted text-left border-b border-line">
              <th className="p-3 font-medium">订单号</th>
              <th className="p-3 font-medium">客户</th>
              <th className="p-3 font-medium">套系</th>
              <th className="p-3 font-medium">应收</th>
              <th className="p-3 font-medium">已收</th>
              <th className="p-3 font-medium">拍摄日</th>
              <th className="p-3 font-medium">状态</th>
            </tr>
          </thead>
          <tbody>
            {list.map((o) => (
              <tr key={o.id} onClick={() => openDetail(o.id)} className="border-b border-line last:border-0 cursor-pointer hover:bg-panel2">
                <td className="p-3 text-white">{o.order_no}</td>
                <td className="p-3 text-white">{o.customer_name}<span className="text-muted ml-1">{o.customer_phone}</span>{o.openid && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-400">C端</span>}</td>
                <td className="p-3 text-muted">{(o.package_snapshot && o.package_snapshot.name) || '—'}</td>
                <td className="p-3 text-white">¥{Number(o.total_amount || 0).toLocaleString()}</td>
                <td className="p-3 text-emerald-400">¥{Number(o.paid_amount || 0).toLocaleString()}</td>
                <td className="p-3 text-muted">{o.shoot_date || '—'}</td>
                <td className="p-3"><span className={'px-2 py-1 rounded-full text-xs ' + badge(o.status)}>{STATUS_LABEL[o.status]}</span></td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan="7" className="p-8 text-center text-muted">暂无订单</td></tr>}
          </tbody>
        </table>
      </div>

      {/* 详情抽屉 */}
      {detail && (
        <div className="fixed inset-0 bg-black/60 flex z-50" onClick={() => closeDetail()}>
          <div className="flex-1" />
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-panel border-l border-line h-full overflow-auto p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-white font-medium">{detail.order_no}</div>
                <div className="text-xs text-muted">{detail.customer_name} · {detail.customer_phone}</div>
                {detail.openid && <div className="text-[11px] text-sky-400 mt-0.5">C端客户 · {detail.openid}</div>}
              </div>
              <button onClick={() => closeDetail()} className="text-muted text-sm">✕</button>
            </div>

            {/* 阶段时间线 */}
            <div className="flex items-center gap-1 mb-4 overflow-x-auto">
              {STAGE_SEQ.map((s, i) => {
                const cur = STAGE_SEQ.indexOf(detail.status);
                const active = i <= cur;
                return (
                  <React.Fragment key={s}>
                    <div className={'flex flex-col items-center ' + (active ? '' : 'opacity-40')}>
                      <div className={'w-3 h-3 rounded-full ' + (active ? STAGE_COLOR[s] : 'bg-line')} />
                      <span className="text-[10px] text-muted mt-1 whitespace-nowrap">{STATUS_LABEL[s]}</span>
                    </div>
                    {i < STAGE_SEQ.length - 1 && <div className={'flex-1 h-0.5 ' + (i < cur ? STAGE_COLOR[s] : 'bg-line')} />}
                  </React.Fragment>
                );
              })}
            </div>

            {/* 金额 */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="bg-panel2 rounded-lg p-3"><div className="text-xs text-muted">应收</div><div className="text-white">¥{total.toLocaleString()}</div></div>
              <div className="bg-panel2 rounded-lg p-3"><div className="text-xs text-muted">已收</div><div className="text-emerald-400">¥{paid.toLocaleString()}</div></div>
              <div className="bg-panel2 rounded-lg p-3"><div className="text-xs text-muted">待收/退</div><div className="text-white">{refundAmt > 0 ? '退¥' + refundAmt : '¥' + remain}</div></div>
            </div>

            {/* 套系快照 */}
            {detail.package_snapshot && (
              <div className="bg-panel2 rounded-lg p-3 mb-3 text-sm">
                <div className="text-white">{detail.package_snapshot.name} · ¥{detail.package_snapshot.price}</div>
              </div>
            )}

            {/* 选片结果（客户在小程序提交，后台可查看/修改）*/}
            <div className="text-xs text-muted mb-1 flex items-center justify-between">
              <span>选片结果</span>
              {sel && sel.selection && (
                <span className={sel.selection.submitted ? 'text-emerald-400' : 'text-amber-400'}>
                  {sel.selection.submitted ? '已提交' : '草稿'}
                </span>
              )}
            </div>
            <div className="mb-4">
              {!sel && <div className="text-muted text-sm py-2">加载中…</div>}
              {sel && !sel.selection && <div className="text-muted text-sm py-2">该订单暂无客户选片</div>}
              {sel && sel.selection && (
                <>
                  <div className="grid grid-cols-4 gap-2 mb-3">
                    {sel.photos.map((p) => {
                      const on = sel.selection.marks.includes(p.photo_url);
                      return (
                        <button key={p.id} onClick={() => toggleSel(p.photo_url)}
                          className={'relative rounded-lg overflow-hidden border ' + (on ? 'border-brand' : 'border-line')}>
                          <img src={img(p.photo_url)} className="w-full h-20 object-cover" />
                          <span className={'absolute top-1 right-1 w-4 h-4 rounded-full text-[10px] flex items-center justify-center ' + (on ? 'bg-brand text-white' : 'bg-black/50 text-white')}>{on ? '✓' : ''}</span>
                        </button>
                      );
                    })}
                    {sel.photos.length === 0 && <div className="col-span-full text-muted text-sm py-2">该订单无可选样片（需在作品相册中上传 sample 区照片）</div>}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted">已选 {sel.selection.marks.length} 张</span>
                    <button onClick={saveSel} disabled={selSaving}
                      className="px-3 py-1.5 rounded bg-brand text-white text-xs disabled:opacity-40">保存修改</button>
                  </div>
                </>
              )}
            </div>

            {/* 操作 */}
            <div className="flex flex-wrap gap-2 mb-4">
              <button onClick={advance} disabled={detail.status === 'completed' || detail.status === 'cancelled'}
                className="px-3 py-1.5 rounded bg-brand text-white text-xs disabled:opacity-40">推进阶段</button>
              <button onClick={() => setPay({ type: 'deposit', amount: '', method: 'offline', note: '' })}
                className="px-3 py-1.5 rounded bg-panel2 border border-line text-white text-xs">+ 收款</button>
              <button onClick={refund} className="px-3 py-1.5 rounded bg-panel2 border border-line text-amber-400 text-xs">退款</button>
              <button onClick={cancel} className="px-3 py-1.5 rounded bg-panel2 border border-line text-red-400 text-xs">作废</button>
              <button onClick={openEdit} className="px-3 py-1.5 rounded bg-panel2 border border-line text-white text-xs">编辑</button>
              <button onClick={removeOrder} className="px-3 py-1.5 rounded bg-panel2 border border-line text-red-400 text-xs">删除</button>
            </div>

            {/* 收款流水 */}
            <div className="text-xs text-muted mb-1">收款流水</div>
            <div className="mb-4">
              {(!detail.payments || detail.payments.length === 0) && <div className="text-muted text-sm py-2">暂无流水</div>}
              {detail.payments && detail.payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between border-b border-line py-2 text-sm">
                  <div>
                    <span className="text-white">{TYPE_LABEL[p.type]}</span>
                    <span className="text-muted ml-2">{p.method === 'online' ? '线上' : '线下'}</span>
                  </div>
                  <div className={p.type === 'refund' ? 'text-red-400' : 'text-emerald-400'}>
                    {p.type === 'refund' ? '-' : '+'}¥{Number(p.amount).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>

            {/* 操作日志 */}
            <div className="text-xs text-muted mb-1">操作日志</div>
            <div className="text-xs text-muted space-y-1">
              {(detail.logs || []).map((l, i) => (
                <div key={i}>· {new Date(l.t).toLocaleString('zh-CN')} {l.text}</div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 新建订单弹窗 */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4" onClick={() => setShowForm(false)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="w-full max-w-lg bg-panel border border-line rounded-xl2 p-6 max-h-[90vh] overflow-auto">
            <div className="text-white font-medium mb-4">新建订单</div>
            <div className="grid grid-cols-2 gap-3">
              <input required value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} placeholder="客户姓名"
                className="px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
              <input value={form.customer_phone} onChange={(e) => setForm({ ...form, customer_phone: e.target.value })} placeholder="联系电话"
                className="px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
            </div>
            <select value={form.package_id} onChange={(e) => setForm({ ...form, package_id: e.target.value })} required
              className="w-full mt-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none">
              <option value="">选择套系</option>
              {pkgs.map((p) => <option key={p.id} value={p.id}>{p.name} · ¥{p.price}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <input value={form.deposit} onChange={(e) => setForm({ ...form, deposit: e.target.value })} type="number" placeholder="定金"
                className="px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
              <input value={form.balance} onChange={(e) => setForm({ ...form, balance: e.target.value })} type="number" placeholder="尾款"
                className="px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <select value={form.deposit_method} onChange={(e) => setForm({ ...form, deposit_method: e.target.value })} className="px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none">
                <option value="offline">定金·线下</option><option value="online">定金·线上</option>
              </select>
              <select value={form.balance_method} onChange={(e) => setForm({ ...form, balance_method: e.target.value })} className="px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none">
                <option value="offline">尾款·线下</option><option value="online">尾款·线上</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <input value={form.shoot_date} onChange={(e) => setForm({ ...form, shoot_date: e.target.value })} type="date" placeholder="拍摄日期"
                className="px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
              <input value={form.executor} onChange={(e) => setForm({ ...form, executor: e.target.value })} placeholder="执行人"
                className="px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
            </div>
            <input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} placeholder="备注"
              className="w-full mt-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
            {err && <div className="text-xs text-red-400 mt-2">{err}</div>}
            <div className="flex gap-2 justify-end mt-4">
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 rounded text-sm text-muted">取消</button>
              <button type="submit" className="px-4 py-2 rounded bg-brand text-white text-sm">创建</button>
            </div>
          </form>
        </div>
      )}

      {/* 收款弹窗 */}
      {pay && detail && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[70] p-4" onClick={() => setPay(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm bg-panel border border-line rounded-xl2 p-6">
            <div className="text-white font-medium mb-4">登记收款 · {detail.order_no}</div>
            <select value={pay.type} onChange={(e) => setPay({ ...pay, type: e.target.value })} className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none">
              <option value="deposit">定金</option><option value="balance">尾款</option><option value="extra">加片/增值</option>
            </select>
            <input value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} type="number" placeholder="金额"
              className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
            <select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })} className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none">
              <option value="offline">线下</option><option value="online">线上</option>
            </select>
            <input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} placeholder="备注(选填)"
              className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
            {err && <div className="text-xs text-red-400 mb-2">{err}</div>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setPay(null)} className="px-4 py-2 rounded text-sm text-muted">取消</button>
              <button onClick={savePay} className="px-4 py-2 rounded bg-brand text-white text-sm">保存</button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑订单弹窗 */}
      {edit && detail && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[70] p-4" onClick={() => setEdit(false)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={saveEdit} className="w-full max-w-md bg-panel border border-line rounded-xl2 p-6">
            <div className="text-white font-medium mb-4">编辑订单 · {detail.order_no}</div>
            <div className="grid grid-cols-2 gap-3">
              <input required value={editForm.customer_name} onChange={(e) => setEditForm({ ...editForm, customer_name: e.target.value })} placeholder="客户姓名"
                className="px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
              <input value={editForm.customer_phone} onChange={(e) => setEditForm({ ...editForm, customer_phone: e.target.value })} placeholder="联系电话"
                className="px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
            </div>
            <input value={editForm.shoot_date} onChange={(e) => setEditForm({ ...editForm, shoot_date: e.target.value })} type="date" placeholder="拍摄日期"
              className="w-full mt-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
            <input value={editForm.executor} onChange={(e) => setEditForm({ ...editForm, executor: e.target.value })} placeholder="执行人"
              className="w-full mt-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
            <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
              className="w-full mt-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none">
              <option value="unpaid">待付定金</option><option value="deposit">已付定金</option><option value="shot">已拍摄</option>
              <option value="selecting">选片中</option><option value="retouching">精修中</option><option value="delivered">已交付</option>
              <option value="completed">已完成</option><option value="cancelled">已作废</option>
            </select>
            <input value={editForm.remark} onChange={(e) => setEditForm({ ...editForm, remark: e.target.value })} placeholder="备注"
              className="w-full mt-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
            <div className="flex gap-2 justify-end mt-4">
              <button type="button" onClick={() => setEdit(false)} className="px-4 py-2 rounded text-sm text-muted">取消</button>
              <button type="submit" className="px-4 py-2 rounded bg-brand text-white text-sm">保存</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function btn(active, label) {
  return 'px-3 py-2 rounded-full text-sm border ' + (active ? 'bg-brand text-white border-brand' : 'bg-panel border-line text-muted');
}
function badge(status) {
  return {
    unpaid: 'bg-red-500/15 text-red-400', deposit: 'bg-amber-500/15 text-amber-400', shot: 'bg-sky-500/15 text-sky-400',
    selecting: 'bg-indigo-500/15 text-indigo-400', retouching: 'bg-purple-500/15 text-purple-400', delivered: 'bg-teal-500/15 text-teal-400',
    completed: 'bg-emerald-500/15 text-emerald-400', cancelled: 'bg-line text-muted'
  }[status] || 'bg-line text-muted';
}
