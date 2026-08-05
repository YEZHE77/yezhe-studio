// routes/orders.js —— 订单中心（全生命周期 / 客户档案 / 收款款项 / 操作日志 / 作废 / 退款）
import { Router } from 'express';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { query, get, insert, run } from '../db.js';
import { authRequired, requireRole } from '../auth.js';
import { parseRow } from '../schema.js';

const router = Router();
const JSON_COLS = ['package_snapshot', 'addons_snapshot', 'logs'];

function nowISO() { return new Date().toISOString(); }

async function appendLog(orderId, text) {
  const cur = await get('SELECT logs FROM orders WHERE id = ?', [orderId]);
  let logs = [];
  if (cur && cur.logs) { try { logs = JSON.parse(cur.logs); } catch { logs = []; } }
  logs.push({ t: nowISO(), text });
  await run('UPDATE orders SET logs = ? WHERE id = ?', [JSON.stringify(logs), orderId]);
}

// 列表
router.get('/', authRequired, async (req, res) => {
  try {
    const { status, q, customer, from, to } = req.query;
    const where = ['cancelled = 0', 'is_deleted = 0'];
    const params = [];
    if (status) { where.push('status = ?'); params.push(status); }
    if (q) { where.push('(customer_name LIKE ? OR order_no LIKE ?)'); params.push('%' + q + '%', '%' + q + '%'); }
    if (customer) { where.push('customer_name LIKE ?'); params.push('%' + customer + '%'); }
    if (from && to) { where.push('created_at >= ? AND created_at <= ?'); params.push(from, to); }
    const rows = await query('SELECT * FROM orders WHERE ' + where.join(' AND ') + ' ORDER BY id DESC', params);
    res.json(rows.map((r) => parseRow(r, JSON_COLS)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 回收站列表（仅管理员可见）
router.get('/recycle', authRequired, requireRole(['admin']), async (req, res) => {
  try {
    const rows = await query('SELECT * FROM orders WHERE is_deleted = 1 ORDER BY deleted_at DESC');
    res.json(rows.map((r) => parseRow(r, JSON_COLS)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 详情（含收款流水）
router.get('/:id', authRequired, async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    const order = parseRow(o, JSON_COLS);
    const payments = await query('SELECT * FROM payments WHERE order_id = ? ORDER BY created_at ASC', [o.id]);
    let pkgName = '';
    if (o.package_id) { const p = await get('SELECT name FROM packages WHERE id = ?', [o.package_id]); pkgName = p ? p.name : ''; }
    res.json({ ...order, payments, packageName: pkgName });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 创建（自动套系快照 + 计算应收）
router.post('/', authRequired, requireRole(['admin', 'photographer', 'finance']), async (req, res) => {
  try {
    const b = req.body;
    let package_snapshot = null, total = 0, addons = [];
    if (b.package_id) {
      const p = await get('SELECT * FROM packages WHERE id = ?', [b.package_id]);
      if (p) {
        let questionnaire = '';
        try { questionnaire = p.questionnaire ? JSON.parse(p.questionnaire) : ''; } catch { questionnaire = p.questionnaire || ''; }
        package_snapshot = { id: p.id, name: p.name, price: p.price, questionnaire };
        total += parseFloat(p.price) || 0;
        if (b.addons && b.addons.length) {
          addons = b.addons;
          total += addons.reduce((s, a) => s + (parseFloat(a.price) || 0), 0);
        }
      }
    }
    const deposit = parseFloat(b.deposit) || 0;
    const balance = parseFloat(b.balance) || 0;
    if (!package_snapshot) total = deposit + balance;
    const order_no = b.order_no || ('NO' + Date.now());
    const logs = JSON.stringify([{ t: nowISO(), text: '创建订单' }]);
    const groom = (b.groom_name || '').trim();
    const bride = (b.bride_name || '').trim();
    const customer_name = groom || bride ? [groom, bride].filter(Boolean).join(' & ') : (b.customer_name || '');
    const id = await insert(
      `INSERT INTO orders (order_no, customer_name, customer_phone, package_id, package_snapshot, addons_snapshot, status,
        deposit, balance, deposit_method, balance_method, shoot_date, executor, total_amount, paid_amount, remark, logs,
        groom_name, bride_name, address)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        order_no, customer_name, b.customer_phone || '', b.package_id || null,
        JSON.stringify(package_snapshot), JSON.stringify(addons), b.status || 'unpaid',
        deposit, balance, b.deposit_method || 'offline', b.balance_method || 'offline',
        b.shoot_date || '', b.executor || '', total, 0, b.remark || '', logs,
        groom, bride, b.address || ''
      ]
    );
    res.json({ id, order_no });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 更新字段（推进阶段 / 改派 / 备注）
router.put('/:id', authRequired, requireRole(['admin', 'photographer', 'finance']), async (req, res) => {
  try {
    const b = req.body;
    const cur = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!cur) return res.status(404).json({ error: '订单不存在' });
    const status = b.status ?? cur.status;
    const groom = (b.groom_name ?? cur.groom_name ?? '').trim();
    const bride = (b.bride_name ?? cur.bride_name ?? '').trim();
    const customer_name = groom || bride ? [groom, bride].filter(Boolean).join(' & ') : (b.customer_name ?? cur.customer_name);
    await run(
      `UPDATE orders SET customer_name=?, customer_phone=?, shoot_date=?, executor=?, remark=?, status=?,
        groom_name=?, bride_name=?, address=? WHERE id=?`,
      [customer_name, b.customer_phone ?? cur.customer_phone,
       b.shoot_date ?? cur.shoot_date, b.executor ?? cur.executor, b.remark ?? cur.remark, status,
       groom, bride, b.address ?? cur.address, cur.id]
    );
    if (b.status && b.status !== cur.status) {
      const MAP = { unpaid: '待付定金', deposit: '已付定金', shot: '已拍摄', selecting: '选片中', retouching: '精修中', delivered: '已交付', completed: '已完成' };
      await appendLog(cur.id, '阶段推进 → ' + (MAP[status] || status));
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 加收款（写入 payments 流水，更新 paid_amount）
router.post('/:id/payments', authRequired, requireRole(['admin', 'photographer', 'finance']), async (req, res) => {
  try {
    const b = req.body;
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    const type = ['deposit', 'balance', 'extra', 'refund'].includes(b.type) ? b.type : 'deposit';
    const amount = parseFloat(b.amount) || 0;
    if (amount <= 0) return res.status(400).json({ error: '金额必须大于 0' });
    const pid = await insert(
      `INSERT INTO payments (order_id, order_no, type, amount, method, note) VALUES (?,?,?,?,?,?)`,
      [o.id, o.order_no, type, amount, b.method || 'offline', b.note || '']
    );
    // 重算 paid_amount（应收类加、退款减）
    const agg = await get(
      `SELECT
         COALESCE(SUM(CASE WHEN type IN ('deposit','balance','extra') THEN amount ELSE 0 END),0) AS received,
         COALESCE(SUM(CASE WHEN type='refund' THEN amount ELSE 0 END),0) AS refunded
       FROM payments WHERE order_id = ?`,
      [o.id]
    );
    const paid = (parseFloat(agg.received) - parseFloat(agg.refunded));
    await run('UPDATE orders SET paid_amount = ? WHERE id = ?', [paid, o.id]);
    const TYPE_LABEL = { deposit: '定金', balance: '尾款', extra: '加片/增值', refund: '退款' };
    await appendLog(o.id, `收款登记：${TYPE_LABEL[type]} ¥${amount}（${b.method === 'online' ? '线上' : '线下'}）`);
    // 收到定金自动进入已付定金
    if (type === 'deposit' && o.status === 'unpaid') {
      await run("UPDATE orders SET status = 'deposit' WHERE id = ?", [o.id]);
    }
    res.json({ ok: true, paymentId: pid, paid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 软删除订单（进入回收站，可恢复；保留收款流水与选片记录，不破坏数据）
router.delete('/:id', authRequired, requireRole(['admin']), async (req, res) => {
  try {
    const o = await get('SELECT id FROM orders WHERE id = ?', [req.params.id]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    await run('UPDATE orders SET is_deleted = 1, deleted_at = ? WHERE id = ?', [nowISO(), o.id]);
    await appendLog(o.id, '订单移入回收站（软删除）');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 恢复订单（移出回收站）
router.post('/:id/restore', authRequired, requireRole(['admin']), async (req, res) => {
  try {
    const o = await get('SELECT id FROM orders WHERE id = ?', [req.params.id]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    await run('UPDATE orders SET is_deleted = 0, deleted_at = NULL WHERE id = ?', [o.id]);
    await appendLog(o.id, '订单已从回收站恢复');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 彻底删除（管理员，物理删除并级联收款流水与选片记录）
router.post('/:id/purge', authRequired, requireRole(['admin']), async (req, res) => {
  try {
    const o = await get('SELECT id FROM orders WHERE id = ?', [req.params.id]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    await run('DELETE FROM payments WHERE order_id = ?', [o.id]);
    await run('DELETE FROM photo_select WHERE order_id = ?', [o.id]);
    await run('DELETE FROM orders WHERE id = ?', [o.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 作废（仅标记 cancelled，禁止物理删除）
router.post('/:id/cancel', authRequired, requireRole(['admin']), async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    await run("UPDATE orders SET cancelled = 1, status = 'cancelled' WHERE id = ?", [o.id]);
    await appendLog(o.id, '订单作废' + (req.body.reason ? '：' + req.body.reason : ''));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 退款（登记退款流水 + 记录退款额）
router.post('/:id/refund', authRequired, requireRole(['admin', 'finance']), async (req, res) => {
  try {
    const b = req.body;
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    const amount = parseFloat(b.amount) || 0;
    if (amount <= 0) return res.status(400).json({ error: '退款金额必须大于 0' });
    await insert(
      `INSERT INTO payments (order_id, order_no, type, amount, method, note) VALUES (?,?,?,?,?,?)`,
      [o.id, o.order_no, 'refund', amount, 'offline', b.note || '退款']
    );
    const agg = await get(
      `SELECT COALESCE(SUM(CASE WHEN type='refund' THEN amount ELSE 0 END),0) AS refunded FROM payments WHERE order_id = ?`,
      [o.id]
    );
    await run('UPDATE orders SET refund_amount = ? WHERE id = ?', [parseFloat(agg.refunded), o.id]);
    await appendLog(o.id, `退款 ¥${amount}` + (b.note ? '：' + b.note : ''));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 设置存储期限（原片/精修保存天数）并自动计算到期时间
router.post('/:id/storage', authRequired, requireRole(['admin', 'photographer', 'finance']), async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    const raw = parseInt(req.body.raw_storage_days, 10) || o.raw_storage_days || 30;
    const retouch = parseInt(req.body.retouch_storage_days, 10) || o.retouch_storage_days || 180;
    const now = new Date();
    const rawExp = new Date(now.getTime() + raw * 86400000).toISOString().slice(0, 10);
    const retouchExp = new Date(now.getTime() + retouch * 86400000).toISOString().slice(0, 10);
    await run(
      'UPDATE orders SET raw_storage_days = ?, retouch_storage_days = ?, raw_expire_at = ?, retouch_expire_at = ? WHERE id = ?',
      [raw, retouch, rawExp, retouchExp, o.id]
    );
    await appendLog(o.id, `设置存储期限：原片 ${raw} 天 / 精修 ${retouch} 天`);
    res.json({ ok: true, raw_expire_at: rawExp, retouch_expire_at: retouchExp });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 生成 / 刷新客户影集分享二维码（公开访问，无需登录）
router.post('/:id/share', authRequired, requireRole(['admin', 'photographer', 'finance']), async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    let token = o.share_token;
    if (!token) token = crypto.randomBytes(16).toString('hex');

    // 分享落地页基准地址：生产设为前端域名（如 https://yezhe-studio.netlify.app），
    // 本地未配置时若请求来自 4000 端口则回退到前端开发端口 5173，方便扫码调试。
    let base = process.env.SHARE_BASE_URL || '';
    if (!base) {
      const host = req.get('host') || '';
      if (host.includes('localhost:4000') || host.includes('127.0.0.1:4000')) {
        base = 'http://localhost:5173';
      } else {
        base = `${req.protocol}://${host}`;
      }
    }
    const shareUrl = `${base}/share/${token}`;
    const qrUrl = await QRCode.toDataURL(shareUrl, { width: 480, margin: 1 });
    await run('UPDATE orders SET share_token = ?, qr_url = ? WHERE id = ?', [token, qrUrl, o.id]);
    await appendLog(o.id, '生成客户影集分享二维码');
    res.json({ ok: true, share_token: token, share_url: shareUrl, qr_url: qrUrl });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 关闭分享（清空令牌，使公开链接失效）
router.post('/:id/unshare', authRequired, requireRole(['admin', 'photographer', 'finance']), async (req, res) => {
  try {
    const o = await get('SELECT id FROM orders WHERE id = ?', [req.params.id]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    await run('UPDATE orders SET share_token = NULL, qr_url = NULL WHERE id = ?', [o.id]);
    await appendLog(o.id, '关闭客户影集分享');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
