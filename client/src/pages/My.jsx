import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import http from '../api.js';

const TEAL = '#7ecdbb';
const TEAL_DARK = '#5bbca8';
const CARD = '#faf8f3';
const PAGE_BG = '#f3f1ec';

export default function My() {
  const nav = useNavigate();
  const [studio, setStudio] = useState({ name: '', contact: {} });
  const [nickname, setNickname] = useState('');
  const [showProfile, setShowProfile] = useState(false);
  const [wechat, setWechat] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => {
    http.get('/api/settings/studio').then((r) => setStudio(r.data || {})).catch(() => {});
    try {
      setNickname(localStorage.getItem('nickname') || '');
      setWechat(localStorage.getItem('wxid') || '');
    } catch (e) {}
  }, []);

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2200); };

  // 网页端无客户会话：引导至小程序查看对应功能
  const guide = (label) => flash('请在微信小程序「叶哲 STUDIO」中查看' + label);

  const copyWechat = () => {
    const wxid = studio.contact?.wechat || 'yezhe-studio';
    if (navigator.clipboard) navigator.clipboard.writeText(wxid).then(() => flash('已复制微信号：' + wxid)).catch(() => {});
    else flash('微信号：' + wxid);
  };

  const saveProfile = () => {
    try {
      localStorage.setItem('nickname', nickname);
      localStorage.setItem('wxid', wechat);
    } catch (e) {}
    setShowProfile(false);
    flash('已保存');
  };

  const items = [
    { label: '我的预约', action: () => guide('我的预约') },
    { label: '我的相册', action: () => guide('我的相册') },
    { label: '消息通知', action: () => guide('消息通知') },
    { label: '个人资料修改', action: () => setShowProfile(true) }
  ];
  const secondary = [
    { label: '联系摄影师（复制微信号）', value: studio.contact?.wechat || 'yezhe-studio', action: copyWechat },
    { label: '商家管理后台', action: () => flash('管理端请在浏览器打开后台地址') },
    { label: '关于' + (studio.name || '叶哲 STUDIO'), action: () => guide('关于我们') }
  ];

  return (
    <div className="min-h-screen" style={{ background: PAGE_BG }}>
      {/* 返回首页 */}
      <div className="flex items-center px-4 h-14">
        <button onClick={() => nav('/')} className="text-sm" style={{ color: '#2c2c2c' }}>‹ 首页</button>
      </div>

      {/* 个人资料头 */}
      <div className="mx-3 rounded-3xl flex items-center px-9 py-10 text-white" style={{ background: '#111' }}>
        <div className="w-[110px] h-[110px] rounded-full bg-white text-[#111] flex items-center justify-center text-4xl font-bold">
          {(nickname || '叶')[0]}
        </div>
        <div className="ml-7">
          <div className="text-xl font-semibold tracking-[2px]">{nickname || '叶哲 STUDIO 用户'}</div>
          <div className="mt-1 text-sm opacity-60">网页访客</div>
        </div>
      </div>

      {/* 主菜单 */}
      <div className="mx-3 mt-6 rounded-3xl overflow-hidden" style={{ background: CARD, boxShadow: '0 4px 18px rgba(0,0,0,0.04)' }}>
        {items.map((it, i) => (
          <div key={it.label}
            onClick={it.action}
            className={'flex items-center justify-between px-7 py-4 text-base cursor-pointer ' + (i ? 'border-t' : '')}
            style={{ color: '#2c2c2c', borderColor: '#efece4' }}>
            <span>{it.label}</span><span style={{ color: '#bbb' }}>›</span>
          </div>
        ))}
      </div>

      {/* 次要菜单 */}
      <div className="mx-3 mt-6 rounded-3xl overflow-hidden" style={{ background: CARD, boxShadow: '0 4px 18px rgba(0,0,0,0.04)' }}>
        {secondary.map((it, i) => (
          <div key={it.label}
            onClick={it.action}
            className={'flex items-center justify-between px-7 py-4 text-base cursor-pointer ' + (i ? 'border-t' : '')}
            style={{ color: '#2c2c2c', borderColor: '#efece4' }}>
            <span>{it.label}</span>
            <span style={{ color: '#bbb' }}>{(it.value ? it.value + ' ' : '') + '›'}</span>
          </div>
        ))}
      </div>

      {/* 右侧悬浮按钮组 */}
      <div className="fixed right-5 top-1/2 -translate-y-1/2 z-50 flex flex-col gap-4">
        <button onClick={copyWechat}
          className="w-14 h-14 rounded-full flex flex-col items-center justify-center shadow-lg" style={{ background: '#fff', color: '#2c2c2c' }}>
          <span className="text-base leading-none mb-0.5">♡</span><span className="text-[10px] font-medium leading-none">关注</span>
        </button>
        <button onClick={() => flash('请在微信小程序中预约')}
          className="w-14 h-14 rounded-full flex flex-col items-center justify-center shadow-lg" style={{ background: TEAL, color: '#fff' }}>
          <span className="text-base leading-none mb-0.5">✉</span><span className="text-[10px] font-medium leading-none">预约</span>
        </button>
        <button onClick={() => nav('/my')}
          className="w-14 h-14 rounded-full flex flex-col items-center justify-center shadow-lg" style={{ background: '#fff', color: '#2c2c2c' }}>
          <span className="text-base leading-none mb-0.5">☺</span><span className="text-[10px] font-medium leading-none">我的</span>
        </button>
      </div>

      {/* 个人资料修改弹窗 */}
      {showProfile && (
        <div className="fixed inset-0 z-[100] flex items-end bg-black/45" onClick={() => setShowProfile(false)}>
          <div className="w-full bg-white rounded-t-3xl p-10" onClick={(e) => e.stopPropagation()}>
            <div className="text-center text-lg font-semibold mb-8" style={{ color: '#2c2c2c' }}>个人资料修改</div>
            <div className="text-sm mb-2" style={{ color: '#888' }}>昵称</div>
            <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="请输入昵称"
              className="w-full h-[52px] px-4 rounded-xl bg-[#f5f5f3] text-base mb-4 outline-none" style={{ color: '#2c2c2c' }} />
            <div className="text-sm mb-2" style={{ color: '#888' }}>微信号</div>
            <input value={wechat} onChange={(e) => setWechat(e.target.value)} placeholder="用于摄影师联系您"
              className="w-full h-[52px] px-4 rounded-xl bg-[#f5f5f3] text-base mb-6 outline-none" style={{ color: '#2c2c2c' }} />
            <button onClick={saveProfile} className="w-full h-11 rounded-lg text-white text-base" style={{ background: TEAL }}>保存</button>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[110] bg-black/80 text-white text-sm px-5 py-3 rounded-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
