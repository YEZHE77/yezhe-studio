const { request } = require('../../utils/req.js');

Page({
  data: {
    studio: {
      name: '叶哲 STUDIO',
      intro: '',
      cover: '',
      logo: '',
      contact: { phone: '', wechat: '', address: '' }
    },
    loading: true
  },

  _tasks: [], onUnload() { this._tasks.forEach(function(t){ try { t.abort(); } catch(e) {} }); this.setData({ studio: null }); },

  onLoad() { this.load(); },
  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },

  load() {
    this.setData({ loading: true });
    return request('/api/settings/studio')
      .then((s) => this.setData({ studio: s || this.data.studio, loading: false }))
      .catch(() => this.setData({ loading: false }));
  },

  copyWechat() {
    const wxid = (this.data.studio.contact && this.data.studio.contact.wechat) || '';
    if (!wxid) return wx.showToast({ title: '未配置微信号', icon: 'none' });
    wx.setClipboardData({ data: wxid, success: () => wx.showToast({ title: '微信号已复制', icon: 'none' }) });
  },

  callPhone() {
    const phone = (this.data.studio.contact && this.data.studio.contact.phone) || '';
    if (!phone) return wx.showToast({ title: '未配置电话', icon: 'none' });
    wx.makePhoneCall({ phoneNumber: phone });
  },

  previewCover() {
    if (this.data.studio.cover) wx.previewImage({ urls: [this.data.studio.cover] });
  },

  noop() {}
});
