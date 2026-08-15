// todo.js —— 独立待办系统核心逻辑（与订单业务状态解耦）
// 两类待办：
//   ① 阶段待办（订单当前所处阶段，订单状态流转时自动归档旧阶段+生成新阶段）
//   ② 事件待办（切换套系合同失效 / 客户提交改期取消申请 等一次性事件）
// 「标记完成」仅把待办归档（status=done），绝不改动订单业务状态。
import { query, get, run, insert } from './db.js';

const nowISO = () => new Date().toISOString();

// 阶段待办类型（与 Todo 页 Tab / stats.todo 口径一致）
const STAGE_TYPES = ['deposit', 'waiting_shoot', 'selecting', 'retouching', 'delivering'];

const STAGE_META = {
  deposit: { title: '已付定金待沟通', content: '客户已付定金，待沟通确认拍摄细节' },
  waiting_shoot: { title: '等待拍摄', content: '已确认拍摄细节，等待拍摄执行' },
  selecting: { title: '待选片', content: '客户待选片' },
  retouching: { title: '精修中', content: '底片已交付，精修进行中' },
  delivering: { title: '待交付', content: '精修完成，待交付成片' }
};

// 判断订单当前阶段（与 stats.js / OrderDetail buildSteps 口径一致；无待办阶段返回 null）
export function orderStage(o) {
  if (!o) return null;
  if (o.cancelled || o.is_deleted || o.status === 'cancelled') return null;
  if (o.status === 'delivered' || o.status === 'completed') return null;
  let logs = [];
  try { logs = Array.isArray(o.logs) ? o.logs : (typeof o.logs === 'string' ? JSON.parse(o.logs || '[]') : []); } catch { logs = []; }
  const hasLog = (re) => logs.some((l) => re.test((l && l.text) || ''));
  if (o.status === 'deposit') {
    return hasLog(/沟通确认|等待拍摄|拍摄执行/) ? 'waiting_shoot' : 'deposit';
  }
  if (o.status === 'shot' || o.status === 'selecting') return 'selecting';
  if (o.status === 'retouching') {
    return hasLog(/精修完成|全部精修完成|底片打包|原片打包/) ? 'delivering' : 'retouching';
  }
  return null;
}

// 同步订单阶段待办：归档旧阶段待办 + 生成/激活当前阶段待办（仅在订单「阶段」变化时调用）
export async function syncOrderTodos(orderId) {
  const o = await get('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!o) return;
  const stage = orderStage(o);
  const bizKey = stage ? `order_${orderId}_${stage}` : null;

  // 归档该订单所有 pending 阶段待办（流转到新阶段）
  const ph = STAGE_TYPES.map(() => '?').join(',');
  await run(`UPDATE todo_items SET status='done', done_at=? WHERE order_id=? AND todo_type IN (${ph}) AND status='pending'`,
    [nowISO(), orderId, ...STAGE_TYPES]);

  if (!stage) return;
  const meta = STAGE_META[stage];
  const exist = await get('SELECT id FROM todo_items WHERE biz_key = ?', [bizKey]);
  if (exist) {
    // 订单流转回该阶段：重新激活
    await run('UPDATE todo_items SET status = ?, done_at = NULL, title = ?, content = ? WHERE id = ?',
      ['pending', meta.title, meta.content, exist.id]);
  } else {
    await insert('INSERT INTO todo_items (order_id, todo_type, title, content, status, biz_key) VALUES (?,?,?,?,?,?)',
      [orderId, stage, meta.title, meta.content, 'pending', bizKey]);
  }
}

// 生成事件待办（一次性，biz_key 含 relId 去重）
export async function generateEventTodo(orderId, type, title, content, relId = '') {
  const bizKey = `order_${orderId}_${type}_${relId || Date.now()}`;
  const exist = await get('SELECT id FROM todo_items WHERE biz_key = ?', [bizKey]);
  if (exist) return exist.id;
  return await insert('INSERT INTO todo_items (order_id, todo_type, title, content, status, biz_key) VALUES (?,?,?,?,?,?)',
    [orderId, type, title, content, 'pending', bizKey]);
}

// 归档订单所有 pending 待办（订单作废/删除时）
export async function archiveOrderTodos(orderId) {
  await run("UPDATE todo_items SET status='done', done_at=? WHERE order_id=? AND status='pending'", [nowISO(), orderId]);
}

// 标记单条待办完成（仅归档，不改订单业务数据）
export async function markTodoDone(todoId) {
  const exist = await get('SELECT id FROM todo_items WHERE id = ?', [todoId]);
  if (!exist) return false;
  await run("UPDATE todo_items SET status='done', done_at=? WHERE id=? AND status='pending'", [nowISO(), todoId]);
  return true;
}

// 待办列表（pending 在前，done 归档在后）+ 按类型计数
export async function listTodos() {
  const items = await query('SELECT * FROM todo_items ORDER BY (status = \'pending\') DESC, id DESC');
  const counts = { pending: 0, done: 0 };
  for (const it of items) counts[it.status === 'pending' ? 'pending' : 'done']++;
  return { items, counts };
}
