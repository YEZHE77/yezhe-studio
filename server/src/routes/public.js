// routes/public.js —— C 端公开接口（H5，无需登录）
// 职责：公开预约表单提交 / customer_token 订单只读查看
// 约束：C 端只能提交预约 + 浏览套系 + 只读查看自己订单 + 选片标记；绝不暴露任何编辑/删除/上传能力。
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query, get, insert, run } from '../db.js';
import { buildCustomerOrderDetail } from './orderDetailHelper.js';
import { emitMessage } from './message.js';
import { emitBizToStaff, BIZ_TYPE } from './mobileMessage.js';
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
    const styleReq = String(b.style_req || '').trim();
    const id = await insert(
      `INSERT INTO appointments (openid, name, phone, package_id, hope_date, remark, status, period, source, style_req, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [openid, name, phone, b.package_id || null, b.hope_date || '', b.remark || '', 'pending', period, 'h5', styleReq, nowISO()]
    );

    // 消息中心：客资新增 → customer_consult
    await emitMessage({
      message_type: 'customer_consult', business_event: 'customer_consult',
      title: '新顾客咨询', content: `${name}（${phone}）提交了预约${b.hope_date ? '，期望日期 ' + b.hope_date : ''}${styleReq ? '，风格 ' + styleReq : ''}`,
      rel_id: openid, rel_model: 'customer'
    });

    // 订单消息子类型：预约消息 reserve（订单消息二级页「预约消息」入口展示；biz_id 存预约 id，点击跳预约管理页）
    try {
      await emitBizToStaff({
        title: '新预约', content: `${name}（${phone}）提交了预约${b.hope_date ? '，期望日期 ' + b.hope_date : ''}${styleReq ? '，风格 ' + styleReq : ''}`,
        biz_type: BIZ_TYPE.ORDER, biz_id: id, sub_type: 'reserve',
        biz_extra: JSON.stringify({ appointmentId: id })
      });
    } catch (e) { console.error('[public] 生成预约消息失败：', e.message); }

    // 待办：新预约待确认（order_id=0 表示尚未转订单的预约待办；biz_key 关联预约 id 去重）
    try {
      await insert(
        'INSERT INTO todo_items (order_id, todo_type, title, content, status, biz_key) VALUES (?,?,?,?,?,?)',
        [0, 'appointment', '新预约待确认', `${name}（${phone}）提交预约${b.hope_date ? '，期望日期 ' + b.hope_date : ''}${styleReq ? '，风格 ' + styleReq : ''}${b.remark ? '，备注：' + b.remark : ''}`, 'pending', `appointment_${id}`]
      );
    } catch (e) { console.error('[public] 生成预约待办失败：', e.message); }

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

    res.json(await buildCustomerOrderDetail(o));
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

// ===== 访客埋点模块（V2；C 端公开，无需登录） =====
// 访客访问校验：黑名单拦截 + 访客密码开关（供 C 端页面加载前判断）
router.get('/visitor/access', async (req, res) => {
  try {
    const vid = String(req.query.visitor_id || '').trim();
    if (!vid) return res.json({ blocked: false, need_password: false });
    const bl = await get('SELECT visitor_id FROM visitor_blacklist WHERE visitor_id = ?', [vid]);
    const setting = await get('SELECT visitor_password FROM visitor_setting WHERE business_uid = 0');
    res.json({ blocked: !!bl, need_password: !!(setting && setting.visitor_password) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 访客密码校验（bcrypt compare；未开启密码恒通过）
router.post('/visitor/verify-password', async (req, res) => {
  try {
    const password = String((req.body && req.body.password) || '');
    const setting = await get('SELECT visitor_password FROM visitor_setting WHERE business_uid = 0');
    if (!setting || !setting.visitor_password) return res.json({ ok: true });
    const ok = await bcrypt.compare(password, setting.visitor_password);
    res.json({ ok });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 访客埋点上报：写访问日志（黑名单命中拦截不写；免打扰不影响日志写入，仅不产生消息通知）
router.post('/visitor/track', async (req, res) => {
  try {
    const { visitor_id, visit_page, source } = req.body || {};
    const vid = String(visitor_id || '').trim();
    if (!vid) return res.status(400).json({ error: 'visitor_id 缺失' });
    const bl = await get('SELECT visitor_id FROM visitor_blacklist WHERE visitor_id = ?', [vid]);
    if (bl) return res.json({ ok: true, blocked: true });
    await insert(
      'INSERT INTO visitor_log (visitor_id, visit_time, visit_page, source, business_uid) VALUES (?,?,?,?,?)',
      [vid, new Date().toISOString(), visit_page || '', source || 'h5', 0]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
