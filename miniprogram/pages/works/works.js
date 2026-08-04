const { request } = require('../../utils/req.js');

Page({
  data: {
    categories: [],
    activeCat: 0,
    works: [],
    page: 1,
    finished: false,
    detail: null,
    detailLoading: false
  },

  onLoad() { this.loadCats(); this.loadWorks(true); },
  onPullDownRefresh() { this.loadWorks(true).then(() => wx.stopPullDownRefresh()); },
  onReachBottom() { if (!this.data.finished) this.loadWorks(false); },

  async loadCats() {
    try {
      const cats = await request('/api/categories');
      this.setData({ categories: [{ id: 0, name: '全部' }, ...(cats || [])] });
    } catch (e) {}
  },

  async loadWorks(reset) {
    const page = reset ? 1 : this.data.page + 1;
    const cat = this.data.activeCat;
    const q = cat ? ('?category=' + cat + '&page=' + page) : ('?page=' + page);
    try {
      const r = await request('/api/works/public' + q);
      const items = (r.items || []).map((w) => ({ ...w, cover: w.cover_url || '' }));
      this.setData({
        works: reset ? items : this.data.works.concat(items),
        page,
        finished: (this.data.works.length + items.length) >= (r.total || 0)
      });
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  selectCat(e) {
    const id = e.currentTarget.dataset.id;
    if (id === this.data.activeCat) return;
    this.setData({ activeCat: id, works: [], page: 1, finished: false });
    this.loadWorks(true);
  },

  async openWork(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ detailLoading: true, detail: { work: { title: '' }, albums: [] } });
    try {
      const d = await request('/api/works/public/' + id);
      this.setData({ detail: d, detailLoading: false });
    } catch (err) {
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
