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
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 768 : false);
  useEffect(() => {
    const onResize = () => setIsMobile(typeof window !== 'undefined' ? window.innerWidth < 768 : false);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const [statusOpen, setStatusOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

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
  // 批量上下架：勾选集合（Set 存 id）
  const [checked, setChecked] = useState(new Set());
  const checkAll = list.length > 0 && list.every((p) => checked.has(p.id));
  const toggleCheck = (id) => setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleCheckAll = () => setChecked(checkAll ? new Set() : new Set(list.map((p) => p.id)));
  // 批量上架 / 下架（spec：支持批量上下架；下架后 C 端隐藏、后台录单仍可选）
  const batchStatus = async (next) => {
    const ids = [...checked];
    if (!ids.length) return;
    if (!confirm(`确认批量${next === 'on' ? '上架' : '下架'}选中的 ${ids.length} 个套系？`)) return;
    try {
      await http.post('/api/packages/batch-status', { ids, status: next });
      setChecked(new Set());
      load();
    } catch (e) { alert((e.response && e.response.data && e.response.data.error) || '批量操作失败'); }
  };

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

  const statusOptions = [
    { value: 'all', label: '全部' },
    { value: 'on', label: '已上架' },
    { value: 'off', label: '已下架' },
  ];
  const subtitleOf = (p) => {
    const parts = [];
    if (p.duration) parts.push(p.duration);
    if (p.retouch_count) parts.push(`${p.retouch_count}张精修`);
    if (p.album_service === 'none') parts.push('不提供相册');
    else if (p.album_service === 'provide') parts.push('提供相册');
    else if (p.album_service === 'extra') parts.push('相册另购');
    return parts.join(' | ');
  };

  if (isMobile) {
    return (
      <div style={{ background: '#F8F8F8', minHeight: '100vh', paddingBottom: 100 }}>
        {/* 顶部搜索栏（返回 + 搜索 + 更多，与 MobileShell TopBack 同一行） */}
        {/* 必须有 position:relative，否则气泡弹窗 absolute 定位会相对视口跑到屏幕外 */}
        <div style={{ background: '#fff', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid #EFEFEF', position: 'sticky', top: 0, zIndex: 5 }}>
          <button onClick={() => nav('/')} style={{ background: 'none', border: 'none', padding: 0, display: 'flex', alignItems: 'center', color: '#1f2329', flexShrink: 0 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1f2329" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
            <span style={{ fontSize: 14, marginLeft: 2 }}>返回</span>
          </button>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', background: '#F5F5F5', borderRadius: 20, padding: '6px 12px', gap: 6 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
            <input
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doSearch()}
              placeholder="输入套系名称"
              style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 14, flex: 1, color: '#333' }}
            />
          </div>
          <button onClick={() => { setMenuOpen(!menuOpen); setStatusOpen(false); setCatOpen(false); }} style={{ background: 'none', border: 'none', padding: 4, color: '#666', fontSize: 16, flexShrink: 0, position: 'relative' }}>⋯</button>
          {/* 管理气泡弹窗（带向上三角箭头） */}
          {menuOpen && (
            <>
              {/* 蒙层：点击外部关闭 */}
              <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
              <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 4, background: '#fff', borderRadius: 10, boxShadow: '0 4px 20px rgba(0,0,0,0.12)', zIndex: 50, minWidth: 170, overflow: 'hidden' }}>
                {/* 向上三角箭头 */}
                <div style={{ position: 'absolute', top: -6, right: 14, width: 0, height: 0, borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderBottom: '6px solid #fff' }} />
                <button onClick={() => { setMenuOpen(false); setSortOpen(true); }} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '12px 16px', background: 'none', border: 'none', fontSize: 14, color: '#555', textAlign: 'left' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5h10M11 9h7M11 13h4M3 17l3 3 3-3M6 18V4"/></svg>
                  套系排序
                </button>
                <div style={{ height: 1, background: '#F0F0F0', margin: '0 16px' }} />
                <button onClick={() => { setMenuOpen(false); nav('/packages/new'); }} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '12px 16px', background: 'none', border: 'none', fontSize: 14, color: '#2f7cf6', textAlign: 'left', fontWeight: 500 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2f7cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  添加新套系
                </button>
              </div>
            </>
          )}
        </div>

        {/* 筛选栏 */}
        <div style={{ display: 'flex', background: '#fff', borderBottom: '1px solid #EFEFEF', position: 'relative' }}>
          <button onClick={() => { setStatusOpen(!statusOpen); setCatOpen(false); }} style={{ flex: 1, textAlign: 'center', padding: '12px 0', background: 'none', border: 'none', fontSize: 14, color: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            状态 {statusOpen ? <span>▲</span> : <span>▼</span>}
          </button>
          <button onClick={() => { setCatOpen(!catOpen); setStatusOpen(false); }} style={{ flex: 1, textAlign: 'center', padding: '12px 0', background: 'none', border: 'none', fontSize: 14, color: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            分类 {catOpen ? <span>▲</span> : <span>▼</span>}
          </button>

          {/* 状态下拉 */}
          {statusOpen && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', borderBottom: '1px solid #EFEFEF', zIndex: 10, boxShadow: '0 4px 8px rgba(0,0,0,0.08)' }}>
              {statusOptions.map((o) => (
                <button key={o.value} onClick={() => { setState((s) => ({ ...s, status: o.value })); setStatusOpen(false); }} style={{ display: 'block', width: '100%', padding: '12px 16px', textAlign: 'left', background: 'none', border: 'none', fontSize: 14, color: state.status === o.value ? '#2f7cf6' : '#333' }}>
                  {o.label}
                </button>
              ))}
            </div>
          )}
          {/* 分类下拉 */}
          {catOpen && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', borderBottom: '1px solid #EFEFEF', zIndex: 10, boxShadow: '0 4px 8px rgba(0,0,0,0.08)' }}>
              <button onClick={() => { setState((s) => ({ ...s, category: '' })); setCatOpen(false); }} style={{ display: 'block', width: '100%', padding: '12px 16px', textAlign: 'left', background: 'none', border: 'none', fontSize: 14, color: state.category === '' ? '#2f7cf6' : '#333' }}>全部</button>
              {categories.filter(Boolean).map((c) => (
                <button key={c.id} onClick={() => { setState((s) => ({ ...s, category: String(c.id) })); setCatOpen(false); }} style={{ display: 'block', width: '100%', padding: '12px 16px', textAlign: 'left', background: 'none', border: 'none', fontSize: 14, color: state.category === String(c.id) ? '#2f7cf6' : '#333' }}>
                  {c.name || '未命名'}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 列表 */}
        <div style={{ padding: '12px 16px' }}>
          {list.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#999', padding: '40px 0', fontSize: 14 }}>暂无套系</div>
          ) : (
            list.map((p) => {
              const off = p.status === 'off';
              return (
                <div key={p.id} onClick={() => nav('/packages/' + p.id)} style={{ background: '#fff', borderRadius: 12, padding: '12px 14px', marginBottom: 10, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ width: 80, height: 80, borderRadius: 8, background: '#f5f5f5', overflow: 'hidden', flexShrink: 0, position: 'relative' }}>
                    {p.cover_url ? <img src={img(p.cover_url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
                    {off && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)', color: '#fff', fontSize: 12 }}>已下架</div>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ fontSize: 15, fontWeight: 500, color: '#1f2329', lineHeight: 1.3, flex: 1 }}>{p.name}</div>
                      <div style={{ fontSize: 15, color: '#e4393c', fontWeight: 500, whiteSpace: 'nowrap' }}>¥{Number(p.price).toLocaleString()}</div>
                    </div>
                    <div style={{ fontSize: 12, color: '#999', marginTop: 6 }}>{subtitleOf(p)}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <span style={{ fontSize: 11, color: '#2f7cf6', background: '#EBF2FF', padding: '2px 6px', borderRadius: 4 }}>{catName(p.category_id)}</span>
                      {off && <span style={{ fontSize: 11, color: '#888', background: '#f5f5f5', padding: '2px 6px', borderRadius: 4 }}>已下架</span>}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 min-h-full" style={{ background: '#F8F8F8', maxWidth: 1050 }}>
      {/* 大卡片容器（包含顶部区域：标题+搜索+高级设置+筛选栏+套系列表） */}
      <div className="bg-white border rounded-lg" style={{ borderColor: '#E6E9EF', borderRadius: 8, padding: '16px 20px' }}>
      {/* 标题（左） + 搜索区（右）；面包屑由全局 <Breadcrumb /> 渲染 */}
      <div className="flex items-end justify-between gap-4 flex-wrap mb-4">
        <div>
          <h1 className="text-2xl" style={{ color: '#1f2329' }}>套系</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
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
          <>
            {/* 批量操作栏（勾选后出现）：全选 + 批量上架 / 下架 */}
            <div className="flex items-center gap-3 px-4 py-2 mb-2 rounded-lg border border-line bg-panel2 text-xs">
              <label className="flex items-center gap-2 cursor-pointer" style={{ color: '#1f2329' }}>
                <input type="checkbox" checked={checkAll} onChange={toggleCheckAll} />
                全选
              </label>
              <span className="text-muted">{checked.size > 0 ? `已选 ${checked.size} 项` : '勾选套系后可批量上架 / 下架'}</span>
              {checked.size > 0 && (
                <div className="flex gap-2 ml-auto">
                  <button onClick={() => batchStatus('on')}
                    className="px-3 py-1 rounded text-xs border border-line bg-white text-fg hover:border-brand">批量上架</button>
                  <button onClick={() => batchStatus('off')}
                    className="px-3 py-1 rounded text-xs border border-line bg-white text-fg hover:border-brand">批量下架</button>
                  <button onClick={() => setChecked(new Set())}
                    className="px-3 py-1 rounded text-xs text-muted hover:text-fg">取消选择</button>
                </div>
              )}
            </div>
            <div className="divide-y divide-line border border-line rounded-lg overflow-hidden bg-white">
              {list.map((p) => {
                const off = p.status === 'off';
                return (
                  <div key={p.id}
                    className="flex items-center gap-3 sm:gap-[18px] px-4 py-4 sm:py-[20px] flex-wrap sm:flex-nowrap hover:bg-panel2/40">
                  {/* 批量勾选 */}
                  <input type="checkbox" checked={checked.has(p.id)} onChange={() => toggleCheck(p.id)}
                    className="shrink-0" title="勾选后批量上架/下架" />
                  {/* 左侧封面缩略图（参考图：90×90 方形，已下架深色蒙层） */}
                  <div className="w-[72px] h-[72px] sm:w-[90px] sm:h-[90px] bg-panel2 border border-line overflow-hidden shrink-0 relative">
                    {p.cover_url
                      ? <img src={img(p.cover_url)} alt="" className="w-full h-full object-cover" />
                      : null}
                    {off && (
                      <div className="absolute inset-0 flex items-center justify-center text-white text-xs" style={{ background: 'rgba(51,51,51,0.53)' }}>已下架</div>
                    )}
                  </div>

                  {/* 中部内容 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-fg text-[15px] truncate">{p.name}</span>
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
                    <div className="flex items-center gap-2 mt-1 text-sm flex-wrap">
                      <span className="text-muted">价格：</span>
                      <span style={{ color: '#e4393c' }}>¥{fmtPrice(p.price)}</span>
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
                  <div className="flex items-center gap-4 sm:gap-8 ml-auto shrink-0 self-center">
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
          </>
        )}
      </div>
      </div>

      {/* 订单溯源弹窗 */}
      {trace && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setTrace(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg bg-panel border border-line rounded-xl2 p-6">
            <div className="text-white mb-4">订单溯源（套系 #{trace.id}）</div>
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
      {/* 套系排序管理弹窗 */}
      {sortOpen && (
        <PackageSortModal
          list={list}
          onClose={() => setSortOpen(false)}
          onMoved={load}
        />
      )}
    </div>
  );
}

// 套系排序弹窗：显示当前列表，上下箭头调整顺序，调用 POST /api/packages/:id/move
function PackageSortModal({ list, onClose, onMoved }) {
  const [items, setItems] = useState(list);
  const [moving, setMoving] = useState(false);

  useEffect(() => { setItems(list); }, [list]);

  const move = async (id, dir) => {
    if (moving) return;
    setMoving(true);
    try {
      await http.post('/api/packages/' + id + '/move', { dir });
      onMoved();
    } catch (e) {
      alert((e.response && e.response.data && e.response.data.error) || '移动失败');
    } finally {
      setMoving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: '#fff', borderRadius: '16px 16px 0 0', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #F0F0F0' }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: '#333' }}>套系排序</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 14, color: '#999' }}>完成</button>
        </div>
        <div style={{ overflowY: 'auto', padding: '8px 20px calc(16px + env(safe-area-inset-bottom))', flex: 1 }}>
          {items.map((p, idx) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: idx < items.length - 1 ? '1px solid #F5F5F5' : 'none' }}>
              <div style={{ width: 48, height: 48, borderRadius: 6, overflow: 'hidden', background: '#f5f5f5', flexShrink: 0 }}>
                {p.cover_url ? <img src={img(p.cover_url, 'thumb')} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>¥{Number(p.price || 0).toLocaleString()}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                <button onClick={() => move(p.id, 'up')} disabled={idx === 0 || moving} style={{ background: 'none', border: '1px solid #E5E5E5', borderRadius: 4, padding: '4px 8px', fontSize: 12, color: idx === 0 || moving ? '#ccc' : '#666' }}>上移</button>
                <button onClick={() => move(p.id, 'down')} disabled={idx === items.length - 1 || moving} style={{ background: 'none', border: '1px solid #E5E5E5', borderRadius: 4, padding: '4px 8px', fontSize: 12, color: idx === items.length - 1 || moving ? '#ccc' : '#666' }}>下移</button>
              </div>
            </div>
          ))}
          {items.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: '#999', fontSize: 14 }}>暂无套系</div>
          )}
        </div>
      </div>
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

        <div className="text-center text-fg mb-4">套系分享</div>

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
          <button onClick={onCopy} className="text-sm hover:underline" style={{ color: '#2f7cf6' }}>复制链接</button>
          {copyTip && <span className="ml-2 text-xs" style={{ color: '#16a34a' }}>{copyTip}</span>}
        </div>
      </div>
    </div>
  );
}
