const { request } = require('../../utils/req.js');

// 档期预约状态语义：pending(待确认) / confirmed(已确认生成订单) / rejected(已拒绝) / cancelled(已取消)
const STATUS_TEXT = { pending: '待确认', confirmed: '已确认·已转单', rejected: '已拒绝', cancelled: '已取消' };
const PERIOD_OPTS = [
  { value: 'full', label: '全天' },
  { value: 'am', label: '上午' },
  { value: 'pm', label: '下午' },
  { value: 'night', label: '晚上' }
];

Page({
  data: {
    packages: [],
    pkgIndex: 0,
    pkgId: '', pkgName: '', specId: '', specName: '',
    name: '', phone: '', hopeDate: '', period: 'full', periodOpts: PERIOD_OPTS, periodIndex: 0, periodLabel: '全天', remark: '',
    list: [],
    submitting: false,
    // 拍摄问卷弹窗
    qModal: false, qAppt: null, qAnswers: {}, qSubmitting: false
  },

  onLoad(q) {
    this.loadPackages();
    this.loadList();
    if (q && q.date) this.setData({ hopeDate: q.date });
    if (q && q.period) this.setData({ period: q.period });
    if (q && q.packageId) this.setData({ pkgId: parseInt(q.packageId) });
    if (q && q.specId) this.setData({ specId: q.specId });
    this.syncPeriod();
  },

  syncPeriod() {
    const idx = Math.max(0, PERIOD_OPTS.findIndex((p) => p.value === this.data.period));
    this.setData({ periodIndex: idx, periodLabel: PERIOD_OPTS[idx].label });
  },

  async loadPackages() {
    try {
      const pkgs = await request('/api/packages/public');
      this.setData({ packages: pkgs || [] });
      this.syncPkgInfo();
    } catch (e) {}
  },

  // 根据 pkgId / specId 解析名称用于展示
  syncPkgInfo() {
    const { packages, pkgId, specId } = this.data;
    const pkg = (packages || []).find((p) => p.id === pkgId);
    if (!pkg) return;
    let specName = '';
    if (specId && Array.isArray(pkg.specs)) {
      const s = pkg.specs.find((x) => x.id === specId);
      if (s) specName = s.name;
    }
    this.setData({ pkgName: pkg.name, specName });
  },

  async loadList() {
    try {
      const list = await request('/api/customer/appointment/list');
      const mapped = (list || []).map((a) => ({
        ...a,
        statusText: STATUS_TEXT[a.status] || a.status,
        periodLabel: (PERIOD_OPTS.find((p) => p.value === a.period) || {}).label || ''
      }));
      this.setData({ list: mapped });
      this.detectQuestionnaire(mapped);
    } catch (e) {}
  },

  // 预约确认成功且套系绑定了问卷、尚未填写 → 自动弹出
  detectQuestionnaire(list) {
    const hit = (list || []).find((a) =>
      a.status === 'confirmed' &&
      Array.isArray(a.package_questionnaire) && a.package_questionnaire.length > 0 &&
      a.order_id && (!a.questionnaire_answers || Object.keys(a.questionnaire_answers).length === 0)
    );
    if (hit) {
      const answers = {};
      (hit.package_questionnaire || []).forEach((q, i) => { answers[i] = ''; });
      this.setData({ qModal: true, qAppt: hit, qAnswers: answers });
    }
  },

  onName(e) { this.setData({ name: e.detail.value }); },
  onPhone(e) { this.setData({ phone: e.detail.value }); },
  onRemark(e) { this.setData({ remark: e.detail.value }); },
  onDate(e) { this.setData({ hopeDate: e.detail.value }); },
  onPkg(e) {
    const idx = parseInt(e.detail.value);
    this.setData({ pkgIndex: idx, pkgId: this.data.packages[idx].id, specId: '' });
    this.syncPkgInfo();
  },
  onPeriod(e) {
    const idx = parseInt(e.detail.value);
    this.setData({ period: PERIOD_OPTS[idx].value, periodIndex: idx, periodLabel: PERIOD_OPTS[idx].label });
  },

  async submit() {
    if (this.data.submitting) return;
    const { name, phone, hopeDate, remark, pkgId, specId, period } = this.data;
    if (!name.trim()) return wx.showToast({ title: '请填写称呼', icon: 'none' });
    if (!/^1\d{10}$/.test(phone.trim())) return wx.showToast({ title: '请填正确的手机号', icon: 'none' });
    this.setData({ submitting: true });
    try {
      await request('/api/customer/appointment/submit', 'POST', {
        name: name.trim(),
        phone: phone.trim(),
        packageId: pkgId || '',
        specId: specId || '',
        hopeDate, remark, period
      });
      wx.showToast({ title: '预约提交成功', icon: 'success' });
      this.setData({ name: '', phone: '', hopeDate: '', remark: '', period: 'full', submitting: false });
      this.loadList();
    } catch (e) {
      this.setData({ submitting: false });
      wx.showToast({ title: (e && e.message) || '提交失败', icon: 'none' });
    }
  },

  // 取消预约（pending / confirmed 可取消；不直接释放档期，需商户处理）
  async cancel(e) {
    const id = e.currentTarget.dataset.id;
    const r = await wx.showModal({ title: '取消预约', content: '确定取消该预约吗？（若已确认，档期释放需摄影师处理）' });
    if (!r.confirm) return;
    try {
      await request('/api/customer/appointment/cancel', 'POST', { id });
      wx.showToast({ title: '已取消', icon: 'success' });
      this.loadList();
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '取消失败', icon: 'none' });
    }
  },

  // ===== 问卷弹窗 =====
  closeQ() { this.setData({ qModal: false }); },
  noop() {},
  onQInputSwitch(e) {
    const i = e.currentTarget.dataset.i;
    const answers = { ...this.data.qAnswers, [i]: e.detail.value ? '是' : '否' };
    this.setData({ qAnswers: answers });
  },
  onQInput(e) {
    const i = e.currentTarget.dataset.i;
    const answers = { ...this.data.qAnswers, [i]: e.detail.value };
    this.setData({ qAnswers: answers });
  },
  async submitQ() {
    if (this.data.qSubmitting) return;
    const { qAppt, qAnswers, list } = this.data;
    if (!qAppt || !qAppt.order_id) return;
    this.setData({ qSubmitting: true });
    try {
      await request('/api/customer/orders/' + qAppt.order_id + '/questionnaire', 'POST', { answers: qAnswers });
      wx.showToast({ title: '问卷已提交', icon: 'success' });
      this.setData({ qModal: false });
      this.loadList();
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '提交失败', icon: 'none' });
    } finally {
      this.setData({ qSubmitting: false });
    }
  }
});
