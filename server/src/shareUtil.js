// shareUtil.js —— 分享内核公共工具（URL 基准 + 二维码生成）
// 生产：SHARE_BASE_URL 环境变量优先；未配置时默认前端公开落地页域名 pages.dev。
// 本地：请求来自后端 4000 端口则回退到前端开发端口 5173，方便扫码调试。
import QRCode from 'qrcode';

// 取分享落地页基准地址（去掉结尾斜杠）
export function shareBaseUrl(req) {
  if (process.env.SHARE_BASE_URL) {
    return process.env.SHARE_BASE_URL.replace(/\/+$/, '');
  }
  const host = (req && req.get && req.get('host')) || '';
  if (host.includes('localhost:4000') || host.includes('127.0.0.1:4000')) {
    return 'http://localhost:5173';
  }
  // 前端公开落地页（H5 分享页 /share/:token）部署在 Cloudflare Pages
  return 'https://yezhe-studio.pages.dev';
}

// 由 token 拼出可访问的公开落地页地址（网页端 /share/:token）
export function buildShareUrl(token, req) {
  return `${shareBaseUrl(req)}/share/${token}`;
}

// 生成二维码 data URL
export async function genQr(url, opts = {}) {
  return QRCode.toDataURL(url, { width: 480, margin: 1, ...opts });
}
