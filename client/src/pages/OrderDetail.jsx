import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import http, { img, uploadBatch, conflictOf } from '../api.js';
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

// —— 加片费核算（验收⑦：一律读订单套系快照，不读套系最新配置）——
// 套系「加片费」为自由文本（如「¥50/张」），从中抽取数字作为单价，缺省 80 与后端 selection.js 保持一致
function parseUnitPrice(text) {
  const m = String(text == null ? '' : text).match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : 80;
}
// 梯度优惠与后端 selectionFee 完全一致：>=20 张 9 折，>=10 张 95 折
function calcExtraFee(extraCount, unitPrice) {
  const n = Math.max(0, parseInt(extraCount, 10) || 0);
  let discount = 1;
  if (n >= 20) discount = 0.9;
  else if (n >= 10) discount = 0.95;
  return { count: n, unitPrice, discount, fee: Math.round(n * unitPrice * discount) };
}

// 订单详情 11 步流程进度条（新规范）：订单生成→生成合同→沟通确认→拍摄执行→拍摄结束
// →选片精修→预告片输出→全部精修完成→原片打包→统一交付→订单完结
const ORDER_STEPS = [
  { key: 'created', label: '订单生成' },
  { key: 'contract_created', label: '生成合同' },
  { key: 'confirmed', label: '沟通确认' },
  { key: 'shooting', label: '拍摄执行' },
  { key: 'shooting_finished', label: '拍摄结束' },
  { key: 'retouch_selecting', label: '选片精修' },
  { key: 'trailer_output', label: '预告片输出' },
  { key: 'retouch_finished', label: '全部精修完成' },
  { key: 'raw_packed', label: '原片打包' },
  { key: 'delivered', label: '统一交付' },
  { key: 'completed', label: '订单完结' }
];
// 由后端 status（6 阶段）推导 11 步的「当前节点」下标；
// 订单一旦存在，订单生成/生成合同/沟通确认 默认已走过的 done 态
function stepIndexFor(detail) {
  if (!detail) return -1;
  if (detail.cancelled) return 3; // 作废停在拍摄执行阶段
  const map = { deposit: 3, shot: 4, selecting: 5, retouching: 7, delivered: 10, completed: 11 };
  const idx = map[detail.status];
  return idx === undefined ? 0 : idx;
}
function fmtStepTime(t) {
  if (!t) return null;
  const d = new Date(t);
  if (isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function findStepTime(logs, kws) {
  for (const kw of kws) {
    const hit = (logs || []).find((l) => (l.text || '').includes(kw));
    if (hit && hit.t) return fmtStepTime(hit.t);
  }
  return null;
}
const STEP_TIME_KW = {
  created: ['创建订单', '订单生成'],
  contract_created: ['合同'],
  confirmed: ['沟通确认', '确认'],
  shooting: ['拍摄执行', '开始拍摄'],
  shooting_finished: ['拍摄结束', '完成拍摄'],
  retouch_selecting: ['选片', '进入精修'],
  trailer_output: ['预告片'],
  retouch_finished: ['全部精修完成', '精修完成'],
  raw_packed: ['原片打包', '打包'],
  delivered: ['统一交付', '交付'],
  completed: ['订单完结', '完结']
};
// 由订单 status / logs 派生 11 步状态（done / current / pending）
function build11Steps(detail, logs) {
  if (!detail) return ORDER_STEPS.map((s) => ({ ...s, state: 'pending', time: null }));
  const cur = stepIndexFor(detail);
  return ORDER_STEPS.map((s, i) => {
    const state = i < cur ? 'done' : i === cur ? 'current' : 'pending';
    let time = null;
    if (state === 'done') {
      const t = findStepTime(logs, STEP_TIME_KW[s.key]);
      time = s.key === 'created' && !t ? fmtStepTime(detail.created_at) : t;
    }
    return { ...s, state, time };
  });
}

// 新规范全局色号（订单详情页 v2：轻量低饱和后台风）
const TEAL = '#67CFC3';          // 状态卡片顶部青绿细线 / 品牌点缀
const BLUE = '#2DB7F5';          // 主蓝色 / 当前·已完成节点 / 完成拍摄 / Tab 选中 / 确定按钮
const DIV = '#EEEEEE';           // 分割线 / 卡片边框
const CARD_BORDER = '#EDEDED';   // 卡片边框
const CARD_SHADOW = 'none';      // 新规范卡片用边框代替阴影，保持轻量
const TEXT_MAIN = '#666666';     // 主文字
const TEXT_SUB = '#999999';      // 次级文字
const TEXT_WEAK = '#BFBFBF';     // 弱文字
const GREEN = '#70C8A7';         // 绿色状态标签 / 更多内容
const BLACK_TAG = '#333333';     // 黑色状态标签 / 分享订单按钮
const STEP_ACTIVE = '#2DB7F5';   // 进度条激活/已完成圆圈（= 主蓝）
const SUMMARY_BG = '#FAFAFA';    // 套系快照摘要灰底块（spec #FAFAFA/#F8F8F8）
const INFO_LABEL = '#999999';    // 信息行标签
const INFO_VALUE = '#666666';    // 信息行值（轻灰，呼应低饱和风）

function asArr(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

// 头像底色：按客户姓名稳定取色（呼应规范的 #67CFC3 / #FFC247 / #A58BE2 等低饱和色）
function pickAvatarColor(name) {
  const palette = ['#67CFC3', '#FFC247', '#A58BE2', '#70C8A7', '#5AA9E6'];
  const s = name && name !== '—' ? name : '客';
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
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
  // 原片/精修片 排序（工具栏排序按钮）
  const [sortKey, setSortKey] = useState('upload');
  const [sortOpen, setSortOpen] = useState(false);
  const [sortTip, setSortTip] = useState(false);
  // 分享订单小程序二维码（复用 /api/orders/:id/mini-qr）
  const [miniQr, setMiniQr] = useState(null);
  const [miniQrLoading, setMiniQrLoading] = useState(false);
  const [moreMenu, setMoreMenu] = useState(false);
  // 改拍摄日期档期冲突二次确认（验收④）
  const [dateConflict, setDateConflict] = useState(null);
  // 更换套系弹窗（验收⑥）
  const [pkgSwitch, setPkgSwitch] = useState(null);
  const [pkgSwitching, setPkgSwitching] = useState(false);
  // 加片设置弹窗（验收⑦：按订单快照核算）
  const [addonBox, setAddonBox] = useState(null);
  // 套系服务详情弹窗
  const [pkgDetailModal, setPkgDetailModal] = useState(false);
  const [pkgDetailTab, setPkgDetailTab] = useState('service');
  // 备注行内编辑（需求：备注由纯文本改为可编辑文本域）
  const [editingRemark, setEditingRemark] = useState(false);
  const [remarkDraft, setRemarkDraft] = useState('');
  const [hoverRemark, setHoverRemark] = useState(false);

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
    if (e) e.preventDefault();
    await doSaveEdit(false);
  }
  // 保存订单编辑；改拍摄日期时后端会做档期冲突检测（验收④），冲突则二次确认后 force 提交
  async function doSaveEdit(force) {
    try {
      await http.put('/api/orders/' + detail.id, { ...editForm, force: force ? 1 : 0 });
      setDateConflict(null);
      setEdit(false);
      reload();
    } catch (e2) {
      const cf = conflictOf(e2);
      if (cf && cf.forcible && !force) { setDateConflict(cf.message); return; }
      alert((e2 && e2.message) || (e2.response && e2.response.data && e2.response.data.error) || '保存失败');
    }
  }

  // 保存备注（行内编辑，失焦或点保存即写入）
  async function saveRemark() {
    if (!detail) return;
    try {
      await http.put('/api/orders/' + detail.id, { remark: remarkDraft });
      setEditingRemark(false);
      reload();
    } catch (e2) {
      alert((e2 && e2.message) || (e2.response && e2.response.data && e2.response.data.error) || '备注保存失败');
    }
  }

  // —— 更换套系（验收⑥）：弹窗确认，仅重写当前订单快照 ——
  function openPkgSwitch() {
    if (!detail) return;
    if (detail.cancelled) { alert('订单已作废，无法更换套系'); return; }
    setPkgSwitch({ package_id: String(detail.package_id || ''), spec_id: '', package_price: '', reason: '', step: 'pick' });
  }
  async function confirmPkgSwitch() {
    if (!pkgSwitch || !pkgSwitch.package_id) { alert('请选择要更换的套系'); return; }
    setPkgSwitching(true);
    try {
      await http.post('/api/orders/' + detail.id + '/change-package', {
        package_id: Number(pkgSwitch.package_id),
        spec_id: pkgSwitch.spec_id || '',
        package_price: pkgSwitch.package_price === '' ? undefined : parseFloat(pkgSwitch.package_price),
        reason: pkgSwitch.reason || ''
      });
      setPkgSwitch(null);
      reload();
    } catch (e2) { alert((e2 && e2.message) || '更换失败'); }
    finally { setPkgSwitching(false); }
  }

  // —— 加片设置（验收⑦）：单价与精修张数一律取订单快照 ——
  function openAddonBox() {
    if (!detail) return;
    const snap = detail.package_snapshot || {};
    const dt = (snap.details && typeof snap.details === 'object') ? snap.details : {};
    const unit = parseUnitPrice(dt.extra_photo_fee);
    const included = parseInt(snap.retouch_count ?? dt.retouch_count, 10) || 0;
    const picked = (sel && sel.selection && Array.isArray(sel.selection.marks)) ? sel.selection.marks.length : 0;
    const count = Math.max(0, picked - included);
    setAddonBox({
      unit, included, picked, count: String(count),
      feeText: dt.extra_photo_fee || '', discountText: dt.extra_photo_discount || '',
      fromSnapshot: !!(snap.id || snap.name), method: 'offline'
    });
  }
  async function submitAddon() {
    if (!addonBox) return;
    const r = calcExtraFee(addonBox.count, addonBox.unit);
    if (r.fee <= 0) { alert('加片张数为 0，无需登记加片费'); return; }
    try {
      await http.post('/api/orders/' + detail.id + '/payments', {
        type: 'extra', amount: r.fee, method: addonBox.method,
        note: `加片 ${r.count} 张 × ¥${r.unitPrice}/张${r.discount < 1 ? ' × ' + (r.discount * 10).toFixed(1) + ' 折' : ''}（按订单套系快照核算）`
      });
      setAddonBox(null);
      reload();
    } catch (e2) { alert((e2 && e2.message) || '登记失败'); }
  }
  async function removeOrder() {
    if (!confirm('确认删除该订单？\n将移入回收站，可在回收站恢复（不破坏收款流水与选片记录）。\n删除后该订单占用的档期会自动释放。')) return;
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
    if (!detail) return;
    const tip = detail.shoot_date && !detail.date_tbd
      ? `确认作废该订单？\n作废后将自动释放已占用的档期 ${detail.shoot_date}，该日期重新变为可约。`
      : '确认作废该订单？';
    if (!confirm(tip)) return;
    const reason = prompt('作废原因（选填）');
    if (reason === null) return;
    try {
      await http.post('/api/orders/' + detail.id + '/cancel', { reason });
      reload();
    } catch (e2) { alert((e2 && e2.message) || '作废失败'); }
  }
  async function refund() {
    const amt = prompt('退款金额');
    if (amt === null || !amt) return;
    await http.post('/api/orders/' + detail.id + '/refund', { amount: parseFloat(amt), note: '手动退款' });
    reload();
  }
  // 复制订单：以当前订单的套系/客户信息新建一条副本（日期置为待定，避免档期冲突），跳转到新订单
  async function copyOrder() {
    if (!detail) return;
    try {
      const r = await http.post('/api/orders', {
        package_id: detail.package_id,
        groom_name: detail.groom_name || '',
        bride_name: detail.bride_name || '',
        customer_phone: detail.customer_phone || (Array.isArray(detail.phones) ? detail.phones[0] : ''),
        address: detail.address || '',
        remark: detail.remark || '',
        channel: detail.channel || '',
        payment_status: 'unpaid',
        deposit: 0,
        date_tbd: 1,
        order_name: (detail.order_name || '复制订单') + '（副本）'
      });
      nav('/orders/' + r.data.id);
    } catch (e) { alert((e.response && e.response.data && e.response.data.error) || '复制失败'); }
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

  // 更多设置下拉菜单（更换套系 / 复制订单 / 作废关闭订单 / 收款 / 退款 / 删除恢复）
  const renderMoreMenu = () => (
    <div style={{ position: 'absolute', zIndex: 60, marginTop: 4, background: '#fff', border: '1px solid ' + DIV, borderRadius: 4, boxShadow: '0 6px 20px rgba(0,0,0,0.10)', padding: '4px 0', fontSize: 14, width: 140 }}>
      <button type="button" onClick={() => { setMoreMenu(false); openPkgSwitch(); }} style={moreItemStyle}>更换套系</button>
      <button type="button" onClick={() => { setMoreMenu(false); copyOrder(); }} style={moreItemStyle}>复制订单</button>
      <button type="button" onClick={() => { setMoreMenu(false); cancel(); }} style={moreItemStyle}>作废/关闭订单</button>
      <div style={{ height: 1, background: DIV, margin: '4px 0' }} />
      <button type="button" onClick={() => { setMoreMenu(false); setPay({ type: 'deposit', amount: '', method: 'offline', note: '' }); }} style={moreItemStyle}>+ 收款</button>
      <button type="button" onClick={() => { setMoreMenu(false); refund(); }} style={moreItemStyle}>退款</button>
      {!detail.is_deleted
        ? <button type="button" onClick={() => { setMoreMenu(false); removeOrder(); }} style={{ ...moreItemStyle, color: '#ef4444' }}>删除</button>
        : <button type="button" onClick={() => { setMoreMenu(false); restoreOrder(); }} style={{ ...moreItemStyle, color: '#10b981' }}>恢复</button>}
    </div>
  );

  const pkgInfo = useMemo(() => {
    if (!detail) return null;
    const snap = detail.package_snapshot || {};
    // 【底层强制规则 1】订单一旦保存套系快照，展示与核算一律读快照；
    // 后续编辑原始套系不影响历史订单。仅无快照的历史脏数据才回落到最新套系配置。
    const hasSnap = !!(snap && (snap.id || snap.name));
    const live = hasSnap ? {} : (pkgs.find((p) => p.id === detail.package_id) || {});
    const arr = (v) => Array.isArray(v) ? v : [];
    const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    const val = (s, l) => (s !== undefined && s !== null && s !== '' ? s : l);
    return {
      fromSnapshot: hasSnap,
      details: obj(snap.details).extra_photo_fee !== undefined || Object.keys(obj(snap.details)).length ? obj(snap.details) : obj(live.details),
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

  // 原片列表排序选项与排序逻辑（工具栏排序按钮；必须放在下面 useMemo 之前，避免工厂函数访问 TDZ）
  const SORT_OPTS = [
    { k: 'upload', t: '按上传时间' },
    { k: 'shoot', t: '按拍摄时间' },
    { k: 'name', t: '按文件名' },
    { k: 'shuffle', t: '打乱顺序' }
  ];
  const sortPhotos = (arr, key) => {
    if (!Array.isArray(arr) || arr.length === 0) return arr;
    if (key === 'name') return [...arr].sort((a, b) => String(a).localeCompare(String(b)));
    if (key === 'shuffle') {
      const c = [...arr];
      for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; }
      return c;
    }
    return arr; // 按上传时间 / 按拍摄时间：沿用原始顺序
  };

  // 原片/精修片 排序（必须放在提前 return 之前，避免 hooks 数量不一致触发 React #310）
  const sortedRaw = useMemo(() => sortPhotos(photos.raw, sortKey), [photos.raw, sortKey]);
  const sortedRetouched = useMemo(() => sortPhotos(photos.retouched, sortKey), [photos.retouched, sortKey]);

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

  const steps = build11Steps(detail, detail.logs);
  const statusText =
    (detail.payment_status === 'unpaid' ? '未付定金' : (PAY_STATUS_LABEL[payKey] || '')) +
    (detail.status ? '，' + (STATUS_LABEL[detail.status] || '') : '');
  const custName = ([detail.groom_name, detail.bride_name].filter(Boolean).join(' & ') || detail.customer_name || '—');
  const custInitial = (custName && custName !== '—') ? custName.slice(0, 1) : '客';
  const offlinePay = detail.pay_method === 'offline' || detail.channel === 'offline' || detail.source === 'offline';

  // 订单套系快照（验收①⑦：摘要卡与弹窗一律读快照，不读套系主表）
  const snap = detail.package_snapshot || {};
  const snapDetails = (snap && typeof snap.details === 'object' && !Array.isArray(snap.details)) ? snap.details : {};
  const sumRawCount = snapDetails.raw_count || snapDetails.shoot_count || snap.raw_count || '';
  const sumAlbum = snapDetails.album || snap.album || '—';
  const sumExtraFee = snapDetails.extra_photo_fee || '—';
  const sumService = snapDetails.service_detail || snap.description || '—';
  const sumRefund = snapDetails.refund_policy || '—';
  const sumSelection = snapDetails.selection_tips || '未开启';
  const sumDuration = snap.duration ? String(snap.duration) : '—';
  const sumRawPolicy = snap.raw_policy ? String(snap.raw_policy) : '—';
  const sumRetouch = snap.retouch_count ? String(snap.retouch_count) + ' 张' : '—';

  const CheckIcon = () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4 10-10" /></svg>
  );

  return (
    <div style={{ background: '#f7f9fc', minHeight: '100vh', paddingBottom: 24 }}>
      {/* ============ Module 3：订单状态卡片（青绿顶线 + 左侧操作 + 右侧 11 步进度条） ============ */}
      <section style={{ margin: '16px 24px 0', background: '#FFFFFF', border: '1px solid ' + CARD_BORDER, borderTop: '3px solid ' + TEAL, borderRadius: 4, overflow: 'hidden' }}>
        <div className="flex items-stretch" style={{ minHeight: 150 }}>
          {/* 左侧订单操作区 ~25% */}
          <div className="flex flex-col justify-center shrink-0" style={{ width: '26%', minWidth: 220, padding: '14px 32px', gap: 12, position: 'relative' }}>
            <div style={{ fontSize: 14, color: TEXT_MAIN, marginBottom: 4 }}>
              订单编号：<span style={{ fontWeight: 500, color: '#333333' }}>{detail.order_no}</span>
            </div>
            <button type="button" onClick={finishShoot} disabled={detail.status === 'cancelled'}
              style={{ width: '100%', height: 40, borderRadius: 2, background: BLUE, color: '#fff', fontSize: 14, border: 'none', opacity: detail.status === 'cancelled' ? 0.4 : 1, cursor: 'pointer' }}>完成拍摄</button>
            <button type="button" onClick={openMiniQr} disabled={miniQrLoading}
              style={{ width: '100%', height: 40, borderRadius: 2, background: BLACK_TAG, color: '#fff', fontSize: 14, border: 'none', cursor: 'pointer', opacity: miniQrLoading ? 0.6 : 1 }}>分享订单</button>
            <div className="flex items-center" style={{ justifyContent: 'space-between' }}>
              <button type="button" onClick={cancel}
                style={{ background: 'none', border: 'none', color: TEXT_MAIN, fontSize: 14, textAlign: 'left', cursor: 'pointer', padding: 0 }}>关闭订单</button>
              <button type="button" onClick={() => setMoreMenu((m) => !m)}
                style={{ background: 'none', border: 'none', color: TEXT_MAIN, fontSize: 14, textAlign: 'right', cursor: 'pointer', padding: 0, position: 'relative' }}>更多设置</button>
            </div>
            {moreMenu && renderMoreMenu()}
          </div>

          {/* 竖向分割线 */}
          <div style={{ width: 1, background: DIV, margin: '14px 0' }} />

          {/* 右侧 11 步横向流程进度条（由后端 status/logs 驱动，支持横向滚动，卡片内垂直居中） */}
          <div className="flex-1" style={{ minWidth: 0, padding: '14px 32px', display: 'flex', alignItems: 'center', overflowX: 'auto', overflowY: 'hidden' }}>
            <div className="flex items-start" style={{ gap: 0, minWidth: 1080 }}>
              {steps.map((st, i) => (
                <React.Fragment key={st.key}>
                  <div className="flex flex-col items-center" style={{ width: 96, flexShrink: 0 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%',
                      background: st.state === 'current' ? BLUE : '#FFFFFF',
                      border: st.state === 'done' ? ('1px solid ' + BLUE) : st.state === 'current' ? ('1px solid ' + BLUE) : '1px solid #DCDCDC',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: st.state === 'pending' ? '#CFCFCF' : BLUE
                    }}>
                      {st.state === 'done'
                        ? <CheckIcon />
                        : <span style={{ fontSize: 14, fontWeight: 600, color: st.state === 'current' ? '#fff' : '#CFCFCF' }}>{i + 1}</span>}
                    </div>
                    <span style={{ fontSize: 14, marginTop: 8, textAlign: 'center', whiteSpace: 'nowrap', color: st.state === 'pending' ? TEXT_WEAK : st.state === 'current' ? '#555555' : TEXT_MAIN }}>{st.label}</span>
                    {st.time ? <span style={{ marginTop: 6, fontSize: 13, textAlign: 'center', color: TEXT_SUB }}>{st.time}</span> : null}
                  </div>
                  {i < steps.length - 1 && (
                    <div style={{ flex: 1, height: 1, minWidth: 28, marginTop: 18, background: st.state === 'done' ? BLUE : '#E5E5E5' }} />
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ============ 合并大白卡：基础信息 + 摘要 + 备注（唯一外层卡片） ============ */}
      <section style={{ margin: '18px 24px 0', background: '#FFFFFF', borderRadius: 4, boxShadow: '0 1px 5px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
        {/* 上分区：客户与订单信息 */}
        <div style={{ padding: '32px 38px' }}>
          {/* 顶部：左客户模块 / 右按钮组 */}
          <div className="flex items-start justify-between" style={{ gap: 24 }}>
            <div className="flex items-center" style={{ gap: 12 }}>
              <div style={{ width: 50, height: 50, borderRadius: '50%', background: pickAvatarColor(custName), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 20, fontWeight: 500, flexShrink: 0 }}>
                {custInitial}
              </div>
              <div className="flex items-center" style={{ gap: 10 }}>
                <span style={{ fontSize: 16, color: TEXT_MAIN }}>{custName}</span>
                <button type="button" style={{ fontSize: 12, color: '#ef4444', background: '#fff', border: '1px solid #FFB6B6', borderRadius: 2, padding: '2px 8px', cursor: 'pointer' }}>客户信息</button>
              </div>
            </div>

            {/* 右上角按钮组 */}
            <div className="flex items-center" style={{ gap: 12 }}>
              <button type="button" onClick={() => setBottomTab('status')}
                style={{ height: 36, borderRadius: 2, background: BLUE, color: '#fff', fontSize: 14, border: 'none', padding: '0 14px', cursor: 'pointer' }}>调查问卷</button>
              <button type="button" onClick={openEdit}
                style={secBtnStyle}>编辑订单</button>
              <button type="button" onClick={openAddonBox}
                style={secBtnStyle}>加片设置</button>
              <button type="button" onClick={() => setMoreMenu((m) => !m)}
                style={{ ...secBtnStyle, position: 'relative' }}>更多设置</button>
              {moreMenu && renderMoreMenu()}
            </div>
          </div>

          <div style={{ height: 1, background: '#e5e7eb', margin: '24px 0' }} />

          {/* 中部：左 订单图片(190x138) + 右 双列信息区 */}
          <div className="flex" style={{ gap: 28, alignItems: 'flex-start' }}>
            <div style={{ width: 190, height: 138, borderRadius: 4, overflow: 'hidden', background: '#f3f4f6', flexShrink: 0 }}>
              {pkgInfo && pkgInfo.cover_url
                ? <img src={img(pkgInfo.cover_url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: 12 }}>套系缩略图</div>}
            </div>
            <div className="flex-1">
              <div className="grid grid-cols-2" style={{ gap: '16px 40px' }}>
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
                    offlinePay ? { t: '线下退款', bg: GREEN, fg: '#fff' } : null,
                    remain > 0 ? { t: '未结算', bg: BLACK_TAG, fg: '#fff' } : null
                  ].filter(Boolean)} />
                <InfoRow label="参与者" value={execs.length ? execs.map((p) => p.name).join('、') : '—'} />
              </div>
            </div>
          </div>
        </div>

        {/* 中间分区：套系快照摘要（#fbfbf3 独立子卡，全部读取订单快照） */}
        <div style={{ margin: '12px 36px', background: '#fbfbf3', border: '1px solid ' + CARD_BORDER, borderRadius: 4, padding: '24px 36px' }}>
          <div className="grid grid-cols-4" style={{ rowGap: 20 }}>
            {[
              { t: '总价', v: '¥' + total.toLocaleString() },
              { t: '服务详情', v: (sumService && sumService !== '—') ? (String(sumService).length > 16 ? String(sumService).slice(0, 16) + '…' : String(sumService)) : '—' },
              { t: '底片全送', v: sumRawPolicy },
              { t: '加片费', v: sumExtraFee },
              { t: '拍摄时长', v: sumDuration },
              { t: '拍摄', v: sumRawCount ? String(sumRawCount) + ' 张' : '—' },
              { t: '精修片', v: sumRetouch }
            ].map((f, i) => (
              <div key={f.t} style={{ paddingLeft: i % 4 === 0 ? 0 : 24, borderLeft: i % 4 === 0 ? 'none' : '1px solid ' + DIV }}>
                <div style={{ fontSize: 14, color: TEXT_SUB }}>{f.t}</div>
                <div style={{ fontSize: 14, color: '#888888', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.v}</div>
              </div>
            ))}
            <div style={{ paddingLeft: 24, borderLeft: '1px solid ' + DIV }}>
              <button type="button" onClick={() => { setPkgDetailTab('service'); setPkgDetailModal(true); }}
                style={{ background: 'none', border: 'none', color: GREEN, fontSize: 14, cursor: 'pointer', padding: 0 }}>更多内容</button>
            </div>
          </div>
        </div>

        {/* 底部分区：备注信息（图标+标题+内容同行，hover 内容弹「✍️编辑」气泡） */}
        <div style={{ padding: '16px 20px' }}>
          {editingRemark ? (
            <div>
              <div className="flex items-center" style={{ gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 14 }}>✍️</span>
                <span style={{ fontSize: 14, color: TEXT_SUB, flexShrink: 0 }}>备注信息：</span>
              </div>
              <textarea
                autoFocus
                value={remarkDraft}
                onChange={(e) => setRemarkDraft(e.target.value)}
                onBlur={saveRemark}
                placeholder="暂无"
                rows={3}
                style={{ width: '100%', resize: 'vertical', fontSize: 14, color: TEXT_MAIN, padding: '8px 10px', border: '1px solid ' + CARD_BORDER, borderRadius: 4, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', lineHeight: 1.6 }}
              />
            </div>
          ) : (
            <div className="flex items-center" style={{ gap: 6, fontSize: 14 }}>
              <span style={{ flexShrink: 0 }}>✍️</span>
              <span style={{ color: TEXT_SUB, flexShrink: 0 }}>备注信息：</span>
              <span
                style={{ position: 'relative', display: 'inline-block', color: detail.remark ? TEXT_MAIN : '#888888', cursor: 'pointer' }}
                onMouseEnter={() => setHoverRemark(true)}
                onMouseLeave={() => setHoverRemark(false)}
                onClick={() => { setRemarkDraft(detail.remark || ''); setEditingRemark(true); }}
              >
                {detail.remark ? detail.remark : '暂无'}
                {hoverRemark && (
                  <span style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 6, background: '#FFFFFF', border: '1px solid #D1D5DB', borderRadius: 4, padding: '4px 10px', fontSize: 13, color: TEXT_MAIN, whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', zIndex: 20, cursor: 'pointer' }}>
                    ✍️ 编辑
                    <span style={{ position: 'absolute', top: '100%', left: 12, width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '5px solid #D1D5DB' }} />
                  </span>
                )}
              </span>
            </div>
          )}
        </div>
      </section>

      {/* ============ Module 5：底片上传 Tab 卡片（保留既有上传/选片功能，仅换肤） ============ */}
      <section style={{ margin: '24px 24px 0', background: '#FFFFFF', border: '1px solid ' + CARD_BORDER, borderRadius: 4 }}>
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

          {/* 筛选操作栏：左侧 全部相册/底片/推荐；右侧 全选 → 仅下载精修片 → 排序 */}
          <div className="flex items-center" style={{ height: 40, marginTop: 12, gap: 12, fontSize: 14, color: '#444444', flexWrap: 'wrap' }}>
            <select style={filterCtrlStyle}><option>全部相册</option></select>
            <button type="button" style={filterBtnStyle}>底片（{photos.raw.length}）</button>
            <button type="button" style={filterBtnStyle}>推荐（0）</button>

            <div style={{ flex: 1 }} />

            <label className="flex items-center" style={{ gap: 6, fontSize: 14, color: '#444444' }}>
              <input type="checkbox" /> 全选
            </label>
            <select style={filterCtrlStyle}><option>仅下载精修片</option><option>全部素材</option></select>

            <div style={{ position: 'relative' }}>
              <button type="button"
                onMouseEnter={() => setSortTip(true)}
                onMouseLeave={() => setSortTip(false)}
                onClick={() => setSortOpen((o) => !o)}
                style={{ ...filterBtnStyle, display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M6 12h12M10 18h4" /></svg>
                排序
              </button>
              {sortTip && (
                <span style={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 6, background: '#FFFFFF', border: '1px solid #D1D5DB', borderRadius: 4, padding: '4px 10px', fontSize: 13, color: TEXT_MAIN, whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', zIndex: 20, pointerEvents: 'none' }}>排序</span>
              )}
              {sortOpen && (
                <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, minWidth: 150, background: '#FFFFFF', border: '1px solid #D1D5DB', borderRadius: 4, boxShadow: '0 2px 8px rgba(0,0,0,0.08)', zIndex: 30, padding: 4 }}>
                  {SORT_OPTS.map((o) => (
                    <div key={o.k} onClick={() => { setSortKey(o.k); setSortOpen(false); }}
                      style={{ padding: '8px 12px', fontSize: 14, cursor: 'pointer', borderRadius: 2, color: sortKey === o.k ? BLUE : TEXT_MAIN, background: sortKey === o.k ? 'rgba(45,183,245,0.08)' : 'transparent' }}>
                      {o.t}{sortKey === o.k ? '  ✓' : ''}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Tab 内容 */}
          <div style={{ marginTop: 16 }}>
            {imgTab === 'raw' && (
              <PhotoZone kind="raw" title="原片" photos={sortedRaw} uploading={uploading.raw}
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
              <PhotoZone kind="retouched" title="精修片" photos={sortedRetouched} uploading={uploading.retouched}
                onAdd={(files) => addPhotos('retouched', files)} onRemove={(u) => removePhoto('retouched', u)} />
            )}
          </div>

          {/* 底部链接 */}
          <button type="button" onClick={() => nav('/works')}
            style={{ marginTop: 16, background: 'none', border: 'none', color: BLUE, fontSize: 13, cursor: 'pointer' }}>查看选片演示案例 &gt;</button>
        </div>
      </section>

      {/* ============ Module 6：底部记录 Tab 卡片 ============ */}
      <section style={{ margin: '24px 24px 24px', background: '#FFFFFF', border: '1px solid ' + CARD_BORDER, borderRadius: 4 }}>
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
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#52C41A', marginRight: 8, flexShrink: 0 }} />
                  <span style={{ fontSize: 14, color: TEXT_SUB }}>{l.text}</span>
                  <span style={{ fontSize: 13, color: TEXT_SUB, marginLeft: 'auto' }}>{new Date(l.t).toLocaleString('zh-CN')}</span>
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
        <div className="fixed inset-0 flex items-center justify-center z-[70] p-4" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={() => setPay(null)}>
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
        <div className="fixed inset-0 flex items-center justify-center z-[70] p-4" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={() => setEdit(false)}>
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
            <div style={{ fontSize: 12, color: '#888888', marginTop: 6 }}>
              修改拍摄日期将自动释放原档期 {detail.shoot_date || '（无）'}，并占用新日期；若新日期已被占用会先提示冲突。
            </div>
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

      {/* 改拍摄日期档期冲突警告（验收④） */}
      {dateConflict && (
        <div className="fixed inset-0 flex items-center justify-center z-[90] p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 400, background: '#fff', borderRadius: 8, padding: 24 }}>
            <div style={{ color: '#222222', fontWeight: 600, marginBottom: 8 }}>档期冲突</div>
            <div style={{ fontSize: 14, color: '#333333', lineHeight: 1.7 }}>{dateConflict}</div>
            <div style={{ fontSize: 12, color: '#888888', marginTop: 8 }}>继续保存会在同一天产生重复占用，请确认是否由不同执行人分别承接。</div>
            <div className="flex justify-end" style={{ gap: 8, marginTop: 16 }}>
              <button type="button" onClick={() => setDateConflict(null)} style={modalCancelStyle}>换个日期</button>
              <button type="button" onClick={() => doSaveEdit(true)} style={{ ...modalSaveStyle, background: '#FF8A34' }}>仍要占用</button>
            </div>
          </div>
        </div>
      )}

      {/* 更换套系弹窗（验收⑥：仅更新当前订单快照） */}
      {pkgSwitch && (() => {
        const target = pkgs.find((p) => String(p.id) === String(pkgSwitch.package_id));
        const specs = target && Array.isArray(target.specs) ? target.specs : [];
        const curSpec = specs.find((s) => String(s.id) === String(pkgSwitch.spec_id));
        const newPrice = pkgSwitch.package_price !== ''
          ? (parseFloat(pkgSwitch.package_price) || 0)
          : (curSpec ? (parseFloat(curSpec.price) || 0) : (target ? parseFloat(target.price) || 0 : 0));
        return (
          <div className="fixed inset-0 flex items-center justify-center z-[85] p-4" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={() => setPkgSwitch(null)}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, background: '#fff', borderRadius: 8, padding: 24 }}>
              <div style={{ color: '#222222', fontWeight: 600, marginBottom: 4 }}>更换套系</div>
              <div style={{ fontSize: 12, color: '#888888', marginBottom: 16 }}>
                更换后会按所选套系的<b>最新配置</b>重新生成本订单快照，<b>仅影响当前订单</b>，其它历史订单不受影响。
              </div>
              <div style={{ fontSize: 13, color: '#666666', marginBottom: 8 }}>
                当前套系：{(pkgInfo && pkgInfo.name) || '—'} · ¥{Number((pkgInfo && pkgInfo.price) || 0).toLocaleString()}
              </div>
              <select value={pkgSwitch.package_id}
                onChange={(e) => setPkgSwitch({ ...pkgSwitch, package_id: e.target.value, spec_id: '', package_price: '' })}
                style={modalInputStyle}>
                <option value="">请选择套系</option>
                {pkgs.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}{p.status === 'off' ? '（已下架）' : ''} · ¥{Number(p.price || 0).toLocaleString()}
                  </option>
                ))}
              </select>
              {specs.length > 0 && (
                <select value={pkgSwitch.spec_id} onChange={(e) => setPkgSwitch({ ...pkgSwitch, spec_id: e.target.value, package_price: '' })}
                  style={{ ...modalInputStyle, marginTop: 12 }}>
                  <option value="">默认规格</option>
                  {specs.map((s) => <option key={s.id} value={String(s.id)}>{s.name} · ¥{Number(s.price || 0).toLocaleString()}</option>)}
                </select>
              )}
              <input value={pkgSwitch.package_price} type="number"
                onChange={(e) => setPkgSwitch({ ...pkgSwitch, package_price: e.target.value })}
                placeholder={'成交价（留空则用套系价 ¥' + newPrice.toLocaleString() + '）'}
                style={{ ...modalInputStyle, marginTop: 12 }} />
              <input value={pkgSwitch.reason} onChange={(e) => setPkgSwitch({ ...pkgSwitch, reason: e.target.value })}
                placeholder="更换原因（选填，写入操作日志）" style={{ ...modalInputStyle, marginTop: 12 }} />
              <div style={{ marginTop: 12, background: '#f9fafb', borderRadius: 4, padding: 12, fontSize: 13, color: '#333333' }}>
                更换后套系价：¥{newPrice.toLocaleString()}（应收总额将按 套系价 + 增值项 + 其他消费 重算，已收金额不变）
              </div>
              <div className="flex justify-end" style={{ gap: 8, marginTop: 16 }}>
                <button type="button" onClick={() => setPkgSwitch(null)} style={modalCancelStyle}>取消</button>
                <button type="button" disabled={pkgSwitching || !pkgSwitch.package_id} onClick={confirmPkgSwitch}
                  style={{ ...modalSaveStyle, opacity: pkgSwitching || !pkgSwitch.package_id ? 0.5 : 1 }}>
                  {pkgSwitching ? '更换中…' : '确认更换'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 加片设置弹窗（验收⑦：单价与精修张数一律取订单快照） */}
      {addonBox && (() => {
        const r = calcExtraFee(addonBox.count, addonBox.unit);
        return (
          <div className="fixed inset-0 flex items-center justify-center z-[85] p-4" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={() => setAddonBox(null)}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 440, background: '#fff', borderRadius: 8, padding: 24 }}>
              <div style={{ color: '#222222', fontWeight: 600, marginBottom: 4 }}>加片设置</div>
              <div style={{ fontSize: 12, color: '#888888', marginBottom: 16 }}>
                {addonBox.fromSnapshot
                  ? '加片单价与含修张数取自本订单下单时的套系快照，之后修改套系不会影响本单核算。'
                  : '该订单无套系快照（历史数据），已按当前套系配置核算。'}
              </div>
              <div className="grid grid-cols-2" style={{ gap: '8px 16px', fontSize: 13, color: '#333333' }}>
                <div>套系含修张数：<b>{addonBox.included}</b> 张</div>
                <div>客户已选：<b>{addonBox.picked}</b> 张</div>
                <div>快照加片费：<b>{addonBox.feeText || ('¥' + addonBox.unit + '/张')}</b></div>
                <div>快照加片优惠：<b>{addonBox.discountText || '按系统梯度'}</b></div>
              </div>
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 13, color: '#666666', marginBottom: 4 }}>加片张数</div>
                <input value={addonBox.count} type="number" min="0"
                  onChange={(e) => setAddonBox({ ...addonBox, count: e.target.value })} style={modalInputStyle} />
              </div>
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 13, color: '#666666', marginBottom: 4 }}>加片单价（元/张）</div>
                <input value={addonBox.unit} type="number" min="0"
                  onChange={(e) => setAddonBox({ ...addonBox, unit: parseFloat(e.target.value) || 0 })} style={modalInputStyle} />
              </div>
              <select value={addonBox.method} onChange={(e) => setAddonBox({ ...addonBox, method: e.target.value })}
                style={{ ...modalInputStyle, marginTop: 12 }}>
                <option value="offline">线下收款</option>
                <option value="online">线上收款</option>
              </select>
              <div style={{ marginTop: 12, background: '#f9fafb', borderRadius: 4, padding: 12, fontSize: 14, color: '#222222' }}>
                应收加片费：<b>¥{r.fee.toLocaleString()}</b>
                <span style={{ fontSize: 12, color: '#888888', marginLeft: 8 }}>
                  {r.count} 张 × ¥{r.unitPrice}/张{r.discount < 1 ? ' × ' + (r.discount * 10).toFixed(1) + ' 折' : '（无梯度优惠）'}
                </span>
              </div>
              <div className="flex justify-end" style={{ gap: 8, marginTop: 16 }}>
                <button type="button" onClick={() => setAddonBox(null)} style={modalCancelStyle}>取消</button>
                <button type="button" onClick={submitAddon} style={modalSaveStyle}>登记加片费</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 套系服务详情弹窗（点击「更多内容」唤起；全部读取订单快照，仅查看不可编辑） */}
      {pkgDetailModal && (
        <div className="fixed inset-0 flex items-center justify-center z-[95] p-4" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={() => setPkgDetailModal(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 620, background: '#ffffff', borderRadius: 8, maxHeight: '90vh', overflow: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,0.18)' }}>
            {/* 头部 */}
            <div className="flex items-center justify-between" style={{ padding: '20px 24px', borderBottom: '1px solid ' + DIV }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#222222' }}>套餐更多内容</div>
              <button type="button" onClick={() => setPkgDetailModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999999', fontSize: 22, lineHeight: 1 }} aria-label="关闭">×</button>
            </div>
            {/* 顶部 6 字段 2 列网格 */}
            <div className="grid grid-cols-2" style={{ gap: '12px 24px', padding: '20px 24px' }}>
              <div style={{ fontSize: 14 }}><span style={{ color: '#777777' }}>订单总价：</span><b style={{ color: '#222222' }}>¥{total.toLocaleString()}</b></div>
              <div style={{ fontSize: 14 }}><span style={{ color: '#777777' }}>加片费：</span><b style={{ color: '#222222' }}>{sumExtraFee}</b></div>
              <div style={{ fontSize: 14 }}><span style={{ color: '#777777' }}>拍摄时长：</span><b style={{ color: '#222222' }}>{sumDuration}</b></div>
              <div style={{ fontSize: 14 }}><span style={{ color: '#777777' }}>拍摄张数：</span><b style={{ color: '#222222' }}>{sumRawCount ? String(sumRawCount) + ' 张' : '—'}</b></div>
              <div style={{ fontSize: 14 }}><span style={{ color: '#777777' }}>精修张数：</span><b style={{ color: '#222222' }}>{sumRetouch}</b></div>
              <div style={{ fontSize: 14 }}><span style={{ color: '#777777' }}>适配相册：</span><b style={{ color: '#222222' }}>{sumAlbum}</b></div>
            </div>
            {/* Tab 切换组 */}
            <div className="flex" style={{ borderBottom: '1px solid ' + DIV, padding: '0 24px' }}>
              {[{ k: 'service', t: '服务详情' }, { k: 'refund', t: '退订政策' }, { k: 'selection', t: '选片提示' }].map((tb) => {
                const a = pkgDetailTab === tb.k;
                return (
                  <button key={tb.k} type="button" onClick={() => setPkgDetailTab(tb.k)}
                    style={{ padding: '10px 16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: a ? BLUE : '#666666', borderBottom: a ? ('2px solid ' + BLUE) : '2px solid transparent', fontWeight: a ? 500 : 400 }}>
                    {tb.t}
                  </button>
                );
              })}
            </div>
            {/* Tab 内容：虚线框渲染订单快照富文本 */}
            <div style={{ padding: 24 }}>
              <div style={{ border: '1px dashed #dcdcdc', borderRadius: 6, padding: 20, fontSize: 14, color: '#333333', whiteSpace: 'pre-wrap', lineHeight: 1.8, minHeight: 120 }}>
                {pkgDetailTab === 'service' && (
                  <>
                    <div className="flex items-start" style={{ gap: 8, color: '#d48806', marginBottom: 10 }}>
                      <span style={{ fontSize: 16, lineHeight: 1.4 }}>⚠</span>
                      <span>以下服务内容以最终双方签署的合同与拍摄确认为准，详情请见套系快照。</span>
                    </div>
                    <div>{sumService && sumService !== '—' ? sumService : '暂无服务详情'}</div>
                  </>
                )}
                {pkgDetailTab === 'refund' && (sumRefund && sumRefund !== '—' ? sumRefund : '暂无退订政策')}
                {pkgDetailTab === 'selection' && (sumSelection && sumSelection !== '—' ? sumSelection : '未开启')}
              </div>
            </div>
            {/* 底部确定按钮 */}
            <div className="flex justify-end" style={{ padding: '12px 24px 20px', borderTop: '1px solid ' + DIV }}>
              <button type="button" onClick={() => setPkgDetailModal(false)}
                style={{ height: 36, borderRadius: 2, background: BLUE, color: '#fff', fontSize: 14, border: 'none', padding: '0 24px', cursor: 'pointer' }}>确定</button>
            </div>
          </div>
        </div>
      )}

      {/* 客户影集分享弹窗 */}
      {shareModal && (
        <div className="fixed inset-0 flex items-center justify-center z-[80] p-4" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={() => setShareModal(false)}>
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
