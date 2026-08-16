// routes/mobileMessage.js —— 移动端业务消息中心（B 端 H5）
// biz_message 表：user_id 账号隔离；biz_type 业务来源（select_photo/schedule/order/system）；biz_id 关联业务主键
// 与 system_message（PC 端旧消息）、todo_items（待办）完全独立；仅业务事件通知，非 IM
// 规则：列表不自动置已读（仅进详情页标记单条已读）；PC + H5 共用一套数据
import { Router } from 'express';
import { query, get, insert, run } from '../db.js';
import { authRequired } from '../auth.js';

const router = Router();

// 业务类型枚举（与架构文档一致）
export const BIZ_TYPE = {
  SELECT_PHOTO: 'select_photo',
  SCHEDULE: 'schedule',
  ORDER: 'order',
  SYSTEM: 'system'
};

// 取所有 B 端员工 uid（admin/photographer/finance/selector）
async function staffUids() {
  const rows = await query("SELECT id FROM users WHERE role IN ('admin','photographer','finance','selector')");
  return rows.map((r) => r.id);
}

// 异步消息生成：主业务成功后调用；user_id 为 null 时广播给全体 staff。
// 消息写入失败仅打日志，绝不回滚/阻塞主业务（附属异步逻辑）。
export async function emitBizMessage({ user_id = null, title, content = '', biz_type, biz_id = null }) {
  try {
    const receivers = user_id != null ? [user_id] : await staffUids();
    for (const uid of receivers) {
      await insert(
        'INSERT INTO biz_message (user_id, title, content, biz_type, biz_id) VALUES (?,?,?,?,?)',
        [uid, title || '', content || '', biz_type || BIZ_TYPE.SYSTEM, biz_id != null ? String(biz_id) : null]
      );
    }
    return receivers.length;
  } catch (e) { console.error('[biz-message] emit failed:', e.message); return null; }
}

// 广播便捷封装
export async function emitBizToStaff(opts) {
  return emitBizMessage({ ...opts, user_id: null });
}

// 消息列表（分页 + read_status 筛选：all / unread / read）
router.get('/list', authRequired, async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
    const readStatus = (req.query.read_status || 'all').toString();
    const where = ['user_id = ?'];
    const params = [uid];
    if (readStatus === 'unread') where.push('is_read = 0');
    else if (readStatus === 'read') where.push('is_read = 1');
    const total = (await get(`SELECT COUNT(*) AS c FROM biz_message WHERE ${where.join(' AND ')}`, params)).c;
    const rows = await query(
      `SELECT * FROM biz_message WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    );
    res.json({ list: rows, total: Number(total) || 0, page, pageSize });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 未读数量（底部 Tab 角标）
router.get('/unread-count', authRequired, async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    const r = await get('SELECT COUNT(*) AS c FROM biz_message WHERE user_id = ? AND is_read = 0', [uid]);
    res.json({ count: Number(r.c) || 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 全部标为已读
router.put('/read-all', authRequired, async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    await run('UPDATE biz_message SET is_read = 1 WHERE user_id = ? AND is_read = 0', [uid]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 单条消息详情（进入即标记已读）
router.get('/:messageId', authRequired, async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    const m = await get('SELECT * FROM biz_message WHERE id = ? AND user_id = ?', [req.params.messageId, uid]);
    if (!m) return res.status(404).json({ error: '消息不存在' });
    if (!m.is_read) await run('UPDATE biz_message SET is_read = 1 WHERE id = ?', [m.id]);
    res.json({ ...m, is_read: 1 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 删除单条消息
router.delete('/:messageId', authRequired, async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    const m = await get('SELECT id FROM biz_message WHERE id = ? AND user_id = ?', [req.params.messageId, uid]);
    if (!m) return res.status(404).json({ error: '消息不存在' });
    await run('DELETE FROM biz_message WHERE id = ?', [m.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
