// routes/mobileMessage.js —— 移动端业务消息中心（B 端 H5）
// biz_message 表：user_id 账号隔离；biz_type 业务来源（select_photo/schedule/order/system）；biz_id 关联业务主键
// 与 system_message（PC 端旧消息）、todo_items（待办）完全独立；仅业务事件通知，非 IM
// 规则：列表不自动置已读（仅进详情页标记单条已读）；PC + H5 共用一套数据
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { query, get, insert, run, dataDir } from '../db.js';
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
// biz_extra：附属参数（JSON 字符串），如 select_photo 存 {"orderId":N}、system 存 {"filename":"..."}
export async function emitBizMessage({ user_id = null, title, content = '', biz_type, biz_id = null, biz_extra = null }) {
  try {
    const receivers = user_id != null ? [user_id] : await staffUids();
    for (const uid of receivers) {
      await insert(
        'INSERT INTO biz_message (user_id, title, content, biz_type, biz_id, biz_extra) VALUES (?,?,?,?,?,?)',
        [uid, title || '', content || '', biz_type || BIZ_TYPE.SYSTEM, biz_id != null ? String(biz_id) : null, biz_extra || null]
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

// 下载备份文件（system 类型消息 biz_id 存文件名；安全校验防路径穿越）
router.get('/backup/:filename', authRequired, async (req, res) => {
  try {
    const filename = req.params.filename;
    if (!/^order_\d+_[0-9T\-]+\.json$/.test(filename)) return res.status(400).json({ error: '非法文件名' });
    const dir = path.join(dataDir, 'selection_backup');
    const filePath = path.join(dir, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: '备份文件不存在' });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(fs.readFileSync(filePath));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 单条消息详情（进入即标记已读）
router.get('/:messageId', authRequired, async (req, res) => {
  try {
    const uid = req.user && req.user.uid;
    const m = await get('SELECT * FROM biz_message WHERE id = ? AND user_id = ?', [req.params.messageId, uid]);
    if (!m) return res.status(404).json({ error: '消息不存在' });
    if (!m.is_read) await run('UPDATE biz_message SET is_read = 1 WHERE id = ?', [m.id]);
    // 动态校验业务存在性 + 解析 biz_extra（业务已删除则 biz_exist=false，前端按钮置灰）
    const result = { ...m, is_read: 1, biz_exist: false, biz_extra: null };
    let extra = {};
    try { extra = m.biz_extra ? JSON.parse(m.biz_extra) : {}; } catch {}
    switch (m.biz_type) {
      case 'select_photo': {
        // biz_id 存 task_id；返回 orderId 供前端拼接路由 /mobile/order/:orderId/select
        const task = await get('SELECT id, order_id FROM order_select_task WHERE id = ?', [m.biz_id]);
        if (task) { result.biz_exist = true; result.biz_extra = { orderId: task.order_id }; }
        break;
      }
      case 'order': {
        const o = await get('SELECT id FROM orders WHERE id = ? AND cancelled = 0 AND is_deleted = 0', [m.biz_id]);
        result.biz_exist = !!o;
        break;
      }
      case 'schedule': {
        const s = await get('SELECT id FROM schedules WHERE id = ?', [m.biz_id]);
        result.biz_exist = !!s;
        break;
      }
      case 'system': {
        // system 无业务实体；biz_exist=true，biz_extra 携带 filename 决定是否显示下载按钮
        result.biz_exist = true;
        result.biz_extra = extra;
        break;
      }
      default:
        result.biz_exist = true;
    }
    res.json(result);
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
