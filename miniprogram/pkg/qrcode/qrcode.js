const { requestTask } = require('../../utils/req.js');
const { rewriteHost } = require('../../utils/imageUrl.js');

Page({
  data: {
    id: null,
    title: '',
    cover: '',
    category: '',
    qrPath: '',      // 二维码本地临时文件（用于展示与保存）
    qrLoading: true,
    saving: false
  },
  _tasks: [],

  onLoad(options) {
    const id = options && options.id ? Number(options.id) : 0;
    this.setData({
      id,
      title: decodeURIComponent(options.title || ''),
      cover: rewriteHost(decodeURIComponent(options.cover || '')),
      category: decodeURIComponent(options.category || '')
    });
    this.genQr();
  },

  onUnload() {
    this._tasks.forEach((t) => { try { t.abort(); } catch (e) {} });
    this._tasks = [];
  },

  // 请求二维码接口（传 albumId），后端返回相册 H5 地址的二维码，写入临时文件
  fetchQr() {
    return new Promise((resolve, reject) => {
      if (!this.data.id) return reject(new Error('no id'));
      const t = requestTask('/api/qrcode?albumId=' + this.data.id);
      this._tasks.push(t.abort);
      t.promise.then((r) => {
        this._tasks = this._tasks.filter((x) => x !== t.abort);
        const dataUrl = (r && r.dataUrl) || '';
        if (!dataUrl) return reject(new Error('empty'));
        const fs = wx.getFileSystemManager();
        const filePath = wx.env.USER_DATA_PATH + '/qr-' + this.data.id + '.png';
        fs.writeFile({ filePath, data: dataUrl.split(',')[1], encoding: 'base64', success: () => resolve(filePath), fail: reject });
      }).catch(reject);
    });
  },

  // 进入页面即生成二维码用于预览
  async genQr() {
    this.setData({ qrLoading: true });
    try {
      const path = await this.fetchQr();
      this.setData({ qrPath: path, qrLoading: false });
    } catch (e) {
      this.setData({ qrLoading: false });
      wx.showToast({ title: '二维码生成失败', icon: 'none' });
    }
  },

  // 点击下载：重新请求接口拿到小程序码，保存到相册
  async onDownload() {
    if (this.data.saving) return;
    this.setData({ saving: true });
    wx.showLoading({ title: '保存中' });
    try {
      const path = await this.fetchQr();
      this.setData({ qrPath: path });
      await new Promise((res, rej) => wx.saveImageToPhotosAlbum({ filePath: path, success: res, fail: rej }));
      wx.showToast({ title: '二维码已保存到相册', duration: 1800 });
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ saving: false });
    }
  },

  onImgError(e) {
    const src = (e && e.detail && e.detail.src) || '';
    console.error('[qrcode] 图片加载失败，请检查 downloadFile 合法域名:', src);
  }
});
