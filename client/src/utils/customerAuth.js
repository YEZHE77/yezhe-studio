import axios from 'axios';
import { BASE } from '../api.js';

// C 端客户手机号登录专用实例：localStorage 持久 Bearer token（跨站不掉登录，解决第三方 cookie 被拦），
// 同时保留 withCredentials 以兼容同站 / 旧 cookie 兜底；与商家 token 完全隔离。
const TOKEN_KEY = 'cust_sid';

export function getCustomerToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}
export function setCustomerToken(sid) {
  try { if (sid) localStorage.setItem(TOKEN_KEY, sid); else localStorage.removeItem(TOKEN_KEY); } catch {}
}
export function clearCustomerToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
}

export const customerHttp = axios.create({ baseURL: BASE, timeout: 15000, withCredentials: true });

// 每次请求附带 Bearer token（来自 localStorage，刷新后仍在 → 登录态持久）；未登录（无 token）时不附加
customerHttp.interceptors.request.use((config) => {
  const t = getCustomerToken();
  if (t) {
    config.headers = config.headers || {};
    config.headers.Authorization = 'Bearer ' + t;
  }
  return config;
});

// ===== 登录回跳（验收清单 2.1 / 黑名单第 2 条）=====
// 需求：未登录直接访问需鉴权的页面时，要记住原 URL，登录成功后回到【原页面】，
//       而不是一律跳到「我的」首页。
// 用法：受保护页面在跳转登录前调用 goLogin(nav)，会把当前 pathname+search 存到 ?redirect=；
//       CustomerLogin 登录成功后读该参数回跳（默认 /customer/mine）。
export const CUSTOMER_HOME = '/customer/mine';

export function goLogin(nav, currentPath) {
  let target = currentPath;
  if (!target && typeof window !== 'undefined' && window.location) {
    target = window.location.pathname + (window.location.search || '');
  }
  // 安全：只接受站内路径，避免 ?redirect= 被构造成外部钓鱼地址（开放重定向）
  const safe = target && /^\/[^/]/.test(target) && !/^\/\//.test(target) ? target : CUSTOMER_HOME;
  nav('/customer/login?redirect=' + encodeURIComponent(safe));
}

// 解析 redirect 参数（同样做站内校验）
export function resolveRedirect(raw) {
  try {
    const v = String(raw || '').trim();
    if (!v) return CUSTOMER_HOME;
    const decoded = decodeURIComponent(v);
    if (/^\/[^/]/.test(decoded) && !/^\/\//.test(decoded)) return decoded;
  } catch { /* 解码失败回落默认 */ }
  return CUSTOMER_HOME;
}

export function maskPhone(p) {
  const s = String(p || '').trim();
  if (/^1\d{10}$/.test(s)) return s.slice(0, 3) + '****' + s.slice(7);
  return s;
}
