const { request, requestTask } = require('../../utils/req.js');

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
    detailLoading: false,
    bookingOpen: false
  },
  _tasks: [],    // 可取消的请求任务
  _loading: false, // 全局加载锁

  onLoad() {
    this.loadAll();
  },

  // onShow 改为静默刷新：数据未过期则跳过，避免 tab 切换重复请求
  onShow() {
    const app = getApp();
    const cachedS = app.getCached('studio');
    if (cachedS) this.setData({ studio: cachedS });
    const cachedC = app.getCached('categories');
    if (cachedC) this.setData({ categories: cachedC });
    // 检查预约开关
    this.loadBooking();
  },

  onUnload() {
    this._tasks.forEach((t) => { try { t.abort(); } catch (e) {} });
    this._tasks = [];
    // 释放图片内存（detail弹窗中的大图列表）
    this.setData({ detail: null, works: [], banners: [], categories: [] });
  },

  onPullDownRefresh() {
    this.loadAll().then(() => wx.stopPullDownRefresh());
  },

  async loadAll() {
    if (this._loading) return;
    this._loading = true;
    try {
      // 优先使用缓存
      const app = getApp();
      let s = app.getCached('studio');
      let c = app.getCached('categories');
      if (!s || !c) {
        [s, c] = await Promise.all([this.loadStudio(), this.loadCategories()]);
      }
      if (s) this.setData({ studio: s });
      if (c) this.setData({ categories: c });
      await this.loadWorks(true);
    } finally {
      this._loading = false;
    }
  },

  async loadBooking() {
    try {
      const b = await request('/api/settings/booking');
      this.setData({ bookingOpen: b && b.open !== false });
    } catch (e) { /* 静默失败 */ }
  },

  async loadStudio() {
    try {
      const s = await request('/api/settings/studio');
      const app = getApp();
      app.setCached('studio', s || {});
      return s || {};
    } catch (e) { console.error('loadStudio err', e); return null; }
  },

  async loadCategories() {
    try {
      const cats = await request('/api/categories');
      const app = getApp();
      app.setCached('categories', cats || []);
      return cats || [];
    } catch (e) { console.error('loadCategories err', e); return null; }
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

  // 按钮即时反馈（≤150ms）: 先 UI 状态变更，再异步操作
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
  goAppointment() { wx.navigateTo({ url: '/pkg/schedule/schedule' }); },
  goAbout() { wx.navigateTo({ url: '/pkg/about/about' }); },

  async openWork(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ detailLoading: true, detail: { work: { title: '' }, albums: [] } });
    try {
      const { promise, abort } = requestTask('/api/works/public/' + id);
      this._tasks.push(abort);
      const d = await promise;
      this.setData({ detail: d, detailLoading: false });
    } catch (err) {
      if (err.type === 'cancel') return;
      this.setData({ detailLoading: false, detail: null });
      wx.showToast({ title: '打开失败', icon: 'none' });
    } finally {
      this._tasks = this._tasks.filter((t) => t !== abort);
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
