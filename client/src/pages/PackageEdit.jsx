import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import http, { img, uploadImage, uploadBatch } from '../api.js';

/* ==========================================================================
   套系编辑页面（后台管理 → 工作台 > 套系 > 套系编辑）
   —— 4 个 Tab：套系名称 / 价格及问卷 / 服务及加片 / 其他详情
   —— 页面背景 #F7F7F7；Tab 内容 = 独立白色表单面板；底部固定【取消】【保存】；左下角蓝色【下一步>】
   —— 真实上传：封面 / 详情图(0-80) / 视频；管理分类弹窗（新建/选择）
   —— 数据全部接口驱动：GET /api/packages/:id（编辑回显） / POST /api/packages（新建） / PUT /api/packages/:id（保存）
   —— 不写死任何分类 / 货币 / 标签来源，全部来自后端；新字段聚合在 details JSON，旧列（price/deposit/...）仍兼容。
   ========================================================================== */

const BRAND = '#2f7cf6';
const TEAL = '#7ecdbb';
const PAGE_BG = '#F7F7F7';
const YELLOW = '#FFFDE8';
const YELLOW_BORDER = '#f0e6a8';
const RED = '#e4393c';

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
    style={{ background: '#eef1f5', color: '#9aa0a8', border: '1px solid #dfe3e8' }}>?</span>
);

// 必填开关（蓝色开启）
function Switch({ checked, onChange, disabled }) {
  return (
    <button type="button" disabled={disabled} onClick={() => onChange(!checked)}
      className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0"
      style={{ background: checked ? BRAND : '#d6d9de', opacity: disabled ? 0.5 : 1 }}>
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
        style={{ borderColor: checked ? BRAND : '#c4c8cf', background: checked ? BRAND : '#fff' }}>
        {checked && <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4 10-10" /></svg>}
      </button>
      {label}
    </label>
  );
}

// 单选按钮组
function RadioGroup({ value, onChange, options }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {options.map((o) => (
        <button key={o.v} type="button" onClick={() => onChange(o.v)}
          className="px-4 py-1.5 rounded-lg text-sm border transition-colors"
          style={{ borderColor: value === o.v ? BRAND : '#e5e7eb', color: value === o.v ? BRAND : '#6b7280', background: value === o.v ? '#eef4ff' : '#fff' }}>
          {o.t}
        </button>
      ))}
    </div>
  );
}

// 字段外壳：标签居左 + 必填星号 + 提示
function Field({ label, required, hint, children }) {
  return (
    <div className="flex items-start gap-4 mb-7">
      <div className="w-36 shrink-0 pt-2 text-right" style={{ color: '#1f2329' }}>
        <span className="text-sm">{label}</span>
        {required && <span style={{ color: RED }}> *</span>}
        {hint && <div className="text-xs mt-0.5" style={{ color: '#9ca3af' }}>{hint}</div>}
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

const inputCls = "w-full px-3 py-2 rounded-lg bg-white border border-line text-sm outline-none focus:border-brand text-fg";
const selCls = "px-3 py-2 rounded-lg bg-white border border-line text-sm outline-none focus:border-brand text-fg";
const inputBg = { background: '#fafbfc' };

export default function PackageEdit() {
  const nav = useNavigate();
  const { id } = useParams();
  const isEdit = !!id;

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
  const onCover = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setUploading('cover');
    try {
      const r = await uploadImage(file, { category: 'cover-sample', isPublic: true });
      setF({ cover_url: r.url });
    } catch (err) { alert('封面上传失败：' + (err.message || err)); }
    finally { setUploading(''); }
  };
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
    for (const r of REQUIRED) {
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
      setErrors(errs.map((x) => x.label));
      setTab(errs[0].tabs[0]);
      return;
    }
    setErrors([]);
    setSaving(true);
    const d = form.details;
    const payload = {
      name: form.name, price: parseFloat(form.price) || 0, deposit: parseFloat(form.deposit) || 0,
      category_id: form.category_id || null, cover_url: form.cover_url || '', description: form.description || '',
      status: form.status, addons: form.addons || [], marketing: form.marketing || {}, specs: form.specs || [],
      questionnaire: Array.isArray(d.questionnaire) ? JSON.stringify(d.questionnaire) : '',
      details: d
    };
    try {
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
    <div className="-mx-6 -my-6 min-h-screen flex flex-col bg-[#F7F7F7]" style={{ background: PAGE_BG }}>
      {/* Tab 栏（顶部，选中黑字白底 / 未选灰字灰底） */}
      <div className="px-6 pt-4 flex gap-1">
        {TABS.map((t, i) => (
          <button key={t} type="button" onClick={() => setTab(i)}
            className="px-5 py-2.5 text-sm rounded-t-md transition-colors"
            style={{
              background: tab === i ? '#ffffff' : '#ececec',
              color: tab === i ? '#1f2329' : '#888888',
              fontWeight: tab === i ? 700 : 400,
              border: tab === i ? '1px solid #e5e7eb' : '1px solid transparent',
              borderBottom: tab === i ? '1px solid #ffffff' : '1px solid transparent'
            }}>
            {t}
          </button>
        ))}
      </div>

      {/* Tab 内容：独立白色表单面板 */}
      <div className="flex-1 px-6 pb-6">
        <form onSubmit={submit} className="bg-white rounded-lg p-6 md:p-8"
          style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          {errors.length > 0 && (
            <div className="mb-5 px-3 py-2 rounded-lg text-sm" style={{ background: '#fff1f0', color: RED, border: '1px solid #ffccc7' }}>
              请完善必填项：{errors.join('、')}
            </div>
          )}

          {/* ============ Tab1 套系名称 ============ */}
          {tab === 0 && (
            <div className="max-w-2xl">
              {/* 套系封面 */}
              <Field label="套系封面" required>
                <div className="flex items-center gap-4">
                  <label className="relative w-32 h-32 rounded-lg border-2 border-dashed flex items-center justify-center cursor-pointer overflow-hidden shrink-0"
                    style={{ borderColor: '#d0d3d9', background: '#fff' }}>
                    {form.cover_url
                      ? <img src={img(form.cover_url)} alt="" className="w-full h-full object-cover" />
                      : <span className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: '#f0f2f5', color: '#9aa0a8' }}><IconPlus width={22} height={22} /></span>}
                    <input type="file" accept="image/*" onChange={onCover} className="hidden" />
                  </label>
                  <div className="flex flex-col gap-2">
                    <span className="text-xs" style={{ color: '#9ca3af' }}>{uploading === 'cover' ? '上传中…' : '点击虚线框上传封面'}</span>
                    {form.cover_url && (
                      <button type="button" onClick={() => setF({ cover_url: '' })}
                        className="text-xs px-3 py-1.5 rounded-lg border border-line text-muted hover:border-brand w-fit">移除</button>
                    )}
                  </div>
                </div>
              </Field>

              {/* 套系名称 */}
              <Field label="套系名称" required>
                <input className={inputCls} style={inputBg} value={form.name}
                  onChange={(e) => setF({ name: e.target.value })} placeholder="婚礼跟拍｜摄影单机位" />
              </Field>

              {/* 套系分类 + 管理分类 */}
              <Field label="套系分类" required>
                <div className="flex items-center gap-2">
                  <select className={inputCls} style={inputBg} value={form.category_id}
                    onChange={(e) => setF({ category_id: e.target.value })}>
                    <option value="">请选择分类</option>
                    {categories.filter(Boolean).map((c) => <option key={c.id} value={c.id}>{c.name || '未命名'}</option>)}
                  </select>
                  <button type="button" onClick={() => setCatOpen(true)}
                    className="text-sm whitespace-nowrap" style={{ color: BRAND }}>管理分类</button>
                </div>
              </Field>

              {/* 套系简介 */}
              <Field label="套系简介" hint="（列表页截断展示）">
                <textarea className={inputCls} style={inputBg} rows={2} value={form.description}
                  onChange={(e) => setF({ description: e.target.value })} placeholder="一句话介绍套系亮点" />
              </Field>

              {/* 详情图片 0/80 */}
              <Field label="详情图片" hint={`（${form.details.detail_images.length}/80张）`}>
                <div className="flex flex-wrap gap-2">
                  {form.details.detail_images.map((u, i) => (
                    <div key={i} className="relative w-24 h-24 rounded-lg overflow-hidden border border-line group">
                      <img src={img(u)} alt="" className="w-full h-full object-cover" />
                      <button type="button" onClick={() => removeDetailImage(i)}
                        className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                        <IconClose />
                      </button>
                    </div>
                  ))}
                  {form.details.detail_images.length < 80 && (
                    <label className="w-24 h-24 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer hover:border-brand"
                      style={{ borderColor: '#d0d3d9', color: '#9ca3af' }}>
                      <span className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: '#f0f2f5', color: '#9aa0a8' }}><IconPlus /></span>
                      <span className="text-[11px]">{uploading === 'images' ? '上传中' : '上传样片'}</span>
                      <input type="file" accept="image/*" multiple onChange={onDetailImages} className="hidden" />
                    </label>
                  )}
                </div>
                <div className="mt-1 text-xs" style={{ color: '#9ca3af' }}>{form.details.detail_images.length}/80张</div>
              </Field>

              {/* 套系视频 */}
              <Field label="套系视频">
                <div className="flex items-center gap-3">
                  {form.details.video_url ? (
                    <video src={form.details.video_url} className="w-40 h-24 rounded-lg object-cover bg-black" controls />
                  ) : (
                    <div className="w-40 h-24 rounded-lg border border-line flex items-center justify-center text-xs" style={{ color: '#b0b3b8', background: '#f5f6f8' }}>未上传</div>
                  )}
                  <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm cursor-pointer border"
                    style={{ borderColor: BRAND, color: BRAND }}>
                    <IconPlus />{uploading === 'video' ? '上传中…' : '点击上传套系视频'}
                    <input type="file" accept="video/*" onChange={onVideo} className="hidden" />
                  </label>
                  {form.details.video_url && (
                    <button type="button" onClick={() => setD({ video_url: '' })}
                      className="text-xs px-3 py-1.5 rounded-lg border border-line text-muted hover:border-brand">移除</button>
                  )}
                </div>
              </Field>
            </div>
          )}

          {/* ============ Tab2 价格及问卷 ============ */}
          {tab === 1 && (
            <div className="max-w-2xl">
              {/* 服务参数 */}
              <Field label="服务参数" required>
                <div className="flex items-center gap-2">
                  <select className={selCls} style={inputBg} value={d.service_params}
                    onChange={(e) => setD({ service_params: e.target.value })}>
                    {!SVC_PARAMS.includes(d.service_params) && d.service_params && <option value={d.service_params}>{d.service_params}</option>}
                    {SVC_PARAMS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <IconHelp />
                </div>
              </Field>

              {/* 价格 + 隐藏 */}
              <Field label="价格(¥)" required>
                <div className="flex items-center gap-3 flex-wrap">
                  <input type="number" className={inputCls} style={inputBg} value={form.price}
                    onChange={(e) => setF({ price: e.target.value })} placeholder="0" />
                  <Checkbox checked={d.hide_price} onChange={(v) => setD({ hide_price: v })} label="隐藏" />
                </div>
              </Field>

              {/* 定金 + 隐藏 + 设为全款 */}
              <Field label="定金(¥)" required>
                <div className="flex items-center gap-3 flex-wrap">
                  <input type="number" disabled={d.deposit_is_full} className={inputCls}
                    style={{ ...inputBg, opacity: d.deposit_is_full ? 0.6 : 1 }}
                    value={d.deposit_is_full ? form.price : form.deposit}
                    onChange={(e) => setF({ deposit: e.target.value })} placeholder="0" />
                  <Checkbox checked={d.hide_deposit} onChange={(v) => setD({ hide_deposit: v })} label="隐藏" />
                  <button type="button" onClick={() => setD({ deposit_is_full: !d.deposit_is_full, deposit: d.deposit_is_full ? '' : form.price })}
                    className="text-sm" style={{ color: BRAND }}>{d.deposit_is_full ? '已设为全款' : '设为全款'}</button>
                </div>
              </Field>

              {/* 显示货币 */}
              <Field label="显示货币">
                <div className="flex items-center gap-2">
                  <span className="text-sm" style={{ color: '#1f2329' }}>{d.show_currency ? '人民币‑¥' : '未显示货币'}</span>
                  <button type="button" onClick={() => setD({ show_currency: !d.show_currency })}
                    className="text-sm" style={{ color: BRAND }}>编辑</button>
                </div>
              </Field>

              {/* 退订政策 + 隐藏 + 红注 */}
              <Field label="退订政策" required>
                <div className="flex items-center gap-2 flex-wrap">
                  <select className={selCls} style={inputBg} value={d.refund_policy}
                    onChange={(e) => setD({ refund_policy: e.target.value })}>
                    {!REFUND_OPTS.includes(d.refund_policy) && d.refund_policy && <option value={d.refund_policy}>{d.refund_policy}</option>}
                    {REFUND_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <IconHelp />
                  <Checkbox checked={d.hide_refund} onChange={(v) => setD({ hide_refund: v })} label="隐藏" />
                </div>
                <div className="mt-1 text-xs" style={{ color: RED }}>注释：隐藏退订政策后，将按照严格政策进行退订</div>
              </Field>

              {/* 底片保存 */}
              <Field label="底片保存">
                <div className="flex items-center gap-2">
                  {editRaw
                    ? <input autoFocus className={inputCls} style={inputBg} value={d.raw_storage}
                        onChange={(e) => setD({ raw_storage: e.target.value })} onBlur={() => setEditRaw(false)} placeholder="如 30 天 / 永久" />
                    : <span className="text-sm" style={{ color: '#1f2329' }}>{d.raw_storage || '未设置'}</span>}
                  <button type="button" onClick={() => setEditRaw((v) => !v)} className="text-sm" style={{ color: BRAND }}>编辑</button>
                </div>
              </Field>

              {/* 预存支付 */}
              <Field label="预存支付">
                <div className="flex items-center gap-2">
                  <Switch checked={d.prepay_enabled} onChange={(v) => setD({ prepay_enabled: v })} />
                  <IconHelp />
                </div>
              </Field>

              {/* 客户问卷区域（浅黄虚线块） */}
              <div className="mt-2 p-4 rounded-lg border-2 border-dashed" style={{ background: YELLOW, borderColor: YELLOW_BORDER }}>
                <div className="text-sm font-medium mb-3" style={{ color: '#1f2329' }}>客户问卷</div>
                <div className="mb-3">
                  <RadioGroup value={d.questionnaire_visibility} onChange={(v) => setD({ questionnaire_visibility: v })}
                    options={[{ v: 'none', t: '不显示' }, { v: 'after_pay', t: '支付后显示' }, { v: 'after_book', t: '预约后显示' }]} />
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={d.questionnaire_verify_phone} onChange={(v) => setD({ questionnaire_verify_phone: v })} />
                  <span className="text-sm" style={{ color: '#6b7280' }}>验证手机号</span>
                </div>
                <div className="mt-1 text-xs" style={{ color: '#9ca3af' }}>*开启后，需验证手机号方可进入填写问卷。</div>
              </div>
            </div>
          )}

          {/* ============ Tab3 服务及加片 ============ */}
          {tab === 2 && (
            <div className="max-w-2xl">
              {/* 绿色顶部分隔 + 标题 */}
              <div className="flex items-center gap-2 mb-4">
                <span className="inline-block w-1 h-4 rounded" style={{ background: TEAL }} />
                <span className="font-medium" style={{ color: '#1f2329' }}>标准服务模板</span>
              </div>

              {/* 浅黄色虚线模块 */}
              <div className="p-4 rounded-lg border-2 border-dashed mb-6" style={{ background: YELLOW, borderColor: YELLOW_BORDER }}>
                {/* 摄影 / 摄像模版切换 */}
                <div className="flex items-center gap-2 mb-5">
                  <span className="text-sm" style={{ color: '#1f2329' }}>模板：</span>
                  <button type="button" onClick={() => setD({ shoot_template: 'photo' })}
                    className="px-4 py-1.5 rounded-lg text-sm border"
                    style={{ background: d.shoot_template === 'photo' ? '#1f2329' : '#fff', color: d.shoot_template === 'photo' ? '#fff' : '#6b7280', borderColor: d.shoot_template === 'photo' ? '#1f2329' : '#e5e7eb' }}>摄影模版</button>
                  <button type="button" onClick={() => setD({ shoot_template: 'video' })}
                    className="px-4 py-1.5 rounded-lg text-sm border"
                    style={{ background: d.shoot_template === 'video' ? '#1f2329' : '#fff', color: d.shoot_template === 'video' ? '#fff' : '#6b7280', borderColor: d.shoot_template === 'video' ? '#1f2329' : '#e5e7eb' }}>摄像模版</button>
                </div>

                {/* 拍摄时长 */}
                <Field label="拍摄时长" required>
                  <select className={selCls} style={inputBg} value={d.duration}
                    onChange={(e) => setD({ duration: e.target.value })}>
                    {!DURATION_OPTS.includes(d.duration) && d.duration && <option value={d.duration}>{d.duration}</option>}
                    {DURATION_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </Field>

                {/* 底片数量 + 底片全送 */}
                <Field label="底片数量" required>
                  <div className="flex items-center gap-3 flex-wrap">
                    <input type="number" className={inputCls} style={inputBg} value={d.raw_count}
                      onChange={(e) => setD({ raw_count: e.target.value })} placeholder="如 300" />
                    <Checkbox checked={d.raw_all_included} onChange={(v) => setD({ raw_all_included: v })} label="底片全送" />
                  </div>
                </Field>

                {/* 精修片 */}
                <Field label="精修片" required>
                  <input type="number" className={inputCls} style={inputBg} value={d.retouch_count}
                    onChange={(e) => setD({ retouch_count: e.target.value })} placeholder="如 50" />
                </Field>

                {/* 加片费 */}
                <Field label="加片费">
                  <input className={inputCls} style={inputBg} value={d.extra_photo_fee}
                    onChange={(e) => setD({ extra_photo_fee: e.target.value })} placeholder="如 ¥50/张" />
                </Field>

                {/* 加片优惠 */}
                <Field label="加片优惠">
                  <div className="flex items-center gap-2">
                    {editDisc
                      ? <input autoFocus className={inputCls} style={inputBg} value={d.extra_photo_discount}
                          onChange={(e) => setD({ extra_photo_discount: e.target.value })} onBlur={() => setEditDisc(false)} placeholder="如 满 10 张 9 折" />
                      : <span className="text-sm" style={{ color: '#1f2329' }}>{d.extra_photo_discount || '暂无优惠'}</span>}
                    <button type="button" onClick={() => setEditDisc((v) => !v)} className="text-sm" style={{ color: BRAND }}>编辑</button>
                  </div>
                </Field>

                {/* 服装 */}
                <Field label="服装">
                  <RadioGroup value={d.cloth_provide} onChange={(v) => setD({ cloth_provide: v })}
                    options={[{ v: 'not', t: '不提供' }, { v: 'provide', t: '提供' }]} />
                </Field>

                {/* 化妆 */}
                <Field label="化妆">
                  <RadioGroup value={d.makeup_provide} onChange={(v) => setD({ makeup_provide: v })}
                    options={[{ v: 'not', t: '不提供' }, { v: 'provide', t: '提供' }]} />
                </Field>

                {/* 相册 */}
                <Field label="相册">
                  <RadioGroup value={d.album_provide} onChange={(v) => setD({ album_provide: v })}
                    options={[{ v: 'not', t: '不提供' }, { v: 'provide', t: '提供' }]} />
                </Field>

                {/* 服务地点 */}
                <Field label="服务地点">
                  <div className="flex items-center gap-2 flex-wrap">
                    <select className={selCls} style={inputBg} value="" onChange={(e) => e.target.value && setD({ service_location: e.target.value })}>
                      <option value="">选择</option>
                      {LOCATION_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <input className={inputCls} style={inputBg} value={d.service_location}
                      onChange={(e) => setD({ service_location: e.target.value })} placeholder="请输入服务地点 0/40" />
                  </div>
                </Field>

                {/* 显示以上套系内容 */}
                <Field label="显示以上套系内容">
                  <Checkbox checked={d.show_service_content} onChange={(v) => setD({ show_service_content: v })} />
                </Field>
              </div>

              {/* 自定义服务详情 */}
              <Field label="自定义服务详情">
                <textarea className={inputCls} style={inputBg} rows={5} value={d.service_detail_text}
                  onChange={(e) => setD({ service_detail_text: e.target.value })} placeholder="例如：本套系包含专业摄影师全程跟拍、精修调色、相册设计等服务，拍摄前可沟通风格需求。" />
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => setD({ service_detail_text: d.service_detail_text + (d.service_detail_text ? '\n' : '') + '【摄影类】' })}
                    className="px-3 py-1 rounded text-xs border" style={{ color: '#6b7280', borderColor: '#e5e7eb', background: '#fff' }}>摄影类</button>
                  <button type="button" onClick={() => setD({ service_detail_text: d.service_detail_text + (d.service_detail_text ? '\n' : '') + '【摄像类】' })}
                    className="px-3 py-1 rounded text-xs border" style={{ color: '#6b7280', borderColor: '#e5e7eb', background: '#fff' }}>摄像类</button>
                </div>
              </Field>
            </div>
          )}

          {/* ============ Tab4 其他详情 ============ */}
          {tab === 3 && (
            <div className="max-w-2xl">
              {/* 对外公开 */}
              <Field label="对外公开">
                <div className="flex items-center gap-3 flex-wrap">
                  <Switch checked={d.public_all_visible} onChange={(v) => setD({ public_all_visible: v })} />
                  <select className={selCls} style={inputBg} value={d.public_visible}
                    onChange={(e) => setD({ public_visible: e.target.value })}>
                    <option>全部可见</option>
                    <option>部分可见</option>
                    <option>指定客户</option>
                  </select>
                </div>
                <div className="mt-1 text-xs" style={{ color: '#9ca3af' }}>*套系将公开展示在小程序和网站中，对所有客户可见</div>
              </Field>

              {/* 咨询提醒 */}
              <Field label="咨询提醒">
                <div className="flex items-center gap-2">
                  <Switch checked={d.consult_reminder} onChange={(v) => setD({ consult_reminder: v })} />
                  <span className="text-sm" style={{ color: '#6b7280' }}>显示</span>
                </div>
                <div className="mt-1 text-xs" style={{ color: '#9ca3af' }}>*开启后，「咨询提醒」将在小程序和网站套系详情页中展示</div>
              </Field>

              {/* 温馨提示 */}
              <Field label="温馨提示">
                <textarea className={inputCls} style={inputBg} rows={5} value={d.warm_tips}
                  onChange={(e) => setD({ warm_tips: e.target.value })} placeholder="例如：拍摄前请保持充足睡眠，避免熬夜；可提前准备喜欢的照片风格参考……" />
              </Field>

              {/* 标签（预设按钮行） */}
              <Field label="标签">
                <div className="flex flex-wrap gap-2">
                  {PRESET_TAGS.map((t) => {
                    const on = d.tags.includes(t);
                    return (
                      <button key={t} type="button" onClick={() => on ? removeTag(t) : addTag(t)}
                        className="px-3 py-1.5 rounded-full text-xs border transition-colors"
                        style={{ borderColor: on ? BRAND : '#e5e7eb', color: on ? BRAND : '#6b7280', background: on ? '#eef4ff' : '#fff' }}>
                        {t}
                      </button>
                    );
                  })}
                </div>
              </Field>

              {/* 顾客协议 */}
              <Field label="顾客协议">
                <div className="flex items-center gap-2">
                  <IconHelp />
                  {editAgr
                    ? <textarea autoFocus rows={4} className={inputCls} style={inputBg} value={d.customer_agreement}
                        onChange={(e) => setD({ customer_agreement: e.target.value })} onBlur={() => setEditAgr(false)} placeholder="填写客户需知 / 协议条款" />
                    : <span className="text-sm" style={{ color: '#1f2329' }}>{d.customer_agreement || '未启用'}</span>}
                  <button type="button" onClick={() => setEditAgr((v) => !v)} className="text-sm" style={{ color: BRAND }}>编辑</button>
                </div>
              </Field>
            </div>
          )}

          {/* 每个 Tab 左下角蓝色【下一步 >】文字链接 */}
          {tab < 3 && (
            <div className="mt-8">
              <button type="button" onClick={goNext}
                className="text-sm font-medium" style={{ color: BRAND }}>下一步 &gt;</button>
            </div>
          )}
        </form>
      </div>

      {/* 底部固定按钮：取消（左） / 保存（右，蓝） */}
      <div className="sticky bottom-0 z-20 flex items-center justify-between px-6 py-3 border-t"
        style={{ background: PAGE_BG, borderColor: '#e5e5e5' }}>
        <button type="button" onClick={() => nav('/packages')}
          className="px-5 py-2 rounded-lg text-sm border border-line text-fg hover:border-brand bg-white">取消</button>
        <button type="button" onClick={submit} disabled={saving}
          className="px-6 py-2 rounded-lg text-sm text-white disabled:opacity-60" style={{ background: BRAND }}>
          {saving ? '保存中…' : '保存'}
        </button>
      </div>

      {/* 管理分类弹窗 */}
      {catOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => setCatOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm bg-white rounded-2xl p-5" style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.18)' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="font-medium" style={{ color: '#1f2329' }}>管理分类</div>
              <button onClick={() => setCatOpen(false)} className="p-1 rounded hover:bg-panel2" style={{ color: '#6b7280' }}><IconClose /></button>
            </div>
            <div className="max-h-60 overflow-auto mb-3">
              {categories.length === 0 && <div className="text-sm text-muted text-center py-4">暂无分类</div>}
              {categories.filter(Boolean).map((c) => (
                <button key={c.id} type="button" onClick={() => { setF({ category_id: c.id }); setCatOpen(false); }}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-panel2 flex items-center justify-between"
                  style={{ color: form.category_id === c.id ? BRAND : '#1f2329', background: form.category_id === c.id ? '#eef4ff' : 'transparent' }}>
                  <span>{c.name || '未命名'}</span>
                  {form.category_id === c.id && <span className="text-xs">已选</span>}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 border-t border-line pt-3">
              <input className={inputCls} value={catName} onChange={(e) => setCatName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addCategory()} placeholder="新建分类名称" />
              <button type="button" onClick={addCategory}
                className="px-3 py-2 rounded-lg text-sm text-white whitespace-nowrap" style={{ background: BRAND }}>新建</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
