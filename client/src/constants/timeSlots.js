// 拍摄时间窗口 —— 全站统一的时间段数据源（B 端订单/档期 + C 端预约共用）
// 24 个整点小时（00:00 ~ 23:00），格式 HH:00，与 B 端新建订单、档期、订单详情的可选时间窗口完全一致。
// 禁止在页面内重复定义 HOURS，统一从这里 import，避免时区/格式/配置差异导致两端时间不一致。
export const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + ':00');

// 场次类型（半天/全天）—— 全站唯一数据源，禁止在页面内重复定义。
// 存储/传输一律用 code（'half'/'full'），显示时经 PERIOD_LABEL / periodLabel() 映射为中文。
// B 端 schedules.period / orders 时段、C 端 reservations.expect_time 的场次取值均遵循此约定。
export const PERIOD_OPTIONS = [
  { v: 'half', label: '半天' },
  { v: 'full', label: '全天' }
];

export const PERIOD_LABEL = { half: '半天', full: '全天' };

// 显示映射：code → 中文；已传中文（历史数据/展示文案）原样返回；其他（如 HH:00 具体时间）原样返回。
export function periodLabel(v) {
  if (v == null || v === '') return v;
  return PERIOD_LABEL[v] || v;
}
