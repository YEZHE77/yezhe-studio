// utils/toast.js —— 全局轻提示 + 异步确认框（替代原生 alert / window.confirm）
//
// 背景：验收审计 6.2（后台 alert() 全局弹窗 ❌）、6.4（删除类二次确认 ⚠️）要求
// 把原生 alert / confirm 改为页面内就近提示与品牌化确认框，避免丑陋的浏览器
// 原生弹窗，并消除白屏/卡顿风险（原生 confirm 是阻塞式同步弹窗）。
//
// 用法：
//   import { toast, confirm } from '../utils/toast';
//   toast('已复制链接');                       // 替代 alert()
//   toast('操作失败', 'error');               // 类型：info | success | error
//   if (await confirm('确认删除？', { danger: true })) { ... }  // 替代 window.confirm()
//
// 设计为「命令式」单例：不依赖 React Context / Provider，任何文件 import 即用，
// 通过动态挂载/卸载 DOM 实现，避免在每个页面接入 Provider 的改造成本。

import React from 'react';
import { createRoot } from 'react-dom/client';

let toastHost = null;
function ensureHost() {
  if (toastHost && document.body && document.body.contains(toastHost)) return toastHost;
  toastHost = document.getElementById('wb-toast-host');
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.id = 'wb-toast-host';
    toastHost.style.cssText =
      'position:fixed;left:0;right:0;top:16px;z-index:9999;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none;';
    document.body.appendChild(toastHost);
  }
  return toastHost;
}

const TYPE_STYLE = {
  info: { background: 'rgba(31,31,31,0.95)', border: '1px solid rgba(126,205,187,0.45)' },
  success: { background: 'rgba(28,46,40,0.96)', border: '1px solid rgba(126,205,187,0.8)' },
  error: { background: 'rgba(58,22,22,0.97)', border: '1px solid rgba(255,99,99,0.65)' },
};

/**
 * 页面内轻提示（替代 alert）。自动消失，不影响交互。
 * @param {string} message 提示文本
 * @param {'info'|'success'|'error'} type 类型
 * @param {number} duration 显示时长 ms
 */
export function toast(message, type = 'info', duration = 2400) {
  if (typeof message !== 'string') message = String(message == null ? '' : message);
  if (typeof document === 'undefined') return; // SSR/非浏览器环境兜底
  const host = ensureHost();
  const el = document.createElement('div');
  const st = TYPE_STYLE[type] || TYPE_STYLE.info;
  const css = `max-width:86vw;padding:10px 16px;border-radius:10px;color:#fff;font-size:13px;line-height:1.5;box-shadow:0 6px 24px rgba(0,0,0,.35);opacity:0;transform:translateY(-8px);transition:opacity .25s,transform .25s;${Object.entries(
    st
  )
    .map(([k, v]) => `${k}:${v}`)
    .join(';')}`;
  el.style.cssText = css;
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
  });
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(-8px)';
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 300);
  }, duration);
}

/**
 * 异步确认框（替代 window.confirm）。返回 Promise<boolean>。
 * 调用方需 `await` 并将所在函数声明为 async。
 * @param {string} message 确认文案（支持 \n 换行）
 * @param {object} opts { title, confirmText, cancelText, danger }
 */
export function confirm(message, opts = {}) {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(false);
      return;
    }
    const host = document.createElement('div');
    host.style.cssText =
      'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);padding:20px;';
    document.body.appendChild(host);
    const root = createRoot(host);
    const close = (val) => {
      try {
        root.unmount();
      } catch (e) {
        /* noop */
      }
      if (host.parentNode) host.parentNode.removeChild(host);
      resolve(val);
    };
    const modal = React.createElement(
      'div',
      {
        style: {
          width: 'min(420px,92vw)',
          background: '#1f1f1f',
          borderRadius: '14px',
          padding: '22px 20px',
          boxShadow: '0 12px 40px rgba(0,0,0,.5)',
          border: '1px solid rgba(255,255,255,.08)',
        },
        onClick: (e) => e.stopPropagation(),
      },
      opts.title
        ? React.createElement(
            'div',
            { style: { color: '#fff', fontSize: '15px', fontWeight: '600', marginBottom: '8px' } },
            opts.title
          )
        : null,
      React.createElement(
        'div',
        {
          style: {
            color: '#d8d8d8',
            fontSize: '13.5px',
            lineHeight: '1.6',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          },
        },
        message
      ),
      React.createElement(
        'div',
        { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' } },
        React.createElement(
          'button',
          {
            onClick: () => close(false),
            style: {
              padding: '8px 16px',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,.18)',
              background: 'transparent',
              color: '#cfcfcf',
              fontSize: '13px',
              cursor: 'pointer',
            },
          },
          opts.cancelText || '取消'
        ),
        React.createElement(
          'button',
          {
            onClick: () => close(true),
            style: {
              padding: '8px 16px',
              borderRadius: '8px',
              border: 'none',
              background: opts.danger ? '#ff4d4f' : '#7ecdbb',
              color: opts.danger ? '#fff' : '#10231f',
              fontSize: '13px',
              fontWeight: '600',
              cursor: 'pointer',
            },
          },
          opts.confirmText || '确定'
        )
      )
    );
    root.render(modal);
  });
}

export default { toast, confirm };
