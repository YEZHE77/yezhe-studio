import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import http, { img, compressImage, uploadImage, BASE } from '../api.js';
import bgm from '../bgm.js';
import Slideshow from '../components/Slideshow.jsx';
import Lightbox from '../components/Lightbox.jsx';
import ImageCropper from '../components/ImageCropper.jsx';
import { ChevronLeft, Music, PlayCircle, Plus } from 'lucide-react';

const ZONES = [
  { key: 'sample', label: '样片', desc: '对外展示、C端小程序可见' },
  { key: 'local', label: '原片', desc: '仅后台可见，不对外' },
  { key: 'final', label: '成片', desc: '交付客户的精修成片' }
];

// 表单默认结构（不写死业务数据，仅作草稿恢复兜底）
const DEFAULT_FORM = {
  title: '', category_ids: [], tags: '', album_copy: '',
  is_public: true, allow_download: false, album_password_enabled: false,
  album_password: '', album_expires_at: ''
};

// —— 作品编辑表单草稿（localStorage）——
// 解决场景：移动端/浏览器在滚动大量图片时可能回收页面或重挂载组件，
// 导致受控表单 form 状态丢失、用户输入被清空。写入本地草稿，重挂载或刷新后自动恢复。
function draftKey(id) { return 'work_form_draft_' + id; }
function readDraft(id) {
  try {
    const raw = localStorage.getItem(draftKey(id));
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object' || !d.__ts) return null;
    return d;
  } catch { return null; }
}
function writeDraft(id, form) {
  try {
    // 明文密码不落本地存储，仅保留其余字段；__ts 用于与后端 updated_at 比较
    const payload = { ...form, __ts: Date.now() };
    delete payload.album_password;
    localStorage.setItem(draftKey(id), JSON.stringify(payload));
  } catch {}
}
function clearDraft(id) {
  try { localStorage.removeItem(draftKey(id)); } catch {}
}

// 上传预览/进度弹窗（移动端与桌面端共用）：
// 此前该弹窗只渲染在桌面端 return 分支，移动端选图后 setUploadOpen(true) 无任何界面反馈，
// 表现为「点了上传照片没反应、看不到进度」。提取为组件后移动/桌面统一渲染。
function UploadModal({ open, zoneLabel, previews, rows, uploading, paused, weakNet, warming, overallPct,
  onClose, onCancel, onTogglePause, onConfirm, onRetry, onDismissWeakNet }) {
  if (!open) return null;
  const toUpload = previews.filter((p) => !p.error && !p.oversize);
  const errCount = previews.filter((p) => p.error).length;
  const overCount = previews.filter((p) => p.oversize).length;
  // 每个预览对应类型与（非超限/非失败）行索引
  const kinds = previews.map((p) => {
    if (p.error) return { kind: 'err' };
    if (p.oversize) return { kind: 'over' };
    return { kind: 'up', ri: toUpload.indexOf(p) };
  });
  const failCount = rows.filter((r) => r.status === 'failed').length;
  const doneCount = rows.filter((r) => r.status === 'done').length;
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => !uploading && onClose()}>
      <div className="bg-panel border border-line rounded-xl2 w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-line">
          <div>
            <h3 className="text-base text-fg">上传到「{zoneLabel}」相册</h3>
            <p className="text-xs text-muted mt-0.5">
              待上传 {toUpload.length} 张{errCount ? ` · 读取失败 ${errCount} 张` : ''}{overCount ? ` · 超过15M ${overCount} 张（已过滤）` : ''}
            </p>
          </div>
          <button onClick={onClose} disabled={uploading} className="text-muted hover:text-fg text-sm disabled:opacity-40">✕</button>
        </div>
        {weakNet && (
          <div className="mx-4 mt-3 px-3 py-2 rounded bg-amber-50 border border-amber-300 text-amber-700 text-xs flex items-center justify-between gap-2">
            <span>⚠️ 检测到弱网，已自动重试；若持续失败请检查网络后单张重试。</span>
            <button onClick={onDismissWeakNet} className="text-amber-700 shrink-0">知道了</button>
          </div>
        )}
        {warming && (
          <div className="mx-4 mt-3 px-3 py-2 rounded bg-blue-50 border border-blue-300 text-blue-700 text-xs flex items-center gap-2">
            <svg className="animate-spin h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <span>服务器唤醒中，请稍候（Render 免费服务首次访问需数秒冷启动）…</span>
          </div>
        )}
        <div className="p-4 overflow-y-auto">
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
            {previews.map((p, i) => {
              const k = kinds[i];
              const row = k.kind === 'up' ? rows[k.ri] : null;
              const isFailed = row && row.status === 'failed';
              const isDone = row && row.status === 'done';
              const isUploading = row && row.status === 'uploading';
              return (
              <div key={i} className={'relative aspect-square rounded-xl2 overflow-hidden bg-ink border ' + (
                k.kind === 'over' ? 'border-red-400'
                : isFailed ? 'border-red-400'
                : isDone ? 'border-green-400/70'
                : 'border-brand/40'
              )}>
                <img src={p.url} className="w-full h-full object-cover" alt={p.name} />
                {k.kind === 'over' && (
                  <>
                    <div className="absolute inset-0 bg-black/55" />
                    <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-red-500/90 text-white text-[10px]">超过15M限制</span>
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
                      <button onClick={() => onRetry(k.ri)} className="absolute inset-0 flex items-center justify-center">
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
              <span>总进度 {doneCount}/{rows.length || toUpload.length}</span>
              <span>{overallPct}%</span>
            </div>
            <div className="h-1.5 bg-ink rounded overflow-hidden">
              <div className="h-full bg-brand transition-all" style={{ width: overallPct + '%' }} />
            </div>
          </div>
        )}
        <div className="p-4 border-t border-line flex items-center justify-between flex-wrap gap-3">
          <span className="text-xs text-muted">
            {failCount ? `失败 ${failCount} 张可单张重试 · ` : ''}{overCount ? `超过15M ${overCount} 张已过滤 · ` : ''}所有照片均可上传
          </span>
          <div className="flex gap-2">
            {uploading ? (
              <>
                <button onClick={onTogglePause} className="px-4 py-2 rounded border border-line text-sm text-brand hover:border-brand">{paused ? '继续' : '暂停'}</button>
                <button onClick={onCancel} className="px-4 py-2 rounded border border-line text-sm text-red-500 hover:border-red-300">取消</button>
              </>
            ) : (
              <button onClick={onClose} className="px-4 py-2 rounded border border-line text-sm text-fg hover:border-brand">取消</button>
            )}
            {!uploading && (
              <button onClick={onConfirm} disabled={toUpload.length === 0}
                className="px-4 py-2 rounded bg-brand text-white text-sm hover:opacity-90 disabled:opacity-60">
                {`上传 ${toUpload.length} 张`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function WorkDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const isNew = id === 'new' || location.pathname === '/works/new'; // 页面式新建：直接进入编辑页，空白表单创建作品
  // 注：/works/new 为静态路由，useParams() 无 :id，id 为 undefined，须用 pathname 兜底判断新建态
  const fileRef = useRef(null);
  const uploadAreaRef = useRef(null);
  const albumCopyRef = useRef(null); // 文案 textarea 自适应高度
  // 移动端响应式：宽度 < 768px 视为手机，内联样式按 isMobile 降级，避免固定宽度溢出
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 768 : false);
  // PC 端相册列数：与 Tailwind 断点一致（默认 3 / sm:640 4 / md:768 5）
  const [pcCols, setPcCols] = useState(() => typeof window !== 'undefined' ? (window.innerWidth < 640 ? 3 : window.innerWidth < 768 ? 4 : 5) : 5);
  useEffect(() => {
    const onResize = () => {
      setIsMobile(window.innerWidth < 768);
      setPcCols(window.innerWidth < 640 ? 3 : window.innerWidth < 768 ? 4 : 5);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // 初始表单：非新建且有本地草稿时，优先用草稿恢复（防止重挂载/刷新后标题被清空）
  const initialDraft = !isNew ? readDraft(id) : null;
  const [cats, setCats] = useState([]);
  const [work, setWork] = useState(null);
  const [albums, setAlbums] = useState([]);
  // 图片加载失败（onError）兜底集合：记录已裂图的相册 id，渲染占位而非空白框
  const [brokenSet, setBrokenSet] = useState(new Set());
  const brokenSetRef = useRef(new Set());
  const [zone, setZone] = useState('sample');
  const [panelTab, setPanelTab] = useState('basic'); // 右侧面板 Tab：basic 基本信息 / album 相册管理
  const [loading, setLoading] = useState(id === 'new' ? false : true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadText, setUploadText] = useState('');
  const abortRef = useRef(null);
  // 需求 D：逐项进度 + 暂停/继续 + 单张失败重试 + 弱网提示
  const [paused, setPaused] = useState(false);
  const [uploadRows, setUploadRows] = useState([]); // 与 toUpload 等长：{ name,size,progress,status,url,error }
  const [overallPct, setOverallPct] = useState(0);
  const [weakNet, setWeakNet] = useState(false);
  // 冷启动提示：后端 TTFB 超过 3000ms 时显示「服务器唤醒中，请稍候」
  const [warming, setWarming] = useState(false);
  const warmingRef = useRef(false);
  const pauseRef = useRef(false);
  const rowsRef = useRef([]);
  const toUploadRef = useRef([]);
  const [selected, setSelected] = useState(new Set());
  const [form, setForm] = useState(
    initialDraft
      ? { ...DEFAULT_FORM, ...initialDraft, album_password: '' }
      : { ...DEFAULT_FORM }
  );
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [reordering, setReordering] = useState(false);
  // 上传去重弹窗状态
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadPreviews, setUploadPreviews] = useState([]); // { file, name, size, url, error, oversize }
  const [preparing, setPreparing] = useState(false);
  const [slideOpen, setSlideOpen] = useState(false);
  const [slidePhotos, setSlidePhotos] = useState([]);
  // 下面 4 个 *Ref 镜像 albums/form 关键字段，供异步逻辑读取最新 state
  const albumsLenRef = useRef(0);
  const formTitleRef = useRef('');
  const formIsPublicRef = useRef(false);
  const formAlbumCopyRef = useRef('');
  const formCoverUrlRef = useRef('');
  // 单击预览（Lightbox）
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  // 封面裁剪
  const [coverCrop, setCoverCrop] = useState({ open: false, file: null, aspect: null, uploading: false });
  // 移动端编辑面板：null | 'album' | 'music' | 'settings'
  const [mobilePanel, setMobilePanel] = useState(null);
  const [mobileZone, setMobileZone] = useState('sample');
  // 修改图片子页：上传类型 tab + 待保存变更（删除/封面/排序）
  const [albumUploadTab, setAlbumUploadTab] = useState('image'); // 'image' | 'video'
  const [pendingDeletes, setPendingDeletes] = useState(() => new Set());
  const [pendingCoverUrl, setPendingCoverUrl] = useState(null);
  const [pendingOrder, setPendingOrder] = useState(null); // 排序后的 id 数组
  // 修改图片子页：长按拖拽排序（dragOverId 复用桌面端既有 state）
  const [draggingId, setDraggingId] = useState(null);
  const longPressTimerRef = useRef(null);
  // 拖拽刚结束的瞬间拦截误触发预览点击
  const justDraggedRef = useRef(false);
  // 新建态(/works/new)下选图的内存暂存：{file, name, size, url, zone}
  // 用户点「保存基本信息」时统一上传并关联到新创建的作品的 albums。
  // 仅内存：刷新/关闭页面即丢失（用户已接受：未保存则不成功）。
  const [pendingPhotos, setPendingPhotos] = useState([]);
  const pendingPhotosRef = useRef([]);
  useEffect(() => { pendingPhotosRef.current = pendingPhotos; }, [pendingPhotos]);
  // 文案 textarea 自适应高度：内容变化时高度跟随 scrollHeight 扩展
  useEffect(() => {
    const el = albumCopyRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, [form.album_copy]);

  async function loadWork() {
    try {
      const r = await http.get('/api/works/' + id);
      const w = r.data.work;
      setWork(w);
      const catIds = typeof w.category_ids === 'string'
        ? w.category_ids.split(',').map((x) => x.trim()).filter(Boolean)
        : (Array.isArray(w.category_ids) ? w.category_ids : []);
      const backendForm = {
        title: w.title || '',
        category_ids: catIds,
        tags: Array.isArray(w.tags) ? w.tags.join('、') : (typeof w.tags === 'string' ? w.tags : ''),
        album_copy: w.album_copy || '',
        is_public: !!w.is_public,
        allow_download: !!w.allow_download,
        album_password_enabled: !!w.album_password_enabled,
        album_password: '', // 明文密码绝不回填，修改时由商家重新录入
        album_expires_at: w.album_expires_at || ''
      };
      // 本地草稿比后端 updated_at 更新 → 用户有未保存修改，优先恢复草稿，避免覆盖输入
      const draft = readDraft(id);
      const backendTs = new Date(w.updated_at || 0).getTime();
      if (draft && draft.__ts && draft.__ts > backendTs) {
        setForm({ ...DEFAULT_FORM, ...draft, album_password: '' });
      } else {
        setForm(backendForm);
        if (draft) clearDraft(id); // 后端已是最新，丢弃过期草稿
      }
      // 后端 /api/works/:id 已同时返回 albums，避免再发一次请求
      const initialAlbums = r.data.albums || [];
      setAlbums(initialAlbums);
    } catch (e) {
      alert('加载作品失败');
    }
  }

  // 标记某张相册图加载失败（onError 兜底），渲染占位图而非空白框
  function markBroken(aid) {
    if (brokenSetRef.current.has(aid)) return;
    const n = new Set(brokenSetRef.current);
    n.add(aid);
    brokenSetRef.current = n;
    setBrokenSet(n);
  }

  async function loadAlbums() {
    try {
      const r = await http.get('/api/works/' + id + '/albums');
      const items = r.data.items || [];
      setAlbums(items);
      // 控制台打印每张图片完整 url，方便排查 404 / 502（url 为空 / 裂图定位）
      items.forEach((a) => console.log('[WorkDetail] album photo', a.id, 'status=', a.status, 'url=', a.photo_url));
    } catch (e) {
      console.error('[WorkDetail] 获取相册列表失败', e);
    }
  }

  async function loadAll() {
    if (isNew) {
      // 新建态不预创建草稿：用户填写表单后点「保存」才真正 POST /api/works。
      // 列表页访问时后端已热启动，WorkDetail 本地渲染无需等待。
      setWork(null);
      setAlbums([]);
      setForm({ ...DEFAULT_FORM });
      setLoading(false);
      return;
    }
    setLoading(true);
    await loadWork();
    setLoading(false);
  }

  useEffect(() => { http.get('/api/categories').then((r) => setCats(r.data)); }, []);
  useEffect(() => { loadAll(); }, [id]);

  // 自动保存表单草稿（防抖 600ms）：滚动导致页面回收/组件重挂载或刷新时，输入不丢失
  useEffect(() => {
    if (isNew || loading) return;
    const t = setTimeout(() => writeDraft(id, form), 600);
    return () => clearTimeout(t);
  }, [form, id, loading, isNew]);

  // 存在未保存草稿或新建态有暂存照片时，离开/刷新页面给出浏览器原生提示，避免误丢改动
  useEffect(() => {
    function onBeforeUnload(e) {
      if (isNew && pendingPhotosRef.current.length) {
        e.preventDefault();
        e.returnValue = '您有待保存的照片，离开页面将丢失。';
        return;
      }
      if (!isNew) {
        const d = readDraft(id);
        if (!d) return;
        e.preventDefault();
        e.returnValue = '您有未保存的修改，离开页面将丢失。';
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [id, isNew]);

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
    if (!form.title.trim()) { alert('请填写作品标题'); return; }
    setSaving(true);
    try {
      const tags = (form.tags || '').split(/[、,，\s]+/).map((s) => s.trim()).filter(Boolean);
      const payload = {
        title: form.title,
        category_ids: form.category_ids,
        is_public: form.is_public,
        allow_download: form.allow_download,
        tags,
        album_copy: form.album_copy || '',
        album_password_enabled: form.album_password_enabled,
        album_password: form.album_password || '', // 空字符串 → 新建无密码 / 编辑保留原密码
        album_expires_at: form.album_expires_at || ''
      };
      if (isNew) {
        // 新建：用户已确认保存，才真正创建作品；成功后进入真实编辑页继续上传照片。
        const r = await http.post('/api/works', {
          ...payload,
          cover_url: '', is_private: false, description: '', blessing: '', live: false, customer_name: '', order_id: null
        });
        const newId = r.data.id;
        // 上传用户在新建态暂存的全部照片（按 zone 分组 → /api/works/:id/albums）
        // 用户硬规则：未点保存不产生作品+不关联相册；此处只在保存按钮点击后才执行
        const pending = pendingPhotosRef.current;
        if (pending.length) {
          const byZone = {};
          const failed = [];
          for (const p of pending) {
            try {
              const compressed = await compressImage(p.file, { maxWidth: 1920, maxHeight: 1920, quality: 0.75 });
              const up = await uploadImage(compressed, {
                category: ZONE_CAT[p.zone] || 'customer',
                isPublic: ZONE_PUB[p.zone] || false,
                metaName: p.name,
                metaSize: p.size
              });
              (byZone[p.zone] = byZone[p.zone] || []).push({ url: up.url, originalName: p.name, size: p.size });
            } catch (err) {
              failed.push(p.name);
            }
          }
          for (const [z, items] of Object.entries(byZone)) {
            if (!items.length) continue;
            try {
              await http.post('/api/works/' + newId + '/albums', { zone: z, items });
            } catch (err) {
              alert('照片保存到「' + (ZONES.find((zz) => zz.key === z)?.label || z) + '」失败：' + ((err.response && err.response.data && err.response.data.error) || err.message));
            }
          }
          if (failed.length) alert('以下照片上传失败，需在编辑页手动重传：\n' + failed.join('、'));
        }
        setPendingPhotos([]);
        pendingPhotosRef.current = [];
        const okCount = Object.values(byZone || {}).reduce((s, a) => s + a.length, 0);
        const msg = pending.length ? `作品创建成功，已上传 ${okCount} 张照片${failed.length ? `，${failed.length} 张失败需在编辑页手动重传` : ''}` : '作品创建成功，可继续上传照片';
        alert(msg);
        navigate('/works/' + newId + '/edit', { replace: true });
        return;
      }
      // 编辑：保留作品本身字段（封面 / 关联订单等），仅更新表单字段
      await http.put('/api/works/' + id, {
        ...payload,
        cover_url: work.cover_url || '',
        is_private: !!work.is_private,
        description: work.description || '',
        blessing: work.blessing || '',
        live: !!work.live,
        customer_name: work.customer_name || '',
        order_id: work.order_id || null
      });
      clearDraft(id);
      await loadWork();
      alert('保存成功');
    } catch (err) {
      alert((err.response && err.response.data && err.response.data.error) || '保存失败');
    } finally { setSaving(false); }
  }

  // 「返回」按钮处理：从预览页进入编辑则返回上一页；其他入口（新建/直达URL）返回列表
  function handleBack() {
    if (location.state?.from === 'preview') navigate(-1);
    else navigate('/works');
  }

  // 同步关键 state 到 ref（保留，供后续扩展使用）
  useEffect(() => { albumsLenRef.current = albums.length; }, [albums.length]);
  useEffect(() => { formTitleRef.current = form.title; }, [form.title]);
  useEffect(() => { formIsPublicRef.current = !!form.is_public; }, [form.is_public]);
  useEffect(() => { formAlbumCopyRef.current = form.album_copy || ''; }, [form.album_copy]);
  useEffect(() => { formCoverUrlRef.current = work?.cover_url || pendingCoverUrl || ''; }, [work?.cover_url, pendingCoverUrl]);

  function onUploadClick() {
    if (fileRef.current) {
      fileRef.current.click();
    } else {
      alert('文件选择器未就绪，请刷新页面后重试');
    }
  }

  // 选图后：读取每张原图 name+size，打开预览弹窗（不限制重复上传）
  // 新建态(/works/new)：暂存到内存 pendingPhotos，等用户点保存基本信息时再统一上传并关联 albums
  async function onPickFiles(e) {
    const files = e.target.files;
    if (!files || !files.length) return;
    setPreparing(true);
    try {
      const MAX = 15 * 1024 * 1024; // 选文件预检：与后端 multer 一致 15MB；实际压缩后远小于此
      const previews = [];
      const overNames = [];
      for (const f of Array.from(files)) {
        let name = f.name, size = f.size, error = false, oversize = false;
        if (!name || !size) { error = true; name = name || 'unknown'; size = size || 0; } // 读取失败 → 放行（防误拦）
        else if (f.size > MAX) { oversize = true; overNames.push(name); } // 单张 >15M → 标记超限，不加入上传队列
        previews.push({ file: f, name, size, error, oversize, url: URL.createObjectURL(f) });
      }
      setUploadPreviews(previews);
      setUploadOpen(true);
      // 需求：选中大于15M 的图片直接提示，不发起上传
      if (overNames.length) {
        alert(`有 ${overNames.length} 张图片大于 15M，已自动过滤：\n` +
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
      // 冷启动检测：后端 TTFB 超 3000ms 视为服务器唤醒中
      if (r.timing && typeof r.timing.ttfb === 'number') {
        if (r.timing.ttfb > 3000) { setWarming(true); warmingRef.current = true; }
        else if (warmingRef.current) { setWarming(false); warmingRef.current = false; }
      }
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

  // 确认上传：所有照片（含重复）均可上传；并发 3 张、逐项进度、暂停/继续、单张失败标红+重试、弱网提示
  async function confirmUpload() {
    // 新建态：暂存到内存，不调后端；用户点保存时再统一上传并关联 albums
    if (isNew) {
      const valid = uploadPreviews.filter((p) => !p.error && !p.oversize);
      uploadPreviews.forEach((p) => URL.revokeObjectURL(p.url));
      setUploadPreviews([]);
      setUploadOpen(false);
      if (!valid.length) return;
      const zoneKey = zone;
      const items = valid.map((p) => ({ file: p.file, name: p.name, size: p.size, url: p.url, zone: zoneKey }));
      setPendingPhotos((arr) => [...arr, ...items]);
      alert(`已暂存 ${valid.length} 张照片（${ZONES.find((z) => z.key === zoneKey)?.label || zoneKey}），点「保存基本信息」后一并上传。`);
      return;
    }
    const toUpload = uploadPreviews.filter((p) => !p.error && !p.oversize);
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
    const failCount = rowsRef.current.filter((r) => r.status === 'failed').length;
    if (failCount) alert(`成功 ${bodyItems.length} 张，失败 ${failCount} 张（失败项可单张重试）`);
    else alert(`成功上传 ${bodyItems.length} 张`);
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

  // 修改图片子页：批量保存所有待提交变更（删除/封面/排序）
  async function saveAlbumChanges() {
    const delIds = [...pendingDeletes];
    const coverUrl = pendingCoverUrl;
    const order = pendingOrder;
    if (!delIds.length && !coverUrl && !order) return;
    setReordering(true);
    try {
      if (order) await http.post('/api/works/' + id + '/albums/reorder', { orders: order, zone: mobileZone });
      if (coverUrl) await http.put('/api/works/' + id, { cover_url: coverUrl });
      if (delIds.length) await Promise.all(delIds.map((aid) => http.delete('/api/albums/' + aid)));
      // 清空待保存状态
      setPendingDeletes(new Set());
      setPendingCoverUrl(null);
      setPendingOrder(null);
      await Promise.all([loadAlbums(), loadWork()]);
    } catch (err) {
      alert((err.response && err.response.data && err.response.data.error) || '保存失败');
    } finally { setReordering(false); }
  }

  // —— 长按拖拽排序（移动端）——
  // pointerdown → 启动 500ms 长按计时；到期设 draggingId 进入拖拽态
  function onThumbPointerDown(e, aid) {
    longPressTimerRef.current = setTimeout(() => {
      setDraggingId(aid);
    }, 500);
  }
  // pointermove → 拖拽中用 elementFromPoint 命中目标缩略图
  function onThumbPointerMove(e) {
    if (!draggingId) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const thumb = el && el.closest('[data-album-id]');
    if (thumb) {
      const overId = parseInt(thumb.getAttribute('data-album-id'), 10);
      if (overId && overId !== dragOverId) setDragOverId(overId);
    } else {
      setDragOverId(null);
    }
  }
  // pointerup → 清计时器；若有 draggingId+dragOverId 则提交排序
  function onThumbPointerUp() {
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
    if (draggingId && dragOverId && draggingId !== dragOverId) {
      // 基于 pendingOrder 或原始顺序计算当前显示顺序
      const currentOrder = albumList.map((a) => a.id);
      const fromIdx = currentOrder.indexOf(draggingId);
      const toIdx = currentOrder.indexOf(dragOverId);
      if (fromIdx !== -1 && toIdx !== -1) {
        const newOrder = [...currentOrder];
        const [moved] = newOrder.splice(fromIdx, 1);
        newOrder.splice(toIdx, 0, moved);
        // 完整 zone 顺序：cover 在前 + grid 新序
        const coverId = coverPhoto ? coverPhoto.id : null;
        const gridIds = newOrder.filter((aid2) => aid2 !== coverId);
        setPendingOrder(coverId ? [coverId, ...gridIds] : gridIds);
      }
      justDraggedRef.current = true;
      setTimeout(() => { justDraggedRef.current = false; }, 50);
    }
    setDraggingId(null);
    setDragOverId(null);
  }

  // 单击照片打开大图预览（拖拽刚结束的瞬间拦截，避免误触）
  function openPreview(i) {
    if (justDraggedRef.current) return;
    setPreviewIndex(i);
    setPreviewOpen(true);
  }
  // 主页尾部照片预览：切换 zone + 打开 Lightbox
  // React 18 自动 batch：同回调内 setZone+setPreviewIndex+setPreviewOpen 合并，
  // 下次渲染 zoneAlbums 已指向新分区，Lightbox 拿到正确照片
  function openZonePreview(zoneKey, idx) {
    if (justDraggedRef.current) return;
    setZone(zoneKey);
    setSelected(new Set());
    setPreviewIndex(idx);
    setPreviewOpen(true);
  }
  // 封面自定义裁剪
  function openCoverCrop() { setCoverCrop({ open: true, file: null, aspect: null, uploading: false }); }
  async function doCoverCrop(file) {
    setCoverCrop((c) => ({ ...c, uploading: true }));
    try {
      const url = await uploadImage(file, { isPublic: true });
      await setCover(url); // 内部已 loadWork + 提示
      setCoverCrop({ open: false, file: null, aspect: null, uploading: false });
    } catch (e) {
      alert('封面裁剪保存失败');
      setCoverCrop((c) => ({ ...c, uploading: false }));
    }
  }
  // 使用当前封面进行裁剪：拉取现有 cover_url 转为 File 传给 ImageCropper
  async function cropCurrentCover() {
    if (!work?.cover_url) { alert('暂无当前封面'); return; }
    setCoverCrop((c) => ({ ...c, uploading: true }));
    try {
      const url = img(work.cover_url);
      const res = await fetch(url);
      if (!res.ok) throw new Error('fetch failed');
      const blob = await res.blob();
      const name = url.split('/').pop() || 'current-cover.jpg';
      const file = new File([blob], name, { type: blob.type || 'image/jpeg' });
      setCoverCrop((c) => ({ ...c, file, uploading: false }));
    } catch (e) {
      console.error(e);
      alert('当前封面无法直接读取（跨域限制），请下载后从本地选择');
      setCoverCrop((c) => ({ ...c, uploading: false }));
    }
  }

  function handleDragStart(e, aid) {
    setDraggedId(aid);
    justDraggedRef.current = true; // 标记本次为拖拽，drop 后短暂拦截点击
    e.dataTransfer.effectAllowed = 'move';
    // 隐藏默认拖拽幽灵图上的悬停提示
    e.dataTransfer.setData('text/plain', String(aid));
  }
  function handleDragOver(e, aid) {
    e.preventDefault();
    if (aid !== draggedId) setDragOverId(aid);
  }
  function resetDrag() { setDraggedId(null); setDragOverId(null); }
  function handleDrop(e, dropId) {
    e.preventDefault();
    if (!draggedId) { resetDrag(); return; }
    const list = [...zoneAlbums];
    if (!list.some((a) => a.id === dropId)) { resetDrag(); return; }
    // 多选拖拽：若拖动的这张在选中集合内且选中数>1，则整体移动选中集合（保持相对顺序）
    const movingIds = (selected.has(draggedId) && selected.size > 1) ? [...selected] : [draggedId];
    if (movingIds.includes(dropId)) { resetDrag(); return; } // 落在自身组内不移动
    const moving = list.filter((a) => movingIds.includes(a.id)); // 保持原顺序
    const rest = list.filter((a) => !movingIds.includes(a.id));
    let insertAt = rest.findIndex((a) => a.id === dropId);
    if (insertAt < 0) insertAt = rest.length;
    rest.splice(insertAt, 0, ...moving);
    saveReorder(rest.map((a) => a.id)); // 整分区按新顺序重写 sort
    resetDrag();
  }
  function handleDragEnd() {
    // 延迟重置，确保 drop 后的 click 被 justDraggedRef 拦截
    setTimeout(() => { justDraggedRef.current = false; }, 0);
    setDraggedId(null);
    setDragOverId(null);
  }

  async function removeWork() {
    if (!confirm(`确认删除作品「${work?.title || '未命名作品'}」？\n该作品下的 ${albums.length} 张照片与选片记录也会一并删除，不可恢复。`)) return;
    try {
      await http.delete('/api/works/' + id);
      clearDraft(id);
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

  // PC 端相册：按索引轮询分成 pcCols 列，视觉顺序从左到右 1.2.3 / 4.5.6，同时每列独立堆叠、无行内空白
  const zoneCols = useMemo(() => {
    const cols = Array.from({ length: pcCols }, () => []);
    zoneAlbums.forEach((_, i) => cols[i % pcCols].push(i));
    return cols;
  }, [zoneAlbums, pcCols]);
  function renderCard(idx) {
    const a = zoneAlbums[idx];
    const src = img(a.photo_url);
    const broken = brokenSet.has(a.id);
    const noUrl = !a.photo_url;
    return (
      <div
        key={a.id}
        draggable
        onDragStart={(e) => handleDragStart(e, a.id)}
        onDragOver={(e) => handleDragOver(e, a.id)}
        onDrop={(e) => handleDrop(e, a.id)}
        onDragEnd={handleDragEnd}
        onClick={() => openPreview(idx)}
        className={`group relative border overflow-hidden bg-ink cursor-grab active:cursor-grabbing select-none mb-3
          ${selected.has(a.id) ? 'border-brand ring-1 ring-brand' : dragOverId === a.id ? 'border-brand ring-2 ring-brand' : 'border-line'}
          ${draggedId === a.id ? 'opacity-40' : ''}`}
      >
        <div className="relative">
          {src && !broken ? (
            // 电脑端专项优化：按原始宽高比完整显示，不裁切、不变形（原为 aspect-square + object-cover 强制裁成 1:1）
            <img src={src} loading="lazy" decoding="async" onError={() => markBroken(a.id)} draggable={false} className="w-full h-auto object-contain bg-ink pointer-events-none select-none" alt="" title="单击预览大图" />
          ) : (
            // url 为空 / 裂图：灰色占位，杜绝空白框；文案区分原因
            <div className="w-full min-h-[120px] flex items-center justify-center bg-ink text-[11px] text-muted px-1 text-center leading-tight">
              {noUrl ? '无图片地址' : '图片加载失败'}
            </div>
          )}
        </div>
        {/* 选中遮罩 */}
        {selected.has(a.id) && <div className="absolute inset-0 bg-brand/10 pointer-events-none" />}
        {/* 操作层 */}
        <div className="absolute top-2 left-2">
          <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggleSelect(a.id)} onClick={(e) => e.stopPropagation()} className="w-4 h-4 accent-brand" />
        </div>
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {work.cover_url !== a.photo_url && (
            <button onClick={(e) => { e.stopPropagation(); setCover(a.photo_url); }} title="设为封面" className="px-2 py-1 rounded bg-black/60 text-white text-[10px]">封面</button>
          )}
          <button onClick={(e) => { e.stopPropagation(); deletePhoto(a.id); }} title="删除" className="px-2 py-1 rounded bg-red-500/80 text-white text-[10px]">删除</button>
        </div>
        <div
          className="absolute bottom-0 left-0 right-0 bg-black/50 px-2 py-1 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <span className="text-white text-[10px]">排序</span>
          <input type="number" defaultValue={a.sort} onBlur={(e) => updateSort(a.id, e.target.value)} className="w-12 px-1 py-0.5 rounded text-[10px] text-fg bg-white text-center" />
        </div>
      </div>
    );
  }

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
    const loadingText = '加载中…';
    if (isMobile) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center text-gray-400 text-sm bg-[#f7f7f7]">
          <span className="inline-block w-5 h-5 border-2 border-gray-300 border-t-[#FF7A8A] rounded-full animate-spin mb-2" />
          {loadingText}
        </div>
      );
    }
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

  if (isMobile) {
    if (mobilePanel === 'music') {
      return (
        <div className="min-h-screen bg-white flex flex-col">
          <div className="flex items-center px-3 py-3 bg-white border-b border-gray-100 sticky top-0 z-10">
            <button onClick={() => setMobilePanel(null)} className="p-1 text-gray-700"><ChevronLeft className="w-6 h-6" /></button>
            <span className="flex-1 text-center text-base text-gray-900">选择音乐</span>
            <span className="w-8" />
          </div>
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 text-sm p-6 text-center">
            <Music className="w-10 h-10 mb-3 text-gray-300" />
            <div>音乐库功能开发中</div>
            <div className="text-xs text-gray-400 mt-2">后续可在此为相册配置背景音乐</div>
          </div>
        </div>
      );
    }
    if (mobilePanel === 'settings') {
      return (
        <div className="min-h-screen bg-white flex flex-col">
          <div className="flex items-center px-3 py-3 bg-white border-b border-gray-100 sticky top-0 z-10">
            <button onClick={() => setMobilePanel(null)} className="p-1 text-gray-700"><ChevronLeft className="w-6 h-6" /></button>
            <span className="flex-1 text-center text-base text-gray-900">放映设置</span>
            <span className="w-8" />
          </div>
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 text-sm p-6 text-center">
            <PlayCircle className="w-10 h-10 mb-3 text-gray-300" />
            <div>放映设置功能开发中</div>
            <div className="text-xs text-gray-400 mt-2">后续可在此配置自动播放、切换效果等</div>
          </div>
        </div>
      );
    }
    if (mobilePanel === 'album') {
      const baseList = albums.filter((a) => a.zone === mobileZone);
      const albumList = pendingOrder
        ? baseList.sort((a, b) => { const ai = pendingOrder.indexOf(a.id); const bi = pendingOrder.indexOf(b.id); return (ai === -1 ? 9999 : ai) - (bi === -1 ? 9999 : bi); })
        : baseList.sort((a, b) => (a.sort - b.sort) || (a.id - b.id));
      const currentCoverUrl = pendingCoverUrl || work?.cover_url || '';
      const coverPhoto = albumList.find((a) => a.photo_url === currentCoverUrl) || albumList[0] || null;
      const gridList = albumList.filter((a) => a.id !== coverPhoto?.id);
      const pendingCount = pendingDeletes.size + (pendingCoverUrl ? 1 : 0) + (pendingOrder ? 1 : 0);
      return (
        <div className="min-h-screen bg-white flex flex-col">
          {/* 顶部导航：取消 + 修改图片 + 保存 */}
          <div className="flex items-center px-4 py-3 bg-white border-b border-gray-100 sticky top-0 z-10">
            <button onClick={() => { setPendingDeletes(new Set()); setPendingCoverUrl(null); setPendingOrder(null); setMobilePanel(null); }} className="text-sm text-gray-700 active:opacity-60">取消</button>
            <span className="flex-1 text-center text-base text-gray-900">修改图片</span>
            <button
              onClick={saveAlbumChanges}
              disabled={!pendingCount || reordering}
              className={'text-sm px-3 py-1.5 rounded-full disabled:opacity-40 ' + (pendingCount ? 'bg-[#FF7A8A] text-white' : 'bg-gray-100 text-gray-400')}
            >保存{pendingCount ? ` (${pendingCount})` : ''}</button>
          </div>
          {/* 上传类型 tab：上传图片 / 上传视频 */}
          <div className="flex bg-white border-b border-gray-100">
            {/* label+htmlFor 直连隐藏 file input：绕开 iOS Safari 对 ref.click() 的偶发拦截（与空态上传按钮同款做法） */}
            <label
              htmlFor="album-upload-input"
              className={'flex-1 py-3 text-sm text-center block cursor-pointer select-none ' + (albumUploadTab === 'image' ? 'text-[#FF7A8A] border-b-2 border-[#FF7A8A] -mb-px' : 'text-gray-500')}
            >上传图片</label>
            <button
              onClick={() => { setAlbumUploadTab('video'); alert('视频上传功能开发中'); }}
              className={'flex-1 py-3 text-sm ' + (albumUploadTab === 'video' ? 'text-[#FF7A8A] border-b-2 border-[#FF7A8A] -mb-px' : 'text-gray-500')}
            >上传视频</button>
          </div>
          {/* 内容区：大封面图 + 缩略图网格 + 底部提示 */}
          <div className="flex-1 overflow-y-auto bg-[#f7f7f7] pb-32">
            {/* 大封面图 */}
            <div className="relative bg-white mx-3 mt-3 rounded-lg overflow-hidden" style={{ aspectRatio: '16/10' }}>
              {coverPhoto ? (
                <img src={img(coverPhoto.photo_url)} alt="" className="w-full h-full object-cover" onError={() => markBroken(coverPhoto.id)} />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-gray-300 text-sm">暂无封面</div>
              )}
              <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded text-[10px] text-white bg-black/60">封面</span>
            </div>
            {/* 缩略图网格：3 列，左上角红圆 X 删除，长按拖拽排序 */}
            {gridList.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mx-3 mt-3">
                {gridList.map((a) => {
                  const marked = pendingDeletes.has(a.id);
                  const isDragging = draggingId === a.id;
                  const isDragOver = dragOverId === a.id;
                  return (
                    <div
                      key={a.id}
                      data-album-id={a.id}
                      onPointerDown={(e) => onThumbPointerDown(e, a.id)}
                      onPointerMove={onThumbPointerMove}
                      onPointerUp={onThumbPointerUp}
                      onPointerCancel={onThumbPointerUp}
                      onClick={() => { if (justDraggedRef.current) return; if (!marked) setPendingCoverUrl(a.photo_url); }}
                      className={'relative rounded-lg overflow-hidden bg-gray-100 ' + (marked ? 'opacity-40 ' : '') + (isDragging ? 'opacity-50 ring-2 ring-[#FF7A8A] ' : '') + (isDragOver ? 'ring-2 ring-[#FF7A8A]/50 ' : '') + (!marked && !isDragging ? 'active:opacity-80' : '')}
                      style={{ aspectRatio: '1', touchAction: 'none' }}
                    >
                      <img src={img(a.photo_url)} alt="" loading="lazy" className="w-full h-full object-cover pointer-events-none" onError={() => markBroken(a.id)} />
                      {!marked && (
                        <button
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); setPendingDeletes((s) => { const n = new Set(s); n.add(a.id); return n; }); }}
                          className="absolute top-1 left-1 w-5 h-5 rounded-full bg-[#FF7A8A] flex items-center justify-center text-white text-[10px] leading-none z-10"
                          aria-label="删除"
                        >✕</button>
                      )}
                      {isDragging && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30 pointer-events-none">
                          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" /></svg>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {/* 底部提示 */}
            <div className="text-center text-xs text-gray-400 mt-4">轻触设为封面，长按拖动排序</div>
          </div>
          {/* 底部保存按钮（fixed 浮动） */}
          <div className="fixed left-0 right-0 bottom-0 bg-white border-t border-gray-100 px-4 py-3 flex justify-center" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
            <button
              onClick={saveAlbumChanges}
              disabled={!pendingCount || reordering}
              className={'px-10 py-2 rounded-full border ' + (pendingCount ? 'border-[#FF7A8A] text-[#FF7A8A] active:bg-[#FF7A8A]/10' : 'border-gray-200 text-gray-300')}
            >保存修改{pendingCount ? ` (${pendingCount})` : ''}</button>
          </div>
          <input id="album-upload-input" ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={onPickFiles} />
          {/* 移动端共用上传预览/进度弹窗（此前仅桌面端渲染，移动端选图后无反馈） */}
          <UploadModal
            open={uploadOpen}
            zoneLabel={ZONES.find((z) => z.key === zone).label}
            previews={uploadPreviews}
            rows={uploadRows}
            uploading={uploading}
            paused={paused}
            weakNet={weakNet}
            warming={warming}
            overallPct={overallPct}
            onClose={closeUpload}
            onCancel={cancelUpload}
            onTogglePause={togglePause}
            onConfirm={confirmUpload}
            onRetry={retryOne}
            onDismissWeakNet={() => setWeakNet(false)}
          />
        </div>
      );
    }

    const sampleFirst = albums.find((a) => a.zone === 'sample');
    const coverSrc = work?.cover_url || (sampleFirst ? img(sampleFirst.photo_url) : '');
    return (
      <div className="min-h-screen bg-[#f7f7f7] flex flex-col">
        <div className="flex items-center px-3 py-2 bg-white border-b border-gray-100 sticky top-0 z-10">
          <button onClick={handleBack} className="flex items-center text-gray-700 shrink-0" style={{ background: 'none', border: 'none', padding: 0 }}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
            <span className="text-sm ml-1">返回</span>
          </button>
          <span className="flex-1 text-center text-base text-gray-900">编辑客片</span>
          <button onClick={saveBasic} disabled={saving} className="text-sm px-3 py-1.5 rounded-full bg-[#FF7A8A] text-white disabled:opacity-50 shrink-0">{saving ? '保存中…' : (isNew ? '保存并创建' : '保存')}</button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="relative w-full bg-gray-200" style={{ aspectRatio: '3/4', maxHeight: '70vh' }}>
            {coverSrc ? (
              <img src={coverSrc} alt="" className="w-full h-full object-cover" onError={(e) => { e.target.style.display = 'none'; }} />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">暂无封面</div>
            )}
            <button onClick={() => setMobilePanel('album')} className="absolute top-3 left-3 px-2.5 py-1.5 rounded text-xs" style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}>更换封面</button>
            <div className="absolute bottom-10 left-4 right-4">
              <div className="border-2 border-dashed border-white/80 rounded-lg px-3 py-2.5 bg-black/25 backdrop-blur-sm">
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="输入标题"
                  className="w-full bg-transparent text-white text-lg outline-none placeholder-white/60"
                  style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}
                />
              </div>
            </div>
          </div>

          <div className="bg-white px-4 py-3">
            <textarea
              ref={albumCopyRef}
              value={form.album_copy}
              onChange={(e) => setForm({ ...form, album_copy: e.target.value })}
              placeholder="输入文案"
              rows={1}
              className="w-full text-sm text-gray-700 placeholder-gray-400 outline-none resize-none overflow-hidden leading-relaxed"
              style={{ minHeight: '24px' }}
            />
          </div>

          {/* 已上传照片预览 — 主页尾部无限浏览，按样片/原片/成片三区分组 */}
          {albums.length > 0 ? (
            <div className="bg-white px-4 py-4 border-t border-gray-100">
              {ZONES.map((z) => {
                const zonePhotos = albums.filter((a) => a.zone === z.key).sort((a, b) => (a.sort - b.sort) || (a.id - b.id));
                if (!zonePhotos.length) return null;
                return (
                  <div key={z.key} className="mb-6 last:mb-0">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-gray-500 font-medium">{z.label} <span className="text-gray-400">({zonePhotos.length})</span></span>
                      <button
                        onClick={() => { setMobileZone(z.key); setZone(z.key); setSelected(new Set()); setMobilePanel('album'); }}
                        className="text-xs text-[#7ecdbb] active:opacity-70"
                      >管理</button>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {zonePhotos.map((a, i) => (
                        <div
                          key={a.id}
                          onClick={() => openZonePreview(z.key, i)}
                          className="aspect-square relative rounded-lg overflow-hidden bg-gray-100 cursor-pointer active:opacity-80"
                        >
                          <img src={img(a.photo_url)} alt="" className="w-full h-full object-cover" loading="lazy" />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-white px-4 py-8 border-t border-gray-100">
              <div className="flex flex-col items-center justify-center text-center">
                <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#bbb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="9" cy="9" r="2" />
                    <path d="M21 15l-5-5L5 21" />
                  </svg>
                </div>
                <p className="text-sm text-gray-400 mb-4">
                  {pendingPhotos.length ? `已暂存 ${pendingPhotos.length} 张照片，保存后入库` : '还没有上传照片，添加第一张客片吧'}
                </p>
                {/* 用 label 包裹 file input，业内移动端标准做法，绕开 iOS Safari 对 ref.click() 的偶发拦截。*/}
                <label className={'px-8 py-2.5 rounded-full text-white text-sm font-medium cursor-pointer select-none active:opacity-80 bg-[#FF7A8A]' + (uploading || preparing ? ' opacity-60' : '')}>
                  {uploading ? '上传中…' : preparing ? '准备中…' : '+ 上传照片'}
                  <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={onPickFiles} />
                </label>
                {isNew && pendingPhotos.length > 0 && (
                  <div className="mt-4 w-full max-w-xs">
                    <div className="grid grid-cols-4 gap-1.5">
                      {pendingPhotos.map((p, i) => (
                        <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-gray-100 group">
                          <img src={p.url} alt="" className="w-full h-full object-cover" />
                          <button
                            onClick={() => setPendingPhotos((arr) => arr.filter((_, j) => j !== i))}
                            aria-label="移除暂存"
                            className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white text-[10px] flex items-center justify-center active:scale-95"
                          >✕</button>
                        </div>
                      ))}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-2 text-center">预览缩略图仅显示在当前会话，保存后即入库</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        {/* 移动端共用上传预览/进度弹窗（此前仅桌面端渲染，移动端选图后无反馈） */}
        <UploadModal
          open={uploadOpen}
          zoneLabel={ZONES.find((z) => z.key === zone).label}
          previews={uploadPreviews}
          rows={uploadRows}
          uploading={uploading}
          paused={paused}
          weakNet={weakNet}
          warming={warming}
          overallPct={overallPct}
          onClose={closeUpload}
          onCancel={cancelUpload}
          onTogglePause={togglePause}
          onConfirm={confirmUpload}
          onRetry={retryOne}
          onDismissWeakNet={() => setWeakNet(false)}
        />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* 顶部导航：返回 + 标题 + 删除 */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button onClick={handleBack} className="px-3 py-1.5 rounded border border-line text-sm text-muted hover:text-brand hover:border-brand shrink-0">← 返回作品列表</button>
          <h1 className="text-lg sm:text-xl text-fg truncate min-w-0">{isNew ? '新建作品' : (work?.title || '未命名作品')}</h1>
          {!isNew && <span className="text-xs px-2 py-0.5 rounded bg-panel border border-line text-muted shrink-0">{work.is_public ? '公开' : '私密'}</span>}
        </div>
        {!isNew && <button onClick={removeWork} className="px-3 py-1.5 rounded border border-red-200 text-red-500 text-sm hover:bg-red-50 shrink-0">删除作品</button>}
      </div>

      <div className="grid lg:grid-cols-5 gap-5">
        {/* 左侧：手机真机预览（参考图：与真机预览一致） */}
        <div className="lg:col-span-2">
          <div className="bg-panel border border-line rounded-xl2 p-5">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
              <div className="flex items-center gap-2">
                <button onClick={onUploadClick} disabled={uploading || preparing} className="px-3 py-1.5 rounded bg-brand text-white text-xs hover:opacity-90 disabled:opacity-50">+ 添加照片{isNew && pendingPhotos.length ? ` (${pendingPhotos.length})` : ''}</button>
                <span className="text-xs text-muted">{albums.length}/{albums.length}</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={openSlide} disabled={!zoneAlbums.length} className="px-3 py-1.5 rounded border border-line text-xs text-muted hover:text-brand disabled:opacity-40">排序</button>
                <button className="px-3 py-1.5 rounded border border-line text-xs text-muted hover:text-brand">水印设置</button>
              </div>
            </div>

            {/* 手机外壳 */}
            <div className="mx-auto rounded-[28px] border-8 border-[#222] bg-white overflow-hidden" style={{ maxWidth: 300, width: isMobile ? '82%' : undefined, aspectRatio: '9/18' }}>
              {/* 顶部状态栏 */}
              <div className="flex items-center justify-center pt-2 pb-1">
                <div className="w-20 h-4 rounded-full bg-[#222]" />
              </div>
              {/* 封面 / 首图 */}
              <div className="relative h-40 bg-black">
                {zoneAlbums[0]
                  ? <img src={img(zoneAlbums[0].photo_url)} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-white/60 text-xs">暂无照片</div>}
              </div>
              {/* 标题 + 创建时间（点击编辑标题） */}
              <div className="px-4 pt-3">
                <div className="text-base text-fg truncate cursor-pointer" title="点击编辑标题" onClick={() => setPanelTab('basic')}>
                  {form.title || '点击编辑标题'}
                </div>
                <div className="text-[11px] text-muted mt-0.5">创建于 {(work && work.created_at ? new Date(work.created_at).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }) : new Date().toLocaleDateString('zh-CN'))}</div>
              </div>
              {/* 描述 + 清除/自动生成 */}
              <div className="px-4 py-3">
                <div className="text-xs text-muted leading-relaxed line-clamp-4 min-h-[56px]">{form.album_copy || '和你一起旅行拍照。这句话里，有我最想做的三件事…'}</div>
                <div className="flex items-center gap-2 mt-2">
                  <button type="button" onClick={() => setForm({ ...form, album_copy: '' })} className="text-[11px] text-muted hover:text-brand">清除</button>
                  <button type="button" onClick={() => setForm({ ...form, album_copy: '和你一起旅行拍照。这句话里，有我最想做的三件事…' })} className="text-[11px] text-brand">自动生成</button>
                </div>
              </div>
              {/* 照片九宫格 */}
              <div className="px-4 grid grid-cols-3 gap-1">
                {zoneAlbums.slice(0, 6).map((p) => (
                  <div key={p.id} className="aspect-square bg-panel overflow-hidden">
                    <img src={img(p.photo_url)} alt="" className="w-full h-full object-cover" />
                  </div>
                ))}
                {zoneAlbums.length === 0 && (
                  <div className="col-span-3 h-24 border border-dashed border-line rounded flex items-center justify-center text-xs text-muted">添加照片后在此预览</div>
                )}
              </div>
              {/* 添加视频 */}
              <button className="mx-4 mt-3 mb-4 w-[calc(100%-32px)] py-2 rounded-lg border border-dashed border-line text-xs text-muted hover:text-brand">+ 添加视频</button>
              {/* 底部绑定/客服（参考图悬浮按钮） */}
              <div className="flex items-center justify-center gap-3 pb-4">
                <span className="text-[10px] text-muted">绑定</span>
                <span className="text-[10px] text-muted">客服</span>
              </div>
            </div>
          </div>
        </div>

        {/* 右侧：Tab 编辑面板 */}
        <div className="lg:col-span-3">
          <div className="flex items-center gap-1 mb-4" style={{ borderBottom: '1px solid #eee' }}>
            <button onClick={() => setPanelTab('basic')}
              style={{ padding: '10px 18px', fontSize: 14, border: 'none', background: 'none', cursor: 'pointer', color: panelTab === 'basic' ? '#2998EB' : '#666666', borderBottom: panelTab === 'basic' ? '2px solid #2998EB' : '2px solid transparent' }}>基本信息</button>
            <button onClick={() => setPanelTab('album')}
              style={{ padding: '10px 18px', fontSize: 14, border: 'none', background: 'none', cursor: 'pointer', color: panelTab === 'album' ? '#2998EB' : '#666666', borderBottom: panelTab === 'album' ? '2px solid #2998EB' : '2px solid transparent' }}>相册管理</button>
          </div>
          {panelTab === 'basic' && (
        <div className="space-y-5">
          <form onSubmit={saveBasic} className="bg-panel border border-line rounded-xl2 p-5">
            <h2 className="text-base text-fg mb-4">基本信息</h2>
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
                    {cats.filter(Boolean).map((c) => {
                      const on = form.category_ids.map(String).includes(String(c.id));
                      return (
                        <button type="button" key={c.id}
                          onClick={() => setForm((f) => {
                            const set = new Set(f.category_ids.map(String));
                            if (set.has(String(c.id))) set.delete(String(c.id)); else set.add(String(c.id));
                            return { ...f, category_ids: Array.from(set) };
                          })}
                          className={'px-3 py-1.5 rounded-full text-sm border transition ' + (on ? 'bg-brand text-white border-brand' : 'bg-ink border-line text-muted hover:border-brand')}>
                          {c.name || '未命名'}
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
                <div className="text-xs text-fg mb-3">相册交付设置（客户访问相册）</div>
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
                    <div className="text-[11px] text-muted mt-1">{(work && work.album_password_set) ? '已设置密码 · 留空则保持当前密码' : '尚未设置密码 · 保存前请先录入'}</div>
                  </div>
                )}
                <div className="mt-3">
                  <label className="block text-xs text-muted mb-1">相册有效期（可选，留空则永久有效）</label>
                  <input type="date" value={form.album_expires_at} onChange={(e) => setForm({ ...form, album_expires_at: e.target.value })}
                    className="w-full px-3 py-2 rounded bg-ink border border-line text-fg text-sm outline-none" />
                </div>
              </div>
            </div>
            <button type="submit" disabled={saving} className="mt-5 w-full px-4 py-2 rounded bg-brand text-white text-sm hover:opacity-90 disabled:opacity-60">{saving ? '保存中…' : (isNew ? '保存并创建作品' : '保存基本信息')}</button>
          </form>

          {work?.cover_url && (
            <div className="bg-panel border border-line rounded-xl2 p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base text-fg">当前封面</h2>
                <button onClick={openCoverCrop} className="text-xs text-brand hover:underline">点击自定义裁剪</button>
              </div>
              <div className="relative cursor-pointer group" onClick={openCoverCrop}>
                <img src={img(work.cover_url)} loading="lazy" decoding="async" className="w-full h-40 object-cover rounded bg-ink" alt="封面" />
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors rounded">
                  <span className="text-white text-xs opacity-0 group-hover:opacity-100">点击裁剪封面</span>
                </div>
              </div>
            </div>
          )}
        </div>
          )}
          {panelTab === 'album' && (
        <div>
          <div ref={uploadAreaRef} className="bg-panel border border-line rounded-xl2 p-5 min-h-[500px]">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <div>
                <h2 className="text-base text-fg">相册管理</h2>
                <p className="text-xs text-muted mt-0.5">共 {albums.length} 张照片 · 当前分区 {zoneAlbums.length} 张</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={openSlide} disabled={!zoneAlbums.length} className="px-4 py-2 rounded border border-line text-sm text-fg hover:text-brand hover:border-brand disabled:opacity-40">▶ 播放幻灯片</button>
                <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={onPickFiles} />
                <button onClick={onUploadClick} disabled={uploading || preparing} className="px-4 py-2 rounded bg-brand text-white text-sm hover:opacity-90 disabled:opacity-60">{uploading ? `上传中 ${overallPct}%` : preparing ? '准备中…' : (isNew && pendingPhotos.length ? `+ 批量上传 (${pendingPhotos.length})` : '+ 批量上传')}</button>
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
                  className={'px-4 py-2 rounded-t text-sm ' + (zone === z.key ? 'text-brand border-b-2 border-brand' : 'text-muted hover:text-fg')}>
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
              <div className={`flex gap-3 items-start ${reordering ? 'opacity-60' : ''}`}>
                {zoneCols.map((col, ci) => (
                  <div key={ci} className="flex-1 min-w-0 flex flex-col">
                    {col.map((idx) => renderCard(idx))}
                  </div>
                ))}
              </div>
            )}
            {zoneAlbums.length > 1 && (
              <div className="text-xs text-muted mt-3">💡 提示：单击照片可预览大图（预览中用 ← → 或两侧按钮切换）；可用鼠标拖动照片自定义排序，也可在照片底部输入排序号。</div>
            )}
          </div>
        </div>
        )}
        </div>
      </div>
      {/* 上传预览弹窗：选图后展示缩略图，所有照片（含重复）均可上传（移动/桌面共用） */}
      <UploadModal
        open={uploadOpen}
        zoneLabel={ZONES.find((z) => z.key === zone).label}
        previews={uploadPreviews}
        rows={uploadRows}
        uploading={uploading}
        paused={paused}
        weakNet={weakNet}
        warming={warming}
        overallPct={overallPct}
        onClose={closeUpload}
        onCancel={cancelUpload}
        onTogglePause={togglePause}
        onConfirm={confirmUpload}
        onRetry={retryOne}
        onDismissWeakNet={() => setWeakNet(false)}
      />
      <Slideshow photos={slidePhotos} open={slideOpen} onClose={closeSlide} title={work ? work.title : ''} />

      {/* 单张大图预览 */}
      <Lightbox
        photos={zoneAlbums.map((a) => img(a.photo_url))}
        index={previewIndex}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title={work ? work.title : ''}
      />

      {/* 封面自定义裁剪：选择图片阶段 */}
      {coverCrop.open && !coverCrop.file && (
        <div className="fixed inset-0 z-[120] bg-black/70 flex items-center justify-center p-4" onClick={() => !coverCrop.uploading && setCoverCrop((c) => ({ ...c, open: false }))}>
          <div className="bg-panel border border-line rounded-xl2 p-5 w-[420px] max-w-[94vw] max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <div className="text-fg">设置作品封面</div>
              <button onClick={() => setCoverCrop((c) => ({ ...c, open: false }))} className="text-muted hover:text-fg text-xl leading-none px-1">×</button>
            </div>
            <p className="text-xs text-muted mb-3">可从已上传照片中直接选用（复用已有图片，不重新上传），或上传新图片裁剪</p>

            {/* 从已上传照片选择：直接复用 photo_url 设为封面，避免裁剪后再上传导致图片丢失 */}
            {zoneAlbums.length > 0 && (
              <div className="mb-4">
                <div className="text-xs text-muted mb-2">从已上传照片中选择</div>
                <div className="grid grid-cols-4 gap-2">
                  {zoneAlbums.map((a) => {
                    const isCover = !!(work?.cover_url && a.photo_url && work.cover_url === a.photo_url);
                    return (
                      <button key={a.id}
                        onClick={async () => { await setCover(a.photo_url); setCoverCrop((c) => ({ ...c, open: false })); }}
                        className={`relative aspect-square rounded overflow-hidden border ${isCover ? 'border-brand ring-1 ring-brand' : 'border-line hover:border-brand'}`}>
                        <img src={img(a.photo_url)} alt="" className="w-full h-full object-cover bg-ink" />
                        {isCover && <span className="absolute bottom-0 left-0 right-0 text-center text-[9px] text-white bg-brand/80 py-0.5">当前</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="border-t border-line pt-3">
              <div className="text-xs text-muted mb-2">上传新图片并裁剪</div>
              <div className="flex gap-2 mb-3 flex-wrap">
                {[
                  { label: '自由', v: null },
                  { label: '1:1', v: 1 },
                  { label: '4:3', v: 4 / 3 },
                  { label: '7:5', v: 7 / 5 },
                  { label: '3:2', v: 3 / 2 },
                  { label: '16:9', v: 16 / 9 }
                ].map((r) => (
                  <button key={r.label} onClick={() => setCoverCrop((c) => ({ ...c, aspect: r.v }))}
                    className={`px-3 py-1.5 rounded border text-sm ${coverCrop.aspect === r.v ? 'border-brand text-brand bg-brand/10' : 'border-line text-muted hover:text-fg'}`}>{r.label}</button>
                ))}
              </div>
              {work?.cover_url && (
                <button onClick={cropCurrentCover} disabled={coverCrop.uploading}
                  className="w-full mb-3 px-4 py-3 rounded border border-line text-sm text-fg hover:border-brand hover:text-brand disabled:opacity-50 flex items-center justify-center gap-2">
                  <img src={img(work.cover_url)} alt="" className="w-8 h-8 object-cover rounded bg-ink" />
                  <span>裁切当前封面</span>
                </button>
              )}
              <label className="block">
                <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) setCoverCrop((c) => ({ ...c, file: f })); }} />
                <div className="border-2 border-dashed border-line rounded-xl2 py-8 text-center text-muted cursor-pointer hover:border-brand hover:text-brand text-sm">＋ 选择本地新图片</div>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* 封面自定义裁剪：裁剪阶段（ImageCropper 自带全屏遮罩） */}
      {coverCrop.open && coverCrop.file && (
        <ImageCropper
          file={coverCrop.file}
          aspectRatio={coverCrop.aspect}
          onCancel={() => setCoverCrop((c) => ({ ...c, file: null }))}
          onConfirm={(f) => doCoverCrop(f)}
          title="裁剪封面"
        />
      )}
    </div>
  );
}
