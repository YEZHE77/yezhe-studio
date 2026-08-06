import axios from 'axios';

// 生产：Netlify 构建时注入 VITE_API_BASE=https://你的render地址.onrender.com
// 开发：留空，由 vite.config.js 的 proxy 转发到本地 4000
const BASE = import.meta.env.VITE_API_BASE || '';
const TIMEOUT = 15000; // 15 秒超时

const http = axios.create({ baseURL: BASE, timeout: TIMEOUT });

// 对 GET 请求做 1 次自动重试，缓解 Render Free 休眠冷启动导致的首次超时
http.interceptors.request.use((cfg) => {
  cfg.__retryCount = cfg.__retryCount || 0;
  return cfg;
});

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
  async (err) => {
    const cfg = err.config;
    if (axios.isCancel(err)) return Promise.reject({ type: 'cancel', message: '请求已取消' });

    // 自动重试：GET 请求在超时/网关错误/无响应时最多重试 1 次
    if (cfg && cfg.method === 'get' && cfg.__retryCount < 1) {
      const shouldRetry = !err.response || err.code === 'ECONNABORTED' || [502, 503, 504].includes(err.response?.status);
      if (shouldRetry) {
        cfg.__retryCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 1500));
        if (!silentMode) toast('服务器正在启动，正在重试…');
        return http(cfg);
      }
    }

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
// 支持 mode 取压缩版本：thumb ?w=420 / preview ?w=1080（仅 R2 Worker 代理域名）
export function img(url, mode) {
  if (!url) return '';
  let src = url;
  if (src.startsWith('/uploads')) src = BASE + src;
  if (!src.startsWith('http')) return src;
  if (!mode) return src;
  try {
    const u = new URL(src);
    u.searchParams.delete('w');
    if (mode === 'thumb') u.searchParams.set('w', '420');
    else if (mode === 'preview') u.searchParams.set('w', '1080');
    return u.toString();
  } catch (e) {
    return src;
  }
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

// 字节数格式化（容量管理展示用）
export function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const idx = Math.min(i, units.length - 1);
  return (bytes / Math.pow(k, idx)).toFixed(idx === 0 ? 0 : decimals) + ' ' + units[idx];
}

// 媒资元数据登记（幂等：唯一索引去重）
export async function registerMedia(url, category, bytes, isPublic) {
  try {
    await http.post('/api/media/register', { url, category, bytes, isPublic: !!isPublic });
  } catch (e) { /* 最佳努力，失败不影响主流程 */ }
}

// 直传 Worker 所需的上传令牌（管理员登录后由后端下发，仅用于上传闸门，不等于 R2 凭证）
let _uploadToken = null;
let _uploadTokenPromise = null;
async function getUploadToken() {
  if (_uploadToken) return _uploadToken;
  if (_uploadTokenPromise) return _uploadTokenPromise;
  _uploadTokenPromise = http.get('/api/admin/upload-token')
    .then((r) => { _uploadToken = r.data.token || null; return _uploadToken; })
    .catch(() => { _uploadToken = null; return null; })
    .finally(() => { _uploadTokenPromise = null; });
  return _uploadTokenPromise;
}

// 业务分类 → Worker type 枚举（T-07）：negative 底片 / retouch 精修 / client 客片 / cover 封面 / set 套系样片 / backup 系统备份
const CATEGORY_TO_TYPE = {
  'raw-negative': 'negative', 'retouched': 'retouched', 'customer': 'client',
  'cover-sample': 'cover', 'system-backup': 'backup',
  'negative': 'negative', 'retouch': 'retouched', 'client': 'client',
  'cover': 'cover', 'set': 'set', 'backup': 'backup', 'uncategorized': 'uncategorized'
};
function toType(cat) { return CATEGORY_TO_TYPE[cat] || 'uncategorized'; }

// 统一的图片上传入口：
//   - 配置了 VITE_UPLOAD_WORKER_URL → 直传 Cloudflare 上传 Worker（密钥只在 Worker，前端绝不接触）
//       图片二进制直接 POST 到该 Worker 地址，不再请求后端 /api/upload 接口，
//       拿到返回的 CDN-URL 后再提交给后端业务接口（registerMedia 登记容量统计）。
//   - 变量为空 / undefined → 自动回退原有逻辑，继续走 Render 的 /api/upload 中转模式，保证降级可用。
//
// 【Render 环境变量配置示例】（在 Render 服务 Environment 里添加，或本地 client/.env）：
//   VITE_UPLOAD_WORKER_URL=https://yezhe-img-proxy.yezhe128627.workers.dev/upload
//   注：该地址为上传 Worker 的独立子域（cloudflare/wrangler.upload.toml 部署），不是只读代理域名；
//       不配置此变量时自动降级为后端中转，无需改动任何业务代码。
//
// 无论走哪条路径，都会在拿到 URL 后登记 media 元数据（按业务分类汇聚容量统计）。
// opts: { category, isPublic, onProgress, signal }
export async function uploadImage(file, opts = {}) {
  const { category = 'uncategorized', isPublic = false, onProgress, signal } = opts;
  const type = toType(category);
  const workerUrl = import.meta.env.VITE_UPLOAD_WORKER_URL;
  let url;
  if (workerUrl) {
    const token = await getUploadToken();
    const fd = new FormData();
    fd.append('file', file);
    fd.append('type', type); // Worker 强制业务类型前缀（用于分类统计，T-07 枚举）
    url = await new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject(new DOMException('上传已取消', 'AbortError'));
      const xhr = new XMLHttpRequest();
      xhr.open('POST', workerUrl);
      if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      xhr.upload.onprogress = (e) => {
        if (onProgress && e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      const onAbort = () => xhr.abort();
      if (signal) signal.addEventListener('abort', onAbort);
      xhr.onload = () => {
        if (signal) signal.removeEventListener('abort', onAbort);
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText).url); }
          catch { reject(new Error('上传返回解析失败')); }
        } else { reject(new Error('上传失败(' + xhr.status + ')')); }
      };
      xhr.onerror = () => {
        if (signal) signal.removeEventListener('abort', onAbort);
        reject(new Error('上传网络错误'));
      };
      xhr.send(fd);
    });
  } else {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('category', type);
    fd.append('isPublic', isPublic ? '1' : '0');
    const { data } = await http.post('/api/upload', fd, {
      timeout: 300000,
      signal,
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });
    url = data.url;
  }
  // 用规范枚举登记 media，保证容量统计分类一致
  await registerMedia(url, type, file.size, isPublic);
  return { url };
}

// 手动导出全量业务 JSON 备份（管理员下载到本地）。后端已过滤明文密钥。
export async function downloadBackup() {
  const { data } = await http.get('/api/admin/backup/export', { responseType: 'blob' });
  const fname = `yezhe-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 并发受限的批量上传（默认 3 张一组，避免短时间大量写入压垮免费数据库 / 卡死页面）。
// 支持传入 AbortSignal 中途取消。onProgress(totalDone, total) 回传整体进度。
// 返回 { urls, failed } —— 失败的单项不丢记录，便于前端重试。
export async function uploadBatch(files, opts = {}) {
  const { category = 'uncategorized', isPublic = false, concurrency = 3, signal, onProgress } = opts;
  const list = Array.from(files || []);
  const urls = [];
  const failed = [];
  let done = 0;
  let cursor = 0;

  const worker = async () => {
    while (cursor < list.length) {
      if (signal && signal.aborted) return;
      const idx = cursor++;
      try {
        const { url } = await uploadImage(list[idx], { category, isPublic, signal });
        urls[idx] = url;
      } catch (e) {
        if (signal && signal.aborted) return;
        failed[idx] = e.message || '上传失败';
      } finally {
        done++;
        if (onProgress) onProgress(done, list.length);
      }
    }
  };

  const pool = [];
  for (let i = 0; i < Math.min(concurrency, list.length); i++) pool.push(worker());
  await Promise.all(pool);

  if (signal && signal.aborted) return { urls: urls.filter(Boolean), failed, aborted: true };
  return { urls: urls.filter(Boolean), failed };
}

export default http;
