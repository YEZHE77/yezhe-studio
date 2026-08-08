import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import http, { img, uploadImage } from '../api.js';
import { useViewState } from '../tabMemory.js';

/* ==========================================================================
   套系页面（后台管理 → 套系）
   —— 视觉规范（严格按设计稿取色，禁止改动）：
        页面底色 #ffffff ／ 深色操作栏 #2c2c2c ／ 橙色提示条 #fff3e0
        主按钮蓝色 #2f7cf6 ／ 黑色按钮 #2c2c2c ／ 定金标签浅棕 #f3ece3/#9a8a76
        负底栏深色区域白字一律用内联 style={{color:'#fff'}}（全局 .text-white 被覆写）
   —— 全部数据（套系列表 / 分类选项 / 搜索 / 状态）均由后端接口返回，禁止硬编码。
   —— 保留原有全部后端交互逻辑（新建/编辑/删除/下架/分享/溯源/复制/排序/导出），仅重构 UI。
   ========================================================================== */

// 内联 SVG 图标（无第三方依赖）
const IconSearch = (p) => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" {...p}>
    <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
  </svg>
);
const IconGear = (p) => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </svg>
);
const IconClose = (p) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

function fmtPrice(v) {
  const n = Number(v || 0);
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDeposit(v) {
  const n = Number(v || 0);
  return n.toLocaleString('en-US');
}

export default function Packages() {
  const nav = useNavigate();
  // Tab 记忆：状态筛选 + 搜索 + 分类
  const [state, setState] = useViewState('packages', { status: 'all', q: '', category: '' });
  const [list, setList] = useState([]);
  const [categories, setCategories] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [trace, setTrace] = useState(null); // 订单溯源
  const [sharePkg, setSharePkg] = useState(null); // 私有分享弹窗
  const [form, setForm] = useState(emptyForm());
  const [tab, setTab] = useState(0); // 编辑弹窗 4 个 Tab

  // 顶部搜索框本地输入（点击【搜索】才提交过滤）
  const [qInput, setQInput] = useState(state.q || '');
  const [advOpen, setAdvOpen] = useState(false); // 高级设置面板
  const [barCollapsed, setBarCollapsed] = useState(false); // 深色操作栏收起

  function emptyForm() {
    return { id: null, name: '', price: '', description: '', cover: null, cover_url: '', category_id: '',
      deposit: '', retouch_count: '', raw_policy: '', duration: '', questionnaire: '',
      addons: [], marketing_coupon: '', marketing_activity: '', status: 'on', specs: [] };
  }

  const loadCategories = () => http.get('/api/categories').then((r) => setCategories(r.data || [])).catch(() => {});
  const load = () => {
    const p = new URLSearchParams();
    if (state.status && state.status !== 'all') p.set('status', state.status);
    if (state.q) p.set('q', state.q);
    if (state.category) p.set('category', state.category);
    http.get('/api/packages?' + p.toString()).then((r) => setList(r.data)).catch(() => {});
  };
  useEffect(() => { loadCategories(); }, []);
  useEffect(load, [state]);

  const doSearch = () => setState((s) => ({ ...s, q: qInput }));

  const openNew = () => { setEditing(null); setForm(emptyForm()); setTab(0); setShowForm(true); };
  const openEdit = (pkg) => {
    setEditing(pkg);
    setForm({
      id: pkg.id, name: pkg.name, price: pkg.price, description: pkg.description || '',
      cover: null, cover_url: pkg.cover_url || '', category_id: pkg.category_id || '',
      deposit: pkg.deposit || '', retouch_count: pkg.retouch_count || '', raw_policy: pkg.raw_policy || '',
      duration: pkg.duration || '',
      questionnaire: typeof pkg.questionnaire === 'string' ? pkg.questionnaire : (pkg.questionnaire ? JSON.stringify(pkg.questionnaire, null, 2) : ''),
      addons: Array.isArray(pkg.addons) ? pkg.addons : [],
      marketing_coupon: (pkg.marketing && pkg.marketing.coupon) || '',
      marketing_activity: (pkg.marketing && pkg.marketing.activity) || '',
      status: pkg.status || 'on',
      specs: Array.isArray(pkg.specs) ? pkg.specs : []
    });
    setTab(0);
    setShowForm(true);
  };

  const addAddon = () => setForm({ ...form, addons: [...form.addons, { name: '', price: '' }] });
  const updAddon = (i, k, v) => setForm({ ...form, addons: form.addons.map((a, j) => j === i ? { ...a, [k]: v } : a) });
  const delAddon = (i) => setForm({ ...form, addons: form.addons.filter((_, j) => j !== i) });

  const addSpec = () => setForm({ ...form, specs: [...form.specs, { id: 's' + Date.now(), name: '', price: '', deposit: '', duration: '', raw_policy: '', remark: '' }] });
  const updSpec = (i, k, v) => setForm({ ...form, specs: form.specs.map((s, j) => j === i ? { ...s, [k]: v } : s) });
  const delSpec = (i) => setForm({ ...form, specs: form.specs.filter((_, j) => j !== i) });

  async function submit(e) {
    e.preventDefault();
    let cover_url = form.cover_url || '';
    if (form.cover) {
      const r = await uploadImage(form.cover, { category: 'cover', isPublic: true });
      cover_url = r.url;
    }
    const payload = {
      name: form.name, price: parseFloat(form.price) || 0, description: form.description,
      cover_url, category_id: form.category_id || null,
      deposit: parseFloat(form.deposit) || 0, retouch_count: parseInt(form.retouch_count) || 0,
      raw_policy: form.raw_policy || '', duration: form.duration || '',
      questionnaire: form.questionnaire || '',
      addons: form.addons.filter((a) => a.name).map((a) => ({ name: a.name, price: parseFloat(a.price) || 0 })),
      marketing: { coupon: form.marketing_coupon, activity: form.marketing_activity },
      status: form.status,
      specs: form.specs
    };
    if (editing) await http.put('/api/packages/' + editing.id, payload);
    else await http.post('/api/packages', payload);
    setShowForm(false);
    load();
  }

  const del = async (id) => {
    if (!confirm('确认后将永久删除，建议先做好本地备份，确定继续？')) return;
    await http.delete('/api/packages/' + id);
    load();
  };

  // 上架 / 下架快捷开关（不改其它字段）
  const toggleStatus = async (pkg) => {
    const next = pkg.status === 'on' ? 'off' : 'on';
    await http.put('/api/packages/' + pkg.id, { status: next });
    load();
  };

  // 复制套系快速新建（默认下架，避免误发）
  const duplicate = async (id) => {
    if (!confirm('复制该套系为副本（默认下架）？')) return;
    await http.post('/api/packages/' + id + '/duplicate');
    load();
  };

  // 排序上下移动
  const move = async (id, dir) => {
    await http.post('/api/packages/' + id + '/move', { dir });
    load();
  };

  // 导出备份
  const exportCsv = () => { window.open('/api/packages/export', '_blank'); };

  const openTrace = async (id) => {
    const r = await http.get('/api/packages/' + id + '/orders');
    setTrace({ id, rows: r.data });
  };

  const catName = (id) => { const c = categories.find((x) => x.id === id); return c ? c.name : (id ? '分类#' + id : '—'); };

  return (
    <div className="-m-6 p-6 min-h-full" style={{ background: '#ffffff' }}>
      {/* 顶部：标题（左） + 搜索区（右） */}
      <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
        <h1 className="text-2xl font-semibold" style={{ color: '#1f2329' }}>套系</h1>
        <div className="flex items-center gap-2">
          <input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doSearch()}
            placeholder="搜索名称"
            className="w-44 md:w-56 px-3 py-2 rounded border border-line bg-white text-fg text-sm outline-none focus:border-brand"
          />
          <button onClick={doSearch}
            className="flex items-center gap-1.5 px-4 py-2 rounded text-sm whitespace-nowrap"
            style={{ background: '#2c2c2c', color: '#fff' }}>
            <IconSearch />搜索
          </button>
          <button onClick={() => setAdvOpen((v) => !v)}
            className="flex items-center gap-1.5 px-4 py-2 rounded text-sm whitespace-nowrap"
            style={{ background: '#2c2c2c', color: '#fff' }}>
            <IconGear />高级设置
          </button>
        </div>
      </div>

      {/* 深色顶部操作栏 */}
      {!barCollapsed ? (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg flex-wrap" style={{ background: '#2c2c2c' }}>
          <button onClick={openNew}
            className="px-4 py-2 rounded text-sm whitespace-nowrap"
            style={{ background: '#2f7cf6', color: '#fff' }}>+ 新建套系</button>
          <span className="text-xs" style={{ color: '#cfcfcf' }}>套系能让您的报价更规范更清晰，客户在小程序也能一目了然。</span>
          <div className="flex-1" />
          <select value={state.category} onChange={(e) => setState((s) => ({ ...s, category: e.target.value }))}
            className="px-3 py-2 rounded text-sm outline-none border-0"
            style={{ background: '#3a3a3a', color: '#fff' }}>
            <option value="">分类：全部</option>
            {categories.filter(Boolean).map((c) => <option key={c.id} value={c.id}>{c.name || '未命名'}</option>)}
          </select>
          <button onClick={() => setBarCollapsed(true)} title="收起"
            className="p-2 rounded hover:bg-white/10" style={{ color: '#cfcfcf' }}><IconClose /></button>
        </div>
      ) : (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg" style={{ background: '#2c2c2c' }}>
          <button onClick={openNew}
            className="px-4 py-2 rounded text-sm whitespace-nowrap"
            style={{ background: '#2f7cf6', color: '#fff' }}>+ 新建套系</button>
          <button onClick={() => setBarCollapsed(false)} title="展开"
            className="px-3 py-2 rounded text-xs border border-white/20 hover:bg-white/10"
            style={{ color: '#cfcfcf' }}>展开操作栏</button>
        </div>
      )}

      {/* 高级设置面板 */}
      {advOpen && (
        <div className="mt-3 px-4 py-3 rounded-lg border border-line bg-panel2" style={{ color: '#1f2329' }}>
          <div className="text-xs text-muted mb-2">高级设置：导出备份、复制套系、排序管理在卡片操作中也可使用。</div>
          <div className="flex flex-wrap gap-2">
            <button onClick={exportCsv}
              className="px-3 py-1.5 rounded text-xs border border-line bg-white text-fg hover:border-brand">导出备份（CSV）</button>
            <span className="text-xs text-muted self-center">提示：每套系卡片右侧【分享】可生成带密码/有效期的私有分享链接。</span>
          </div>
        </div>
      )}

      {/* 橙色空态提示条（无套系时显示） */}
      {list.length === 0 && (
        <div className="flex items-center gap-3 mt-4 px-4 py-3 rounded-lg text-sm flex-wrap"
          style={{ background: '#fff3e0' }}>
          <span className="inline-flex w-5 h-5 rounded-full items-center justify-center shrink-0"
            style={{ background: '#ff8822', color: '#fff', fontSize: 13, fontWeight: 700 }}>!</span>
          <span style={{ color: '#7a6a55' }}>您当前没有上传任何套系</span>
          <div className="flex-1" />
          <button onClick={openNew} className="text-sm font-medium" style={{ color: '#ff8822' }}>新建套系&gt;</button>
        </div>
      )}

      {/* 套系列表（纵向卡片） */}
      <div className="mt-4 space-y-4">
        {list.map((p) => {
          const off = p.status === 'off';
          return (
            <div key={p.id}
              className="flex flex-col sm:flex-row sm:items-center gap-4 bg-white border border-line rounded-xl2 p-4 shadow-sm">
              {/* 左侧封面 */}
              <div className="w-24 h-24 rounded-lg bg-panel2 border border-line overflow-hidden shrink-0 flex items-center justify-center">
                {p.cover_url
                  ? <img src={img(p.cover_url)} alt="" className="w-full h-full object-cover" />
                  : <span className="text-faint text-xs">无图</span>}
              </div>

              {/* 中部信息 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="text-fg font-medium text-base truncate">{p.name}</div>
                  {off && (
                    <span className="px-1.5 py-0.5 rounded text-[11px]" style={{ background: '#f5f5f5', color: '#888' }}>已下架</span>
                  )}
                  {Array.isArray(p.specs) && p.specs.length > 0 && (
                    <span className="px-1.5 py-0.5 rounded text-[11px] bg-brand/10" style={{ color: '#2f7cf6' }}>{p.specs.length} 规格</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className="font-bold text-lg" style={{ color: '#1f2329' }}>¥{fmtPrice(p.price)}</span>
                  <span className="px-2 py-0.5 rounded text-xs" style={{ background: '#f3ece3', color: '#9a8a76' }}>定金：¥{fmtDeposit(p.deposit)}</span>
                </div>
                <div className="text-xs text-muted mt-1 truncate">{catName(p.category_id)}{p.description ? ' · ' + p.description : ''}</div>
              </div>

              {/* 右侧操作按钮组：分享 / 编辑 / 下架 / 删除 */}
              <div className="flex flex-row sm:flex-col items-stretch sm:items-end gap-2 sm:gap-1.5 text-sm">
                <button onClick={() => setSharePkg(p)} className="px-3 py-1.5 rounded text-left sm:text-right hover:text-brand" style={{ color: '#1f2329' }}>分享</button>
                <button onClick={() => openEdit(p)} className="px-3 py-1.5 rounded text-left sm:text-right hover:text-brand" style={{ color: '#1f2329' }}>编辑</button>
                <button onClick={() => toggleStatus(p)} className="px-3 py-1.5 rounded text-left sm:text-right hover:text-brand" style={{ color: '#1f2329' }}>{off ? '上架' : '下架'}</button>
                <button onClick={() => del(p.id)} className="px-3 py-1.5 rounded text-left sm:text-right hover:text-red-400" style={{ color: '#1f2329' }}>删除</button>
              </div>
            </div>
          );
        })}
        {list.length === 0 && (
          <div className="text-center text-muted py-16">暂无套系，点击右上角「+ 新建套系」开始添加。</div>
        )}
      </div>

      {/* 新建/编辑弹窗 */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowForm(false)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={submit}
            className="w-full max-w-lg bg-panel border border-line rounded-xl2 p-6 max-h-[90vh] overflow-auto">
            <div className="text-white font-medium mb-4">{editing ? '编辑套系' : '新建套系'}</div>
            {/* 4 个 Tab */}
            <div className="flex gap-2 mb-4 flex-wrap">
              {['基础信息', '服务明细', '多规格配置', '绑定问卷'].map((t, i) => (
                <button key={t} type="button" onClick={() => setTab(i)}
                  className={'px-3 py-1.5 rounded text-xs border ' + (tab === i ? 'bg-brand text-white border-brand' : 'bg-panel2 border-line text-muted')}>{t}</button>
              ))}
            </div>

            {tab === 0 && (
              <>
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="套系名称"
                  className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
                <label className="text-xs text-muted">套系分类</label>
                <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                  className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none">
                  <option value="">未分类</option>
                  {categories.filter(Boolean).map((c) => <option key={c.id} value={c.id}>{c.name || '未命名'}</option>)}
                </select>
                <div className="text-xs text-muted mb-1">封面图（可选）</div>
                <input type="file" accept="image/*" onChange={(e) => setForm({ ...form, cover: e.target.files[0] })} className="w-full mb-3 text-xs text-muted" />
                {form.cover_url && <img src={img(form.cover_url)} className="w-20 h-20 object-cover rounded mb-3" />}
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="包含内容描述"
                  className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none h-16" />
                <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} type="number" placeholder="套系价格（起）"
                  className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
                <input value={form.deposit} onChange={(e) => setForm({ ...form, deposit: e.target.value })} type="number" placeholder="定金"
                  className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
                <div className="flex items-center gap-4 mb-4">
                  <span className="text-xs text-muted">对外状态</span>
                  <label className="flex items-center gap-1 text-sm text-white"><input type="radio" checked={form.status === 'on'} onChange={() => setForm({ ...form, status: 'on' })} /> 上架（小程序展示）</label>
                  <label className="flex items-center gap-1 text-sm text-white"><input type="radio" checked={form.status === 'off'} onChange={() => setForm({ ...form, status: 'off' })} /> 下架（隐藏）</label>
                </div>
              </>
            )}

            {tab === 1 && (
              <>
                <input value={form.retouch_count} onChange={(e) => setForm({ ...form, retouch_count: e.target.value })} type="number" placeholder="精修张数"
                  className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
                <input value={form.raw_policy} onChange={(e) => setForm({ ...form, raw_policy: e.target.value })} placeholder="底片政策（如 300 张底片全送）"
                  className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
                <input value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} placeholder="拍摄时长（如 全天）"
                  className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
                <div className="text-xs text-muted mb-1">增值服务定价</div>
                {form.addons.map((a, i) => (
                  <div key={i} className="flex gap-2 mb-2">
                    <input value={a.name} onChange={(e) => updAddon(i, 'name', e.target.value)} placeholder="名称(如加精修/张)" className="flex-1 px-2 py-1 rounded bg-panel2 border border-line text-white text-xs outline-none" />
                    <input value={a.price} onChange={(e) => updAddon(i, 'price', e.target.value)} type="number" placeholder="价格" className="w-24 px-2 py-1 rounded bg-panel2 border border-line text-white text-xs outline-none" />
                    <button type="button" onClick={() => delAddon(i)} className="px-2 text-red-400 text-xs">✕</button>
                  </div>
                ))}
                <button type="button" onClick={addAddon} className="text-brand text-xs mb-3">+ 添加增值项</button>
                <div className="text-xs text-muted mb-1 mt-2">营销绑定</div>
                <input value={form.marketing_coupon} onChange={(e) => setForm({ ...form, marketing_coupon: e.target.value })} placeholder="优惠券(如新客立减200)" className="w-full mb-2 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
                <input value={form.marketing_activity} onChange={(e) => setForm({ ...form, marketing_activity: e.target.value })} placeholder="营销活动(如转发送摆台)" className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
              </>
            )}

            {tab === 2 && (
              <>
                <div className="text-xs text-muted mb-2">同一套系可配置多个版本（独立价格 / 服务），客户在小程序可切换。</div>
                {form.specs.map((s, i) => (
                  <div key={s.id || i} className="border border-line rounded-lg p-3 mb-3 bg-panel2">
                    <div className="flex items-center justify-between mb-2">
                      <input value={s.name} onChange={(e) => updSpec(i, 'name', e.target.value)} placeholder="规格名称(如 经典版/旗舰版)" className="flex-1 px-2 py-1 rounded bg-panel border border-line text-white text-xs outline-none" />
                      <button type="button" onClick={() => delSpec(i)} className="ml-2 px-2 text-red-400 text-xs">删除规格</button>
                    </div>
                    <div className="flex gap-2 mb-2">
                      <input value={s.price} onChange={(e) => updSpec(i, 'price', e.target.value)} type="number" placeholder="价格" className="flex-1 px-2 py-1 rounded bg-panel border border-line text-white text-xs outline-none" />
                      <input value={s.deposit} onChange={(e) => updSpec(i, 'deposit', e.target.value)} type="number" placeholder="定金" className="flex-1 px-2 py-1 rounded bg-panel border border-line text-white text-xs outline-none" />
                    </div>
                    <input value={s.duration} onChange={(e) => updSpec(i, 'duration', e.target.value)} placeholder="拍摄时长(如 全天)" className="w-full mb-2 px-2 py-1 rounded bg-panel border border-line text-white text-xs outline-none" />
                    <input value={s.raw_policy} onChange={(e) => updSpec(i, 'raw_policy', e.target.value)} placeholder="底片政策" className="w-full mb-2 px-2 py-1 rounded bg-panel border border-line text-white text-xs outline-none" />
                    <input value={s.remark} onChange={(e) => updSpec(i, 'remark', e.target.value)} placeholder="规格说明(如 含 2 套服装)" className="w-full px-2 py-1 rounded bg-panel border border-line text-white text-xs outline-none" />
                  </div>
                ))}
                <button type="button" onClick={addSpec} className="text-brand text-xs">+ 添加规格</button>
              </>
            )}

            {tab === 3 && (
              <>
                <div className="text-xs text-muted mb-1">绑定套系专属拍摄问卷（JSON 数组，确认预约后客户填写）</div>
                <div className="text-xs text-muted mb-2">示例：{'[{"q":"婚礼日期","type":"text"},{"q":"偏好风格","type":"text"},{"q":"是否需要跟拍","type":"bool"}]'}</div>
                <textarea value={form.questionnaire} onChange={(e) => setForm({ ...form, questionnaire: e.target.value })} placeholder='[{"q":"婚礼日期","type":"text"}]'
                  className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none h-32 font-mono" />
              </>
            )}

            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 rounded text-sm text-muted">取消</button>
              <button type="submit" className="px-4 py-2 rounded bg-brand text-white text-sm">保存</button>
            </div>
          </form>
        </div>
      )}

      {/* 订单溯源弹窗 */}
      {trace && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setTrace(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg bg-panel border border-line rounded-xl2 p-6">
            <div className="text-white font-medium mb-4">订单溯源（套系 #{trace.id}）</div>
            <div className="max-h-80 overflow-auto">
              {trace.rows.length === 0 && <div className="text-muted text-sm py-6 text-center">暂无订单引用该套系</div>}
              {trace.rows.map((o) => (
                <div key={o.id} className="flex items-center justify-between border-b border-line py-2 text-sm">
                  <div>
                    <span className="text-white">{o.order_no}</span>
                    <span className="text-muted ml-2">{o.customer_name}</span>
                  </div>
                  <div className="text-muted">¥{Number(o.total_amount || 0).toLocaleString()} · {o.status}</div>
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-4">
              <button onClick={() => setTrace(null)} className="px-4 py-2 rounded text-sm text-muted">关闭</button>
            </div>
          </div>
        </div>
      )}

      {/* 单套系私有分享弹窗 */}
      {sharePkg && (
        <ShareModal pkg={sharePkg} onClose={() => setSharePkg(null)} refresh={load} />
      )}
    </div>
  );
}

function ShareModal({ pkg, onClose, refresh }) {
  const [shares, setShares] = useState([]);
  const [password, setPassword] = useState('');
  const [expireDays, setExpireDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [tip, setTip] = useState('');

  const loadShares = () => http.get('/api/shares?type=package&ref_id=' + pkg.id).then((r) => setShares(r.data || [])).catch(() => {});
  useEffect(() => { loadShares(); }, []);

  async function create() {
    setBusy(true); setTip('');
    try {
      const expire_at = expireDays ? new Date(Date.now() + parseInt(expireDays) * 86400000).toISOString().slice(0, 10) : null;
      await http.post('/api/shares', { type: 'package', ref_id: pkg.id, password: password || undefined, expire_at });
      setPassword(''); setExpireDays('');
      setTip('已生成分享（下架套系也可分享）');
      loadShares();
      if (refresh) refresh();
    } catch (e) { setTip('生成失败：' + (e.response?.data?.error || e.message)); }
    setBusy(false);
    setTimeout(() => setTip(''), 3000);
  }
  async function toggle(s) {
    await http.post('/api/shares/' + s.token + '/toggle');
    loadShares(); if (refresh) refresh();
  }
  async function remove(s) {
    if (!confirm('确认后将永久删除，建议先做好本地备份，确定继续？')) return;
    await http.delete('/api/shares/' + s.token);
    loadShares(); if (refresh) refresh();
  }
  const copy = (url) => { navigator.clipboard?.writeText(url); setTip('链接已复制'); setTimeout(() => setTip(''), 2000); };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg bg-panel border border-line rounded-xl2 p-6 max-h-[90vh] overflow-auto">
        <div className="text-white font-medium mb-1">套系私有分享 · {pkg.name}</div>
        <div className="text-xs text-muted mb-4">生成二维码 + 访问密码 + 有效期；可分享下架内部套餐，不受主页上架状态限制。</div>
        {tip && <div className="mb-3 text-sm px-3 py-2 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">{tip}</div>}

        <div className="flex gap-2 mb-4">
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="访问密码(可选)" className="flex-1 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
          <input value={expireDays} onChange={(e) => setExpireDays(e.target.value)} type="number" placeholder="有效期天数" className="w-28 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
          <button onClick={create} disabled={busy} className="px-4 py-2 rounded bg-brand text-white text-sm disabled:opacity-50">生成</button>
        </div>

        <div className="space-y-3">
          {shares.length === 0 && <div className="text-muted text-sm text-center py-4">暂无分享链接</div>}
          {shares.map((s) => (
            <div key={s.token} className="flex gap-3 border border-line rounded-lg p-3 bg-panel2">
              {s.qr_url ? <img src={s.qr_url} className="w-20 h-20 rounded object-contain bg-white" /> : null}
              <div className="flex-1 min-w-0">
                <div className="text-white text-sm truncate">{s.title}</div>
                <div className="text-xs text-muted mt-0.5">
                  {s.has_password ? '🔒 密码保护 · ' : ''}{s.expire_at ? '有效期至 ' + s.expire_at : '长期有效'} · {s.disabled ? '已关闭' : '生效中'}
                </div>
                <div className="text-xs text-brand mt-1 truncate" onClick={() => copy(s.share_url)}>复制链接</div>
              </div>
              <div className="flex flex-col gap-2 items-end">
                <button onClick={() => toggle(s)} className="text-xs text-muted hover:text-white">{s.disabled ? '启用' : '关闭'}</button>
                <button onClick={() => remove(s)} className="text-xs text-red-400 hover:underline">删除</button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="px-4 py-2 rounded text-sm text-muted">关闭</button>
        </div>
      </div>
    </div>
  );
}
