import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import http, { img, uploadImage, uploadBatch } from '../api.js';
import CropperModal from '../components/CropperModal.jsx';

// dataURL → File（裁切结果保存时上传用）
function dataURLtoFile(dataUrl, name = 'cover.jpg') {
  const [meta, b64] = dataUrl.split(',');
  const mime = (meta.match(/:(.*?);/) || [])[1] || 'image/jpeg';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new File([arr], name, { type: mime });
}

/* ==========================================================================
   套系编辑页面（后台管理 → 工作台 > 套系 > 套系编辑）
   —— 4 个 Tab：套系名称 / 价格及问卷 / 服务及加片 / 其他详情
   —— 全局共用：页面底 #ffffff；外层白卡 max-w 840px / 圆角 8px / 阴影 0 1px 4px；
   —— 统一 Tab 方框选中样式；input/select max-w 420px；浅黄模块 #FDFCEB；底部下一步/取消/保存
   —— 真实上传：封面 / 详情图(0-80) / 视频；管理分类弹窗（新建/选择）
   —— 数据全部接口驱动：GET /api/packages/:id / POST /api/packages / PUT /api/packages/:id
   —— 不写死任何分类 / 货币 / 标签来源；新字段聚合在 details JSON，旧列仍兼容。
   —— 仅改 UI 视觉，业务字段 / 接口 / 保存逻辑全部保留。
   ========================================================================== */

const LINK = '#2196F3';          // 蓝色文字链接（管理分类/编辑/点击上传视频/下一步）
const SAVE_BTN = '#3488EB';      // 保存按钮蓝色
const TOGGLE_ON = '#34C759';     // 开关开启绿色
const PAGE_BG = '#f7f9fc';
const YELLOW_BORDER = '#D1D5DB'; // 浅黄色模块虚线边框
const TAB_BORDER = '#E5E7EB';    // Tab 未选中边框
const TAB_ACTIVE_BORDER = '#333333';
const RED = '#E53E3E';           // 必填红色星号 / 红色注释
const NOTE = '#888888';          // 辅助说明灰色文字
const INPUT_BORDER = '#D1D5DB';  // 输入框 / 下拉边框
const PLACEHOLDER = '#9CA3AF';
const LIGHT_BLUE = '#e6f3ff';    // 选中浅蓝底

const PRESET_TAGS = ['婚纱类', '亲子类', '写真类', '旅拍类', '情侣类', '婚礼类', '创意类', '其他', '新生儿', '婚礼策划', '美妆'];
const SVC_PARAMS = ['单规格服务', '多规格服务'];
const REFUND_OPTS = ['严格', '中等', '宽松'];
const DURATION_OPTS = ['全天', '半天', '指定时长'];
const LOCATION_OPTS = ['海口', '三亚', '北京', '上海', '广州', '深圳', '杭州', '成都'];

function defaultDetails() {
  return {
    detail_images: [],
    video_url: '',
    service_params: '单规格服务',
    hide_price: false,
    hide_deposit: false,
    deposit_is_full: false,
    show_currency: true,
    refund_policy: '严格',
    hide_refund: false,
    raw_storage: '',
    prepay_enabled: false,
    questionnaire_visibility: 'none',
    questionnaire_verify_phone: false,
    questionnaire: [],
    shoot_template: 'photo',
    duration: '全天',
    raw_count: '',
    raw_all_included: false,
    retouch_count: '',
    extra_photo_fee: '',
    extra_photo_discount: '',
    cloth_provide: 'not',
    makeup_provide: 'not',
    album_provide: 'not',
    service_location: '',
    show_service_content: true,
    service_detail_text: '',
    public_all_visible: false,
    public_visible: '全部可见',
    consult_reminder: false,
    warm_tips: '',
    tags: [],
    customer_agreement: ''
  };
}

function emptyForm() {
  return {
    id: null, name: '', category_id: '', cover_url: '', description: '',
    price: '', deposit: '', status: 'on',
    addons: [], marketing: {}, specs: [],
    details: defaultDetails()
  };
}

// 内联 SVG 图标
const IconPlus = (p) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 5v14M5 12h14" /></svg>
);
const IconClose = (p) => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M18 6 6 18M6 6l12 12" /></svg>
);
const IconHelp = (p) => (
  <span {...p} className="inline-flex w-4 h-4 items-center justify-center rounded-full text-[10px] cursor-default select-none"
    style={{ background: '#f0f2f5', color: '#888888', border: '1px solid #e2e5ea' }}>?</span>
);

// 必填开关（开启绿色 #34C759，关闭灰色 #D1D5DB）
function Switch({ checked, onChange, disabled }) {
  return (
    <button type="button" disabled={disabled} onClick={() => onChange(!checked)}
      className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0"
      style={{ background: checked ? TOGGLE_ON : '#D1D5DB', opacity: disabled ? 0.5 : 1 }}>
      <span className="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform"
        style={{ transform: checked ? 'translateX(18px)' : 'translateX(2px)' }} />
    </button>
  );
}

// 复选框（方形）
function Checkbox({ checked, onChange, label }) {
  return (
    <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer select-none" style={{ color: '#6b7280' }}>
      <button type="button" onClick={() => onChange(!checked)}
        className="w-4 h-4 rounded-sm border flex items-center justify-center shrink-0"
        style={{ borderColor: checked ? LINK : '#c4c8cf', background: checked ? LINK : '#fff' }}>
        {checked && <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4 10-10" /></svg>}
      </button>
      {label}
    </label>
  );
}

// 单选按钮组（horizontal：边框胶囊 / vertical：圆点）
function RadioGroup({ value, onChange, options, vertical }) {
  if (vertical) {
    return (
      <div className="flex flex-col gap-5">
        {options.map((o) => (
          <button key={o.v} type="button" onClick={() => onChange(o.v)}
            className="flex items-center gap-2 text-sm transition-colors" style={{ color: value === o.v ? LINK : '#6b7280' }}>
            <span className="w-4 h-4 rounded-full border flex items-center justify-center shrink-0"
              style={{ borderColor: value === o.v ? LINK : '#c4c8cf' }}>
              {value === o.v && <span className="w-2 h-2 rounded-full" style={{ background: LINK }} />}
            </span>
            {o.t}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-6 flex-wrap">
      {options.map((o) => (
        <button key={o.v} type="button" onClick={() => onChange(o.v)}
          className="px-4 py-1.5 rounded text-sm border transition-colors"
          style={{ borderColor: value === o.v ? LINK : TAB_BORDER, color: value === o.v ? LINK : '#6b7280', background: value === o.v ? LIGHT_BLUE : '#fff' }}>
          {o.t}
        </button>
      ))}
    </div>
  );
}

// 字段外壳：标签在上方 + 必填星号（margin-right 6px）+ 提示
function Field({ label, required, hint, children }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-2.5 text-sm" style={{ color: '#333333' }}>
        <span>{label}</span>
        {required && <span style={{ color: RED, marginRight: 6 }}>*</span>}
        {hint && <span className="text-xs" style={{ color: NOTE }}>{hint}</span>}
      </div>
      <div>{children}</div>
    </div>
  );
}

const inputCls = "w-full max-w-[420px] h-9 px-3 rounded bg-white border border-[#D1D5DB] text-sm text-[#333333] placeholder:text-[#9CA3AF] outline-none focus:border-[#2196F3]";
const selCls = "max-w-[420px] h-9 px-3 rounded bg-white border border-[#D1D5DB] text-sm text-[#333333] placeholder:text-[#9CA3AF] outline-none focus:border-[#2196F3]";
const selSmCls = "max-w-[420px] h-[34px] px-3 rounded bg-white border border-[#D1D5DB] text-sm text-[#333333] placeholder:text-[#9CA3AF] outline-none focus:border-[#2196F3]";
const inputSm = "w-full max-w-[260px] h-[34px] px-3 rounded bg-white border border-[#D1D5DB] text-sm text-[#333333] placeholder:text-[#9CA3AF] outline-none focus:border-[#2196F3]";
const selSm = "max-w-[260px] h-[34px] px-3 rounded bg-white border border-[#D1D5DB] text-sm text-[#333333] placeholder:text-[#9CA3AF] outline-none focus:border-[#2196F3]";
const textareaCls = "w-full max-w-[420px] px-3 py-3 rounded bg-white border border-[#D1D5DB] text-sm text-[#333333] placeholder:text-[#9CA3AF] outline-none focus:border-[#2196F3]";
const textareaFull = "w-full px-3 py-3 rounded bg-white border border-[#D1D5DB] text-[13px] text-[#333333] placeholder:text-[#9CA3AF] outline-none focus:border-[#2196F3]";
const taBig = "w-full px-3 py-3 rounded bg-white border border-[#D1D5DB] text-[13px] text-[#333333] placeholder:text-[#9CA3AF] outline-none focus:border-[#2196F3]";
// 拉宽到卡片右侧边界：与 inputCls 一致，仅去掉 max-w 限制（高度/字号/边框/圆角不变）
const inputFull = "w-full h-9 px-3 rounded bg-white border border-[#D1D5DB] text-sm text-[#333333] placeholder:text-[#9CA3AF] outline-none focus:border-[#2196F3]";
const selFull = "flex-1 max-w-none h-9 px-3 rounded bg-white border border-[#D1D5DB] text-sm text-[#333333] placeholder:text-[#9CA3AF] outline-none focus:border-[#2196F3]";
const textareaWide = "w-full px-3 py-3 rounded bg-white border border-[#D1D5DB] text-sm text-[#333333] placeholder:text-[#9CA3AF] outline-none focus:border-[#2196F3]";

export default function PackageEdit() {
  const nav = useNavigate();
  const { id } = useParams();
  const isEdit = !!id;

  // 移动端响应式：<768px 时收缩内边距/列数/固定宽度
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 768 : false);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const [form, setForm] = useState(emptyForm());
  const [tab, setTab] = useState(0);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState([]);
  const [uploading, setUploading] = '';
  const [catOpen, setCatOpen] = useState(false);
  // 内联编辑开关（文本展示 + 编辑链接）
  const [editRaw, setEditRaw] = useState(false);
  const [editDisc, setEditDisc] = useState(false);
  const [editAgr, setEditAgr] = useState(false);
  // 套系封面裁切：选中图存 cropSrc 唤起弹窗；裁切结果存 coverPending（仅保存时上传）
  const [coverPending, setCoverPending] = useState(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [cropSrc, setCropSrc] = useState(null);
  const coverInputRef = useRef(null);

  const setD = (patch) => setForm((f) => ({ ...f, details: { ...f.details, ...patch } }));
  const setF = (patch) => setForm((f) => ({ ...f, ...patch }));

  const loadCategories = () =>
    http.get('/api/categories').then((r) => setCategories(r.data || [])).catch(() => {});

  useEffect(() => {
    loadCategories();
    if (id) {
      setLoading(true);
      http.get('/api/packages/' + id).then((r) => {
        const p = r.data || {};
        const d = { ...defaultDetails(), ...(p.details && typeof p.details === 'object' ? p.details : {}) };
        setForm({
          id: p.id, name: p.name || '', category_id: p.category_id || '', cover_url: p.cover_url || '',
          description: p.description || '', price: p.price ?? '', deposit: p.deposit ?? '',
          status: p.status || 'on', addons: Array.isArray(p.addons) ? p.addons : [],
          marketing: p.marketing || {}, specs: Array.isArray(p.specs) ? p.specs : [],
          details: d
        });
      }).catch(() => {}).finally(() => setLoading(false));
    }
    // eslint-disable-next-line
  }, [id]);

  // ---- 上传 ----
  // 选图：仅做格式/大小校验并唤起裁切弹窗，不直接上传后端
  const onCoverSelect = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
    if (!OK_TYPES.includes(file.type)) { alert('仅支持 jpg / png / jpeg / webp 格式'); return; }
    if (file.size > 3 * 1024 * 1024) { alert('图片大小不能超过 3MB'); return; }
    const reader = new FileReader();
    reader.onload = () => { setCropSrc(reader.result); setCropOpen(true); };
    reader.readAsDataURL(file);
  };
  const handleCropConfirm = (dataUrl) => { setCoverPending(dataUrl); setCropOpen(false); setCropSrc(null); };
  const handleCropCancel = () => { setCropOpen(false); setCropSrc(null); };
  const clearCover = () => { setCoverPending(null); setF({ cover_url: '' }); };
  const onDetailImages = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    const remain = 80 - form.details.detail_images.length;
    if (remain <= 0) { alert('详情图片已达上限 80 张'); return; }
    setUploading('images');
    try {
      const { urls } = await uploadBatch(files.slice(0, remain), { category: 'set', isPublic: true });
      setD({ detail_images: [...form.details.detail_images, ...urls] });
    } catch (err) { alert('详情图上传失败：' + (err.message || err)); }
    finally { setUploading(''); }
  };
  const onVideo = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setUploading('video');
    try {
      const r = await uploadImage(file, { category: 'set', isPublic: true });
      setD({ video_url: r.url });
    } catch (err) { alert('视频上传失败：' + (err.message || err)); }
    finally { setUploading(''); }
  };

  const removeDetailImage = (i) =>
    setD({ detail_images: form.details.detail_images.filter((_, j) => j !== i) });

  // ---- 标签 ----
  const [tagInput, setTagInput] = useState('');
  const addTag = (v) => {
    const val = (v !== undefined ? v : tagInput).trim();
    if (val && !form.details.tags.includes(val)) setD({ tags: [...form.details.tags, val] });
    setTagInput('');
  };
  const removeTag = (t) => setD({ tags: form.details.tags.filter((x) => x !== t) });

  // ---- 管理分类弹窗 ----
  const [catName, setCatName] = useState('');
  const addCategory = async () => {
    const name = catName.trim();
    if (!name) return;
    try {
      const r = await http.post('/api/categories', { name, kind: 'work' });
      await loadCategories();
      setForm((f) => ({ ...f, category_id: r.data.id }));
      setCatName('');
    } catch (err) { alert('分类创建失败：' + (err.response?.data?.error || err.message || err)); }
  };

  // ---- 验证 ----
  const REQUIRED = [
    { k: 'cover_url', label: '套系封面', tabs: [0] },
    { k: 'name', label: '套系名称', tabs: [0] },
    { k: 'category_id', label: '套系分类', tabs: [0] },
    { k: 'service_params', label: '服务参数', tabs: [1], d: true },
    { k: 'price', label: '价格', tabs: [1] },
    { k: 'deposit', label: '定金', tabs: [1] },
    { k: 'refund_policy', label: '退订政策', tabs: [1], d: true },
    { k: 'duration', label: '拍摄时长', tabs: [2], d: true },
    { k: 'raw_count', label: '底片数量', tabs: [2], d: true },
    { k: 'retouch_count', label: '精修片', tabs: [2], d: true }
  ];
  const validate = () => {
    const errs = [];
    const coverVal = form.cover_url || coverPending;
    for (const r of REQUIRED) {
      if (r.k === 'cover_url') {
        if (!coverVal) errs.push(r);
        continue;
      }
      const v = r.d ? form.details[r.k] : form[r.k];
      if (v === '' || v === null || v === undefined || (typeof v === 'string' && !v.trim())) {
        errs.push(r);
      }
    }
    return errs;
  };

  const submit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const errs = validate();
    if (errs.length) {
      setErrors(errs.map((x) => (x.k === 'cover_url' ? '请上传并裁切套系封面' : x.label)));
      setTab(errs[0].tabs[0]);
      return;
    }
    setErrors([]);
    setSaving(true);
    try {
      // 仅当存在裁切结果时才上传图片，未裁切则不提交图片
      let coverUrl = form.cover_url || '';
      if (coverPending) {
        const file = dataURLtoFile(coverPending, 'cover.jpg');
        const r = await uploadImage(file, { category: 'cover', isPublic: true });
        coverUrl = r.url;
      }
      const d = form.details;
      const payload = {
        name: form.name, price: parseFloat(form.price) || 0, deposit: parseFloat(form.deposit) || 0,
        category_id: form.category_id || null, cover_url: coverUrl, description: form.description || '',
        status: form.status, addons: form.addons || [], marketing: form.marketing || {}, specs: form.specs || [],
        questionnaire: Array.isArray(d.questionnaire) ? JSON.stringify(d.questionnaire) : '',
        details: d
      };
      if (isEdit) await http.put('/api/packages/' + id, payload);
      else await http.post('/api/packages', payload);
      nav('/packages');
    } catch (err) { alert('保存失败：' + (err.response?.data?.error || err.message || err)); }
    finally { setSaving(false); }
  };

  const goNext = () => { if (tab < 3) setTab(tab + 1); };

  if (loading) return <div className="p-10 text-muted">加载中…</div>;

  const TABS = ['套系名称', '价格及问卷', '服务及加片', '其他详情'];
  const d = form.details;

  return (
    <div className="-mx-6 -my-6 min-h-screen flex flex-col" style={{ background: PAGE_BG }}>
      {/* 白色卡片容器：Tab 栏 + 全部 Tab 内容；底边距 0 留出底部按钮栏 */}
      <form onSubmit={submit} className="m-4 sm:m-6 mb-0 max-w-[840px] mx-auto w-full"
        style={{ zoom: 0.8, borderRadius: 6, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', padding: isMobile ? '20px 16px' : '40px 48px', background: '#ffffff' }}>

        {/* Tab 栏：选中=方框高亮（黑边白底黑字），未选=灰字灰边透明底；无下划线 */}
        <div className="flex gap-1 overflow-x-auto" style={{ marginBottom: 28 }}>
          {TABS.map((t, i) => (
            <button key={t} type="button" onClick={() => setTab(i)}
              className="px-4 py-2 text-sm border rounded whitespace-nowrap shrink-0 transition-colors"
              style={{
                background: tab === i ? '#FFFFFF' : 'transparent',
                color: tab === i ? '#111111' : '#666666',
                borderColor: tab === i ? TAB_ACTIVE_BORDER : TAB_BORDER
              }}>
              {t}
            </button>
          ))}
        </div>

        {/* 卡片内容区（卡片已含 40/48 内边距） */}
        <div>
          {errors.length > 0 && (
            <div className="mb-5 px-3 py-2 rounded text-sm" style={{ background: '#fff1f0', color: RED, border: '1px solid #ffccc7' }}>
              请完善必填项：{errors.join('、')}
            </div>
          )}

          {/* ============ Tab1 套系名称 ============ */}
          {tab === 0 && (
            <div>
              {/* 套系封面：虚线框上传区；选图唤起裁切弹窗，裁切后回显预览；保存时才上传 */}
              <Field label="套系封面" required>
                <div className="flex items-center gap-4 flex-wrap">
                  {coverPending || form.cover_url ? (
                    <div className="relative w-60 h-[180px] rounded border overflow-hidden shrink-0 group"
                      style={{ borderColor: INPUT_BORDER, background: '#fff', maxWidth: '100%', width: isMobile ? '100%' : undefined }}>
                      <img src={coverPending || img(form.cover_url)} alt="" className="w-full h-full object-cover" />
                      {/* 悬浮：重新上传 / 重新裁切 */}
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                        style={{ background: 'rgba(0,0,0,0.45)' }}
                        onClick={() => coverInputRef.current && coverInputRef.current.click()}>
                        <span className="text-white text-xs">重新上传 / 重新裁切</span>
                      </div>
                      {/* 删除图标 */}
                      <button type="button" onClick={clearCover}
                        className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                        aria-label="删除封面"><IconClose /></button>
                    </div>
                  ) : (
                    <label className="relative w-60 h-[180px] rounded border border-dashed flex items-center justify-center cursor-pointer overflow-hidden shrink-0"
                      style={{ borderColor: INPUT_BORDER, background: '#fff', maxWidth: '100%', width: isMobile ? '100%' : undefined }}
                      onClick={() => coverInputRef.current && coverInputRef.current.click()}>
                      <span className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: '#f0f2f5', color: '#9aa0a8' }}><IconPlus width={24} height={24} /></span>
                    </label>
                  )}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs" style={{ color: NOTE }}>{coverPending ? '已裁切，保存时上传' : '点击虚线框上传封面'}</span>
                    {(coverPending || form.cover_url) && (
                      <button type="button" onClick={clearCover}
                        className="text-xs w-fit hover:opacity-80" style={{ color: NOTE }}>移除</button>
                    )}
                  </div>
                </div>
                <input ref={coverInputRef} type="file" accept="image/jpeg,image/png,image/webp"
                  onChange={onCoverSelect} className="hidden" />
              </Field>

              {/* 基础信息：套系名称 占满整行（拉宽到卡片右侧边界） */}
              <Field label="套系名称" required>
                <input className={inputFull} value={form.name}
                  onChange={(e) => setF({ name: e.target.value })} placeholder="婚礼跟拍｜摄影单机位" />
              </Field>

              {/* 套系分类 + 管理分类（占满整行，下拉自适应 + 管理分类按钮同行） */}
              <Field label="套系分类" required>
                <div className="flex items-center gap-3 flex-wrap">
                  <select className={selFull} value={form.category_id}
                    onChange={(e) => setF({ category_id: e.target.value })}>
                    <option value="">请选择分类</option>
                    {categories.filter(Boolean).map((c) => <option key={c.id} value={c.id}>{c.name || '未命名'}</option>)}
                  </select>
                  <button type="button" onClick={() => setCatOpen(true)}
                    className="text-[13px] whitespace-nowrap" style={{ color: LINK }}>管理分类</button>
                </div>
              </Field>

              {/* 套系简介（拉宽到与套系名称左右对齐，占满整行） */}
              <Field label="套系简介" hint="（列表页截断展示）">
                <textarea className={textareaWide} rows={2} value={form.description}
                  onChange={(e) => setF({ description: e.target.value })} placeholder="一句话介绍套系亮点" />
              </Field>

              {/* 详情图片 0/80：虚线框 140x120，0/80张在框下方 */}
              <Field label="详情图片">
                <div className="flex flex-wrap gap-2">
                  {form.details.detail_images.map((u, i) => (
                    <div key={i} className="relative w-20 h-20 rounded overflow-hidden border border-line group">
                      <img src={img(u)} alt="" className="w-full h-full object-cover" />
                      <button type="button" onClick={() => removeDetailImage(i)}
                        className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                        <IconClose />
                      </button>
                    </div>
                  ))}
                  {form.details.detail_images.length < 80 && (
                    <label className="w-[140px] h-[120px] rounded border border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer hover:border-[#2196F3]"
                      style={{ borderColor: INPUT_BORDER, color: NOTE }}>
                      <span className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: '#f0f2f5', color: '#9aa0a8' }}><IconPlus /></span>
                      <span className="text-[12px]">{uploading === 'images' ? '上传中' : '上传样片'}</span>
                      <input type="file" accept="image/*" multiple onChange={onDetailImages} className="hidden" />
                    </label>
                  )}
                </div>
                <div className="mt-1.5 text-[12px]" style={{ color: NOTE }}>{form.details.detail_images.length}/80张</div>
              </Field>

              {/* 套系视频：删除大块占位方框，仅保留蓝色文字按钮 */}
              <Field label="套系视频">
                <div className="flex items-center gap-3 flex-wrap">
                  {form.details.video_url && (
                    <video src={form.details.video_url} className="w-40 h-24 rounded object-cover bg-black" controls />
                  )}
                  <label className="inline-flex items-center gap-1.5 text-[13px] cursor-pointer" style={{ color: LINK }}>
                    <IconPlus />{uploading === 'video' ? '上传中…' : '点击上传套系视频'}
                    <input type="file" accept="video/*" onChange={onVideo} className="hidden" />
                  </label>
                  {form.details.video_url && (
                    <button type="button" onClick={() => setD({ video_url: '' })}
                      className="text-xs w-fit hover:opacity-80" style={{ color: NOTE }}>移除</button>
                  )}
                </div>
              </Field>
            </div>
          )}

          {/* ============ Tab2 价格及问卷 ============ */}
          {tab === 1 && (
            <div>
              {/* 服务参数 */}
              <Field label="服务参数" required>
                <div className="flex items-center gap-2">
                  <select className={selCls} value={d.service_params}
                    onChange={(e) => setD({ service_params: e.target.value })}>
                    {!SVC_PARAMS.includes(d.service_params) && d.service_params && <option value={d.service_params}>{d.service_params}</option>}
                    {SVC_PARAMS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <IconHelp />
                </div>
              </Field>

              {/* 价格 + 隐藏（同行的勾选框 margin-left 12px） */}
              <Field label="价格(¥)" required>
                <div className="flex items-center gap-3 flex-wrap">
                  <input type="number" className={inputCls} value={form.price}
                    onChange={(e) => setF({ price: e.target.value })} placeholder="0" />
                  <Checkbox checked={d.hide_price} onChange={(v) => setD({ hide_price: v })} label="隐藏" />
                </div>
              </Field>

              {/* 定金 + 隐藏 + 设为全款 */}
              <Field label="定金(¥)" required>
                <div className="flex items-center gap-3 flex-wrap">
                  <input type="number" disabled={d.deposit_is_full} className={inputCls}
                    style={{ opacity: d.deposit_is_full ? 0.6 : 1 }}
                    value={d.deposit_is_full ? form.price : form.deposit}
                    onChange={(e) => setF({ deposit: e.target.value })} placeholder="0" />
                  <Checkbox checked={d.hide_deposit} onChange={(v) => setD({ hide_deposit: v })} label="隐藏" />
                  <button type="button" onClick={() => setD({ deposit_is_full: !d.deposit_is_full, deposit: d.deposit_is_full ? '' : form.price })}
                    className="text-[13px]" style={{ color: LINK }}>{d.deposit_is_full ? '已设为全款' : '设为全款'}</button>
                </div>
              </Field>

              {/* 显示货币 */}
              <Field label="显示货币">
                <div className="flex items-center gap-2">
                  <span className="text-sm" style={{ color: '#333333' }}>{d.show_currency ? '人民币‑¥' : '未显示货币'}</span>
                  <button type="button" onClick={() => setD({ show_currency: !d.show_currency })}
                    className="text-[13px]" style={{ color: LINK }}>编辑</button>
                </div>
              </Field>

              {/* 退订政策 + 隐藏 + 红注 */}
              <Field label="退订政策" required>
                <div className="flex items-center gap-2 flex-wrap">
                  <select className={selCls} value={d.refund_policy}
                    onChange={(e) => setD({ refund_policy: e.target.value })}>
                    {!REFUND_OPTS.includes(d.refund_policy) && d.refund_policy && <option value={d.refund_policy}>{d.refund_policy}</option>}
                    {REFUND_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <IconHelp />
                  <Checkbox checked={d.hide_refund} onChange={(v) => setD({ hide_refund: v })} label="隐藏" />
                </div>
                <div className="mt-1.5 text-[12px]" style={{ color: RED }}>注释：隐藏退订政策后，将按照严格政策进行退订</div>
              </Field>

              {/* 底片保存 */}
              <Field label="底片保存">
                <div className="flex items-center gap-2">
                  {editRaw
                    ? <input autoFocus className={inputCls} value={d.raw_storage}
                        onChange={(e) => setD({ raw_storage: e.target.value })} onBlur={() => setEditRaw(false)} placeholder="如 30 天 / 永久" />
                    : <span className="text-sm" style={{ color: '#333333' }}>{d.raw_storage || '未设置'}</span>}
                  <button type="button" onClick={() => setEditRaw((v) => !v)} className="text-[13px]" style={{ color: LINK }}>编辑</button>
                </div>
              </Field>

              {/* 预存支付 */}
              <Field label="预存支付">
                <div className="flex items-center gap-2">
                  <Switch checked={d.prepay_enabled} onChange={(v) => setD({ prepay_enabled: v })} />
                  <IconHelp />
                </div>
              </Field>

              {/* 客户问卷区域（价格及问卷 Tab 虚线块：内底 #fbfbf3 / 边框 #dcdcdc，仅本 Tab 生效） */}
              <div className="mt-3 rounded border border-dashed" style={{ background: '#fbfbf3', borderColor: '#dcdcdc', padding: isMobile ? '16px' : '20px 24px' }}>
                <div className="mb-3">
                  <RadioGroup value={d.questionnaire_visibility} onChange={(v) => setD({ questionnaire_visibility: v })}
                    options={[{ v: 'none', t: '不显示' }, { v: 'after_pay', t: '支付后显示' }, { v: 'after_book', t: '预约后显示' }]} />
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={d.questionnaire_verify_phone} onChange={(v) => setD({ questionnaire_verify_phone: v })} />
                  <span className="text-sm" style={{ color: '#6b7280' }}>验证手机号</span>
                </div>
                <div className="mt-2 text-[12px]" style={{ color: '#888888' }}>*开启后，需验证手机号方可进入填写问卷。</div>
              </div>
            </div>
          )}

          {/* ============ Tab3 服务及加片 ============ */}
          {tab === 2 && (
            <div>
              {/* 标准服务模板虚线块（含标题 + 模板切换 + 全部服务字段 + 显示内容）；仅此块底色 #fbfbf3，其余区域白色 */}
              <div className="mb-6 rounded border border-dashed" style={{ background: '#fbfbf3', borderColor: YELLOW_BORDER, padding: '24px 28px' }}>
                <div className="text-[13px] mb-4" style={{ color: '#666666' }}>标准服务模板</div>

                {/* 摄影 / 摄像模版切换（选中黑底 pill，未选灰边） */}
                <div className="flex items-center gap-2 mb-5">
                  <button type="button" onClick={() => setD({ shoot_template: 'photo' })}
                    className="text-[13px] border"
                    style={{ background: d.shoot_template === 'photo' ? '#222222' : '#fff', color: d.shoot_template === 'photo' ? '#fff' : '#333333', borderColor: d.shoot_template === 'photo' ? '#222222' : '#D1D5DB', padding: '6px 16px', borderRadius: 20 }}>摄影模版</button>
                  <button type="button" onClick={() => setD({ shoot_template: 'video' })}
                    className="text-[13px] border"
                    style={{ background: d.shoot_template === 'video' ? '#222222' : '#fff', color: d.shoot_template === 'video' ? '#fff' : '#333333', borderColor: d.shoot_template === 'video' ? '#222222' : '#D1D5DB', padding: '6px 16px', borderRadius: 20 }}>摄像模版</button>
                </div>

                {/* 服务参数横版分组：拍摄时长 / 底片数量 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                  {/* 拍摄时长 */}
                  <Field label="拍摄时长" required>
                    <select className={selSm} value={d.duration}
                      onChange={(e) => setD({ duration: e.target.value })}>
                      {!DURATION_OPTS.includes(d.duration) && d.duration && <option value={d.duration}>{d.duration}</option>}
                      {DURATION_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </Field>

                  {/* 底片数量 + 底片全送 */}
                  <Field label="底片数量" required>
                    <div className="flex items-center gap-3 flex-wrap">
                      <input type="number" className={inputSm} value={d.raw_count}
                        onChange={(e) => setD({ raw_count: e.target.value })} placeholder="如 300" />
                      <Checkbox checked={d.raw_all_included} onChange={(v) => setD({ raw_all_included: v })} label="底片全送" />
                    </div>
                  </Field>
                </div>

                {/* 精修片 / 加片费 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                  {/* 精修片 */}
                  <Field label="精修片" required>
                    <input type="number" className={inputSm} value={d.retouch_count}
                      onChange={(e) => setD({ retouch_count: e.target.value })} placeholder="如 50" />
                  </Field>

                  {/* 加片费 */}
                  <Field label="加片费">
                    <input className={inputSm} value={d.extra_photo_fee}
                      onChange={(e) => setD({ extra_photo_fee: e.target.value })} placeholder="如 ¥50/张" />
                  </Field>
                </div>

                {/* 加片优惠 / 服务地点 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                  {/* 加片优惠 */}
                  <Field label="加片优惠">
                    <div className="flex items-center gap-2">
                      {editDisc
                        ? <input autoFocus className={inputSm} value={d.extra_photo_discount}
                            onChange={(e) => setD({ extra_photo_discount: e.target.value })} onBlur={() => setEditDisc(false)} placeholder="如 满 10 张 9 折" />
                        : <span className="text-sm" style={{ color: '#333333' }}>{d.extra_photo_discount || '暂无优惠'}</span>}
                      <button type="button" onClick={() => setEditDisc((v) => !v)} className="text-[13px]" style={{ color: LINK }}>编辑</button>
                    </div>
                  </Field>

                  {/* 服务地点：下拉 + 文本输入 同一行 gap 8px */}
                  <Field label="服务地点">
                    <div className="flex items-center gap-2 flex-wrap">
                      <select className={selSm} value="" onChange={(e) => e.target.value && setD({ service_location: e.target.value })}>
                        <option value="">选择</option>
                        {LOCATION_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                      <input className={inputSm} value={d.service_location}
                        onChange={(e) => setD({ service_location: e.target.value })} placeholder="请输入服务地点 0/40" />
                    </div>
                  </Field>
                </div>

                {/* 服装 / 化妆 / 相册：同一行三列均分（重点修改，原纵向堆叠→横向并排） */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4">
                  {/* 服装 */}
                  <div className="flex items-center gap-3">
                    <span className="text-sm" style={{ color: '#333333', whiteSpace: 'nowrap' }}>服装</span>
                    <RadioGroup value={d.cloth_provide} onChange={(v) => setD({ cloth_provide: v })}
                      options={[{ v: 'not', t: '不提供' }, { v: 'provide', t: '提供' }]} />
                  </div>
                  {/* 化妆 */}
                  <div className="flex items-center gap-3">
                    <span className="text-sm" style={{ color: '#333333', whiteSpace: 'nowrap' }}>化妆</span>
                    <RadioGroup value={d.makeup_provide} onChange={(v) => setD({ makeup_provide: v })}
                      options={[{ v: 'not', t: '不提供' }, { v: 'provide', t: '提供' }]} />
                  </div>
                  {/* 相册 */}
                  <div className="flex items-center gap-3">
                    <span className="text-sm" style={{ color: '#333333', whiteSpace: 'nowrap' }}>相册</span>
                    <RadioGroup value={d.album_provide} onChange={(v) => setD({ album_provide: v })}
                      options={[{ v: 'not', t: '不提供' }, { v: 'provide', t: '提供' }]} />
                  </div>
                </div>

                {/* 显示以上套系内容（复选框同行） */}
                <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer select-none mt-2" style={{ color: '#6b7280' }}>
                  <button type="button" onClick={() => setD({ show_service_content: !d.show_service_content })}
                    className="w-4 h-4 rounded-sm border flex items-center justify-center shrink-0"
                    style={{ borderColor: d.show_service_content ? LINK : '#c4c8cf', background: d.show_service_content ? LINK : '#fff' }}>
                    {d.show_service_content && <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4 10-10" /></svg>}
                  </button>
                  显示以上套系内容
                </label>
              </div>

              {/* 自定义服务详情（大文本域占卡片可用宽度） */}
              <Field label="自定义服务详情">
                <textarea className={taBig} rows={5} value={d.service_detail_text}
                  style={{ minHeight: 220, lineHeight: 1.6 }}
                  onChange={(e) => setD({ service_detail_text: e.target.value })} placeholder="例如：本套系包含专业摄影师全程跟拍、精修调色、相册设计等服务，拍摄前可沟通风格需求。" />
                <div className="flex flex-wrap mt-3">
                  <button type="button" onClick={() => setD({ service_detail_text: d.service_detail_text + (d.service_detail_text ? '\n' : '') + '【摄影类】' })}
                    className="text-[13px] rounded mr-2" style={{ color: '#444444', borderColor: '#E5E7EB', background: '#E5E7EB', padding: '4px 12px' }}>摄影类</button>
                  <button type="button" onClick={() => setD({ service_detail_text: d.service_detail_text + (d.service_detail_text ? '\n' : '') + '【摄像类】' })}
                    className="text-[13px] rounded mr-2" style={{ color: '#444444', borderColor: '#E5E7EB', background: '#E5E7EB', padding: '4px 12px' }}>摄像类</button>
                </div>
              </Field>
            </div>
          )}

          {/* ============ Tab4 其他详情 ============ */}
          {tab === 3 && (
            <div>
              {/* 对外公开：开关 + 右侧下拉（高 32px），同行 gap 12px */}
              <Field label="对外公开">
                <div className="flex items-center gap-3 flex-wrap">
                  <Switch checked={d.public_all_visible} onChange={(v) => setD({ public_all_visible: v })} />
                  <select className={selSmCls} value={d.public_visible}
                    onChange={(e) => setD({ public_visible: e.target.value })}>
                    <option>全部可见</option>
                    <option>部分可见</option>
                    <option>指定客户</option>
                  </select>
                </div>
                <div className="mt-1 text-[12px]" style={{ color: '#888888' }}>*套系将公开展示在小程序和网站中，对所有客户可见</div>
              </Field>

              {/* 咨询提醒 */}
              <Field label="咨询提醒">
                <div className="flex items-center gap-3 flex-wrap">
                  <Switch checked={d.consult_reminder} onChange={(v) => setD({ consult_reminder: v })} />
                  <span className="text-sm" style={{ color: '#6b7280' }}>显示</span>
                </div>
                <div className="mt-1 text-[12px]" style={{ color: '#888888' }}>*开启后，「咨询提醒」将在小程序和网站套系详情页中展示</div>
              </Field>

              {/* 温馨提示（大文本域） */}
              <Field label="温馨提示">
                <textarea className={taBig} rows={5} value={d.warm_tips}
                  style={{ minHeight: 180, lineHeight: 1.6 }}
                  onChange={(e) => setD({ warm_tips: e.target.value })} placeholder="例如：拍摄前请保持充足睡眠，避免熬夜；可提前准备喜欢的照片风格参考……" />
              </Field>

              {/* 标签（灰色标签按钮组，选中蓝底白字） */}
              <Field label="标签">
                <div className="flex flex-wrap gap-2">
                  {PRESET_TAGS.map((t) => {
                    const on = d.tags.includes(t);
                    return (
                      <button key={t} type="button" onClick={() => on ? removeTag(t) : addTag(t)}
                        className="px-[12px] py-1 rounded text-xs transition-colors"
                        style={{ background: on ? LINK : '#E5E7EB', color: on ? '#FFFFFF' : '#444444' }}>
                        {t}
                      </button>
                    );
                  })}
                </div>
              </Field>

              {/* 顾客协议：文字 + 蓝色「编辑」链接 */}
              <Field label="顾客协议">
                <div className="flex items-center gap-2">
                  {editAgr
                    ? <textarea autoFocus rows={4} className={textareaFull} value={d.customer_agreement}
                        onChange={(e) => setD({ customer_agreement: e.target.value })} onBlur={() => setEditAgr(false)} placeholder="填写客户需知 / 协议条款" />
                    : <span className="text-sm" style={{ color: '#333333' }}>{d.customer_agreement || '未启用'}</span>}
                  <button type="button" onClick={() => setEditAgr((v) => !v)} className="text-[13px] whitespace-nowrap" style={{ color: LINK }}>编辑</button>
                </div>
              </Field>
            </div>
          )}

          {/* 每个 Tab 左下角蓝色【下一步 >】文字链接（最后一个 Tab 不显示） */}
          {tab < 3 && (
            <div className="mt-8 mb-10">
              <button type="button" onClick={goNext}
                className="text-[13px]" style={{ color: LINK }}>下一步 &gt;</button>
            </div>
          )}
        </div>
      </form>

      {/* 底部固定按钮：取消 / 保存 并排居中 */}
      <div className="sticky bottom-0 z-20 flex items-center justify-center gap-3 px-6 py-3 border-t max-w-[840px] mx-auto w-full"
        style={{ zoom: 0.8, background: PAGE_BG, borderColor: '#e5e5e5' }}>
        <button type="button" onClick={() => nav('/packages')}
          className="h-[34px] px-4 rounded text-sm hover:opacity-90" style={{ background: '#FFFFFF', border: '1px solid #D1D5DB', color: '#333333' }}>取消</button>
        <button type="button" onClick={submit} disabled={saving}
          className="h-[34px] px-[18px] rounded text-sm text-white disabled:opacity-60" style={{ background: SAVE_BTN }}>
          {saving ? '保存中…' : '保存'}
        </button>
      </div>

      {/* 管理分类弹窗 */}
      {catOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => setCatOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm bg-white rounded-2xl p-5" style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.18)' }}>
            <div className="flex items-center justify-between mb-3">
              <div style={{ color: '#333333' }}>管理分类</div>
              <button onClick={() => setCatOpen(false)} className="p-1 rounded hover:bg-panel2" style={{ color: '#6b7280' }}><IconClose /></button>
            </div>
            <div className="max-h-60 overflow-auto mb-3">
              {categories.length === 0 && <div className="text-sm text-muted text-center py-4">暂无分类</div>}
              {categories.filter(Boolean).map((c) => (
                <button key={c.id} type="button" onClick={() => { setF({ category_id: c.id }); setCatOpen(false); }}
                  className="w-full text-left px-3 py-2 rounded-md text-sm hover:bg-panel2 flex items-center justify-between"
                  style={{ color: form.category_id === c.id ? LINK : '#333333', background: form.category_id === c.id ? LIGHT_BLUE : 'transparent' }}>
                  <span>{c.name || '未命名'}</span>
                  {form.category_id === c.id && <span className="text-xs">已选</span>}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 border-t border-line pt-3 flex-wrap">
              <input className={inputCls} value={catName} onChange={(e) => setCatName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addCategory()} placeholder="新建分类名称" />
              <button type="button" onClick={addCategory}
                className="px-3 py-2 rounded-md text-sm text-white whitespace-nowrap" style={{ background: LINK }}>新建</button>
            </div>
          </div>
        </div>
      )}

      {/* 套系封面临时裁切弹窗：选图后唤起，确认才生成裁切图 */}
      {cropOpen && cropSrc && (
        <CropperModal src={cropSrc} onCancel={handleCropCancel} onConfirm={handleCropConfirm} />
      )}
    </div>
  );
}
