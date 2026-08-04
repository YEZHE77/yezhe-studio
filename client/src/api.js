import axios from 'axios';

// 生产：Netlify 构建时注入 VITE_API_BASE=https://你的render地址.onrender.com
// 开发：留空，由 vite.config.js 的 proxy 转发到本地 4000
const BASE = import.meta.env.VITE_API_BASE || '';

const http = axios.create({ baseURL: BASE });

http.interceptors.request.use((cfg) => {
  const t = localStorage.getItem('token');
  if (t) cfg.headers.Authorization = 'Bearer ' + t;
  return cfg;
});

http.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response && err.response.status === 401) {
      localStorage.removeItem('token');
      if (location.pathname !== '/login') location.href = '/login';
    }
    return Promise.reject(err);
  }
);

// 图片地址补全（本地 /uploads 在开发期由代理处理；生产需拼 Render 地址）
export function img(url) {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  if (url.startsWith('/uploads')) return BASE + url;
  return url;
}

export default http;
