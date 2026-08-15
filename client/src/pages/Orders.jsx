import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import http, { img } from '../api.js';
import { useViewState } from '../tabMemory.js';
import { avatarColor, avatarText } from '../utils/avatar.js';
import OrderCreateModal from '../components/OrderCreateModal.jsx';

/* ==========================================================================
   订单中心（列表页）
   —— 本页仅承载「列表 + 筛选 + 新建」，订单详情走独立路由 /orders/:id。
   —— 视觉规范（严格按设计稿取色，禁止改动）：
        深色筛选栏 #2c2c2c ／ 预警条底 #fff3e0 ／ 金额与预警红字 #ff3333 ／ 移动端深色导航 #1f1f1f
        未结算尾款标签 #e2d2c2 ／「设置>」链接 #ff8822 ／ 页面底色 #ffffff
   —— 注意：全局 index.css 把 .text-white 覆写成了深灰（浅色主题迁移），
        因此深色区域的白字一律用内联 style={{color:'#fff'}}，不要用 text-white。
   —— 所有统计数字（订单总数 / 到期 / 选片超时）均由后端接口返回，禁止硬编码。
   移动端顶部深色 #1f1f1f / 未结算尾款 #ff3333 红底白字 / 卡片圆角 12 / 卡片间距 12。
   ========================================================================== */

const STATUS_LABEL = {
  deposit: '已付定金', shot: '已拍摄', selecting: '选片中',
  retouching: '精修中', delivered: '已交付', completed: '已完成', cancelled: '已关闭'
};

// 待办 Tab key → 筛选 status 值（与 Todo.jsx TAB_DEFS 的 key/value 一致）
// 供 /orders?tab=xxx 兼容跳转使用（消除 TAB_STATUS 未定义引用隐患）
const TAB_STATUS = {
  deposit: 'deposit_pending',
  waiting: 'waiting_shoot',
  selecting: 'todo_selecting',
  retouching: 'todo_retouch',
  delivered: 'todo_deliver',
};

// deposit 状态细分：logs 含「沟通确认」=「等待拍摄」，否则 =「已付定金」
// retouching 状态细分：logs 含「精修完成/全部精修完成/底片打包/原片打包」=「待交付」，否则 =「精修中」
// 两段细分都与后端 stats/orders 的 waiting_shoot / todo_retouch / todo_deliver 过滤分界一致
function stageLabel(o) {
  if (!o) return '历史订单';
  const s = o.status;
  if (s === 'deposit' || s === 'retouching') {
    let logsArr = [];
    try { logsArr = Array.isArray(o.logs) ? o.logs : (typeof o.logs === 'string' ? JSON.parse(o.logs || '[]') : []); } catch {}
    if (s === 'deposit') {
      const hasConfirm = logsArr.some((l) => (l && l.text || '').includes('沟通确认'));
      return hasConfirm ? '等待拍摄' : '已付定金';
    }
    // retouching + logs 已到「精修完成/底片打包」→ 归「待交付」（与后端 stats 口径一致）
    const hasFinish = logsArr.some((l) => (l && l.text || '').match(/精修完成|全部精修完成|底片打包|原片打包/));
    return hasFinish ? '待交付' : '精修中';
  }
  return STATUS_LABEL[s] || '历史订单';
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
  const [state, setState] = useViewState('orders', {
    statuses: [],
    q: '',
    executorIds: [],
    sort: 'recent',
    types: [],
    shootFrom: '',
    shootTo: '',
    orderFrom: '',
    orderTo: ''
  });

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
      if (state.statuses && state.statuses.length) p.set('statuses', state.statuses.join(','));
      if (state.q) p.set('q', state.q);
      if (state.executorIds && state.executorIds.length) p.set('executorIds', state.executorIds.join(','));
      if (state.sort && state.sort !== 'recent') p.set('sort', state.sort);
      if (state.types && state.types.length && !state.types.includes('all')) p.set('types', state.types.join(','));
      if (state.shootFrom) p.set('shootFrom', state.shootFrom);
      if (state.shootTo) p.set('shootTo', state.shootTo);
      if (state.orderFrom) p.set('orderFrom', state.orderFrom);
      if (state.orderTo) p.set('orderTo', state.orderTo);
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
    if (state.statuses && state.statuses.length) p.set('statuses', state.statuses.join(','));
    if (state.q) p.set('q', state.q);
    if (state.executorIds && state.executorIds.length) p.set('executorIds', state.executorIds.join(','));
    if (state.shootFrom) p.set('shootFrom', state.shootFrom);
    if (state.shootTo) p.set('shootTo', state.shootTo);
    if (state.orderFrom) p.set('orderFrom', state.orderFrom);
    if (state.orderTo) p.set('orderTo', state.orderTo);
    const qs = p.toString();
    window.open(base + '/api/orders/export' + (qs ? '?' + qs : ''), '_blank');
  };

  /* ------------------------------ 渲染 ------------------------------ */
  // 移动端：1:1 复刻「订单中心」截图（顶部导航 + 三筛 + 卡片列表 + 悬浮新建）
  if (isMobile) {
    return (
      <MobileOrderCenterView
        stats={stats}
        list={list}
        listTotal={listTotal}
        state={state}
        setState={setState}
        refreshOrderList={refreshOrderList}
        onNavToOrder={(id) => nav('/orders/' + id)}
        onLoadMore={() => refreshOrderList({ reset: false })}
        pkgs={pkgs}
        personnel={personnel}
        trash={trash}
        setTrash={setTrash}
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
          style={{ background: '#2DB7F5', color: '#fff', fontSize: 14 }}>+ 新建订单</button>

        <div className="hidden sm:block flex-1" />

        <span className="text-xs whitespace-nowrap" style={{ color: '#fff' }}>状态</span>
        <select value={trash ? '__trash' : (state.statuses?.[0] || '')}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '__trash') { setTrash(true); setFilter('statuses', []); return; }
            setTrash(false); setFilter('statuses', v ? [v] : []);
          }}
          className="px-3 py-1.5 rounded text-sm outline-none border-0"
          style={{ background: '#fff', color: '#333' }}>
          <option value="">所有订单 ({stats.total})</option>
          <option value="unpaid">未付定金</option>
          <option value="deposit_pending">已付定金</option>
          <option value="waiting_shoot">等待拍摄</option>
          <option value="todo_selecting">待选片</option>
          <option value="todo_retouch">精修中</option>
          <option value="todo_deliver">待交付</option>
          <option value="delivered">已交付</option>
          <option value="completed">已完成</option>
          <option value="cancelled">已关闭</option>
          <option value="__trash">回收站</option>
        </select>

        <span className="text-xs whitespace-nowrap" style={{ color: '#fff' }}>执行者</span>
        <select value={state.executorIds?.[0] || ''} onChange={(e) => setFilter('executorIds', e.target.value ? [Number(e.target.value)] : [])}
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
                        <span className="text-fg text-sm truncate">订单：{o.customer_name || o.order_name || '未命名订单'}</span>
                        {o.channel && (
                          <span className="shrink-0 inline-flex items-center justify-center text-white text-[11px] font-medium"
                            style={{ width: 20, height: 20, borderRadius: 4, background: channelColor(o.channel) }}>
                            {o.channel.slice(0, 1)}
                          </span>
                        )}
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
                        <span className="px-2 py-0.5 rounded-lg text-[11px] text-white"
                          style={{ background: '#7ECDBB' }}>未结算尾款</span>
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
                  <span className="text-fg block truncate">
                    订单：{o.customer_name || o.order_name || '未命名订单'}
                    {o.channel && (
                      <span className="shrink-0 inline-flex items-center justify-center text-white text-[11px] font-medium"
                        style={{ width: 20, height: 20, borderRadius: 4, background: channelColor(o.channel), marginLeft: 6, verticalAlign: 'middle' }}>
                        {o.channel.slice(0, 1)}
                      </span>
                    )}
                  </span>
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
   移动端订单中心（1:1 复刻截图 IMG_7497）
   ========================================================================== */

const ORDER_STATUS_OPTIONS = [
  { value: '', label: '全部订单' },
  { value: 'unpaid', label: '未付定金' },
  { value: 'deposit_pending', label: '已付定金' },
  { value: 'waiting_shoot', label: '等待拍摄' },
  { value: 'todo_selecting', label: '待选片' },
  { value: 'todo_retouch', label: '精修中' },
  { value: 'todo_deliver', label: '待交付' },
  { value: 'delivered', label: '已交付' },
  { value: 'completed', label: '已完成' },
  { value: 'cancelled', label: '已关闭' },
  { value: '__trash', label: '回收站' }
];

const SORT_OPTIONS = [
  { value: 'order_time', label: '下单时间' },
  { value: 'shoot_date', label: '拍摄时间' },
  { value: 'recent', label: '最近操作' }
];

// 筛选抽屉 pill 选项（对齐业务 6 节点流程 + 特殊状态，与待办 Tab / 进度条口径一致）
// 状态流程：未付定金 → 已付定金 → 等待拍摄 → 待选片 → 精修中 → 待交付 → 已交付 → 已完成
// 末位：已关闭 / 未结算尾款(财务维度) / 回收站
const STATUS_PILLS = [
  { value: 'all', label: '所有订单' },
  { value: 'unpaid_deposit', label: '未付定金' },
  { value: 'deposit_pending', label: '已付定金' },
  { value: 'waiting_shoot', label: '等待拍摄' },
  { value: 'todo_selecting', label: '待选片' },
  { value: 'todo_retouch', label: '精修中' },
  { value: 'todo_deliver', label: '待交付' },
  { value: 'delivered', label: '已交付' },
  { value: 'completed', label: '已完成' },
  { value: 'cancelled', label: '已关闭' },
  { value: 'has_balance', label: '未结算尾款' },
  { value: '__trash', label: '回收站' }
];

// 订单类型：婚礼/人像摄影工作室不区分「普通/促销/拼团」，只保留全部订单
const TYPE_PILLS = [
  { value: 'all', label: '全部订单' }
];

const AVATAR_BG = ['#7ECDBB', '#F5A623', '#2DB7F5', '#FF8A8A', '#9B7ED8', '#5A5A5A'];
// avatarColor / avatarText 已抽到 utils/avatar.js（订单中心 + 待办 Tab 共用，避免同客户名算出不同颜色）

/* 渠道来源徽标：已知渠道用品牌色（校 IMG_7522 渠道卡），未知渠道 hash 取色 */
const CHANNEL_COLORS = {
  '抖音': '#161823',         // 抖音品牌深色（与音乐图标同色）
  '小红书': '#FF2442',       // 小红书红
  '美团': '#FFB300',         // 美团黄
  '小程序': '#07C160',       // 微信绿
  '客户推荐': '#52C8B6',     // 心形图标青绿（与小程序区分）
  '自然进店': '#5BC0DE',     // 气泡图标天蓝
  '其他来源': '#7B85F4',     // 网格图标蓝紫
};
const CHANNEL_FALLBACK = ['#FE2C55', '#FF2442', '#FFB300', '#07C160', '#2DB7F5', '#7ECDBB', '#9B7ED8', '#5A5A5A'];
function channelColor(name) {
  if (!name) return '#8C8C8C';
  if (CHANNEL_COLORS[name]) return CHANNEL_COLORS[name];
  let h = 0;
  for (let i = 0; i < String(name).length; i++) h += String(name).charCodeAt(i);
  return CHANNEL_FALLBACK[h % CHANNEL_FALLBACK.length];
}

const IconBack = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
);
const IconSearch = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
);
const IconSetting = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
);
const IconQr = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
);
const IconClose = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#999" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
);

function MobileOrderCenterView({ stats, list, listTotal, state, setState, refreshOrderList, onNavToOrder, onLoadMore, personnel, trash, setTrash, pkgs }) {
  const nav = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const [qInput, setQInput] = useState(state.q || '');
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterAnim, setFilterAnim] = useState(false);
  const openFilter = () => { setFilterOpen(true); requestAnimationFrame(() => setFilterAnim(true)); };
  const closeFilter = () => { setFilterAnim(false); setTimeout(() => setFilterOpen(false), 300); };
  // 商家管理头像（settings.studio.logo），传给 OrderCard 显示在日期行
  const [studioLogo, setStudioLogo] = useState('');
  useEffect(() => { http.get('/api/settings/studio').then((r) => setStudioLogo(r.data?.logo || '')).catch(() => {}); }, []);
  // 抽屉内分区的展开/折叠（默认全部展开，对齐参考图 7504）
  const [filterSections, setFilterSections] = useState({
    sort: true, executor: true, status: true, type: true, shootDate: true, orderDate: true
  });
  const toggleFilterSection = (k) => setFilterSections((p) => ({ ...p, [k]: !p[k] }));
  // 抽屉临时状态（重置/完成期间不直接污染 viewState，点完成才落地）
  const [filterDraft, setFilterDraft] = useState(null);
  useEffect(() => {
    if (filterOpen && !filterDraft) setFilterDraft({
      sort: state.sort,
      executorIds: state.executorIds || [],
      statuses: state.statuses || [],
      types: state.types || [],
      shootFrom: state.shootFrom || '',
      shootTo: state.shootTo || '',
      orderFrom: state.orderFrom || '',
      orderTo: state.orderTo || ''
    });
    if (!filterOpen) setFilterDraft(null);
  }, [filterOpen]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetType, setSheetType] = useState(''); // 'status' | 'sort'
  const [qrPopover, setQrPopover] = useState(null);
  // 新建订单入口已统一为跳转 /orders/new → OrdersNew 全屏页（移动端 FAB + 主页「+」都用同一路由）

  const doSearch = () => { setState((s) => ({ ...s, q: qInput })); setSearchOpen(false); };
  const setFilter = (k, v) => setState((s) => ({ ...s, [k]: v }));

  const openSheet = (type) => { setSheetType(type); setSheetOpen(true); };
  const selectStatus = (v) => {
    if (v === '__trash') { setTrash(true); setState((s) => ({ ...s, statuses: [] })); }
    else { setTrash(false); setState((s) => ({ ...s, statuses: v ? [v] : [] })); }
    setSheetOpen(false);
  };
  const selectSort = (v) => { setFilter('sort', v); setSheetOpen(false); };

  const openQrPopover = async (o, e) => {
    e.stopPropagation();
    const btn = e.currentTarget;
    const rect = btn.getBoundingClientRect();
    setQrPopover({ orderId: o.id, qrUrl: '', loading: true, error: '', rect });
    try {
      const r = await http.post('/api/orders/' + o.id + '/mini-qr');
      setQrPopover((prev) => (prev && prev.orderId === o.id ? { ...prev, loading: false, qrUrl: r.data.qr_url, error: '' } : prev));
    } catch (err) {
      setQrPopover((prev) => (prev && prev.orderId === o.id ? { ...prev, loading: false, qrUrl: '', error: err.response?.data?.error || '二维码生成失败' } : prev));
    }
  };
  const closeQrPopover = () => setQrPopover(null);

  const activeStatusLabel = ORDER_STATUS_OPTIONS.find((x) => x.value === (trash ? '__trash' : (state.statuses?.[0] || '')))?.label || '全部订单';
  const activeSortLabel = SORT_OPTIONS.find((x) => x.value === state.sort)?.label || '最近操作';

  return (
    <div style={{ minHeight: '100vh', background: '#F8F8F8', paddingBottom: 'calc(24px + env(safe-area-inset-bottom))' }}>
      {/* 顶部导航：深色 #1f1f1f 背景 + 白色图标文字（对齐 IMG_7521） */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50,
        height: 48, background: '#1f1f1f',
        display: 'flex', alignItems: 'center', padding: '0 12px'
      }}>
        <button onClick={() => nav('/')} style={{ background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center' }}><IconBack /></button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 16, color: '#fff' }}>订单中心</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setSearchOpen(true)} style={{ background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center' }}><IconSearch /></button>
          <button onClick={openFilter} style={{ background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center' }}><IconSetting /></button>
        </div>
      </div>

      {/* 搜索栏 */}
      {searchOpen && (
        <div style={{ background: '#fff', padding: '8px 12px', borderBottom: '1px solid #EFEFEF', display: 'flex', gap: 8 }}>
          <input
            autoFocus
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doSearch()}
            placeholder="姓名、套系名称、备注..."
            style={{ flex: 1, border: 'none', background: '#F5F5F5', borderRadius: 18, padding: '8px 14px', fontSize: 14, outline: 'none' }}
          />
          <button onClick={() => { setSearchOpen(false); }} style={{ background: 'none', border: 'none', fontSize: 14, color: '#666' }}>取消</button>
        </div>
      )}

      {/* 筛选栏 */}
      <div style={{
        background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-around',
        padding: '10px 0', borderBottom: '1px solid #EFEFEF'
      }}>
        <button onClick={() => openSheet('status')} style={{ background: 'none', border: 'none', fontSize: 14, color: '#333', display: 'flex', alignItems: 'center', gap: 4 }}>
          {activeStatusLabel}<span style={{ fontSize: 10, color: '#333' }}>▼</span>
        </button>
        <button onClick={() => openSheet('sort')} style={{ background: 'none', border: 'none', fontSize: 14, color: '#333', display: 'flex', alignItems: 'center', gap: 4 }}>
          {activeSortLabel}<span style={{ fontSize: 10, color: '#333' }}>▼</span>
        </button>
        <button onClick={openFilter} style={{ background: 'none', border: 'none', fontSize: 14, color: '#333', display: 'flex', alignItems: 'center', gap: 4 }}>
          筛选<span style={{ fontSize: 10, color: '#333' }}>▼</span>
        </button>
      </div>

      {/* 订单列表 */}
      <div style={{ padding: '12px 16px' }}>
        {list.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#BBBBBB', fontSize: 14, padding: '100px 0' }}>暂无数据</div>
        ) : (
          <>
            {list.map((o) => (
              <OrderCard key={o.id} order={o} studioLogo={studioLogo} onClick={() => onNavToOrder(o.id)} />
            ))}
            {list.length < listTotal && (
              <button type="button" onClick={onLoadMore} style={{
                width: '100%', padding: '12px 0', background: '#fff', border: 'none', borderRadius: 10,
                marginTop: 10, color: '#666666', fontSize: 13
              }}>加载更多（{list.length}/{listTotal}）</button>
            )}
          </>
        )}
      </div>

      {/* + 新建订单（青绿 FAB，跳 OrdersNew 全屏页） */}
      <button type="button" onClick={() => nav('/orders/new')} style={{
        position: 'fixed', right: 16,
        bottom: 'calc(24px + env(safe-area-inset-bottom))',
        zIndex: 40,
        height: 44, padding: '0 20px', borderRadius: 22,
        background: '#7ECDBB', color: '#fff', border: 'none',
        fontSize: 15, display: 'flex', alignItems: 'center', gap: 6,
        boxShadow: '0 6px 18px rgba(126,205,187,0.35)'
      }}>
        <span style={{ fontSize: 18 }}>+</span>新建订单
      </button>

      {/* 移动端 OrderCreateModal 已移除：FAB 跳转 /orders/new → OrdersNew 全屏页（统一体验） */}

      {/* 底部弹窗：状态 / 排序 */}
      {sheetOpen && (
        <div className="fixed inset-0 z-[60]" style={{ background: 'rgba(0,0,0,0.35)' }} onClick={() => setSheetOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            background: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16,
            padding: '16px 0 calc(20px + env(safe-area-inset-bottom))'
          }}>
            <div style={{ textAlign: 'center', fontSize: 15, color: '#999', marginBottom: 8 }}>{sheetType === 'status' ? '订单状态' : '排序方式'}</div>
            {(sheetType === 'status' ? ORDER_STATUS_OPTIONS : SORT_OPTIONS).map((opt) => {
              const active = sheetType === 'status' ? (trash ? '__trash' : (state.statuses?.[0] || '')) === opt.value : state.sort === opt.value;
              return (
                <button key={opt.value} onClick={() => sheetType === 'status' ? selectStatus(opt.value) : selectSort(opt.value)} style={{
                  width: '100%', padding: '14px 20px', border: 'none', background: 'none',
                  textAlign: 'left', fontSize: 15, color: active ? '#FA5151' : '#333', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                }}>
                  {opt.label}
                  {active && <span style={{ color: '#FA5151' }}>✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 筛选抽屉：右滑动画 + 6 个可折叠分区（订单排序/执行人/订单状态/订单类型/拍摄日期/下单时间） */}
      {filterOpen && filterDraft && (() => {
        const PINK = '#7ECDBB';           // 统一为品牌主色青绿（订单中心强调/选中态不再用红色 #FA5151）
        const PINK_BG = '#EAF7F4';     // 浅青绿背景，与品牌色匹配
        const toggleArr = (k, v) => setFilterDraft((d) => {
          const arr = d[k] || [];
          return { ...d, [k]: arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v] };
        });
        const resetDraft = () => {
          const empty = { sort: 'recent', executorIds: [], statuses: [], types: [], shootFrom: '', shootTo: '', orderFrom: '', orderTo: '' };
          setFilterDraft(empty);
          // 「重置」立即生效：同时清空列表过滤（否则只清草稿、列表不刷新，用户以为没清除）
          setState((s) => ({ ...s, ...empty }));
        };
        const applyDraft = () => {
          setState((s) => ({
            ...s,
            sort: filterDraft.sort,
            executorIds: filterDraft.executorIds,
            statuses: filterDraft.statuses,
            types: filterDraft.types,
            shootFrom: filterDraft.shootFrom,
            shootTo: filterDraft.shootTo,
            orderFrom: filterDraft.orderFrom,
            orderTo: filterDraft.orderTo
          }));
          closeFilter();
        };
        const Section = ({ k, title, children }) => (
          <div style={{ background: '#fff', borderBottom: '1px solid #F5F5F5' }}>
            <button onClick={() => toggleFilterSection(k)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: 'none', border: 'none', color: '#1f2329' }}>
              <span style={{ fontSize: 15, fontWeight: 500 }}>{title}</span>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#999" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: filterSections[k] ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform .2s' }}>
                <path d="m6 15 6-6 6 6" />
              </svg>
            </button>
            {filterSections[k] && <div style={{ padding: '4px 16px 16px' }}>{children}</div>}
          </div>
        );
        const Pill = ({ active, onClick, children }) => (
          <button onClick={onClick}
            style={{
              padding: '8px 14px', borderRadius: 20, fontSize: 13,
              border: `1px solid ${active ? PINK : '#E8E8E8'}`,
              background: active ? PINK_BG : '#F7F7F7',
              color: active ? PINK : '#666', cursor: 'pointer', whiteSpace: 'nowrap'
            }}>{children}</button>
        );
        return (
          <div className="fixed inset-0 z-[60]" style={{ background: 'rgba(0,0,0,0.35)' }} onClick={closeFilter}>
            <div onClick={(e) => e.stopPropagation()} style={{
              position: 'absolute', top: 0, right: 0, bottom: 0, width: 320, maxWidth: '90vw',
              background: '#F7F7F7', display: 'flex', flexDirection: 'column',
              transform: filterAnim ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 300ms ease',
              boxShadow: '-4px 0 20px rgba(0,0,0,0.12)'
            }}>
              {/* 顶部：返回箭头 */}
              <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', background: '#fff', flexShrink: 0, borderBottom: '1px solid #F5F5F5' }}>
                <button onClick={closeFilter} style={{ background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center' }}>
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#1f2329" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>
              </div>

              {/* 可滚动内容区 */}
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {/* 订单排序 */}
                <Section k="sort" title="订单排序">
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {SORT_OPTIONS.map((o) => (
                      <Pill key={o.value} active={filterDraft.sort === o.value} onClick={() => setFilterDraft((d) => ({ ...d, sort: o.value }))}>
                        {o.label}
                      </Pill>
                    ))}
                  </div>
                </Section>

                {/* 执行人 */}
                <Section k="executor" title="执行人">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontSize: 12, color: '#999' }}>共 {personnel.length} 位</span>
                    <button onClick={() => setFilterDraft((d) => ({ ...d, executorIds: d.executorIds.length === personnel.length ? [] : personnel.map((p) => p.id) }))}
                      style={{ padding: '4px 12px', borderRadius: 14, border: '1px solid #E8E8E8', background: '#fff', color: '#666', fontSize: 12 }}>
                      {filterDraft.executorIds.length === personnel.length ? '取消全选' : '全选'}
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {personnel.length === 0 && <div style={{ fontSize: 13, color: '#999' }}>暂无人员</div>}
                    {personnel.map((p) => {
                      const on = filterDraft.executorIds.includes(p.id);
                      return (
                        <button key={p.id} onClick={() => toggleArr('executorIds', p.id)}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', padding: 0, textAlign: 'left' }}>
                          {p.avatar
                            ? <img src={p.avatar} className="rounded-full" style={{ width: 32, height: 32, objectFit: 'cover' }} alt="" />
                            : <span style={{ width: 32, height: 32, borderRadius: '50%', background: '#333', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>{(p.name || '?').slice(0, 1)}</span>}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, color: '#1f2329' }}>{p.name}</div>
                            {p.role ? <div style={{ fontSize: 11, color: '#999' }}>{p.role === 'admin' ? '主账号' : p.role === 'photographer' ? '摄影师' : p.role === 'finance' ? '财务' : p.role}</div> : null}
                          </div>
                          <span style={{
                            width: 20, height: 20, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            background: on ? PINK : 'transparent', border: `1.5px solid ${on ? PINK : '#D8D8D8'}`
                          }}>
                            {on && <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </Section>

                {/* 订单状态 */}
                <Section k="status" title="订单状态">
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {STATUS_PILLS.map((o) => {
                      const on = o.value === 'all' ? filterDraft.statuses.length === 0 : filterDraft.statuses.includes(o.value);
                      return (
                        <Pill key={o.value} active={on} onClick={() => {
                          if (o.value === 'all') setFilterDraft((d) => ({ ...d, statuses: [] }));
                          else toggleArr('statuses', o.value);
                        }}>
                          {o.label}
                        </Pill>
                      );
                    })}
                  </div>
                </Section>

                {/* 订单类型 */}
                <Section k="type" title="订单类型">
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {TYPE_PILLS.map((o) => {
                      const on = o.value === 'all' ? filterDraft.types.length === 0 : filterDraft.types.includes(o.value);
                      return (
                        <Pill key={o.value} active={on} onClick={() => {
                          if (o.value === 'all') setFilterDraft((d) => ({ ...d, types: [] }));
                          else toggleArr('types', o.value);
                        }}>
                          {o.label}
                        </Pill>
                      );
                    })}
                  </div>
                </Section>

                {/* 拍摄日期 */}
                <Section k="shootDate" title="拍摄日期">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <input type="date" value={filterDraft.shootFrom} onChange={(e) => setFilterDraft((d) => ({ ...d, shootFrom: e.target.value }))}
                      style={{ flex: 1, height: 36, padding: '0 10px', borderRadius: 18, border: '1px solid #E8E8E8', background: '#F7F7F7', fontSize: 13, color: filterDraft.shootFrom ? '#333' : '#999', outline: 'none' }} />
                    <span style={{ color: '#999' }}>—</span>
                    <input type="date" value={filterDraft.shootTo} onChange={(e) => setFilterDraft((d) => ({ ...d, shootTo: e.target.value }))}
                      style={{ flex: 1, height: 36, padding: '0 10px', borderRadius: 18, border: '1px solid #E8E8E8', background: '#F7F7F7', fontSize: 13, color: filterDraft.shootTo ? '#333' : '#999', outline: 'none' }} />
                  </div>
                </Section>

                {/* 下单时间 */}
                <Section k="orderDate" title="下单时间">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <input type="date" value={filterDraft.orderFrom} onChange={(e) => setFilterDraft((d) => ({ ...d, orderFrom: e.target.value }))}
                      style={{ flex: 1, height: 36, padding: '0 10px', borderRadius: 18, border: '1px solid #E8E8E8', background: '#F7F7F7', fontSize: 13, color: filterDraft.orderFrom ? '#333' : '#999', outline: 'none' }} />
                    <span style={{ color: '#999' }}>—</span>
                    <input type="date" value={filterDraft.orderTo} onChange={(e) => setFilterDraft((d) => ({ ...d, orderTo: e.target.value }))}
                      style={{ flex: 1, height: 36, padding: '0 10px', borderRadius: 18, border: '1px solid #E8E8E8', background: '#F7F7F7', fontSize: 13, color: filterDraft.orderTo ? '#333' : '#999', outline: 'none' }} />
                  </div>
                </Section>
              </div>

              {/* 底部：重置 / 完成 */}
              <div style={{ display: 'flex', flexShrink: 0, borderTop: '1px solid #F5F5F5', background: '#fff' }}>
                <button onClick={resetDraft}
                  style={{ flex: 1, padding: '16px 0 calc(16px + env(safe-area-inset-bottom))', background: '#fff', color: '#666', border: 'none', fontSize: 15, borderRight: '1px solid #F5F5F5' }}>
                  重置
                </button>
                <button onClick={applyDraft}
                  style={{ flex: 1.4, padding: '16px 0 calc(16px + env(safe-area-inset-bottom))', background: PINK, color: '#fff', border: 'none', fontSize: 15 }}>
                  完成
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 订单二维码悬浮弹窗 */}
      {qrPopover && (
        <div className="fixed inset-0 z-[70]" style={{ background: 'rgba(0,0,0,0.35)' }} onClick={closeQrPopover}>
          {(() => {
            const { rect } = qrPopover;
            const popW = 280;
            const left = Math.max(16, Math.min(window.innerWidth - popW - 16, rect.left + rect.width / 2 - popW / 2));
            const top = rect.top - 260 - 8;
            const adjustedTop = top < 16 ? rect.bottom + 8 : top;
            return (
              <div onClick={(e) => e.stopPropagation()} style={{
                position: 'absolute', left, top: adjustedTop, width: popW,
                background: '#fff', borderRadius: 12, padding: 16, boxShadow: '0 12px 40px rgba(0,0,0,0.16)'
              }}>
                <div style={{ fontSize: 14, color: '#1f2329', marginBottom: 12, textAlign: 'center' }}>订单二维码</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
                  {qrPopover.loading ? <span style={{ fontSize: 12, color: '#999' }}>二维码生成中…</span>
                    : qrPopover.error ? <span style={{ fontSize: 12, color: '#e53e3e', textAlign: 'center' }}>{qrPopover.error}</span>
                      : qrPopover.qrUrl ? <img src={qrPopover.qrUrl} alt="订单二维码" style={{ width: 220, height: 220 }} onError={() => setQrPopover((p) => p ? { ...p, error: '二维码加载失败' } : p)} /> : null}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function OrderCard({ order, studioLogo, onClick }) {
  const nav = useNavigate();
  const snap = asObj(order.package_snapshot);
  const pkgName = [snap.name, snap.spec && snap.spec.name].filter(Boolean).join('｜') || '未选套系';
  const pkgCategory = snap.category_name || order.category_name || String(snap.name || '').split('｜')[0] || '';
  const cover = snap.cover_url ? img(snap.cover_url) : '';
  const remain = Number(order.total_amount || 0) - Number(order.paid_amount || 0);
  const statusText = stageLabel(order);
  const customerName = order.customer_name || order.order_name || '未知';
  const orderName = order.customer_name || order.order_name || '未知';
  const avatarTextVal = avatarText(customerName);
  const bg = avatarColor(customerName);
  const chName = order.channel || '';
  const execs = asArr(order.executors);
  const execFirst = execs[0] || {};
  const execName = execFirst.name || order.executor || '';
  const execAvatar = execFirst.avatar ? img(execFirst.avatar) : '';

  let dateLabel = '拍摄日期';
  let dateValue = Number(order.date_tbd) === 1 ? '日期待定' : (order.shoot_date || '未排期');
  if (order.status === 'cancelled') {
    dateLabel = '订单关闭';
    dateValue = fmtDate(order.closed_at || order.updated_at || order.created_at);
  } else if (order.status === 'completed') {
    dateLabel = '完成日期';
    dateValue = fmtDate(order.completed_at || order.updated_at || order.created_at);
  }

  return (
    <button type="button" onClick={onClick} style={{
      width: '100%', background: '#fff', borderRadius: 12, marginBottom: 12,
      border: '1px solid #F0F0F0', textAlign: 'left', display: 'block', overflow: 'hidden'
    }}>
      {/* 头像 + 客户 + 状态（padding 14/8 对齐参考图） */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 14px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%', background: bg, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0
          }}>{avatarTextVal}</div>
          <div style={{ fontSize: 15, color: '#1f2329', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{orderName}</div>
          {chName && (
            <span style={{
              width: 20, height: 20, borderRadius: 4, background: channelColor(chName),
              color: '#fff', fontSize: 11, fontWeight: 500, flexShrink: 0,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center'
            }}>{chName.slice(0, 1)}</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <div style={{ fontSize: 13, color: '#999', whiteSpace: 'nowrap' }}>{statusText}</div>
        </div>
      </div>
      <div style={{ height: 1, background: '#F0F0F0' }} />

      {/* 套系名 + 分类 + 尾款标签（padding-bottom 20 加大套系与日期间空白；套系名细体对齐参考图） */}
      <div style={{ padding: '10px 14px 20px' }}>
        <div style={{ fontSize: 15, color: '#1f2329', lineHeight: 1.4, fontWeight: 400, marginBottom: 6 }}>{pkgName}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {pkgCategory ? <span style={{ fontSize: 12, color: '#999' }}>{pkgCategory}</span> : null}
          {remain > 0 && order.status !== 'completed' && order.status !== 'cancelled' && (
            <span style={{ fontSize: 9, color: '#fff', background: '#7ECDBB', padding: '0 5px', lineHeight: '14px', borderRadius: 3 }}>未结算尾款</span>
          )}
        </div>
      </div>

      {/* 日期 + 商家管理头像（独立在封面左侧，与日期同行）+ 封面（顶部与套系名同行） */}
      <div style={{ position: 'relative', padding: '0 14px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#999', paddingBottom: 6 }}>
          <IconCalendar style={{ width: 14, height: 14, color: '#bbb' }} />
          <span>{dateLabel}：{dateValue}</span>
        </div>
        {/* 商家管理头像：与日期同行，绝对定位在封面左侧（封面 right:14+width:90+gap:16=120） */}
        {studioLogo ? (
          <img src={img(studioLogo)} alt="商家管理" title="商家管理"
            style={{ position: 'absolute', right: 120, bottom: 14, width: 30, height: 30,
              borderRadius: '50%', border: '2px solid #fff', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div title="商家管理"
            style={{ position: 'absolute', right: 120, bottom: 14, width: 30, height: 30, borderRadius: '50%', background: '#2998EB', color: '#fff',
              border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 500 }}>叶</div>
        )}
        {/* 封面：90×90 正方形，绝对定位 right:14 bottom:12 顶端上移到套系名同一行 */}
        {cover ? (
          <div style={{ position: 'absolute', right: 14, bottom: 12, width: 90, height: 90 }}>
            <img src={cover} alt="" style={{ width: '100%', height: '100%', borderRadius: 6, objectFit: 'cover', display: 'block' }} />
          </div>
        ) : (
          <div style={{ position: 'absolute', right: 14, bottom: 12, width: 90, height: 90, borderRadius: 6, background: '#F5F5F5' }} />
        )}
      </div>
      <div style={{ height: 1, background: '#F0F0F0' }} />

      {/* 备注 + 编辑入口（点击编辑跳 /orders/:id/notes） */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '6px 14px 10px' }}>
        <span
          onClick={(e) => { e.stopPropagation(); nav('/orders/' + order.id + '/notes'); }}
          style={{ fontSize: 12, color: '#2f7cf6', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}
          aria-label="编辑备注"
          role="button"
          tabIndex={0}
        >
          <IconPencil style={{ width: 12, height: 12 }} />
          <span>编辑</span>
        </span>
        {order.remark ? (
          <span style={{ marginLeft: 6, flex: 1, fontSize: 12, color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {order.remark}
          </span>
        ) : null}
      </div>
    </button>
  );
}
