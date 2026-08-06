// utils/bgm.js —— 相册幻灯片背景音乐《梦中的婚礼》全局唯一单例
//
// 严格遵守音频策略与性能规范：
//  1. 音频采用线上 mp3 网络地址（不打包进小程序包），由 bgmUrl 注入。
//  2. 全局仅维护唯一音频实例（wx.createInnerAudioContext 单例）。
//  3. 必须用户点击【播放】手势后才 play（本模块不主动播放，由页面在手势内调用 play）。
//  4. 切换相册图片时不对音频做停止/重置，音乐持续连贯。
//  5. 音乐按钮只切 muted 静音，不调用 stop。
//  6. 关闭幻灯片执行 pause 并记录进度，不 destroy；下次打开从上次进度继续，不重新下载。
//  7. 微信小程序特殊处理：
//      ① createInnerAudioContext 全局单例；
//      ② onHide 切后台暂停；onShow 切回前台若幻灯片仍开则 resume；
//      ③ 仅页面 onUnload 才 destroy 释放内存。
//  8. 缓冲加载时通过 subscribe 暴露 loading 状态，界面展示「音乐加载中」。

let ctx = null;        // 唯一音频实例
let url = '';          // BGM 地址
let progress = 0;      // 已播放秒数（关闭 / 切后台时记录）
let muted = false;     // 静音状态
let loading = false;   // 缓冲中
let playing = false;   // 是否处于"应播放"状态（用于 onShow 恢复）
const listeners = [];

function getState() {
  return { loading, muted, hasUrl: !!url, playing };
}

function emit() {
  const s = getState();
  listeners.slice().forEach((fn) => { try { fn(s); } catch (e) {} });
}

// 订阅状态变化（loading / muted 等），返回取消订阅函数
function subscribe(fn) {
  listeners.push(fn);
  fn(getState());
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

// 注入 BGM 地址（页面加载时调用，不触发播放）
function init(u) {
  url = u || '';
  return getState();
}

function ensureCtx() {
  if (ctx || !url) return ctx;
  const c = wx.createInnerAudioContext();
  c.src = url;
  c.loop = true;
  c.obeyMuteSwitch = false; // 不受系统静音键影响（仍受本应用 muted 控制）
  c.onCanplay(() => { loading = false; emit(); });
  c.onWaiting(() => { loading = true; emit(); });
  c.onError(() => { loading = false; playing = false; emit(); });
  c.onTimeUpdate(() => { if (c.currentTime) progress = c.currentTime; });
  ctx = c;
  return c;
}

// 开始播放（必须由用户手势触发）
function play() {
  const c = ensureCtx();
  if (!c) return;
  if (progress > 0.5) { try { c.seek(progress); } catch (e) {} }
  c.muted = muted;
  loading = true; playing = true; emit();
  c.play();
}

// 暂停并记录进度（不销毁实例）
function pause() {
  if (!ctx) { playing = false; return; }
  try { if (ctx.currentTime) progress = ctx.currentTime; } catch (e) {}
  ctx.pause();
  loading = false; playing = false; emit();
}

// 切回前台恢复（仅当仍处于应播放状态）
function resume() {
  if (!ctx || !playing) return;
  try { if (progress > 0.5) ctx.seek(progress); } catch (e) {}
  ctx.play();
}

// 静音切换（不停止音频）
function toggleMute() {
  muted = !muted;
  if (ctx) ctx.muted = muted;
  emit();
  return muted;
}

// 彻底销毁（仅页面 onUnload 调用）
function destroy() {
  if (ctx) {
    try { ctx.stop(); } catch (e) {}
    try { ctx.destroy(); } catch (e) {}
    ctx = null;
  }
  playing = false; loading = false;
  // 保留 progress，离开页面再回来仍可续播
  emit();
}

module.exports = { init, play, pause, resume, toggleMute, destroy, subscribe, getState };
