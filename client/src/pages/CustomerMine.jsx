import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { customerHttp, maskPhone } from '../utils/customerAuth.js';
import http, { img } from '../api.js';

// ===== C 端【我的】页面（/customer/mine）=====
// 登录逻辑在本页弹窗完成，不跳转独立登录页。非开放注册：仅校验手机号下是否有订单记录。
// 未登录：灰色占位头像 +「未登录」，点击头像唤起登录弹窗；菜单置灰不可点。
// 已登录：头像 + 脱敏手机号 + 功能菜单；底部【退出登录】。菜单不含「商家管理后台」（C 端权限边界）。
// 禁加粗，靠灰度/字号/间距分层，卡片圆角 + 柔和阴影。
const TEXT = '#1D1D1F';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';
const LINE = '#F0F0F2';
const BRAND = '#7ECDBB';

const glass = { background: 'rgba(255,255,255,0.66)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' };
const softCard = { background: '#fff', borderRadius: 16, boxShadow: '0 8px 24px rgba(31,35,41,0.06)' };

const MENU = [
  { key: 'appointments', label: '我的预约', tag: 'appointments' },
  { key: 'orders', label: '我的订单', tag: 'orders' },
  { key: 'evaluates', label: '我的评价', tag: 'evaluates' },
  { key: 'schedules', label: '拍摄提醒订阅', tag: 'schedules' },
  { key: 'contact', label: '联系摄影师', tag: 'contact' },
  { key: 'about', label: '关于我们', tag: 'about' }
];
// ⚠️ 注意：不包含「商家管理后台」——C 端客户完全隐藏，仅 admin 后台可见。

const ORDER_STATUS = {
  deposit: '已付定金', waiting: '等待拍摄', shot: '拍摄中', selecting: '待选片',
  retouching: '精修中', deliver: '待交付', delivered: '已交付', completed: '已完成', cancelled: '已关闭'
};
const APPT_STATUS = { pending: '待确认', confirmed: '已确认', cancelled: '已取消', rejected: '已拒绝' };

function Sheet({ title, onClose, children }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...softCard, borderRadius: '20px 20px 0 0', padding: 20, width: '100%', maxWidth: 480, maxHeight: '70vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 16, color: TEXT }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: SUB, fontSize: 14, cursor: 'pointer' }}>关闭</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function CustomerMine() {
  const nav = useNavigate();
  const [studio, setStudio] = useState({ name: '', logo: '', contact: {} });
  const [auth, setAuth] = useState(null);        // null=校验中 / {isLogin:false} / {isLogin:true,phone}
  const [biz, setBiz] = useState({ orders: [], appointments: [], schedules: [] });
  const [loginOpen, setLoginOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [loginErr, setLoginErr] = useState('');
  const [sheet, setSheet] = useState('');
  const [toast, setToast] = useState('');
  const flashToast = (m) => { setToast(m); setTimeout(() => setToast(''), 1600); };

  // 商家资料
  useEffect(() => {
    http.get('/api/settings/studio').then((r) => setStudio(r.data || {})).catch(() => {});
  }, []);

  // 登录态 + 业务数据
  const loadAuth = () => {
    setAuth(null);
    customerHttp.get('/api/customer/me')
      .then((r) => {
        if (!(r.data && r.data.isLogin)) { setAuth({ isLogin: false }); return null; }
        setAuth(r.data);
        return customerHttp.get('/api/customer/my-business');
      })
      .then((b) => { if (b && b.data) setBiz(b.data || {}); })
      .catch(() => setAuth({ isLogin: false }));
  };
  useEffect(() => { loadAuth(); }, []);

  const submitLogin = async () => {
    setLoginErr('');
    if (!/^1\d{10}$/.test(phone.trim())) { setLoginErr('请输入正确的 11 位手机号'); return; }
    setBusy(true);
    try {
      const r = await customerHttp.post('/api/customer/login', { phone: phone.trim() });
      if (r.data && r.data.ok) {
        setLoginOpen(false);
        setPhone('');
        loadAuth(); // 刷新进入已登录状态
      }
    } catch (e) {
      setLoginErr((e.response && e.response.data && e.response.data.error) || '登录失败');
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    try { await customerHttp.post('/api/customer/logout'); } catch (e) {}
    setAuth({ isLogin: false });
    setBiz({ orders: [], appointments: [], schedules: [] });
    flashToast('已退出登录');
  };

  const copyWechat = () => {
    const w = (studio.contact && studio.contact.wechat) || '';
    if (!w) { flashToast('未配置微信号'); return; }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(w).then(() => flashToast('已复制微信号')).catch(() => flashToast('微信号：' + w));
    } else {
      flashToast('微信号：' + w);
    }
  };

  const onMenu = (tag) => {
    if (!auth || !auth.isLogin) return; // 未登录菜单置灰不可点
    if (tag === 'contact') { copyWechat(); return; }
    setSheet(tag);
  };

  if (auth === null) {
    return <div style={{ minHeight: '100vh', background: '#F2F2F5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: FAINT, fontSize: 14 }}>加载中…</div>;
  }

  const logged = auth.isLogin;

  return (
    <div style={{ minHeight: '100vh', background: '#F2F2F5', color: TEXT, paddingBottom: 40 }}>
      {/* 顶部深色导航栏（返回键白色） */}
      <div style={{ background: '#1f1f1f', position: 'sticky', top: 0, zIndex: 20, display: 'flex', alignItems: 'center', padding: '14px 18px' }}>
        <button onClick={() => nav('/home')} style={{ background: 'none', border: 'none', fontSize: 16, color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ fontSize: 20, lineHeight: 1 }}>‹</span>我的
        </button>
      </div>

      {/* 档案头：未登录点击唤起登录弹窗；已登录展示头像+脱敏手机号 */}
      <div style={{ padding: '20px 18px 12px' }}>
        <div onClick={() => { if (!logged) setLoginOpen(true); }} style={{ ...softCard, padding: 20, display: 'flex', alignItems: 'center', gap: 14, cursor: logged ? 'default' : 'pointer' }}>
          {logged ? (
            studio.logo ? (
              <div style={{ width: 64, height: 64, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: '#F2F2F5' }}>
                <img src={img(studio.logo)} alt={studio.name || '头像'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            ) : (
              <div style={{ width: 64, height: 64, borderRadius: '50%', flexShrink: 0, background: '#E1F5EE', color: '#3E9C8B', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>{(studio.name || '叶')[0]}</div>
            )
          ) : (
            <div style={{ width: 64, height: 64, borderRadius: '50%', flexShrink: 0, background: '#E5E5EA', color: '#8E8E93', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>未登录</div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, color: logged ? TEXT : SUB, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {logged ? (auth.phone || '已登录') : (studio.name || '')}
            </div>
            <div style={{ fontSize: 12, color: FAINT, marginTop: 4 }}>
              {logged ? '已登录' : '未登录 · 点击头像登录'}
            </div>
          </div>
        </div>
      </div>

      {/* 菜单（不含「商家管理后台」——C 端客户权限边界）；未登录整体置灰不可点 */}
      <div style={{ padding: '12px 18px' }}>
        <div style={{ ...softCard, overflow: 'hidden' }}>
          {MENU.map((m, i) => (
            <div key={m.key} onClick={() => onMenu(m.tag)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '16px 18px', cursor: logged ? 'pointer' : 'default',
                borderTop: i > 0 ? '1px solid ' + LINE : 'none',
                opacity: logged ? 1 : 0.4
              }}>
              <span style={{ fontSize: 15, color: logged ? TEXT : FAINT }}>{m.label}</span>
              <span style={{ color: FAINT, fontSize: 14 }}>›</span>
            </div>
          ))}
        </div>

        {/* 已登录：底部退出登录按钮 */}
        {logged && (
          <button onClick={logout} style={{ width: '100%', marginTop: 18, padding: '14px 0', borderRadius: 14, border: '1px solid #E8E8EA', background: '#fff', color: SUB, fontSize: 14, cursor: 'pointer', boxShadow: '0 4px 12px rgba(31,35,41,0.05)' }}>
            退出登录
          </button>
        )}

        <div style={{ textAlign: 'center', fontSize: 12, color: FAINT, marginTop: 14 }}>仅展示本人订单与档期 · 全部只读</div>
      </div>

      {/* 登录弹窗：仅手机号输入 + 确认提交，无验证码无密码 */}
      {loginOpen && (
        <div onClick={() => setLoginOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...softCard, padding: 24, width: '100%', maxWidth: 340 }}>
            <div style={{ fontSize: 18, color: TEXT, marginBottom: 4 }}>手机号登录</div>
            <div style={{ fontSize: 12, color: FAINT, marginBottom: 18 }}>仅限已有订单的客户登录</div>
            <input type="tel" inputMode="numeric" maxLength={11} autoFocus value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter') submitLogin(); }}
              placeholder="请输入 11 位手机号"
              style={{ width: '100%', boxSizing: 'border-box', padding: '13px 14px', borderRadius: 12, border: '1px solid #E8E8EA', background: '#fff', fontSize: 15, color: TEXT, outline: 'none' }} />
            {loginErr && <div style={{ fontSize: 13, color: '#E5484D', marginTop: 12 }}>{loginErr}</div>}
            <button onClick={submitLogin} disabled={busy}
              style={{ width: '100%', marginTop: 16, padding: '13px 0', borderRadius: 12, border: 'none', background: BRAND, color: '#fff', fontSize: 15, cursor: 'pointer', opacity: busy ? 0.6 : 1, boxShadow: '0 8px 20px rgba(126,205,187,0.32)' }}>
              {busy ? '校验中…' : '确认提交'}
            </button>
            <button onClick={() => setLoginOpen(false)} style={{ width: '100%', marginTop: 10, padding: '11px 0', borderRadius: 12, border: 'none', background: 'none', color: SUB, fontSize: 14, cursor: 'pointer' }}>取消</button>
          </div>
        </div>
      )}

      {/* 列表 sheet：订单 / 预约 / 档期 / 评价 / 关于 */}
      {sheet === 'orders' && (
        <Sheet title="我的订单" onClose={() => setSheet('')}>
          {biz.orders.length === 0 ? (
            <div style={{ textAlign: 'center', color: FAINT, padding: '30px 0', fontSize: 14 }}>暂无订单</div>
          ) : biz.orders.map((o) => (
            <div key={o.id} onClick={() => { setSheet(''); nav('/customer/order?accessToken=' + encodeURIComponent(o.customer_token || '')); }} style={{ padding: '12px 0', borderBottom: '1px solid ' + LINE, cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 14, color: TEXT }}>{o.package_name || ('订单 ' + o.order_no)}</span>
                <span style={{ fontSize: 12, padding: '3px 8px', borderRadius: 8, background: 'rgba(126,205,187,0.15)', color: '#3E9C8B' }}>{o.status_label}</span>
              </div>
              <div style={{ fontSize: 12, color: FAINT, marginTop: 6 }}>拍摄日期 {o.shoot_date}</div>
              <div style={{ fontSize: 12, color: FAINT, marginTop: 4, textAlign: 'right' }}>查看详情 ›</div>
            </div>
          ))}
        </Sheet>
      )}
      {sheet === 'appointments' && (
        <Sheet title="我的预约" onClose={() => setSheet('')}>
          {biz.appointments.length === 0 ? (
            <div style={{ textAlign: 'center', color: FAINT, padding: '30px 0', fontSize: 14 }}>暂无预约</div>
          ) : biz.appointments.map((a) => (
            <div key={a.id} style={{ padding: '12px 0', borderBottom: '1px solid ' + LINE }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 14, color: TEXT }}>{a.hope_date ? ('期望日期 ' + a.hope_date) : '日期待定'}</span>
                <span style={{ fontSize: 12, padding: '3px 8px', borderRadius: 8, background: 'rgba(126,205,187,0.15)', color: '#3E9C8B' }}>{APPT_STATUS[a.status] || a.status || '待确认'}</span>
              </div>
              {a.style_req && <div style={{ fontSize: 12, color: SUB, marginTop: 6 }}>风格：{a.style_req}</div>}
              {a.remark && <div style={{ fontSize: 12, color: FAINT, marginTop: 4 }}>备注：{a.remark}</div>}
            </div>
          ))}
        </Sheet>
      )}
      {sheet === 'schedules' && (
        <Sheet title="拍摄提醒订阅" onClose={() => setSheet('')}>
          {biz.schedules.length === 0 ? (
            <div style={{ textAlign: 'center', color: FAINT, padding: '30px 0', fontSize: 14 }}>暂无档期</div>
          ) : biz.schedules.map((s) => (
            <div key={s.id} style={{ padding: '12px 0', borderBottom: '1px solid ' + LINE }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 14, color: TEXT }}>{s.date || '日期待定'}</span>
                <span style={{ fontSize: 12, padding: '3px 8px', borderRadius: 8, background: 'rgba(126,205,187,0.15)', color: '#3E9C8B' }}>{s.status === 'booked' ? '已预约' : (s.status || '空闲')}</span>
              </div>
              {s.address && <div style={{ fontSize: 12, color: FAINT, marginTop: 6 }}>{s.address}</div>}
            </div>
          ))}
        </Sheet>
      )}
      {sheet === 'evaluates' && (
        <Sheet title="我的评价" onClose={() => setSheet('')}>
          <div style={{ textAlign: 'center', color: FAINT, padding: '30px 0', fontSize: 14 }}>暂无评价</div>
        </Sheet>
      )}
      {sheet === 'about' && (
        <Sheet title="关于我们" onClose={() => setSheet('')}>
          <div style={{ fontSize: 13, color: SUB, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{studio.intro || '用影像记录时光。'}</div>
        </Sheet>
      )}

      {toast && <div style={{ position: 'fixed', left: '50%', top: 70, transform: 'translateX(-50%)', zIndex: 120, background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 12, padding: '8px 14px', borderRadius: 8 }}>{toast}</div>}
    </div>
  );
}