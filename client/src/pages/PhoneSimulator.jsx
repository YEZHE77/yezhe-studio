import React, { useEffect, useMemo, useRef, useState } from 'react';

// 线上「手机端模拟器」页面
// 用途：在网页中直接查看 C 端/H5 页面在真实手机屏幕里的样子，给老板/客户演示用。
// 注意：只还原屏幕尺寸与外壳；真实 UA、微信环境、触摸手感请用「真机打开」扫码验证。

const DEVICES = [
  { name: 'iPhone 15 Pro Max', w: 430, h: 932, radius: 52, islandW: 126, islandH: 37, homeW: 148 },
  { name: 'iPhone 15 Pro', w: 393, h: 852, radius: 48, islandW: 116, islandH: 34, homeW: 134 },
  { name: 'iPhone 14 Pro Max', w: 430, h: 932, radius: 52, islandW: 126, islandH: 37, homeW: 148 },
  { name: 'iPhone 13 / 14', w: 390, h: 844, radius: 48, islandW: 108, islandH: 32, homeW: 132 },
  { name: 'iPhone X / 11 Pro', w: 375, h: 812, radius: 46, islandW: 0, islandH: 0, notchW: 172, notchH: 30, homeW: 128 },
  { name: 'iPhone SE', w: 375, h: 667, radius: 40, islandW: 0, islandH: 0, notchW: 0, notchH: 0, homeW: 110 },
  { name: 'Android', w: 412, h: 915, radius: 42, islandW: 0, islandH: 0, notchW: 0, notchH: 0, homeW: 128 },
  { name: '小屏安卓', w: 360, h: 780, radius: 38, islandW: 0, islandH: 0, notchW: 0, notchH: 0, homeW: 110 },
];

const PRESETS = [
  { label: '微官网', path: '/home' },
  { label: '套系中心', path: '/package-center' },
  { label: '我的', path: '/my' },
  { label: '管理后台', path: '/' },
];

function getOrigin() {
  if (typeof window === 'undefined') return '';
  return window.location.origin;
}

function isLocal() {
  if (typeof window === 'undefined') return false;
  return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}

export default function PhoneSimulator() {
  const [url, setUrl] = useState(() => getOrigin() + '/home');
  const [deviceName, setDeviceName] = useState('iPhone 15 Pro Max');
  const [landscape, setLandscape] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showQR, setShowQR] = useState(false);
  const frameRef = useRef(null);

  const device = useMemo(() => DEVICES.find((d) => d.name === deviceName) || DEVICES[0], [deviceName]);

  // 横屏时宽高互换
  const screenW = landscape ? device.h : device.w;
  const screenH = landscape ? device.w : device.h;
  const framePad = 12; // 屏幕黑边
  const frameW = screenW + framePad * 2;
  const frameH = screenH + framePad * 2;
  const scale = screenW / device.w; // 灵动岛/Home indicator 按屏幕宽度比例缩放

  // 键盘快捷键：R 刷新
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'r' || e.key === 'R') {
        setRefreshKey((k) => k + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const doRefresh = () => setRefreshKey((k) => k + 1);

  const openNew = () => window.open(url, '_blank');

  const openLocal = () => {
    const u = new URL(url, window.location.href);
    setUrl(`http://localhost:5173${u.pathname}${u.search}`);
    doRefresh();
  };

  const openOnline = () => {
    const u = new URL(url, window.location.href);
    setUrl(`${getOrigin()}${u.pathname}${u.search}`);
    doRefresh();
  };

  const toggleLandscape = () => {
    setLandscape((v) => !v);
    doRefresh();
  };

  const applyPreset = (path) => {
    setUrl(getOrigin() + path);
    doRefresh();
  };

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(url)}`;

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '28px 16px 40px',
        background: 'linear-gradient(160deg, #1b1f27 0%, #0f1117 100%)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
        color: '#e8eaed',
      }}
    >
      {/* 标题 */}
      <h1
        style={{
          fontSize: 18,
          fontWeight: 600,
          letterSpacing: 0.5,
          marginBottom: 4,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: '#7ECDBB',
            boxShadow: '0 0 8px #7ECDBB',
            display: 'inline-block',
          }}
        />
        岛像工作室 · 手机端模拟器
      </h1>
      <div style={{ fontSize: 12, color: '#8a919f', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>网页中直接查看手机端效果，视口宽度 &lt;768px 自动进入手机模式</span>
        <span
          style={{
            background: isLocal() ? '#2a3a2a' : '#1e3a4c',
            color: isLocal() ? '#7ECDBB' : '#2DB7F5',
            padding: '2px 8px',
            borderRadius: 4,
            fontSize: 11,
            border: `1px solid ${isLocal() ? '#3a5a4a' : '#2a5a7c'}`,
          }}
        >
          {isLocal() ? '本地 localhost' : '线上 pages.dev'}
        </span>
      </div>

      {/* 链接 + 设备 + 操作 */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          justifyContent: 'center',
          alignItems: 'center',
          marginBottom: 20,
          maxWidth: 900,
        }}
      >
        <span style={{ fontSize: 13, color: '#8a919f' }}>链接</span>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doRefresh()}
          style={{
            flex: 1,
            minWidth: 260,
            padding: '8px 12px',
            background: '#16191f',
            border: '1px solid #2c313c',
            borderRadius: 8,
            fontSize: 13,
            color: '#e8eaed',
            outline: 'none',
          }}
        />
        <select
          value={deviceName}
          onChange={(e) => {
            setDeviceName(e.target.value);
            doRefresh();
          }}
          style={{
            padding: '8px 10px',
            background: '#16191f',
            border: '1px solid #2c313c',
            borderRadius: 8,
            fontSize: 13,
            color: '#e8eaed',
            outline: 'none',
            cursor: 'pointer',
          }}
        >
          {DEVICES.map((d) => (
            <option key={d.name} value={d.name}>
              {d.name} ({d.w}×{d.h})
            </option>
          ))}
        </select>
        <span style={{ width: 1, height: 20, background: '#2c313c', margin: '0 4px' }} />
        <button onClick={toggleLandscape} style={btnStyle(landscape)}>
          🔄 {landscape ? '竖屏' : '横屏'}
        </button>
        <button onClick={doRefresh} style={btnStyle(false)}>↻ 刷新</button>
        <button onClick={openNew} style={btnStyle(false)}>↗ 新窗口</button>
        {!isLocal() && <button onClick={openLocal} style={btnStyle(false)}>本地版</button>}
        {isLocal() && <button onClick={openOnline} style={btnStyle(false)}>线上版</button>}
        <button onClick={() => setShowQR(true)} style={{ ...btnStyle(false), color: '#7ECDBB', borderColor: '#3a5a52' }}>真机打开</button>
      </div>

      {/* 快捷页面 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 20 }}>
        {PRESETS.map((p) => (
          <button
            key={p.path}
            onClick={() => applyPreset(p.path)}
            style={{
              padding: '6px 12px',
              background: url.endsWith(p.path) || url.includes(p.path + '?') ? '#7ECDBB' : '#1a1d24',
              color: url.endsWith(p.path) || url.includes(p.path + '?') ? '#0f1117' : '#c9ced8',
              border: '1px solid #2c313c',
              borderRadius: 6,
              fontSize: 12,
              cursor: 'pointer',
              fontWeight: url.endsWith(p.path) || url.includes(p.path + '?') ? 600 : 400,
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* 手机舞台 */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        {/* iPhone 外框 */}
        <div
          style={{
            position: 'relative',
            width: frameW,
            height: frameH,
            background: '#0a0c10',
            borderRadius: device.radius,
            padding: framePad,
            boxShadow:
              '0 0 0 1px #000, 0 24px 60px rgba(0,0,0,.55), 0 4px 14px rgba(0,0,0,.4), inset 0 0 6px rgba(255,255,255,.04)',
            border: '3px solid #2c313c',
            transition: 'width .3s ease, height .3s ease',
          }}
        >
          {/* 屏幕 */}
          <div
            style={{
              position: 'relative',
              width: screenW,
              height: screenH,
              borderRadius: device.radius - 10,
              overflow: 'hidden',
              background: '#fff',
            }}
          >
            <iframe
              ref={frameRef}
              key={refreshKey}
              src={url}
              title="手机端模拟"
              style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
            />
            {/* 灵动岛 */}
            {device.islandW > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: 10,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: Math.round(device.islandW * scale),
                  height: Math.round(device.islandH * scale),
                  background: '#000',
                  borderRadius: 18,
                  zIndex: 10,
                  pointerEvents: 'none',
                }}
              />
            )}
            {/* 刘海屏 notch（iPhone X/SE 之前/无灵动岛机型） */}
            {device.notchW > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: Math.round(device.notchW * scale),
                  height: Math.round(device.notchH * scale),
                  background: '#000',
                  borderBottomLeftRadius: 18,
                  borderBottomRightRadius: 18,
                  zIndex: 10,
                  pointerEvents: 'none',
                }}
              />
            )}
            {/* Home 指示条 */}
            {device.homeW > 0 && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 6,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: Math.round(device.homeW * scale),
                  height: 5,
                  background: 'rgba(0,0,0,.65)',
                  borderRadius: 3,
                  zIndex: 10,
                  pointerEvents: 'none',
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* 底部提示 */}
      <div style={{ marginTop: 18, textAlign: 'center', fontSize: 12, color: '#6b7280', lineHeight: 1.9 }}>
        登录账号 <b style={{ color: '#7ECDBB', fontWeight: 600 }}>admin</b> / 密码{' '}
        <b style={{ color: '#7ECDBB', fontWeight: 600 }}>admin123</b> · 模拟器内操作即等于手机端操作
        <br />
        模拟器只还原屏幕尺寸与外壳；真实 UA、微信环境、触摸手感请用
        <button
          onClick={() => setShowQR(true)}
          style={{
            background: 'none',
            border: 'none',
            color: '#FF8A8A',
            cursor: 'pointer',
            fontSize: 12,
            padding: 0,
            textDecoration: 'underline',
          }}
        >
          「真机打开」
        </button>
        扫码在手机上验证
      </div>

      {/* 二维码弹窗 */}
      {showQR && (
        <div
          onClick={() => setShowQR(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: 12,
              padding: 24,
              width: 320,
              textAlign: 'center',
              color: '#1f2937',
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>真机打开</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 16, wordBreak: 'break-all' }}>
              用手机浏览器或微信扫一扫，访问当前页面
              <br />
              <span style={{ color: '#111' }}>{url}</span>
            </div>
            <img src={qrUrl} alt="真机二维码" style={{ width: 180, height: 180, display: 'block', margin: '0 auto 16px' }} />
            <button
              onClick={() => setShowQR(false)}
              style={{
                padding: '8px 24px',
                background: '#7ECDBB',
                border: 'none',
                borderRadius: 8,
                color: '#0f1117',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function btnStyle(active) {
  return {
    padding: '7px 14px',
    background: active ? '#7ECDBB' : '#1a1d24',
    color: active ? '#0f1117' : '#c9ced8',
    border: `1px solid ${active ? '#7ECDBB' : '#2c313c'}`,
    borderRadius: 8,
    fontSize: 12,
    cursor: 'pointer',
    transition: 'all .15s',
    fontWeight: active ? 600 : 400,
  };
}
