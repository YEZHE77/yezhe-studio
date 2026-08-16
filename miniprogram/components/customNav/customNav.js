// components/customNav/customNav.js —— 自定义导航栏 + 左侧抽屉菜单
const { requestTask } = require('../../utils/req.js');

Component({
  properties: {
    title: { type: String, value: '' },
    // 是否显示自定义返回箭头（仅在「个人中心」等需要手动返回的子页面启用；
    // 因本组件配合 navigationStyle:custom 使用，系统原生返回箭头永不显示，
    // 故 showBack=true 时由组件渲染左上角白色左箭头，不会出现双返回键）。
    showBack: { type: Boolean, value: false },
    // 是否显示圆形 LOGO + 品牌文字（首页导航栏启用：左侧用圆形 LOGO 图片替代默认相机图标）
    showLogo: { type: Boolean, value: false },
    // 是否在导航栏下方渲染占位块（默认 true，为页面内容预留顶部高度）。
    // 首页改为 false：由页面自身用动态 --nav-height 控制首屏轮播的下偏移，避免双重占位。
    placeholder: { type: Boolean, value: true }
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
      // 使用微信推荐的新 API 替代已废弃的 wx.getSystemInfoSync
      const win = wx.getWindowInfo();
      const statusBarHeight = win.statusBarHeight || 20;
      const navHeight = 44; // 对应 88rpx 在 375px 屏
      // 预留右侧空间避让微信胶囊（getMenuButtonBoundingClientRect 取得胶囊左边界，汉堡置于其左侧）
      let navBarPadRight = 180;
      try {
        const mb = wx.getMenuButtonBoundingClientRect();
        const winW = win.windowWidth || 375;
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
      // 直接使用后端返回（已启用、按 sort 排序）的全部分类，避免前端写死分类数组
      this.setData({ subCategories: (categories || []).filter((c) => c && c.id) });
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

    goMy() { this._nav('/pages/my/my', false); },

    // 联系我们：回首页并滚动到「联系我们」卡片（与 H5 抽屉「联系我们」行为一致）
    goContact() {
      this.closeDrawer();
      setTimeout(() => {
        wx.reLaunch({
          url: '/pages/index/index',
          success: () => {
            setTimeout(() => {
              wx.pageScrollTo({ selector: '.footer', duration: 300 });
            }, 600);
          }
        });
      }, 200);
    },

    // 自定义返回箭头点击：有上一页则 navigateBack，无上一页（页面栈为空/直接打开）则回首页
    onBack() {
      const pages = getCurrentPages();
      if (pages && pages.length > 1) {
        wx.navigateBack();
      } else {
        wx.reLaunch({ url: '/pages/index/index' });
      }
    },

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
