import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import http, { conflictOf } from '../api.js';

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + ':00');
const HALF = 'half';
const FULL = 'full';
const PHONE_RE = /^1[3-9]\d{9}$/;

// 新增订单弹窗色号（1:1 复刻 spec）
const DLG_BLOCK_BORDER = '#E5E7EB';
const DLG_FIELD_BORDER = '#D8D8D8';
const ADD_BTN = '#2998EB';

const MODAL_BLUE = '#2DB7F5';
const MODAL_BORDER = '#DDDDDD';
const MODAL_PLACE = '#B5B5B5';
const MODAL_RED = '#FF5B5B';
const MODAL_POP_HOVER = '#EAFBFC';
const MODAL_TBD = '#FFF9E8';
const MODAL_TBD_BORDER = '#FFF0C2';
const MODAL_SLOT_FREE = '#8BDCB8';
const MODAL_SLOT_SEL = '#333333';
const MODAL_ACTIVE = '#BFEFFF';
const MODAL_DIV = '#EEEEEE';

// page-mode 1:1 spec colors (module level for sub-components)
const PAGE_TEXT = '#333333';
const PAGE_PLACE = '#BBBBBB';

const pad = (n) => String(n).padStart(2, '0');

function toast(msg) {
  let el = document.getElementById('__schedule_toast__');
  if (!el) {
    el = document.createElement('div');
    el.id = '__schedule_toast__';
    el.style.cssText = 'position:fixed;left:50%;top:18%;transform:translateX(-50%);background:rgba(0,0,0,.8);color:#fff;padding:8px 16px;border-radius:6px;font-size:14px;z-index:3000;transition:opacity .3s;pointer-events:none;white-space:nowrap;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el.__t);
  el.__t = setTimeout(() => { el.style.opacity = '0'; }, 2400);
}

function buildMonth(year, month0) {
  const first = new Date(year, month0, 1);
  const startDay = first.getDay();
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export default function OrderDialog({ orderDlg, personnel, onClose, onSaved, mode = 'modal' }) {
  const nav = useNavigate();
  const isPage = mode === 'page';
  const isMobile = isPage || (window.innerWidth || 1200) < 768;
  const [pkgList, setPkgList] = useState([]);
  const [chList, setChList] = useState([]);
  const [execPop, setExecPop] = useState(false);
  const execPopRef = useRef(null);
  const [payPop, setPayPop] = useState(false);
  const [chPop, setChPop] = useState(false);
  const [showRemark, setShowRemark] = useState(false);
  const payPopRef = useRef(null);
  const chPopRef = useRef(null);

  // page-mode specific UI state
  const [pagePayOpen, setPagePayOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const timeRef = useRef(null);
  const [birthdayText, setBirthdayText] = useState('');
  const [showBirthday, setShowBirthday] = useState(false);
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [priceMissing, setPriceMissing] = useState(false);

  const [orderName, setOrderName] = useState('');
  const [customers, setCustomers] = useState([{ name: '', phone: '' }, { name: '', phone: '' }]);
  const [chooseSession, setChooseSession] = useState(false);
  const [dateTbd, setDateTbd] = useState(false);
  const [shootDate, setShootDate] = useState(orderDlg?.date || '');
  const [slots, setSlots] = useState([]);
  const [pkgId, setPkgId] = useState('');
  const [pkgPrice, setPkgPrice] = useState('');
  const [deposit, setDeposit] = useState('');
  const [pkgDuration, setPkgDuration] = useState('');
  const [pkgRawCount, setPkgRawCount] = useState('');
  const [pkgRetouch, setPkgRetouch] = useState('');
  const [pkgExtraFee, setPkgExtraFee] = useState('');
  const [payStatus, setPayStatus] = useState('deposit');
  const [extras, setExtras] = useState([]);
  const [location, setLocation] = useState('');
  const [remark, setRemark] = useState('');
  const [channelId, setChannelId] = useState('');
  const [channelName, setChannelName] = useState('');
  const [executors, setExecutors] = useState([]);
  const [localErr, setLocalErr] = useState('');
  const [conflictBox, setConflictBox] = useState(null);

  useEffect(() => {
    http.get('/api/packages').then((r) => setPkgList(r.data || [])).catch(() => {});
    http.get('/api/channels').then((r) => {
      const rows = r.data || [];
      if (rows.length) setChList(rows);
      else setChList([
        { id: 1, name: '抖音' }, { id: 2, name: '小红书' }, { id: 3, name: '美团' },
        { id: 4, name: '小程序' }, { id: 5, name: '客户推荐' }, { id: 6, name: '自然进店' }, { id: 7, name: '其他来源' }
      ]);
    }).catch(() => {});
  }, []);
  useEffect(() => {
    const onDown = (e) => {
      if (execPopRef.current && !execPopRef.current.contains(e.target)) setExecPop(false);
      if (payPopRef.current && !payPopRef.current.contains(e.target)) setPayPop(false);
      if (chPopRef.current && !chPopRef.current.contains(e.target)) setChPop(false);
      if (timeRef.current && !timeRef.current.contains(e.target)) setTimeOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);
  useEffect(() => {
    // Auto-fill deposit based on payment status for page-mode UX
    const price = parseFloat(pkgPrice) || 0;
    if (payStatus === 'paid') setDeposit(price ? String(price) : deposit);
    else if (payStatus === 'unpaid') setDeposit('0');
    // 'deposit' keeps user value so they can fill it
  }, [payStatus, pkgPrice]);

  const toggleSlot = (h) => setSlots((p) => p.includes(h) ? p.filter((x) => x !== h) : [...p, h]);
  const onChooseSession = (v) => { setChooseSession(v); if (v) setDateTbd(false); };
  const onDateTbd = (v) => { setDateTbd(v); if (v) { setChooseSession(false); setSlots([]); } };

  const onPickPackage = (id) => {
    setPkgId(id);
    const p = pkgList.find((x) => String(x.id) === String(id));
    if (p) {
      setPkgPrice(String(p.price ?? ''));
      setPriceMissing(!(p.price > 0));
      const d = (p.details && typeof p.details === 'object') ? p.details : {};
      setPkgDuration(p.duration || d.duration || '');
      setPkgRawCount(d.raw_count || '');
      setPkgRetouch(p.retouch_count || d.retouch_count || '');
      setPkgExtraFee(d.extra_photo_fee || '');
      if (payStatus === 'paid') setDeposit(String(p.price ?? ''));
      else if (payStatus === 'unpaid') setDeposit('0');
    }
  };
  const onPickChannel = (id, name) => { setChannelId(id); setChannelName(name); setChPop(false); };

  const addCustomer = () => setCustomers((c) => [...c, { name: '', phone: '' }]);
  const setCustomerAt = (i, key, v) => setCustomers((c) => c.map((x, idx) => idx === i ? { ...x, [key]: v } : x));
  const removeCustomerAt = (i) => setCustomers((c) => (c.length > 1 ? c.filter((_, idx) => idx !== i) : [{ name: '', phone: '' }]));

  const addExtra = () => setExtras((e) => [...e, { name: '', amount: '' }]);
  const setExtraAt = (i, key, v) => setExtras((e) => e.map((x, idx) => idx === i ? { ...x, [key]: v } : x));
  const removeExtraAt = (i) => setExtras((e) => e.filter((_, idx) => idx !== i));

  const toggleExec = (p) => {
    setExecutors((cur) => {
      const exists = cur.find((x) => String(x.id) === String(p.id));
      if (exists) return cur.filter((x) => String(x.id) !== String(p.id));
      return [...cur, { id: p.id, name: p.name, avatar: p.avatar || '' }];
    });
  };
  const removeExec = (id) => setExecutors((cur) => cur.filter((x) => String(x.id) !== String(id)));

  const save = async () => {
    setLocalErr('');
    if (!dateTbd && !shootDate) return setLocalErr('请选择拍摄日期');
    const filled = customers.filter((c) => c.name.trim() || c.phone.trim());
    const names = filled.map((c) => c.name.trim()).filter(Boolean);
    if (names.length === 0) return setLocalErr('请填写顾客姓名');
    const customerName = names.join(' & ');
    const phoneList = filled.map((c) => c.phone.trim()).filter(Boolean);
    if (phoneList.length === 0) return setLocalErr('请至少填写一个联系电话');
    if (!phoneList.every((p) => PHONE_RE.test(p))) {
      const msg = '联系电话格式不正确，请填写有效的 11 位手机号';
      setLocalErr(msg); toast(msg); return;
    }
    if (!pkgId) return setLocalErr('请选择套系名称');
    if (!pkgPrice || parseFloat(pkgPrice) <= 0) return setLocalErr('请填写套系价格');
    if (payStatus === 'paid' && parseFloat(deposit) <= 0) return setLocalErr('收款状态为「已付全款」时，已付金额必须大于 0');
    if (payStatus === 'deposit' && parseFloat(deposit) <= 0) return setLocalErr('收款状态为「已付定金」时，定金必须大于 0');
    if (chooseSession && slots.length === 0) return setLocalErr('请选择场次时间段');
    const payload = {
      order_name: orderName.trim(),
      customerName: customerName.trim(),
      customerPhoneList: phoneList,
      customer_name: customerName.trim(),
      phones: phoneList,
      shoot_date: dateTbd ? '' : shootDate,
      date_tbd: dateTbd ? 1 : 0,
      time_slots: slots,
      package_id: pkgId ? Number(pkgId) : null,
      package_price: parseFloat(pkgPrice) || 0,
      deposit: parseFloat(deposit) || 0,
      payment_status: payStatus,
      extra_items: extras.filter((e) => e.name || e.amount).map((e) => ({ name: (e.name || '').trim(), amount: parseFloat(e.amount) || 0 })),
      address: location.trim(),
      remark: [remark.trim(), birthdayText.trim()].filter(Boolean).join('\n'),
      channel: channelName,
      channel_id: channelId ? Number(channelId) : null,
      executors,
      package_defaults: {
        duration: pkgDuration || null,
        raw_count: pkgRawCount ? Number(pkgRawCount) : null,
        retouch_count: pkgRetouch ? Number(pkgRetouch) : null,
        extra_photo_fee: pkgExtraFee || null
      }
    };
    await postOrder(payload, false);
  };

  const postOrder = async (payload, force) => {
    try {
      await http.post('/api/orders', { ...payload, force: force ? 1 : 0 });
      setConflictBox(null);
      if (onSaved) onSaved();
      else nav('/schedule');
    } catch (e) {
      const cf = conflictOf(e);
      if (cf && cf.forcible && !force) { setConflictBox({ message: cf.message, payload }); return; }
      setLocalErr((e && e.message) || (e.response && e.response.data && e.response.data.error) || '保存失败');
    }
  };

  const slotLabel = (s) => s === HALF ? '半天' : s === FULL ? '全天' : s;
  const formatDateCn = (ds) => {
    if (!ds) return '';
    const d = new Date(ds + 'T00:00:00');
    if (isNaN(d.getTime())) return ds;
    const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    return `${ds}星期${week}`;
  };

  const isDirty = () => !!(orderName.trim() || customers.some((c) => c.name.trim() || c.phone.trim()) || shootDate || pkgId || pkgPrice || deposit || payStatus !== 'deposit' || remark.trim() || birthdayText.trim() || location.trim() || channelId || executors.length || extras.length || slots.length || dateTbd);
  const requestClose = () => {
    if (isDirty()) {
      if (!window.confirm('确定放弃当前填写的内容吗？')) return;
    }
    if (onClose) onClose();
    else nav('/schedule');
  };

  const BLOCK = { border: `1px solid ${DLG_BLOCK_BORDER}`, borderRadius: 6, padding: 16, marginBottom: 16 };
  const BLOCK_TITLE = { fontSize: 14, fontWeight: 500, color: '#333333', marginBottom: 12 };
  const FIELD = {
    height: 38, width: '100%', background: '#FFFFFF',
    border: `1px solid ${DLG_FIELD_BORDER}`, borderRadius: 4,
    padding: '0 12px', fontSize: 14, color: '#333333', outline: 'none'
  };
  const payLabel = { unpaid: '未付款', deposit: '已付定金', paid: '已付全款' }[payStatus] || '请选择收款状态';
  const PAY_OPTIONS = [
    { v: 'unpaid', label: '未付款' },
    { v: 'deposit', label: '已付定金' },
    { v: 'paid', label: '已付全款' }
  ];
  const Caret = ({ rotate, color = '#999999' }) => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke={color} strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="shrink-0"
      style={{ transform: rotate ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}><path d="m6 9 6 6 6-6" /></svg>
  );
  const Star = () => <span style={{ color: MODAL_RED, marginRight: 2, fontSize: 14 }}>*</span>;

  // page-mode 1:1 spec colors
  const PAGE_BG = '#F7F7F7';
  const PAGE_BAR = '#3F3F3F';
  const PAGE_ROW_BG = '#FFFFFF';
  const PAGE_BORDER = '#F2F2F2';
  const PAGE_ICON = '#BBBBBB';
  const PAGE_TEXT = '#333333';
  const PAGE_PLACE = '#BBBBBB';
  const PAGE_LINK = '#999999';
  const PAGE_GAP = 10;

  const formBody = (
    <>
      <div style={{ border: `1px solid ${MODAL_BORDER}`, borderRadius: 3, padding: '18px 20px', marginBottom: 16, minHeight: 90 }}>
        <div className="flex items-center" style={{ gap: 12 }}>
          <div className="shrink-0 rounded-full flex items-center justify-center"
            style={{ width: 48, height: 48, background: '#D8D8D8', color: '#FFFFFF' }}>
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="3.4" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
            </svg>
          </div>
          <input value={orderName} onChange={(e) => setOrderName(e.target.value)} placeholder="请输入订单名称"
            className="placeholder-[#B5B5B5]" style={{ ...FIELD, flex: 1, width: 'auto', borderColor: MODAL_BORDER }} />
        </div>
        <div style={{ marginTop: 12 }}>
          {customers.map((c, i) => (
            <div key={i} className="flex items-center" style={{ gap: 12, marginBottom: i < customers.length - 1 ? 10 : 0 }}>
              <div className="flex items-center" style={{ gap: 4, flex: 1, width: 'auto' }}>
                <Star />
                <input value={c.name} onChange={(e) => setCustomerAt(i, 'name', e.target.value)} placeholder="顾客姓名"
                  className="placeholder-[#B5B5B5]"
                  style={{ ...FIELD, flex: 1, width: 'auto', borderColor: MODAL_BORDER }} />
              </div>
              <div className="relative flex items-center" style={{ gap: 4, flex: 1 }}>
                <Star />
                <input value={c.phone} onChange={(e) => setCustomerAt(i, 'phone', e.target.value)} placeholder="电话号码"
                  className="placeholder-[#B5B5B5]"
                  style={{ ...FIELD, flex: 1, width: 'auto', borderColor: MODAL_BORDER }} />
                {customers.length > 1 && (
                  <button type="button" onClick={() => removeCustomerAt(i)} className="absolute top-1/2 -translate-y-1/2 hover:text-[#666666]"
                    style={{ right: 8, fontSize: 12, color: '#BBBBBB', background: 'none', border: 'none' }}>×</button>
                )}
              </div>
            </div>
          ))}
          <button type="button" onClick={addCustomer} className="flex items-center" style={{ gap: 4, color: MODAL_BLUE, fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0' }}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
            添加顾客
          </button>
        </div>
      </div>

      <div style={{ border: `1px solid ${MODAL_BORDER}`, borderRadius: 3, padding: '18px 20px', marginBottom: 16 }}>
        <div className="flex items-center" style={{ gap: 12 }}>
          <DatePicker value={shootDate} onChange={setShootDate} disabled={dateTbd} />
          <label className="flex items-center cursor-pointer shrink-0" style={{ gap: 6, fontSize: 14, color: '#999999' }}>
            <input type="checkbox" checked={chooseSession} onChange={(e) => onChooseSession(e.target.checked)} style={{ width: 16, height: 16, accentColor: MODAL_BLUE }} />
            选择场次
          </label>
        </div>

        {chooseSession && (
          <div className="flex flex-wrap" style={{ gap: '10px 8px', marginTop: 12 }}>
            {HOURS.map((k) => {
              const on = slots.includes(k);
              return (
                <button key={k} onClick={() => toggleSlot(k)} type="button"
                  className="transition-opacity hover:opacity-90"
                  style={{ height: 30, borderRadius: 15, padding: '0 14px', fontSize: 14, background: on ? MODAL_SLOT_SEL : MODAL_SLOT_FREE, color: '#FFFFFF' }}>
                  {on ? '✓ ' : ''}{k}
                </button>
              );
            })}
            {[HALF, FULL].map((k) => {
              const on = slots.includes(k);
              return (
                <button key={k} onClick={() => toggleSlot(k)} type="button"
                  className="transition-opacity hover:opacity-90"
                  style={{ height: 30, borderRadius: 15, padding: '0 14px', fontSize: 14, background: on ? MODAL_SLOT_SEL : MODAL_SLOT_FREE, color: '#FFFFFF' }}>
                  {on ? '✓ ' : ''}{slotLabel(k)}
                </button>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: 12, background: MODAL_TBD, border: `1px solid ${MODAL_TBD_BORDER}`, borderRadius: 3, height: 36, display: 'flex', alignItems: 'center', padding: '0 8px' }}>
          <label className="flex items-center cursor-pointer" style={{ gap: 6, fontSize: 14, color: '#666666' }}>
            <input type="checkbox" checked={dateTbd} onChange={(e) => onDateTbd(e.target.checked)} style={{ width: 16, height: 16, accentColor: MODAL_BLUE }} />
            日期待定
          </label>
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13, color: '#666666', marginBottom: 6 }}><Star />套系名称</div>
          <PackagePicker pkgList={pkgList} value={pkgId} onPick={onPickPackage} />
          <div style={{ fontSize: 13, color: '#666666', marginBottom: 6, marginTop: 12 }}><Star />套系价格</div>
          <input value={pkgPrice} onChange={(e) => setPkgPrice(e.target.value)} placeholder="套系价格" className="placeholder-[#B5B5B5]" style={{ ...FIELD, borderColor: MODAL_BORDER }} />
          <div style={{ fontSize: 13, color: '#666666', marginBottom: 6, marginTop: 12 }}><Star />套系定金</div>
          <input value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="套系定金" className="placeholder-[#B5B5B5]" style={{ ...FIELD, borderColor: MODAL_BORDER }} />
          {pkgList.find((p) => String(p.id) === String(pkgId)) && (
            <div style={{ marginTop: 10, fontSize: 12, color: '#999999' }}>
              已同步默认配置：拍摄时长 {pkgDuration || '—'} · 底片数量 {pkgRawCount || '—'} · 精修片 {pkgRetouch || '—'} · 加片费 {pkgExtraFee || '—'}
            </div>
          )}
        </div>
      </div>

      <div style={{ border: `1px solid ${MODAL_BORDER}`, borderRadius: 3, padding: '18px 20px', marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: '#333333', marginBottom: 12 }}><Star />收款状态</div>
        <div className="relative" ref={payPopRef}>
          <button onClick={() => setPayPop((v) => !v)}
            className="flex items-center justify-between"
            style={{ height: 44, width: 150, background: '#FFFFFF', border: `1px solid ${payPop ? MODAL_ACTIVE : MODAL_BORDER}`, borderRadius: 4, padding: '0 12px', fontSize: 14, color: payStatus ? '#666666' : '#AAAAAA', outline: 'none' }}>
            <span>{payLabel}</span>
            <Caret rotate={payPop} />
          </button>
          {payPop && (
            <div className="absolute left-0 bg-white overflow-hidden"
              style={{ top: 50, width: 150, borderRadius: 4, boxShadow: '0 2px 8px rgba(0,0,0,0.12)', zIndex: 30 }}>
              {PAY_OPTIONS.map((o) => {
                const on = payStatus === o.v;
                return (
                  <button key={o.v} onClick={() => { setPayStatus(o.v); setPayPop(false); }}
                    className="w-full text-left transition-colors"
                    style={{ height: 44, padding: '0 12px', fontSize: 14, color: on ? MODAL_BLUE : '#666666', background: on ? MODAL_POP_HOVER : 'transparent' }}>
                    {o.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ borderTop: `1px solid ${MODAL_DIV}`, marginTop: 16 }} />
        <div className="flex items-center justify-between" style={{ height: 50 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#666666' }}>其他消费</div>
          <button onClick={addExtra} className="hover:opacity-80" style={{ fontSize: 14, color: MODAL_BLUE }}>添加</button>
        </div>
        <div style={{ borderBottom: `1px solid ${MODAL_DIV}`, marginBottom: 4 }} />
        {extras.map((e, i) => (
          <div key={i} className="flex items-center" style={{ gap: 12, marginBottom: 8 }}>
            <input value={e.name} onChange={(ev) => setExtraAt(i, 'name', ev.target.value)} placeholder="消费名称"
              className="placeholder-[#B5B5B5]" style={{ ...FIELD, flex: 1, width: 'auto', borderColor: MODAL_BORDER }} />
            <input value={e.amount} onChange={(ev) => setExtraAt(i, 'amount', ev.target.value)} placeholder="金额"
              className="placeholder-[#B5B5B5]" style={{ ...FIELD, width: 120, borderColor: MODAL_BORDER }} />
            <button onClick={() => removeExtraAt(i)} className="shrink-0 hover:text-[#666666]" style={{ fontSize: 14, color: '#BBBBBB' }}>×</button>
          </div>
        ))}
      </div>

      <div style={{ border: `1px solid ${MODAL_BORDER}`, borderRadius: 3, padding: '18px 20px', marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: '#333333', marginBottom: 12 }}>拍摄地点</div>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#B5B5B5', pointerEvents: 'none' }}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z" /><circle cx="12" cy="10" r="3" /></svg>
          </span>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="输入拍摄地点"
            className="placeholder-[#B5B5B5]" style={{ ...FIELD, height: 60, paddingLeft: 38, borderColor: MODAL_BORDER }} />
        </div>
        {!showRemark && !remark && (
          <button onClick={() => setShowRemark(true)} className="hover:opacity-80 flex items-center gap-1.5" style={{ height: 42, fontSize: 14, color: MODAL_BLUE }}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
            添加备注
          </button>
        )}
        {(showRemark || remark) && (
          <textarea value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="备注：如 婚礼跟拍 / 特殊要求"
            className="placeholder-[#B5B5B5]" rows={3}
            style={{ ...FIELD, height: 'auto', marginTop: 12, padding: '10px 12px', resize: 'vertical', borderColor: MODAL_BORDER }} />
        )}
      </div>

      <div style={{ border: `1px solid ${MODAL_BORDER}`, borderRadius: 3, padding: '18px 20px', marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: '#333333', marginBottom: 12 }}>渠道来源</div>
        <div className="relative" ref={chPopRef}>
          <button onClick={() => setChPop((v) => !v)}
            className="flex items-center justify-between"
            style={{ ...FIELD, color: channelName ? '#666666' : MODAL_PLACE, borderColor: MODAL_BORDER }}>
            <span>{channelName || '请选择渠道来源'}</span>
            <Caret rotate={chPop} />
          </button>
          {chPop && (
            <div className="absolute left-0 bg-white overflow-hidden"
              style={{ top: 50, width: 170, borderRadius: 4, boxShadow: '0 2px 10px rgba(0,0,0,0.12)', zIndex: 30, maxHeight: 280, overflowY: 'auto' }}>
              {chList.map((c) => {
                const on = String(channelId) === String(c.id);
                return (
                  <button key={c.id} onClick={() => onPickChannel(c.id, c.name)}
                    className="w-full flex items-center text-left transition-colors"
                    style={{ height: 44, padding: '0 12px', gap: 8, fontSize: 14, color: on ? MODAL_BLUE : '#666666', background: on ? MODAL_POP_HOVER : 'transparent' }}>
                    <span className="shrink-0 rounded-full inline-flex items-center justify-center"
                      style={{ width: 20, height: 20, background: '#EAF2FE', color: MODAL_BLUE, fontSize: 11 }}>{(c.name || '?').slice(0, 1)}</span>
                    {c.name}
                  </button>
                );
              })}
              <button
                onClick={() => { setChPop(false); window.location.hash = '#/channels'; }}
                className="w-full text-left transition-colors"
                style={{ height: 44, padding: '0 12px', fontSize: 13, color: MODAL_BLUE, borderTop: `1px solid ${MODAL_DIV}` }}>
                渠道管理
              </button>
            </div>
          )}
        </div>
      </div>

      <div style={{ border: `1px solid ${MODAL_BORDER}`, borderRadius: 3, padding: '0 20px', height: 52, marginBottom: 0, display: 'flex', alignItems: 'center' }}>
        <div className="relative flex-1" ref={execPopRef}>
          <div className="flex flex-wrap items-center" style={{ gap: 10 }}>
            <span style={{ fontSize: 14, color: '#333333', fontWeight: 500, marginRight: 4 }}>执行人</span>
            {executors.map((ex) => (
              <span key={ex.id ?? ex.name} className="inline-flex items-center"
                style={{ gap: 6, height: 32, padding: '0 8px 0 4px', borderRadius: 16, background: '#F2F2F2', color: '#333333', fontSize: 13 }}>
                {ex.avatar
                  ? <img src={ex.avatar} className="rounded-full" style={{ width: 24, height: 24 }} alt="" />
                  : <span className="rounded-full inline-flex items-center justify-center" style={{ width: 24, height: 24, background: '#333333', color: '#fff', fontSize: 11 }}>{(ex.name || '?').slice(0, 1)}</span>}
                {ex.name}
                <button onClick={() => removeExec(ex.id)} className="hover:opacity-70" style={{ fontSize: 12 }}>×</button>
              </span>
            ))}
            <button onClick={() => setExecPop((v) => !v)} aria-label="添加执行人"
              className="shrink-0 flex items-center justify-center"
              style={{ width: 26, height: 26, borderRadius: '50%', background: MODAL_BLUE, color: '#fff', fontSize: 16, lineHeight: 1 }}>＋</button>
          </div>
          {execPop && (
            <div className="absolute left-0 bg-white overflow-auto"
              style={{ top: 40, width: 220, maxHeight: 208, borderRadius: 4, boxShadow: '0 2px 12px rgba(0,0,0,0.12)', zIndex: 30 }}>
              {personnel.length === 0 && <div style={{ padding: '10px 12px', fontSize: 12, color: '#999999' }}>暂无人员</div>}
              {personnel.map((p) => {
                const on = !!executors.find((x) => String(x.id) === String(p.id));
                return (
                  <button key={p.id} onClick={() => toggleExec(p)}
                    className="w-full flex items-center text-left transition-colors"
                    style={{ height: 44, padding: '0 12px', gap: 8, fontSize: 14, color: on ? MODAL_BLUE : '#666666', background: on ? MODAL_POP_HOVER : 'transparent' }}>
                    {p.avatar
                      ? <img src={p.avatar} className="rounded-full" style={{ width: 20, height: 20 }} alt="" />
                      : <span className="rounded-full inline-flex items-center justify-center" style={{ width: 20, height: 20, background: '#333333', color: '#fff', fontSize: 10 }}>{(p.name || '?').slice(0, 1)}</span>}
                    {p.name}
                    {on && <span className="ml-auto">✓</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {localErr && <div style={{ marginTop: 12, fontSize: 12, color: MODAL_RED }}>{localErr}</div>}

      <div className="flex justify-center" style={{ marginTop: 36, position: 'sticky', bottom: 0, background: '#F7F7F7', padding: '12px 0 4px', borderTop: '1px solid #EEEEEE' }}>
        <button onClick={save} className="text-white hover:opacity-90 transition-opacity"
          style={{ width: 100, height: 40, background: MODAL_BLUE, borderRadius: 2, fontSize: 16 }}>保存</button>
      </div>

      {conflictBox && (
        <div className="fixed inset-0 flex items-center justify-center z-[95] p-4" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={(e) => e.stopPropagation()}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 380, background: '#fff', borderRadius: 8, padding: 24 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#222222', marginBottom: 8 }}>档期冲突</div>
            <div style={{ fontSize: 14, color: '#333333', lineHeight: 1.7 }}>{conflictBox.message}</div>
            <div style={{ fontSize: 12, color: '#888888', marginTop: 8 }}>继续保存会在同一天产生重复占用，请确认是否由不同执行人分别承接。</div>
            <div className="flex justify-end" style={{ gap: 8, marginTop: 20 }}>
              <button onClick={() => setConflictBox(null)}
                style={{ height: 34, padding: '0 14px', borderRadius: 4, border: '1px solid #DDDDDD', background: '#fff', fontSize: 14, color: '#333333' }}>换个日期</button>
              <button onClick={() => postOrder(conflictBox.payload, true)}
                style={{ height: 34, padding: '0 14px', borderRadius: 4, border: 'none', background: '#FF8A34', color: '#fff', fontSize: 14 }}>仍要占用</button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  const pageFormBody = isPage && (
    <div style={{ paddingBottom: 'calc(20px + env(safe-area-inset-bottom))' }}>
      {/* 订单名称 */}
      <div style={{ background: PAGE_ROW_BG, marginBottom: PAGE_GAP, padding: '14px 16px' }}>
        <div className="flex items-center" style={{ gap: 4 }}>
          <Star />
          <input value={orderName} onChange={(e) => setOrderName(e.target.value)} placeholder="输入订单名称"
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, color: PAGE_TEXT, background: 'transparent' }} />
        </div>
      </div>

      {/* 电话 + 客户姓名 */}
      <div style={{ background: PAGE_ROW_BG, marginBottom: PAGE_GAP, padding: '0 16px' }}>
        {customers.map((c, i) => (
          <div key={i} className="flex items-center" style={{ gap: 8, padding: '12px 0', borderBottom: i < customers.length - 1 ? `1px solid ${PAGE_BORDER}` : 'none' }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke={PAGE_ICON} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
            <input value={c.phone} onChange={(e) => setCustomerAt(i, 'phone', e.target.value)} placeholder="添加电话"
              style={{ flex: 1.2, border: 'none', outline: 'none', fontSize: 15, color: PAGE_TEXT, background: 'transparent' }} />
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke={PAGE_ICON} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></svg>
            <input value={c.name} onChange={(e) => setCustomerAt(i, 'name', e.target.value)} placeholder="客户姓名"
              style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, color: PAGE_TEXT, background: 'transparent' }} />
            {customers.length === 1 && i === 0 ? (
              <button onClick={addCustomer} style={{ color: PAGE_ICON, background: 'none', border: 'none', padding: '0 2px' }}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
              </button>
            ) : (
              <button onClick={() => removeCustomerAt(i)} style={{ color: '#BBBBBB', fontSize: 18, background: 'none', border: 'none', padding: '0 4px' }}>×</button>
            )}
          </div>
        ))}
      </div>

      {/* 日期 + 时间 + 待定 */}
      <div style={{ background: PAGE_ROW_BG, marginBottom: PAGE_GAP, padding: '12px 16px' }}>
        <div className="flex items-center" style={{ gap: 10 }}>
          <div className="flex items-center" style={{ gap: 6, flex: 1.6, minWidth: 0 }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke={PAGE_ICON} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 10h18M8 2v4M16 2v4" /></svg>
            <DatePicker value={shootDate} onChange={setShootDate} disabled={dateTbd} compact label={shootDate ? formatDateCn(shootDate) : '选择日期'} />
          </div>
          <div className="flex items-center" style={{ gap: 6, flex: 1, minWidth: 0 }} ref={timeRef}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke={PAGE_ICON} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
            <button type="button" onClick={() => setTimeOpen((v) => !v)} disabled={dateTbd}
              style={{ flex: 1, height: 32, border: 'none', background: 'transparent', textAlign: 'left', fontSize: 15, color: dateTbd ? '#CCCCCC' : (slots.length ? PAGE_TEXT : PAGE_PLACE), outline: 'none' }}>
              {slots.length ? slotLabel(slots[0]) : '选择时间'}
            </button>
            {timeOpen && (
              <div className="absolute bg-white" style={{ top: 40, left: 0, right: 0, maxHeight: 220, overflowY: 'auto', borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 40, border: `1px solid ${DLG_BLOCK_BORDER}` }}>
                {HOURS.map((h) => (
                  <button key={h} type="button" onClick={() => { setSlots([h]); setChooseSession(true); setTimeOpen(false); }}
                    className="w-full text-left transition-colors hover:bg-[#F0F7FF]"
                    style={{ padding: '10px 12px', fontSize: 14, color: slots[0] === h ? MODAL_BLUE : PAGE_TEXT }}>{h}</button>
                ))}
              </div>
            )}
          </div>
          <label className="flex items-center shrink-0 cursor-pointer" style={{ gap: 6, fontSize: 14, color: '#999999' }}>
            <input type="checkbox" checked={dateTbd} onChange={(e) => onDateTbd(e.target.checked)} style={{ width: 16, height: 16, accentColor: MODAL_BLUE }} />
            待定
          </label>
        </div>
      </div>

      {/* 套系名称 */}
      <div style={{ background: PAGE_ROW_BG, marginBottom: PAGE_GAP, padding: '0 16px' }}>
        <div className="flex items-center" style={{ gap: 6, padding: '10px 0' }}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke={PAGE_ICON} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
          <Star />
          <div style={{ flex: 1, minWidth: 0 }}>
            <PackagePicker pkgList={pkgList} value={pkgId} onPick={onPickPackage} compact />
          </div>
        </div>
        {priceMissing && (
          <div className="flex items-center" style={{ gap: 8, padding: '10px 0', borderTop: `1px solid ${PAGE_BORDER}` }}>
            <span style={{ fontSize: 14, color: MODAL_RED }}>套系价格</span>
            <input value={pkgPrice} onChange={(e) => { setPkgPrice(e.target.value); setPriceMissing(!(parseFloat(e.target.value) > 0)); }} placeholder="请输入价格"
              style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, color: PAGE_TEXT, background: 'transparent' }} />
          </div>
        )}
        {pkgId && payStatus === 'deposit' && (
          <div className="flex items-center" style={{ gap: 8, padding: '10px 0', borderTop: `1px solid ${PAGE_BORDER}` }}>
            <span style={{ fontSize: 14, color: MODAL_RED }}>定金</span>
            <input value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="请输入定金"
              style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, color: PAGE_TEXT, background: 'transparent' }} />
          </div>
        )}
      </div>

      {/* 执行人 */}
      <div style={{ background: PAGE_ROW_BG, marginBottom: PAGE_GAP, padding: '0 16px' }}>
        <div onClick={() => setExecPop(true)} className="flex items-center justify-between cursor-pointer" style={{ padding: '14px 0' }}>
          <span style={{ fontSize: 15, color: PAGE_TEXT }}>执行人</span>
          <div className="flex items-center" style={{ gap: 6, maxWidth: '60%' }}>
            {executors.length > 0 ? (
              <span className="truncate" style={{ fontSize: 14, color: PAGE_TEXT }}>{executors.map((e) => e.name).join('、')}</span>
            ) : (
              <span style={{ fontSize: 14, color: PAGE_PLACE }}>请选择</span>
            )}
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#CCCCCC" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
          </div>
        </div>
        {execPop && (
          <div className="fixed inset-0 z-[60] flex items-end" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={() => setExecPop(false)}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxHeight: '70vh', background: '#fff', borderRadius: '16px 16px 0 0', padding: '16px 0 calc(20px + env(safe-area-inset-bottom))' }}>
              <div className="flex items-center justify-between" style={{ padding: '0 16px 12px', borderBottom: `1px solid ${PAGE_BORDER}` }}>
                <span style={{ fontSize: 16, fontWeight: 500, color: PAGE_TEXT }}>选择执行人</span>
                <button onClick={() => setExecPop(false)} style={{ color: '#999999', fontSize: 20, background: 'none', border: 'none' }}>×</button>
              </div>
              <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
                {personnel.length === 0 && <div style={{ padding: '16px', fontSize: 14, color: PAGE_PLACE }}>暂无人员</div>}
                {personnel.map((p) => {
                  const on = !!executors.find((x) => String(x.id) === String(p.id));
                  return (
                    <button key={p.id} onClick={() => toggleExec(p)} className="w-full flex items-center text-left"
                      style={{ padding: '12px 16px', gap: 10, fontSize: 15, color: PAGE_TEXT, background: 'transparent', borderBottom: `1px solid ${PAGE_BORDER}` }}>
                      {p.avatar
                        ? <img src={p.avatar} className="rounded-full" style={{ width: 24, height: 24 }} alt="" />
                        : <span className="rounded-full inline-flex items-center justify-center" style={{ width: 24, height: 24, background: '#333333', color: '#fff', fontSize: 11 }}>{(p.name || '?').slice(0, 1)}</span>}
                      {p.name}
                      {on && <span className="ml-auto" style={{ color: MODAL_BLUE }}>✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 拍摄地点 */}
      <div style={{ background: PAGE_ROW_BG, marginBottom: PAGE_GAP, padding: '14px 16px' }}>
        <div className="flex items-center" style={{ gap: 10 }}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke={PAGE_ICON} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z" /><circle cx="12" cy="10" r="3" /></svg>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="拍摄地点"
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, color: PAGE_TEXT, background: 'transparent' }} />
        </div>
      </div>

      {/* 备注 */}
      <div style={{ background: PAGE_ROW_BG, marginBottom: PAGE_GAP, padding: '14px 16px' }}>
        <div className="flex items-center" style={{ gap: 10 }}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke={PAGE_ICON} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
          <input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="备注"
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, color: PAGE_TEXT, background: 'transparent' }} />
        </div>
      </div>

      {/* 生日/纪念日 */}
      <div style={{ background: PAGE_ROW_BG, marginBottom: PAGE_GAP, padding: '14px 16px' }}>
        {!showBirthday && !birthdayText ? (
          <button onClick={() => setShowBirthday(true)} className="flex items-center" style={{ gap: 4, fontSize: 14, color: PAGE_LINK, background: 'none', border: 'none', padding: 0 }}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
            添加客户生日、纪念日
          </button>
        ) : (
          <textarea value={birthdayText} onChange={(e) => setBirthdayText(e.target.value)} placeholder="填写客户生日、纪念日等信息"
            rows={2} style={{ width: '100%', border: 'none', outline: 'none', fontSize: 15, color: PAGE_TEXT, background: 'transparent', resize: 'none' }} />
        )}
      </div>

      {/* 渠道来源 */}
      <div style={{ background: PAGE_ROW_BG, marginBottom: PAGE_GAP, padding: '0 16px' }}>
        <div onClick={() => setChPop(true)} className="flex items-center justify-between cursor-pointer" style={{ padding: '14px 0' }}>
          <span style={{ fontSize: 15, color: PAGE_TEXT }}>渠道来源</span>
          <div className="flex items-center" style={{ gap: 6 }}>
            <span style={{ fontSize: 14, color: channelName ? PAGE_TEXT : PAGE_PLACE }}>{channelName || '请选择'}</span>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#CCCCCC" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
          </div>
        </div>
        {chPop && (
          <div className="fixed inset-0 z-[60] flex items-end" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={() => setChPop(false)}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxHeight: '70vh', background: '#fff', borderRadius: '16px 16px 0 0', padding: '16px 0 calc(20px + env(safe-area-inset-bottom))' }}>
              <div className="flex items-center justify-between" style={{ padding: '0 16px 12px', borderBottom: `1px solid ${PAGE_BORDER}` }}>
                <span style={{ fontSize: 16, fontWeight: 500, color: PAGE_TEXT }}>选择渠道来源</span>
                <button onClick={() => setChPop(false)} style={{ color: '#999999', fontSize: 20, background: 'none', border: 'none' }}>×</button>
              </div>
              <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
                {chList.map((c) => {
                  const on = String(channelId) === String(c.id);
                  return (
                    <button key={c.id} onClick={() => onPickChannel(c.id, c.name)} className="w-full flex items-center text-left"
                      style={{ padding: '12px 16px', gap: 10, fontSize: 15, color: PAGE_TEXT, background: 'transparent', borderBottom: `1px solid ${PAGE_BORDER}` }}>
                      <span className="rounded-full inline-flex items-center justify-center" style={{ width: 24, height: 24, background: '#EAF2FE', color: MODAL_BLUE, fontSize: 11 }}>{(c.name || '?').slice(0, 1)}</span>
                      {c.name}
                      {on && <span className="ml-auto" style={{ color: MODAL_BLUE }}>✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 其他消费 */}
      <div style={{ background: PAGE_ROW_BG, marginBottom: PAGE_GAP, padding: '0 16px' }}>
        <div onClick={() => setExtrasOpen((v) => !v)} className="flex items-center justify-between cursor-pointer" style={{ padding: '14px 0' }}>
          <span style={{ fontSize: 15, color: PAGE_TEXT }}>其他消费</span>
          <div className="flex items-center" style={{ gap: 6 }}>
            <span style={{ fontSize: 14, color: extras.length ? PAGE_TEXT : PAGE_PLACE }}>{extras.length ? `${extras.length} 项` : '无'}</span>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#CCCCCC" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: extrasOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}><path d="m9 18 6-6-6-6" /></svg>
          </div>
        </div>
        {extrasOpen && (
          <div style={{ paddingBottom: 12 }}>
            {extras.map((e, i) => (
              <div key={i} className="flex items-center" style={{ gap: 8, marginBottom: 8 }}>
                <input value={e.name} onChange={(ev) => setExtraAt(i, 'name', ev.target.value)} placeholder="消费名称"
                  style={{ flex: 1, height: 36, border: `1px solid ${PAGE_BORDER}`, borderRadius: 4, padding: '0 10px', fontSize: 14, outline: 'none' }} />
                <input value={e.amount} onChange={(ev) => setExtraAt(i, 'amount', ev.target.value)} placeholder="金额"
                  style={{ width: 90, height: 36, border: `1px solid ${PAGE_BORDER}`, borderRadius: 4, padding: '0 10px', fontSize: 14, outline: 'none' }} />
                <button onClick={() => removeExtraAt(i)} style={{ color: '#BBBBBB', fontSize: 18, background: 'none', border: 'none', padding: '0 4px' }}>×</button>
              </div>
            ))}
            <button onClick={addExtra} className="flex items-center" style={{ gap: 4, fontSize: 14, color: MODAL_BLUE, background: 'none', border: 'none', padding: '6px 0' }}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
              添加消费
            </button>
          </div>
        )}
      </div>

      {localErr && <div style={{ padding: '0 16px', marginBottom: 10, fontSize: 13, color: MODAL_RED }}>{localErr}</div>}

      {/* 收款状态选择（page-mode 底部弹层） */}
      {pagePayOpen && (
        <div className="fixed inset-0 z-[70] flex items-end" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={() => setPagePayOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', background: '#fff', borderRadius: '16px 16px 0 0', padding: '16px 0 calc(24px + env(safe-area-inset-bottom))' }}>
            <div className="flex items-center justify-between" style={{ padding: '0 16px 12px', borderBottom: `1px solid ${PAGE_BORDER}` }}>
              <span style={{ fontSize: 16, fontWeight: 500, color: PAGE_TEXT }}>收款状态</span>
              <button onClick={() => setPagePayOpen(false)} style={{ color: '#999999', fontSize: 20, background: 'none', border: 'none' }}>×</button>
            </div>
            {PAY_OPTIONS.map((o) => (
              <button key={o.v} onClick={() => { setPayStatus(o.v); setPagePayOpen(false); }} className="w-full flex items-center text-left"
                style={{ padding: '14px 16px', fontSize: 15, color: PAGE_TEXT, background: 'transparent', borderBottom: `1px solid ${PAGE_BORDER}` }}>
                {o.label}
                {payStatus === o.v && <span className="ml-auto" style={{ color: MODAL_BLUE }}>✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  if (isPage) {
    return (
      <div style={{ minHeight: '100vh', background: PAGE_BG }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 50, height: 48, background: PAGE_BAR, display: 'flex', alignItems: 'center', padding: '0 12px' }}>
          <button type="button" onClick={requestClose} style={{ background: 'none', border: 'none', padding: 6, color: '#fff' }}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <button type="button" onClick={() => setPagePayOpen(true)} className="flex items-center justify-center" style={{ flex: 1, gap: 4, background: 'none', border: 'none', color: '#fff', fontSize: 16 }}>
            <span>{payLabel}</span>
            <Caret rotate={pagePayOpen} color="#fff" />
          </button>
          <button type="button" onClick={save} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 15, padding: '6px 4px' }}>保存</button>
        </div>
        {pageFormBody}
      </div>
    );
  }

  return (
    <div className="fixed inset-0" style={{ background: 'rgba(0,0,0,0.45)', zIndex: 999, overflowY: 'auto', display: 'flex', justifyContent: 'center', alignItems: isMobile ? 'flex-end' : 'flex-start' }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 560,
          maxHeight: isMobile ? '94dvh' : '88vh',
          margin: isMobile ? 0 : '40px auto',
          borderRadius: isMobile ? '16px 16px 0 0' : 6,
          boxShadow: '0 4px 18px rgba(0,0,0,0.18)',
          padding: isMobile ? '18px 16px calc(20px + env(safe-area-inset-bottom))' : '20px 20px 28px',
          position: 'relative', zIndex: 1000,
          background: '#F7F7F7', overflowY: 'auto'
        }}
      >
        <div className="relative" style={{ marginBottom: 24 }}>
          <div className="text-center" style={{ fontSize: 16, fontWeight: 500, color: '#333333' }}>新增订单</div>
          <button onClick={requestClose} aria-label="关闭"
            className="absolute top-0 hover:text-[#333333] transition-colors"
            style={{ right: 0, fontSize: 24, lineHeight: 1, color: '#999999' }}>×</button>
        </div>
        {formBody}
      </div>
    </div>
  );
}

function DatePicker({ value, onChange, disabled, label, compact }) {
  const init = value ? new Date(value + 'T00:00:00') : new Date();
  const [view, setView] = useState({ y: init.getFullYear(), m: init.getMonth() + 1 });
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  const cells = buildMonth(view.y, view.m - 1);
  const shift = (d) => { const t = view.y * 12 + (view.m - 1) + d; setView({ y: Math.floor(t / 12), m: (t % 12) + 1 }); };
  const pick = (day) => { onChange(`${view.y}-${pad(view.m)}-${pad(day)}`); setOpen(false); };
  return (
    <div className="relative" ref={ref} style={{ flex: 1, minWidth: 0 }}>
      <button type="button" disabled={disabled} onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between"
        style={compact
          ? { height: 24, width: '100%', background: 'transparent', border: 'none', padding: 0, fontSize: 15, color: disabled ? '#CCCCCC' : (value ? PAGE_TEXT : PAGE_PLACE), cursor: disabled ? 'not-allowed' : 'pointer', outline: 'none', textAlign: 'left' }
          : { height: 38, width: '100%', background: '#FFFFFF', border: `1px solid ${MODAL_BORDER}`, borderRadius: 4, padding: '0 12px', fontSize: 15, color: disabled ? '#999999' : (value ? '#666666' : MODAL_PLACE), cursor: disabled ? 'not-allowed' : 'pointer', outline: 'none' }}>
        <span>{label !== undefined ? label : (value ? value : '未选择日期')}</span>
        {!compact && (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" />
          </svg>
        )}
      </button>
      {open && (
        <div className="absolute left-0 bg-white" style={{ top: 44, width: 264, borderRadius: 6, border: `1px solid ${DLG_BLOCK_BORDER}`, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', padding: 12, zIndex: 40 }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
            <button type="button" onClick={() => shift(-1)} className="flex items-center justify-center rounded hover:bg-[#F4F7FB]" style={{ width: 28, height: 28, color: '#666666', border: '1px solid #E5E7EB' }}>‹</button>
            <span style={{ fontSize: 13, color: '#333333' }}>{view.y}年{view.m}月</span>
            <button type="button" onClick={() => shift(1)} className="flex items-center justify-center rounded hover:bg-[#F4F7FB]" style={{ width: 28, height: 28, color: '#666666', border: '1px solid #E5E7EB' }}>›</button>
          </div>
          <div className="grid grid-cols-7" style={{ gap: 2 }}>
            {['日', '一', '二', '三', '四', '五', '六'].map((w) => <div key={w} className="text-center" style={{ fontSize: 11, color: '#999999', height: 24, lineHeight: '24px' }}>{w}</div>)}
            {cells.map((day, i) => {
              if (day == null) return <div key={i} style={{ height: 30 }} />;
              const ds = `${view.y}-${pad(view.m)}-${pad(day)}`;
              const on = ds === value;
              return (
                <button key={i} type="button" onClick={() => pick(day)}
                  className="flex items-center justify-center rounded transition-colors hover:bg-[#F0F7FF]"
                  style={{ height: 30, fontSize: 13, color: on ? '#FFFFFF' : '#333333', background: on ? ADD_BTN : 'transparent' }}>{day}</button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function PackagePicker({ pkgList, value, onPick, compact }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const sel = pkgList.find((p) => String(p.id) === String(value));
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center justify-between w-full text-left"
        style={compact
          ? { height: 24, width: '100%', background: 'transparent', border: 'none', padding: 0, fontSize: 15, color: sel ? PAGE_TEXT : PAGE_PLACE, outline: 'none' }
          : { height: 38, width: '100%', background: '#FFFFFF', border: `1px solid ${MODAL_BORDER}`, borderRadius: 4, padding: '0 12px', fontSize: 14, color: sel ? '#333333' : MODAL_PLACE, outline: 'none' }}>
        <span className="truncate">{sel ? sel.name : (compact ? '套系名称' : '请选择套系名称')}</span>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#999999" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" className="shrink-0"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', opacity: compact ? 0.6 : 1 }}><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="absolute left-0 bg-white z-30" style={{ top: 44, width: 320, maxWidth: '100%', maxHeight: 320, overflowY: 'auto', borderRadius: 4, border: `1px solid ${MODAL_BORDER}`, boxShadow: '0 2px 10px rgba(0,0,0,0.12)' }}>
          {pkgList.length === 0 && <div style={{ padding: '12px', fontSize: 14, color: '#999999' }}>暂无套系</div>}
          {pkgList.map((p) => {
            const on = String(p.id) === String(value);
            const off = p.status === 'off';
            return (
              <button key={p.id} type="button" disabled={off}
                onClick={() => { if (off) return; onPick(String(p.id)); setOpen(false); }}
                className="w-full text-left transition-colors"
                style={{ padding: '10px 12px', fontSize: 14, color: off ? '#BBBBBB' : '#666666', background: on ? MODAL_POP_HOVER : 'transparent', borderBottom: '1px solid #F2F2F2', cursor: off ? 'not-allowed' : 'pointer', opacity: off ? 0.6 : 1 }}>
                <div className="flex items-center" style={{ justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 500, color: off ? '#999999' : '#333333' }}>{p.name}</span>
                  {off && <span style={{ fontSize: 12, color: '#BBBBBB', marginLeft: 8 }}>已下架</span>}
                </div>
                <div style={{ fontSize: 12, color: '#999999', marginTop: 2 }}>
                  ¥{p.price ?? '—'} · 定金 ¥{p.deposit ?? '—'} · 时长 {p.duration || '—'} · 精修 {p.retouch_count ?? '—'}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
