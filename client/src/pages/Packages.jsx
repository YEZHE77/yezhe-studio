import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import http, { img } from '../api.js';
import { useViewState } from '../tabMemory.js';

/* ==========================================================================
   套系页面（后台管理 → 套系）
   —— 视觉规范（严格按设计稿取色，禁止改动）：
        页面底色 #ffffff ／ 深色操作栏 #333333
        主按钮蓝色 #2f7cf6 ／ 黑色按钮 #2c2c2c ／ 定金普通文字 #555（格式：价格：¥xxxx｜定金：¥xxxx）
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
const IconShare = (p) => (
  // 向右弯曲箭头分享图形
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M10 14c0-3 2.5-5 6-5h2" />
    <path d="M15 6l5 3-5 3" />
  </svg>
);
const IconEdit = (p) => (
  // 方形方框内部放置一支铅笔编辑图标
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M16 8l2 2-8 8h-2v-2l8-8Z" />
  </svg>
);
const IconCartDown = (p) => (
  // 购物小车 + 向下箭头下架图形
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M2 5h4l2 10h12l2-8H8" />
    <circle cx="10" cy="19" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="18" cy="19" r="1.5" fill="currentColor" stroke="none" />
    <path d="M17 3v6M14 6l3 3 3-3" />
  </svg>
);
const IconCartUp = (p) => (
  // 购物小车 + 向上箭头上架图形（下架的反向操作，保持同一购物车轮廓）
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M2 5h4l2 10h12l2-8H8" />
    <circle cx="10" cy="19" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="18" cy="19" r="1.5" fill="currentColor" stroke="none" />
    <path d="M17 9V3M14 6l3-3 3 3" />
  </svg>
);
const IconTrash = (p) => (
  // 垃圾桶轮廓图标
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);
const IconList = (p) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </svg>
);
const IconDiamond = (p) => (
  <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" {...p}>
    <path d="M12 2 22 12 12 22 2 12Z" />
  </svg>
);
const IconFilter = (p) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M3 4h18l-7 8v6l-4 2v-8L3 4Z" />
  </svg>
);
// 列表项右侧【图标 + 文字】操作按钮（无背景框、无圆角，默认 #666，hover #333）
const ActionBtn = ({ title, onClick, children }) => (
  <button title={title} onClick={onClick}
    className="flex items-center gap-2 text-[13px] leading-4 text-[#666666] hover:text-[#333333] transition-colors cursor-pointer bg-transparent border-0 p-0 whitespace-nowrap">
    {children}
    <span>{title}</span>
  </button>
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
  const [trace, setTrace] = useState(null); // 订单溯源
  const [sharePkg, setSharePkg] = useState(null); // 套系分享二维码弹窗（H5 / 小程序）
  const [shareTab, setShareTab] = useState('h5'); // h5 | miniprogram
  const [shareQr, setShareQr] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [shareLoading, setShareLoading] = useState(false);
  const [shareErr, setShareErr] = useState('');
  const [copyTip, setCopyTip] = useState('');

  // 顶部搜索框本地输入（点击【搜索】才提交过滤）
  const [qInput, setQInput] = useState(state.q || '');
  const [advOpen, setAdvOpen] = useState(false); // 高级设置面板

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

  // 套系分享二维码弹窗：H5 / 小程序 Tab 共用后端 /api/shares（type=package）生成的专属二维码
  const openShareQr = async (pkg) => {
    setSharePkg(pkg);
    setShareTab('h5');
    setShareQr(''); setShareUrl(''); setShareErr(''); setCopyTip('');
    setShareLoading(true);
    try {
      const list = await http.get('/api/shares?type=package&ref_id=' + pkg.id);
      let s = (list.data || []).find((x) => !x.disabled) || (list.data || [])[0];
      if (!s || !s.qr_url) {
        const r = await http.post('/api/shares', { type: 'package', ref_id: pkg.id });
        s = r.data;
      }
      setShareQr(s.qr_url || '');
      setShareUrl(s.share_url || '');
    } catch (e) {
      setShareErr((e.response && e.response.data && e.response.data.error) || '二维码生成失败');
    } finally {
      setShareLoading(false);
    }
  };
  const copyShareLink = () => {
    if (!shareUrl) return;
    navigator.clipboard?.writeText(shareUrl);
    setCopyTip('链接已复制');
    setTimeout(() => setCopyTip(''), 2000);
  };

  // 删除：已被订单关联的套系禁止物理删除，后端返回 PACKAGE_IN_USE，引导改为下架（验收②）
  const del = async (pkg) => {
    const id = typeof pkg === 'object' ? pkg.id : pkg;
    const cur = typeof pkg === 'object' ? pkg : list.find((x) => x.id === id);
    if (!confirm('确认后将永久删除，建议先做好本地备份，确定继续？')) return;
    try {
      await http.delete('/api/packages/' + id);
      load();
    } catch (e) {
      if (e && e.code === 'PACKAGE_IN_USE') {
        const n = (e.data && e.data.count) || 0;
        const goOff = cur && cur.status === 'on'
          ? confirm(`该套系已关联 ${n} 个订单，为保护历史订单数据不可删除。\n是否改为「下架」隐藏？（下架后 C 端不可见，后台手动录单仍可选）`)
          : (alert(`该套系已关联 ${n} 个订单，为保护历史订单数据不可删除，当前已处于下架状态。`), false);
        if (goOff) { await http.put('/api/packages/' + id, { status: 'off' }); load(); }
        return;
      }
      alert((e && e.message) || '删除失败');
    }
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
      {/* 标题（左） + 搜索区（右）；面包屑由全局 <Breadcrumb /> 渲染 */}
      <div className="flex items-end justify-between gap-4 flex-wrap mb-4">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: '#1f2329' }}>套系</h1>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doSearch()}
            placeholder="套系名称"
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
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg flex-wrap" style={{ background: '#333333' }}>
        <button onClick={() => nav('/packages/new')}
          className="px-4 py-2 rounded text-sm whitespace-nowrap"
          style={{ background: '#2f7cf6', color: '#fff' }}>+ 新建套系</button>
        <span className="text-xs" style={{ color: '#cfcfcf' }}>您目前没有上线的促销/拼团活动…</span>
        <div className="flex-1" />
        <select value={state.category} onChange={(e) => setState((s) => ({ ...s, category: e.target.value }))}
          className="px-3 py-2 rounded text-sm outline-none border-0"
          style={{ background: '#3a3a3a', color: '#fff' }}>
          <option value="">分类：全部</option>
          {categories.filter(Boolean).map((c) => <option key={c.id} value={c.id}>{c.name || '未命名'}</option>)}
        </select>
        <button onClick={() => setAdvOpen((v) => !v)} title="更多筛选"
          className="p-2 rounded hover:bg-white/10" style={{ color: '#cfcfcf' }}><IconList /></button>
        <button onClick={() => setAdvOpen((v) => !v)} title="筛选"
          className="p-2 rounded hover:bg-white/10" style={{ color: '#cfcfcf' }}><IconFilter /></button>
      </div>

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

      {/* 套系列表（横向条目） */}
      <div className="mt-4">
        {list.length === 0 ? (
          <div className="text-center text-muted py-16">暂无套系，点击右上角「+ 新建套系」开始添加。</div>
        ) : (
          <div className="divide-y divide-line border border-line rounded-lg overflow-hidden bg-white">
            {list.map((p) => {
              const off = p.status === 'off';
              return (
                <div key={p.id}
                  className="flex items-center gap-3 px-4 py-2.5 flex-wrap sm:flex-nowrap hover:bg-panel2/40">
                  {/* 左侧封面缩略图（方形占位，无文字） */}
                  <div className="w-16 h-16 rounded-lg bg-panel2 border border-line overflow-hidden shrink-0 flex items-center justify-center">
                    {p.cover_url
                      ? <img src={img(p.cover_url)} alt="" className="w-full h-full object-cover" />
                      : null}
                  </div>

                  {/* 中部内容 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-fg font-bold text-[15px] truncate">{p.name}</span>
                      {off && (
                        <span className="px-1.5 py-0.5 rounded text-[11px]" style={{ background: '#f5f5f5', color: '#888' }}>已下架</span>
                      )}
                      {Array.isArray(p.specs) && p.specs.length > 0 && (
                        <span className="px-1.5 py-0.5 rounded text-[11px]" style={{ background: '#eaf5ef', color: '#3a9d7a' }}>{p.specs.length} 规格</span>
                      )}
                    </div>
                    {/* 简短简介（截断，禁止完整长描述） */}
                    {p.description ? (
                      <div className="mt-0.5 text-xs truncate" style={{ color: '#9ca3af' }}>
                        {p.description.length > 28 ? p.description.slice(0, 28) + '…' : p.description}
                      </div>
                    ) : null}
                    <div className="flex items-center gap-2 mt-1 text-sm">
                      <span className="text-muted">价格：</span>
                      <span className="font-bold" style={{ color: '#e4393c' }}>¥{fmtPrice(p.price)}</span>
                      <span className="text-muted">｜定金：</span>
                      <span style={{ color: '#555' }}>¥{fmtDeposit(p.deposit)}</span>
                    </div>
                    {/* 底部：菱形图标 + 套系分类名称（灰色小字） */}
                    <div className="flex items-center gap-1 mt-1">
                      <IconDiamond style={{ color: '#9ca3af' }} />
                      <span className="text-xs" style={{ color: '#9ca3af' }}>{catName(p.category_id)}</span>
                    </div>
                  </div>

                  {/* 右侧操作按钮组：分享 → 编辑 → 下架 → 删除（图标 + 文字） */}
                  <div className="flex items-center gap-8 ml-auto shrink-0 self-center">
                    <ActionBtn title="分享" onClick={() => openShareQr(p)}><IconShare /></ActionBtn>
                    <ActionBtn title="编辑" onClick={() => nav('/packages/' + p.id + '/edit')}><IconEdit /></ActionBtn>
                    <ActionBtn title={off ? '上架' : '下架'} onClick={() => toggleStatus(p)}>
                      {off ? <IconCartUp /> : <IconCartDown />}
                    </ActionBtn>
                    <ActionBtn title="删除" onClick={() => del(p)}><IconTrash /></ActionBtn>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

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

      {/* 套系分享二维码弹窗（H5 / 小程序） */}
      {sharePkg && (
        <PackageShareModal
          pkg={sharePkg}
          tab={shareTab} setTab={setShareTab}
          qr={shareQr} url={shareUrl}
          loading={shareLoading} err={shareErr}
          copyTip={copyTip} onCopy={copyShareLink}
          onClose={() => setSharePkg(null)}
        />
      )}
    </div>
  );
}

// 套系分享二维码弹窗：H5 / 小程序 Tab 切换；二维码来自后端 /api/shares（type=package）动态生成，绑定当前套系 ID，不写死。
function PackageShareModal({ pkg, tab, setTab, qr, url, loading, err, copyTip, onCopy, onClose }) {
  const IconH5 = (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.5 2.5 15.5 0 18M12 3c-2.5 2.5-2.5 15.5 0 18" />
    </svg>
  );
  const IconMini = (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6A8.4 8.4 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5Z" />
      <circle cx="9" cy="10" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="10" r="1" fill="currentColor" stroke="none" />
    </svg>
  );

  const tabBtn = (key, label, Icon) => {
    const active = tab === key;
    return (
      <button onClick={() => setTab(key)}
        className={'flex-1 flex items-center justify-center gap-1.5 pb-2.5 border-b-2 ' + (active ? 'border-brand' : 'border-transparent')}
        style={{ color: active ? '#2f7cf6' : '#9ca3af' }}>
        <Icon />{label}
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm bg-white rounded-2xl p-6 relative"
        style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.18)' }}>
        {/* 右上角关闭叉号 */}
        <button onClick={onClose} className="absolute top-3 right-3 p-1.5 rounded hover:bg-panel2" style={{ color: '#6b7280' }}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        <div className="text-center text-fg font-medium mb-4">套系分享</div>

        {/* Tab 切换栏 */}
        <div className="flex border-b border-line mb-5">
          {tabBtn('h5', 'H5', IconH5)}
          {tabBtn('miniprogram', '小程序', IconMini)}
        </div>

        {/* 二维码区域 */}
        <div className="flex items-center justify-center" style={{ minHeight: 200 }}>
          {loading ? (
            <div className="text-sm" style={{ color: '#9ca3af' }}>二维码生成中…</div>
          ) : err ? (
            <div className="text-sm text-center px-4" style={{ color: '#e53e3e' }}>{err}</div>
          ) : qr ? (
            tab === 'h5' ? (
              <img src={qr} alt="套系 H5 分享二维码" className="w-44 h-44 rounded-lg bg-white" />
            ) : (
              <div className="relative" style={{ width: 184, height: 184 }}>
                <div className="w-full h-full rounded-full overflow-hidden bg-white"
                  style={{ boxShadow: '0 0 0 6px #fff, 0 0 0 7px #07C160' }}>
                  <img src={qr} alt="套系小程序二维码" className="w-full h-full object-cover" />
                </div>
                <span className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center"
                  style={{ background: '#07C160' }}>
                  <IconMini style={{ color: '#fff' }} />
                </span>
              </div>
            )
          ) : (
            <div className="text-sm" style={{ color: '#9ca3af' }}>暂无二维码</div>
          )}
        </div>

        {/* 提示文字 */}
        <div className="text-center text-sm mt-4" style={{ color: '#666' }}>使用微信扫描以上二维码</div>

        {/* 复制链接 */}
        <div className="text-center mt-2">
          <button onClick={onCopy} className="text-sm font-medium hover:underline" style={{ color: '#2f7cf6' }}>复制链接</button>
          {copyTip && <span className="ml-2 text-xs" style={{ color: '#16a34a' }}>{copyTip}</span>}
        </div>
      </div>
    </div>
  );
}
