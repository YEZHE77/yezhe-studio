import { useAuth } from '../auth.jsx';

export default function Topbar({ onMenu }) {
  const { user, logout } = useAuth();
  const now = new Date();
  const greet = now.getHours() < 12 ? '早上好' : now.getHours() < 18 ? '下午好' : '晚上好';
  const date = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

  return (
    <header className="h-16 border-b border-line flex items-center justify-between px-6 bg-panel shrink-0">
      <div className="flex items-center gap-3">
        <button onClick={onMenu} className="lg:hidden -ml-1 p-2 -mr-1" style={{ color: '#333333' }} aria-label="菜单">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
        <div>
        <div className="text-xs text-muted">{date}</div>
        <div className="font-semibold text-fg">{greet}，{user?.name || user?.username}</div>
      </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs px-2 py-1 rounded bg-panel2 text-muted">{user?.role}</span>
        <button onClick={logout} className="text-sm text-muted hover:text-brand">退出登录</button>
      </div>
    </header>
  );
}
