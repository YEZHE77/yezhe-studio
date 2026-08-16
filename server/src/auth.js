// auth.js —— JWT 认证 + RBAC 角色 + 细粒度权限集合
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { get } from './db.js';

const SECRET = process.env.JWT_SECRET || 'change_me_to_a_long_random_secret';
const EXP = '7d';

// ===== 细粒度权限集合（安全模块）=====
// admin 主账号恒为全权限；子账号按 permissions 字段显式分配。
export const PERMISSIONS = {
  VIEW_ORDERS: 'view_orders',           // 查看订单
  EDIT_PRICE: 'edit_price',             // 修改价格
  EXPORT_CUSTOMERS: 'export_customers', // 导出客户资料
  DELETE_DATA: 'delete_data'            // 删除数据
};
export const PERMISSION_LABELS = {
  view_orders: '查看订单',
  edit_price: '修改价格',
  export_customers: '导出客户资料',
  delete_data: '删除数据'
};

// 预设角色默认权限映射（子账号未单独配置 permissions 时回退）
const ROLE_DEFAULT_PERMS = {
  photographer: ['view_orders'],
  selector: ['view_orders'],
  finance: ['view_orders', 'edit_price']
};

// 解析 permissions 字段（JSON 数组字符串 / 数组 → 字符串数组）
export function parsePermissions(v) {
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string');
  if (typeof v === 'string' && v) { try { const a = JSON.parse(v); return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []; } catch { return []; } }
  return [];
}

// 判断用户是否拥有某权限（admin 恒 true；否则看显式权限集合或角色默认值）
export function hasPerm(user, perm) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const perms = Array.isArray(user.permissions) && user.permissions.length
    ? user.permissions
    : (ROLE_DEFAULT_PERMS[user.role] || []);
  return perms.includes(perm);
}

// 密码强度校验：≥8 位 + 大写 + 小写 + 数字；通过返回 null，否则返回中文错误提示。
export function validatePasswordStrength(pwd) {
  const s = String(pwd || '');
  if (s.length < 8) return '密码至少 8 位';
  if (!/[A-Z]/.test(s)) return '密码需包含大写字母';
  if (!/[a-z]/.test(s)) return '密码需包含小写字母';
  if (!/[0-9]/.test(s)) return '密码需包含数字';
  return null;
}

// 手机号脱敏：138****1234（保留前 3 后 4）；非 11 位则中间打码
export function maskPhone(phone) {
  const s = String(phone || '').trim();
  if (!s) return '';
  if (/^1\d{10}$/.test(s)) return s.slice(0, 3) + '****' + s.slice(7);
  if (s.length >= 7) return s.slice(0, 3) + '****' + s.slice(-2);
  return s;
}

// 是否可查看完整手机号（admin 或拥有「导出客户资料」权限）
export function canViewPhone(user) {
  return !!(user && (user.role === 'admin' || hasPerm(user, PERMISSIONS.EXPORT_CUSTOMERS)));
}

export function signToken(user) {
  return jwt.sign({ uid: user.id, role: user.role, username: user.username }, SECRET, { expiresIn: EXP });
}

export function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// 登录校验中间件：验 JWT 后查库取最新角色/权限/禁用状态（禁用即 403，改权限实时生效）
export function authRequired(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  let payload;
  try { payload = jwt.verify(token, SECRET); }
  catch { return res.status(401).json({ error: '未登录或登录已过期' }); }
  get('SELECT id, username, role, name, permissions, disabled FROM users WHERE id = ?', [payload.uid])
    .then((u) => {
      if (!u) return res.status(401).json({ error: '用户不存在' });
      if (u.disabled) return res.status(403).json({ error: '账号已被禁用，请联系管理员' });
      req.user = { ...payload, role: u.role, name: u.name, permissions: parsePermissions(u.permissions) };
      next();
    })
    .catch(() => res.status(401).json({ error: '认证失败' }));
}

// 角色校验：requireRole('admin','finance') 或 requireRole(['admin','finance']) 均可
export function requireRole(...roles) {
  let list = roles;
  if (roles.length === 1 && Array.isArray(roles[0])) list = roles[0];
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '未登录' });
    if (list.length && !list.includes(req.user.role)) {
      return res.status(403).json({ error: '权限不足（需要：' + list.join('/') + '）' });
    }
    next();
  };
}

// 细粒度权限校验：requirePerm(PERMISSIONS.EDIT_PRICE) —— admin 恒通过，子账号按权限集合判定
export function requirePerm(perm) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '未登录' });
    if (!hasPerm(req.user, perm)) return res.status(403).json({ error: '权限不足（需要：' + (PERMISSION_LABELS[perm] || perm) + '）' });
    next();
  };
}

// 商家角色集合：登录后台的商户（admin/photographer/selector/finance）一律视为内部人员；
// 客户 JWT（role='customer'）不在此列，故不会触发「管理员跳过」逻辑。
export const MERCHANT_ROLES = ['admin', 'photographer', 'selector', 'finance'];

// 非抛错地解析请求里的商家令牌：仅当角色属于 MERCHANT_ROLES 时才返回 payload，否则返回 null。
// 用于公开分享网关判断「是否为管理员从后台进入」——是则跳过相册密码锁。
export function peekUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return null;
  try {
    const payload = jwt.verify(token, SECRET);
    if (payload && MERCHANT_ROLES.includes(payload.role)) return payload;
    return null;
  } catch {
    return null;
  }
}

// ===== 客户侧 JWT（C 端小程序）=====
// 与商家 JWT 隔离：payload 只含 openid + customerId，不可冒充商家角色。
export function signCustomerToken(customer) {
  return jwt.sign(
    { openid: customer.openid, customerId: customer.id, role: 'customer' },
    SECRET,
    { expiresIn: '30d' }
  );
}

// 客户鉴权中间件：从 Authorization: Bearer <token> 解析可信 openid
// 验证失败一律 401；req.customer = { openid, customerId }
export function customerRequired(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return res.status(401).json({ error: '请先登录小程序' });
  try {
    const payload = jwt.verify(token, SECRET);
    if (payload.role !== 'customer') return res.status(403).json({ error: '令牌类型错误' });
    req.customer = { openid: payload.openid, customerId: payload.customerId };
    next();
  } catch {
    res.status(401).json({ error: '登录已过期，请重新打开小程序' });
  }
}

// ===== 手机号查订单查询会话 token（C 端自助查单，验证码通过后签发）=====
// 与商家/客户 JWT 隔离：payload 只含 phone + role='query'，短时效 30 分钟。
// 用于订单详情 / 合同预览鉴权（免重复验证码），不可用于任何写操作。
export function signQueryToken(phone) {
  return jwt.sign({ phone, role: 'query' }, SECRET, { expiresIn: '30m' });
}

// 校验查询会话 token，成功返回绑定的手机号，失败/类型不符返回 null
export function verifyQueryToken(token) {
  if (!token) return null;
  try {
    const p = jwt.verify(token, SECRET);
    if (p.role !== 'query') return null;
    return String(p.phone || '');
  } catch {
    return null;
  }
}
