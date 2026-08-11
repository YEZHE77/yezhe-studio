import { useState, useEffect } from 'react';
import { useAuth } from '../auth.jsx';

function getTimeInfo() {
  const now = new Date();
  const hours = now.getHours();
  const greet = hours < 12 ? '早上好' : hours < 18 ? '下午好' : '晚上好';
  const date = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  return { greet, date };
}

export default function Topbar({ onMenu }) {
  const { user, logout } = useAuth();
  const [timeInfo, setTimeInfo] = useState(getTimeInfo());

  useEffect(() => {
    const timer = setInterval(() => setTimeInfo(getTimeInfo()), 60000);
    return () => clearInterval(timer);
  }, []);

  const handleLogout = () => {
    if (window.confirm('确定要退出登录吗？')) {
      logout();
    }
  };

  return (
    <header
      className="shrink-0 flex items-center justify-between"
      style={{ height: 80, background: '#ffffff', borderBottom: '1px solid #e5e7eb', padding: '0 16px 0 24px' }}
    >
      {/* 左侧：移动端汉堡菜单（品牌已移至侧边栏工作台上方） */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={onMenu}
          className="lg:hidden -ml-1 p-2"
          style={{ color: '#333333' }}
          aria-label="菜单"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      </div>

      {/* 中间：日期（问候语已按需求删除） */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: 13, color: '#777777' }}>{timeInfo.date}</span>
      </div>

      {/* 右侧：admin 标签 + 退出登录 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span
          style={{
            background: '#f3f4f6',
            borderRadius: 8,
            padding: '6px 14px',
            fontSize: 14,
            color: '#333333'
          }}
        >
          {user?.username || 'admin'}
        </span>
        <button
          onClick={handleLogout}
          style={{
            fontSize: 14,
            color: '#444444',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0
          }}
        >
          退出登录
        </button>
      </div>
    </header>
  );
}
