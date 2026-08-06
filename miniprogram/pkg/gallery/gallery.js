// pkg/gallery/gallery.js —— 客片电子相册（C 端小程序，对应零屿 VISION 婚礼电子相册）
// 复用 /api/share/:token 公开网关（type=album）；沉浸式上下滑动 + 播放/投屏/分享/更多。
const { requestTask } = require('../../utils/req.js');
const { getImageUrl } = require('../../utils/imageUrl.js');

function abs(u) {
  if (!u) return '';
  if (u.indexOf('http') === 0) return u;
  if (u.indexOf('/uploads') === 0) return CONFIG.API_BASE + u;
  return u;
}

Page({
  data: {
    loading: true,
    error: '',
    gallery: null,
    photos: [],
    current: 0,
    playing: false,
    toast: ''
  },
  _tasks: [],
  _toastTimer: null,

  onLoad(q) {
    const token = (q && q.token) || '';
    this.setData({ token });
    if (!token) { this.setData({ loading: false, error: '缺少分享令牌' }); return; }
    this.load(token);
  },

  onUnload() {
    this._tasks.forEach((t) => { try { t(); } catch (e) {} });
    this._tasks = [];
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this.setData({ gallery: null, photos: [] });
  },

  async load(token) {
    this.setData({ loading: true, error: '' });
    try {
      const t = requestTask('/api/share/' + token);
      this._tasks.push(t.abort);
      const r = await t.promise;
      this._tasks = this._tasks.filter((x) => x !== t.abort);
      if (r.locked) { this.setData({ loading: false, error: '该分享已加密，请输入密码' }); return; }
      const g = (r.data && r.data.gallery) || null;
      if (!g) { this.setData({ loading: false, error: '相册内容不存在或已失效' }); return; }
      const photos = (g.photos || []).map((u) => getImageUrl(abs(u), 'preview')).filter(Boolean);
      this.setData({ loading: false, gallery: g, photos });
      wx.setNavigationBarTitle({ title: g.subtitle || g.title || '客片相册' });
    } catch (e) {
      this.setData({ loading: false, error: (e && e.message) || '加载失败' });
    }
  },

  onSwiper(e) { this.setData({ current: e.detail.current }); },

  togglePlay() { this.setData({ playing: !this.data.playing }); },

  share() { wx.showToast({ title: '请点右上角「···」转发给好友', icon: 'none' }); },

  cast() { this.showToast('请下拉控制中心 → 屏幕镜像投屏到电视'); },

  goMore() { wx.switchTab({ url: '/pages/index/index' }); },

  goBack() { wx.navigateBack({ delta: 1 }); },

  showToast(msg) {
    this.setData({ toast: msg });
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.setData({ toast: '' }), 2400);
  }
});
