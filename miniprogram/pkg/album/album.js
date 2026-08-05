const { CONFIG } = require('../../utils/config.js');
const { requestTask } = require('../../utils/req.js');
const { getImageUrl } = require('../../utils/imageUrl.js');

function abs(u) {
  if (!u) return '';
  if (u.indexOf('http') === 0) return u;
  if (u.indexOf('/uploads') === 0) return CONFIG.API_BASE + u;
  return u;
}

Page({
  data: {
    orderId: '',
    token: '',
    locked: false,
    photos: [],
    allowDownload: false,
    savingUrl: '',
    title: '',
    pw: '',
    pwErr: '',
    pwBusy: false
  },
  _tasks: [],

  // 统一请求封装：收集 abort 句柄，供 onUnload 终止未完成请求
  _req(path, method, data) {
    const t = requestTask(path, method || 'GET', data || {});
    this._tasks.push(t.abort);
    return t.promise;
  },

  onUnload() {
    this._tasks.forEach((ab) => { try { ab(); } catch (e) {} });
    this._tasks = [];
    // 释放大图内存
    this.setData({ photos: [], title: '' });
  },

  onLoad(q) {
    if (q && q.token) {
      this.setData({ token: q.token });
      this.loadToken();
    } else if (q && q.orderId) {
      this.setData({ orderId: q.orderId });
      this.load();
    }
  },

  // 客户自有订单（openid 行级隔离）
  async load() {
    try {
      const r = await this._req('/api/customer/album/' + this.data.orderId);
      const photos = (r.photos || []).map((p) => ({ ...p, thumb: getImageUrl(p.photo_url, 'preview') }));
      this.setData({ photos, allowDownload: !!r.allowDownload });
      if (photos.length === 0) wx.showToast({ title: '成片尚未上传', icon: 'none' });
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  // 分享令牌模式（只读交付，公开网关）
  async loadToken() {
    try {
      const r = await this._req('/api/share/' + this.data.token);
      if (r.locked) {
        this.setData({ locked: true, title: (r.meta && r.meta.title) || '受保护的影集' });
        return;
      }
      this.applyTokenData(r);
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  applyTokenData(r) {
    const data = (r.data && r.data.works) ? r.data : null;
    if (!data) { this.setData({ photos: [] }); return; }
    const photos = [];
    (data.works || []).forEach((w) => {
      (w.photos || []).forEach((p) => {
        const url = abs(p.url);
        photos.push({ photo_url: url, thumb: getImageUrl(url, 'preview'), zone: p.zone });
      });
    });
    this.setData({
      photos,
      allowDownload: true,
      title: (r.meta && r.meta.title) || '',
      locked: false
    });
  },

  onPwInput(e) { this.setData({ pw: e.detail.value, pwErr: '' }); },

  async verify() {
    if (this.data.pwBusy) return;
    this.setData({ pwBusy: true, pwErr: '' });
    try {
      const r = await this._req('/api/share/' + this.data.token + '/verify', 'POST', { password: this.data.pw });
      this.applyTokenData(r);
    } catch (e) {
      this.setData({ pwErr: (e && e.message) || '密码错误' });
    } finally {
      this.setData({ pwBusy: false });
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
