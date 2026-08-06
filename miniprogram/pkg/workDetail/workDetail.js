const { requestTask } = require('../../utils/req.js');
const { getImageUrl } = require('../../utils/imageUrl.js');

Page({
  data: {
    id: null,
    loading: true,
    error: false,
    // 自定义顶栏高度
    statusBarHeight: 20,
    navHeight: 44,
    // 视图：grid 两列网格 / flow 流式大图
    view: 'grid',
    // 相册内容
    title: '',
    category: '',
    albumCopy: '',
    cover: '',
    photos: [], // [{ url, thumb, preview }]
    // 相册密码锁
    locked: false,
    pw: '',
    pwErr: '',
    pwBusy: false,
    canShare: true // 锁定时置灰分享按钮
  },
  _tasks: [],

  onLoad(options) {
    const sys = wx.getSystemInfoSync();
    const statusBarHeight = sys.statusBarHeight || 20;
    const navHeight = 44;
    this.setData({ statusBarHeight, navHeight });

    const id = options && options.id ? Number(options.id) : 0;
    if (!id) {
      wx.showToast({ title: '参数错误', icon: 'none' });
      wx.navigateBack();
      return;
    }
    this.setData({ id });
    this.loadAlbum(id);
  },

  onUnload() {
    this._tasks.forEach((t) => { try { t.abort(); } catch (e) {} });
    this._tasks = [];
    this.setData({ photos: [] });
  },

  // 转发分享（右下角悬浮按钮触发）
  onShareAppMessage() {
    const d = this.data;
    return {
      title: d.title || 'YEZHE WORKSHOP 作品相册',
      path: '/pkg/workDetail/workDetail?id=' + d.id,
      imageUrl: (d.photos && d.photos[0] && d.photos[0].thumb) || ''
    };
  },

  onShareTimeline() {
    const d = this.data;
    return { title: d.title || 'YEZHE WORKSHOP 作品相册', query: 'id=' + d.id };
  },

  // 加载相册（带相册密码锁感知）
  async loadAlbum(id) {
    this.setData({ loading: true, error: false });
    try {
      const t = requestTask('/api/works/public/' + id + '/album');
      this._tasks.push(t.abort);
      const r = await t.promise;
      this._tasks = this._tasks.filter((x) => x !== t.abort);

      if (r.locked && r.albumLock) {
        // 相册已开启密码：全屏密码校验，分享按钮置灰
        this.setData({ loading: false, locked: true, canShare: false });
        return;
      }
      if (!r.gallery) {
        this.setData({ loading: false, error: true });
        return;
      }
      this.applyGallery(r.gallery);
      wx.setNavigationBarTitle({ title: r.gallery.title || '作品相册' });
    } catch (err) {
      this.setData({ loading: false, error: true });
      if (err && err.type === 'cancel') return;
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  applyGallery(g) {
    const photos = (g.photos || []).filter(Boolean).map((u, i) => ({
      id: i,
      url: u,
      thumb: getImageUrl(u, 'thumb'),
      preview: getImageUrl(u, 'preview')
    }));
    this.setData({
      loading: false,
      locked: false,
      canShare: true,
      title: g.title || '',
      category: g.category || g.subtitle || '',
      albumCopy: g.albumCopy || '',
      cover: getImageUrl(g.cover_url || '', 'thumb'),
      photos
    });
  },

  retry() {
    if (this.data.id) this.loadAlbum(this.data.id);
  },

  setView(e) {
    this.setData({ view: e.currentTarget.dataset.v });
  },

  goBack() { wx.navigateBack(); },

  // 点击图片：原生大图查看（支持左右滑动）
  previewImage(e) {
    const idx = e.currentTarget.dataset.idx;
    const urls = this.data.photos.map((p) => p.preview || p.url).filter(Boolean);
    const current = (this.data.photos[idx] && (this.data.photos[idx].preview || this.data.photos[idx].url)) || urls[0];
    if (current && urls.length) wx.previewImage({ current, urls });
  },

  onPwInput(e) { this.setData({ pw: e.detail.value, pwErr: '' }); },

  // 相册密码校验
  async verify() {
    if (this.data.pwBusy) return;
    const pw = (this.data.pw || '').trim();
    if (!pw) { this.setData({ pwErr: '请输入密码' }); return; }
    this.setData({ pwBusy: true, pwErr: '' });
    try {
      const t = requestTask('/api/works/public/' + this.data.id + '/album/verify', 'POST', { password: pw });
      this._tasks.push(t.abort);
      const r = await t.promise;
      this._tasks = this._tasks.filter((x) => x !== t.abort);
      if (!r.gallery) { this.setData({ pwBusy: false, pwErr: '相册内容不存在或已失效' }); return; }
      this.applyGallery(r.gallery);
      wx.setNavigationBarTitle({ title: r.gallery.title || '作品相册' });
    } catch (e) {
      this.setData({ pwBusy: false, pwErr: (e && e.message) || '密码错误' });
    }
  }
});
