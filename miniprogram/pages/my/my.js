const { CONFIG } = require('../../utils/config.js');
const { requestTask } = require('../../utils/req.js');

Page({
  data: {
    openid: '', login: false, studio: null,
    nickname: '', wechat: '', showProfile: false
  },
  _tasks: [],

  onShow() {
    try {
      const openid = wx.getStorageSync('openid') || '';
      const token = wx.getStorageSync('token') || '';
      this.setData({
        openid, login: !!token,
        nickname: wx.getStorageSync('nickname') || '',
        wechat: wx.getStorageSync('wxid') || ''
      });
    } catch (e) {}
    this.loadStudio();
  },

  onUnload() {
    this._tasks.forEach((t) => { try { t.abort(); } catch (e) {} });
    this._tasks = [];
    this.setData({ studio: null });
  },

  _req(path, method, data) {
    const t = requestTask(path, method || 'GET', data || {});
    this._tasks.push(t.abort);
    return t.promise;
  },

  loadStudio() {
    const app = getApp();
    const cached = app.getCached('studio');
    if (cached) { this.setData({ studio: cached }); return; }
    this._req('/api/settings/studio')
      .then((s) => { this.setData({ studio: s }); app.setCached('studio', s || {}); })
      .catch(() => {});
  },

  go(e) {
    const url = e.currentTarget.dataset.url;
    wx.navigateTo({ url });
  },

  // 我的相册：拉取客户订单，多选则弹窗选择，再进入对应相册
  async openMyAlbum() {
    const token = wx.getStorageSync('token');
    if (!token) { wx.showToast({ title: '请先登录', icon: 'none' }); return; }
    wx.showLoading({ title: '加载中', mask: true });
    try {
      const r = await this._req('/api/customer/order/list');
      const orders = Array.isArray(r) ? r : [];
      wx.hideLoading();
      if (!orders.length) { wx.showToast({ title: '暂无相册', icon: 'none' }); return; }
      const pick = (o) => wx.navigateTo({ url: '/pkg/album/album?orderId=' + (o.orderId || o.id) });
      if (orders.length === 1) { pick(orders[0]); return; }
      const names = orders.map((o) => (o.title || o.customer_name || ('订单 ' + o.id)));
      wx.showActionSheet({
        itemList: names,
        success: (res) => pick(orders[res.tapIndex])
      });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  copyContact() {
    const wxid = (this.data.studio && this.data.studio.contact && this.data.studio.contact.wechat) || 'yezhe-studio';
    wx.setClipboardData({ data: wxid, success: () => wx.showToast({ title: '微信号已复制', icon: 'none' }) });
  },

  openAdmin() {
    wx.showModal({
      title: '商家后台',
      content: '管理端请在浏览器打开：' + CONFIG.WEB_ADMIN,
      confirmText: '复制地址',
      success: (r) => { if (r.confirm) wx.setClipboardData({ data: CONFIG.WEB_ADMIN }); }
    });
  },

  // 个人资料修改弹窗
  openProfile() { this.setData({ showProfile: true }); },
  closeProfile() { this.setData({ showProfile: false }); },
  noop() {},
  onNick(e) { this.setData({ nickname: e.detail.value }); },
  onWx(e) { this.setData({ wechat: e.detail.value }); },
  saveProfile() {
    wx.setStorageSync('nickname', this.data.nickname);
    wx.setStorageSync('wxid', this.data.wechat);
    this.setData({ showProfile: false });
    wx.showToast({ title: '已保存', icon: 'success' });
  }
});
