const { request } = require('../../utils/req.js');

Page({
  data: { packages: [] },

  onLoad() { this.load(); },
  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },

  async load() {
    try {
      const pkgs = await request('/api/packages/public');
      this.setData({ packages: pkgs || [] });
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  // 进入套系详情页（公开列表仅展示已上架套系）
  openPkg(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/packageDetail/packageDetail?id=' + id });
  }
});
