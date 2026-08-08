const { requestTask } = require('../../utils/req.js');

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];
const PERIODS = ['half', 'full'];
const PERIOD_LABEL = { half: '半天', full: '全天' };
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
    loading: false,
    bookingOpen: true,
    occupied: {}, closed: {}, pending: {}, // date -> {am:true,...}
    selDate: '', selPeriod: '', picking: false,
    msg: ''
  },

  _cache: {}, // month -> { occupied, closed, pending }
  _req: null,
  _tasks: [],

  onLoad() {
    const now = new Date();
    this.setData({ year: now.getFullYear(), monthIdx: now.getMonth() });
    this.loadBooking();
    this.loadAvailability();
  },

  onUnload() {
    if (this._req) { try { this._req.abort(); } catch (e) {} this._req = null; }
    this._tasks.forEach((t) => { try { t.abort(); } catch (e) {} });
    this._tasks = [];
    this._cache = {};
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
    this.setData({ month });
    if (!month) {
      // 兜底：年月非法时绝不直接拼接进 url，避免污染参数导致 400
      console.error('[schedule] 非法年月，无法请求档期', { year: this.data.year, monthIdx: this.data.monthIdx });
      wx.showToast({ title: '档期获取失败，请稍后重试', icon: 'none' });
      this.decorate();
      return;
    }

    // ③ 本地缓存命中：已加载过的月份直接复用，不再请求接口
    if (this._cache[month]) {
      const cached = this._cache[month];
      this.setData({ occupied: cached.occupied, closed: cached.closed, pending: cached.pending, loading: false });
      this.decorate();
      return;
    }

    // 切换月份时立刻发起请求，并取消上一个月未完成的请求
    if (this._req) { try { this._req.abort(); } catch (e) {} this._req = null; }
    this.setData({ loading: true, cells: [], occupied: {}, closed: {}, pending: {}, selDate: '', selPeriod: '', picking: false });

    try {
      const task = requestTask('/api/schedules/availability?month=' + encodeURIComponent(month), 'GET', {}, { timeout: 8000 });
      this._req = task;
      this._tasks.push(task);
      const av = await task.promise;

      const occupied = {}, closed = {}, pending = {};
      const fill = (map, x) => {
        if (!x || !x.date) return; // 兼容兜底：缺少 date 字段的脏数据直接跳过
        const ps = x.period === 'full' ? PERIODS : [x.period];
        map[x.date] = map[x.date] || {};
        ps.forEach((p) => { map[x.date][p] = true; });
      };
      // 数据格式校验：若不是对象/数组，按空数组兜底，避免 forEach 崩溃
      const arr = (v) => Array.isArray(v) ? v : [];
      arr(av && av.occupied).forEach((x) => fill(occupied, x));
      arr(av && av.closed).forEach((x) => fill(closed, x));
      arr(av && av.pending).forEach((x) => fill(pending, x));

      this._cache[month] = { occupied, closed, pending };
      this.setData({ occupied, closed, pending, loading: false });
      this.decorate();
    } catch (e) {
      // ② 容错兜底：接口 400/500/网络/超时均不崩溃，该月全部日期默认可选空闲
      console.error('[schedule] 获取档期失败 month=', month, 'err=', e && (e.errMsg || e.message || e));
      wx.showToast({ title: '档期获取失败，请稍后重试', icon: 'none' });
      this.setData({ occupied: {}, closed: {}, pending: {}, loading: false });
      this.decorate();
    } finally {
      // 清理已完成的请求句柄
      if (this._req) {
        this._tasks = this._tasks.filter((t) => t !== this._req);
        this._req = null;
      }
    }
  },

  // 给每个日期格子上色：booked(红)/closed(灰)/partial(红,部分时段)/pending(黄)/free(白)
  decorate() {
    const { occupied, closed, pending, year, monthIdx } = this.data;
    const cells = buildMonth(year, monthIdx);
    for (const c of cells) {
      if (!c) continue;
      const occ = occupied[c.date], clo = closed[c.date], pen = pending[c.date];
      let st = 'free';
      if (occ && occ.full) st = 'booked';
      else if (occ && Object.keys(occ).length) st = 'partial';
      else if (clo && clo.full && !occ) st = 'closed';
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
    wx.navigateTo({ url: `/pkg/appointment/appointment?date=${selDate}&period=${selPeriod}` });
  },

  goFillNoDate() {
    wx.navigateTo({ url: '/pkg/appointment/appointment' });
  }
});
