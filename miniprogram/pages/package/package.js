const { request } = require('../../utils/req.js');

Page({
  data: {
    packages: [],
    loading: true,
    error: false
  },
  _tasks: [],

  onLoad() { this.load(); },
  onShow() {
    // 从详情页返回时静默刷新（不显示全屏 loading）
    if (this.data.packages.length) this.refresh();
  },
  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },

  onUnload() {
    this._tasks.forEach((t) => { try { t.abort(); } catch (e) {} });
    this._tasks = [];
    this.setData({ packages: [] });
  },

  async load() {
    this.setData({ loading: true, error: false });
    try {
      const pkgs = await request('/api/packages/public');
      // 仅展示已上架的套系
      this.setData({ packages: (pkgs || []).filter((p) => p.is_public !== false), loading: false });
      // 缓存到全局（详情页返回时可用）
      const app = getApp();
      app.setCached('packages', pkgs || []);
    } catch (e) {
      this.setData({ loading: false, error: true });
    }
  },

  async refresh() {
    try {
      const pkgs = await request('/api/packages/public');
      this.setData({ packages: (pkgs || []).filter((p) => p.is_public !== false) });
      const app = getApp();
      app.setCached('packages', pkgs || []);
    } catch (e) { /* 静默刷新 */ }
  },

  retry() { this.load(); },

  // 进入套系详情页
  openPkg(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pkg/packageDetail/packageDetail?id=' + id });
  }
});
