// pages/media/MediaBoard.jsx —— 选题看板
// 双视图：Trello 泳道看板 ↔ 表格列表
// 看板：卡片拖拽换列（松手更新 status_id）+ 同列上下排序；失败回弹+弹窗报错；成功 toast
// 状态列：默认 5 列 + 自定义新增/重命名/删除 + 拖拽调整列顺序（media_status_column）
// 卡片字段：标题/核心痛点/目标平台/图文短视频/优先级/预计发布时间/参考链接/颜色/标签/素材绑定（相册图片ID 或 上传素材）
import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import http, { img } from '../../api.js';
import { toast, fmtDate, PRIORITY_OPTS, COLOR_PRESETS } from './common.js';

const EMPTY_TOPIC = {
  title: '', core_pain: '', target_platform: '', content_form: '', priority: 'medium',
  expect_publish_time: '', reference_url: '', card_color: '#2DB7F5', tags: [], material_ref: null
};

export default function MediaBoard() {
  const [params, setParams] = useSearchParams();
  // 窄屏（< 768）自动切到表格视图：手机端看板 3 列在窄屏会挤成竖排，拖拽体验也差
  const [view, setView] = useState(() => {
    if (typeof window === 'undefined') return 'board';
    return window.innerWidth < 768 ? 'table' : 'board';
  });
  const [columns, setColumns] = useState([]);
  const [topics, setTopics] = useState([]);
  const [tags, setTags] = useState([]);
  const [form, setForm] = useState(null); // 新建/编辑弹窗
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState(null); // 被拖拽卡片 id
  const [overCol, setOverCol] = useState(null); // 悬停列
  const [dragColId, setDragColId] = useState(null); // 被拖拽列 id

  const loadAll = useCallback(() => {
    http.get('/api/media/status-columns').then((r) => setColumns(r.data || [])).catch(() => toast('状态列加载失败', 'err'));
    http.get('/api/media/topics', { params: { includeArchived: 1 } }).then((r) => setTopics(r.data || [])).catch(() => toast('选题加载失败', 'err'));
    http.get('/api/media/tags').then((r) => setTags(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ?new=1 自动打开新建弹窗
  useEffect(() => {
    if (params.get('new') === '1') {
      const first = columns[0];
      setForm({ ...EMPTY_TOPIC, status_id: first ? first.id : null });
      setParams({}, { replace: true });
    }
  }, [params, setParams, columns]);

  const topicsOf = (colId) => (topics || [])
    .filter((t) => String(t.status_id) === String(colId))
    .sort((a, b) => (a.sort || 0) - (b.sort || 0) || (a.id || 0) - (b.id || 0));

  const statusName = (id) => {
    const c = columns.find((x) => String(x.id) === String(id));
    return c ? c.name : '未设置';
  };
  const tagById = (id) => tags.find((t) => String(t.id) === String(id));

  // ---------- 拖拽：卡片换列 / 同列排序 ----------
  const onCardDrop = async (e, col) => {
    e.preventDefault();
    const id = Number(dragId);
    setOverCol(null);
    setDragId(null);
    if (!id || !col) return;
    const topic = topics.find((t) => t.id === id);
    const same = topic && String(topic.status_id) === String(col.id);
    // 同列：仅做排序（sort = 该列当前最大 + 1，由后端兜底）；跨列：更新 status_id
    try {
      if (same) {
        const list = topicsOf(col.id).filter((t) => t.id !== id);
        await http.put('/api/media/topics/' + id + '/sort', { sort: list.length });
        toast('排序已更新');
      } else {
        await http.put('/api/media/topics/' + id + '/status', { status_id: col.id });
        toast('已移动到「' + col.name + '」');
      }
      loadAll();
    } catch (err) {
      toast('操作失败，卡片已回弹', 'err');
      window.alert('拖拽失败：' + ((err.data && err.data.error) || err.message));
      loadAll(); // 回弹
    }
  };

  // ---------- 拖拽：列顺序 ----------
  const onColDrop = async (e) => {
    e.preventDefault();
    const fromId = Number(dragColId);
    const toId = Number(e.currentTarget.dataset.colId);
    setDragColId(null);
    if (!fromId || !toId || fromId === toId) return;
    const ids = columns.map((c) => c.id);
    const fi = ids.indexOf(fromId);
    const ti = ids.indexOf(toId);
    if (fi < 0 || ti < 0) return;
    ids.splice(fi, 1);
    ids.splice(ti, 0, fromId);
    try {
      await http.put('/api/media/status-columns/order', { ids });
      toast('列顺序已更新');
      loadAll();
    } catch (err) { toast('列排序失败', 'err'); loadAll(); }
  };

  // ---------- 新建/编辑 ----------
  const openNew = () => {
    const first = columns[0];
    setForm({ ...EMPTY_TOPIC, status_id: first ? first.id : null });
  };
  const openEdit = (t) => setForm({
    id: t.id, title: t.title || '', core_pain: t.core_pain || '', target_platform: t.target_platform || '',
    content_form: t.content_form || '', priority: t.priority || 'medium', expect_publish_time: t.expect_publish_time || '',
    reference_url: t.reference_url || '', card_color: t.card_color || '#2DB7F5', tags: (t.tags || []).map(String),
    status_id: t.status_id, material_ref: t.materialRef || null
  });

  const save = async () => {
    if (!String(form.title || '').trim()) { toast('选题标题不能为空', 'warn'); return; }
    setBusy(true);
    try {
      const payload = { ...form, title: String(form.title || '').trim(), material_ref: form.material_ref || null };
      if (form.id) {
        await http.put('/api/media/topics/' + form.id, payload);
        toast('选题已更新');
      } else {
        await http.post('/api/media/topics', payload);
        toast('选题已创建');
      }
      setForm(null);
      loadAll();
    } catch (e) { toast('保存失败：' + ((e.data && e.data.error) || e.message), 'err'); }
    finally { setBusy(false); }
  };

  const remove = async (t) => {
    if (!window.confirm('确定删除该选题？相关草稿会一并删除。')) return;
    try { await http.delete('/api/media/topics/' + t.id); toast('已删除'); loadAll(); }
    catch (e) { toast('删除失败', 'err'); }
  };

  // ---------- 列管理 ----------
  const addCol = async () => {
    const name = window.prompt('新状态列名称');
    if (!name || !String(name).trim()) return;
    try { await http.post('/api/media/status-columns', { name: String(name).trim() }); toast('状态列已添加'); loadAll(); }
    catch (e) { toast('添加失败', 'err'); }
  };
  const renameCol = async (c) => {
    const name = window.prompt('重命名状态列', c.name);
    if (!name || !String(name).trim() || String(name).trim() === c.name) return;
    try { await http.put('/api/media/status-columns/' + c.id, { name: String(name).trim() }); toast('已重命名'); loadAll(); }
    catch (e) { toast('重命名失败', 'err'); }
  };
  const delCol = async (c) => {
    if (!window.confirm('删除状态列「' + c.name + '」？其下选题将移动到第一列。')) return;
    try { await http.delete('/api/media/status-columns/' + c.id); toast('状态列已删除'); loadAll(); }
    catch (e) { toast('删除失败', 'err'); }
  };

  const setFormStatus = (id) => setForm((f) => ({ ...f, status_id: Number(id) }));
  const setFormTag = (id) => setForm((f) => {
    const s = String(id);
    return { ...f, tags: (f.tags || []).includes(s) ? f.tags.filter((x) => x !== s) : [...(f.tags || []), s] };
  });

  const fv = (k) => (form ? form[k] : '');

  // ---------- 素材绑定（二选一：作品相册图片 / 上传素材） ----------
  function MaterialSection({ value, onChange }) {
    const [works, setWorks] = useState([]);
    const [selWork, setSelWork] = useState(null);
    const [albums, setAlbums] = useState([]);
    const [uploading, setUploading] = useState(false);
    const ref = value || { type: 'album', album_ids: [], urls: [] };
    const fileRef = React.useRef(null);
    useEffect(() => { http.get('/api/works').then((r) => setWorks(r.data || [])).catch(() => {}); }, []);
    const loadAlbums = (wid) => {
      setSelWork(wid);
      if (!wid) { setAlbums([]); return; }
      http.get('/api/albums/work/' + wid).then((r) => setAlbums(r.data || [])).catch(() => setAlbums([]));
    };
    const toggleAlbum = (a) => {
      const ids = ref.album_ids || [];
      const urls = ref.urls || [];
      const on = ids.includes(a.id);
      onChange({
        ...ref,
        type: 'album',
        album_ids: on ? ids.filter((x) => x !== a.id) : [...ids, a.id],
        urls: on ? urls.filter((u) => u !== a.photo_url) : [...urls, a.photo_url].filter(Boolean)
      });
    };
    const doUpload = async (f) => {
      if (!f) return;
      setUploading(true);
      try {
        const fd = new FormData();
        fd.append('file', f);
        fd.append('category', 'client');
        fd.append('isPublic', '0');
        const r = await http.post('/api/upload', fd, { timeout: 120000 });
        const url = r.data && r.data.url;
        if (!url) throw new Error('上传返回为空');
        onChange({ ...ref, type: 'upload', urls: [...(ref.urls || []), url] });
        toast('素材已上传');
      } catch (e) { toast('上传失败：' + ((e.data && e.data.error) || e.message), 'err'); }
      finally { setUploading(false); }
    };
    const removeUrl = (u) => onChange({ ...ref, urls: (ref.urls || []).filter((x) => x !== u) });
    return (
      <div>
        <div className="text-xs mb-1" style={{ color: '#666666' }}>素材绑定（① 关联项目相册图片 ② 单独上传自媒体素材，可并存）</div>
        <div className="grid grid-cols-2 gap-3">
          <div className="border rounded p-2" style={{ borderColor: '#E0E0E0' }}>
            <div className="text-[11px] mb-1" style={{ color: '#999999' }}>① 从作品相册选择</div>
            <select
              value={selWork || ''}
              onChange={(e) => loadAlbums(e.target.value ? Number(e.target.value) : null)}
              style={{ width: '100%', height: 30, border: '1px solid #E0E0E0', borderRadius: 4, fontSize: 12, background: '#fff' }}
            >
              <option value="">选择作品</option>
              {(works || []).map((w) => <option key={w.id} value={w.id}>{w.title || ('作品#' + w.id)}</option>)}
            </select>
            <div className="mt-1 flex flex-wrap gap-1" style={{ maxHeight: 120, overflowY: 'auto' }}>
              {(albums || []).slice(0, 60).map((a) => {
                const on = (ref.album_ids || []).includes(a.id);
                return (
                  <div key={a.id} onClick={() => toggleAlbum(a)} style={{ width: 44, height: 44, borderRadius: 4, overflow: 'hidden', border: on ? '2px solid #2DB7F5' : '2px solid transparent', cursor: 'pointer', opacity: a.photo_url ? 1 : 0.3, position: 'relative' }}>
                    {a.photo_url ? <img src={img(a.photo_url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ width: '100%', height: '100%', background: '#F0F0F0' }} />}
                    {on && <div style={{ position: 'absolute', right: 1, top: 1, width: 14, height: 14, borderRadius: 7, background: '#2DB7F5', color: '#fff', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✓</div>}
                  </div>
                );
              })}
              {!albums.length && <span className="text-[11px]" style={{ color: '#BBBBBB' }}>选择作品后显示相册</span>}
            </div>
          </div>
          <div className="border rounded p-2" style={{ borderColor: '#E0E0E0' }}>
            <div className="text-[11px] mb-1" style={{ color: '#999999' }}>② 上传自媒体素材</div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { doUpload(e.target.files && e.target.files[0]); e.target.value = ''; }} />
            <button type="button" onClick={() => fileRef.current && fileRef.current.click()} disabled={uploading} className="text-[11px] w-full" style={{ padding: '6px 0', borderRadius: 4, border: '1px dashed #ABE2FB', background: '#F0F7FF', color: '#2DB7F6', cursor: uploading ? 'default' : 'pointer' }}>{uploading ? '上传中…' : '+ 上传图片'}</button>
            <div className="mt-1 flex flex-wrap gap-1">
              {(ref.urls || []).map((u, i) => (
                <div key={i} style={{ width: 44, height: 44, borderRadius: 4, overflow: 'hidden', border: '1px solid #EEE', position: 'relative' }}>
                  <img src={img(u)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  <button type="button" onClick={() => removeUrl(u)} style={{ position: 'absolute', right: 0, top: 0, width: 14, height: 14, background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', borderRadius: '0 0 0 4px', fontSize: 10, cursor: 'pointer', lineHeight: '14px' }}>×</button>
                </div>
              ))}
              {!(ref.urls || []).length && <span className="text-[11px]" style={{ color: '#BBBBBB' }}>暂无上传素材</span>}
            </div>
          </div>
        </div>
        {(ref.urls || []).length > 0 && (
          <div className="mt-2 text-[11px]" style={{ color: '#999999' }}>已绑定素材 {ref.urls.length} 张（相册 {ref.album_ids ? ref.album_ids.length : 0} 张 + 上传 {ref.urls.length - (ref.album_ids ? ref.album_ids.length : 0)} 张）</div>
        )}
      </div>
    );
  }

  // ---------- 渲染：卡片 ----------
  const Card = ({ t, index }) => {
    const p = PRIORITY_OPTS.find((x) => x.value === (t.priority || 'medium')) || PRIORITY_OPTS[1];
    return (
      <div
        draggable
        onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.effectAllowed = 'move'; setDragId(t.id); }}
        onDragEnd={(e) => { e.stopPropagation(); setDragId(null); }}
        onClick={() => openEdit(t)}
        className="bg-white border cursor-grab active:cursor-grabbing"
        style={{ borderRadius: 6, borderColor: '#E8E8E8', padding: 10, marginBottom: 8, boxShadow: '0 1px 2px rgba(0,0,0,0.04)', opacity: dragId === t.id ? 0.4 : 1 }}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="text-[13px] font-medium truncate" style={{ color: '#333333' }} title={t.title || '未命名选题'}>{t.title || '未命名选题'}</span>
          <span className="shrink-0 w-1.5 h-1.5 rounded-full" style={{ background: t.card_color || '#2DB7F5' }} />
        </div>
        {t.core_pain ? <div className="text-[11px] leading-[16px] mt-1 line-clamp-2" style={{ color: '#888888' }}>{t.core_pain}</div> : null}
        <div className="flex items-center gap-1 flex-wrap mt-1.5">
          <span className="text-[10px] px-1 py-0.5 rounded" style={{ background: p.bg, color: p.color }}>{p.label}</span>
          {t.target_platform ? <span className="text-[10px] px-1 py-0.5 rounded" style={{ background: '#F0F7FF', color: '#2DB7F6' }}>{t.target_platform}</span> : null}
          {t.content_form ? <span className="text-[10px] px-1 py-0.5 rounded" style={{ background: '#F6F6F6', color: '#666666' }}>{t.content_form}</span> : null}
        </div>
        <div className="flex items-center gap-1 flex-wrap mt-1.5 text-[10px]" style={{ color: '#999999' }}>
          {(t.tags || []).slice(0, 2).map((id) => {
            const tg = tagById(id);
            return tg ? <span key={id} className="px-1 py-0.5 rounded" style={{ background: '#F0F0F0', color: '#666666' }}>{tg.name}</span> : null;
          })}
          {(t.tags || []).length > 2 && <span className="px-1 py-0.5 rounded" style={{ background: '#F0F0F0', color: '#999999' }}>+{(t.tags || []).length - 2}</span>}
          {t.expect_publish_time ? <span className="ml-auto">{fmtDate(t.expect_publish_time)}</span> : null}
        </div>
        <div className="flex items-center justify-end mt-1 text-[10px]" style={{ color: '#BBBBBB' }} onClick={(e) => e.stopPropagation()}>
          <span>#{index + 1}</span>
        </div>
      </div>
    );
  };

  // ---------- 渲染：看板视图 ----------
  const renderBoard = () => (
    <div className="flex gap-3 items-start" style={{ overflowX: 'auto', paddingBottom: 12, minHeight: 300 }}>
      {(columns || []).map((c) => {
        const cards = topicsOf(c.id);
        return (
          <div
            key={c.id}
            data-col-id={c.id}
            draggable
            onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragColId(c.id); }}
            onDragEnd={() => setDragColId(null)}
            onDragOver={(e) => { e.preventDefault(); setOverCol(c.id); }}
            onDragLeave={() => setOverCol((o) => (o === c.id ? null : o))}
            onDrop={(e) => {
              // 列头拖拽（dragColId）→ 调整列顺序；卡片拖拽（dragId）→ 换列/排序
              if (dragColId) onColDrop(e);
              else onCardDrop(e, c);
            }}
            className="shrink-0"
            style={{ width: 252, background: '#F7F7F9', borderRadius: 8, padding: 8, border: overCol === c.id ? '1px solid #2DB7F5' : '1px solid transparent' }}
          >
            <div className="flex items-center justify-between px-1 pb-2" style={{ cursor: dragColId === c.id ? 'grabbing' : 'grab' }} title="拖拽可调整列顺序">
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] font-medium" style={{ color: '#333333' }}>{c.name}</span>
                <span className="text-[11px] px-1.5 rounded-full" style={{ background: '#E8F3FF', color: '#2DB7F6' }}>{cards.length}</span>
              </div>
              <span className="text-[11px]" style={{ color: '#BBBBBB' }}>
                <button type="button" style={{ background: 'none', border: 'none', color: '#AAAAAA', cursor: 'pointer', fontSize: 11, marginRight: 4 }} title="重命名" onClick={(e) => { e.stopPropagation(); renameCol(c); }}>✎</button>
                <button type="button" style={{ background: 'none', border: 'none', color: '#F47175', cursor: 'pointer', fontSize: 11 }} title="删除列" onClick={(e) => { e.stopPropagation(); delCol(c); }}>×</button>
              </span>
            </div>
            <div style={{ minHeight: 60 }}>
              {cards.map((t, i) => <Card key={t.id} t={t} index={i} />)}
              {!cards.length && <div className="text-[11px] text-center py-4" style={{ color: '#C0C0C0' }}>拖拽选题到这里</div>}
            </div>
          </div>
        );
      })}
      <div className="shrink-0" style={{ width: 180 }}>
        <button type="button" onClick={addCol} className="w-full text-[12px]" style={{ padding: '10px 0', borderRadius: 8, border: '1px dashed #D0D0D0', background: '#fff', color: '#888888', cursor: 'pointer' }}>+ 新增状态列</button>
      </div>
    </div>
  );

  // ---------- 渲染：表格视图 ----------
  const renderTable = () => (
    <div className="bg-white border overflow-x-auto" style={{ borderRadius: 6, borderColor: '#EEEEEE' }}>
      <table className="w-full text-[13px]" style={{ borderCollapse: 'collapse', minWidth: 860 }}>
        <thead>
          <tr style={{ background: '#FAFAFA', color: '#666666', textAlign: 'left' }}>
            <th className="px-3 py-2.5 font-normal" style={{ borderBottom: '1px solid #F0F0F0' }}>标题</th>
            <th className="px-3 py-2.5 font-normal" style={{ borderBottom: '1px solid #F0F0F0' }}>状态</th>
            <th className="px-3 py-2.5 font-normal" style={{ borderBottom: '1px solid #F0F0F0' }}>优先级</th>
            <th className="px-3 py-2.5 font-normal" style={{ borderBottom: '1px solid #F0F0F0' }}>平台 / 形式</th>
            <th className="px-3 py-2.5 font-normal" style={{ borderBottom: '1px solid #F0F0F0' }}>预计发布</th>
            <th className="px-3 py-2.5 font-normal" style={{ borderBottom: '1px solid #F0F0F0' }}>标签</th>
            <th className="px-3 py-2.5 font-normal" style={{ borderBottom: '1px solid #F0F0F0' }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {(topics || []).map((t) => {
            const p = PRIORITY_OPTS.find((x) => x.value === (t.priority || 'medium')) || PRIORITY_OPTS[1];
            return (
              <tr key={t.id} style={{ borderBottom: '1px solid #F5F5F5' }}>
                <td className="px-3 py-2.5" style={{ color: '#333333', maxWidth: 240 }}>
                  <div className="flex items-center gap-2">
                    <span className="w-1 h-4 rounded" style={{ background: t.card_color || '#2DB7F5' }} />
                    <span className="truncate">{t.title || '未命名选题'}</span>
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <select value={t.status_id || ''} onChange={async (e) => {
                    const v = Number(e.target.value);
                    try { await http.put('/api/media/topics/' + t.id + '/status', { status_id: v }); toast('状态已更新'); loadAll(); }
                    catch (err) { toast('更新失败', 'err'); loadAll(); }
                  }} style={{ height: 28, border: '1px solid #E0E0E0', borderRadius: 4, fontSize: 12, background: '#fff' }}>
                    {(columns || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2.5"><span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: p.bg, color: p.color }}>{p.label}</span></td>
                <td className="px-3 py-2.5 text-xs" style={{ color: '#666666' }}>{[t.target_platform, t.content_form].filter(Boolean).join(' / ') || '—'}</td>
                <td className="px-3 py-2.5 text-xs" style={{ color: '#999999' }}>{t.expect_publish_time ? fmtDate(t.expect_publish_time) : '—'}</td>
                <td className="px-3 py-2.5 text-xs" style={{ color: '#888888' }}>
                  {(t.tags || []).slice(0, 2).map((id) => { const tg = tagById(id); return tg ? <span key={id} className="mr-1 px-1.5 py-0.5 rounded" style={{ background: '#F0F0F0' }}>{tg.name}</span> : null; })}
                  {(t.tags || []).length > 2 ? <span className="text-[10px]" style={{ color: '#999999' }}>+{(t.tags || []).length - 2}</span> : null}
                </td>
                <td className="px-3 py-2.5">
                  <button type="button" className="text-[11px] mr-2" style={{ color: '#2DB7F6', background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => openEdit(t)}>编辑</button>
                  <button type="button" className="text-[11px]" style={{ color: '#F47175', background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => remove(t)}>删除</button>
                </td>
              </tr>
            );
          })}
          {!topics.length && (
            <tr><td colSpan={7} className="px-3 py-10 text-center text-sm" style={{ color: '#999999' }}>暂无选题，点击右上角「新建选题」</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div style={{ maxWidth: 1200 }}>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <div className="text-[20px]" style={{ color: '#222222' }}>选题看板</div>
          <div className="text-xs mt-1" style={{ color: '#999999' }}>共 {topics.length} 个选题 · 拖拽卡片切换状态 · 拖拽列头调整列顺序</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border rounded-full overflow-hidden" style={{ borderColor: '#E0E0E0' }}>
            <button type="button" onClick={() => setView('board')} className="text-xs" style={{ padding: '6px 16px', background: view === 'board' ? '#2DB7F5' : '#fff', color: view === 'board' ? '#fff' : '#666666', border: 'none', cursor: 'pointer' }}>看板</button>
            <button type="button" onClick={() => setView('table')} className="text-xs" style={{ padding: '6px 16px', background: view === 'table' ? '#2DB7F5' : '#fff', color: view === 'table' ? '#fff' : '#666666', border: 'none', cursor: 'pointer' }}>表格</button>
          </div>
          <button type="button" onClick={openNew} className="text-xs" style={{ color: '#fff', background: '#2DB7F5', border: '1px solid #2DB7F5', padding: '0 16px', height: 32, borderRadius: 100, cursor: 'pointer' }}>+ 新建选题</button>
        </div>
      </div>

      {view === 'board' ? renderBoard() : renderTable()}

      {/* 新建/编辑弹窗 */}
      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => !busy && setForm(null)}>
          <div className="bg-white w-full max-w-[640px] max-h-[92vh] overflow-auto" style={{ borderRadius: 10, padding: 20 }} onClick={(e) => e.stopPropagation()}>
            <div className="text-[16px] mb-4" style={{ color: '#333333' }}>{form.id ? '编辑选题' : '新建选题'}</div>
            <div className="space-y-3">
              <div>
                <div className="text-xs mb-1" style={{ color: '#666666' }}>标题 *</div>
                <input value={String(fv('title') || '')} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="选题标题" style={{ width: '100%', height: 36, border: '1px solid #E0E0E0', borderRadius: 6, padding: '0 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <div className="text-xs mb-1" style={{ color: '#666666' }}>核心痛点</div>
                <textarea value={String(fv('core_pain') || '')} onChange={(e) => setForm((f) => ({ ...f, core_pain: e.target.value }))} rows={2} placeholder="这个选题要解决的用户痛点…" style={{ width: '100%', border: '1px solid #E0E0E0', borderRadius: 6, padding: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box', resize: 'vertical' }} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <div className="text-xs mb-1" style={{ color: '#666666' }}>目标平台</div>
                  <input value={String(fv('target_platform') || '')} onChange={(e) => setForm((f) => ({ ...f, target_platform: e.target.value }))} placeholder="如 小红书 / 抖音" style={{ width: '100%', height: 36, border: '1px solid #E0E0E0', borderRadius: 6, padding: '0 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <div className="text-xs mb-1" style={{ color: '#666666' }}>内容形式</div>
                  <select value={String(fv('content_form') || '')} onChange={(e) => setForm((f) => ({ ...f, content_form: e.target.value }))} style={{ width: '100%', height: 36, border: '1px solid #E0E0E0', borderRadius: 6, fontSize: 13, background: '#fff' }}>
                    <option value="">未设置</option>
                    <option value="图文">图文</option>
                    <option value="短视频">短视频</option>
                  </select>
                </div>
                <div>
                  <div className="text-xs mb-1" style={{ color: '#666666' }}>优先级</div>
                  <select value={String(fv('priority') || 'medium')} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))} style={{ width: '100%', height: 36, border: '1px solid #E0E0E0', borderRadius: 6, fontSize: 13, background: '#fff' }}>
                    {PRIORITY_OPTS.map((p) => <option key={p.value} value={p.value}>{p.label}优先级</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs mb-1" style={{ color: '#666666' }}>预计发布时间</div>
                  <input type="date" value={String(fv('expect_publish_time') || '').slice(0, 10)} onChange={(e) => setForm((f) => ({ ...f, expect_publish_time: e.target.value }))} style={{ width: '100%', height: 36, border: '1px solid #E0E0E0', borderRadius: 6, padding: '0 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <div className="text-xs mb-1" style={{ color: '#666666' }}>所在状态列</div>
                  <select value={String(fv('status_id') || '')} onChange={(e) => setFormStatus(e.target.value)} style={{ width: '100%', height: 36, border: '1px solid #E0E0E0', borderRadius: 6, fontSize: 13, background: '#fff' }}>
                    {(columns || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <div className="text-xs mb-1" style={{ color: '#666666' }}>参考链接</div>
                <input value={String(fv('reference_url') || '')} onChange={(e) => setForm((f) => ({ ...f, reference_url: e.target.value }))} placeholder="对标作品 / 资料链接" style={{ width: '100%', height: 36, border: '1px solid #E0E0E0', borderRadius: 6, padding: '0 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <div className="text-xs mb-1" style={{ color: '#666666' }}>标签</div>
                <div className="flex flex-wrap gap-1.5">
                  {(tags || []).map((t) => {
                    const on = (form.tags || []).includes(String(t.id));
                    return (
                      <button key={t.id} type="button" onClick={() => setFormTag(t.id)} className="text-xs" style={on ? { background: t.color || '#2DB7F5', color: '#fff', border: 'none', padding: '5px 12px', borderRadius: 100, cursor: 'pointer' } : { background: '#fff', color: '#666666', border: '1px solid #E0E0E0', padding: '5px 12px', borderRadius: 100, cursor: 'pointer' }}>{t.name}</button>
                    );
                  })}
                  {!(tags || []).length && <span className="text-xs" style={{ color: '#AAAAAA' }}>暂无标签，可到「标签管理」创建</span>}
                </div>
              </div>
              <div>
                <div className="text-xs mb-1" style={{ color: '#666666' }}>卡片颜色</div>
                <div className="flex flex-wrap gap-2">
                  {COLOR_PRESETS.map((c) => (
                    <button key={c} type="button" onClick={() => setForm((f) => ({ ...f, card_color: c }))} style={{ width: 22, height: 22, borderRadius: 4, background: c, border: String(fv('card_color')) === c ? '2px solid #333' : '2px solid transparent', cursor: 'pointer' }} />
                  ))}
                </div>
              </div>
              <MaterialSection value={form.material_ref} onChange={(v) => setForm((f) => ({ ...f, material_ref: v }))} />
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" onClick={() => setForm(null)} className="text-xs" style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #E0E0E0', background: '#fff', color: '#666666', cursor: 'pointer' }}>取消</button>
              <button type="button" onClick={save} disabled={busy} className="text-xs" style={{ padding: '8px 20px', borderRadius: 6, border: 'none', background: '#2DB7F5', color: '#fff', cursor: busy ? 'default' : 'pointer' }}>{busy ? '保存中…' : '保存'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
