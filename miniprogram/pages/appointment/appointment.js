const { request } = require('../../utils/req.js');

const STATUS_TEXT = { pending: '待联系', contacted: '已联系', converted: '已转订单', cancelled: '已取消' };

Page({
  data: {
    packages: [],
    pkgIndex: 0,
    name: '', phone: '', hopeDate: '', remark: '',
    list: [],
    submitting: false
  },

  onLoad(q) {
    this.loadPackages();
    this.loadList();
    if (q && q.packageId) {
      this.setData({ packageId: parseInt(q.packageId) });
    }
  },

  async loadPackages() {
    try {
      const pkgs = await request('/api/packages/public');
      this.setData({ packages: pkgs || [] });
      if (this.data.packageId) {
        const idx = (pkgs || []).findIndex((p) => p.id === this.data.packageId);
        if (idx >= 0) this.setData({ pkgIndex: idx });
      }
    } catch (e) {}
  },

  async loadList() {
    try {
      const list = await request('/api/customer/appointment/list');
      this.setData({ list: (list || []).map((a) => ({ ...a, statusText: STATUS_TEXT[a.status] || a.status })) });
    } catch (e) {}
  },

  onName(e) { this.setData({ name: e.detail.value }); },
  onPhone(e) { this.setData({ phone: e.detail.value }); },
  onRemark(e) { this.setData({ remark: e.detail.value }); },
  onDate(e) { this.setData({ hopeDate: e.detail.value }); },
  onPkg(e) { this.setData({ pkgIndex: parseInt(e.detail.value), packageId: this.data.packages[parseInt(e.detail.value)].id }); },

  async submit() {
    if (this.data.submitting) return;
    const { name, phone, hopeDate, remark, packages, pkgIndex } = this.data;
    if (!name.trim()) return wx.showToast({ title: '请填写称呼', icon: 'none' });
    if (!/^1\d{10}$/.test(phone.trim())) return wx.showToast({ title: '请填正确的手机号', icon: 'none' });
    this.setData({ submitting: true });
    try {
      await request('/api/customer/appointment/submit', 'POST', {
        name: name.trim(),
        phone: phone.trim(),
        packageId: packages.length ? packages[pkgIndex].id : '',
        hopeDate, remark
      });
      wx.showToast({ title: '预约提交成功', icon: 'success' });
      this.setData({ name: '', phone: '', hopeDate: '', remark: '', submitting: false });
      this.loadList();
    } catch (e) {
      this.setData({ submitting: false });
      wx.showToast({ title: (e && e.message) || '提交失败', icon: 'none' });
    }
  }
});
