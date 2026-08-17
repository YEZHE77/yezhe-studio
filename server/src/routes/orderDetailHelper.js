// routes/orderDetailHelper.js —— C 端订单详情共用构建器（单一数据源，避免 public.js / customerMine.js 两份副本漂移）
// 入参：orders 表完整行 o；返回与 B 端订单详情同口径的 C 端只读详情对象。
// 安全：不返回备注(remark/appointment_remark/external_remark)与订单变更记录(logs)。
import { get } from '../db.js';

export async function buildCustomerOrderDetail(o) {
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
  // 简化订单状态（预约转订单体系）：优先展示 order_status，旧订单回退到 status
  const ORDER_STATUS = { pending_deposit: '待付定金', deposit_paid: '已付定金', shot_done: '拍摄完成', completed: '已完结', cancelled: '已取消' };

  return {
    order_no: o.order_no,
    customer_name: o.customer_name,
    groom_name: o.groom_name || '',
    bride_name: o.bride_name || '',
    create_time: o.created_at || '',
    shoot_date: o.shoot_date || '',
    date_tbd: !!Number(o.date_tbd),
    time_slots: timeSlots,
    address: o.address || '',
    status: o.order_status || o.status,
    status_label: ORDER_STATUS[o.order_status] || STATUS_LABEL[o.status] || o.status,
    order_status: o.order_status || '',
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
      refund_policy_strict_text: pkgDetails.refund_policy_strict_text || '',
      // 完整套系 details JSON（含交付时间/交付备注/顾客协议/快修费/服务地点/化妆服装/提供相册等），供 C 端订单详情展示完整套系内容
      details: pkgDetails
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
  };
}
