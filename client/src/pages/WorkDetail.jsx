import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import http, { img, compressImage } from '../api.js';

const ZONES = [
  { key: 'sample', label: '样片', desc: '对外展示、C端小程序可见' },
  { key: 'local', label: '原片', desc: '仅后台可见，不对外' },
  { key: 'final', label: '成片', desc: '交付客户的精修成片' }
];

export default function WorkDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const fileRef = useRef(null);

  const [cats, setCats] = useState([]);
  const [work, setWork] = useState(null);
  const [albums, setAlbums] = useState([]);
  const [zone, setZone] = useState('sample');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [form, setForm] = useState({ title: '', category_id: '', description: '', tags: '', customer_name: '', is_public: true, allow_download: false });
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [reordering, setReordering] = useState(false);

  async function loadWork() {
    try {
      const r = await http.get('/api/works/' + id);
      const w = r.data.work;
      setWork(w);
      setForm({
        title: w.title || '',
        category_id: w.category_id || '',
        description: w.description || '',
        tags: Array.isArray(w.tags) ? w.tags.join('、') : (w.tags || ''),
        customer_name: w.customer_name || '',
        is_public: !!w.is_public,
        allow_download: !!w.allow_download
      });
    } catch (e) {
      alert('加载作品失败');
    }
  }

  async function loadAlbums() {
    try {
      const r = await http.get('/api/works/' + id + '/albums');
      setAlbums(r.data.items || []);
    } catch (e) {
      console.error(e);
    }
  }

  async function loadAll() {
    setLoading(true);
    await Promise.all([loadWork(), loadAlbums()]);
    setLoading(false);
  }

  useEffect(() => { http.get('/api/categories').then((r) => setCats(r.data)); }, []);
  useEffect(() => { loadAll(); }, [id]);

  async function saveBasic(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const tags = (form.tags || '').split(/[、,，\s]+/).map((s) => s.trim()).filter(Boolean);
      await http.put('/api/works/' + id, {
        title: form.title,
        category_id: form.category_id || null,
        is_public: form.is_public,
        allow_download: form.allow_download,
        cover_url: work.cover_url || '',
        description: form.description,
        tags,
        is_private: !!work.is_private,
        blessing: work.blessing || '',
        live: !!work.live,
        customer_name: form.customer_name,
        order_id: work.order_id || null
      });
      await loadWork();
      alert('保存成功');
    } catch (err) {
      alert((err.response && err.response.data && err.response.data.error) || '保存失败');
    } finally { setSaving(false); }
  }

  async function batchUpload(e) {
    const files = e.target.files;
    if (!files || !files.length) return;
    setUploading(true);
    try {
      // 批量压缩：并发 3 张一组，避免 UI 卡死
      const compressed = [];
      const list = Array.from(files);
      for (let i = 0; i < list.length; i += 3) {
        const chunk = list.slice(i, i + 3);
        const out = await Promise.all(chunk.map((f) => compressImage(f, { maxWidth: 1920, maxHeight: 1920, quality: 0.82 })));
        compressed.push(...out);
      }
      const fd = new FormData();
      for (const f of compressed) fd.append('files', f);
      const up = await http.post('/api/upload-multiple', fd, { timeout: 300000 });
      const urls = up.data.urls || [];
      if (urls.length) {
        await http.post('/api/works/' + id + '/albums', { urls, zone });
        await loadAlbums();
      }
      alert(`成功上传 ${urls.length} 张照片`);
    } catch (err) {
      alert((err.response && err.response.data && err.response.data.error) || '上传失败');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function setCover(url) {
    try {
      await http.put('/api/works/' + id + '/cover', { cover_url: url });
      await loadWork();
      alert('封面已更新');
    } catch (err) {
      alert('封面设置失败');
    }
  }

  async function deletePhoto(aid) {
    if (!confirm('确认删除这张照片？')) return;
    try {
      await http.delete('/api/albums/' + aid);
      await loadAlbums();
      setSelected((s) => { const n = new Set(s); n.delete(aid); return n; });
    } catch (err) { alert('删除失败'); }
  }

  async function deleteSelected() {
    if (!selected.size || !confirm(`确认删除选中的 ${selected.size} 张照片？`)) return;
    try {
      await Promise.all([...selected].map((aid) => http.delete('/api/albums/' + aid)));
      await loadAlbums();
      setSelected(new Set());
    } catch (err) { alert('批量删除失败'); }
  }

  async function updateSort(aid, value) {
    const sort = parseInt(value, 10);
    if (Number.isNaN(sort)) return;
    try {
      await http.put('/api/albums/' + aid + '/sort', { sort });
      await loadAlbums();
    } catch (err) { alert('排序更新失败'); }
  }

  async function saveReorder(newOrder) {
    if (!newOrder || newOrder.length < 2) return;
    setReordering(true);
    try {
      await http.post('/api/works/' + id + '/albums/reorder', { orders: newOrder, zone });
      await loadAlbums();
    } catch (err) {
      alert((err.response && err.response.data && err.response.data.error) || '排序保存失败');
    } finally { setReordering(false); }
  }

  function handleDragStart(e, aid) {
    setDraggedId(aid);
    e.dataTransfer.effectAllowed = 'move';
    // 隐藏默认拖拽幽灵图上的悬停提示
    e.dataTransfer.setData('text/plain', String(aid));
  }
  function handleDragOver(e, aid) {
    e.preventDefault();
    if (aid !== draggedId) setDragOverId(aid);
  }
  function handleDrop(e, dropId) {
    e.preventDefault();
    if (!draggedId || draggedId === dropId) { setDraggedId(null); setDragOverId(null); return; }
    const list = [...zoneAlbums];
    const from = list.findIndex((a) => a.id === draggedId);
    const to = list.findIndex((a) => a.id === dropId);
    if (from < 0 || to < 0) { setDraggedId(null); setDragOverId(null); return; }
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
    saveReorder(list.map((a) => a.id));
    setDraggedId(null);
    setDragOverId(null);
  }

  async function removeWork() {
    if (!confirm(`确认删除作品「${work.title}」？\n该作品下的 ${albums.length} 张照片与选片记录也会一并删除，不可恢复。`)) return;
    try {
      await http.delete('/api/works/' + id);
      navigate('/works');
    } catch (err) { alert('删除失败'); }
  }

  function toggleSelect(aid) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(aid)) n.delete(aid); else n.add(aid);
      return n;
    });
  }

  const zoneAlbums = albums.filter((a) => a.zone === zone).sort((a, b) => (a.sort - b.sort) || (a.id - b.id));

  if (loading) return <div className="p-10 text-muted">加载中…</div>;

  return (
    <div className="max-w-7xl mx-auto">
      {/* 顶部导航：返回 + 标题 + 删除 */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/works')} className="px-3 py-1.5 rounded border border-line text-sm text-muted hover:text-brand hover:border-brand">← 返回作品列表</button>
          <h1 className="text-xl font-semibold text-fg">{work.title}</h1>
          <span className="text-xs px-2 py-0.5 rounded bg-panel border border-line text-muted">{work.is_public ? '公开' : '私密'}</span>
        </div>
        <button onClick={removeWork} className="px-3 py-1.5 rounded border border-red-200 text-red-500 text-sm hover:bg-red-50">删除作品</button>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* 左侧：基本信息 */}
        <div className="lg:col-span-1 space-y-5">
          <form onSubmit={saveBasic} className="bg-panel border border-line rounded-xl2 p-5">
            <h2 className="text-base font-semibold text-fg mb-4">基本信息</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-muted mb-1">作品标题</label>
                <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full px-3 py-2 rounded bg-ink border border-line text-fg text-sm outline-none" />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">分类</label>
                <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} className="w-full px-3 py-2 rounded bg-ink border border-line text-fg text-sm outline-none">
                  <option value="">未分类</option>
                  {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">客户名称</label>
                <input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} placeholder="如：XI XI & JUN HUA" className="w-full px-3 py-2 rounded bg-ink border border-line text-fg text-sm outline-none" />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">作品描述</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={4} className="w-full px-3 py-2 rounded bg-ink border border-line text-fg text-sm outline-none" />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">标签</label>
                <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="用顿号、逗号或空格分隔" className="w-full px-3 py-2 rounded bg-ink border border-line text-fg text-sm outline-none" />
              </div>
              <label className="flex items-center gap-2 text-sm text-fg">
                <input type="checkbox" checked={form.is_public} onChange={(e) => setForm({ ...form, is_public: e.target.checked })} /> 对外公开展示
              </label>
              <label className="flex items-center gap-2 text-sm text-fg">
                <input type="checkbox" checked={form.allow_download} onChange={(e) => setForm({ ...form, allow_download: e.target.checked })} /> 允许客户下载成片
              </label>
            </div>
            <button type="submit" disabled={saving} className="mt-5 w-full px-4 py-2 rounded bg-brand text-white text-sm hover:opacity-90 disabled:opacity-60">{saving ? '保存中…' : '保存基本信息'}</button>
          </form>

          {work.cover_url && (
            <div className="bg-panel border border-line rounded-xl2 p-5">
              <h2 className="text-base font-semibold text-fg mb-3">当前封面</h2>
              <img src={img(work.cover_url)} className="w-full h-40 object-cover rounded" alt="封面" />
            </div>
          )}
        </div>

        {/* 右侧：相册管理 */}
        <div className="lg:col-span-2">
          <div className="bg-panel border border-line rounded-xl2 p-5 min-h-[500px]">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <div>
                <h2 className="text-base font-semibold text-fg">相册管理</h2>
                <p className="text-xs text-muted mt-0.5">共 {albums.length} 张照片 · 当前分区 {zoneAlbums.length} 张</p>
              </div>
              <div className="flex items-center gap-2">
                {selected.size > 0 && (
                  <button onClick={deleteSelected} className="px-3 py-1.5 rounded border border-red-200 text-red-500 text-sm hover:bg-red-50">删除选中({selected.size})</button>
                )}
                <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={batchUpload} />
                <button onClick={() => fileRef.current && fileRef.current.click()} disabled={uploading} className="px-4 py-2 rounded bg-brand text-white text-sm hover:opacity-90 disabled:opacity-60">{uploading ? '上传中…' : '+ 批量上传'}</button>
              </div>
            </div>

            {/* 分区 Tab */}
            <div className="flex gap-2 mb-4 border-b border-line pb-3">
              {ZONES.map((z) => (
                <button key={z.key} onClick={() => { setZone(z.key); setSelected(new Set()); }}
                  className={'px-4 py-2 rounded-t text-sm ' + (zone === z.key ? 'text-brand border-b-2 border-brand font-medium' : 'text-muted hover:text-fg')}>
                  {z.label}
                  <span className="ml-1 text-xs text-muted">({albums.filter((a) => a.zone === z.key).length})</span>
                </button>
              ))}
            </div>
            <p className="text-xs text-muted mb-3">{ZONES.find((z) => z.key === zone).desc}</p>

            {/* 相册网格 */}
            {zoneAlbums.length === 0 ? (
              <div className="text-center text-muted py-16 border border-dashed border-line rounded-xl2">
                该分区暂无照片，点击右上角「批量上传」添加
              </div>
            ) : (
              <div className={`grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 ${reordering ? 'opacity-60' : ''}`}>
                {zoneAlbums.map((a) => (
                  <div
                    key={a.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, a.id)}
                    onDragOver={(e) => handleDragOver(e, a.id)}
                    onDrop={(e) => handleDrop(e, a.id)}
                    onDragEnd={() => { setDraggedId(null); setDragOverId(null); }}
                    className={`group relative border rounded-xl2 overflow-hidden bg-ink cursor-grab active:cursor-grabbing select-none
                      ${selected.has(a.id) ? 'border-brand ring-1 ring-brand' : dragOverId === a.id ? 'border-brand ring-2 ring-brand' : 'border-line'}
                      ${draggedId === a.id ? 'opacity-40' : ''}`}
                  >
                    <div className="aspect-square pointer-events-none">
                      <img src={img(a.photo_url)} loading="lazy" className="w-full h-full object-cover" alt="" />
                    </div>
                    {/* 选中遮罩 */}
                    {selected.has(a.id) && <div className="absolute inset-0 bg-brand/10 pointer-events-none" />}
                    {/* 操作层 */}
                    <div className="absolute top-2 left-2">
                      <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggleSelect(a.id)} className="w-4 h-4 accent-brand" />
                    </div>
                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {work.cover_url !== a.photo_url && (
                        <button onClick={() => setCover(a.photo_url)} title="设为封面" className="px-2 py-1 rounded bg-black/60 text-white text-[10px]">封面</button>
                      )}
                      <button onClick={() => deletePhoto(a.id)} title="删除" className="px-2 py-1 rounded bg-red-500/80 text-white text-[10px]">删除</button>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-2 py-1 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="text-white text-[10px]">排序</span>
                      <input type="number" defaultValue={a.sort} onBlur={(e) => updateSort(a.id, e.target.value)} className="w-12 px-1 py-0.5 rounded text-[10px] text-fg bg-white text-center" />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {zoneAlbums.length > 1 && (
              <div className="text-xs text-muted mt-3">💡 提示：可用鼠标拖动照片自定义排序，也可在照片底部输入排序号。</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
