const { CONFIG } = require('../../utils/config.js');

Page({
  data: { openid: '', login: false },

  onShow() {
    try {
      const openid = wx.getStorageSync('openid') || '';
      const token = wx.getStorageSync('token') || '';
      this.setData({ openid, login: !!token });
    } catch (e) {}
  },

  go(e) {
    const url = e.currentTarget.dataset.url;
    wx.navigateTo({ url });
  },

  copyContact() {
    wx.setClipboardData({ data: 'yezhe-studio', success: () => wx.showToast({ title: '微信号已复制', icon: 'none' }) });
  },

  openAdmin() {
    wx.showModal({
      title: '商家后台',
      content: '管理端请在浏览器打开：' + CONFIG.WEB_ADMIN,
      confirmText: '复制地址',
      success: (r) => { if (r.confirm) wx.setClipboardData({ data: CONFIG.WEB_ADMIN }); }
    });
  }
});
