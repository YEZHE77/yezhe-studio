// app.js —— 全局：wx.login 换 openid + 客户 token，缓存到本地
// 同时提供全局数据缓存（studio/categories），减少首页重复请求
const { CONFIG } = require('./config.js');
const CACHE_TTL = 5 * 60 * 1000; // 5 分钟

App({
  globalData: {
    openid: '',
    token: '',
    logging: null,
    _cache: {}
  },

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
            timeout: 15000,
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

  // 全局缓存：从内存/本地缓存读 key，命中且未过期则返回
  getCached(key) {
    const entry = this.globalData._cache[key];
    if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
    // 尝试从本地持久化读（页面卸载后内存清空，本地兜底）
    try {
      const raw = wx.getStorageSync('_cache_' + key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Date.now() - parsed.ts < CACHE_TTL) {
          this.globalData._cache[key] = parsed;
          return parsed.data;
        }
      }
    } catch (e) {}
    return null;
  },

  // 写入全局缓存（内存 + 本地持久化）
  setCached(key, data) {
    const entry = { data, ts: Date.now() };
    this.globalData._cache[key] = entry;
    try { wx.setStorageSync('_cache_' + key, JSON.stringify(entry)); } catch (e) {}
  },

  _readToken() {
    try { return wx.getStorageSync('token') || ''; } catch (e) { return ''; }
  },
  _save(openid, token) {
    try { wx.setStorageSync('openid', openid); wx.setStorageSync('token', token); } catch (e) {}
  }
});
