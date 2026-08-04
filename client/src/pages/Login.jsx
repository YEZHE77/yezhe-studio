import React, { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

export default function Login() {
  const { login, user } = useAuth();
  const nav = useNavigate();
  const [u, setU] = useState('admin');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');

  if (user) return <Navigate to="/" replace />;

  async function submit(e) {
    e.preventDefault();
    setErr('');
    try {
      await login(u, p);
      nav('/');
    } catch (e) {
      setErr(e.response?.data?.error || '登录失败');
    }
  }

  return (
    <div className="h-screen flex items-center justify-center bg-ink">
      <form onSubmit={submit} className="w-80 bg-panel border border-line rounded-xl2 p-7">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 rounded-lg bg-brand" />
          <div className="text-lg font-semibold text-white">叶哲 Studio</div>
        </div>
        <div className="text-sm text-muted mb-5">摄影工作室全链路管理系统</div>
        <input className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white outline-none"
          placeholder="账号" value={u} onChange={(e) => setU(e.target.value)} />
        <input type="password" className="w-full mb-3 px-3 py-2 rounded bg-panel2 border border-line text-white outline-none"
          placeholder="密码" value={p} onChange={(e) => setP(e.target.value)} />
        {err && <div className="text-red-400 text-xs mb-3">{err}</div>}
        <button className="w-full py-2 rounded bg-brand text-white font-medium hover:opacity-90">登 录</button>
        <div className="text-xs text-muted mt-4 text-center">默认账号 admin / admin123（首次登录请修改）</div>
      </form>
    </div>
  );
}
