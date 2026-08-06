// pages/share/share.js —— 统一分享扫码路由页（C 端小程序）
// 职责：读取 token → 调公开网关校验令牌/有效期/可选密码 → 按 type 渲染只读视图。
// 这是 5 大模块共用的分享底座：B 端生成二维码（小程序路径 pages/share/share?token=xxx），
// 客户扫码即进入本页，校验通过后查看对应内容（影集/作品/套系/档期/账单）。
const { CONFIG } = require('../../utils/config.js');
const { requestTask } = require('../../utils/req.js');
const { getImageUrl } = require('../../utils/imageUrl.js');

// 把后端返回的相对 /uploads 路径补全为可访问的完整 URL
function abs(u) {
  if (!u) return '';
  if (u.indexOf('http') === 0) return u;
  if (u.indexOf('/uploads') === 0) return CONFIG.API_BASE + u;
  return u;
}

// 按类型规整 payload（补全图片地址、适配展示字段）
function normalize(type, data) {
  if (!data) return data;
  if (type === 'order') {
    const works = (data.works || []).map((w) => ({
      title: w.title || '',
      photos: (w.photos || []).map((p) => {
        const url = abs(p.url);
        return { url, thumb: getImageUrl(url, 'preview'), zone: p.zone };
      })
    }));
    return { order: data.order || {}, works };
  }
  if (type === 'work') {
    return {
      work: data.work || {},
      photos: (data.photos || []).map((p) => {
        const url = abs(p.url);
        return { url, thumb: getImageUrl(url, 'preview'), zone: p.zone };
      })
    };
  }
  if (type === 'package') {
    const p = data.package || {};
    return { package: { ...p, cover_url: abs(p.cover_url), cover_thumb: getImageUrl(abs(p.cover_url), 'thumb') } };
  }
  if (type === 'schedule') {
    return { schedule: data.schedule || {} };
  }
  if (type === 'bill') {
    return { order: data.order || {}, payments: data.payments || [], summary: data.summary || {} };
  }
  return data;
}

Page({
  data: {
    token: '',
    loading: true,
    error: '',
    locked: false,
    title: '',
    type: '',
    payload: null,
    pw: '',
    pwErr: '',
    pwBusy: false,
    ZONE_LABEL: { sample: '样片', final: '成片' }
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
    this.setData({ payload: null });
  },

  onLoad(q) {
    const token = (q && q.token) || '';
    this.setData({ token });
    if (!token) {
      this.setData({ loading: false, error: '缺少分享令牌' });
      return;
    }
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const r = await this._req('/api/share/' + this.data.token);
      if (r.locked) {
        this.setData({ loading: false, locked: true, title: (r.meta && r.meta.title) || '受保护的分享' });
      } else if (r.meta && r.meta.type === 'album') {
        // 电子相册：直接跳转沉浸式画廊页
        wx.redirectTo({ url: '/pkg/gallery/gallery?token=' + this.data.token });
        return;
      } else {
        this.setData({
          loading: false,
          type: r.meta.type,
          title: (r.meta && r.meta.title) || '',
          payload: normalize(r.meta.type, r.data)
        });
      }
    } catch (e) {
      this.setData({ loading: false, error: (e && e.message) || (typeof e === 'string' ? e : '加载失败') });
    }
  },

  onPwInput(e) { this.setData({ pw: e.detail.value, pwErr: '' }); },

  async verify() {
    if (this.data.pwBusy) return;
    this.setData({ pwBusy: true, pwErr: '' });
    try {
      const r = await this._req('/api/share/' + this.data.token + '/verify', 'POST', { password: this.data.pw });
      this.setData({
        locked: false,
        type: r.meta.type,
        title: (r.meta && r.meta.title) || '',
        payload: normalize(r.meta.type, r.data)
      });
    } catch (e) {
      this.setData({ pwErr: (e && e.message) || (typeof e === 'string' ? e : '密码错误') });
    } finally {
      this.setData({ pwBusy: false });
    }
  },

  // 预览大图（订单/作品照片）
  preview(e) {
    const url = e.currentTarget.dataset.url;
    const photos = this.data.payload.photos || [];
    const urls = photos.map((p) => p.url).filter(Boolean);
    if (url && urls.length) wx.previewImage({ current: url, urls });
  },

  // 保存到相册（订单/作品照片）
  save(e) {
    const url = e.currentTarget.dataset.url;
    wx.showLoading({ title: '保存中' });
    wx.downloadFile({
      url,
      success: (res) => {
        if (res.statusCode !== 200) { wx.hideLoading(); return wx.showToast({ title: '下载失败', icon: 'none' }); }
        wx.saveImageToPhotosAlbum({
          filePath: res.tempFilePath,
          success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
          fail: () => wx.showToast({ title: '请授权相册权限', icon: 'none' }),
          complete: () => wx.hideLoading()
        });
      },
      fail: () => { wx.hideLoading(); wx.showToast({ title: '下载失败', icon: 'none' }); }
    });
  },

  // 跳转到对应模块的完整交互页（透传 token，供后续逐模块接入）
  goModule(e) {
    const page = e.currentTarget.dataset.page;
    wx.redirectTo({ url: page + '?token=' + this.data.token });
  },

  goBack() { wx.navigateBack({ delta: 1 }); }
});
