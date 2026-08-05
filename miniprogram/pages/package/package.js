const { requestTask } = require('../../utils/req.js');
const { getImageUrl } = require('../../utils/imageUrl.js');

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

  // 统一请求封装：收集 abort 句柄，供 onUnload 终止未完成请求
  _req(path, method, data) {
    const t = requestTask(path, method || 'GET', data || {});
    this._tasks.push(t.abort);
    return t.promise;
  },

  async load() {
    this.setData({ loading: true, error: false });
    try {
      const pkgs = await this._req('/api/packages/public');
      // 仅展示已上架的套系，并预生成缩略图地址
      const list = (pkgs || []).filter((p) => p.is_public !== false)
        .map((p) => ({ ...p, coverThumb: getImageUrl(p.cover_url || '', 'thumb') }));
      this.setData({ packages: list, loading: false });
      // 缓存到全局（详情页返回时可用）
      const app = getApp();
      app.setCached('packages', pkgs || []);
    } catch (e) {
      this.setData({ loading: false, error: true });
    }
  },

  async refresh() {
    try {
      const pkgs = await this._req('/api/packages/public');
      const list = (pkgs || []).filter((p) => p.is_public !== false)
        .map((p) => ({ ...p, coverThumb: getImageUrl(p.cover_url || '', 'thumb') }));
      this.setData({ packages: list });
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
