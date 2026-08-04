import React, { useState, useEffect } from 'react';
import http, { img } from '../api.js';
import { useViewState } from '../tabMemory.js';

export default function Works() {
  // Tab 记忆：分类 tab / 搜索 / 公开筛选 / 页码 全部存入 URL + sessionStorage
  const [state, setState] = useViewState('works', { tab: '', q: '', vis: '', page: 1 });
  const [cats, setCats] = useState([]);
  const [data, setData] = useState({ items: [], total: 0, pageSize: 12 });
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());

  function emptyForm() {
    return { id: null, title: '', category_id: '', is_public: true, allow_download: false, cover: null, cover_url: '', description: '', tags: '' };
  }

  const reload = () => {
    const p = new URLSearchParams();
    if (state.tab) p.set('category', state.tab);
    if (state.q) p.set('q', state.q);
    if (state.vis === '1') p.set('is_public', '1');
    if (state.vis === '0') p.set('is_public', '0');
    p.set('page', state.page);
    http.get('/api/works?' + p.toString()).then((r) => setData(r.data));
  };
  useEffect(() => { http.get('/api/categories').then((r) => setCats(r.data)); }, []);
  useEffect(reload, [state]);

  // 成片下载开关（保留其余字段，仅翻转 allow_download 后整行 PUT）
  async function toggleDownload(w) {
    try {
      await http.put('/api/works/' + w.id, {
        title: w.title, category_id: w.category_id || null, is_public: !!w.is_public,
        is_private: !!w.is_private, cover_url: w.cover_url || '', description: w.description || '',
        blessing: w.blessing || '', tags: w.tags || [], live: !!w.live,
        customer_name: w.customer_name || '', order_id: w.order_id || null,
        allow_download: !w.allow_download
      });
      reload();
    } catch (e) {
      alert((e.response && e.response.data && e.response.data.error) || '操作失败');
    }
  }

  const openNew = () => { setEditing(null); setForm(emptyForm()); setShowForm(true); };
  const openEdit = (w) => {
    setEditing(w);
    setForm({
      id: w.id, title: w.title, category_id: w.category_id || '',
      is_public: !!w.is_public, allow_download: !!w.allow_download,
      cover: null, cover_url: w.cover_url || '', description: w.description || '',
      tags: Array.isArray(w.tags) ? w.tags.join('、') : (w.tags || '')
    });
    setShowForm(true);
  };

  const setTab = (t) => setState((s) => ({ ...s, tab: t, page: 1 }));
  const setQ = (q) => setState((s) => ({ ...s, q, page: 1 }));
  const setVis = (v) => setState((s) => ({ ...s, vis: v, page: 1 }));
  const goPage = (p) => setState((s) => ({ ...s, page: p }));

  async function submit(e) {
    e.preventDefault();
    let cover_url = form.cover_url || '';
    if (form.cover) {
      const fd = new FormData();
      fd.append('file', form.cover);
      const r = await http.post('/api/upload', fd);
      cover_url = r.data.url;
    }
    const tags = (form.tags || '').split(/[、,，\s]+/).map((s) => s.trim()).filter(Boolean);
    const payload = {
      title: form.title,
      category_id: form.category_id || null,
      is_public: form.is_public,
      allow_download: form.allow_download,
      cover_url,
      description: form.description || '',
      tags
    };
    try {
      if (editing) {
        await http.put('/api/works/' + editing.id, {
          ...payload,
          is_private: !!editing.is_private, blessing: editing.blessing || '',
          live: !!editing.live, customer_name: editing.customer_name || '', order_id: editing.order_id || null
        });
      } else {
        await http.post('/api/works', payload);
      }
      setShowForm(false);
      setEditing(null);
      reload();
    } catch (e) {
      alert((e.response && e.response.data && e.response.data.error) || '保存失败');
    }
  }

  async function remove(w) {
    if (!confirm(`确认删除作品「${w.title}」？\n该作品下的相册与选片记录也会一并删除，不可恢复。`)) return;
    try {
      await http.delete('/api/works/' + w.id);
      reload();
    } catch (e) {
      alert((e.response && e.response.data && e.response.data.error) || '删除失败');
    }
  }

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-white">作品管理</h1>
        <button onClick={openNew} className="px-4 py-2 rounded bg-brand text-white text-sm hover:opacity-90">+ 新建作品组</button>
      </div>

      {/* 分类 Tab（记忆） */}
      <div className="flex gap-2 mb-3 overflow-x-auto">
        <button onClick={() => setTab('')}
          className={'px-4 py-2 rounded-full text-sm border ' + (state.tab === '' ? 'bg-brand text-white border-brand' : 'bg-panel border-line text-muted')}>全部</button>
        {cats.map((c) => (
          <button key={c.id} onClick={() => setTab(String(c.id))}
            className={'px-4 py-2 rounded-full text-sm border ' + (state.tab === String(c.id) ? 'bg-brand text-white border-brand' : 'bg-panel border-line text-muted')}>{c.name}</button>
        ))}
      </div>

      {/* 搜索 + 公开筛选（记忆） */}
      <div className="flex gap-3 mb-4">
        <input value={state.q} onChange={(e) => setQ(e.target.value)} placeholder="搜索作品 / 客户"
          className="flex-1 px-3 py-2 rounded bg-panel border border-line text-white text-sm outline-none" />
        <select value={state.vis} onChange={(e) => setVis(e.target.value)}
          className="px-3 py-2 rounded bg-panel border border-line text-white text-sm outline-none">
          <option value="">全部</option>
          <option value="1">公开</option>
          <option value="0">私密</option>
        </select>
      </div>

      {/* 作品网格 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {data.items.map((w) => (
          <div key={w.id} className="bg-panel border border-line rounded-xl2 overflow-hidden">
            <div className="h-40 bg-panel2 flex items-center justify-center text-muted text-3xl">
              {w.cover_url ? <img src={img(w.cover_url)} className="w-full h-full object-cover" /> : '▣'}
            </div>
            <div className="p-3">
              <div className="text-sm text-white truncate">{w.title}</div>
              <div className="text-xs text-muted mt-1 flex justify-between">
                <span>{w.is_public ? '公开' : '私密'}</span>
                <span>{(w.tags || []).join(' · ')}</span>
              </div>
              <button onClick={() => toggleDownload(w)}
                className={'mt-2 w-full text-xs py-1.5 rounded border ' + (w.allow_download ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-panel2 text-muted border-line')}>
                {w.allow_download ? '✓ 允许下载' : '禁止下载'}
              </button>
              <div className="flex gap-2 mt-2">
                <button onClick={() => openEdit(w)} className="flex-1 text-xs py-1.5 rounded border border-line text-muted hover:text-white">编辑</button>
                <button onClick={() => remove(w)} className="flex-1 text-xs py-1.5 rounded border border-line text-red-400 hover:bg-red-500/10">删除</button>
              </div>
            </div>
          </div>
        ))}
        {data.items.length === 0 && <div className="col-span-full text-center text-muted py-10">暂无作品</div>}
      </div>

      {/* 分页（记忆） */}
      {pages > 1 && (
        <div className="flex gap-2 mt-5 justify-center">
          {Array.from({ length: pages }).map((_, i) => (
            <button key={i} onClick={() => goPage(i + 1)}
              className={'w-8 h-8 rounded text-sm border ' + (data.page === i + 1 ? 'bg-brand text-white border-brand' : 'bg-panel border-line text-muted')}>{i + 1}</button>
          ))}
        </div>
      )}

      {/* 新建/编辑作品弹窗 */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowForm(false)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={submit}
            className="w-96 bg-panel border border-line rounded-xl2 p-6">
            <div className="text-white font-medium mb-4">{editing ? '编辑作品组' : '新建作品组'}</div>
            <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="作品标题" className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
            <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}
              className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none">
              <option value="">选择分类</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="作品描述（选填）"
              className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none h-16" />
            <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="标签，用顿号分隔（选填）"
              className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
            <label className="flex items-center gap-2 text-sm text-muted mb-4">
              <input type="checkbox" checked={form.is_public} onChange={(e) => setForm({ ...form, is_public: e.target.checked })} /> 对外公开展示
            </label>
            <label className="flex items-center gap-2 text-sm text-muted mb-4">
              <input type="checkbox" checked={form.allow_download} onChange={(e) => setForm({ ...form, allow_download: e.target.checked })} /> 允许客户下载成片（小程序相册）
            </label>
            <input type="file" accept="image/*" onChange={(e) => setForm({ ...form, cover: e.target.files[0] })}
              className="w-full mb-2 text-xs text-muted" />
            {form.cover_url && <img src={img(form.cover_url)} className="w-20 h-20 object-cover rounded mb-4" />}
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 rounded text-sm text-muted">取消</button>
              <button type="submit" className="px-4 py-2 rounded bg-brand text-white text-sm">保存</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
