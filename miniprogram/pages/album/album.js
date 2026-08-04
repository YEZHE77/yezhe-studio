const { request } = require('../../utils/req.js');

Page({
  data: { orderId: '', photos: [], allowDownload: false, savingUrl: '' },

  onLoad(q) {
    if (q && q.orderId) {
      this.setData({ orderId: q.orderId });
      this.load();
    }
  },

  async load() {
    try {
      const r = await request('/api/customer/album/' + this.data.orderId);
      this.setData({ photos: r.photos || [], allowDownload: !!r.allowDownload });
      if ((r.photos || []).length === 0) wx.showToast({ title: '成片尚未上传', icon: 'none' });
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  preview(e) {
    const url = e.currentTarget.dataset.url;
    const urls = (this.data.photos || []).map((p) => p.photo_url).filter(Boolean);
    if (url && urls.length) wx.previewImage({ current: url, urls });
  },

  save(e) {
    const url = e.currentTarget.dataset.url;
    if (this.data.savingUrl) return;
    this.setData({ savingUrl: url });
    wx.showLoading({ title: '保存中' });
    wx.downloadFile({
      url,
      success: (res) => {
        if (res.statusCode !== 200) { wx.hideLoading(); this.setData({ savingUrl: '' }); return wx.showToast({ title: '下载失败', icon: 'none' }); }
        wx.saveImageToPhotosAlbum({
          filePath: res.tempFilePath,
          success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
          fail: () => wx.showToast({ title: '保存失败，请授权相册', icon: 'none' }),
          complete: () => { wx.hideLoading(); this.setData({ savingUrl: '' }); }
        });
      },
      fail: () => { wx.hideLoading(); this.setData({ savingUrl: '' }); wx.showToast({ title: '下载失败', icon: 'none' }); }
    });
  }
});
