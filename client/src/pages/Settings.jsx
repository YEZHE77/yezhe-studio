import React, { useState, useEffect, useRef } from 'react';
import http, { img, compressImage, uploadImage, downloadBackup } from '../api.js';
import ImageCropper from '../components/ImageCropper.jsx';

const EMPTY = {
  name: '叶哲 STUDIO', logo: '', cover: '', heroImages: [],
  // 幻灯片背景音乐（BGM）HTTPS 地址；留空则用前端内置打包的本地 MP3（当前默认《The Way You Look Tonight - Tony Bennett》）
  bgmUrl: '',
  // 客服微信二维码：小程序首页「添加客服」弹窗展示，客户长按保存添加；不裁剪、保持完整
  serviceQr: '',
  intro: '海口婚礼 / 人像摄影 · YEZHE WORKSHOP',
  // 品牌 Slogan：首页工作室名称下方浅灰小字（为空则不渲染）
  slogan: '拍摄有温度的照片，记录平凡生活中的美好。',
  contact: { phone: '', wechat: '', address: '' },
  // 客户小程序：qr 为小程序码图片（工作台首页「小程序」入口弹窗展示，微信内长按识别进入）
  miniProgram: { enabled: false, appid: '', qr: '' },
  // 客户自助查订单：价格是否对 C 端客户展示（默认关闭，保护报价隐私）
  showPriceToCustomer: false,
  // 公开作品集 H5 链接（客户自助查订单页「查看作品集」跳转按钮；留空隐藏）
  portfolioUrl: ''
};

const inputCls = 'w-full border border-line rounded-lg px-3 py-2 text-sm bg-panel text-fg outline-none focus:border-brand';

function Field({ label, children }) {
  return (
    <label className="block mb-4">
      <div className="text-xs text-muted mb-1.5">{label}</div>
      {children}
    </label>
  );
}

export default function Settings() {
  const [form, setForm] = useState(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tip, setTip] = useState('');
  const logoRef = useRef();
  const coverRef = useRef();
  const heroRef = useRef();
  const serviceQrRef = useRef();
  const miniQrRef = useRef();
  const [heroBusy, setHeroBusy] = useState(false);
  const [crop, setCrop] = useState(null);
  const [heroDragged, setHeroDragged] = useState(null);
  const [heroOver, setHeroOver] = useState(null);

  // 对外预约设置：开放开关 + 每周可约日（0=周日 … 6=周六）
  const [booking, setBooking] = useState({ open: true, openDays: [0, 1, 2, 3, 4, 5, 6] });
  const [bookingLoaded, setBookingLoaded] = useState(false);
  const [bookingSaving, setBookingSaving] = useState(false);
  const [bookingTip, setBookingTip] = useState('');
  const DAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  // 账户安全：修改密码
  const [pwOld, setPwOld] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwTip, setPwTip] = useState('');

  // 数据备份：手动导出全量业务 JSON
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupTip, setBackupTip] = useState('');
  async function doBackup() {
    if (backupBusy) return;
    setBackupBusy(true);
    setBackupTip('正在生成备份…');
    try {
      await downloadBackup();
      setBackupTip('已导出完整业务 JSON 到本地（图片二进制已在 R2，不在备份内）');
    } catch (e) {
      setBackupTip('导出失败：' + (e.response?.data?.error || e.message));
    } finally { setBackupBusy(false); }
  }

  useEffect(() => {
    http.get('/api/settings/studio').then((r) => {
      const d = r.data || {};
      setForm({
        name: d.name || EMPTY.name,
        logo: d.logo || '', cover: d.cover || '',
        heroImages: Array.isArray(d.heroImages) ? d.heroImages : [],
        bgmUrl: d.bgmUrl !== undefined ? d.bgmUrl : EMPTY.bgmUrl,
        serviceQr: d.serviceQr || '',
        intro: d.intro || EMPTY.intro,
        slogan: d.slogan !== undefined ? d.slogan : EMPTY.slogan,
        contact: { phone: (d.contact && d.contact.phone) || '', wechat: (d.contact && d.contact.wechat) || '', address: (d.contact && d.contact.address) || '' },
        miniProgram: {
          enabled: !!(d.miniProgram && (d.miniProgram.enabled || d.miniProgram.qr)),
          appid: (d.miniProgram && d.miniProgram.appid) || '',
          qr: (d.miniProgram && d.miniProgram.qr) || ''
        },
        showPriceToCustomer: !!d.showPriceToCustomer,
        portfolioUrl: d.portfolioUrl || ''
      });
      setLoaded(true);
    }).catch(() => setLoaded(true));

    http.get('/api/settings/booking').then((r) => {
      const d = r.data || {};
      setBooking({
        open: d.open !== undefined ? !!d.open : true,
        openDays: Array.isArray(d.openDays) ? d.openDays.map((x) => Number(x)).filter((x) => x >= 0 && x <= 6) : [0, 1, 2, 3, 4, 5, 6]
      });
      setBookingLoaded(true);
    }).catch(() => setBookingLoaded(true));
  }, []);

  function set(path, val) {
    setForm((f) => {
      const next = { ...f };
      if (path === 'phone') next.contact = { ...next.contact, phone: val };
      else if (path === 'wechat') next.contact = { ...next.contact, wechat: val };
      else if (path === 'address') next.contact = { ...next.contact, address: val };
      else if (path === 'miniProgram') next.miniProgram = { ...next.miniProgram, ...val };
      else next[path] = val;
      return next;
    });
  }

  async function upload(file, kind) {
    if (!file) return;
    try {
      const compressed = await compressImage(file, { maxWidth: 1280, maxHeight: 1280, quality: 0.82 });
      const r = await uploadImage(compressed, { category: 'backup', isPublic: true });
      set(kind, r.url);
    } catch (e) {
      const msg = e.response?.data?.error || e.message || '上传失败';
      setTip('上传失败：' + msg);
      setTimeout(() => setTip(''), 5000);
      throw e;
    }
  }

  function startCrop(file, kind, aspectRatio, outputWidth, outputHeight) {
    setCrop({ file, kind, aspectRatio, outputWidth, outputHeight });
  }

  async function onCropped(croppedFile) {
    if (!crop) return;
    try {
      await upload(croppedFile, crop.kind);
    } finally {
      setCrop(null);
    }
  }

  // 客服微信二维码：原图直传、不裁剪、不压缩，保证二维码清晰可扫
  async function uploadQr(file) {
    if (!file) return;
    try {
      const r = await uploadImage(file, { category: 'backup', isPublic: true });
      set('serviceQr', r.url);
    } catch (e) {
      const msg = e.response?.data?.error || e.message || '上传失败';
      setTip('二维码上传失败：' + msg);
      setTimeout(() => setTip(''), 5000);
    }
  }

  // 小程序码：原图直传、不压缩，保证微信长按识别成功
  async function uploadMiniQr(file) {
    if (!file) return;
    try {
      const r = await uploadImage(file, { category: 'backup', isPublic: true });
      set('miniProgram', { enabled: true, qr: r.url });
    } catch (e) {
      const msg = e.response?.data?.error || e.message || '上传失败';
      setTip('小程序码上传失败：' + msg);
      setTimeout(() => setTip(''), 5000);
    }
  }
  function removeMiniQr() {
    set('miniProgram', { enabled: false, qr: '' });
  }

  // 首页轮播图：支持一次选多张，顺序即展示顺序
  async function addHeroFiles(files) {
    const arr = Array.from(files || []);
    if (!arr.length || heroBusy) return;
    setHeroBusy(true);
    try {
      for (const f of arr) {
        const compressed = await compressImage(f, { maxWidth: 1600, maxHeight: 1600, quality: 0.82 });
        const r = await uploadImage(compressed, { category: 'cover', isPublic: true });
        if (r && r.url) {
          setForm((fm) => ({ ...fm, heroImages: [...fm.heroImages, r.url] }));
        }
      }
    } catch (e) {
      setTip('轮播图上传失败：' + (e.response?.data?.error || e.message));
      setTimeout(() => setTip(''), 3000);
    } finally { setHeroBusy(false); }
  }
  function removeHero(idx) {
    setForm((fm) => ({ ...fm, heroImages: fm.heroImages.filter((_, i) => i !== idx) }));
  }
  // 拖拽调整轮播图顺序
  function onHeroDragStart(e, i) {
    setHeroDragged(i);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(i));
  }
  function onHeroDragOver(e, i) {
    e.preventDefault();
    if (i !== heroDragged) setHeroOver(i);
  }
  function onHeroDrop(e, i) {
    e.preventDefault();
    if (heroDragged === null || heroDragged === i) { resetHeroDrag(); return; }
    setForm((fm) => {
      const arr = [...fm.heroImages];
      const [moved] = arr.splice(heroDragged, 1);
      arr.splice(i, 0, moved);
      return { ...fm, heroImages: arr };
    });
    resetHeroDrag();
  }
  function resetHeroDrag() { setHeroDragged(null); setHeroOver(null); }

  async function save() {
    setSaving(true); setTip('');
    try {
      await http.put('/api/settings/studio', form);
      setTip('已保存，小程序「关于我们」实时生效');
    } catch (e) { setTip('保存失败：' + (e.response?.data?.error || e.message)); }
    setSaving(false);
    setTimeout(() => setTip(''), 3000);
  }

  function setBookingOpen(v) {
    setBooking((b) => ({ ...b, open: v }));
  }
  function toggleDay(d) {
    setBooking((b) => {
      const has = b.openDays.includes(d);
      const openDays = has
        ? b.openDays.filter((x) => x !== d)
        : [...b.openDays, d].sort((a, b) => a - b);
      return { ...b, openDays };
    });
  }
  async function saveBooking() {
    setBookingSaving(true); setBookingTip('');
    try {
      await http.put('/api/settings/booking', booking);
      setBookingTip('已保存，小程序预约入口与可约日实时生效');
    } catch (e) { setBookingTip('保存失败：' + (e.response?.data?.error || e.message)); }
    setBookingSaving(false);
    setTimeout(() => setBookingTip(''), 3000);
  }

  async function changePassword() {
    setPwTip('');
    if (pwNew.length < 8) { setPwTip('新密码至少 8 位'); return; }
    if (!/[A-Z]/.test(pwNew)) { setPwTip('新密码需包含大写字母'); return; }
    if (!/[a-z]/.test(pwNew)) { setPwTip('新密码需包含小写字母'); return; }
    if (!/[0-9]/.test(pwNew)) { setPwTip('新密码需包含数字'); return; }
    if (pwNew !== pwConfirm) { setPwTip('两次输入的新密码不一致'); return; }
    setPwSaving(true);
    try {
      await http.put('/api/auth/password', { oldPassword: pwOld, newPassword: pwNew });
      setPwTip('✅ 密码修改成功，下次登录请使用新密码');
      setPwOld(''); setPwNew(''); setPwConfirm('');
    } catch (e) { setPwTip('修改失败：' + (e.response?.data?.error || e.message)); }
    setPwSaving(false);
    setTimeout(() => setPwTip(''), 3000);
  }

  return (
    <div className="max-w-[1050px] max-md:max-w-full">
      <div className="flex items-center justify-between mb-4 max-md:mb-3 max-md:px-4 max-md:pt-2">
        <div>
          <h1 className="text-xl font-semibold text-fg max-md:text-lg">资料设置</h1>
          <p className="text-xs text-muted mt-0.5 max-md:text-[11px] max-md:leading-tight max-md:max-w-[260px]">工作室对外资料 · 保存后 C 端小程序「关于我们」实时同步</p>
        </div>
        <button onClick={save} disabled={saving || !loaded}
          className="px-5 py-2 rounded-lg bg-brand text-white text-sm hover:opacity-90 disabled:opacity-50 max-md:px-4 max-md:py-1.5 max-md:text-xs max-md:rounded-md">
          {saving ? '保存中…' : '保存'}
        </button>
      </div>

      {tip && <div className="mb-4 text-sm px-4 py-2 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 max-md:text-xs max-md:mx-4">{tip}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-md:gap-0">
        {/* 表单 */}
        <div className="bg-panel border border-line rounded-xl2 p-5 max-md:rounded-none max-md:border-x-0 max-md:border-t-0 max-md:p-4 max-md:bg-white">
          <Field label="工作室名称">
            <input className={inputCls + ' max-md:py-2.5'} value={form.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="品牌 Slogan（首页工作室名称下方浅灰小字 · 留空则不显示）">
            <input className={inputCls + ' max-md:py-2.5'} value={form.slogan} onChange={(e) => set('slogan', e.target.value)} placeholder="拍摄有温度的照片，记录平凡生活中的美好。" />
          </Field>
          <Field label="幻灯片背景音乐 BGM（留空则用前端内置本地 MP3）">
            <input className={inputCls + ' max-md:py-2.5'} value={form.bgmUrl} onChange={(e) => set('bgmUrl', e.target.value)} placeholder="可选：填自有 CDN/R2 代理的 MP3 地址" />
            <p className="text-xs text-muted mt-1 max-md:text-[11px] max-md:leading-relaxed">留空 → 使用已打包进前端的本地 MP3（当前默认《Kiss The Rain - Yiruma》）；要替换曲子可在此填自有 CDN/R2 代理地址。</p>
          </Field>
          <Field label="简介 / 品牌故事（关于我们页正文）">
            <textarea className={inputCls + ' h-20 resize-none max-md:py-2.5'} value={form.intro} onChange={(e) => set('intro', e.target.value)} />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-md:gap-4">
            <Field label="联系电话"><input className={inputCls + ' max-md:py-2.5'} value={form.contact.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
            <Field label="微信号"><input className={inputCls + ' max-md:py-2.5'} value={form.contact.wechat} onChange={(e) => set('wechat', e.target.value)} /></Field>
            <Field label="地址"><input className={inputCls + ' max-md:py-2.5'} value={form.contact.address} onChange={(e) => set('address', e.target.value)} /></Field>
          </div>
          <Field label="客户自助查订单">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-fg">
                <input type="checkbox" checked={!!form.showPriceToCustomer} onChange={(e) => set('showPriceToCustomer', e.target.checked)} className="h-4 w-4 accent-[#7ECDBB]" />
                向 C 端客户展示价格字段
              </label>
            </div>
            <input className={inputCls + ' mt-3 max-md:py-2.5'} value={form.portfolioUrl} onChange={(e) => set('portfolioUrl', e.target.value)} placeholder="公开作品集 H5 链接（如 https://…/home）" />
            <p className="text-xs text-muted mt-1 max-md:text-[11px] max-md:leading-relaxed">查订单页「查看作品集」跳转按钮的地址；留空则隐藏该按钮。价格开关默认关闭以保护报价隐私。</p>
          </Field>
          <Field label="Logo">
            <div className="flex items-center gap-3 max-md:flex-col max-md:items-start">
              {form.logo && <img src={img(form.logo)} alt="" loading="lazy" decoding="async" className="w-14 h-14 rounded-lg object-cover border border-line max-md:w-16 max-md:h-16" />}
              <div className="flex items-center gap-2">
                <button onClick={() => logoRef.current.click()} className="px-3 py-1.5 rounded-lg border border-line text-sm text-muted hover:text-brand hover:border-brand max-md:text-xs">上传 Logo</button>
                <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={(e) => startCrop(e.target.files[0], 'logo', 1, 400, 400)} />
              </div>
            </div>
          </Field>
          <Field label="封面图（关于我们页封面）">
            <div className="flex items-center gap-3 max-md:flex-col max-md:items-start">
              {form.cover && <img src={img(form.cover)} alt="" loading="lazy" decoding="async" className="w-24 h-16 rounded-lg object-cover border border-line max-md:w-full max-md:h-auto max-md:aspect-[16/9]" />}
              <div className="flex items-center gap-2">
                <button onClick={() => coverRef.current.click()} className="px-3 py-1.5 rounded-lg border border-line text-sm text-muted hover:text-brand hover:border-brand max-md:text-xs">上传封面</button>
                <input ref={coverRef} type="file" accept="image/*" className="hidden" onChange={(e) => startCrop(e.target.files[0], 'cover', 16 / 9, 1200, 675)} />
              </div>
            </div>
          </Field>
          <Field label="客服微信二维码（小程序首页「添加客服」弹窗展示）">
            <div className="flex items-center gap-3 max-md:flex-col max-md:items-start">
              {form.serviceQr && <img src={img(form.serviceQr)} alt="" loading="lazy" decoding="async" className="w-28 h-28 rounded-lg object-contain border border-line bg-panel2 max-md:w-24 max-md:h-24" />}
              <div className="flex items-center gap-2">
                <button onClick={() => serviceQrRef.current.click()} className="px-3 py-1.5 rounded-lg border border-line text-sm text-muted hover:text-brand hover:border-brand max-md:text-xs">上传二维码</button>
                {form.serviceQr && <button onClick={() => set('serviceQr', '')} className="px-2 py-1.5 rounded-lg border border-line text-sm text-muted hover:text-red-500 hover:border-red-300 max-md:text-xs">移除</button>}
                <input ref={serviceQrRef} type="file" accept="image/*" className="hidden" onChange={(e) => uploadQr(e.target.files[0])} />
              </div>
            </div>
            <p className="text-xs text-muted mt-1 max-md:text-[11px] max-md:leading-relaxed">建议上传正方形微信二维码 PNG/JPG；小程序弹窗内客户<b>长按即可保存图片、扫码添加客服</b>。留空则小程序弹窗提示「暂未配置客服二维码」。</p>
          </Field>
          <Field label="小程序码（工作台首页「小程序」入口弹窗展示）">
            <div className="flex items-center gap-3 max-md:flex-col max-md:items-start">
              {form.miniProgram.qr && <img src={img(form.miniProgram.qr)} alt="" loading="lazy" decoding="async" className="w-28 h-28 rounded-lg object-contain border border-line bg-panel2 max-md:w-24 max-md:h-24" />}
              <div className="flex items-center gap-2">
                <button onClick={() => miniQrRef.current.click()} className="px-3 py-1.5 rounded-lg border border-line text-sm text-muted hover:text-brand hover:border-brand max-md:text-xs">上传小程序码</button>
                {form.miniProgram.qr && <button onClick={removeMiniQr} className="px-2 py-1.5 rounded-lg border border-line text-sm text-muted hover:text-red-500 hover:border-red-300 max-md:text-xs">移除</button>}
                <input ref={miniQrRef} type="file" accept="image/*" className="hidden" onChange={(e) => uploadMiniQr(e.target.files[0])} />
              </div>
            </div>
            <p className="text-xs text-muted mt-1 max-md:text-[11px] max-md:leading-relaxed">在微信公众平台「小程序码」处下载二维码图片上传（需发布过的小程序）。客户在工作台首页点击<b>「小程序」</b>时，微信内可<b>长按识别</b>直接进入你的客户小程序；留空则弹窗提示「暂未配置」。</p>
          </Field>
          <Field label={`首页轮播图（多张 · ${form.heroImages.length} 张）`}>
            <div className="flex flex-wrap gap-3 items-start max-md:gap-2">
              {form.heroImages.map((u, i) => (
                <div key={i}
                  draggable
                  onDragStart={(e) => onHeroDragStart(e, i)}
                  onDragOver={(e) => onHeroDragOver(e, i)}
                  onDrop={(e) => onHeroDrop(e, i)}
                  onDragEnd={resetHeroDrag}
                  className={`relative w-32 aspect-[16/9] rounded-lg overflow-hidden border group cursor-grab active:cursor-grabbing select-none max-md:w-24
                    ${heroOver === i && heroDragged !== null && heroDragged !== i ? 'border-brand ring-2 ring-brand' : 'border-line'}
                    ${heroDragged === i ? 'opacity-40' : ''}`}>
                  <img src={img(u)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" draggable={false} />
                  <button type="button" onClick={() => removeHero(i)} onMouseDown={(e) => e.stopPropagation()}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-xs leading-none flex items-center justify-center opacity-0 group-hover:opacity-100">×</button>
                  <span className="absolute bottom-0 left-0 px-1 text-[10px] text-white bg-black/50">{i + 1}</span>
                </div>
              ))}
              <button type="button" onClick={() => heroRef.current.click()} disabled={heroBusy}
                className="w-32 aspect-[16/9] rounded-lg border border-dashed border-line text-xs text-muted flex flex-col items-center justify-center gap-1 hover:text-brand hover:border-brand disabled:opacity-50 max-md:w-24">
                {heroBusy ? '上传中…' : '+ 添加'}
              </button>
              <input ref={heroRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addHeroFiles(e.target.files)} />
            </div>
            <p className="text-xs text-muted mt-2 max-md:text-[11px] max-md:leading-relaxed">建议上传 16:9 比例照片；支持一次选多张；<b>拖拽缩略图即可调整轮播顺序</b>。删除：鼠标移到图片上点右上角 ×。</p>
          </Field>
        </div>

        {/* 预览（手机端隐藏，节省空间） */}
        <div className="bg-panel border border-line rounded-xl2 p-5 max-md:hidden">
          <div className="text-xs text-muted mb-3">C 端「首页轮播 / 关于我们」预览</div>
          <div className="rounded-xl overflow-hidden border border-line">
            {form.heroImages.length > 0 ? (
              <div className="flex overflow-x-auto snap-x gap-0">
                {form.heroImages.map((u, i) => (
                  <img key={i} src={img(u)} alt="" loading="lazy" decoding="async" className="w-full aspect-[16/9] object-cover shrink-0 snap-start" style={{ minWidth: '100%' }} />
                ))}
              </div>
            ) : form.cover ? (
              <img src={img(form.cover)} alt="" loading="lazy" decoding="async" className="w-full aspect-[16/9] object-cover" />
            ) : null}
            <div className="p-5">
              <div className="flex items-center gap-3">
                {form.logo
                  ? <img src={img(form.logo)} loading="lazy" decoding="async" className="w-12 h-12 rounded-full object-cover border border-line" />
                  : <div className="w-12 h-12 rounded-full bg-brand text-white flex items-center justify-center font-semibold">{(form.name || '叶').slice(0, 1)}</div>}
                <div className="font-semibold text-fg text-lg">{form.name}</div>
              </div>
              <div className="text-sm text-muted mt-2 leading-relaxed">{form.intro}</div>
              <div className="mt-4 space-y-1.5 text-sm text-fg/80">
                {form.contact.phone && <div>📞 {form.contact.phone}</div>}
                {form.contact.wechat && <div>💬 微信 {form.contact.wechat}</div>}
                {form.contact.address && <div>📍 {form.contact.address}</div>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {crop && (
        <ImageCropper
          file={crop.file}
          aspectRatio={crop.aspectRatio}
          outputWidth={crop.outputWidth}
          outputHeight={crop.outputHeight}
          title={crop.kind === 'logo' ? '裁剪 Logo（正方形）' : '裁剪封面图（16:9）'}
          onCancel={() => setCrop(null)}
          onConfirm={onCropped}
        />
      )}

      {/* 对外预约设置 */}
      <div className="mt-6 max-md:mt-0">
        <div className="flex items-center justify-between mb-4 max-md:mb-3 max-md:px-4 max-md:pt-5">
          <div>
            <h2 className="text-lg font-semibold text-fg max-md:text-base">对外预约设置</h2>
            <p className="text-xs text-muted mt-0.5 max-md:text-[11px] max-md:leading-tight max-md:max-w-[260px]">控制小程序「预约档期」入口与每周可约日 · 保存后 C 端实时生效</p>
          </div>
          <button onClick={saveBooking} disabled={bookingSaving || !bookingLoaded}
            className="px-5 py-2 rounded-lg bg-brand text-white text-sm hover:opacity-90 disabled:opacity-50 max-md:px-3.5 max-md:py-1.5 max-md:text-xs max-md:rounded-md max-md:whitespace-nowrap">
            {bookingSaving ? '保存中…' : '保存预约设置'}
          </button>
        </div>

        {bookingTip && <div className="mb-4 text-sm px-4 py-2 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 max-md:text-xs max-md:mx-4">{bookingTip}</div>}

        <div className="bg-panel border border-line rounded-xl2 p-5 max-md:rounded-none max-md:border-x-0 max-md:border-t-0 max-md:p-4 max-md:bg-white">
          <div className="flex items-center justify-between py-3 border-b border-line max-md:py-2.5">
            <div>
              <div className="text-sm font-medium text-fg max-md:text-[13px]">开放对外预约</div>
              <div className="text-xs text-muted mt-0.5 max-md:text-[11px] max-md:leading-tight max-md:max-w-[240px]">关闭后小程序首页预约入口隐藏，客户无法提交新预约</div>
            </div>
            <button onClick={() => setBookingOpen(!booking.open)} type="button" disabled={!bookingLoaded}
              className={'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ' + (booking.open ? 'bg-brand' : 'bg-gray-300')}>
              <span className={'inline-block h-5 w-5 transform rounded-full bg-white transition-transform ' + (booking.open ? 'translate-x-5' : 'translate-x-1')} />
            </button>
          </div>
          <div className="py-3 max-md:py-2.5">
            <div className="text-sm font-medium text-fg mb-1 max-md:text-[13px]">每周可预约日</div>
            <div className="text-xs text-muted mb-3 max-md:text-[11px] max-md:leading-tight">未勾选的星期整日视为关闭，日历对应日期自动置灰（不影响已锁定的既有档期）</div>
            <div className="flex flex-wrap gap-2">
              {DAY_LABELS.map((label, d) => {
                const on = booking.openDays.includes(d);
                return (
                  <button key={d} type="button" onClick={() => toggleDay(d)} disabled={!bookingLoaded}
                    className={'px-3 py-1.5 rounded-lg text-sm border transition-colors disabled:opacity-50 ' + (on ? 'bg-brand/10 border-brand text-brand' : 'bg-panel2 border-line text-muted hover:text-fg')}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

      {/* 账户安全：修改密码 */}
      <div className="mt-6 max-md:mt-0">
        <div className="mb-4 max-md:mb-3 max-md:px-4 max-md:pt-5">
          <h2 className="text-lg font-semibold text-fg max-md:text-base">账户安全</h2>
          <p className="text-xs text-muted mt-0.5 max-md:text-[11px] max-md:leading-tight">修改当前登录账号的登录密码（需输入旧密码验证）</p>
        </div>
        {pwTip && <div className="mb-4 text-sm px-4 py-2 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 max-md:text-xs max-md:mx-4">{pwTip}</div>}
        <div className="bg-panel border border-line rounded-xl2 p-5 max-w-xl max-md:rounded-none max-md:border-x-0 max-md:border-t-0 max-md:p-4 max-md:bg-white max-md:max-w-full">
          <Field label="当前密码">
            <input type="password" className={inputCls + ' max-md:py-2.5'} value={pwOld} onChange={(e) => setPwOld(e.target.value)} />
          </Field>
          <Field label="新密码（至少 6 位）">
            <input type="password" className={inputCls + ' max-md:py-2.5'} value={pwNew} onChange={(e) => setPwNew(e.target.value)} />
          </Field>
          <Field label="确认新密码">
            <input type="password" className={inputCls + ' max-md:py-2.5'} value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)} />
          </Field>
          <button onClick={changePassword} disabled={pwSaving}
            className="px-5 py-2 rounded-lg bg-brand text-white text-sm hover:opacity-90 disabled:opacity-50 max-md:w-full max-md:py-2.5">
            {pwSaving ? '保存中…' : '修改密码'}
          </button>
        </div>
      </div>

      {/* 数据备份：双重备份能力（手动导出 + R2 定时写入） */}
      <div className="mt-6 max-md:mt-0 max-md:pb-6">
        <div className="mb-4 max-md:mb-3 max-md:px-4 max-md:pt-5">
          <h2 className="text-lg font-semibold text-fg max-md:text-base">数据备份</h2>
          <p className="text-xs text-muted mt-0.5 max-md:text-[11px] max-md:leading-tight">手动导出全量业务 JSON 到本地电脑；系统每日 03:10 还会自动写入 R2 /backup 目录一份。</p>
        </div>
        {backupTip && <div className="mb-4 text-sm px-4 py-2 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 max-md:text-xs max-md:mx-4">{backupTip}</div>}
        <div className="bg-panel border border-line rounded-xl2 p-5 max-w-xl max-md:rounded-none max-md:border-x-0 max-md:border-t-0 max-md:p-4 max-md:bg-white max-md:max-w-full">
          <p className="text-sm text-muted mb-4 max-md:text-xs max-md:leading-relaxed">备份包含全部订单、客户、相册、作品、设置等结构化数据（不含明文密钥）。图片二进制已存于 R2，无需重复备份。</p>
          <button onClick={doBackup} disabled={backupBusy}
            className="px-5 py-2 rounded-lg bg-brand text-white text-sm hover:opacity-90 disabled:opacity-50 max-md:w-full max-md:py-2.5">
            {backupBusy ? '导出中…' : '导出 JSON 备份'}
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}
