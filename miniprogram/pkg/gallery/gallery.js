// pkg/gallery/gallery.js —— 作品/客片电子相册（C 端小程序，对应零屿 VISION 婚礼电子相册）
// 两种打开方式：
//   1) 分享令牌模式：?token=xxx（公开网关 /api/share/:token，type=album/work）
//   2) 作品直连模式：?workId=xxx（公开接口 /api/works/public/:id/album，客户无需登录）
// 沉浸式上下滑动 + 播放/投屏/分享/更多；支持 onShareAppMessage 转发给好友。
const { requestTask } = require('../../utils/req.js');
const { getImageUrl, rewriteHost } = require('../../utils/imageUrl.js');

function abs(u) {
  if (!u) return '';
  if (u.indexOf('http') === 0) return u;
  if (u.indexOf('/uploads') === 0) return CONFIG.API_BASE + u;
  return u;
}

// 重写 gallery 对象中可能含 workers.dev 的图片字段
function fixGalleryLogo(g) {
  if (g && g.brand_logo) g.brand_logo = rewriteHost(g.brand_logo);
  return g;
}

Page({
  data: {
    loading: true,
    error: '',
    gallery: null,
    photos: [],
    current: 0,
    playing: false,
    toast: '',
    token: '',
    workId: '',
    albumLock: false, // 相册密码锁（访客需输入密码）
    pw: '',
    pwErr: '',
    pwBusy: false
  },
  _tasks: [],
  _toastTimer: null,

  onLoad(q) {
    const token = (q && q.token) || '';
    const workId = (q && q.workId) || '';
    if (token) {
      this.setData({ token });
      this.loadToken(token);
    } else if (workId) {
      this.setData({ workId });
      this.loadWork(workId);
    } else {
      this.setData({ loading: false, error: '缺少参数' });
    }
  },

  onUnload() {
    this._tasks.forEach((t) => { try { t(); } catch (e) {} });
    this._tasks = [];
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this.setData({ gallery: null, photos: [] });
  },

  // 分享令牌模式（只读交付，公开网关）
  async loadToken(token) {
    this.setData({ loading: true, error: '' });
    try {
      const t = requestTask('/api/share/' + token);
      this._tasks.push(t.abort);
      const r = await t.promise;
      this._tasks = this._tasks.filter((x) => x !== t.abort);
      if (r.locked && r.meta && r.meta.albumLock) { this.setData({ loading: false, albumLock: true }); return; }
      if (r.locked) { this.setData({ loading: false, error: '该分享已加密，请输入密码' }); return; }
      const g = (r.data && (r.data.gallery || r.data.work)) || null;
      if (!g) { this.setData({ loading: false, error: '相册内容不存在或已失效' }); return; }
      const photos = (g.photos || []).map((u) => getImageUrl(abs(u), 'preview')).filter(Boolean);
      fixGalleryLogo(g);
      this.setData({ loading: false, gallery: g, photos });
      wx.setNavigationBarTitle({ title: g.subtitle || g.title || '作品相册' });
    } catch (e) {
      this.setData({ loading: false, error: (e && e.message) || '加载失败' });
    }
  },

  // 作品直连模式（公开接口，客户无需登录）
  async loadWork(workId) {
    this.setData({ loading: true, error: '' });
    try {
      const t = requestTask('/api/works/public/' + workId + '/album');
      this._tasks.push(t.abort);
      const r = await t.promise;
      this._tasks = this._tasks.filter((x) => x !== t.abort);
      if (r.locked && r.albumLock) { this.setData({ loading: false, albumLock: true }); return; }
      const g = (r && r.gallery) || null;
      if (!g) { this.setData({ loading: false, error: '作品相册不存在或已失效' }); return; }
      const photos = (g.photos || []).map((u) => getImageUrl(abs(u), 'preview')).filter(Boolean);
      fixGalleryLogo(g);
      this.setData({ loading: false, gallery: g, photos });
      wx.setNavigationBarTitle({ title: g.subtitle || g.title || '作品相册' });
    } catch (e) {
      this.setData({ loading: false, error: (e && e.message) || '加载失败' });
    }
  },

  onSwiper(e) { this.setData({ current: e.detail.current }); },

  togglePlay() { this.setData({ playing: !this.data.playing }); },

  // 转发分享：右上角「···」或系统菜单触发，把当前相册链接分享给好友
  onShareAppMessage() {
    const g = this.data.gallery || {};
    const path = this.data.token
      ? '/pages/share/share?token=' + this.data.token
      : '/pkg/gallery/gallery?workId=' + this.data.workId;
    return {
      title: g.title || g.subtitle || 'YEZHE WORKSHOP 作品相册',
      path,
      imageUrl: (this.data.photos && this.data.photos[0]) || ''
    };
  },

  // 分享到朋友圈
  onShareTimeline() {
    const g = this.data.gallery || {};
    return {
      title: g.title || g.subtitle || 'YEZHE WORKSHOP 作品相册',
      query: this.data.token ? ('token=' + this.data.token) : ('workId=' + this.data.workId)
    };
  },

  cast() { this.showToast('请下拉控制中心 → 屏幕镜像投屏到电视'); },

  goMore() { wx.reLaunch({ url: '/pages/index/index' }); },

  goBack() { wx.navigateBack({ delta: 1 }); },

  onPwInput(e) { this.setData({ pw: e.detail.value, pwErr: '' }); },

  // 相册密码解锁：兼容分享令牌模式与作品直连模式
  async unlock() {
    const pw = (this.data.pw || '').trim();
    if (!pw) { this.setData({ pwErr: '请输入密码' }); return; }
    this.setData({ pwBusy: true, pwErr: '' });
    try {
      const endpoint = this.data.token
        ? '/api/share/' + this.data.token + '/verify'
        : '/api/works/public/' + this.data.workId + '/album/verify';
      const t = requestTask(endpoint, 'POST', { password: pw });
      this._tasks.push(t.abort);
      const r = await t.promise;
      this._tasks = this._tasks.filter((x) => x !== t.abort);
      const g = r.gallery || (r.data && r.data.gallery) || null;
      if (!g) { this.setData({ pwBusy: false, pwErr: '相册内容不存在或已失效' }); return; }
      const photos = (g.photos || []).map((u) => getImageUrl(abs(u), 'preview')).filter(Boolean);
      fixGalleryLogo(g);
      this.setData({ pwBusy: false, albumLock: false, pw: '', gallery: g, photos });
      wx.setNavigationBarTitle({ title: g.subtitle || g.title || '作品相册' });
    } catch (e) {
      this.setData({ pwBusy: false, pwErr: (e && e.message) || '密码错误' });
    }
  },

  showToast(msg) {
    this.setData({ toast: msg });
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.setData({ toast: '' }), 2400);
  }
});
