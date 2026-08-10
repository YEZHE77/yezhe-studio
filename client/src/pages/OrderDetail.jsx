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

// 订单详情 11 步横向流程进度条（spec：订单生成 → … → 订单完结）
// 每一步的完成状态/时间全部由后端接口数据推导（status 阶段机 + 操作日志 logs + 原片上传数），禁止写死日期
const ORDER_STEPS_11 = [
  { key: 'created', label: '订单生成', kws: ['创建订单', '订单生成'] },
  { key: 'contract', label: '生成合同', kws: ['生成合同', '合同'] },
  { key: 'confirm', label: '沟通确认', kws: ['沟通确认', '沟通'] },
  { key: 'shooting', label: '拍摄执行', kws: ['拍摄执行', '开始拍摄', '阶段推进 → 已拍摄'] },
  { key: 'shot_done', label: '拍摄结束', kws: ['完成拍摄', '拍摄结束', '阶段推进 → 已拍摄'] },
  { key: 'selecting', label: '选片精修', kws: ['选片', '精修'] },
  { key: 'teaser', label: '预告片输出', kws: ['预告片'] },
  { key: 'retouch_done', label: '全部精修完成', kws: ['精修完成', '全部精修完成'] },
  { key: 'raw_pack', label: '原片打包', kws: ['上传原片', '原片打包'], raw: true },
  { key: 'deliver', label: '统一交付', kws: ['已交付', '统一交付'] },
  { key: 'complete', label: '订单完结', kws: ['已完成', '订单完结'] }
];
// 后端 status（6 阶段）→ 已完成的最后一步（1 起）
const STATUS_BOUNDARY_11 = { deposit: 1, shot: 5, selecting: 6, retouching: 6, delivered: 10, completed: 11 };
// 作废订单：按日志倒推已推进到哪一步（禁止写死）
function boundaryFromLogs(logs) {
  const has = (kw) => (logs || []).some((l) => (l.text || '').includes(kw));
  if (has('已完成') || has('订单完结')) return 11;
  if (has('已交付')) return 10;
  if (has('选片') || has('精修')) return 6;
  if (has('完成拍摄') || has('拍摄结束') || has('已拍摄')) return 5;
  return 1;
}
// 11 步推导：done = 已到该步（状态边界）且数据满足；current = 第一个未完成节点；time 全部取后端日志时间
function build11Steps(detail, logs, rawCount = 0) {
  if (!detail) return ORDER_STEPS_11.map((s) => ({ ...s, state: 'pending', time: null }));
  const boundary = detail.cancelled
    ? boundaryFromLogs(logs)
    : (STATUS_BOUNDARY_11[detail.status] || 1);
  let currentIdx = 0;
  for (let i = 0; i < ORDER_STEPS_11.length; i++) {
    const s = ORDER_STEPS_11[i];
    const within = (i + 1) <= boundary;
    const rawDone = !!s.raw && rawCount > 0 && boundary >= 4; // 原片已上传且拍摄已执行
    if (!within && !rawDone) { currentIdx = i; break; }
    if (i === ORDER_STEPS_11.length - 1) currentIdx = ORDER_STEPS_11.length;
  }
  return ORDER_STEPS_11.map((s, i) => {
    const within = (i + 1) <= boundary;
    const rawDone = !!s.raw && rawCount > 0 && boundary >= 4;
    const done = within || rawDone;
    const state = done ? 'done' : (i === currentIdx ? 'current' : 'pending');
    let time = null;
    if (done) {
      if (s.key === 'created') time = findStepTime(logs, s.kws) || fmtStepTime(detail.created_at);
      else time = findStepTime(logs, s.kws);
    }
    return { ...s, state, time };
  });
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
// 新规范全局色号（订单详情页 v2：轻量低饱和后台风）
const TEAL = '#67CFC3';          // 状态卡片顶部青绿细线 / 品牌点缀
const BLUE = '#2DB7F5';          // 主蓝色 / 当前·已完成节点 / 完成拍摄 / Tab 选中 / 确定按钮
const DIV = '#EEEEEE';           // 分割线 / 卡片边框
const CARD_BORDER = '#EDEDED';   // 卡片边框
const TEXT_MAIN = '#666666';     // 主文字
const TEXT_SUB = '#999999';      // 次级文字
const TEXT_WEAK = '#BFBFBF';     // 弱文字
const GREEN = '#82C8AE';         // 绿色状态标签（PicBling 实测：线下收取标签底色）
const BLACK_TAG = '#333333';     // 黑色状态标签 / 分享订单按钮
const STEP_ACTIVE = '#2DB7F5';   // 进度条激活/已完成圆圈（= 主蓝）
const INFO_LABEL = '#999999';    // 信息行标签
const INFO_VALUE = '#6C9295';    // 信息行值（PicBling 实测：#6c9295）

// ===== 订单详情·客户&订单基础信息卡片（spec 1:1 复刻，750 设计稿，单位 rpx） =====
const CARD_RADIUS = 6;                       // 卡片圆角 12rpx
const CARD_SHADOW = '0 1px 5px rgba(0,0,0,0.04)'; // 0 2rpx 10rpx rgba(0,0,0,0.04)
const ICON_COLOR = '#888888';                // 通用图标色（spec：40rpx #888）
const ICON_SIZE = 20;                        // 通用图标尺寸 40rpx
const HEAD_DIVIDER = '#e8e8e8';              // 头部下方分割线
const SURVEY_BTN = '#2DB7F5';                // 调查问卷按钮底色（PicBling 实测主蓝）
const TAG_OFFLINE = '#82C8AE';               // 线下收取 绿色标签（PicBling 实测）
const TAG_UNSETTLED = '#2c2c2c';             // 未结算 黑色标签
const SUMMARY_BG = '#fafbf8';                // 套系汇总底栏背景
const MORE_LINK = '#82C8AE';                 // 更多内容 链接文字（PicBling 实测青绿）
const AVATAR_PURPLE = '#AEA2D5';             // 客户头像·圆形紫（PicBling 实测）
const LABEL_COLOR = '#999999';               // 信息行标签浅灰（PicBling 实测 #999）

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
  // 客户信息头像下拉浮层
  const [custInfoOpen, setCustInfoOpen] = useState(false);
  // 已付加片费 问号图标 hover 提示
  const [addonHelp, setAddonHelp] = useState(false);
  // 编辑订单弹窗：渠道列表 + 人员列表（联调后端）
  const [channels, setChannels] = useState([]);
  const [personnel, setPersonnel] = useState([]);
  // 编辑订单表单校验错误
  const [editErrors, setEditErrors] = useState({});
  // 执行人多选下拉（编辑订单弹窗内）
  const [execDropdownOpen, setExecDropdownOpen] = useState(false);
  // 执行人独立选择弹窗（芯片标签区域的蓝色加号按钮唤起）
  const [execPickerOpen, setExecPickerOpen] = useState(false);
  const [execPickerSelections, setExecPickerSelections] = useState([]);
  // 打印单据
  const [printMode, setPrintMode] = useState(false);
  // 底部常驻记录卡片 Tab（订单状态详情 / 交易记录 / 下载记录）
  const [logTab, setLogTab] = useState('status');
  // 右上角【查看记录】唤起日志弹窗（与底部卡片并存，独立 Tab 状态）
  const [logModal, setLogModal] = useState(false);
  const [logModalTab, setLogModalTab] = useState('status');
  // 调查问卷弹窗
  const [questionnaireModal, setQuestionnaireModal] = useState(false);

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
    http.get('/api/channels', { signal: ctrl.signal }).then((r) => setChannels(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    http.get('/api/admin/personnel', { signal: ctrl.signal }).then((r) => setPersonnel(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    return () => ctrl.abort();
  }, []);
  useEffect(() => {
    const ctrl = new AbortController();
    http.get('/api/packages?status=all', { signal: ctrl.signal }).then((r) => setPkgs(r.data)).catch(() => {});
    return () => ctrl.abort();
  }, []);
  useEffect(() => () => { bgm.pause(); }, []);
  // 点击空白收起下拉（客户信息 / 更多设置 / 执行人下拉）
  useEffect(() => {
    if (!custInfoOpen && !moreMenu && !execDropdownOpen) return;
    const handler = (e) => {
      if (custInfoOpen) setCustInfoOpen(false);
      if (moreMenu) setMoreMenu(false);
      if (execDropdownOpen) setExecDropdownOpen(false);
    };
    const id = setTimeout(() => document.addEventListener('click', handler), 0);
    return () => { clearTimeout(id); document.removeEventListener('click', handler); };
  }, [custInfoOpen, moreMenu, execDropdownOpen]);
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
      address: detail.address || '', shoot_date: detail.shoot_date || '',
      executors: asArr(detail.executors).map((x) => typeof x === 'object' ? x : { id: null, name: x }),
      channel: detail.channel || '', channel_id: detail.channel_id || '',
      remark: detail.remark || '', status: detail.status
    });
    setEditErrors({});
    setEdit(true);
  };
  async function saveEdit(e) {
    if (e) e.preventDefault();
    // 前端表单校验
    const errs = {};
    const name = [editForm.groom_name, editForm.bride_name].filter(Boolean).join('').trim();
    if (!name) errs.customer_name = '请至少填写新郎或新娘姓名';
    const phone = (editForm.customer_phone || '').trim();
    if (!phone) errs.customer_phone = '请填写联系电话';
    else if (!/^1\d{10}$/.test(phone)) errs.customer_phone = '手机号格式不正确（应为 11 位数字）';
    if (Object.keys(errs).length > 0) { setEditErrors(errs); return; }
    await doSaveEdit(false);
  }
  // 保存订单编辑；改拍摄日期时后端会做档期冲突检测（验收④），冲突则二次确认后 force 提交
  async function doSaveEdit(force) {
    try {
      // 确保后端收到规范的 phones 数组和 executors 数组
      const phoneVal = (editForm.customer_phone || '').trim();
      await http.put('/api/orders/' + detail.id, {
        ...editForm,
        phones: phoneVal ? [phoneVal] : [],
        channel: editForm.channel || '',
        channel_id: editForm.channel_id || '',
        force: force ? 1 : 0
      });
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

  // 移除执行人（芯片标签 × 按钮）：二次确认后过滤并提交
  async function removeExecutor(index) {
    if (!window.confirm('确认移除此执行人？')) return;
    const nextExecs = execs.filter((_, i) => i !== index);
    try {
      await http.put('/api/orders/' + detail.id, { executors: nextExecs });
      reload();
    } catch (e) {
      alert('移除执行人失败：' + (e?.message || '未知错误'));
    }
  }

  // 保存执行人选择（独立弹窗确认）：将已勾选人员提交后端
  async function saveExecutors() {
    try {
      await http.put('/api/orders/' + detail.id, { executors: execPickerSelections });
      setExecPickerOpen(false);
      reload();
    } catch (e) {
      alert('保存执行人失败：' + (e?.message || '未知错误'));
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
  function printOrder() {
    if (!detail) return;
    setMoreMenu(false);
    // 先渲染打印内容，再触发打印
    setPrintMode(true);
    // 延迟确保 DOM 渲染完成后再打印
    setTimeout(() => { window.print(); setPrintMode(false); }, 300);
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

  // 更多设置下拉菜单（复刻截图：仅保留 编辑订单 / 打印单据 2 项）
  const renderMoreMenu = () => (
    <div style={{ position: 'absolute', zIndex: 60, marginTop: 4, background: '#fff', border: '1px solid ' + DIV, borderRadius: 4, boxShadow: '0 6px 20px rgba(0,0,0,0.10)', padding: '6px 0', fontSize: 14, width: 142 }}>
      <button type="button" onClick={() => { setMoreMenu(false); openEdit(); }} style={moreItemStyle}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
          编辑订单
        </span>
      </button>
      <button type="button" onClick={() => { setMoreMenu(false); printOrder(); }} style={moreItemStyle}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>
          打印单据
        </span>
      </button>
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

  const steps = build11Steps(detail, detail.logs, photos.raw.length);
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
    <div style={{ background: '#f7f7f7', minHeight: '100vh', padding: '0 16px 24px', maxWidth: 1280, width: '100%', margin: '0 auto' }}>
      {/* ============ Module 3：订单状态卡片（白色卡片 + 左侧操作 + 右侧 4 步进度条，复刻第3张） ============ */}
      <section style={{ margin: '8px 24px 0', background: '#FFFFFF', border: '1px solid ' + CARD_BORDER, borderTop: '3px solid ' + TEAL, borderRadius: 4, boxShadow: '0 1px 5px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
        <div className="flex items-stretch" style={{ minHeight: 132 }}>
          {/* 左侧订单操作区 */}
          <div className="flex flex-col justify-center shrink-0" style={{ width: '26%', minWidth: 240, padding: '16px 28px', gap: 10, position: 'relative' }}>
            <div style={{ fontSize: 12, color: TEXT_SUB, marginBottom: 2 }}>
              订单编号：<span style={{ color: '#333333', fontWeight: 400 }}>{detail.order_no}</span>
            </div>
            <button type="button" onClick={finishShoot} disabled={detail.status === 'cancelled'}
              style={{ width: '100%', height: 38, borderRadius: 2, background: BLUE, color: '#fff', fontSize: 12, fontWeight: 400, border: '1px solid ' + BLUE, opacity: detail.status === 'cancelled' ? 0.4 : 1, cursor: 'pointer' }}>完成拍摄</button>
            <button type="button" onClick={openMiniQr} disabled={miniQrLoading}
              style={{ width: '100%', height: 38, borderRadius: 2, background: BLACK_TAG, color: '#fff', fontSize: 12, fontWeight: 400, border: '1px solid ' + BLACK_TAG, cursor: 'pointer', opacity: miniQrLoading ? 0.6 : 1 }}>分享订单</button>
            <div className="flex items-center" style={{ justifyContent: 'space-between', marginTop: 2 }}>
              <button type="button" onClick={cancel}
                style={{ background: 'none', border: 'none', color: TEXT_MAIN, fontSize: 12, textAlign: 'left', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                关闭订单
              </button>
              <button type="button" onClick={() => setMoreMenu((m) => !m)}
                style={{ background: 'none', border: 'none', color: TEXT_MAIN, fontSize: 12, textAlign: 'right', cursor: 'pointer', padding: 0, position: 'relative', display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></svg>
                更多设置
              </button>
            </div>
            {moreMenu && renderMoreMenu()}
          </div>

          {/* 竖向分割线 */}
          <div style={{ width: 1, background: DIV, margin: '16px 0' }} />

          {/* 右侧 11 步横向流程进度条（spec：完成=蓝色圆圈+蓝色对勾 / 当前=蓝色实心 / 未达=灰色空心；连接线蓝/灰；支持横向滚动） */}
          <div className="flex-1" style={{ minWidth: 0, padding: '14px 28px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 12 }}>
            <div style={{ fontSize: 12, color: TEXT_SUB, textAlign: 'right' }}>
              {statusText}<span style={{ color: BLUE, marginLeft: 8, cursor: 'pointer' }} onClick={() => setLogModal(true)}>查看记录</span>
            </div>
            <div style={{ overflowX: 'auto', overflowY: 'hidden' }}>
              <div className="flex items-start" style={{ gap: 0, minWidth: steps.length * 78 + (steps.length - 1) * 22 }}>
                {steps.map((st, i) => (
                  <React.Fragment key={st.key}>
                    <div className="flex flex-col items-center" style={{ width: 78, flexShrink: 0 }}>
                      <div style={{
                        width: 30, height: 30, borderRadius: '50%',
                        background: st.state === 'done' ? '#EAF6FD' : st.state === 'current' ? BLUE : '#FFFFFF',
                        border: st.state === 'done' || st.state === 'current' ? ('1px solid ' + BLUE) : '1px solid rgba(0,0,0,0.25)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: st.state === 'done' ? BLUE : (st.state === 'pending' ? 'rgba(0,0,0,0.25)' : '#FFFFFF')
                      }}>
                        {st.state === 'done'
                          ? <CheckIcon />
                          : <span style={{ fontSize: 13, fontWeight: 400, color: st.state === 'current' ? '#FFFFFF' : 'rgba(0,0,0,0.25)' }}>{i + 1}</span>}
                      </div>
                      <span style={{ fontSize: 12, marginTop: 7, textAlign: 'center', whiteSpace: 'nowrap', color: st.state === 'pending' ? 'rgba(0,0,0,0.25)' : st.state === 'current' ? '#555555' : 'rgba(0,0,0,0.65)' }}>{st.label}</span>
                      {st.time ? <span style={{ marginTop: 5, fontSize: 11, textAlign: 'center', color: 'rgba(0,0,0,0.45)' }}>{st.time}</span> : null}
                    </div>
                    {i < steps.length - 1 && (
                      <div style={{ flex: 1, height: 1, minWidth: 22, marginTop: 15, background: (st.state === 'done' && steps[i + 1].state === 'done') ? BLUE : '#E5E5E5' }} />
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ 客户&订单基础信息卡片（全卡 1:1 复刻，750 设计稿，rpx） ============ */}
      <section style={{ margin: '8px 24px 0', background: '#FFFFFF', borderRadius: CARD_RADIUS, boxShadow: CARD_SHADOW, overflow: 'hidden' }}>

        {/* ——— 1、卡片头部行 ——— */}
        <div style={{ padding: '20px 24px 0' }}>
          <div className="flex items-center justify-between">
            {/* 左：圆形客户头像 / 客户姓名 / 手机号 / 编辑笔 / 红色边框【客户信息】 */}
            <div className="flex items-center" style={{ gap: 8 }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: AVATAR_PURPLE, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 20, fontWeight: 400, flexShrink: 0 }}>{custInitial}</div>
              <span style={{ fontSize: 14, color: '#333333' }}>{custName}</span>
              <span style={{ fontSize: 12, color: '#999999' }}>{phoneList.length ? phoneList.join(' / ') : (detail.customer_phone || '')}</span>
              <button type="button" onClick={openEdit} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#999999', display: 'flex' }} title="编辑订单">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>
              </button>
              <div style={{ position: 'relative' }}>
                <button type="button" onClick={() => setCustInfoOpen((v) => !v)}
                  style={{ fontSize: 10, color: '#F47174', background: 'transparent', border: '1px solid #F9E4E3', borderRadius: 2, padding: '2px 8px', cursor: 'pointer' }}>客户信息</button>
                {custInfoOpen && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 65, background: '#FFFFFF', border: '1px solid ' + CARD_BORDER, borderRadius: 6, padding: 18, boxShadow: '0 6px 20px rgba(0,0,0,0.12)', width: 260 }}>
                    <div className="flex items-center" style={{ gap: 10, marginBottom: 14 }}>
                      <div style={{ width: 42, height: 42, borderRadius: '50%', background: AVATAR_PURPLE, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 18, fontWeight: 400, flexShrink: 0 }}>{custInitial}</div>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 400, color: '#333333' }}>{custName}</div>
                        <div style={{ fontSize: 12, color: TEXT_SUB, marginTop: 2 }}>{detail.order_no || '—'}</div>
                      </div>
                    </div>
                    <div style={{ borderTop: '1px solid ' + DIV, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {[
                        { key: 'wechat', icon: <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></>, label: '微信号', val: '—', badge: '未绑定', badgeColor: '#999999', badgeBg: '#f5f5f5' },
                        { key: 'phone', icon: <><rect x="5" y="2" width="14" height="20" rx="2" /><line x1="12" y1="18" x2="12.01" y2="18" /></>, label: '手机号', val: phoneList.length ? phoneList[0] : '—', badge: phoneList.length ? '已绑定' : '未绑定', badgeColor: phoneList.length ? '#52c41a' : '#999999', badgeBg: phoneList.length ? '#e6f7ed' : '#f5f5f5' },
                        { key: 'address', icon: <><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></>, label: '地址', val: detail.address || '—', badge: null, badgeColor: null, badgeBg: null },
                        { key: 'date', icon: <><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>, label: '拍摄日期', val: tbd ? '日期待定' : (detail.shoot_date || '—'), badge: null, badgeColor: null, badgeBg: null },
                        { key: 'channel', icon: <><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></>, label: '渠道', val: detail.channel || detail.source || '—', badge: null, badgeColor: null, badgeBg: null },
                      ].map((item) => (
                        <div key={item.key} className="flex items-center justify-between" style={{ padding: '7px 0' }}>
                          <div className="flex items-center" style={{ gap: 8, flex: 1, overflow: 'hidden' }}>
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#999999" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              {item.icon}
                            </svg>
                            <span style={{ fontSize: 13, color: '#666666', flexShrink: 0 }}>{item.label}</span>
                            <span style={{ fontSize: 13, color: '#333333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{item.val}</span>
                          </div>
                          {item.badge && <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 3, background: item.badgeBg, color: item.badgeColor, flexShrink: 0 }}>{item.badge}</span>}
                        </div>
                      ))}
                    </div>
                    <button type="button" onClick={() => { setCustInfoOpen(false); openEdit(); }}
                      style={{ marginTop: 14, width: '100%', height: 32, borderRadius: 2, background: BLUE, color: '#fff', fontSize: 12, border: 'none', cursor: 'pointer' }}>编辑资料</button>
                  </div>
                )}
              </div>
            </div>

            {/* 右：四个功能按钮 */}
            <div className="flex items-center" style={{ gap: 12 }}>
              <button type="button" onClick={() => setQuestionnaireModal(true)}
                style={{ height: 36, borderRadius: 2, background: SURVEY_BTN, color: '#fff', fontSize: 12, fontWeight: 400, border: '1px solid ' + SURVEY_BTN, padding: '0 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 13h6M9 17h6" /></svg>
                调查问卷
              </button>
              <button type="button" onClick={openEdit}
                style={{ ...secBtnStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                编辑订单
              </button>
              <button type="button" onClick={openAddonBox}
                style={{ ...secBtnStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></svg>
                加片设置
              </button>
              <button type="button" onClick={() => setMoreMenu((m) => !m)}
                style={{ ...secBtnStyle, display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>
                更多设置
              </button>
              {moreMenu && renderMoreMenu()}
            </div>
          </div>

          <div style={{ height: 1, background: HEAD_DIVIDER, margin: '12px 0' }} />
        </div>

        {/* ——— 2、订单信息主体：左侧基础信息 + 右侧灰色小卡片分组 ——— */}
        <div style={{ padding: '0 24px' }}>
          <div className="flex" style={{ gap: 24, alignItems: 'stretch' }}>
            {/* 左侧：套系封面图 + 基础信息 */}
            <div style={{ flex: '0 0 46%', display: 'flex', alignItems: 'flex-start', gap: 24, minWidth: 0 }}>
              <div style={{ width: 206, height: 150, borderRadius: 2, overflow: 'hidden', background: '#f3f4f6', flexShrink: 0 }}>
                {pkgInfo && pkgInfo.cover_url
                  ? <img src={img(pkgInfo.cover_url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: 12 }}>套系缩略图</div>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0, flex: 1 }}>
                <InfoRow label="套系名称" labelColor={LABEL_COLOR}
                  icon={<><rect x="4" y="3" width="16" height="18" rx="2" /><line x1="8" y1="8" x2="16" y2="8" /><line x1="8" y1="12" x2="16" y2="12" /><line x1="8" y1="16" x2="12" y2="16" /></>}
                  value={pkgInfo && pkgInfo.name && pkgInfo.name !== '—' ? pkgInfo.name : '暂无'} />
                <InfoRow label="定金" labelColor={LABEL_COLOR}
                  icon={<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />}
                  value={<span style={{ fontSize: 12 }}>{'¥' + Number(pkgInfo?.deposit || 0).toLocaleString()}</span>}
                  tags={detail.pay_method === 'offline' ? [{ t: '线下收取', bg: TAG_OFFLINE, fg: '#fff' }] : []} />
                <InfoRow label="已付加片费" labelColor={LABEL_COLOR}
                  icon={<><path d="M4 2v20l2-2 2 2 2-2 2 2 2-2 2 2 2-2 2 2V2l-2 2-2-2-2 2-2-2-2 2-2-2-2 2z" /><line x1="8" y1="7" x2="16" y2="7" /><line x1="8" y1="11" x2="16" y2="11" /><line x1="8" y1="15" x2="12" y2="15" /></>}
                  value={
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative', fontSize: 12 }}>
                      <span>{'¥' + extraSum.toLocaleString()}</span>
                      <span
                        onMouseEnter={() => setAddonHelp(true)} onMouseLeave={() => setAddonHelp(false)}
                        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14, borderRadius: '50%', border: '1px solid ' + LABEL_COLOR, color: LABEL_COLOR, fontSize: 10, cursor: 'help', flexShrink: 0 }}
                      >?</span>
                      {addonHelp && (
                        <div style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 6, background: '#222222', color: '#fff', fontSize: 12, padding: '6px 10px', borderRadius: 4, whiteSpace: 'nowrap', zIndex: 30, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
                          已登记的加片费合计
                        </div>
                      )}
                    </span>
                  } />
                <InfoRow label="渠道来源" labelColor={LABEL_COLOR}
                  icon={<rect x="4" y="4" width="16" height="16" rx="2" />}
                  value={
                    <select
                      value={detail.channel || ''}
                      onChange={async (e) => {
                        const newChannel = e.target.value;
                        const ch = channels.find((c) => c.name === newChannel);
                        try {
                          await http.put('/api/orders/' + detail.id, { channel: newChannel, channel_id: ch ? ch.id : '' });
                          reload();
                        } catch {}
                      }}
                      style={{ border: '1px solid #d9d9d9', borderRadius: 2, padding: '3px 8px', fontSize: 12, color: '#222222', background: '#fff', outline: 'none', cursor: 'pointer', maxWidth: 160 }}>
                      <option value="">暂无</option>
                      {channels.map((c) => (
                        <option key={c.id} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                  } />
                <InfoRow label="执行人" labelColor={LABEL_COLOR}
                  icon={<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>}
                  value={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {execs.length ? execs.map((p, i) => (
                        <div key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#f5f5f5', borderRadius: 999, padding: '2px 12px 2px 4px' }}>
                          {p.avatar ? <img src={p.avatar} alt="" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} onError={(e) => { e.target.style.display = 'none'; e.target.parentElement.insertAdjacentHTML('afterbegin', '<div style="width:32px;height:32px;border-radius:50%;background:#333;color:#fff;font-size:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0">' + p.name.slice(0,1) + '</div>'); }} />
                          : <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#333333', color: '#fff', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{p.name.slice(0, 1)}</div>}
                          <span style={{ fontSize: 14, color: '#222222' }}>{p.name}</span>
                          <button type="button" onClick={() => removeExecutor(i)} title="移除此执行人"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#444444', padding: 0, fontSize: 18, lineHeight: 1, flexShrink: 0 }}>&times;</button>
                        </div>
                      )) : <span style={{ color: '#999999', fontSize: 12 }}>暂无</span>}
                      <button type="button" onClick={() => { setExecPickerSelections(execs.map((e) => ({ id: e.id, name: e.name, avatar: e.avatar || '' }))); setExecPickerOpen(true); }}
                        title="添加执行人"
                        style={{ width: 32, height: 32, borderRadius: '50%', background: '#21a6ff', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 16, padding: 0, flexShrink: 0 }}>+</button>
                    </div>
                  }
                />
              </div>
            </div>

            {/* 右侧：灰色小卡片分组 */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
              {/* 右上卡片：拍摄信息 */}
              <div style={{ background: '#FFFFFF', borderRadius: 0, padding: '0 0 8px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                <InfoRow label="拍摄时间" labelColor={LABEL_COLOR}
                  icon={<><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>}
                  value={tbd ? '日期待定' : ((detail.shoot_date || '暂无') + (slots.length ? ' ' + slots.join(' ') : ''))} />
                <InfoRow label="尾款" labelColor={LABEL_COLOR}
                  icon={<><path d="M20 12V8H6a2 2 0 0 1 0-4h14v4" /><path d="M4 6v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4" /><circle cx="16" cy="13" r="1" /></>}
                  value={<span style={{ fontSize: 12 }}>{'¥' + remain.toLocaleString()}</span>}
                  tags={remain > 0 ? [{ t: '未结算', bg: TAG_UNSETTLED, fg: '#fff' }] : []} />
                <InfoRow label="拍摄地址" labelColor={LABEL_COLOR}
                  icon={<><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></>}
                  value={detail.address || '暂无'} />
              </div>

              {/* 右下卡片：套系摘要 */}
              <div style={{ background: '#fafbf8', borderRadius: 2, padding: '18px 20px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px 12px' }}>
                  {(() => {
                    const SUM_FIELDS = [
                      { t: '总价', v: '¥' + total.toLocaleString(), ic: <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /> },
                      { t: '服务详情', v: (sumService && sumService !== '—' && sumService !== '暂无') ? (String(sumService).length > 14 ? String(sumService).slice(0, 14) + '…' : String(sumService)) : '暂无', ic: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 13h6M9 17h6" /></> },
                      { t: '底片全送', v: sumRawPolicy, ic: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></> },
                      { t: '加片费', v: sumExtraFee, ic: <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></> },
                      { t: '拍摄时长', v: sumDuration, ic: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></> },
                      { t: '拍摄', v: sumRawCount ? String(sumRawCount) + ' 张' : '暂无', ic: <><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></> },
                      { t: '精修片', v: sumRetouch, ic: <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></> },
                    ];
                    // 参考图：行内「图标 标签：值」对，4 列 2 行；「更多内容」作为第 8 格
                    return SUM_FIELDS.map((f) => (
                      <div key={f.t} className="flex items-center" style={{ fontSize: 12, color: LABEL_COLOR, gap: 5, minWidth: 0 }}>
                        <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke={ICON_COLOR} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{f.ic}</svg>
                        <span className="truncate">{f.t}：{f.v}</span>
                      </div>
                    ));
                  })()}
                  <div className="flex items-center" style={{ fontSize: 12, color: MORE_LINK, gap: 5, cursor: 'pointer' }}
                    onClick={() => { setPkgDetailTab('service'); setPkgDetailModal(true); }}>
                    <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></svg>
                    更多内容
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ——— 3、执行人单行（已迁移至左侧基础信息内） ——— */}
        <div style={{ marginTop: 0 }} />

        {/* ——— 4、浅灰色套系摘要区块（已迁移至右侧灰色小卡片） ——— */}
        <div style={{ marginTop: 0 }} />

        {/* ——— 5、卡片底部：备注信息 ——— */}
        <div style={{ padding: '14px 16px 12px' }}>
          {editingRemark ? (
            <div>
              <div className="flex items-center" style={{ gap: 6, marginBottom: 8 }}>
                <svg viewBox="0 0 24 24" width={ICON_SIZE} height={ICON_SIZE} fill="none" stroke={ICON_COLOR} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>
                <span style={{ fontSize: 12, color: LABEL_COLOR, flexShrink: 0 }}>备注信息：</span>
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
              <svg viewBox="0 0 24 24" width={ICON_SIZE} height={ICON_SIZE} fill="none" stroke={ICON_COLOR} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>
              <span style={{ fontSize: 12, color: LABEL_COLOR, flexShrink: 0 }}>备注信息：</span>
              <span
                style={{ position: 'relative', display: 'inline-block', color: detail.remark ? TEXT_MAIN : '#888888', cursor: 'pointer' }}
                onMouseEnter={() => setHoverRemark(true)}
                onMouseLeave={() => setHoverRemark(false)}
                onClick={() => { setRemarkDraft(detail.remark || ''); setEditingRemark(true); }}
              >
                {detail.remark ? detail.remark : '暂无'}
                {hoverRemark && (
                  <span style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 6, background: '#FFFFFF', border: '1px solid #D1D5DB', borderRadius: 4, padding: '4px 10px', fontSize: 13, color: TEXT_MAIN, whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', zIndex: 20, cursor: 'pointer' }}>
                    编辑
                    <span style={{ position: 'absolute', top: '100%', left: 12, width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '5px solid #D1D5DB' }} />
                  </span>
                )}
              </span>
            </div>
          )}
        </div>
      </section>

      {/* ============ Module 5：底片上传 Tab 卡片（保留既有上传/选片功能，仅换肤） ============ */}
      <section style={{ margin: '8px 24px 0', background: '#FFFFFF', border: '1px solid ' + CARD_BORDER, borderRadius: 4 }}>
        {/* Tab 头部 */}
        <div className="flex items-center" style={{ height: 44, borderBottom: '1px solid ' + DIV }}>
          <div className="flex">
          {[{ k: 'raw', t: '原片' }, { k: 'sel', t: '选片' }, { k: 'retouched', t: '精修片' }].map((tb) => {
            const active = imgTab === tb.k;
            const count = tb.k === 'raw' ? photos.raw.length : tb.k === 'retouched' ? photos.retouched.length : (sel && sel.photos ? sel.photos.length : 0);
            return (
              <button key={tb.k} type="button" onClick={() => setImgTab(tb.k)}
                style={{
                  padding: '0 20px', height: 44, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12,
                  color: active ? BLUE : 'rgba(0,0,0,0.65)',
                  borderBottom: active ? '2px solid ' + BLUE : '2px solid transparent', fontWeight: 400
                }}>{tb.t}({count})</button>
            );
          })}
          </div>
          <div style={{ flex: 1 }} />
        </div>

        <div style={{ padding: '12px 24px 24px' }}>
          {/* 提示警告条（黄色提示 + 灯泡图标） */}
          <div style={{ background: '#FAFAEC', color: '#D1B372', fontSize: 11, padding: '9px 16px', display: 'flex', alignItems: 'center', gap: 8, borderRadius: 0 }}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z" /></svg>
            <span>上传小图用于选片和浏览，同时，在网盘中提供原图用于下载，可节省存储和流量成本。</span>
            <span style={{ flex: 1 }} />
            <span onClick={() => nav('/capacity')}
              style={{ color: BLUE, fontSize: 11, cursor: 'pointer', fontWeight: 400, whiteSpace: 'nowrap' }}>查看容量</span>
          </div>

          {/* 筛选操作栏：左侧 全部相册/底片/推荐；右侧 全选 → 仅下载精修片 → 排序 */}
          <div className="flex items-center" style={{ height: 40, marginTop: 12, gap: 12, fontSize: 12, color: '#444B53', flexWrap: 'wrap' }}>
            <select style={{ ...filterCtrlStyle, color: 'rgba(0,0,0,0.65)' }}><option>全部相册</option></select>
            <button type="button" style={{ ...filterBtnStyle, background: '#2F2F31', color: '#fff', border: '1px solid #2F2F31' }}>底片 {photos.raw.length}</button>
            <button type="button" style={filterBtnStyle}>推荐 0</button>

            <div style={{ flex: 1 }} />

            <label className="flex items-center" style={{ gap: 6, fontSize: 14, color: 'rgba(0,0,0,0.65)' }}>
              <input type="checkbox" /> 全选
            </label>
            <select style={filterCtrlStyle}>
              <option>仅下载精修片</option>
              <option>仅下载原片</option>
              <option>仅下载选片</option>
              <option>全部素材</option>
            </select>

            <button type="button" onClick={() => nav('/works')} title="更多选片设置"
              style={{ background: 'none', border: 'none', color: '#666666', fontSize: 12, cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></svg>
            </button>

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
            style={{ marginTop: 16, background: 'none', border: 'none', color: BLUE, fontSize: 12, cursor: 'pointer' }}>查看选片演示案例 &gt;</button>
        </div>
      </section>

      {/* ============ Module 6：底部记录卡片（订单状态详情 / 交易记录 / 下载记录），与顶部【查看记录】弹窗并存 ============ */}
      <section style={{ margin: '8px 24px 24px', background: '#FFFFFF', border: '1px solid ' + CARD_BORDER, borderRadius: CARD_RADIUS, boxShadow: CARD_SHADOW, overflow: 'hidden' }}>
        <div className="flex" style={{ height: 46, borderBottom: '1px solid ' + DIV, padding: '0 8px' }}>
          {[{ k: 'status', t: '订单状态详情' }, { k: 'trade', t: '交易记录' }, { k: 'download', t: '下载记录' }].map((tb) => {
            const active = logTab === tb.k;
            return (
              <button key={tb.k} type="button" onClick={() => setLogTab(tb.k)}
                style={{
                  padding: '0 16px', height: 46, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12,
                  color: active ? BLUE : 'rgba(0,0,0,0.65)',
                  borderBottom: active ? ('2px solid ' + BLUE) : '2px solid transparent', fontWeight: 400
                }}>{tb.t}</button>
            );
          })}
        </div>
        <div style={{ padding: '20px 24px' }}>
          {logTab === 'status' && (
            <>
              <div style={{ color: '#222222', marginBottom: 8 }}>操作日志</div>
              {(detail.logs || []).length === 0 && <div style={{ color: '#999999', fontSize: 14, padding: '4px 0' }}>暂无日志</div>}
              {(detail.logs || []).map((l, i, arr) => (
                <div key={i} className="flex" style={{ gap: 12 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 10, flexShrink: 0 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#52C41A', marginTop: 7, flexShrink: 0 }} />
                    {i < arr.length - 1 && <span style={{ flex: 1, width: 1, background: '#EAEAEA', marginTop: 4 }} />}
                  </div>
                  <div style={{ flex: 1, paddingBottom: 14 }}>
                    <div style={{ fontSize: 14, color: '#333333' }}>{l.text}</div>
                    <div style={{ fontSize: 12, color: TEXT_SUB, marginTop: 2 }}>{new Date(l.t).toLocaleString('zh-CN')}</div>
                  </div>
                </div>
              ))}
            </>
          )}
          {logTab === 'trade' && (
            <div>
              <div style={{ color: '#222222', marginBottom: 8 }}>收款流水</div>
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
          {logTab === 'download' && (
            <div>
              <div style={{ color: '#222222', marginBottom: 8 }}>可下载素材（原片 / 精修片 / 选片）</div>
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
        <div className="fixed inset-0 flex items-center justify-center z-[70] p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: '#fff', border: '1px solid ' + DIV, borderRadius: 8, padding: 24 }}>
            <div style={{ color: '#222222', fontWeight: 400, marginBottom: 16 }}>登记收款 · {detail.order_no}</div>
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

      {/* 编辑订单弹窗（卡片式横向布局，复刻截图） */}
      {edit && (
        <div className="fixed inset-0 flex items-center justify-center z-[70] p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={saveEdit} style={{ width: '100%', maxWidth: 780, background: '#fff', border: '1px solid ' + DIV, borderRadius: 8, padding: 28, maxHeight: '90vh', overflow: 'auto' }}>
            <div style={{ color: '#222222', fontWeight: 400, marginBottom: 22, fontSize: 16 }}>编辑订单 · {detail.order_no}</div>

            {/* 双卡片横向布局 */}
            <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
              {/* 卡片 1：基本信息 */}
              <div style={{ flex: '1 1 50%', minWidth: 0, background: '#FAFAFA', border: '1px solid ' + DIV, borderRadius: 6, padding: 18 }}>
                <div style={{ fontSize: 14, fontWeight: 400, color: '#333333', marginBottom: 16, paddingBottom: 10, borderBottom: '1px solid ' + DIV }}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6, verticalAlign: -2 }}>
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                  </svg>
                  基本信息
                </div>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, color: '#666666', marginBottom: 4 }}>订单名称</div>
                  <input value={editForm.order_name} onChange={(e) => setEditForm({ ...editForm, order_name: e.target.value })} placeholder="如「张三 & 李四 婚纱照」" style={{ ...modalInputStyle, fontSize: 13 }} />
                </div>
                <div className="grid grid-cols-2" style={{ gap: 12, marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 13, color: '#666666', marginBottom: 4 }}>新郎姓名 <span style={{ color: '#ef4444' }}>*</span></div>
                    <input value={editForm.groom_name} onChange={(e) => setEditForm({ ...editForm, groom_name: e.target.value })} placeholder="新郎姓名" style={{ ...modalInputStyle, borderColor: editErrors.customer_name ? '#ef4444' : DIV, fontSize: 13 }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, color: '#666666', marginBottom: 4 }}>新娘姓名</div>
                    <input value={editForm.bride_name} onChange={(e) => setEditForm({ ...editForm, bride_name: e.target.value })} placeholder="新娘姓名" style={{ ...modalInputStyle, fontSize: 13 }} />
                  </div>
                </div>
                {editErrors.customer_name && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 10, marginTop: -10 }}>{editErrors.customer_name}</div>}
                <div style={{ marginBottom: 4 }}>
                  <div style={{ fontSize: 13, color: '#666666', marginBottom: 4 }}>联系电话 <span style={{ color: '#ef4444' }}>*</span></div>
                  <input value={editForm.customer_phone} onChange={(e) => setEditForm({ ...editForm, customer_phone: e.target.value })} placeholder="11 位手机号" style={{ ...modalInputStyle, borderColor: editErrors.customer_phone ? '#ef4444' : DIV, fontSize: 13 }} />
                  {editErrors.customer_phone && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>{editErrors.customer_phone}</div>}
                </div>
              </div>

              {/* 卡片 2：订单详情 */}
              <div style={{ flex: '1 1 50%', minWidth: 0, background: '#FAFAFA', border: '1px solid ' + DIV, borderRadius: 6, padding: 18 }}>
                <div style={{ fontSize: 14, fontWeight: 400, color: '#333333', marginBottom: 16, paddingBottom: 10, borderBottom: '1px solid ' + DIV }}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6, verticalAlign: -2 }}>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
                  </svg>
                  订单详情
                </div>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, color: '#666666', marginBottom: 4 }}>拍摄地址</div>
                  <input value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} placeholder="拍摄城市 / 场地" style={{ ...modalInputStyle, fontSize: 13 }} />
                </div>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, color: '#666666', marginBottom: 4 }}>拍摄日期</div>
                  <input value={editForm.shoot_date} onChange={(e) => setEditForm({ ...editForm, shoot_date: e.target.value })} type="date" style={{ ...modalInputStyle, fontSize: 13 }} />
                  <div style={{ fontSize: 11, color: '#999999', marginTop: 4 }}>修改日期将释放旧档期并占用新日期；冲突时会先提示。</div>
                </div>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, color: '#666666', marginBottom: 4 }}>执行人</div>
                  <div style={{ position: 'relative' }}>
                    <div onClick={() => setExecDropdownOpen((o) => !o)}
                      style={{ ...modalInputStyle, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 38, fontSize: 13 }}>
                      <span style={{ color: (editForm.executors || []).length ? '#222222' : '#999999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {(editForm.executors || []).length ? (editForm.executors || []).map((x) => x.name).join('、') : '选择执行人'}
                      </span>
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                    </div>
                    {execDropdownOpen && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, maxHeight: 200, overflowY: 'auto', background: '#fff', border: '1px solid ' + DIV, borderRadius: 4, boxShadow: '0 6px 20px rgba(0,0,0,0.10)', zIndex: 20, padding: 4 }}>
                        {personnel.length === 0 && <div style={{ padding: '8px 12px', fontSize: 13, color: '#999999' }}>暂无人员</div>}
                        {personnel.map((p) => {
                          const selected = (editForm.executors || []).some((x) => x.id === p.id);
                          return (
                            <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 14, color: '#222222' }}>
                              <input type="checkbox" checked={selected} onChange={() => {
                                setEditForm((f) => {
                                  const cur = f.executors || [];
                                  if (selected) return { ...f, executors: cur.filter((x) => x.id !== p.id) };
                                  return { ...f, executors: [...cur, { id: p.id, name: p.name, avatar: p.avatar || '' }] };
                                });
                              }} />
                              {p.avatar ? <img src={p.avatar} alt="" style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover' }} /> : <span style={{ width: 20, height: 20, borderRadius: '50%', background: pickAvatarColor(p.name), color: '#fff', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{p.name.slice(0, 1)}</span>}
                              {p.name}
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 13, color: '#666666', marginBottom: 4 }}>渠道来源</div>
                  <select value={editForm.channel || ''} onChange={(e) => {
                    const name = e.target.value;
                    const ch = channels.find((c) => c.name === name);
                    setEditForm({ ...editForm, channel: name, channel_id: ch ? ch.id : '' });
                  }} style={{ ...modalInputStyle, fontSize: 13 }}>
                    <option value="">请选择渠道</option>
                    {channels.map((ch) => (
                      <option key={ch.id} value={ch.name}>{ch.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* 底栏卡片：状态 + 备注 + 当前套系 */}
            <div style={{ background: '#FAFAFA', border: '1px solid ' + DIV, borderRadius: 6, padding: 18, marginBottom: 20 }}>
              <div className="grid grid-cols-2" style={{ gap: 20 }}>
                <div>
                  <div style={{ fontSize: 13, color: '#666666', marginBottom: 4 }}>订单状态</div>
                  <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })} style={{ ...modalInputStyle, fontSize: 13 }}>
                    <option value="deposit">已付定金</option><option value="shot">已拍摄</option>
                    <option value="selecting">选片中</option><option value="retouching">精修中</option><option value="delivered">已交付</option>
                    <option value="completed">已完成</option><option value="cancelled">已作废</option>
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 13, color: '#666666', marginBottom: 4 }}>备注</div>
                  <input value={editForm.remark} onChange={(e) => setEditForm({ ...editForm, remark: e.target.value })} placeholder="选填备注" style={{ ...modalInputStyle, fontSize: 13 }} />
                </div>
              </div>
              <div style={{ marginTop: 16, background: '#fff', borderRadius: 4, padding: '12px 14px', fontSize: 13 }}>
                <span style={{ color: '#999999' }}>当前套系：</span>
                <b style={{ color: '#333333' }}>{(pkgInfo && pkgInfo.name) || '—'}</b>
                <span style={{ color: '#10b981', marginLeft: 8 }}>¥{Number((pkgInfo && pkgInfo.price) || 0).toLocaleString()}</span>
                <span style={{ color: '#999999', marginLeft: 8, fontSize: 11 }}>（只读，更换套系请在"更多设置"操作）</span>
              </div>
            </div>

            <div className="flex justify-end" style={{ gap: 10 }}>
              <button type="button" onClick={() => { setEdit(false); setEditErrors({}); }} style={modalCancelStyle}>取消</button>
              <button type="submit" style={modalSaveStyle}>保存</button>
            </div>
          </form>
        </div>
      )}

      {/* 改拍摄日期档期冲突警告（验收④） */}
      {dateConflict && (
        <div className="fixed inset-0 flex items-center justify-center z-[90] p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 400, background: '#fff', borderRadius: 8, padding: 24 }}>
            <div style={{ color: '#222222', fontWeight: 400, marginBottom: 8 }}>档期冲突</div>
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
          <div className="fixed inset-0 flex items-center justify-center z-[85] p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, background: '#fff', borderRadius: 8, padding: 24 }}>
              <div style={{ color: '#222222', fontWeight: 400, marginBottom: 4 }}>更换套系</div>
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
          <div className="fixed inset-0 flex items-center justify-center z-[85] p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 440, background: '#fff', borderRadius: 8, padding: 24 }}>
              <div style={{ color: '#222222', fontWeight: 400, marginBottom: 4 }}>加片设置</div>
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
        <div className="fixed inset-0 flex items-center justify-center z-[95] p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 620, background: '#ffffff', borderRadius: 8, maxHeight: '90vh', overflow: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,0.18)' }}>
            {/* 头部 */}
            <div className="flex items-center justify-between" style={{ padding: '20px 24px', borderBottom: '1px solid ' + DIV }}>
              <div style={{ fontSize: 16, fontWeight: 400, color: '#222222' }}>套餐更多内容</div>
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
                    style={{ padding: '10px 16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: a ? BLUE : '#666666', borderBottom: a ? ('2px solid ' + BLUE) : '2px solid transparent', fontWeight: 400 }}>
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

      {/* 执行人选择弹窗（芯片标签区域的蓝色 + 按钮唤起；支持多选勾选，确认后直接提交后端） */}
      {execPickerOpen && (
        <div onClick={() => setExecPickerOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 96, background: 'rgba(0,0,0,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 8, padding: 24, width: 360, maxHeight: '70vh', overflow: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <div style={{ fontSize: 16, fontWeight: 400, color: '#222222', marginBottom: 16 }}>选择执行人</div>
            {personnel.length === 0 && <div style={{ padding: '12px 0', fontSize: 14, color: '#999999' }}>暂无人员（请先在设置中配置执行人）</div>}
            {personnel.map((p) => {
              const sel = execPickerSelections.some((x) => x.id === p.id);
              return (
                <div key={p.id} onClick={() => {
                  if (sel) setExecPickerSelections((prev) => prev.filter((x) => x.id !== p.id));
                  else setExecPickerSelections((prev) => [...prev, { id: p.id, name: p.name, avatar: p.avatar || '' }]);
                }} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer', borderRadius: 4, background: sel ? '#e6f4ff' : 'transparent', marginBottom: 2 }}>
                  <span style={{ width: 18, height: 18, borderRadius: 3, border: '2px solid ' + (sel ? BLUE : '#D8D8D8'), background: sel ? BLUE : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, flexShrink: 0 }}>{sel ? '✓' : ''}</span>
                  {p.avatar ? <img src={p.avatar} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
                    : <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#333333', color: '#fff', fontSize: 12, fontWeight: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{p.name.slice(0, 1)}</div>}
                  <span style={{ fontSize: 14, color: '#222222' }}>{p.name}</span>
                </div>
              );
            })}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <button type="button" onClick={() => setExecPickerOpen(false)}
                style={{ padding: '8px 20px', borderRadius: 4, border: '1px solid ' + DIV, background: '#fff', color: '#666666', cursor: 'pointer', fontSize: 14 }}>取消</button>
              <button type="button" onClick={saveExecutors}
                style={{ padding: '8px 20px', borderRadius: 4, border: 'none', background: BLUE, color: '#fff', cursor: 'pointer', fontSize: 14 }}>保存</button>
            </div>
          </div>
        </div>
      )}

      {/* 客户影集分享弹窗 */}
      {shareModal && (
        <div className="fixed inset-0 flex items-center justify-center z-[80] p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: '#fff', border: '1px solid ' + DIV, borderRadius: 8, padding: 24, textAlign: 'center' }}>
            <div style={{ color: '#222222', fontWeight: 400, marginBottom: 4 }}>客户影集分享</div>
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
            <div style={{ color: '#222222', fontWeight: 400, marginBottom: 8 }}>订单二维码</div>
            {miniQr ? (
              <img src={miniQr} alt="订单二维码" style={{ width: 176, height: 176, margin: '0 auto', borderRadius: 8 }} />
            ) : (
              <div style={{ color: '#666666', fontSize: 14, padding: 32, textAlign: 'center' }}>生成中…</div>
            )}
            <div style={{ fontSize: 11, color: '#666666', textAlign: 'center', marginTop: 8 }}>微信扫码查看订单（右键 / 长按可保存）</div>
          </div>
        </>
      )}

      {/* 打印单据内容（仅打印时可见，屏幕隐藏） */}
      <div className="print-order-sheet" style={{ display: 'none' }}>
        <style>{`
          @media print {
            body * { visibility: hidden; }
            .print-order-sheet, .print-order-sheet * { visibility: visible; }
            .print-order-sheet { position: absolute; left: 0; top: 0; width: 100%; padding: 20mm 15mm; }
            @page { size: A4; margin: 0; }
          }
        `}</style>
        <div style={{ maxWidth: 700, margin: '0 auto', fontFamily: 'SimSun, STSong, serif', color: '#000' }}>
          {/* 标题 */}
          <div style={{ textAlign: 'center', borderBottom: '2px solid #000', paddingBottom: 16, marginBottom: 20 }}>
            <div style={{ fontSize: 22, fontWeight: 400, letterSpacing: 4 }}>拍摄服务单</div>
            <div style={{ fontSize: 14, marginTop: 8, color: '#555' }}>订单编号：{detail.order_no}</div>
          </div>

          {/* 客户信息 */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 16, fontWeight: 400, borderBottom: '1px solid #ccc', paddingBottom: 6, marginBottom: 10 }}>客户信息</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <tbody>
                <tr>
                  <td style={{ padding: '4px 8px', width: 100, color: '#555' }}>客户姓名</td>
                  <td style={{ padding: '4px 8px' }}>{custName}</td>
                  <td style={{ padding: '4px 8px', width: 80, color: '#555' }}>联系电话</td>
                  <td style={{ padding: '4px 8px' }}>{phoneList.join(' / ') || '—'}</td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', color: '#555' }}>新郎</td>
                  <td style={{ padding: '4px 8px' }}>{detail.groom_name || '—'}</td>
                  <td style={{ padding: '4px 8px', color: '#555' }}>新娘</td>
                  <td style={{ padding: '4px 8px' }}>{detail.bride_name || '—'}</td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', color: '#555' }}>拍摄地址</td>
                  <td style={{ padding: '4px 8px' }} colSpan={3}>{detail.address || '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* 订单信息 */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 16, fontWeight: 400, borderBottom: '1px solid #ccc', paddingBottom: 6, marginBottom: 10 }}>订单信息</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <tbody>
                <tr>
                  <td style={{ padding: '4px 8px', width: 120, color: '#555' }}>订单名称</td>
                  <td style={{ padding: '4px 8px' }}>{detail.order_name || '—'}</td>
                  <td style={{ padding: '4px 8px', width: 100, color: '#555' }}>拍摄日期</td>
                  <td style={{ padding: '4px 8px' }}>{tbd ? '日期待定' : (detail.shoot_date || '—')}</td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', color: '#555' }}>渠道来源</td>
                  <td style={{ padding: '4px 8px' }}>{detail.channel || '—'}</td>
                  <td style={{ padding: '4px 8px', color: '#555' }}>订单状态</td>
                  <td style={{ padding: '4px 8px' }}>{STATUS_LABEL[detail.status] || detail.status}</td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', color: '#555' }}>执行人</td>
                  <td style={{ padding: '4px 8px' }} colSpan={3}>{execs.length ? execs.map((x) => x.name).join('、') : (detail.executor || '—')}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* 套系详情 */}
          {pkgInfo && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 400, borderBottom: '1px solid #ccc', paddingBottom: 6, marginBottom: 10 }}>套系详情</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <tbody>
                  <tr>
                    <td style={{ padding: '4px 8px', width: 100, color: '#555' }}>套系名称</td>
                    <td style={{ padding: '4px 8px' }}>{pkgInfo.name}</td>
                    <td style={{ padding: '4px 8px', width: 80, color: '#555' }}>价格</td>
                    <td style={{ padding: '4px 8px' }}>¥{Number(pkgInfo.price || 0).toLocaleString()}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px 8px', color: '#555' }}>定金</td>
                    <td style={{ padding: '4px 8px' }}>¥{Number(pkgInfo.deposit || 0).toLocaleString()}</td>
                    <td style={{ padding: '4px 8px', color: '#555' }}>拍摄时长</td>
                    <td style={{ padding: '4px 8px' }}>{pkgInfo.duration || '—'}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px 8px', color: '#555' }}>精修张数</td>
                    <td style={{ padding: '4px 8px' }}>{pkgInfo.retouch_count || '—'}</td>
                    <td style={{ padding: '4px 8px', color: '#555' }}>底片政策</td>
                    <td style={{ padding: '4px 8px' }}>{pkgInfo.raw_policy || '—'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* 收款信息 */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 16, fontWeight: 400, borderBottom: '1px solid #ccc', paddingBottom: 6, marginBottom: 10 }}>收款信息</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <tbody>
                <tr>
                  <td style={{ padding: '4px 8px', width: 100, color: '#555' }}>应收总额</td>
                  <td style={{ padding: '4px 8px', fontWeight: 400 }}>¥{total.toLocaleString()}</td>
                  <td style={{ padding: '4px 8px', width: 80, color: '#555' }}>已收金额</td>
                  <td style={{ padding: '4px 8px', color: '#10b981', fontWeight: 400 }}>¥{paid.toLocaleString()}</td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', color: '#555' }}>待收余额</td>
                  <td style={{ padding: '4px 8px', color: remain > 0 ? '#ef4444' : '#10b981' }}>¥{Math.max(0, remain).toLocaleString()}</td>
                  <td style={{ padding: '4px 8px', color: '#555' }}>付款状态</td>
                  <td style={{ padding: '4px 8px' }}>{PAY_STATUS_LABEL[payKey] || payKey}</td>
                </tr>
              </tbody>
            </table>
            {(detail.payments || []).length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 13, color: '#555', marginBottom: 6 }}>收款明细</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, border: '1px solid #ddd' }}>
                  <thead>
                    <tr style={{ background: '#f5f5f5' }}>
                      <th style={{ padding: '4px 8px', border: '1px solid #ddd', textAlign: 'left' }}>类型</th>
                      <th style={{ padding: '4px 8px', border: '1px solid #ddd', textAlign: 'right' }}>金额</th>
                      <th style={{ padding: '4px 8px', border: '1px solid #ddd', textAlign: 'left' }}>方式</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.payments.map((p) => (
                      <tr key={p.id}>
                        <td style={{ padding: '4px 8px', border: '1px solid #ddd' }}>{TYPE_LABEL[p.type] || p.type}</td>
                        <td style={{ padding: '4px 8px', border: '1px solid #ddd', textAlign: 'right' }}>{p.type === 'refund' ? '-' : '+'}¥{Number(p.amount).toLocaleString()}</td>
                        <td style={{ padding: '4px 8px', border: '1px solid #ddd' }}>{p.method === 'online' ? '线上' : '线下'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 备注 */}
          {detail.remark && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 400, borderBottom: '1px solid #ccc', paddingBottom: 6, marginBottom: 10 }}>备注</div>
              <div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{detail.remark}</div>
            </div>
          )}

          {/* 页脚 */}
          <div style={{ textAlign: 'center', marginTop: 40, fontSize: 12, color: '#999', borderTop: '1px solid #ccc', paddingTop: 12 }}>
            <div>打印时间：{new Date().toLocaleString('zh-CN')}</div>
            <div style={{ marginTop: 4 }}>本单据仅供内部使用，最终结算以合同为准</div>
          </div>
        </div>
      </div>

      {/* 右上角【查看记录】唤起日志弹窗：3 个 Tab（订单状态详情 / 交易记录 / 下载记录） */}
      {logModal && (
        <div onClick={() => setLogModal(false)} style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 720, maxHeight: '80vh', background: '#ffffff', borderRadius: 8, overflow: 'hidden', boxShadow: '0 12px 40px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column' }}>
            <div className="flex items-center justify-between" style={{ padding: '16px 24px', borderBottom: '1px solid ' + DIV, flexShrink: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 400, color: '#222222' }}>订单记录 · {detail.order_no}</div>
              <button type="button" onClick={() => setLogModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999999', fontSize: 22, lineHeight: 1, padding: 0 }} aria-label="关闭">×</button>
            </div>
            <div className="flex" style={{ borderBottom: '1px solid ' + DIV, padding: '0 24px', flexShrink: 0 }}>
              {[{ k: 'status', t: '订单状态详情' }, { k: 'trade', t: '交易记录' }, { k: 'download', t: '下载记录' }].map((tb) => {
                const active = logModalTab === tb.k;
                return (
                  <button key={tb.k} type="button" onClick={() => setLogModalTab(tb.k)}
                    style={{ padding: '10px 16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: active ? BLUE : '#666666', borderBottom: active ? ('2px solid ' + BLUE) : '2px solid transparent', fontWeight: 400 }}>
                    {tb.t}
                  </button>
                );
              })}
            </div>
            <div style={{ padding: '20px 24px', overflow: 'auto', flex: 1 }}>
              {logModalTab === 'status' && (
                <>
                  <div style={{ color: '#222222', fontWeight: 400, marginBottom: 8 }}>操作日志</div>
                  {(detail.logs || []).length === 0 && <div style={{ color: '#999999', fontSize: 14, padding: '4px 0' }}>暂无日志</div>}
                  {(detail.logs || []).map((l, i, arr) => (
                    <div key={i} className="flex" style={{ gap: 12 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 10, flexShrink: 0 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#52C41A', marginTop: 7, flexShrink: 0 }} />
                        {i < arr.length - 1 && <span style={{ flex: 1, width: 1, background: '#EAEAEA', marginTop: 4 }} />}
                      </div>
                      <div style={{ flex: 1, paddingBottom: 14 }}>
                        <div style={{ fontSize: 14, color: '#333333' }}>{l.text}</div>
                        <div style={{ fontSize: 12, color: TEXT_SUB, marginTop: 2 }}>{new Date(l.t).toLocaleString('zh-CN')}</div>
                      </div>
                    </div>
                  ))}
                </>
              )}
              {logModalTab === 'trade' && (
                <div>
                  <div style={{ color: '#222222', fontWeight: 400, marginBottom: 8 }}>收款流水</div>
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
              {logModalTab === 'download' && (
                <div>
                  <div style={{ color: '#222222', fontWeight: 400, marginBottom: 8 }}>可下载素材（原片 / 精修片 / 选片）</div>
                  {downloadItems.length === 0 && <div style={{ color: '#999999', fontSize: 14, padding: '4px 0' }}>暂无素材</div>}
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
          </div>
        </div>
      )}

      {/* 调查问卷弹窗（点击头部【调查问卷】按钮唤起） */}
      {questionnaireModal && (
        <div onClick={() => setQuestionnaireModal(false)} style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, maxHeight: '80vh', background: '#ffffff', borderRadius: 8, overflow: 'hidden', boxShadow: '0 12px 40px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column' }}>
            <div className="flex items-center justify-between" style={{ padding: '16px 24px', borderBottom: '1px solid ' + DIV, flexShrink: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 400, color: '#222222' }}>调查问卷 · {detail.order_no}</div>
              <button type="button" onClick={() => setQuestionnaireModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999999', fontSize: 22, lineHeight: 1, padding: 0 }} aria-label="关闭">×</button>
            </div>
            <div style={{ padding: '20px 24px', overflow: 'auto', flex: 1 }}>
              {(() => {
                if (!detail.package_snapshot || !Array.isArray(detail.package_snapshot.questionnaire) || detail.package_snapshot.questionnaire.length === 0) {
                  return <div style={{ color: '#999999', fontSize: 14, padding: '36px 0', textAlign: 'center' }}>该订单套系未配置调查问卷</div>;
                }
                let ans = {};
                try { ans = detail.questionnaire_answers ? (typeof detail.questionnaire_answers === 'string' ? JSON.parse(detail.questionnaire_answers) : detail.questionnaire_answers) : {}; } catch { ans = {}; }
                const qs = detail.package_snapshot.questionnaire;
                return (
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
                );
              })()}
            </div>
            <div className="flex justify-end" style={{ padding: '12px 24px 20px', borderTop: '1px solid ' + DIV }}>
              <button type="button" onClick={() => setQuestionnaireModal(false)}
                style={{ padding: '8px 24px', borderRadius: 4, background: BLUE, color: '#fff', fontSize: 14, border: 'none', cursor: 'pointer' }}>关闭</button>
            </div>
          </div>
        </div>
      )}

      <Slideshow photos={slidePhotos} open={slideOpen} onClose={closeSlideSel} title={detail.order_name || '订单相册'} />
    </div>
  );
}

// —— 复刻 spec 样式片段（模块内复用） ——
const secBtnStyle = {
  height: 36, borderRadius: 2, background: '#fff', color: '#666666',
  border: '1px solid #D9D9D9', fontSize: 12, fontWeight: 400, padding: '0 14px', cursor: 'pointer'
};
const moreItemStyle = {
  display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px',
  background: 'none', border: 'none', color: '#222222', cursor: 'pointer', whiteSpace: 'nowrap'
};
const filterCtrlStyle = { height: 32, padding: '0 8px', border: 'none', color: '#16ADF7', background: 'transparent', fontSize: 12, outline: 'none', cursor: 'pointer' };
const filterBtnStyle = { height: 32, padding: '0 16px', borderRadius: 2, border: '1px solid #D5DBE2', color: '#444B53', background: '#fff', fontSize: 12, cursor: 'pointer' };
const modalInputStyle = { width: '100%', padding: '8px 12px', borderRadius: 4, border: '1px solid ' + DIV, color: '#222222', fontSize: 14, outline: 'none', background: '#fff' };
const modalCancelStyle = { padding: '8px 16px', borderRadius: 4, fontSize: 14, color: '#666666', background: '#fff', border: '1px solid ' + DIV, cursor: 'pointer' };
const modalSaveStyle = { padding: '8px 16px', borderRadius: 4, fontSize: 14, color: '#fff', background: BLUE, border: 'none', cursor: 'pointer' };

// 信息行（标签：内容 + 可选业务标签，复刻截图：标签前小图标 + 值容器 div + 内联标签）
function InfoRow({ label, value, tags, extra, icon, labelColor }) {
  const lc = labelColor || ICON_COLOR;
  return (
    <div className="flex" style={{ alignItems: 'center', gap: 0, fontSize: 12, lineHeight: 1.6 }}>
      <span style={{ color: lc, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
        {icon ? <svg viewBox="0 0 24 24" width={ICON_SIZE} height={ICON_SIZE} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{icon}</svg> : null}
        {label}：
      </span>
      <div style={{ color: INFO_VALUE, flex: 1 }}>
        {value}
        {extra && extra.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
            {extra.map((h, i) => <span key={i} style={{ padding: '1px 6px', borderRadius: 4, background: '#f3f4f6', fontSize: 11, color: '#444' }}>{h}</span>)}
          </div>
        )}
        {tags && tags.length > 0 && (
          <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6, marginLeft: 8, verticalAlign: 'middle' }}>
            {tags.map((t, i) => <span key={i} style={{ padding: '2px 8px', borderRadius: 2, background: t.bg, color: t.fg, fontSize: 12 }}>{t.t}</span>)}
          </span>
        )}
      </div>
    </div>
  );
}

// 图片上传区域（原片 / 精修片 真实上传）—— 复刻 spec 140x140 虚线上传框
function PhotoZone({ kind, title, photos, uploading, onAdd, onRemove }) {
  const inputRef = React.useRef(null);
  return (
    <div>
      <input ref={inputRef} type="file" accept="image/*" multiple className="hidden"
        onChange={(e) => { onAdd(e.target.files); e.target.value = ''; }} />
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
            style={{ marginTop: 8, background: 'none', border: 'none', color: '#666666', fontSize: 12, cursor: 'pointer' }}>上传{title}</button>
        </div>
      </div>
    </div>
  );
}
