const { CONFIG } = require('../../utils/config.js');
const { request } = require('../../utils/req.js');

Page({
  data: { openid: '', login: false, studio: null },

  onShow() {
    try {
      const openid = wx.getStorageSync('openid') || '';
      const token = wx.getStorageSync('token') || '';
      this.setData({ openid, login: !!token });
    } catch (e) {}
    this.loadStudio();
  },

  // 拉取商家在后台「资料设置」中配置的工作室信息（B 端保存即实时同步到 C 端）
  loadStudio() {
    request('/api/settings/studio')
      .then((s) => this.setData({ studio: s }))
      .catch(() => {});
  },

  go(e) {
    const url = e.currentTarget.dataset.url;
    wx.navigateTo({ url });
  },

  copyContact() {
    const wxid = (this.data.studio && this.data.studio.contact && this.data.studio.contact.wechat) || 'yezhe-studio';
    wx.setClipboardData({ data: wxid, success: () => wx.showToast({ title: '微信号已复制', icon: 'none' }) });
  },

  openAdmin() {
    wx.showModal({
      title: '商家后台',
      content: '管理端请在浏览器打开：' + CONFIG.webAdmin,
      confirmText: '复制地址',
      success: (r) => { if (r.confirm) wx.setClipboardData({ data: CONFIG.WEB_ADMIN }); }
    });
  }
});
