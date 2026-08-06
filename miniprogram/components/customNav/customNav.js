// components/customNav/customNav.js —— 自定义导航栏 + 左侧抽屉菜单
const { requestTask } = require('../../utils/req.js');

Component({
  properties: {
    title: { type: String, value: '' }
  },

  data: {
    showDrawer: false,
    subOpen: false,
    statusBarHeight: 20,
    navHeight: 44,
    totalHeight: 64,
    // 汉堡菜单右侧预留宽度（避免被微信胶囊遮挡）：默认 180rpx，attached 中按胶囊位置动态计算
    navBarPadRight: 180,
    studio: { name: '叶哲 STUDIO', logo: '' },
    subCategories: []
  },

  lifetimes: {
    attached() {
      const sys = wx.getSystemInfoSync();
      const statusBarHeight = sys.statusBarHeight || 20;
      const navHeight = 44; // 对应 88rpx 在 375px 屏
      // 预留右侧空间避让微信胶囊（getMenuButtonBoundingClientRect 取得胶囊左边界，汉堡置于其左侧）
      let navBarPadRight = 180;
      try {
        const mb = wx.getMenuButtonBoundingClientRect();
        const winW = sys.windowWidth || 375;
        if (mb && mb.left) {
          // 汉堡右边缘留在 (胶囊左边界 - 16px) 处，换算为 rpx
          navBarPadRight = Math.ceil((winW - mb.left + 16) * 750 / winW);
        }
      } catch (e) { /* 个别环境无此 API，沿用默认 180rpx */ }
      this.setData({
        statusBarHeight,
        navHeight,
        totalHeight: statusBarHeight + navHeight,
        navBarPadRight
      });
      this.loadCache();
    }
  },

  methods: {
    loadCache() {
      const app = getApp();
      let studio = app.getCached('studio');
      let categories = app.getCached('categories');
      // 若缓存未命中，静默拉取并写入缓存
      if (!studio) {
        requestTask('/api/settings/studio', 'GET', {}).promise
          .then((s) => {
            app.setCached('studio', s || {});
            this.setData({ studio: s || {} });
          })
          .catch(() => {});
      }
      if (!categories) {
        requestTask('/api/categories', 'GET', {}).promise
          .then((cats) => {
            app.setCached('categories', cats || []);
            this.setSubCategories(cats || []);
          })
          .catch(() => {});
      }
      studio = studio || { name: '叶哲 STUDIO', logo: '' };
      categories = categories || [];
      this.setData({ studio });
      this.setSubCategories(categories);
    },

    setSubCategories(categories) {
      const wanted = ['婚礼', '领证', '孕妇照', '写真'];
      const map = new Map((categories || []).map((c) => [c.name, c]));
      const subCategories = wanted.map((name) => map.get(name)).filter(Boolean);
      this.setData({ subCategories });
    },

    openDrawer() {
      this.loadCache();
      this.setData({ showDrawer: true, subOpen: false });
    },

    closeDrawer() {
      this.setData({ showDrawer: false });
    },

    preventBubble() {
      // catchtap 阻止事件冒泡到遮罩
    },

    preventMove() {
      // catchtouchmove 阻止滚动穿透
      return false;
    },

    toggleSub() {
      this.setData({ subOpen: !this.data.subOpen });
    },

    goHome() { this._nav('/pages/index/index', true); },

    goWorks(e) {
      const cat = e.currentTarget.dataset.cat || 0;
      this._nav('/pages/works/works?cat=' + cat, true);
    },

    goPackage() { this._nav('/pages/package/package', true); },

    goEvaluate() { this._nav('/pkg/evaluate/evaluate', false); },

    goAbout() { this._nav('/pkg/about/about', false); },

    goMy() { this._nav('/pages/my/my', true); },

    _nav(url, isMainPage) {
      this.closeDrawer();
      // 等抽屉关闭动画后再跳转，视觉更顺
      setTimeout(() => {
        if (isMainPage) {
          wx.reLaunch({ url });
        } else {
          wx.navigateTo({ url });
        }
      }, 200);
    }
  }
});
