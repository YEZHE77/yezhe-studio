import React, { useState, useEffect } from 'react';
import http from '../api.js';
import Icon from '../components/Icon.jsx';

// 渠道来源管理：新增订单弹窗「渠道来源」下拉的唯一数据源
// 后端可配置（增/改名/排序/启停/软删），前端下拉实时读取，绝不写死。
export default function Channels() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', sort: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  async function load() {
    try {
      setLoading(true);
      const r = await http.get('/api/channels/manage');
      setList(Array.isArray(r.data) ? r.data : []);
    } catch (e) {
      setError((e.response && e.response.data && e.response.data.error) || '加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function saveNew(e) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) { setError('请输入渠道名称'); return; }
    setSaving(true); setError(''); setMsg('');
    try {
      const body = { name };
      if (String(form.sort).trim() !== '') body.sort = Number(form.sort) || 0;
      await http.post('/api/channels', body);
      setForm({ name: '', sort: '' });
      setMsg('已新增渠道：' + name);
      await load();
    } catch (e) {
      setError((e.response && e.response.data && e.response.data.error) || '新增失败');
    } finally {
      setSaving(false);
    }
  }

  async function patch(id, body) {
    try {
      await http.put('/api/channels/' + id, body);
      await load();
    } catch (e) {
      alert((e.response && e.response.data && e.response.data.error) || '保存失败');
      await load();
    }
  }

  function onNameBlur(ch, val) {
    const v = (val || '').trim();
    if (!v) { load(); return; }
    if (v !== ch.name) patch(ch.id, { name: v });
  }
  function onSortBlur(ch, val) {
    const n = Number(val);
    if (Number.isNaN(n)) { load(); return; }
    if (n !== Number(ch.sort)) patch(ch.id, { sort: n });
  }
  function onToggle(ch, checked) {
    patch(ch.id, { is_active: checked ? 1 : 0 });
  }
  async function onDelete(ch) {
    if (!confirm('确认删除渠道「' + ch.name + '」？\n历史订单已保存渠道名称快照，不受影响；如只是暂时不用，建议改为「禁用」。')) return;
    setError(''); setMsg('');
    try {
      await http.delete('/api/channels/' + ch.id);
      setMsg('已删除渠道：' + ch.name);
      await load();
    } catch (e) {
      alert((e.response && e.response.data && e.response.data.error) || '删除失败');
    }
  }

  const activeCount = list.filter((c) => Number(c.is_active) === 1).length;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-fg flex items-center gap-2">
            <Icon name="tag" className="w-5 h-5 text-brand" /> 渠道管理
          </h1>
          <p className="text-sm text-muted mt-1">
            新增订单时「渠道来源」下拉的数据源；排序权重越小越靠前；禁用后下拉不再展示，历史订单不受影响。
          </p>
        </div>
      </div>

      {error && <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>}
      {msg && <div className="mb-3 px-3 py-2 rounded-lg bg-green-50 text-green-600 text-sm">{msg}</div>}

      {/* 新增渠道 */}
      <form onSubmit={saveNew} className="bg-panel rounded-xl border border-line p-4 mb-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs text-faint mb-1">渠道名称</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="如：视频号 / 老客户复购"
            className="w-full px-3 py-2 rounded-lg border border-line bg-ink text-sm text-fg outline-none focus:border-brand"
          />
        </div>
        <div className="w-28">
          <label className="block text-xs text-faint mb-1">排序权重</label>
          <input
            type="number"
            value={form.sort}
            onChange={(e) => setForm({ ...form, sort: e.target.value })}
            placeholder="自动"
            className="w-full px-3 py-2 rounded-lg border border-line bg-ink text-sm text-fg outline-none focus:border-brand"
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-medium disabled:opacity-50"
        >
          {saving ? '保存中…' : '新增渠道'}
        </button>
      </form>

      {/* 渠道列表 */}
      <div className="bg-panel rounded-xl border border-line overflow-hidden">
        <div className="flex items-center px-4 py-3 text-xs text-faint border-b border-line">
          <div className="flex-1">渠道名称</div>
          <div className="w-24">排序</div>
          <div className="w-20 text-center">启用</div>
          <div className="w-16 text-right">操作</div>
        </div>
        {loading ? (
          <div className="p-6 text-sm text-muted text-center">加载中…</div>
        ) : list.length === 0 ? (
          <div className="p-6 text-sm text-muted text-center">暂无渠道，请在上方新增</div>
        ) : (
          list.filter(Boolean).map((c) => (
            <div key={c.id} className="flex items-center px-4 py-3 border-b border-line last:border-0">
              <div className="flex-1">
                <input
                  defaultValue={c.name}
                  onBlur={(e) => onNameBlur(c, e.target.value)}
                  className="w-full max-w-[240px] px-2 py-1.5 rounded-lg border border-transparent bg-ink text-sm text-fg outline-none hover:border-line focus:border-brand"
                />
              </div>
              <div className="w-24">
                <input
                  type="number"
                  defaultValue={c.sort}
                  onBlur={(e) => onSortBlur(c, e.target.value)}
                  className="w-16 px-2 py-1.5 rounded-lg border border-transparent bg-ink text-sm text-fg outline-none hover:border-line focus:border-brand"
                />
              </div>
              <div className="w-20 flex justify-center">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Number(c.is_active) === 1}
                    onChange={(e) => onToggle(c, e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-line rounded-full peer-checked:bg-brand transition" />
                  <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full transition peer-checked:translate-x-4" />
                </label>
              </div>
              <div className="w-16 text-right">
                <button onClick={() => onDelete(c)} className="text-sm text-red-500 hover:underline">删除</button>
              </div>
            </div>
          ))
        )}
      </div>

      <p className="mt-3 text-xs text-faint leading-relaxed">
        当前共 {list.length} 个渠道，其中启用 {activeCount} 个。修改后回到「订单中心 → 新增订单」，渠道下拉会实时读取最新配置，无需重新部署。
      </p>
    </div>
  );
}
