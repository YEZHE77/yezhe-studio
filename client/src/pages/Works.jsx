import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import http, { img, debounce, compressImage, uploadBatch } from '../api.js';
import { useViewState } from '../tabMemory.js';

export default function Works() {
  const navigate = useNavigate();
  const [state, setState] = useViewState('works', { tab: '', q: '', vis: '', page: 1 });
  const [cats, setCats] = useState([]);
  const [data, setData] = useState({ items: [], total: 0, pageSize: 12 });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [pendingFiles, setPendingFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadZone, setUploadZone] = useState('sample');
  const abortRef = useRef(null);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  function emptyForm() {
    return { title: '', category_id: '', is_public: true, allow_download: false, cover: null, cover_url: '', description: '', tags: '' };
  }

  // 搜索防抖 300ms
  const setQ = useMemo(() => debounce((v) => setState((s) => ({ ...s, q: v, page: 1 }))), [setState]);

  useEffect(() => {
    const ctrl = new AbortController();
    http.get('/api/categories', { signal: ctrl.signal }).then((r) => setCats(r.data)).catch(() => {});
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    const p = new URLSearchParams();
    if (state.tab) p.set('category', state.tab);
    if (state.q) p.set('q', state.q);
    if (state.vis === '1') p.set('is_public', '1');
    if (state.vis === '0') p.set('is_public', '0');
    p.set('page', state.page);
    p.set('pageSize', data.pageSize || 12);
    http.get('/api/works?' + p.toString(), { signal: ctrl.signal }).then((r) => setData(r.data)).catch(() => {});
    return () => ctrl.abort();
  }, [state]);

  async function toggleDownload(w, e) {
    e.stopPropagation();
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

  const openNew = () => {
    setForm(emptyForm());
    setPendingFiles([]);
    setUploading(false);
    setUploadProgress(0);
    setUploadZone('sample');
    setShowForm(true);
  };

  function handleFiles(e) {
    const files = Array.from(e.target.files || []).filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    setPendingFiles(files);
    e.target.value = '';
  }

  function cancelUpload() {
    if (abortRef.current) abortRef.current.abort();
  }

  async function submit(e) {
    e.preventDefault();
    let cover_url = '';
    let uploadedUrls = [];

    // 1) 批量上传照片（若有）
    if (pendingFiles.length > 0) {
      setUploading(true);
      setUploadProgress(0);
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const compressed = [];
        const list = Array.from(pendingFiles);
        for (let i = 0; i < list.length; i += 3) {
          const chunk = list.slice(i, i + 3);
          const out = await Promise.all(chunk.map((f) => compressImage(f, { maxWidth: 1920, maxHeight: 1920, quality: 0.82 })));
          compressed.push(...out);
        }
        const ZONE_CAT = { sample: 'client', local: 'negative', final: 'retouched' };
        const ZONE_PUB = { sample: true, local: false, final: false };
        const { urls, failed, aborted } = await uploadBatch(compressed, {
          category: ZONE_CAT[uploadZone] || 'customer',
          isPublic: ZONE_PUB[uploadZone] || false,
          signal: ac.signal,
          onProgress: (d, t) => setUploadProgress(Math.round((d / t) * 100))
        });
        if (aborted) { setUploading(false); return; }
        uploadedUrls = urls;
        if (uploadedUrls.length) cover_url = uploadedUrls[0];
        if (failed.length) alert(`成功 ${uploadedUrls.length} 张，失败 ${failed.length} 张（创建后可进入作品详情重试）`);
        if (!uploadedUrls.length) {
          alert('照片全部上传失败，作品未创建');
          setUploading(false);
          return;
        }
      } catch (err) {
        alert((err.response && err.response.data && err.response.data.error) || '上传失败，作品未创建');
        setUploading(false);
        return;
      } finally {
        setUploading(false);
        setUploadProgress(0);
      }
    }

    // 2) 创建作品（第一张上传照片自动作为封面）
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
      const r = await http.post('/api/works', payload);
      const workId = r.data.id;
      // 3) 其余照片写入相册
      if (uploadedUrls.length > 1) {
        await http.post('/api/works/' + workId + '/albums', { urls: uploadedUrls.slice(1), zone: uploadZone });
      }
      setShowForm(false);
      setPendingFiles([]);
      navigate('/works/' + workId);
    } catch (e) {
      alert((e.response && e.response.data && e.response.data.error) || '保存失败');
    }
  }

  async function remove(w, e) {
    e.stopPropagation();
    if (!confirm(`确认删除作品「${w.title}」？\n该作品下的相册与选片记录也会一并删除，不可恢复。`)) return;
    try {
      await http.delete('/api/works/' + w.id);
      // 删除后若当前页可能变空，回到第一页重新加载，避免空白
      if (data.items.length <= 1 && state.page > 1) {
        setState((s) => ({ ...s, page: 1 }));
      } else {
        reload();
      }
    } catch (e) {
      alert((e.response && e.response.data && e.response.data.error) || '删除失败');
    }
  }

  const setTab = (t) => setState((s) => ({ ...s, tab: t, page: 1 }));
  const setVis = (v) => setState((s) => ({ ...s, vis: v, page: 1 }));
  const goPage = (p) => setState((s) => ({ ...s, page: p }));

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-fg">作品管理</h1>
        <button onClick={openNew} className="px-4 py-2 rounded bg-brand text-white text-sm hover:opacity-90">+ 新建作品组</button>
      </div>

      {/* 分类 Tab */}
      <div className="flex gap-2 mb-3 overflow-x-auto">
        <button onClick={() => setTab('')}
          className={'px-4 py-2 rounded-full text-sm border ' + (state.tab === '' ? 'bg-brand text-white border-brand' : 'bg-panel border-line text-muted')}>全部</button>
        {cats.map((c) => (
          <button key={c.id} onClick={() => setTab(String(c.id))}
            className={'px-4 py-2 rounded-full text-sm border ' + (state.tab === String(c.id) ? 'bg-brand text-white border-brand' : 'bg-panel border-line text-muted')}>{c.name}</button>
        ))}
      </div>

      {/* 搜索 + 公开筛选 */}
      <div className="flex gap-3 mb-4">
        <input value={state.q} onChange={(e) => setQ(e.target.value)} placeholder="搜索作品 / 客户"
          className="flex-1 px-3 py-2 rounded bg-panel border border-line text-fg text-sm outline-none" />
        <select value={state.vis} onChange={(e) => setVis(e.target.value)}
          className="px-3 py-2 rounded bg-panel border border-line text-fg text-sm outline-none">
          <option value="">全部</option>
          <option value="1">公开</option>
          <option value="0">私密</option>
        </select>
      </div>

      {/* 作品网格 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {data.items.map((w) => (
          <div key={w.id} onClick={() => navigate('/works/' + w.id)}
            className="bg-panel border border-line rounded-xl2 overflow-hidden cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition">
            <div className="h-40 bg-ink flex items-center justify-center text-muted text-3xl">
              {w.cover_url ? <img src={img(w.cover_url)} className="w-full h-full object-cover" alt="" /> : '▣'}
            </div>
            <div className="p-3">
              <div className="text-sm text-fg truncate">{w.title}</div>
              <div className="text-xs text-muted mt-1 flex justify-between">
                <span>{w.is_public ? '公开' : '私密'}</span>
                <span>{(w.tags || []).join(' · ')}</span>
              </div>
              <button onClick={(e) => toggleDownload(w, e)}
                className={'mt-2 w-full text-xs py-1.5 rounded border ' + (w.allow_download ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-panel2 text-muted border-line')}>
                {w.allow_download ? '✓ 允许下载' : '禁止下载'}
              </button>
              <div className="flex gap-2 mt-2">
                <button onClick={(e) => { e.stopPropagation(); navigate('/works/' + w.id); }} className="flex-1 text-xs py-1.5 rounded border border-line text-brand hover:bg-brand/5">管理相册</button>
                <button onClick={(e) => remove(w, e)} className="flex-1 text-xs py-1.5 rounded border border-line text-red-500 hover:bg-red-50">删除</button>
              </div>
            </div>
          </div>
        ))}
        {data.items.length === 0 && <div className="col-span-full text-center text-muted py-10">暂无作品</div>}
      </div>

      {/* 分页 */}
      {pages > 1 && (
        <div className="flex gap-2 mt-5 justify-center">
          {Array.from({ length: pages }).map((_, i) => (
            <button key={i} onClick={() => goPage(i + 1)}
              className={'w-8 h-8 rounded text-sm border ' + (data.page === i + 1 ? 'bg-brand text-white border-brand' : 'bg-panel border-line text-muted')}>{i + 1}</button>
          ))}
        </div>
      )}

      {/* 新建作品弹窗 */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => { if (!uploading) setShowForm(false); }}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={submit}
            className="w-96 bg-panel border border-line rounded-xl2 p-6">
            <div className="text-fg font-medium mb-4">新建作品组</div>
            <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="作品标题" className="w-full mb-3 px-3 py-2 rounded bg-ink border border-line text-fg text-sm outline-none" />
            <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}
              className="w-full mb-3 px-3 py-2 rounded bg-ink border border-line text-fg text-sm outline-none">
              <option value="">选择分类</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="作品描述（选填）"
              className="w-full mb-3 px-3 py-2 rounded bg-ink border border-line text-fg text-sm outline-none h-16" />
            <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="标签，用顿号分隔（选填）"
              className="w-full mb-3 px-3 py-2 rounded bg-ink border border-line text-fg text-sm outline-none" />
            <label className="flex items-center gap-2 text-sm text-fg mb-4">
              <input type="checkbox" checked={form.is_public} onChange={(e) => setForm({ ...form, is_public: e.target.checked })} /> 对外公开展示
            </label>
            <label className="flex items-center gap-2 text-sm text-fg mb-4">
              <input type="checkbox" checked={form.allow_download} onChange={(e) => setForm({ ...form, allow_download: e.target.checked })} /> 允许客户下载成片（小程序相册）
            </label>

            {/* 批量/文件夹上传 */}
            <div className="mb-3">
              <label className="block text-sm text-fg mb-1.5">上传照片</label>
              <select value={uploadZone} onChange={(e) => setUploadZone(e.target.value)}
                disabled={uploading}
                className="w-full mb-2 px-3 py-2 rounded bg-ink border border-line text-fg text-sm outline-none disabled:opacity-60">
                <option value="sample">样片（对外展示）</option>
                <option value="local">原片（仅后台可见）</option>
                <option value="final">成片（交付客户）</option>
              </select>
              <div className="flex gap-2 mb-2">
                <label className="flex-1 text-center px-3 py-2 rounded bg-panel border border-line text-sm text-fg cursor-pointer hover:bg-brand/5 disabled:opacity-60">
                  选择多张照片
                  <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} disabled={uploading} />
                </label>
                <label className="flex-1 text-center px-3 py-2 rounded bg-panel border border-line text-sm text-fg cursor-pointer hover:bg-brand/5 disabled:opacity-60">
                  选择文件夹
                  <input ref={folderInputRef} type="file" accept="image/*" webkitdirectory="" className="hidden" onChange={handleFiles} disabled={uploading} />
                </label>
              </div>
              {pendingFiles.length > 0 && (
                <div className="text-xs text-muted mb-2">
                  已选 <span className="text-fg font-medium">{pendingFiles.length}</span> 张照片，第一张自动作为作品封面
                </div>
              )}
              {uploading && (
                <div className="mt-2">
                  <div className="flex items-center justify-between text-xs text-muted mb-1">
                    <span>上传中 {uploadProgress}%</span>
                    <button type="button" onClick={cancelUpload} className="text-red-500 hover:underline">取消</button>
                  </div>
                  <div className="w-full h-1.5 bg-ink rounded overflow-hidden">
                    <div className="h-full bg-brand transition-all" style={{ width: uploadProgress + '%' }} />
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowForm(false)} disabled={uploading} className="px-4 py-2 rounded text-sm text-muted disabled:opacity-60">取消</button>
              <button type="submit" disabled={uploading} className="px-4 py-2 rounded bg-brand text-white text-sm disabled:opacity-60">
                {uploading ? '上传中…' : '保存并上传照片'}
              </button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
}
