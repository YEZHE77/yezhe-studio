// pages/media/toast.js —— 自媒体模块内联 toast（零依赖，避免与 api.js 全局 toast 耦合）
let _timer = null;
export function toast(msg, type = 'ok') {
  let el = document.getElementById('__media_toast__');
  if (!el) {
    el = document.createElement('div');
    el.id = '__media_toast__';
    el.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:99999;padding:10px 24px;border-radius:10px;font-size:14px;white-space:nowrap;box-shadow:0 4px 20px rgba(0,0,0,.2);transition:opacity .3s;pointer-events:none;font-family:inherit;';
    document.body.appendChild(el);
  }
  el.style.background = type === 'err' ? '#F47175' : type === 'warn' ? '#E6A23C' : '#1f2329';
  el.style.color = '#fff';
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(_timer);
  _timer = setTimeout(() => { if (el) el.style.opacity = '0'; }, 2800);
}
