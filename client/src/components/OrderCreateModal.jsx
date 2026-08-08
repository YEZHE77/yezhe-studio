import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import http, { img } from '../api.js';

// ===== 新增订单弹窗（2026-08 重构）=====
// 交互硬规则：点击蒙层不关闭，仅右上角 X 可关闭；必填项标 *，校验失败弹提示并停留在弹窗。
// 数据硬规则：套系 / 渠道 / 执行人全部读后端接口，绝不写死前端。

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + ':00');

const PAY_OPTIONS = [
  { value: 'unpaid', label: '未付定金' },
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
    customer_name: '',
    phones: [''],
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

const inputCls =
  'w-full px-3 py-2 rounded-lg border border-line bg-ink text-sm text-fg outline-none focus:border-brand disabled:opacity-50 disabled:cursor-not-allowed';

function Label({ children, required }) {
  return (
    <label className="block text-xs text-muted mb-1">
      {children}
      {required && <span className="text-danger ml-0.5">*</span>}
    </label>
  );
}

function Section({ title, children }) {
  return (
    <div className="px-5 py-4 border-b border-line last:border-0">
      <div className="text-sm font-medium text-fg mb-3">{title}</div>
      {children}
    </div>
  );
}

export default function OrderCreateModal({ visible, packages, initialPackageId, onClose, onAfterCreate }) {
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyForm());
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [pkgList, setPkgList] = useState([]);
  const [channels, setChannels] = useState([]);
  const [people, setPeople] = useState([]);
  const [chOpen, setChOpen] = useState(false);
  const chRef = useRef(null);
  // 父级传入的套系数组引用可能每次渲染都变，放 ref 里避免把它写进 effect 依赖导致反复重置表单
  const pkgPropRef = useRef(packages);
  pkgPropRef.current = packages;

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  // 打开时重置表单并实时拉取套系 / 渠道 / 人员（全部接口驱动）
  useEffect(() => {
    if (!visible) return;
    setForm({ ...emptyForm(), package_id: initialPackageId || '' });
    setErr('');
    setChOpen(false);

    let alive = true;
    (async () => {
      const propPkgs = pkgPropRef.current;
      try {
        const list = propPkgs && propPkgs.length ? propPkgs : ((await http.get('/api/packages')).data || []);
        if (!alive) return;
        setPkgList(list);
        // 支持从「套系」页带 ?pkg= 预选，自动回填价格 / 定金
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
      try {
        const r = await http.get('/api/channels');
        if (alive) setChannels(r.data || []);
      } catch { if (alive) setChannels([]); }
      try {
        const r = await http.get('/api/admin/personnel');
        if (alive) setPeople(r.data || []);
      } catch { if (alive) setPeople([]); }
    })();
    return () => { alive = false; };
  }, [visible, initialPackageId]);

  // 渠道下拉：点击外部收起
  useEffect(() => {
    if (!chOpen) return;
    const onDown = (e) => { if (chRef.current && !chRef.current.contains(e.target)) setChOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [chOpen]);

  const extraTotal = useMemo(
    () => form.extra_items.reduce((s, x) => s + (parseFloat(x.amount) || 0), 0),
    [form.extra_items]
  );
  const totalAmount = (parseFloat(form.package_price) || 0) + extraTotal;

  if (!visible) return null;

  // —— 联系电话（可加多个） ——
  const setPhone = (i, v) => set({ phones: form.phones.map((p, k) => (k === i ? v : p)) });
  const addPhone = () => set({ phones: [...form.phones, ''] });
  const delPhone = (i) => set({ phones: form.phones.filter((_, k) => k !== i) });

  // —— 场次时间标签 ——
  const toggleSlot = (h) =>
    set({ time_slots: form.time_slots.includes(h) ? form.time_slots.filter((x) => x !== h) : [...form.time_slots, h] });

  // —— 其他消费 ——
  const addExtra = () => set({ extra_items: [...form.extra_items, { name: '', amount: '' }] });
  const setExtra = (i, key, v) =>
    set({ extra_items: form.extra_items.map((x, k) => (k === i ? { ...x, [key]: v } : x)) });
  const delExtra = (i) => set({ extra_items: form.extra_items.filter((_, k) => k !== i) });

  // —— 套系选择：自动回填价格 / 定金（仍可手动改价） ——
  function onPickPackage(pid) {
    const p = pkgList.find((x) => String(x.id) === String(pid));
    set({
      package_id: pid,
      package_price: p && p.price != null ? String(p.price) : '',
      package_deposit: p && p.deposit != null ? String(p.deposit) : ''
    });
  }

  // —— 执行人多选 ——
  const toggleExec = (id) =>
    set({ executor_ids: form.executor_ids.includes(id) ? form.executor_ids.filter((x) => x !== id) : [...form.executor_ids, id] });

  function fail(msg) {
    setErr(msg);
    // 校验失败：弹出提示且保持弹窗不关闭
    window.alert(msg);
    return false;
  }

  function validate() {
    if (!form.order_name.trim()) return fail('请输入订单名称');
    if (!form.customer_name.trim()) return fail('请输入顾客姓名');
    if (!form.date_tbd && !form.shoot_date) return fail('请选择档期日期，或勾选「日期待定」');
    if (!form.package_id) return fail('请选择套系名称');
    if (form.package_price === '' || isNaN(parseFloat(form.package_price))) return fail('请填写套系价格');
    if (form.package_deposit === '' || isNaN(parseFloat(form.package_deposit))) return fail('请填写套系定金');
    if (!form.payment_status) return fail('请选择收款状态');
    if (form.payment_status === 'deposit' && (parseFloat(form.package_deposit) || 0) <= 0) {
      return fail('收款状态为「已付定金」时，套系定金必须大于 0');
    }
    for (const it of form.extra_items) {
      if (!String(it.name || '').trim()) return fail('请填写其他消费的项目名称，或删除该行');
    }
    return true;
  }

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (!validate()) return;
    const phones = form.phones.map((p) => p.trim()).filter(Boolean);
    const executors = form.executor_ids
      .map((id) => people.find((p) => p.id === id))
      .filter(Boolean)
      .map((p) => ({ id: p.id, name: p.name, avatar: p.avatar || '' }));
    const payload = {
      order_name: form.order_name.trim(),
      customer_name: form.customer_name.trim(),
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

  return (
    // 蒙层：不绑定 onClick，点击蒙层不关闭弹窗
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-[60] p-4 overflow-auto">
      <form
        onSubmit={submit}
        className="w-full max-w-2xl my-6 bg-panel border border-line rounded-xl shadow-xl overflow-hidden"
      >
        {/* 标题栏：仅 X 关闭 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line sticky top-0 bg-panel z-10">
          <div className="text-base font-semibold text-fg">新增订单</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted hover:bg-panel2 hover:text-fg"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {/* ① 基础信息 */}
        <Section title="基础信息">
          <div className="mb-3">
            <Label required>订单名称</Label>
            <input
              value={form.order_name}
              onChange={(e) => set({ order_name: e.target.value })}
              placeholder="请输入订单名称"
              className={inputCls}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label required>顾客姓名</Label>
              <input
                value={form.customer_name}
                onChange={(e) => set({ customer_name: e.target.value })}
                placeholder="请输入顾客姓名"
                className={inputCls}
              />
            </div>
            <div>
              <Label>联系电话</Label>
              <div className="space-y-2">
                {form.phones.map((p, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      value={p}
                      onChange={(e) => setPhone(i, e.target.value)}
                      placeholder="请输入联系电话"
                      inputMode="tel"
                      className={inputCls}
                    />
                    {i === form.phones.length - 1 ? (
                      <button
                        type="button"
                        onClick={addPhone}
                        title="新增联系电话"
                        className="shrink-0 w-9 h-9 rounded-lg border border-line text-brand hover:bg-brand/10 flex items-center justify-center"
                      >
                        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => delPhone(i)}
                        title="删除该电话"
                        className="shrink-0 w-9 h-9 rounded-lg border border-line text-muted hover:text-danger hover:border-danger/40 flex items-center justify-center"
                      >
                        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <path d="M5 12h14" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Section>

        {/* ② 档期时间 */}
        <Section title="档期时间">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full sm:w-48">
              <Label>拍摄日期</Label>
              <input
                type="date"
                value={form.shoot_date}
                disabled={dateDisabled}
                onChange={(e) => set({ shoot_date: e.target.value })}
                className={inputCls}
              />
            </div>
            <label className={'flex items-center gap-2 text-sm pb-2 select-none ' + (dateDisabled ? 'text-faint cursor-not-allowed' : 'text-muted cursor-pointer')}>
              <input
                type="checkbox"
                disabled={dateDisabled}
                checked={form.pick_slots}
                onChange={(e) => set({ pick_slots: e.target.checked, time_slots: e.target.checked ? form.time_slots : [] })}
                className="accent-brand"
              />
              选择场次
            </label>
            <label className="flex items-center gap-2 text-sm text-muted pb-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.date_tbd}
                onChange={(e) => set({ date_tbd: e.target.checked })}
                className="accent-brand"
              />
              日期待定
            </label>
          </div>

          {form.pick_slots && (
            <div className={'mt-3 ' + (dateDisabled ? 'opacity-50 pointer-events-none' : '')}>
              <div className="text-xs text-faint mb-2">按小时选择场次，可多选（婚礼可选多个时间段）</div>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {HOURS.map((h) => {
                  const on = form.time_slots.includes(h);
                  return (
                    <button
                      key={h}
                      type="button"
                      disabled={dateDisabled}
                      onClick={() => toggleSlot(h)}
                      className={
                        'px-2 py-1.5 rounded-lg text-xs border transition ' +
                        (on ? 'bg-brand text-white border-brand' : 'bg-ink text-muted border-line hover:border-brand/50')
                      }
                    >
                      {h}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {form.date_tbd && (
            <div className="mt-3 text-xs text-faint bg-panel2 rounded-lg px-3 py-2">
              已勾选「日期待定」：该订单视为意向订单，不占用日历档期，后续确定日期后可在订单详情补填。
            </div>
          )}
        </Section>

        {/* ③ 套系信息 */}
        <Section title="套系信息">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-3">
              <Label required>套系名称</Label>
              <select value={form.package_id} onChange={(e) => onPickPackage(e.target.value)} className={inputCls}>
                <option value="">请选择套系</option>
                {pkgList.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} · ¥{p.price}</option>
                ))}
              </select>
              {pkgList.length === 0 && (
                <div className="text-xs text-faint mt-1">暂无套系，请先到「套系管理」新增。</div>
              )}
            </div>
            <div>
              <Label required>套系价格</Label>
              <input
                type="number"
                min="0"
                value={form.package_price}
                onChange={(e) => set({ package_price: e.target.value })}
                placeholder="0"
                className={inputCls}
              />
            </div>
            <div>
              <Label required>套系定金</Label>
              <input
                type="number"
                min="0"
                value={form.package_deposit}
                onChange={(e) => set({ package_deposit: e.target.value })}
                placeholder="0"
                className={inputCls}
              />
            </div>
            <div className="flex items-end">
              <div className="text-xs text-faint pb-2">选择套系后自动带出价格与定金，可手动改价</div>
            </div>
          </div>
        </Section>

        {/* ④ 收款与额外消费 */}
        <Section title="收款与额外消费">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label required>收款状态</Label>
              <select
                value={form.payment_status}
                onChange={(e) => set({ payment_status: e.target.value })}
                className={inputCls}
              >
                {PAY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="flex items-end">
              <div className="text-xs text-faint pb-2">
                应收合计 <span className="text-fg font-medium">¥{totalAmount.toFixed(2)}</span>
                （套系 ¥{(parseFloat(form.package_price) || 0).toFixed(2)} + 其他 ¥{extraTotal.toFixed(2)}）
              </div>
            </div>
          </div>

          <div className="mt-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-muted">其他消费</div>
              <button
                type="button"
                onClick={addExtra}
                className="text-xs text-brand hover:underline flex items-center gap-1"
              >
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                添加一条
              </button>
            </div>
            {form.extra_items.length === 0 ? (
              <div className="text-xs text-faint bg-panel2 rounded-lg px-3 py-2">暂无其他消费，可点击「添加一条」录入加片、相册等费用。</div>
            ) : (
              <div className="space-y-2">
                {form.extra_items.map((it, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      value={it.name}
                      onChange={(e) => setExtra(i, 'name', e.target.value)}
                      placeholder="消费名称（如：加精修 10 张）"
                      className={inputCls}
                    />
                    <input
                      type="number"
                      min="0"
                      value={it.amount}
                      onChange={(e) => setExtra(i, 'amount', e.target.value)}
                      placeholder="金额"
                      className={inputCls + ' sm:w-32'}
                    />
                    <button
                      type="button"
                      onClick={() => delExtra(i)}
                      title="删除该条消费"
                      className="shrink-0 w-9 h-9 rounded-lg border border-line text-muted hover:text-danger hover:border-danger/40 flex items-center justify-center"
                    >
                      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M5 12h14" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Section>

        {/* ⑤ 拍摄地点 & 备注 */}
        <Section title="拍摄地点与备注">
          <div className="mb-3">
            <Label>拍摄地点</Label>
            <input
              value={form.address}
              onChange={(e) => set({ address: e.target.value })}
              placeholder="输入拍摄地点"
              className={inputCls}
            />
          </div>
          <div>
            <Label>备注</Label>
            <textarea
              rows={3}
              value={form.remark}
              onChange={(e) => set({ remark: e.target.value })}
              placeholder="补充说明（服装、化妆、集合时间等）"
              className={inputCls + ' resize-y'}
            />
          </div>
        </Section>

        {/* ⑥ 渠道来源 */}
        <Section title="渠道来源">
          <div className="relative" ref={chRef}>
            <button
              type="button"
              onClick={() => setChOpen((o) => !o)}
              className={inputCls + ' flex items-center justify-between text-left'}
            >
              <span className={form.channel ? 'text-fg' : 'text-faint'}>{form.channel || '请选择渠道来源'}</span>
              <svg viewBox="0 0 24 24" className="w-4 h-4 text-faint" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {chOpen && (
              <div className="absolute left-0 right-0 mt-1 bg-panel border border-line rounded-lg shadow-lg z-20 overflow-hidden">
                <div className="max-h-52 overflow-auto">
                  {channels.length === 0 ? (
                    <div className="px-3 py-3 text-xs text-faint">暂无渠道，请先到「渠道管理」新增。</div>
                  ) : (
                    channels.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => { set({ channel_id: c.id, channel: c.name }); setChOpen(false); }}
                        className={
                          'w-full text-left px-3 py-2 text-sm hover:bg-panel2 ' +
                          (String(form.channel_id) === String(c.id) ? 'text-brand bg-brand/5' : 'text-fg')
                        }
                      >
                        {c.name}
                      </button>
                    ))
                  )}
                </div>
                {/* 下拉底部固定入口：跳转渠道管理页 */}
                <button
                  type="button"
                  onClick={() => { setChOpen(false); onClose(); navigate('/channels'); }}
                  className="w-full px-3 py-2.5 text-sm text-brand border-t border-line bg-panel2 hover:bg-brand/10 flex items-center justify-center gap-1.5"
                >
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  渠道管理
                </button>
              </div>
            )}
          </div>
        </Section>

        {/* ⑦ 执行人 */}
        <Section title="执行人">
          {people.length === 0 ? (
            <div className="text-xs text-faint bg-panel2 rounded-lg px-3 py-2">暂无可选人员，请先在系统中添加账号。</div>
          ) : (
            <div className="flex flex-wrap gap-3">
              {people.map((p) => {
                const on = form.executor_ids.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleExec(p.id)}
                    className="flex flex-col items-center gap-1 w-16"
                    title={p.name}
                  >
                    <span
                      className={
                        'relative w-11 h-11 rounded-full overflow-hidden flex items-center justify-center text-sm font-medium transition ' +
                        (on ? 'ring-2 ring-brand ring-offset-2 ring-offset-panel bg-brand text-white' : 'bg-panel2 text-muted border border-line')
                      }
                    >
                      {p.avatar
                        ? <img src={img(p.avatar)} alt={p.name} className="w-full h-full object-cover" />
                        : (p.name || '?').slice(0, 1)}
                      {on && (
                        <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-brand text-white flex items-center justify-center border-2 border-panel">
                          <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4 12l6 6L20 6" />
                          </svg>
                        </span>
                      )}
                    </span>
                    <span className={'text-[11px] truncate w-full text-center ' + (on ? 'text-brand' : 'text-muted')}>{p.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </Section>

        {/* ⑧ 底部保存 */}
        <div className="px-5 py-4 border-t border-line sticky bottom-0 bg-panel">
          {err && <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 text-red-600 text-sm">{err}</div>}
          <button
            type="submit"
            disabled={saving}
            className="w-full py-2.5 rounded-lg bg-brand hover:bg-brand2 text-white text-sm font-medium disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </div>
  );
}
