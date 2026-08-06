import React, { useState, useEffect, useRef } from 'react';
import http, { img, compressImage, uploadImage, downloadBackup } from '../api.js';
import ImageCropper from '../components/ImageCropper.jsx';

const EMPTY = {
  name: '叶哲 Studio', logo: '', cover: '', heroImages: [],
  // 幻灯片背景音乐（BGM）HTTPS 地址，如《梦中的婚礼》钢琴曲 MP3
  bgmUrl: '',
  intro: '海口婚礼 / 人像摄影 · YEZHE WORKSHOP',
  // 品牌 Slogan：首页工作室名称下方浅灰小字（为空则不渲染）
  slogan: '拍摄有温度的照片，记录平凡生活中的美好。',
  contact: { phone: '', wechat: '', address: '' }
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
  const [heroBusy, setHeroBusy] = useState(false);
  const [crop, setCrop] = useState(null);

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
        intro: d.intro || EMPTY.intro,
        slogan: d.slogan !== undefined ? d.slogan : EMPTY.slogan,
        contact: { phone: (d.contact && d.contact.phone) || '', wechat: (d.contact && d.contact.wechat) || '', address: (d.contact && d.contact.address) || '' }
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
    if (pwNew.length < 6) { setPwTip('新密码至少 6 位'); return; }
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
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-fg">资料设置</h1>
          <p className="text-xs text-muted mt-0.5">工作室对外资料 · 保存后 C 端小程序「关于我们」实时同步</p>
        </div>
        <button onClick={save} disabled={saving || !loaded}
          className="px-5 py-2 rounded-lg bg-brand text-white text-sm hover:opacity-90 disabled:opacity-50">
          {saving ? '保存中…' : '保存'}
        </button>
      </div>

      {tip && <div className="mb-4 text-sm px-4 py-2 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">{tip}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 表单 */}
        <div className="bg-panel border border-line rounded-xl2 p-5">
          <Field label="工作室名称">
            <input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="品牌 Slogan（首页工作室名称下方浅灰小字 · 留空则不显示）">
            <input className={inputCls} value={form.slogan} onChange={(e) => set('slogan', e.target.value)} placeholder="拍摄有温度的照片，记录平凡生活中的美好。" />
          </Field>
          <Field label="幻灯片背景音乐 BGM（HTTPS MP3，如《梦中的婚礼》；留空则播放幻灯片无声）">
            <input className={inputCls} value={form.bgmUrl} onChange={(e) => set('bgmUrl', e.target.value)} placeholder="https://.../dream-wedding.mp3" />
            <p className="text-xs text-muted mt-1">相册「播放幻灯片」时作为背景音乐循环播放；仅用户点击播放后才触发，切图不中断；建议上传到 R2 私有桶并经代理域名访问（小程序需加入 downloadFile 合法域名）。</p>
          </Field>
          <Field label="简介 / 品牌故事（关于我们页正文）">
            <textarea className={inputCls + ' h-20 resize-none'} value={form.intro} onChange={(e) => set('intro', e.target.value)} />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="联系电话"><input className={inputCls} value={form.contact.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
            <Field label="微信号"><input className={inputCls} value={form.contact.wechat} onChange={(e) => set('wechat', e.target.value)} /></Field>
            <Field label="地址"><input className={inputCls} value={form.contact.address} onChange={(e) => set('address', e.target.value)} /></Field>
          </div>
          <Field label="Logo">
            <div className="flex items-center gap-3">
              {form.logo && <img src={img(form.logo)} alt="" loading="lazy" decoding="async" className="w-14 h-14 rounded-lg object-cover border border-line" />}
              <button onClick={() => logoRef.current.click()} className="px-3 py-1.5 rounded-lg border border-line text-sm text-muted hover:text-brand hover:border-brand">上传 Logo</button>
              <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={(e) => startCrop(e.target.files[0], 'logo', 1, 400, 400)} />
            </div>
          </Field>
          <Field label="封面图（关于我们页封面）">
            <div className="flex items-center gap-3">
              {form.cover && <img src={img(form.cover)} alt="" loading="lazy" decoding="async" className="w-24 h-16 rounded-lg object-cover border border-line" />}
              <button onClick={() => coverRef.current.click()} className="px-3 py-1.5 rounded-lg border border-line text-sm text-muted hover:text-brand hover:border-brand">上传封面</button>
              <input ref={coverRef} type="file" accept="image/*" className="hidden" onChange={(e) => startCrop(e.target.files[0], 'cover', 16 / 9, 1200, 675)} />
            </div>
          </Field>
          <Field label={`首页轮播图（多张 · ${form.heroImages.length} 张）`}>
            <div className="flex flex-wrap gap-3 items-start">
              {form.heroImages.map((u, i) => (
                <div key={i} className="relative w-24 h-16 rounded-lg overflow-hidden border border-line group">
                  <img src={img(u)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                  <button type="button" onClick={() => removeHero(i)}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-xs leading-none flex items-center justify-center opacity-0 group-hover:opacity-100">×</button>
                  <span className="absolute bottom-0 left-0 px-1 text-[10px] text-white bg-black/50">{i + 1}</span>
                </div>
              ))}
              <button type="button" onClick={() => heroRef.current.click()} disabled={heroBusy}
                className="w-24 h-16 rounded-lg border border-dashed border-line text-xs text-muted flex flex-col items-center justify-center gap-1 hover:text-brand hover:border-brand disabled:opacity-50">
                {heroBusy ? '上传中…' : '+ 添加'}
              </button>
              <input ref={heroRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addHeroFiles(e.target.files)} />
            </div>
            <p className="text-xs text-muted mt-2">建议上传 4:3 比例照片；支持一次选多张；从左到右的顺序即为小程序首页轮播顺序；第一张建议为品牌主视觉。删除：鼠标移到图片上点右上角 ×。</p>
          </Field>
        </div>

        {/* 预览 */}
        <div className="bg-panel border border-line rounded-xl2 p-5">
          <div className="text-xs text-muted mb-3">C 端「首页轮播 / 关于我们」预览</div>
          <div className="rounded-xl overflow-hidden border border-line">
            {form.heroImages.length > 0 ? (
              <div className="flex overflow-x-auto snap-x gap-0">
                {form.heroImages.map((u, i) => (
                  <img key={i} src={img(u)} alt="" loading="lazy" decoding="async" className="w-full h-32 object-cover shrink-0 snap-start" style={{ minWidth: '100%' }} />
                ))}
              </div>
            ) : form.cover ? (
              <img src={img(form.cover)} alt="" loading="lazy" decoding="async" className="w-full h-32 object-cover" />
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
      <div className="mt-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-fg">对外预约设置</h2>
            <p className="text-xs text-muted mt-0.5">控制小程序「预约档期」入口与每周可约日 · 保存后 C 端实时生效</p>
          </div>
          <button onClick={saveBooking} disabled={bookingSaving || !bookingLoaded}
            className="px-5 py-2 rounded-lg bg-brand text-white text-sm hover:opacity-90 disabled:opacity-50">
            {bookingSaving ? '保存中…' : '保存预约设置'}
          </button>
        </div>

        {bookingTip && <div className="mb-4 text-sm px-4 py-2 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">{bookingTip}</div>}

        <div className="bg-panel border border-line rounded-xl2 p-5">
          <div className="flex items-center justify-between py-3 border-b border-line">
            <div>
              <div className="text-sm font-medium text-fg">开放对外预约</div>
              <div className="text-xs text-muted mt-0.5">关闭后小程序首页预约入口隐藏，客户无法提交新预约</div>
            </div>
            <button onClick={() => setBookingOpen(!booking.open)} type="button" disabled={!bookingLoaded}
              className={'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ' + (booking.open ? 'bg-brand' : 'bg-gray-300')}>
              <span className={'inline-block h-5 w-5 transform rounded-full bg-white transition-transform ' + (booking.open ? 'translate-x-5' : 'translate-x-1')} />
            </button>
          </div>
          <div className="py-3">
            <div className="text-sm font-medium text-fg mb-1">每周可预约日</div>
            <div className="text-xs text-muted mb-3">未勾选的星期整日视为关闭，日历对应日期自动置灰（不影响已锁定的既有档期）</div>
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
      <div className="mt-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-fg">账户安全</h2>
          <p className="text-xs text-muted mt-0.5">修改当前登录账号的登录密码（需输入旧密码验证）</p>
        </div>
        {pwTip && <div className="mb-4 text-sm px-4 py-2 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">{pwTip}</div>}
        <div className="bg-panel border border-line rounded-xl2 p-5 max-w-xl">
          <Field label="当前密码">
            <input type="password" className={inputCls} value={pwOld} onChange={(e) => setPwOld(e.target.value)} />
          </Field>
          <Field label="新密码（至少 6 位）">
            <input type="password" className={inputCls} value={pwNew} onChange={(e) => setPwNew(e.target.value)} />
          </Field>
          <Field label="确认新密码">
            <input type="password" className={inputCls} value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)} />
          </Field>
          <button onClick={changePassword} disabled={pwSaving}
            className="px-5 py-2 rounded-lg bg-brand text-white text-sm hover:opacity-90 disabled:opacity-50">
            {pwSaving ? '保存中…' : '修改密码'}
          </button>
        </div>
      </div>

      {/* 数据备份：双重备份能力（手动导出 + R2 定时写入） */}
      <div className="mt-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-fg">数据备份</h2>
          <p className="text-xs text-muted mt-0.5">手动导出全量业务 JSON 到本地电脑；系统每日 03:10 还会自动写入 R2 /backup 目录一份。</p>
        </div>
        {backupTip && <div className="mb-4 text-sm px-4 py-2 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">{backupTip}</div>}
        <div className="bg-panel border border-line rounded-xl2 p-5 max-w-xl">
          <p className="text-sm text-muted mb-4">备份包含全部订单、客户、相册、作品、设置等结构化数据（不含明文密钥）。图片二进制已存于 R2，无需重复备份。</p>
          <button onClick={doBackup} disabled={backupBusy}
            className="px-5 py-2 rounded-lg bg-brand text-white text-sm hover:opacity-90 disabled:opacity-50">
            {backupBusy ? '导出中…' : '导出 JSON 备份'}
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}
