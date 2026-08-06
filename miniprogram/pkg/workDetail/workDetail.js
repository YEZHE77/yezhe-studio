const { requestTask } = require('../../utils/req.js');
const { getImageUrl } = require('../../utils/imageUrl.js');

// 幻灯片背景音乐：《梦中的婚礼》钢琴曲。
// 请替换为真实 HTTPS URL（建议上传 MP3 至 R2 私有桶，通过 yezhe-img-proxy.yezhe128627.workers.dev 代理；
// 并在微信公众平台 downloadFile 合法域名添加该域名）。留空则不播放声音，播放/暂停/退出逻辑保持完整。
const BGM_URL = '';

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
    // 播放状态
    playing: false,
    playTimer: null,
    // 相册密码锁
    locked: false,
    pw: '',
    pwErr: '',
    pwBusy: false,
    shareOpen: false, // 分享弹窗
    canInteract: true // 锁定时置灰分享、视图切换、播放、投屏
  },
  _tasks: [],
  innerAudioContext: null,

  onLoad(options) {
    const sys = wx.getSystemInfoSync();
    const statusBarHeight = sys.statusBarHeight || 20;
    const navHeight = 44;
    const shareTop = statusBarHeight + navHeight + 8;
    this.setData({ statusBarHeight, navHeight, shareTop });

    // 初始化背景音乐（配置了 BGM_URL 才创建；留空则无声音但逻辑完整）
    if (BGM_URL) {
      const audio = wx.createInnerAudioContext();
      audio.src = BGM_URL;
      audio.loop = true;
      this.innerAudioContext = audio;
    }

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
    this.stopPlay();
    if (this.innerAudioContext) {
      this.innerAudioContext.stop();
      this.innerAudioContext.destroy();
      this.innerAudioContext = null;
    }
    this.setData({ photos: [] });
  },

  onHide() {
    this.stopPlay();
    if (this.innerAudioContext) this.innerAudioContext.pause();
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

  // 分享弹窗
  openShare() {
    if (!this.data.canInteract) return;
    this.setData({ shareOpen: true });
  },
  closeShare() { this.setData({ shareOpen: false }); },
  noop() {},

  // 朋友圈：生成相册二维码后唤起微信"分享图片到朋友圈"
  async shareTimeline() {
    this.setData({ shareOpen: false });
    if (!this.data.canInteract) return;
    wx.showLoading({ title: '生成中' });
    try {
      const url = 'https://yezhe-studio.pages.dev/w/' + this.data.id;
      const t = requestTask('/api/qrcode?text=' + encodeURIComponent(url));
      this._tasks.push(t.abort);
      const r = await t.promise;
      this._tasks = this._tasks.filter((x) => x !== t.abort);
      const dataUrl = (r && r.dataUrl) || '';
      const fs = wx.getFileSystemManager();
      const filePath = wx.env.USER_DATA_PATH + '/album-qr.png';
      await new Promise((res, rej) => fs.writeFile({ filePath, data: dataUrl.split(',')[1], encoding: 'base64', success: res, fail: rej }));
      wx.showShareImageMenu({ path: filePath, fail: () => wx.showToast({ title: '已取消', icon: 'none' }) });
    } catch (e) {
      wx.showToast({ title: '生成失败', icon: 'none' });
    } finally { wx.hideLoading(); }
  },

  // 下载二维码到相册
  async downloadQR() {
    this.setData({ shareOpen: false });
    if (!this.data.canInteract) return;
    wx.showLoading({ title: '生成中' });
    try {
      const url = 'https://yezhe-studio.pages.dev/w/' + this.data.id;
      const t = requestTask('/api/qrcode?text=' + encodeURIComponent(url));
      this._tasks.push(t.abort);
      const r = await t.promise;
      this._tasks = this._tasks.filter((x) => x !== t.abort);
      const dataUrl = (r && r.dataUrl) || '';
      const fs = wx.getFileSystemManager();
      const filePath = wx.env.USER_DATA_PATH + '/album-qr.png';
      await new Promise((res, rej) => fs.writeFile({ filePath, data: dataUrl.split(',')[1], encoding: 'base64', success: res, fail: rej }));
      wx.saveImageToPhotosAlbum({
        filePath,
        success: () => wx.showToast({ title: '已保存到相册' }),
        fail: () => wx.showToast({ title: '保存失败', icon: 'none' })
      });
    } catch (e) {
      wx.showToast({ title: '生成失败', icon: 'none' });
    } finally { wx.hideLoading(); }
  },

  // 点击网格缩略图：直接打开对应大图并定位
  previewImage(e) {
    if (!this.data.canInteract) return;
    const idx = e.currentTarget.dataset.idx;
    const urls = this.data.photos.map((p) => p.preview || p.url).filter(Boolean);
    const current = (this.data.photos[idx] && (this.data.photos[idx].preview || this.data.photos[idx].url)) || urls[0];
    if (current && urls.length) wx.previewImage({ current, urls });
  },

  // 幻灯片播放：自动向下滚动，同步背景音乐
  togglePlay() {
    if (!this.data.canInteract || !this.data.photos.length) return;
    if (this.data.playing) {
      this.stopPlay();
      return;
    }
    this.setData({ playing: true });
    if (this.innerAudioContext) this.innerAudioContext.play();
    this._playTimer = setInterval(() => {
      const query = wx.createSelectorQuery().in(this);
      query.select('.content').scrollOffset();
      query.select('.content').boundingClientRect();
      query.exec((res) => {
        if (!res || !res[0] || !res[1]) return;
        const offset = res[0].scrollTop;
        const viewH = res[1].height;
        const next = offset + viewH * 0.88;
        this.setData({ scrollTop: next });
      });
    }, 2200);
  },

  stopPlay() {
    if (this._playTimer) { clearInterval(this._playTimer); this._playTimer = null; }
    this.setData({ playing: false });
    if (this.innerAudioContext) this.innerAudioContext.pause();
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