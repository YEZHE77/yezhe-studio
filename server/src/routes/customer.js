// routes/customer.js —— C 端小程序客户接口（行级隔离：只能访问自己 openid 绑定的数据）
// 所有写/私有读均经 customerRequired 解析可信 openid（来自客户 JWT，不可伪造）。
import { Router } from 'express';
import { query, get, insert, run } from '../db.js';
import { parseRow } from '../schema.js';
import { customerRequired, signCustomerToken } from '../auth.js';
import { serverError, FORBIDDEN_VIEW_MSG } from '../httpError.js';

const router = Router();
const JSON_COLS = ['package_snapshot', 'addons_snapshot', 'logs', 'questionnaire_answers'];

function nowISO() { return new Date().toISOString(); }

// 取订单并校验归属：openid 不匹配或无绑定 → 403
// 越权判定：查不到 与 非本人 返回【完全相同】的 403 文案，
// 避免「订单是否存在」被遍历探测（验收清单 2.4 / 黑名单）。
// ⚠️ 改动此处请同步 orderDetailHelper / customerMine 的同类判定。
async function ownOrderOrFail(orderId, openid) {
  const o = await get('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!o) return { status: 403, msg: FORBIDDEN_VIEW_MSG };
  if (o.openid && o.openid !== openid) return { status: 403, msg: FORBIDDEN_VIEW_MSG };
  return { order: o };
}

// 取订单关联的作品（works.order_id = order.id）
async function linkedWorks(orderId) {
  const rows = await query('SELECT id, title, cover_url, allow_download, is_public FROM works WHERE order_id = ? ORDER BY id DESC', [orderId]);
  return rows.map((r) => ({ ...r, allow_download: r.allow_download ? 1 : 0 }));
}

// ===== 0. H5 手机号登录（零成本，无短信验证，手机号即身份标识）=====
// 用手机号生成确定性 openid（h5_<phone>），upsert customers，并回填该手机号名下尚无 openid 绑定的订单/预约
router.post('/phone-login', async (req, res) => {
  try {
    const phone = String((req.body && req.body.phone) || '').trim();
    if (!/^1\d{10}$/.test(phone)) return res.status(400).json({ error: '请输入正确的 11 位手机号' });
    const openid = 'h5_' + phone;
    const now = nowISO();
    let c = await get('SELECT * FROM customers WHERE openid = ?', [openid]);
    if (!c) {
      const id = await insert('INSERT INTO customers (openid, phone, created_at, updated_at) VALUES (?,?,?,?)', [openid, phone, now, now]);
      c = { id, openid, phone };
    } else {
      await run('UPDATE customers SET phone = ?, updated_at = ? WHERE id = ?', [phone, now, c.id]);
      c.phone = phone;
    }
    // 回填：该手机号名下尚无 openid 绑定的订单/预约，绑定到本次登录的客户身份
    await run("UPDATE orders SET openid = ? WHERE (openid IS NULL OR openid = '') AND (customer_phone = ? OR phones LIKE '%' || ? || '%')", [openid, phone, phone]);
    await run("UPDATE appointments SET openid = ? WHERE (openid IS NULL OR openid = '') AND phone = ?", [openid, phone]);
    const token = signCustomerToken({ openid: c.openid, id: c.id });
    res.json({ token, openid: c.openid, customerId: c.id, phone });
  } catch (e) {
    serverError(res, e);
  }
});

// ===== 0.1 当前客户信息已迁至 customerMine（/api/customer/me，免验证码 cookie 会话），openid 版移除 =====

// ===== 1. 预约提交 =====
router.post('/appointment/submit', customerRequired, async (req, res) => {
  try {
    const openid = req.customer.openid;
    const b = req.body || {};
    const name = (b.name || '').trim();
    const phone = (b.phone || '').trim();
    if (!name || !phone) return res.status(400).json({ error: '请填写称呼与联系电话' });
    const period = ['full', 'half'].includes(b.period) ? b.period : 'full';
    let pkgName = '';
    if (b.packageId) {
      const p = await get('SELECT name FROM packages WHERE id = ?', [b.packageId]);
      pkgName = p ? p.name : '';
    }
    const id = await insert(
      `INSERT INTO appointments (openid, name, phone, package_id, spec_id, hope_date, remark, status, period, source, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [openid, name, phone, b.packageId || null, b.specId || null, b.hopeDate || '', b.remark || '', 'pending', period, 'mini', nowISO()]
    );
    res.json({ ok: true, appointmentId: id, packageName: pkgName });
  } catch (e) {
    serverError(res, e);
  }
});

// ===== 1.1 客户取消预约申请（不直接释放档期/订单，仅改状态，需 B 端处理）=====
router.post('/appointment/cancel', customerRequired, async (req, res) => {
  try {
    const openid = req.customer.openid;
    const id = req.body && req.body.id;
    if (!id) return res.status(400).json({ error: '缺少预约 id' });
    const a = await get('SELECT * FROM appointments WHERE id = ?', [id]);
    if (!a) return res.status(404).json({ error: '预约不存在' });
    if (a.openid !== openid) return res.status(403).json({ error: '无权操作该预约' });
    if (a.status !== 'pending' && a.status !== 'confirmed') {
      return res.status(400).json({ error: '该预约状态不可取消' });
    }
    await run("UPDATE appointments SET status = 'cancelled', handled_at = ? WHERE id = ?", [nowISO(), id]);
    // 注意：已确认（含关联档期/订单）的取消不直接释放档期，需商户端处理
    res.json({ ok: true });
  } catch (e) {
    serverError(res, e);
  }
});

// ===== 2. 我的预约列表（含套系问卷模板 / 规格 / 关联订单问卷答案，供 C 端确认后弹问卷）=====
router.get('/appointment/list', customerRequired, async (req, res) => {
  try {
    const rows = await query(
      `SELECT a.*, p.name AS package_name, p.questionnaire AS package_questionnaire, p.specs AS package_specs,
              o.questionnaire_answers AS questionnaire_answers, o.id AS order_id
       FROM appointments a
       LEFT JOIN packages p ON p.id = a.package_id
       LEFT JOIN orders o ON o.id = a.order_id
       WHERE a.openid = ? ORDER BY a.id DESC`,
      [req.customer.openid]
    );
    const out = rows.map((a) => {
      let questionnaire = '', specs = [];
      try { questionnaire = a.package_questionnaire ? JSON.parse(a.package_questionnaire) : ''; } catch { questionnaire = a.package_questionnaire || ''; }
      try { specs = a.package_specs ? JSON.parse(a.package_specs) : []; } catch { specs = []; }
      let answers = {};
      try { answers = a.questionnaire_answers ? JSON.parse(a.questionnaire_answers) : {}; } catch { answers = {}; }
      return { ...a, package_questionnaire: questionnaire, package_specs: specs, questionnaire_answers: answers, order_id: a.order_id || null };
    });
    res.json(out);
  } catch (e) {
    serverError(res, e);
  }
});

// ===== 3. 我的订单列表 =====
router.get('/order/list', customerRequired, async (req, res) => {
  try {
    const rows = await query(
      `SELECT * FROM orders WHERE openid = ? AND cancelled = 0 ORDER BY id DESC`,
      [req.customer.openid]
    );
    const out = [];
    for (const o of rows) {
      const order = parseRow(o, JSON_COLS);
      let pkgName = '';
      if (o.package_id) { const p = await get('SELECT name FROM packages WHERE id = ?', [o.package_id]); pkgName = p ? p.name : ''; }
      const works = await linkedWorks(o.id);
      out.push({ ...order, packageName: pkgName, works, hasAlbum: works.length > 0 });
    }
    res.json(out);
  } catch (e) {
    serverError(res, e);
  }
});

// ===== 4. 订单详情（含收款流水 + 关联作品 + 选片/评价状态）=====
router.get('/order/:orderId', customerRequired, async (req, res) => {
  try {
    const r = await ownOrderOrFail(req.params.orderId, req.customer.openid);
    if (r.status) return res.status(r.status).json({ error: r.msg });
    const o = r.order;
    const order = parseRow(o, JSON_COLS);
    const payments = await query('SELECT * FROM payments WHERE order_id = ? ORDER BY created_at ASC', [o.id]);
    let pkgName = '';
    if (o.package_id) { const p = await get('SELECT name FROM packages WHERE id = ?', [o.package_id]); pkgName = p ? p.name : ''; }
    const works = await linkedWorks(o.id);
    const sel = await get('SELECT submitted FROM photo_select WHERE order_id = ? AND openid = ? ORDER BY id DESC LIMIT 1', [o.id, req.customer.openid]);
    const ev = await get('SELECT id, status FROM evaluates WHERE order_id = ? AND openid = ? ORDER BY id DESC LIMIT 1', [o.id, req.customer.openid]);
    res.json({
      ...order, payments, packageName: pkgName, works,
      photoSelectSubmitted: !!(sel && sel.submitted),
      evaluated: !!ev, evaluateStatus: ev ? ev.status : null
    });
  } catch (e) {
    serverError(res, e);
  }
});

// ===== 4.1 客户填写拍摄问卷（确认后回写订单，与下单时刻套系快照隔离）=====
router.post('/orders/:orderId/questionnaire', customerRequired, async (req, res) => {
  try {
    const r = await ownOrderOrFail(req.params.orderId, req.customer.openid);
    if (r.status) return res.status(r.status).json({ error: r.msg });
    const answers = req.body && req.body.answers;
    if (!answers || typeof answers !== 'object') return res.status(400).json({ error: '问卷内容无效' });
    await run('UPDATE orders SET questionnaire_answers = ? WHERE id = ?', [JSON.stringify(answers), r.order.id]);
    res.json({ ok: true });
  } catch (e) {
    serverError(res, e);
  }
});

// ===== 5. 成片相册（只返 sample/final 小样，绝不返 local 原片；越权 403）=====
router.get('/album/:orderId', customerRequired, async (req, res) => {
  try {
    const r = await ownOrderOrFail(req.params.orderId, req.customer.openid);
    if (r.status) return res.status(r.status).json({ error: r.msg });
    const works = await linkedWorks(r.order.id);
    const photos = [];
    let allowDownload = 0;
    for (const w of works) {
      const albums = await query("SELECT id, zone, photo_url, sort FROM albums WHERE work_id = ? AND zone != 'local' ORDER BY zone, sort", [w.id]);
      allowDownload = Math.max(allowDownload, w.allow_download ? 1 : 0);
      for (const a of albums) photos.push({ ...a, workTitle: w.title });
    }
    res.json({ photos, allowDownload, works });
  } catch (e) {
    serverError(res, e);
  }
});

// ===== 6. 在线选片 =====
// 保存草稿（submitted=0）
router.post('/photo-select/save', customerRequired, async (req, res) => {
  try {
    const openid = req.customer.openid;
    const b = req.body || {};
    const r = await ownOrderOrFail(b.orderId, openid);
    if (r.status) return res.status(r.status).json({ error: r.msg });
    const marks = Array.isArray(b.marks) ? b.marks : [];
    const draft = JSON.stringify(b.draft !== undefined ? b.draft : marks);
    const existing = await get('SELECT id FROM photo_select WHERE order_id = ? AND openid = ? ORDER BY id DESC LIMIT 1', [b.orderId, openid]);
    if (existing) {
      await run('UPDATE photo_select SET draft = ?, marks = ?, submitted = 0, updated_at = ? WHERE id = ?',
        [draft, JSON.stringify(marks), nowISO(), existing.id]);
    } else {
      await insert('INSERT INTO photo_select (order_id, openid, marks, draft, submitted, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
        [b.orderId, openid, JSON.stringify(marks), draft, 0, nowISO(), nowISO()]);
    }
    res.json({ ok: true, count: marks.length, submitted: false });
  } catch (e) {
    serverError(res, e);
  }
});

// 提交选片（submitted=1，商户端可见）
router.post('/photo-select/submit', customerRequired, async (req, res) => {
  try {
    const openid = req.customer.openid;
    const b = req.body || {};
    const r = await ownOrderOrFail(b.orderId, openid);
    if (r.status) return res.status(r.status).json({ error: r.msg });
    const marks = Array.isArray(b.marks) ? b.marks : [];
    const existing = await get('SELECT id FROM photo_select WHERE order_id = ? AND openid = ? ORDER BY id DESC LIMIT 1', [b.orderId, openid]);
    if (existing) {
      await run('UPDATE photo_select SET marks = ?, draft = ?, submitted = 1, updated_at = ? WHERE id = ?',
        [JSON.stringify(marks), JSON.stringify(marks), nowISO(), existing.id]);
    } else {
      await insert('INSERT INTO photo_select (order_id, openid, marks, draft, submitted, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
        [b.orderId, openid, JSON.stringify(marks), JSON.stringify(marks), 1, nowISO(), nowISO()]);
    }
    res.json({ ok: true, count: marks.length, submitted: true });
  } catch (e) {
    serverError(res, e);
  }
});

// 读取我的选片（含可选择的 sample 小样照片）
router.get('/photo-select/:orderId', customerRequired, async (req, res) => {
  try {
    const openid = req.customer.openid;
    const r = await ownOrderOrFail(req.params.orderId, openid);
    if (r.status) return res.status(r.status).json({ error: r.msg });
    const sel = await get('SELECT * FROM photo_select WHERE order_id = ? AND openid = ? ORDER BY id DESC LIMIT 1', [req.params.orderId, openid]);
    const works = await linkedWorks(r.order.id);
    const photos = [];
    for (const w of works) {
      const albums = await query("SELECT id, zone, photo_url, sort FROM albums WHERE work_id = ? AND zone = 'sample' ORDER BY sort", [w.id]);
      for (const a of albums) photos.push({ ...a, workTitle: w.title });
    }
    res.json({
      selection: sel ? { marks: sel.marks ? JSON.parse(sel.marks) : [], submitted: !!sel.submitted, draft: sel.draft ? JSON.parse(sel.draft) : [] } : null,
      photos
    });
  } catch (e) {
    serverError(res, e);
  }
});

// ===== 7. 评价 =====
router.post('/evaluate/submit', customerRequired, async (req, res) => {
  try {
    const openid = req.customer.openid;
    const b = req.body || {};
    const r = await ownOrderOrFail(b.orderId, openid);
    if (r.status) return res.status(r.status).json({ error: r.msg });
    const stars = Math.min(5, Math.max(1, parseInt(b.stars) || 5));
    const images = Array.isArray(b.images) ? b.images : [];
    const id = await insert(
      `INSERT INTO evaluates (order_id, openid, stars, text, images, status, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [b.orderId, openid, stars, (b.text || '').trim(), JSON.stringify(images), 'pending', nowISO()]
    );
    res.json({ ok: true, evaluateId: id });
  } catch (e) {
    serverError(res, e);
  }
});

// 我的评价列表
router.get('/evaluate/list', customerRequired, async (req, res) => {
  try {
    const { orderId } = req.query;
    let sql = 'SELECT * FROM evaluates WHERE openid = ?';
    const params = [req.customer.openid];
    if (orderId) { sql += ' AND order_id = ?'; params.push(orderId); }
    sql += ' ORDER BY id DESC';
    const rows = await query(sql, params);
    res.json(rows.map((r) => ({ ...r, images: r.images ? JSON.parse(r.images) : [] })));
  } catch (e) {
    serverError(res, e);
  }
});

// 公开好评墙（已审核通过，首页展示用，无需登录）
router.get('/evaluate/public', async (req, res) => {
  try {
    const rows = await query(
      `SELECT e.stars, e.text, e.images, e.created_at, o.customer_name
       FROM evaluates e LEFT JOIN orders o ON o.id = e.order_id
       WHERE e.status = 'approved' ORDER BY e.id DESC LIMIT 20`,
      []
    );
    res.json(rows.map((r) => ({ ...r, images: r.images ? JSON.parse(r.images) : [] })));
  } catch (e) {
    serverError(res, e);
  }
});

export default router;
