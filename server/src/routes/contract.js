// routes/contract.js —— 合同模板管理 + 订单合同 PDF 上传回写
// 模板 template_content 富文本带 {{占位符}}；PDF 前端本地生成后上传 R2 回写 contract_pdf_url
import { Router } from 'express';
import multer from 'multer';
import { query, get, insert, run } from '../db.js';
import { authRequired, requireRole } from '../auth.js';
import { saveBuffer } from '../storage.js';
import { emitMessage } from './message.js';

const router = Router();
const STAFF_ROLES = ['admin', 'photographer', 'finance'];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function nowISO() { return new Date().toISOString(); }

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

// 前端本地生成 PDF 后上传，回写 contract_pdf_url + 保存生成时间与订单快照 + 推送消息
router.post('/orders/:id/contract-pdf', authRequired, requireRole(...STAFF_ROLES), upload.single('file'), async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    if (!req.file || !req.file.buffer) return res.status(400).json({ error: '未收到 PDF 文件' });
    // 生成后二次校验：核心字段为空仍拒绝（防绕过前端直接调接口）
    const pre = contractPrecheck(o);
    if (!pre.ok) return res.status(400).json({ error: '订单核心信息不完整，无法生成合同：' + pre.missing.join('、') });
    const isUpdate = !!o.contract_pdf_url;
    const { url } = await saveBuffer(req.file.buffer, '.pdf', 'biz-contract', { contentType: 'application/pdf', isPublic: false, category: 'contract' });
    // 生成后存储数据快照（本次渲染使用的完整订单 JSON，用于版本追溯与「订单已变更」比对）
    await run('UPDATE orders SET contract_pdf_url = ?, contract_generate_time = ?, contract_order_snapshot = ? WHERE id = ?',
      [url, nowISO(), JSON.stringify(o), o.id]);
    // 消息中心：生成 / 重新生成合同（order_msg 类型，记录操作时间与订单关联 ID，全流程可追溯）
    await emitMessage({
      message_type: 'order_msg',
      business_event: isUpdate ? 'contract_updated' : 'contract_generated',
      title: isUpdate ? '合同已更新' : '合同已生成',
      content: `${o.customer_name || '客户'} 的合同${isUpdate ? '已重新生成' : '已生成'}（订单 ${o.order_no || o.id}）`,
      rel_id: String(o.id), rel_model: 'order'
    });
    res.json({ ok: true, contract_pdf_url: url, contract_generate_time: o.contract_generate_time });
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

export default router;
