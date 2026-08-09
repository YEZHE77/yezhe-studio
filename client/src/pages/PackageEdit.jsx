import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import http, { img, uploadImage, uploadBatch } from '../api.js';

/* ==========================================================================
   套系编辑页面（后台管理 → 工作台 > 套系 > 套系编辑）
   —— 4 个 Tab：套系名称 / 价格及问卷 / 服务及加片 / 其他详情
   —— 顶部面包屑 + 4 Tab；内容滚动；底部固定【取消】【保存】；左下角蓝色【下一步>】
   —— 真实上传：封面 / 详情图(0-80) / 视频；管理分类弹窗（新建/选择）
   —— 数据全部接口驱动：GET /api/packages/:id（编辑回显） / POST /api/packages（新建） / PUT /api/packages/:id（保存）
   —— 不写死任何分类 / 货币 / 标签来源，全部来自后端；新字段聚合在 details JSON，旧列（price/deposit/...）仍兼容。
   ========================================================================== */

const BRAND = '#2f7cf6';
const TEAL = '#7ecdbb';
const PAGE_BG = '#ffffff';

function defaultDetails() {
  return {
    detail_images: [],            // 详情图片 URL 数组（最多 80）
    video_url: '',                // 套系视频 URL
    service_params: '',           // 服务参数（*）
    hide_price: false,            // 价格隐藏
    hide_deposit: false,          // 定金隐藏
    deposit_is_full: false,       // 设为全款（定金=价格）
    show_currency: true,          // 显示货币符号
    refund_policy: '',            // 退订政策（*，带红注释）
    hide_refund: false,           // 退订政策隐藏
    raw_storage: '',              // 底片保存（如 30天 / 永久）
    prepay_enabled: false,        // 预存支付开关
    questionnaire_visibility: 'none', // 客户问卷：none / after_pay / after_book
    questionnaire_verify_phone: false, // 验证手机号开关
    questionnaire: [],            // 问卷模板（数组，兼容旧 questionnaire 列）
    shoot_template: 'photo',      // 摄影 / 摄像
    duration: '',                 // 拍摄时长（*）
    raw_count: '',                // 底片数量（*）
    raw_all_included: false,      // 底片全送
    retouch_count: '',            // 精修片（*）
    extra_photo_fee: '',          // 加片费
    extra_photo_discount: '',     // 加片优惠
    single_service: '',           // 服装 / 化妆 / 相册 单选
    service_location: '',         // 服务地点
    show_service_content: true,   // 显示以上套系内容
    service_detail_text: '',      // 自定义服务详情
    public_all_visible: false,    // 对外公开 + 全部可见
    consult_reminder: false,      // 咨询提醒开关
    warm_tips: '',                // 温馨提示
    tags: [],                     // 标签按钮组
    customer_agreement: ''        // 顾客协议
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
const IconArrowLeft = (p) => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="m15 18-6-6 6-6" /></svg>
);
const IconPlus = (p) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 5v14M5 12h14" /></svg>
);
const IconClose = (p) => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M18 6 6 18M6 6l12 12" /></svg>
);

// 必填开关（青绿强调）
function Switch({ checked, onChange, disabled }) {
  return (
    <button type="button" disabled={disabled} onClick={() => onChange(!checked)}
      className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors"
      style={{ background: checked ? TEAL : '#d6d9de', opacity: disabled ? 0.5 : 1 }}>
      <span className="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform"
        style={{ transform: checked ? 'translateX(18px)' : 'translateX(2px)' }} />
    </button>
  );
}

// 字段外壳：label + 必填星号 + 提示
function Field({ label, required, hint, children }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-1 mb-1.5">
        <span className="text-sm" style={{ color: '#1f2329' }}>{label}</span>
        {required && <span style={{ color: '#e4393c' }}>*</span>}
        {hint && <span className="text-xs" style={{ color: '#9ca3af' }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

const inputCls = "w-full px-3 py-2 rounded-lg bg-white border border-line text-sm outline-none focus:border-brand text-fg";
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
  const [uploading, setUploading] = useState(''); // '', 'cover' | 'images' | 'video'
  const [catOpen, setCatOpen] = useState(false);

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
  const addTag = () => {
    const v = tagInput.trim();
    if (v && !form.details.tags.includes(v)) setD({ tags: [...form.details.tags, v] });
    setTagInput('');
  };
  const removeTag = (t) => setD({ tags: form.details.tags.filter((x) => x !== t) });

  // ---- 多规格配置（specs） ----
  const addSpec = () =>
    setForm((f) => ({ ...f, specs: [...f.specs, { id: 's' + Date.now(), name: '', price: '', deposit: '', duration: '', raw_policy: '', remark: '' }] }));
  const updSpec = (i, k, v) =>
    setForm((f) => ({ ...f, specs: f.specs.map((s, j) => j === i ? { ...s, [k]: v } : s) }));
  const delSpec = (i) =>
    setForm((f) => ({ ...f, specs: f.specs.filter((_, j) => j !== i) }));

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
    e.preventDefault();
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

  return (
    <div className="-m-6 min-h-full flex flex-col" style={{ background: PAGE_BG }}>
      {/* 面包屑由全局 <Breadcrumb /> 渲染 */}

      {/* 标题 */}
      <div className="px-6 pt-5 pb-3 flex items-center justify-between">
        <h1 className="text-xl font-semibold" style={{ color: '#1f2329' }}>{isEdit ? '编辑套系' : '新建套系'}</h1>
      </div>

      {/* Tab 栏 */}
      <div className="px-6 flex gap-2 border-b border-line">
        {['套系名称', '价格及问卷', '服务及加片', '其他详情'].map((t, i) => (
          <button key={t} type="button" onClick={() => setTab(i)}
            className="px-4 py-2.5 text-sm border-b-2 -mb-px transition-colors"
            style={{ borderColor: tab === i ? BRAND : 'transparent', color: tab === i ? BRAND : '#6b7280', fontWeight: tab === i ? 600 : 400 }}>
            {t}
          </button>
        ))}
      </div>

      {/* 内容区（滚动） */}
      <form onSubmit={submit} className="flex-1 overflow-auto px-6 py-5" style={{ background: PAGE_BG }}>
        {errors.length > 0 && (
          <div className="mb-4 px-3 py-2 rounded-lg text-sm" style={{ background: '#fff1f0', color: '#e4393c', border: '1px solid #ffccc7' }}>
            请完善必填项：{errors.join('、')}
          </div>
        )}

        {/* ============ Tab1 套系名称 ============ */}
        {tab === 0 && (
          <div className="max-w-2xl">
            {/* 套系封面 */}
            <Field label="套系封面" required>
              <div className="flex items-center gap-3">
                <div className="w-28 h-28 rounded-lg border border-line overflow-hidden flex items-center justify-center shrink-0"
                  style={{ background: '#f5f6f8' }}>
                  {form.cover_url
                    ? <img src={img(form.cover_url)} alt="" className="w-full h-full object-cover" />
                    : <span className="text-xs" style={{ color: '#b0b3b8' }}>未上传</span>}
                </div>
                <div className="flex flex-col gap-2">
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm cursor-pointer"
                    style={{ background: BRAND, color: '#fff' }}>
                    <IconPlus />{uploading === 'cover' ? '上传中…' : '上传封面'}
                    <input type="file" accept="image/*" onChange={onCover} className="hidden" />
                  </label>
                  {form.cover_url && (
                    <button type="button" onClick={() => setF({ cover_url: '' })}
                      className="text-xs px-3 py-1.5 rounded-lg border border-line text-muted hover:border-brand">移除</button>
                  )}
                </div>
              </div>
            </Field>

            {/* 套系名称 */}
            <Field label="套系名称" required>
              <input className={inputCls} style={inputBg} value={form.name}
                onChange={(e) => setF({ name: e.target.value })} placeholder="如 海岛婚礼跟拍 · 旗舰版" />
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
                  className="px-3 py-2 rounded-lg text-sm border border-line text-fg hover:border-brand whitespace-nowrap">管理分类</button>
              </div>
            </Field>

            {/* 套系简介（列表展示用） */}
            <Field label="套系简介" hint="（列表页截断展示）">
              <textarea className={inputCls} style={inputBg} rows={2} value={form.description}
                onChange={(e) => setF({ description: e.target.value })} placeholder="一句话介绍套系亮点" />
            </Field>

            {/* 详情图片 0/80 */}
            <Field label="详情图片" hint={`（${form.details.detail_images.length}/80 张）`}>
              <div className="flex flex-wrap gap-2">
                {form.details.detail_images.map((u, i) => (
                  <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border border-line group">
                    <img src={img(u)} alt="" className="w-full h-full object-cover" />
                    <button type="button" onClick={() => removeDetailImage(i)}
                      className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                      <IconClose />
                    </button>
                  </div>
                ))}
                {form.details.detail_images.length < 80 && (
                  <label className="w-20 h-20 rounded-lg border border-dashed border-line flex flex-col items-center justify-center gap-1 cursor-pointer hover:border-brand"
                    style={{ color: '#9ca3af' }}>
                    <IconPlus />
                    <span className="text-[11px]">{uploading === 'images' ? '上传中' : '添加'}</span>
                    <input type="file" accept="image/*" multiple onChange={onDetailImages} className="hidden" />
                  </label>
                )}
              </div>
            </Field>

            {/* 套系视频 */}
            <Field label="套系视频">
              <div className="flex items-center gap-3">
                {form.details.video_url ? (
                  <video src={form.details.video_url} className="w-40 h-24 rounded-lg object-cover bg-black" controls />
                ) : (
                  <div className="w-40 h-24 rounded-lg border border-line flex items-center justify-center text-xs" style={{ color: '#b0b3b8', background: '#f5f6f8' }}>未上传</div>
                )}
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm cursor-pointer border border-line text-fg hover:border-brand">
                  <IconPlus />{uploading === 'video' ? '上传中…' : '上传视频'}
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
            <Field label="服务参数" required hint="（如 标准服务 / 高端定制）">
              <input className={inputCls} style={inputBg} value={form.details.service_params}
                onChange={(e) => setD({ service_params: e.target.value })} placeholder="服务参数模板名称" />
            </Field>

            {/* 价格 + 隐藏 */}
            <Field label="价格" required>
              <div className="flex items-center gap-3">
                <input type="number" className={inputCls} style={inputBg} value={form.price}
                  onChange={(e) => setF({ price: e.target.value })} placeholder="0" />
                <label className="flex items-center gap-1.5 text-sm text-muted whitespace-nowrap">
                  <Switch checked={form.details.hide_price} onChange={(v) => setD({ hide_price: v })} />隐藏
                </label>
                <label className="flex items-center gap-1.5 text-sm text-muted whitespace-nowrap">
                  <Switch checked={form.details.show_currency} onChange={(v) => setD({ show_currency: v })} />显示货币
                </label>
              </div>
            </Field>

            {/* 定金 + 隐藏 + 设为全款 */}
            <Field label="定金" required>
              <div className="flex items-center gap-3 flex-wrap">
                <input type="number" disabled={form.details.deposit_is_full} className={inputCls}
                  style={{ ...inputBg, opacity: form.details.deposit_is_full ? 0.6 : 1 }}
                  value={form.details.deposit_is_full ? form.price : form.deposit}
                  onChange={(e) => setF({ deposit: e.target.value })} placeholder="0" />
                <label className="flex items-center gap-1.5 text-sm text-muted whitespace-nowrap">
                  <Switch checked={form.details.hide_deposit} onChange={(v) => setD({ hide_deposit: v })} />隐藏
                </label>
                <button type="button" onClick={() => setD({ deposit_is_full: !form.details.deposit_is_full, deposit: form.details.deposit_is_full ? '' : form.price })}
                  className="px-3 py-1.5 rounded-lg text-sm border border-line text-fg hover:border-brand whitespace-nowrap"
                  style={{ borderColor: form.details.deposit_is_full ? TEAL : undefined, color: form.details.deposit_is_full ? TEAL : undefined }}>
                  {form.details.deposit_is_full ? '已设为全款' : '设为全款'}
                </button>
              </div>
            </Field>

            {/* 上架 / 下架状态（迁移至价格及问卷 Tab） */}
            <Field label="上架 / 下架状态">
              <label className="flex items-center gap-1.5 text-sm text-muted">
                <Switch checked={form.status === 'on'} onChange={(v) => setF({ status: v ? 'on' : 'off' })} />
                {form.status === 'on' ? '上架（小程序展示）' : '下架（隐藏）'}
              </label>
            </Field>

            {/* 退订政策 + 隐藏 + 红注释 */}
            <Field label="退订政策" required>
              <textarea className={inputCls} style={inputBg} rows={3} value={form.details.refund_policy}
                onChange={(e) => setD({ refund_policy: e.target.value })} placeholder="说明定金/尾款退订规则" />
              <div className="mt-1 text-xs" style={{ color: '#e4393c' }}>注：退订政策将直接展示给客户，请务必准确填写，避免纠纷。</div>
              <label className="mt-1.5 flex items-center gap-1.5 text-sm text-muted">
                <Switch checked={form.details.hide_refund} onChange={(v) => setD({ hide_refund: v })} />隐藏退订政策
              </label>
            </Field>

            {/* 底片保存 + 预存支付 */}
            <Field label="底片保存">
              <div className="flex items-center gap-3 flex-wrap">
                <input className={inputCls} style={inputBg} value={form.details.raw_storage}
                  onChange={(e) => setD({ raw_storage: e.target.value })} placeholder="如 30 天 / 永久" />
                <label className="flex items-center gap-1.5 text-sm text-muted whitespace-nowrap">
                  <Switch checked={form.details.prepay_enabled} onChange={(v) => setD({ prepay_enabled: v })} />预存支付
                </label>
              </div>
            </Field>

            {/* 客户问卷区域 */}
            <div className="mt-2 p-3 rounded-lg border border-line" style={{ background: '#fafbfc' }}>
              <div className="text-sm font-medium mb-2" style={{ color: '#1f2329' }}>客户问卷</div>
              <div className="flex items-center gap-2 mb-2">
                {[
                  { v: 'none', t: '不显示' },
                  { v: 'after_pay', t: '支付后显示' },
                  { v: 'after_book', t: '预约后显示' }
                ].map((o) => (
                  <button key={o.v} type="button" onClick={() => setD({ questionnaire_visibility: o.v })}
                    className="px-3 py-1.5 rounded-lg text-sm border"
                    style={{ borderColor: form.details.questionnaire_visibility === o.v ? BRAND : '#e5e7eb', color: form.details.questionnaire_visibility === o.v ? BRAND : '#6b7280', background: form.details.questionnaire_visibility === o.v ? '#eef4ff' : '#fff' }}>
                    {o.t}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-1.5 text-sm text-muted">
                <Switch checked={form.details.questionnaire_verify_phone} onChange={(v) => setD({ questionnaire_verify_phone: v })} />验证手机号
              </label>
            </div>
          </div>
        )}

        {/* ============ Tab3 服务及加片 ============ */}
        {tab === 3 && (
          <div className="max-w-2xl">
            {/* 多规格配置（同一套系多个版本，客户可选） */}
            <Field label="多规格配置" hint="（同一套系可配多个版本，客户在小程序可切换）">
              <div className="space-y-3">
                {form.specs.map((s, i) => (
                  <div key={s.id || i} className="border border-line rounded-lg p-3 flex flex-col gap-2" style={{ background: '#fafbfc' }}>
                    <div className="flex items-center gap-2">
                      <input className={inputCls} style={inputBg} value={s.name} onChange={(e) => updSpec(i, 'name', e.target.value)} placeholder="规格名称（如 经典版 / 旗舰版）" />
                      <button type="button" onClick={() => delSpec(i)} className="px-2 py-1.5 rounded text-xs border border-line text-red-500 hover:border-red-400 whitespace-nowrap">删除</button>
                    </div>
                    <div className="flex gap-2">
                      <input type="number" className={inputCls} style={inputBg} value={s.price} onChange={(e) => updSpec(i, 'price', e.target.value)} placeholder="价格" />
                      <input type="number" className={inputCls} style={inputBg} value={s.deposit} onChange={(e) => updSpec(i, 'deposit', e.target.value)} placeholder="定金" />
                    </div>
                    <input className={inputCls} style={inputBg} value={s.duration} onChange={(e) => updSpec(i, 'duration', e.target.value)} placeholder="拍摄时长（如 全天）" />
                    <input className={inputCls} style={inputBg} value={s.raw_policy} onChange={(e) => updSpec(i, 'raw_policy', e.target.value)} placeholder="底片政策" />
                    <input className={inputCls} style={inputBg} value={s.remark} onChange={(e) => updSpec(i, 'remark', e.target.value)} placeholder="规格说明（如 含 2 套服装）" />
                  </div>
                ))}
                <button type="button" onClick={addSpec} className="text-sm" style={{ color: BRAND }}>+ 添加规格</button>
              </div>
            </Field>

            {/* 显示设置：全部可见 / 咨询提醒 */}
            <Field label="显示设置">
              <div className="flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-1.5 text-sm text-muted">
                  <Switch checked={form.details.public_all_visible} onChange={(v) => setD({ public_all_visible: v })} />全部可见
                </label>
                <label className="flex items-center gap-1.5 text-sm text-muted">
                  <Switch checked={form.details.consult_reminder} onChange={(v) => setD({ consult_reminder: v })} />咨询提醒
                </label>
              </div>
            </Field>

            {/* 标签按钮组 */}
            <Field label="标签">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                {form.details.tags.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs"
                    style={{ background: '#eaf5ef', color: '#3a9d7a' }}>
                    {t}
                    <button type="button" onClick={() => removeTag(t)} className="hover:text-red-500"><IconClose /></button>
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input className={inputCls} style={inputBg} value={tagInput} onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())} placeholder="输入标签后回车添加" />
                <button type="button" onClick={addTag} className="px-3 py-2 rounded-lg text-sm border border-line text-fg hover:border-brand">添加</button>
              </div>
            </Field>

            {/* 顾客协议 */}
            <Field label="顾客协议">
              <textarea className={inputCls} style={inputBg} rows={4} value={form.details.customer_agreement}
                onChange={(e) => setD({ customer_agreement: e.target.value })} placeholder="填写客户需知 / 协议条款" />
            </Field>
          </div>
        )}

        {/* ============ Tab3 服务及加片（第三 Tab） ============ */}
        {tab === 2 && (
          <div className="max-w-2xl">
            {/* 摄影 / 摄像模板 */}
            <Field label="摄影 / 摄像模板">
              <div className="flex items-center gap-2">
                {[
                  { v: 'photo', t: '摄影' },
                  { v: 'video', t: '摄像' }
                ].map((o) => (
                  <button key={o.v} type="button" onClick={() => setD({ shoot_template: o.v })}
                    className="px-4 py-1.5 rounded-lg text-sm border"
                    style={{ borderColor: form.details.shoot_template === o.v ? BRAND : '#e5e7eb', color: form.details.shoot_template === o.v ? BRAND : '#6b7280', background: form.details.shoot_template === o.v ? '#eef4ff' : '#fff' }}>
                    {o.t}
                  </button>
                ))}
              </div>
            </Field>

            {/* 拍摄时长 */}
            <Field label="拍摄时长" required>
              <input className={inputCls} style={inputBg} value={form.details.duration}
                onChange={(e) => setD({ duration: e.target.value })} placeholder="如 全天 / 6 小时" />
            </Field>

            {/* 底片数量 + 底片全送 */}
            <Field label="底片数量" required>
              <div className="flex items-center gap-3">
                <input type="number" className={inputCls} style={inputBg} value={form.details.raw_count}
                  onChange={(e) => setD({ raw_count: e.target.value })} placeholder="如 300" />
                <label className="flex items-center gap-1.5 text-sm text-muted whitespace-nowrap">
                  <Switch checked={form.details.raw_all_included} onChange={(v) => setD({ raw_all_included: v })} />底片全送
                </label>
              </div>
            </Field>

            {/* 精修片 */}
            <Field label="精修片" required>
              <input type="number" className={inputCls} style={inputBg} value={form.details.retouch_count}
                onChange={(e) => setD({ retouch_count: e.target.value })} placeholder="如 50" />
            </Field>

            {/* 加片费 / 加片优惠 */}
            <div className="flex gap-3">
              <div className="flex-1">
                <Field label="加片费">
                  <input className={inputCls} style={inputBg} value={form.details.extra_photo_fee}
                    onChange={(e) => setD({ extra_photo_fee: e.target.value })} placeholder="如 ¥50/张" />
                </Field>
              </div>
              <div className="flex-1">
                <Field label="加片优惠">
                  <input className={inputCls} style={inputBg} value={form.details.extra_photo_discount}
                    onChange={(e) => setD({ extra_photo_discount: e.target.value })} placeholder="如 满 10 张 9 折" />
                </Field>
              </div>
            </div>

            {/* 服装 / 化妆 / 相册 单选 */}
            <Field label="服装 / 化妆 / 相册">
              <div className="flex items-center gap-2">
                {['服装', '化妆', '相册'].map((o) => (
                  <button key={o} type="button" onClick={() => setD({ single_service: o })}
                    className="px-4 py-1.5 rounded-lg text-sm border"
                    style={{ borderColor: form.details.single_service === o ? BRAND : '#e5e7eb', color: form.details.single_service === o ? BRAND : '#6b7280', background: form.details.single_service === o ? '#eef4ff' : '#fff' }}>
                    {o}
                  </button>
                ))}
                {form.details.single_service && (
                  <button type="button" onClick={() => setD({ single_service: '' })} className="text-xs text-muted hover:text-red-500">清除</button>
                )}
              </div>
            </Field>

            {/* 服务地点 */}
            <Field label="服务地点">
              <input className={inputCls} style={inputBg} value={form.details.service_location}
                onChange={(e) => setD({ service_location: e.target.value })} placeholder="如 海口 / 三亚 / 指定场地" />
            </Field>

            {/* 显示以上套系内容 */}
            <Field label="显示以上套系内容">
              <label className="flex items-center gap-1.5 text-sm text-muted">
                <Switch checked={form.details.show_service_content} onChange={(v) => setD({ show_service_content: v })} />在小程序展示以上服务明细
              </label>
            </Field>

            {/* 自定义服务详情 */}
            <Field label="自定义服务详情">
              <textarea className={inputCls} style={inputBg} rows={4} value={form.details.service_detail_text}
                onChange={(e) => setD({ service_detail_text: e.target.value })} placeholder="补充服务说明（自由文本）" />
            </Field>

            {/* 温馨提示（迁移至服务及加片 Tab） */}
            <Field label="温馨提示">
              <textarea className={inputCls} style={inputBg} rows={2} value={form.details.warm_tips}
                onChange={(e) => setD({ warm_tips: e.target.value })} placeholder="如 拍摄前请保持充足睡眠" />
            </Field>
          </div>
        )}
      </form>

      {/* 底部固定栏 */}
      <div className="sticky bottom-0 border-t border-line bg-white px-6 py-3 flex items-center justify-between">
        <div>
          {tab < 3 && (
            <button type="button" onClick={goNext}
              className="px-4 py-2 rounded-lg text-sm text-white" style={{ background: BRAND }}>下一步 &gt;</button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => nav('/packages')}
            className="px-5 py-2 rounded-lg text-sm border border-line text-fg hover:border-brand">取消</button>
          <button type="button" onClick={submit} disabled={saving}
            className="px-6 py-2 rounded-lg text-sm text-white disabled:opacity-60" style={{ background: BRAND }}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
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
