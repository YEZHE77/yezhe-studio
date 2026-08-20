import React, { useState, useEffect } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

export default function Login() {
  const { login, user } = useAuth();
  const nav = useNavigate();
  const [u, setU] = useState('admin');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 返回守卫：若用户是通过浏览器「返回」进入登录页（back_forward 导航），
  // 判定来自 C 端分享链路（客户在 /home 按返回 → 历史里的 /login 项），
  // 自动 replace 回 C 端主页，避免客户在手机浏览器看到后台登录页；
  // replace 会替换历史中的 /login 条目，再按返回即退出浏览器。
  useEffect(() => {
    if (user) return; // 已登录走下方 <Navigate to="/" />，不触发守卫
    try {
      const navEntries = performance.getEntriesByType('navigation');
      const navType = navEntries.length ? navEntries[0].type : '';
      if (navType === 'back_forward') {
        nav('/home', { replace: true });
      }
    } catch { /* 不支持 performance API 的环境安全降级 */ }
  }, [nav, user]);

  if (user) return <Navigate to="/" replace />;

  async function submit(e) {
    e.preventDefault();
    if (submitting) return;
    setErr('');
    setSubmitting(true);
    try {
      await login(u, p);
      nav('/');
    } catch (e) {
      setErr(e.response?.data?.error || '登录失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="h-screen flex items-center justify-center bg-ink">
      <form onSubmit={submit} className="w-full max-w-[320px] mx-4 bg-panel border border-line rounded-xl2 p-6 sm:p-7">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 rounded-lg bg-brand" />
          <div className="text-lg text-white">叶哲 STUDIO</div>
        </div>
        <div className="text-sm text-muted mb-5">摄影工作室全链路管理系统</div>
        <input className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white outline-none"
          placeholder="账号" value={u} onChange={(e) => setU(e.target.value)} />
        <input type="password" className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white outline-none"
          placeholder="密码" value={p} onChange={(e) => setP(e.target.value)} />
        {err && <div className="text-red-400 text-xs mb-3">{err}</div>}
        <button disabled={submitting} className="w-full py-2 rounded bg-brand text-white hover:opacity-90 disabled:opacity-60">{submitting ? '登录中…' : '登 录'}</button>
        <div className="text-xs text-muted mt-4 text-center">默认账号 admin / admin123（首次登录请修改）</div>
      </form>
    </div>
  );
}
