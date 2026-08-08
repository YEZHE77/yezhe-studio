// miniQr.js —— 生成微信小程序风格订单二维码（SVG 数据 URL）
// 视觉规格：白底、环形装饰样式、中间相机图标、右下角绿色小程序标识
import QRCode from 'qrcode';

const SIZE = 280;
const QR_SIZE = 200;
const QR_OFFSET = (SIZE - QR_SIZE) / 2; // 40

// 微信小程序绿色标识（右下角，直径 44）
const WECHAT_ICON_SVG = `
<g transform="translate(${SIZE - 40 - 12}, ${SIZE - 40 - 12})">
  <circle cx="22" cy="22" r="22" fill="#07C160"/>
  <path d="M12 18c0-4.4 5.8-8 13-8s13 3.6 13 8-5.8 8-13 8c-1.4 0-2.8-.2-4.1-.5l-3.9 2.2v-3.3C14.2 23.2 12 20.8 12 18z" fill="#ffffff"/>
  <circle cx="19" cy="18" r="1.4" fill="#07C160"/>
  <circle cx="29" cy="18" r="1.4" fill="#07C160"/>
  <path d="M30 26c4.2 0 7.6-2.7 7.6-6s-3.4-6-7.6-6c-4.2 0-7.6 2.7-7.6 6s3.4 6 7.6 6z" fill="#ffffff" opacity="0.85"/>
  <circle cx="26.5" cy="20" r="1" fill="#07C160"/>
  <circle cx="34" cy="20" r="1" fill="#07C160"/>
</g>`;

// 中间相机图标（放置在白色圆形底上）
const CAMERA_ICON_SVG = `
<g transform="translate(${SIZE / 2}, ${SIZE / 2})">
  <circle cx="0" cy="0" r="34" fill="#ffffff"/>
  <g transform="translate(-18, -14)" fill="none" stroke="#1f2329" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="2" y="5" width="32" height="22" rx="4"/>
    <path d="M10 5l3-4h8l3 4"/>
    <circle cx="18" cy="16" r="6"/>
  </g>
</g>`;

function svgToDataUrl(svg) {
  const encoded = Buffer.from(svg).toString('base64');
  return 'data:image/svg+xml;base64,' + encoded;
}

/**
 * 生成微信小程序风格二维码 SVG 数据 URL
 * @param {string} text - 二维码内容（如订单分享落地页 URL）
 * @returns {Promise<string>} SVG data URL
 */
export async function generateMiniProgramQr(text) {
  // 生成标准 QR 的 SVG（白色背景 + 黑色模块）
  const qrSvg = await QRCode.toString(text, {
    type: 'svg',
    margin: 0,
    width: QR_SIZE,
    color: { dark: '#000000', light: '#ffffff' },
  });

  // 提取 QR SVG 的 body（去掉外层的 <svg> 标签）以及原始 viewBox，用于正确缩放
  const bodyMatch = qrSvg.match(/<svg[^>]*>([\s\S]*)<\/svg>/);
  const qrBody = bodyMatch ? bodyMatch[1] : qrSvg;
  const vbMatch = qrSvg.match(/viewBox="([^"]+)"/);
  const qrViewBox = vbMatch ? vbMatch[1] : `0 0 ${QR_SIZE} ${QR_SIZE}`;

  // viewBox 缩放：qrcode 默认按模块数生成 viewBox（如 33x33），通过 inner svg 的 viewBox 让浏览器自动缩放填充 QR_SIZE
  const fullSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <clipPath id="qrCircle">
      <circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${QR_SIZE / 2 - 2}"/>
    </clipPath>
  </defs>
  <!-- 白底卡片背景（弹窗内本身已是白底，这里仅作为二维码区域背景） -->
  <rect x="0" y="0" width="${SIZE}" height="${SIZE}" fill="#ffffff" rx="12" ry="12"/>
  <!-- 环形装饰：浅灰细圆环 -->
  <circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${QR_SIZE / 2}" fill="none" stroke="#f0f0f0" stroke-width="2"/>
  <!-- QR 码主体，裁切成圆形，模拟小程序码环形样式 -->
  <g clip-path="url(#qrCircle)" transform="translate(${QR_OFFSET}, ${QR_OFFSET})">
    <svg width="${QR_SIZE}" height="${QR_SIZE}" viewBox="${qrViewBox}" preserveAspectRatio="xMidYMid meet">
      ${qrBody}
    </svg>
  </g>
  <!-- 中心相机图标（遮挡 QR 中心少量区域，提升辨识度） -->
  ${CAMERA_ICON_SVG}
  <!-- 右下角微信小程序绿色标识 -->
  ${WECHAT_ICON_SVG}
</svg>`;

  return svgToDataUrl(fullSvg);
}
