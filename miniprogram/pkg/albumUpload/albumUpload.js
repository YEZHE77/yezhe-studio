// 相册上传页（小程序端，对应需求 D 优化）
// 依赖 pkg/uploadDedup —— 选图 + 单张 3M 超限检测，重复照片不再过滤，全部可上传。
// 依赖 pkg/uploadOpt —— 本地压缩 + 分片上传 + 断点续传 + 失败重试（需求 D）。
//
// ⚠️ 说明：当前小程序为 C 端（客户浏览/选片），相册上传接口需管理员会话（admin token）。
//   本页从 getApp().globalData.adminToken 取管理员令牌；若未登录管理端则提示「需管理员登录」。
//   该页已注册在 app.json，可作为未来 B 端摄影师上传入口直接启用（无需改后端）。

const dedup = require('../uploadDedup/uploadDedup.js');
const opt = require('../uploadOpt/index.js');
const { CONFIG } = require('../../config.js');

function getApiBase() { return CONFIG.API_BASE; }

Page({
  data: {
    workId: '',
    zone: 'sample',
    previews: [],      // { tempFilePath, digest, size, oversize, error, status, progress, url }
    toUploadCount: 0,  // 待上传数
    overCount: 0,      // 超过3M限制数
    uploading: false,
    paused: false,
    overallPct: 0,     // 总进度
    weakNet: false     // 弱网提示
  },

  onLoad(query) {
    this.setData({
      workId: (query && query.workId) || '',
      zone: (query && query.zone) || 'sample'
    });
  },

  onChoose() {
    const token = this._adminToken();
    if (!token) return;
    if (this.data.uploading) return;
    dedup.chooseAndDedup(this.data.workId, token, 9)
      .then(({ previews, toUploadCount, overCount }) => {
        // 注入状态字段用于逐项进度渲染
        const withStatus = previews.map((p) => ({
          ...p,
          status: p.oversize ? 'over' : (p.error ? 'error' : 'pending'),
          progress: 0
        }));
        this.setData({ previews: withStatus, toUploadCount, overCount: overCount || 0, overallPct: 0, weakNet: false });
      })
      .catch(() => wx.showToast({ title: '选图失败', icon: 'none' }));
  },

  async onConfirm() {
    const token = this._adminToken();
    if (!token) return;
    const previews = this.data.previews;
    const uploadIdx = [];
    previews.forEach((p, i) => { if (!p.error && !p.oversize) uploadIdx.push(i); });
    if (!uploadIdx.length) { wx.showToast({ title: '无新照片', icon: 'none' }); return; }

    const init = previews.map((p) => ({ ...p, status: p.oversize ? 'over' : (p.error ? 'error' : 'pending'), progress: 0 }));
    this.setData({ uploading: true, paused: false, overallPct: 0, weakNet: false, previews: init });

    const ctrl = { aborted: false };
    this._ctrl = ctrl;
    const getPaused = () => this.data.paused;
    const total = uploadIdx.length;
    let done = 0;
    let cursor = 0;

    const setP = (i, patch) => {
      const ps = this.data.previews.slice();
      ps[i] = { ...ps[i], ...patch };
      this.setData({ previews: ps });
    };

    // 并发 3 张（需求 D：同时最多 3 张）
    const worker = async () => {
      while (cursor < total) {
        if (ctrl.aborted) return;
        const ord = cursor++;
        const i = uploadIdx[ord];
        const p = this.data.previews[i];
        setP(i, { status: 'uploading', progress: 0 });
        try {
          const url = await opt.uploadImage(p.tempFilePath, {
            token, apiBase: getApiBase(), category: 'client', isPublic: '1', ctrl, getPaused,
            onProgress: (pct) => setP(i, { progress: pct })
          });
          setP(i, { status: 'done', progress: 100, url });
        } catch (e) {
          if (ctrl.aborted) return;
          if (e && e.type === 'cancel') return;
          // 弱网/超时/网络错误 → 标记提示（非静默失败）
          if (!e || /fail|timeout|network/i.test(e.message || '')) this.setData({ weakNet: true });
          setP(i, { status: 'failed', error: (e && e.message) || '上传失败' });
        } finally {
          done++;
          this.setData({ overallPct: Math.round((done / total) * 100) });
        }
      }
    };

    const pool = [];
    for (let k = 0; k < Math.min(3, total); k++) pool.push(worker());
    await Promise.all(pool);

    if (ctrl.aborted) { this.setData({ uploading: false }); return; }

    // 按成功项拼接 originalName/size 投递后端（后端据签名下次识别为重复）
    const items = [];
    this.data.previews.forEach((p) => {
      if (p.status === 'done' && p.url) items.push({ url: p.url, originalName: p.digest, size: p.size });
    });
    if (items.length) {
      try {
        await new Promise((resolve, reject) => {
          wx.request({
            url: `${getApiBase()}/api/works/${this.data.workId}/albums`,
            method: 'POST',
            header: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            data: { zone: this.data.zone, items },
            success: (res) => (res.statusCode >= 200 && res.statusCode < 300) ? resolve(res) : reject(new Error((res.data && res.data.error) || '提交失败')),
            fail: reject
          });
        });
        wx.showToast({ title: `上传成功 ${items.length} 张`, icon: 'none' });
        this.setData({ previews: [], toUploadCount: 0, overallPct: 0 });
      } catch (e) {
        wx.showToast({ title: (e && e.message) || '相册保存失败', icon: 'none' });
      }
    }
    this.setData({ uploading: false });
  },

  // 单张失败重试（不影响其他图，不打断队列）
  async retryOne(e) {
    const i = Number(e.currentTarget.dataset.idx);
    const token = this._adminToken();
    if (!token) return;
    if (!this._ctrl) this._ctrl = { aborted: false };
    const p = this.data.previews[i];
    if (!p) return;
    const setP = (patch) => {
      const ps = this.data.previews.slice();
      ps[i] = { ...ps[i], ...patch };
      this.setData({ previews: ps });
    };
    setP({ status: 'uploading', progress: 0, error: undefined });
    try {
      const url = await opt.uploadImage(p.tempFilePath, {
        token, apiBase: getApiBase(), category: 'client', isPublic: '1',
        ctrl: this._ctrl, getPaused: () => this.data.paused,
        onProgress: (pct) => setP({ progress: pct })
      });
      setP({ status: 'done', progress: 100, url });
      const done = this.data.previews.filter((x) => x.status === 'done').length;
      const up = this.data.previews.filter((x) => !x.error && !x.oversize).length;
      this.setData({ overallPct: up ? Math.round((done / up) * 100) : 0 });
    } catch (err) {
      if (err && err.type === 'cancel') return;
      setP({ status: 'failed', error: (err && err.message) || '上传失败' });
    }
  },

  togglePause() {
    const np = !this.data.paused;
    this.setData({ paused: np });
  },

  cancelAll() {
    if (this._ctrl) this._ctrl.aborted = true;
  },

  _adminToken() {
    const t = getApp().globalData && getApp().globalData.adminToken;
    if (!t) { wx.showToast({ title: '需管理员登录', icon: 'none' }); return null; }
    return t;
  },

  onClose() {
    if (this.data.uploading) return;
    this.setData({ previews: [], toUploadCount: 0, overallPct: 0 });
  },

  onWeakClose() {
    this.setData({ weakNet: false });
  }
});
