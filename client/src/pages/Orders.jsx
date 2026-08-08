import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import http, { img } from '../api.js';
import { useViewState } from '../tabMemory.js';
import OrderCreateModal from '../components/OrderCreateModal.jsx';
import bgm from '../bgm.js';
import Slideshow from '../components/Slideshow.jsx';

const STATUS_LABEL = {
  deposit: '已付定金', shot: '已拍摄', selecting: '选片中',
  retouching: '精修中', delivered: '已交付', completed: '已完成', cancelled: '已作废'
};
const STAGE_SEQ = ['deposit', 'shot', 'selecting', 'retouching', 'delivered', 'completed'];
const STAGE_COLOR = {
  deposit: 'bg-amber-500', shot: 'bg-sky-500', selecting: 'bg-indigo-500',
  retouching: 'bg-purple-500', delivered: 'bg-teal-500', completed: 'bg-emerald-500', cancelled: 'bg-line'
};
const TYPE_LABEL = { deposit: '定金', balance: '尾款', extra: '加片/增值', refund: '退款' };
// 新增订单弹窗的「收款状态」枚举（unpaid/deposit/paid）
const PAY_STATUS_LABEL = { unpaid: '未付定金', deposit: '已付定金', paid: '已付全款' };
const PAY_STATUS_COLOR = { unpaid: 'text-red-400', deposit: 'text-amber-400', paid: 'text-emerald-400' };
// JSON 列容错解析：后端已 JSON.parse，但旧数据/异常情况下可能仍是字符串
// 首阶段 status 恒为 deposit（订单已建立），但收款状态可能是「未付定金」，
// 直接显示「已付定金」会误导，这里按 payment_status 做展示层修正（不改后端阶段机）。
function stageLabel(o) {
  if (o && o.status === 'deposit' && o.payment_status === 'unpaid') return '未付定金';
  return STATUS_LABEL[o && o.status] || '历史订单';
}
function asArr(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

export default function Orders() {
  const [params, setParams] = useSearchParams();
  const [state, setState] = useViewState('orders', { status: '', q: '', executor: '', sort: 'recent', shootFrom: '', shootTo: '' });
  const [list, setList] = useState([]);
  const [listTotal, setListTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(12);
  const pageRef = useRef(1);
  const [pkgs, setPkgs] = useState([]);
  const [personnel, setPersonnel] = useState([]);
  const [stats, setStats] = useState({ expiringSoon: 0, selectionTimeout: 0 });
  const [detail, setDetail] = useState(null);
  const [sel, setSel] = useState(null); // 选片结果 {selection, photos}
  const [selSaving, setSelSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [initialPkg, setInitialPkg] = useState(null);
  const [pay, setPay] = useState(null); // {type, amount, method, note}
  const [err, setErr] = useState('');
  const [trash, setTrash] = useState(false);
  const [share, setShare] = useState(null); // 分享二维码 {share_token, share_url, qr_url}
  const [shareModal, setShareModal] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [slideOpen, setSlideOpen] = useState(false);
  const [slidePhotos, setSlidePhotos] = useState([]);
  // 工具栏 / 筛选 / 卡片交互
  const [qInput, setQInput] = useState(state.q || '');
  const [advancedOpen, setAdvancedOpen] = useState(false); // 高级选项面板
  const [filtersCollapsed, setFiltersCollapsed] = useState(false); // 筛选条收起
  const [renamingId, setRenamingId] = useState(null);
  const [renameVal, setRenameVal] = useState('');
  const [aiTipOpen, setAiTipOpen] = useState(() => (typeof localStorage !== 'undefined' ? localStorage.getItem('order_ai_tip') !== '1' : true));

  const abortRef = useRef(null);

  // 全屏幻灯片（订单选片结果）：用户点击【播放】手势内触发 BGM 播放
  function openSlideSel() {
    if (!sel || !sel.photos.length) return;
    setSlidePhotos(sel.photos.map((p) => ({ url: img(p.photo_url) })));
    bgm.play();
    setSlideOpen(true);
  }
  function closeSlideSel() {
    bgm.pause();
    setSlideOpen(false);
  }

  // 刷新订单列表：分页 + 全后端过滤；reset=true 重置到第 1 页并替换，否则追加（load more）
  const refreshOrderList = useCallback(async (opts = {}) => {
    const reset = opts.reset !== false;
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      if (trash) {
        const r = await http.get('/api/orders/recycle', { signal: ctrl.signal });
        setList(r.data);
        setListTotal(r.data.length);
        pageRef.current = 1; setPage(1);
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
      pageRef.current = nextPage; setPage(nextPage);
    } catch (e) {
      if (e.name !== 'AbortError') { /* 忽略请求中断外的错误 */ }
    }
  }, [state, pageSize, trash]);

  const loadMore = useCallback(() => { refreshOrderList({ reset: false }); }, [refreshOrderList]);

  useEffect(() => {
    refreshOrderList({ reset: true });
  }, [refreshOrderList]);

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
  useEffect(() => {
    const ctrl = new AbortController();
    http.get('/api/orders/stats', { signal: ctrl.signal }).then((r) => setStats(r.data || { expiringSoon: 0, selectionTimeout: 0 })).catch(() => {});
    return () => ctrl.abort();
  }, []);

  const doSearch = () => setState((s) => ({ ...s, q: qInput }));
  const setFilter = (k, v) => setState((s) => ({ ...s, [k]: v }));

  // 套系复用开单：从 /orders?pkg= 进入自动打开新建并预选套系
  useEffect(() => {
    const pkg = params.get('pkg');
    if (pkg) {
      setInitialPkg(pkg);
      setShowForm(true);
      params.delete('pkg');
      setParams(params, { replace: true });
    }
    // eslint-disable-next-line
  }, []);

  // 工作台「待处理订单」进度条点击跳转：读取 ?status= 预筛选
  useEffect(() => {
    const s = params.get('status');
    if (s) setState((x) => ({ ...x, status: s }));
    // eslint-disable-next-line
  }, []);

  const openDetail = async (id) => {
    const r = await http.get('/api/orders/' + id);
    setDetail(r.data);
    loadSel(id);
  };
  const closeDetail = () => { setDetail(null); setSel(null); };

  // 加载该订单的选片结果（客户在小程序提交 / 后台可修改）
  const loadSel = (id) => {
    http.get('/api/admin/photo-select/' + id).then((r) => setSel(r.data)).catch(() => setSel(null));
  };
  const toggleSel = (url) => {
    if (!sel || !sel.selection) return;
    const set = new Set(sel.selection.marks);
    if (set.has(url)) set.delete(url); else set.add(url);
    const marks = [...set];
    setSel({ ...sel, selection: { ...sel.selection, marks } });
  };
  const saveSel = async () => {
    if (!sel || !detail) return;
    setSelSaving(true);
    try {
      await http.post('/api/admin/photo-select/' + detail.id, { marks: sel.selection.marks });
      loadSel(detail.id);
    } catch (e) {
      alert((e.response && e.response.data && e.response.data.error) || '保存失败');
    } finally {
      setSelSaving(false);
    }
  };

  const openNew = () => { setInitialPkg(null); setShowForm(true); };

  // 卡片快速改名：点击订单名旁 ✎ 进入内联编辑，回车/失焦提交
  const startRename = (o) => { setRenamingId(o.id); setRenameVal(o.order_name || ''); };
  const commitRename = async () => {
    if (!renamingId) return;
    const name = (renameVal || '').trim();
    setRenamingId(null);
    if (!name) { refreshOrderList({ reset: true }); return; }
    try {
      await http.put('/api/orders/' + renamingId, { order_name: name });
      refreshOrderList({ reset: true });
    } catch (e) { alert((e.response && e.response.data && e.response.data.error) || '重命名失败'); }
  };

  // 卡片「分享订单」：按订单 ID 生成客片分享链接（复用订单分享接口），弹出复制
  const shareFromCard = async (o) => {
    setShareBusy(true);
    try {
      const r = await http.post('/api/orders/' + o.id + '/share');
      setShare(r.data);
      setShareModal(true);
    } catch (e) { alert((e.response && e.response.data && e.response.data.error) || '生成失败'); }
    finally { setShareBusy(false); }
  };

  // 编辑订单（基本信息；金额通过收款/退款调整，不在本处改）
  const [edit, setEdit] = useState(null);
  const [editForm, setEditForm] = useState({ groom_name: '', bride_name: '', customer_phone: '', address: '', shoot_date: '', executor: '', remark: '', status: '' });
  const openEdit = () => {
    if (!detail) return;
    setEditForm({
      groom_name: detail.groom_name || '', bride_name: detail.bride_name || '', customer_phone: detail.customer_phone || '',
      address: detail.address || '', shoot_date: detail.shoot_date || '', executor: detail.executor || '',
      remark: detail.remark || '', status: detail.status
    });
    setEdit(true);
  };
  async function saveEdit(e) {
    e.preventDefault();
    try {
      await http.put('/api/orders/' + detail.id, editForm);
      setEdit(false);
      openDetail(detail.id); refreshOrderList();
    } catch (e2) { alert((e2.response && e2.response.data && e2.response.data.error) || '保存失败'); }
  }
  async function removeOrder() {
    if (!confirm('确认删除该订单？\n将移入回收站，可在回收站恢复（不破坏收款流水与选片记录）。')) return;
    try {
      await http.delete('/api/orders/' + detail.id);
      setDetail(null); refreshOrderList();
    } catch (e2) { alert((e2.response && e2.response.data && e2.response.data.error) || '删除失败'); }
  }
  async function restoreOrder() {
    if (!confirm('确认恢复该订单？')) return;
    try {
      await http.post('/api/orders/' + detail.id + '/restore');
      setDetail(null); refreshOrderList();
    } catch (e2) { alert((e2.response && e2.response.data && e2.response.data.error) || '恢复失败'); }
  }
  async function purgeOrder() {
    if (!confirm('确认后将永久删除，建议先做好本地备份，确定继续？')) return;
    try {
      await http.post('/api/orders/' + detail.id + '/purge');
      setDetail(null); refreshOrderList();
    } catch (e2) { alert((e2.response && e2.response.data && e2.response.data.error) || '彻底删除失败'); }
  }

  async function advance() {
    if (!detail) return;
    const idx = STAGE_SEQ.indexOf(detail.status);
    if (idx < 0 || idx >= STAGE_SEQ.length - 1) return;
    const next = STAGE_SEQ[idx + 1];
    await http.put('/api/orders/' + detail.id, { status: next });
    openDetail(detail.id);
    refreshOrderList();
  }
  async function setStatus(s) {
    await http.put('/api/orders/' + detail.id, { status: s });
    openDetail(detail.id); refreshOrderList();
  }
  async function cancel() {
    const reason = prompt('作废原因（选填）');
    if (reason === null) return;
    await http.post('/api/orders/' + detail.id + '/cancel', { reason });
    openDetail(detail.id); refreshOrderList();
  }
  async function refund() {
    const amt = prompt('退款金额');
    if (amt === null || !amt) return;
    await http.post('/api/orders/' + detail.id + '/refund', { amount: parseFloat(amt), note: '手动退款' });
    openDetail(detail.id); refreshOrderList();
  }
  async function savePay() {
    setErr('');
    try {
      await http.post('/api/orders/' + detail.id + '/payments', pay);
      setPay(null);
      openDetail(detail.id); refreshOrderList();
    } catch (e) { setErr((e.response && e.response.data && e.response.data.error) || '登记失败'); }
  }

  // 生成 / 刷新客户影集分享二维码
  async function openShare() {
    if (!detail) return;
    setShareBusy(true);
    try {
      const r = await http.post('/api/orders/' + detail.id + '/share');
      setShare(r.data);
      setShareModal(true);
      openDetail(detail.id);
    } catch (e) { alert((e.response && e.response.data && e.response.data.error) || '生成失败'); }
    finally { setShareBusy(false); }
  }
  async function unshare() {
    if (!detail) return;
    if (!confirm('确认关闭该订单的分享？\n已生成的二维码将失效，客户无法再访问。')) return;
    try {
      await http.post('/api/orders/' + detail.id + '/unshare');
      setShare(null); setShareModal(false);
      openDetail(detail.id); refreshOrderList();
    } catch (e) { alert((e.response && e.response.data && e.response.data.error) || '操作失败'); }
  }
  function copyShare() {
    if (!share) return;
    navigator.clipboard?.writeText(share.share_url);
    alert('分享链接已复制：\n' + share.share_url);
  }

  // （已移除订单详情「生成电子相册」入口：相册分享改为在「作品」页发起，见 Works.jsx）

  const total = detail ? Number(detail.total_amount || 0) : 0;
  const paid = detail ? Number(detail.paid_amount || 0) : 0;
  const refundAmt = detail ? Number(detail.refund_amount || 0) : 0;
  const remain = total - paid;

  // 订单详情套系信息：优先用创建时的 package_snapshot，旧订单缺少字段时以当前套系补充
  const pkgInfo = useMemo(() => {
    if (!detail) return null;
    const snap = detail.package_snapshot || {};
    const live = pkgs.find((p) => p.id === detail.package_id) || {};
    const arr = (v) => Array.isArray(v) ? v : [];
    const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    const val = (s, l) => (s !== undefined && s !== null && s !== '' ? s : l);
    return {
      name: snap.name || live.name || '—',
      price: val(snap.price, live.price),
      deposit: val(snap.deposit, live.deposit),
      duration: val(snap.duration, live.duration),
      retouch_count: val(snap.retouch_count, live.retouch_count),
      raw_policy: val(snap.raw_policy, live.raw_policy),
      description: val(snap.description, live.description),
      cover_url: snap.cover_url || live.cover_url,
      spec: snap.spec || live.spec || null,
      addons: arr(snap.addons).length ? snap.addons : arr(live.addons),
      marketing: Object.keys(obj(snap.marketing)).length ? snap.marketing : obj(live.marketing),
      specs: arr(snap.specs).length ? snap.specs : arr(live.specs),
      questionnaire: arr(snap.questionnaire).length ? snap.questionnaire : arr(live.questionnaire),
    };
  }, [detail, pkgs]);

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-xl font-semibold text-white mb-3">订单中心</h1>

      {/* 顶部预警栏（到期 / 选片超时统计） */}
      {(stats.expiringSoon > 0 || stats.selectionTimeout > 0) && (
        <div className="flex items-center gap-4 mb-3 px-4 py-2 rounded-xl2 bg-amber-500/10 border border-amber-500/30 text-sm">
          <span className="text-amber-400">⏰ 预警</span>
          <span className="text-white">图片即将到期 <b className="text-amber-300">{stats.expiringSoon}</b></span>
          <span className="text-white">选片超时 <b className="text-amber-300">{stats.selectionTimeout}</b></span>
        </div>
      )}

      {/* AI 提示条（可关闭） */}
      {aiTipOpen && (
        <div className="flex items-center gap-3 mb-3 px-4 py-2 rounded-xl2 bg-brand/10 border border-brand/30 text-sm">
          <span className="text-brand">💡</span>
          <span className="text-white/90 flex-1">提示：点击卡片「查看订单」可编辑全部字段；「分享订单」生成客片分享链接，客户在手机即可查看成品影集。</span>
          <button onClick={() => { setAiTipOpen(false); try { localStorage.setItem('order_ai_tip', '1'); } catch { /* ignore */ } }}
            className="text-muted hover:text-white text-xs shrink-0">✕</button>
        </div>
      )}

      {/* 工具栏：搜索 + 高级选项 + 添加新订单 + 筛选收起 */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <input value={qInput} onChange={(e) => setQInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doSearch()}
            placeholder="姓名、套系名…" className="flex-1 px-3 py-2 rounded bg-panel border border-line text-white text-sm outline-none" />
          <button onClick={doSearch} className="px-3 py-2 rounded bg-panel2 border border-line text-white text-sm hover:border-brand">搜索</button>
        </div>
        <button onClick={() => setAdvancedOpen((v) => !v)} className={btn(advancedOpen, '高级选项')}>高级选项</button>
        <button onClick={openNew} className="px-4 py-2 rounded bg-brand text-white text-sm hover:opacity-90 whitespace-nowrap">+ 添加新订单</button>
        <button onClick={() => setFiltersCollapsed((v) => !v)} title="收起 / 展开筛选"
          className="px-3 py-2 rounded bg-panel2 border border-line text-muted hover:text-white text-sm whitespace-nowrap">{filtersCollapsed ? '▸ 筛选' : '▾ 筛选'}</button>
      </div>

      {/* 筛选行：状态 / 执行者 / 排序 */}
      {!filtersCollapsed && (
        <div className="flex gap-2 mb-3 flex-wrap">
          <select value={state.status} onChange={(e) => setFilter('status', e.target.value)}
            className="px-3 py-2 rounded bg-panel border border-line text-white text-sm outline-none">
            <option value="">所有订单</option>
            <option value="unpaid">未付定金</option>
            <option value="deposit">已付定金</option>
            <option value="shot">已拍摄</option>
            <option value="selecting">选片中</option>
            <option value="retouching">精修中</option>
            <option value="delivered">已交付</option>
            <option value="completed">已完成</option>
            <option value="cancelled">已作废</option>
          </select>
          <select value={state.executor} onChange={(e) => setFilter('executor', e.target.value)}
            className="px-3 py-2 rounded bg-panel border border-line text-white text-sm outline-none">
            <option value="">执行者：所有人</option>
            {personnel.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </select>
          <select value={state.sort} onChange={(e) => setFilter('sort', e.target.value)}
            className="px-3 py-2 rounded bg-panel border border-line text-white text-sm outline-none">
            <option value="recent">排序：最近</option>
            <option value="shoot_date">拍摄时间</option>
            <option value="amount">订单金额</option>
          </select>
          <button onClick={() => { setTrash((t) => !t); setFilter('status', ''); setQInput(''); }}
            className={btn(trash, '回收站')}>回收站</button>
        </div>
      )}

      {/* 高级选项面板：拍摄日期范围 */}
      {advancedOpen && !filtersCollapsed && (
        <div className="flex gap-2 mb-3 flex-wrap items-center">
          <span className="text-xs text-muted">拍摄日期</span>
          <input type="date" value={state.shootFrom} onChange={(e) => setFilter('shootFrom', e.target.value)}
            className="px-3 py-2 rounded bg-panel border border-line text-white text-sm outline-none" />
          <span className="text-xs text-muted">至</span>
          <input type="date" value={state.shootTo} onChange={(e) => setFilter('shootTo', e.target.value)}
            className="px-3 py-2 rounded bg-panel border border-line text-white text-sm outline-none" />
          <button onClick={() => { setFilter('shootFrom', ''); setFilter('shootTo', ''); }}
            className="px-3 py-2 rounded bg-panel2 border border-line text-muted text-xs">清除</button>
        </div>
      )}

      {trash && <div className="text-xs text-amber-400 mb-2">回收站：以下订单已软删除，可在详情中「恢复」或「彻底删除」。</div>}

      {/* 卡片流式列表 */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {list.map((o) => {
          const snap = (typeof o.package_snapshot === 'object' && o.package_snapshot) || {};
          const pkgType = [snap.name, snap.spec && snap.spec.name].filter(Boolean).join('｜') || '—';
          const execs = asArr(o.executors);
          const ms = mediaStatusOf(o);
          const thumb = snap.cover_url ? img(snap.cover_url) : '';
          const reviewTxt = o.eval_stars ? (Number(o.eval_stars) >= 4 ? '好评' : '中评') : '好评';
          const reviewDate = fmtDate(o.eval_at || o.created_at);
          return (
            <div key={o.id} className="bg-panel border border-line rounded-xl2 p-4 flex flex-col">
              {/* 头部：名称 + 改名 / 编号 + 状态 */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  {renamingId === o.id ? (
                    <input autoFocus value={renameVal} onChange={(e) => setRenameVal(e.target.value)}
                      onBlur={commitRename} onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null); }}
                      className="w-full px-2 py-1 rounded bg-panel2 border border-line text-white text-sm outline-none" />
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span className="text-white font-medium truncate">{o.order_name || '未命名订单'}</span>
                      <button onClick={() => startRename(o)} title="改名" className="text-muted hover:text-brand text-xs shrink-0">✎</button>
                    </div>
                  )}
                  <div className="text-[11px] text-faint mt-0.5">{o.order_no}</div>
                </div>
                <span className={'px-2 py-1 rounded-full text-xs shrink-0 ' + (o.status === 'deposit' && o.payment_status === 'unpaid' ? 'bg-red-500/15 text-red-400' : badge(o.status))}>
                  {stageLabel(o)}
                </span>
              </div>

              {/* 缩略图 + 套系类型 + 金额 */}
              <div className="flex gap-3 mt-3">
                <div className="w-16 h-16 rounded-lg bg-panel2 border border-line overflow-hidden shrink-0 flex items-center justify-center">
                  {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover" /> : <span className="text-[10px] text-muted">无图</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-white text-sm truncate">{pkgType}</div>
                  <div className="text-red-400 font-semibold mt-1">¥{Number(o.total_amount || 0).toLocaleString()}</div>
                  <div className="text-[11px] text-muted mt-0.5">
                    {Number(o.date_tbd) === 1 ? <span className="text-amber-400">日期待定</span> : (o.shoot_date || '未排期')}
                  </div>
                </div>
              </div>

              {/* 评价行 + 媒体状态 */}
              <div className="flex items-center justify-between mt-3 text-xs">
                <span className="text-amber-400">★ {reviewTxt}{reviewDate && <span className="text-muted ml-1">{reviewDate}</span>}</span>
                <span className={ms.c}>{ms.t}</span>
              </div>

              {/* 备注 */}
              <div className="text-xs text-muted mt-2 line-clamp-2">
                {o.remark ? o.remark : '备注：无'}
              </div>

              {/* 执行人头像 */}
              <div className="flex items-center gap-1.5 mt-3">
                {execs.length === 0 && <span className="text-[11px] text-faint">无执行人</span>}
                {execs.map((p, i) => (
                  <span key={i} className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-panel2 border border-line">
                    {p.avatar ? <img src={img(p.avatar)} alt="" className="w-5 h-5 rounded-full object-cover" />
                      : <span className="w-5 h-5 rounded-full bg-brand/20 text-brand text-[10px] flex items-center justify-center">{String(p.name || '?').slice(0, 1)}</span>}
                    <span className="text-white text-[11px]">{p.name}</span>
                  </span>
                ))}
              </div>

              {/* 操作按钮 */}
              <div className="flex gap-2 mt-4 pt-3 border-t border-line">
                <button onClick={() => openDetail(o.id)} className="flex-1 px-3 py-2 rounded bg-panel2 border border-line text-white text-xs hover:border-brand">查看订单</button>
                <button onClick={() => shareFromCard(o)} disabled={shareBusy}
                  className="flex-1 px-3 py-2 rounded bg-panel2 border border-line text-sky-400 text-xs hover:border-sky-400 disabled:opacity-40">分享订单</button>
              </div>
            </div>
          );
        })}
      </div>

      {list.length === 0 && <div className="text-center text-muted py-16">暂无订单</div>}

      {/* 分页：加载更多（后端分页，避免一次性渲染全部） */}
      {!trash && list.length < listTotal && (
        <div className="flex justify-center mt-6">
          <button onClick={loadMore} className="px-6 py-2 rounded bg-panel2 border border-line text-white text-sm hover:border-brand">加载更多（{list.length}/{listTotal}）</button>
        </div>
      )}

      {/* 详情抽屉 */}
      {detail && (
        <div className="fixed inset-0 bg-black/60 flex z-50" onClick={() => closeDetail()}>
          <div className="flex-1" />
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-panel border-l border-line h-full overflow-auto p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-white font-medium">{detail.order_name || detail.order_no}</div>
                {detail.order_name && <div className="text-[11px] text-faint">{detail.order_no}</div>}
                <div className="text-xs text-muted">
                  {(detail.groom_name || detail.bride_name) ? (
                    <>
                      {detail.groom_name && <span className="mr-2">新郎：{detail.groom_name}</span>}
                      {detail.bride_name && <span>新娘：{detail.bride_name}</span>}
                    </>
                  ) : detail.customer_name}
                  {detail.customer_phone && <span className="ml-2">{detail.customer_phone}</span>}
                </div>
                {detail.address && <div className="text-[11px] text-muted mt-0.5">📍 {detail.address}</div>}
                {detail.openid && <div className="text-[11px] text-sky-400 mt-0.5">C端客户 · {detail.openid}</div>}
              </div>
              <button onClick={() => closeDetail()} className="text-muted text-sm">✕</button>
            </div>

            {/* 阶段时间线 */}
            <div className="flex items-center gap-1 mb-4 overflow-x-auto">
              {STAGE_SEQ.map((s, i) => {
                const cur = STAGE_SEQ.indexOf(detail.status);
                const active = i <= cur;
                return (
                  <React.Fragment key={s}>
                    <div className={'flex flex-col items-center ' + (active ? '' : 'opacity-40')}>
                      <div className={'w-3 h-3 rounded-full ' + (active ? STAGE_COLOR[s] : 'bg-line')} />
                      <span className="text-[10px] text-muted mt-1 whitespace-nowrap">
                        {s === 'deposit' && detail.payment_status === 'unpaid' ? '未付定金' : STATUS_LABEL[s]}
                      </span>
                    </div>
                    {i < STAGE_SEQ.length - 1 && <div className={'flex-1 h-0.5 ' + (i < cur ? STAGE_COLOR[s] : 'bg-line')} />}
                  </React.Fragment>
                );
              })}
            </div>

            {/* 金额 */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="bg-panel2 rounded-lg p-3"><div className="text-xs text-muted">应收</div><div className="text-white">¥{total.toLocaleString()}</div></div>
              <div className="bg-panel2 rounded-lg p-3"><div className="text-xs text-muted">已收</div><div className="text-emerald-400">¥{paid.toLocaleString()}</div></div>
              <div className="bg-panel2 rounded-lg p-3"><div className="text-xs text-muted">待收/退</div><div className="text-white">{refundAmt > 0 ? '退¥' + refundAmt : '¥' + remain}</div></div>
            </div>

            {/* 订单资料：新增订单弹窗录入的完整字段 */}
            {(() => {
              const phones = asArr(detail.phones);
              const phoneList = phones.length ? phones : (detail.customer_phone ? [detail.customer_phone] : []);
              const slots = asArr(detail.time_slots);
              const extras = asArr(detail.extra_items);
              const execs = asArr(detail.executors);
              const extraSum = extras.reduce((s, x) => s + (Number(x.amount) || 0), 0);
              const tbd = Number(detail.date_tbd) === 1;
              const payKey = detail.payment_status || 'deposit';
              return (
                <div className="bg-panel2 rounded-lg p-3 mb-3 text-sm space-y-2.5">
                  <div className="text-white font-medium">订单资料</div>

                  {detail.order_name && (
                    <div className="flex gap-2">
                      <span className="text-muted shrink-0 w-16">订单名称</span>
                      <span className="text-white flex-1 break-all">{detail.order_name}</span>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <span className="text-muted shrink-0 w-16">联系电话</span>
                    <span className="flex-1 flex flex-wrap gap-1.5">
                      {phoneList.length === 0 ? <span className="text-muted">—</span> : phoneList.map((p, i) => (
                        <a key={i} href={'tel:' + p} className="px-1.5 py-0.5 rounded bg-panel border border-line text-white text-xs hover:text-brand">{p}</a>
                      ))}
                    </span>
                  </div>

                  <div className="flex gap-2">
                    <span className="text-muted shrink-0 w-16">档期时间</span>
                    <span className="flex-1">
                      {tbd ? (
                        <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 text-xs border border-amber-500/20">日期待定（不占用日历档期）</span>
                      ) : (
                        <>
                          <span className="text-white">{detail.shoot_date || '—'}</span>
                          {slots.length > 0 && (
                            <span className="flex flex-wrap gap-1 mt-1">
                              {slots.map((h, i) => (
                                <span key={i} className="px-1.5 py-0.5 rounded bg-panel border border-line text-white text-[11px]">{h}</span>
                              ))}
                            </span>
                          )}
                        </>
                      )}
                    </span>
                  </div>

                  <div className="flex gap-2">
                    <span className="text-muted shrink-0 w-16">收款状态</span>
                    <span className={'flex-1 ' + (PAY_STATUS_COLOR[payKey] || 'text-white')}>
                      {PAY_STATUS_LABEL[payKey] || payKey}
                    </span>
                  </div>

                  {extras.length > 0 && (
                    <div className="flex gap-2">
                      <span className="text-muted shrink-0 w-16">其他消费</span>
                      <span className="flex-1 space-y-1">
                        {extras.map((x, i) => (
                          <span key={i} className="flex items-center justify-between text-xs">
                            <span className="text-white">{x.name}</span>
                            <span className="text-emerald-400">+¥{Number(x.amount || 0).toLocaleString()}</span>
                          </span>
                        ))}
                        <span className="flex items-center justify-between text-xs border-t border-line pt-1">
                          <span className="text-muted">小计</span>
                          <span className="text-white">¥{extraSum.toLocaleString()}</span>
                        </span>
                      </span>
                    </div>
                  )}

                  {detail.channel && (
                    <div className="flex gap-2">
                      <span className="text-muted shrink-0 w-16">渠道来源</span>
                      <span className="flex-1">
                        <span className="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-400 text-xs border border-sky-500/20">{detail.channel}</span>
                      </span>
                    </div>
                  )}

                  {(execs.length > 0 || detail.executor) && (
                    <div className="flex gap-2">
                      <span className="text-muted shrink-0 w-16">执行人</span>
                      <span className="flex-1 flex flex-wrap gap-2">
                        {execs.length > 0 ? execs.map((p, i) => (
                          <span key={i} className="flex items-center gap-1.5 px-1.5 py-0.5 rounded-full bg-panel border border-line">
                            {p.avatar ? (
                              <img src={img(p.avatar)} alt="" className="w-5 h-5 rounded-full object-cover" />
                            ) : (
                              <span className="w-5 h-5 rounded-full bg-brand/20 text-brand text-[10px] flex items-center justify-center">
                                {String(p.name || '?').slice(0, 1)}
                              </span>
                            )}
                            <span className="text-white text-xs">{p.name}</span>
                          </span>
                        )) : <span className="text-white text-xs">{detail.executor}</span>}
                      </span>
                    </div>
                  )}

                  {detail.address && (
                    <div className="flex gap-2">
                      <span className="text-muted shrink-0 w-16">拍摄地点</span>
                      <span className="text-white flex-1 break-all">{detail.address}</span>
                    </div>
                  )}

                  {detail.remark && (
                    <div className="flex gap-2">
                      <span className="text-muted shrink-0 w-16">备注</span>
                      <span className="text-white flex-1 whitespace-pre-line break-all">{detail.remark}</span>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* 套系信息 */}
            {pkgInfo && pkgInfo.name && pkgInfo.name !== '—' && (
              <div className="bg-panel2 rounded-lg p-3 mb-3 text-sm">
                <div className="text-white font-medium mb-2">套系信息</div>
                <div className="flex gap-3 mb-3">
                  {pkgInfo.cover_url && (
                    <img src={img(pkgInfo.cover_url)} alt="cover" className="w-20 h-20 rounded-lg object-cover border border-line flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-base text-white font-semibold mb-1">{pkgInfo.name}</div>
                    {pkgInfo.spec && pkgInfo.spec.name && (
                      <div className="text-xs text-emerald-400 mb-1.5">已选规格：{pkgInfo.spec.name}</div>
                    )}
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      {pkgInfo.price !== undefined && pkgInfo.price !== '' && (
                        <div><span className="text-muted">套系总价</span> <span className="text-white ml-1">¥{Number(pkgInfo.price || 0).toLocaleString()}</span></div>
                      )}
                      {pkgInfo.deposit !== undefined && pkgInfo.deposit !== '' && (
                        <div><span className="text-muted">定金</span> <span className="text-white ml-1">¥{Number(pkgInfo.deposit || 0).toLocaleString()}</span></div>
                      )}
                    </div>
                  </div>
                </div>

                {/* 营销标签 */}
                {pkgInfo.marketing && Object.keys(pkgInfo.marketing).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {pkgInfo.marketing.tag && (
                      <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 text-xs border border-amber-500/20">{pkgInfo.marketing.tag}</span>
                    )}
                    {pkgInfo.marketing.hot && (
                      <span className="px-2 py-0.5 rounded bg-red-500/15 text-red-400 text-xs border border-red-500/20">热门</span>
                    )}
                    {pkgInfo.marketing.recommend && (
                      <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 text-xs border border-emerald-500/20">推荐</span>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 text-xs mb-2">
                  {pkgInfo.duration !== undefined && pkgInfo.duration !== '' && (
                    <div><span className="text-muted">拍摄时长</span> <span className="text-white ml-1">{pkgInfo.duration}</span></div>
                  )}
                  {pkgInfo.retouch_count !== undefined && pkgInfo.retouch_count !== '' && (
                    <div><span className="text-muted">精修张数</span> <span className="text-white ml-1">{pkgInfo.retouch_count}</span></div>
                  )}
                  {pkgInfo.raw_policy !== undefined && pkgInfo.raw_policy !== '' && (
                    <div className="col-span-2"><span className="text-muted">底片政策</span> <span className="text-white ml-1">{pkgInfo.raw_policy}</span></div>
                  )}
                </div>

                {pkgInfo.description && (
                  <div className="text-xs text-muted whitespace-pre-line leading-relaxed mt-2">{pkgInfo.description}</div>
                )}

                {/* 规格列表 */}
                {pkgInfo.specs.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs text-muted mb-1.5">可选规格</div>
                    <div className="space-y-1.5">
                      {pkgInfo.specs.map((s, i) => {
                        const active = pkgInfo.spec && pkgInfo.spec.name === s.name;
                        return (
                          <div key={i} className={'flex items-center justify-between px-2 py-1.5 rounded text-xs border ' + (active ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-line bg-panel')}>
                            <span className={active ? 'text-emerald-400' : 'text-white'}>{s.name}{active ? '（已选）' : ''}</span>
                            <span className="text-muted">¥{Number(s.price || 0).toLocaleString()}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {pkgInfo.addons.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs text-muted mb-1">增值服务</div>
                    <div className="flex flex-wrap gap-1">
                      {pkgInfo.addons.map((a, i) => (
                        <span key={i} className="px-2 py-0.5 rounded bg-panel text-white text-xs border border-line">
                          {a.name}{a.price ? ` +¥${Number(a.price).toLocaleString()}` : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 客户问卷（客户在小程序填写，后台查看）*/}
            {detail.package_snapshot && Array.isArray(detail.package_snapshot.questionnaire) && detail.package_snapshot.questionnaire.length > 0 && (() => {
              let ans = {};
              try { ans = detail.questionnaire_answers ? (typeof detail.questionnaire_answers === 'string' ? JSON.parse(detail.questionnaire_answers) : detail.questionnaire_answers) : {}; } catch { ans = {}; }
              const qs = detail.package_snapshot.questionnaire;
              return (
                <div className="bg-panel2 rounded-lg p-3 mb-3">
                  <div className="text-white font-medium mb-2">客户问卷</div>
                  <div className="space-y-2">
                    {qs.map((q, i) => (
                      <div key={i} className="text-sm">
                        <div className="text-muted">{i + 1}. {q.q}{q.required ? ' *' : ''}</div>
                        <div className="text-white mt-0.5">
                          {ans[i] !== undefined && ans[i] !== '' && !(Array.isArray(ans[i]) && ans[i].length === 0)
                            ? (Array.isArray(ans[i]) ? ans[i].join('、') : ans[i])
                            : <span className="text-muted">（未填写）</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* 选片结果（客户在小程序提交，后台可查看/修改）*/}
            <div className="text-xs text-muted mb-1 flex items-center justify-between">
              <span>选片结果</span>
              <div className="flex items-center gap-2">
                <button onClick={openSlideSel} disabled={!sel || !sel.photos.length}
                  className="px-2 py-1 rounded border border-line text-xs text-fg hover:text-brand hover:border-brand disabled:opacity-40">▶ 播放</button>
                {sel && sel.selection && (
                  <span className={sel.selection.submitted ? 'text-emerald-400' : 'text-amber-400'}>
                    {sel.selection.submitted ? '已提交' : '草稿'}
                  </span>
                )}
              </div>
            </div>
            <div className="mb-4">
              {!sel && <div className="text-muted text-sm py-2">加载中…</div>}
              {sel && !sel.selection && <div className="text-muted text-sm py-2">该订单暂无客户选片</div>}
              {sel && sel.selection && (
                <>
                  <div className="grid grid-cols-4 gap-2 mb-3">
                    {sel.photos.map((p) => {
                      const on = sel.selection.marks.includes(p.photo_url);
                      return (
                        <button key={p.id} onClick={() => toggleSel(p.photo_url)}
                          className={'relative rounded-lg overflow-hidden border ' + (on ? 'border-brand' : 'border-line')}>
                          <img src={img(p.photo_url)} className="w-full h-20 object-cover" />
                          <span className={'absolute top-1 right-1 w-4 h-4 rounded-full text-[10px] flex items-center justify-center ' + (on ? 'bg-brand text-white' : 'bg-black/50 text-white')}>{on ? '✓' : ''}</span>
                        </button>
                      );
                    })}
                    {sel.photos.length === 0 && <div className="col-span-full text-muted text-sm py-2">该订单无可选样片（需在作品相册中上传 sample 区照片）</div>}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted">已选 {sel.selection.marks.length} 张</span>
                    <button onClick={saveSel} disabled={selSaving}
                      className="px-3 py-1.5 rounded bg-brand text-white text-xs disabled:opacity-40">保存修改</button>
                  </div>
                </>
              )}
            </div>

            {/* 操作 */}
            <div className="flex flex-wrap gap-2 mb-4">
              <button onClick={advance} disabled={detail.status === 'completed' || detail.status === 'cancelled'}
                className="px-3 py-1.5 rounded bg-brand text-white text-xs disabled:opacity-40">推进阶段</button>
              <button onClick={() => setPay({ type: 'deposit', amount: '', method: 'offline', note: '' })}
                className="px-3 py-1.5 rounded bg-panel2 border border-line text-white text-xs">+ 收款</button>
              <button onClick={refund} className="px-3 py-1.5 rounded bg-panel2 border border-line text-amber-400 text-xs">退款</button>
              <button onClick={cancel} className="px-3 py-1.5 rounded bg-panel2 border border-line text-red-400 text-xs">作废</button>
              <button onClick={openEdit} className="px-3 py-1.5 rounded bg-panel2 border border-line text-white text-xs">编辑</button>
              <button onClick={openShare} disabled={shareBusy}
                className="px-3 py-1.5 rounded bg-panel2 border border-line text-sky-400 text-xs disabled:opacity-40">分享客户影集</button>
              {!detail.is_deleted ? (
                <button onClick={removeOrder} className="px-3 py-1.5 rounded bg-panel2 border border-line text-red-400 text-xs">删除</button>
              ) : (
                <>
                  <button onClick={restoreOrder} className="px-3 py-1.5 rounded bg-panel2 border border-line text-emerald-400 text-xs">恢复</button>
                  <button onClick={purgeOrder} className="px-3 py-1.5 rounded bg-panel2 border border-line text-red-400 text-xs">彻底删除</button>
                </>
              )}
            </div>

            {/* 收款流水 */}
            <div className="text-xs text-muted mb-1">收款流水</div>
            <div className="mb-4">
              {(!detail.payments || detail.payments.length === 0) && <div className="text-muted text-sm py-2">暂无流水</div>}
              {detail.payments && detail.payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between border-b border-line py-2 text-sm">
                  <div>
                    <span className="text-white">{TYPE_LABEL[p.type]}</span>
                    <span className="text-muted ml-2">{p.method === 'online' ? '线上' : '线下'}</span>
                  </div>
                  <div className={p.type === 'refund' ? 'text-red-400' : 'text-emerald-400'}>
                    {p.type === 'refund' ? '-' : '+'}¥{Number(p.amount).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>

            {/* 操作日志 */}
            <div className="text-xs text-muted mb-1">操作日志</div>
            <div className="text-xs text-muted space-y-1">
              {(detail.logs || []).map((l, i) => (
                <div key={i}>· {new Date(l.t).toLocaleString('zh-CN')} {l.text}</div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 新建订单弹窗（抽离为独立组件，创建成功后刷新列表） */}
      <OrderCreateModal
        visible={showForm}
        packages={pkgs}
        initialPackageId={initialPkg}
        onClose={() => setShowForm(false)}
        onAfterCreate={refreshOrderList}
      />

      {/* 收款弹窗 */}
      {pay && detail && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[70] p-4" onClick={() => setPay(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm bg-panel border border-line rounded-xl2 p-6">
            <div className="text-white font-medium mb-4">登记收款 · {detail.order_no}</div>
            <select value={pay.type} onChange={(e) => setPay({ ...pay, type: e.target.value })} className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none">
              <option value="deposit">定金</option><option value="balance">尾款</option><option value="extra">加片/增值</option>
            </select>
            <input value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} type="number" placeholder="金额"
              className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
            <select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })} className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none">
              <option value="offline">线下</option><option value="online">线上</option>
            </select>
            <input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} placeholder="备注(选填)"
              className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
            {err && <div className="text-xs text-red-400 mb-2">{err}</div>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setPay(null)} className="px-4 py-2 rounded text-sm text-muted">取消</button>
              <button onClick={savePay} className="px-4 py-2 rounded bg-brand text-white text-sm">保存</button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑订单弹窗 */}
      {edit && detail && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[70] p-4" onClick={() => setEdit(false)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={saveEdit} className="w-full max-w-md bg-panel border border-line rounded-xl2 p-6">
            <div className="text-white font-medium mb-4">编辑订单 · {detail.order_no}</div>
            <div className="grid grid-cols-2 gap-3">
              <input value={editForm.groom_name} onChange={(e) => setEditForm({ ...editForm, groom_name: e.target.value })} placeholder="新郎姓名"
                className="px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
              <input value={editForm.bride_name} onChange={(e) => setEditForm({ ...editForm, bride_name: e.target.value })} placeholder="新娘姓名"
                className="px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <input value={editForm.customer_phone} onChange={(e) => setEditForm({ ...editForm, customer_phone: e.target.value })} placeholder="联系电话"
                className="px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
              <input value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} placeholder="拍摄地址"
                className="px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
            </div>
            <input value={editForm.shoot_date} onChange={(e) => setEditForm({ ...editForm, shoot_date: e.target.value })} type="date" placeholder="拍摄日期"
              className="w-full mt-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
            <input value={editForm.executor} onChange={(e) => setEditForm({ ...editForm, executor: e.target.value })} placeholder="执行人"
              className="w-full mt-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
            <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
              className="w-full mt-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none">
              <option value="deposit">已付定金</option><option value="shot">已拍摄</option>
              <option value="selecting">选片中</option><option value="retouching">精修中</option><option value="delivered">已交付</option>
              <option value="completed">已完成</option><option value="cancelled">已作废</option>
            </select>
            <input value={editForm.remark} onChange={(e) => setEditForm({ ...editForm, remark: e.target.value })} placeholder="备注"
              className="w-full mt-3 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
            <div className="flex gap-2 justify-end mt-4">
              <button type="button" onClick={() => setEdit(false)} className="px-4 py-2 rounded text-sm text-muted">取消</button>
              <button type="submit" className="px-4 py-2 rounded bg-brand text-white text-sm">保存</button>
            </div>
          </form>
        </div>
      )}

      {/* 客户影集分享二维码弹窗 */}
      {shareModal && detail && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[80] p-4" onClick={() => setShareModal(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm bg-panel border border-line rounded-xl2 p-6 text-center">
            <div className="text-white font-medium mb-1">客户影集分享</div>
            <div className="text-xs text-muted mb-4">扫码或复制链接，客户即可在手机上查看成品影集（仅展示样片/成片，不含原片）</div>
            {share && share.qr_url ? (
              <>
                <img src={share.qr_url} alt="分享二维码" className="w-56 h-56 mx-auto rounded-lg bg-white p-2" />
                <div className="text-xs text-muted mt-3 break-all">{share.share_url}</div>
                <div className="flex gap-2 justify-center mt-4">
                  <button onClick={copyShare} className="px-3 py-1.5 rounded bg-brand text-white text-xs">复制链接</button>
                  <button onClick={openShare} disabled={shareBusy} className="px-3 py-1.5 rounded bg-panel2 border border-line text-white text-xs disabled:opacity-40">刷新二维码</button>
                  <button onClick={unshare} className="px-3 py-1.5 rounded bg-panel2 border border-line text-red-400 text-xs">关闭分享</button>
                </div>
              </>
            ) : (
              <div className="text-muted text-sm py-8">生成中…</div>
            )}
            <button onClick={() => setShareModal(false)} className="mt-4 px-4 py-2 rounded text-sm text-muted">关闭</button>
          </div>
        </div>
      )}

      <Slideshow photos={slidePhotos} open={slideOpen} onClose={closeSlideSel} title={detail ? detail.title : '订单相册'} />
    </div>
  );
}

function btn(active, label) {
  return 'px-3 py-2 rounded-full text-sm border ' + (active ? 'bg-brand text-white border-brand' : 'bg-panel border-line text-muted');
}
function badge(status) {
  return {
    deposit: 'bg-amber-500/15 text-amber-400', shot: 'bg-sky-500/15 text-sky-400',
    selecting: 'bg-indigo-500/15 text-indigo-400', retouching: 'bg-purple-500/15 text-purple-400', delivered: 'bg-teal-500/15 text-teal-400',
    completed: 'bg-emerald-500/15 text-emerald-400', cancelled: 'bg-line text-muted'
  }[status] || 'bg-line text-muted';
}

// 卡片辅助：日期格式化 / 媒体状态（已过期·待选片·正常）
function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s).slice(0, 10);
  return d.toLocaleDateString('zh-CN');
}
function mediaStatusOf(o) {
  const today = new Date().toISOString().slice(0, 10);
  const expired = (o.raw_expire_at && o.raw_expire_at < today) || (o.retouch_expire_at && o.retouch_expire_at < today);
  if (expired) return { t: '照片已过期', c: 'text-red-400' };
  if (!o.selection_submitted) return { t: '待选片', c: 'text-amber-400' };
  return { t: '正常', c: 'text-emerald-400' };
}
