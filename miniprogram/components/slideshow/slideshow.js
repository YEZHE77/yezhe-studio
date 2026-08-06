const Bgm = require('../../utils/bgm.js');

// 全屏幻灯片组件：作品相册 / 订单相册 共用
//
// 交互规则（继承底部栏 UI 修改，不可回退）：
//  - 底部彻底移除「音乐 / 手动 / 关闭」，仅保留：播放/暂停、进度条、时间
//  - 左上角白色 × ：唯一退出入口（停止播放 + 暂停 BGM + 关闭）
//  - 右上角白色 ♪ ：控制 BGM 开/关；退出幻灯片自动暂停 BGM
//  - 图片按相册原有顺序播放（不洗牌），仅【转场动画】每次随机
//  - 6 种预定义转场，相邻尽量不重复
//  - 图片默认停留 2s（dwell 可配）；视频完整播放后执行随机转场
//  - 自动循环；手动左右滑动同样触发随机转场
//  - BGM 仅在用户手势内 play（规避音频拦截），切图不中断音乐

const TRANSITIONS = ['fade', 'slideL', 'slideU', 'zoom', 'rotate', 'blind'];
const DWELL_DEFAULT = 2000; // ms / 图片

function isVideo(p) {
  if (!p) return false;
  if (p.type === 'video') return true;
  const u = p.url || p.preview || '';
  return /\.(mp4|mov|webm|m4v|avi|m3u8)$/i.test(u);
}

Component({
  properties: {
    visible: { type: Boolean, value: false },
    // [{ id, url, thumb, preview, type? }]
    photos: { type: Array, value: [] },
    startIndex: { type: Number, value: 0 },
    // 每张图片停留毫秒，默认 2000
    dwell: { type: Number, value: DWELL_DEFAULT }
  },
  data: {
    index: 0,
    total: 0,
    playing: true,
    bgmOn: true,
    cur: '',
    curIsVideo: false,
    animClass: 'ss-anim-fade',
    progress: 0,        // 0..1 当前素材进度
    curTime: 0,         // 当前素材已播秒数
    curDuration: 2,     // 当前素材总秒数
    prevAnim: ''
  },
  lifetimes: {
    attached() {
      this._timer = null;        // 自动轮播 setTimeout
      this._progressTimer = null; // 进度条 setInterval
      this._vc = null;            // video context
      this._unsub = Bgm.subscribe(() => {});
    },
    detached() {
      this._clearAll();
      if (this._unsub) { this._unsub(); this._unsub = null; }
    }
  },
  observers: {
    visible(v) {
      if (v) {
        const total = (this.data.photos || []).length;
        const idx = Math.min(Math.max(this.data.startIndex || 0, 0), Math.max(total - 1, 0));
        const p = (this.data.photos || [])[idx] || {};
        this.setData({
          index: idx,
          total,
          playing: true,
          bgmOn: true,
          cur: p.preview || p.url || '',
          curIsVideo: isVideo(p),
          curDuration: this.data.dwell / 1000,
          curTime: 0,
          progress: 0,
          animClass: 'ss-anim-fade'
        });
        this._syncVideo();
        this._start();
      } else {
        this._clearAll();
        this.setData({ playing: false });
      }
    },
    photos(p) {
      this.setData({ total: (p || []).length });
    }
  },
  methods: {
    _curPhoto() { return (this.data.photos || [])[this.data.index] || {}; },

    _setCur() {
      const p = this._curPhoto();
      this.setData({
        cur: p.preview || p.url || '',
        curIsVideo: isVideo(p),
        curDuration: this.data.dwell / 1000,
        curTime: 0,
        progress: 0
      });
      this._syncVideo();
    },

    _clearAll() {
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
      if (this._progressTimer) { clearInterval(this._progressTimer); this._progressTimer = null; }
    },

    _pickAnim() {
      const pool = TRANSITIONS.filter((t) => t !== this.data.prevAnim);
      const a = pool[Math.floor(Math.random() * pool.length)];
      this.setData({ prevAnim: a });
      return a;
    },

    // 切到指定索引，触发随机转场（相邻尽量不重复）
    _goto(idx) {
      const total = this.data.total;
      if (!total) return;
      const ni = ((idx % total) + total) % total;
      const anim = this._pickAnim();
      // 先去掉动画类，换图后再施加，确保每次都重新触发动画
      this.setData({ animClass: '' }, () => {
        this.setData({ index: ni });
        this._setCur();
        setTimeout(() => { this.setData({ animClass: 'ss-anim-' + anim }); }, 20);
      });
      this._start();
    },

    next() { this._goto(this.data.index + 1); },
    prev() { this._goto(this.data.index - 1); },

    _start() {
      this._clearAll();
      if (!this.data.playing) return;
      const p = this._curPhoto();
      if (isVideo(p)) {
        // 视频由 onVideoEnded 驱动切换，无需 dwell 计时
        this.setData({ progress: 0, curTime: 0 });
        return;
      }
      const dwell = this.data.dwell;
      const start = Date.now();
      this._progressTimer = setInterval(() => {
        const el = Date.now() - start;
        const pr = Math.min(el / dwell, 1);
        this.setData({ progress: pr, curTime: Math.min(Math.floor(el / 1000), Math.floor(dwell / 1000)) });
      }, 50);
      this._timer = setTimeout(() => { this.next(); }, dwell);
    },

    togglePlay() {
      const playing = !this.data.playing;
      this.setData({ playing });
      if (playing) this._start();
      else { this._clearAll(); }
      this._syncVideo();
    },

    toggleBgm() {
      const on = !this.data.bgmOn;
      this.setData({ bgmOn: on });
      if (on) Bgm.play(); else Bgm.pause();
    },

    _syncVideo() {
      if (!this.data.curIsVideo) { this._vc = null; return; }
      if (!this._vc) {
        try { this._vc = wx.createVideoContext('ssVideo', this); } catch (e) { this._vc = null; }
      }
      if (!this._vc) return;
      // 延迟到节点渲染后再控制
      setTimeout(() => {
        try { if (this.data.playing) this._vc.play(); else this._vc.pause(); } catch (e) {}
      }, 60);
    },

    close() { this.triggerEvent('close'); },

    onMaskTap() { /* 仅背景，不关闭；唯一退出入口为左上角 × */ },

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
      }
      // 移除下拉退出：× 为唯一退出入口
    },

    onVideoEnded() { this.next(); },
    onVideoTimeUpdate(e) {
      const d = (e.detail && e.detail.duration) || this.data.dwell / 1000;
      const c = (e.detail && e.detail.currentTime) || 0;
      this.setData({
        curDuration: Math.max(d, 0.1),
        curTime: Math.floor(c),
        progress: d ? Math.min(c / d, 1) : 0
      });
    },

    noop() {}
  }
});
