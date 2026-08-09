import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import http, { img, uploadBatch } from '../api.js';
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
const PAY_STATUS_LABEL = { unpaid: '未付定金', deposit: '已付定金', paid: '已付全款' };
const PAY_STATUS_COLOR = { unpaid: 'text-red-400', deposit: 'text-amber-400', paid: 'text-emerald-400' };

// 订单详情 11 步流程进度条（由 status + 关键标记派生，不新建接口）
const ORDER_STEPS = [
  { key: 'created', label: '订单生成' },
  { key: 'contract', label: '生成合同' },
  { key: 'confirm', label: '沟通确认' },
  { key: 'shoot', label: '拍摄执行' },
  { key: 'shot_end', label: '拍摄结束' },
  { key: 'select', label: '选片精修' },
  { key: 'preview', label: '预告片输出' },
  { key: 'retouch', label: '全部精修完成' },
  { key: 'raw_pack', label: '原片打包' },
  { key: 'deliver', label: '统一交付' },
  { key: 'done', label: '订单完结' }
];
const STATUS_STEP = { deposit: 2, shot: 4, selecting: 5, retouching: 7, delivered: 9, completed: 10 };
function computeStep(detail) {
  if (!detail) return 0;
  if (detail.status === 'cancelled') return -1;
  return STATUS_STEP[detail.status] ?? 2;
}

function asArr(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

// 订单详情独立路由页 /orders/:id —— 由订单中心卡片【查看订单】跳转进入
export default function OrderDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [detail, setDetail] = useState(null);
  const [pkgs, setPkgs] = useState([]);
  const [sel, setSel] = useState(null);
  const [selSaving, setSelSaving] = useState(false);
  const [pay, setPay] = useState(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(false);
  const [editForm, setEditForm] = useState({ order_name: '', groom_name: '', bride_name: '', customer_phone: '', address: '', shoot_date: '', executor: '', remark: '', status: '' });
  const [share, setShare] = useState(null);
  const [shareModal, setShareModal] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [slideOpen, setSlideOpen] = useState(false);
  const [slidePhotos, setSlidePhotos] = useState([]);
  const [notFound, setNotFound] = useState(false);

  // 新增：图片管理（原片 / 精修片 真实上传）+ 选片复用 photo_select
  const [photos, setPhotos] = useState({ raw: [], retouched: [] });
  const [imgTab, setImgTab] = useState('raw');
  const [uploading, setUploading] = useState({ raw: false, retouched: false });
  // 底部 Tab
  const [bottomTab, setBottomTab] = useState('status');
  // 分享订单小程序二维码（复用 /api/orders/:id/mini-qr）
  const [miniQr, setMiniQr] = useState(null);
  const [miniQrLoading, setMiniQrLoading] = useState(false);
  const [moreMenu, setMoreMenu] = useState(false);

  const loadSel = useCallback((oid) => {
    http.get('/api/admin/photo-select/' + oid).then((r) => setSel(r.data)).catch(() => setSel(null));
  }, []);

  const reload = useCallback(async () => {
    try {
      const r = await http.get('/api/orders/' + id);
      setDetail(r.data);
      loadSel(id);
    } catch { setNotFound(true); }
  }, [id, loadSel]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const ctrl = new AbortController();
    http.get('/api/packages?status=all', { signal: ctrl.signal }).then((r) => setPkgs(r.data)).catch(() => {});
    return () => ctrl.abort();
  }, []);
  useEffect(() => () => { bgm.pause(); }, []);

  // 订单图片（原片/精修片）随订单初始化一次（同 id 不覆盖本地编辑）
  useEffect(() => {
    if (detail && detail.order_photos) {
      setPhotos({ raw: asArr(detail.order_photos.raw), retouched: asArr(detail.order_photos.retouched) });
    }
  }, [detail && detail.id]);

  function openSlideSel() {
    if (!sel || !sel.photos.length) return;
    setSlidePhotos(sel.photos.map((p) => ({ url: img(p.photo_url) })));
    bgm.play();
    setSlideOpen(true);
  }
  function closeSlideSel() { bgm.pause(); setSlideOpen(false); }

  const toggleSel = (url) => {
    if (!sel || !sel.selection) return;
    const set = new Set(sel.selection.marks);
    if (set.has(url)) set.delete(url); else set.add(url);
    setSel({ ...sel, selection: { ...sel.selection, marks: [...set] } });
  };
  const saveSel = async () => {
    if (!sel || !detail) return;
    setSelSaving(true);
    try {
      await http.post('/api/admin/photo-select/' + detail.id, { marks: sel.selection.marks });
      loadSel(detail.id);
    } catch (e) { alert((e.response && e.response.data && e.response.data.error) || '保存失败'); }
    finally { setSelSaving(false); }
  };

  const openEdit = () => {
    if (!detail) return;
    setEditForm({
      order_name: detail.order_name || '',
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
      reload();
    } catch (e2) { alert((e2.response && e2.response.data && e2.response.data.error) || '保存失败'); }
  }
  async function removeOrder() {
    if (!confirm('确认删除该订单？\n将移入回收站，可在回收站恢复（不破坏收款流水与选片记录）。')) return;
    try { await http.delete('/api/orders/' + detail.id); nav('/orders'); }
    catch (e2) { alert((e2.response && e2.response.data && e2.response.data.error) || '删除失败'); }
  }
  async function restoreOrder() {
    if (!confirm('确认恢复该订单？')) return;
    try { await http.post('/api/orders/' + detail.id + '/restore'); reload(); }
    catch (e2) { alert((e2.response && e2.response.data && e2.response.data.error) || '恢复失败'); }
  }
  async function purgeOrder() {
    if (!confirm('确认后将永久删除，建议先做好本地备份，确定继续？')) return;
    try { await http.post('/api/orders/' + detail.id + '/purge'); nav('/orders'); }
    catch (e2) { alert((e2.response && e2.response.data && e2.response.data.error) || '彻底删除失败'); }
  }
  async function advance() {
    if (!detail) return;
    const idx = STAGE_SEQ.indexOf(detail.status);
    if (idx < 0 || idx >= STAGE_SEQ.length - 1) return;
    await http.put('/api/orders/' + detail.id, { status: STAGE_SEQ[idx + 1] });
    reload();
  }
  // 完成拍摄：直接置为「已拍摄」
  async function finishShoot() {
    if (!detail) return;
    if (detail.status !== 'deposit' && !confirm('当前阶段非「已付定金」，确认直接标记为已拍摄？')) return;
    try { await http.put('/api/orders/' + detail.id, { status: 'shot' }); reload(); }
    catch (e2) { alert((e2.response && e2.response.data && e2.response.data.error) || '操作失败'); }
  }
  async function cancel() {
    const reason = prompt('作废原因（选填）');
    if (reason === null) return;
    await http.post('/api/orders/' + detail.id + '/cancel', { reason });
    reload();
  }
  async function refund() {
    const amt = prompt('退款金额');
    if (amt === null || !amt) return;
    await http.post('/api/orders/' + detail.id + '/refund', { amount: parseFloat(amt), note: '手动退款' });
    reload();
  }
  async function savePay() {
    setErr('');
    try {
      await http.post('/api/orders/' + detail.id + '/payments', pay);
      setPay(null); reload();
    } catch (e) { setErr((e.response && e.response.data && e.response.data.error) || '登记失败'); }
  }
  async function openShare() {
    if (!detail) return;
    setShareBusy(true);
    try {
      const r = await http.post('/api/orders/' + detail.id + '/share');
      setShare(r.data); setShareModal(true); reload();
    } catch (e) { alert((e.response && e.response.data && e.response.data.error) || '生成失败'); }
    finally { setShareBusy(false); }
  }
  async function unshare() {
    if (!confirm('确认关闭该订单的分享？\n已生成的二维码将失效，客户无法再访问。')) return;
    try {
      await http.post('/api/orders/' + detail.id + '/unshare');
      setShare(null); setShareModal(false); reload();
    } catch (e) { alert((e.response && e.response.data && e.response.data.error) || '操作失败'); }
  }
  function copyShare() {
    if (!share) return;
    navigator.clipboard?.writeText(share.share_url);
    alert('分享链接已复制：\n' + share.share_url);
  }
  // 分享订单：生成微信小程序风格二维码（复用后端 /mini-qr）
  async function openMiniQr() {
    if (!detail) return;
    setMiniQrLoading(true); setMiniQr(null);
    try {
      const r = await http.post('/api/orders/' + detail.id + '/mini-qr');
      setMiniQr(r.data.qr_url || '');
    } catch (e) { alert((e.response && e.response.data && e.response.data.error) || '生成失败'); }
    finally { setMiniQrLoading(false); }
  }
  function closeMiniQr() { setMiniQr(null); }

  // —— 图片管理：原片 / 精修片 真实上传（复用现有分片上传，不新建接口） ——
  async function addPhotos(kind, fileList) {
    if (!fileList || !fileList.length) return;
    setUploading((u) => ({ ...u, [kind]: true }));
    try {
      const category = kind === 'raw' ? 'raw-negative' : 'retouched';
      const res = await uploadBatch(Array.from(fileList), { category, isPublic: false, concurrency: 3 });
      const urls = (res.urls || []).filter(Boolean);
      if (!urls.length) { if ((res.failed || []).some(Boolean)) alert('上传失败：' + (res.failed || []).filter(Boolean).join('；')); return; }
      const next = { ...photos, [kind]: [...photos[kind], ...urls] };
      setPhotos(next);
      await http.put('/api/orders/' + detail.id, { order_photos: JSON.stringify(next) });
    } catch (e) { alert((e && e.message) || '上传失败'); }
    finally { setUploading((u) => ({ ...u, [kind]: false })); }
  }
  async function removePhoto(kind, url) {
    const next = { ...photos, [kind]: photos[kind].filter((u) => u !== url) };
    setPhotos(next);
    try { await http.put('/api/orders/' + detail.id, { order_photos: JSON.stringify(next) }); }
    catch (e) { alert('保存失败'); }
  }
  function downloadFile(url) {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.download = '';
    document.body.appendChild(a); a.click(); a.remove();
  }

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
      questionnaire: arr(snap.questionnaire).length ? snap.questionnaire : arr(live.questionnaire)
    };
  }, [detail, pkgs]);

  if (notFound) {
    return (
      <div className="max-w-3xl mx-auto py-20 text-center">
        <div className="text-muted mb-4">订单不存在或已被彻底删除</div>
        <button onClick={() => nav('/orders')} className="px-4 py-2 rounded bg-brand text-white text-sm">返回订单中心</button>
      </div>
    );
  }
  if (!detail) return <div className="p-10 text-muted text-sm">加载中…</div>;

  const total = Number(detail.total_amount || 0);
  const paid = Number(detail.paid_amount || 0);
  const refundAmt = Number(detail.refund_amount || 0);
  const remain = total - paid;
  const phones = asArr(detail.phones);
  const phoneList = phones.length ? phones : (detail.customer_phone ? [detail.customer_phone] : []);
  const slots = asArr(detail.time_slots);
  const extras = asArr(detail.extra_items);
  const execs = asArr(detail.executors);
  const extraSum = extras.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const tbd = Number(detail.date_tbd) === 1;
  const payKey = detail.payment_status || 'deposit';
  const curStep = computeStep(detail);
  const logText = (detail.logs || []).map((l) => l.text || '').join(' ');
  const isStepDone = (i) => {
    if (curStep < 0) return false;
    if (i > curStep) return false;
    if (i === 1 && !logText.includes('合同')) return false; // 生成合同需日志
    if (i === 8 && photos.raw.length === 0) return false;   // 原片打包需有原片
    return true;
  };

  // 下载记录：原片 + 精修片 + 选片
  const downloadItems = [
    ...photos.raw.map((u) => ({ url: u, kind: '原片' })),
    ...photos.retouched.map((u) => ({ url: u, kind: '精修片' })),
    ...(sel && sel.photos ? sel.photos.map((p) => ({ url: p.photo_url, kind: '选片' })) : [])
  ];

  return (
    <div className="max-w-6xl mx-auto">
      {/* 面包屑 + 返回 */}
      <div className="text-xs text-muted mb-1">
        <button onClick={() => nav('/orders')} className="hover:text-brand">工作台 &gt; 订单中心</button>
        <span className="mx-1">&gt;</span>
        <span className="text-fg">订单详情</span>
      </div>

      {/* 顶部浅绿色顶边横线 */}
      <div className="rounded-xl2 overflow-hidden border border-line bg-panel">
        <div style={{ height: 4, background: '#7ecdbb' }} />

        {/* 订单编号 + 状态 */}
        <div className="flex items-center justify-between gap-4 flex-wrap px-5 pt-4">
          <div>
            <h1 className="text-2xl font-semibold text-fg">{detail.order_name || detail.order_no}</h1>
            <div className="text-xs text-faint mt-1">订单编号：{detail.order_no}</div>
          </div>
          <span className="px-3 py-1 rounded-full text-xs bg-panel2 border border-line text-muted">
            {detail.status === 'deposit' && detail.payment_status === 'unpaid' ? '未付定金' : (STATUS_LABEL[detail.status] || '历史订单')}
          </span>
        </div>

        {/* 11 步流程进度条 */}
        <div className="px-5 py-5">
          <div className="flex items-center gap-1 overflow-x-auto">
            {ORDER_STEPS.map((s, i) => {
              const done = isStepDone(i);
              const current = i === curStep && curStep >= 0;
              return (
                <React.Fragment key={s.key}>
                  <div className={'flex flex-col items-center ' + (done ? '' : 'opacity-50')}>
                    <div className={'w-3.5 h-3.5 rounded-full flex items-center justify-center ' + (done ? 'bg-brand' : 'bg-line') + (current ? ' ring-2 ring-brand/40' : '')}>
                      {done && i === curStep && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </div>
                    <span className={'text-[10px] mt-1 whitespace-nowrap ' + (current ? 'text-brand font-medium' : 'text-muted')}>{s.label}</span>
                  </div>
                  {i < ORDER_STEPS.length - 1 && <div className={'flex-1 h-0.5 min-w-[12px] ' + (i < curStep ? 'bg-brand' : 'bg-line')} />}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* 主体：左侧垂直按钮组 + 右侧内容 */}
        <div className="flex gap-4 px-5 pb-5 items-start">
          {/* 左侧垂直按钮组 */}
          <div className="flex flex-col items-stretch gap-2 w-32 shrink-0">
            <button onClick={finishShoot} disabled={detail.status === 'cancelled'}
              className="px-3 py-2 rounded-lg bg-brand text-white text-sm disabled:opacity-40">完成拍摄</button>
            <div className="relative">
              <button onClick={openMiniQr} disabled={miniQrLoading}
                className="w-full px-3 py-2 rounded-lg bg-white border border-line text-fg text-sm hover:border-brand disabled:opacity-40">分享订单</button>
              {miniQr !== null && (
                <>
                  <div className="fixed inset-0 z-40 bg-black/30" onClick={closeMiniQr} />
                  <div onClick={(e) => e.stopPropagation()}
                    className="absolute bottom-full right-0 mb-2 z-50 w-60 bg-white rounded-xl p-4 shadow-2xl">
                    <div className="text-fg font-medium mb-2">订单二维码</div>
                    {miniQr ? (
                      <img src={miniQr} alt="订单二维码" className="w-44 h-44 mx-auto rounded-lg" />
                    ) : (
                      <div className="text-muted text-sm py-8 text-center">生成中…</div>
                    )}
                    <div className="text-[11px] text-muted text-center mt-2">微信扫码查看订单（右键 / 长按可保存）</div>
                  </div>
                </>
              )}
            </div>
            <button onClick={cancel} className="px-3 py-2 rounded-lg bg-white border border-line text-red-400 text-sm">关闭订单</button>
            <div className="relative">
              <button onClick={() => setMoreMenu((m) => !m)}
                className="w-full px-3 py-2 rounded-lg bg-white border border-line text-fg text-sm hover:border-brand">更多设置</button>
              {moreMenu && (
                <div className="absolute top-full right-0 mt-1 z-50 w-36 bg-white border border-line rounded-lg shadow-xl py-1 text-sm">
                  <button onClick={() => { setMoreMenu(false); openEdit(); }} className="block w-full text-left px-3 py-2 hover:bg-panel2">编辑订单</button>
                  <button onClick={() => { setMoreMenu(false); setPay({ type: 'deposit', amount: '', method: 'offline', note: '' }); }} className="block w-full text-left px-3 py-2 hover:bg-panel2">+ 收款</button>
                  <button onClick={() => { setMoreMenu(false); refund(); }} className="block w-full text-left px-3 py-2 hover:bg-panel2">退款</button>
                  {!detail.is_deleted
                    ? <button onClick={() => { setMoreMenu(false); removeOrder(); }} className="block w-full text-left px-3 py-2 hover:bg-panel2 text-red-400">删除</button>
                    : <button onClick={() => { setMoreMenu(false); restoreOrder(); }} className="block w-full text-left px-3 py-2 hover:bg-panel2 text-emerald-400">恢复</button>}
                </div>
              )}
            </div>
          </div>

          {/* 右侧内容列 */}
          <div className="flex-1 min-w-0 space-y-4">
            {/* 金额 */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-panel2 border border-line rounded-xl2 p-4"><div className="text-xs text-muted">应收</div><div className="text-fg text-lg font-semibold">¥{total.toLocaleString()}</div></div>
              <div className="bg-panel2 border border-line rounded-xl2 p-4"><div className="text-xs text-muted">已收</div><div className="text-emerald-400 text-lg font-semibold">¥{paid.toLocaleString()}</div></div>
              <div className="bg-panel2 border border-line rounded-xl2 p-4"><div className="text-xs text-muted">待收 / 退款</div><div className="text-fg text-lg font-semibold">{refundAmt > 0 ? '退¥' + refundAmt.toLocaleString() : '¥' + remain.toLocaleString()}</div></div>
            </div>

            {/* 客户与订单基础信息卡片 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-panel border border-line rounded-xl2 p-4 text-sm space-y-2.5">
                <div className="text-fg font-medium">客户与订单信息</div>
                {(detail.groom_name || detail.bride_name) ? (
                  <div className="flex gap-2"><span className="text-muted shrink-0 w-16">客户</span>
                    <span className="text-fg flex-1">{[detail.groom_name, detail.bride_name].filter(Boolean).join(' & ')}</span></div>
                ) : detail.customer_name && (
                  <div className="flex gap-2"><span className="text-muted shrink-0 w-16">客户</span><span className="text-fg flex-1">{detail.customer_name}</span></div>
                )}
                <div className="flex gap-2">
                  <span className="text-muted shrink-0 w-16">联系电话</span>
                  <span className="flex-1 flex flex-wrap gap-1.5">
                    {phoneList.length === 0 ? <span className="text-muted">—</span> : phoneList.map((p, i) => (
                      <a key={i} href={'tel:' + p} className="px-1.5 py-0.5 rounded bg-panel2 border border-line text-fg text-xs hover:text-brand">{p}</a>
                    ))}
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted shrink-0 w-16">档期时间</span>
                  <span className="flex-1">
                    {tbd ? <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 text-xs border border-amber-500/20">日期待定（不占用日历档期）</span>
                      : <><span className="text-fg">{detail.shoot_date || '—'}</span>
                        {slots.length > 0 && <span className="flex flex-wrap gap-1 mt-1">{slots.map((h, i) => (<span key={i} className="px-1.5 py-0.5 rounded bg-panel2 border border-line text-fg text-[11px]">{h}</span>))}</span>}</>}
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted shrink-0 w-16">收款状态</span>
                  <span className={'flex-1 ' + (PAY_STATUS_COLOR[payKey] || 'text-fg')}>{PAY_STATUS_LABEL[payKey] || payKey}</span>
                </div>
                {execs.length > 0 && (
                  <div className="flex gap-2">
                    <span className="text-muted shrink-0 w-16">参与者</span>
                    <span className="flex-1 flex flex-wrap gap-2">
                      {execs.map((p, i) => (
                        <span key={i} className="flex items-center gap-1.5 px-1.5 py-0.5 rounded-full bg-panel2 border border-line">
                          {p.avatar ? <img src={img(p.avatar)} alt="" className="w-5 h-5 rounded-full object-cover" />
                            : <span className="w-5 h-5 rounded-full bg-brand/20 text-brand text-[10px] flex items-center justify-center">{String(p.name || '?').slice(0, 1)}</span>}
                          <span className="text-fg text-xs">{p.name}</span>
                        </span>
                      ))}
                    </span>
                  </div>
                )}
                {detail.address && <div className="flex gap-2"><span className="text-muted shrink-0 w-16">拍摄地点</span><span className="text-fg flex-1 break-all">{detail.address}</span></div>}
                <div className="flex gap-2">
                  <span className="text-muted shrink-0 w-16">备注</span>
                  <span className="text-fg flex-1 whitespace-pre-line break-all">{detail.remark || '无'}</span>
                </div>
              </div>

              {/* 套系信息 */}
              {pkgInfo && pkgInfo.name && pkgInfo.name !== '—' && (
                <div className="bg-panel border border-line rounded-xl2 p-4 text-sm">
                  <div className="text-fg font-medium mb-2">套系信息</div>
                  <div className="flex gap-3 mb-3">
                    {pkgInfo.cover_url && <img src={img(pkgInfo.cover_url)} alt="cover" className="w-20 h-20 rounded-lg object-cover border border-line flex-shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="text-base text-fg font-semibold mb-1">{pkgInfo.name}</div>
                      {pkgInfo.spec && pkgInfo.spec.name && <div className="text-xs text-emerald-400 mb-1.5">已选规格：{pkgInfo.spec.name}</div>}
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                        {pkgInfo.price !== undefined && pkgInfo.price !== '' && (<div><span className="text-muted">套系总价</span> <span className="text-fg ml-1">¥{Number(pkgInfo.price || 0).toLocaleString()}</span></div>)}
                        {pkgInfo.deposit !== undefined && pkgInfo.deposit !== '' && (<div><span className="text-muted">定金</span> <span className="text-fg ml-1">¥{Number(pkgInfo.deposit || 0).toLocaleString()}</span></div>)}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs mb-2">
                    {pkgInfo.duration !== undefined && pkgInfo.duration !== '' && (<div><span className="text-muted">拍摄时长</span> <span className="text-fg ml-1">{pkgInfo.duration}</span></div>)}
                    {pkgInfo.retouch_count !== undefined && pkgInfo.retouch_count !== '' && (<div><span className="text-muted">精修张数</span> <span className="text-fg ml-1">{pkgInfo.retouch_count}</span></div>)}
                    {pkgInfo.raw_policy !== undefined && pkgInfo.raw_policy !== '' && (<div className="col-span-2"><span className="text-muted">底片政策</span> <span className="text-fg ml-1">{pkgInfo.raw_policy}</span></div>)}
                  </div>
                  {pkgInfo.description && <div className="text-xs text-muted whitespace-pre-line leading-relaxed mt-2">{pkgInfo.description}</div>}
                </div>
              )}
            </div>

            {/* 浅米绿色服务详情信息条 */}
            <div className="rounded-xl2 px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm"
              style={{ background: '#eaf5ef', border: '1px solid #cfe9dd' }}>
              <span className="text-emerald-700 font-medium">服务详情</span>
              <span className="text-emerald-900/80">套系：{pkgInfo && pkgInfo.name && pkgInfo.name !== '—' ? pkgInfo.name : '—'}</span>
              {pkgInfo && pkgInfo.duration !== undefined && pkgInfo.duration !== '' && <span className="text-emerald-900/80">拍摄时长：{pkgInfo.duration}</span>}
              {pkgInfo && pkgInfo.retouch_count !== undefined && pkgInfo.retouch_count !== '' && <span className="text-emerald-900/80">精修：{pkgInfo.retouch_count} 张</span>}
              {pkgInfo && pkgInfo.raw_policy !== undefined && pkgInfo.raw_policy !== '' && <span className="text-emerald-900/80">底片：{pkgInfo.raw_policy}</span>}
            </div>

            {/* 图片管理 Tab */}
            <div className="bg-panel border border-line rounded-xl2">
              <div className="flex border-b border-line">
                {[{ k: 'raw', t: '原片' }, { k: 'sel', t: '选片' }, { k: 'retouched', t: '精修片' }].map((tb) => (
                  <button key={tb.k} onClick={() => setImgTab(tb.k)}
                    className={'px-5 py-3 text-sm border-b-2 -mb-px ' + (imgTab === tb.k ? 'border-brand text-brand font-medium' : 'border-transparent text-muted hover:text-fg')}>
                    {tb.t}{tb.k === 'raw' ? `（${photos.raw.length}）` : tb.k === 'retouched' ? `（${photos.retouched.length}）` : ''}
                  </button>
                ))}
              </div>
              <div className="p-4">
                {imgTab === 'raw' && (
                  <PhotoZone kind="raw" title="原片" photos={photos.raw} uploading={uploading.raw}
                    onAdd={(files) => addPhotos('raw', files)} onRemove={(u) => removePhoto('raw', u)} />
                )}
                {imgTab === 'sel' && (
                  <div>
                    <div className="text-xs text-muted mb-2 flex items-center justify-between">
                      <span>选片（来自客户相册选片结果，可在此勾选确认）</span>
                      {sel && sel.selection && <span className={sel.selection.submitted ? 'text-emerald-400' : 'text-amber-400'}>{sel.selection.submitted ? '已提交' : '草稿'}</span>}
                    </div>
                    {!sel && <div className="text-muted text-sm py-2">加载中…</div>}
                    {sel && !sel.selection && <div className="text-muted text-sm py-2">该订单暂无客户选片</div>}
                    {sel && sel.selection && (
                      <>
                        <div className="grid grid-cols-4 md:grid-cols-6 gap-2 mb-3">
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
                          <button onClick={saveSel} disabled={selSaving} className="px-3 py-1.5 rounded bg-brand text-white text-xs disabled:opacity-40">保存修改</button>
                        </div>
                      </>
                    )}
                  </div>
                )}
                {imgTab === 'retouched' && (
                  <PhotoZone kind="retouched" title="精修片" photos={photos.retouched} uploading={uploading.retouched}
                    onAdd={(files) => addPhotos('retouched', files)} onRemove={(u) => removePhoto('retouched', u)} />
                )}
              </div>
            </div>

            {/* 底部 Tab：订单状态详情 / 交易记录 / 下载记录 */}
            <div className="bg-panel border border-line rounded-xl2">
              <div className="flex border-b border-line">
                {[{ k: 'status', t: '订单状态详情' }, { k: 'trade', t: '交易记录' }, { k: 'download', t: '下载记录' }].map((tb) => (
                  <button key={tb.k} onClick={() => setBottomTab(tb.k)}
                    className={'px-5 py-3 text-sm border-b-2 -mb-px ' + (bottomTab === tb.k ? 'border-brand text-brand font-medium' : 'border-transparent text-muted hover:text-fg')}>
                    {tb.t}
                  </button>
                ))}
              </div>
              <div className="p-4 text-sm space-y-3">
                {bottomTab === 'status' && (
                  <>
                    {detail.package_snapshot && Array.isArray(detail.package_snapshot.questionnaire) && detail.package_snapshot.questionnaire.length > 0 && (() => {
                      let ans = {};
                      try { ans = detail.questionnaire_answers ? (typeof detail.questionnaire_answers === 'string' ? JSON.parse(detail.questionnaire_answers) : detail.questionnaire_answers) : {}; } catch { ans = {}; }
                      const qs = detail.package_snapshot.questionnaire;
                      return (
                        <div>
                          <div className="text-fg font-medium mb-2">客户问卷</div>
                          <div className="space-y-2">
                            {qs.map((q, i) => (
                              <div key={i}>
                                <div className="text-muted">{i + 1}. {q.q}{q.required ? ' *' : ''}</div>
                                <div className="text-fg mt-0.5">
                                  {ans[i] !== undefined && ans[i] !== '' && !(Array.isArray(ans[i]) && ans[i].length === 0)
                                    ? (Array.isArray(ans[i]) ? ans[i].join('、') : ans[i]) : <span className="text-muted">（未填写）</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                    <div>
                      <div className="text-fg font-medium mb-2">操作日志</div>
                      <div className="text-xs text-muted space-y-1">
                        {(detail.logs || []).length === 0 && <div className="py-2">暂无日志</div>}
                        {(detail.logs || []).map((l, i) => (<div key={i}>· {new Date(l.t).toLocaleString('zh-CN')} {l.text}</div>))}
                      </div>
                    </div>
                  </>
                )}
                {bottomTab === 'trade' && (
                  <div>
                    <div className="text-fg font-medium mb-2">收款流水</div>
                    {(!detail.payments || detail.payments.length === 0) && <div className="text-muted py-2">暂无流水</div>}
                    {detail.payments && detail.payments.map((p) => (
                      <div key={p.id} className="flex items-center justify-between border-b border-line py-2">
                        <div>
                          <span className="text-fg">{TYPE_LABEL[p.type]}</span>
                          <span className="text-muted ml-2">{p.method === 'online' ? '线上' : '线下'}</span>
                        </div>
                        <div className={p.type === 'refund' ? 'text-red-400' : 'text-emerald-400'}>
                          {p.type === 'refund' ? '-' : '+'}¥{Number(p.amount).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {bottomTab === 'download' && (
                  <div>
                    <div className="text-fg font-medium mb-2">可下载素材（原片 / 精修片 / 选片）</div>
                    {downloadItems.length === 0 && <div className="text-muted py-2">暂无素材（请在上方可片/原片/精修片 Tab 上传）</div>}
                    <div className="space-y-1">
                      {downloadItems.map((it, i) => (
                        <div key={i} className="flex items-center justify-between border-b border-line py-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="px-1.5 py-0.5 rounded bg-panel2 border border-line text-[11px] text-muted shrink-0">{it.kind}</span>
                            <span className="text-fg text-xs truncate">{it.url}</span>
                          </div>
                          <button onClick={() => downloadFile(it.url)} className="px-2 py-1 rounded border border-line text-xs text-fg hover:border-brand shrink-0">下载</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 收款弹窗 */}
      {pay && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[70] p-4" onClick={() => setPay(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm bg-panel border border-line rounded-xl2 p-6">
            <div className="text-fg font-medium mb-4">登记收款 · {detail.order_no}</div>
            <select value={pay.type} onChange={(e) => setPay({ ...pay, type: e.target.value })} className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-fg text-sm outline-none">
              <option value="deposit">定金</option><option value="balance">尾款</option><option value="extra">加片/增值</option>
            </select>
            <input value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} type="number" placeholder="金额"
              className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-fg text-sm outline-none" />
            <select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })} className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-fg text-sm outline-none">
              <option value="offline">线下</option><option value="online">线上</option>
            </select>
            <input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} placeholder="备注(选填)"
              className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-fg text-sm outline-none" />
            {err && <div className="text-xs text-red-400 mb-2">{err}</div>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setPay(null)} className="px-4 py-2 rounded text-sm text-muted">取消</button>
              <button onClick={savePay} className="px-4 py-2 rounded bg-brand text-white text-sm">保存</button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑订单弹窗 */}
      {edit && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[70] p-4" onClick={() => setEdit(false)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={saveEdit} className="w-full max-w-md bg-panel border border-line rounded-xl2 p-6">
            <div className="text-fg font-medium mb-4">编辑订单 · {detail.order_no}</div>
            <input value={editForm.order_name} onChange={(e) => setEditForm({ ...editForm, order_name: e.target.value })} placeholder="订单名称"
              className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-fg text-sm outline-none" />
            <div className="grid grid-cols-2 gap-3">
              <input value={editForm.groom_name} onChange={(e) => setEditForm({ ...editForm, groom_name: e.target.value })} placeholder="新郎姓名"
                className="px-3 py-2 rounded bg-panel2 border border-line text-fg text-sm outline-none" />
              <input value={editForm.bride_name} onChange={(e) => setEditForm({ ...editForm, bride_name: e.target.value })} placeholder="新娘姓名"
                className="px-3 py-2 rounded bg-panel2 border border-line text-fg text-sm outline-none" />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <input value={editForm.customer_phone} onChange={(e) => setEditForm({ ...editForm, customer_phone: e.target.value })} placeholder="联系电话"
                className="px-3 py-2 rounded bg-panel2 border border-line text-fg text-sm outline-none" />
              <input value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} placeholder="拍摄地址"
                className="px-3 py-2 rounded bg-panel2 border border-line text-fg text-sm outline-none" />
            </div>
            <input value={editForm.shoot_date} onChange={(e) => setEditForm({ ...editForm, shoot_date: e.target.value })} type="date"
              className="w-full mt-3 px-3 py-2 rounded bg-panel2 border border-line text-fg text-sm outline-none" />
            <input value={editForm.executor} onChange={(e) => setEditForm({ ...editForm, executor: e.target.value })} placeholder="执行人"
              className="w-full mt-3 px-3 py-2 rounded bg-panel2 border border-line text-fg text-sm outline-none" />
            <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
              className="w-full mt-3 px-3 py-2 rounded bg-panel2 border border-line text-fg text-sm outline-none">
              <option value="deposit">已付定金</option><option value="shot">已拍摄</option>
              <option value="selecting">选片中</option><option value="retouching">精修中</option><option value="delivered">已交付</option>
              <option value="completed">已完成</option><option value="cancelled">已作废</option>
            </select>
            <input value={editForm.remark} onChange={(e) => setEditForm({ ...editForm, remark: e.target.value })} placeholder="备注"
              className="w-full mt-3 px-3 py-2 rounded bg-panel2 border border-line text-fg text-sm outline-none" />
            <div className="flex gap-2 justify-end mt-4">
              <button type="button" onClick={() => setEdit(false)} className="px-4 py-2 rounded text-sm text-muted">取消</button>
              <button type="submit" className="px-4 py-2 rounded bg-brand text-white text-sm">保存</button>
            </div>
          </form>
        </div>
      )}

      {/* 客户影集分享弹窗 */}
      {shareModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[80] p-4" onClick={() => setShareModal(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm bg-panel border border-line rounded-xl2 p-6 text-center">
            <div className="text-fg font-medium mb-1">客户影集分享</div>
            <div className="text-xs text-muted mb-4">扫码或复制链接，客户即可在手机上查看成品影集（仅展示样片/成片，不含原片）</div>
            {share && share.qr_url ? (
              <>
                <img src={share.qr_url} alt="分享二维码" className="w-56 h-56 mx-auto rounded-lg bg-white p-2 border border-line" />
                <div className="text-xs text-muted mt-3 break-all">{share.share_url}</div>
                <div className="flex gap-2 justify-center mt-4">
                  <button onClick={copyShare} className="px-3 py-1.5 rounded bg-brand text-white text-xs">复制链接</button>
                  <button onClick={openShare} disabled={shareBusy} className="px-3 py-1.5 rounded bg-white border border-line text-fg text-xs disabled:opacity-40">刷新二维码</button>
                  <button onClick={unshare} className="px-3 py-1.5 rounded bg-white border border-line text-red-400 text-xs">关闭分享</button>
                </div>
              </>
            ) : (<div className="text-muted text-sm py-8">生成中…</div>)}
            <button onClick={() => setShareModal(false)} className="mt-4 px-4 py-2 rounded text-sm text-muted">关闭</button>
          </div>
        </div>
      )}

      <Slideshow photos={slidePhotos} open={slideOpen} onClose={closeSlideSel} title={detail.order_name || '订单相册'} />
    </div>
  );
}

// 图片上传区域（原片 / 精修片 真实上传）
function PhotoZone({ kind, title, photos, uploading, onAdd, onRemove }) {
  const inputRef = React.useRef(null);
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-fg font-medium">{title}（{photos.length}）</span>
        <button onClick={() => inputRef.current?.click()}
          className="px-3 py-1.5 rounded bg-brand text-white text-xs disabled:opacity-40">
          {uploading ? '上传中…' : '+ 上传' + title}
        </button>
        <input ref={inputRef} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => { onAdd(e.target.files); e.target.value = ''; }} />
      </div>
      {photos.length === 0 && !uploading && (
        <div className="border border-dashed border-line rounded-xl py-10 text-center text-muted text-sm cursor-pointer"
          onClick={() => inputRef.current?.click()}>
          <div className="text-3xl mb-1">+</div>
          点击或拖拽上传{title}（支持批量）
        </div>
      )}
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
        {photos.map((u, i) => (
          <div key={i} className="relative group">
            <img src={img(u)} className="w-full h-28 object-cover rounded-lg border border-line" />
            <button onClick={() => onRemove(u)}
              className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100">✕</button>
          </div>
        ))}
        {uploading && <div className="w-full h-28 rounded-lg border border-dashed border-line flex items-center justify-center text-muted text-xs">上传中…</div>}
      </div>
    </div>
  );
}
