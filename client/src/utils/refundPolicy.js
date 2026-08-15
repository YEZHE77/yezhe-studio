// utils/refundPolicy.js —— 退订政策两档默认文案 + 编辑/预览帮手
// 预览页 + 编辑页共用，确保两端展示完全一致

// 字段名（后端 details JSON 里）
export const FIELD_LAX = 'refund_policy_lax_text';
export const FIELD_STRICT = 'refund_policy_strict_text';

// 两档退订政策的默认文案（写入数据库前的兜底）
// 注意：保存为单字符串（用 \n 分段），方便 textarea 一段编辑
// 叶哲工作室官方退订、改期与违约责任模板（2026-08-15 用户提供，宽松/严格两档统一）
const OFFICIAL_POLICY = [
  '退订、改期与违约责任',
  '1. 定金履约规则：客户支付定金后正式锁定当日摄影师档期，若甲方单方面主动取消婚礼拍摄，定金不予退还；仅因疫情管控、政府限制、重大自然灾害等不可抗力导致婚礼无法举办，可免费协商改期，定金保留有效。',
  '2. 尾款交付约束：婚礼拍摄结束24小时内甲方需结清全部尾款，逾期未结清的，乙方有权暂停交付底片、精修、婚礼预告、电子相册等全部影像素材，直至全款结清。',
  '3. 临时缺席处理：婚礼当日甲方无故不到场、临时放弃拍摄，属于甲方单方违约，所有已支付定金、拍摄费用不予退还。',
  '4. 改期规则：甲方如需变更拍摄日期，需提前与乙方沟通确认，仅摄影师存在空余档期时可重新安排，无强制免费改期次数，改期产生的异地差旅等额外费用由甲方承担。',
  '5. 乙方违约处理：摄影师无不可抗力因素无法到场完成拍摄，全额退还客户已支付定金、尾款全部费用；若因设备、存储问题造成影像素材丢失，双方友好协商退款补偿，补偿上限为本订单总服务金额。',
  '6. 争议处理：因取消、改期、退款产生纠纷，双方优先协商，协商不成向乙方所在地人民法院提起诉讼。'
].join('\n');

export const POLICY_TEXTS = {
  '宽松': OFFICIAL_POLICY,
  '严格': OFFICIAL_POLICY
};

// 取合法政策类型（默认「严格」）
export function normalizePolicy(v) {
  return v === '宽松' ? '宽松' : '严格';
}

// 取得当前类型的文案（优先取详情字段，缺失则用默认）
export function getRefundText(d, policy) {
  const key = policy === '宽松' ? FIELD_LAX : FIELD_STRICT;
  return (d && typeof d[key] === 'string' && d[key].trim()) ? d[key] : POLICY_TEXTS[policy];
}

// 取首段（首句摘要）用于套系预览底部紧凑展示；跳过「退订、改期与违约责任」标题，取第一条编号规则
export function getRefundSummary(d, policy) {
  const text = getRefundText(d, policy);
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
  const firstRule = lines.find((s) => /^\d+\./.test(s)) || lines[0];
  return firstRule || '';
}

// 把多行文案拆成段落数组用于渲染
export function getRefundParagraphs(d, policy) {
  const text = getRefundText(d, policy);
  return text.split('\n').map((s) => s.trim()).filter(Boolean);
}
