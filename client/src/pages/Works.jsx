import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import http, { img, debounce } from '../api.js';
import { useViewState } from '../tabMemory.js';

export default function Works() {
  const navigate = useNavigate();
  const [state, setState] = useViewState('works', { tab: '', q: '', vis: '', page: 1 });
  const [cats, setCats] = useState([]);
  const [data, setData] = useState({ items: [], total: 0, pageSize: 12 });
  const [workShare, setWorkShare] = useState(null); // 作品分享相册 {open, workId, title, result, busy}
  const [sortMode, setSortMode] = useState(false);
  const [allItems, setAllItems] = useState([]); // 排序模式下加载全部作品（忽略分页）
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [savingSort, setSavingSort] = useState(false);

  // 作品分享相册：生成公开分享令牌（type=work）→ 沉浸式相册二维码 + 链接
  function openWorkShare(w) {
    setWorkShare({ open: true, workId: w.id, title: w.title, result: null, busy: false });
  }
  async function submitWorkShare() {
    const ws = workShare;
    if (!ws) return;
    setWorkShare({ ...ws, busy: true });
    try {
      const r = await http.post('/api/shares', { type: 'work', ref_id: ws.workId });
      setWorkShare({ ...ws, result: r.data, busy: false });
    } catch (e) {
      const msg = (e.response && e.response.data && e.response.data.error) || '生成失败';
      setWorkShare({ ...ws, busy: false });
      alert(msg);
    }
  }
  function copyWorkShare() {
    if (!workShare || !workShare.result) return;
    navigator.clipboard?.writeText(workShare.result.share_url);
    alert('相册链接已复制：\n' + workShare.result.share_url);
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

  // 筛选/分页变化时自动退出排序模式，避免 allItems 与当前筛选不一致
  useEffect(() => {
    if (sortMode) setSortMode(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.tab, state.vis, state.q, state.page]);

  // 重新拉取列表（删除 / 切换公开状态后）
  async function reload() {
    const ctrl = new AbortController();
    const p = new URLSearchParams();
    if (state.tab) p.set('category', state.tab);
    if (state.q) p.set('q', state.q);
    if (state.vis === '1') p.set('is_public', '1');
    if (state.vis === '0') p.set('is_public', '0');
    p.set('page', state.page);
    p.set('pageSize', data.pageSize || 12);
    http.get('/api/works?' + p.toString(), { signal: ctrl.signal }).then((r) => setData(r.data)).catch(() => {});
  }

  async function toggleDownload(w, e) {
    e.stopPropagation();
    try {
      await http.put('/api/works/' + w.id, {
        title: w.title, category_id: w.category_id || null, category_ids: w.category_ids || '',
        is_public: !!w.is_public,
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

  // 新流程：点击「+ 新建作品组」不再弹窗，直接进入作品详情编辑页（页面式新建）
  const openNew = () => navigate('/works/new');

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

  // 进入/退出排序模式：排序模式加载全部作品（按当前筛选），方便全局拖拽排序
  async function toggleSortMode() {
    if (sortMode) {
      // 退出排序模式时重新加载分页列表
      setSortMode(false);
      reload();
      return;
    }
    const ctrl = new AbortController();
    const p = new URLSearchParams();
    if (state.tab) p.set('category', state.tab);
    if (state.q) p.set('q', state.q);
    if (state.vis === '1') p.set('is_public', '1');
    if (state.vis === '0') p.set('is_public', '0');
    p.set('page', '1');
    p.set('pageSize', '1000');
    try {
      const r = await http.get('/api/works?' + p.toString(), { signal: ctrl.signal });
      setAllItems((r.data.items || []).filter(Boolean));
      setSortMode(true);
    } catch (e) {
      alert('加载作品失败，无法进入排序模式');
    }
  }

  async function saveSortOrder() {
    setSavingSort(true);
    try {
      await http.post('/api/works/reorder', { orders: allItems.map((w) => w.id) });
      setSortMode(false);
      reload();
    } catch (e) {
      alert((e.response && e.response.data && e.response.data.error) || '排序保存失败');
    } finally {
      setSavingSort(false);
    }
  }

  function handleDragStart(e, id) {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(id));
  }
  function handleDragOver(e, id) {
    e.preventDefault();
    if (id !== draggedId) setDragOverId(id);
  }
  function resetDrag() { setDraggedId(null); setDragOverId(null); }
  function handleDrop(e, dropId) {
    e.preventDefault();
    if (!draggedId || draggedId === dropId) { resetDrag(); return; }
    const list = [...allItems];
    const dragIdx = list.findIndex((w) => w.id === draggedId);
    const dropIdx = list.findIndex((w) => w.id === dropId);
    if (dragIdx < 0 || dropIdx < 0) { resetDrag(); return; }
    const [moved] = list.splice(dragIdx, 1);
    list.splice(dropIdx, 0, moved);
    setAllItems(list);
    resetDrag();
  }

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-fg">作品管理</h1>
        <div className="flex items-center gap-2">
          {sortMode ? (
            <>
              <button onClick={() => setSortMode(false)} disabled={savingSort} className="px-4 py-2 rounded border border-line text-sm text-muted hover:text-fg disabled:opacity-50">取消</button>
              <button onClick={saveSortOrder} disabled={savingSort || !allItems.length}
                className="px-4 py-2 rounded bg-brand text-white text-sm hover:opacity-90 disabled:opacity-50">{savingSort ? '保存中…' : '保存排序'}</button>
            </>
          ) : (
            <>
              <button onClick={toggleSortMode} className="px-4 py-2 rounded border border-line text-sm text-muted hover:text-brand hover:border-brand">自定义排序</button>
              <button onClick={openNew} className="px-4 py-2 rounded bg-brand text-white text-sm hover:opacity-90">+ 新建作品组</button>
            </>
          )}
        </div>
      </div>

      {/* 分类 Tab + 管理入口 */}
      <div className="flex items-center gap-2 mb-3 overflow-x-auto">
        <button onClick={() => setTab('')}
          className={'px-4 py-2 rounded-full text-sm border ' + (state.tab === '' ? 'bg-brand text-white border-brand' : 'bg-panel border-line text-muted')}>全部</button>
        {cats.filter(Boolean).map((c) => (
          <button key={c.id} onClick={() => setTab(String(c.id))}
            className={'px-4 py-2 rounded-full text-sm border ' + (state.tab === String(c.id) ? 'bg-brand text-white border-brand' : 'bg-panel border-line text-muted')}>{c.name || '未命名'}</button>
        ))}
        <button onClick={() => navigate('/categories')}
          className="ml-1 flex items-center gap-1 px-3 py-2 rounded-full text-sm border border-dashed border-line text-muted hover:text-brand hover:border-brand bg-panel shrink-0"
          title="管理分类">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
            <circle cx="7" cy="7" r="1.5" fill="currentColor" stroke="none" />
          </svg>
          管理
        </button>
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
      {sortMode && (
        <div className="mb-3 text-xs text-muted bg-panel border border-line rounded-lg p-3">
          💡 排序模式：拖拽作品卡片可调整顺序，保存后会同步到公开列表（小程序/H5 首页）。未保存前可点击「取消」退出。
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {(sortMode ? allItems : data.items).filter(Boolean).map((w) => {
          if (!w.id) return null;
          const isDragOver = sortMode && dragOverId === w.id;
          const isDragged = sortMode && draggedId === w.id;
          return (
          <div key={w.id}
            draggable={sortMode}
            onDragStart={(e) => sortMode && handleDragStart(e, w.id)}
            onDragOver={(e) => sortMode && handleDragOver(e, w.id)}
            onDrop={(e) => sortMode && handleDrop(e, w.id)}
            onDragEnd={resetDrag}
            onClick={() => !sortMode && navigate('/works/' + w.id)}
            className={`bg-panel border rounded-xl2 overflow-hidden transition select-none
              ${sortMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer hover:shadow-md hover:-translate-y-0.5'}
              ${isDragOver ? 'border-brand ring-2 ring-brand' : 'border-line'}
              ${isDragged ? 'opacity-40' : ''}`}>
            <div className="h-40 bg-ink flex items-center justify-center text-muted text-3xl relative">
              {w.cover_url ? <img src={img(w.cover_url)} className="w-full h-full object-cover" alt="" /> : '▣'}
              {sortMode && (
                <div className="absolute top-2 left-2 bg-black/60 text-white text-[10px] px-2 py-1 rounded flex items-center gap-1">
                  <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg>
                  拖拽排序
                </div>
              )}
            </div>
            <div className="p-3">
              <div className="text-sm text-fg truncate">{w.title}</div>
              <div className="text-xs text-muted mt-1 flex justify-between">
                <span>{w.is_public ? '公开' : '私密'}</span>
                <span>{(w.tags || []).join(' · ')}</span>
              </div>
              {!sortMode && (
                <>
                  <button onClick={(e) => toggleDownload(w, e)}
                    className={'mt-2 w-full text-xs py-1.5 rounded border ' + (w.allow_download ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-panel2 text-muted border-line')}>
                    {w.allow_download ? '✓ 允许下载' : '禁止下载'}
                  </button>
                  <div className="flex gap-2 mt-2">
                    <button onClick={(e) => { e.stopPropagation(); navigate('/works/' + w.id); }} className="flex-1 text-xs py-1.5 rounded border border-line text-brand hover:bg-brand/5">管理相册</button>
                    <button onClick={(e) => { e.stopPropagation(); openWorkShare(w); }} className="flex-1 text-xs py-1.5 rounded border border-line text-emerald-500 hover:bg-emerald-50">分享相册</button>
                    <button onClick={(e) => remove(w, e)} className="flex-1 text-xs py-1.5 rounded border border-line text-red-500 hover:bg-red-50">删除</button>
                  </div>
                </>
              )}
            </div>
          </div>
        );})}
        {(sortMode ? allItems : data.items).length === 0 && <div className="col-span-full text-center text-muted py-10">暂无作品</div>}
      </div>

      {/* 分页：排序模式下隐藏（已加载全部作品） */}
      {!sortMode && pages > 1 && (
        <div className="flex gap-2 mt-5 justify-center">
          {Array.from({ length: pages }).map((_, i) => (
            <button key={i} onClick={() => goPage(i + 1)}
              className={'w-8 h-8 rounded text-sm border ' + (data.page === i + 1 ? 'bg-brand text-white border-brand' : 'bg-panel border-line text-muted')}>{i + 1}</button>
          ))}
        </div>
      )}

      {/* 作品分享相册弹窗 */}
      {workShare && workShare.open && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[80] p-4" onClick={() => setWorkShare(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-panel border border-line rounded-xl2 p-6">
            {!workShare.result && (
              <>
                <div className="text-white font-medium mb-1">分享作品相册</div>
                <div className="text-xs text-muted mb-4">将生成该作品的公开沉浸式相册（全屏轮播 / 播放 / 投屏 / 分享），客户扫码或点链接即可在手机浏览并转发。</div>
                <div className="space-y-3">
                  <label className="block text-xs text-muted">{workShare.title || '未命名作品'}</label>
                  <div className="text-xs text-muted">相册照片自动取该作品「样片」分区（对外展示）；公开链接不含原片。</div>
                </div>
                <div className="flex gap-2 justify-end mt-5">
                  <button type="button" onClick={() => setWorkShare(null)} className="px-4 py-2 rounded text-sm text-muted">取消</button>
                  <button type="button" onClick={submitWorkShare} disabled={workShare.busy}
                    className="px-4 py-2 rounded bg-brand text-white text-sm disabled:opacity-40">{workShare.busy ? '生成中…' : '生成相册链接'}</button>
                </div>
              </>
            )}
            {workShare.result && (
              <>
                <div className="text-white font-medium mb-1">作品相册已生成</div>
                <div className="text-xs text-muted mb-4">客户扫码或点链接即可在手机浏览作品（沉浸轮播 / 播放 / 投屏 / 分享）</div>
                {workShare.result.qr_url && (
                  <img src={workShare.result.qr_url} alt="相册二维码" className="w-56 h-56 mx-auto rounded-lg bg-white p-2" />
                )}
                <div className="text-xs text-muted mt-3 break-all">{workShare.result.share_url}</div>
                <div className="flex gap-2 justify-center mt-4">
                  <button onClick={copyWorkShare} className="px-3 py-1.5 rounded bg-brand text-white text-xs">复制链接</button>
                  <button onClick={() => window.open(workShare.result.share_url, '_blank')} className="px-3 py-1.5 rounded bg-panel2 border border-line text-white text-xs">预览</button>
                  <button onClick={() => setWorkShare(null)} className="px-3 py-1.5 rounded bg-panel2 border border-line text-muted text-xs">完成</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
