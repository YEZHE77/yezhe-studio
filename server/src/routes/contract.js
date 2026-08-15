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
    if (b.is_default) await run('UPDATE contract_template SET is_default = 0');
    const id = await insert(
      'INSERT INTO contract_template (template_name, template_content, backup_word_url, is_default, create_time, update_time) VALUES (?,?,?,?,?,?)',
      [b.template_name.trim(), b.template_content || '', b.backup_word_url || '', b.is_default ? 1 : 0, nowISO(), nowISO()]
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
    if (b.is_default) await run('UPDATE contract_template SET is_default = 0');
    await run(
      'UPDATE contract_template SET template_name=?, template_content=?, backup_word_url=?, is_default=?, update_time=? WHERE id=?',
      [b.template_name || cur.template_name, b.template_content !== undefined ? b.template_content : cur.template_content,
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

// 前端本地生成 PDF 后上传，回写 contract_pdf_url + 推送消息
router.post('/orders/:id/contract-pdf', authRequired, requireRole(...STAFF_ROLES), upload.single('file'), async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    if (!req.file || !req.file.buffer) return res.status(400).json({ error: '未收到 PDF 文件' });
    const isUpdate = !!o.contract_pdf_url;
    const { url } = await saveBuffer(req.file.buffer, '.pdf', 'biz-contract', { contentType: 'application/pdf', isPublic: false, category: 'contract' });
    await run('UPDATE orders SET contract_pdf_url = ? WHERE id = ?', [url, o.id]);
    // 消息中心：生成 / 重新生成合同
    await emitMessage({
      message_type: 'order_msg',
      business_event: isUpdate ? 'contract_updated' : 'contract_generated',
      title: isUpdate ? '合同已更新' : '合同已生成',
      content: `${o.customer_name || '客户'} 的合同${isUpdate ? '已重新生成' : '已生成'}`,
      rel_id: String(o.id), rel_model: 'order'
    });
    res.json({ ok: true, contract_pdf_url: url });
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
