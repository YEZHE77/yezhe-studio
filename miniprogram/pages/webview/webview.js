// webview.js —— 小程序内嵌 H5 页面（复用 H5 客户登录/查单/个人中心能力）
const { CONFIG } = require('../../utils/config.js');

Page({
  data: { url: '' },
  onLoad(options) {
    // options.path 指定 H5 路径，默认客户登录页
    const path = (options && options.path) || 'customer/login';
    // 去掉可能的开头斜杠，避免双斜杠
    const clean = String(path).replace(/^\/+/, '');
    this.setData({ url: CONFIG.WEB_ADMIN + '/' + clean });
  }
});
