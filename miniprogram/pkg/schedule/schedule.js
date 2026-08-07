const { request } = require('../../utils/req.js');

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];
const PERIODS = ['am', 'pm', 'night'];
const PERIOD_LABEL = { am: '上午', pm: '下午', night: '晚上', full: '全天' };
const DOT = { booked: '约满', pending: '待确认', closed: '关闭', partial: '紧张', free: '' };

function pad(n) { return n < 10 ? '0' + n : '' + n; }

function buildMonth(year, month0) {
  const first = new Date(year, month0, 1);
  const startDay = (first.getDay() + 6) % 7; // 周一为一周起点
  const days = new Date(year, month0 + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  const mm = pad(month0 + 1);
  for (let d = 1; d <= days; d++) {
    cells.push({ day: d, date: `${year}-${mm}-${pad(d)}`, status: 'free', dot: '' });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

Page({
  data: {
    WEEK, PERIODS, PERIOD_LABEL,
    month: '', year: 0, monthIdx: 0,
    cells: [],
    bookingOpen: true,
    occupied: {}, closed: {}, pending: {}, // date -> {am:true,...}
    selDate: '', selPeriod: '', picking: false,
    msg: ''
  },

  _loading: false,
  _tasks: [],

  onLoad(options) {
    const now = new Date();
    // selectMode=1：作为预约表单的子选择器，选完日期返回表单而非再跳表单
    this.setData({
      year: now.getFullYear(),
      monthIdx: now.getMonth(),
      selectMode: !!(options && options.selectMode)
    });
    this.loadBooking();
    this.loadAvailability();
  },

  onUnload() {
    this._tasks.forEach((t) => { try { t.abort(); } catch (e) {} });
    this._tasks = [];
    this.setData({ cells: [] });
  },

  async loadBooking() {
    try {
      const b = await request('/api/settings/booking');
      this.setData({ bookingOpen: b && b.open !== false });
    } catch (e) { this.setData({ bookingOpen: true }); }
  },

  // 严格产出 YYYY-MM：仅从 year/monthIdx 提取年、月纯数字，杜绝把 Date 对象塞进 url 参数
  monthStr(y, m0) {
    const yy = Number(y);
    const mm = Number(m0) + 1; // monthIdx 是 0-11，+1 得 1-12
    if (!Number.isFinite(yy) || !Number.isFinite(mm)) return '';
    return `${yy}-${pad(mm)}`;
  },

  async loadAvailability() {
    // ① 单独取出年、月纯数字（month 仅传「年-月」字符串 YYYY-MM），禁止传入 Date 对象
    const month = this.monthStr(this.data.year, this.data.monthIdx);
    // 每次切换月份先清空档期状态，确保该月默认全部【空闲白色】，避免沿用上月的红/灰
    this.setData({ month, occupied: {}, closed: {}, pending: {} });
    if (!month) {
      // 兜底：年月非法时绝不直接拼接进 url，避免污染参数导致 400；仅打印日志，不阻断
      console.error('[schedule] 非法年月，使用空白档期渲染', { year: this.data.year, monthIdx: this.data.monthIdx });
      this.decorate();
      return;
    }
    try {
      const av = await request('/api/schedules/availability?month=' + month);
      const occupied = {}, closed = {}, pending = {};
      const fill = (map, x) => {
        const ps = x.period === 'full' ? PERIODS : [x.period];
        map[x.date] = map[x.date] || {};
        ps.forEach((p) => { map[x.date][p] = true; });
      };
      (av.occupied || []).forEach((x) => fill(occupied, x));
      (av.closed || []).forEach((x) => fill(closed, x));
      (av.pending || []).forEach((x) => fill(pending, x));
      this.setData({ occupied, closed, pending });
    } catch (e) {
      // 容错：接口出错（含未来/历史月份无数据、网络抖动、超时、Render 冷启动）
      // 均不弹出「获取档期失败」阻断用户；仅打印日志，该月日期默认空闲白色，可正常点击选择
      console.error('[schedule] 档期加载失败（已降级为空闲）month=', month, 'err=', e && (e.errMsg || e.message || e));
    }
    // 无论成功/失败都渲染日历格子（失败则全部空闲白色）
    this.decorate();
  },

  // 给每个日期格子上色：booked(红)/closed(灰)/partial(红,部分时段)/pending(黄)/free(白)
  decorate() {
    const { occupied, closed, pending, year, monthIdx } = this.data;
    const cells = buildMonth(year, monthIdx);
    for (const c of cells) {
      if (!c) continue;
      const occ = occupied[c.date], clo = closed[c.date], pen = pending[c.date];
      const occAll = occ && PERIODS.every((x) => occ[x]);
      let st = 'free';
      if (occAll) st = 'booked';
      else if (clo && clo.full && !occ) st = 'closed';
      else if (occ && Object.keys(occ).length) st = 'partial';
      else if (pen && Object.keys(pen).length) st = 'pending';
      c.status = st;
      c.dot = DOT[st];
    }
    this.setData({ cells });
  },

  shift(delta) {
    let y = this.data.year, m = this.data.monthIdx + delta;
    if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
    this.setData({ year: y, monthIdx: m, selDate: '', selPeriod: '', picking: false });
    this.loadAvailability();
  },

  onPickDay(e) {
    const date = e.currentTarget.dataset.date;
    if (!date) return;
    // 不做前端拦截：任意日期（含约满/关闭/过去日期）均可选中，原样提交，业务校验交给后端
    this.setData({ selDate: date, selPeriod: '', picking: true });
  },

  onPickPeriod(e) {
    const period = e.currentTarget.dataset.period;
    const date = this.data.selDate;
    const occ = this.data.occupied[date] || {};
    if (occ[period]) { wx.showToast({ title: '该时段已约满', icon: 'none' }); return; }
    this.setData({ selPeriod: period });
  },

  goFill() {
    const { selDate, selPeriod, selectMode } = this.data;
    if (!selDate || !selPeriod) return wx.showToast({ title: '请选择日期与时段', icon: 'none' });
    if (selectMode) {
      // 子选择器模式：回填上一页（预约表单）的 期望日期/时段，并返回
      const pages = getCurrentPages();
      const prev = pages[pages.length - 2];
      if (prev && prev.route && prev.route.indexOf('appointment') >= 0) {
        const periodIdx = ['full', 'am', 'pm', 'night'].indexOf(selPeriod);
        prev.setData({
          hopeDate: selDate,
          period: selPeriod,
          periodIndex: periodIdx < 0 ? 0 : periodIdx,
          periodLabel: PERIOD_LABEL[selPeriod] || '全天'
        });
        wx.navigateBack();
        return;
      }
      // 兜底（极端情况）：重定向到表单
      wx.redirectTo({ url: `/pkg/appointment/appointment?date=${selDate}&period=${selPeriod}` });
      return;
    }
    wx.navigateTo({ url: `/pkg/appointment/appointment?date=${selDate}&period=${selPeriod}` });
  },

  goFillNoDate() {
    if (this.data.selectMode) {
      // 子选择器模式：不指定日期，直接返回上一页（保留表单原有值）
      const pages = getCurrentPages();
      const prev = pages[pages.length - 2];
      if (prev && prev.route && prev.route.indexOf('appointment') >= 0) {
        wx.navigateBack();
        return;
      }
      wx.redirectTo({ url: '/pkg/appointment/appointment' });
      return;
    }
    wx.navigateTo({ url: '/pkg/appointment/appointment' });
  }
});
