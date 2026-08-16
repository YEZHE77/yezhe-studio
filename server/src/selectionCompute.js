// selectionCompute.js —— 选片模块统一计算内核（单一数据源）
// 规则：精修总数、加选数量、加选总金额、三态统计等所有口径全部收敛到这里；
// 统计面板 / B 端监控 / 导出清单 / 支付金额 一律调用本模块，禁止在业务里重复写公式。
// 加片计费模型（简单线性）：加选数量 = max(0, 保留数 - 免费精修张数)；加选金额 = 加选数量 × 加片单价。

export const TASK_STATUS = {
  NOT_STARTED: 'not_started', // 未开启
  SELECTING: 'selecting',     // 选片中
  SUBMITTED: 'submitted',     // 已提交
  RESET: 'reset'              // 已重置
};

export const MARK_STATUS = {
  KEEP: 'keep',     // 保留
  REJECT: 'reject'  // 淘汰
};

export const PAY_STATUS = {
  UNPAID: 'unpaid', // 待支付
  PAID: 'paid'      // 已支付
};

// 加片计费：保留数超出免费额度部分按单价计费（线性，不设阶梯）
export function calcExtra(keepCount, minRetouch, extraPrice) {
  const keep = Math.max(0, parseInt(keepCount, 10) || 0);
  const min = Math.max(0, parseInt(minRetouch, 10) || 0);
  const price = Math.max(0, parseFloat(extraPrice) || 0);
  const extraCount = Math.max(0, keep - min);
  const extraFee = Math.round(extraCount * price * 100) / 100;
  return { extraCount, extraFee };
}

// 三态统计：保留 / 淘汰 / 未标记（未标记 = 总数 - 保留 - 淘汰）
export function calcStats(keepCount, rejectCount, totalPhotos) {
  const keep = Math.max(0, parseInt(keepCount, 10) || 0);
  const reject = Math.max(0, parseInt(rejectCount, 10) || 0);
  const total = Math.max(0, parseInt(totalPhotos, 10) || 0);
  const unmarked = Math.max(0, total - keep - reject);
  return { keep, reject, unmarked, total };
}

// 由 mark 行集合（[{status}]）汇总统计（未标记按总数-已标计算）
export function summarizeMarks(markRows, totalPhotos) {
  let keep = 0, reject = 0;
  for (const m of markRows || []) {
    if (m && m.status === MARK_STATUS.KEEP) keep++;
    else if (m && m.status === MARK_STATUS.REJECT) reject++;
  }
  return calcStats(keep, reject, totalPhotos);
}

// 完整选片汇总：三态统计 + 加片计费，一次算齐
export function selectionSummary(markRows, totalPhotos, minRetouch, extraPrice) {
  const stats = summarizeMarks(markRows, totalPhotos);
  const extra = calcExtra(stats.keep, minRetouch, extraPrice);
  return { stats, extra };
}

// 从文本解析加片单价（兼容 "70/张"、"¥70"、"70元" 等，返回数字）
export function parsePrice(raw) {
  if (raw == null || raw === '') return 0;
  if (typeof raw === 'number') return Math.max(0, raw);
  const m = String(raw).replace(/[,，¥￥\s]/g, '').match(/(\d+(?:\.\d+)?)/);
  return m ? Math.max(0, parseFloat(m[1])) : 0;
}
