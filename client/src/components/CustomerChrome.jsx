import React from 'react';
import { useOnline, OFFLINE_MSG } from '../utils/netStatus.js';

// components/CustomerChrome.jsx —— C 端全局浮层（微信提示条 + 断网提示条）
//
// 1) 微信提示条（前置约束 / 清单 9.1 / 黑名单第 7 条）
//    微信内置浏览器打开任意 C 端页面时，顶部【常驻】一条轻提示，
//    引导用户复制链接到手机浏览器打开。此前该文案只存在于 B 端设置项的 placeholder，
//    C 端根本没有渲染，导致微信里直接打开就白屏/异常。
//
// 2) 断网提示条（清单 5.1）
//    断网时顶部悬浮提示，按钮由 index.css 的 body[data-offline] 统一置灰；恢复后自动解除。

export const WECHAT_TIP = '此链接为系统专属访问地址，受微信环境限制，请复制链接，在手机浏览器打开查看订单详情。';

export function isWechat() {
  try {
    return typeof navigator !== 'undefined' && /MicroMessenger/i.test(navigator.userAgent || '');
  } catch {
    return false;
  }
}

export default function CustomerChrome({ cEnd = false }) {
  const online = useOnline();
  const wechat = isWechat();

  return (
    <>
      {/* 微信环境顶部常驻提示（仅 C 端页面显示；不可关闭，始终可见） */}
      {cEnd && wechat && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99997,
            background: 'rgba(255,243,205,0.98)', color: '#7A5B00',
            fontSize: 12, lineHeight: 1.6, padding: '8px 14px',
            borderBottom: '1px solid rgba(122,91,0,0.15)',
            textAlign: 'center', fontFamily: 'inherit'
          }}
        >
          {WECHAT_TIP}
        </div>
      )}

      {/* 断网悬浮提示：顶部居中，恢复网络自动消失 */}
      {!online && (
        <div
          role="alert"
          style={{
            position: 'fixed', left: '50%', transform: 'translateX(-50%)',
            top: wechat ? 44 : 16, zIndex: 99996,
            background: 'rgba(229,72,77,0.96)', color: '#fff',
            fontSize: 13, padding: '8px 16px', borderRadius: 20,
            boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
            whiteSpace: 'nowrap', fontFamily: 'inherit'
          }}
        >
          {OFFLINE_MSG}
        </div>
      )}
    </>
  );
}
