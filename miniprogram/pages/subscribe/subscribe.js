const { request } = require('../../utils/req.js');

Page({
  data: { tmplId: '', subscribed: false },

  onTmpl(e) { this.setData({ tmplId: e.detail.value }); },

  requestSubscribe() {
    const tmplId = this.data.tmplId.trim();
    if (!tmplId) return wx.showToast({ title: '请填写订阅模板 ID', icon: 'none' });
    wx.requestSubscribeMessage({
      tmplIds: [tmplId],
      success: async (res) => {
        const openid = wx.getStorageSync('openid') || '';
        try {
          await request('/api/wx/subscribe-msg', 'POST', { openid, templateId: tmplId, data: res });
          this.setData({ subscribed: true });
          wx.showToast({ title: '订阅成功', icon: 'success' });
        } catch (e) {
          wx.showToast({ title: '订阅记录失败', icon: 'none' });
        }
      },
      fail: () => wx.showToast({ title: '已取消订阅', icon: 'none' })
    });
  }
});
