import { useState, useEffect } from 'react';

// 视图状态记忆：Tab / 筛选 / 页码 同时存入 URL 参数与 sessionStorage
// - 切换左侧菜单再返回：sessionStorage 自动恢复上次状态
// - 浏览器前进/后退：监听 popstate 完整重放
// - 关闭浏览器自动清空（sessionStorage 特性），无残留脏数据
export function useViewState(pageKey, initial) {
  const read = () => {
    const sp = new URLSearchParams(location.search);
    const fromUrl = {};
    for (const k of Object.keys(initial)) {
      if (sp.has(k)) fromUrl[k] = sp.get(k);
    }
    let fromSess = {};
    try { fromSess = JSON.parse(sessionStorage.getItem('view:' + pageKey) || '{}'); } catch {}
    return { ...initial, ...fromSess, ...fromUrl };
  };

  const [state, setState] = useState(read);

  const persist = (s) => {
    const sp = new URLSearchParams(location.search);
    for (const k of Object.keys(s)) {
      if (s[k] !== '' && s[k] != null) sp.set(k, s[k]);
      else sp.delete(k);
    }
    const qs = sp.toString();
    window.history.replaceState(null, '', qs ? location.pathname + '?' + qs : location.pathname);
    sessionStorage.setItem('view:' + pageKey, JSON.stringify(s));
  };

  useEffect(() => { persist(state); }, [state]);

  useEffect(() => {
    const onPop = () => setState(read());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line
  }, []);

  return [state, setState];
}
