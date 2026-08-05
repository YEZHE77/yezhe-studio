// Cloudflare 上传 Worker —— 直传 R2（仅写，密钥只在 Worker 环境变量，前端绝不接触 R2 密钥）
// 配套只读代理 worker.js（yezhe-img-proxy）负责读取；二者绑定同一 R2 桶。
//
// 安全边界：
//   1) 必须携带 Bearer 上传令牌（env.UPLOAD_TOKEN），否则 401 —— 令牌由后端 /api/admin/upload-token
//      在管理员登录后下发，仅用于上传闸门，不等于 R2 凭证，泄露也仅能上传、不能读/删。
//   2) 强制业务类型参数 type（枚举）：negative 底片 / retouch 精修 / client 客片 / cover 封面 /
//      set 套系样片 / backup 系统备份。无 type 或非枚举 → 400 拒绝（不允许无类型上传业务图片）。
//      写入 R2 key 形如 uploads/{type}/{uuid}.{ext}，便于容量管理按业务分类统计。
//   3) 仅接受图片；单文件 ≤ 20MB；校验 magic bytes，拒绝非图片。
//   4) 返回读代理域名 URL（PUBLIC_CDN，默认只读代理域名），保证上传后同一 URL 可读。
//
// 部署：见 wrangler.upload.toml（独立子域，如 yezhe-img-upload.workers.dev），与只读代理分开部署。

// T-07 业务类型枚举（不允许无 type）
const ALLOWED_TYPES = new Set([
  'negative', 'retouch', 'client', 'cover', 'set', 'backup'
]);

function sanitizeType(t) {
  const s = String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/\.+/g, '-');
  if (!ALLOWED_TYPES.has(s) || s.includes('..')) return null; // 无 type 或非枚举 → 拒绝
  return s;
}

function isImage(buf) {
  if (buf.byteLength < 4) return null;
  const b = new Uint8Array(buf.slice(0, 12));
  // JPEG FFD8FF / PNG 89504E47 / GIF 474946 / WEBP 52494646 57454250
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x52 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

function cors(env, extra = {}) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    ...extra
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(env) });
    }
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: cors(env) });
    }

    // 令牌闸门
    const auth = request.headers.get('Authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (!env.UPLOAD_TOKEN || token !== env.UPLOAD_TOKEN) {
      return new Response('Unauthorized', { status: 401, headers: cors(env) });
    }

    // 强制业务类型前缀（type 必填且必须为枚举）
    const type = sanitizeType(url.searchParams.get('type'));
    if (!type) {
      return new Response('Missing or invalid type. Allowed: negative, retouch, client, cover, set, backup',
        { status: 400, headers: cors(env) });
    }

    // 解析文件：multipart 或原始二进制
    const ct = request.headers.get('content-type') || '';
    let body, ext = '.jpg';
    if (ct.includes('multipart/form-data')) {
      try {
        const form = await request.formData();
        const file = form.get('file');
        if (!file || typeof file === 'string') return new Response('No file', { status: 400, headers: cors(env) });
        body = await file.arrayBuffer();
        const name = file.name || '';
        if (name.includes('.')) ext = name.slice(name.lastIndexOf('.')).slice(0, 6);
      } catch (e) {
        return new Response('Bad Form', { status: 400, headers: cors(env) });
      }
    } else {
      body = await request.arrayBuffer();
    }

    if (!body || body.byteLength === 0) return new Response('Empty', { status: 400, headers: cors(env) });
    if (body.byteLength > 20 * 1024 * 1024) return new Response('Too Large (max 20MB)', { status: 413, headers: cors(env) });

    const mime = isImage(body);
    if (!mime) return new Response('Only image files allowed', { status: 415, headers: cors(env) });

    // key 规则：uploads/{type}/{uuid}.{ext}
    const uuid = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    const key = `uploads/${type}/${uuid}${ext}`;
    await env.R2.put(key, body, { contentType: mime });

    const cdn = env.PUBLIC_CDN || `https://${url.hostname}`;
    return new Response(JSON.stringify({ url: `${cdn}/r2/${key}` }), {
      headers: { ...cors(env), 'content-type': 'application/json' }
    });
  }
};
