import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { customerHttp, maskPhone } from '../utils/customerAuth.js';

// ===== C 端客户个人中心（/customer/profile）=====
// 仅登录可访问：脱敏手机号 + 我的订单 / 我的拍摄档期（只读）+ 退出登录
// Glassmorphism + Soft-UI，禁加粗，靠灰度/字号/间距分层
const TEXT = '#1D1D1F';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';
const LINE = '#F0F0F2';
const BRAND = '#7ECDBB';

const glass = { background: 'rgba(255,255,255,0.66)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' };
const softCard = { background: '#fff', borderRadius: 16, boxShadow: '0 8px 24px rgba(31,35,41,0.06)' };

const SCHEDULE_STATUS = { free: '空闲', booked: '已预约', locked: '已锁定', done: '已完成' };

function Field({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '12px 0', borderBottom: '1px solid ' + LINE }}>
      <span style={{ fontSize: 13, color: SUB, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 14, color: value ? TEXT : FAINT, textAlign: 'right', maxWidth: '62%', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{value || '—'}</span>
    </div>
  );
}

export default function CustomerProfile() {
  const nav = useNavigate();
  const [me, setMe] = useState(null);        // null=校验中
  const [tab, setTab] = useState('orders');   // orders | schedules
  const [orders, setOrders] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [toast, setToast] = useState('');

  const flashToast = (m) => { setToast(m); setTimeout(() => setToast(''), 1600); };

  useEffect(() => {
    customerHttp.get('/api/customer-auth/me')
      .then((r) => {
        if (!(r.data && r.data.logged_in)) { nav('/customer/login', { replace: true }); return; }
        setMe(r.data);
        loadData();
      })
      .catch(() => nav('/customer/login', { replace: true }));
  }, []);

  const loadData = () => {
    setLoading(true);
    Promise.all([
      customerHttp.get('/api/customer-auth/orders'),
      customerHttp.get('/api/customer-auth/schedules')
    ]).then(([o, s]) => {
      setOrders(o.data || []);
      setSchedules(s.data || []);
    }).catch(() => {}).finally(() => setLoading(false));
  };

  const openOrder = async (id) => {
    try {
      const r = await customerHttp.get('/api/customer-auth/orders/' + id);
      setDetail({ type: 'order', data: r.data });
    } catch (e) {
      flashToast((e.response && e.response.data && e.response.data.error) || '加载失败');
    }
  };

  const openSchedule = (s) => setDetail({ type: 'schedule', data: s });

  const logout = async () => {
    try { await customerHttp.post('/api/customer-auth/logout'); } catch (e) {}
    nav('/home', { replace: true });
  };

  if (!me) {
    return <div style={{ minHeight: '100vh', background: '#F2F2F5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: FAINT, fontSize: 14 }}>加载中…</div>;
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F2F2F5', color: TEXT, paddingBottom: 40 }}>
      {/* 玻璃顶栏 */}
      <div style={{ ...glass, position: 'sticky', top: 0, zIndex: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
        <button onClick={() => nav(-1)} style={{ background: 'none', border: 'none', fontSize: 16, color: TEXT, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ fontSize: 20, lineHeight: 1 }}>‹</span>个人中心
        </button>
        <button onClick={logout} style={{ background: 'none', border: 'none', fontSize: 13, color: SUB, cursor: 'pointer' }}>退出登录</button>
      </div>

      {/* 头部：脱敏手机号 */}
      <div style={{ padding: '24px 18px 12px' }}>
        <div style={{ ...softCard, padding: 20 }}>
          <div style={{ fontSize: 13, color: SUB }}>已登录手机号</div>
          <div style={{ fontSize: 22, color: TEXT, marginTop: 6, letterSpacing: 1 }}>{me.phone}</div>
        </div>
      </div>

      {/* Tab 切换 */}
      <div style={{ display: 'flex', gap: 12, padding: '12px 18px' }}>
        {[['orders', '我的订单', orders.length], ['schedules', '我的档期', schedules.length]].map(([key, label, count]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: 'none', background: tab === key ? BRAND : '#fff', color: tab === key ? '#fff' : SUB, fontSize: 14, cursor: 'pointer', boxShadow: '0 4px 12px rgba(31,35,41,0.05)' }}>
            {label} {count > 0 ? '(' + count + ')' : ''}
          </button>
        ))}
      </div>

      {/* 列表 */}
      <div style={{ padding: '0 18px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: FAINT, fontSize: 13, padding: 40 }}>加载中…</div>
        ) : tab === 'orders' ? (
          orders.length === 0 ? (
            <div style={{ ...softCard, padding: 40, textAlign: 'center', color: FAINT, fontSize: 14 }}>暂无订单</div>
          ) : (
            orders.map((o) => (
              <div key={o.id} onClick={() => openOrder(o.id)} style={{ ...softCard, padding: 16, marginBottom: 12, cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 15, color: TEXT }}>{o.package_name || ('订单 ' + (o.order_no || o.id))}</span>
                  <span style={{ fontSize: 12, padding: '4px 10px', borderRadius: 10, background: 'rgba(126,205,187,0.15)', color: '#3E9C8B' }}>{o.status_label}</span>
                </div>
                <div style={{ fontSize: 12, color: FAINT, marginTop: 8 }}>拍摄日期 {o.shoot_date}</div>
                <div style={{ fontSize: 12, color: FAINT, marginTop: 8, textAlign: 'right' }}>查看详情 ›</div>
              </div>
            ))
          )
        ) : (
          schedules.length === 0 ? (
            <div style={{ ...softCard, padding: 40, textAlign: 'center', color: FAINT, fontSize: 14 }}>暂无拍摄档期</div>
          ) : (
            schedules.map((s) => (
              <div key={s.id} onClick={() => openSchedule(s)} style={{ ...softCard, padding: 16, marginBottom: 12, cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 15, color: TEXT }}>{s.date || '日期待定'}</span>
                  <span style={{ fontSize: 12, padding: '4px 10px', borderRadius: 10, background: 'rgba(126,205,187,0.15)', color: '#3E9C8B' }}>{SCHEDULE_STATUS[s.status] || s.status || '已预约'}</span>
                </div>
                {s.groom_name || s.bride_name ? (
                  <div style={{ fontSize: 12, color: SUB, marginTop: 8 }}>{[s.groom_name, s.bride_name].filter(Boolean).join(' · ')}</div>
                ) : null}
                {s.address && <div style={{ fontSize: 12, color: FAINT, marginTop: 4 }}>{s.address}</div>}
              </div>
            ))
          )
        )}
      </div>

      {/* 详情弹窗 */}
      {detail && (
        <div onClick={() => setDetail(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...softCard, padding: 20, width: '100%', maxWidth: 360, maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ fontSize: 16, color: TEXT, marginBottom: 12 }}>{detail.type === 'order' ? '订单详情' : '档期详情'}</div>
            {detail.type === 'order' ? (
              <>
                <Field label="拍摄日期" value={detail.data.shoot_date} />
                <Field label="套系名称" value={detail.data.package_name} />
                <Field label="拍摄进度" value={detail.data.status_label} />
                <Field label="预约备注" value={detail.data.remark} />
              </>
            ) : (
              <>
                <Field label="拍摄日期" value={detail.data.date || '日期待定'} />
                <Field label="档期类型" value={detail.data.period === 'half' ? '半天' : '全天'} />
                <Field label="状态" value={SCHEDULE_STATUS[detail.data.status] || detail.data.status || '已预约'} />
                <Field label="新人" value={[detail.data.groom_name, detail.data.bride_name].filter(Boolean).join(' · ')} />
                <Field label="拍摄地址" value={detail.data.address} />
                {detail.data.note && <Field label="备注" value={detail.data.note} />}
              </>
            )}
            <button onClick={() => setDetail(null)} style={{ width: '100%', marginTop: 14, padding: '12px 0', borderRadius: 12, border: 'none', background: '#E8E8EA', color: SUB, fontSize: 14, cursor: 'pointer' }}>关闭</button>
          </div>
        </div>
      )}

      {toast && <div style={{ position: 'fixed', left: '50%', top: 70, transform: 'translateX(-50%)', zIndex: 120, background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 12, padding: '8px 14px', borderRadius: 8 }}>{toast}</div>}
    </div>
  );
}
