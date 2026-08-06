import React, { useState, useEffect } from 'react';
import http from '../api.js';
import Icon from '../components/Icon.jsx';

export default function Categories() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', sort: 0, is_active: true });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  async function load() {
    try {
      setLoading(true);
      const r = await http.get('/api/categories/manage');
      setList(r.data || []);
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
    if (!name) { setError('请输入分类名称'); return; }
    setSaving(true); setError(''); setMsg('');
    try {
      await http.post('/api/categories', { name, sort: Number(form.sort) || 0, is_active: form.is_active ? 1 : 0 });
      setForm({ name: '', sort: 0, is_active: true });
      setMsg('已新增分类：' + name);
      await load();
    } catch (e) {
      setError((e.response && e.response.data && e.response.data.error) || '新增失败');
    } finally {
      setSaving(false);
    }
  }

  async function patch(id, body) {
    try {
      await http.put('/api/categories/' + id, body);
      await load();
    } catch (e) {
      alert((e.response && e.response.data && e.response.data.error) || '保存失败');
    }
  }

  function onNameBlur(cat, val) {
    const v = val.trim();
    if (!v) { load(); return; }
    if (v !== cat.name) patch(cat.id, { name: v });
  }
  function onSortBlur(cat, val) {
    const n = Number(val);
    if (Number.isNaN(n)) { load(); return; }
    if (n !== cat.sort) patch(cat.id, { sort: n });
  }
  function onToggle(cat, checked) {
    patch(cat.id, { is_active: checked ? 1 : 0 });
  }
  async function onDelete(cat) {
    if (cat.preset) { alert('预设分类不可删除，可禁用代替删除'); return; }
    if (!confirm('确认删除分类「' + cat.name + '」？\n已绑定该分类的作品不会被删除，可重新分配分类。')) return;
    try {
      await http.delete('/api/categories/' + cat.id);
      setMsg('已删除分类：' + cat.name);
      await load();
    } catch (e) {
      alert((e.response && e.response.data && e.response.data.error) || '删除失败');
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-fg flex items-center gap-2">
            <Icon name="tag" className="w-5 h-5 text-brand" /> 分类管理
          </h1>
          <p className="text-sm text-muted mt-1">作品分类前后端实时同步；排序权重越小越靠前；禁用后两端均不再展示。</p>
        </div>
      </div>

      {error && <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>}
      {msg && <div className="mb-3 px-3 py-2 rounded-lg bg-green-50 text-green-600 text-sm">{msg}</div>}

      {/* 新增分类 */}
      <form onSubmit={saveNew} className="bg-panel rounded-xl border border-line p-4 mb-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs text-faint mb-1">分类名称</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="如：亲子 / 旅拍"
            className="w-full px-3 py-2 rounded-lg border border-line bg-ink text-sm text-fg outline-none focus:border-brand"
          />
        </div>
        <div className="w-28">
          <label className="block text-xs text-faint mb-1">排序权重</label>
          <input
            type="number"
            value={form.sort}
            onChange={(e) => setForm({ ...form, sort: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-line bg-ink text-sm text-fg outline-none focus:border-brand"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted pb-2 cursor-pointer select-none">
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="accent-brand" />
          启用
        </label>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-medium disabled:opacity-50"
        >
          {saving ? '保存中…' : '新增分类'}
        </button>
      </form>

      {/* 分类列表 */}
      <div className="bg-panel rounded-xl border border-line overflow-hidden">
        <div className="flex items-center px-4 py-3 text-xs text-faint border-b border-line">
          <div className="flex-1">分类名称</div>
          <div className="w-24">排序</div>
          <div className="w-20 text-center">状态</div>
          <div className="w-16 text-right">操作</div>
        </div>
        {loading ? (
          <div className="p-6 text-sm text-muted text-center">加载中…</div>
        ) : list.length === 0 ? (
          <div className="p-6 text-sm text-muted text-center">暂无分类</div>
        ) : (
          list.map((c) => (
            <div key={c.id} className="flex items-center px-4 py-3 border-b border-line last:border-0">
              <div className="flex-1 flex items-center gap-2">
                <input
                  defaultValue={c.name}
                  onBlur={(e) => onNameBlur(c, e.target.value)}
                  className="w-full max-w-[240px] px-2 py-1.5 rounded-lg border border-transparent bg-ink text-sm text-fg outline-none hover:border-line focus:border-brand"
                />
                {c.preset === 1 && (
                  <span className="shrink-0 px-1.5 py-0.5 rounded text-[11px] bg-brand/10 text-brand">预设</span>
                )}
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
                    checked={c.is_active === 1}
                    onChange={(e) => onToggle(c, e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-line rounded-full peer-checked:bg-brand transition" />
                  <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full transition peer-checked:translate-x-4" />
                </label>
              </div>
              <div className="w-16 text-right">
                <button
                  onClick={() => onDelete(c)}
                  disabled={c.preset === 1}
                  className={'text-sm ' + (c.preset === 1 ? 'text-faint cursor-not-allowed' : 'text-red-500 hover:underline')}
                >
                  {c.preset === 1 ? '禁止' : '删除'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <p className="mt-3 text-xs text-faint leading-relaxed">
        说明：预设分类（婚礼 / 领证 / 写真 / 家庭纪实）允许改名与禁用，不可直接删除；自定义分类可随意增删改。删除分类不会删除已绑定作品，相关作品可在「作品」模块重新分配分类。
      </p>
    </div>
  );
}
