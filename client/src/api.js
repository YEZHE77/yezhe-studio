import axios from 'axios';

// 生产：Netlify 构建时注入 VITE_API_BASE=https://你的render地址.onrender.com
// 开发：留空，由 vite.config.js 的 proxy 转发到本地 4000
const BASE = import.meta.env.VITE_API_BASE || '';
const TIMEOUT = 15000; // 15 秒超时

const http = axios.create({ baseURL: BASE, timeout: TIMEOUT });

http.interceptors.request.use((cfg) => {
  const t = localStorage.getItem('token');
  if (t) cfg.headers.Authorization = 'Bearer ' + t;
  // 支持外部传入 signal（AbortController）
  if (cfg.signal) cfg.cancelToken = new axios.CancelToken((c) => {
    cfg.signal.addEventListener('abort', () => c('aborted'));
  });
  return cfg;
});

// 是否需要静默处理（不弹 toast）
let silentMode = false;
export function setSilent(v) { silentMode = v; }

// 弱网友好：离线时弹一次提示
let offlineWarned = false;

http.interceptors.response.use(
  (r) => r,
  (err) => {
    if (axios.isCancel(err)) return Promise.reject({ type: 'cancel', message: '请求已取消' });
    if (err.code === 'ECONNABORTED') {
      if (!silentMode) toast('请求超时，请检查网络连接');
      return Promise.reject({ type: 'timeout', message: '请求超时' });
    }
    if (!err.response) {
      if (!silentMode && !offlineWarned) {
        offlineWarned = true;
        toast('网络连接失败，服务器可能正在启动中（约10秒）');
        setTimeout(() => { offlineWarned = false; }, 10000);
      }
      return Promise.reject({ type: 'network', message: '网络连接失败' });
    }
    if (err.response.status === 401) {
      localStorage.removeItem('token');
      if (location.pathname !== '/login') location.href = '/login';
      return Promise.reject({ type: 'auth', message: '登录已过期' });
    }
    const msg = (err.response.data && err.response.data.error) || ('请求失败(' + err.response.status + ')');
    if (!silentMode) toast(msg);
    return Promise.reject({ ...err, message: msg, type: 'server' });
  }
);

// 简易内联 toast（零依赖，替代各页面重复代码）
let toastTimer;
function toast(msg) {
  const id = '__api_toast__';
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999;background:#1f2329;color:#fff;padding:10px 24px;border-radius:10px;font-size:14px;white-space:nowrap;box-shadow:0 4px 20px rgba(0,0,0,.2);transition:opacity .3s;pointer-events:none;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { if (el) el.style.opacity = '0'; }, 3000);
}

// 防抖工具（用于搜索框）
export function debounce(fn, delay = 300) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), delay);
  };
}

// 图片地址补全（本地 /uploads 在开发期由代理处理；生产需拼 Render 地址）
export function img(url) {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  if (url.startsWith('/uploads')) return BASE + url;
  return url;
}

// 获取缩略图 URL（支持 CDN 裁剪参数，Worker 支持后生效）
export function thumb(url, width = 400) {
  if (!url) return '';
  // 仅对 R2 Worker URL 追加裁剪参数
  if (url.includes('workers.dev/r2/')) return url + '?w=' + width;
  return url;
}

/**
 * 创建带 AbortController 的请求（页面卸载时可 abort）
 * 用法：const { promise, abort } = api.get('/api/xxx');
 *       useEffect(() => { return abort; }, []);
 */
export const api = {
  get: (url, config) => {
    const controller = new AbortController();
    return {
      promise: http.get(url, { ...config, signal: controller.signal }),
      abort: () => controller.abort()
    };
  },
  post: (url, data, config) => {
    const controller = new AbortController();
    return {
      promise: http.post(url, data, { ...config, signal: controller.signal }),
      abort: () => controller.abort()
    };
  },
  put: (url, data, config) => {
    const controller = new AbortController();
    return {
      promise: http.put(url, data, { ...config, signal: controller.signal }),
      abort: () => controller.abort()
    };
  },
  delete: (url, config) => {
    const controller = new AbortController();
    return {
      promise: http.delete(url, { ...config, signal: controller.signal }),
      abort: () => controller.abort()
    };
  }
};

// 前端上传前压缩：长边不超过 maxWidth/maxHeight，质量 quality，<2MB 或不是图片则跳过
export function compressImage(file, { maxWidth = 1920, maxHeight = 1920, quality = 0.85, type = 'image/jpeg' } = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return resolve(file);
    if (file.size < 2 * 1024 * 1024) return resolve(file);
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
