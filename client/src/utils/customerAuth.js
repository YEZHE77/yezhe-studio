import axios from 'axios';
import { BASE } from '../api.js';

// C 端客户手机号验证码登录专用实例：withCredentials 携带 HttpOnly 会话 cookie（与商家 token 完全隔离）
export const customerHttp = axios.create({ baseURL: BASE, timeout: 15000, withCredentials: true });

export function maskPhone(p) {
  const s = String(p || '').trim();
  if (/^1\d{10}$/.test(s)) return s.slice(0, 3) + '****' + s.slice(7);
  return s;
}
