// 数字处理工具
// safeNum: 把任何值归一化为数字（NaN/undefined/null/字符串都返回 0）
export const safeNum = (v) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};