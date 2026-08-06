const { requestTask } = require('../../utils/req.js');
const { getImageUrl } = require('../../utils/imageUrl.js');

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
    bookingOpen: false,
    // 顶部自定义导航栏总高度（px）：状态栏高度 + 44px 导航内容区，随机型动态计算（默认兜底 64）
    navHeight: 64
  },
  _tasks: [],    // 可取消的请求任务
  _loading: false, // 全局加载锁

  onLoad() {
    this.setNavHeight();
    this.loadAll();
  },

  // 动态获取状态栏高度 + 固定导航内容区(44px) 得到导航总高度，
  // 供 --nav-height CSS 变量下偏移首屏轮播，覆盖全部机型（刘海/挖孔屏状态栏不同）。
  setNavHeight() {
    let navHeight = 64; // 兜底：约 statusBar(20) + navContent(44)
    try {
      const win = wx.getWindowInfo();           // 微信推荐 API，替代已废弃的 wx.getSystemInfoSync
      const statusBarHeight = win.statusBarHeight || 20;
      const navContentHeight = 44;              // 自定义导航内容区高度（与 customNav 组件一致，全机型恒定）
      navHeight = Math.round(statusBarHeight + navContentHeight);
    } catch (e) { /* 个别环境无此 API，沿用兜底值 */ }
    this.setData({ navHeight });
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
    this.setData({ works: [], banners: [], categories: [] });
  },

  // 统一请求封装：收集 abort 句柄，供 onUnload 终止未完成请求
  _req(path, method, data) {
    const t = requestTask(path, method || 'GET', data || {});
    this._tasks.push(t.abort);
    return t.promise;
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
      const b = await this._req('/api/settings/booking');
      this.setData({ bookingOpen: b && b.open !== false });
    } catch (e) { /* 静默失败 */ }
  },

  async loadStudio() {
    try {
      const s = await this._req('/api/settings/studio');
      const app = getApp();
      app.setCached('studio', s || {});
      // 优先使用 B 端上传的首页轮播图；没有再用作品封面兜底
      const heroImages = (s && s.heroImages) || [];
      if (heroImages.length) {
        const banners = heroImages.map((url) => getImageUrl(url, 'thumb')).filter(Boolean);
        this.setData({ banners });
      }
      return s || {};
    } catch (e) { console.error('loadStudio err', e); return null; }
  },

  async loadCategories() {
    try {
      const cats = await this._req('/api/categories');
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
      const r = await this._req('/api/works/public?' + params.join('&'));
      const items = (r.items || []).map((w) => ({ ...w, cover: getImageUrl(w.cover_url || '', 'thumb') }));
      const merged = reset ? items : this.data.works.concat(items);
      // 只在未配置 heroImages 时用作品封面兜底轮播
      const fallbackBanners = reset && !this.data.banners.length
        ? items.slice(0, 3).map((w) => getImageUrl(w.cover_url || '', 'thumb')).filter(Boolean)
        : this.data.banners;
      this.setData({
        works: merged,
        page,
        hasMore: merged.length < (r.total || 0),
        banners: fallbackBanners
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

  goAppointment() { wx.navigateTo({ url: '/pkg/schedule/schedule' }); },
  goAbout() { wx.navigateTo({ url: '/pkg/about/about' }); },
  goMy() { wx.navigateTo({ url: '/pages/my/my' }); },

  openWork(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pkg/workDetail/workDetail?id=' + id });
  },
});
