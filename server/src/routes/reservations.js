// routes/reservations.js —— B 端预约管理（预约列表 / 修改状态 / 转订单）
// 状态机：pending 待确认 / contacted 已沟通 / rejected 已拒绝 / converted 已转订单
import { Router } from 'express';
import crypto from 'node:crypto';
import { query, get, insert, run } from '../db.js';
import { authRequired, requireRole } from '../auth.js';
import { getConfig } from '../configStore.js';

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
      is_read: !!Number(r.is_read),
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

// ===== 进入详情标记已读 =====
router.post('/:id/read', authRequired, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await run('UPDATE reservations SET is_read = 1 WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 转为订单（中转编辑弹窗提交：预填预约数据 + 执行人/成交价/定金/订单状态/定金支付时间；执行人与定金必填）=====
router.post('/:id/convert', authRequired, requireRole(['admin', 'photographer', 'finance']), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const r = await get('SELECT * FROM reservations WHERE id = ?', [id]);
    if (!r) return res.status(404).json({ error: '预约不存在' });
    if (r.status === 'converted') return res.status(400).json({ error: '该预约已转订单' });

    const b = req.body || {};

    // 预填项（可手动修改）：弹窗传入优先，回退到预约记录
    const groom = String(b.groom_name != null ? b.groom_name : (r.groom_name || '')).trim();
    const bride = String(b.bride_name != null ? b.bride_name : (r.bride_name || '')).trim();
    const phone = String(b.phone != null ? b.phone : (r.phone || '')).trim();
    const phoneTwo = String(b.phone_two != null ? b.phone_two : (r.phone_two || '')).trim();
    const expectDate = String(b.expect_date != null ? b.expect_date : (r.expect_date || '')).trim();
    const shootLocation = String(b.shoot_location != null ? b.shoot_location : (r.shoot_location || '')).trim();
    const remark = String(b.remark != null ? b.remark : (r.remark || '')).trim();
    const packageId = (b.package_id !== undefined && b.package_id !== null && b.package_id !== '')
      ? parseInt(b.package_id, 10)
      : (r.package_id || null);

    // 补充确认字段
    const executorName = String(b.executor_name || '').trim();
    const executorId = b.executor_id ? parseInt(b.executor_id, 10) : null;
    const orderStatus = String(b.order_status || 'pending_deposit').trim();
    const depositPayTime = String(b.deposit_pay_time || '').trim();
    const deposit = Math.max(0, parseFloat(b.deposit) || 0);
    const price = Math.max(0, parseFloat(b.price) || 0);

    if (!phone) return res.status(400).json({ error: '请填写主联系手机号' });
    if (!executorName) return res.status(400).json({ error: '请选择执行人' });
    if (!(deposit >= 0) || b.deposit === undefined || b.deposit === null || b.deposit === '') {
      return res.status(400).json({ error: '请填写定金金额' });
    }

    // 读取套系（可为空；价格默认取套系价，可手动修改）
    let pkg = null;
    if (packageId) pkg = await get('SELECT * FROM packages WHERE id = ?', [packageId]);
    const finalPrice = b.price !== undefined && b.price !== null && b.price !== '' ? price : (pkg ? (Number(pkg.price) || 0) : 0);

    // 生成 accessToken（复用 orders.customer_token 作为免登录密钥）
    const customer_token = crypto.randomBytes(16).toString('hex');
    const order_no = 'NO' + Date.now();
    const package_snapshot = pkg ? JSON.stringify({
      name: pkg.name, price: pkg.price, description: pkg.description, cover_url: pkg.cover_url || ''
    }) : '{}';

    const customer_name = groom || bride || '客户';
    const phones = [phone, phoneTwo].filter(Boolean);
    const balance = Math.max(0, finalPrice - deposit);
    const payment_status = deposit >= finalPrice && finalPrice > 0 ? 'paid' : (deposit > 0 ? 'deposit' : 'unpaid');

    // 订单分享默认备注：建单时从系统配置默认值带入（管理员清空则不带）；单订单可后续单独覆盖
    const shareNote = await getConfig('customer_order_share_default_note', '');
    const orderId = await insert(
      `INSERT INTO orders (order_no, customer_name, customer_phone, phone_two, reservation_id, package_id, package_name, package_snapshot,
        status, order_status, deposit, deposit_amount, balance, total_amount, paid_amount, executor, executors,
        shoot_date, address, groom_name, bride_name, remark, phones, customer_token, payment_status, date_tbd, deposit_pay_time)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        order_no, customer_name, phone, phoneTwo, id, packageId, pkg ? pkg.name : '', package_snapshot,
        'deposit', orderStatus, deposit, deposit, balance, finalPrice, deposit, executorName, JSON.stringify([{ id: executorId, name: executorName }]),
        expectDate, shootLocation, groom, bride, remark, JSON.stringify(phones), customer_token, payment_status, 0, depositPayTime || null
      ]
    );
    // 订单分享默认备注：建单时带入系统配置默认值（空则不带）
    if (shareNote) {
      try { await run('UPDATE orders SET share_note = ? WHERE id = ?', [shareNote, orderId]); } catch (e) { console.error('[reservations] 写入 share_note 失败', e.message); }
    }

    // 预约标记已转订单 + 绑定订单 id
    await run('UPDATE reservations SET status = ?, order_id = ? WHERE id = ?', ['converted', orderId, id]);

    // 订单变更日志
    await appendOrderLog(orderId, '由预约转为订单（来源预约 ' + id + '，成交价 ' + finalPrice + '，定金 ' + deposit + '）', '系统');

    res.json({ ok: true, order_id: orderId, order_no, access_token: customer_token });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
