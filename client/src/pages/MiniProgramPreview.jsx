import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

// 电脑端「小程序预览」页：用 iframe 嵌入手机端 H5 链接，按真实手机屏幕比例（iPhone 13 / iPhone SE）显示
// 给老板在电脑上就能像手机那样看到自家微官网 / 套系中心 / 任何 H5 页面在手机里的样子，
// 而不是按桌面比例铺满全屏看

const DEVICES = {
  iPhone13: { frameW: 410, frameH: 890, screenW: 390, screenH: 844, notchW: 110, notchH: 28, radius: 44, homeW: 134 }, // iPhone 13 / 14
  iPhoneSE: { frameW: 340, frameH: 600, screenW: 320, screenH: 568, notchW: 0, notchH: 0, radius: 36, homeW: 110 } // iPhone SE（小屏，无刘海）
};

export default function MiniProgramPreview() {
  const nav = useNavigate();
  const [url, setUrl] = useState(() => (typeof window !== 'undefined' ? window.location.origin : '') + '/home');
  const [refreshKey, setRefreshKey] = useState(0);
  const [device, setDevice] = useState('iPhone13');
  const [error, setError] = useState(false);

  const d = DEVICES[device];
  const iframeW = Math.round(d.screenW);
  const iframeH = Math.round(d.screenH);
  const pad = Math.round(d.frameW * 10 / 410);

  return (
    <div style={{ minHeight: '100vh', background: '#000', display: 'flex', flexDirection: 'column', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif', color: '#fff' }}>
      {/* 顶部 */}
      <header style={{ display: 'flex', alignItems: 'center', padding: '12px 24px', background: '#000', borderBottom: '1px solid #1f1f1f' }}>
        <button onClick={() => nav(-1)} style={{ background: 'none', border: 'none', padding: '4px 8px', cursor: 'pointer', fontSize: 20, color: '#fff', lineHeight: 1 }} aria-label="返回">‹</button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 16, color: '#fff' }}>小程序预览</div>
        <div style={{ width: 30 }} />
      </header>

      {/* 工具栏：URL + 刷新 + 设备切换 + 快捷链接 */}
      <div style={{ display: 'flex', gap: 8, padding: '14px 24px', background: '#0a0a0a', borderBottom: '1px solid #1f1f1f', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: '#999' }}>链接</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: 1, minWidth: 280, padding: '8px 12px', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 6, fontSize: 13, outline: 'none', color: '#fff' }} />
        <button onClick={() => { setError(false); setRefreshKey((k) => k + 1); }} style={{ padding: '8px 16px', background: '#2DB7F5', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>刷新</button>
        <select value={device} onChange={(e) => setDevice(e.target.value)} style={{ padding: '8px 12px', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 6, fontSize: 13, color: '#fff' }}>
          <option value="iPhone13">iPhone 13 / 14</option>
          <option value="iPhoneSE">iPhone SE（小屏）</option>
        </select>
        <span style={{ width: 1, height: 20, background: '#2a2a2a', margin: '0 4px' }} />
        <button onClick={() => setUrl(window.location.origin + '/home')} style={{ padding: '8px 12px', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#fff' }}>微官网</button>
        <button onClick={() => setUrl(window.location.origin + '/package-center')} style={{ padding: '8px 12px', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#fff' }}>套系中心</button>
      </div>

      {/* 设备预览区（纯黑底 + 居中 + iPhone 框架） */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, background: '#000' }}>
        {/* iPhone 框架 */}
        <div style={{ position: 'relative', width: d.frameW, height: d.frameH, background: '#0e0e0e', borderRadius: d.radius, boxShadow: '0 25px 60px rgba(0,0,0,0.25)', padding: pad, boxSizing: 'border-box' }}>
          {/* notch / 灵动岛（iPhoneSE 无） */}
          {d.notchW > 0 && (
            <div style={{ position: 'absolute', top: pad + 4, left: '50%', transform: 'translateX(-50%)', width: d.notchW, height: d.notchH, background: '#000', borderRadius: 14, zIndex: 10 }} />
          )}
          {/* 屏幕 iframe（真实手机比例） */}
          <iframe
            key={refreshKey}
            src={url}
            title="mini-program-preview"
            onLoad={() => setError(false)}
            onError={() => setError(true)}
            style={{ display: 'block', width: iframeW, height: iframeH, margin: '0 auto', background: '#fff', border: 'none', borderRadius: d.radius - 10, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)' }}
          />
          {/* home indicator（iPhone 13 底部白条） */}
          {d.homeW > 0 && (
            <div style={{ position: 'absolute', bottom: pad - 2, left: '50%', transform: 'translateX(-50%)', width: d.homeW, height: 5, background: '#fff', borderRadius: 3, opacity: 0.85, pointerEvents: 'none' }} />
          )}
        </div>
      </div>

      {/* 说明 + 错误 */}
      <div style={{ padding: '12px 24px 24px', textAlign: 'center', fontSize: 12, color: '#999' }}>
        {error ? '⚠️ iframe 加载失败，请检查链接是否可访问 / 是否被 X-Frame-Options 限制' : '按真实手机屏幕比例（' + device + '）展示 iframe 内容；右侧工具栏可切换设备型号 / 刷新 / 跳到常用页面'}
      </div>
    </div>
  );
}
