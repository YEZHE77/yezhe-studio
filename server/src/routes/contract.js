// routes/contract.js —— 合同模板管理 + 订单合同 PDF 安全存储（私有 R2 + 后端鉴权中转下载）
// 模板 template_content 富文本带 {{占位符}}；PDF 前端本地生成后上传私有 R2，下载走后端鉴权中转
import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { query, get, insert, run } from '../db.js';
import { authRequired, requireRole, peekUser } from '../auth.js';
import { saveBuffer, getObjectBuffer, deleteObjectByKey } from '../storage.js';
import { emitMessage } from './message.js';

const router = Router();
const STAFF_ROLES = ['admin', 'photographer', 'finance'];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function nowISO() { return new Date().toISOString(); }
function md5(buf) { return crypto.createHash('md5').update(buf).digest('hex'); }

// ===== 合同数据一致性强制规则 =====
// ① 模板防篡改：必填业务占位符（缺失则禁止保存模板）
const REQUIRED_PLACEHOLDERS = ['groom_name', 'bride_name', 'wedding_full_date', 'shoot_position', 'total_money'];
// ② 生成前核心字段校验：新人 / 日期 / 机位 / 价格 任一为空则阻断生成
function contractPrecheck(o) {
  const missing = [];
  if (!(o.groom_name || '').trim() && !(o.bride_name || '').trim()) missing.push('新人姓名');
  if (!(o.shoot_date || '').trim()) missing.push('拍摄日期');
  if (!(o.shoot_position || '').trim()) missing.push('机位');
  const price = parseFloat(o.total_amount) || 0;
  if (price <= 0) missing.push('合同总价');
  return { ok: missing.length === 0, missing };
}

// 合同操作审计留痕（上传/下载/作废/恢复/销毁，记录操作人 + IP + 时间）
async function audit(orderId, req, action, detail, operator) {
  try {
    const uid = (operator && operator.uid) || (req.user && req.user.uid) || null;
    const name = (operator && operator.username) || (req.user && req.user.username) || null;
    await insert(
      'INSERT INTO contract_audit (order_id, operator_uid, operator_name, action, ip, token, detail, created_at) VALUES (?,?,?,?,?,?,?,?)',
      [orderId, uid, name, action, req.ip || '', String(detail || '').slice(0, 200), detail || '', nowISO()]
    );
  } catch (e) { console.error('[contract] audit failed', e.message); }
}

// ===================== 合同模板 CRUD =====================

// 模板列表
router.get('/templates', authRequired, async (req, res) => {
  try {
    const rows = await query('SELECT * FROM contract_template ORDER BY is_default DESC, id DESC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 新增模板（is_default=true 时清空其它默认）
router.post('/templates', authRequired, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const b = req.body || {};
    if (!(b.template_name || '').trim()) return res.status(400).json({ error: '请填写模板名称' });
    // 防篡改校验：缺失必填业务占位符则禁止保存
    const content = b.template_content || '';
    const missing = REQUIRED_PLACEHOLDERS.filter((p) => !content.includes('{{' + p + '}}'));
    if (missing.length) return res.status(400).json({ error: '合同正文缺失必填占位符：' + missing.map((p) => '{{' + p + '}}').join('、') });
    if (b.is_default) await run('UPDATE contract_template SET is_default = 0');
    const id = await insert(
      'INSERT INTO contract_template (template_name, template_content, backup_word_url, is_default, create_time, update_time) VALUES (?,?,?,?,?,?)',
      [b.template_name.trim(), content, b.backup_word_url || '', b.is_default ? 1 : 0, nowISO(), nowISO()]
    );
    res.json({ ok: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 编辑模板
router.put('/templates/:id', authRequired, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const b = req.body || {};
    const cur = await get('SELECT * FROM contract_template WHERE id = ?', [req.params.id]);
    if (!cur) return res.status(404).json({ error: '模板不存在' });
    // 防篡改校验：缺失必填业务占位符则禁止保存
    const content = b.template_content !== undefined ? b.template_content : cur.template_content;
    const missing = REQUIRED_PLACEHOLDERS.filter((p) => !(content || '').includes('{{' + p + '}}'));
    if (missing.length) return res.status(400).json({ error: '合同正文缺失必填占位符：' + missing.map((p) => '{{' + p + '}}').join('、') });
    if (b.is_default) await run('UPDATE contract_template SET is_default = 0');
    await run(
      'UPDATE contract_template SET template_name=?, template_content=?, backup_word_url=?, is_default=?, update_time=? WHERE id=?',
      [b.template_name || cur.template_name, content,
        b.backup_word_url !== undefined ? b.backup_word_url : cur.backup_word_url,
        b.is_default ? 1 : 0, nowISO(), req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 删除模板（有订单绑定时拦截）
router.delete('/templates/:id', authRequired, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const bound = await get('SELECT id FROM orders WHERE contract_template_id = ? LIMIT 1', [req.params.id]);
    if (bound) return res.status(400).json({ error: '该模板已被订单绑定，无法删除' });
    await run('DELETE FROM contract_template WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===================== 订单合同 PDF 上传回写 =====================

// 生成前校验：实时读订单最新字段，核心字段（新人/日期/机位/价格）为空则阻断
router.get('/orders/:id/contract-precheck', authRequired, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    res.json(contractPrecheck(o));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 前端本地生成 PDF 后上传（私有存储）：存 contract_file_key + md5 + 操作人 + 快照；重新生成时旧文件归档
router.post('/orders/:id/contract-pdf', authRequired, requireRole(...STAFF_ROLES), upload.single('file'), async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    if (!req.file || !req.file.buffer) return res.status(400).json({ error: '未收到 PDF 文件' });
    // 生成后二次校验：核心字段为空仍拒绝（防绕过前端直接调接口）
    const pre = contractPrecheck(o);
    if (!pre.ok) return res.status(400).json({ error: '订单核心信息不完整，无法生成合同：' + pre.missing.join('、') });
    const isUpdate = !!o.contract_file_key;
    // 合同文件存专属私有目录 contract/{订单ID}/（不通过公开 Worker 代理暴露，仅后端鉴权中转下载）
    const { r2Key } = await saveBuffer(req.file.buffer, '.pdf', 'contract/' + o.id, { contentType: 'application/pdf', isPublic: false, category: 'contract' });
    const fileMd5 = md5(req.file.buffer);
    // 重新生成：旧文件归档保留 30 天（可恢复历史版本）
    if (isUpdate && o.contract_file_key && o.contract_file_key !== r2Key) {
      await insert(
        'INSERT INTO contract_archive (order_id, file_key, file_md5, generated_at, archived_at, reason, operator_uid) VALUES (?,?,?,?,?,?,?)',
        [o.id, o.contract_file_key, o.contract_file_md5 || null, o.contract_generate_time || nowISO(), nowISO(), 'regenerate', (req.user && req.user.uid) || null]
      );
    }
    // contract_pdf_url 只存后端中转路径（不暴露原始桶直链）；file_key 用于后端 GetObject 中转下载
    await run('UPDATE orders SET contract_file_key = ?, contract_file_md5 = ?, contract_operator_uid = ?, contract_pdf_url = ?, contract_generate_time = ?, contract_order_snapshot = ?, contract_invalid = 0 WHERE id = ?',
      [r2Key, fileMd5, (req.user && req.user.uid) || null, '/api/contract/download/' + o.id, nowISO(), JSON.stringify(o), o.id]);
    await audit(o.id, req, isUpdate ? 'update' : 'upload', isUpdate ? '重新生成合同' : '生成合同');
    await emitMessage({
      message_type: 'order_msg',
      business_event: isUpdate ? 'contract_updated' : 'contract_generated',
      title: isUpdate ? '合同已更新' : '合同已生成',
      content: `${o.customer_name || '客户'} 的合同${isUpdate ? '已重新生成' : '已生成'}（订单 ${o.order_no || o.id}）`,
      rel_id: String(o.id), rel_model: 'order'
    });
    res.json({ ok: true, contract_pdf_url: '/api/contract/download/' + o.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===================== 合同下载鉴权中转 + 作废/恢复 =====================

// 下载（预览/下载统一走后端鉴权中转）：管理员登录态 或 客户 customer_token 鉴权；md5 校验
router.get('/download/:orderId', async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.orderId]);
    if (!o || !o.contract_file_key) return res.status(404).json({ error: '合同不存在' });
    // 鉴权：管理员登录态 或 客户 customer_token 匹配
    const admin = peekUser(req);
    const ct = String(req.query.customer_token || '');
    const isCustomer = !!ct && !!o.customer_token && ct === o.customer_token;
    if (!admin && !isCustomer) return res.status(403).json({ error: '无权限访问该合同' });
    // 作废合同：客户不可下载（管理员仍可查看）
    if (Number(o.contract_invalid) && isCustomer) return res.status(403).json({ error: '合同已作废，无法下载' });
    // 读文件 + md5 校验（篡改/损坏直接阻断）
    let buf;
    try { buf = await getObjectBuffer(o.contract_file_key); } catch (e) { return res.status(404).json({ error: '合同文件不存在，请重新生成' }); }
    if (o.contract_file_md5 && md5(buf) !== o.contract_file_md5) {
      return res.status(409).json({ error: '合同文件校验失败（已损坏或被篡改），请重新生成' });
    }
    await audit(o.id, req, 'download', isCustomer ? '客户下载合同（customer_token）' : '管理员下载合同', admin || undefined);
    // 下载记录（统一到 download_logs，B 端订单详情可查）
    try {
      await insert('INSERT INTO download_logs (order_id, item_type, item_name, operator_name, created_at) VALUES (?,?,?,?,?)',
        [o.id, 'contract', '合同 PDF', isCustomer ? '客户' : ((admin && admin.username) || '管理员'), nowISO()]);
    } catch (e) { console.error('[download] 记录失败', e.message); }
    const dl = req.query.dl === '1';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', (dl ? 'attachment' : 'inline') + '; filename="contract-' + o.id + '.pdf"');
    res.send(buf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 作废合同：标记 contract_invalid=1，客户无法下载
router.post('/orders/:id/invalidate', authRequired, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    await run('UPDATE orders SET contract_invalid = 1 WHERE id = ?', [o.id]);
    await audit(o.id, req, 'invalidate', '作废合同');
    await emitMessage({
      message_type: 'system', business_event: 'contract_invalidated',
      title: '合同已作废', content: `${o.customer_name || '客户'} 的合同已作废（订单 ${o.order_no || o.id}）`,
      rel_id: String(o.id), rel_model: 'order'
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 恢复作废合同：contract_invalid=0，客户恢复下载权限
router.post('/orders/:id/restore', authRequired, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    await run('UPDATE orders SET contract_invalid = 0 WHERE id = ?', [o.id]);
    await audit(o.id, req, 'restore', '恢复合同');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 上传模板备份 PDF（backup_word_url 存 R2，仅后台备份下载）
router.post('/upload-backup', authRequired, requireRole(...STAFF_ROLES), upload.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) return res.status(400).json({ error: '未收到文件' });
    const { url } = await saveBuffer(req.file.buffer, '.pdf', 'biz-contract', { contentType: 'application/pdf', isPublic: false, category: 'contract' });
    res.json({ ok: true, url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 订单保存合同配置（模板 id + 附加条款）
router.post('/orders/:id/contract', authRequired, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const b = req.body || {};
    await run('UPDATE orders SET contract_template_id = ?, contract_extra_text = ? WHERE id = ?',
      [b.contract_template_id != null ? b.contract_template_id : null, b.contract_extra_text || '', req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== 合同操作审计日志（B端，筛选 order_id / action / 时间范围，分页） =====
router.get('/audit', authRequired, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const where = [];
    const params = [];
    if (req.query.order_id) { where.push('a.order_id = ?'); params.push(Number(req.query.order_id) || 0); }
    if (req.query.action) { where.push('a.action = ?'); params.push(String(req.query.action)); }
    if (req.query.from) { where.push('a.created_at >= ?'); params.push(String(req.query.from)); }
    if (req.query.to) { where.push('a.created_at <= ?'); params.push(String(req.query.to)); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, parseInt(req.query.page_size, 10) || 50);
    const offset = (page - 1) * pageSize;
    const rows = await query(
      `SELECT a.id, a.order_id, a.operator_name, a.action, a.ip, a.detail, a.created_at,
              o.order_no, o.customer_name
       FROM contract_audit a LEFT JOIN orders o ON o.id = a.order_id
       ${whereSql}
       ORDER BY a.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const totalRow = await get(`SELECT COUNT(*) AS c FROM contract_audit a ${whereSql}`, params);
    res.json({ list: rows, total: totalRow ? Number(totalRow.c) : 0, page, page_size: pageSize });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 审计日志导出 CSV
router.get('/audit/export', authRequired, requireRole(...STAFF_ROLES), async (req, res) => {
  try {
    const where = [];
    const params = [];
    if (req.query.order_id) { where.push('a.order_id = ?'); params.push(Number(req.query.order_id) || 0); }
    if (req.query.action) { where.push('a.action = ?'); params.push(String(req.query.action)); }
    if (req.query.from) { where.push('a.created_at >= ?'); params.push(String(req.query.from)); }
    if (req.query.to) { where.push('a.created_at <= ?'); params.push(String(req.query.to)); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = await query(
      `SELECT a.id, a.order_id, a.operator_name, a.action, a.ip, a.detail, a.created_at, o.order_no, o.customer_name
       FROM contract_audit a LEFT JOIN orders o ON o.id = a.order_id
       ${whereSql}
       ORDER BY a.id DESC LIMIT 5000`, params
    );
    const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const header = ['ID', '订单ID', '订单编号', '客户姓名', '操作人', '操作类型', 'IP', '详情', '时间'];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push([r.id, r.order_id, r.order_no, r.customer_name, r.operator_name, r.action, r.ip, r.detail, r.created_at].map(esc).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="contract-audit.csv"');
    res.send('\uFEFF' + lines.join('\n'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
