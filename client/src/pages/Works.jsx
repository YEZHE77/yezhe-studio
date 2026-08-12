import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import http, { img, debounce } from '../api.js';
import { useViewState } from '../tabMemory.js';
import {
  ChevronLeft,
  Search,
  MoreHorizontal,
  ChevronDown,
  Eye,
  MoreVertical,
  Plus,
  Image as ImageIcon
} from 'lucide-react';

const CORAL = '#FF7A8A';

function formatDate(d) {
  if (!d) return '';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

export default function Works() {
  const navigate = useNavigate();
  const [state, setState] = useViewState('works', { tab: '', q: '', vis: '', page: 1 });
  const [cats, setCats] = useState([]);
  const [data, setData] = useState({ items: [], total: 0, pageSize: 12 });
  const [loading, setLoading] = useState(true);
  const [workShare, setWorkShare] = useState(null); // 作品分享相册 {open, workId, title, result, busy}
  const [sortMode, setSortMode] = useState(false);
  const [allItems, setAllItems] = useState([]); // 排序模式下加载全部作品（忽略分页）
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [savingSort, setSavingSort] = useState(false);

  // 移动端筛选/排序/菜单状态
  const [openFilter, setOpenFilter] = useState(null); // 'vis' | 'cat' | 'sort'
  const [sortBy, setSortBy] = useState('newest'); // 'newest' | 'views'
  const [activeMenuWork, setActiveMenuWork] = useState(null);
  const [showTopMenu, setShowTopMenu] = useState(false);

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
    setLoading(true);
    http.get('/api/works?' + p.toString(), { signal: ctrl.signal })
      .then((r) => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
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

  // 眼睛图标：点击直接切换公开 / 隐藏，无需弹窗；乐观更新卡片图标即时翻转，失败回滚
  async function togglePublic(w, e) {
    e.stopPropagation();
    const next = w.is_public ? 0 : 1;
    setData((d) => ({ ...d, items: (d.items || []).map((it) => it.id === w.id ? { ...it, is_public: next } : it) }));
    try {
      await http.patch('/api/works/' + w.id + '/public', { is_public: next });
    } catch (err) {
      setData((d) => ({ ...d, items: (d.items || []).map((it) => it.id === w.id ? { ...it, is_public: w.is_public } : it) }));
      alert((err.response && err.response.data && err.response.data.error) || '切换失败');
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

  // 排序下拉仅做前端排序（当前页）
  const displayItems = useMemo(() => {
    const list = sortMode ? allItems : data.items;
    if (sortBy === 'views') {
      return [...list].sort((a, b) => (b.views || 0) - (a.views || 0));
    }
    return list;
  }, [sortMode, allItems, data.items, sortBy]);

  // 关闭下拉/菜单的透明遮罩
  const closeOverlays = () => { setOpenFilter(null); setShowTopMenu(false); };

  return (
    <div className="min-h-screen bg-[#f7f7f7] pb-24">
      {/* 顶部栏：返回 + 搜索 + 更多 */}
      <div className="flex items-center gap-2 px-3 py-3 bg-white border-b border-gray-100">
        <button onClick={() => navigate('/')} className="p-1.5 text-gray-700" style={{ background: 'none', border: 'none' }}>
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex-1 relative">
          <input
            value={state.q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="输入您所需要查找的客片名称"
            className="w-full pl-9 pr-3 py-2 rounded-full bg-[#f2f2f2] text-sm text-gray-800 outline-none"
          />
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        </div>
        <div className="relative">
          <button onClick={(e) => { e.stopPropagation(); setShowTopMenu((v) => !v); }} className="p-1.5 text-gray-500">
            <MoreHorizontal className="w-6 h-6" />
          </button>
          {showTopMenu && (
            <div className="absolute right-0 top-full mt-1 w-32 rounded-lg bg-white shadow-lg border border-gray-100 py-1 z-50">
              {!sortMode ? (
                <button onClick={() => { setShowTopMenu(false); toggleSortMode(); }} className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">自定义排序</button>
              ) : (
                <>
                  <button onClick={() => { setShowTopMenu(false); saveSortOrder(); }} disabled={savingSort || !allItems.length} className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">{savingSort ? '保存中…' : '保存排序'}</button>
                  <button onClick={() => { setShowTopMenu(false); setSortMode(false); reload(); }} disabled={savingSort} className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">取消排序</button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 筛选下拉：全部 / 分类 / 排序 */}
      <div className="flex items-center justify-around px-2 py-3 bg-white border-b border-gray-100">
        {/* 全部：可见性 */}
        <div className="relative flex-1 text-center">
          <button onClick={(e) => { e.stopPropagation(); setOpenFilter(openFilter === 'vis' ? null : 'vis'); }} className="flex items-center justify-center gap-1 w-full text-sm text-gray-700">
            {state.vis === '1' ? '公开' : state.vis === '0' ? '私密' : '全部'} <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
          </button>
          {openFilter === 'vis' && (
            <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-24 rounded-lg bg-white shadow-lg border border-gray-100 py-1 z-40">
              {['', '1', '0'].map((v) => (
                <button key={v || 'all'} onClick={() => { setVis(v); setOpenFilter(null); }} className={'w-full text-left px-4 py-2 text-sm ' + (state.vis === v ? 'text-[#FF7A8A]' : 'text-gray-700')}>
                  {v === '1' ? '公开' : v === '0' ? '私密' : '全部'}
                </button>
              ))}
            </div>
          )}
        </div>
        {/* 分类 */}
        <div className="relative flex-1 text-center">
          <button onClick={(e) => { e.stopPropagation(); setOpenFilter(openFilter === 'cat' ? null : 'cat'); }} className="flex items-center justify-center gap-1 w-full text-sm text-gray-700">
            {state.tab ? (cats.find((c) => String(c.id) === state.tab)?.name || '分类') : '分类'} <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
          </button>
          {openFilter === 'cat' && (
            <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-32 max-h-60 overflow-y-auto rounded-lg bg-white shadow-lg border border-gray-100 py-1 z-40">
              <button onClick={() => { setTab(''); setOpenFilter(null); }} className={'w-full text-left px-4 py-2 text-sm ' + (state.tab === '' ? 'text-[#FF7A8A]' : 'text-gray-700')}>全部分类</button>
              {cats.filter(Boolean).map((c) => (
                <button key={c.id} onClick={() => { setTab(String(c.id)); setOpenFilter(null); }} className={'w-full text-left px-4 py-2 text-sm truncate ' + (state.tab === String(c.id) ? 'text-[#FF7A8A]' : 'text-gray-700')}>{c.name || '未命名'}</button>
              ))}
            </div>
          )}
        </div>
        {/* 排序 */}
        <div className="relative flex-1 text-center">
          <button onClick={(e) => { e.stopPropagation(); setOpenFilter(openFilter === 'sort' ? null : 'sort'); }} className="flex items-center justify-center gap-1 w-full text-sm text-gray-700">
            {sortBy === 'views' ? '最多浏览' : '最新发布'} <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
          </button>
          {openFilter === 'sort' && (
            <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-28 rounded-lg bg-white shadow-lg border border-gray-100 py-1 z-40">
              {[
                { key: 'newest', label: '最新发布' },
                { key: 'views', label: '最多浏览' }
              ].map((s) => (
                <button key={s.key} onClick={() => { setSortBy(s.key); setOpenFilter(null); }} className={'w-full text-left px-4 py-2 text-sm ' + (sortBy === s.key ? 'text-[#FF7A8A]' : 'text-gray-700')}>{s.label}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 排序模式提示 */}
      {sortMode && (
        <div className="mx-4 mt-3 text-xs text-gray-500 bg-white border border-gray-100 rounded-lg p-3">
          💡 排序模式：拖拽作品卡片可调整顺序，保存后会同步到公开列表（小程序/H5 首页）。未保存前点击「更多 → 取消排序」退出。
        </div>
      )}

      {/* 作品网格 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 p-4">
        {displayItems.filter(Boolean).map((w) => {
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
              className={`bg-white rounded-2xl overflow-hidden shadow-md transition select-none
                ${sortMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}
                ${isDragOver ? 'ring-2 ring-[#FF7A8A]' : ''}
                ${isDragged ? 'opacity-40' : ''}`}>
              <div className="relative aspect-[4/5] bg-gray-100">
                {w.cover_url ? (
                  <img src={img(w.cover_url)} alt="" loading="lazy" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-300">
                    <ImageIcon className="w-10 h-10 opacity-40" />
                  </div>
                )}
                {/* 置顶标签：后端暂无 pinned 字段，预留条件 */}
                {w.pinned && (
                  <span className="absolute left-2 top-2 rounded px-2 py-0.5 text-[10px] text-white" style={{ background: CORAL }}>置顶</span>
                )}
                {/* 浏览量角标 */}
                <div className="absolute top-2 right-2 flex items-center gap-1 text-white text-[10px] bg-black/30 backdrop-blur-sm rounded-full px-1.5 py-0.5">
                  <Eye className="w-3 h-3" />
                  <span>{w.views ?? 0}</span>
                </div>
                {/* 排序模式拖拽手柄 */}
                {sortMode && (
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/60 text-white text-[10px] px-2 py-1 rounded flex items-center gap-1">
                    <MoreVertical className="w-3 h-3" /> 拖拽排序
                  </div>
                )}
              </div>
              <div className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-900 truncate">{w.title}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{formatDate(w.created_at)}</div>
                  </div>
                  {!sortMode && (
                    <button onClick={(e) => { e.stopPropagation(); setActiveMenuWork(w); }} className="p-1 text-gray-400 -mr-1 -mt-0.5">
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {displayItems.length === 0 && !loading && (
          <div className="col-span-full text-center text-gray-400 py-12">
            <div className="text-sm">暂无作品</div>
            <div className="mt-1 text-xs">点击右下角添加新客片</div>
          </div>
        )}
      </div>

      {/* 分页 */}
      {!sortMode && pages > 1 && (
        <div className="flex gap-2 mt-2 justify-center pb-4">
          {Array.from({ length: pages }).map((_, i) => (
            <button key={i} onClick={() => goPage(i + 1)}
              className={'w-8 h-8 rounded-full text-sm border ' + (data.page === i + 1 ? 'bg-[#FF7A8A] text-white border-[#FF7A8A]' : 'bg-white border-gray-200 text-gray-500')}>{i + 1}</button>
          ))}
        </div>
      )}

      {/* 底部悬浮添加按钮 */}
      {!sortMode && (
        <button onClick={openNew}
          className="fixed right-4 bottom-6 z-50 flex items-center gap-1 px-4 py-2.5 rounded-full text-white text-sm shadow-lg active:scale-95 transition"
          style={{ background: CORAL }}>
          <Plus className="w-4 h-4" /> 添加新客片
        </button>
      )}

      {/* 点击外部关闭下拉/菜单的透明层 */}
      {(openFilter || showTopMenu || activeMenuWork) && (
        <div className="fixed inset-0 z-30" onClick={closeOverlays} />
      )}

      {/* 卡片操作菜单（底部浮层） */}
      {activeMenuWork && (
        <div className="fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-2xl p-4 pb-8 shadow-[0_-4px_20px_rgba(0,0,0,0.1)]" onClick={(e) => e.stopPropagation()}>
          <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4" />
          <div className="text-center text-sm font-medium text-gray-900 mb-1">{activeMenuWork.title}</div>
          <div className="text-center text-xs text-gray-400 mb-4">{activeMenuWork.is_public ? '公开' : '私密'} · {activeMenuWork.image_count ?? 0} 张</div>
          <div className="grid grid-cols-4 gap-3 mb-4">
            <button onClick={() => { togglePublic(activeMenuWork, { stopPropagation: () => {} }); setActiveMenuWork(null); }} className="flex flex-col items-center gap-1 p-2 rounded-lg hover:bg-gray-50">
              <Eye className="w-5 h-5 text-gray-600" />
              <span className="text-xs text-gray-600">{activeMenuWork.is_public ? '隐藏' : '公开'}</span>
            </button>
            <button onClick={() => { navigate('/works/' + activeMenuWork.id); setActiveMenuWork(null); }} className="flex flex-col items-center gap-1 p-2 rounded-lg hover:bg-gray-50">
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>
              <span className="text-xs text-gray-600">管理相册</span>
            </button>
            <button onClick={() => { openWorkShare(activeMenuWork); setActiveMenuWork(null); }} className="flex flex-col items-center gap-1 p-2 rounded-lg hover:bg-gray-50">
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
              <span className="text-xs text-gray-600">分享相册</span>
            </button>
            <button onClick={() => { remove(activeMenuWork, { stopPropagation: () => {} }); setActiveMenuWork(null); }} className="flex flex-col items-center gap-1 p-2 rounded-lg hover:bg-gray-50">
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              <span className="text-xs text-red-500">删除</span>
            </button>
          </div>
          <button onClick={() => toggleDownload(activeMenuWork, { stopPropagation: () => {} })}
            className={'w-full py-2.5 rounded-lg text-sm border ' + (activeMenuWork.allow_download ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-gray-50 text-gray-600 border-gray-200')}>
            {activeMenuWork.allow_download ? '✓ 允许下载' : '禁止下载'}
          </button>
          <button onClick={() => setActiveMenuWork(null)} className="w-full mt-3 py-2.5 rounded-lg text-sm text-gray-500 bg-gray-100">取消</button>
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
