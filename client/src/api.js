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

// 前端上传前压缩：长边不超过 maxWidth/maxHeight，质量 quality，<800KB 或不是图片则跳过
export function compressImage(file, { maxWidth = 1920, maxHeight = 1920, quality = 0.82, type = 'image/jpeg' } = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return resolve(file);
    if (file.size < 800 * 1024) return resolve(file);
    const src = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(src);
      let { width, height } = image;
      if (width > maxWidth || height > maxHeight) {
        const scale = Math.min(maxWidth / width, maxHeight / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error('图片压缩失败'));
        const name = (file.name || 'image').replace(/\.[^.]+$/, '.jpg');
        resolve(new File([blob], name, { type, lastModified: file.lastModified }));
      }, type, quality);
    };
    image.onerror = () => {
      URL.revokeObjectURL(src);
      reject(new Error('图片加载失败'));
    };
    image.src = src;
  });
}

export default http;
