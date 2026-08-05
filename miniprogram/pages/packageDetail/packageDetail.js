const { CONFIG } = require('../../utils/config.js');
const { request } = require('../../utils/req.js');

function abs(u) {
  if (!u) return '';
  if (u.indexOf('http') === 0) return u;
  if (u.indexOf('/uploads') === 0) return CONFIG.API_BASE + u;
  return u;
}

Page({
  data: {
    loading: true, error: '', locked: false,
    pw: '', pwErr: '', pwBusy: false,
    token: '', pkg: null,
    specIndex: 0, specPrice: 0
  },

  onLoad(q) {
    const token = (q && q.token) || '';
    if (token) { this.setData({ token }); this.loadByToken(); }
    else if (q && (q.id || q.packageId)) { this.loadById(q.id || q.packageId); }
    else { this.setData({ loading: false, error: '缺少套系参数' }); }
  },

  async loadById(id) {
    try {
      const p = await request('/api/packages/public/' + id);
      this.applyPkg(p);
    } catch (e) { this.setData({ loading: false, error: (e && e.message) || '加载失败' }); }
  },

  async loadByToken() {
    this.setData({ loading: true, error: '' });
    try {
      const r = await request('/api/share/' + this.data.token);
      if (r.locked) { this.setData({ loading: false, locked: true }); return; }
      this.applyPkg(r.data.package);
    } catch (e) { this.setData({ loading: false, error: (e && e.message) || '分享已失效' }); }
  },

  applyPkg(p) {
    const specs = Array.isArray(p.specs) ? p.specs : [];
    const spec = specs[0] || null;
    this.setData({
      loading: false, pkg: p, specIndex: 0,
      specPrice: spec ? (parseFloat(spec.price) || 0) : (parseFloat(p.price) || 0)
    });
    wx.setNavigationBarTitle({ title: p.name || '套系详情' });
  },

  onSpec(e) {
    const i = parseInt(e.currentTarget.dataset.i);
    const specs = this.data.pkg.specs || [];
    const spec = specs[i] || null;
    this.setData({
      specIndex: i,
      specPrice: spec ? (parseFloat(spec.price) || 0) : (parseFloat(this.data.pkg.price) || 0)
    });
  },

  onPwInput(e) { this.setData({ pw: e.detail.value, pwErr: '' }); },
  async verify() {
    if (this.data.pwBusy) return;
    this.setData({ pwBusy: true, pwErr: '' });
    try {
      const r = await request('/api/share/' + this.data.token + '/verify', 'POST', { password: this.data.pw });
      this.applyPkg(r.data.package);
    } catch (e) { this.setData({ pwErr: (e && e.message) || '密码错误' }); }
    finally { this.setData({ pwBusy: false }); }
  },

  goAppointment() {
    const p = this.data.pkg;
    if (!p) return;
    const specs = p.specs || [];
    const spec = specs[this.data.specIndex];
    const url = '/pages/appointment/appointment?packageId=' + p.id + (spec ? ('&specId=' + spec.id) : '');
    wx.navigateTo({ url });
  },

  preview(e) {
    const url = e.currentTarget.dataset.url;
    if (url) wx.previewImage({ current: url, urls: [url] });
  },
  back() { wx.navigateBack({ delta: 1 }); }
});
