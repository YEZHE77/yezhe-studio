import React, { useState, useEffect, useRef } from 'react';
import http, { img } from '../api.js';

const EMPTY = {
  name: '叶哲 Studio', logo: '', cover: '',
  intro: '海口婚礼 / 人像摄影 · YEZHE WORKSHOP',
  contact: { phone: '', wechat: '', address: '' }
};

export default function Settings() {
  const [form, setForm] = useState(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tip, setTip] = useState('');
  const logoRef = useRef();
  const coverRef = useRef();

  // 对外预约设置：开放开关 + 每周可约日（0=周日 … 6=周六）
  const [booking, setBooking] = useState({ open: true, openDays: [0, 1, 2, 3, 4, 5, 6] });
  const [bookingLoaded, setBookingLoaded] = useState(false);
  const [bookingSaving, setBookingSaving] = useState(false);
  const [bookingTip, setBookingTip] = useState('');
  const DAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  useEffect(() => {
    http.get('/api/settings/studio').then((r) => {
      const d = r.data || {};
      setForm({
        name: d.name || EMPTY.name,
        logo: d.logo || '', cover: d.cover || '',
        intro: d.intro || EMPTY.intro,
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
    const fd = new FormData();
    fd.append('file', file);
    const r = await http.post('/api/upload', fd);
    set(kind, r.data.url);
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

  const Field = ({ label, children }) => (
    <label className="block mb-4">
      <div className="text-xs text-muted mb-1.5">{label}</div>
      {children}
    </label>
  );
  const inputCls = 'w-full border border-line rounded-lg px-3 py-2 text-sm bg-panel text-fg outline-none focus:border-brand';

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
          <Field label="简介 / Slogan">
            <textarea className={inputCls + ' h-20 resize-none'} value={form.intro} onChange={(e) => set('intro', e.target.value)} />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="联系电话"><input className={inputCls} value={form.contact.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
            <Field label="微信号"><input className={inputCls} value={form.contact.wechat} onChange={(e) => set('wechat', e.target.value)} /></Field>
            <Field label="地址"><input className={inputCls} value={form.contact.address} onChange={(e) => set('address', e.target.value)} /></Field>
          </div>
          <Field label="Logo">
            <div className="flex items-center gap-3">
              {form.logo && <img src={img(form.logo)} alt="" className="w-14 h-14 rounded-lg object-cover border border-line" />}
              <button onClick={() => logoRef.current.click()} className="px-3 py-1.5 rounded-lg border border-line text-sm text-muted hover:text-brand hover:border-brand">上传 Logo</button>
              <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={(e) => upload(e.target.files[0], 'logo')} />
            </div>
          </Field>
          <Field label="封面图">
            <div className="flex items-center gap-3">
              {form.cover && <img src={img(form.cover)} alt="" className="w-24 h-16 rounded-lg object-cover border border-line" />}
              <button onClick={() => coverRef.current.click()} className="px-3 py-1.5 rounded-lg border border-line text-sm text-muted hover:text-brand hover:border-brand">上传封面</button>
              <input ref={coverRef} type="file" accept="image/*" className="hidden" onChange={(e) => upload(e.target.files[0], 'cover')} />
            </div>
          </Field>
        </div>

        {/* 预览 */}
        <div className="bg-panel border border-line rounded-xl2 p-5">
          <div className="text-xs text-muted mb-3">C 端「关于我们」预览</div>
          <div className="rounded-xl overflow-hidden border border-line">
            {form.cover && <img src={img(form.cover)} alt="" className="w-full h-32 object-cover" />}
            <div className="p-5">
              <div className="flex items-center gap-3">
                {form.logo
                  ? <img src={img(form.logo)} className="w-12 h-12 rounded-full object-cover border border-line" />
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
      </div>
    </div>
  );
}
