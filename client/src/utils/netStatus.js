// utils/netStatus.js —— 全局网络状态（验收清单 5.1）
// 需求：断网时页面顶部悬浮提示「当前网络不可用，请检查网络连接」，按钮置灰；
//       网络恢复后自动解除，无需刷新页面。
//
// 实现要点：
//   1) 单例订阅 navigator.onLine + online/offline 事件，避免每个页面各监听一遍；
//   2) 断网时给 <body> 打 data-offline="1"，由 index.css 统一把可点击元素置灰并禁用指针事件，
//      这样"按钮置灰"是一次性全局生效，不必逐个页面改；
//   3) 提供 useOnline() 给需要自己渲染提示的组件。
import { useEffect, useState } from 'react';

const listeners = new Set();
let online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;

function notify() {
  listeners.forEach((fn) => {
    try { fn(online); } catch { /* 单个订阅者异常不影响其它 */ }
  });
  applyBodyFlag();
}

// 断网打标：CSS 里 body[data-offline='1'] 会把按钮/链接统一置灰并禁用交互（清单 5.1）
function applyBodyFlag() {
  try {
    if (typeof document === 'undefined' || !document.body) return;
    if (online) document.body.removeAttribute('data-offline');
    else document.body.setAttribute('data-offline', '1');
  } catch { /* 忽略 */ }
}

let installed = false;
function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const on = () => { online = true; notify(); };
  const off = () => { online = false; notify(); };
  window.addEventListener('online', on);
  window.addEventListener('offline', off);
  applyBodyFlag();
}

// 订阅网络状态；返回当前是否在线
export function useOnline() {
  const [v, setV] = useState(online);
  useEffect(() => {
    install();
    listeners.add(setV);
    return () => { listeners.delete(setV); };
  }, []);
  return v;
}

export function isOnline() { return online; }
export const OFFLINE_MSG = '当前网络不可用，请检查网络连接';
