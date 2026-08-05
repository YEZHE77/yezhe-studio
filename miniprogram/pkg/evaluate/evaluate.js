const { requestTask } = require('../../utils/req.js');

const STATUS_TEXT = { pending: '审核中', approved: '已展示', rejected: '未通过' };

Page({
  data: {
    orderId: '', mode: 'list', stars: 5, text: '', submitting: false,
    myList: [], orders: []
  },
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
    this.setData({ myList: [], orders: [] });
  },

  onLoad(q) {
    if (q && q.orderId) {
      this.setData({ orderId: q.orderId, mode: 'submit' });
    } else {
      this.loadList();
    }
  },

  async loadList() {
    try {
      const [list, orders] = await Promise.all([
        this._req('/api/customer/evaluate/list'),
        this._req('/api/customer/order/list')
      ]);
      this.setData({
        myList: (list || []).map((e) => ({ ...e, statusText: STATUS_TEXT[e.status] || e.status })),
        orders: (orders || []).filter((o) => ['delivered', 'completed'].includes(o.status) && !o.evaluated)
      });
    } catch (e) {}
  },

  pickOrder(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ orderId: id, mode: 'submit', stars: 5, text: '' });
  },

  setStar(e) { this.setData({ stars: parseInt(e.currentTarget.dataset.n) }); },
  onText(e) { this.setData({ text: e.detail.value }); },

  async submit() {
    if (this.data.submitting) return;
    if (!this.data.text.trim()) return wx.showToast({ title: '写点感受吧', icon: 'none' });
    this.setData({ submitting: true });
    try {
      await this._req('/api/customer/evaluate/submit', 'POST', {
        orderId: this.data.orderId, stars: this.data.stars, text: this.data.text.trim(), images: []
      });
      wx.showToast({ title: '评价已提交', icon: 'success' });
      this.setData({ mode: 'list', orderId: '', stars: 5, text: '' });
      this.loadList();
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '提交失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  back() { this.setData({ mode: 'list', orderId: '' }); this.loadList(); }
});
