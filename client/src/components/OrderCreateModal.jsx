import React, { useState, useEffect } from 'react';
import http from '../api.js';

function emptyForm() {
  return {
    groom_name: '', bride_name: '', customer_phone: '', address: '',
    package_id: '', deposit: '', balance: '',
    deposit_method: 'offline', balance_method: 'offline',
    shoot_date: '', executor: '', remark: ''
  };
}

// 新建订单 Modal：成功后由父页面通过 onAfterCreate 刷新列表（仅更新 state，不整页刷新）
export default function OrderCreateModal({ visible, packages, initialPackageId, onClose, onAfterCreate }) {
  const [form, setForm] = useState(emptyForm());
  const [err, setErr] = useState('');

  // 每次打开时重置表单（支持从 ?pkg= 预选套系），关闭逻辑不变
  useEffect(() => {
    if (visible) {
      setForm({ ...emptyForm(), package_id: initialPackageId || '' });
      setErr('');
    }
  }, [visible, initialPackageId]);

  if (!visible) return null;

  async function submit(e) {
    e.preventDefault();
    setErr('');
    const pkg = packages.find((p) => String(p.id) === String(form.package_id));
    const payload = {
      groom_name: form.groom_name, bride_name: form.bride_name, customer_phone: form.customer_phone, address: form.address,
      package_id: form.package_id || null,
      deposit: parseFloat(form.deposit) || 0, balance: parseFloat(form.balance) || 0,
      deposit_method: form.deposit_method, balance_method: form.balance_method,
      shoot_date: form.shoot_date, executor: form.executor, remark: form.remark
    };
    if (!pkg) { setErr('请选择套系（或填写定金/尾款金额）'); return; }
    if (payload.deposit <= 0) { setErr('请填写定金金额（必须大于 0，未收定金不能建立订单）'); return; }
    try {
      await http.post('/api/orders', payload); // 后端保存完毕
      onClose();        // 弹窗关闭逻辑不变
      onAfterCreate();  // 通知父页面刷新列表
    } catch (e) {
      setErr((e.response && e.response.data && e.response.data.error) || '创建失败');
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="w-full max-w-lg bg-panel border border-line rounded-xl2 p-6 max-h-[90vh] overflow-auto">
        <div className="text-white font-medium mb-4">新建订单</div>
        <div className="grid grid-cols-2 gap-3">
          <input value={form.groom_name} onChange={(e) => setForm({ ...form, groom_name: e.target.value })} placeholder="新郎姓名"
            className="px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
          <input value={form.bride_name} onChange={(e) => setForm({ ...form, bride_name: e.target.value })} placeholder="新娘姓名"
            className="px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <input value={form.customer_phone} onChange={(e) => setForm({ ...form, customer_phone: e.target.value })} placeholder="联系电话"
            className="px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
          <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="拍摄地址"
            className="px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
        </div>
          <select value={form.package_id} onChange={(e) => {
            const pid = e.target.value;
            const pkg = packages.find((p) => String(p.id) === String(pid));
            setForm((f) => ({ ...f, package_id: pid, deposit: pkg ? (parseFloat(pkg.deposit) || f.deposit) : f.deposit }));
          }} required
          className="w-full mt-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none">
          <option value="">选择套系</option>
          {packages.map((p) => <option key={p.id} value={p.id}>{p.name} · ¥{p.price}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <input value={form.deposit} onChange={(e) => setForm({ ...form, deposit: e.target.value })} type="number" placeholder="定金"
            className="px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
          <input value={form.balance} onChange={(e) => setForm({ ...form, balance: e.target.value })} type="number" placeholder="尾款"
            className="px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <select value={form.deposit_method} onChange={(e) => setForm({ ...form, deposit_method: e.target.value })} className="px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none">
            <option value="offline">定金·线下</option><option value="online">定金·线上</option>
          </select>
          <select value={form.balance_method} onChange={(e) => setForm({ ...form, balance_method: e.target.value })} className="px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none">
            <option value="offline">尾款·线下</option><option value="online">尾款·线上</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <input value={form.shoot_date} onChange={(e) => setForm({ ...form, shoot_date: e.target.value })} type="date" placeholder="拍摄日期"
            className="px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
          <input value={form.executor} onChange={(e) => setForm({ ...form, executor: e.target.value })} placeholder="执行人"
            className="px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
        </div>
        <input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} placeholder="备注"
          className="w-full mt-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
        {err && <div className="text-xs text-red-400 mt-2">{err}</div>}
        <div className="flex gap-2 justify-end mt-4">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded text-sm text-muted">取消</button>
          <button type="submit" className="px-4 py-2 rounded bg-brand text-white text-sm">创建</button>
        </div>
      </form>
    </div>
  );
}
