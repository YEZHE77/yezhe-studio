import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const TEAL = 'var(--brand-green)';
const PAGE_BG = '#f9f8f6';

// H5 客户中心（我的）—— 与小程序 pages/my 菜单一致
// 注：Web 端无客户会话，我的预约/我的相册/消息通知引导至微信小程序查看。
export default function My() {
  const nav = useNavigate();
  const [toast, setToast] = useState('');

  const items = [
    { label: '我的预约', icon: '📅', tip: '请在微信小程序查看' },
    { label: '我的相册', icon: '🖼️', tip: '请在微信小程序查看' },
    { label: '消息通知', icon: '🔔', tip: '请在微信小程序查看' },
    { label: '个人资料修改', icon: '✏️', tip: '请在微信小程序修改' },
  ];

  const onTap = (tip) => setToast(tip);

  return (
    <div className="min-h-screen" style={{ background: PAGE_BG, color: '#2c2c2c' }}>
      {/* 档案头 */}
      <div className="flex items-center gap-4 bg-black px-6 py-12 text-white">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10 text-2xl">☺</div>
        <div>
          <div className="text-lg font-medium">我的</div>
          <div className="mt-1 text-xs text-white/50">叶哲 STUDIO 客户中心</div>
        </div>
      </div>

      {/* 主菜单 */}
      <div className="px-4 -mt-6">
        <div className="divide-y rounded-2xl bg-white">
          {items.map((m) => (
            <div key={m.label} onClick={() => onTap(m.tip)} className="flex cursor-pointer items-center gap-3 px-5 py-4">
              <span>{m.icon}</span>
              <span className="flex-1 text-sm">{m.label}</span>
              <span className="text-gray-300">›</span>
            </div>
          ))}
        </div>
      </div>

      {toast && <div className="fixed left-1/2 top-20 z-50 -translate-x-1/2 rounded bg-black/70 px-4 py-2 text-xs text-white">{toast}</div>}
    </div>
  );
}
