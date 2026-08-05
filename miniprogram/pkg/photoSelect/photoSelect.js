const { requestTask } = require('../../utils/req.js');
const { getImageUrl } = require('../../utils/imageUrl.js');

Page({
  data: { orderId: '', photos: [], selected: [], submitted: false, saving: false, submitting: false },
  _tasks: [],

  // 统一请求封装：收集 abort 句柄，供 onUnload 终止未完成请求
  _req(path, method, data) {
    const t = requestTask(path, method || 'GET', data || {});
    this._tasks.push(t.abort);
    return t.promise;
  },

  onUnload() {
    this._tasks.forEach((ab) => { try { ab(); } catch (e) {} });
    this._tasks = [];
    // 释放大图内存
    this.setData({ photos: [], selected: [] });
  },

  onLoad(q) {
    if (q && q.orderId) {
      this.setData({ orderId: q.orderId });
      this.load();
    }
  },

  _merge(photos, selected) {
    const set = new Set(selected);
    return (photos || []).map((p) => ({ ...p, thumb: getImageUrl(p.photo_url, 'thumb'), _sel: set.has(p.photo_url) }));
  },

  async load() {
    try {
      const r = await this._req('/api/customer/photo-select/' + this.data.orderId);
      const sel = (r.selection && r.selection.marks) || [];
      this.setData({
        photos: this._merge(r.photos, sel),
        selected: sel,
        submitted: !!(r.selection && r.selection.submitted)
      });
      if ((r.photos || []).length === 0) {
        wx.showToast({ title: '暂无可选小样', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  toggle(e) {
    const url = e.currentTarget.dataset.url;
    const sel = this.data.selected.slice();
    const i = sel.indexOf(url);
    if (i >= 0) sel.splice(i, 1); else sel.push(url);
    this.setData({ selected: sel, photos: this._merge(this.data.photos, sel) });
  },

  async save() {
    if (this.data.saving) return;
    this.setData({ saving: true });
    try {
      await this._req('/api/customer/photo-select/save', 'POST', { orderId: this.data.orderId, marks: this.data.selected });
      wx.showToast({ title: '草稿已保存', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  async submit() {
    if (this.data.submitting) return;
    if (this.data.selected.length === 0) return wx.showToast({ title: '请先选择照片', icon: 'none' });
    this.setData({ submitting: true });
    try {
      await this._req('/api/customer/photo-select/submit', 'POST', { orderId: this.data.orderId, marks: this.data.selected });
      this.setData({ submitted: true, submitting: false });
      wx.showToast({ title: '选片已提交', icon: 'success' });
    } catch (e) {
      this.setData({ submitting: false });
      wx.showToast({ title: (e && e.message) || '提交失败', icon: 'none' });
    }
  }
});
