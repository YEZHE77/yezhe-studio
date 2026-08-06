// 相册上传页（小程序端，对应需求 C）
// 依赖 pkg/uploadDedup —— 选图后自动置灰重复照片、过滤后仅上传新照片。
//
// ⚠️ 说明：当前小程序为 C 端（客户浏览/选片），相册上传接口需管理员会话（admin token）。
//   本页从 getApp().globalData.adminToken 取管理员令牌；若未登录管理端则提示「需管理员登录」。
//   该页已注册在 app.json，可作为未来 B 端摄影师上传入口直接启用（无需改后端）。

const dedup = require('../uploadDedup/uploadDedup.js');
const { CONFIG } = require('../../config.js');

function getApiBase() { return CONFIG.API_BASE; }

Page({
  data: {
    workId: '',
    zone: 'sample',
    previews: [],      // { tempFilePath, digest, size, sign, dup, error }
    toUploadCount: 0,  // 待上传数（已剔除重复）
    dupCount: 0,       // 重复数
    uploading: false,
    uploadProgress: 0
  },

  onLoad(query) {
    this.setData({
      workId: (query && query.workId) || '',
      zone: (query && query.zone) || 'sample'
    });
  },

  onChoose() {
    const token = this._adminToken();
    if (!token) return;
    if (this.data.uploading) return;
    dedup.chooseAndDedup(this.data.workId, token, 9)
      .then(({ previews, toUploadCount, dupCount }) => {
        this.setData({ previews, toUploadCount, dupCount });
      })
      .catch(() => wx.showToast({ title: '选图失败', icon: 'none' }));
  },

  async onConfirm() {
    const toUpload = this.data.previews.filter((p) => !p.dup);
    if (!toUpload.length) { wx.showToast({ title: '无新照片', icon: 'none' }); return; }
    const token = this._adminToken();
    if (!token) return;

    this.setData({ uploading: true, uploadProgress: 0 });
    try {
      const items = [];
      for (let i = 0; i < toUpload.length; i++) {
        const p = toUpload[i];
        const url = await this._uploadOne(p.tempFilePath, token);
        items.push({ url, originalName: p.digest, size: p.size });
        this.setData({ uploadProgress: Math.round(((i + 1) / toUpload.length) * 100) });
      }
      // 仅上传新照片；重复项已被过滤，不会发起本段请求
      await new Promise((resolve, reject) => {
        wx.request({
          url: `${getApiBase()}/api/works/${this.data.workId}/albums`,
          method: 'POST',
          header: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          data: { zone: this.data.zone, items },
          success: (res) => (res.statusCode >= 200 && res.statusCode < 300) ? resolve(res) : reject(new Error((res.data && res.data.error) || '提交失败')),
          fail: reject
        });
      });
      const dupCount = this.data.previews.length - toUpload.length;
      wx.showToast({ title: `上传成功 ${items.length} 张（跳过 ${dupCount} 重复）`, icon: 'none' });
      this.setData({ previews: [], toUploadCount: 0, dupCount: 0 });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '上传失败', icon: 'none' });
    } finally {
      this.setData({ uploading: false, uploadProgress: 0 });
    }
  },

  _uploadOne(tempFilePath, token) {
    return new Promise((resolve, reject) => {
      wx.uploadFile({
        url: `${getApiBase()}/api/upload`,
        filePath: tempFilePath,
        name: 'file',
        formData: { category: 'client', isPublic: '1' },
        header: { Authorization: 'Bearer ' + token },
        success: (res) => {
          try { resolve(JSON.parse(res.data).url); }
          catch (e) { reject(new Error('上传返回解析失败')); }
        },
        fail: reject
      });
    });
  },

  _adminToken() {
    const t = getApp().globalData && getApp().globalData.adminToken;
    if (!t) { wx.showToast({ title: '需管理员登录', icon: 'none' }); return null; }
    return t;
  },

  onClose() {
    if (this.data.uploading) return;
    this.setData({ previews: [], toUploadCount: 0, dupCount: 0 });
  }
});
