import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import http, { img, BASE } from '../api.js';

const TEAL = 'var(--brand-green)';
const PAGE_BG = '#f9f8f6';

// 客户请求实例：独立于商家 token（避开全局拦截器的 admin token 覆盖 + 401 跳转 /login）
const customerHttp = axios.create({ baseURL: BASE, timeout: 15000 });
customerHttp.interceptors.request.use((cfg) => {
  const t = localStorage.getItem('customer_token');
  if (t) cfg.headers.Authorization = 'Bearer ' + t;
  return cfg;
});

function maskPhone(p) {
  const s = String(p || '').trim();
  if (/^1\d{10}$/.test(s)) return s.slice(0, 3) + '****' + s.slice(7);
  return s;
}

const ORDER_STATUS = {
  deposit: '已付定金', waiting: '等待拍摄', shot: '拍摄中', selecting: '待选片',
  retouching: '精修中', deliver: '待交付', delivered: '已交付', completed: '已完成', cancelled: '已关闭'
};
const APPT_STATUS = {
  pending: '待确认', confirmed: '已确认', cancelled: '已取消', rejected: '已拒绝'
};

// H5 客户中心（我的）—— 对齐小程序 pages/my 参考图
// 登录态：未登录显示灰色头像 +「未登录」，手机号登录后显示脱敏手机号，可查自己的订单/档期
export default function My() {
  const nav = useNavigate();
  const [toast, setToast] = useState('');
  const [studio, setStudio] = useState({ name: '', logo: '', intro: '', contact: {} });
  const [customer, setCustomer] = useState(null);   // null=未登录 / 对象=已登录
  const [authChecked, setAuthChecked] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [sheet, setSheet] = useState('');            // '' | 'orders' | 'appointments'
  const [orders, setOrders] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [loadingList, setLoadingList] = useState(false);

  const flashToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 1600); };

  // 商家资料（品牌名 / 头像 / 简介 / 联系方式）
  useEffect(() => {
    let mounted = true;
    http.get('/api/settings/studio').then((r) => { if (mounted) setStudio(r.data || {}); }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  // 客户登录态校验：有 customer_token 则用 /me 验证，失败即清除
  useEffect(() => {
    let mounted = true;
    const t = localStorage.getItem('customer_token');
    if (!t) { if (mounted) setAuthChecked(true); return; }
    customerHttp.get('/api/customer/me')
      .then((r) => { if (mounted) setCustomer(r.data || null); })
      .catch(() => { localStorage.removeItem('customer_token'); if (mounted) setCustomer(null); })
      .finally(() => { if (mounted) setAuthChecked(true); });
    return () => { mounted = false; };
  }, []);

  const doLogin = async () => {
    const p = phone.trim();
    if (!/^1\d{10}$/.test(p)) { flashToast('请输入正确的 11 位手机号'); return; }
    setLoggingIn(true);
    try {
      const r = await http.post('/api/customer/phone-login', { phone: p });
      localStorage.setItem('customer_token', r.data.token);
      setCustomer(r.data);
      setPhone('');
      setLoginOpen(false);
      flashToast('登录成功');
    } catch (e) {
      flashToast(e.message || '登录失败');
    } finally {
      setLoggingIn(false);
    }
  };

  const doLogout = () => {
    localStorage.removeItem('customer_token');
    setCustomer(null);
    setSheet('');
    flashToast('已退出登录');
  };

  const openSheet = (kind) => {
    if (!customer) { setLoginOpen(true); return; }
    setSheet(kind);
    setLoadingList(true);
    const req = kind === 'orders'
      ? customerHttp.get('/api/customer/order/list')
      : customerHttp.get('/api/customer/appointment/list');
    req.then((r) => { kind === 'orders' ? setOrders(r.data || []) : setAppointments(r.data || []); })
      .catch((e) => flashToast(e.message || '加载失败'))
      .finally(() => setLoadingList(false));
  };

  const menuItems = [
    { label: '我的预约', action: () => openSheet('appointments') },
    { label: '我的订单', action: () => openSheet('orders') },
    { label: '我的评价', action: () => flashToast('请在微信小程序查看') },
    { label: '拍摄提醒订阅', action: () => flashToast('请在微信小程序订阅') }
  ];

  const wechatValue = (studio.contact && studio.contact.wechat) || '';
  const copyWechat = () => {
    if (!wechatValue) { flashToast('未配置微信号'); return; }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(wechatValue).then(() => flashToast('已复制微信号')).catch(() => flashToast('微信号：' + wechatValue));
    } else {
      flashToast('微信号：' + wechatValue);
    }
  };

  return (
    <div className="min-h-screen" style={{ background: PAGE_BG, color: '#2c2c2c' }}>
      {/* 顶部导航栏：深色，模拟小程序胶囊栏 */}
      <div className="flex items-center justify-between px-4 py-3 text-white" style={{ background: '#1f1f1f' }}>
        <button onClick={() => nav(-1)} className="flex items-center text-base" aria-label="返回">
          <span className="mr-1 text-lg">‹</span>我的
        </button>
        <div className="flex items-center gap-4 text-base">
          <button onClick={() => flashToast('更多')} aria-label="更多" className="leading-none">⋯</button>
          <button onClick={() => flashToast('操作')} aria-label="操作" className="leading-none">⊙</button>
        </div>
      </div>

      {/* 档案头：深色背景 + 头像（logo 优先，首字回退）+ 名称/登录态 */}
      <div className="flex items-center gap-4 px-6 pb-10 pt-4 text-white" style={{ background: '#1f1f1f' }}>
        {/* 头像：商家头像 logo 优先，无 logo 时显示 studio.name 首字（参考图风格统一，不再用 SVG 人形图标） */}
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.16)' }}>
          {studio.logo ? (
            <img src={img(studio.logo)} alt={studio.name || '商家头像'} className="h-full w-full object-cover" />
          ) : (
            <span className="text-xl">{(studio.name || '叶哲 Studio')[0]}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base">{customer ? (maskPhone(customer.phone) || '已登录') : (studio.name || '叶哲 Studio')}</div>
          <div className="mt-1 flex items-center gap-2 text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
            {!authChecked ? (
              <span>…</span>
            ) : customer ? (
              <>
                <span>已登录</span>
                <button onClick={doLogout} className="underline" style={{ color: 'rgba(255,255,255,0.6)' }}>退出</button>
              </>
            ) : (
              <button onClick={() => setLoginOpen(true)} className="flex items-center gap-1">
                <span>未登录</span>
                <span style={{ color: TEAL }}>点击登录 ›</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 主菜单卡片 */}
      <div className="px-4 -mt-6">
        <div className="overflow-hidden rounded-2xl bg-white">
          {menuItems.map((m) => (
            <div key={m.label} onClick={m.action} className="flex cursor-pointer items-center border-b border-gray-100 px-5 py-4 last:border-b-0">
              <span className="flex-1 text-sm">{m.label}</span>
              <span className="text-gray-300">›</span>
            </div>
          ))}
          {/* 联系摄影师（复制微信号） */}
          <div onClick={copyWechat} className="flex cursor-pointer items-center border-b border-gray-100 px-5 py-4 last:border-b-0">
            <span className="flex-1 text-sm">联系摄影师（复制微信号）</span>
            <span className="mr-2 text-sm" style={{ color: '#666' }}>{wechatValue}</span>
            <span className="text-gray-300">›</span>
          </div>
          {/* 商家管理后台 */}
          <div onClick={() => nav('/login')} className="flex cursor-pointer items-center border-b border-gray-100 px-5 py-4 last:border-b-0">
            <span className="flex-1 text-sm">商家管理后台</span>
            <span className="text-gray-300">›</span>
          </div>
        </div>
      </div>

      {/* 关于叶哲 Studio */}
      <div className="px-4 pb-10 pt-6">
        <div className="rounded-2xl bg-white p-5">
          <div className="mb-3 text-sm" style={{ color: TEAL }}>关于叶哲 Studio ›</div>
          <div className="whitespace-pre-line text-xs leading-relaxed" style={{ color: '#666' }}>{studio.intro || '叶哲 STUDIO — 用影像记录时光。'}</div>
        </div>
      </div>

      {/* 手机号登录弹窗 */}
      {loginOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setLoginOpen(false)}>
          <div className="w-[calc(100%-48px)] max-w-sm rounded-2xl bg-white p-6 text-[#2c2c2c]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 text-base">手机号登录</div>
            <div className="mb-4 text-xs text-gray-400">登录后可查看自己的订单与档期</div>
            <input
              type="tel" inputMode="numeric" maxLength={11} autoFocus
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter') doLogin(); }}
              placeholder="请输入 11 位手机号"
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-[var(--brand-green)]"
            />
            <button onClick={doLogin} disabled={loggingIn} className="mt-4 w-full rounded-lg py-2.5 text-sm text-white disabled:opacity-50" style={{ background: TEAL }}>
              {loggingIn ? '登录中…' : '登录'}
            </button>
            <button onClick={() => setLoginOpen(false)} className="mt-3 w-full rounded-lg py-2.5 text-sm text-gray-500">取消</button>
          </div>
        </div>
      )}

      {/* 订单 / 档期 底部抽屉 */}
      {sheet && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setSheet('')}>
          <div className="max-h-[70vh] w-full max-w-md overflow-auto rounded-t-2xl bg-white p-5 text-[#2c2c2c]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="text-base">{sheet === 'orders' ? '我的订单' : '我的档期'}</div>
              <button onClick={() => setSheet('')} className="text-gray-400">关闭</button>
            </div>
            {loadingList ? (
              <div className="py-10 text-center text-sm text-gray-400">加载中…</div>
            ) : sheet === 'orders' ? (
              orders.length === 0 ? (
                <div className="py-10 text-center text-sm text-gray-400">暂无订单</div>
              ) : (
                <div className="space-y-3 pb-4">
                  {orders.map((o) => (
                    <div key={o.id} className="rounded-xl border border-gray-100 p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-500">{o.order_no || '—'}</span>
                        <span className="rounded px-2 py-0.5 text-xs" style={{ background: '#f0faf6', color: TEAL }}>{ORDER_STATUS[o.status] || o.status || '进行中'}</span>
                      </div>
                      <div className="mt-2 text-sm">{o.customer_name || o.order_name || '—'}</div>
                      <div className="mt-1 text-xs text-gray-400">
                        {o.date_tbd ? '日期待定' : (o.shoot_date ? ('拍摄日期：' + o.shoot_date) : '')}
                        {o.packageName ? (' · ' + o.packageName) : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : (
              appointments.length === 0 ? (
                <div className="py-10 text-center text-sm text-gray-400">暂无档期预约</div>
              ) : (
                <div className="space-y-3 pb-4">
                  {appointments.map((a) => (
                    <div key={a.id} className="rounded-xl border border-gray-100 p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm">{a.package_name || '档期预约'}</span>
                        <span className="rounded px-2 py-0.5 text-xs" style={{ background: '#f0faf6', color: TEAL }}>{APPT_STATUS[a.status] || a.status || '待确认'}</span>
                      </div>
                      <div className="mt-1 text-xs text-gray-400">{a.hope_date ? ('期望日期：' + a.hope_date) : '日期待定'}</div>
                      {a.remark && <div className="mt-1 text-xs text-gray-400">备注：{a.remark}</div>}
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        </div>
      )}

      {toast && <div className="fixed left-1/2 top-20 z-[60] -translate-x-1/2 rounded bg-black/70 px-4 py-2 text-xs text-white">{toast}</div>}
    </div>
  );
}
