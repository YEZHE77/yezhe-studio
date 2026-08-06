const { CONFIG } = require('../../utils/config.js');
const { requestTask } = require('../../utils/req.js');
const { getImageUrl } = require('../../utils/imageUrl.js');
const Bgm = require('../../utils/bgm.js');

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
    pwBusy: false,
    // 全屏幻灯片
    showSlideshow: false,
    slidePhotos: [],
    bgmUrl: ''
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
    Bgm.destroy();
    // 释放大图内存
    this.setData({ photos: [], title: '' });
  },

  onHide() {
    if (this.data.showSlideshow) Bgm.pause();
  },

  onShow() {
    if (this.data.showSlideshow) Bgm.resume();
  },

  onLoad(q) {
    if (q && q.token) {
      this.setData({ token: q.token });
      this.loadToken();
    } else if (q && q.orderId) {
      this.setData({ orderId: q.orderId });
      this.load();
    }
    // 获取 BGM 地址（后台设置）
    requestTask('/api/settings/studio').then((r) => {
      if (r && r.bgmUrl) this.setData({ bgmUrl: r.bgmUrl });
    }).catch(() => {});
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

  // 唤起全屏幻灯片（用户手势内触发 BGM 播放）
  openSlideshow() {
    if (!this.data.photos.length) return;
    const slidePhotos = this.data.photos.map((p) => ({ url: p.photo_url, preview: p.thumb || p.photo_url }));
    Bgm.init(this.data.bgmUrl);
    Bgm.play(); // 必须在用户点击手势内调用
    this.setData({ showSlideshow: true, slidePhotos });
  },

  // 关闭幻灯片：暂停 BGM 并记录进度（不销毁实例）
  closeSlideshow() {
    Bgm.pause();
    this.setData({ showSlideshow: false });
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
