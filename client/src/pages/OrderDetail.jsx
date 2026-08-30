import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import http, { img, uploadBatch, conflictOf } from '../api.js';
import { HOURS } from '../constants/timeSlots.js';
import bgm from '../bgm.js';
import Slideshow from '../components/Slideshow.jsx';
import html2pdf from 'html2pdf.js';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { renderContract, buildContractVars, contractChanged } from '../utils/contract.js';
import { getRefundText, getRefundParagraphs, normalizePolicy } from '../utils/refundPolicy.js';
import { getServiceAgreement, getPhotoAuthAgreement, toParagraphs } from '../utils/customerAgreement.js';
import { DEFAULT_CONTRACT_TEMPLATE } from '../utils/contractDefault.js';
import { DEFAULT_SERVICE_DETAIL } from '../utils/serviceDetail.js';
import { toast, confirm } from '../utils/toast.js';

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
// 收款渠道显示：线上统一「线上」；线下按 channel 区分微信/支付宝/现金/银行转账
const CHANNEL_LABEL = { wechat: '微信', alipay: '支付宝', cash: '现金', bank: '银行转账', online: '线上' };
function payMethodLabel(p) {
  if (!p) return '—';
  if (p.method === 'online') return '线上';
  return '线下·' + (CHANNEL_LABEL[p.channel] || '其他');
}
const PAY_STATUS_LABEL = { unpaid: '未付定金', deposit: '已付定金', paid: '已付全款' };
// 移动端订单状态标签底色（与订单中心同风格低饱和色板）
const M_STATUS_COLOR = { deposit: '#F5A623', shot: '#2DB7F5', selecting: '#7B61FF', retouching: '#9B59B6', delivered: '#10B981', completed: '#52C41A', cancelled: '#999999' };

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

// 订单详情 6 步横向流程进度条（与待办事项 Tab 一一对应，简化状态机）
// 当前节点由 status + logs 推导，与后端 stats/orders 的 todo 过滤口径完全一致
const ORDER_STAGES = [
  { key: 'deposit',    label: '已付定金' },
  { key: 'waiting',    label: '等待拍摄' },
  { key: 'selecting',  label: '待选片' },
  { key: 'retouching', label: '精修中' },
  { key: 'deliver',    label: '待交付' },
  { key: 'completed',  label: '已完成' }
];

// 从节点 i 推进到 i+1 的动作（状态步 PUT status；日志步 POST 日志）
const STAGE_NEXT = [
  { log: '沟通确认' },          // 0→1 已付定金 → 等待拍摄
  { status: 'shot' },          // 1→2 等待拍摄 → 待选片
  { status: 'retouching' },    // 2→3 待选片 → 精修中
  { log: '精修完成' },          // 3→4 精修中 → 待交付
  { status: 'delivered' },     // 4→5 待交付 → 已完成
];

// 从节点 i 回退到 i-1 的动作（logUndo 撤销最后一条日志；status 直接回退）
const STAGE_PREV = [
  null,                          // 0 已付定金（不能再退）
  { logUndo: true },             // 1→0 撤销「沟通确认」日志
  { status: 'deposit' },         // 2→1 待选片 → 等待拍摄
  { status: 'selecting' },       // 3→2 精修中 → 待选片
  { logUndo: true },             // 4→3 待交付 → 精修中（撤销「精修完成」日志）
  { status: 'retouching' },      // 5→4 已完成 → 待交付（delivered/completed 都回退到 retouching）
];

// 当前节点 index：由 status + logs 推导（与后端 stats 的 todo 口径一致）
function currentStageIndex(detail, logs) {
  if (!detail) return 0;
  if (detail.status === 'completed' || detail.status === 'delivered') return 5;
  if (detail.status === 'retouching') {
    const hasFinish = (logs || []).some((l) => /精修完成|全部精修完成|底片打包|原片打包/.test((l.text || '')));
    return hasFinish ? 4 : 3;
  }
  if (detail.status === 'shot' || detail.status === 'selecting') return 2;
  if (detail.status === 'deposit') {
    const hasConfirm = (logs || []).some((l) => /沟通确认/.test((l.text || '')));
    return hasConfirm ? 1 : 0;
  }
  return 0; // cancelled 等异常状态归已付定金
}

// 6 步推导：i < current = done；i === current = current；i > current = pending
function buildSteps(detail, logs) {
  if (!detail) return ORDER_STAGES.map((s) => ({ ...s, state: 'pending', time: null }));
  const cur = currentStageIndex(detail, logs);
  return ORDER_STAGES.map((s, i) => {
    const state = i < cur ? 'done' : (i === cur ? 'current' : 'pending');
    return { ...s, state, time: null };
  });
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
  // 移动端适配：<768px 视为手机，内联样式按 isMobile 降级（堆叠 / 去固定像素 / 减小留白）
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 768 : false);
  // 宽屏：>=1280 才走 750 设计稿两列 + 208 大间距的原始布局；中等窗口（768-1279）改用小间距避免右侧塌陷
  const [isWide, setIsWide] = useState(() => typeof window !== 'undefined' ? window.innerWidth >= 1280 : true);
  useEffect(() => {
    const onResize = () => {
      setIsMobile(window.innerWidth < 768);
      setIsWide(window.innerWidth >= 1280);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const [detail, setDetail] = useState(null);
  const [pkgs, setPkgs] = useState([]);
  const [catList, setCatList] = useState([]);
  const [sel, setSel] = useState(null);
  const [selSaving, setSelSaving] = useState(false);
  const [pay, setPay] = useState(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(false);
  const [editForm, setEditForm] = useState({ order_name: '', groom_name: '', bride_name: '', customer_phone: '', address: '', shoot_date: '', executor: '', remark: '', status: '', time_slots: [], period: 'full', extra_items: [], custom_time: '' });
  const [share, setShare] = useState(null);
  const [shareModal, setShareModal] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  // 合同：模板 / 附加条款 / PDF
  const [contractTemplates, setContractTemplates] = useState([]);
  const [contractTemplateId, setContractTemplateId] = useState(null);
  const [creatingDefault, setCreatingDefault] = useState(false);
  // 实时套系协议开关（决定订单合同区能否发起合同；无套系/读取失败默认允许，向后兼容）
  const [pkgAgreementEnabled, setPkgAgreementEnabled] = useState(true);
  // 客户改期/取消申请列表
  const [orderRequests, setOrderRequests] = useState([]);
  const [contractExtraText, setContractExtraText] = useState('');
  const [contractPdfUrl, setContractPdfUrl] = useState('');
  const [contractGenerating, setContractGenerating] = useState(false);
  const [contractSaving, setContractSaving] = useState(false);
  // 规则4：订单业务字段 vs 生成时快照是否不一致（标红提示「订单已变更，旧PDF未同步」）
  const [contractDirty, setContractDirty] = useState(false);
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
  const [custMoreMenu, setCustMoreMenu] = useState(false);
  const [pkgPicker, setPkgPicker] = useState(false); // 编辑弹窗：选取已有套系
  const [pkgPickerQ, setPkgPickerQ] = useState('');
  const [pkgPickerCat, setPkgPickerCat] = useState('');
  const [chOpen, setChOpen] = useState(false);       // 编辑弹窗：渠道来源下拉
  const [slotOpen, setSlotOpen] = useState(false);   // 编辑弹窗：拍摄时间下拉
  const [addSched, setAddSched] = useState(false);   // 编辑弹窗：添加档期弹窗（参考拾光盒子新增订单弹窗）
  // 改拍摄日期档期冲突二次确认（验收④）
  const [dateConflict, setDateConflict] = useState(null);
  // 更换套系弹窗（验收⑥）
  const [pkgSwitch, setPkgSwitch] = useState(null);
  const [pkgSwitching, setPkgSwitching] = useState(false);
  // 加片设置弹窗（验收⑦：按订单快照核算）
  const [addonBox, setAddonBox] = useState(null);
  // 作废订单 / 退款弹窗（替换原生 confirm+prompt，iOS PWA prompt 失效，保证移动端可用）
  const [cancelDlg, setCancelDlg] = useState(null); // { tip, reason }
  const [refundDlg, setRefundDlg] = useState(null); // { amount }
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
  // 打印单据：是否附带商家内部备注（默认关，内部备注敏感）
  const [printInternal, setPrintInternal] = useState(false);
  // 底部常驻记录卡片 Tab（订单状态详情 / 交易记录 / 下载记录）
  const [logTab, setLogTab] = useState('status');
  // 下载日志（download_logs 表，真实下载行为留痕）
  const [downloadLogs, setDownloadLogs] = useState([]);
  // 右上角【查看记录】唤起日志弹窗（与底部卡片并存，独立 Tab 状态）
  const [logModal, setLogModal] = useState(false);
  const [logModalTab, setLogModalTab] = useState('status');
  // 调查问卷弹窗
  const [questionnaireModal, setQuestionnaireModal] = useState(false);
  // 更多服务详情全屏页
  const [svcDetailOpen, setSvcDetailOpen] = useState(false);
  const [svcDetailExpanded, setSvcDetailExpanded] = useState(false);
  const [svcRefundExpanded, setSvcRefundExpanded] = useState(false);
  const [svcAgreementExpanded, setSvcAgreementExpanded] = useState(false);
  const [svcPhotoAuthExpanded, setSvcPhotoAuthExpanded] = useState(false);
  // 选片任务摘要（四表架构 V2）
  const [selectionInfo, setSelectionInfo] = useState(null);
  const loadSelection = useCallback(() => {
    http.get('/api/selection/orders/' + id + '/task')
      .then((r) => setSelectionInfo(r.data || {}))
      .catch(() => setSelectionInfo(null));
  }, [id]);
  useEffect(loadSelection, [loadSelection]);

  const loadSel = useCallback((oid) => {
    http.get('/api/admin/photo-select/' + oid).then((r) => setSel(r.data)).catch(() => setSel(null));
  }, []);

  // 请求序号：连点时只接受最后一次 reload 的响应，避免旧 GET 覆盖乐观更新后的新状态
  const reloadSeq = useRef(0);
  const reload = useCallback(async () => {
    const seq = ++reloadSeq.current;
    try {
      const r = await http.get('/api/orders/' + id);
      if (seq === reloadSeq.current) {
        setDetail(r.data);
        // 初始化合同字段
        setContractTemplateId(r.data.contract_template_id ?? null);
        setContractExtraText(r.data.contract_extra_text || '');
        setContractPdfUrl(r.data.contract_pdf_url || '');
        // 规则4：订单已变更且旧 PDF 未同步 → 标红提示（仅在有历史 PDF 且快照存在时比对）
        setContractDirty(!!r.data.contract_pdf_url && contractChanged(r.data, r.data.contract_order_snapshot));
        // 实时套系协议开关：套系关闭协议则订单无法发起合同（PRD 四.3：套系只控制「能不能用协议」）
        if (r.data.package_id) {
          http.get('/api/packages/' + r.data.package_id)
            .then((p) => setPkgAgreementEnabled(!!(p.data?.details?.customer_agreement_enabled)))
            .catch(() => setPkgAgreementEnabled(true));
        } else {
          setPkgAgreementEnabled(true);
        }
      }
      loadSel(id);
    } catch { setNotFound(true); }
  }, [id, loadSel]);

  useEffect(() => { reload(); }, [reload]);
  // 客户改期/取消申请列表
  useEffect(() => {
    if (!id) return;
    http.get('/api/orders/' + id + '/requests').then((r) => setOrderRequests(r.data || [])).catch(() => setOrderRequests([]));
  }, [id, reload]);
  // 下载记录（download_logs 表，真实下载行为留痕）
  useEffect(() => {
    if (!id) return;
    http.get('/api/orders/' + id + '/downloads').then((r) => setDownloadLogs(r.data.list || [])).catch(() => setDownloadLogs([]));
  }, [id, reload]);
  // 合同模板列表
  useEffect(() => {
    http.get('/api/contract/templates').then((r) => {
      const list = r.data || [];
      setContractTemplates(list);
      // 默认模板：若订单未绑定，选 is_default
      setContractTemplateId((cur) => {
        if (cur != null) return cur;
        const def = list.find((t) => t.is_default);
        return def ? def.id : (list[0] ? list[0].id : null);
      });
    }).catch(() => {});
  }, []);

  // 一键创建默认合同模板（解决「线上/新库无模板」痛点；订单合同区模板下拉为空时一键直达）
  const createDefaultTemplate = async () => {
    if (creatingDefault) return;
    setCreatingDefault(true);
    try {
      const r = await http.post('/api/contract/templates', DEFAULT_CONTRACT_TEMPLATE);
      const newId = r.data?.id || r.data?.template?.id;
      // 拉一遍列表以同步 is_default 等字段
      const listRes = await http.get('/api/contract/templates').catch(() => ({ data: [] }));
      const list = listRes.data || [];
      setContractTemplates(list);
      // 自动选中新建的（或默认的）
      const target = newId || (list.find((t) => t.is_default) || list[0])?.id;
      if (target) setContractTemplateId(target);
      toast('已创建默认合同模板并自动选中');
    } catch (e) {
      toast('创建失败：' + (e.response?.data?.error || e.message));
    } finally {
      setCreatingDefault(false);
    }
  };

  // 审核客户改期/取消申请（通过后仍需商家在订单页手动改日期/作废，这里仅标记状态）
  const handleRequest = async (reqId, status) => {
    try {
      await http.post(`/api/orders/${detail.id}/requests/${reqId}/handle`, { status });
      const r = await http.get('/api/orders/' + detail.id + '/requests').catch(() => ({ data: [] }));
      setOrderRequests(r.data || []);
    } catch (e) { toast('操作失败：' + (e.message || '')); }
  };

  useEffect(() => {
    const ctrl = new AbortController();
    http.get('/api/channels', { signal: ctrl.signal }).then((r) => setChannels(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    http.get('/api/admin/personnel', { signal: ctrl.signal }).then((r) => setPersonnel(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    return () => ctrl.abort();
  }, []);
  useEffect(() => {
    const ctrl = new AbortController();
    http.get('/api/packages?status=all', { signal: ctrl.signal }).then((r) => setPkgs(r.data)).catch(() => {});
    http.get('/api/categories').then((r) => setCatList(r.data || [])).catch(() => {});
    return () => ctrl.abort();
  }, []);
  useEffect(() => () => { bgm.pause(); }, []);
  // 点击空白收起下拉（客户信息 / 更多设置 / 执行人下拉）
  useEffect(() => {
    if (!custInfoOpen && !moreMenu && !custMoreMenu && !execDropdownOpen && !chOpen && !slotOpen) return;
    const handler = (e) => {
      if (custInfoOpen) setCustInfoOpen(false);
      if (moreMenu) setMoreMenu(false);
      if (custMoreMenu) setCustMoreMenu(false);
      if (execDropdownOpen) setExecDropdownOpen(false);
      if (chOpen) setChOpen(false);
      if (slotOpen) setSlotOpen(false);
    };
    const id = setTimeout(() => document.addEventListener('click', handler), 0);
    return () => { clearTimeout(id); document.removeEventListener('click', handler); };
  }, [custInfoOpen, moreMenu, custMoreMenu, execDropdownOpen, chOpen, slotOpen]);
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
    } catch (e) { toast((e.response && e.response.data && e.response.data.error) || '保存失败'); }
    finally { setSelSaving(false); }
  };

  const openEdit = () => {
    if (!detail) return;
    const detailPhones = asArr(detail.phones);
    const phone0 = detailPhones[0] || detail.customer_phone || '';
    const phone1 = detailPhones[1] || '';
    // 新郎/新娘姓名：优先取独立字段；为空时从 customer_name 反向拆分（兼容拆分前老数据）
    const rawGroom = (detail.groom_name || '').trim();
    const rawBride = (detail.bride_name || '').trim();
    let groom = rawGroom, bride = rawBride;
    if (!groom && !bride) {
      const cn = (detail.customer_name || '').trim();
      if (cn) {
        // 常见分隔符：& / ，/ 空&
        const parts = cn.split(/\s*[&＆，,]\s*/).filter(Boolean);
        groom = parts[0] || '';
        bride = parts.slice(1).join(' ') || '';
      }
    }
    setEditForm({
      order_name: detail.order_name || '',
      groom_name: groom, bride_name: bride,
      groom_phone: detail.groom_phone || phone0,
      bride_phone: detail.bride_phone || phone1,
      customer_phone: detail.customer_phone || phone0,
      address: detail.address || '', shoot_date: detail.shoot_date || '',
      executors: asArr(detail.executors).map((x) => typeof x === 'object' ? x : { id: null, name: x }),
      channel: detail.channel || '', channel_id: detail.channel_id || '',
      remark: detail.remark || '', status: detail.status,
      time_slots: asArr(detail.time_slots),
      period: detail.period || 'full',
      extra_items: asArr(detail.extra_items).map((x) => ({ name: String((x && x.name) || ''), amount: (x && x.amount) != null ? String(x.amount) : '' }))
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
    const groomP = (editForm.groom_phone || '').trim();
    const brideP = (editForm.bride_phone || '').trim();
    if (!groomP && !brideP) errs.contact_phone = '请至少填写一个联系电话';
    else if (groomP && !/^1\d{10}$/.test(groomP)) errs.contact_phone = '新郎电话格式不正确（应为 11 位数字）';
    else if (brideP && !/^1\d{10}$/.test(brideP)) errs.contact_phone = '新娘电话格式不正确（应为 11 位数字）';
    if (Object.keys(errs).length > 0) { setEditErrors(errs); return; }
    await doSaveEdit(false);
  }
  // 保存订单编辑；改拍摄日期时后端会做档期冲突检测（验收④），冲突则二次确认后 force 提交
  async function doSaveEdit(force) {
    try {
      // 确保后端收到规范的 phones 数组和 executors 数组
      const groomP = (editForm.groom_phone || '').trim();
      const brideP = (editForm.bride_phone || '').trim();
      // 取新郎/新娘电话的并集，按「新郎在前、新娘在后」回写到 phones 数组
      const phonesList = [groomP, brideP].filter((p) => /^1\d{10}$/.test(p));
      await http.put('/api/orders/' + detail.id, {
        ...editForm,
        groom_phone: groomP,
        bride_phone: brideP,
        customer_phone: groomP || brideP || '',
        phones: phonesList,
        channel: editForm.channel || '',
        channel_id: editForm.channel_id || '',
        time_slots: (editForm.time_slots || []).filter(Boolean),
        extra_items: (editForm.extra_items || [])
          .map((x) => ({ name: String((x && x.name) || '').trim(), amount: parseFloat(x && x.amount) || 0 }))
          .filter((x) => x.name || x.amount),
        force: force ? 1 : 0
      });
      setDateConflict(null);
      setEdit(false);
      reload();
    } catch (e2) {
      const cf = conflictOf(e2);
      if (cf && cf.forcible && !force) { setDateConflict(cf.message); return; }
      toast((e2 && e2.message) || (e2.response && e2.response.data && e2.response.data.error) || '保存失败');
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
      toast((e2 && e2.message) || (e2.response && e2.response.data && e2.response.data.error) || '备注保存失败');
    }
  }

  // 移除执行人（芯片标签 × 按钮）：二次确认后过滤并提交
  async function removeExecutor(index) {
    if (!await confirm('确认移除此执行人？')) return;
    const nextExecs = execs.filter((_, i) => i !== index);
    try {
      await http.put('/api/orders/' + detail.id, { executors: nextExecs });
      reload();
    } catch (e) {
      toast('移除执行人失败：' + (e?.message || '未知错误'));
    }
  }

  // 保存执行人选择（独立弹窗确认）：将已勾选人员提交后端
  async function saveExecutors() {
    try {
      await http.put('/api/orders/' + detail.id, { executors: execPickerSelections });
      setExecPickerOpen(false);
      reload();
    } catch (e) {
      toast('保存执行人失败：' + (e?.message || '未知错误'));
    }
  }

  // —— 更换套系（验收⑥）：弹窗确认，仅重写当前订单快照 ——
  function openPkgSwitch() {
    if (!detail) return;
    if (detail.cancelled) { toast('订单已作废，无法更换套系'); return; }
    setPkgSwitch({ package_id: String(detail.package_id || ''), spec_id: '', package_price: '', reason: '', step: 'pick' });
  }
  async function confirmPkgSwitch() {
    if (!pkgSwitch || !pkgSwitch.package_id) { toast('请选择要更换的套系'); return; }
    const targetPkg = pkgs.find((p) => String(p.id) === String(pkgSwitch.package_id));
    const targetAgreementOff = targetPkg ? !(targetPkg.details && targetPkg.details.customer_agreement_enabled) : false;
    const hasContractData = !!(detail.contract_pdf_url || detail.contract_template_id || detail.contract_extra_text);
    // 新套系关闭协议 + 当前订单已有协议数据 → 二次确认清空（PRD 三.2）
    let clearContract = false;
    if (targetAgreementOff && hasContractData) {
      if (!await confirm('新套系已关闭协议。\n\n更换后将清空本订单所有协议数据（签署记录、合同 PDF、附加条款），且不可恢复。\n\n确定继续更换？')) {
        return;
      }
      clearContract = true;
    }
    setPkgSwitching(true);
    try {
      await http.post('/api/orders/' + detail.id + '/change-package', {
        package_id: Number(pkgSwitch.package_id),
        spec_id: pkgSwitch.spec_id || '',
        package_price: pkgSwitch.package_price === '' ? undefined : parseFloat(pkgSwitch.package_price),
        reason: pkgSwitch.reason || '',
        clear_contract: clearContract
      });
      setPkgSwitch(null);
      // 强视觉提醒：切换套系后套餐规格/价格/退订政策/协议模板已变更，原有合同失效（PRD 二.4）
      if (detail.contract_pdf_url && !clearContract) {
        setContractDirty(true);
      }
      reload();
    } catch (e2) { toast((e2 && e2.message) || '更换失败'); }
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
      fromSnapshot: !!(snap.id || snap.name), method: 'offline', channel: 'wechat'
    });
  }
  async function submitAddon() {
    if (!addonBox) return;
    const r = calcExtraFee(addonBox.count, addonBox.unit);
    if (r.fee <= 0) { toast('加片张数为 0，无需登记加片费'); return; }
    try {
      await http.post('/api/orders/' + detail.id + '/payments', {
        type: 'extra', amount: r.fee, method: addonBox.method, channel: addonBox.channel,
        note: `加片 ${r.count} 张 × ¥${r.unitPrice}/张${r.discount < 1 ? ' × ' + (r.discount * 10).toFixed(1) + ' 折' : ''}（按订单套系快照核算）`
      });
      setAddonBox(null);
      reload();
    } catch (e2) { toast((e2 && e2.message) || '登记失败'); }
  }
  async function removeOrder() {
    if (!(await confirm('确认删除该订单？\n将移入回收站，可在回收站恢复（不破坏收款流水与选片记录）。\n删除后该订单占用的档期会自动释放。'))) return;
    try { await http.delete('/api/orders/' + detail.id); nav('/orders'); }
    catch (e2) { toast((e2.response && e2.response.data && e2.response.data.error) || '删除失败'); }
  }
  // 打印单据：前端 html2canvas + jsPDF 直接生成「拍摄服务合同」PDF（手机端 1–2 秒，无需后端 Chromium）
  // 版式与后端 puppeteer 完全一致：每页页眉（拍摄服务合同/订单编号/创建时间·状态）+ 页脚（叶哲 STUDIO/打印时间），正文逐页切片。
  // 修复 v6 bug：抓取 .print-sheet-body 整体，而非 querySelector('div')（那只拿到页眉首元素，正文会空白）。
  async function downloadPrintPdf() {
    try {
      const sheet = document.querySelector('.print-order-sheet');
      if (!sheet) throw new Error('未找到打印内容');
      const bodyEl = sheet.querySelector('.print-sheet-body');
      if (!bodyEl) throw new Error('未找到打印内容主体');

      const CJK = "'PingFang SC','Microsoft YaHei','Noto Sans SC','Hiragino Sans GB',sans-serif";
      const PAGE_W = 700; // 版心像素宽，对应 A4 内容区
      const ua = navigator.userAgent || '';
      const isMobile = /iphone|ipad|ipod|android/i.test(ua);
      // iPadOS 13+ Safari 会伪装 Mac UA，靠 maxTouchPoints 区分；同时含真 iPhone/iPad/iPod
      const isIOS = /iphone|ipad|ipod/i.test(ua) || (/Mac/.test(ua) && navigator.maxTouchPoints > 1);
      // 移动端降 scale 大幅提速：1.0 已足够清晰，桌面用 2.0 保留锐利
      const scale = isMobile ? 1 : 2;
      const imgQuality = isMobile ? 0.88 : 0.95;

      // —— 正文：克隆 .print-sheet-body 离屏渲染（强制 sans-serif，贴近后端 Noto Sans 观感）——
      const clone = bodyEl.cloneNode(true);
      const wrap = document.createElement('div');
      wrap.className = 'pdf-render-root';
      wrap.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + PAGE_W + 'px;background:#fff;z-index:-1;';
      const styleTag = document.createElement('style');
      styleTag.textContent = '.pdf-render-root *{font-family:' + CJK + ' !important;}';
      wrap.appendChild(styleTag);
      wrap.appendChild(clone);
      document.body.appendChild(wrap);

      let bodyCanvas;
      try {
        bodyCanvas = await html2canvas(clone, {
          scale,
          useCORS: true,
          backgroundColor: '#ffffff',
          logging: false,
          imageTimeout: 10000
        });
      } finally {
        document.body.removeChild(wrap);
      }

      // —— 页眉 / 页脚（与后端版式 1:1 一致）——
      const created = detail.created_at ? new Date(detail.created_at).toLocaleString('zh-CN') : '—';
      const headerHTML =
        '<div style="width:' + PAGE_W + 'px;background:#fff;text-align:center;font-family:' + CJK + ';padding:8mm 0 4mm;border-bottom:1px solid #555;">' +
          '<div style="font-size:22px;letter-spacing:4px;color:#000;font-weight:400;">拍摄服务合同</div>' +
          '<div style="font-size:13px;margin-top:6px;color:#555;font-weight:400;">订单编号：' + (detail.order_no || '—') + '</div>' +
          '<div style="font-size:12px;margin-top:3px;color:#555;font-weight:400;">创建时间：' + created + '　·　订单状态：' + (statusText || '—') + '</div>' +
        '</div>';
      const nowStr = new Date().toLocaleString('zh-CN');
      const footerHTML =
        '<div style="width:' + PAGE_W + 'px;background:#fff;display:flex;justify-content:space-between;align-items:center;font-family:' + CJK + ';font-size:12px;color:#999;font-weight:400;padding:0 12mm 8mm;border-top:1px solid #ccc;">' +
          '<span>叶哲 STUDIO · 摄影工作室管理系统</span>' +
          '<span>打印时间：' + nowStr + '</span>' +
        '</div>';

      const renderBlock = (html) => new Promise((resolve, reject) => {
        const el = document.createElement('div');
        el.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + PAGE_W + 'px;background:#fff;z-index:-1;';
        el.innerHTML = html;
        document.body.appendChild(el);
        html2canvas(el.firstElementChild, { scale, backgroundColor: '#ffffff', logging: false, imageTimeout: 10000 })
          .then((c) => { document.body.removeChild(el); resolve(c); })
          .catch((e) => { try { document.body.removeChild(el); } catch (_) {} reject(e); });
      });

      const [headerCanvas, footerCanvas] = await Promise.all([renderBlock(headerHTML), renderBlock(footerHTML)]);

      // 预先把页眉页脚转成 base64（避免循环里重复编码，多页时能省大量时间）
      const headerData = headerCanvas.toDataURL('image/jpeg', 0.9);
      const footerData = footerCanvas.toDataURL('image/jpeg', 0.9);

      // —— 拼装 A4（mm）：每页 页眉 + 正文切片 + 页脚，间距对齐后端 @page 边距 ——
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW = 210, pageH = 297, sideMargin = 12;
      const contentW = pageW - sideMargin * 2; // 186mm 版心
      const headerH = headerCanvas.height / headerCanvas.width * contentW;
      const footerH = footerCanvas.height / footerCanvas.width * contentW;
      const topGap = 8, bottomGap = 8, hbGap = 4, fbGap = 4; // 页眉上留白 / 页脚下留白 / 页眉-正文 / 正文-页脚
      const contentTop = topGap + headerH + hbGap;
      const contentBottom = pageH - bottomGap - footerH - fbGap;
      const contentAreaH = contentBottom - contentTop;
      const pxPerMm = bodyCanvas.width / contentW;
      const pageContentPx = contentAreaH * pxPerMm;
      const totalPages = Math.max(1, Math.ceil(bodyCanvas.height / pageContentPx));

      // 提速关键（移动端耗时大头）：正文整图只编码一次 JPEG，逐页用负 y 偏移平移复用。
      // 实证：jspdf 对相同 dataURL（不传 alias）自动去重，PDF 内仅存 1 份图 → 编码 1 次 + 文件显著变小，
      // 取代原先"每页新 canvas 切片 + 各自 toDataURL + 各自写入 PDF"（N 次编码、N 份图）的做法。
      // 页面外的图内容由 PDF 查看器按 MediaBox 自动裁剪（已验证负坐标 addImage 不抛错、输出正常）。
      const bodyData = bodyCanvas.toDataURL('image/jpeg', imgQuality);
      const bodyTotalH = bodyCanvas.height / pxPerMm;

      for (let i = 0; i < totalPages; i++) {
        if (i > 0) pdf.addPage();
        pdf.addImage(headerData, 'JPEG', sideMargin, topGap, contentW, headerH);
        pdf.addImage(bodyData, 'JPEG', sideMargin, contentTop - i * contentAreaH, contentW, bodyTotalH, undefined, 'FAST');
        pdf.addImage(footerData, 'JPEG', sideMargin, pageH - bottomGap - footerH, contentW, footerH);
      }

      const blob = pdf.output('blob');
      if (!blob || blob.size < 500) throw new Error('生成的 PDF 为空');
      const filename = '拍摄服务合同-' + (detail.order_no || detail.id) + '.pdf';
      const file = new File([blob], filename, { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      let delivered = false;
      // —— iOS Safari：优先系统分享面板（保存到文件 / 分享微信 / 隔空投送 / 打印，iOS 15+ 原生支持分享 PDF 文件）——
      // 用户明确要求：手机端不预览 PDF，点打印单据直接可保存本地或分享微信等。
      // 若 share 不可用或分享失败（非用户取消）→ 兜底全屏 iframe 预览（Safari 内置 viewer 渲染）。
      // 注意：iOS Safari 对 <a download> 不真正"下载"（15+ 尝试新标签打开 blob URL 经常因 origin 限制静默失败），不能靠 a[download] 兜底。
      if (isIOS) {
        let shareFailed = false;
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: filename });
            delivered = true;
          } catch (shareErr) {
            // 用户主动取消 = 用户放弃保存，视为已送达；其余错误（如分享面板被系统拦截）→ 预览兜底
            if (shareErr && shareErr.name === 'AbortError') delivered = true;
            else shareFailed = true;
          }
        } else {
          shareFailed = true; // 老 iOS 无 share(files) 能力 → 预览兜底
        }
        if (!delivered && shareFailed) {
          const mask = document.createElement('div');
          mask.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,0.4);display:flex;flex-direction:column;';
          const bar = document.createElement('div');
          bar.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#1f1f1f;gap:8px;';
          const title = document.createElement('span');
          title.textContent = filename;
          title.style.cssText = 'color:#fff;font-size:13px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
          const shareBtn = document.createElement('button');
          shareBtn.type = 'button';
          shareBtn.textContent = '分享/保存';
          shareBtn.style.cssText = 'padding:7px 14px;border:none;border-radius:6px;background:#fff;color:#000;cursor:pointer;font-size:13px;';
          shareBtn.onclick = async () => {
            try {
              if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({ files: [file], title: filename });
              } else {
                toast('请用 Safari 工具栏的「分享」按钮保存到文件');
              }
            } catch (shareErr2) {
              if (shareErr2 && shareErr2.name !== 'AbortError') toast('分享失败');
            }
          };
          const closeBtn = document.createElement('button');
          closeBtn.type = 'button';
          closeBtn.textContent = '关闭';
          closeBtn.style.cssText = 'padding:7px 14px;border:none;border-radius:6px;background:#fff;color:#000;cursor:pointer;font-size:13px;';
          closeBtn.onclick = () => { if (mask.parentNode) document.body.removeChild(mask); URL.revokeObjectURL(url); };
          const iframe = document.createElement('iframe');
          iframe.src = url;
          iframe.title = 'PDF 预览';
          iframe.style.cssText = 'flex:1;width:100%;height:100%;border:none;background:#fff;';
          bar.appendChild(title);
          bar.appendChild(shareBtn);
          bar.appendChild(closeBtn);
          mask.appendChild(bar);
          mask.appendChild(iframe);
          document.body.appendChild(mask);
          delivered = true;
        }
      }
      // —— 兼容性投递：严禁 window.open（异步生成完成后已脱离用户点击手势，会被 Chrome/Safari/微信 弹窗拦截器静默拦截）——
      // 1) 移动端（非 iOS）：优先系统分享面板（保存到文件/打印/隔空投送），用户自行选择目标
      if (!delivered && isMobile && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: filename });
          delivered = true;
        } catch (shareErr) {
          // 用户取消分享 = 已送达；其余错误继续走下载兜底
          if (shareErr && shareErr.name === 'AbortError') delivered = true;
        }
      }
      // 2) 兜底（桌面 + 移动）：a[download] 直接下载 —— 非弹窗，任何浏览器/WebView（微信内置、UC、Safari、Chrome、Edge、Firefox）都不会拦截
      if (!delivered) {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.rel = 'noopener';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        delivered = true;
      }
      if (delivered) toast(isMobile ? 'PDF 已生成' : 'PDF 已生成，正在下载…');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      console.error(e);
      toast('PDF 生成失败：' + ((e && e.message) || e));
    }
  }
  function printOrder() {
    if (!detail) return;
    setMoreMenu(false);
    // 6.0 决策骨架：PC / 普通浏览器优先 window.print() 弹原生打印对话框（含打印机选择 + 预览）；
    // 微信 / PWA 环境 window.print 无效 → fallback 到 PDF 下载。
    // iOS Safari（含 iPadOS 13+ 伪装 Mac）的 window.print() 长期静默无效（实测点击无反应）→ 必须走 downloadPrintPdf，
    // 其内部 iOS 分支 = 全屏 mask+iframe 预览（Safari 内置 viewer 渲染 PDF + 「分享/保存」按钮），用户立刻看得到。
    const ua = navigator.userAgent || '';
    const isIOS = /iphone|ipad|ipod/i.test(ua) || (/Mac/.test(ua) && navigator.maxTouchPoints > 1);
    const isWechat = /MicroMessenger/i.test(ua);
    const isStandalone = typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
    if (isIOS || isWechat || isStandalone || typeof window.print !== 'function') {
      toast('正在生成 PDF…');
      downloadPrintPdf();
      return;
    }
    window.print();
  }
  async function restoreOrder() {
    if (!(await confirm('确认恢复该订单？'))) return;
    try { await http.post('/api/orders/' + detail.id + '/restore'); reload(); }
    catch (e2) { toast((e2.response && e2.response.data && e2.response.data.error) || '恢复失败'); }
  }
  async function purgeOrder() {
    if (!(await confirm('确认后将永久删除，建议先做好本地备份，确定继续？'))) return;
    try { await http.post('/api/orders/' + detail.id + '/purge'); nav('/orders'); }
    catch (e2) { toast((e2.response && e2.response.data && e2.response.data.error) || '彻底删除失败'); }
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
    if (detail.status !== 'deposit' && !(await confirm('当前阶段非「已付定金」，确认直接标记为已拍摄？'))) return;
    try { await http.put('/api/orders/' + detail.id, { status: 'shot' }); reload(); }
    catch (e2) { toast((e2.response && e2.response.data && e2.response.data.error) || '操作失败'); }
  }
  // 进度条：下一步（逐 Tab 推进：状态步 PUT status；日志步 POST 日志）
  // 乐观更新：点击瞬间先本地更新 detail（节点秒动），再后台发请求；失败回滚 + 提示
  async function stepNext() {
    if (!detail || detail.cancelled) return;
    const cur = currentStageIndex(detail, detail.logs);
    if (cur >= ORDER_STAGES.length - 1) return; // 已完成，无下一步
    const act = STAGE_NEXT[cur];
    if (!act) return;
    // ① 乐观更新：立即本地更新（不等网络往返）
    if (act.status) {
      setDetail((d) => (d ? { ...d, status: act.status } : d));
    } else {
      setDetail((d) => (d ? { ...d, logs: [...(Array.isArray(d.logs) ? d.logs : []), { t: new Date().toISOString(), text: act.log }] } : d));
    }
    // ② 后台发请求
    try {
      if (act.status) await http.put('/api/orders/' + detail.id, { status: act.status });
      else await http.post('/api/orders/' + detail.id + '/logs', { text: act.log });
      // 通知 Todo 页等监听者刷新计数
      try { window.dispatchEvent(new Event('order-status-changed')); } catch {}
    } catch (e2) {
      toast((e2.response && e2.response.data && e2.response.data.error) || '操作失败');
    } finally {
      reload(); // 静默同步真实数据（成功兜底 / 失败回滚）
    }
  }
  // 进度条：上一步（逐 Tab 回退：状态步直接 PUT；日志步 logs/undo 撤销最后一条）
  async function stepPrev() {
    if (!detail || detail.cancelled) return;
    const cur = currentStageIndex(detail, detail.logs);
    if (cur <= 0) return;
    const act = STAGE_PREV[cur];
    if (!act) return;
    // ① 乐观更新：立即本地回退（不等网络往返）
    if (act.status) {
      setDetail((d) => (d ? { ...d, status: act.status } : d));
    } else if (act.logUndo) {
      setDetail((d) => (d ? { ...d, logs: (Array.isArray(d.logs) ? d.logs.slice(0, -1) : d.logs) } : d));
    }
    // ② 后台发请求
    try {
      if (act.status) await http.put('/api/orders/' + detail.id, { status: act.status });
      else if (act.logUndo) await http.post('/api/orders/' + detail.id + '/logs/undo');
      try { window.dispatchEvent(new Event('order-status-changed')); } catch {}
    } catch (e2) {
      toast((e2.response && e2.response.data && e2.response.data.error) || '操作失败');
    } finally {
      reload();
    }
  }
  async function cancel() {
    if (!detail) return;
    // 所属套系退订政策（作废订单时作为退款扣费参考，PRD 七.1）
    let refundRule = '';
    try {
      const snap = detail.package_snapshot && typeof detail.package_snapshot === 'object'
        ? detail.package_snapshot : (detail.package_snapshot ? JSON.parse(detail.package_snapshot) : {});
      const sd = (snap && typeof snap.details === 'object') ? snap.details : {};
      refundRule = getRefundText(sd, normalizePolicy(sd.refund_policy));
    } catch {}
    const ruleTip = refundRule ? `\n\n所属套系退订政策（退款扣费参考）：\n${refundRule}` : '';
    const tip = (detail.shoot_date && !detail.date_tbd
      ? `确认作废该订单？\n作废后将自动释放已占用的档期 ${detail.shoot_date}，该日期重新变为可约。`
      : '确认作废该订单？') + ruleTip;
    setCancelDlg({ tip, reason: '' });
  }
  async function doCancel() {
    if (!cancelDlg) return;
    const reason = (cancelDlg.reason || '').trim();
    setCancelDlg(null);
    try {
      await http.post('/api/orders/' + detail.id + '/cancel', { reason });
      reload();
    } catch (e2) { toast((e2 && e2.message) || '作废失败'); }
  }
  function refund() {
    if (!detail) return;
    setRefundDlg({ amount: '' });
  }
  async function doRefund() {
    if (!refundDlg) return;
    const amt = parseFloat(refundDlg.amount);
    setRefundDlg(null);
    if (!amt || amt <= 0) { toast('请输入有效的退款金额'); return; }
    try {
      await http.post('/api/orders/' + detail.id + '/refund', { amount: amt, note: '手动退款' });
      reload();
    } catch (e2) { toast((e2 && e2.message) || '退款失败'); }
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
    } catch (e) { toast((e.response && e.response.data && e.response.data.error) || '复制失败'); }
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
    } catch (e) { toast((e.response && e.response.data && e.response.data.error) || '生成失败'); }
    finally { setShareBusy(false); }
  }
  async function unshare() {
    if (!(await confirm('确认关闭该订单的分享？\n已生成的二维码将失效，客户无法再访问。'))) return;
    try {
      await http.post('/api/orders/' + detail.id + '/unshare');
      setShare(null); setShareModal(false); reload();
    } catch (e) { toast((e.response && e.response.data && e.response.data.error) || '操作失败'); }
  }
  function copyShare() {
    if (!share) return;
    const note = share.share_note ? '\n\n备注：' + share.share_note : '';
    const text = share.share_url + note;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    toast('分享链接已复制' + (share.share_note ? '（含备注）' : '') + '：\n' + text);
  }
  // 分享订单给客户：生成随机 customer_token 链接 + 二维码（客户 /customer-order?token= 只读查看自己订单）
  async function openMiniQr(reset) {
    if (!detail) return;
    setMiniQrLoading(true); setMiniQr(null);
    try {
      const r = await http.post('/api/orders/' + detail.id + '/customer-share', { reset: !!reset });
      setMiniQr({ url: r.data.url, qr_url: r.data.qr_url });
    } catch (e) { toast((e.response && e.response.data && e.response.data.error) || '生成失败'); }
    finally { setMiniQrLoading(false); }
  }
  function closeMiniQr() { setMiniQr(null); }

  // ===== 合同：保存配置（模板 + 附加条款） =====
  async function saveContractConfig() {
    if (!detail) return;
    setContractSaving(true);
    try {
      await http.post('/api/contract/orders/' + detail.id + '/contract', {
        contract_template_id: contractTemplateId,
        contract_extra_text: contractExtraText
      });
      reload();
      toast('合同配置已保存');
    } catch (e) { toast((e.response && e.response.data && e.response.data.error) || '保存失败'); }
    finally { setContractSaving(false); }
  }

  // ===== 合同：生成 / 重新生成 PDF（数据一致性：先保存配置 → 实时拉取最新订单 → 生成前校验 → 本地生成）=====
  async function generateContractPdf() {
    if (!detail) return;
    if (!contractTemplateId) { toast('请先选择合同模板'); return; }
    const tpl = contractTemplates.find((t) => t.id === contractTemplateId);
    if (!tpl || !tpl.template_content) { toast('所选模板无合同正文，请先在「合同模板管理」填写'); return; }
    setContractGenerating(true);
    try {
      // ① 先保存合同配置（模板 + 附加条款），确保后端持有最新配置
      await http.post('/api/contract/orders/' + detail.id + '/contract', {
        contract_template_id: contractTemplateId,
        contract_extra_text: contractExtraText
      });
      // ② 实时请求后端读取订单最新数据库字段（数据源头唯一性，不使用页面缓存）
      const latestRes = await http.get('/api/orders/' + detail.id);
      const latest = latestRes.data;
      // ③ 生成前校验：核心字段（新人/日期/机位/价格）为空则阻断
      const pre = await http.get('/api/contract/orders/' + detail.id + '/contract-precheck');
      if (!pre.data.ok) {
        toast('订单核心信息不完整，无法生成合同：\n' + pre.data.missing.join('、') + '\n\n请先完善订单信息后再生成。');
        return;
      }
      // ④ 用最新订单字段替换占位符（只读订单字段，不读套系兜底）
      const vars = buildContractVars(latest);
      let htmlContent = renderContract(tpl.template_content, vars);
      // 退订政策：模板含 {{refund_rule}} 则已替换；否则自动拼接至「违约责任」段（PRD 二.2 自动拼接，不依赖手动加占位符）
      if (!/\{\{refund_rule\}\}/.test(tpl.template_content) && vars.refund_rule) {
        const refundHtml = '<h3>退订政策</h3><p>' + String(vars.refund_rule).replace(/\n/g, '<br>') + '</p>';
        if (/违约责任/.test(htmlContent)) {
          htmlContent = htmlContent.replace(/违约责任/, '违约责任\n\n' + refundHtml);
        } else {
          htmlContent += '\n\n' + refundHtml;
        }
      }
      // 附加条款已在占位符 {{contract_extra_text}} 中，若无占位符则拼接尾部
      if (!/\{\{contract_extra_text\}\}/.test(tpl.template_content) && latest.contract_extra_text) {
        htmlContent += '\n\n<h3>七、其他补充约定</h3>\n<p>' + String(latest.contract_extra_text).replace(/\n/g, '<br>') + '</p>';
      }
      const html = '<div style="font-family: serif; font-size: 13px; line-height: 1.8; color: #000; white-space: pre-wrap;">'
        + htmlContent.replace(/\n/g, '<br>') + '</div>';

      // ⑤ 前端本地生成 A4 PDF
      const container = document.createElement('div');
      container.innerHTML = html;
      container.style.position = 'absolute';
      container.style.left = '-9999px';
      container.style.top = '0';
      container.style.width = '210mm';
      container.style.background = '#fff';
      container.style.padding = '15mm';
      container.style.boxSizing = 'border-box';
      document.body.appendChild(container);

      const pdfBlob = await html2pdf().set({
        margin: 0,
        filename: 'contract.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
      }).from(container).output('blob');

      document.body.removeChild(container);

      // ⑥ 上传 R2 回写 contract_pdf_url + 后端保存生成时间与订单快照
      const fd = new FormData();
      fd.append('file', pdfBlob, 'contract_' + detail.id + '.pdf');
      const r = await http.post('/api/contract/orders/' + detail.id + '/contract-pdf', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setContractPdfUrl(r.data.contract_pdf_url);
      toast('合同 PDF 已生成并保存');
      reload(); // 刷新后 contractDirty 重新比对（应为 false）
    } catch (e) {
      console.error(e);
      toast('合同生成失败：' + ((e.response && e.response.data && e.response.data.error) || e.message));
    } finally { setContractGenerating(false); }
  }
  function copyCustomerUrl() {
    if (!miniQr || !miniQr.url) return;
    navigator.clipboard?.writeText(miniQr.url);
    toast('客户订单链接已复制：\n' + miniQr.url);
  }

  // ===== 合同：查看/下载走后端鉴权中转（管理员带 token，blob 流式） =====
  async function viewContract() {
    if (!detail) return;
    try {
      const r = await http.get('/api/contract/download/' + detail.id, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      // 兼容性预览：异步 fetch 后 window.open 会被弹窗拦截器拦截；改页面内 iframe 全屏预览（非新窗口，任何浏览器都不会拦截，且支持直接打印/保存）
      const mask = document.createElement('div');
      mask.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,0.4);display:flex;flex-direction:column;';
      const bar = document.createElement('div');
      bar.style.cssText = 'display:flex;justify-content:flex-end;align-items:center;padding:8px 12px;background:#1f1f1f;';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '关闭预览';
      btn.style.cssText = 'padding:7px 18px;border:none;border-radius:6px;background:#fff;color:#000;cursor:pointer;font-size:14px;';
      btn.onclick = () => { document.body.removeChild(mask); URL.revokeObjectURL(url); };
      const iframe = document.createElement('iframe');
      iframe.src = url;
      iframe.title = '合同预览';
      iframe.style.cssText = 'flex:1;width:100%;border:none;background:#fff;';
      bar.appendChild(btn);
      mask.appendChild(bar);
      mask.appendChild(iframe);
      document.body.appendChild(mask);
    } catch (e) { toast('合同打开失败，请重试'); }
  }
  async function downloadContract() {
    if (!detail) return;
    try {
      const r = await http.get('/api/contract/download/' + detail.id + '?dl=1', { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url; a.download = '合同-' + (detail.customer_name || detail.order_no || detail.id) + '.pdf';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { toast('合同下载失败，请重试'); }
  }
  async function invalidateContract() {
    if (!detail) return;
    if (!await confirm('确认作废该合同？作废后客户将无法下载。')) return;
    try { await http.post('/api/contract/orders/' + detail.id + '/invalidate'); reload(); }
    catch (e) { toast((e.response && e.response.data && e.response.data.error) || '作废失败'); }
  }
  async function restoreContract() {
    if (!detail) return;
    try { await http.post('/api/contract/orders/' + detail.id + '/restore'); reload(); }
    catch (e) { toast((e.response && e.response.data && e.response.data.error) || '恢复失败'); }
  }

  // —— 图片管理：原片 / 精修片 真实上传（复用现有分片上传，不新建接口） ——
  async function addPhotos(kind, fileList) {
    if (!fileList || !fileList.length) return;
    // 精修片数量限制：上传精修片不得超过订单「精修张数」字段（PRD 四.4 作品自检2，数据源=订单当前数值）
    if (kind === 'retouched') {
      const limit = parseInt(detail?.retouch_count, 10) || 0;
      if (limit > 0) {
        const current = (photos.retouched || []).length;
        if (current + fileList.length > limit) {
          toast(`精修片数量已达上限 ${limit} 张（当前 ${current} 张），最多还可上传 ${Math.max(0, limit - current)} 张。`);
          return;
        }
      }
    }
    setUploading((u) => ({ ...u, [kind]: true }));
    try {
      const category = kind === 'raw' ? 'raw-negative' : 'retouched';
      const res = await uploadBatch(Array.from(fileList), { category, isPublic: false, concurrency: 3 });
      const urls = (res.urls || []).filter(Boolean);
      if (!urls.length) { if ((res.failed || []).some(Boolean)) toast('上传失败：' + (res.failed || []).filter(Boolean).join('；')); return; }
      const next = { ...photos, [kind]: [...photos[kind], ...urls] };
      setPhotos(next);
      await http.put('/api/orders/' + detail.id, { order_photos: JSON.stringify(next) });
    } catch (e) { toast((e && e.message) || '上传失败'); }
    finally { setUploading((u) => ({ ...u, [kind]: false })); }
  }
  async function removePhoto(kind, url) {
    const next = { ...photos, [kind]: photos[kind].filter((u) => u !== url) };
    setPhotos(next);
    try { await http.put('/api/orders/' + detail.id, { order_photos: JSON.stringify(next) }); }
    catch (e) { toast('保存失败'); }
  }
  function downloadFile(url) {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.download = '';
    document.body.appendChild(a); a.click(); a.remove();
  }

  // 更多设置下拉菜单（复刻截图：仅保留 编辑订单 / 打印单据 2 项）
  // 菜单渲染在按钮内部，position:absolute + top:100% 保证紧贴按钮正下方；align 控制左右对齐
  const renderMoreMenu = (onClose, align = 'left') => (
    <div style={{ position: 'absolute', top: '100%', zIndex: 60, marginTop: 4, ...(align === 'right' ? { right: 0 } : { left: 0 }), background: '#fff', border: '1px solid ' + DIV, borderRadius: 4, boxShadow: '0 6px 20px rgba(0,0,0,0.10)', padding: '6px 0', fontSize: 14, width: 184 }}>
      <button type="button" onClick={() => { onClose && onClose(); openEdit(); }} style={moreItemStyle}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
          编辑订单
        </span>
      </button>
      <button type="button" onClick={() => { onClose && onClose(); printOrder(); }} style={moreItemStyle}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>
          打印单据
        </span>
      </button>
      {/* 打印设置：是否附带商家内部备注（默认关） */}
      <button type="button" onClick={() => setPrintInternal((v) => !v)} style={moreItemStyle}>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            打印含内部备注
          </span>
          <span style={{ width: 34, height: 18, borderRadius: 9, background: printInternal ? '#7ECDBB' : '#ddd', position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
            <span style={{ position: 'absolute', top: 2, left: printInternal ? 18 : 2, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left .2s' }} />
          </span>
        </span>
      </button>
    </div>
  );

  const pkgInfo = useMemo(() => {
    if (!detail) return null;
    const snap = detail.package_snapshot || {};
    // 【底层强制规则 1】订单一旦保存套系快照，展示与核算一律读快照；
    // 后续编辑原始套系不影响历史订单。仅无快照的历史脏数据才回落到最新套系配置。
    // 【补丁】实时套系始终查找，用于填补快照中缺失的模板字段（如后加的交付时间/备注）
    //   —— 快照已有值则快照胜出，缺失的 key 才用实时套系兜底；不影响其他字段的「快照为准」语义。
    const hasSnap = !!(snap && (snap.id || snap.name));
    const live = pkgs.find((p) => p.id === detail.package_id) || {};
    const arr = (v) => Array.isArray(v) ? v : [];
    const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    const val = (s, l) => (s !== undefined && s !== null && s !== '' ? s : l);
    return {
      fromSnapshot: hasSnap,
      // details：合并快照 + 实时套系；快照胜出（已有值），缺失 key 用实时兜底
      details: { ...obj(live.details), ...obj(snap.details) },
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

  const steps = buildSteps(detail, detail.logs);
  const curStep = currentStageIndex(detail, detail.logs);
  // 当前阶段标签：与 buildSteps 一致（与待办 Tab / 后端 stats 口径统一）
  const curForPhase = steps.find((s) => s.state === 'current');
  const phaseLabel = curForPhase ? curForPhase.label
    : (detail.status === 'cancelled' ? '已作废'
      : (detail.status === 'completed' ? '已完成'
        : (detail.status === 'delivered' ? '已交付'
          : STATUS_LABEL[detail.status] || '')));
  const statusText =
    (detail.payment_status === 'unpaid' ? '未付定金' : (PAY_STATUS_LABEL[payKey] || '')) +
    (phaseLabel && detail.status && detail.status !== detail.payment_status ? '，' + phaseLabel : '');
  const custName = ([detail.groom_name, detail.bride_name].filter(Boolean).join(' & ') || detail.customer_name || '—');
  // 新郎/新娘姓名：优先独立字段；都为空时从 customer_name 反向拆分（兼容拆分前老数据）
  const groomPrintName = (detail.groom_name || '').trim() || custName.split(/\s*[&＆，,]\s*/)[0] || '';
  const bridePrintName = (detail.bride_name || '').trim() || custName.split(/\s*[&＆，,]\s*/).slice(1).join(' ') || '';
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
    <>
      {isMobile ? (
        /* ============ 移动端订单详情（按 IMG_7498/IMG_7499 1:1 复刻） ============ */
        <div style={{ minHeight: '100vh', background: '#F8F8F8', paddingBottom: 'calc(72px + env(safe-area-inset-bottom))' }}>
          {/* 顶部导航：< 返回 + 动态状态标题 + 打印 + ⋮ */}
          <div style={{ position: 'sticky', top: 0, zIndex: 50, height: 48, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px' }}>
            <button type="button" onClick={() => nav(-1)} style={{ background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center' }}>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#1f2329" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <div style={{ fontSize: 16, color: '#1f2329' }}>{(() => {
              // 与 buildSteps 一致：从 status+logs 推断当前阶段标签（与待办 Tab / 后端 stats 口径统一）
              const cur = steps.find((s) => s.state === 'current');
              if (cur) return cur.label;
              if (detail?.status === 'cancelled') return '已关闭';
              if (detail?.status === 'completed') return '已完成';
              if (detail?.status === 'delivered') return '已交付';
              return detail?.payment_status === 'unpaid' ? '待付定金' : '等待拍摄';
            })()}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button type="button" onClick={printOrder} style={{ background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center' }}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#1f2329" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>
              </button>
              <button type="button" onClick={() => setMoreMenu(true)} style={{ background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center' }}>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#1f2329" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></svg>
              </button>
            </div>
          </div>

          {/* 状态卡 + 业务流进度条（后台 12 步，横向滑动） */}
          <div style={{ margin: '12px 12px 0', background: '#fff', borderRadius: 8, padding: '12px 12px 14px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            {/* 卡片顶部：左上「上一步」+ 右上「下一步」（与桌面态按钮共用 stepPrev/stepNext，逐格推进/回退进度条节点） */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <button type="button" onClick={stepPrev} disabled={detail?.cancelled}
                style={{ padding: '4px 12px', borderRadius: 4, border: '1px solid ' + (detail?.cancelled ? '#E5E5E5' : DIV), background: '#fff', color: detail?.cancelled ? TEXT_WEAK : BLUE, fontSize: 13, cursor: detail?.cancelled ? 'not-allowed' : 'pointer', opacity: detail?.cancelled ? 0.5 : 1 }}>‹ 上一步</button>
              <button type="button" onClick={stepNext} disabled={detail?.cancelled}
                style={{ padding: '4px 12px', borderRadius: 4, border: '1px solid ' + BLUE, background: BLUE, color: '#fff', fontSize: 13, cursor: detail?.cancelled ? 'not-allowed' : 'pointer', opacity: detail?.cancelled ? 0.5 : 1 }}>下一步 ›</button>
            </div>
            {/* 状态文字行已删除——与桌面端一致，进度条上方仅保留两个按钮 */}
            {/* 业务流进度条：11 步横向滑动（节点下仅文字无日期；完成=蓝勾/当前=蓝实心/未达=灰空心） */}
            <div style={{ overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', msOverflowStyle: 'none', touchAction: 'pan-x' }} className="hide-scrollbar">
              <div className="flex items-start" style={{ gap: 0, minWidth: steps.length * 70 + (steps.length - 1) * 20 }}>
                {steps.map((st, i) => (
                  <React.Fragment key={st.key}>
                    <div className="flex flex-col items-center" style={{ width: 70, flexShrink: 0 }}>
                      <div style={{
                        width: 26, height: 26, borderRadius: '50%',
                        background: st.state === 'done' ? '#EAF6FD' : st.state === 'current' ? BLUE : '#FFFFFF',
                        border: st.state === 'done' || st.state === 'current' ? ('1px solid ' + BLUE) : '1px solid rgba(0,0,0,0.25)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: st.state === 'done' ? BLUE : (st.state === 'pending' ? 'rgba(0,0,0,0.25)' : '#FFFFFF')
                      }}>
                        {st.state === 'done'
                          ? <CheckIcon />
                          : <span style={{ fontSize: 12, fontWeight: 400, color: st.state === 'current' ? '#FFFFFF' : 'rgba(0,0,0,0.25)' }}>{i + 1}</span>}
                      </div>
                      <span style={{ fontSize: 12, marginTop: 6, textAlign: 'center', whiteSpace: 'nowrap', color: st.state === 'pending' ? 'rgba(0,0,0,0.25)' : st.state === 'current' ? '#555555' : 'rgba(0,0,0,0.65)' }}>{st.label}</span>
                    </div>
                    {i < steps.length - 1 && (
                      <div style={{ flex: 1, height: 1, minWidth: 20, marginTop: 13, background: (st.state === 'done' && steps[i + 1].state === 'done') ? BLUE : '#E5E5E5' }} />
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>
            <div style={{ textAlign: 'right', marginTop: 10 }}>
              <button type="button" onClick={() => setLogModal(true)} style={{ background: 'none', border: 'none', color: '#FA5151', fontSize: 12, padding: 0 }}>状态变更记录 ›</button>
            </div>
          </div>

          {/* 状态卡与下方套餐卡之间的 1px 分隔线（横贯全屏宽，左右 indent 12px） */}
          <div style={{ height: 1, background: '#EEEEEE', margin: '0 12px' }} />

          {/* 客户 + 套系 + 价格 */}
          <div style={{ margin: '12px 12px 0', background: '#fff', borderRadius: 8, padding: '14px 14px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: pickAvatarColor(custName), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>{custInitial}</div>
                <span style={{ fontSize: 15, color: '#1f2329' }}>{custName}</span>
                <button type="button" onClick={() => nav('/orders/' + detail?.id + '/notes')} style={{ background: 'none', border: 'none', padding: 0, color: '#7ECDBB', display: 'flex', alignItems: 'center' }} title="编辑备注">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#7ECDBB" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                </button>
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 18, borderRadius: 3, background: '#9DDFF1', color: '#fff' }}>
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16v6H4z" /><path d="M8 14h8" /><path d="M10 18h4" /></svg>
                </span>
              </div>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#7ECDBB', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-3 0-8 1.5-8 4.5V21h16v-2.5c0-3-5-4.5-8-4.5z" /></svg>
              </div>
            </div>
            {/* 客户行与套餐行之间的 1px 分隔线（横贯卡片全宽） */}
            <div style={{ height: 1, background: '#EEEEEE', margin: '14px -14px 14px' }} />
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              {pkgInfo?.cover_url && (
                <img src={img(pkgInfo.cover_url)} alt="" style={{ width: 96, height: 96, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
              )}
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
                <div style={{ fontSize: 15, color: '#1f2329', lineHeight: 1.35 }}>{pkgInfo?.name || '未选套系'}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#666', flexWrap: 'wrap' }}>
                  <span>定金</span>
                  <span style={{ background: TAG_OFFLINE, color: '#fff', padding: '1px 8px', borderRadius: 3, fontSize: 11 }}>线下收取</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#666' }}>
                  <span>尾款</span>
                  <span style={{ background: TAG_UNSETTLED, color: '#fff', padding: '1px 8px', borderRadius: 3, fontSize: 11 }}>未结算</span>
                </div>
              </div>
              <div style={{ flexShrink: 0, textAlign: 'right', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
                <div style={{ color: '#999' }}>¥ <span style={{ color: '#1f2329', fontSize: 15 }}>{Number(pkgInfo?.list_price || pkgInfo?.price || 0).toLocaleString()}</span></div>
                <div style={{ color: '#999' }}>¥ <span style={{ color: '#1f2329', fontSize: 15 }}>{Number(detail?.deposit || 0).toLocaleString()}</span></div>
                <div style={{ color: '#999' }}>¥ <span style={{ color: '#1f2329', fontSize: 15 }}>{Number(remain || 0).toLocaleString()}</span></div>
              </div>
            </div>
          </div>

          {/* 执行人 */}
          <div style={{ margin: '12px 12px 0', background: '#fff', borderRadius: 8, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <span style={{ fontSize: 14, color: '#1f2329' }}>执行人</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {(() => {
                const first = execs[0];
                if (first && first.avatar) {
                  return <img src={first.avatar} style={{ width: 26, height: 26, borderRadius: '50%', objectFit: 'cover' }} alt="" />;
                }
                return <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#222', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>{(first?.name || '执').slice(0, 1)}</span>;
              })()}
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#CCCCCC" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
            </div>
          </div>

          {/* 订单信息 */}
          <div style={{ margin: '12px 12px 0', background: '#fff', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            {(() => {
              const shootDate = detail?.shoot_date || '';
              const shootTimeText = detail?.period === 'full' ? '全天'
                : detail?.period === 'half' ? '半天'
                : (Array.isArray(detail?.time_slots) ? detail.time_slots.join(' ') : '');
              const createdAt = detail?.created_at ? new Date(detail.created_at) : null;
              const created = createdAt ? `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, '0')}-${String(createdAt.getDate()).padStart(2, '0')} ${String(createdAt.getHours()).padStart(2, '0')}:${String(createdAt.getMinutes()).padStart(2, '0')}` : '';
              const rows = [
                { k: '订单编号', v: detail?.order_no || '—', chevron: false },
                { k: '拍摄日期', v: shootDate || '未排期', chevron: true },
                { k: '拍摄时间', v: shootTimeText || '未排期', chevron: true },
                { k: '拍摄地点', v: detail?.address || '未填写', chevron: true },
                { k: '下单时间', v: created, chevron: false }
              ];
              return rows.map((r, i) => (
                <div key={r.k} onClick={r.chevron ? openEdit : undefined} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', borderTop: i === 0 ? 'none' : '1px solid #F2F2F2', cursor: r.chevron ? 'pointer' : 'default' }}>
                  <span style={{ fontSize: 14, color: '#1f2329' }}>{r.k}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 14, color: r.v === '未填写' || r.v === '未排期' ? '#bbb' : '#666' }}>{r.v}</span>
                    {r.chevron && <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#7ECDBB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>}
                  </div>
                </div>
              ));
            })()}
          </div>

          {/* 可选精修 + 加片 */}
          <div style={{ margin: '12px 12px 0', background: '#fff', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            {(() => {
              const extraFee = pkgInfo?.details?.extra_photo_fee || pkgInfo?.extra_photo_fee || '';
              const extraList = Array.isArray(detail?.extra_items) ? detail.extra_items : [];
              const extraSum = extraList.reduce((s, x) => s + (Number(x.amount) || 0), 0);
              const rows = [
                { k: '可选精修片', v: pkgInfo?.retouch_count ? `${pkgInfo.retouch_count}张` : '—', chevron: true },
                { k: '加片费', v: extraFee ? `¥ ${extraFee}/张` : '—', chevron: true },
                { k: '其他消费', v: extraList.length ? `¥${extraSum.toLocaleString()}` : '无', chevron: true }
              ];
              return rows.map((r, i) => (
                <div key={r.k} onClick={r.chevron ? openEdit : undefined} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', cursor: r.chevron ? 'pointer' : 'default' }}>
                  <span style={{ fontSize: 14, color: '#1f2329' }}>{r.k}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 14, color: r.v === '—' || r.v === '无' ? '#bbb' : '#666' }}>{r.v}</span>
                    {r.chevron && <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#7ECDBB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>}
                  </div>
                </div>
              ));
            })()}
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <button type="button" onClick={() => { setSvcDetailOpen(true); setSvcDetailExpanded(false); setSvcRefundExpanded(false); }} style={{ background: 'none', border: 'none', color: '#999', fontSize: 13 }}>更多服务详情</button>
            </div>
          </div>

          {/* 加片统计 */}
          <div style={{ margin: '12px 12px 0', background: '#fff', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            {(() => {
              const selPhotos = sel && Array.isArray(sel.photos) ? sel.photos.length : 0;
              const extraFeeNum = parseFloat(pkgInfo?.details?.extra_photo_fee || pkgInfo?.extra_photo_fee || 0) || 0;
              const extraTotal = sel ? Math.round(extraFeeNum * selPhotos * 100) / 100 : 0;
              return [
                { k: '已加片', v: `${selPhotos}张`, red: false },
                { k: '已付加片费', v: `¥ ${extraTotal.toFixed(2)}`, red: true }
              ].map((r) => (
                <div key={r.k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px' }}>
                  <span style={{ fontSize: 14, color: '#1f2329' }}>{r.k}</span>
                  <span style={{ fontSize: 14, color: r.red ? '#FA5151' : '#666' }}>{r.v}</span>
                </div>
              ));
            })()}
          </div>

          {/* 备注（预约备注 / 调查问卷 / 员工备注） */}
          <div style={{ margin: '12px 12px 0', background: '#fff', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            {(() => {
              const rows = [
                { k: '预约备注', v: detail?.appointment_remark || '无' },
                { k: '调查问卷', v: detail?.questionnaire_answers ? '已填写' : '未填写' },
                { k: '员工备注', v: detail?.internal_remark || '未填写' }
              ];
              return rows.map((r, i) => (
                <div key={r.k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px' }}>
                  <span style={{ fontSize: 14, color: '#1f2329' }}>{r.k}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 14, color: r.v === '无' || r.v === '未填写' ? '#bbb' : '#666' }}>{r.v}</span>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#CCCCCC" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                  </div>
                </div>
              ));
            })()}
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <button type="button" onClick={() => nav('/orders/' + detail?.id + '/notes')} style={{ background: 'none', border: 'none', color: '#7ECDBB', fontSize: 13 }}>展开备注</button>
            </div>
          </div>

          {/* 客户改期/取消申请（B端审核；仅 pending 显示操作按钮） */}
          {orderRequests.length > 0 && (
            <div style={{ margin: '12px 12px 0', background: '#fff', borderRadius: 8, padding: '14px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <div style={{ fontSize: 14, color: '#1f2329', marginBottom: 8 }}>客户申请</div>
              {orderRequests.map((rq) => (
                <div key={rq.id} style={{ padding: '10px 0', borderTop: '1px solid #F5F5F5' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 6, background: rq.type === 'reschedule' ? '#EAF7F4' : '#FDECEC', color: rq.type === 'reschedule' ? '#3E9C8B' : '#FF4D4F' }}>
                      {rq.type === 'reschedule' ? '改期' : '取消'}
                    </span>
                    <span style={{ fontSize: 12, color: '#999' }}>{rq.status === 'pending' ? '待处理' : rq.status === 'approved' ? '已通过' : '已拒绝'}</span>
                    <span style={{ flex: 1 }} />
                  </div>
                  <div style={{ fontSize: 13, color: '#666', marginTop: 6, lineHeight: 1.6 }}>{rq.reason}</div>
                  {rq.desired_date && <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>期望日期：{rq.desired_date}</div>}
                  {rq.status === 'pending' && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button type="button" onClick={() => handleRequest(rq.id, 'approved')}
                        style={{ padding: '5px 14px', borderRadius: 6, background: '#7ECDBB', color: '#fff', fontSize: 12, border: 'none', cursor: 'pointer' }}>通过</button>
                      <button type="button" onClick={() => handleRequest(rq.id, 'rejected')}
                        style={{ padding: '5px 14px', borderRadius: 6, background: '#fff', color: '#999', fontSize: 12, border: '1px solid #E8E8E8', cursor: 'pointer' }}>拒绝</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 订单变更记录（3 项可点击跳转 logModal 对应 tab） */}
          <div onClick={() => { setLogModalTab('status'); setLogModal(true); }} style={{ margin: '12px 12px 0', background: '#fff', borderRadius: 8, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', cursor: 'pointer' }}>
            <span style={{ fontSize: 14, color: '#1f2329' }}>订单变更记录</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 13, color: '#bbb' }}>
              <span onClick={(e) => { e.stopPropagation(); setLogModalTab('status'); setLogModal(true); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>状态<span style={{ marginLeft: 3 }}>›</span></span>
              <span onClick={(e) => { e.stopPropagation(); setLogModalTab('trade'); setLogModal(true); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>交易<span style={{ marginLeft: 3 }}>›</span></span>
              <span onClick={(e) => { e.stopPropagation(); setLogModalTab('download'); setLogModal(true); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>顾客下载<span style={{ marginLeft: 3 }}>›</span></span>
            </div>
          </div>

          {/* 更多设置底部弹窗 */}
          {moreMenu && (
            <div className="fixed inset-0 z-[80]" style={{ background: 'rgba(0,0,0,0.35)' }} onClick={() => setMoreMenu(false)}>
              <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: '8px 0 calc(20px + env(safe-area-inset-bottom))' }}>
                <div style={{ textAlign: 'center', fontSize: 13, color: '#999999', padding: '6px 0 8px' }}>更多设置</div>
                {[
                  { t: '编辑订单', fn: () => { setMoreMenu(false); openEdit(); } },
                  { t: '分享订单', fn: () => { setMoreMenu(false); openMiniQr(); } },
                  { t: '登记收款', fn: () => { setMoreMenu(false); setPay({ type: 'deposit', amount: '', method: 'offline', channel: 'wechat', note: '' }); } },
                  { t: '打印单据', fn: () => { setMoreMenu(false); printOrder(); } },
                  { t: '复制订单', fn: () => { setMoreMenu(false); copyOrder(); } },
                  { t: '关闭订单', fn: () => { setMoreMenu(false); cancel(); } },
                  { t: '删除订单', fn: () => { setMoreMenu(false); removeOrder(); } }
                ].map((it) => (
                  <button key={it.t} type="button" onClick={it.fn} style={{ width: '100%', padding: '13px 20px', border: 'none', background: 'none', textAlign: 'left', fontSize: 15, color: '#333333' }}>{it.t}</button>
                ))}
              </div>
            </div>
          )}

          {/* 固定底部：关闭订单 + 完成拍摄 */}
          <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, display: 'flex', zIndex: 40, background: '#fff', boxShadow: '0 -2px 8px rgba(0,0,0,0.05)' }}>
            <button type="button" onClick={cancel} disabled={detail?.cancelled}
              style={{ flex: 1, padding: '12px 0 calc(12px + env(safe-area-inset-bottom))', background: '#B5B5B5', color: '#fff', fontSize: 15, border: 'none', opacity: detail?.cancelled ? 0.4 : 1 }}>关闭订单</button>
            <button type="button" onClick={finishShoot} disabled={detail?.cancelled}
              style={{ flex: 1, padding: '12px 0 calc(12px + env(safe-area-inset-bottom))', background: '#FA5151', color: '#fff', fontSize: 15, border: 'none', opacity: detail?.cancelled ? 0.4 : 1 }}>完成拍摄</button>
          </div>
        </div>
      ) : (
        <div style={{ background: '#f7f7f7', minHeight: '100vh', padding: isMobile ? `0 0 calc(72px + env(safe-area-inset-bottom))` : '0 16px 24px', maxWidth: 1280, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
      {/* ============ Module 3：订单状态卡片（白色卡片 + 左侧操作 + 右侧 4 步进度条，复刻第3张） ============ */}
      <section style={{ margin: isMobile ? '8px 12px 0' : '8px 24px 0', background: '#FFFFFF', border: '1px solid ' + CARD_BORDER, borderTop: '3px solid ' + TEAL, borderRadius: 4, boxShadow: '0 1px 5px rgba(0,0,0,0.04)' }}>
        <div className="flex items-stretch" style={{ minHeight: 132, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
          {/* 左侧订单操作区 */}
          <div className="flex flex-col justify-center shrink-0" style={{ width: isMobile ? '100%' : '23%', minWidth: isMobile ? 0 : 240, padding: isMobile ? '16px 20px' : '16px 28px', gap: 10, position: 'relative' }}>
            <div style={{ fontSize: 12, color: TEXT_SUB, marginBottom: 2 }}>
              订单编号：<span style={{ color: '#333333', fontWeight: 400 }}>{detail.order_no}</span>
            </div>
            <button type="button" onClick={finishShoot} disabled={detail.status === 'cancelled'}
              style={{ alignSelf: 'center', width: 160, height: 36, borderRadius: 2, background: BLUE, color: '#fff', fontSize: 12, fontWeight: 400, border: '1px solid ' + BLUE, opacity: detail.status === 'cancelled' ? 0.4 : 1, cursor: 'pointer' }}>完成拍摄</button>
            <button type="button" onClick={openMiniQr} disabled={miniQrLoading}
              style={{ alignSelf: 'center', width: 160, height: 36, borderRadius: 2, background: BLACK_TAG, color: '#fff', fontSize: 12, fontWeight: 400, border: '1px solid ' + BLACK_TAG, cursor: 'pointer', opacity: miniQrLoading ? 0.6 : 1 }}>分享订单</button>
            <div className="flex items-center" style={{ justifyContent: 'space-between', marginTop: 2 }}>
              <button type="button" onClick={cancel}
                style={{ background: 'none', border: 'none', color: TEXT_MAIN, fontSize: 12, textAlign: 'left', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                关闭订单
              </button>
              <button type="button" onClick={() => { setMoreMenu((m) => !m); setCustMoreMenu(false); }}
                style={{ background: 'none', border: 'none', color: TEXT_MAIN, fontSize: 12, textAlign: 'right', cursor: 'pointer', padding: 0, position: 'relative', display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></svg>
                更多设置
                {moreMenu && renderMoreMenu(() => setMoreMenu(false), 'left')}
              </button>
            </div>
          </div>

          {/* 竖向分割线 */}
          <div style={{ width: 1, background: DIV, margin: '16px 0', flexShrink: 0, display: isMobile ? 'none' : 'block' }} />

          {/* 右侧 11 步横向流程进度条（spec：完成=蓝色圆圈+蓝色对勾 / 当前=蓝色实心 / 未达=灰色空心；连接线蓝/灰；支持横向滚动） */}
          <div className="flex-1" style={{ minWidth: 0, flex: isMobile ? '1 1 100%' : undefined, padding: isMobile ? '14px 16px' : '14px 28px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 12 }}>
            <div className="flex items-center justify-between" style={{ fontSize: 12, color: TEXT_SUB, marginBottom: 12 }}>
              <button type="button" onClick={stepPrev} disabled={detail.cancelled || curStep <= 0}
                style={{ height: 24, padding: '0 12px', borderRadius: 3, border: '1px solid #D8D8D8', background: '#fff', color: detail.cancelled || curStep <= 0 ? '#CCCCCC' : TEXT_MAIN, fontSize: 12, cursor: detail.cancelled || curStep <= 0 ? 'not-allowed' : 'pointer' }}>‹ 上一步</button>
              <button type="button" onClick={stepNext} disabled={detail.cancelled || curStep >= ORDER_STAGES.length - 1}
                style={{ height: 24, padding: '0 12px', borderRadius: 3, border: '1px solid ' + BLUE, background: BLUE, color: '#fff', fontSize: 12, cursor: detail.cancelled || curStep >= ORDER_STAGES.length - 1 ? 'not-allowed' : 'pointer', opacity: detail.cancelled || curStep >= ORDER_STAGES.length - 1 ? 0.4 : 1 }}>下一步 ›</button>
            </div>
            {/* 状态文字行已删除（与手机端 db330aa 一致，进度条上方仅保留两个按钮） */}
            <div style={{ overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch' }}>
              <div className="flex items-start" style={{ gap: 0, minWidth: steps.length * 70 + (steps.length - 1) * 20 }}>
                {steps.map((st, i) => (
                  <React.Fragment key={st.key}>
                    <div className="flex flex-col items-center" style={{ width: 70, flexShrink: 0 }}>
                      <div style={{
                        width: 26, height: 26, borderRadius: '50%',
                        background: st.state === 'done' ? '#EAF6FD' : st.state === 'current' ? BLUE : '#FFFFFF',
                        border: st.state === 'done' || st.state === 'current' ? ('1px solid ' + BLUE) : '1px solid rgba(0,0,0,0.25)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: st.state === 'done' ? BLUE : (st.state === 'pending' ? 'rgba(0,0,0,0.25)' : '#FFFFFF')
                      }}>
                        {st.state === 'done'
                          ? <CheckIcon />
                          : <span style={{ fontSize: 12, fontWeight: 400, color: st.state === 'current' ? '#FFFFFF' : 'rgba(0,0,0,0.25)' }}>{i + 1}</span>}
                      </div>
                      <span style={{ fontSize: 12, marginTop: 6, textAlign: 'center', whiteSpace: 'nowrap', color: st.state === 'pending' ? 'rgba(0,0,0,0.25)' : st.state === 'current' ? '#555555' : 'rgba(0,0,0,0.65)' }}>{st.label}</span>
                    </div>
                    {i < steps.length - 1 && (
                      <div style={{ flex: 1, height: 1, minWidth: 20, marginTop: 13, background: (st.state === 'done' && steps[i + 1].state === 'done') ? BLUE : '#E5E5E5' }} />
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>
            <div style={{ textAlign: 'right', marginTop: 4 }}>
              <button type="button" onClick={() => { setLogModalTab('status'); setLogModal(true); }}
                style={{ background: 'none', border: 'none', color: BLUE, fontSize: 12, padding: 0, cursor: 'pointer' }}>
                状态变更记录 ›
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ============ 选片任务摘要（固定靠前） ============ */}
      {selectionInfo && (
        <section style={{ margin: isMobile ? '8px 12px 0' : '8px 24px 0', background: '#FFFFFF', border: '1px solid ' + CARD_BORDER, borderRadius: 4, boxShadow: '0 1px 5px rgba(0,0,0,0.04)' }}>
          <div style={{ padding: isMobile ? '14px 16px' : '14px 24px' }}>
            <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 10 }}>
              <div style={{ fontSize: 14, color: '#222222', fontWeight: 400 }}>
                选片
                {selectionInfo.task && (
                  <span style={{ marginLeft: 10, fontSize: 12, padding: '2px 10px', borderRadius: 10, background: selectionInfo.task.status === 'completed' ? 'rgba(126,205,187,0.18)' : 'rgba(245,166,35,0.15)', color: selectionInfo.task.status === 'completed' ? '#3E9C8B' : '#C77B00' }}>
                    {({ not_started: '未开启', selecting: '选片中', pending_payment: '待支付', completed: '已完成', reset: '已重置' })[selectionInfo.task.status] || selectionInfo.task.status}
                  </span>
                )}
              </div>
              {!isMobile && <button type="button" onClick={() => nav('/selections')} style={{ background: 'none', border: 'none', color: BLUE, fontSize: 13, cursor: 'pointer', padding: 0 }}>管理选片 ›</button>}
            </div>
            {(!selectionInfo.task || !selectionInfo.photo_total) ? (
              <div style={{ fontSize: 13, color: '#999999', marginTop: 10 }}>尚未上传底片，请到「在线选片」上传底片并开启选片。</div>
            ) : (
              <div className="flex" style={{ gap: isMobile ? 14 : 28, marginTop: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: '#666666' }}>底片 <span style={{ color: '#222222' }}>{selectionInfo.photo_total}</span> 张</span>
                <span style={{ fontSize: 13, color: '#666666' }}>保留 <span style={{ color: '#FF5A5F' }}>{selectionInfo.stats ? selectionInfo.stats.keep : 0}</span> 张</span>
                <span style={{ fontSize: 13, color: '#666666' }}>淘汰 <span style={{ color: '#8E8E93' }}>{selectionInfo.stats ? selectionInfo.stats.reject : 0}</span> 张</span>
                <span style={{ fontSize: 13, color: '#666666' }}>加选 <span style={{ color: '#222222' }}>{selectionInfo.extra ? selectionInfo.extra.extraCount : 0}</span> 张 · ¥{selectionInfo.extra ? selectionInfo.extra.extraFee.toFixed(2) : '0.00'}</span>
                {selectionInfo.task && selectionInfo.task.status === 'pending_payment' && (
                  <span style={{ fontSize: 13, color: '#C77B00' }}>待支付 ¥{(selectionInfo.task.pending_fee || 0).toFixed(2)}</span>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ============ 客户&订单基础信息卡片（全卡 1:1 复刻，750 设计稿，rpx） ============ */}
      <section style={{ margin: isMobile ? '8px 12px 0' : '8px 24px 0', background: '#FFFFFF', borderRadius: CARD_RADIUS, boxShadow: CARD_SHADOW }}>

        {/* ——— 1、卡片头部行 ——— */}
        <div style={{ padding: isMobile ? '16px 16px 0' : '20px 24px 0' }}>
          <div className="flex items-center justify-between" style={{ position: 'relative', flexWrap: 'wrap', gap: isMobile ? 10 : 0 }}>
            {/* 左：圆形客户头像 / 客户姓名 / 手机号 / 编辑笔 / 红色边框【客户信息】 */}
            <div className="flex items-center" style={{ gap: 8, flexWrap: 'wrap' }}>
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

            {/* 右：四个功能按钮（整体右移，左缘对齐红线 x=1115 / 64.32%；移动端改为常规流式换行） */}
            <div className="flex items-center" style={{ gap: isMobile ? 8 : 10, flexWrap: isMobile ? 'wrap' : 'nowrap', flexShrink: 0 }}>
              <button type="button" onClick={() => setQuestionnaireModal(true)}
                style={{ height: 28, minWidth: 93, justifyContent: 'center', borderRadius: 2, background: SURVEY_BTN, color: '#fff', fontSize: 12, fontWeight: 400, border: '1px solid ' + SURVEY_BTN, padding: '0 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, flex: isMobile ? '1 1 45%' : undefined }}>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 13h6M9 17h6" /></svg>
                调查问卷
              </button>
              <button type="button" onClick={openEdit}
                style={{ ...secBtnStyle, minWidth: 93, justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 6, flex: isMobile ? '1 1 45%' : undefined }}>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                编辑订单
              </button>
              <button type="button" onClick={openAddonBox}
                style={{ ...secBtnStyle, minWidth: 93, justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 6, flex: isMobile ? '1 1 45%' : undefined }}>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></svg>
                加片设置
              </button>
              <button type="button" onClick={() => { setCustMoreMenu((m) => !m); setMoreMenu(false); }}
                style={{ ...secBtnStyle, minWidth: 93, justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 6, position: 'relative', flex: isMobile ? '1 1 45%' : undefined }}>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>
                更多设置
                {custMoreMenu && renderMoreMenu(() => setCustMoreMenu(false), 'right')}
              </button>
            </div>
          </div>

          <div style={{ height: 1, background: HEAD_DIVIDER, margin: '12px 0' }} />
        </div>

        {/* ——— 2、订单信息主体：左侧基础信息 + 右侧灰色小卡片分组 ——— */}
        <div style={{ padding: isMobile ? '0 16px' : '0 24px' }}>
          <div className="flex flex-wrap" style={{ gap: isMobile ? 16 : (isWide ? 208 : 24), alignItems: 'stretch' }}>
            {/* 左侧：套系封面图 + 基础信息 */}
            <div style={{ flex: isMobile ? '1 1 100%' : '0 0 46%', display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: isMobile ? 16 : 63, minWidth: 0 }}>
              <div style={{ width: isMobile ? '100%' : 206, height: isMobile ? 200 : 150, borderRadius: 2, overflow: 'hidden', background: '#f3f4f6', flexShrink: 0 }}>
                {pkgInfo && pkgInfo.cover_url
                  ? <img src={img(pkgInfo.cover_url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: 12 }}>套系缩略图</div>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, flex: 1, flexBasis: isMobile ? '100%' : undefined }}>
                <InfoRow label="套系名称" labelColor={LABEL_COLOR}
                  icon={<><rect x="4" y="3" width="16" height="18" rx="2" /><line x1="8" y1="8" x2="16" y2="8" /><line x1="8" y1="12" x2="16" y2="12" /><line x1="8" y1="16" x2="12" y2="16" /></>}
                  value={pkgInfo && pkgInfo.name && pkgInfo.name !== '—' ? pkgInfo.name : '暂无'} />
                <InfoRow label="定金" labelColor={LABEL_COLOR}
                  icon={<><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M12 8v8M9.5 11h5M9.5 13h5" /></>}
                  value={<span style={{ fontSize: 12 }}>{'¥' + Number(pkgInfo?.deposit || 0).toLocaleString()}</span>}
                  tags={[
                    (detail.deposit_method === 'online' || detail.pay_method === 'online')
                      ? { t: '线上收取', bg: BLUE, fg: '#fff', tip: '定金为线上收取（微信 / 支付宝等）' }
                      : { t: '线下收取', bg: TAG_OFFLINE, fg: '#fff', tip: '定金为线下收取（现金 / 银行转账等）' }
                  ]} />
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
                        <div key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#f5f5f5', borderRadius: 999, padding: '1px 10px 1px 3px' }}>
                          {p.avatar ? <img src={p.avatar} alt="" style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} onError={(e) => { e.target.style.display = 'none'; e.target.parentElement.insertAdjacentHTML('afterbegin', '<div style="width:22px;height:22px;border-radius:50%;background:#333;color:#fff;font-size:11px;display:flex;align-items:center;justify-content:center;flex-shrink:0">' + p.name.slice(0,1) + '</div>'); }} />
                          : <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#333333', color: '#fff', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{p.name.slice(0, 1)}</div>}
                          <span style={{ fontSize: 12, color: '#222222' }}>{p.name}</span>
                          <button type="button" onClick={() => removeExecutor(i)} title="移除此执行人"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888888', padding: 0, fontSize: 14, lineHeight: 1, flexShrink: 0 }}>&times;</button>
                        </div>
                      )) : <span style={{ color: '#999999', fontSize: 12 }}>暂无</span>}
                      <button type="button" onClick={() => { setExecPickerSelections(execs.map((e) => ({ id: e.id, name: e.name, avatar: e.avatar || '' }))); setExecPickerOpen(true); }}
                        title="添加执行人"
                        style={{ width: 22, height: 22, borderRadius: '50%', background: '#21a6ff', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 14, padding: 0, flexShrink: 0 }}>+</button>
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

            </div>
          </div>

          {/* 套系摘要卡：整行紧接执行人下方（参考图） */}
          <div style={{ background: '#fafbf8', borderRadius: 2, padding: '18px 20px', marginTop: 16, marginLeft: isMobile || !isWide ? 0 : 269, maxWidth: isMobile || !isWide ? '100%' : 763 }}>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: '16px 12px' }}>
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

        {/* ——— 3、执行人单行（已迁移至左侧基础信息内） ——— */}
        <div style={{ marginTop: 0 }} />

        {/* ——— 4、浅灰色套系摘要区块（已迁移至右侧灰色小卡片） ——— */}
        <div style={{ marginTop: 0 }} />

        {/* ——— 5、卡片底部：备注信息 ——— */}
        <div style={{ padding: isMobile ? '16px 16px 24px' : '16px 16px 44px 317px' }}>
          {editingRemark ? (
            <div>
              <div className="flex items-center" style={{ gap: 6, marginBottom: 8 }}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke={ICON_COLOR} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 13h6M9 17h6" /></svg>
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
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke={ICON_COLOR} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 13h6M9 17h6" /></svg>
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
      <section style={{ margin: isMobile ? '8px 12px 0' : '8px 24px 0', background: '#FFFFFF', border: '1px solid ' + CARD_BORDER, borderRadius: 4 }}>
        {/* Tab 头部 */}
        <div className="flex items-center" style={{ height: 44, borderBottom: '1px solid ' + DIV }}>
          <div className="flex">
          {[{ k: 'raw', t: '原片' }, { k: 'sel', t: '选片' }, { k: 'retouched', t: '精修片' }].map((tb) => {
            const active = imgTab === tb.k;
            const count = tb.k === 'raw' ? photos.raw.length : tb.k === 'retouched' ? photos.retouched.length : (sel && sel.photos ? sel.photos.length : 0);
            return (
              <button key={tb.k} type="button" onClick={() => setImgTab(tb.k)}
                style={{
                  padding: '0 14px', height: 44, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12,
                  color: active ? BLUE : 'rgba(0,0,0,0.65)',
                  borderBottom: active ? '2px solid ' + BLUE : '2px solid transparent', fontWeight: 400
                }}>{tb.t}({count})</button>
            );
          })}
          </div>
          <div style={{ flex: 1 }} />
        </div>

        <div style={{ padding: isMobile ? '12px 16px 16px' : '12px 24px 24px' }}>
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
      <section style={{ margin: isMobile ? '8px 12px 24px' : '8px 24px 24px', background: '#FFFFFF', border: '1px solid ' + CARD_BORDER, borderRadius: CARD_RADIUS, boxShadow: CARD_SHADOW, overflow: 'hidden' }}>
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
        <div style={{ padding: isMobile ? '16px' : '20px 24px' }}>
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
              <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                <div style={{ color: '#222222' }}>收款流水</div>
                <button type="button" onClick={() => setPay({ type: 'deposit', amount: '', method: 'offline', channel: 'wechat', note: '' })}
                  style={{ background: 'none', border: '1px solid ' + BLUE, color: BLUE, fontSize: 12, borderRadius: 4, padding: '2px 10px', cursor: 'pointer', lineHeight: '20px' }}>+ 登记收款</button>
              </div>
              {(!detail.payments || detail.payments.length === 0) && <div style={{ color: '#999999', fontSize: 14, padding: '4px 0' }}>暂无流水</div>}
              {detail.payments && detail.payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between" style={{ borderBottom: '1px solid ' + DIV, padding: '8px 0' }}>
                  <div>
                    <span style={{ color: '#222222' }}>{TYPE_LABEL[p.type]}</span>
                    <span style={{ color: '#666666', marginLeft: 8 }}>{payMethodLabel(p)}</span>
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
              {/* 下载日志（真实下载行为留痕） */}
              <div style={{ color: '#222222', marginBottom: 8 }}>下载日志</div>
              {downloadLogs.length === 0 ? (
                <div style={{ color: '#999999', fontSize: 14, padding: '4px 0 12px' }}>暂无下载记录</div>
              ) : (
                <div style={{ display: 'grid', gap: 2, marginBottom: 12, maxHeight: 200, overflowY: 'auto' }}>
                  {downloadLogs.map((dl, i) => (
                    <div key={i} className="flex items-center justify-between" style={{ borderBottom: '1px solid ' + DIV, padding: '6px 0' }}>
                      <div className="flex items-center" style={{ gap: 8, minWidth: 0 }}>
                        <span style={{ padding: '2px 6px', borderRadius: 4, background: '#f3f4f6', fontSize: 11, color: '#666666', flexShrink: 0 }}>{dl.item_type === 'contract' ? '合同' : '作品'}</span>
                        <span style={{ color: '#222222', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dl.item_name}</span>
                      </div>
                      <div style={{ fontSize: 11, color: '#999999', flexShrink: 0, textAlign: 'right' }}>
                        <div>{dl.operator_name || ''}</div>
                        <div>{dl.created_at ? new Date(dl.created_at).toLocaleString('zh-CN') : ''}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
      </div>
      )}

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
            <select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value, channel: e.target.value === 'online' ? 'online' : 'wechat' })} style={{ ...modalInputStyle, marginTop: 12 }}>
              <option value="offline">线下</option><option value="online">线上</option>
            </select>
            {pay.method === 'offline' && (
              <select value={pay.channel} onChange={(e) => setPay({ ...pay, channel: e.target.value })} style={{ ...modalInputStyle, marginTop: 12 }}>
                <option value="wechat">微信</option><option value="alipay">支付宝</option>
                <option value="cash">现金</option><option value="bank">银行转账</option>
              </select>
            )}
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

      {/* 编辑订单弹窗：居中弹窗 + 半透明遮罩 + 圆角白卡（maxWidth 720 / maxHeight 85vh，超出内部滚动），点遮罩关闭，点表单内不关闭 */}
      {edit && (
        <div onClick={() => { setEdit(false); setPkgPicker(false); setEditErrors({}); }} className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
          <form onSubmit={saveEdit} onClick={(e) => e.stopPropagation()} className="flex flex-col" style={{ width: '100%', maxWidth: 720, maxHeight: '85vh', background: '#fff', borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden' }}>
            <div className="flex items-center justify-between shrink-0" style={{ padding: '16px 20px', borderBottom: '1px solid ' + DIV }}>
              <button type="button" onClick={() => { setEdit(false); setPkgPicker(false); setEditErrors({}); }} style={{ background: 'none', border: 'none', fontSize: 22, lineHeight: 1, color: '#999999', cursor: 'pointer', padding: 2 }} aria-label="返回">‹</button>
              <span style={{ fontSize: 15, color: '#222222' }}>编辑订单 · {detail.order_no}</span>
              <button type="submit" style={{ background: 'none', border: 'none', color: '#1f2329', fontSize: 15, fontWeight: 500, cursor: 'pointer', padding: '4px 8px' }}>保存</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px' }}>

              {/* 套系与价格（参考图：套系名称 / 订单价格 / 定金 / 尾款 / 其他消费） */}
              <div style={{ marginBottom: 16 }}>
                <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 13, color: '#666666' }}>套系名称</span>
                  <button type="button" onClick={() => setPkgPicker(true)} style={{ background: 'none', border: 'none', color: BLUE, fontSize: 12, cursor: 'pointer', padding: 0 }}>更换套系</button>
                </div>
                <button type="button" onClick={() => setPkgPicker(true)}
                  style={{ width: '100%', textAlign: 'left', background: '#FAFAFA', border: '1px solid ' + DIV, borderRadius: 4, padding: '8px 12px', fontSize: 14, color: '#222222', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span className="truncate">
                    {[pkgInfo && pkgInfo.name, pkgInfo && pkgInfo.spec && pkgInfo.spec.name].filter(Boolean).join('｜') || '—'}
                    <span style={{ color: '#999999', marginLeft: 8, fontSize: 12 }}>¥{Number((pkgInfo && pkgInfo.price) || 0).toLocaleString()}</span>
                  </span>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#999999" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="m6 9 6 6 6-6" /></svg>
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3" style={{ gap: 12, marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 13, color: '#666666', marginBottom: 4 }}>订单价格</div>
                  <div style={{ background: '#FAFAFA', border: '1px solid ' + DIV, borderRadius: 4, padding: '8px 12px', fontSize: 13, color: '#333333' }}>¥{total.toLocaleString()}</div>
                </div>
                <div>
                  <div style={{ fontSize: 13, color: '#666666', marginBottom: 4 }}>定金</div>
                  <div style={{ background: '#FAFAFA', border: '1px solid ' + DIV, borderRadius: 4, padding: '8px 12px', fontSize: 13, color: '#333333' }}>¥{Number(detail.deposit || 0).toLocaleString()}</div>
                </div>
                <div>
                  <div style={{ fontSize: 13, color: '#666666', marginBottom: 4 }}>尾款</div>
                  <div style={{ background: '#FAFAFA', border: '1px solid ' + DIV, borderRadius: 4, padding: '8px 12px', fontSize: 13, color: '#333333' }}>¥{remain.toLocaleString()}</div>
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, color: '#666666', marginBottom: 8 }}>其他消费</div>
                {(editForm.extra_items || []).map((x, i) => (
                  <div key={i} className="flex items-center" style={{ gap: 8, marginBottom: 8 }}>
                    <input value={x.name} onChange={(e) => setEditForm((f) => { const arr = [...f.extra_items]; arr[i] = { ...arr[i], name: e.target.value }; return { ...f, extra_items: arr }; })} placeholder="项目（如 加急费）" style={{ ...modalInputStyle, fontSize: 13, flex: 1 }} />
                    <input value={x.amount} type="number" onChange={(e) => setEditForm((f) => { const arr = [...f.extra_items]; arr[i] = { ...arr[i], amount: e.target.value }; return { ...f, extra_items: arr }; })} placeholder="金额" style={{ ...modalInputStyle, fontSize: 13, width: 90 }} />
                    <button type="button" onClick={() => setEditForm((f) => ({ ...f, extra_items: f.extra_items.filter((_, j) => j !== i) }))} style={{ background: 'none', border: 'none', color: '#BBBBBB', fontSize: 16, cursor: 'pointer', padding: '0 4px' }}>×</button>
                  </div>
                ))}
                <button type="button" onClick={() => setEditForm((f) => ({ ...f, extra_items: [...(f.extra_items || []), { name: '', amount: '' }] }))} style={{ background: 'none', border: '1px dashed #D8D8D8', borderRadius: 3, color: BLUE, fontSize: 12, padding: '5px 14px', cursor: 'pointer' }}>+ 添加</button>
              </div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, color: '#666666', marginBottom: 8 }}>拍摄日期与时段</div>
                <div className="flex items-center" style={{ gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                  <input value={editForm.shoot_date} onChange={(e) => setEditForm({ ...editForm, shoot_date: e.target.value })} type="date" style={{ ...modalInputStyle, fontSize: 13, maxWidth: '100%' }} />
                  <span style={{ fontSize: 11, color: '#999999' }}>修改日期将释放旧档期并占用新日期；冲突时会先提示。</span>
                </div>
                <div>
                  <div style={{ fontSize: 13, color: '#666666', marginBottom: 6 }}>拍摄时间</div>
                  <button type="button" onClick={() => setAddSched(true)}
                    style={{ ...modalInputStyle, fontSize: 13, textAlign: 'left', color: '#222', background: '#fff', display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', border: '1px dashed ' + BLUE, color: BLUE, borderRadius: 3 }}>
                    <span style={{ fontSize: 16, marginRight: 2 }}>＋</span> 添加拍摄时间
                  </button>
                </div>
              </div>

            {/* 双卡片横向布局 */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, marginBottom: 12 }}>
              {/* 卡片 1：基本信息 */}
              <div style={{ flex: '1 1 260px', minWidth: 0, background: '#FAFAFA', border: '1px solid ' + DIV, borderRadius: 6, padding: 18 }}>
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
                <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: 12, marginBottom: 6 }}>
                  <div>
                    <div style={{ fontSize: 13, color: '#666666', marginBottom: 4 }}>新郎姓名 <span style={{ color: '#ef4444' }}>*</span></div>
                    <input value={editForm.groom_name} onChange={(e) => setEditForm({ ...editForm, groom_name: e.target.value })} placeholder="新郎姓名" style={{ ...modalInputStyle, borderColor: editErrors.customer_name ? '#ef4444' : DIV, fontSize: 13 }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, color: '#666666', marginBottom: 4 }}>新娘姓名</div>
                    <input value={editForm.bride_name} onChange={(e) => setEditForm({ ...editForm, bride_name: e.target.value })} placeholder="新娘姓名" style={{ ...modalInputStyle, fontSize: 13 }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, color: '#666666', marginBottom: 4 }}>新郎电话</div>
                    <input value={editForm.groom_phone || ''} onChange={(e) => setEditForm({ ...editForm, groom_phone: e.target.value })} placeholder="11 位手机号" style={{ ...modalInputStyle, borderColor: editErrors.contact_phone ? '#ef4444' : DIV, fontSize: 13 }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, color: '#666666', marginBottom: 4 }}>新娘电话</div>
                    <input value={editForm.bride_phone || ''} onChange={(e) => setEditForm({ ...editForm, bride_phone: e.target.value })} placeholder="11 位手机号" style={{ ...modalInputStyle, fontSize: 13 }} />
                  </div>
                </div>
                {editErrors.customer_name && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 10, marginTop: -10 }}>{editErrors.customer_name}</div>}
                {editErrors.contact_phone && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 10 }}>{editErrors.contact_phone}</div>}
              </div>

              {/* 卡片 2：订单详情 */}
              <div style={{ flex: '1 1 260px', minWidth: 0, background: '#FAFAFA', border: '1px solid ' + DIV, borderRadius: 6, padding: 18 }}>
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
                  <div style={{ position: 'relative' }}>
                    <button type="button" onClick={() => setChOpen((v) => !v)}
                      style={{ ...modalInputStyle, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, cursor: 'pointer', color: editForm.channel ? '#222222' : '#999999' }}>
                      <span className="truncate">{editForm.channel || '请选择渠道'}</span>
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#999999" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="m6 9 6 6 6-6" /></svg>
                    </button>
                    {chOpen && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, maxHeight: 220, overflowY: 'auto', background: '#fff', border: '1px solid ' + DIV, borderRadius: 4, boxShadow: '0 6px 20px rgba(0,0,0,0.10)', zIndex: 30, padding: 4 }}>
                        <div onClick={() => { setEditForm({ ...editForm, channel: '', channel_id: '' }); setChOpen(false); }}
                          style={{ padding: '7px 12px', fontSize: 13, cursor: 'pointer', borderRadius: 3, color: editForm.channel ? '#333333' : BLUE, background: !editForm.channel ? '#EAF6FD' : 'transparent' }}>请选择渠道</div>
                        {channels.map((ch) => {
                          const on = editForm.channel === ch.name;
                          return (
                            <div key={ch.id} onClick={() => { setEditForm({ ...editForm, channel: ch.name, channel_id: ch.id }); setChOpen(false); }}
                              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 12px', fontSize: 13, cursor: 'pointer', borderRadius: 3, color: on ? BLUE : '#333333', background: on ? '#EAF6FD' : 'transparent' }}>
                              <span>{ch.name}</span>
                              {on && <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4 10-10" /></svg>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* 底栏卡片：状态 + 备注 + 当前套系 */}
            <div style={{ background: '#FAFAFA', border: '1px solid ' + DIV, borderRadius: 6, padding: 18, marginBottom: 12 }}>
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
            </div>

            </div>
          </form>
        </div>
      )}

      {/* 添加档期弹窗（复制拾光盒子「新增订单」弹窗；确认后写回拍摄日期/时段） */}
      {addSched && (
        <AddScheduleModal
          initialDate={editForm.shoot_date}
          initialSlots={editForm.time_slots}
          initialCustomTime={editForm.custom_time}
          packageName={(pkgInfo && pkgInfo.name) || detail.order_package || ''}
          totalAmount={detail.total_amount || detail.package_price || 0}
          onClose={() => setAddSched(false)}
          onConfirm={(date, slots, period, customTime) => { setEditForm((f) => ({ ...f, shoot_date: date, time_slots: slots, period: period || 'full', custom_time: customTime || '' })); setSlotOpen(false); setAddSched(false); }}
        />
      )}

      {/* 选取已有套系（编辑弹窗：点击套系名称弹窗，参考图：分类+搜索+列表） */}
      {pkgPicker && (() => {
        const q = pkgPickerQ.trim().toLowerCase();
        const list = (pkgs || []).filter((p) => {
          if (pkgPickerCat && String(p.category_id) !== String(pkgPickerCat)) return false;
          if (q && !String(p.name || '').toLowerCase().includes(q)) return false;
          return true;
        });
        const pick = (p) => {
          setPkgPicker(false);
          setPkgSwitch({ package_id: String(p.id), spec_id: '', package_price: '', reason: '', step: 'pick' });
        };
        return (
          <div className="fixed inset-0 z-[92] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={() => setPkgPicker(false)}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 580, maxHeight: '78vh', background: '#fff', borderRadius: 8, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div className="flex items-center justify-between shrink-0" style={{ padding: '14px 18px', borderBottom: '1px solid ' + DIV }}>
                <span style={{ fontSize: 15, color: '#222222' }}>选取已有套系</span>
                <button type="button" onClick={() => setPkgPicker(false)} style={{ background: 'none', border: 'none', fontSize: 20, lineHeight: 1, color: '#999999', cursor: 'pointer', padding: 2 }}>×</button>
              </div>
              <div className="flex items-center gap-2 shrink-0" style={{ padding: '12px 18px', borderBottom: '1px solid #F0F0F0' }}>
                <select value={pkgPickerCat} onChange={(e) => setPkgPickerCat(e.target.value)} style={{ ...modalInputStyle, fontSize: 13, width: 110 }}>
                  <option value="">全部分类</option>
                  {catList.filter((c) => !c.deleted).map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                </select>
                <input value={pkgPickerQ} onChange={(e) => setPkgPickerQ(e.target.value)} placeholder="搜索套系名称" style={{ ...modalInputStyle, fontSize: 13, flex: 1 }} />
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#999999" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '6px 10px' }}>
                {list.length === 0 && <div style={{ padding: '24px', textAlign: 'center', color: '#999999', fontSize: 13 }}>暂无匹配套系</div>}
                {list.map((p) => {
                  const off = p.status === 'off';
                  const specs = Array.isArray(p.specs) ? p.specs : [];
                  return (
                    <button key={p.id} type="button" onClick={() => pick(p)}
                      style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 12px', borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13 }}
                      className="hover:bg-[#F5F7FA]">
                      <span style={{ color: '#222222' }}>
                        {p.name}
                        {specs.length > 0 && <span style={{ color: '#999999', marginLeft: 6, fontSize: 12 }}>{specs.length} 规格</span>}
                        {off && <span style={{ marginLeft: 6, fontSize: 11, color: '#999999', border: '1px solid #DDD', borderRadius: 2, padding: '0 4px' }}>已下架</span>}
                      </span>
                      <span style={{ color: '#e4393c', fontWeight: 400 }}>¥{Number(p.price || 0).toLocaleString()}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

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

      {/* 作废订单弹窗（替换原生 confirm+prompt，iOS PWA 兼容） */}
      {cancelDlg && (
        <div className="fixed inset-0 flex items-center justify-center z-[85] p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, background: '#fff', borderRadius: 8, padding: 24 }}>
            <div style={{ color: '#FF4D4F', fontWeight: 600, marginBottom: 12, fontSize: 15 }}>作废订单</div>
            <div style={{ fontSize: 13, color: '#333333', whiteSpace: 'pre-wrap', lineHeight: 1.7, marginBottom: 12 }}>
              {cancelDlg.tip}
            </div>
            <input value={cancelDlg.reason}
              onChange={(e) => setCancelDlg({ ...cancelDlg, reason: e.target.value })}
              placeholder="作废原因（选填）" style={modalInputStyle} />
            <div className="flex justify-end" style={{ gap: 8, marginTop: 16 }}>
              <button type="button" onClick={() => setCancelDlg(null)} style={modalCancelStyle}>取消</button>
              <button type="button" onClick={doCancel} style={{ ...modalSaveStyle, background: '#FF4D4F' }}>确认作废</button>
            </div>
          </div>
        </div>
      )}

      {/* 退款弹窗（替换原生 prompt，iOS PWA 兼容） */}
      {refundDlg && (
        <div className="fixed inset-0 flex items-center justify-center z-[85] p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 400, background: '#fff', borderRadius: 8, padding: 24 }}>
            <div style={{ color: '#222222', fontWeight: 600, marginBottom: 12, fontSize: 15 }}>退款</div>
            <div style={{ fontSize: 13, color: '#666666', marginBottom: 8 }}>请输入退款金额（元）</div>
            <input value={refundDlg.amount} type="number" min="0"
              onChange={(e) => setRefundDlg({ amount: e.target.value })}
              placeholder="退款金额" style={modalInputStyle} autoFocus />
            <div className="flex justify-end" style={{ gap: 8, marginTop: 16 }}>
              <button type="button" onClick={() => setRefundDlg(null)} style={modalCancelStyle}>取消</button>
              <button type="button" onClick={doRefund} style={modalSaveStyle}>确认退款</button>
            </div>
          </div>
        </div>
      )}

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
              <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: '8px 16px', fontSize: 13, color: '#333333' }}>
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
              <select value={addonBox.method} onChange={(e) => setAddonBox({ ...addonBox, method: e.target.value, channel: e.target.value === 'online' ? 'online' : 'wechat' })}
                style={{ ...modalInputStyle, marginTop: 12 }}>
                <option value="offline">线下收款</option>
                <option value="online">线上收款</option>
              </select>
              {addonBox.method === 'offline' && (
                <select value={addonBox.channel} onChange={(e) => setAddonBox({ ...addonBox, channel: e.target.value })}
                  style={{ ...modalInputStyle, marginTop: 12 }}>
                  <option value="wechat">微信</option><option value="alipay">支付宝</option>
                  <option value="cash">现金</option><option value="bank">银行转账</option>
                </select>
              )}
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
            <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: '12px 24px', padding: '20px 24px' }}>
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
        <div onClick={() => setExecPickerOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 96, background: 'rgba(0,0,0,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isMobile ? 16 : 0 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 8, padding: 24, width: isMobile ? '100%' : 360, maxWidth: isMobile ? '100%' : 360, maxHeight: '70vh', overflow: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
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

      {/* 分享订单给客户二维码弹窗（customer_token 随机链接，客户只读查看自己订单；屏幕居中样式） */}
      {miniQr !== null && (
        <>
          <div className="fixed inset-0 z-[90]" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={closeMiniQr} />
          <div onClick={(e) => e.stopPropagation()}
            style={{ position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', zIndex: 95, width: 300, maxWidth: 'calc(100vw - 32px)', background: '#fff', borderRadius: 12, padding: '24px 22px 20px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ textAlign: 'center', fontSize: 16, color: '#1f2329' }}>分享订单</div>
            <div style={{ textAlign: 'center', fontSize: 12, color: '#999999', marginTop: 4, marginBottom: 16 }}>扫码或复制链接分享给客户</div>
            {miniQr ? (
              <>
                <img src={miniQr.qr_url} alt="订单二维码" style={{ width: 200, height: 200, margin: '0 auto', display: 'block', borderRadius: 8 }} />
                <div style={{ fontSize: 12, color: '#666666', marginTop: 14, wordBreak: 'break-all', textAlign: 'center', lineHeight: 1.5 }}>{miniQr.url}</div>
                <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                  <button onClick={copyCustomerUrl} style={{ flex: 1, padding: '10px 0', borderRadius: 20, background: '#FF4D4F', color: '#fff', fontSize: 14, border: 'none', cursor: 'pointer' }}>复制链接</button>
                  <button onClick={() => openMiniQr(true)} disabled={miniQrLoading} style={{ flex: 1, padding: '10px 0', borderRadius: 20, background: '#fff', color: '#666666', fontSize: 14, border: '1px solid #E8E8E8', cursor: 'pointer' }}>重置链接</button>
                </div>
                <div style={{ fontSize: 11, color: '#999999', textAlign: 'center', marginTop: 12, lineHeight: 1.5 }}>客户扫码 / 打开链接即可查看自己的订单（只读）</div>
              </>
            ) : (
              <div style={{ color: '#999999', fontSize: 14, padding: 60, textAlign: 'center' }}>生成中…</div>
            )}
          </div>
        </>
      )}

      {/* 打印单据内容（离屏渲染；html2canvas 直接抓取；window.print 通道 @media print 移入视口打印） */}
      <div className="print-order-sheet" style={{ position: 'fixed', left: -10000, top: 0, width: '700px' }}>
        {/* 页眉（window.print 走 sheet 通道直出；下载 PDF 走 downloadPrintPdf 自行 addImage 互相独立） */}
        <div className="print-header">
          <div className="print-header-title">拍摄服务合同</div>
          <div className="print-header-meta">订单编号：{detail.order_no}</div>
          <div className="print-header-meta2">
            创建时间：{detail.created_at ? new Date(detail.created_at).toLocaleString('zh-CN') : '—'}　·　订单状态：{statusText || '—'}
          </div>
        </div>
        <div className="print-sheet-body" style={{ maxWidth: 700, margin: '0 auto', fontFamily: 'SimSun, STSong, serif', fontSize: 14, lineHeight: 1.8, color: '#222', background: '#fff', padding: '4mm 0' }}>

          {/* 客户信息 */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 400, paddingBottom: 4, marginBottom: 10 }}>客户信息</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, lineHeight: 1.8 }}>
              <tbody>
                <tr>
                  <td style={{ padding: '4px 8px', width: 100, color: '#555' }}>客户姓名</td>
                  <td style={{ padding: '4px 8px' }}>{custName}</td>
                  <td style={{ padding: '4px 8px', width: 80, color: '#555' }}>联系电话</td>
                  <td style={{ padding: '4px 8px' }}>{phoneList.join(' / ') || '—'}</td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', color: '#555' }}>新郎</td>
                  <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>{groomPrintName || '—'}</td>
                  <td style={{ padding: '4px 8px', color: '#555' }}>新娘</td>
                  <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>{bridePrintName || '—'}</td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', color: '#555' }}>拍摄日期</td>
                  <td style={{ padding: '4px 8px' }}>{detail.shoot_date || (detail.date_tbd ? '待定' : '—')}</td>
                  <td style={{ padding: '4px 8px', width: 80, color: '#555' }}>摄影师</td>
                  <td style={{ padding: '4px 8px' }}>{(Array.isArray(detail.executors) && detail.executors.length ? detail.executors.map((x) => (x && x.name) || '').filter(Boolean).join('、') : '') || detail.executor || '—'}</td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', color: '#555' }}>拍摄地址</td>
                  <td style={{ padding: '4px 8px' }} colSpan={3}>{detail.address || '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* 套系详情：根据实际选择的套系显示完整模板字段（pkgInfo.details 来自 package_snapshot；订单特定金额从 orders 表读取） */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 400, paddingBottom: 4, marginBottom: 10 }}>套系详情</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, lineHeight: 1.8 }}>
              <tbody>
                <tr>
                  <td style={{ padding: '4px 8px', width: 100, color: '#555' }}>套系名称</td>
                  <td style={{ padding: '4px 8px' }} colSpan={3}>{(pkgInfo && pkgInfo.name) || '—'}</td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', color: '#555' }}>机位</td>
                  <td style={{ padding: '4px 8px' }}>{detail.shoot_position || '—'}</td>
                  <td style={{ padding: '4px 8px', width: 80, color: '#555' }}>原片</td>
                  <td style={{ padding: '4px 8px' }}>{pkgInfo?.details?.raw_count ? `${pkgInfo.details.raw_count} 张` : '—'}</td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', color: '#555' }}>拍摄时长</td>
                  <td style={{ padding: '4px 8px' }}>{pkgInfo?.details?.duration || '—'}</td>
                  <td style={{ padding: '4px 8px', color: '#555' }}>精修</td>
                  <td style={{ padding: '4px 8px' }}>{pkgInfo?.details?.retouch_count ? `${pkgInfo.details.retouch_count} 张` : '—'}</td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', color: '#555' }}>加片费</td>
                  <td style={{ padding: '4px 8px' }}>{pkgInfo?.details?.extra_photo_fee || '—'}</td>
                  <td style={{ padding: '4px 8px', color: '#555' }}>快修费</td>
                  <td style={{ padding: '4px 8px' }}>{Number(detail.quick_repair_cost) > 0 ? '¥' + Number(detail.quick_repair_cost).toLocaleString() : (pkgInfo?.details?.quick_repair_cost || '—')}</td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', color: '#555' }}>化妆服装</td>
                  <td style={{ padding: '4px 8px' }}>{`${pkgInfo?.details?.cloth_provide === 'provide' ? '提供服装' : '不提供服装'} · ${pkgInfo?.details?.makeup_provide === 'provide' ? '提供化妆' : '不提供化妆'}`}</td>
                  <td style={{ padding: '4px 8px', color: '#555' }}>提供相册</td>
                  <td style={{ padding: '4px 8px' }}>{pkgInfo?.details?.album_provide === 'provide' ? '是' : pkgInfo?.details?.album_provide === 'extra' ? '相册另购' : '否'}</td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', color: '#555' }}>拍摄费</td>
                  <td style={{ padding: '4px 8px' }}>{Number(detail.shoot_cost) > 0 ? '¥' + Number(detail.shoot_cost).toLocaleString() : '—'}</td>
                  <td style={{ padding: '4px 8px', color: '#555' }}>定金</td>
                  <td style={{ padding: '4px 8px' }}>{Number(detail.deposit) > 0 ? '¥' + Number(detail.deposit).toLocaleString() : '—'}</td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', color: '#555', verticalAlign: 'top' }}>交付时间</td>
                  <td style={{ padding: '4px 8px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.8 }} colSpan={3}>{pkgInfo?.details?.delivery_time || '—'}</td>
                </tr>
                <tr>
                  <td style={{ padding: '4px 8px', color: '#555', verticalAlign: 'top' }}>交付备注</td>
                  <td style={{ padding: '4px 8px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.8 }} colSpan={3}>{pkgInfo?.details?.delivery_remark || '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* 收款信息 */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 400, paddingBottom: 4, marginBottom: 10 }}>收款信息</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, lineHeight: 1.8 }}>
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
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 14, color: '#555', marginBottom: 6 }}>收款明细</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, lineHeight: 1.8, border: '1px solid #ddd' }}>
                  <thead>
                    <tr style={{ background: '#f5f5f5' }}>
                      <th style={{ padding: '10px 12px', border: '1px solid #ddd', textAlign: 'center', fontWeight: 400 }}>类型</th>
                      <th style={{ padding: '10px 12px', border: '1px solid #ddd', textAlign: 'center', fontWeight: 400 }}>金额</th>
                      <th style={{ padding: '10px 12px', border: '1px solid #ddd', textAlign: 'center', fontWeight: 400 }}>方式</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.payments.map((p) => (
                      <tr key={p.id}>
                        <td style={{ padding: '10px 12px', border: '1px solid #ddd', textAlign: 'center' }}>{TYPE_LABEL[p.type] || p.type}</td>
                        <td style={{ padding: '10px 12px', border: '1px solid #ddd', textAlign: 'center' }}>{p.type === 'refund' ? '-' : '+'}¥{Number(p.amount).toLocaleString()}</td>
                        <td style={{ padding: '10px 12px', border: '1px solid #ddd', textAlign: 'center' }}>{payMethodLabel(p)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 服务详情（订单套系快照；空时用官方默认模板） */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 400, paddingBottom: 4, marginBottom: 12 }}>服务详情</div>
            <div style={{ fontSize: 14, lineHeight: 1.8, color: '#222', whiteSpace: 'pre-wrap', textIndent: '2em' }}>
              {((pkgInfo && pkgInfo.details && pkgInfo.details.service_detail_text) || DEFAULT_SERVICE_DETAIL)}
            </div>
          </div>

          {/* 顾客服务协议：订单创建时的套系快照；空时用官方默认模板 */}
          {(() => {
            const sd = (pkgInfo && pkgInfo.details) || {};
            const paras = toParagraphs(getServiceAgreement(sd));
            if (!paras.length) return null;
            return (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 16, fontWeight: 400, paddingBottom: 4, marginBottom: 12 }}>
                  顾客服务协议
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.8, color: '#222' }}>
                  {paras.map((p, i) => {
                    const isHeading = /^[一二三四五六七八九十]+、/.test(p);
                    return (
                      <div key={i} style={{ marginTop: isHeading ? 8 : 0, marginBottom: 4, fontWeight: 400, textIndent: isHeading ? 0 : '2em' }}>{p}</div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* 顾客照片授权协议 */}
          {(() => {
            const sd = (pkgInfo && pkgInfo.details) || {};
            const paras = toParagraphs(getPhotoAuthAgreement(sd));
            if (!paras.length) return null;
            return (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 16, fontWeight: 400, paddingBottom: 4, marginBottom: 12 }}>
                  顾客照片授权协议
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.8, color: '#222' }}>
                  {paras.map((p, i) => {
                    const isHeading = /^[一二三四五六七八九十]+、/.test(p);
                    return (
                      <div key={i} style={{ marginTop: isHeading ? 8 : 0, marginBottom: 4, fontWeight: 400, textIndent: isHeading ? 0 : '2em' }}>{p}</div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* 退订政策：放在最底部（用户最新要求：按 顾客服务协议 → 顾客照片授权协议 → 退订政策 顺序） */}
          {(() => {
            const sd = (pkgInfo && pkgInfo.details) || {};
            const policy = normalizePolicy(sd.refund_policy);
            const paras = getRefundParagraphs(sd, policy);
            if (!paras.length) return null;
            return (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 16, fontWeight: 400, paddingBottom: 4, marginBottom: 12 }}>
                  退订政策（{policy}）
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.8, color: '#222' }}>
                  {paras.map((p, i) => (
                    <div key={i} style={{ marginBottom: i < paras.length - 1 ? 6 : 0, fontWeight: 400, textIndent: '2em' }}>{p}</div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* 备注：客户备注 + 商家内部备注（开关控制，默认关，内部备注敏感） */}
          {detail.remark && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 400, paddingBottom: 4, marginBottom: 12 }}>客户备注</div>
              <div style={{ fontSize: 14, lineHeight: 1.8, color: '#222', whiteSpace: 'pre-wrap', textIndent: '2em' }}>{detail.remark}</div>
            </div>
          )}
          {printInternal && detail.internal_remark && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 400, paddingBottom: 4, marginBottom: 12 }}>商家内部备注</div>
              <div style={{ fontSize: 14, lineHeight: 1.8, color: '#222', whiteSpace: 'pre-wrap', textIndent: '2em' }}>{detail.internal_remark}</div>
            </div>
          )}

          </div>
        {/* 页脚（window.print 通道直出，与 PDF 路径 addImage 页眉页脚内容一致） */}
        <div className="print-footer">
          <span>叶哲 STUDIO · 摄影工作室管理系统</span>
          <span>打印时间：{new Date().toLocaleString('zh-CN')}</span>
        </div>
      </div>

      {/* 订单记录全屏页（点击底部订单变更记录跳转，校 IMG_7533） */}
      {logModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 70, background: '#fff', display: 'flex', flexDirection: 'column' }}>
          <div style={{ paddingTop: 'env(safe-area-inset-top, 0px)', height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid ' + DIV, flexShrink: 0, position: 'relative' }}>
            <button type="button" onClick={() => setLogModal(false)}
              style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontSize: 20, padding: 4 }} aria-label="返回">‹</button>
            <div style={{ fontSize: 16, fontWeight: 500, color: '#222222' }}>订单记录</div>
          </div>
          <div className="flex" style={{ borderBottom: '1px solid ' + DIV, padding: '0 24px', flexShrink: 0 }}>
            {[{ k: 'status', t: '订单变更记录' }, { k: 'trade', t: '交易记录' }, { k: 'download', t: '下载记录' }].map((tb) => {
              const active = logModalTab === tb.k;
              return (
                <button key={tb.k} type="button" onClick={() => setLogModalTab(tb.k)}
                  style={{ padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: active ? '#FF4949' : '#666666', borderBottom: active ? '2px solid #FF4949' : '2px solid transparent', fontWeight: active ? 500 : 400 }}>
                  {tb.t}
                </button>
              );
            })}
          </div>
          <div style={{ padding: '20px 24px', overflow: 'auto', flex: 1 }}>
            {logModalTab === 'status' && (
              <>
                <div style={{ color: '#222222', fontSize: 13, marginBottom: 12 }}>订单编号：{detail.order_no}</div>
                {(detail.logs || []).length === 0 && <div style={{ color: '#999999', fontSize: 14, padding: '4px 0' }}>暂无日志</div>}
                {(detail.logs || []).map((l, i, arr) => (
                  <div key={i} className="flex" style={{ gap: 12 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 50, flexShrink: 0 }}>
                      <div style={{ fontSize: 13, color: '#666' }}>{new Date(l.t).toLocaleDateString('zh-CN').replace(/\//g, '-')}</div>
                      <div style={{ fontSize: 11, color: '#999' }}>{new Date(l.t).getFullYear()}</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#FF4949', marginTop: 7, flexShrink: 0 }} />
                      {i < arr.length - 1 && <span style={{ flex: 1, width: 1, background: '#EAEAEA', marginTop: 4 }} />}
                    </div>
                    <div style={{ flex: 1, paddingBottom: 14 }}>
                      <div style={{ fontSize: 14, color: '#333333' }}>{l.text}</div>
                      <div style={{ fontSize: 12, color: TEXT_SUB, marginTop: 2 }}>{new Date(l.t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                  </div>
                ))}
              </>
            )}
            {logModalTab === 'trade' && (
              <div>
                <div style={{ color: '#222222', fontSize: 13, marginBottom: 12 }}>订单编号：{detail.order_no}</div>
                <div style={{ color: '#222222', fontWeight: 400, marginBottom: 8 }}>收款流水</div>
                {(!detail.payments || detail.payments.length === 0) && <div style={{ color: '#999999', fontSize: 14, padding: '4px 0' }}>暂无流水</div>}
                {detail.payments && detail.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between" style={{ borderBottom: '1px solid ' + DIV, padding: '8px 0' }}>
                    <div>
                      <span style={{ color: '#222222' }}>{TYPE_LABEL[p.type]}</span>
                      <span style={{ color: '#666666', marginLeft: 8 }}>{payMethodLabel(p)}</span>
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
                <div style={{ color: '#222222', fontSize: 13, marginBottom: 12 }}>订单编号：{detail.order_no}</div>
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
      )}

      {/* 更多服务详情全屏页（校 IMG_7532） */}
      {svcDetailOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 80, background: '#fff', display: 'flex', flexDirection: 'column' }}>
          <div style={{ paddingTop: 'env(safe-area-inset-top, 0px)', height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid ' + DIV, flexShrink: 0, position: 'relative' }}>
            <button type="button" onClick={() => { setSvcDetailOpen(false); setSvcDetailExpanded(false); setSvcRefundExpanded(false); setSvcAgreementExpanded(false); setSvcPhotoAuthExpanded(false); }} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontSize: 20, padding: 4 }} aria-label="返回">‹</button>
            <span style={{ fontSize: 16, fontWeight: 500, color: '#222' }}>套系服务详情</span>
          </div>
          <div style={{ overflowY: 'auto', flex: 1, padding: '8px 20px' }}>
            {/* 标准模版完整字段列表（与 PackagePreview 套系更多服务一致） */}
            {(() => {
              const dd = (pkgInfo && pkgInfo.details) || {};
              const rows = [
                { label: '拍摄时长', value: dd.duration || pkgInfo?.duration || '未设置' },
                { label: '原片', value: dd.raw_count ? `${dd.raw_count}张` : '未设置' },
                { label: '精修片', value: dd.retouch_count ? `${dd.retouch_count}张` : '未设置' },
                { label: '加片费', value: dd.extra_photo_fee || '未设置' },
                { label: '快修费', value: dd.quick_repair_cost || '未设置' },
                { label: '交付时间', value: dd.delivery_time || '未设置' },
                { label: '交付备注', value: dd.delivery_remark || '未设置', fullWidth: true },
                { label: '化妆服装', value: `${dd.cloth_provide === 'provide' ? '提供服装' : '不提供服装'} · ${dd.makeup_provide === 'provide' ? '提供化妆' : '不提供化妆'}` },
                { label: '提供相册', value: dd.album_provide === 'provide' ? '是' : dd.album_provide === 'extra' ? '相册另购' : '否' },
                { label: '服务地点', value: dd.service_location || '未设置' }
              ];
              return rows.map((row, i, arr) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '14px 0', borderBottom: i < arr.length - 1 ? `1px solid ${DIV}` : 'none' }}>
                  <span style={{ fontSize: 14, color: '#333', flex: 1 }}>{row.label}</span>
                  <span style={{ fontSize: 14, color: '#666', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.value}</span>
                  <span style={{ color: '#82C8AE', marginLeft: 6 }}>›</span>
                </div>
              ));
            })()}

            <div style={{ height: 1, background: DIV, margin: '12px -20px' }} />

            {/* 服务详情（可展开） */}
            <div style={{ padding: '14px 0' }}>
              <div onClick={() => setSvcDetailExpanded((v) => !v)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                <span style={{ fontSize: 14, color: '#333' }}>服务详情</span>
                <span style={{ fontSize: 14, color: '#82C8AE' }}>{svcDetailExpanded ? '收起' : '展开'}</span>
              </div>
              {svcDetailExpanded && (
                <div style={{ marginTop: 10, fontSize: 13, color: '#666', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                  {(pkgInfo?.details?.service_detail_text) || pkgInfo?.description || DEFAULT_SERVICE_DETAIL}
                </div>
              )}
            </div>

            {/* 退订政策（严格档：默认文案 + 套系自定义覆盖） */}
            <div style={{ padding: '14px 0', borderTop: `1px solid ${DIV}` }}>
              <div onClick={() => setSvcRefundExpanded((v) => !v)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                <span style={{ fontSize: 14, color: '#333' }}>退订政策</span>
                <span style={{ fontSize: 14, color: (pkgInfo?.details?.hide_refund) ? '#999' : '#82C8AE' }}>{(pkgInfo?.details?.hide_refund) ? '该套系已设置为隐藏退订政策' : (svcRefundExpanded ? '收起' : '展开')}</span>
              </div>
              {!pkgInfo?.details?.hide_refund && svcRefundExpanded && (() => {
                const sd = (pkgInfo && pkgInfo.details) || {};
                const policy = normalizePolicy(sd.refund_policy);
                const paras = getRefundParagraphs(sd, policy);
                if (!paras.length) return <div style={{ marginTop: 10, fontSize: 13, color: '#666', lineHeight: 1.6 }}>未设置</div>;
                return (
                  <div style={{ marginTop: 10, fontSize: 13, color: '#666', lineHeight: 1.6 }}>
                    {paras.map((p, i) => {
                      const isHeading = /^[一二三四五六七八九十]+、|退订/.test(p);
                      return (
                        <div key={i} style={{ marginTop: isHeading && i > 0 ? 8 : 0, marginBottom: 4, fontSize: isHeading ? 14 : 13 }}>{p}</div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            {/* 顾客协议（与 PackagePreview 一致：永远绿色 + 展开/收起） */}
            {(() => {
              const sd = (pkgInfo && pkgInfo.details) || {};
              const paras = toParagraphs(getServiceAgreement(sd));
              if (!paras.length) return null;
              return (
                <div style={{ padding: '14px 0', borderTop: `1px solid ${DIV}` }}>
                  <div onClick={() => setSvcAgreementExpanded((v) => !v)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                    <span style={{ fontSize: 14, color: '#333' }}>顾客协议</span>
                    <span style={{ fontSize: 14, color: '#82C8AE' }}>{svcAgreementExpanded ? '收起' : '展开'}</span>
                  </div>
                  {svcAgreementExpanded && (
                    <div style={{ marginTop: 10, fontSize: 13, color: '#666', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                      {paras.map((p, i) => {
                        const isHeading = /^[一二三四五六七八九十]+、/.test(p);
                        return (
                          <div key={i} style={{ marginTop: isHeading ? 8 : 0, marginBottom: 4 }}>{p}</div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* 顾客照片授权协议 */}
            {(() => {
              const sd = (pkgInfo && pkgInfo.details) || {};
              const paras = toParagraphs(getPhotoAuthAgreement(sd));
              if (!paras.length) return null;
              return (
                <div style={{ padding: '14px 0', borderTop: `1px solid ${DIV}` }}>
                  <div onClick={() => setSvcPhotoAuthExpanded((v) => !v)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                    <span style={{ fontSize: 14, color: '#333' }}>顾客照片授权协议</span>
                    <span style={{ fontSize: 14, color: '#82C8AE' }}>{svcPhotoAuthExpanded ? '收起' : '展开'}</span>
                  </div>
                  {svcPhotoAuthExpanded && (
                    <div style={{ marginTop: 10, fontSize: 13, color: '#666', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                      {paras.map((p, i) => {
                        const isHeading = /^[一二三四五六七八九十]+、/.test(p);
                        return (
                          <div key={i} style={{ marginTop: isHeading ? 8 : 0, marginBottom: 4 }}>{p}</div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* 提示信息 */}
            <div style={{ marginTop: 24, padding: '10px 14px', background: '#f5f9fa', borderRadius: 6, fontSize: 12, color: '#999', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>💡</span>
              <span>修改订单将同步更新以上数据</span>
            </div>
          </div>
          <div style={{ padding: '20px 20px calc(20px + env(safe-area-inset-bottom))', display: 'flex', justifyContent: 'center', borderTop: `1px solid ${DIV}`, flexShrink: 0 }}>
            <button onClick={() => setSvcDetailOpen(false)} style={{ width: 44, height: 44, borderRadius: '50%', border: '1px solid #ddd', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
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
    </>
  );
}

// —— 复刻 spec 样式片段（模块内复用） ——
const secBtnStyle = {
  height: 28, borderRadius: 2, background: '#fff', color: '#666666',
  border: '1px solid #D9D9D9', fontSize: 12, fontWeight: 400, padding: '0 10px', cursor: 'pointer'
};
const moreItemStyle = {
  display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px',
  background: 'none', border: 'none', color: '#222222', cursor: 'pointer', whiteSpace: 'nowrap'
};
const filterCtrlStyle = { height: 32, padding: '0 8px', border: 'none', color: '#16ADF7', background: 'transparent', fontSize: 12, outline: 'none', cursor: 'pointer' };
const filterBtnStyle = { height: 32, padding: '0 16px', borderRadius: 2, border: '1px solid #D5DBE2', color: '#444B53', background: '#fff', fontSize: 12, cursor: 'pointer' };
const modalInputStyle = { width: '100%', padding: '8px 12px', borderRadius: 4, border: '1px solid ' + DIV, color: '#222222', fontSize: 14, outline: 'none', background: '#fff' };

/* 添加档期弹窗（1:1 复刻拾光盒子「新增订单」弹窗：选择场次 24 时段 + 半天全天 + 日期待定 + 套系名称） */
function AddScheduleModal({ initialDate = '', initialSlots = [], initialPeriod = 'full', initialCustomTime = '', packageName = '', totalAmount = 0, onClose, onConfirm }) {
  const [date, setDate] = useState(initialDate || '');
  const [slots, setSlots] = useState(Array.isArray(initialSlots) ? initialSlots : []);
  const [period, setPeriod] = useState(initialPeriod || 'full');
  const [tbd, setTbd] = useState(false);
  const [err, setErr] = useState('');
  // 自定义时间（文字输入，如「早上6:00-晚上21:00」）
  const [customTime, setCustomTime] = useState(initialCustomTime || '');
  const [customInput, setCustomInput] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const toggle = (h) => setSlots((s) => s.includes(h) ? s.filter((x) => x !== h) : [...s, h]);
  // 选择「半天/全天」时清空 slots
  const pickPeriod = (p) => { setPeriod(p); setSlots([]); };
  const confirm = () => {
    onConfirm(date, slots, period, customTime);
  };
  return (
    <div className="fixed inset-0 z-[95] flex items-end" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, margin: '0 auto', maxHeight: '82vh', background: '#F4F4F4', borderTopLeftRadius: 16, borderTopRightRadius: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 -6px 30px rgba(0,0,0,0.18)' }}>
        {/* 顶部 Header：右侧 × 关闭（左侧日期已移除） */}
        <div className="flex items-center justify-end shrink-0" style={{ padding: '10px 14px', background: '#F4F4F4' }}>
          <button type="button" onClick={onClose} aria-label="关闭"
            style={{ background: 'none', border: 'none', fontSize: 22, lineHeight: 1, color: '#999', cursor: 'pointer', padding: 2 }}>
            ×
          </button>
        </div>
        {/* 内容区：可滚动 */}
        <div className="flex-1 overflow-y-auto" style={{ padding: '0 16px 16px' }}>
          {/* 自定义时间（点击弹嵌套底部上滑弹窗输入文字） */}
          <button type="button" onClick={() => { setCustomInput(customTime); setCustomOpen(true); }}
            style={{ width: '100%', background: '#fff', borderRadius: 8, marginBottom: 12, padding: '14px 14px', fontSize: 14, color: '#333', display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
            <span>自定义时间</span>
            <span style={{ color: customTime ? '#222' : '#bbb', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {customTime || '›'}
            </span>
          </button>
          {/* 可选场次 24 时段网格 + 半天/全天 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px 12px' }}>
            <span style={{ fontSize: 14, color: '#333' }}>可选场次</span>
            <button type="button" onClick={() => setSlots(slots.length ? [] : HOURS.slice(0, 1))} style={{ background: 'none', border: 'none', color: '#999', fontSize: 13, padding: 0, cursor: 'pointer' }}>编辑</button>
          </div>
          <div style={{ background: '#fff', borderRadius: 8, padding: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
              {HOURS.map((h) => {
                const on = slots.includes(h);
                return (
                  <button key={h} type="button" onClick={() => toggle(h)}
                    style={{ height: 30, fontSize: 12, padding: 0, border: 'none', borderRadius: 14, cursor: 'pointer', background: on ? '#82C8AE' : '#A6E1CC', color: '#fff', fontWeight: on ? 500 : 400, position: 'relative' }}>
                    {on && <span style={{ position: 'absolute', left: 4, top: '50%', transform: 'translateY(-50%)' }}>✓</span>}
                    {h}
                  </button>
                );
              })}
              <button type="button" onClick={() => pickPeriod('half')}
                style={{ height: 30, fontSize: 12, padding: 0, border: 'none', borderRadius: 14, cursor: 'pointer', background: period === 'half' ? '#82C8AE' : '#A6E1CC', color: '#fff', fontWeight: period === 'half' ? 500 : 400 }}>半天</button>
              <button type="button" onClick={() => pickPeriod('full')}
                style={{ height: 30, fontSize: 12, padding: 0, border: 'none', borderRadius: 14, cursor: 'pointer', background: period === 'full' ? '#82C8AE' : '#A6E1CC', color: '#fff', fontWeight: period === 'full' ? 500 : 400 }}>全天</button>
            </div>
            {err && <div style={{ fontSize: 12, color: '#F53F3F', marginTop: 8 }}>{err}</div>}
          </div>
        </div>
        {/* 底部确认按钮（红底白字 + safe-area） */}
        <div className="flex justify-center shrink-0" style={{ padding: '12px 16px calc(16px + env(safe-area-inset-bottom))', background: '#fff', borderTop: '1px solid #F0F0F0' }}>
          <button type="button" onClick={confirm} style={{ width: '100%', padding: '12px 16px', background: '#FA5151', color: '#fff', fontSize: 15, border: 'none', borderRadius: 6, cursor: 'pointer' }}>确认</button>
        </div>

        {/* 自定义时间嵌套弹窗（底部上滑小弹窗） */}
        {customOpen && (
          <div className="fixed inset-0 z-[100] flex items-end" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={() => setCustomOpen(false)}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, margin: '0 auto', background: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: '20px 16px calc(16px + env(safe-area-inset-bottom))', boxShadow: '0 -6px 24px rgba(0,0,0,0.18)' }}>
              <div style={{ fontSize: 16, color: '#222', fontWeight: 500, textAlign: 'center', marginBottom: 6 }}>自定义时间</div>
              <div style={{ fontSize: 12, color: '#999', textAlign: 'center', marginBottom: 14 }}>输入拍摄时间文字描述，如「早上6:00-晚上21:00」</div>
              <input
                autoFocus
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                placeholder="早上6:00-晚上21:00"
                style={{ width: '100%', padding: '12px 14px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 14, color: '#222', outline: 'none', background: '#fff', boxSizing: 'border-box' }}
              />
              <div style={{ display: 'flex', gap: 12, marginTop: 14 }}>
                <button type="button" onClick={() => setCustomOpen(false)} style={{ flex: 1, padding: '12px', background: '#fff', border: '1px solid #D1D5DB', borderRadius: 6, color: '#666', fontSize: 14 }}>取消</button>
                <button type="button" onClick={() => { setCustomTime(customInput); setCustomOpen(false); }} style={{ flex: 1, padding: '12px', background: '#FA5151', color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 500 }}>确定</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
const modalCancelStyle = { padding: '8px 16px', borderRadius: 4, fontSize: 14, color: '#666666', background: '#fff', border: '1px solid ' + DIV, cursor: 'pointer' };
const modalSaveStyle = { padding: '8px 16px', borderRadius: 4, fontSize: 14, color: '#fff', background: BLUE, border: 'none', cursor: 'pointer' };

// 信息行（标签：内容 + 可选业务标签，复刻截图：标签前小图标 + 值容器 div + 内联标签）
function InfoRow({ label, value, tags, extra, icon, labelColor }) {
  const lc = labelColor || ICON_COLOR;
  const [tip, setTip] = useState(null);
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
            {tags.map((t, i) => (
              <span key={i} style={{ position: 'relative', display: 'inline-flex' }}
                onMouseEnter={() => t.tip && setTip(i)}
                onMouseLeave={() => setTip(null)}>
                <span style={{ padding: '2px 8px', borderRadius: 2, background: t.bg, color: t.fg, fontSize: 12, cursor: t.tip ? 'help' : 'default' }}>{t.t}</span>
                {tip === i && t.tip && (
                  <span style={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 6, background: '#222222', color: '#fff', fontSize: 12, padding: '6px 10px', borderRadius: 4, whiteSpace: 'nowrap', zIndex: 40, boxShadow: '0 2px 8px rgba(0,0,0,0.15)', pointerEvents: 'none' }}>{t.tip}</span>
                )}
              </span>
            ))}
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
