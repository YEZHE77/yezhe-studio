const { request } = require('../../utils/req.js');

const STATUS = {
  unpaid: '待付定金', deposit: '已付定金', shot: '已拍摄',
  selecting: '选片中', retouching: '精修中', delivered: '已交付',
  completed: '已完成', cancelled: '已取消'
};
const SELECTABLE = ['selecting', 'retouching', 'delivered', 'completed'];
const EVALUABLE = ['delivered', 'completed'];

Page({
  data: { orders: [], detail: null, loadingDetail: false },

  onShow() { this.load(); },
  onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },

  async load() {
    try {
      const list = await request('/api/customer/order/list');
      this.setData({
        orders: (list || []).map((o) => ({
          ...o,
          statusText: STATUS[o.status] || o.status,
          totalText: '¥' + (o.total_amount || 0),
          paidText: '¥' + (o.paid_amount || 0)
        }))
      });
    } catch (e) { wx.showToast({ title: '加载失败', icon: 'none' }); }
  },

  async openOrder(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ loadingDetail: true, detail: null });
    try {
      const d = await request('/api/customer/order/' + id);
      this.setData({
        detail: {
          ...d,
          statusText: STATUS[d.status] || d.status,
          canSelect: SELECTABLE.includes(d.status),
          canEvaluate: EVALUABLE.includes(d.status) && !d.evaluated,
          worksTitles: (d.works || []).map((w) => w.title).join('、')
        },
        loadingDetail: false
      });
    } catch (err) {
      this.setData({ loadingDetail: false });
      wx.showToast({ title: '打开失败', icon: 'none' });
    }
  },
  closeDetail() { this.setData({ detail: null }); },

  goAlbum(e) { wx.navigateTo({ url: '/pkg/album/album?orderId=' + e.currentTarget.dataset.id }); },
  goSelect(e) { wx.navigateTo({ url: '/pkg/photoSelect/photoSelect?orderId=' + e.currentTarget.dataset.id }); },
  goEvaluate(e) { wx.navigateTo({ url: '/pkg/evaluate/evaluate?orderId=' + e.currentTarget.dataset.id }); },
  noop() {}
});
