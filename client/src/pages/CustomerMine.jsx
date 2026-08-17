import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { customerHttp } from '../utils/customerAuth.js';
import http, { img } from '../api.js';

// ===== C 端【我的】页面（/customer/mine）=====
// 登录弹窗完成（非开放注册：phone/phone_two 命中预约或订单才允许）。双手机号匹配预约+订单。
// 菜单：我的预约 / 我的订单 / 我的评价 / 拍摄提醒 / 联系我们 / 关于；不含「商家管理后台」（仅 admin 后台可见）。
// 禁加粗，灰度/字号/间距分层，卡片圆角 + 柔和阴影，移动端优先。
const TEXT = '#1D1D1F';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';
const LINE = '#F0F0F2';
const BRAND = '#7ECDBB';

const softCard = { background: '#fff', borderRadius: 16, boxShadow: '0 8px 24px rgba(31,35,41,0.06)' };

const MENU = [
  { key: 'reservations', label: '我的预约', tag: 'reservations' },
  { key: 'orders', label: '我的订单', tag: 'orders' },
  { key: 'evaluates', label: '我的评价', tag: 'evaluates' },
  { key: 'remind', label: '拍摄提醒', tag: 'remind' },
  { key: 'contact', label: '联系我们', tag: 'contact' },
  { key: 'about', label: '关于', tag: 'about' }
];
// ⚠️ 注意：不包含「商家管理后台」——C 端客户完全隐藏，仅 admin 后台可见。

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

const fmtTime = (t) => {
  if (!t) return '';
  const d = new Date(t);
  if (isNaN(d.getTime())) return t;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function CustomerMine() {
  const nav = useNavigate();
  const [studio, setStudio] = useState({ name: '', logo: '', contact: {} });
  const [auth, setAuth] = useState(null);        // null=校验中 / {isLogin:false} / {isLogin:true,phone}
  const [biz, setBiz] = useState({ reservations: [], orders: [] });
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

  const submitLogin = async (e) => {
    if (e && e.preventDefault) e.preventDefault(); // 防表单默认提交刷新页面
    const p = phone.trim();
    setLoginErr('');
    if (!p) { setLoginErr('请输入手机号'); return; }
    if (!/^1\d{10}$/.test(p)) { setLoginErr('请输入正确的 11 位手机号'); return; }
    setBusy(true);
    try {
      const r = await customerHttp.post('/api/customer/login', { phone: p }, { timeout: 15000 });
      if (r.data && r.data.ok) {
        setLoginOpen(false);
        setPhone('');
        flashToast('登录成功');
        loadAuth();
        return;
      }
      setLoginErr('登录失败，请稍后重试');
    } catch (ex) {
      // 分类提示：后端业务错误（403 无记录 / 400 格式 / 429 限流）/ 网络 / 超时 / 兜底
      const status = ex && ex.response && ex.response.status;
      const data = ex && ex.response && ex.response.data;
      if (data && data.error) setLoginErr(String(data.error));
      else if (!ex || !ex.response) setLoginErr(ex && ex.code === 'ECONNABORTED' ? '请求超时，请检查网络后重试' : '网络连接失败，请检查网络后重试');
      else if (status === 429) setLoginErr('访问过于频繁，请稍后再试');
      else setLoginErr('登录失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    try { await customerHttp.post('/api/customer/logout'); } catch (e) {}
    setAuth({ isLogin: false });
    setBiz({ reservations: [], orders: [] });
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

        <div style={{ textAlign: 'center', fontSize: 12, color: FAINT, marginTop: 14 }}>仅展示本人预约与订单 · 全部只读</div>
      </div>

      {/* 登录弹窗：仅手机号输入 + 确认提交，无验证码无密码（form 提交：点击/回车一致，preventDefault 防刷新） */}
      {loginOpen && (
        <div onClick={() => setLoginOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...softCard, padding: 24, width: '100%', maxWidth: 340 }}>
            <div style={{ fontSize: 18, color: TEXT, marginBottom: 4 }}>手机号登录</div>
            <div style={{ fontSize: 12, color: FAINT, marginBottom: 18 }}>仅限已有预约或订单的客户登录</div>
            <form onSubmit={submitLogin} noValidate>
              <input type="tel" inputMode="numeric" maxLength={11} autoFocus value={phone} disabled={busy}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                placeholder="请输入 11 位手机号"
                style={{ width: '100%', boxSizing: 'border-box', padding: '13px 14px', borderRadius: 12, border: '1px solid #E8E8EA', background: '#fff', fontSize: 15, color: TEXT, outline: 'none', opacity: busy ? 0.6 : 1 }} />
              {loginErr && (
                <div role="alert" style={{ fontSize: 13, color: '#E5484D', marginTop: 12, background: 'rgba(229,72,77,0.06)', border: '1px solid rgba(229,72,77,0.18)', borderRadius: 10, padding: '10px 12px', lineHeight: 1.5 }}>{loginErr}</div>
              )}
              <button type="submit" disabled={busy} aria-busy={busy}
                style={{ width: '100%', marginTop: 16, padding: '13px 0', borderRadius: 12, border: 'none', background: BRAND, color: '#fff', fontSize: 15, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, boxShadow: '0 8px 20px rgba(126,205,187,0.32)' }}>
                {busy ? '登录中…' : '确认提交'}
              </button>
            </form>
            <button onClick={() => setLoginOpen(false)} style={{ width: '100%', marginTop: 10, padding: '11px 0', borderRadius: 12, border: 'none', background: 'none', color: SUB, fontSize: 14, cursor: 'pointer' }}>取消</button>
          </div>
        </div>
      )}

      {/* 我的预约：预约卡片（已转订单可跳订单详情，已拒绝置灰） */}
      {sheet === 'reservations' && (
        <Sheet title="我的预约" onClose={() => setSheet('')}>
          {biz.reservations.length === 0 ? (
            <div style={{ textAlign: 'center', color: FAINT, padding: '30px 0', fontSize: 14 }}>暂无预约</div>
          ) : biz.reservations.map((r) => {
            const rejected = r.status === 'rejected';
            const converted = r.status === 'converted';
            return (
              <div key={r.id} style={{ padding: '14px 0', borderBottom: '1px solid ' + LINE, opacity: rejected ? 0.45 : 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 14, color: TEXT }}>{(r.groom_name || r.bride_name) ? `${r.groom_name}${r.bride_name ? ' & ' + r.bride_name : ''}` : '客户'}</span>
                  <span style={{ fontSize: 12, padding: '3px 8px', borderRadius: 8, background: rejected ? 'rgba(0,0,0,0.06)' : 'rgba(126,205,187,0.15)', color: rejected ? '#8E8E93' : '#3E9C8B' }}>{r.status_label}</span>
                </div>
                <div style={{ fontSize: 12, color: FAINT, marginTop: 6 }}>提交时间 {fmtTime(r.create_time)}</div>
                <div style={{ fontSize: 12, color: SUB, marginTop: 4 }}>主手机号 {r.phone}{r.phone_two ? ' · 副 ' + r.phone_two : ''}</div>
                <div style={{ fontSize: 12, color: SUB, marginTop: 4 }}>套系 {r.package_name || '暂未确定套系'}</div>
                <div style={{ fontSize: 12, color: SUB, marginTop: 4 }}>意向日期 {r.expect_date || '待定'}{r.expect_time ? ' ' + r.expect_time : ''}{r.shoot_location ? ' · ' + r.shoot_location : ''}</div>
                {converted && r.order_token && (
                  <button onClick={() => nav('/customer/order?accessToken=' + encodeURIComponent(r.order_token))}
                    style={{ marginTop: 10, padding: '7px 16px', borderRadius: 14, border: '1px solid ' + BRAND, background: '#fff', color: BRAND, fontSize: 12, cursor: 'pointer' }}>
                    查看对应订单 ›
                  </button>
                )}
              </div>
            );
          })}
        </Sheet>
      )}

      {/* 我的订单：订单卡片（点击进详情） */}
      {sheet === 'orders' && (
        <Sheet title="我的订单" onClose={() => setSheet('')}>
          {biz.orders.length === 0 ? (
            <div style={{ textAlign: 'center', color: FAINT, padding: '30px 0', fontSize: 14 }}>暂无订单</div>
          ) : biz.orders.map((o) => (
            <div key={o.id} onClick={() => { setSheet(''); nav('/customer/order?accessToken=' + encodeURIComponent(o.customer_token || '')); }} style={{ padding: '14px 0', borderBottom: '1px solid ' + LINE, cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 14, color: TEXT }}>{o.package_name || ('订单 ' + o.order_no)}</span>
                <span style={{ fontSize: 12, padding: '3px 8px', borderRadius: 8, background: 'rgba(126,205,187,0.15)', color: '#3E9C8B' }}>{o.status_label}</span>
              </div>
              <div style={{ fontSize: 12, color: FAINT, marginTop: 6 }}>拍摄日期 {o.expect_date}</div>
              <div style={{ fontSize: 12, color: FAINT, marginTop: 4, textAlign: 'right' }}>查看详情 ›</div>
            </div>
          ))}
        </Sheet>
      )}

      {sheet === 'evaluates' && (
        <Sheet title="我的评价" onClose={() => setSheet('')}>
          <div style={{ textAlign: 'center', color: FAINT, padding: '30px 0', fontSize: 14 }}>暂无评价</div>
        </Sheet>
      )}

      {sheet === 'remind' && (
        <Sheet title="拍摄提醒" onClose={() => setSheet('')}>
          <div style={{ textAlign: 'center', color: FAINT, padding: '30px 0', fontSize: 14 }}>拍摄提醒即将上线，敬请期待</div>
        </Sheet>
      )}

      {sheet === 'about' && (
        <Sheet title="关于" onClose={() => setSheet('')}>
          <div style={{ fontSize: 13, color: SUB, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{studio.intro || '用影像记录时光。'}</div>
        </Sheet>
      )}

      {toast && <div style={{ position: 'fixed', left: '50%', top: 70, transform: 'translateX(-50%)', zIndex: 120, background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 12, padding: '8px 14px', borderRadius: 8 }}>{toast}</div>}
    </div>
  );
}
