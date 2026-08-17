// routes/reservations.js —— B 端预约管理（预约列表 / 修改状态 / 转订单）
// 状态机：pending 待确认 / contacted 已沟通 / rejected 已拒绝 / converted 已转订单
import { Router } from 'express';
import crypto from 'node:crypto';
import { query, get, insert, run } from '../db.js';
import { authRequired, requireRole } from '../auth.js';

const router = Router();

function nowISO() { return new Date().toISOString(); }

// 写订单变更记录（orders.logs）；失败不阻塞主业务
async function appendOrderLog(orderId, text, who) {
  try {
    const cur = await get('SELECT logs FROM orders WHERE id = ?', [orderId]);
    let logs = [];
    if (cur && cur.logs) { try { logs = JSON.parse(cur.logs); } catch { logs = []; } }
    const entry = { t: nowISO(), text };
    if (who) entry.who = who;
    logs.push(entry);
    await run('UPDATE orders SET logs = ? WHERE id = ?', [JSON.stringify(logs), orderId]);
  } catch (e) { console.error('[reservations] 写订单变更记录失败：', e.message); }
}

const RESERVATION_STATUS = { pending: '待确认', contacted: '已沟通', rejected: '已拒绝', converted: '已转订单' };

// ===== 列表（含套系名称价格；空套系展示「暂未确定套系」）=====
router.get('/', authRequired, async (req, res) => {
  try {
    const rows = await query(
      `SELECT r.*, p.name AS package_name, p.price AS package_price
       FROM reservations r LEFT JOIN packages p ON p.id = r.package_id
       ORDER BY r.id DESC`
    );
    res.json(rows.map((r) => ({
      id: r.id,
      groom_name: r.groom_name || '',
      bride_name: r.bride_name || '',
      phone: r.phone || '',
      phone_two: r.phone_two || '',
      package_id: r.package_id || null,
      package_name: r.package_name || '',
      package_price: Number(r.package_price) || 0,
      expect_date: r.expect_date || '',
      shoot_location: r.shoot_location || '',
      remark: r.remark || '',
      status: r.status,
      status_label: RESERVATION_STATUS[r.status] || r.status,
      order_id: r.order_id || null,
      create_time: r.create_time || ''
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 修改状态（待确认 / 已沟通 / 已拒绝）=====
router.patch('/:id/status', authRequired, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const status = String((req.body && req.body.status) || '').trim();
    if (!['pending', 'contacted', 'rejected'].includes(status)) {
      return res.status(400).json({ error: '无效的状态' });
    }
    const r = await get('SELECT id, status FROM reservations WHERE id = ?', [id]);
    if (!r) return res.status(404).json({ error: '预约不存在' });
    if (r.status === 'converted') return res.status(400).json({ error: '该预约已转订单，无法修改状态' });
    await run('UPDATE reservations SET status = ? WHERE id = ?', [status, id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 转为订单（字段映射复制生成订单 + 生成 accessToken + 预约标记已转订单）=====
router.post('/:id/convert', authRequired, requireRole(['admin', 'photographer', 'finance']), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const r = await get('SELECT * FROM reservations WHERE id = ?', [id]);
    if (!r) return res.status(404).json({ error: '预约不存在' });
    if (r.status === 'converted') return res.status(400).json({ error: '该预约已转订单' });

    // 读取套系（可为空）
    let pkg = null;
    if (r.package_id) pkg = await get('SELECT * FROM packages WHERE id = ?', [r.package_id]);

    // 生成 accessToken（复用 orders.customer_token 作为免登录密钥）
    const customer_token = crypto.randomBytes(16).toString('hex');
    const order_no = 'NO' + Date.now();
    const package_snapshot = pkg ? JSON.stringify({
      name: pkg.name, price: pkg.price, description: pkg.description, cover_url: pkg.cover_url || ''
    }) : '{}';
    const price = pkg ? (Number(pkg.price) || 0) : 0;

    const groom = r.groom_name || '';
    const bride = r.bride_name || '';
    const customer_name = groom || bride || '客户';
    const phones = [r.phone, r.phone_two || ''].filter(Boolean);

    const orderId = await insert(
      `INSERT INTO orders (order_no, customer_name, customer_phone, phone_two, reservation_id, package_id, package_name, package_snapshot,
        status, order_status, deposit, deposit_amount, balance, total_amount, paid_amount,
        shoot_date, address, groom_name, bride_name, remark, phones, customer_token, payment_status, date_tbd)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        order_no, customer_name, r.phone || '', r.phone_two || '', id, r.package_id || null,
        pkg ? pkg.name : '', package_snapshot,
        'deposit', 'pending_deposit', 0, 0, price, price, 0,
        r.expect_date || '', r.shoot_location || '', groom, bride, r.remark || '', JSON.stringify(phones),
        customer_token, 'unpaid', 0
      ]
    );

    // 预约标记已转订单 + 绑定订单 id
    await run('UPDATE reservations SET status = ?, order_id = ? WHERE id = ?', ['converted', orderId, id]);

    // 订单变更日志
    await appendOrderLog(orderId, '由预约自动转为订单（来源预约 ' + id + '）', '系统');

    res.json({ ok: true, order_id: orderId, order_no, access_token: customer_token });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
