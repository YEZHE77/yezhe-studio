// 订单状态 → 展示文案（与后端 stats/orders 的 todo 过滤口径一致）
const STATUS_LABEL = {
  deposit: '已付定金', shot: '已拍摄', selecting: '选片中',
  retouching: '精修中', delivered: '已交付', completed: '已完成', cancelled: '已关闭'
};

// deposit 状态细分：logs 含「沟通确认」=「等待拍摄」，否则 =「已付定金」
// retouching 状态细分：logs 含「精修完成/全部精修完成/底片打包/原片打包」=「待交付」，否则 =「精修中」
// 两段细分都与后端 stats/orders 的 waiting_shoot / todo_retouch / todo_deliver 过滤分界一致
export function stageLabel(o) {
  if (!o) return '历史订单';
  const s = o.status;
  if (s === 'deposit' || s === 'retouching') {
    let logsArr = [];
    try { logsArr = Array.isArray(o.logs) ? o.logs : (typeof o.logs === 'string' ? JSON.parse(o.logs || '[]') : []); } catch {}
    if (s === 'deposit') {
      const hasConfirm = logsArr.some((l) => (l && l.text || '').includes('沟通确认'));
      return hasConfirm ? '等待拍摄' : '已付定金';
    }
    // retouching + logs 已到「精修完成/底片打包」→ 归「待交付」（与后端 stats 口径一致）
    const hasFinish = logsArr.some((l) => (l && l.text || '').match(/精修完成|全部精修完成|底片打包|原片打包/));
    return hasFinish ? '待交付' : '精修中';
  }
  return STATUS_LABEL[s] || '历史订单';
}
