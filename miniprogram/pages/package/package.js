const { request } = require('../../utils/req.js');

Page({
  data: { packages: [], detail: null },

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

  openPkg(e) {
    const id = e.currentTarget.dataset.id;
    const pkg = this.data.packages.find((p) => p.id === id);
    this.setData({ detail: pkg || null });
  },
  closeDetail() { this.setData({ detail: null }); },

  goAppointment() {
    const id = this.data.detail ? this.data.detail.id : '';
    this.setData({ detail: null });
    wx.navigateTo({ url: '/pages/appointment/appointment' + (id ? ('?packageId=' + id) : '') });
  },
  noop() {}
});
