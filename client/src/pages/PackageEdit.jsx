import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
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
const CAMERA_OPTS = ['单机位', '双机位', '三机位', '多机位'];
const DELIVERY_OPTS = ['U盘', '网盘', '邮箱', '线下交付'];
const LOCATION_OPTS = ['全国', '海口', '三亚', '三沙', '儋州', '文昌', '琼海', '万宁', '东方', '五指山', '澄迈', '临高', '定安', '屯昌', '白沙', '昌江', '乐东', '陵水', '保亭', '琼中'];

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
    camera_count: '',
    video_duration: '',
    delivery_method: '',
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
/* ========================================================================
   移动端专用组件（小程序 1:1 复刻风格）
   ======================================================================== */
const MRED = '#FA5151';
const MGRAY = '#999999';
const MBORDER = '#F0F0F0';
const MBAR = '#F5F5F5';

function ChevronRight() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C4C4C4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6"/></svg>;
}

// 通用行：左 label + 右 value + chevron
function MRow({ label, value, onClick, valueColor, extra, disabled, children, noChevron }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{ display: 'flex', alignItems: 'center', minHeight: 50, padding: '0 16px', width: '100%', background: 'none', border: 'none', textAlign: 'left', gap: 10, borderBottom: '1px solid ' + MBORDER }}>
      <span style={{ fontSize: 15, color: '#333333', flexShrink: 0 }}>{label}</span>
      {children}
      {extra && <span style={{ marginLeft: 'auto' }}>{extra}</span>}
      {value !== undefined && (
        <span style={{ marginLeft: 'auto', fontSize: 14, color: valueColor || MGRAY, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>{value}</span>
      )}
      {!noChevron && <ChevronRight />}
    </button>
  );
}

// 分组标题：灰底 + 红色左竖线
function MGroup({ title }) {
  return (
    <div style={{ background: MBAR, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 3, height: 14, background: MRED, borderRadius: 2 }} />
      <span style={{ fontSize: 14, fontWeight: 500, color: '#333333' }}>{title}</span>
    </div>
  );
}

// 红色开关（小程序风格）
function MSwitch({ checked, onChange }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} style={{ width: 44, height: 26, borderRadius: 13, background: checked ? MRED : '#E5E5E5', position: 'relative', transition: 'background .2s', border: 'none', flexShrink: 0, cursor: 'pointer' }}>
      <span style={{ position: 'absolute', top: 2, left: checked ? 20 : 2, width: 22, height: 22, borderRadius: 11, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.15)', transition: 'left .2s' }} />
    </button>
  );
}

// 红色 radio（横向）
function MRadio({ value, onChange, options }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
      {options.map((o) => (
        <button key={o.v} type="button" onClick={() => onChange(o.v)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', fontSize: 14, color: value === o.v ? '#333333' : MGRAY, cursor: 'pointer' }}>
          <span style={{ width: 16, height: 16, borderRadius: 8, border: `1.5px solid ${value === o.v ? MRED : '#D1D5DB'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {value === o.v && <span style={{ width: 8, height: 8, borderRadius: 4, background: MRED }} />}
          </span>
          {o.t}
        </button>
      ))}
    </div>
  );
}

// Pill 切换（模板类型）
function MPill({ value, onChange, options }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {options.map((o) => {
        const on = value === o.v;
        return (
          <button key={o.v} type="button" onClick={() => onChange(o.v)}
            style={{ padding: '5px 14px', borderRadius: 14, fontSize: 13, border: `1px solid ${on ? MRED : '#D1D5DB'}`, background: on ? '#FFF5F5' : '#fff', color: on ? MRED : '#333333', cursor: 'pointer' }}>
            {o.t}
          </button>
        );
      })}
    </div>
  );
}

// 底部弹窗 Sheet
function MSheet({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100 }} onClick={onClose} />
      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, background: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, zIndex: 101, padding: '12px 20px calc(20px + env(safe-area-inset-bottom))', maxHeight: '80vh', overflow: 'auto' }}>
        <div style={{ width: 36, height: 4, background: '#DDD', borderRadius: 2, margin: '0 auto 14px' }} />
        <div style={{ fontSize: 16, fontWeight: 500, textAlign: 'center', marginBottom: 16, color: '#333' }}>{title}</div>
        {children}
      </div>
    </>
  );
}

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
  const location = useLocation();
  const isEdit = !!id;
  // 从预览页（PackagePreview）进入编辑 → 返回上一页即预览；其他入口（新建/直达URL）返回列表
  const backToPrev = () => { if (location.state?.from === 'preview') nav(-1); else nav('/packages'); };

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
  const [catOpen, setCatOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [qnaHelpOpen, setQnaHelpOpen] = useState(false);
  // 内联编辑开关（文本展示 + 编辑链接）
  const [editRaw, setEditRaw] = useState(false);
  const [editDisc, setEditDisc] = useState(false);
  const [editAgr, setEditAgr] = useState(false);

  // 移动端 Tab：0=价格, 1=详情, 2=选填
  const [mTab, setMTab] = useState(0);
  // 移动端 Sheet 弹窗
  const [sheet, setSheet] = useState(null); // 'name' | 'price' | 'deposit' | 'refund' | 'raw' | 'questionnaire' | 'duration' | 'rawCount' | 'retouch' | 'extraFee' | 'extraDisc' | 'cloth' | 'album' | 'location' | 'warm' | 'visible' | null
  const [sheetVal, setSheetVal] = useState('');
  const openSheet = (key, val) => { setSheet(key); setSheetVal(val !== undefined ? String(val) : ''); };
  const closeSheet = () => { setSheet(null); setSheetVal(''); };
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
    if (file.size > 15 * 1024 * 1024) { alert('图片大小不能超过 15MB'); return; }
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
  const [catInput, setCatInput] = useState('');
  // 分类 id → 名称（categories 列表来自 GET /api/categories）
  const getCatName = (cid) => {
    if (!cid) return '';
    const c = (categories || []).find((x) => x && String(x.id) === String(cid));
    return c ? c.name : '';
  };
  const addCategory = async () => {
    const name = catInput.trim();
    if (!name) return;
    try {
      const r = await http.post('/api/categories', { name, kind: 'work' });
      await loadCategories();
      setForm((f) => ({ ...f, category_id: r.data.id }));
      setCatInput('');
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
      if (isMobile) {
        const mt = { 0: 0, 1: 0, 2: 1, 3: 2 }[errs[0].tabs[0]];
        if (mt !== undefined) setMTab(mt);
      } else {
        setTab(errs[0].tabs[0]);
      }
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

  // ===================== 移动端 1:1 复刻渲染 =====================
  if (isMobile) {
    const d = form.details;
    const catN = getCatName(form.category_id);
    const hasCover = coverPending || form.cover_url;
    const coverSrc = coverPending || img(form.cover_url);

    return (
      <div style={{ background: '#F8F8F8', minHeight: '100vh', paddingBottom: 20 }}>
        {/* 顶部导航栏 */}
        <div style={{ position: 'sticky', top: 0, zIndex: 30, background: '#fff', borderBottom: '1px solid #EFEFEF', display: 'flex', alignItems: 'center', height: 48, padding: '0 12px' }}>
          <button type="button" onClick={backToPrev} style={{ background: 'none', border: 'none', padding: '6px 0', flexShrink: 0 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6"/></svg>
          </button>
          <div style={{ flex: 1, textAlign: 'center', fontSize: 16, fontWeight: 500, color: '#333' }}>{isEdit ? '编辑套系' : '新建套系'}</div>
          <button type="button" onClick={submit} disabled={saving} style={{ background: 'none', border: 'none', fontSize: 15, color: MRED, flexShrink: 0, opacity: saving ? 0.6 : 1 }}>
            {saving ? '保存中' : '保存'}
          </button>
        </div>

        {/* 错误提示 */}
        {errors.length > 0 && (
          <div style={{ margin: '12px 12px 0', padding: '10px 14px', borderRadius: 8, background: '#FFF5F5', color: '#E53E3E', fontSize: 13, border: '1px solid #FFD6D6' }}>
            请完善必填项：{errors.join('、')}
          </div>
        )}

        {/* 基本信息卡片（块内不画分隔线，靠留白分组） */}
        <div style={{ background: '#fff', margin: '12px 12px 0', borderRadius: 12, overflow: 'hidden' }}>
          {/* 套系名称 */}
          <button type="button" onClick={() => openSheet('name', form.name)}
            style={{ display: 'flex', alignItems: 'center', minHeight: 50, padding: '0 16px', width: '100%', background: 'none', border: 'none', textAlign: 'left', gap: 10 }}>
            <span style={{ fontSize: 15, color: '#333', flexShrink: 0 }}>套系名称</span>
            <span style={{ marginLeft: 'auto', fontSize: 14, color: form.name ? '#333' : MGRAY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>{form.name || '请填写套系名称'}</span>
            <ChevronRight />
          </button>

          {/* 选择分类 */}
          <button type="button" onClick={() => setCatOpen(true)}
            style={{ display: 'flex', alignItems: 'center', minHeight: 50, padding: '0 16px', width: '100%', background: 'none', border: 'none', textAlign: 'left', gap: 10 }}>
            <span style={{ fontSize: 15, color: '#333', flexShrink: 0 }}>选择分类</span>
            <span style={{ marginLeft: 'auto', fontSize: 14, color: catN ? '#333' : MGRAY }}>{catN || '请选择分类'}</span>
            <ChevronRight />
          </button>

          {/* 封面图片区 */}
          <div style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: 15, color: '#333', marginBottom: 10 }}>套系封面</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              {hasCover && (
                <div style={{ position: 'relative', width: 96, height: 96, borderRadius: 4, overflow: 'hidden', flexShrink: 0 }}>
                  <img src={coverSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  <button type="button" onClick={clearCover} style={{ position: 'absolute', top: 4, left: 4, width: 20, height: 20, borderRadius: 10, background: 'rgba(0,0,0,0.5)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                  </button>
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 11, textAlign: 'center', padding: '2px 0' }}>封面</div>
                </div>
              )}
              <label style={{ width: 96, height: 96, borderRadius: 4, border: '1px dashed #D1D5DB', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: 'pointer', flexShrink: 0, background: '#FAFAFA' }}
                onClick={() => coverInputRef.current && coverInputRef.current.click()}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                <span style={{ fontSize: 12, color: '#999' }}>添加图片</span>
              </label>
              <input ref={coverInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={onCoverSelect} className="hidden" />
            </div>
          </div>

          {/* 上传视频 */}
          <button type="button" onClick={() => { if (!d.video_url) coverInputRef.current?.click(); }}
            style={{ display: 'flex', alignItems: 'center', minHeight: 50, padding: '0 16px', width: '100%', background: 'none', border: 'none', textAlign: 'left', gap: 10 }}>
            <span style={{ fontSize: 15, color: '#333', flexShrink: 0 }}>上传视频</span>
            <span style={{ marginLeft: 'auto', fontSize: 14, color: d.video_url ? '#333' : MGRAY }}>{d.video_url ? '已上传' : '未上传'}</span>
            <ChevronRight />
          </button>
        </div>

        {/* Tab 胶囊切换（与上方卡片留 16px 间距，下方卡片用 margin 间隔） */}
        <div style={{ padding: '4px 0', margin: '16px 12px 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          {['价格', '详情', '选填'].map((t, i) => (
            <button key={t} type="button" onClick={() => setMTab(i)}
              style={{ padding: '7px 28px', borderRadius: 16, fontSize: 14, fontWeight: 500, border: 'none', cursor: 'pointer',
                background: mTab === i ? MRED : '#fff',
                color: mTab === i ? '#fff' : '#333333',
                border: mTab === i ? 'none' : '1px solid #E5E5E5' }}>
              {t}
            </button>
          ))}
        </div>

        {/* ====== 详情 Tab ====== */}
        {mTab === 1 && (
          <div style={{ background: '#fff', margin: '0 12px 12px', borderRadius: 12, overflow: 'hidden', border: '1px solid #F0F0F0' }}>
            {/* 显示标准模板 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 50, padding: '0 16px', borderBottom: '1px solid ' + MBORDER }}>
              <span style={{ fontSize: 15, color: '#333' }}>显示标准模板</span>
              <MSwitch checked={d.show_service_content} onChange={(v) => setD({ show_service_content: v })} />
            </div>
            {/* 模板类型 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 50, padding: '0 16px', borderBottom: '1px solid ' + MBORDER }}>
              <span style={{ fontSize: 15, color: '#333' }}>模板类型</span>
              <MPill value={d.shoot_template} onChange={(v) => setD({ shoot_template: v })}
                options={[{ v: 'photo', t: '摄影模板' }, { v: 'video', t: '摄像模板' }]} />
            </div>

            {/* 标准模板分组 */}
            <MGroup title="标准模板" />
            <MRow label="拍摄时长" value={d.duration || '请选择'} onClick={() => openSheet('duration', d.duration)} />
            {d.shoot_template === 'video' ? (
              <>
                <MRow label="拍摄机位" value={d.camera_count || '请选择'} onClick={() => openSheet('camera', d.camera_count)} />
                <MRow label="成片时长" value={d.video_duration || '请选择'} onClick={() => openSheet('videoDuration', d.video_duration)} />
                <MRow label="交付方式" value={d.delivery_method || '请选择'} onClick={() => openSheet('delivery', d.delivery_method)} />
              </>
            ) : (
              <>
                <MRow label="原片" value={d.raw_count ? `${d.raw_count}张` : '请选择'} onClick={() => openSheet('rawCount', d.raw_count)} />
                <MRow label="精修片" value={d.retouch_count ? `${d.retouch_count}张` : '请选择'} onClick={() => openSheet('retouch', d.retouch_count)} />
                <MRow label="加片费" value={d.extra_photo_fee || '请选择'} onClick={() => openSheet('extraFee', d.extra_photo_fee)} />
                <MRow label="加片优惠" value={d.extra_photo_discount || '无'} onClick={() => openSheet('extraDisc', d.extra_photo_discount)} />
              </>
            )}
            <MRow label="化妆服装" value={`${d.cloth_provide === 'provide' ? '提供服装' : '不提供服装'} ${d.makeup_provide === 'provide' ? '提供化妆' : '不提供化妆'}`}
              onClick={() => openSheet('cloth', `${d.cloth_provide}|${d.makeup_provide}`)} />
            <MRow label="提供相册" value={d.album_provide === 'provide' ? '是' : d.album_provide === 'extra' ? '相册另购' : '否'}
              onClick={() => openSheet('album', d.album_provide)} />
            <MRow label="服务地点" value={d.service_location || '不显示'} onClick={() => openSheet('location', d.service_location)} />

            {/* 服务详情分组（可编辑 textarea；空内容显示占位文案） */}
            <MGroup title="服务详情" />
            <div style={{ padding: '14px 16px' }}>
              <textarea
                value={d.service_detail_text || ''}
                onChange={(e) => setD({ service_detail_text: e.target.value })}
                placeholder="婚礼跟拍 | 摄影单机位（两台相机拍摄）&#10;&#10;拍摄内容：婚礼当天流程、人物、场景等，具体拍摄内容由摄影师根据实际情况拍摄。&#10;照片数量：承诺拍摄不少于 300 张照片，并从中精选 40 张进行精修。&#10;照片格式：乙方提供 JPEG 格式的数字照片。&#10;婚礼预告：婚礼结束后 1—3 日 9 张精修（赠送服务）&#10;概述：摄影单机位记录画面有限。"
                rows={8}
                className={taBig}
                style={{ resize: 'vertical', minHeight: 160, lineHeight: 1.7 }}
              />
            </div>
            {/* 快捷模板：点击追加预设段落标记到末尾 */}
            <div style={{ background: '#F8F8F8', padding: '12px 16px' }}>
              <div style={{ fontSize: 13, color: MGRAY, marginBottom: 10 }}>快捷模板（点击追加到末尾）</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => setD({ service_detail_text: (d.service_detail_text || '') + (d.service_detail_text ? '\n' : '') + '【摄影类】' })}
                  className="px-3 py-1.5 rounded-full text-xs border border-line bg-white">摄影类</button>
                <button type="button" onClick={() => setD({ service_detail_text: (d.service_detail_text || '') + (d.service_detail_text ? '\n' : '') + '【摄像类】' })}
                  className="px-3 py-1.5 rounded-full text-xs border border-line bg-white">摄像类</button>
              </div>
            </div>
          </div>
        )}

        {/* ====== 选填 Tab ====== */}
        {mTab === 2 && (
          <div style={{ background: '#fff', margin: '0 12px 12px', borderRadius: 12, overflow: 'hidden', border: '1px solid #F0F0F0' }}>
            <MRow label="温馨提示" value={d.warm_tips ? d.warm_tips.slice(0, 30) + '...' : ''}
              onClick={() => openSheet('warm', d.warm_tips)} />
            <MRow label="咨询提醒设置" value="" onClick={() => setD({ consult_reminder: !d.consult_reminder })} />
            <MRow label="顾客协议" value={d.customer_agreement ? '已启用' : '未启用'}
              onClick={() => openSheet('agreement', d.customer_agreement)} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 50, padding: '0 16px', borderBottom: '1px solid ' + MBORDER }}>
              <span style={{ fontSize: 15, color: '#333' }}>对外公开</span>
              <MSwitch checked={d.public_all_visible} onChange={(v) => setD({ public_all_visible: v })} />
            </div>
            <MRow label="谁可以看" value={d.public_visible || '全部可见'}
              onClick={() => openSheet('visible', d.public_visible)} />
            <div style={{ padding: '8px 16px 12px', fontSize: 12, color: MGRAY }}>
              *套系将公开展示在小程序和网站中，对所有客户可见
            </div>
          </div>
        )}

        {/* ====== 价格 Tab ====== */}
        {mTab === 0 && (
          <div style={{ background: '#fff', margin: '0 12px 12px', borderRadius: 12, overflow: 'hidden', border: '1px solid #F0F0F0' }}>
            {/* 服务规格 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 50, padding: '0 16px', borderBottom: '1px solid ' + MBORDER }}>
              <span style={{ fontSize: 15, color: '#333' }}>服务规格</span>
              <MRadio value={d.service_params} onChange={(v) => setD({ service_params: v })}
                options={[{ v: '单规格服务', t: '单规格' }, { v: '多规格服务', t: '多规格' }]} />
            </div>
            {/* 总价 */}
            <button type="button" onClick={() => openSheet('price', form.price)}
              style={{ display: 'flex', alignItems: 'center', minHeight: 50, padding: '0 16px', width: '100%', background: 'none', border: 'none', textAlign: 'left', gap: 8, borderBottom: '1px solid ' + MBORDER }}>
              <span style={{ fontSize: 15, color: '#333', flex: 1 }}>总价</span>
              <span style={{ fontSize: 14, color: MGRAY }}>¥ {form.price || '0.00'}</span>
              <button type="button" onClick={(e) => { e.stopPropagation(); setD({ hide_price: !d.hide_price }); }}
                style={{ background: 'none', border: 'none', padding: 2, display: 'flex', alignItems: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={d.hide_price ? '#E5E5E5' : '#C4C4C4'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {d.hide_price
                    ? <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><path d="M4 4l16 16"/></>
                    : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></>}
                </svg>
              </button>
              <ChevronRight />
            </button>
            {/* 定金 */}
            <button type="button" onClick={() => openSheet('deposit', form.deposit)}
              style={{ display: 'flex', alignItems: 'center', minHeight: 50, padding: '0 16px', width: '100%', background: 'none', border: 'none', textAlign: 'left', gap: 8, borderBottom: '1px solid ' + MBORDER }}>
              <span style={{ fontSize: 15, color: '#333', flex: 1 }}>定金</span>
              <span style={{ fontSize: 14, color: MGRAY }}>¥ {form.deposit || '0.00'}</span>
              <button type="button" onClick={(e) => { e.stopPropagation(); setD({ hide_deposit: !d.hide_deposit }); }}
                style={{ background: 'none', border: 'none', padding: 2, display: 'flex', alignItems: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={d.hide_deposit ? '#E5E5E5' : '#C4C4C4'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {d.hide_deposit
                    ? <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><path d="M4 4l16 16"/></>
                    : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></>}
                </svg>
              </button>
              <ChevronRight />
            </button>
            {/* 退订政策 */}
            <button type="button" onClick={() => openSheet('refund', d.refund_policy)}
              style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: 50, padding: '8px 16px', width: '100%', background: 'none', border: 'none', textAlign: 'left', borderBottom: '1px solid ' + MBORDER }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
                <span style={{ fontSize: 15, color: '#333', flex: 1 }}>退订政策</span>
                <span style={{ fontSize: 14, color: d.hide_refund ? MGRAY : '#333' }}>{d.hide_refund ? '不显示' : d.refund_policy}</span>
                <ChevronRight />
              </div>
              <div style={{ fontSize: 12, color: MGRAY, marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                隐藏后，则默认为"严格"政策
                <IconHelp />
              </div>
            </button>
            {/* 底片保存设置 */}
            <button type="button" onClick={() => openSheet('raw', d.raw_storage)}
              style={{ display: 'flex', alignItems: 'center', minHeight: 50, padding: '0 16px', width: '100%', background: 'none', border: 'none', textAlign: 'left', gap: 8, borderBottom: '1px solid ' + MBORDER }}>
              <span style={{ fontSize: 15, color: '#333', flexShrink: 0 }}>底片保存设置</span>
              <span style={{ fontSize: 10, color: '#fff', background: '#FFBB33', borderRadius: 3, padding: '1px 4px', marginLeft: 4, flexShrink: 0 }}>NEW</span>
              <span style={{ marginLeft: 'auto', fontSize: 14, color: d.raw_storage ? '#333' : MGRAY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140, textAlign: 'right' }}>
                {d.raw_storage || '未设置'}
              </span>
              <ChevronRight />
            </button>
            {/* 预存支付 */}
            <button type="button" onClick={() => openSheet('prepay', d.prepay_enabled ? '允许' : '不允许')}
              style={{ display: 'flex', alignItems: 'center', minHeight: 50, padding: '0 16px', width: '100%', background: 'none', border: 'none', textAlign: 'left', gap: 8, borderBottom: '1px solid ' + MBORDER }}>
              <span style={{ fontSize: 15, color: '#333', flex: 1 }}>预存支付</span>
              <span style={{ fontSize: 14, color: d.prepay_enabled ? '#333' : MGRAY }}>{d.prepay_enabled ? '允许' : '不允许'}</span>
              <ChevronRight />
            </button>
            {/* 套系问卷 */}
            <button type="button" onClick={() => openSheet('questionnaire', d.questionnaire_visibility)}
              style={{ display: 'flex', alignItems: 'center', minHeight: 50, padding: '0 16px', width: '100%', background: 'none', border: 'none', textAlign: 'left', gap: 8 }}>
              <span style={{ fontSize: 15, color: '#333', flex: 1 }}>套系问卷</span>
              <span style={{ fontSize: 14, color: d.questionnaire_visibility === 'none' ? MGRAY : '#333' }}>
                {d.questionnaire_visibility === 'none' ? '未设置' : d.questionnaire_visibility === 'after_pay' ? '支付后显示' : '预约后显示'}
              </span>
              <ChevronRight />
            </button>
            {/* 底部说明 */}
            <div onClick={() => setQnaHelpOpen(true)} style={{ padding: '8px 16px 12px', fontSize: 13, color: '#FF6B00', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: '#FF6B00' }}>*什么是客户调查问卷？</span>
            </div>
          </div>
        )}

        {/* 移动端 Sheet 弹窗 */}
        <MSheet open={sheet === 'name'} onClose={closeSheet} title="套系名称">
          <input autoFocus value={sheetVal} onChange={(e) => setSheetVal(e.target.value)} placeholder="请输入套系名称"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 15, outline: 'none' }}
            onKeyDown={(e) => { if (e.key === 'Enter') { setF({ name: sheetVal }); closeSheet(); } }} />
          <button type="button" onClick={() => { setF({ name: sheetVal }); closeSheet(); }}
            style={{ width: '100%', marginTop: 16, padding: '12px', borderRadius: 8, background: MRED, color: '#fff', fontSize: 15, border: 'none' }}>确定</button>
        </MSheet>

        <MSheet open={sheet === 'price'} onClose={closeSheet} title="总价">
          <input autoFocus type="number" value={sheetVal} onChange={(e) => setSheetVal(e.target.value)} placeholder="0"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 15, outline: 'none' }} />
          <button type="button" onClick={() => { setF({ price: sheetVal }); closeSheet(); }}
            style={{ width: '100%', marginTop: 16, padding: '12px', borderRadius: 8, background: MRED, color: '#fff', fontSize: 15, border: 'none' }}>确定</button>
        </MSheet>

        <MSheet open={sheet === 'deposit'} onClose={closeSheet} title="定金">
          <input autoFocus type="number" value={sheetVal} onChange={(e) => setSheetVal(e.target.value)} placeholder="0"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 15, outline: 'none' }} />
          <button type="button" onClick={() => { setF({ deposit: sheetVal }); closeSheet(); }}
            style={{ width: '100%', marginTop: 16, padding: '12px', borderRadius: 8, background: MRED, color: '#fff', fontSize: 15, border: 'none' }}>确定</button>
        </MSheet>

        <MSheet open={sheet === 'refund'} onClose={closeSheet} title="退订政策">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {REFUND_OPTS.map((o) => (
              <button key={o} type="button" onClick={() => { setD({ refund_policy: o, hide_refund: false }); closeSheet(); }}
                style={{ padding: '12px 16px', borderRadius: 8, border: '1px solid ' + (d.refund_policy === o && !d.hide_refund ? MRED : '#E5E5E5'), background: d.refund_policy === o && !d.hide_refund ? '#FFF5F5' : '#fff', fontSize: 15, color: '#333', textAlign: 'left' }}>
                {o}
              </button>
            ))}
            <button type="button" onClick={() => { setD({ hide_refund: true }); closeSheet(); }}
              style={{ padding: '12px 16px', borderRadius: 8, border: '1px solid ' + (d.hide_refund ? MRED : '#E5E5E5'), background: d.hide_refund ? '#FFF5F5' : '#fff', fontSize: 15, color: '#333', textAlign: 'left' }}>
              不显示
            </button>
          </div>
        </MSheet>

        <MSheet open={sheet === 'raw'} onClose={closeSheet} title="底片保存设置">
          <input autoFocus value={sheetVal} onChange={(e) => setSheetVal(e.target.value)} placeholder="如：原片-- 精修片 3年"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 15, outline: 'none' }}
            onKeyDown={(e) => { if (e.key === 'Enter') { setD({ raw_storage: sheetVal }); closeSheet(); } }} />
          <button type="button" onClick={() => { setD({ raw_storage: sheetVal }); closeSheet(); }}
            style={{ width: '100%', marginTop: 16, padding: '12px', borderRadius: 8, background: MRED, color: '#fff', fontSize: 15, border: 'none' }}>确定</button>
        </MSheet>

        <MSheet open={sheet === 'questionnaire'} onClose={closeSheet} title="套系问卷">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[{ v: 'none', t: '不显示' }, { v: 'after_pay', t: '支付后显示' }, { v: 'after_book', t: '预约后显示' }].map((o) => (
              <button key={o.v} type="button" onClick={() => { setD({ questionnaire_visibility: o.v }); closeSheet(); }}
                style={{ padding: '12px 16px', borderRadius: 8, border: '1px solid ' + (d.questionnaire_visibility === o.v ? MRED : '#E5E5E5'), background: d.questionnaire_visibility === o.v ? '#FFF5F5' : '#fff', fontSize: 15, color: '#333', textAlign: 'left' }}>
                {o.t}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Switch checked={d.questionnaire_verify_phone} onChange={(v) => setD({ questionnaire_verify_phone: v })} />
            <span style={{ fontSize: 14, color: '#666' }}>验证手机号</span>
          </div>
        </MSheet>

        <MSheet open={sheet === 'duration'} onClose={closeSheet} title="拍摄时长">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {DURATION_OPTS.map((o) => (
              <button key={o} type="button" onClick={() => { setD({ duration: o }); closeSheet(); }}
                style={{ padding: '12px 16px', borderRadius: 8, border: '1px solid ' + (d.duration === o ? MRED : '#E5E5E5'), background: d.duration === o ? '#FFF5F5' : '#fff', fontSize: 15, color: '#333', textAlign: 'left' }}>{o}</button>
            ))}
          </div>
        </MSheet>

        <MSheet open={sheet === 'rawCount'} onClose={closeSheet} title="原片数量">
          <input autoFocus type="number" value={sheetVal} onChange={(e) => setSheetVal(e.target.value)} placeholder="如 300"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 15, outline: 'none' }} />
          <button type="button" onClick={() => { setD({ raw_count: sheetVal }); closeSheet(); }}
            style={{ width: '100%', marginTop: 16, padding: '12px', borderRadius: 8, background: MRED, color: '#fff', fontSize: 15, border: 'none' }}>确定</button>
        </MSheet>

        <MSheet open={sheet === 'retouch'} onClose={closeSheet} title="精修片数量">
          <input autoFocus type="number" value={sheetVal} onChange={(e) => setSheetVal(e.target.value)} placeholder="如 40"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 15, outline: 'none' }} />
          <button type="button" onClick={() => { setD({ retouch_count: sheetVal }); closeSheet(); }}
            style={{ width: '100%', marginTop: 16, padding: '12px', borderRadius: 8, background: MRED, color: '#fff', fontSize: 15, border: 'none' }}>确定</button>
        </MSheet>

        <MSheet open={sheet === 'extraFee'} onClose={closeSheet} title="加片费">
          <input autoFocus value={sheetVal} onChange={(e) => setSheetVal(e.target.value)} placeholder="如 ¥50.00/张"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 15, outline: 'none' }} />
          <button type="button" onClick={() => { setD({ extra_photo_fee: sheetVal }); closeSheet(); }}
            style={{ width: '100%', marginTop: 16, padding: '12px', borderRadius: 8, background: MRED, color: '#fff', fontSize: 15, border: 'none' }}>确定</button>
        </MSheet>

        <MSheet open={sheet === 'extraDisc'} onClose={closeSheet} title="加片优惠">
          <input autoFocus value={sheetVal} onChange={(e) => setSheetVal(e.target.value)} placeholder="如 满10张9折"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 15, outline: 'none' }} />
          <button type="button" onClick={() => { setD({ extra_photo_discount: sheetVal }); closeSheet(); }}
            style={{ width: '100%', marginTop: 16, padding: '12px', borderRadius: 8, background: MRED, color: '#fff', fontSize: 15, border: 'none' }}>确定</button>
        </MSheet>

        <MSheet open={sheet === 'camera'} onClose={closeSheet} title="拍摄机位">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {CAMERA_OPTS.map((o) => (
              <button key={o} type="button" onClick={() => { setD({ camera_count: o }); closeSheet(); }}
                style={{ padding: '12px 16px', borderRadius: 8, border: '1px solid ' + (d.camera_count === o ? MRED : '#E5E5E5'), background: d.camera_count === o ? '#FFF5F5' : '#fff', fontSize: 15, color: '#333', textAlign: 'left' }}>{o}</button>
            ))}
          </div>
        </MSheet>

        <MSheet open={sheet === 'videoDuration'} onClose={closeSheet} title="成片时长">
          <input autoFocus value={sheetVal} onChange={(e) => setSheetVal(e.target.value)} placeholder="如 40分钟"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 15, outline: 'none' }} />
          <button type="button" onClick={() => { setD({ video_duration: sheetVal }); closeSheet(); }}
            style={{ width: '100%', marginTop: 16, padding: '12px', borderRadius: 8, background: MRED, color: '#fff', fontSize: 15, border: 'none' }}>确定</button>
        </MSheet>

        <MSheet open={sheet === 'delivery'} onClose={closeSheet} title="交付方式">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {DELIVERY_OPTS.map((o) => (
              <button key={o} type="button" onClick={() => { setD({ delivery_method: o }); closeSheet(); }}
                style={{ padding: '12px 16px', borderRadius: 8, border: '1px solid ' + (d.delivery_method === o ? MRED : '#E5E5E5'), background: d.delivery_method === o ? '#FFF5F5' : '#fff', fontSize: 15, color: '#333', textAlign: 'left' }}>{o}</button>
            ))}
          </div>
        </MSheet>

        <MSheet open={sheet === 'cloth'} onClose={closeSheet} title="化妆服装">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 14, color: '#666', marginBottom: 4 }}>服装</div>
            <MRadio value={d.cloth_provide} onChange={(v) => setD({ cloth_provide: v })} options={[{ v: 'not', t: '不提供服装' }, { v: 'provide', t: '提供服装' }]} />
            <div style={{ fontSize: 14, color: '#666', marginTop: 8, marginBottom: 4 }}>化妆</div>
            <MRadio value={d.makeup_provide} onChange={(v) => setD({ makeup_provide: v })} options={[{ v: 'not', t: '不提供化妆' }, { v: 'provide', t: '提供化妆' }]} />
          </div>
          <button type="button" onClick={closeSheet}
            style={{ width: '100%', marginTop: 16, padding: '12px', borderRadius: 8, background: MRED, color: '#fff', fontSize: 15, border: 'none' }}>确定</button>
        </MSheet>

        <MSheet open={sheet === 'album'} onClose={closeSheet} title="提供相册">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[{ v: 'not', t: '否' }, { v: 'provide', t: '是' }, { v: 'extra', t: '相册另购' }].map((o) => (
              <button key={o.v} type="button" onClick={() => { setD({ album_provide: o.v }); closeSheet(); }}
                style={{ padding: '12px 16px', borderRadius: 8, border: '1px solid ' + (d.album_provide === o.v ? MRED : '#E5E5E5'), background: d.album_provide === o.v ? '#FFF5F5' : '#fff', fontSize: 15, color: '#333', textAlign: 'left' }}>{o.t}</button>
            ))}
          </div>
        </MSheet>

        <MSheet open={sheet === 'location'} onClose={closeSheet} title="服务地点">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {LOCATION_OPTS.map((o) => (
              <button key={o} type="button" onClick={() => { setD({ service_location: o }); closeSheet(); }}
                style={{ padding: '12px 16px', borderRadius: 8, border: '1px solid ' + (d.service_location === o ? MRED : '#E5E5E5'), background: d.service_location === o ? '#FFF5F5' : '#fff', fontSize: 15, color: '#333', textAlign: 'left' }}>{o}</button>
            ))}
            <button type="button" onClick={() => { setD({ service_location: '' }); closeSheet(); }}
              style={{ padding: '12px 16px', borderRadius: 8, border: '1px solid ' + (!d.service_location ? MRED : '#E5E5E5'), background: !d.service_location ? '#FFF5F5' : '#fff', fontSize: 15, color: '#333', textAlign: 'left' }}>不显示</button>
          </div>
        </MSheet>

        <MSheet open={sheet === 'warm'} onClose={closeSheet} title="温馨提示">
          <textarea autoFocus value={sheetVal} onChange={(e) => setSheetVal(e.target.value)} rows={4} placeholder="请输入温馨提示"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 15, outline: 'none', resize: 'none' }} />
          <button type="button" onClick={() => { setD({ warm_tips: sheetVal }); closeSheet(); }}
            style={{ width: '100%', marginTop: 16, padding: '12px', borderRadius: 8, background: MRED, color: '#fff', fontSize: 15, border: 'none' }}>确定</button>
        </MSheet>

        <MSheet open={sheet === 'agreement'} onClose={closeSheet} title="顾客协议">
          <textarea autoFocus value={sheetVal} onChange={(e) => setSheetVal(e.target.value)} rows={4} placeholder="填写客户需知 / 协议条款"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 15, outline: 'none', resize: 'none' }} />
          <button type="button" onClick={() => { setD({ customer_agreement: sheetVal }); closeSheet(); }}
            style={{ width: '100%', marginTop: 16, padding: '12px', borderRadius: 8, background: MRED, color: '#fff', fontSize: 15, border: 'none' }}>确定</button>
        </MSheet>

        <MSheet open={sheet === 'visible'} onClose={closeSheet} title="谁可以看">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {['全部可见', '部分可见', '指定客户'].map((o) => (
              <button key={o} type="button" onClick={() => { setD({ public_visible: o }); closeSheet(); }}
                style={{ padding: '12px 16px', borderRadius: 8, border: '1px solid ' + (d.public_visible === o ? MRED : '#E5E5E5'), background: d.public_visible === o ? '#FFF5F5' : '#fff', fontSize: 15, color: '#333', textAlign: 'left' }}>{o}</button>
            ))}
          </div>
        </MSheet>

        {/* 移动端管理分类弹窗（底部 sheet 风格） */}
        {catOpen && (
          <>
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100 }} onClick={() => setCatOpen(false)} />
            <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, background: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, zIndex: 101, padding: '12px 20px calc(20px + env(safe-area-inset-bottom))', maxHeight: '70vh', overflow: 'auto' }}>
              <div style={{ width: 36, height: 4, background: '#DDD', borderRadius: 2, margin: '0 auto 14px' }} />
              <div style={{ fontSize: 16, fontWeight: 500, textAlign: 'center', marginBottom: 16, color: '#333' }}>选择分类</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {categories.filter(Boolean).map((c) => (
                  <button key={c.id} type="button" onClick={() => { setF({ category_id: c.id }); setCatOpen(false); }}
                    style={{ padding: '12px 16px', borderRadius: 8, border: '1px solid ' + (form.category_id === c.id ? MRED : '#E5E5E5'), background: form.category_id === c.id ? '#FFF5F5' : '#fff', fontSize: 15, color: '#333', textAlign: 'left' }}>
                    {c.name || '未命名'}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <input value={catInput} onChange={(e) => setCatInput(e.target.value)} placeholder="新建分类名称"
                  style={{ flex: 1, padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 15, outline: 'none' }}
                  onKeyDown={(e) => e.key === 'Enter' && addCategory()} />
                <button type="button" onClick={addCategory}
                  style={{ padding: '10px 16px', borderRadius: 8, background: MRED, color: '#fff', fontSize: 14, border: 'none' }}>新建</button>
              </div>
            </div>
          </>
        )}

        {/* 什么是调查问卷？说明弹窗 */}
        {qnaHelpOpen && (
          <>
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 200 }} onClick={() => setQnaHelpOpen(false)} />
            <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 201, background: '#fff', borderRadius: 12, width: 'min(340px, 90vw)', padding: '28px 24px 20px', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
              <div style={{ fontSize: 17, fontWeight: 500, textAlign: 'center', color: '#333', marginBottom: 28 }}>什么是调查问卷？</div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* 1. 下单时邀请填写问卷 */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 10, background: '#FFB800', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="13" x2="14" y2="13"/></svg>
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 500, color: '#333', lineHeight: 1.4 }}>下单时邀请填写问卷</div>
                    <div style={{ fontSize: 12, color: '#999', marginTop: 4, lineHeight: 1.4 }}>可邀请客户填写，或设置问卷弹出时机</div>
                  </div>
                </div>

                {/* 2. 自由选配条目 */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 10, background: '#52C41A', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 500, color: '#333', lineHeight: 1.4 }}>自由选配条目</div>
                    <div style={{ fontSize: 12, color: '#999', marginTop: 4, lineHeight: 1.4 }}>根据拍摄类别选择合适的问卷内容</div>
                  </div>
                </div>

                {/* 3. 同步至客户管理 */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 10, background: '#1890FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 500, color: '#333', lineHeight: 1.4 }}>同步至客户管理</div>
                    <div style={{ fontSize: 12, color: '#999', marginTop: 4, lineHeight: 1.4 }}>客户生日云端同步，及时收到生日提醒</div>
                  </div>
                </div>
              </div>

              <button type="button" onClick={() => setQnaHelpOpen(false)}
                style={{ width: '100%', height: 44, borderRadius: 22, background: MRED, color: '#fff', fontSize: 15, fontWeight: 500, border: 'none', marginTop: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                知道了
              </button>
            </div>
          </>
        )}

        {cropOpen && cropSrc && (
          <CropperModal src={cropSrc} onCancel={handleCropCancel} onConfirm={handleCropConfirm} />
        )}
      </div>
    );
  }

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
        <button type="button" onClick={backToPrev}
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
              <input className={inputCls} value={catInput} onChange={(e) => setCatInput(e.target.value)}
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
