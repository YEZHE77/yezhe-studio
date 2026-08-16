// routes/public.js —— C 端公开接口（H5，无需登录）
// 职责：公开预约表单提交 / customer_token 订单只读查看
// 约束：C 端只能提交预约 + 浏览套系 + 只读查看自己订单 + 选片标记；绝不暴露任何编辑/删除/上传能力。
import { Router } from 'express';
import { query, get, insert, run } from '../db.js';
import { emitMessage } from './message.js';
import { generateEventTodo } from '../todo.js';

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
  } catch (e) { console.error('[public] 写订单变更记录失败：', e.message); }
}

// ===== 1. 公开预约表单提交（提交后客户无法修改） =====
router.post('/appointment', async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const phone = String(b.phone || '').trim();
    if (!name || !phone) return res.status(400).json({ error: '请填写称呼与联系电话' });
    // H5 匿名访问拿不到微信 openid，用手机号派生稳定标识，同一手机号归并到同一客资
    const openid = 'h5_' + phone;
    const period = ['full', 'half'].includes(b.period) ? b.period : 'full';

    // 写入客资（upsert：同一手机号更新，否则新建）
    const existCust = await get('SELECT id FROM customers WHERE openid = ?', [openid]);
    if (existCust) {
      await insert('UPDATE customers SET nickname = ?, phone = ?, updated_at = ? WHERE openid = ?', [name, phone, nowISO(), openid]);
    } else {
      await insert('INSERT INTO customers (openid, nickname, phone, created_at, updated_at) VALUES (?,?,?,?,?)', [openid, name, phone, nowISO(), nowISO()]);
    }

    // 写入预约
    const id = await insert(
      `INSERT INTO appointments (openid, name, phone, package_id, hope_date, remark, status, period, source, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [openid, name, phone, b.package_id || null, b.hope_date || '', b.remark || '', 'pending', period, 'h5', nowISO()]
    );

    // 消息中心：客资新增 → customer_consult
    await emitMessage({
      message_type: 'customer_consult', business_event: 'customer_consult',
      title: '新顾客咨询', content: `${name}（${phone}）提交了预约${b.hope_date ? '，期望日期 ' + b.hope_date : ''}`,
      rel_id: openid, rel_model: 'customer'
    });

    res.json({ ok: true, message: '提交完成，请等待摄影师确认' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== 2. customer_token 订单只读查看（与 B 端订单详情同口径，只读无编辑） =====
router.get('/order/:token', async (req, res) => {
  try {
    const token = req.params.token;
    const o = await get('SELECT * FROM orders WHERE customer_token = ?', [token]);
    if (!o) return res.status(403).json({ error: '无权限访问该订单' });
    if (o.cancelled || o.is_deleted) return res.status(404).json({ error: '订单不存在或已关闭' });
    // 安全：客户私有链接有效期校验（过期仅提示，不返回订单数据）
    if (o.customer_token_expire_at) {
      const exp = new Date(o.customer_token_expire_at).getTime();
      if (!Number.isNaN(exp) && exp < Date.now()) return res.status(403).json({ error: '访问链接已过期，请联系商家' });
    }

    const safeArr = (t) => { try { const a = JSON.parse(t || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };

    // 套系快照：封面 / 简介 / 价格 / 定金 / 精修 / 加片单价 / 服务详情
    let pkg = {};
    try { if (o.package_snapshot) pkg = JSON.parse(o.package_snapshot) || {}; } catch {}
    const pkgName = pkg.name || '';
    const pkgPrice = parseFloat(pkg.price) || 0;
    const pkgCover = pkg.cover_url || pkg.cover_image || '';
    const pkgDesc = pkg.description || pkg.package_desc || '';
    const pkgNotice = pkg.notice || '';
    const pkgOtherService = pkg.other_service || '';
    const pkgShootDuration = pkg.duration || pkg.shoot_duration || '';
    const pkgShootScope = pkg.raw_policy || pkg.shoot_scope || '';
    const pkgAdditionalPrice = parseFloat(pkg.additional_price) || 0;
    const pkgPhotoTotal = parseInt(pkg.photo_total, 10) || 0;
    const retouchCount = parseInt(pkg.retouch_count, 10) || 0;
    const pkgOriginalFile = pkg.original_file || '';
    // 退订政策（来自套系快照 details；前端用 utils/refundPolicy.js 处理默认兜底）
    const pkgDetails = (pkg && typeof pkg.details === 'object') ? pkg.details : {};
    const refundPolicy = pkgDetails.refund_policy === '宽松' ? '宽松' : '严格';

    // 拍摄时段
    const timeSlots = safeArr(o.time_slots);
    // 执行人
    const executors = safeArr(o.executors).map((x) => ({ name: x.name || '', avatar: x.avatar || '' })).filter((x) => x.name);
    // 消费明细：可选精修片 / 加片费 / 加片优惠 / 其他消费
    const extraItems = safeArr(o.extra_items);

    // 选片入口（选片 V2：/s/:customer_token 直连，仅当已开启选片任务时展示；不再用旧表 selection_tasks）
    const selTaskV2 = await get('SELECT id, status FROM order_select_task WHERE order_id = ? LIMIT 1', [o.id]);
    let selectionUrl = '';
    if (selTaskV2 && selTaskV2.status !== 'not_started' && o.customer_token) {
      selectionUrl = '/s/' + o.customer_token;
    }

    const STATUS_LABEL = { deposit: '已付定金', shot: '已拍摄', selecting: '选片中', retouching: '精修中', delivered: '已交付', completed: '已完成' };
    const PAY_LABEL = { unpaid: '未付定金', deposit: '已付定金', paid: '已付全款' };

    res.json({
      order_no: o.order_no,
      customer_name: o.customer_name,
      groom_name: o.groom_name || '',
      bride_name: o.bride_name || '',
      create_time: o.created_at || '',
      shoot_date: o.shoot_date || '',
      date_tbd: !!Number(o.date_tbd),
      time_slots: timeSlots,
      address: o.address || '',
      status: o.status,
      status_label: STATUS_LABEL[o.status] || o.status,
      // 套系快照
      package: {
        name: pkgName,
        cover: pkgCover,
        desc: pkgDesc,
        price: pkgPrice,
        deposit: parseFloat(o.deposit) || 0,
        retouch_count: retouchCount,
        photo_total: pkgPhotoTotal,
        original_file: pkgOriginalFile,
        additional_price: pkgAdditionalPrice,
        shoot_duration: pkgShootDuration,
        shoot_scope: pkgShootScope,
        other_service: pkgOtherService,
        notice: pkgNotice,
        refund_policy: refundPolicy,
        refund_policy_lax_text: pkgDetails.refund_policy_lax_text || '',
        refund_policy_strict_text: pkgDetails.refund_policy_strict_text || ''
      },
      executors,
      extra_items: extraItems,
      // 金额
      total_amount: parseFloat(o.total_amount) || 0,
      paid_amount: parseFloat(o.paid_amount) || 0,
      balance: parseFloat(o.balance) || 0,
      payment_status: o.payment_status || 'deposit',
      payment_status_label: PAY_LABEL[o.payment_status] || o.payment_status,
      selection_url: selectionUrl,
      order_id: o.id,
      // 合同：只返回是否可下载（有私有文件且未作废），不返回公开 URL；预览/下载走后端鉴权中转
      contract_available: !!(o.contract_file_key && !Number(o.contract_invalid)),
      contract_invalid: !!Number(o.contract_invalid)
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== C 端提交改期/取消申请（仅推送商家，不自动变更订单数据）=====
router.post('/order/:token/request', async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE customer_token = ?', [req.params.token]);
    if (!o) return res.status(403).json({ error: '无权限访问该订单' });
    if (o.cancelled || o.is_deleted) return res.status(404).json({ error: '订单不存在或已关闭' });
    const b = req.body || {};
    const type = ['reschedule', 'cancel'].includes(b.type) ? b.type : 'reschedule';
    const reason = String(b.reason || '').trim().slice(0, 200);
    if (!reason) return res.status(400).json({ error: '请填写申请原因' });
    const desiredDate = type === 'reschedule' ? String(b.desired_date || '').trim() : '';
    const id = await insert(
      'INSERT INTO order_requests (order_id, type, reason, desired_date, status, created_at) VALUES (?,?,?,?,?,?)',
      [o.id, type, reason, desiredDate, 'pending', nowISO()]
    );
    // 推送商家（消息中心）
    const typeLabel = type === 'reschedule' ? '改期申请' : '取消申请';
    await emitMessage({
      message_type: 'customer_consult',
      business_event: 'order_request_' + id,
      title: `客户提交${typeLabel}`,
      content: `${o.customer_name || '客户'}：${reason}${desiredDate ? '（期望日期 ' + desiredDate + '）' : ''}`,
      rel_id: o.id, rel_model: 'order'
    });
    // 待办：客户提交改期/取消申请 → 生成「客户申请」待办（仅提醒，不改订单数据）
    try { await generateEventTodo(o.id, 'order_request', `客户${typeLabel}`, `${o.customer_name || '客户'}：${reason}${desiredDate ? '（期望日期 ' + desiredDate + '）' : ''}`, String(id)); } catch (e) { console.error('[todo] 生成申请待办失败', e.message); }
    res.json({ ok: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== C 端下载作品记录（下载行为留痕，B 端订单详情可查下载记录）=====
router.post('/order/:token/download-log', async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE customer_token = ?', [req.params.token]);
    if (!o) return res.status(403).json({ error: '无权限访问该订单' });
    const itemName = String((req.body && req.body.item_name) || '作品图片').slice(0, 100);
    const itemType = String((req.body && req.body.item_type) || 'work').slice(0, 20);
    await insert('INSERT INTO download_logs (order_id, item_type, item_name, operator_name, created_at) VALUES (?,?,?,?,?)',
      [o.id, itemType, itemName, '客户', nowISO()]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== 3. 电子服务协议签署（C 端手写签名，绑定订单，签署记录不可篡改） =====
// 查询协议签署状态 + 历史签署记录（只读）
router.get('/order/:token/agreement', async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE customer_token = ?', [req.params.token]);
    if (!o) return res.status(403).json({ error: '无权限访问该订单' });
    if (o.customer_token_expire_at) {
      const exp = new Date(o.customer_token_expire_at).getTime();
      if (!Number.isNaN(exp) && exp < Date.now()) return res.status(403).json({ error: '访问链接已过期，请联系商家' });
    }
    const history = await query('SELECT id, customer_name, signed_at, created_at FROM agreement_sign WHERE order_id = ? ORDER BY created_at DESC', [o.id]);
    res.json({
      force_agreement: !!Number(o.force_agreement),
      agreement_signed: !!Number(o.agreement_signed),
      history: history.map((h) => ({ id: h.id, customer_name: h.customer_name || '', signed_at: h.signed_at || h.created_at }))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 客户签署协议（signature=手写签名图片 base64；content_snapshot=签署当时的协议全文，防篡改）
router.post('/order/:token/agreement/sign', async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE customer_token = ?', [req.params.token]);
    if (!o) return res.status(403).json({ error: '无权限访问该订单' });
    if (o.cancelled || o.is_deleted) return res.status(404).json({ error: '订单不存在或已关闭' });
    if (o.customer_token_expire_at) {
      const exp = new Date(o.customer_token_expire_at).getTime();
      if (!Number.isNaN(exp) && exp < Date.now()) return res.status(403).json({ error: '访问链接已过期，请联系商家' });
    }
    const b = req.body || {};
    const signature = String(b.signature || '').trim();
    const content = String(b.content_snapshot || '').trim();
    if (!signature) return res.status(400).json({ error: '请先完成签名' });
    if (!content) return res.status(400).json({ error: '缺少协议内容' });
    const signedAt = nowISO();
    const id = await insert(
      'INSERT INTO agreement_sign (order_id, customer_name, signer_phone, signature, content_snapshot, signed_at, device) VALUES (?,?,?,?,?,?,?)',
      [o.id, String(b.customer_name || o.customer_name || ''), String(b.signer_phone || ''), signature, content, signedAt, String(b.device || 'H5')]
    );
    await run('UPDATE orders SET agreement_signed = 1 WHERE id = ?', [o.id]);
    // 签署留痕（订单变更记录）+ 通知商家
    try {
      await appendOrderLog(o.id, `客户签署电子服务协议（第 ${id} 条签署记录）`, '客户');
      await emitMessage({ message_type: 'order_msg', business_event: 'agreement_signed', title: '客户已签署服务协议', content: `订单 ${o.order_no || o.id} 客户已签署电子服务协议`, rel_id: String(o.id), rel_model: 'order' });
    } catch (e) { console.error('[agreement] 签署通知失败', e.message); }
    res.json({ ok: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
