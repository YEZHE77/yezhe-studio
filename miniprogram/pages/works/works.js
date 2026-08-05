const { request, requestTask } = require('../../utils/req.js');

Page({
  data: {
    categories: [],
    activeCat: 0,
    works: [],
    page: 1,
    pageSize: 12,
    finished: false,
    loading: false,
    detail: null,
    detailLoading: false,
    skeleton: true   // 首次加载骨架屏
  },
  _tasks: [],
  _loadingWorks: false,

  onLoad() { this.loadCats(); this.loadWorks(true); },
  onPullDownRefresh() { this.loadWorks(true).then(() => wx.stopPullDownRefresh()); },

  onReachBottom() {
    if (!this.data.finished && !this._loadingWorks) this.loadWorks(false);
  },

  onUnload() {
    this._tasks.forEach((t) => { try { t.abort(); } catch (e) {} });
    this._tasks = [];
    // 释放图片内存
    this.setData({ works: [], detail: null, categories: [] });
  },

  async loadCats() {
    const app = getApp();
    const cached = app.getCached('categories');
    if (cached) {
      this.setData({ categories: [{ id: 0, name: '全部' }, ...cached] });
      return;
    }
    try {
      const cats = await request('/api/categories');
      app.setCached('categories', cats || []);
      this.setData({ categories: [{ id: 0, name: '全部' }, ...(cats || [])] });
    } catch (e) { /* 静默失败 */ }
  },

  async loadWorks(reset) {
    if (this._loadingWorks) return;
    this._loadingWorks = true;
    this.setData({ loading: true });
    try {
      const page = reset ? 1 : this.data.page + 1;
      const cat = this.data.activeCat;
      const q = cat ? ('?category=' + cat + '&page=' + page + '&pageSize=' + this.data.pageSize)
                   : ('?page=' + page + '&pageSize=' + this.data.pageSize);
      const r = await request('/api/works/public' + q);
      const items = (r.items || []).map((w) => ({ ...w, cover: w.cover_url || '' }));
      const merged = reset ? items : this.data.works.concat(items);
      this.setData({
        works: merged,
        page,
        finished: merged.length >= (r.total || 0),
        skeleton: false
      });
    } catch (e) {
      if (e && e.type === 'cancel') return;
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this._loadingWorks = false;
      this.setData({ loading: false });
    }
  },

  selectCat(e) {
    const id = e.currentTarget.dataset.id;
    if (id === this.data.activeCat) return;
    this.setData({ activeCat: id, works: [], page: 1, finished: false, skeleton: true });
    this.loadWorks(true);
  },

  async openWork(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ detailLoading: true, detail: { work: { title: '' }, albums: [] } });
    try {
      const { promise, abort } = requestTask('/api/works/public/' + id);
      this._tasks.push(abort);
      const d = await promise;
      this.setData({ detail: d, detailLoading: false });
      this._tasks = this._tasks.filter((t) => t !== abort);
    } catch (err) {
      if (err && err.type === 'cancel') return;
      this.setData({ detail: null, detailLoading: false });
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
