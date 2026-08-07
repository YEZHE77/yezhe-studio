import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import http, { img, compressImage, uploadImage, getExistSigns } from '../api.js';
import bgm from '../bgm.js';
import Slideshow from '../components/Slideshow.jsx';

const ZONES = [
  { key: 'sample', label: '样片', desc: '对外展示、C端小程序可见' },
  { key: 'local', label: '原片', desc: '仅后台可见，不对外' },
  { key: 'final', label: '成片', desc: '交付客户的精修成片' }
];

export default function WorkDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const fileRef = useRef(null);
  const uploadAreaRef = useRef(null);

  const [cats, setCats] = useState([]);
  const [work, setWork] = useState(null);
  const [albums, setAlbums] = useState([]);
  const [zone, setZone] = useState('sample');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadText, setUploadText] = useState('');
  const abortRef = useRef(null);
  // 需求 D：逐项进度 + 暂停/继续 + 单张失败重试 + 弱网提示
  const [paused, setPaused] = useState(false);
  const [uploadRows, setUploadRows] = useState([]); // 与 toUpload 等长：{ name,size,progress,status,url,error }
  const [overallPct, setOverallPct] = useState(0);
  const [weakNet, setWeakNet] = useState(false);
  const pauseRef = useRef(false);
  const rowsRef = useRef([]);
  const toUploadRef = useRef([]);
  const [selected, setSelected] = useState(new Set());
  const [form, setForm] = useState({ title: '', category_ids: [], tags: '', album_copy: '', is_public: true, allow_download: false, album_password_enabled: false, album_password: '', album_expires_at: '' });
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [reordering, setReordering] = useState(false);
  // 上传去重弹窗状态
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadPreviews, setUploadPreviews] = useState([]); // { file, name, size, sign, dup, url, error }
  const [preparing, setPreparing] = useState(false);
  const [slideOpen, setSlideOpen] = useState(false);
  const [slidePhotos, setSlidePhotos] = useState([]);

  async function loadWork() {
    try {
      const r = await http.get('/api/works/' + id);
      const w = r.data.work;
      setWork(w);
      setForm({
        title: w.title || '',
        category_ids: w.category_ids ? w.category_ids.split(',').map((x) => x.trim()).filter(Boolean) : [],
        tags: Array.isArray(w.tags) ? w.tags.join('、') : (w.tags || ''),
        album_copy: w.album_copy || '',
        is_public: !!w.is_public,
        allow_download: !!w.allow_download,
        album_password_enabled: !!w.album_password_enabled,
        album_password: '', // 明文密码绝不回填，修改时由商家重新录入
        album_expires_at: w.album_expires_at || ''
      });
      // 后端 /api/works/:id 已同时返回 albums，避免再发一次请求
      setAlbums(r.data.albums || []);
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
    await loadWork();
    setLoading(false);
  }

  useEffect(() => { http.get('/api/categories').then((r) => setCats(r.data)); }, []);
  useEffect(() => { loadAll(); }, [id]);

  // 从「新建作品组」保存并上传照片跳转过来时，自动聚焦右侧批量上传区域
  useEffect(() => {
    if (!loading && location.state?.openUpload && uploadAreaRef.current) {
      uploadAreaRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const t = setTimeout(() => {
        if (fileRef.current) {
          try { fileRef.current.click(); } catch {}
        }
        // 触发一次后清空 state，避免刷新重复打开
        if (window.history.replaceState) {
          window.history.replaceState({}, '', window.location.pathname);
        }
      }, 400);
      return () => clearTimeout(t);
    }
  }, [loading, location.state]);

  async function saveBasic(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const tags = (form.tags || '').split(/[、,，\s]+/).map((s) => s.trim()).filter(Boolean);
      await http.put('/api/works/' + id, {
        title: form.title,
        category_ids: form.category_ids,
        is_public: form.is_public,
        allow_download: form.allow_download,
        cover_url: work.cover_url || '',
        tags,
        is_private: !!work.is_private,
        blessing: work.blessing || '',
        live: !!work.live,
        order_id: work.order_id || null,
        album_copy: form.album_copy || '',
        album_password_enabled: form.album_password_enabled,
        album_password: form.album_password || '', // 空字符串 → 后端保留原密码
        album_expires_at: form.album_expires_at || ''
      });
      await loadWork();
      alert('保存成功');
    } catch (err) {
      alert((err.response && err.response.data && err.response.data.error) || '保存失败');
    } finally { setSaving(false); }
  }

  // 选图后立即：①拉取本相册已存在签名；②读取每张原图 name+size 生成签名；③标记重复项；④打开预览弹窗
  async function onPickFiles(e) {
    const files = e.target.files;
    if (!fileRef.current) return;
    if (!files || !files.length) return;
    setPreparing(true);
    try {
      // 第一时间请求后端，拿到本相册 existSignList（原有图片签名集合）
      const existSet = await getExistSigns(id);
      const MAX = 3 * 1024 * 1024; // 单张硬性限制 3M
      // H5 直接读取 File 真实原始文件名与字节（压缩前），不拿临时路径名
      const previews = [];
      const overNames = [];
      for (const f of Array.from(files)) {
        let name = f.name, size = f.size, error = false, oversize = false;
        if (!name || !size) { error = true; name = name || 'unknown'; size = size || 0; } // 读取失败 → 放行（防误拦）
        else if (f.size > MAX) { oversize = true; overNames.push(name); } // 单张 >3M → 标记超限，不加入上传队列
        const sign = `${name}_${size}`;
        previews.push({ file: f, name, size, sign, dup: !error && !oversize && existSet.has(sign), error, oversize, url: URL.createObjectURL(f) });
      }
      setUploadPreviews(previews);
      setUploadOpen(true);
      // 需求：选中大于3M 的图片直接提示，不发起上传
      if (overNames.length) {
        alert(`有 ${overNames.length} 张图片大于 3M，已自动过滤（标红「超过3M限制」），请压缩后再上传：\n` +
          overNames.slice(0, 3).join('、') + (overNames.length > 3 ? ' 等' : ''));
      }
    } catch (err) {
      alert('准备上传失败：' + (err.message || err));
    } finally {
      setPreparing(false);
      fileRef.current.value = ''; // 清空，允许再次选择同一批文件
    }
  }

  function closeUpload() {
    if (uploading) return;
    setUploadOpen(false);
    uploadPreviews.forEach((p) => URL.revokeObjectURL(p.url));
    setUploadPreviews([]);
  }

  function cancelUpload() {
    if (abortRef.current) abortRef.current.abort();
  }

  // 行内更新（ref 为真源，setState 仅触发渲染）
  function updateRow(i, patch) {
    const n = rowsRef.current.slice();
    n[i] = { ...n[i], ...patch };
    rowsRef.current = n;
    setUploadRows(n);
  }
  function recomputeOverall() {
    const rows = rowsRef.current;
    if (!rows.length) { setOverallPct(0); return; }
    const done = rows.filter((r) => r.status === 'done').length;
    setOverallPct(Math.round((done / rows.length) * 100));
  }

  function togglePause() {
    const np = !paused;
    setPaused(np);
    pauseRef.current = np;
  }

  const ZONE_CAT = { sample: 'client', local: 'negative', final: 'retouched' };
  const ZONE_PUB = { sample: true, local: false, final: false };

  // 单张上传（压缩 → 上传，含逐项进度 + 弱网标记）。供主循环与单张重试复用。
  async function uploadOneRow(p, idx, ac) {
    updateRow(idx, { status: 'uploading', progress: 0, error: undefined });
    try {
      // 需求 D：压缩质量下调到 0.75，进一步加快上传；保留压缩前 name/size 供去重签名
      const compressed = await compressImage(p.file, { maxWidth: 1920, maxHeight: 1920, quality: 0.75 });
      const r = await uploadImage(compressed, {
        category: ZONE_CAT[zone] || 'customer',
        isPublic: ZONE_PUB[zone] || false,
        signal: ac.signal,
        metaName: p.name,
        metaSize: p.size,
        getPaused: () => pauseRef.current, // 大图分片上传时也可被暂停挂起
        onProgress: (pct) => updateRow(idx, { progress: pct })
      });
      updateRow(idx, { status: 'done', progress: 100, url: r.url });
      return true;
    } catch (e) {
      if (ac.signal.aborted) return false;
      // 弱网/超时/网络错误 → 弹出非静默提示（不吞掉失败）
      const isNet = e && (e.type === 'network' || e.type === 'timeout' || e.type === 'cancel');
      if (isNet) setWeakNet(true);
      updateRow(idx, { status: 'failed', error: (e && e.message) || '上传失败' });
      return false;
    }
  }

  // 单张失败重试（不影响其他图，不打断队列）
  async function retryOne(idx) {
    const p = toUploadRef.current[idx];
    if (!p || !abortRef.current) return;
    await uploadOneRow(p, idx, abortRef.current);
    recomputeOverall();
  }

  // 确认上传：仅上传非重复项；并发 3 张、逐项进度、暂停/继续、单张失败标红+重试、弱网提示
  async function confirmUpload() {
    const toUpload = uploadPreviews.filter((p) => !p.dup && !p.error && !p.oversize);
    if (!toUpload.length) { setUploadOpen(false); return; }
    setUploading(true);
    setOverallPct(0);
    setPaused(false);
    pauseRef.current = false;
    setWeakNet(false);
    rowsRef.current = toUpload.map((p) => ({ name: p.name, size: p.size, progress: 0, status: 'pending' }));
    toUploadRef.current = toUpload;
    setUploadRows(rowsRef.current.slice());
    const ac = new AbortController();
    abortRef.current = ac;
    const total = toUpload.length;
    let done = 0;
    let cursor = 0;

    const worker = async () => {
      while (cursor < total) {
        if (ac.signal.aborted) return;
        const idx = cursor++;
        const ok = await uploadOneRow(toUpload[idx], idx, ac);
        if (ac.signal.aborted) return;
        done++;
        recomputeOverall();
        if (!ok) {/* 单张失败已标红，继续其余 */}
      }
    };

    const pool = [];
    for (let i = 0; i < Math.min(3, total); i++) pool.push(worker());
    await Promise.all(pool);

    // 收尾：取消则不投递；否则按成功项拼接 originalName/size 投递后端
    if (ac.signal.aborted) { setUploadText('已取消上传'); setUploading(false); return; }
    const bodyItems = [];
    toUpload.forEach((p, i) => {
      const row = rowsRef.current[i];
      if (row && row.status === 'done' && row.url) bodyItems.push({ url: row.url, originalName: p.name, size: p.size });
    });
    if (bodyItems.length) {
      try {
        await http.post('/api/works/' + id + '/albums', { zone, items: bodyItems });
        await loadAlbums();
      } catch (err) {
        alert((err.response && err.response.data && err.response.data.error) || '相册保存失败');
      }
    }
    const dupCount = uploadPreviews.length - toUpload.length;
    const failCount = rowsRef.current.filter((r) => r.status === 'failed').length;
    if (failCount) alert(`成功 ${bodyItems.length} 张，已自动跳过重复 ${dupCount} 张，失败 ${failCount} 张（失败项可单张重试）`);
    else alert(`成功上传 ${bodyItems.length} 张（已自动跳过 ${dupCount} 张重复照片）`);
    setUploading(false);
    setUploadOpen(false);
    uploadPreviews.forEach((p) => URL.revokeObjectURL(p.url));
    setUploadPreviews([]);
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
    if (!confirm('确认后将永久删除，建议先做好本地备份，确定继续？')) return;
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

  function toggleSelectAll() {
    const all = new Set(zoneAlbums.map((a) => a.id));
    const allSelected = zoneAlbums.every((a) => selected.has(a.id));
    if (allSelected) {
      setSelected((s) => {
        const n = new Set(s);
        zoneAlbums.forEach((a) => n.delete(a.id));
        return n;
      });
    } else {
      setSelected((s) => new Set([...s, ...all]));
    }
  }

  const zoneAlbums = albums.filter((a) => a.zone === zone).sort((a, b) => (a.sort - b.sort) || (a.id - b.id));

  // 全屏幻灯片：用户点击【播放】手势内触发 BGM 播放
  function openSlide() {
    if (!zoneAlbums.length) return;
    setSlidePhotos(zoneAlbums.map((a) => ({ url: img(a.photo_url) })));
    bgm.play(); // 必须在用户点击手势内调用，规避浏览器自动播放拦截
    setSlideOpen(true);
  }
  function closeSlide() {
    bgm.pause();
    setSlideOpen(false);
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto animate-pulse">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-28 h-9 rounded bg-ink" />
            <div className="w-32 h-7 rounded bg-ink" />
            <div className="w-12 h-5 rounded bg-ink" />
          </div>
          <div className="w-20 h-9 rounded bg-ink" />
        </div>
        <div className="grid lg:grid-cols-3 gap-5">
          <div className="lg:col-span-1 space-y-5">
            <div className="bg-panel border border-line rounded-xl2 p-5 space-y-4">
              <div className="w-24 h-5 rounded bg-ink" />
              <div className="h-10 rounded bg-ink" />
              <div className="h-10 rounded bg-ink" />
              <div className="h-10 rounded bg-ink" />
              <div className="h-24 rounded bg-ink" />
              <div className="h-10 rounded bg-ink" />
              <div className="h-10 rounded bg-brand/30" />
            </div>
            <div className="bg-panel border border-line rounded-xl2 p-5">
              <div className="w-20 h-5 rounded bg-ink mb-3" />
              <div className="w-full h-40 rounded bg-ink" />
            </div>
          </div>
          <div className="lg:col-span-2">
            <div className="bg-panel border border-line rounded-xl2 p-5 min-h-[500px]">
              <div className="flex items-center justify-between mb-4">
                <div className="space-y-2">
                  <div className="w-24 h-5 rounded bg-ink" />
                  <div className="w-40 h-4 rounded bg-ink" />
                </div>
                <div className="w-24 h-9 rounded bg-ink" />
              </div>
              <div className="flex gap-2 mb-4 border-b border-line pb-3">
                <div className="w-16 h-8 rounded bg-ink" />
                <div className="w-16 h-8 rounded bg-ink" />
                <div className="w-16 h-8 rounded bg-ink" />
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="aspect-square rounded-xl2 bg-ink" />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
                <label className="block text-xs text-muted mb-1">作品分类（可多选）</label>
                {cats.length === 0 ? (
                  <div className="text-xs text-muted">暂无分类，可在「分类管理」中新增</div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {cats.map((c) => {
                      const on = form.category_ids.map(String).includes(String(c.id));
                      return (
                        <button type="button" key={c.id}
                          onClick={() => setForm((f) => {
                            const set = new Set(f.category_ids.map(String));
                            if (set.has(String(c.id))) set.delete(String(c.id)); else set.add(String(c.id));
                            return { ...f, category_ids: Array.from(set) };
                          })}
                          className={'px-3 py-1.5 rounded-full text-sm border transition ' + (on ? 'bg-brand text-white border-brand' : 'bg-ink border-line text-muted hover:border-brand')}>
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">相册文案（自定义正文）</label>
                <textarea value={form.album_copy} onChange={(e) => setForm({ ...form, album_copy: e.target.value })} rows={4} placeholder="写给新人的话 / 拍摄手记，将展示在相册首页覆盖层" className="w-full px-3 py-2 rounded bg-ink border border-line text-fg text-sm outline-none" />
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

              <div className="pt-3 mt-1 border-t border-line">
                <div className="text-xs font-medium text-fg mb-3">相册交付设置（客户访问相册）</div>
                <label className="flex items-center gap-2 text-sm text-fg cursor-pointer select-none">
                  <input type="checkbox" checked={form.album_password_enabled} onChange={(e) => setForm({ ...form, album_password_enabled: e.target.checked })} /> 启用相册密码保护
                </label>
                {form.album_password_enabled && (
                  <div className="mt-2">
                    <label className="block text-xs text-muted mb-1">访问密码（6 位数字）</label>
                    <input type="password" inputMode="numeric" maxLength={6} value={form.album_password}
                      onChange={(e) => setForm({ ...form, album_password: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                      placeholder="请输入 6 位数字"
                      className="w-full px-3 py-2 rounded bg-ink border border-line text-fg text-sm outline-none tracking-widest" />
                    <div className="text-[11px] text-muted mt-1">{work.album_password_set ? '已设置密码 · 留空则保持当前密码' : '尚未设置密码 · 保存前请先录入'}</div>
                  </div>
                )}
                <div className="mt-3">
                  <label className="block text-xs text-muted mb-1">相册有效期（可选，留空则永久有效）</label>
                  <input type="date" value={form.album_expires_at} onChange={(e) => setForm({ ...form, album_expires_at: e.target.value })}
                    className="w-full px-3 py-2 rounded bg-ink border border-line text-fg text-sm outline-none" />
                </div>
              </div>
            </div>
            <button type="submit" disabled={saving} className="mt-5 w-full px-4 py-2 rounded bg-brand text-white text-sm hover:opacity-90 disabled:opacity-60">{saving ? '保存中…' : '保存基本信息'}</button>
          </form>

          {work.cover_url && (
            <div className="bg-panel border border-line rounded-xl2 p-5">
              <h2 className="text-base font-semibold text-fg mb-3">当前封面</h2>
              <img src={img(work.cover_url)} loading="lazy" decoding="async" className="w-full h-40 object-cover rounded bg-ink" alt="封面" />
            </div>
          )}
        </div>

        {/* 右侧：相册管理 */}
        <div className="lg:col-span-2">
          <div ref={uploadAreaRef} className="bg-panel border border-line rounded-xl2 p-5 min-h-[500px]">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <div>
                <h2 className="text-base font-semibold text-fg">相册管理</h2>
                <p className="text-xs text-muted mt-0.5">共 {albums.length} 张照片 · 当前分区 {zoneAlbums.length} 张</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={openSlide} disabled={!zoneAlbums.length} className="px-4 py-2 rounded border border-line text-sm text-fg hover:text-brand hover:border-brand disabled:opacity-40">▶ 播放幻灯片</button>
                <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={onPickFiles} />
                <button onClick={() => fileRef.current && fileRef.current.click()} disabled={uploading || preparing} className="px-4 py-2 rounded bg-brand text-white text-sm hover:opacity-90 disabled:opacity-60">{uploading ? `上传中 ${overallPct}%` : preparing ? '准备中…' : '+ 批量上传'}</button>
                {uploading && (
                  <button onClick={togglePause} className="px-3 py-2 rounded border border-line text-sm text-muted hover:text-brand">{paused ? '继续' : '暂停'}</button>
                )}
                {uploading && (
                  <button onClick={cancelUpload} className="px-3 py-2 rounded border border-line text-sm text-muted hover:text-red-500">取消</button>
                )}
                {uploading && (
                  <div className="w-full mt-2 h-1.5 bg-ink rounded overflow-hidden">
                    <div className="h-full bg-brand transition-all" style={{ width: overallPct + '%' }} />
                  </div>
                )}
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

            {/* 全选工具栏 */}
            {zoneAlbums.length > 0 && (
              <div className="flex items-center justify-between mb-3">
                <label className="flex items-center gap-2 text-sm text-fg cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={zoneAlbums.length > 0 && zoneAlbums.every((a) => selected.has(a.id))}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 accent-brand"
                  />
                  全选 <span className="text-muted">({selected.size}/{zoneAlbums.length})</span>
                </label>
                {selected.size > 0 && (
                  <button onClick={deleteSelected} className="px-3 py-1.5 rounded border border-red-200 text-red-500 text-sm hover:bg-red-50">删除选中({selected.size})</button>
                )}
              </div>
            )}

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
                      <img src={img(a.photo_url)} loading="lazy" decoding="async" className="w-full h-full object-cover bg-ink" alt="" />
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
      {/* 上传去重预览弹窗：选图后展示缩略图，重复项灰色蒙层 + 【已存在】标签，仅上传新照片 */}
      {uploadOpen && (() => {
        const toUpload = uploadPreviews.filter((p) => !p.dup && !p.error && !p.oversize);
        const dupCount = uploadPreviews.filter((p) => p.dup).length;
        const errCount = uploadPreviews.filter((p) => p.error).length;
        const overCount = uploadPreviews.filter((p) => p.oversize).length;
        // 每个预览对应类型与（非重复）行索引
        const kinds = uploadPreviews.map((p) => {
          if (p.dup) return { kind: 'dup' };
          if (p.error) return { kind: 'err' };
          if (p.oversize) return { kind: 'over' };
          return { kind: 'up', ri: toUpload.indexOf(p) };
        });
        const failCount = uploadRows.filter((r) => r.status === 'failed').length;
        const doneCount = uploadRows.filter((r) => r.status === 'done').length;
        return (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => !uploading && closeUpload()}>
          <div className="bg-panel border border-line rounded-xl2 w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-line">
              <div>
                <h3 className="text-base font-semibold text-fg">上传到「{ZONES.find((z) => z.key === zone).label}」相册</h3>
                <p className="text-xs text-muted mt-0.5">
                  待上传 {toUpload.length} 张 · 已存在 {dupCount} 张（自动跳过）{errCount ? ` · 读取失败 ${errCount} 张` : ''}{overCount ? ` · 超过3M ${overCount} 张（已过滤）` : ''}
                </p>
              </div>
              <button onClick={closeUpload} disabled={uploading} className="text-muted hover:text-fg text-sm disabled:opacity-40">✕</button>
            </div>
            {weakNet && (
              <div className="mx-4 mt-3 px-3 py-2 rounded bg-amber-50 border border-amber-300 text-amber-700 text-xs flex items-center justify-between gap-2">
                <span>⚠️ 检测到弱网，已自动重试；若持续失败请检查网络后单张重试。</span>
                <button onClick={() => setWeakNet(false)} className="text-amber-700 font-medium shrink-0">知道了</button>
              </div>
            )}
            <div className="p-4 overflow-y-auto">
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                {uploadPreviews.map((p, i) => {
                  const k = kinds[i];
                  const row = k.kind === 'up' ? uploadRows[k.ri] : null;
                  const isFailed = row && row.status === 'failed';
                  const isDone = row && row.status === 'done';
                  const isUploading = row && row.status === 'uploading';
                  return (
                  <div key={i} className={'relative aspect-square rounded-xl2 overflow-hidden bg-ink border ' + (
                    k.kind === 'dup' ? 'border-line'
                    : k.kind === 'over' ? 'border-red-400'
                    : isFailed ? 'border-red-400'
                    : isDone ? 'border-green-400/70'
                    : 'border-brand/40'
                  )}>
                    <img src={p.url} className="w-full h-full object-cover" alt={p.name} />
                    {k.kind === 'dup' && (
                      <>
                        <div className="absolute inset-0 bg-black/55" />
                        <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/70 text-white text-[10px]">已存在</span>
                        <span className="absolute bottom-1.5 right-1.5 text-white/80 text-[10px]">已跳过</span>
                      </>
                    )}
                    {k.kind === 'over' && (
                      <>
                        <div className="absolute inset-0 bg-black/55" />
                        <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-red-500/90 text-white text-[10px]">超过3M限制</span>
                        <span className="absolute bottom-1.5 right-1.5 text-white/80 text-[10px]">已过滤</span>
                      </>
                    )}
                    {k.kind === 'err' && (
                      <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-amber-500/80 text-white text-[10px]">读取失败</span>
                    )}
                    {k.kind === 'up' && (
                      <>
                        {isUploading && (
                          <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/40">
                            <div className="h-full bg-brand transition-all" style={{ width: (row.progress || 0) + '%' }} />
                          </div>
                        )}
                        {isFailed && (
                          <button onClick={() => retryOne(k.ri)} className="absolute inset-0 flex items-center justify-center">
                            <span className="px-2 py-1 rounded bg-red-500/90 text-white text-[10px]">↻ 重试</span>
                          </button>
                        )}
                        <span className={'absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded text-white text-[10px] ' + (
                          isDone ? 'bg-green-500/80' : isFailed ? 'bg-red-500/80' : isUploading ? 'bg-brand/90' : 'bg-brand/80'
                        )}>
                          {isDone ? '完成' : isFailed ? '失败' : isUploading ? `上传中 ${row.progress || 0}%` : '待上传'}
                        </span>
                      </>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
            {uploading && (
              <div className="px-4 pb-3">
                <div className="flex items-center justify-between text-xs text-muted mb-1">
                  <span>总进度 {doneCount}/{uploadRows.length || toUpload.length}</span>
                  <span>{overallPct}%</span>
                </div>
                <div className="h-1.5 bg-ink rounded overflow-hidden">
                  <div className="h-full bg-brand transition-all" style={{ width: overallPct + '%' }} />
                </div>
              </div>
            )}
            <div className="p-4 border-t border-line flex items-center justify-between gap-3">
              <span className="text-xs text-muted">
                {failCount ? `失败 ${failCount} 张可单张重试 · ` : ''}{overCount ? `超过3M ${overCount} 张已过滤 · ` : ''}已自动过滤重复照片，仅上传新照片
              </span>
              <div className="flex gap-2">
                {uploading ? (
                  <>
                    <button onClick={togglePause} className="px-4 py-2 rounded border border-line text-sm text-brand hover:border-brand">{paused ? '继续' : '暂停'}</button>
                    <button onClick={cancelUpload} className="px-4 py-2 rounded border border-line text-sm text-red-500 hover:border-red-300">取消</button>
                  </>
                ) : (
                  <button onClick={closeUpload} className="px-4 py-2 rounded border border-line text-sm text-fg hover:border-brand">取消</button>
                )}
                {!uploading && (
                  <button onClick={confirmUpload} disabled={toUpload.length === 0}
                    className="px-4 py-2 rounded bg-brand text-white text-sm hover:opacity-90 disabled:opacity-60">
                    {`上传 ${toUpload.length} 张`}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
        );
      })()}
      <Slideshow photos={slidePhotos} open={slideOpen} onClose={closeSlide} title={work ? work.title : ''} />
    </div>
  );
}
