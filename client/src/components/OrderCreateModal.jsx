import React, { useState, useEffect, useRef, useMemo } from 'react';
import http, { img } from '../api.js';

// ===== 新增订单弹窗（按【新增订单弹窗】spec 1:1 复刻）=====
// 交互硬规则：点击蒙层 / 右上角 × 均可关闭；必填项标 *，校验失败弹提示并停留在弹窗。
// 数据硬规则：套系 / 渠道 / 执行人全部读后端接口，绝不写死前端。

// —— spec 严格色号 ——
const BLUE = '#2890F0';        // 链接 / 加号 / 保存按钮 蓝
const MINT = '#88D8B0';         // 可用时间按钮：薄荷绿底白字
const FULL_BG = '#BBBBBB';      // 已满时间按钮底
const FULL_TEXT = '#888888';    // 已满时间按钮字
const TBD_BG = '#FFF9E6';       // 日期待定整行浅黄
const REQ_RED = '#FF4444';      // 必填标记红
const INPUT_BORDER = '#DDDDDD'; // 输入框边框
const TEXT_BODY = '#333333';    // 正文
const TEXT_MUTED = '#999999';   // 次要占位

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + ':00');

const PAY_OPTIONS = [
  { value: 'unpaid', label: '未付款' },
  { value: 'deposit', label: '已付定金' },
  { value: 'paid', label: '已付全款' }
];

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function emptyForm() {
  return {
    order_name: '',
    customers: [{ name: '', phone: '' }],
    shoot_date: todayStr(),
    pick_slots: false,
    time_slots: [],
    date_tbd: false,
    package_id: '',
    package_price: '',
    package_deposit: '',
    payment_status: 'deposit',
    extra_items: [],
    address: '',
    remark: '',
    channel_id: '',
    channel: '',
    executor_ids: []
  };
}

// 输入框基础类：白底 / 6px 圆角 / #DDDDDD 边框（色号走 inline style）
const inputCls =
  'w-full px-3 py-2 rounded-md border bg-white text-sm outline-none transition focus:border-[#2890F0] disabled:opacity-50 disabled:cursor-not-allowed';

function Label({ children, required }) {
  return (
    <label className="block text-sm mb-1.5" style={{ color: TEXT_BODY }}>
      {children}
      {required && <span className="ml-0.5" style={{ color: REQ_RED }}>*</span>}
    </label>
  );
}

/* ------------------------------ 内联 SVG 图标 ------------------------------ */
const Svg = (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p} />;

const IconPerson = (p) => <Svg {...p}><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" /><path d="M4 20a8 8 0 0 1 16 0" /></Svg>;
const IconCalendar = (p) => <Svg {...p}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></Svg>;
const IconCoin = (p) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9 9.5h4.5a2 2 0 0 1 0 4H9" /></Svg>;
const IconLocation = (p) => <Svg {...p}><path d="M12 21s7-6.4 7-12a7 7 0 1 0-14 0c0 5.6 7 12 7 12Z" /><circle cx="12" cy="9" r="2.5" /></Svg>;
const IconPen = (p) => <Svg {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></Svg>;
const IconTeam = (p) => <Svg {...p}><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 5.5a3 3 0 0 1 0 5M21 20a6 6 0 0 0-5-5.9" /></Svg>;
const IconCheck = (p) => <Svg {...p}><path d="M4 12l6 6L20 6" /></Svg>;
const IconChevron = (p) => <Svg {...p}><path d="M6 9l6 6 6-6" /></Svg>;
const IconPlus = (p) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
const IconClose = (p) => <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>;
const IconBox = (p) => <Svg {...p}><path d="M21 8 12 3 3 8l9 5 9-5Z" /><path d="M3 8v8l9 5 9-5V8M12 13v8" /></Svg>;

// 渠道来源图标：根据渠道名称匹配品牌色与图形，未匹配走默认
function ChannelIcon({ name, size = 16 }) {
  const n = (name || '').toLowerCase();
  let color = '#9aa0a6', inner = null;
  if (n.includes('抖音')) { color = '#000'; inner = <path d="M14 3v8.5a3.5 3.5 0 1 1-3-3.46" />; }
  else if (n.includes('小红书')) { color = '#ff2442'; inner = <><rect x="5" y="3" width="14" height="18" rx="3" /><path d="M9 8h6M9 12h6M9 16h4" /></>; }
  else if (n.includes('美团')) { color = '#ffc300'; inner = <><path d="M5 11h14M5 11a7 7 0 0 0 14 0" /><circle cx="12" cy="16" r="1.5" /></>; }
  else if (n.includes('小程序') || n.includes('微信')) { color = '#07C160'; inner = <><circle cx="9" cy="9" r="2" /><circle cx="15" cy="9" r="2" /><path d="M7 16h10" /></>; }
  else if (n.includes('推荐')) { color = BLUE; inner = <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M18 8h3M19.5 6.5v3" /></>; }
  else if (n.includes('自然') || n.includes('进店')) { color = '#8a6d3b'; inner = <><path d="M6 21V10l6-4 6 4v11" /><path d="M6 21h12M10 21v-5h4v5" /></>; }
  else { color = '#9aa0a6'; inner = <><circle cx="6" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="18" cy="12" r="1.5" /></>; }
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {inner}
    </svg>
  );
}

/* ------------------------------ 通用下拉（自定义，1:1 复刻 spec 弹窗样式） ------------------------------ */
function Dropdown({ value, placeholder, options, onSelect, renderValue, renderOption, icon, disabled }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const selected = options.find((o) => o.value === value);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={'w-full px-3 py-2 rounded-md border bg-white text-sm text-left flex items-center gap-2 outline-none focus:border-[#2890F0] disabled:opacity-50 ' + (selected ? '' : 'placeholder')}
        style={{ borderColor: INPUT_BORDER, color: selected ? TEXT_BODY : TEXT_MUTED }}
      >
        {icon && <span className="shrink-0" style={{ color: BLUE }}>{icon}</span>}
        <span className="flex-1 truncate">{selected ? renderValue(selected) : placeholder}</span>
        <IconChevron className="w-4 h-4 shrink-0" style={{ color: TEXT_MUTED }} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 mt-1 bg-white border rounded-md shadow-lg z-30 overflow-hidden" style={{ borderColor: INPUT_BORDER }}>
          <div className="max-h-56 overflow-auto">
            {options.length === 0 ? (
              <div className="px-3 py-3 text-xs" style={{ color: TEXT_MUTED }}>暂无选项</div>
            ) : (
              options.map((o) => (
                <button
                  type="button"
                  key={o.value}
                  onClick={() => { onSelect(o); setOpen(false); }}
                  className={
                    'w-full text-left px-3 py-2 text-sm flex items-center gap-2 ' +
                    (String(o.value) === String(value) ? '' : 'hover:bg-[#f5f7fa]')
                  }
                  style={String(o.value) === String(value) ? { background: 'rgba(40,144,240,0.1)', color: BLUE, fontWeight: 500 } : { color: TEXT_BODY }}
                >
                  {renderOption ? renderOption(o) : o.label}
                  {String(o.value) === String(value) && <IconCheck className="w-4 h-4 ml-auto" style={{ color: BLUE }} />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function OrderCreateModal({ visible, packages, initialPackageId, onClose, onAfterCreate }) {
  const [form, setForm] = useState(emptyForm());
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [pkgList, setPkgList] = useState([]);
  const [channels, setChannels] = useState([]);
  const [people, setPeople] = useState([]);
  const [execOpen, setExecOpen] = useState(false);
  const pkgPropRef = useRef(packages);
  pkgPropRef.current = packages;

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    if (!visible) return;
    setForm({ ...emptyForm(), package_id: initialPackageId || '' });
    setErr('');
    setExecOpen(false);

    let alive = true;
    (async () => {
      const propPkgs = pkgPropRef.current;
      try {
        const list = propPkgs && propPkgs.length ? propPkgs : ((await http.get('/api/packages')).data || []);
        if (!alive) return;
        setPkgList(list);
        if (initialPackageId) {
          const p = list.find((x) => String(x.id) === String(initialPackageId));
          if (p) {
            setForm((f) => ({
              ...f,
              package_id: String(p.id),
              package_price: p.price != null ? String(p.price) : '',
              package_deposit: p.deposit != null ? String(p.deposit) : ''
            }));
          }
        }
      } catch { if (alive) setPkgList(propPkgs || []); }
      try { const r = await http.get('/api/channels'); if (alive) setChannels(r.data || []); } catch { if (alive) setChannels([]); }
      try { const r = await http.get('/api/admin/personnel'); if (alive) setPeople(r.data || []); } catch { if (alive) setPeople([]); }
    })();
    return () => { alive = false; };
  }, [visible, initialPackageId]);

  const extraTotal = useMemo(
    () => form.extra_items.reduce((s, x) => s + (parseFloat(x.amount) || 0), 0),
    [form.extra_items]
  );

  if (!visible) return null;

  /* —— 客户姓名 + 手机号（可加多组） —— */
  const setCustomer = (i, key, v) => set({ customers: form.customers.map((c, k) => (k === i ? { ...c, [key]: v } : c)) });
  const addCustomer = () => set({ customers: [...form.customers, { name: '', phone: '' }] });
  const delCustomer = (i) => set({ customers: form.customers.filter((_, k) => k !== i) });

  /* —— 场次时间 —— */
  const toggleSlot = (h) =>
    set({ time_slots: form.time_slots.includes(h) ? form.time_slots.filter((x) => x !== h) : [...form.time_slots, h] });

  /* —— 其他消费 —— */
  const addExtra = () => set({ extra_items: [...form.extra_items, { name: '', amount: '' }] });
  const setExtra = (i, key, v) => set({ extra_items: form.extra_items.map((x, k) => (k === i ? { ...x, [key]: v } : x)) });
  const delExtra = (i) => set({ extra_items: form.extra_items.filter((_, k) => k !== i) });

  /* —— 套系选择：回填价格 / 定金（仍可手动改） —— */
  const onPickPackage = (opt) => {
    const p = pkgList.find((x) => String(x.id) === String(opt.value));
    set({
      package_id: opt.value,
      package_price: p && p.price != null ? String(p.price) : '',
      package_deposit: p && p.deposit != null ? String(p.deposit) : ''
    });
  };
  const pkgSpecName = (p) => {
    const s = (p.specs && (Array.isArray(p.specs) ? p.specs : safeParse(p.specs)) || [])[0];
    return s && s.name ? s.name : (p.spec_name || '');
  };
  function safeParse(v) { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return []; } }

  /* —— 执行人多选 —— */
  const toggleExec = (id) =>
    set({ executor_ids: form.executor_ids.includes(id) ? form.executor_ids.filter((x) => x !== id) : [...form.executor_ids, id] });

  function fail(msg) { setErr(msg); window.alert(msg); return false; }
  function validate() {
    if (!form.order_name.trim()) return fail('请输入订单名称');
    const named = form.customers.filter((c) => c.name.trim());
    if (named.length === 0) return fail('请至少填写一位顾客姓名');
    if (!form.date_tbd && !form.shoot_date) return fail('请选择档期日期，或勾选「日期待定」');
    if (!form.package_id) return fail('请选择套系');
    if (form.package_price === '' || isNaN(parseFloat(form.package_price))) return fail('请填写套系价格');
    if (form.package_deposit === '' || isNaN(parseFloat(form.package_deposit))) return fail('请填写套系定金');
    if (!form.payment_status) return fail('请选择收款状态');
    if (form.payment_status === 'deposit' && (parseFloat(form.package_deposit) || 0) <= 0) return fail('收款状态为「已付定金」时，套系定金必须大于 0');
    for (const it of form.extra_items) {
      if (!String(it.name || '').trim()) return fail('请填写其他消费的项目名称，或删除该行');
    }
    return true;
  }

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (!validate()) return;
    const phones = form.customers.map((c) => (c.phone || '').trim()).filter(Boolean);
    const names = form.customers.map((c) => (c.name || '').trim()).filter(Boolean);
    const executors = form.executor_ids
      .map((id) => people.find((p) => p.id === id))
      .filter(Boolean)
      .map((p) => ({ id: p.id, name: p.name, avatar: p.avatar || '' }));
    const payload = {
      order_name: form.order_name.trim(),
      customer_name: names.join(' & '),
      phones,
      customer_phone: phones[0] || '',
      shoot_date: form.date_tbd ? '' : form.shoot_date,
      date_tbd: form.date_tbd ? 1 : 0,
      time_slots: form.date_tbd || !form.pick_slots ? [] : form.time_slots,
      package_id: form.package_id || null,
      package_price: parseFloat(form.package_price) || 0,
      deposit: parseFloat(form.package_deposit) || 0,
      payment_status: form.payment_status,
      extra_items: form.extra_items
        .filter((x) => String(x.name || '').trim())
        .map((x) => ({ name: x.name.trim(), amount: parseFloat(x.amount) || 0 })),
      address: form.address.trim(),
      remark: form.remark.trim(),
      channel: form.channel || '',
      channel_id: form.channel_id || null,
      executors
    };
    try {
      setSaving(true);
      await http.post('/api/orders', payload);
      onClose();
      if (onAfterCreate) onAfterCreate();
    } catch (e2) {
      const msg = (e2.response && e2.response.data && e2.response.data.error) || '保存失败，请重试';
      setErr(msg);
      window.alert(msg);
    } finally {
      setSaving(false);
    }
  }

  const dateDisabled = form.date_tbd;
  const slotDisabled = form.date_tbd || !form.pick_slots;

  /* 套系下拉选项 */
  const pkgOptions = pkgList.map((p) => {
    const spec = pkgSpecName(p);
    return { value: String(p.id), label: spec ? `${p.name} | ${spec}` : p.name };
  });

  function slotBtn(h) {
    const on = form.time_slots.includes(h);
    const full = false; // 暂无后端占用数据，全部视为可用
    return (
      <button key={h} type="button" disabled={slotDisabled || full} onClick={() => toggleSlot(h)}
        className={'px-3 py-1.5 rounded-[24px] text-xs border transition flex items-center gap-1 ' + (full ? 'cursor-not-allowed' : '')}
        style={{ background: full ? FULL_BG : MINT, color: full ? FULL_TEXT : '#FFFFFF', borderColor: 'transparent' }}>
        {on && !full && <IconCheck className="w-3 h-3" />}
        {h}
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center p-4 overflow-auto"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full my-4 sm:my-6 bg-white shadow-xl overflow-hidden flex flex-col"
        style={{ maxWidth: 920, borderRadius: 12, maxHeight: 'calc(100vh - 2rem)' }}
      >
        {/* 标题栏：居中标题 + 右上角 × 关闭 */}
        <div className="relative flex items-center justify-center px-5 py-4 border-b shrink-0" style={{ borderColor: '#EEEEEE' }}>
          <div className="text-base font-semibold" style={{ color: TEXT_BODY }}>新增订单</div>
          <button type="button" onClick={onClose} aria-label="关闭"
            className="absolute right-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-md flex items-center justify-center hover:bg-[#f5f7fa]"
            style={{ color: TEXT_MUTED }}>
            <IconClose className="w-4 h-4" />
          </button>
        </div>

        {/* 可滚动内容区（移动端内部滚动） */}
        <div className="flex-1 overflow-y-auto">

          {/* ① 顾客信息 */}
          <div className="flex gap-3 p-5 border-b" style={{ borderColor: '#EEEEEE' }}>
            <div className="shrink-0 w-12 h-12 rounded-full flex items-center justify-center" style={{ background: '#F2F2F2', color: TEXT_MUTED }}>
              <IconPerson className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              {/* 第一行：订单名称 */}
              <input
                value={form.order_name}
                onChange={(e) => set({ order_name: e.target.value })}
                placeholder="请输入订单名称"
                className={inputCls + ' placeholder:text-[#999999]'}
                style={{ borderColor: INPUT_BORDER, color: TEXT_BODY }}
              />
              {/* 第二行起：添加电话（左） + 顾客姓名（右） */}
              {form.customers.map((c, i) => (
                <div key={i} className="flex items-center gap-2 mt-2">
                  <input
                    value={c.phone}
                    onChange={(e) => setCustomer(i, 'phone', e.target.value)}
                    placeholder="添加电话"
                    inputMode="tel"
                    className={inputCls + ' placeholder:text-[#999999]'}
                    style={{ borderColor: INPUT_BORDER, color: TEXT_BODY }}
                  />
                  <input
                    value={c.name}
                    onChange={(e) => setCustomer(i, 'name', e.target.value)}
                    placeholder="顾客姓名"
                    className={inputCls + ' placeholder:text-[#999999]'}
                    style={{ borderColor: INPUT_BORDER, color: TEXT_BODY }}
                  />
                  {form.customers.length > 1 && (
                    <button type="button" onClick={() => delCustomer(i)} title="删除该联系人"
                      className="shrink-0 w-9 h-9 rounded-md border flex items-center justify-center hover:opacity-80"
                      style={{ borderColor: INPUT_BORDER, color: TEXT_MUTED }}>
                      <IconClose className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button type="button" onClick={addCustomer} title="新增联系人"
              className="shrink-0 self-start w-10 h-10 rounded-full text-white flex items-center justify-center hover:opacity-90"
              style={{ background: BLUE }}>
              <IconPlus className="w-5 h-5" />
            </button>
          </div>

          {/* ② 日期 / 场次 */}
          <div className="p-5 border-b" style={{ borderColor: '#EEEEEE' }}>
            <div className="flex flex-wrap items-center gap-3">
              {/* 日期：日历图标 + 文本 + 清除 × */}
              <div className={'relative flex-1 min-w-[200px] ' + (dateDisabled ? 'opacity-50 pointer-events-none' : '')}>
                <div className="flex items-center gap-2 px-3 py-2 rounded-md border bg-white text-sm" style={{ borderColor: INPUT_BORDER, color: TEXT_BODY }}>
                  <IconCalendar className="w-4 h-4 shrink-0" style={{ color: TEXT_MUTED }} />
                  <span className="flex-1">{form.shoot_date || '请选择日期'}</span>
                  {form.shoot_date && !dateDisabled && (
                    <button type="button" onClick={() => set({ shoot_date: '' })} aria-label="清除日期"
                      className="hover:opacity-80" style={{ color: TEXT_MUTED }}>
                      <IconClose className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <input type="date" value={form.shoot_date} disabled={dateDisabled}
                  onChange={(e) => set({ shoot_date: e.target.value })}
                  className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed" />
              </div>
              {/* 右上角：选择场次 */}
              <label className={'flex items-center gap-2 text-sm select-none ' + (dateDisabled ? 'cursor-not-allowed' : 'cursor-pointer')}
                style={{ color: TEXT_BODY }}>
                <input type="checkbox" disabled={dateDisabled} checked={form.pick_slots}
                  onChange={(e) => set({ pick_slots: e.target.checked, time_slots: e.target.checked ? form.time_slots : [] })}
                  className="w-4 h-4" style={{ accentColor: BLUE }} />
                选择场次
              </label>
            </div>

            {/* 日期待定：整行浅黄底 */}
            <div className="mt-3 rounded-md px-3 py-2 flex items-center gap-2" style={{ background: TBD_BG }}>
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none" style={{ color: TEXT_BODY }}>
                <input type="checkbox" checked={form.date_tbd} onChange={(e) => set({ date_tbd: e.target.checked })} className="w-4 h-4" style={{ accentColor: BLUE }} />
                日期待定
              </label>
            </div>

            {form.pick_slots && (
              <div className={'mt-3 ' + (slotDisabled ? 'opacity-50 pointer-events-none' : '')}>
                <div className="text-xs mb-2" style={{ color: TEXT_MUTED }}>按小时选择场次，可多选（婚礼可选多个时间段）</div>
                <div className="flex flex-wrap gap-2">
                  {HOURS.map(slotBtn)}
                </div>
              </div>
            )}
          </div>

          {/* ③ 套系信息 */}
          <div className="p-5 border-b" style={{ borderColor: '#EEEEEE' }}>
            <Label required>套系</Label>
            <Dropdown
              value={form.package_id}
              placeholder="请选择套系名称"
              options={pkgOptions}
              icon={<IconBox className="w-4 h-4" />}
              onSelect={onPickPackage}
              renderValue={(o) => o.label}
            />
            {pkgList.length === 0 && <div className="text-xs mt-1" style={{ color: TEXT_MUTED }}>暂无套系，请先到「套系管理」新增。</div>}
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <Label required>套系价格</Label>
                <input type="number" min="0" value={form.package_price}
                  onChange={(e) => set({ package_price: e.target.value })} placeholder="0" className={inputCls + ' placeholder:text-[#999999]'}
                  style={{ borderColor: INPUT_BORDER, color: TEXT_BODY }} />
              </div>
              <div>
                <Label required>套系定金</Label>
                <input type="number" min="0" value={form.package_deposit}
                  onChange={(e) => set({ package_deposit: e.target.value })} placeholder="0" className={inputCls + ' placeholder:text-[#999999]'}
                  style={{ borderColor: INPUT_BORDER, color: TEXT_BODY }} />
              </div>
            </div>
          </div>

          {/* ④ 收款状态 & 其他消费 */}
          <div className="p-5 border-b" style={{ borderColor: '#EEEEEE' }}>
            <div className="flex items-center gap-2 mb-2.5">
              <IconCoin className="w-4 h-4 shrink-0" style={{ color: TEXT_MUTED }} />
              <Label required>收款状态</Label>
            </div>
            <Dropdown
              value={form.payment_status}
              placeholder="请选择"
              options={PAY_OPTIONS}
              onSelect={(o) => set({ payment_status: o.value })}
              renderValue={(o) => o.label}
            />

            <div className="flex items-center gap-2 mt-4 mb-2.5">
              <IconCoin className="w-4 h-4 shrink-0" style={{ color: TEXT_MUTED }} />
              <span className="text-sm" style={{ color: TEXT_BODY }}>其他消费</span>
              <button type="button" onClick={addExtra} className="ml-auto flex items-center gap-1 text-xs hover:underline" style={{ color: BLUE }}>
                <IconPlus className="w-3.5 h-3.5" /> 添加
              </button>
            </div>
            {form.extra_items.length === 0 ? (
              <div className="text-xs rounded-md px-3 py-2" style={{ background: '#F7F7F7', color: TEXT_MUTED }}>暂无其他消费，点击「添加」录入加片、相册等费用。</div>
            ) : (
              <div className="space-y-2">
                {form.extra_items.map((it, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input value={it.name} onChange={(e) => setExtra(i, 'name', e.target.value)} placeholder="消费名称（如：加精修 10 张）" className={inputCls + ' placeholder:text-[#999999]'}
                      style={{ borderColor: INPUT_BORDER, color: TEXT_BODY }} />
                    <input type="number" min="0" value={it.amount} onChange={(e) => setExtra(i, 'amount', e.target.value)} placeholder="金额" className={inputCls + ' placeholder:text-[#999999] sm:w-32'}
                      style={{ borderColor: INPUT_BORDER, color: TEXT_BODY }} />
                    <button type="button" onClick={() => delExtra(i)} title="删除该条消费"
                      className="shrink-0 w-9 h-9 rounded-md border flex items-center justify-center hover:opacity-80"
                      style={{ borderColor: INPUT_BORDER, color: TEXT_MUTED }}>
                      <IconClose className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ⑤ 拍摄地点 & 添加备注 */}
          <div className="p-5 border-b" style={{ borderColor: '#EEEEEE' }}>
            <div className="flex items-center gap-2">
              <IconLocation className="w-4 h-4 shrink-0" style={{ color: TEXT_MUTED }} />
              <input value={form.address} onChange={(e) => set({ address: e.target.value })} placeholder="输入拍摄地点"
                className={inputCls + ' placeholder:text-[#999999]'} style={{ borderColor: INPUT_BORDER, color: TEXT_BODY }} />
            </div>
            {form.remark ? (
              <textarea rows={3} value={form.remark} onChange={(e) => set({ remark: e.target.value })}
                placeholder="补充说明（服装、化妆、集合时间等）" className={inputCls + ' resize-y mt-3 w-full placeholder:text-[#999999]'} style={{ borderColor: INPUT_BORDER, color: TEXT_BODY }} />
            ) : (
              <button type="button" onClick={() => set({ remark: ' ' })} className="flex items-center gap-1 text-sm mt-3 hover:underline" style={{ color: BLUE }}>
                <IconPen className="w-4 h-4" /> 添加备注
              </button>
            )}
          </div>

          {/* ⑥ 渠道来源 */}
          <div className="p-5 border-b" style={{ borderColor: '#EEEEEE' }}>
            <div className="flex items-center gap-2 mb-2.5">
              <IconPen className="w-4 h-4 shrink-0" style={{ color: TEXT_MUTED }} />
              <span className="text-sm" style={{ color: TEXT_BODY }}>渠道来源</span>
            </div>
            <Dropdown
              value={form.channel_id}
              placeholder="请选择"
              options={channels.map((c) => ({ value: String(c.id), label: c.name }))}
              onSelect={(o) => set({ channel_id: o.value, channel: o.label })}
              renderValue={(o) => o.label}
              renderOption={(o) => (<><ChannelIcon name={o.label} /><span>{o.label}</span></>)}
              icon={<ChannelIcon name={channels.find(c => String(c.id) === String(form.channel_id))?.name || ''} />}
            />
          </div>

          {/* ⑦ 执行人 */}
          <div className="p-5 border-b" style={{ borderColor: '#EEEEEE' }}>
            <div className="flex items-center gap-2 mb-3">
              <IconTeam className="w-4 h-4 shrink-0" style={{ color: TEXT_MUTED }} />
              <span className="text-sm" style={{ color: TEXT_BODY }}>执行人：</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {form.executor_ids.map((id) => {
                const p = people.find((x) => x.id === id);
                if (!p) return null;
                return (
                  <span key={id} title={p.name}
                    className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center text-sm font-medium border"
                    style={{ background: 'rgba(40,144,240,0.12)', color: BLUE, borderColor: '#DDDDDD' }}>
                    {p.avatar ? <img src={img(p.avatar)} alt={p.name} className="w-full h-full object-cover" /> : (p.name || '?').slice(0, 1)}
                  </span>
                );
              })}
              <button type="button" onClick={() => setExecOpen(true)}
                className="w-10 h-10 rounded-full text-white flex items-center justify-center hover:opacity-90"
                style={{ background: BLUE }}>
                <IconPlus className="w-5 h-5" />
              </button>
            </div>
          </div>

        </div>

        {/* ⑧ 底部居中保存 */}
        <div className="px-5 py-4 flex flex-col items-center shrink-0 border-t" style={{ borderColor: '#EEEEEE' }}>
          {err && <div className="mb-3 w-full px-3 py-2 rounded-md text-center text-sm" style={{ background: '#FDECEC', color: '#E4393C' }}>{err}</div>}
          <button type="submit" disabled={saving}
            className="min-w-[160px] py-2.5 rounded-md text-white text-sm font-medium disabled:opacity-50 hover:opacity-90"
            style={{ background: BLUE }}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </form>

      {/* 执行人多选弹窗 */}
      {execOpen && (
        <div className="fixed inset-0 flex items-center justify-center z-[70] p-4" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={() => setExecOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm bg-white shadow-xl overflow-hidden flex flex-col" style={{ borderRadius: 12 }}>
            <div className="relative flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: '#EEEEEE' }}>
              <div className="text-base font-semibold" style={{ color: TEXT_BODY }}>选择执行人</div>
              <button type="button" onClick={() => setExecOpen(false)} aria-label="关闭"
                className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-[#f5f7fa]" style={{ color: TEXT_MUTED }}>
                <IconClose className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-72 overflow-auto p-3">
              {people.length === 0 ? (
                <div className="text-xs px-2 py-6 text-center" style={{ color: TEXT_MUTED }}>暂无可选人员，请先在系统中添加账号。</div>
              ) : (
                people.map((p) => {
                  const on = form.executor_ids.includes(p.id);
                  return (
                    <button type="button" key={p.id} onClick={() => toggleExec(p.id)}
                      className={'w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left ' + (on ? '' : 'hover:bg-[#f5f7fa]')}
                      style={on ? { background: 'rgba(40,144,240,0.1)' } : {}}
                    >
                      <span className="w-9 h-9 rounded-full overflow-hidden flex items-center justify-center text-sm font-medium border" style={{ background: 'rgba(40,144,240,0.12)', color: BLUE, borderColor: '#DDDDDD' }}>
                        {p.avatar ? <img src={img(p.avatar)} alt={p.name} className="w-full h-full object-cover" /> : (p.name || '?').slice(0, 1)}
                      </span>
                      <span className="flex-1 text-sm" style={{ color: TEXT_BODY }}>{p.name}</span>
                      <span className={'w-5 h-5 rounded border flex items-center justify-center ' + (on ? '' : 'text-transparent')} style={on ? { background: BLUE, borderColor: BLUE } : { borderColor: '#DDDDDD' }}>
                        <IconCheck className="w-3.5 h-3.5" />
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            <div className="px-5 py-3 border-t flex justify-end" style={{ borderColor: '#EEEEEE' }}>
              <button type="button" onClick={() => setExecOpen(false)} className="px-5 py-2 rounded-md text-white text-sm font-medium hover:opacity-90" style={{ background: BLUE }}>确定</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
