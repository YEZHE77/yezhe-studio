const { request } = require('../../utils/req.js');

Page({
  data: {
    studio: { name: '', logo: '', intro: '', contact: {} },
    categories: [],
    activeCat: 0,
    works: [],
    page: 1,
    pageSize: 8,
    hasMore: true,
    loading: false,
    banners: [],
    detail: null,
    detailLoading: false
  },

  onLoad() { this.loadAll(); },
  onShow() { this.loadAll(); },

  onPullDownRefresh() {
    this.loadAll().then(() => wx.stopPullDownRefresh());
  },

  async loadAll() {
    await Promise.all([this.loadStudio(), this.loadCategories()]);
    await this.loadWorks(true);
  },

  async loadStudio() {
    try {
      const s = await request('/api/settings/studio');
      this.setData({ studio: s || {} });
    } catch (e) { console.error('loadStudio err', e); }
  },

  async loadCategories() {
    try {
      const cats = await request('/api/categories');
      this.setData({ categories: cats || [] });
    } catch (e) { console.error('loadCategories err', e); }
  },

  async loadWorks(reset) {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const page = reset ? 1 : this.data.page + 1;
      const cat = this.data.activeCat;
      const params = ['page=' + page, 'pageSize=' + this.data.pageSize];
      if (cat) params.push('category=' + cat);
      const r = await request('/api/works/public?' + params.join('&'));
      const items = (r.items || []).map((w) => ({ ...w, cover: w.cover_url || '' }));
      const merged = reset ? items : this.data.works.concat(items);
      this.setData({
        works: merged,
        page,
        hasMore: merged.length < (r.total || 0),
        banners: reset ? items.slice(0, 3).map((w) => w.cover_url).filter(Boolean) : this.data.banners
      });
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  loadMore() {
    if (this.data.hasMore && !this.data.loading) this.loadWorks(false);
  },

  selectCat(e) {
    const id = Number(e.currentTarget.dataset.id) || 0;
    if (id === this.data.activeCat) return;
    this.setData({ activeCat: id, works: [], page: 1, hasMore: true });
    this.loadWorks(true);
  },

  copyWechat() {
    const wechat = (this.data.studio.contact && this.data.studio.contact.wechat) || '';
    if (!wechat) {
      wx.showToast({ title: '未配置微信', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: wechat,
      success: () => wx.showToast({ title: '已复制微信号', icon: 'none' })
    });
  },

  callPhone() {
    const phone = (this.data.studio.contact && this.data.studio.contact.phone) || '';
    if (!phone) {
      wx.showToast({ title: '未配置电话', icon: 'none' });
      return;
    }
    wx.makePhoneCall({ phoneNumber: phone });
  },

  goWorks() { wx.switchTab({ url: '/pages/works/works' }); },
  goPackage() { wx.switchTab({ url: '/pages/package/package' }); },
  goAppointment() { wx.navigateTo({ url: '/pages/schedule/schedule' }); },

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
  },

  noop() {}
});
