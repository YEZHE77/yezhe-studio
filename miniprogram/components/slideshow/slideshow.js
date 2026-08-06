const Bgm = require('../../utils/bgm.js');

// 全屏幻灯片组件：作品相册 / 订单相册 共用
// 交互（与 Web 端逻辑统一）：
//  - 仅当父页面在用户点击【播放】手势内调用 Bgm.play() 后才出声（本组件不主动播音）
//  - 图片切换：手指左右滑动（catchtouch）；小程序下拉手势退出
//  - 内置自动轮播开关：开启后每张停留 5 秒，手动切图重置倒计时，可随时关闭
//  - 悬浮控件：静音切换 / 自动播放开关 / 关闭
//  - 退出：关闭按钮 / 点击黑色蒙层 / 下拉手势；退出时父页面负责 pause BGM（见 bind:close）
//  - 切图不中断 BGM；缓冲中展示「音乐加载中」
Component({
  properties: {
    visible: { type: Boolean, value: false },
    // [{ url, thumb?, preview? }]
    photos: { type: Array, value: [] },
    startIndex: { type: Number, value: 0 }
  },
  data: {
    index: 0,
    total: 0,
    autoplay: false,
    muted: false,
    loading: false,
    cur: ''
  },
  lifetimes: {
    attached() {
      this._timer = null;
      this._unsub = Bgm.subscribe((s) => {
        if (!this.data.visible) return; // 仅展示态同步 UI
        this.setData({ loading: s.loading, muted: s.muted });
      });
    },
    detached() {
      this._clearTimer();
      if (this._unsub) { this._unsub(); this._unsub = null; }
    }
  },
  observers: {
    visible(v) {
      if (v) {
        const total = (this.data.photos || []).length;
        const idx = Math.min(Math.max(this.data.startIndex || 0, 0), Math.max(total - 1, 0));
        this.setData({ index: idx, total, autoplay: false });
        this._updateCur();
      } else {
        this._clearTimer();
      }
    },
    photos(p) {
      this.setData({ total: (p || []).length });
      if (this.data.visible) this._updateCur();
    }
  },
  methods: {
    _updateCur() {
      const p = this.data.photos[this.data.index];
      this.setData({ cur: (p && (p.preview || p.url)) || '' });
    },
    _clearTimer() {
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
    },
    _startTimer() {
      this._clearTimer();
      if (!this.data.autoplay) return;
      this._timer = setInterval(() => { this.next(); }, 5000);
    },
    next() {
      const total = this.data.total;
      if (!total) return;
      const idx = (this.data.index + 1) % total;
      this.setData({ index: idx }, () => this._updateCur());
      this._startTimer(); // 手动切图重置倒计时
    },
    prev() {
      const total = this.data.total;
      if (!total) return;
      const idx = (this.data.index - 1 + total) % total;
      this.setData({ index: idx }, () => this._updateCur());
      this._startTimer();
    },
    toggleAutoplay() {
      const autoplay = !this.data.autoplay;
      this.setData({ autoplay });
      if (autoplay) this._startTimer(); else this._clearTimer();
    },
    toggleMute() {
      const m = Bgm.toggleMute();
      this.setData({ muted: m });
    },
    close() {
      this.triggerEvent('close');
    },
    onMaskTap() {
      // 点击黑色蒙层（图片用 catchtap 阻止冒泡）
      this.close();
    },
    onImgTouchStart(e) {
      const t = e.touches[0];
      this._sx = t.clientX;
      this._sy = t.clientY;
    },
    onImgTouchEnd(e) {
      const t = e.changedTouches[0];
      const dx = t.clientX - this._sx;
      const dy = t.clientY - this._sy;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) this.next(); else this.prev();
      } else if (dy > 100 && dy > Math.abs(dx)) {
        // 下拉手势退出
        this.close();
      }
    },
    noop() {}
  }
});
