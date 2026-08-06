const { requestTask } = require('../../utils/req.js');
const { getImageUrl } = require('../../utils/imageUrl.js');
const Bgm = require('../../utils/bgm.js');

Page({
  data: {
    id: null,
    loading: true,
    error: false,
    // 自定义顶栏高度
    statusBarHeight: 20,
    navHeight: 44,
    // 视图：flow 纵向长图流式（默认） / grid 缩略图网格
    view: 'flow',
    // 滚动位置记忆
    scrollTop: 0,
    // 相册内容
    title: '',
    category: '',
    albumCopy: '',
    cover: '',
    photos: [], // [{ id, url, thumb, preview }]
    brand: { name: '', slogan: '', logo: '' },
    // 全屏幻灯片
    showSlideshow: false,
    slideIndex: 0,
    bgmUrl: '',
    // 相册密码锁
    locked: false,
    pw: '',
    pwErr: '',
    pwBusy: false,
    showSharePopup: false, // 底部分享弹窗
    canInteract: true // 锁定时置灰分享、视图切换、播放、投屏
  },
  _tasks: [],

  onLoad(options) {
    // 使用微信推荐的新 API 替代已废弃的 wx.getSystemInfoSync
    const win = wx.getWindowInfo();
    const statusBarHeight = win.statusBarHeight || 20;
    const navHeight = 44;
    this.setData({ statusBarHeight, navHeight });

    // 获取 BGM 地址（后台设置）；不在此播放，仅注入单例
    requestTask('/api/settings/studio').promise.then((r) => {
      if (r && r.bgmUrl) this.setData({ bgmUrl: r.bgmUrl });
    }).catch(() => {});

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
    Bgm.destroy();
    this.setData({ photos: [] });
  },

  onHide() {
    if (this.data.showSlideshow) Bgm.pause();
  },

  onShow() {
    if (this.data.showSlideshow) Bgm.resume();
  },

  // 进入页面即启用右上角系统「…」原生转发（好友 / 朋友圈）
  onReady() {
    if (wx.showShareMenu) {
      wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] });
    }
  },

  // 转发分享（封面右上悬浮胶囊按钮触发）
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
        // 相册已开启密码：全屏密码校验，所有交互置灰
        this.setData({ loading: false, locked: true, canInteract: false });
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
      canInteract: true,
      title: g.title || '',
      category: g.category || g.subtitle || '',
      albumCopy: g.albumCopy || '',
      cover: getImageUrl(g.cover_url || (g.photos && g.photos[0]) || '', 'preview'),
      photos,
      brand: {
        name: g.brand_name || '',
        slogan: g.brand_slogan || '',
        logo: g.brand_logo || ''
      }
    });
  },

  retry() {
    if (this.data.id) this.loadAlbum(this.data.id);
  },

  // 切换视图并尽量保留滚动位置
  setView(e) {
    if (!this.data.canInteract) return;
    const view = e.currentTarget.dataset.v;
    if (view === this.data.view) return;
    // 记录当前滚动位置
    const query = wx.createSelectorQuery().in(this);
    query.select('.content').scrollOffset();
    query.exec((res) => {
      const offset = (res && res[0]) ? res[0].scrollTop : 0;
      this._lastScrollTop = offset;
      this.setData({ view, scrollTop: this._lastScrollTop || 0 }, () => {
        // DOM 更新后恢复滚动位置（取近似值）
        setTimeout(() => {
          this.setData({ scrollTop: this._lastScrollTop || 0 });
        }, 50);
      });
    });
  },

  goBack() { wx.navigateBack(); },

  // 打开底部分享弹窗
  openShareSheet() {
    if (!this.data.canInteract) return;
    this.setData({ showSharePopup: true });
  },
  closeShareSheet() {
    this.setData({ showSharePopup: false });
  },
  noop() {},

  // 转发微信好友：关闭弹窗并启用转发能力（点击由 button open-type="share" 唤起原生分享面板）
  shareToFriend() {
    this.closeShareSheet();
    if (wx.showShareMenu) wx.showShareMenu({ withShareTicket: true });
  },

  // 下载二维码：关闭弹窗，跳转二维码预览页（携带 albumId / 标题 / 封面 / 事件类型）
  downloadAlbumQrcode() {
    this.closeShareSheet();
    if (!this.data.canInteract) return;
    const d = this.data;
    const q = [
      'id=' + d.id,
      'title=' + encodeURIComponent(d.title || ''),
      'cover=' + encodeURIComponent(d.cover || ''),
      'category=' + encodeURIComponent(d.category || '')
    ].join('&');
    wx.navigateTo({ url: '/pkg/qrcode/qrcode?' + q });
  },

  // 点击网格缩略图：直接打开对应大图并定位
  previewImage(e) {
    if (!this.data.canInteract) return;
    const idx = e.currentTarget.dataset.idx;
    const urls = this.data.photos.map((p) => p.preview || p.url).filter(Boolean);
    const current = (this.data.photos[idx] && (this.data.photos[idx].preview || this.data.photos[idx].url)) || urls[0];
    if (current && urls.length) wx.previewImage({ current, urls });
  },

  // 图片加载失败：多为微信小程序 downloadFile 合法域名未配置
  onImgError(e) {
    const src = (e && e.detail && e.detail.src) || '';
    console.error('[workDetail] 图片加载失败，请检查小程序后台 downloadFile 合法域名:', src);
  },

  // 唤起全屏幻灯片（用户手势内触发 BGM 播放）
  openSlideshow() {
    if (!this.data.canInteract || !this.data.photos.length) return;
    Bgm.init(this.data.bgmUrl);
    Bgm.play(); // 必须在用户点击手势内调用，规避音频拦截
    this.setData({ showSlideshow: true, slideIndex: 0 });
  },

  // 关闭幻灯片：暂停 BGM 并记录进度（不销毁实例）
  closeSlideshow() {
    Bgm.pause();
    this.setData({ showSlideshow: false });
  },

  // 投屏提示
  cast() {
    if (!this.data.canInteract) return;
    wx.showToast({ title: '请下拉控制中心 → 屏幕镜像到电视', icon: 'none', duration: 2800 });
  },

  // 预约服务
  goAppointment() { wx.navigateTo({ url: '/pages/schedule/schedule' }); },

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