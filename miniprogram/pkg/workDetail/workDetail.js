const { request, requestTask } = require('../../utils/req.js');
const { getImageUrl } = require('../../utils/imageUrl.js');

Page({
  data: {
    id: null,
    work: { title: '', description: '', cover_url: '' },
    albums: [],
    loading: true,
    error: false
  },
  _tasks: [],

  onLoad(options) {
    const id = options && options.id ? Number(options.id) : 0;
    if (!id) {
      wx.showToast({ title: '参数错误', icon: 'none' });
      wx.navigateBack();
      return;
    }
    this.setData({ id });
    this.loadDetail(id);
  },

  onUnload() {
    this._tasks.forEach((t) => { try { t.abort(); } catch (e) {} });
    this._tasks = [];
    this.setData({ albums: [] });
  },

  async loadDetail(id) {
    this.setData({ loading: true, error: false });
    try {
      const { promise, abort } = requestTask('/api/works/public/' + id);
      this._tasks.push(abort);
      const d = await promise;
      this._tasks = this._tasks.filter((t) => t !== abort);
      this.setData({
        work: d.work || { title: '', description: '', cover_url: '' },
        albums: (d.albums || []).filter((a) => a.photo_url)
          .map((a) => ({ ...a, thumb: getImageUrl(a.photo_url, 'preview') })),
        loading: false
      });
      // 设置页面标题
      if (d.work && d.work.title) {
        wx.setNavigationBarTitle({ title: d.work.title });
      }
    } catch (err) {
      this.setData({ loading: false, error: true });
      if (err && err.type === 'cancel') return;
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  previewImage(e) {
    const url = e.currentTarget.dataset.url;
    const urls = this.data.albums.map((a) => a.photo_url).filter(Boolean);
    if (url && urls.length) wx.previewImage({ current: url, urls });
  },

  retry() {
    if (this.data.id) this.loadDetail(this.data.id);
  },

  // 查看沉浸式电子相册（公开接口，无需登录即可转发分享）
  openAlbum() {
    if (!this.data.id) return;
    wx.navigateTo({ url: '/pkg/gallery/gallery?workId=' + this.data.id });
  },

  goBack() { wx.navigateBack(); }
});
