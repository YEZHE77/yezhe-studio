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

// 订单详情 11 步流程进度条（顺序固定，状态/时间戳完全由后端接口驱动，不写死）
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
// 每一步对应后端 logs 中的关键字（用于回显接口返回的真实完成时间，禁止写死）
const STEP_LOG_KW = [
  ['下单', '创建订单', '生成订单', '创建'],               // 订单生成
  ['合同'],                                              // 生成合同
  ['沟通', '确认'],                                      // 沟通确认
  ['拍摄执行', '开始拍摄', '执行拍摄'],                    // 拍摄执行
  ['拍摄结束', '拍摄完成'],                                // 拍摄结束
  ['选片', '进入选片'],                                    // 选片精修
  ['预告片', '预告'],                                     // 预告片输出
  ['全部精修', '精修完成'],                                 // 全部精修完成
  ['原片打包', '原片上传', '打包'],                         // 原片打包
  ['统一交付', '交付'],                                    // 统一交付
  ['订单完结', '订单完成', '完结']                          // 订单完结
];
function fmtStepTime(t) {
  if (!t) return null;
  const d = new Date(t);
  if (isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function findStepTime(logs, i) {
  const kws = STEP_LOG_KW[i] || [];
  for (const kw of kws) {
    const hit = (logs || []).find((l) => (l.text || '').includes(kw));
    if (hit && hit.t) return fmtStepTime(hit.t);
  }
  return null;
}
// 由后端 订单 status / logs / 原片 派生 11 步状态（done / current / pending）
function buildSteps(detail, photos, logs) {
  if (!detail || detail.status === 'cancelled')
    return ORDER_STEPS.map((s) => ({ ...s, state: 'pending', time: null }));
  const cur = computeStep(detail);
  return ORDER_STEPS.map((s, i) => {
    let state = i < cur ? 'done' : i === cur ? 'current' : 'pending';
    if (state === 'done') {
      if (s.key === 'contract' && !((logs || []).some((l) => (l.text || '').includes('合同')))) state = 'pending';
      if (s.key === 'raw_pack' && (!photos || photos.raw.length === 0)) state = 'pending';
    }
    const time = state === 'done' ? findStepTime(logs, i) : null;
    return { ...s, state, time };
  });
}

// spec 全局色号
const MINT = '#48c8b0';   // 主题薄荷绿 / 已完成节点 / 顶线 / 查看记录 / 调查问卷
const BLUE = '#2b88e6';   // 主蓝色 / 当前节点 / 完成拍摄 / Tab 选中
const DIV = '#e5e7eb';    // 分割线
const CARD_SHADOW = '0 1px 4px rgba(0,0,0,0.06)';

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

  // 下载记录：原片 + 精修片 + 选片
  const downloadItems = [
    ...photos.raw.map((u) => ({ url: u, kind: '原片' })),
    ...photos.retouched.map((u) => ({ url: u, kind: '精修片' })),
    ...(sel && sel.photos ? sel.photos.map((p) => ({ url: p.photo_url, kind: '选片' })) : [])
  ];

  const steps = buildSteps(detail, photos, detail.logs);
  const statusText =
    (detail.payment_status === 'unpaid' ? '未付定金' : (PAY_STATUS_LABEL[payKey] || '')) +
    (detail.status ? '，' + (STATUS_LABEL[detail.status] || '') : '');
  const custName = ([detail.groom_name, detail.bride_name].filter(Boolean).join(' & ') || detail.customer_name || '—');
  const custInitial = (custName && custName !== '—') ? custName.slice(0, 1) : '客';
  const offlinePay = detail.pay_method === 'offline' || detail.channel === 'offline' || detail.source === 'offline';

  const CheckIcon = () => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4 10-10" /></svg>
  );

  return (
    <div style={{ background: '#f5f7fa' }}>
      {/* ============ Module 3：订单头部操作栏 ============ */}
      <section style={{ background: '#ffffff', borderTop: '3px solid ' + MINT, borderBottom: '1px solid ' + DIV, borderRadius: 6, overflow: 'hidden' }}>
        <div style={{ padding: '16px 24px' }}>
          {/* 顶行：左 订单编号 / 右 状态 + 查看记录 */}
          <div className="flex items-center justify-between" style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 14, color: '#333333' }}>
              订单编号：<span style={{ fontWeight: 500 }}>{detail.order_no}</span>
            </div>
            <div className="flex items-center gap-3" style={{ fontSize: 14, color: '#666666' }}>
              <span>{statusText}</span>
              <button type="button" onClick={() => { setBottomTab('status'); }}
                style={{ color: MINT, background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}>查看记录</button>
            </div>
          </div>

          {/* 主体：左 垂直按钮组 + 右 4 步进度条 */}
          <div className="flex items-start" style={{ gap: 32 }}>
            {/* 左侧垂直按钮组 */}
            <div className="flex flex-col shrink-0" style={{ width: 140, gap: 12 }}>
              <button type="button" onClick={finishShoot} disabled={detail.status === 'cancelled'}
                style={{ width: 140, height: 40, borderRadius: 4, background: BLUE, color: '#fff', fontSize: 14, border: 'none', opacity: detail.status === 'cancelled' ? 0.4 : 1, cursor: 'pointer' }}>完成拍摄</button>
              <button type="button" onClick={openMiniQr} disabled={miniQrLoading}
                style={{ width: 140, height: 40, borderRadius: 4, background: '#222222', color: '#fff', fontSize: 14, border: 'none', cursor: 'pointer', opacity: miniQrLoading ? 0.6 : 1 }}>分享订单</button>
              <button type="button" onClick={cancel}
                style={{ background: 'none', border: 'none', color: '#666666', fontSize: 14, textAlign: 'left', cursor: 'pointer', padding: 0 }}>关闭订单</button>
              <button type="button" onClick={() => setMoreMenu((m) => !m)}
                style={{ background: 'none', border: 'none', color: '#666666', fontSize: 14, textAlign: 'left', cursor: 'pointer', padding: 0, position: 'relative' }}>更多设置</button>
              {moreMenu && (
                <div style={{ position: 'absolute', zIndex: 50, marginTop: 4, background: '#fff', border: '1px solid ' + DIV, borderRadius: 4, boxShadow: '0 6px 20px rgba(0,0,0,0.10)', padding: '4px 0', fontSize: 14, width: 140 }}>
                  <button type="button" onClick={() => { setMoreMenu(false); openEdit(); }} style={moreItemStyle}>编辑订单</button>
                  <button type="button" onClick={() => { setMoreMenu(false); setPay({ type: 'deposit', amount: '', method: 'offline', note: '' }); }} style={moreItemStyle}>+ 收款</button>
                  <button type="button" onClick={() => { setMoreMenu(false); refund(); }} style={moreItemStyle}>退款</button>
                  {!detail.is_deleted
                    ? <button type="button" onClick={() => { setMoreMenu(false); removeOrder(); }} style={{ ...moreItemStyle, color: '#ef4444' }}>删除</button>
                    : <button type="button" onClick={() => { setMoreMenu(false); restoreOrder(); }} style={{ ...moreItemStyle, color: '#10b981' }}>恢复</button>}
                </div>
              )}
            </div>

            {/* 右侧 11 步横向流程进度条（由后端 status/logs/原片 驱动，支持横向滚动） */}
            <div className="flex-1" style={{ minWidth: 0 }}>
              <div style={{ overflowX: 'auto', overflowY: 'hidden' }}>
                <div className="flex items-start" style={{ gap: 0, padding: '8px 0', minWidth: 'max-content' }}>
                  {steps.map((st, i) => (
                    <React.Fragment key={st.key}>
                      <div className="flex flex-col items-center" style={{ width: 116, flexShrink: 0 }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: '50%',
                          background: (st.state === 'done' || st.state === 'current') ? BLUE : '#ffffff',
                          border: (st.state === 'done' || st.state === 'current') ? 'none' : '2px solid #cccccc',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff'
                        }}>
                          {st.state === 'done' ? <CheckIcon /> : st.state === 'current' ? <span style={{ fontSize: 13, fontWeight: 600 }}>{i + 1}</span> : null}
                        </div>
                        <span style={{ fontSize: 13, marginTop: 8, textAlign: 'center', color: st.state === 'pending' ? '#999999' : '#111111', fontWeight: st.state === 'current' ? 600 : 400 }}>{st.label}</span>
                        {st.time ? <span style={{ fontSize: 12, marginTop: 4, textAlign: 'center', color: '#666666' }}>{st.time}</span> : null}
                      </div>
                      {i < steps.length - 1 && (
                        <div style={{ flex: 1, height: 2, minWidth: 40, marginTop: 13, background: st.state === 'done' ? BLUE : '#e2e2e2' }} />
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ Module 4：客户 & 订单信息卡片 ============ */}
      <section style={{ margin: '16px 24px 0', background: '#ffffff', borderRadius: 6, boxShadow: CARD_SHADOW, padding: 24 }}>
        {/* 顶部：左客户模块 / 右按钮组 */}
        <div className="flex items-start justify-between" style={{ gap: 24 }}>
          <div className="flex items-start" style={{ gap: 12 }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#ede9fe', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7c3aed', fontSize: 18, fontWeight: 600, flexShrink: 0 }}>
              {custInitial}
            </div>
            <div>
              <div className="flex items-center" style={{ gap: 8 }}>
                <span style={{ background: '#fef2f2', color: '#ef4444', fontSize: 12, borderRadius: 4, padding: '2px 6px' }}>客户信息</span>
                <span style={{ fontSize: 16, color: '#222222', fontWeight: 500 }}>{custName}</span>
              </div>
              <div style={{ marginTop: 16, width: 160, height: 120, borderRadius: 4, overflow: 'hidden', background: '#f3f4f6' }}>
                {pkgInfo && pkgInfo.cover_url
                  ? <img src={img(pkgInfo.cover_url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: 12 }}>套系缩略图</div>}
              </div>
            </div>
          </div>

          {/* 右上角按钮组 */}
          <div className="flex items-center" style={{ gap: 12 }}>
            <button type="button" onClick={() => setBottomTab('status')}
              style={{ height: 36, borderRadius: 4, background: MINT, color: '#fff', fontSize: 14, border: 'none', padding: '0 14px', cursor: 'pointer' }}>调查问卷</button>
            <button type="button" onClick={openEdit}
              style={secBtnStyle}>编辑订单</button>
            <button type="button" onClick={() => setPay({ type: 'extra', amount: '', method: 'offline', note: '' })}
              style={secBtnStyle}>加片设置</button>
            <button type="button" onClick={() => setMoreMenu((m) => !m)}
              style={secBtnStyle}>更多设置</button>
          </div>
        </div>

        {/* 中部：双列信息区 */}
        <div className="grid grid-cols-2" style={{ gap: '14px 40px', marginTop: 24 }}>
          <InfoRow label="套系名称" value={pkgInfo && pkgInfo.name && pkgInfo.name !== '—' ? pkgInfo.name : '—'} />
          <InfoRow label="定金" value={'¥' + Number(pkgInfo?.deposit || 0).toLocaleString()} />
          <InfoRow label="已付加片费" value={'¥' + extraSum.toLocaleString()} />
          <InfoRow label="渠道来源" value={detail.channel || detail.source || '—'} />
          <InfoRow label="拍摄时间" value={tbd ? '日期待定' : (detail.shoot_date || '—')} extra={slots} />
          <InfoRow label="尾款" value={'¥' + remain.toLocaleString()} />
          <InfoRow label="拍摄地址" value={detail.address || '—'} />
          <InfoRow label="客户" value={custName} />
          <InfoRow label="联系电话" value={phoneList.length ? phoneList.join(' / ') : '—'} />
          <InfoRow label="收款状态" value={PAY_STATUS_LABEL[payKey] || payKey}
            tags={[
              offlinePay ? { t: '线下收取', bg: '#d1fae5', fg: '#065f46' } : null,
              remain > 0 ? { t: '未结算', bg: '#fef3c7', fg: '#92400e' } : null
            ].filter(Boolean)} />
          <InfoRow label="参与者" value={execs.length ? execs.map((p) => p.name).join('、') : '—'} />
          <InfoRow label="备注" value={detail.remark || '无'} />
        </div>

        {/* 底部摘要栏 */}
        <div style={{ marginTop: 20, background: '#f9fafb', borderRadius: 4, padding: '16px 20px' }}>
          <div className="flex items-stretch" style={{ flexWrap: 'wrap' }}>
            {[
              { t: '总价', v: '¥' + total.toLocaleString() },
              { t: '拍摄时长', v: pkgInfo?.duration ? String(pkgInfo.duration) : '—' },
              { t: '服务详情', v: pkgInfo?.description ? String(pkgInfo.description).slice(0, 16) : '—' },
              { t: '拍摄张数', v: pkgInfo?.raw_count ? String(pkgInfo.raw_count) + ' 张' : '—' },
              { t: '底片全送', v: pkgInfo?.raw_policy ? String(pkgInfo.raw_policy) : '—' },
              { t: '精修张数', v: pkgInfo?.retouch_count ? String(pkgInfo.retouch_count) + ' 张' : '—' },
              { t: '加片费', v: '¥' + extraSum.toLocaleString() }
            ].map((f, i, arr) => (
              <div key={f.t} style={{ flex: '1 1 0', minWidth: 110, padding: '0 12px', borderLeft: i === 0 ? 'none' : '1px solid ' + DIV }}>
                <div style={{ fontSize: 13, color: '#777777' }}>{f.t}</div>
                <div style={{ fontSize: 14, color: '#222222', marginTop: 4 }}>{f.v}</div>
              </div>
            ))}
          </div>
          {detail.remark ? (
            <div style={{ marginTop: 12, fontSize: 14, color: '#666666' }}>备注：{detail.remark}</div>
          ) : null}
        </div>
      </section>

      {/* ============ Module 5：底片上传 Tab 卡片 ============ */}
      <section style={{ margin: '24px 24px 0', background: '#ffffff', borderRadius: 6 }}>
        {/* Tab 头部 */}
        <div className="flex" style={{ height: 44, borderBottom: '1px solid ' + DIV }}>
          {[{ k: 'raw', t: '原片' }, { k: 'sel', t: '选片' }, { k: 'retouched', t: '精修片' }].map((tb) => {
            const active = imgTab === tb.k;
            const count = tb.k === 'raw' ? photos.raw.length : tb.k === 'retouched' ? photos.retouched.length : (sel && sel.photos ? sel.photos.length : 0);
            return (
              <button key={tb.k} type="button" onClick={() => setImgTab(tb.k)}
                style={{
                  padding: '0 20px', height: 44, background: 'none', border: 'none', cursor: 'pointer', fontSize: 14,
                  color: active ? BLUE : '#666666',
                  borderBottom: active ? '2px solid ' + BLUE : '2px solid transparent', fontWeight: active ? 500 : 400
                }}>{tb.t}（{count}）</button>
            );
          })}
        </div>

        <div style={{ padding: '12px 24px 24px' }}>
          {/* 提示警告条 */}
          <div style={{ background: '#fffde7', color: '#b58900', fontSize: 13, padding: '8px 16px' }}>
            请先上传完整原片后再通知客户选片；精修片交付前请确认已通过全部精修。
          </div>

          {/* 筛选操作栏 */}
          <div className="flex items-center" style={{ height: 40, marginTop: 12, gap: 12, fontSize: 14, color: '#444444', flexWrap: 'wrap' }}>
            <select style={filterCtrlStyle}><option>全部相册</option></select>
            <button type="button" style={filterBtnStyle}>底片（{photos.raw.length}）</button>
            <button type="button" style={filterBtnStyle}>推荐（0）</button>
            <label className="flex items-center" style={{ gap: 6, fontSize: 14, color: '#444444' }}>
              <input type="checkbox" /> 全选
            </label>
            <select style={filterCtrlStyle}><option>仅下载精修片</option><option>全部素材</option></select>
            <button type="button" style={{ ...filterBtnStyle, marginLeft: 'auto' }}>更多</button>
          </div>

          {/* Tab 内容 */}
          <div style={{ marginTop: 16 }}>
            {imgTab === 'raw' && (
              <PhotoZone kind="raw" title="原片" photos={photos.raw} uploading={uploading.raw}
                onAdd={(files) => addPhotos('raw', files)} onRemove={(u) => removePhoto('raw', u)} />
            )}
            {imgTab === 'sel' && (
              <div>
                <div className="flex items-center justify-between" style={{ fontSize: 12, color: '#666666', marginBottom: 8 }}>
                  <span>选片（来自客户相册选片结果，可在此勾选确认）</span>
                  {sel && sel.selection && <span style={{ color: sel.selection.submitted ? '#10b981' : '#b58900' }}>{sel.selection.submitted ? '已提交' : '草稿'}</span>}
                </div>
                {!sel && <div style={{ color: '#666666', fontSize: 14, padding: '8px 0' }}>加载中…</div>}
                {sel && !sel.selection && <div style={{ color: '#666666', fontSize: 14, padding: '8px 0' }}>该订单暂无客户选片</div>}
                {sel && sel.selection && (
                  <>
                    <div className="grid grid-cols-4 md:grid-cols-6" style={{ gap: 8, marginBottom: 12 }}>
                      {sel.photos.map((p) => {
                        const on = sel.selection.marks.includes(p.photo_url);
                        return (
                          <button key={p.id} type="button" onClick={() => toggleSel(p.photo_url)}
                            style={{ position: 'relative', borderRadius: 4, overflow: 'hidden', border: on ? '2px solid ' + BLUE : '1px solid ' + DIV }}>
                            <img src={img(p.photo_url)} style={{ width: '100%', height: 80, objectFit: 'cover' }} />
                            <span style={{ position: 'absolute', top: 4, right: 4, width: 16, height: 16, borderRadius: '50%', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: on ? BLUE : 'rgba(0,0,0,0.5)', color: '#fff' }}>{on ? '✓' : ''}</span>
                          </button>
                        );
                      })}
                      {sel.photos.length === 0 && <div style={{ gridColumn: '1 / -1', color: '#666666', fontSize: 14, padding: '8px 0' }}>该订单无可选样片（需在作品相册中上传 sample 区照片）</div>}
                    </div>
                    <div className="flex items-center justify-between">
                      <span style={{ fontSize: 12, color: '#666666' }}>已选 {sel.selection.marks.length} 张</span>
                      <button type="button" onClick={saveSel} disabled={selSaving}
                        style={{ padding: '6px 12px', borderRadius: 4, background: BLUE, color: '#fff', fontSize: 12, border: 'none', opacity: selSaving ? 0.4 : 1, cursor: 'pointer' }}>保存修改</button>
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

          {/* 底部链接 */}
          <button type="button" onClick={() => nav('/works')}
            style={{ marginTop: 16, background: 'none', border: 'none', color: BLUE, fontSize: 13, cursor: 'pointer' }}>查看选片演示案例 &gt;</button>
        </div>
      </section>

      {/* ============ Module 6：底部记录 Tab 卡片 ============ */}
      <section style={{ margin: '24px 24px 24px', background: '#ffffff', borderRadius: 6 }}>
        <div className="flex" style={{ height: 44, borderBottom: '1px solid ' + DIV }}>
          {[{ k: 'status', t: '订单状态详情' }, { k: 'trade', t: '交易记录' }, { k: 'download', t: '下载记录' }].map((tb) => {
            const active = bottomTab === tb.k;
            return (
              <button key={tb.k} type="button" onClick={() => setBottomTab(tb.k)}
                style={{
                  padding: '0 20px', height: 44, background: 'none', border: 'none', cursor: 'pointer', fontSize: 14,
                  color: active ? BLUE : '#666666',
                  borderBottom: active ? '2px solid ' + BLUE : '2px solid transparent', fontWeight: active ? 500 : 400
                }}>{tb.t}</button>
            );
          })}
        </div>
        <div style={{ padding: '20px 24px' }}>
          {bottomTab === 'status' && (
            <>
              {detail.package_snapshot && Array.isArray(detail.package_snapshot.questionnaire) && detail.package_snapshot.questionnaire.length > 0 && (() => {
                let ans = {};
                try { ans = detail.questionnaire_answers ? (typeof detail.questionnaire_answers === 'string' ? JSON.parse(detail.questionnaire_answers) : detail.questionnaire_answers) : {}; } catch { ans = {}; }
                const qs = detail.package_snapshot.questionnaire;
                return (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ color: '#222222', fontWeight: 500, marginBottom: 8 }}>客户问卷</div>
                    <div style={{ display: 'grid', gap: 8 }}>
                      {qs.map((q, i) => (
                        <div key={i}>
                          <div style={{ color: '#777777', fontSize: 14 }}>{i + 1}. {q.q}{q.required ? ' *' : ''}</div>
                          <div style={{ color: '#222222', marginTop: 2, fontSize: 14 }}>
                            {ans[i] !== undefined && ans[i] !== '' && !(Array.isArray(ans[i]) && ans[i].length === 0)
                              ? (Array.isArray(ans[i]) ? ans[i].join('、') : ans[i]) : <span style={{ color: '#999999' }}>（未填写）</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
              <div style={{ color: '#222222', fontWeight: 500, marginBottom: 8 }}>操作日志</div>
              {(detail.logs || []).length === 0 && <div style={{ color: '#999999', fontSize: 14, padding: '4px 0' }}>暂无日志</div>}
              {(detail.logs || []).map((l, i) => (
                <div key={i} className="flex items-center" style={{ lineHeight: '28px' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#36d399', marginRight: 8, flexShrink: 0 }} />
                  <span style={{ fontSize: 14, color: '#444444' }}>{l.text}</span>
                  <span style={{ fontSize: 13, color: '#999999', marginLeft: 'auto' }}>{new Date(l.t).toLocaleString('zh-CN')}</span>
                </div>
              ))}
            </>
          )}
          {bottomTab === 'trade' && (
            <div>
              <div style={{ color: '#222222', fontWeight: 500, marginBottom: 8 }}>收款流水</div>
              {(!detail.payments || detail.payments.length === 0) && <div style={{ color: '#999999', fontSize: 14, padding: '4px 0' }}>暂无流水</div>}
              {detail.payments && detail.payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between" style={{ borderBottom: '1px solid ' + DIV, padding: '8px 0' }}>
                  <div>
                    <span style={{ color: '#222222' }}>{TYPE_LABEL[p.type]}</span>
                    <span style={{ color: '#666666', marginLeft: 8 }}>{p.method === 'online' ? '线上' : '线下'}</span>
                  </div>
                  <div style={{ color: p.type === 'refund' ? '#ef4444' : '#10b981' }}>
                    {p.type === 'refund' ? '-' : '+'}¥{Number(p.amount).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
          {bottomTab === 'download' && (
            <div>
              <div style={{ color: '#222222', fontWeight: 500, marginBottom: 8 }}>可下载素材（原片 / 精修片 / 选片）</div>
              {downloadItems.length === 0 && <div style={{ color: '#999999', fontSize: 14, padding: '4px 0' }}>暂无素材（请在上方可片/原片/精修片 Tab 上传）</div>}
              <div style={{ display: 'grid', gap: 4 }}>
                {downloadItems.map((it, i) => (
                  <div key={i} className="flex items-center justify-between" style={{ borderBottom: '1px solid ' + DIV, padding: '8px 0' }}>
                    <div className="flex items-center" style={{ gap: 8, minWidth: 0 }}>
                      <span style={{ padding: '2px 6px', borderRadius: 4, background: '#f3f4f6', fontSize: 11, color: '#666666', flexShrink: 0 }}>{it.kind}</span>
                      <span style={{ color: '#222222', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.url}</span>
                    </div>
                    <button type="button" onClick={() => downloadFile(it.url)} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid ' + DIV, fontSize: 12, color: '#222222', background: '#fff', cursor: 'pointer', flexShrink: 0 }}>下载</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 收款弹窗 */}
      {pay && (
        <div className="fixed inset-0 flex items-center justify-center z-[70] p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => setPay(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: '#fff', border: '1px solid ' + DIV, borderRadius: 8, padding: 24 }}>
            <div style={{ color: '#222222', fontWeight: 500, marginBottom: 16 }}>登记收款 · {detail.order_no}</div>
            <select value={pay.type} onChange={(e) => setPay({ ...pay, type: e.target.value })} style={modalInputStyle}>
              <option value="deposit">定金</option><option value="balance">尾款</option><option value="extra">加片/增值</option>
            </select>
            <input value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} type="number" placeholder="金额"
              style={{ ...modalInputStyle, marginTop: 12 }} />
            <select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })} style={{ ...modalInputStyle, marginTop: 12 }}>
              <option value="offline">线下</option><option value="online">线上</option>
            </select>
            <input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} placeholder="备注(选填)"
              style={{ ...modalInputStyle, marginTop: 12 }} />
            {err && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 8 }}>{err}</div>}
            <div className="flex justify-end" style={{ gap: 8, marginTop: 16 }}>
              <button onClick={() => setPay(null)} style={modalCancelStyle}>取消</button>
              <button onClick={savePay} style={modalSaveStyle}>保存</button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑订单弹窗 */}
      {edit && (
        <div className="fixed inset-0 flex items-center justify-center z-[70] p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => setEdit(false)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={saveEdit} style={{ width: '100%', maxWidth: 448, background: '#fff', border: '1px solid ' + DIV, borderRadius: 8, padding: 24 }}>
            <div style={{ color: '#222222', fontWeight: 500, marginBottom: 16 }}>编辑订单 · {detail.order_no}</div>
            <input value={editForm.order_name} onChange={(e) => setEditForm({ ...editForm, order_name: e.target.value })} placeholder="订单名称"
              style={modalInputStyle} />
            <div className="grid grid-cols-2" style={{ gap: 12, marginTop: 12 }}>
              <input value={editForm.groom_name} onChange={(e) => setEditForm({ ...editForm, groom_name: e.target.value })} placeholder="新郎姓名" style={modalInputStyle} />
              <input value={editForm.bride_name} onChange={(e) => setEditForm({ ...editForm, bride_name: e.target.value })} placeholder="新娘姓名" style={modalInputStyle} />
            </div>
            <div className="grid grid-cols-2" style={{ gap: 12, marginTop: 12 }}>
              <input value={editForm.customer_phone} onChange={(e) => setEditForm({ ...editForm, customer_phone: e.target.value })} placeholder="联系电话" style={modalInputStyle} />
              <input value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} placeholder="拍摄地址" style={modalInputStyle} />
            </div>
            <input value={editForm.shoot_date} onChange={(e) => setEditForm({ ...editForm, shoot_date: e.target.value })} type="date"
              style={{ ...modalInputStyle, marginTop: 12 }} />
            <input value={editForm.executor} onChange={(e) => setEditForm({ ...editForm, executor: e.target.value })} placeholder="执行人"
              style={{ ...modalInputStyle, marginTop: 12 }} />
            <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
              style={{ ...modalInputStyle, marginTop: 12 }}>
              <option value="deposit">已付定金</option><option value="shot">已拍摄</option>
              <option value="selecting">选片中</option><option value="retouching">精修中</option><option value="delivered">已交付</option>
              <option value="completed">已完成</option><option value="cancelled">已作废</option>
            </select>
            <input value={editForm.remark} onChange={(e) => setEditForm({ ...editForm, remark: e.target.value })} placeholder="备注"
              style={{ ...modalInputStyle, marginTop: 12 }} />
            <div className="flex justify-end" style={{ gap: 8, marginTop: 16 }}>
              <button type="button" onClick={() => setEdit(false)} style={modalCancelStyle}>取消</button>
              <button type="submit" style={modalSaveStyle}>保存</button>
            </div>
          </form>
        </div>
      )}

      {/* 客户影集分享弹窗 */}
      {shareModal && (
        <div className="fixed inset-0 flex items-center justify-center z-[80] p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => setShareModal(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: '#fff', border: '1px solid ' + DIV, borderRadius: 8, padding: 24, textAlign: 'center' }}>
            <div style={{ color: '#222222', fontWeight: 500, marginBottom: 4 }}>客户影集分享</div>
            <div style={{ fontSize: 12, color: '#666666', marginBottom: 16 }}>扫码或复制链接，客户即可在手机上查看成品影集（仅展示样片/成片，不含原片）</div>
            {share && share.qr_url ? (
              <>
                <img src={share.qr_url} alt="分享二维码" style={{ width: 224, height: 224, margin: '0 auto', borderRadius: 8, background: '#fff', padding: 8, border: '1px solid ' + DIV }} />
                <div style={{ fontSize: 12, color: '#666666', marginTop: 12, wordBreak: 'break-all' }}>{share.share_url}</div>
                <div className="flex justify-center" style={{ gap: 8, marginTop: 16 }}>
                  <button onClick={copyShare} style={{ ...modalSaveStyle, padding: '6px 12px' }}>复制链接</button>
                  <button onClick={openShare} disabled={shareBusy} style={{ ...modalCancelStyle, padding: '6px 12px', border: '1px solid ' + DIV }}>刷新二维码</button>
                  <button onClick={unshare} style={{ ...modalCancelStyle, padding: '6px 12px', color: '#ef4444', border: '1px solid ' + DIV }}>关闭分享</button>
                </div>
              </>
            ) : (<div style={{ color: '#666666', fontSize: 14, padding: 32 }}>生成中…</div>)}
            <button onClick={() => setShareModal(false)} style={{ marginTop: 16, ...modalCancelStyle }}>关闭</button>
          </div>
        </div>
      )}

      {/* 分享订单小程序二维码浮层 */}
      {miniQr !== null && (
        <>
          <div className="fixed inset-0 z-[90]" style={{ background: 'rgba(0,0,0,0.3)' }} onClick={closeMiniQr} />
          <div onClick={(e) => e.stopPropagation()}
            style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 95, width: 240, background: '#fff', borderRadius: 8, padding: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.18)' }}>
            <div style={{ color: '#222222', fontWeight: 500, marginBottom: 8 }}>订单二维码</div>
            {miniQr ? (
              <img src={miniQr} alt="订单二维码" style={{ width: 176, height: 176, margin: '0 auto', borderRadius: 8 }} />
            ) : (
              <div style={{ color: '#666666', fontSize: 14, padding: 32, textAlign: 'center' }}>生成中…</div>
            )}
            <div style={{ fontSize: 11, color: '#666666', textAlign: 'center', marginTop: 8 }}>微信扫码查看订单（右键 / 长按可保存）</div>
          </div>
        </>
      )}

      <Slideshow photos={slidePhotos} open={slideOpen} onClose={closeSlideSel} title={detail.order_name || '订单相册'} />
    </div>
  );
}

// —— 复刻 spec 样式片段（模块内复用） ——
const secBtnStyle = {
  height: 36, borderRadius: 4, background: '#fff', color: '#444444',
  border: '1px solid ' + DIV, fontSize: 14, padding: '0 14px', cursor: 'pointer'
};
const moreItemStyle = {
  display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px',
  background: 'none', border: 'none', color: '#222222', cursor: 'pointer', whiteSpace: 'nowrap'
};
const filterCtrlStyle = { height: 36, padding: '0 12px', borderRadius: 4, border: '1px solid ' + DIV, color: '#444444', background: '#fff', fontSize: 14 };
const filterBtnStyle = { height: 36, padding: '0 12px', borderRadius: 4, border: '1px solid ' + DIV, color: '#444444', background: '#fff', fontSize: 14, cursor: 'pointer' };
const modalInputStyle = { width: '100%', padding: '8px 12px', borderRadius: 4, border: '1px solid ' + DIV, color: '#222222', fontSize: 14, outline: 'none', background: '#fff' };
const modalCancelStyle = { padding: '8px 16px', borderRadius: 4, fontSize: 14, color: '#666666', background: '#fff', border: '1px solid ' + DIV, cursor: 'pointer' };
const modalSaveStyle = { padding: '8px 16px', borderRadius: 4, fontSize: 14, color: '#fff', background: BLUE, border: 'none', cursor: 'pointer' };

// 信息行（标签 / 内容 + 可选业务标签）
function InfoRow({ label, value, tags, extra }) {
  return (
    <div className="flex" style={{ alignItems: 'flex-start', gap: 12 }}>
      <span style={{ fontSize: 14, color: '#777777', flexShrink: 0, minWidth: 64 }}>{label}</span>
      <span style={{ fontSize: 14, color: '#222222', flex: 1 }}>
        {value}
        {extra && extra.length > 0 && (
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
            {extra.map((h, i) => <span key={i} style={{ padding: '1px 6px', borderRadius: 4, background: '#f3f4f6', fontSize: 11, color: '#444' }}>{h}</span>)}
          </span>
        )}
        {tags && tags.length > 0 && (
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {tags.map((t, i) => <span key={i} style={{ padding: '2px 8px', borderRadius: 4, background: t.bg, color: t.fg, fontSize: 12 }}>{t.t}</span>)}
          </span>
        )}
      </span>
    </div>
  );
}

// 图片上传区域（原片 / 精修片 真实上传）—— 复刻 spec 140x140 虚线上传框
function PhotoZone({ kind, title, photos, uploading, onAdd, onRemove }) {
  const inputRef = React.useRef(null);
  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
        <span style={{ fontSize: 14, color: '#222222', fontWeight: 500 }}>{title}（{photos.length}）</span>
        <button type="button" onClick={() => inputRef.current?.click()}
          style={{ padding: '6px 12px', borderRadius: 4, background: BLUE, color: '#fff', fontSize: 12, border: 'none', opacity: uploading ? 0.6 : 1, cursor: 'pointer' }}>
          {uploading ? '上传中…' : '+ 上传' + title}
        </button>
        <input ref={inputRef} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => { onAdd(e.target.files); e.target.value = ''; }} />
      </div>
      <div className="flex flex-wrap" style={{ gap: 12, alignItems: 'flex-start' }}>
        {photos.map((u, i) => (
          <div key={i} style={{ position: 'relative' }} className="group">
            <img src={img(u)} style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 4, border: '1px solid ' + DIV }} />
            <button type="button" onClick={() => onRemove(u)}
              style={{ position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 12, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0 }} className="group-hover:opacity-100">✕</button>
          </div>
        ))}
        {uploading && <div style={{ width: 96, height: 96, borderRadius: 4, border: '1px dashed ' + DIV, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#999999' }}>上传中…</div>}
        {/* spec 上传框 140x140 虚线 + 蓝色加号 + 下方上传按钮 */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 140 }}>
          <label style={{ width: 140, height: 140, borderRadius: 4, border: '1px dashed #cccccc', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            onClick={() => inputRef.current?.click()}>
            <span style={{ width: 36, height: 36, borderRadius: '50%', background: '#e6f0fb', color: BLUE, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
            </span>
          </label>
          <button type="button" onClick={() => inputRef.current?.click()}
            style={{ marginTop: 8, background: 'none', border: 'none', color: '#222222', fontSize: 14, cursor: 'pointer' }}>上传{title}</button>
        </div>
      </div>
    </div>
  );
}
