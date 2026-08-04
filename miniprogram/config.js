// config.js —— web-view 地址（两种模式）
const CONFIG = {
  mode: 'prod', // 'lan' 局域网调试 / 'prod' 生产公网
  lanBase: 'http://192.168.31.39:8080', // 调试期改成你 Mac 局域网 IP:端口（前端 dev 或 build 后静态服务）
  prodBase: 'https://yezhe.netlify.app'  // 生产：Netlify 公网 H5（已部署）
};

function getWebViewUrl(globalData) {
  const base = CONFIG.mode === 'lan' ? CONFIG.lanBase : CONFIG.prodBase;
  const params = [];
  if (globalData && globalData.openid) params.push('openid=' + encodeURIComponent(globalData.openid));
  return params.length ? base + '?' + params.join('&') : base;
}

module.exports = { CONFIG, getWebViewUrl };
