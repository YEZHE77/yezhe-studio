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
    shareOpen: false, // 分享操作菜单
    // 客片海报弹窗
    posterOpen: false,
    posterLoading: false,
    posterImage: '',
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

  // 打开分享操作菜单
  openShare() {
    if (!this.data.canInteract) return;
    this.setData({ shareOpen: true });
  },
  closeShare() { this.setData({ shareOpen: false }); },
  noop() {},

  // 生成朋友圈海报：关闭菜单 → 打开海报弹窗 → 自动 canvas 合成
  openPoster() {
    this.setData({ shareOpen: false });
    if (!this.data.canInteract) return;
    this.setData({ posterOpen: true, posterLoading: true, posterImage: '' });
    // 等 canvas 节点渲染后再绘制
    setTimeout(() => this.genPoster(), 300);
  },

  closePoster() {
    // 关闭时清空，canvas 节点随 wx:if 移除即销毁释放内存
    this.setData({ posterOpen: false, posterLoading: false, posterImage: '' });
  },

  // 下载图片到本地临时路径（供 canvas 使用）
  _dl(url) {
    return new Promise((resolve) => {
      if (!url) return resolve('');
      wx.downloadFile({
        url,
        success: (r) => resolve(r.statusCode === 200 ? r.tempFilePath : ''),
        fail: () => resolve('')
      });
    });
  },

  // 二维码 base64 → 本地临时文件
  _qrToLocal(dataUrl) {
    return new Promise((resolve) => {
      if (!dataUrl) return resolve('');
      try {
        const fs = wx.getFileSystemManager();
        const filePath = wx.env.USER_DATA_PATH + '/poster-qr-' + Date.now() + '.png';
        fs.writeFile({
          filePath,
          data: dataUrl.split(',')[1] || '',
          encoding: 'base64',
          success: () => resolve(filePath),
          fail: () => resolve('')
        });
      } catch (e) { resolve(''); }
    });
  },

  // Canvas 2D 的 Image 对象（异步加载）
  _loadImage(canvas, path) {
    return new Promise((resolve) => {
      if (!path) return resolve(null);
      const img = canvas.createImage();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = path;
    });
  },

  // 圆角矩形路径
  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  },

  // 文本超长截断（按像素宽度）
  _clipText(ctx, text, x, y, maxW) {
    text = (text || '').toString();
    if (ctx.measureText(text).width <= maxW) { ctx.fillText(text, x, y); return; }
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    ctx.fillText(t + '…', x, y);
  },

  // 封面图按比例居中裁剪绘制
  _drawCover(ctx, img, x, y, w, h) {
    const iw = img.width, ih = img.height;
    if (!iw || !ih) { ctx.fillStyle = '#f0f0f0'; ctx.fillRect(x, y, w, h); return; }
    const scale = Math.max(w / iw, h / ih);
    const dw = iw * scale, dh = ih * scale;
    const dx = x + (w - dw) / 2, dy = y + (h - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
  },

  // 用 Canvas 2D 合成海报（禁止 DOM 截图，全部 canvas 绘制）
  genPoster() {
    const d = this.data;
    const count = d.photos.length;
    const W = 620, H = 880; // 设计坐标（px），再按 dpr 放大保清晰
    wx.createSelectorQuery().select('#posterCanvas').fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) {
        this.setData({ posterLoading: false });
        wx.showToast({ title: '生成失败', icon: 'none' });
        return;
      }
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      const dpr = (wx.getWindowInfo().pixelRatio || 2);
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.scale(dpr, dpr);

      // 并行准备素材：封面、logo、小程序跳转码
      const h5Url = 'https://yezhe-studio.pages.dev/w/' + d.id;
      const qrTask = requestTask('/api/qrcode?text=' + encodeURIComponent(h5Url));
      this._tasks.push(qrTask.abort);
      Promise.all([
        this._dl(d.cover),
        this._dl(d.brand.logo),
        qrTask.promise.then((r) => this._qrToLocal((r && r.dataUrl) || '')).catch(() => '')
      ]).then((paths) => {
        this._tasks = this._tasks.filter((x) => x !== qrTask.abort);
        return Promise.all([
          this._loadImage(canvas, paths[0]),
          this._loadImage(canvas, paths[1]),
          this._loadImage(canvas, paths[2])
        ]).then((imgs) => {
          const [coverImg, logoImg, qrImg] = imgs;

          // 白底圆角卡片
          this._roundRect(ctx, 0, 0, W, H, 24);
          ctx.fillStyle = '#ffffff';
          ctx.fill();

          // 左上 logo + 右侧标题/工作室名
          if (logoImg) {
            ctx.save();
            this._roundRect(ctx, 30, 30, 64, 64, 12);
            ctx.clip();
            ctx.drawImage(logoImg, 30, 30, 64, 64);
            ctx.restore();
          }
          ctx.fillStyle = '#2c2c2c';
          ctx.font = '600 30px sans-serif';
          ctx.textBaseline = 'middle';
          this._clipText(ctx, d.title || '作品相册', 110, 50, 470);
          ctx.fillStyle = '#999999';
          ctx.font = '22px sans-serif';
          this._clipText(ctx, d.brand.name || 'YEZHE WORKSHOP', 110, 86, 470);

          // 中间封面大图（560×420）
          if (coverImg) this._drawCover(ctx, coverImg, 30, 120, 560, 420);
          else { ctx.fillStyle = '#f0f0f0'; ctx.fillRect(30, 120, 560, 420); }

          // 下方居中小程序跳转码（130×130）
          if (qrImg) ctx.drawImage(qrImg, (W - 130) / 2, 580, 130, 130);

          // 小程序码下方文字：长按二维码识别 查看全部 N 张照片
          ctx.fillStyle = '#666666';
          ctx.font = '24px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('长按二维码识别 查看全部' + count + '张照片', W / 2, 770);
          ctx.textAlign = 'left';

          // 导出为临时图片（保存源来自 canvas 绘制）
          wx.canvasToTempFilePath({
            canvas,
            success: (r) => this.setData({ posterImage: r.tempFilePath, posterLoading: false }),
            fail: () => { this.setData({ posterLoading: false }); wx.showToast({ title: '生成失败', icon: 'none' }); }
          });
        });
      }).catch(() => {
        this.setData({ posterLoading: false });
        wx.showToast({ title: '生成失败', icon: 'none' });
      });
    });
  },

  // 保存海报到相册
  savePoster() {
    if (this.data.posterLoading || !this.data.posterImage) return;
    wx.saveImageToPhotosAlbum({
      filePath: this.data.posterImage,
      success: () => wx.showToast({ title: '海报已保存到相册，可以前往朋友圈发布', icon: 'none', duration: 2200 }),
      fail: (e) => {
        const msg = (e && e.errMsg) || '';
        // 用户主动取消：不提示；权限被拒：友好引导
        if (msg.indexOf('cancel') !== -1) return;
        if (msg.indexOf('auth') !== -1 || msg.indexOf('deny') !== -1) {
          wx.showModal({
            title: '需要相册权限',
            content: '保存海报需要相册权限，请在设置中允许后重试',
            showCancel: false,
            confirmText: '知道了'
          });
          return;
        }
        wx.showToast({ title: '保存失败', icon: 'none' });
      }
    });
  },

  // 下载小程序码到相册
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
      const filePath = wx.env.USER_DATA_PATH + '/work-qr-' + this.data.id + '.png';
      await new Promise((res, rej) => fs.writeFile({ filePath, data: dataUrl.split(',')[1], encoding: 'base64', success: res, fail: rej }));
      wx.saveImageToPhotosAlbum({
        filePath,
        success: () => wx.showToast({ title: '小程序码已保存到相册', duration: 1800 }),
        fail: (e) => {
          const msg = (e && e.errMsg) || '';
          if (msg.indexOf('cancel') !== -1) return;
          if (msg.indexOf('auth') !== -1 || msg.indexOf('deny') !== -1) {
            wx.showModal({ title: '需要相册权限', content: '保存图片需要相册权限，请在设置中允许后重试', showCancel: false, confirmText: '知道了' });
            return;
          }
          wx.showToast({ title: '保存失败', icon: 'none' });
        }
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