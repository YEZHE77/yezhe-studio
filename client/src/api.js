import axios from 'axios';

// 生产：Netlify 构建时注入 VITE_API_BASE=https://你的render地址.onrender.com
// 开发：留空，由 vite.config.js 的 proxy 转发到本地 4000
// 生产：优先读取构建时注入的 VITE_API_BASE；未注入则默认指向 Render 后端。
// 开发：留空，由 vite.config.js 的 proxy 转发到本地 4000。
// 注：环境变量末尾若有 / 会导致双斜杠，统一去掉。
const DEFAULT_BASE = import.meta.env.DEV ? '' : 'https://yezhe-studio-server.onrender.com';
export const BASE = (import.meta.env.VITE_API_BASE || DEFAULT_BASE).replace(/\/+$/, '');
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
    const data = err.response.data || {};
    const msg = data.error || ('请求失败(' + err.response.status + ')');
    // 业务冲突（档期占用 / 套系被订单引用）由调用方自行弹窗处理，不走全局 toast
    const quiet = (cfg && cfg.skipToast) || err.response.status === 409 || data.code === 'PACKAGE_IN_USE';
    if (!silentMode && !quiet) toast(msg);
    return Promise.reject({ ...err, message: msg, type: 'server', status: err.response.status, code: data.code || '', data });
  }
);

// 档期冲突判定助手：命中返回 { message, conflict, forcible }，否则 null
export function conflictOf(err) {
  if (!err || err.status !== 409 || err.code !== 'CONFLICT') return null;
  return { message: err.message, conflict: (err.data && err.data.conflict) || null, forcible: !!(err.data && err.data.forcible) };
}

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
// 支持 mode 取压缩版本：
//   thumb  → 400px 缩略图（列表页）
//   preview → 1080px 大图预览
// 非 https URL（本地 /uploads）不参与压缩，直接返回原 URL
//
// ====== 方案 B：R2 Worker ?w= 参数（当前生效） ======
// R2 Worker 已内置缩略图查找：?w=400 → 先查 thumb_400/<name>，命中返回小图，未命中降级原图
// 优点：无需 Cloudflare Dashboard 配置，立即生效
// 缺点：历史图片无预生成缩略图时降级原图（慢但能加载）
//
// ====== 方案 A：Cloudflare Pages Image Resizing（待启用，更快） ======
// 启用后把 USE_CF_RESIZING 改为 true 即可走 Pages 边缘压缩，无需后端预生成缩略图
// 启用方法：Cloudflare Dashboard → Workers & Pages → yezhe-studio → Settings → Functions → Image transformations → Enabled

const USE_CF_RESIZING = false; // Image Transformations 启用后改为 true
const PAGES_HOST = 'https://yezhe-studio.pages.dev';
const WORKER_HOST = 'yezhe-img-proxy.yezhe128627.workers.dev';

// workers.dev 域名在国内被 GFW 封锁，重写为 pages.dev（_worker.js 代理 /r2/* 到 Worker）
function rewriteHost(src) {
  try {
    const u = new URL(src);
    if (u.hostname === WORKER_HOST || u.hostname.endsWith('.workers.dev')) {
      u.hostname = 'yezhe-studio.pages.dev';
    }
    return u.toString();
  } catch (e) {
    return src;
  }
}

function imageResized(src, width, quality = 75) {
  return `${PAGES_HOST}/cdn-cgi/image/width=${width},quality=${quality},fit=cover/${src}`;
}

function workerThumb(src, width) {
  try {
    const u = new URL(src);
    u.searchParams.set('w', String(width));
    return u.toString();
  } catch (e) {
    return src;
  }
}

export function img(url, mode) {
  if (!url) return '';
  let src = url;
  if (src.startsWith('/uploads')) src = BASE + src;
  if (!src.startsWith('http')) return src;
  src = rewriteHost(src); // workers.dev → pages.dev（绕过 GFW 封锁）
  if (!mode) return src;
  try {
    if (mode === 'thumb') {
      return USE_CF_RESIZING ? imageResized(src, 400) : workerThumb(src, 400);
    }
    if (mode === 'preview') {
      return USE_CF_RESIZING ? imageResized(src, 1080) : workerThumb(src, 1080);
    }
    return src;
  } catch (e) {
    return src;
  }
}

// 获取缩略图 URL（指定宽度）
export function thumb(url, width = 400) {
  if (!url) return '';
  if (!url.startsWith('http')) return url;
  url = rewriteHost(url); // workers.dev → pages.dev（绕过 GFW 封锁）
  return USE_CF_RESIZING ? imageResized(url, width) : workerThumb(url, width);
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
// 需求 D：默认质量下调到 0.8（0.7~0.8 区间），进一步缩小压缩小样体积、加快上传。
export function compressImage(file, { maxWidth = 1920, maxHeight = 1920, quality = 0.8, type = 'image/jpeg' } = {}) {
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
    await http.post('/api/admin/media/register', { url, category, bytes, isPublic: !!isPublic });
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
// 上传性能埋点（需求：区分网络耗时 vs 后端阻塞）：
//   uploadImage / uploadImageChunked 在上传完成后打印控制台日志：
//     [upload] <文件名> localSize=<字节>B upload=<总上传耗时>ms ttfb=<后端等待耗时>ms
//   ttfb = 从发起请求到「首个字节/首次进度」的等待（后端冷启动/处理阻塞会显著拉高）。
//   registerMedia（容量统计登记）改为 fire-and-forget，不再阻塞上传关键路径。
//
// 【Render 环境变量配置示例】（在 Render 服务 Environment 里添加，或本地 client/.env）：
//   VITE_UPLOAD_WORKER_URL=https://yezhe-img-proxy.yezhe128627.workers.dev/upload
//   注：该地址为上传 Worker 的独立子域（cloudflare/wrangler.upload.toml 部署），不是只读代理域名；
//       不配置此变量时自动降级为后端中转，无需改动任何业务代码。

// 上传耗时埋点：统一打印控制台日志
function logUploadTiming(label, fileSize, t0, tFirst, tEnd) {
  const elapsed = Math.round(tEnd - t0);
  const ttfb = Math.round((tFirst && tFirst > 0 ? tFirst - t0 : elapsed));
  // eslint-disable-next-line no-console
  console.log(`[upload] ${label} localSize=${fileSize}B upload=${elapsed}ms ttfb=${ttfb}ms`);
  return { ttfb, elapsed };
}
//
// 无论走哪条路径，都会在拿到 URL 后登记 media 元数据（按业务分类汇聚容量统计）。
// opts: { category, isPublic, onProgress, signal }
export async function uploadImage(file, opts = {}) {
  const { category = 'uncategorized', isPublic = false, onProgress, signal, metaName, metaSize } = opts;
  // 需求 D：压缩小样单张 >2MB 走分片上传（断点续传 + 2 次自动重试 + 聚合单图进度）
  if (file && file.size > 2 * 1024 * 1024) {
    const r = await uploadImageChunked(file, opts);
    return r;
  }
  const type = toType(category);
  const workerUrl = import.meta.env.VITE_UPLOAD_WORKER_URL;
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let tFirst = 0;
  const markFirst = () => { if (!tFirst) tFirst = (typeof performance !== 'undefined' ? performance.now() : Date.now()); };
  let url;
  if (workerUrl) {
    const token = await getUploadToken();
    const fd = new FormData();
    fd.append('file', file);
    fd.append('type', type); // Worker 强制业务类型前缀（用于分类统计，T-07 枚举）
    try {
      url = await new Promise((resolve, reject) => {
        if (signal && signal.aborted) return reject(new DOMException('上传已取消', 'AbortError'));
        const xhr = new XMLHttpRequest();
        xhr.open('POST', workerUrl);
        if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);
        xhr.upload.onprogress = (e) => {
          markFirst();
          if (onProgress && e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        };
        const onAbort = () => xhr.abort();
        if (signal) signal.addEventListener('abort', onAbort);
        xhr.onload = () => {
          markFirst();
          if (signal) signal.removeEventListener('abort', onAbort);
          if (xhr.status >= 200 && xhr.status < 300) {
            try { resolve(JSON.parse(xhr.responseText).url); }
            catch { reject(new Error('Worker 上传返回解析失败: ' + workerUrl)); }
          } else {
            let detail = '';
            try { detail = ' ' + xhr.responseText; } catch {}
            reject(new Error('Worker 上传失败(' + xhr.status + '): ' + workerUrl + detail));
          }
        };
        xhr.onerror = () => {
          markFirst();
          if (signal) signal.removeEventListener('abort', onAbort);
          reject(new Error('Worker 上传网络错误: ' + workerUrl));
        };
        xhr.send(fd);
      });
    } catch (err) {
      // Worker 配置错误或不可用时，自动降级到后端 /api/upload（兜底可用）
      console.warn('[upload] Worker 失败，降级到 /api/upload:', err.message);
      url = null;
    }
  }
  if (!url) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('category', type);
    fd.append('isPublic', isPublic ? '1' : '0');
    const { data } = await http.post('/api/upload', fd, {
      timeout: 300000,
      signal,
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        markFirst();
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });
    url = data.url;
  }
  const tEnd = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const timing = logUploadTiming(metaName || file.name, file.size, t0, tFirst, tEnd);
  // 容量统计登记（fire-and-forget，绝不阻塞上传关键路径）
  registerMedia(url, type, file.size, isPublic).catch(() => {});
  // 返回文件名 + 字节数，供前端去重签名（originalName_size）使用。
  // 压缩会改变文件名（如 .png→.jpg）与字节数，故允许调用方传入 metaName/metaSize
  // 携带【压缩前】的原始文件名与字节，确保去重签名与首次上传时存库的一致。
  return { url, name: metaName ?? file.name, size: metaSize ?? file.size, timing };
}

// ---- 需求 D：分片上传（压缩小样单张 >2MB 启用） ----
const CHUNK_SIZE = 512 * 1024; // 512KB/片（R2/S3 原生 multipart 要求每片≥5MB，故走后端临时缓冲+合并）
const CHUNK_RETRY = 2; // 单分片失败自动重试次数

function genUploadId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// 上传单个分片（per-part 进度回调 + 自动重试 CHUNK_RETRY 次）
async function uploadOneChunk(uploadId, partNo, blob, opts) {
  const { signal, onPartProgress } = opts;
  const fd = new FormData();
  fd.append('file', blob, `part-${partNo}`);
  fd.append('uploadId', uploadId);
  fd.append('partNo', String(partNo));
  let attempts = 0;
  while (true) {
    try {
      await http.post('/api/upload/chunk', fd, {
        timeout: 60000,
        signal,
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => { if (onPartProgress && e.total) onPartProgress(Math.round((e.loaded / e.total) * 100)); }
      });
      return;
    } catch (err) {
      if (signal && signal.aborted) throw err;
      attempts++;
      if (attempts > CHUNK_RETRY) throw err; // 2 次自动重试后仍失败 → 交上层（单张失败标红+手动重试）
      await new Promise((r) => setTimeout(r, 800));
    }
  }
}

// 分片上传主流程：512KB/片 + 断点续传（先查已存在分片跳过）+ 2 次自动重试 + 聚合单图进度
export async function uploadImageChunked(file, opts = {}) {
  const { category = 'uncategorized', isPublic = false, onProgress, signal, metaName, metaSize, getPaused } = opts;
  const uploadId = genUploadId();
  const ext = '.' + ((file.name.split('.').pop() || 'jpg').toLowerCase());
  const totalParts = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let tFirst = 0;
  const markFirst = () => { if (!tFirst) tFirst = (typeof performance !== 'undefined' ? performance.now() : Date.now()); };
  // 断点续传：先查该 uploadId 已存在的分片（切网络/后台回来可续，已传分片不重复传）
  const uploaded = new Set();
  try {
    const st = await http.get('/api/upload/chunk/status?uploadId=' + encodeURIComponent(uploadId));
    (st.data.parts || []).forEach((p) => uploaded.add(Number(p)));
  } catch { /* 查询失败不阻断，从头传 */ }
  let uploadedBytes = 0;
  for (let partNo = 1; partNo <= totalParts; partNo++) {
    if (signal && signal.aborted) throw { type: 'cancel', message: '已取消' };
    // 暂停（getPaused 返回 true 时挂起当前图后续分片，已发起请求不阻断）
    while (getPaused && getPaused() && !(signal && signal.aborted)) {
      await new Promise((r) => setTimeout(r, 150));
    }
    const start = (partNo - 1) * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const partSize = end - start;
    if (uploaded.has(partNo)) {
      uploadedBytes = end;
      if (onProgress) onProgress(Math.min(99, Math.round((uploadedBytes / file.size) * 100)));
      continue;
    }
    await uploadOneChunk(uploadId, partNo, file.slice(start, end), {
      signal,
      onPartProgress: (pct) => {
        markFirst();
        if (onProgress) {
          const cur = uploadedBytes + Math.round((pct / 100) * partSize);
          onProgress(Math.min(99, Math.round((cur / file.size) * 100)));
        }
      }
    });
    uploadedBytes = end;
  }
  // 全部到达 → 后端合并落库
  const type = toType(category);
  const { data } = await http.post('/api/upload/complete', {
    uploadId, ext, category: type, isPublic: !!isPublic, totalParts
  }, { signal, timeout: 60000 });
  const tEnd = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const timing = logUploadTiming('(chunked) ' + (metaName || file.name), file.size, t0, tFirst, tEnd);
  // 容量统计登记（fire-and-forget，绝不阻塞上传关键路径）
  registerMedia(data.url, type, file.size, isPublic).catch(() => {});
  return { url: data.url, name: metaName ?? file.name, size: metaSize ?? file.size, timing };
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
// files 支持两种形态：
//   - File[] （兼容旧调用）：直接上传，返回名/字节为压缩后的值。
//   - { file, name, size }[]：name/size 为【压缩前】原始文件名与字节，
//     透传给 uploadImage 作为去重签名，确保与首次上传存库时一致。
// 返回：
//   - urls：紧凑数组（压缩后 URL 字符串），兼容 Works.jsx 等旧调用。
//   - items：与入参等长、按索引对齐，每项 { url, name, size } 或失败留 null，
//     便于调用方按原始顺序拼接 originalName/size 投递后端去重接口。
//   - failed：按索引对齐的错误信息数组（成功项为空）。
export async function uploadBatch(files, opts = {}) {
  const { category = 'uncategorized', isPublic = false, concurrency = 3, signal, onProgress, onItemProgress } = opts;
  const list = Array.from(files || []).map((f) => (f && f.file ? f : { file: f, name: f && f.name, size: f && f.size }));
  const items = new Array(list.length).fill(null);
  const failed = new Array(list.length).fill(undefined);
  let done = 0;
  let cursor = 0;

  const worker = async () => {
    while (cursor < list.length) {
      if (signal && signal.aborted) return;
      const idx = cursor++;
      try {
        const item = list[idx];
        const r = await uploadImage(item.file, {
          category, isPublic, signal, metaName: item.name, metaSize: item.size,
          onProgress: (pct) => { if (onItemProgress) onItemProgress(idx, pct); }
        });
        items[idx] = r;
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

  const urls = items.filter(Boolean).map((it) => it.url);
  if (signal && signal.aborted) return { urls, items, failed, aborted: true };
  return { urls, items, failed };
}

export default http;
