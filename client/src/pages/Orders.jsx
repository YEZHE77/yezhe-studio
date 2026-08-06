import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import http, { img, debounce } from '../api.js';
import { useViewState } from '../tabMemory.js';
import OrderCreateModal from '../components/OrderCreateModal.jsx';

const STATUS_LABEL = {
  unpaid: '待付定金', deposit: '已付定金', shot: '已拍摄', selecting: '选片中',
  retouching: '精修中', delivered: '已交付', completed: '已完成', cancelled: '已作废'
};
const STAGE_SEQ = ['unpaid', 'deposit', 'shot', 'selecting', 'retouching', 'delivered', 'completed'];
const STAGE_COLOR = {
  unpaid: 'bg-red-500', deposit: 'bg-amber-500', shot: 'bg-sky-500', selecting: 'bg-indigo-500',
  retouching: 'bg-purple-500', delivered: 'bg-teal-500', completed: 'bg-emerald-500', cancelled: 'bg-line'
};
const TYPE_LABEL = { deposit: '定金', balance: '尾款', extra: '加片/增值', refund: '退款' };

export default function Orders() {
  const [params, setParams] = useSearchParams();
  const [state, setState] = useViewState('orders', { status: '', q: '' });
  const [list, setList] = useState([]);
  const [pkgs, setPkgs] = useState([]);
  const [detail, setDetail] = useState(null);
  const [sel, setSel] = useState(null); // 选片结果 {selection, photos}
  const [selSaving, setSelSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [initialPkg, setInitialPkg] = useState(null);
  const [pay, setPay] = useState(null); // {type, amount, method, note}
  const [err, setErr] = useState('');
  const [trash, setTrash] = useState(false);
  const [storage, setStorage] = useState(null);
  const [storageForm, setStorageForm] = useState({ raw_storage_days: 30, retouch_storage_days: 180 });
  const [share, setShare] = useState(null); // 分享二维码 {share_token, share_url, qr_url}
  const [shareModal, setShareModal] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);

  const abortRef = useRef(null);

  // 搜索防抖 300ms（避免逐字发请求）
  const setQ = useMemo(() => debounce((v) => setState((s) => ({ ...s, q: v }))), [setState]);

  // 刷新订单列表：重新拉取接口并更新 list state（不做 location.reload）
  const refreshOrderList = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      if (trash) {
        const r = await http.get('/api/orders/recycle', { signal: ctrl.signal });
        setList(r.data);
      } else {
        const p = new URLSearchParams();
        if (state.status) p.set('status', state.status);
        if (state.q) p.set('q', state.q);
        const r = await http.get('/api/orders?' + p.toString(), { signal: ctrl.signal });
        setList(r.data);
      }
    } catch (e) {
      if (e.name !== 'AbortError') { /* 忽略请求中断外的错误 */ }
    }
  }, [state, trash]);

  useEffect(() => {
    refreshOrderList();
  }, [refreshOrderList]);

  useEffect(() => () => { if (abortRef.current) abortRef.current.abort(); }, []);
  useEffect(() => {
    const ctrl = new AbortController();
    http.get('/api/packages?status=all', { signal: ctrl.signal }).then((r) => setPkgs(r.data)).catch(() => {});
    return () => ctrl.abort();
  }, []);

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

  function openStorage() {
    if (!detail) return;
    setStorageForm({
      raw_storage_days: detail.raw_storage_days || 30,
      retouch_storage_days: detail.retouch_storage_days || 180
    });
    setStorage(true);
  }
  async function saveStorage() {
    try {
      await http.post('/api/orders/' + detail.id + '/storage', storageForm);
      setStorage(false);
      openDetail(detail.id); refreshOrderList();
    } catch (e) { alert((e.response && e.response.data && e.response.data.error) || '保存失败'); }
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

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-white">订单中心</h1>
        <button onClick={openNew} className="px-4 py-2 rounded bg-brand text-white text-sm hover:opacity-90">+ 新建订单</button>
      </div>

      {/* 状态筛选 + 搜索 */}
      <div className="flex gap-2 mb-3 flex-wrap">
        <button onClick={() => setState((s) => ({ ...s, status: '' }))} className={btn(state.status === '', '全部')}>全部</button>
        {STAGE_SEQ.map((s) => (
          <button key={s} onClick={() => setState((x) => ({ ...x, status: s }))} className={btn(state.status === s, STATUS_LABEL[s])}>{STATUS_LABEL[s]}</button>
        ))}
        <button onClick={() => { setTrash((t) => !t); setState((s) => ({ ...s, status: '', q: '' })); }} className={btn(trash, '回收站')}>回收站</button>
        <input value={state.q} onChange={(e) => setQ(e.target.value)} placeholder="搜索客户 / 订单号"
          className="ml-auto w-56 px-3 py-2 rounded bg-panel border border-line text-white text-sm outline-none" />
      </div>

      {trash && <div className="text-xs text-amber-400 mb-2">回收站：以下订单已软删除，可「恢复」或「彻底删除」（彻底删除不可恢复）。</div>}

      {/* 列表 */}
      <div className="bg-panel border border-line rounded-xl2 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted text-left border-b border-line">
              <th className="p-3 font-medium">订单号</th>
              <th className="p-3 font-medium">客户</th>
              <th className="p-3 font-medium">套系</th>
              <th className="p-3 font-medium">应收</th>
              <th className="p-3 font-medium">已收</th>
              <th className="p-3 font-medium">拍摄日</th>
              <th className="p-3 font-medium">状态</th>
            </tr>
          </thead>
          <tbody>
            {list.map((o) => (
              <tr key={o.id} onClick={() => openDetail(o.id)} className="border-b border-line last:border-0 cursor-pointer hover:bg-panel2">
                <td className="p-3 text-white">{o.order_no}</td>
                <td className="p-3 text-white">
                  {(o.groom_name || o.bride_name) ? (
                    <span>{[o.groom_name, o.bride_name].filter(Boolean).join(' & ')}</span>
                  ) : o.customer_name}
                  <span className="text-muted ml-1">{o.customer_phone}</span>
                  {o.openid && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-400">C端</span>}
                </td>
                <td className="p-3 text-muted">{(o.package_snapshot && o.package_snapshot.name) || '—'}</td>
                <td className="p-3 text-white">¥{Number(o.total_amount || 0).toLocaleString()}</td>
                <td className="p-3 text-emerald-400">¥{Number(o.paid_amount || 0).toLocaleString()}</td>
                <td className="p-3 text-muted">{o.shoot_date || '—'}</td>
                <td className="p-3"><span className={'px-2 py-1 rounded-full text-xs ' + badge(o.status)}>{STATUS_LABEL[o.status]}</span></td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan="7" className="p-8 text-center text-muted">暂无订单</td></tr>}
          </tbody>
        </table>
      </div>

      {/* 详情抽屉 */}
      {detail && (
        <div className="fixed inset-0 bg-black/60 flex z-50" onClick={() => closeDetail()}>
          <div className="flex-1" />
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-panel border-l border-line h-full overflow-auto p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-white font-medium">{detail.order_no}</div>
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
                      <span className="text-[10px] text-muted mt-1 whitespace-nowrap">{STATUS_LABEL[s]}</span>
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

            {/* 套系快照 */}
            {detail.package_snapshot && (
              <div className="bg-panel2 rounded-lg p-3 mb-3 text-sm">
                <div className="text-white">{detail.package_snapshot.name} · ¥{detail.package_snapshot.price}</div>
              </div>
            )}

            {/* 文件保存期限提示栏 */}
            {(() => {
              const dl = (exp) => { if (!exp) return null; return Math.ceil((new Date(exp).getTime() - Date.now()) / 86400000); };
              const rawLeft = dl(detail.raw_expire_at);
              const retLeft = dl(detail.retouch_expire_at);
              const fmt = (v) => v === null ? '未设置' : (v >= 0 ? v + ' 天' : '已过期');
              const cls = (v) => v !== null && v < 7 ? 'text-red-400' : 'text-white';
              return (
                <div className="bg-panel2 rounded-lg p-3 mb-3 text-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-white font-medium">文件保存期限</span>
                    <button onClick={openStorage} className="px-2 py-1 rounded bg-panel border border-line text-xs text-white">设置保存时长</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><div className="text-muted">原片剩余</div><div className={cls(rawLeft)}>{fmt(rawLeft)}</div></div>
                    <div><div className="text-muted">精修剩余</div><div className={cls(retLeft)}>{fmt(retLeft)}</div></div>
                  </div>
                </div>
              );
            })()}

            {/* 选片结果（客户在小程序提交，后台可查看/修改）*/}
            <div className="text-xs text-muted mb-1 flex items-center justify-between">
              <span>选片结果</span>
              {sel && sel.selection && (
                <span className={sel.selection.submitted ? 'text-emerald-400' : 'text-amber-400'}>
                  {sel.selection.submitted ? '已提交' : '草稿'}
                </span>
              )}
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
              <option value="unpaid">待付定金</option><option value="deposit">已付定金</option><option value="shot">已拍摄</option>
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

      {/* 存储时长设置弹窗 */}
      {storage && detail && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[70] p-4" onClick={() => setStorage(false)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); saveStorage(); }} className="w-full max-w-sm bg-panel border border-line rounded-xl2 p-6">
            <div className="text-white font-medium mb-4">设置文件保存时长 · {detail.order_no}</div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-muted">原片保存(天)
                <input type="number" min="1" value={storageForm.raw_storage_days} onChange={(e) => setStorageForm({ ...storageForm, raw_storage_days: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
              </label>
              <label className="text-xs text-muted">精修保存(天)
                <input type="number" min="1" value={storageForm.retouch_storage_days} onChange={(e) => setStorageForm({ ...storageForm, retouch_storage_days: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded bg-panel2 border border-line text-white text-sm outline-none" />
              </label>
            </div>
            <div className="text-xs text-muted mt-3">保存后立即按今天计算到期日，到期前 7 天标红预警。</div>
            <div className="flex gap-2 justify-end mt-4">
              <button type="button" onClick={() => setStorage(false)} className="px-4 py-2 rounded text-sm text-muted">取消</button>
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

    </div>
  );
}

function btn(active, label) {
  return 'px-3 py-2 rounded-full text-sm border ' + (active ? 'bg-brand text-white border-brand' : 'bg-panel border-line text-muted');
}
function badge(status) {
  return {
    unpaid: 'bg-red-500/15 text-red-400', deposit: 'bg-amber-500/15 text-amber-400', shot: 'bg-sky-500/15 text-sky-400',
    selecting: 'bg-indigo-500/15 text-indigo-400', retouching: 'bg-purple-500/15 text-purple-400', delivered: 'bg-teal-500/15 text-teal-400',
    completed: 'bg-emerald-500/15 text-emerald-400', cancelled: 'bg-line text-muted'
  }[status] || 'bg-line text-muted';
}
