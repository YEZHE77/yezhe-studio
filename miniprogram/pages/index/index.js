const { request } = require('../../utils/req.js');

Page({
  data: {
    works: [],
    packages: [],
    reviews: [],
    detail: null,      // 作品大图弹层
    detailLoading: false
  },

  onLoad() { this.loadAll(); },
  onShow() { this.loadAll(); },

  onPullDownRefresh() {
    this.loadAll().then(() => wx.stopPullDownRefresh());
  },

  async loadAll() {
    try {
      const [works, pkgs, reviews] = await Promise.all([
        request('/api/works/public?pageSize=6'),
        request('/api/packages/public'),
        request('/api/customer/evaluate/public')
      ]);
      this.setData({
        works: (works.items || []).map((w) => ({ ...w, cover: w.cover_url || '' })),
        packages: (pkgs || []).slice(0, 4),
        reviews: (reviews || []).slice(0, 3)
      });
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  goWorks() { wx.switchTab({ url: '/pages/works/works' }); },
  goPackage() { wx.switchTab({ url: '/pages/package/package' }); },
  goAppointment() { wx.navigateTo({ url: '/pages/appointment/appointment' }); },

  async openWork(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ detailLoading: true, detail: { work: { title: '' }, albums: [] } });
    try {
      const d = await request('/api/works/public/' + id);
      this.setData({ detail: d, detailLoading: false });
    } catch (err) {
      this.setData({ detailLoading: false, detail: null });
      wx.showToast({ title: '打开失败', icon: 'none' });
    }
  },
  closeDetail() { this.setData({ detail: null }); },

  previewImage(e) {
    const url = e.currentTarget.dataset.url;
    const urls = (this.data.detail.albums || []).map((a) => a.photo_url).filter(Boolean);
    if (url && urls.length) wx.previewImage({ current: url, urls });
  }
});
