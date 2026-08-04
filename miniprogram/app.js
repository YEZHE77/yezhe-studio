// app.js —— 全局：wx.login 换 openid + 客户 token，缓存到本地
const { CONFIG } = require('./config.js');

App({
  globalData: { openid: '', token: '', logging: null },

  onLaunch() {
    this.ensureLogin();
  },

  // 返回可信 token（首次自动 wx.login → /api/wx/login）
  ensureLogin() {
    const cached = this._readToken();
    if (cached) { this.globalData.token = cached; return Promise.resolve(cached); }
    if (this.globalData.logging) return this.globalData.logging;

    this.globalData.logging = new Promise((resolve) => {
      wx.login({
        success: (res) => {
          if (!res.code) { resolve(''); return; }
          wx.request({
            url: CONFIG.API_BASE + '/api/wx/login',
            method: 'POST',
            data: { code: res.code },
            success: (r) => {
              if (r.data && r.data.token) {
                this.globalData.openid = r.data.openid || '';
                this.globalData.token = r.data.token || '';
                this._save(r.data.openid, r.data.token);
                resolve(r.data.token);
              } else {
                resolve('');
              }
            },
            fail: () => resolve('')
          });
        },
        fail: () => resolve('')
      });
    });
    return this.globalData.logging;
  },

  _readToken() {
    try { return wx.getStorageSync('token') || ''; } catch (e) { return ''; }
  },
  _save(openid, token) {
    try { wx.setStorageSync('openid', openid); wx.setStorageSync('token', token); } catch (e) {}
  }
});
