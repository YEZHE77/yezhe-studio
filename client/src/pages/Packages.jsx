import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import http, { img } from '../api.js';
import { useViewState } from '../tabMemory.js';

export default function Packages() {
  const nav = useNavigate();
  // Tab 记忆：状态筛选 + 搜索
  const [state, setState] = useViewState('packages', { status: 'all', q: '' });
  const [list, setList] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [trace, setTrace] = useState(null); // 订单溯源
  const [form, setForm] = useState(emptyForm());

  function emptyForm() {
    return { id: null, name: '', price: '', description: '', cover: null, cover_url: '', category_id: '',
      addons: [], marketing_coupon: '', marketing_activity: '', status: 'on' };
  }

  const load = () => {
    const p = new URLSearchParams();
    if (state.status && state.status !== 'all') p.set('status', state.status);
    if (state.q) p.set('q', state.q);
    http.get('/api/packages?' + p.toString()).then((r) => setList(r.data)).catch(() => {});
  };
  useEffect(load, [state]);

  const openNew = () => { setEditing(null); setForm(emptyForm()); setShowForm(true); };
  const openEdit = (pkg) => {
    setEditing(pkg);
    setForm({
      id: pkg.id, name: pkg.name, price: pkg.price, description: pkg.description || '',
      cover: null, cover_url: pkg.cover_url || '', category_id: pkg.category_id || '',
      addons: Array.isArray(pkg.addons) ? pkg.addons : [],
      marketing_coupon: (pkg.marketing && pkg.marketing.coupon) || '',
      marketing_activity: (pkg.marketing && pkg.marketing.activity) || '',
      status: pkg.status || 'on'
    });
    setShowForm(true);
  };

  const addAddon = () => setForm({ ...form, addons: [...form.addons, { name: '', price: '' }] });
  const updAddon = (i, k, v) => setForm({ ...form, addons: form.addons.map((a, j) => j === i ? { ...a, [k]: v } : a) });
  const delAddon = (i) => setForm({ ...form, addons: form.addons.filter((_, j) => j !== i) });

  async function submit(e) {
    e.preventDefault();
    let cover_url = form.cover_url || '';
    if (form.cover) {
      const fd = new FormData();
      fd.append('file', form.cover);
      const r = await http.post('/api/upload', fd);
      cover_url = r.data.url;
    }
    const payload = {
      name: form.name, price: parseFloat(form.price) || 0, description: form.description,
      cover_url, category_id: form.category_id || null,
      addons: form.addons.filter((a) => a.name).map((a) => ({ name: a.name, price: parseFloat(a.price) || 0 })),
      marketing: { coupon: form.marketing_coupon, activity: form.marketing_activity },
      status: form.status
    };
    if (editing) await http.put('/api/packages/' + editing.id, payload);
    else await http.post('/api/packages', payload);
    setShowForm(false);
    load();
  }

  const del = async (id) => {
    if (!confirm('确认删除该套系？')) return;
    await http.delete('/api/packages/' + id);
    load();
  };

  const openTrace = async (id) => {
    const r = await http.get('/api/packages/' + id + '/orders');
    setTrace({ id, rows: r.data });
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-white">套系管理</h1>
        <button onClick={openNew} className="px-4 py-2 rounded bg-brand text-white text-sm hover:opacity-90">+ 新建套系</button>
      </div>

      {/* 状态 Tab + 搜索 */}
      <div className="flex gap-2 mb-3">
        {[{ v: 'all', l: '全部' }, { v: 'on', l: '已上架' }, { v: 'off', l: '已下架' }].map((t) => (
          <button key={t.v} onClick={() => setState((s) => ({ ...s, status: t.v }))}
            className={'px-4 py-2 rounded-full text-sm border ' + (state.status === t.v ? 'bg-brand text-white border-brand' : 'bg-panel border-line text-muted')}>{t.l}</button>
        ))}
        <input value={state.q} onChange={(e) => setState((s) => ({ ...s, q: e.target.value }))}
          placeholder="搜索套系名称" className="ml-auto w-56 px-3 py-2 rounded bg-panel border border-line text-white text-sm outline-none" />
      </div>

      {/* 列表 */}
      <div className="bg-panel border border-line rounded-xl2 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted text-left border-b border-line">
              <th className="p-3 font-medium">套系</th>
              <th className="p-3 font-medium">价格</th>
              <th className="p-3 font-medium">增值项</th>
              <th className="p-3 font-medium">营销</th>
              <th className="p-3 font-medium">状态</th>
              <th className="p-3 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id} className="border-b border-line last:border-0">
                <td className="p-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded bg-panel2 flex items-center justify-center text-muted overflow-hidden">
                      {p.cover_url ? <img src={img(p.cover_url)} className="w-full h-full object-cover" /> : '◆'}
                    </div>
                    <div>
                      <div className="text-white">{p.name}</div>
                      <div className="text-xs text-muted max-w-xs truncate">{p.description}</div>
                    </div>
                  </div>
                </td>
                <td className="p-3 text-white">¥{Number(p.price).toLocaleString()}</td>
                <td className="p-3 text-muted">{(p.addons || []).length} 项</td>
                <td className="p-3 text-muted max-w-[180px] truncate">{(p.marketing && p.marketing.coupon) || (p.marketing && p.marketing.activity) || '—'}</td>
                <td className="p-3">
                  <span className={'px-2 py-1 rounded-full text-xs ' + (p.status === 'on' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-line text-muted')}>
                    {p.status === 'on' ? '上架' : '下架'}
                  </span>
                </td>
                <td className="p-3 text-right whitespace-nowrap">
                  <button onClick={() => nav('/orders?pkg=' + p.id)} className="text-brand text-xs mr-3 hover:underline">复用开单</button>
                  <button onClick={() => openTrace(p.id)} className="text-sky-400 text-xs mr-3 hover:underline">溯源</button>
                  <button onClick={() => openEdit(p)} className="text-muted text-xs mr-3 hover:text-white">编辑</button>
                  <button onClick={() => del(p.id)} className="text-red-400 text-xs hover:underline">删除</button>
                </td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan="6" className="p-8 text-center text-muted">暂无套系</td></tr>}
          </tbody>
        </table>
      </div>

      {/* 新建/编辑弹窗 */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowForm(false)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={submit}
            className="w-full max-w-lg bg-panel border border-line rounded-xl2 p-6 max-h-[90vh] overflow-auto">
            <div className="text-white font-medium mb-4">{editing ? '编辑套系' : '新建套系'}</div>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="套系名称"
              className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
            <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} type="number" placeholder="套系价格"
              className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="包含内容描述"
              className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none h-16" />
            <div className="text-xs text-muted mb-1">封面图（可选）</div>
            <input type="file" accept="image/*" onChange={(e) => setForm({ ...form, cover: e.target.files[0] })} className="w-full mb-3 text-xs text-muted" />
            {form.cover_url && <img src={img(form.cover_url)} className="w-20 h-20 object-cover rounded mb-3" />}

            {/* 增值定价 */}
            <div className="text-xs text-muted mb-1">增值服务定价</div>
            {form.addons.map((a, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input value={a.name} onChange={(e) => updAddon(i, 'name', e.target.value)} placeholder="名称(如加精修/张)" className="flex-1 px-2 py-1 rounded bg-panel2 border border-line text-white text-xs outline-none" />
                <input value={a.price} onChange={(e) => updAddon(i, 'price', e.target.value)} type="number" placeholder="价格" className="w-24 px-2 py-1 rounded bg-panel2 border border-line text-white text-xs outline-none" />
                <button type="button" onClick={() => delAddon(i)} className="px-2 text-red-400 text-xs">✕</button>
              </div>
            ))}
            <button type="button" onClick={addAddon} className="text-brand text-xs mb-3">+ 添加增值项</button>

            {/* 营销绑定 */}
            <div className="text-xs text-muted mb-1 mt-1">营销绑定</div>
            <input value={form.marketing_coupon} onChange={(e) => setForm({ ...form, marketing_coupon: e.target.value })} placeholder="优惠券(如新客立减200)" className="w-full mb-2 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
            <input value={form.marketing_activity} onChange={(e) => setForm({ ...form, marketing_activity: e.target.value })} placeholder="营销活动(如转发送摆台)" className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />

            <div className="flex items-center gap-4 mb-4">
              <span className="text-xs text-muted">状态</span>
              <label className="flex items-center gap-1 text-sm text-white"><input type="radio" checked={form.status === 'on'} onChange={() => setForm({ ...form, status: 'on' })} /> 上架</label>
              <label className="flex items-center gap-1 text-sm text-white"><input type="radio" checked={form.status === 'off'} onChange={() => setForm({ ...form, status: 'off' })} /> 下架</label>
            </div>

            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 rounded text-sm text-muted">取消</button>
              <button type="submit" className="px-4 py-2 rounded bg-brand text-white text-sm">保存</button>
            </div>
          </form>
        </div>
      )}

      {/* 订单溯源弹窗 */}
      {trace && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setTrace(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg bg-panel border border-line rounded-xl2 p-6">
            <div className="text-white font-medium mb-4">订单溯源（套系 #{trace.id}）</div>
            <div className="max-h-80 overflow-auto">
              {trace.rows.length === 0 && <div className="text-muted text-sm py-6 text-center">暂无订单引用该套系</div>}
              {trace.rows.map((o) => (
                <div key={o.id} className="flex items-center justify-between border-b border-line py-2 text-sm">
                  <div>
                    <span className="text-white">{o.order_no}</span>
                    <span className="text-muted ml-2">{o.customer_name}</span>
                  </div>
                  <div className="text-muted">¥{Number(o.total_amount || 0).toLocaleString()} · {o.status}</div>
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-4">
              <button onClick={() => setTrace(null)} className="px-4 py-2 rounded text-sm text-muted">关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
