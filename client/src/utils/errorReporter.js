// 三端统一前端异常上报 SDK
// 自动识别当前端（mobile 移动工作台 / desktop 桌面工作台 / cend C 端客户客户端），
// 捕获 JS 运行时错误、未处理的 Promise 拒绝、接口错误、React 渲染崩溃，
// 生成结构化报告（错误类型 / 发生端 / 时间戳 / 上下文），并推送到后端 /api/client-error。
//
// 设计原则：
//  - 自给自足，绝不依赖 api.js（避免循环依赖 + 自身崩溃不应影响主流程）。
//  - 所有逻辑包裹 try/catch；上报失败静默忽略，绝不抛出。
//  - 自带 BASE 计算（与 api.js 保持一致），开发期走相对路径经 vite 代理转发到本地 4000。

const APP_VERSION = import.meta.env.VITE_APP_VERSION || import.meta.env.MODE || 'unknown';

// 与 client/src/api.js 同源的 BASE 计算（独立副本，避免循环依赖）
const BASE = (import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? '' : 'https://yezhe-studio-server.onrender.com')).replace(/\/+$/, '');

// C 端（客户客户端）公开路径前缀集合
const CEND_PREFIXES = [
  '/customer', '/package', '/customer-order', '/appointment-form',
  '/home', '/my', '/w/', '/package-center', '/share/', '/s/', '/customer/select-photo'
];

// 根据当前 pathname 判断当前属于哪一端
export function detectEnd() {
  try {
    const p = window.location.pathname || '';
    if (p.startsWith('/m/')) return 'mobile';
    if (CEND_PREFIXES.some((pre) => p === pre || p.startsWith(pre))) return 'cend';
    return 'desktop';
  } catch {
    return 'unknown';
  }
}

const END_LABEL = { mobile: '移动端', desktop: '桌面端', cend: 'C端客户', unknown: '未知端' };

let installed = false;
// 简单去重：相同 message+url 在 2s 内只上报一次，防止崩溃循环刷屏
const recent = new Map();
function throttle(key) {
  const now = Date.now();
  const last = recent.get(key) || 0;
  if (now - last < 2000) return false;
  recent.set(key, now);
  return true;
}

function buildReport({ type, message, stack, context }) {
  const now = new Date();
  return {
    type: String(type || 'js'),
    end: detectEnd(),
    message: String(message || '').slice(0, 500),
    stack: String(stack || '').slice(0, 4000),
    url: (window.location && window.location.pathname) || '',
    ua: (navigator && navigator.userAgent) || '',
    appVersion: APP_VERSION,
    timestamp: now.toISOString(),
    context: context ? JSON.stringify(context).slice(0, 2000) : ''
  };
}

function send(report) {
  try {
    const endpoint = BASE + '/api/client-error';
    const body = JSON.stringify(report);
    // 优先 sendBeacon（页面卸载也能送达）；失败回退 fetch keepalive
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      const ok = navigator.sendBeacon(endpoint, blob);
      if (ok) return;
    }
    if (typeof fetch !== 'undefined') {
      fetch(endpoint, { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {});
    }
  } catch { /* 上报失败不影响主流程 */ }
}

// 通用上报入口（JS 运行时错误 / 主动捕获）
export function report(error, opts = {}) {
  try {
    const err = error instanceof Error ? error : (error && error.error) || error;
    const message = (err && err.message) || String(error);
    const stack = err && err.stack;
    const reportObj = buildReport({ type: opts.type || 'js', message, stack, context: opts.context });
    const key = reportObj.type + '|' + reportObj.message + '|' + reportObj.url;
    if (!throttle(key)) return reportObj;
    send(reportObj);
    return reportObj;
  } catch {
    return null;
  }
}

// React 渲染崩溃（供 ErrorBoundary 调用）
export function reportBoundary(error, errorInfo) {
  try {
    const message = (error && error.message) || String(error);
    const stack = [error && error.stack, errorInfo && errorInfo.componentStack].filter(Boolean).join('\n');
    const reportObj = buildReport({
      type: 'react_boundary',
      message,
      stack,
      context: { componentStack: (errorInfo && errorInfo.componentStack) || '' }
    });
    const key = 'boundary|' + message + '|' + reportObj.url;
    if (!throttle(key)) return reportObj;
    send(reportObj);
    return reportObj;
  } catch {
    return null;
  }
}

// 接口错误（供 api.js 拦截器调用）
export function reportApiError(err, cfg = {}) {
  try {
    const status = (err && err.status) || (err && err.response && err.response.status);
    // 仅上报网络层 / 超时 / 5xx 服务端错误；401/403/409/4xx 业务态跳过，避免噪音
    const isNetwork = !err || err.type === 'network' || err.type === 'timeout' || !status;
    const isServer = typeof status === 'number' && status >= 500;
    if (!isNetwork && !isServer) return null;
    const url = (cfg && cfg.url) || '';
    const method = (cfg && cfg.method) || '';
    const reportObj = buildReport({
      type: 'api',
      message: `${method.toUpperCase()} ${url} → ${status || err.type || 'network'} ${err && err.message ? '(' + err.message + ')' : ''}`,
      stack: err && err.stack,
      context: { method, url, status, code: err && err.code, apiType: err && err.type }
    });
    const key = 'api|' + method + '|' + url + '|' + status;
    if (!throttle(key)) return reportObj;
    send(reportObj);
    return reportObj;
  } catch {
    return null;
  }
}

// 安装全局捕获（window.onerror + unhandledrejection），幂等
export function installGlobalHandlers() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (e) => {
    // 资源加载错误（img/script）没有 error.message，跳过
    if (e && e.message) report(e.error || e, { type: 'js', context: { filename: e.filename, lineno: e.lineno, colno: e.colno } });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e && e.reason;
    report(reason || { message: 'Unhandled Promise Rejection' }, { type: 'unhandledrejection' });
  });
}

export const ERROR_END_LABEL = END_LABEL;
export default { detectEnd, report, reportBoundary, reportApiError, installGlobalHandlers };
