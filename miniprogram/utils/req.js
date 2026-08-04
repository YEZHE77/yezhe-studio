// req.js —— 带鉴权的请求封装
// 所有 /api/customer/* 请求自动确保已登录（无 token 时先 wx.login 换 token）
const { CONFIG } = require('./config.js');

function getToken() {
  try { return wx.getStorageSync('token') || ''; } catch (e) { return ''; }
}

function request(path, method = 'GET', data = {}) {
  return new Promise((resolve, reject) => {
    const run = (token) => {
      wx.request({
        url: CONFIG.API_BASE + path,
        method,
        data,
        header: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {})
        },
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve(res.data);
          if (res.statusCode === 401) {
            try { wx.removeStorageSync('token'); } catch (e) {}
            return reject((res.data && res.data.error) || '请重新登录');
          }
          if (res.statusCode === 403) return reject((res.data && res.data.error) || '无权访问');
          return reject((res.data && res.data.error) || ('请求失败(' + res.statusCode + ')'));
        },
        fail: () => reject('网络错误，请检查后端域名配置')
      });
    };

    if (path.indexOf('/api/customer/') === 0) {
      const app = getApp();
      if (app && app.ensureLogin) {
        app.ensureLogin().then((t) => run(t));
      } else {
        run(getToken());
      }
    } else {
      run(getToken());
    }
  });
}

module.exports = { request, getToken };
