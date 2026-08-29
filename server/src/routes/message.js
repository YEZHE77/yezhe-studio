// routes/message.js —— 消息中心（B 端管理员）
// system_message 表：customer_consult 顾客咨询 / order_msg 订单消息 / todo_alert 待办提醒 / system 系统通知
// 规则：business_event+rel_id 5 分钟内去重；点击单条已读；归档隐藏；永久保存；按 receiver_uid 统计未读红点；H5 仅预埋 can_wechat_push 不调推送。
import { Router } from 'express';
import { query, get, insert, run, dialect } from '../db.js';
import { authRequired } from '../auth.js';
import { serverError } from '../httpError.js';
import { getConfig } from '../configStore.js';

const router = Router();
const DEDUP_WINDOW_MS = 5 * 60 * 1000;

// business_event → biz_message.biz_type 映射（emitMessage 双写移动端消息中心时用）
// select_* 由 selection.js 手动 emitBizToStaff（biz_id=task_id）避免重复，这里不映射。
// customer_consult 的 business_event 是动态的（order_request_<id>），走 message_type 兜底映射。
const BIZ_TYPE_BY_EVENT = {
  order_created: 'order',
  order_status: 'order',
  agreement_signed: 'order',
  contract_generated: 'order',
  contract_updated: 'order',
  package_view: 'system',
  contract_invalidated: 'system'
};
// message_type → biz_type 兜底（customer_consult 动态 event、todo_alert 归为 system）
const BIZ_TYPE_BY_MSG_TYPE = {
  customer_consult: 'customer_consult',
  todo_alert: 'system'
};

// 取所有 B 端员工 uid（admin/photographer/finance），消息接收人
export async function staffUids() {
  const rows = await query("SELECT id FROM users WHERE role IN ('admin','photographer','finance')");
  return rows.map((r) => r.id);
}

// 消息触发（去重：business_event + rel_id，5 分钟内相同事件不重复生成）
// receiver_uid 为 null 时广播给全体 staff
export async function emitMessage({ receiver_uid = null, message_type, business_event, title, content, rel_id, rel_model, can_wechat_push = 0, sub_type = null }) {
  try {
    if (business_event && rel_id != null && rel_id !== '') {
      const recent = await get(
        'SELECT id FROM system_message WHERE business_event = ? AND rel_id = ? AND create_time >= ? ORDER BY id DESC LIMIT 1',
        [business_event, String(rel_id), new Date(Date.now() - DEDUP_WINDOW_MS).toISOString()]
      );
      if (recent) return null; // 5 分钟内已生成过，去重
    }
    const receivers = receiver_uid != null ? [receiver_uid] : await staffUids();
    for (const uid of receivers) {
      await insert(
        'INSERT INTO system_message (receiver_uid, message_type, business_event, title, content, rel_id, rel_model, can_wechat_push) VALUES (?,?,?,?,?,?,?,?)',
        [uid, message_type, business_event || null, title || '', content || '', rel_id != null ? String(rel_id) : null, rel_model || null, can_wechat_push ? 1 : 0]
      );
      // 双写 biz_message（移动端消息中心，PC 端也已改读 biz_message）：按 business_event 精确映射，message_type 兜底
      const bizType = BIZ_TYPE_BY_EVENT[business_event || ''] || BIZ_TYPE_BY_MSG_TYPE[message_type || ''];
      if (bizType && rel_id != null && rel_id !== '') {
        try {
          await insert(
            'INSERT INTO biz_message (user_id, title, content, biz_type, biz_id, sub_type) VALUES (?,?,?,?,?,?)',
            [uid, title || '', content || '', bizType, String(rel_id), sub_type || null]
          );
        } catch (e) { console.error('[message] biz_message 双写失败：', e.message); }
      }
    }
    return receivers.length;
  } catch (e) { console.error('[message] emit failed:', e.message); return null; }
}

// 广播给全体 staff 的便捷封装
export async function emitToStaff(opts) {
  return emitMessage({ ...opts, receiver_uid: null });
}

// 消息保留周期策略（P1 #11）：已读且未归档的消息超过 N 天自动清理，避免无限堆积。
// 归档（用户主动保留）与未读（待处理）消息永不自动删除。默认 180 天，可在 system_config 配置。
export async function getRetentionDays() {
  const v = await getConfig('msg_retention_days', '180');
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 180;
}

export async function cleanupOldMessages(days) {
  const n = Number.isFinite(days) ? days : await getRetentionDays();
  if (!n || n <= 0) return { enabled: false, days: 0, system: 0, biz: 0 };
  const cutSys = dialect === 'pg'
    ? `create_time < now() - interval '${n} days'`
    : `create_time < datetime('now', '-${n} days')`;
  const cutBiz = dialect === 'pg'
    ? `created_at < now() - interval '${n} days'`
    : `created_at < datetime('now', '-${n} days')`;
  const delSys = await query(
    `DELETE FROM system_message WHERE is_read = 1 AND is_archived = 0 AND ${cutSys} RETURNING id`
  );
  const delBiz = await query(
    `DELETE FROM biz_message WHERE is_read = 1 AND is_archived = 0 AND ${cutBiz} RETURNING id`
  );
  return { enabled: true, days: n, system: delSys.length, biz: delBiz.length };
}

// B 端：消息列表（当前用户，可按 type 筛选、含归档开关）
router.get('/', authRequired, async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    const { type, archived } = req.query;
    const where = ['(receiver_uid IS NULL OR receiver_uid = ?)'];
    const params = [uid];
    if (archived === '1') where.push('is_archived = 1');
    else where.push('is_archived = 0');
    if (type) { where.push('message_type = ?'); params.push(type); }
    const rows = await query(
      `SELECT * FROM system_message WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (e) { serverError(res, e); }
});

// B 端：未读统计（红点角标，多设备同步）
router.get('/unread-count', authRequired, async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    const r = await get(
      'SELECT COUNT(*) AS c FROM system_message WHERE (receiver_uid IS NULL OR receiver_uid = ?) AND is_read = 0 AND is_archived = 0',
      [uid]
    );
    res.json({ count: Number(r.c) || 0 });
  } catch (e) { serverError(res, e); }
});

// 标记单条已读
router.post('/:id/read', authRequired, async (req, res) => {
  try {
    await run('UPDATE system_message SET is_read = 1, read_time = ? WHERE id = ?', [new Date().toISOString(), req.params.id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// 归档 / 取消归档
router.post('/:id/archive', authRequired, async (req, res) => {
  try {
    const r = await get('SELECT is_archived FROM system_message WHERE id = ?', [req.params.id]);
    if (!r) return res.status(404).json({ error: '消息不存在' });
    const next = r.is_archived ? 0 : 1;
    await run('UPDATE system_message SET is_archived = ? WHERE id = ?', [next, req.params.id]);
    res.json({ ok: true, archived: !!next });
  } catch (e) { serverError(res, e); }
});

export default router;
