// client/src/bgm.js —— 相册幻灯片背景音乐《梦中的婚礼》全局唯一单例（Web 端）
//
// 与微信小程序端逻辑完全统一：
//  1. 音频采用线上 mp3 网络地址（不打包进前端包），由 bgmUrl 注入。
//  2. 全局仅维护唯一音频实例（单例 Audio）。
//  3. 必须用户点击【播放】手势后才 play（由页面在手势内调用 play）。
//  4. 切换相册图片时不对音频做停止/重置，音乐持续连贯。
//  5. 音乐按钮只切 muted 静音，不调用 stop。
//  6. 关闭幻灯片执行 pause 并记录进度，不销毁实例；下次打开从上次进度继续，不重新下载。
//  7. Web 为单页应用，实例常驻（仅 pause），离开页面不销毁，符合"记录进度下次继续"诉求。
//  8. 缓冲加载时通过 subscribe 暴露 loading 状态，界面展示「音乐加载中」。

let audio = null;        // 唯一音频实例
let url = '';            // BGM 地址
let progress = 0;        // 已播放秒数（关闭时记录）
let muted = false;       // 静音状态
let loading = false;     // 缓冲中
let playing = false;     // 是否处于"应播放"状态
const listeners = [];

function getState() {
  return { loading, muted, hasUrl: !!url, playing };
}

function emit() {
  const s = getState();
  listeners.slice().forEach((fn) => { try { fn(s); } catch (e) {} });
}

// 订阅状态变化，返回取消订阅函数
export function subscribe(fn) {
  listeners.push(fn);
  fn(getState());
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

// 注入 BGM 地址（组件挂载时调用，不触发播放）
export function init(u) {
  url = u || '';
  return getState();
}

function ensure() {
  if (audio || !url) return audio;
  const a = new Audio();
  a.src = url;
  a.loop = true;
  a.preload = 'auto';
  a.addEventListener('waiting', () => { loading = true; emit(); });
  a.addEventListener('canplay', () => { loading = false; emit(); });
  a.addEventListener('playing', () => { loading = false; emit(); });
  a.addEventListener('timeupdate', () => { progress = a.currentTime || 0; });
  a.addEventListener('error', () => { loading = false; emit(); });
  audio = a;
  return a;
}

// 开始播放（必须由用户手势触发）
export function play() {
  const a = ensure();
  if (!a) return;
  if (progress > 0.3) { try { a.currentTime = progress; } catch (e) {} }
  a.muted = muted;
  loading = true; playing = true; emit();
  a.play().catch(() => {});
}

// 暂停并记录进度（不销毁实例）
export function pause() {
  if (!audio) { playing = false; return; }
  try { progress = audio.currentTime || progress; } catch (e) {}
  audio.pause();
  loading = false; playing = false; emit();
}

// 静音切换（不停止音频）
export function toggleMute() {
  muted = !muted;
  if (audio) audio.muted = muted;
  emit();
  return muted;
}

const bgm = { init, play, pause, toggleMute, subscribe, getState };
export default bgm;
