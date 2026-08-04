// config.js —— 后端地址与商家后台地址
// 本地开发：http://localhost:4000（需同时启动后端 + 开发者工具勾选「不校验合法域名」）
// 正式发布前：改成 Render 后端真实 https 域名，并在微信后台「开发设置→服务器域名」添加为 request 合法域名
const CONFIG = {
  API_BASE: 'http://localhost:4000',       // 开发默认值；上线前改为 https://你的render域名
  WEB_ADMIN: 'https://yezhe.netlify.app' // 商家网页管理后台
};

module.exports = { CONFIG };
