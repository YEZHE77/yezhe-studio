// auth.js —— JWT 认证 + RBAC 角色
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const SECRET = process.env.JWT_SECRET || 'change_me_to_a_long_random_secret';
const EXP = '7d';

export function signToken(user) {
  return jwt.sign({ uid: user.id, role: user.role, username: user.username }, SECRET, { expiresIn: EXP });
}

export function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// 登录校验中间件
export function authRequired(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: '未登录或登录已过期' });
  }
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
