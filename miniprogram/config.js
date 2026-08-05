// config.js —— 后端地址（两种模式）+ 管理端地址
const CONFIG = {
  mode: 'prod', // 'lan' 局域网调试 / 'prod' 生产公网
  lanBase: 'http://192.168.31.39:4000', // 调试期改成你 Mac 局域网 IP:端口（本地 node 后端）
  prodBase: 'https://yezhe-studio-server.onrender.com', // 生产：Render 公网后端（后端已部署）
  webAdmin: 'https://yezhe-studio.netlify.app', // 商家管理后台（网页）
  // 后端 API 基地址（req.js 自动拼接 /api/...），随 mode 切换
  get API_BASE() { return this.mode === 'lan' ? this.lanBase : this.prodBase; }
};

function getWebViewUrl(globalData) {
  const base = CONFIG.mode === 'lan' ? CONFIG.lanBase : CONFIG.prodBase;
  const params = [];
  if (globalData && globalData.openid) params.push('openid=' + encodeURIComponent(globalData.openid));
  return params.length ? base + '?' + params.join('&') : base;
}

module.exports = { CONFIG, getWebViewUrl };
