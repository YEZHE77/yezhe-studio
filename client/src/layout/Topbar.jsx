import { useAuth } from '../auth.jsx';

export default function Topbar({ onMenu }) {
  const { user, logout } = useAuth();
  const now = new Date();
  const greet = now.getHours() < 12 ? '早上好' : now.getHours() < 18 ? '下午好' : '晚上好';
  const date = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

  return (
    <header className="shrink-0 flex items-center justify-between" style={{ height: 88, background: '#ffffff', borderBottom: '1px solid #e5e7eb', padding: '16px 24px' }}>
      <div className="flex items-center" style={{ gap: 12 }}>
        <button onClick={onMenu} className="lg:hidden -ml-1 p-2 -mr-1" style={{ color: '#333333' }} aria-label="菜单">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 16, color: '#6b7280' }}>{date}</div>
          <div style={{ fontSize: 32, color: '#111111', fontWeight: 600 }}>{greet}，{user?.name || user?.username}</div>
        </div>
      </div>
      <div className="flex items-center" style={{ gap: 16 }}>
        <span style={{ background: '#f3f4f6', borderRadius: 8, padding: '8px 16px', fontSize: 18, color: '#333333' }}>{user?.username || 'admin'}</span>
        <button onClick={logout} style={{ fontSize: 18, color: '#444444', background: 'none', border: 'none', cursor: 'pointer' }}>退出登录</button>
      </div>
    </header>
  );
}
