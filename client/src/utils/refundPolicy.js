// utils/refundPolicy.js —— 退订政策两档默认文案 + 编辑/预览帮手
// 预览页 + 编辑页共用，确保两端展示完全一致

// 字段名（后端 details JSON 里）
export const FIELD_LAX = 'refund_policy_lax_text';
export const FIELD_STRICT = 'refund_policy_strict_text';

// 两档退订政策的默认文案（写入数据库前的兜底，与截图 1/2 一致）
// 注意：保存为单字符串（用 \n 分段），方便 textarea 一段编辑
export const POLICY_TEXTS = {
  '宽松': [
    '约定服务开始前 14 天以上取消，退还所有费用，包括定金。',
    '约定服务开始前 14 天以内取消，定金将不可退还，但剩余部分费用将予以退还。',
    '任何时间段内，如因摄影师原因取消订单，将退还所有费用，包括定金。'
  ].join('\n'),
  '严格': [
    '预付定金是对双方履行协约的承诺',
    '如因客户原因，未按期履约，并未同摄影师协商，定金将不可退还，但剩余部分费用将予以退还。',
    '如因摄影师原因取消订单，将退还所有费用，包括定金。'
  ].join('\n')
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

// 取首段（首句摘要）用于套系预览底部紧凑展示
export function getRefundSummary(d, policy) {
  const text = getRefundText(d, policy);
  const first = text.split('\n').map((s) => s.trim()).filter(Boolean)[0];
  return first || '';
}

// 把多行文案拆成段落数组用于渲染
export function getRefundParagraphs(d, policy) {
  const text = getRefundText(d, policy);
  return text.split('\n').map((s) => s.trim()).filter(Boolean);
}
