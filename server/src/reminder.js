// reminder.js —— 移动端业务消息的定时提醒扫描
// 每日扫描两类「临近」事件，生成 biz_message（与待办/消息中心独立，异步生成失败不阻塞）：
//   ① 选片任务即将到期：order_select_task.expire_at 在未来 24h 内且任务进行中
//   ② 摄影日程即将到来：schedules.date 为今天或明天且 status=booked
// 去重：同一 biz_type + biz_id 只生成一次（避免每日重复提醒）
import { query, get } from './db.js';
import { emitBizToStaff, BIZ_TYPE } from './routes/mobileMessage.js';

const DAY = 24 * 60 * 60 * 1000;

// 该 biz_type + biz_id 是否已生成过提醒
async function alreadyNotified(biz_type, biz_id) {
  if (biz_id == null) return false;
  const r = await get('SELECT id FROM biz_message WHERE biz_type = ? AND biz_id = ? LIMIT 1', [biz_type, String(biz_id)]);
  return !!r;
}

// ① 选片任务即将到期
async function scanSelectionExpiry() {
  const now = Date.now();
  const windowEnd = new Date(now + DAY).toISOString();
  // expire_at 是 TEXT（ISO 或 'YYYY-MM-DD'），仅取有值且未过期的进行中任务
  const tasks = await query(
    "SELECT id, order_id, expire_at FROM order_select_task WHERE status IN ('selecting','pending_payment') AND expire_at IS NOT NULL AND expire_at != ''"
  );
  let count = 0;
  for (const t of tasks) {
    const exp = new Date(t.expire_at).getTime();
    if (isNaN(exp)) continue;
    if (exp <= now || exp > now + DAY) continue; // 已过期或超过 24h 窗口
    if (await alreadyNotified(BIZ_TYPE.SELECT_PHOTO, t.id)) continue;
    const o = await get('SELECT order_no, customer_name FROM orders WHERE id = ?', [t.order_id]);
    await emitBizToStaff({
      title: '选片任务即将到期',
      content: `订单 ${(o && o.order_no) || t.order_id}（${(o && o.customer_name) || '客户'}）的选片任务即将到期，请提醒客户尽快完成选片`,
      biz_type: BIZ_TYPE.SELECT_PHOTO, biz_id: t.id,
      biz_extra: JSON.stringify({ orderId: t.order_id })
    });
    count++;
  }
  return count;
}

// ② 摄影日程即将到来
async function scanScheduleReminder() {
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  const tomorrow = new Date(now.getTime() + DAY);
  const tomorrowStr = `${tomorrow.getFullYear()}-${p(tomorrow.getMonth() + 1)}-${p(tomorrow.getDate())}`;
  const rows = await query(
    "SELECT id, date, order_no, groom_name, bride_name FROM schedules WHERE status = 'booked' AND date IN (?, ?)",
    [today, tomorrowStr]
  );
  let count = 0;
  for (const s of rows) {
    if (await alreadyNotified(BIZ_TYPE.SCHEDULE, s.id)) continue;
    const name = (s.groom_name && s.bride_name) ? `${s.groom_name} & ${s.bride_name}` : (s.order_no || '客户');
    await emitBizToStaff({
      title: '摄影日程即将到来',
      content: `摄影日程「${name}」于 ${s.date} 进行，请提前做好准备`,
      biz_type: BIZ_TYPE.SCHEDULE, biz_id: s.id
    });
    count++;
  }
  return count;
}

// ③ 文件到期清理提醒（sub_type=file_expire；仅生成提醒，不删原图——删除逻辑后续单独排期）
async function scanFileExpiry() {
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  const rows = await query(
    "SELECT id, order_no, customer_name, retouch_expire_at FROM orders WHERE retouch_expire_at IS NOT NULL AND retouch_expire_at != '' AND retouch_expire_at <= ? AND cancelled = 0 AND is_deleted = 0",
    [today]
  );
  let count = 0;
  for (const o of rows) {
    // 去重：同订单只生成一次 file_expire 提醒（sub_type 维度，避免每日重复）
    const exist = await get('SELECT id FROM biz_message WHERE biz_type = ? AND sub_type = ? AND biz_id = ? LIMIT 1', [BIZ_TYPE.ORDER, 'file_expire', String(o.id)]);
    if (exist) continue;
    await emitBizToStaff({
      title: '文件保存期已到期',
      content: `订单 ${(o.order_no) || o.id}（${(o.customer_name) || '客户'}）的精修大图保存期已到，即将自动清理（缩略图保留），请及时下载存档`,
      biz_type: BIZ_TYPE.ORDER, biz_id: o.id, sub_type: 'file_expire',
      biz_extra: JSON.stringify({ orderId: o.id })
    });
    count++;
  }
  return count;
}

// 执行一次扫描（导出供手动触发/测试）
export async function runReminderScan() {
  try {
    const sel = await scanSelectionExpiry();
    const sch = await scanScheduleReminder();
    const fe = await scanFileExpiry();
    console.log(`[reminder] 扫描完成：选片到期 ${sel} 条，日程临近 ${sch} 条，文件到期 ${fe} 条`);
    return { selection: sel, schedule: sch, fileExpire: fe };
  } catch (e) { console.error('[reminder] 扫描失败：', e.message); return { selection: 0, schedule: 0, fileExpire: 0 }; }
}

// 定时调度：每日 08:00 执行（避开凌晨备份/巡检时段）
let _timer = null;
export function scheduleReminders() {
  if (_timer) return;
  const run = async () => { try { await runReminderScan(); } catch (e) { console.error('[reminder] 调度失败', e.message); } };
  const now = new Date();
  const next = new Date(now);
  next.setHours(8, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const delay = next - now;
  const ms = 24 * 60 * 60 * 1000;
  setTimeout(() => { run(); _timer = setInterval(run, ms); }, delay);
  console.log('[reminder] 已调度每日提醒扫描，首次于', next.toISOString());
}
