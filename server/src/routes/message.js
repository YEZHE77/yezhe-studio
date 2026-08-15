// routes/message.js —— 消息中心（B 端管理员）
// system_message 表：customer_consult 顾客咨询 / order_msg 订单消息 / todo_alert 待办提醒 / system 系统通知
// 规则：business_event+rel_id 5 分钟内去重；点击单条已读；归档隐藏；永久保存；按 receiver_uid 统计未读红点；H5 仅预埋 can_wechat_push 不调推送。
import { Router } from 'express';
import { query, get, insert, run } from '../db.js';
import { authRequired } from '../auth.js';

const router = Router();
const DEDUP_WINDOW_MS = 5 * 60 * 1000;

// 取所有 B 端员工 uid（admin/photographer/finance），消息接收人
export async function staffUids() {
  const rows = await query("SELECT id FROM users WHERE role IN ('admin','photographer','finance')");
  return rows.map((r) => r.id);
}

// 消息触发（去重：business_event + rel_id，5 分钟内相同事件不重复生成）
// receiver_uid 为 null 时广播给全体 staff
export async function emitMessage({ receiver_uid = null, message_type, business_event, title, content, rel_id, rel_model, can_wechat_push = 0 }) {
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
    }
    return receivers.length;
  } catch (e) { console.error('[message] emit failed:', e.message); return null; }
}

// 广播给全体 staff 的便捷封装
export async function emitToStaff(opts) {
  return emitMessage({ ...opts, receiver_uid: null });
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
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 标记单条已读
router.post('/:id/read', authRequired, async (req, res) => {
  try {
    await run('UPDATE system_message SET is_read = 1, read_time = ? WHERE id = ?', [new Date().toISOString(), req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 归档 / 取消归档
router.post('/:id/archive', authRequired, async (req, res) => {
  try {
    const r = await get('SELECT is_archived FROM system_message WHERE id = ?', [req.params.id]);
    if (!r) return res.status(404).json({ error: '消息不存在' });
    const next = r.is_archived ? 0 : 1;
    await run('UPDATE system_message SET is_archived = ? WHERE id = ?', [next, req.params.id]);
    res.json({ ok: true, archived: !!next });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
