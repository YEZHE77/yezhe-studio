// server/src/printOrder.js —— 订单「拍摄服务合同」PDF 服务端生成（1:1 复刻前端 .print-order-sheet 版式）
// 数据源唯一性：只信任 order_id，内容全部由服务端从数据库查询渲染（订单/套系快照/收款流水），不信任前端传入的任何内容。
// 渲染：puppeteer 无头 Chromium 打开服务端拼装的 HTML，page.pdf() 输出 A4 PDF。
// 字体：Render 基础镜像无中文字体，故把 Noto Sans SC 随仓库打包，渲染时复制到临时目录以 file:// 相对路径加载。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_PATH = path.join(__dirname, '..', 'fonts', 'NotoSansSC-Regular.otf');

const STATUS_LABEL = {
  deposit: '已付定金', shot: '已拍摄', selecting: '选片中',
  retouching: '精修中', delivered: '已交付', completed: '已完成', cancelled: '已作废'
};
const PAY_STATUS_LABEL = { unpaid: '未付定金', deposit: '已付定金', paid: '已付全款' };
const TYPE_LABEL = { deposit: '定金', balance: '尾款', extra: '加片/增值', refund: '退款' };
const CHANNEL_LABEL = { wechat: '微信', alipay: '支付宝', cash: '现金', bank: '银行转账', online: '线上' };

// —— 顾客服务协议 / 照片授权协议（复刻 client/src/utils/customerAgreement.js）——
const FIELD_SERVICE = 'customer_agreement';
const FIELD_PHOTO_AUTH = 'photo_authorization_agreement';

const DEFAULT_SERVICE_AGREEMENT = [
  '一、合同双方', '',
  '甲方（委托方）客户：客户信息', '',
  '乙方（服务方）：叶哲STUDIO团队',
  '联系方式：18976896154', '',
  '二、服务内容', '',
  '拍摄项目：套系详情',
  '特别说明：赠送婚礼预告服务，预告张数纳入套餐正片精修图计算；自选精修片请提前告知摄影师（自选精修片则无婚礼预告片服务）。', '',
  '三、服务费用及支付方式',
  '1. 总费用、定金、尾款均以订单为准。',
  '2. 跟拍尾款：婚礼结束后 24 小时内结清。',
  '3. 异地费用：海口市区外拍摄需承担摄影师住宿费及路费（实报实销）。', '',
  '四、双方权利与义务',
  '1. 摄影师责任：按约定时间、地点完成当天拍摄；提供底片及精修服务；确保成片按时交付。',
  '2. 客户责任：提前告知婚礼流程及特殊需求；配合拍摄并按时支付费用；自选精修片需提前书面说明。', '',
  '五、违约责任',
  '1. 客户违约：未按时支付尾款，婚礼结束后不提供婚礼相关的照片；单方面取消服务，定金不退（政府管控原因导致的婚礼取消或延迟除外）。',
  '2. 摄影师违约：因非不可抗力未能履行合同，全额退款；照片丢失，协商补救或部分退款。'
].join('\n');

const DEFAULT_PHOTO_AUTH_AGREEMENT = [
  '婚礼肖像授权', '',
  '尊敬的甲方，感谢您选择我们为您记录人生中最重要的时刻。为便于我们更好地展示创作成果、进行品牌宣传与服务更多新人，特拟定本授权协议。我们郑重承诺，将始终尊重并保护您的隐私。', '',
  '一、授权作品内容',
  '本协议所指授权作品，为乙方在婚礼现场为甲方所拍摄并精修制作的全部影像作品（包括但不限于静态照片及动态视频）。', '',
  '二、授权使用范围',
  '甲方在此不可撤销地授权乙方，在遵守本协议条款的前提下，在全球范围内永久免费使用上述授权作品，用于以下用途：',
  '1. 作品展示：在乙方的官方网站、博客、在线作品集等网络平台进行公开展示。',
  '2. 社交媒体宣传：在乙方的社交媒体平台（包括但不限于微信、微博、小红书、抖音、Instagram、Facebook 等）进行发布、分享及推广。',
  '3. 商业宣传：用于乙方的宣传图册、海报、线下展位、产品样书、作品集等宣传材料。',
  '4. 参赛与出版：参加各类摄影比赛、评选活动，或在专业摄影杂志、书籍、出版物中发表。',
  '5. 内部培训：作为乙方内部团队进行技术交流、教学与培训的案例素材。', '',
  '三、甲方权利与承诺',
  '1. 甲方确认对授权作品拥有合法的肖像权，并保证授权使用不侵犯任何第三方的合法权益。',
  '2. 甲方同意乙方在使用授权作品时，可对作品进行必要的技术处理（如色彩微调、添加水印或 Logo 等），以保持作品风格或用于品牌识别，但不得进行恶意扭曲或丑化。',
  '3. 本授权为非排他性授权，即甲方仍可自行使用或将作品授权予其他方使用。', '',
  '四、乙方义务与承诺',
  '1. 乙方承诺对所有授权作品的使用均出于艺术展示和品牌宣传之目的，不会将原片用于任何恶意、诽谤、淫秽或不道德的用途。',
  '2. 乙方在使用作品时，将秉持专业和审美的态度，维护甲方婚礼的美好形象。',
  '3. 如甲方有特殊要求（例如，某些特定场景或亲友的照片不希望被公开），可与摄影师联系告知列出，乙方将予以充分尊重并遵守。', '',
  '五、授权撤销',
  '甲方有权随时以书面形式（如微信、邮件、正式信函）通知乙方，要求停止使用包含其肖像的特定作品或全部作品。乙方在收到通知后，应在 15 个工作日内从其完全控制的公开渠道撤下该作品。但对于在通知前已公开发布、转载或用于参赛的素材，乙方将尽力处理，但不承担第三方转载所带来的连带责任。'
].join('\n');

function getServiceAgreement(d) {
  return (d && typeof d[FIELD_SERVICE] === 'string' && d[FIELD_SERVICE].trim()) ? d[FIELD_SERVICE] : DEFAULT_SERVICE_AGREEMENT;
}
function getPhotoAuthAgreement(d) {
  return (d && typeof d[FIELD_PHOTO_AUTH] === 'string' && d[FIELD_PHOTO_AUTH].trim()) ? d[FIELD_PHOTO_AUTH] : DEFAULT_PHOTO_AUTH_AGREEMENT;
}
function toParagraphs(text) {
  return (text || '').split('\n').map((s) => s.trim()).filter(Boolean);
}

// —— 退订政策（复刻 client/src/utils/refundPolicy.js）——
const FIELD_LAX = 'refund_policy_lax_text';
const FIELD_STRICT = 'refund_policy_strict_text';
const OFFICIAL_POLICY = [
  '退订、改期与违约责任',
  '1. 定金履约规则：客户支付定金后正式锁定当日摄影师档期，若甲方单方面主动取消婚礼拍摄，定金不予退还；仅因疫情管控、政府限制、重大自然灾害等不可抗力导致婚礼无法举办，可免费协商改期，定金保留有效。',
  '2. 尾款交付约束：婚礼拍摄结束24小时内甲方需结清全部尾款，逾期未结清的，乙方有权暂停交付底片、精修、婚礼预告、电子相册等全部影像素材，直至全款结清。',
  '3. 临时缺席处理：婚礼当日甲方无故不到场、临时放弃拍摄，属于甲方单方违约，所有已支付定金、拍摄费用不予退还。',
  '4. 改期规则：甲方如需变更拍摄日期，需提前与乙方沟通确认，仅摄影师存在空余档期时可重新安排，无强制免费改期次数，改期产生的异地差旅等额外费用由甲方承担。',
  '5. 乙方违约处理：摄影师无不可抗力因素无法到场完成拍摄，全额退还客户已支付定金、尾款全部费用；若因设备、存储问题造成影像素材丢失，双方友好协商退款补偿，补偿上限为本订单总服务金额。',
  '6. 争议处理：因取消、改期、退款产生纠纷，双方优先协商，协商不成向乙方所在地人民法院提起诉讼。'
].join('\n');
const POLICY_TEXTS = { '宽松': OFFICIAL_POLICY, '严格': OFFICIAL_POLICY };

function normalizePolicy(v) {
  return v === '宽松' ? '宽松' : '严格';
}
function getRefundText(d, policy) {
  const key = policy === '宽松' ? FIELD_LAX : FIELD_STRICT;
  return (d && typeof d[key] === 'string' && d[key].trim()) ? d[key] : POLICY_TEXTS[policy];
}
function getRefundParagraphs(d, policy) {
  return getRefundText(d, policy).split('\n').map((s) => s.trim()).filter(Boolean);
}

// 服务详情默认模板（复刻 client/src/utils/serviceDetail.js）
const DEFAULT_SERVICE_DETAIL = [
  '甲方委托乙方于甲方婚礼当天，提供婚礼摄影服务。', '',
  '- 拍摄时间范围：本着诚实、信用、热情服务和尊重甲方意愿的原则为甲方提供婚礼纪实摄影拍摄服务，以新娘早妆为开始，晚宴仪式为结束。', '',
  '注意⚠：赠送婚礼预告服务（1-7 天内交付），预告张数纳入套餐正片精修图计算；若自选精修片，请提前告知摄影师。如自选精修片，则无婚礼预告片服务。'
].join('\n');

// —— 工具 ——
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function money(v) {
  return Number(v) > 0 ? '¥' + Number(v).toLocaleString('zh-CN') : '—';
}
function fmtDate(v) {
  if (!v) return '—';
  try { return new Date(v).toLocaleString('zh-CN'); } catch { return '—'; }
}
function payMethodLabel(p) {
  if (!p) return '—';
  if (p.method === 'online') return '线上';
  return '线下·' + (CHANNEL_LABEL[p.channel] || '其他');
}
function paraHtml(paras, mode) {
  // mode: 'indent'（首行缩进）/ 'mixed'（标题段不缩进 + 缩进段）
  if (mode === 'mixed') {
    return paras.map((p) => {
      const isHeading = /^[一二三四五六七八九十]+、/.test(p);
      return `<div style="margin-top:${isHeading ? 8 : 0}px; margin-bottom:4px; font-weight:400; text-indent:${isHeading ? 0 : '2em'};">${esc(p)}</div>`;
    }).join('');
  }
  return paras.map((p, i) =>
    `<div style="margin-bottom:${i < paras.length - 1 ? 6 : 0}px; font-weight:400; text-indent:2em;">${esc(p)}</div>`
  ).join('');
}

// —— 构建打印模板变量（复刻 OrderDetail.jsx 打印区块计算逻辑）——
export function buildOrderPrintVars(order, payments, livePkg) {
  const snap = (order && order.package_snapshot && typeof order.package_snapshot === 'object') ? order.package_snapshot : {};
  const live = livePkg || {};
  const liveDetails = (live.details && typeof live.details === 'object' && !Array.isArray(live.details)) ? live.details : {};
  const snapDetails = (snap.details && typeof snap.details === 'object' && !Array.isArray(snap.details)) ? snap.details : {};
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  // details：快照胜出，缺失 key 用实时套系兜底（与前端一致）
  const details = { ...obj(liveDetails), ...obj(snapDetails) };
  const hasSnap = !!(snap && (snap.id || snap.name));
  const pkgInfo = {
    fromSnapshot: hasSnap,
    details,
    name: snap.name || live.name || '—'
  };

  const total = Number(order.total_amount || 0);
  const paid = Number(order.paid_amount || 0);
  const remain = total - paid;

  let phones = [];
  try { phones = Array.isArray(order.phones) ? order.phones : JSON.parse(order.phones || '[]'); } catch { phones = []; }
  const phoneList = phones.length ? phones : (order.customer_phone ? [order.customer_phone] : []);

  const payKey = order.payment_status || 'deposit';
  const phaseLabel =
    order.status === 'cancelled' ? '已作废'
      : order.status === 'completed' ? '已完成'
        : order.status === 'delivered' ? '已交付'
          : (STATUS_LABEL[order.status] || '');
  const statusText =
    (order.payment_status === 'unpaid' ? '未付定金' : (PAY_STATUS_LABEL[payKey] || '')) +
    (phaseLabel && order.status && order.status !== order.payment_status ? '，' + phaseLabel : '');

  const custName = ([order.groom_name, order.bride_name].filter(Boolean).join(' & ') || order.customer_name || '—');
  const groomPrintName = (order.groom_name || '').trim() || String(custName).split(/\s*[&＆，,]\s*/)[0] || '';
  const bridePrintName = (order.bride_name || '').trim() || String(custName).split(/\s*[&＆，,]\s*/).slice(1).join(' ') || '';

  let execs = [];
  try { execs = Array.isArray(order.executors) ? order.executors : JSON.parse(order.executors || '[]'); } catch { execs = []; }
  const execNames = execs.map((x) => (x && x.name) || '').filter(Boolean).join('、');
  const photographer = execNames || order.executor || '—';

  return {
    order_no: order.order_no,
    created: fmtDate(order.created_at),
    statusText,
    custName,
    phoneList: phoneList.join(' / ') || '—',
    groomPrintName: groomPrintName || '—',
    bridePrintName: bridePrintName || '—',
    shootDate: order.shoot_date || (Number(order.date_tbd) === 1 ? '待定' : '—'),
    photographer,
    address: order.address || '—',
    pkgInfo,
    shoot_position: order.shoot_position || '—',
    quick_repair_cost: Number(order.quick_repair_cost) > 0 ? money(order.quick_repair_cost) : (details.quick_repair_cost || '—'),
    shootCost: Number(order.shoot_cost) || 0,
    deposit: Number(order.deposit) || 0,
    total,
    paid,
    remain,
    payLabel: PAY_STATUS_LABEL[payKey] || payKey,
    payments,
    serviceDetail: (details.service_detail_text || '').trim() || DEFAULT_SERVICE_DETAIL,
    agreementParas: toParagraphs(getServiceAgreement(details)),
    photoAuthParas: toParagraphs(getPhotoAuthAgreement(details)),
    refundPolicy: normalizePolicy(details.refund_policy),
    refundParas: getRefundParagraphs(details, normalizePolicy(details.refund_policy)),
    remark: order.remark || '',
    internalRemark: order.internal_remark || '',
    printTime: new Date().toLocaleString('zh-CN')
  };
}

// —— 1:1 复刻前端 .print-order-sheet 的 HTML ——
export function renderOrderPrintHtml(vars, includeInternal) {
  const { pkgInfo } = vars;
  const d = pkgInfo.details;
  const rawCount = d.raw_count ? `${d.raw_count} 张` : '—';
  const retouch = d.retouch_count ? `${d.retouch_count} 张` : '—';
  const clothMakeup = `${d.cloth_provide === 'provide' ? '提供服装' : '不提供服装'} · ${d.makeup_provide === 'provide' ? '提供化妆' : '不提供化妆'}`;
  const album = d.album_provide === 'provide' ? '是' : (d.album_provide === 'extra' ? '相册另购' : '否');

  const paymentRows = (vars.payments || []).map((p) => `
        <tr>
          <td style="padding:10px 12px; border:1px solid #ddd; text-align:center;">${esc(TYPE_LABEL[p.type] || p.type)}</td>
          <td style="padding:10px 12px; border:1px solid #ddd; text-align:center;">${p.type === 'refund' ? '-' : '+'}¥${Number(p.amount).toLocaleString('zh-CN')}</td>
          <td style="padding:10px 12px; border:1px solid #ddd; text-align:center;">${esc(payMethodLabel(p))}</td>
        </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  @page { size: A4; margin: 0; }
  @font-face {
    font-family: 'YezheCJK';
    src: url('yezhe-cjk.otf') format('opentype');
    font-weight: normal;
    font-display: block;
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0; background: #fff; font-family: 'YezheCJK', SimSun, "Noto Sans CJK SC", "PingFang SC", serif; color: #222; }
  .print-order-sheet { width: 100%; max-width: 100%; margin: 0; padding: 0; }
  /* 页眉/页脚用 fixed 定位，Chromium 打印时会逐页重复，保证每一页都有页眉页脚（手机端/电脑端一致） */
  .print-header { position: fixed; top: 0; left: 0; right: 0; z-index: 10; background: #fff; text-align: center; padding: 10mm 12mm 6px; border-bottom: 1px solid #555; font-family: 'YezheCJK', SimSun, "Noto Sans CJK SC", serif; }
  .print-header-title { font-size: 22px; letter-spacing: 4px; color: #000; font-weight: 400; }
  .print-header-meta { font-size: 13px; margin-top: 6px; color: #555; font-weight: 400; }
  .print-header-meta2 { font-size: 12px; margin-top: 3px; color: #555; font-weight: 400; }
  .print-sheet-body { font-family: 'YezheCJK', SimSun, "Noto Sans CJK SC", serif; font-size: 14px; line-height: 1.8; color: #222; background: #fff; padding: 30mm 12mm 20mm; }
  .print-footer { position: fixed; bottom: 0; left: 0; right: 0; z-index: 10; background: #fff; display: flex; justify-content: space-between; align-items: center; padding: 6px 12mm 8mm; border-top: 1px solid #ccc; font-family: 'YezheCJK', SimSun, "Noto Sans CJK SC", serif; font-size: 12px; color: #999; font-weight: 400; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; line-height: 1.8; }
  td { padding: 4px 8px; }
</style>
</head>
<body>
  <div class="print-order-sheet">
    <div class="print-header">
      <div class="print-header-title">拍摄服务合同</div>
      <div class="print-header-meta">订单编号：${esc(vars.order_no)}</div>
      <div class="print-header-meta2">创建时间：${esc(vars.created)}　·　订单状态：${esc(vars.statusText)}</div>
    </div>
    <div class="print-sheet-body">
      <div style="margin-bottom:12px;">
        <div style="font-size:16px; font-weight:400; padding-bottom:4px; margin-bottom:10px;">客户信息</div>
        <table>
          <tbody>
            <tr>
              <td style="width:100px; color:#555;">客户姓名</td>
              <td>${esc(vars.custName)}</td>
              <td style="width:80px; color:#555;">联系电话</td>
              <td>${esc(vars.phoneList)}</td>
            </tr>
            <tr>
              <td style="color:#555;">新郎</td>
              <td style="white-space:nowrap;">${esc(vars.groomPrintName)}</td>
              <td style="color:#555;">新娘</td>
              <td style="white-space:nowrap;">${esc(vars.bridePrintName)}</td>
            </tr>
            <tr>
              <td style="color:#555;">拍摄日期</td>
              <td>${esc(vars.shootDate)}</td>
              <td style="width:80px; color:#555;">摄影师</td>
              <td>${esc(vars.photographer)}</td>
            </tr>
            <tr>
              <td style="color:#555;">拍摄地址</td>
              <td colspan="3">${esc(vars.address)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style="margin-bottom:12px;">
        <div style="font-size:16px; font-weight:400; padding-bottom:4px; margin-bottom:10px;">套系详情</div>
        <table>
          <tbody>
            <tr>
              <td style="width:100px; color:#555;">套系名称</td>
              <td colspan="3">${esc(pkgInfo.name)}</td>
            </tr>
            <tr>
              <td style="color:#555;">机位</td>
              <td>${esc(vars.shoot_position)}</td>
              <td style="width:80px; color:#555;">原片</td>
              <td>${esc(rawCount)}</td>
            </tr>
            <tr>
              <td style="color:#555;">拍摄时长</td>
              <td>${esc(d.duration || '—')}</td>
              <td style="color:#555;">精修</td>
              <td>${esc(retouch)}</td>
            </tr>
            <tr>
              <td style="color:#555;">加片费</td>
              <td>${esc(d.extra_photo_fee || '—')}</td>
              <td style="color:#555;">快修费</td>
              <td>${esc(vars.quick_repair_cost)}</td>
            </tr>
            <tr>
              <td style="color:#555;">化妆服装</td>
              <td>${esc(clothMakeup)}</td>
              <td style="color:#555;">提供相册</td>
              <td>${esc(album)}</td>
            </tr>
            <tr>
              <td style="color:#555;">拍摄费</td>
              <td>${money(vars.shootCost)}</td>
              <td style="color:#555;">定金</td>
              <td>${money(vars.deposit)}</td>
            </tr>
            <tr>
              <td style="color:#555; vertical-align:top;">交付时间</td>
              <td colspan="3" style="white-space:pre-wrap; word-break:break-word; line-height:1.8;">${esc(d.delivery_time || '—')}</td>
            </tr>
            <tr>
              <td style="color:#555; vertical-align:top;">交付备注</td>
              <td colspan="3" style="white-space:pre-wrap; word-break:break-word; line-height:1.8;">${esc(d.delivery_remark || '—')}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style="margin-bottom:12px;">
        <div style="font-size:16px; font-weight:400; padding-bottom:4px; margin-bottom:10px;">收款信息</div>
        <table>
          <tbody>
            <tr>
              <td style="width:100px; color:#555;">应收总额</td>
              <td style="font-weight:400;">${money(vars.total)}</td>
              <td style="width:80px; color:#555;">已收金额</td>
              <td style="color:#10b981; font-weight:400;">${money(vars.paid)}</td>
            </tr>
            <tr>
              <td style="color:#555;">待收余额</td>
              <td style="color:${vars.remain > 0 ? '#ef4444' : '#10b981'};">${money(Math.max(0, vars.remain))}</td>
              <td style="color:#555;">付款状态</td>
              <td>${esc(vars.payLabel)}</td>
            </tr>
          </tbody>
        </table>
        ${(vars.payments || []).length > 0 ? `
        <div style="margin-top:12px;">
          <div style="font-size:14px; color:#555; margin-bottom:6px;">收款明细</div>
          <table style="border:1px solid #ddd;">
            <thead>
              <tr style="background:#f5f5f5;">
                <th style="padding:10px 12px; border:1px solid #ddd; text-align:center; font-weight:400;">类型</th>
                <th style="padding:10px 12px; border:1px solid #ddd; text-align:center; font-weight:400;">金额</th>
                <th style="padding:10px 12px; border:1px solid #ddd; text-align:center; font-weight:400;">方式</th>
              </tr>
            </thead>
            <tbody>${paymentRows}</tbody>
          </table>
        </div>` : ''}
      </div>

      <div style="margin-bottom:12px;">
        <div style="font-size:16px; font-weight:400; padding-bottom:4px; margin-bottom:12px;">服务详情</div>
        <div style="font-size:14px; line-height:1.8; color:#222; white-space:pre-wrap; text-indent:2em;">${esc(vars.serviceDetail)}</div>
      </div>

      ${vars.agreementParas.length ? `
      <div style="margin-bottom:12px;">
        <div style="font-size:16px; font-weight:400; padding-bottom:4px; margin-bottom:12px;">顾客服务协议</div>
        <div style="font-size:14px; line-height:1.8; color:#222;">${paraHtml(vars.agreementParas, 'mixed')}</div>
      </div>` : ''}

      ${vars.photoAuthParas.length ? `
      <div style="margin-bottom:12px;">
        <div style="font-size:16px; font-weight:400; padding-bottom:4px; margin-bottom:12px;">顾客照片授权协议</div>
        <div style="font-size:14px; line-height:1.8; color:#222;">${paraHtml(vars.photoAuthParas, 'mixed')}</div>
      </div>` : ''}

      ${vars.refundParas.length ? `
      <div style="margin-bottom:12px;">
        <div style="font-size:16px; font-weight:400; padding-bottom:4px; margin-bottom:12px;">退订政策（${esc(vars.refundPolicy)}）</div>
        <div style="font-size:14px; line-height:1.8; color:#222;">${paraHtml(vars.refundParas, 'indent')}</div>
      </div>` : ''}

      ${vars.remark ? `
      <div style="margin-bottom:12px;">
        <div style="font-size:16px; font-weight:400; padding-bottom:4px; margin-bottom:12px;">客户备注</div>
        <div style="font-size:14px; line-height:1.8; color:#222; white-space:pre-wrap; text-indent:2em;">${esc(vars.remark)}</div>
      </div>` : ''}

      ${includeInternal && vars.internalRemark ? `
      <div style="margin-bottom:12px;">
        <div style="font-size:16px; font-weight:400; padding-bottom:4px; margin-bottom:12px;">商家内部备注</div>
        <div style="font-size:14px; line-height:1.8; color:#222; white-space:pre-wrap; text-indent:2em;">${esc(vars.internalRemark)}</div>
      </div>` : ''}
    </div>
    <div class="print-footer">
      <span>叶哲 STUDIO · 摄影工作室管理系统</span>
      <span>打印时间：${esc(vars.printTime)}</span>
    </div>
  </div>
</body>
</html>`;
  return html;
}

// —— puppeteer 渲染 PDF ——
let _browserPromise = null;
async function getBrowser() {
  if (!_browserPromise) {
    const isRender = !!process.env.RENDER;
    const isLinux = process.platform === 'linux';
    if (isRender || isLinux) {
      // Render 等 Linux 容器缺少 puppeteer 自带 Chromium 的系统依赖（libnss3 等），
      // 使用 @sparticuz/chromium（为 serverless/容器预编译，依赖自包含）
      _browserPromise = (async () => {
        const [{ default: puppeteerCore }, { default: chromium }] = await Promise.all([
          import('puppeteer-core'),
          import('@sparticuz/chromium')
        ]);
        const executablePath = await chromium.executablePath();
        return puppeteerCore.launch({
          args: [...chromium.args, '--disable-dev-shm-usage'],
          executablePath,
          headless: chromium.headless
        });
      })().catch((e) => { _browserPromise = null; throw e; });
    } else {
      // 本地 macOS/Windows：继续用 puppeteer 下载的 Chromium
      _browserPromise = (async () => {
        const { default: puppeteer } = await import('puppeteer');
        return puppeteer.launch({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--font-render-hinting=none'
          ]
        });
      })().catch((e) => { _browserPromise = null; throw e; });
    }
  }
  return _browserPromise;
}

export async function generateOrderPdf(html) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  // 渲染为临时 HTML 文件，并把中文字体放到同目录，以 file:// 相对路径加载
  // （Render 基础镜像无 CJK 字体，直接渲染会出豆腐块）
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yezhe-pdf-'));
  const htmlPath = path.join(tmpDir, 'index.html');
  const fontPath = path.join(tmpDir, 'yezhe-cjk.otf');
  try {
    fs.writeFileSync(htmlPath, html, 'utf8');
    try { fs.copyFileSync(FONT_PATH, fontPath); } catch (_) { /* 字体缺失则回退系统字体 */ }
    await page.goto('file://' + htmlPath, { waitUntil: 'load', timeout: 60000 });
    try { await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve())); } catch (_) {}
    const buf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' }
    });
    return buf;
  } finally {
    await page.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}
