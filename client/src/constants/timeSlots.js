// 拍摄时间窗口 —— 全站统一的时间段数据源（B 端订单/档期 + C 端预约共用）
// 24 个整点小时（00:00 ~ 23:00），格式 HH:00，与 B 端新建订单、档期、订单详情的可选时间窗口完全一致。
// 禁止在页面内重复定义 HOURS，统一从这里 import，避免时区/格式/配置差异导致两端时间不一致。
export const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + ':00');

// 场次类型（半天/全天）—— 与 B 端新建订单的 PERIOD_OPTIONS 一致
export const PERIOD_OPTIONS = [
  { v: 'half', label: '半天' },
  { v: 'full', label: '全天' }
];
