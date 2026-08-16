import http from '../api.js';

// 访客设备指纹（V2）：localStorage uuid 为主（持久标识），无 localStorage 环境回退一次性随机 id。
// H5 无微信企业环境，无法获取微信昵称/手机号，故仅以设备 id 标识访客。
const KEY = 'visitor_id';

export function getVisitorId() {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = 'v_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return 'v_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }
}

// 访问校验：黑名单拦截 + 访客密码开关（返回 { blocked, need_password }）
export function checkVisitorAccess() {
  return http.get('/api/public/visitor/access', { params: { visitor_id: getVisitorId() } })
    .then((r) => r.data)
    .catch(() => ({ blocked: false, need_password: false }));
}

// 访客密码校验（bcrypt compare；未开启恒通过）
export function verifyVisitorPassword(password) {
  return http.post('/api/public/visitor/verify-password', { password }).then((r) => !!r.data.ok).catch(() => false);
}

// 埋点上报（fire-and-forget，失败静默）
export function trackVisit(page, source) {
  return http.post('/api/public/visitor/track', { visitor_id: getVisitorId(), visit_page: page, source: source || 'h5' }).catch(() => {});
}

// 访客密码会话标记（同一浏览器会话内免重复输入）
const PW_KEY = 'visitor_pw_ok';
export function hasPasswordGrant() {
  try { return sessionStorage.getItem(PW_KEY) === '1'; } catch { return false; }
}
export function setPasswordGrant(v) {
  try { if (v) sessionStorage.setItem(PW_KEY, '1'); else sessionStorage.removeItem(PW_KEY); } catch {}
}
