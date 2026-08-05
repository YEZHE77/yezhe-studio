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

  onLoad() {
    const now = new Date();
    this.setData({ year: now.getFullYear(), monthIdx: now.getMonth() });
    this.loadBooking();
    this.loadAvailability();
  },

  async loadBooking() {
    try {
      const b = await request('/api/settings/booking');
      this.setData({ bookingOpen: b && b.open !== false });
    } catch (e) { this.setData({ bookingOpen: true }); }
  },

  async loadAvailability() {
    const y = this.data.year, m = this.data.monthIdx;
    const month = `${y}-${pad(m + 1)}`;
    this.setData({ month });
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
      this.decorate();
    } catch (e) {
      this.decorate();
    }
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
    const cell = this.data.cells.find((c) => c && c.date === date);
    const st = cell ? cell.status : 'free';
    if (st === 'booked' || st === 'closed') {
      wx.showToast({ title: st === 'closed' ? '该日暂不开放' : '该日已约满', icon: 'none' });
      return;
    }
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
    const { selDate, selPeriod } = this.data;
    if (!selDate || !selPeriod) return wx.showToast({ title: '请选择日期与时段', icon: 'none' });
    wx.navigateTo({ url: `/pages/appointment/appointment?date=${selDate}&period=${selPeriod}` });
  },

  goFillNoDate() {
    wx.navigateTo({ url: '/pages/appointment/appointment' });
  }
});
