import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import http, { img } from '../api.js';
import { useViewState } from '../tabMemory.js';
import OrderCreateModal from '../components/OrderCreateModal.jsx';

/* ==========================================================================
   订单中心（列表页）
   —— 本页仅承载「列表 + 筛选 + 新建」，订单详情走独立路由 /orders/:id。
   —— 视觉规范（严格按设计稿取色，禁止改动）：
        深色筛选栏 #2c2c2c ／ 预警条底 #fff3e0 ／ 金额与预警红字 #ff3333
        未结算尾款标签 #e2d2c2 ／「设置>」链接 #ff8822 ／ 页面底色 #ffffff
   —— 注意：全局 index.css 把 .text-white 覆写成了深灰（浅色主题迁移），
        因此深色区域的白字一律用内联 style={{color:'#fff'}}，不要用 text-white。
   —— 所有统计数字（订单总数 / 到期 / 选片超时）均由后端接口返回，禁止硬编码。
   ========================================================================== */

const STATUS_LABEL = {
  deposit: '已付定金', shot: '已拍摄', selecting: '选片中',
  retouching: '精修中', delivered: '已交付', completed: '已完成', cancelled: '已作废'
};

// 首阶段 status 恒为 deposit（订单已建立），但收款状态可能仍是「未付定金」，
// 直接显示「已付定金」会误导，这里按 payment_status 做展示层修正（不改后端阶段机）。
function stageLabel(o) {
  if (o && o.status === 'deposit' && o.payment_status === 'unpaid') return '未付定金';
  return STATUS_LABEL[o && o.status] || '历史订单';
}

// JSON 列容错解析：后端已 JSON.parse，但旧数据/异常情况下可能仍是字符串
function asArr(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}
function asObj(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    try { const p = JSON.parse(v); return (p && typeof p === 'object') ? p : {}; } catch { return {}; }
  }
  return {};
}
function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s).slice(0, 10);
  return d.toLocaleDateString('zh-CN');
}

/* --------------------------- 内联 SVG 图标（无第三方依赖） --------------------------- */
const IconPencil = (p) => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);
const IconCalendar = (p) => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" {...p}>
    <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
  </svg>
);
const IconList = (p) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" {...p}>
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </svg>
);
const IconFilter = (p) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3Z" />
  </svg>
);
const IconTrash = (p) => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M3 6h18" />
    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M19 6l-.867 12.142A2 2 0 0 1 16.138 20H7.862a2 2 0 0 1-1.995-1.858L5 6" />
    <path d="M10 10v5" />
    <path d="M14 10v5" />
  </svg>
);

export default function Orders() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const [state, setState] = useViewState('orders', { status: '', q: '', executor: '', sort: 'recent', shootFrom: '', shootTo: '' });

  const [list, setList] = useState([]);
  const [listTotal, setListTotal] = useState(0);
  const pageRef = useRef(1);
  const pageSize = 12;

  const [pkgs, setPkgs] = useState([]);
  const [personnel, setPersonnel] = useState([]);
  // 统计数字全部来自 GET /api/orders/stats（后端实时 SQL），前端不做任何硬编码
  const [stats, setStats] = useState({ expiringSoon: 0, selectionTimeout: 0, total: 0 });

  const [showForm, setShowForm] = useState(false);
  const [qInput, setQInput] = useState(state.q || '');
  // 移动端响应式：宽度 < 768px 视为手机，内联样式按 isMobile 降级
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 768 : false);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [compact, setCompact] = useState(false); // 列表视图图标：卡片流 ⇄ 紧凑行列表
  const [trash, setTrash] = useState(false);

  const [renamingId, setRenamingId] = useState(null);
  const [renameVal, setRenameVal] = useState('');

  const [share, setShare] = useState(null);
  const [shareModal, setShareModal] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareKind, setShareKind] = useState('album'); // album=分享订单 / survey=问卷邀请

  // 订单二维码悬浮弹窗（点击卡片右下角「分享订单」唤起）
  const [qrPopover, setQrPopover] = useState(null); // { orderId, qrUrl, loading, error, rect }

  const abortRef = useRef(null);

  /* ------------------------------ 数据加载 ------------------------------ */
  const refreshOrderList = useCallback(async (opts = {}) => {
    const reset = opts.reset !== false;
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      if (trash) {
        const r = await http.get('/api/orders/recycle', { signal: ctrl.signal });
        setList(r.data); setListTotal(r.data.length); pageRef.current = 1;
        return;
      }
      const nextPage = reset ? 1 : pageRef.current + 1;
      const p = new URLSearchParams();
      if (state.status) p.set('status', state.status);
      if (state.q) p.set('q', state.q);
      if (state.executor) p.set('executor', state.executor);
      if (state.sort && state.sort !== 'recent') p.set('sort', state.sort);
      if (state.shootFrom) p.set('shootFrom', state.shootFrom);
      if (state.shootTo) p.set('shootTo', state.shootTo);
      p.set('page', nextPage);
      p.set('pageSize', pageSize);
      const r = await http.get('/api/orders?' + p.toString(), { signal: ctrl.signal });
      const rows = r.data.list || [];
      setList((prev) => (reset ? rows : [...prev, ...rows]));
      setListTotal(r.data.total || 0);
      pageRef.current = nextPage;
    } catch (e) {
      if (e.name !== 'AbortError') { /* 忽略请求中断外的错误 */ }
    }
  }, [state, trash]);

  const loadStats = useCallback(() => {
    http.get('/api/orders/stats')
      .then((r) => setStats(r.data || { expiringSoon: 0, selectionTimeout: 0, total: 0 }))
      .catch(() => {});
  }, []);

  useEffect(() => { refreshOrderList({ reset: true }); }, [refreshOrderList]);
  useEffect(() => () => { if (abortRef.current) abortRef.current.abort(); }, []);
  useEffect(() => {
    const ctrl = new AbortController();
    http.get('/api/packages?status=all', { signal: ctrl.signal }).then((r) => setPkgs(r.data)).catch(() => {});
    return () => ctrl.abort();
  }, []);
  useEffect(() => {
    const ctrl = new AbortController();
    http.get('/api/admin/personnel', { signal: ctrl.signal }).then((r) => setPersonnel(r.data || [])).catch(() => {});
    return () => ctrl.abort();
  }, []);
  useEffect(() => { loadStats(); }, [loadStats]);

  // 工作台跳转预筛选：
  //   ?status=xxx  直接设置列表状态筛选（兼容旧工作台进度条入口）
  //   ?tab=xxx     移动端待办事项 Tab key，映射为对应 status（如 waitingShoot → deposit）
  // 同时清理历史遗留的 ?pkg= 参数——旧方案会据此自动弹出「新建订单」，
  // 现已彻底移除该行为：新建订单只能由用户点击【+ 添加新订单】主动触发。
  useEffect(() => {
    const s = params.get('status');
    const tab = params.get('tab');
    let nextStatus = '';
    if (s) nextStatus = s;
    else if (tab && TAB_STATUS[tab]) nextStatus = TAB_STATUS[tab];
    if (nextStatus) setState((x) => ({ ...x, status: nextStatus }));
    if (params.get('pkg')) {
      const next = new URLSearchParams(params);
      next.delete('pkg');
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line
  }, []);

  /* ------------------------------ 交互 ------------------------------ */
  const doSearch = () => setState((s) => ({ ...s, q: qInput }));
  const setFilter = (k, v) => setState((s) => ({ ...s, [k]: v }));
  const afterMutate = () => { refreshOrderList({ reset: true }); loadStats(); };

  // 卡片快速改名：点击订单名旁铅笔进入内联编辑，回车/失焦提交
  const startRename = (o) => { setRenamingId(o.id); setRenameVal(o.order_name || ''); };
  const commitRename = async () => {
    if (!renamingId) return;
    const name = (renameVal || '').trim();
    const id = renamingId;
    setRenamingId(null);
    if (!name) { refreshOrderList({ reset: true }); return; }
    try {
      await http.put('/api/orders/' + id, { order_name: name });
      refreshOrderList({ reset: true });
    } catch (e) { alert((e.response && e.response.data && e.response.data.error) || '重命名失败'); }
  };

  // 软删除订单（移入回收站）
  const handleDelete = async (o, e) => {
    e.stopPropagation();
    e.preventDefault();
    if (!window.confirm(`确定将订单「${o.order_name || '未命名订单'}」移入回收站？\n\n移入后可在回收站中恢复或彻底删除。`)) return;
    try {
      await http.delete('/api/orders/' + o.id);
      refreshOrderList({ reset: true });
    } catch (err) {
      alert((err.response && err.response.data && err.response.data.error) || '删除失败');
    }
  };

  // 分享订单 / 问卷邀请：复用同一个订单分享接口，仅弹窗文案不同
  const openShareFor = async (o, kind) => {
    setShareBusy(true); setShareKind(kind); setShare(null); setShareModal(true);
    try {
      const r = await http.post('/api/orders/' + o.id + '/share');
      setShare(r.data);
    } catch (e) {
      setShareModal(false);
      alert((e.response && e.response.data && e.response.data.error) || '生成失败');
    } finally { setShareBusy(false); }
  };

  // 订单二维码悬浮弹窗：点击「分享订单」按钮时，在按钮上方弹出
  const openQrPopover = async (o, e) => {
    const btn = e.currentTarget;
    const rect = btn.getBoundingClientRect();
    setQrPopover({ orderId: o.id, qrUrl: '', loading: true, error: '', rect });
    try {
      const r = await http.post('/api/orders/' + o.id + '/mini-qr');
      setQrPopover((prev) => (prev && prev.orderId === o.id
        ? { ...prev, loading: false, qrUrl: r.data.qr_url, error: '' }
        : prev));
    } catch (err) {
      setQrPopover((prev) => (prev && prev.orderId === o.id
        ? { ...prev, loading: false, qrUrl: '', error: (err.response?.data?.error) || '二维码生成失败' }
        : prev));
    }
  };
  const closeQrPopover = () => setQrPopover(null);

  const copyShare = () => {
    if (!share) return;
    navigator.clipboard?.writeText(share.share_url);
    alert('链接已复制：\n' + share.share_url);
  };

  // 导出 Excel（携带当前筛选条件；后端 /api/orders/export 输出 UTF-8 BOM CSV）
  const doExport = () => {
    const base = (http.defaults.baseURL || '').replace(/\/+$/, '');
    const p = new URLSearchParams();
    if (state.status) p.set('status', state.status);
    if (state.q) p.set('q', state.q);
    if (state.executor) p.set('executor', state.executor);
    if (state.shootFrom) p.set('shootFrom', state.shootFrom);
    if (state.shootTo) p.set('shootTo', state.shootTo);
    const qs = p.toString();
    window.open(base + '/api/orders/export' + (qs ? '?' + qs : ''), '_blank');
  };

  /* ------------------------------ 渲染 ------------------------------ */
  // 移动端：复刻「待办事项」独立页面（顶部日期条 + 横向状态 Tab + 订单列表）
  if (isMobile) {
    return (
      <MobileTodoView
        stats={stats}
        list={list}
        listTotal={listTotal}
        state={state}
        setState={setState}
        refreshOrderList={refreshOrderList}
        onNavToOrder={(id) => nav('/orders/' + id)}
        onLoadMore={() => refreshOrderList({ reset: false })}
      />
    );
  }

  return (
    <div className="p-4 sm:p-6 min-h-full" style={{ background: '#F8F8F8', maxWidth: 1050 }}>
      {/* 大卡片容器（包含顶部区域：标题+搜索+筛选栏+订单列表） */}
      <div className="bg-white border rounded-lg" style={{ borderColor: '#E6E9EF', borderRadius: 8, padding: isMobile ? '12px' : '16px 20px' }}>
      {/* 大标题（左） / 搜索区（右）；面包屑由全局 <Breadcrumb /> 渲染 */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <h1 style={{ fontSize: 16, fontWeight: 400, color: '#000000' }}>订单中心</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doSearch()}
            placeholder="姓名、套系名称、备注..."
            className="w-36 sm:w-56 md:w-72 px-3 py-2 rounded border border-line bg-white text-fg text-sm outline-none focus:border-brand"
          />
          <button onClick={doSearch}
            className="px-4 py-2 rounded text-sm whitespace-nowrap"
            style={{ background: '#333333', color: '#fff' }}>搜索</button>
          <button onClick={() => setAdvancedOpen((v) => !v)}
            className="px-4 py-2 rounded text-sm whitespace-nowrap"
            style={{ background: '#333333', color: '#fff' }}>高级选项</button>
        </div>
      </div>

      {/* 深色筛选栏：+添加新订单 → 状态 → 执行者 → 排序 → 列表视图 → 筛选 */}
      <div className="flex items-center gap-3 px-3 py-5 rounded-lg flex-wrap" style={{ background: '#2c2c2c' }}>
        <button onClick={() => setShowForm(true)}
          className="px-4 py-1.5 rounded text-sm whitespace-nowrap"
          style={{ background: '#2DB7F5', color: '#fff', fontSize: 14 }}>+ 添加新订单</button>

        <div className="hidden sm:block flex-1" />

        <span className="text-xs whitespace-nowrap" style={{ color: '#fff' }}>状态</span>
        <select value={trash ? '__trash' : state.status}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '__trash') { setTrash(true); setFilter('status', ''); return; }
            setTrash(false); setFilter('status', v);
          }}
          className="px-3 py-1.5 rounded text-sm outline-none border-0"
          style={{ background: '#fff', color: '#333' }}>
          <option value="">所有订单 ({stats.total})</option>
          <option value="unpaid">未付定金</option>
          <option value="deposit">已付定金</option>
          <option value="shot">已拍摄</option>
          <option value="selecting">选片中</option>
          <option value="retouching">精修中</option>
          <option value="delivered">已交付</option>
          <option value="completed">已完成</option>
          <option value="cancelled">已作废</option>
          <option value="__trash">回收站</option>
        </select>

        <span className="text-xs whitespace-nowrap" style={{ color: '#fff' }}>执行者</span>
        <select value={state.executor} onChange={(e) => setFilter('executor', e.target.value)}
          className="px-3 py-1.5 rounded text-sm outline-none border-0"
          style={{ background: '#fff', color: '#333' }}>
          <option value="">所有人</option>
          {personnel.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
        </select>

        <span className="text-xs whitespace-nowrap" style={{ color: '#fff' }}>排序</span>
        <select value={state.sort} onChange={(e) => setFilter('sort', e.target.value)}
          className="px-3 py-1.5 rounded text-sm outline-none border-0"
          style={{ background: '#fff', color: '#333' }}>
          <option value="recent">最近操作</option>
          <option value="shoot_date">拍摄时间</option>
          <option value="amount">订单金额</option>
        </select>

        <button onClick={() => setCompact((v) => !v)} title={compact ? '切换为卡片视图' : '切换为列表视图'}
          className="p-1.5 rounded" style={{ color: compact ? '#2f7cf6' : '#bbb' }}>
          <IconList />
        </button>
        <button onClick={() => setAdvancedOpen((v) => !v)} title="展开 / 收起筛选"
          className="flex items-center gap-1 p-1.5 rounded text-xs whitespace-nowrap"
          style={{ color: advancedOpen ? '#2f7cf6' : '#fff' }}>
          <IconFilter />
          <span>筛选</span>
        </button>
      </div>

      {/* 高级选项：拍摄日期范围 */}
      {advancedOpen && (
        <div className="flex gap-2 mt-3 flex-wrap items-center">
          <span className="text-xs text-muted">拍摄日期</span>
          <input type="date" value={state.shootFrom} onChange={(e) => setFilter('shootFrom', e.target.value)}
            className="px-3 py-1.5 rounded border border-line bg-white text-fg text-sm outline-none" />
          <span className="text-xs text-muted">至</span>
          <input type="date" value={state.shootTo} onChange={(e) => setFilter('shootTo', e.target.value)}
            className="px-3 py-1.5 rounded border border-line bg-white text-fg text-sm outline-none" />
          <button onClick={() => { setFilter('shootFrom', ''); setFilter('shootTo', ''); }}
            className="px-3 py-1.5 rounded border border-line bg-white text-muted text-xs">清除</button>
        </div>
      )}

      {trash && (
        <div className="text-xs mt-3" style={{ color: '#ff8822' }}>
          回收站：以下订单已软删除，可在订单详情中「恢复」或「彻底删除」。
        </div>
      )}

      {/* 订单卡片列表 */}
      {!compact && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-4">
          {list.map((o) => {
            const snap = asObj(o.package_snapshot);
            const pkgName = [snap.name, snap.spec && snap.spec.name].filter(Boolean).join('｜') || '未选套系';
            const execs = asArr(o.executors);
            const cover = snap.cover_url ? img(snap.cover_url) : '';
            const amount = Number(o.total_amount || 0);
            const remain = amount - Number(o.paid_amount || 0);
            const done = o.status === 'completed';
            const hasSurvey = Array.isArray(snap.questionnaire) && snap.questionnaire.length > 0;
            const surveyDone = !!(o.questionnaire_answers && String(o.questionnaire_answers) !== '{}' && String(o.questionnaire_answers) !== 'null');
            return (
              <div key={o.id} className="rounded-xl2 border border-line bg-white p-4 flex flex-col transition-all duration-200 hover:shadow-md hover:border-[#c9d8e8] hover:-translate-y-0.5">
                {/* 卡片头部：订单名 + 蓝色铅笔 / 订单编号 ｜ 右上灰色状态 */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {renamingId === o.id ? (
                      <input autoFocus value={renameVal} onChange={(e) => setRenameVal(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null); }}
                        className="w-full px-2 py-1 rounded border border-line bg-white text-fg text-sm outline-none" />
                    ) : (
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-fg text-sm truncate">订单：{o.order_name || '未命名订单'}</span>
                        <button onClick={() => startRename(o)} title="编辑订单名称"
                          className="shrink-0" style={{ color: '#2f7cf6' }}><IconPencil /></button>
                      </div>
                    )}
                    <div className="text-[11px] text-faint mt-1">订单编号：{o.order_no}</div>
                  </div>
                  <span className="text-xs shrink-0" style={{ color: '#9ca3af' }}>{stageLabel(o)}</span>
                </div>

                {/* 卡片主体：方形封面 + 套系 + 金额 + 尾款标签 + 日期 */}
                <div className="flex gap-3 mt-3">
                  <div className="w-[72px] h-[72px] rounded bg-panel2 border border-line overflow-hidden shrink-0 flex items-center justify-center">
                    {cover
                      ? <img src={cover} alt="" className="w-full h-full object-cover" />
                      : <span className="text-[10px] text-faint">无图</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-fg truncate">{pkgName}</div>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span style={{ color: '#ff3333' }}>¥{amount.toLocaleString()}</span>
                      {remain > 0 && (
                        <span className="px-1.5 py-0.5 rounded text-[11px]"
                          style={{ background: '#e2d2c2', color: '#6b5744' }}>未结算尾款</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-1.5 text-[12px]" style={{ color: '#6b7280' }}>
                      <IconCalendar />
                      {done
                        ? <span>默认好评：{fmtDate(o.eval_at || o.created_at) || '—'}</span>
                        : <span>拍摄日期：{Number(o.date_tbd) === 1 ? '日期待定' : (o.shoot_date || '未排期')}</span>}
                    </div>
                  </div>
                </div>

                {/* 浅米色占位行（备注） */}
                <div className="mt-3 px-3 py-2 rounded text-xs truncate"
                  style={{ background: '#faf7f2', color: '#8a8378' }}>
                  {o.remark ? o.remark : '无'}
                </div>

                {/* 卡片底部：参与者 + 按钮组 */}
                <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                  <span className="text-xs" style={{ color: '#6b7280' }}>参与者：</span>
                  {execs.length === 0 && <span className="text-xs text-faint">—</span>}
                  {execs.map((p, i) => (
                    p.avatar
                      ? <img key={i} src={img(p.avatar)} alt={p.name} title={p.name}
                        className="w-6 h-6 rounded-full object-cover border border-line" />
                      : <span key={i} title={p.name}
                        className="w-6 h-6 rounded-full bg-brand/15 text-brand text-[10px] flex items-center justify-center">
                        {String(p.name || '?').slice(0, 1)}
                      </span>
                  ))}
                </div>

                <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-line flex-wrap">
                  <button onClick={(e) => handleDelete(o, e)}
                    className="shrink-0 p-1 rounded transition"
                    title="移入回收站"
                    style={{ color: '#cccccc' }}
                    onMouseEnter={(e) => e.currentTarget.style.color = '#ff4d4f'}
                    onMouseLeave={(e) => e.currentTarget.style.color = '#cccccc'}
                  ><IconTrash /></button>
                  <div className="flex items-center justify-end gap-2 flex-wrap">
                  {hasSurvey && !surveyDone && (
                    <button onClick={() => openShareFor(o, 'survey')} disabled={shareBusy}
                      className="px-3 py-1.5 rounded text-xs border disabled:opacity-40"
                      style={{ background: '#ffffff', borderColor: '#e0e0e0', color: '#666666' }}>问卷邀请</button>
                  )}
                  <button onClick={() => nav('/orders/' + o.id)}
                    className="px-3 py-1.5 rounded text-xs border"
                    style={{ background: '#ffffff', borderColor: '#e0e0e0', color: '#666666' }}>查看订单</button>
                  <button onClick={(e) => openQrPopover(o, e)} disabled={shareBusy}
                    className="px-3 py-1.5 rounded text-xs disabled:opacity-40"
                    style={{ background: '#2f7cf6', color: '#fff' }}>分享订单</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 紧凑列表视图（筛选栏「列表视图」图标切换） */}
      {compact && list.length > 0 && (
        <div className="mt-4 border border-line rounded-xl2 overflow-hidden">
          <div className="hidden md:flex items-center gap-3 px-4 py-2 bg-panel2 text-xs text-muted">
            <span className="flex-1">订单 / 编号</span>
            <span className="w-40">套系</span>
            <span className="w-24 text-right">金额</span>
            <span className="w-28">拍摄日期</span>
            <span className="w-20">状态</span>
            <span className="w-44 text-right">操作</span>
          </div>
          {list.map((o) => {
            const snap = asObj(o.package_snapshot);
            const pkgName = [snap.name, snap.spec && snap.spec.name].filter(Boolean).join('｜') || '未选套系';
            return (
              <div key={o.id} className="flex items-center gap-3 px-4 py-3 border-t border-line bg-white text-sm flex-wrap">
                <span className="flex-1 min-w-[160px]">
                  <span className="text-fg block truncate">订单：{o.order_name || '未命名订单'}</span>
                  <span className="text-[11px] text-faint">订单编号：{o.order_no}</span>
                </span>
                <span className="w-40 text-muted truncate hidden md:block">{pkgName}</span>
                <span className="w-24 text-right" style={{ color: '#ff3333' }}>¥{Number(o.total_amount || 0).toLocaleString()}</span>
                <span className="w-28 text-muted text-xs hidden md:block">{Number(o.date_tbd) === 1 ? '日期待定' : (o.shoot_date || '未排期')}</span>
                <span className="w-20 text-xs" style={{ color: '#9ca3af' }}>{stageLabel(o)}</span>
                <span className="w-44 flex justify-end gap-2">
                  <button onClick={() => nav('/orders/' + o.id)}
                    className="px-3 py-1 rounded text-xs border"
                    style={{ background: '#ffffff', borderColor: '#e0e0e0', color: '#666666' }}>查看订单</button>
                  <button onClick={(e) => openQrPopover(o, e)} disabled={shareBusy}
                    className="px-3 py-1 rounded text-xs disabled:opacity-40"
                    style={{ background: '#2f7cf6', color: '#fff' }}>分享订单</button>
                </span>
              </div>
            );
          })}
        </div>
      )}
      </div>

      {list.length === 0 && <div className="text-center text-muted py-16">暂无订单</div>}

      {/* 加载更多（后端分页） */}
      {!trash && list.length > 0 && list.length < listTotal && (
        <div className="flex justify-center mt-6">
          <button onClick={() => refreshOrderList({ reset: false })}
            className="px-6 py-2 rounded border border-line bg-white text-fg text-sm hover:border-brand">
            加载更多（{list.length}/{listTotal}）
          </button>
        </div>
      )}

      {/* 新建订单弹窗：仅点击【+ 添加新订单】才打开，无任何自动弹出逻辑 */}
      <OrderCreateModal
        visible={showForm}
        packages={pkgs}
        initialPackageId={null}
        onClose={() => setShowForm(false)}
        onAfterCreate={afterMutate}
      />

      {/* 分享 / 问卷邀请二维码弹窗 */}
      {shareModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[80] p-4" onClick={() => setShareModal(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm bg-white border border-line rounded-xl2 p-6 text-center">
            <div className="text-fg mb-1">{shareKind === 'survey' ? '问卷邀请' : '分享订单'}</div>
            <div className="text-xs text-muted mb-4">
              {shareKind === 'survey'
                ? '把二维码或链接发给客户，客户在手机上即可填写拍摄问卷'
                : '扫码或复制链接，客户即可在手机上查看订单与成品影集（仅展示样片/成片，不含原片）'}
            </div>
            {share && share.qr_url ? (
              <>
                <img src={share.qr_url} alt="二维码" className="w-56 h-56 mx-auto rounded-lg bg-white p-2 border border-line" />
                <div className="text-xs text-muted mt-3 break-all">{share.share_url}</div>
                <div className="flex gap-2 justify-center mt-4">
                  <button onClick={copyShare} className="px-4 py-1.5 rounded text-xs" style={{ background: '#2f7cf6', color: '#fff' }}>复制链接</button>
                  <button onClick={() => setShareModal(false)}
                    className="px-4 py-1.5 rounded text-xs border"
                    style={{ background: '#ffffff', borderColor: '#e0e0e0', color: '#666666' }}>关闭</button>
                </div>
              </>
            ) : (<div className="text-muted text-sm py-10">生成中…</div>)}
          </div>
        </div>
      )}

      {/* 订单二维码悬浮弹窗：紧贴「分享订单」按钮上方，白底阴影、无关闭叉号、点击蒙层关闭 */}
      {qrPopover && (
        <div className="fixed inset-0 z-[90]" style={{ background: 'rgba(0,0,0,0.35)' }} onClick={closeQrPopover}>
          {(() => {
            const { rect } = qrPopover;
            const popW = 300;
            const padding = 16;
            const left = Math.max(12, Math.min(window.innerWidth - popW - 12, rect.left + rect.width / 2 - popW / 2));
            const top = rect.top - 280 - 12; // 弹窗高约 280，留 12px 间隙
            const adjustedTop = top < 12 ? rect.bottom + 12 : top;
            return (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute bg-white rounded-xl2"
                style={{
                  left,
                  top: adjustedTop,
                  width: popW,
                  padding,
                  boxShadow: '0 12px 40px rgba(0,0,0,0.16)',
                }}
              >
                <div className="text-sm mb-3" style={{ color: '#1f2329' }}>订单二维码</div>
                <div className="flex items-center justify-center" style={{ minHeight: 200 }}>
                  {qrPopover.loading ? (
                    <div className="text-xs" style={{ color: '#9ca3af' }}>二维码生成中…</div>
                  ) : qrPopover.error ? (
                    <div className="text-xs text-center px-4" style={{ color: '#e53e3e' }}>{qrPopover.error}</div>
                  ) : qrPopover.qrUrl ? (
                    <img
                      src={qrPopover.qrUrl}
                      alt="订单二维码"
                      className="block"
                      style={{ width: 240, height: 240 }}
                      onError={() => setQrPopover((p) => p ? { ...p, error: '二维码加载失败' } : p)}
                    />
                  ) : null}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
   移动端待办事项视图（1:1 复刻截图 IMG_7445）
   ========================================================================== */

const TAB_STATUS = {
  deposit: 'deposit_paid', // 已付定金 Tab → 列表按 payment_status='deposit' 过滤
  waitingShoot: 'deposit',
  unDelivered: 'shot',
  selecting: 'selecting',
  retouching: 'retouching'
};
const STATUS_TAB = Object.fromEntries(Object.entries(TAB_STATUS).map(([k, v]) => [v, k]));

const TODO_TABS = [
  { key: 'deposit', label: '已付定金', color: '#FF8A8A', lineColor: '#FF8A8A' },
  { key: 'waitingShoot', label: '等待拍摄', color: '#7ECDBB', lineColor: '#7ECDBB' },
  { key: 'unDelivered', label: '未交片', color: '#F5A623', lineColor: '#F5A623' },
  { key: 'selecting', label: '待选片', color: '#2DB7F5', lineColor: '#2DB7F5' },
  { key: 'retouching', label: '待精修', color: '#F5A623', lineColor: '#F5A623' }
];

const WEEK_DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function pad2(n) { return String(n).padStart(2, '0'); }

function MobileTodoView({ stats, list, listTotal, state, setState, refreshOrderList, onNavToOrder, onLoadMore }) {
  const [lunarMap, setLunarMap] = useState({});

  useEffect(() => {
    const now = new Date();
    const month = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
    http.get('/api/schedules/lunar?month=' + encodeURIComponent(month))
      .then((r) => setLunarMap(r.data || {}))
      .catch(() => {});
  }, []);

  const activeKey = STATUS_TAB[state.status] || 'deposit';

  const onTabChange = (key) => {
    const status = TAB_STATUS[key];
    if (status && status !== state.status) {
      setState((s) => ({ ...s, status }));
    }
  };

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
  const lunarToday = lunarMap[todayStr] || '';

  return (
    <div style={{ minHeight: '100vh', background: '#F8F8F8' }}>
      {/* 深色日期条（顶部导航由 MobileShell TopBack 统一承载：返回 + 标题“待办事项”） */}
      <div style={{
        background: '#4A4A4A',
        padding: '16px 20px',
        display: 'flex',
        alignItems: 'center',
        color: '#fff'
      }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 14, flexShrink: 0 }}>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 44 }}>
            <span style={{ fontSize: 38, fontWeight: 500, lineHeight: 1 }}>{today.getDate()}</span>
            <span style={{ fontSize: 11, textTransform: 'uppercase', opacity: 0.8, letterSpacing: 0.5 }}>
              {today.toLocaleDateString('en-US', { month: 'long' })}
            </span>
          </div>
          <div style={{ width: 1, height: 42, background: 'rgba(255,255,255,0.22)' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {lunarToday && <span style={{ fontSize: 13 }}>农历{lunarToday}</span>}
            <span style={{ fontSize: 13, opacity: 0.85 }}>{WEEK_DAYS[today.getDay()]}</span>
          </div>
        </div>
      </div>

      {/* 横向状态 Tab */}
      <div style={{
        background: '#fff',
        display: 'flex',
        overflowX: 'auto',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        borderBottom: '1px solid #EFEFEF'
      }}>
        {TODO_TABS.map((t) => {
          const count = stats?.todo?.[t.key] ?? 0;
          const active = activeKey === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onTabChange(t.key)}
              style={{
                flex: '0 0 auto',
                minWidth: 82,
                padding: '12px 14px 10px',
                background: 'none',
                border: 'none',
                textAlign: 'center',
                position: 'relative',
                WebkitTapHighlightColor: 'transparent'
              }}
            >
              {active && (
                <div style={{
                  position: 'absolute',
                  inset: '8px 5px',
                  background: t.color,
                  borderRadius: 8,
                  zIndex: 0
                }} />
              )}
              <div style={{
                fontSize: 22,
                fontWeight: 600,
                color: active ? '#fff' : '#1f2329',
                lineHeight: 1,
                position: 'relative',
                zIndex: 1
              }}>{count}</div>
              <div style={{
                fontSize: 12,
                color: active ? '#fff' : '#999999',
                marginTop: 6,
                position: 'relative',
                zIndex: 1
              }}>{t.label}</div>
              {!active && (
                <div style={{
                  position: 'absolute',
                  bottom: 0,
                  left: '18%',
                  right: '18%',
                  height: 2,
                  background: t.lineColor,
                  borderRadius: 1,
                  zIndex: 1
                }} />
              )}
            </button>
          );
        })}
      </div>

      {/* 订单列表 */}
      <div style={{ padding: 12 }}>
        {list.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#BBBBBB', fontSize: 14, padding: '100px 0' }}>暂无数据</div>
        ) : (
          <>
            {list.map((o) => (
              <TodoOrderCard key={o.id} order={o} onClick={() => onNavToOrder(o.id)} />
            ))}
            {list.length < listTotal && (
              <button
                type="button"
                onClick={onLoadMore}
                style={{
                  width: '100%',
                  padding: '12px 0',
                  background: '#fff',
                  border: 'none',
                  borderRadius: 10,
                  marginTop: 10,
                  color: '#666666',
                  fontSize: 13
                }}
              >加载更多（{list.length}/{listTotal}）</button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TodoOrderCard({ order, onClick }) {
  const snap = asObj(order.package_snapshot);
  const pkgName = [snap.name, snap.spec && snap.spec.name].filter(Boolean).join('｜') || '未选套系';
  const amount = Number(order.total_amount || 0);
  const execs = asArr(order.executors);
  const execNames = execs.map((e) => e.name).filter(Boolean).join('、') || '未分配';
  const statusLabel = {
    unpaid: '未付定金',
    deposit: '等待拍摄',
    shot: '未交片',
    selecting: '待选片',
    retouching: '待精修'
  }[order.status] || (stageLabel(order));

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%',
        background: '#fff',
        borderRadius: 12,
        padding: '14px 16px',
        marginBottom: 10,
        border: 'none',
        textAlign: 'left',
        display: 'block'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 15, color: '#1f2329', fontWeight: 500 }}>{order.order_name || '未命名订单'}</div>
          <div style={{ fontSize: 12, color: '#999999', marginTop: 4 }}>{pkgName}</div>
        </div>
        <div style={{ fontSize: 15, color: '#FF4D4F', fontWeight: 500, marginLeft: 8, whiteSpace: 'nowrap' }}>
          ¥{amount.toLocaleString()}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#999999' }}>
          <span>{order.customer_name || '—'}</span>
          <span style={{ color: '#2DB7F5' }}>{statusLabel}</span>
        </div>
        <div style={{ fontSize: 12, color: '#999999' }}>
          {Number(order.date_tbd) === 1 ? '日期待定' : (order.shoot_date || '未排期')}
        </div>
      </div>
      {execNames && (
        <div style={{ fontSize: 11, color: '#BBBBBB', marginTop: 8 }}>执行人：{execNames}</div>
      )}
    </button>
  );
}
