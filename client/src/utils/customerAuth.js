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

export function maskPhone(p) {
  const s = String(p || '').trim();
  if (/^1\d{10}$/.test(s)) return s.slice(0, 3) + '****' + s.slice(7);
  return s;
}
