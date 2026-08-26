import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import http from '../api.js';

function getTimeInfo() {
  const now = new Date();
  const hours = now.getHours();
  const greet = hours < 12 ? '早上好' : hours < 18 ? '下午好' : '晚上好';
  const date = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  return { greet, date };
}

export default function Topbar({ onMenu }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [timeInfo, setTimeInfo] = useState(getTimeInfo());
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTimeInfo(getTimeInfo()), 60000);
    return () => clearInterval(timer);
  }, []);

  // 消息未读红点：轮询 biz_message（与手机端共用同一套数据），onFocus 切回强制拉取
  const pullUnread = () => {
    http.get('/api/mobile/message/unread-count', { __skipReport: true }).then((r) => setUnread(r.data.count || 0)).catch(() => {});
  };
  useEffect(() => {
    pullUnread();
    const t = setInterval(pullUnread, 8000);
    window.addEventListener('focus', pullUnread);
    return () => { clearInterval(t); window.removeEventListener('focus', pullUnread); };
  }, []);

  const handleLogout = () => {
    if (window.confirm('确定要退出登录吗？')) {
      logout();
    }
  };

  return (
    <header
      className="shrink-0 flex items-center justify-between"
      style={{ height: 56, background: '#ffffff', borderBottom: '1px solid #e5e7eb', padding: '0 16px 0 24px' }}
    >
      {/* 左侧：移动端汉堡菜单（品牌已移至侧边栏工作台上方） */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={onMenu}
          className="xl:hidden -ml-1 p-2"
          style={{ color: '#333333' }}
          aria-label="菜单"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      </div>

      {/* 中间：日期（仅桌面端显示，移动端隐藏省空间） */}
      <div className="hidden md:flex" style={{ flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: 13, color: '#777777' }}>{timeInfo.date}</span>
      </div>

      {/* 右侧：消息铃铛（未读角标）+ admin 标签 + 退出登录 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={() => nav('/m/msg')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, position: 'relative', color: '#444444' }}
          aria-label="消息中心"
          title="消息中心"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.7 21a2 2 0 0 1-3.4 0" />
          </svg>
          {unread > 0 && (
            <span style={{ position: 'absolute', top: -2, right: -4, minWidth: 16, height: 16, borderRadius: 8, background: '#FF4D4F', color: '#fff', fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', border: '2px solid #fff' }}>
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
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
