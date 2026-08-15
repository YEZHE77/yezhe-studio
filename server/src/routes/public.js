// routes/public.js —— C 端公开接口（H5，无需登录）
// 职责：公开预约表单提交 / customer_token 订单只读查看
// 约束：C 端只能提交预约 + 浏览套系 + 只读查看自己订单 + 选片标记；绝不暴露任何编辑/删除/上传能力。
import { Router } from 'express';
import { query, get, insert } from '../db.js';
import { emitMessage } from './message.js';

const router = Router();

function nowISO() { return new Date().toISOString(); }

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

    // 拍摄时段
    const timeSlots = safeArr(o.time_slots);
    // 执行人
    const executors = safeArr(o.executors).map((x) => ({ name: x.name || '', avatar: x.avatar || '' })).filter((x) => x.name);
    // 消费明细：可选精修片 / 加片费 / 加片优惠 / 其他消费
    const extraItems = safeArr(o.extra_items);

    // 选片入口
    const selTask = await get('SELECT id FROM selection_tasks WHERE order_id = ? ORDER BY id DESC LIMIT 1', [o.id]);
    let selectionUrl = '';
    if (selTask) {
      const share = await get('SELECT token FROM shares WHERE type = ? AND ref_id = ?', ['selection', selTask.id]);
      if (share) selectionUrl = '/s/' + share.token;
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
        notice: pkgNotice
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

export default router;
