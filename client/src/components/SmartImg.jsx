import React, { useEffect, useState } from 'react';

// 通用图片组件（验收清单 6.1/6.2/6.3）
//   - 加载中：浅灰底 + 微光骨架（skeleton），不大片空白；
//   - 加载失败：统一占位图（图标 +「图片加载失败」），绝不出现浏览器原生裂图；
//   - 通过 onFail 回调让父组件统计失败数量（多图失效时顶部提示）。
//
// ratio = 宽/高（如 0.75 表示 3:4 竖图）。用于在加载完成前按已知宽高比预留高度，
// 避免骨架期间布局塌陷/后续图片跳动。拿不到比例时给默认 0.75。
export default function SmartImg({
  src, alt = '', style = {}, imgStyle = {}, className = '', imgClassName = '',
  loading = 'lazy', ratio = 0.75, onFail, onClick, onKeyDown, role, tabIndex,
}) {
  const [status, setStatus] = useState('loading'); // loading | ok | error
  useEffect(() => { setStatus('loading'); }, [src]);

  const ratioH = ratio && ratio > 0 ? (1 / ratio) : (4 / 3);

  return (
    <div
      className={className}
      role={role}
      tabIndex={tabIndex}
      onClick={onClick}
      onKeyDown={onKeyDown}
      style={{
        position: 'relative', width: '100%', overflow: 'hidden',
        background: '#f3f3f3', aspectRatio: `${ratio} / 1`,
        ...style,
      }}
    >
      {/* 加载骨架：浅灰底色 + 缓慢扫光（清单 6.3） */}
      {status === 'loading' && (
        <div
          aria-hidden
          style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(100deg, #f0f0f0 30%, #fafafa 50%, #f0f0f0 70%)',
            backgroundSize: '200% 100%',
            animation: 'skel-sweep 1.2s ease-in-out infinite',
          }}
        />
      )}

      {status === 'error' ? (
        // 统一占位图（清单 6.1）：不渲染 <img>，避免原生裂图
        <div
          style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 6, color: '#b0b0b0', background: '#f3f3f3',
          }}
        >
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#c4c4c4" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.6" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
          <span style={{ fontSize: 12 }}>图片加载失败</span>
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          loading={loading}
          className={imgClassName}
          onLoad={() => setStatus('ok')}
          onError={() => { setStatus('error'); if (onFail) onFail(); }}
          style={{
            width: '100%', height: '100%', objectFit: 'cover', display: 'block',
            visibility: status === 'ok' ? 'visible' : 'hidden',
            ...imgStyle,
          }}
        />
      )}
    </div>
  );
}
