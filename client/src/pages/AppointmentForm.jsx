import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import http from '../api.js';
import { customerHttp } from '../utils/customerAuth.js';
import { HOURS, PERIOD_OPTIONS } from '../constants/timeSlots.js';

// ===== C 端预约提交页（/customer/book）=====
// 表单：新郎/新娘姓名 + 主/第二联系手机号 + 意向套系下拉 + 意向拍摄日期 + 拍摄地点 + 备注
// 加载：GET /api/packages/public（B 端公开套系接口，仅启用套系）+ GET /api/customer/me（登录态回填主手机号）
// 提交：POST /api/customer/reservation-submit（游客可提交，主手机号+意向日期必填）
// 禁加粗，灰度/字号/间距分层，卡片圆角 + 柔和阴影，移动端优先。
const TEXT = '#1D1D1F';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';
const BRAND = '#7ECDBB';

const inputStyle = { width: '100%', padding: '13px 16px', borderRadius: 14, border: '1px solid #E4E4E7', background: '#fff', fontSize: 15, color: TEXT, boxSizing: 'border-box', outline: 'none' };
const labelStyle = { fontSize: 13, color: SUB, marginBottom: 8, display: 'block' };

export default function AppointmentForm() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const preselectPackageId = params.get('packageId') || '';
  const [packages, setPackages] = useState([]);
  const [form, setForm] = useState({ groom_name: '', bride_name: '', phone: '', phone_two: '', package_id: '', expect_date: '', expect_time: '', shoot_location: '', remark: '' });
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  // 套系列表 + 登录态回填 + ?packageId 预选
  useEffect(() => {
    http.get('/api/packages/public')
      .then((r) => {
        const list = r.data || [];
        setPackages(list);
        if (preselectPackageId) {
          const hit = list.find((p) => String(p.id) === String(preselectPackageId));
          if (hit) setForm((f) => ({ ...f, package_id: String(hit.id) }));
        }
      })
      .catch(() => {});
    customerHttp.get('/api/customer/me')
      .then((r) => {
        if (r.data && r.data.isLogin && r.data.rawPhone) {
          setForm((f) => ({ ...f, phone: r.data.rawPhone }));
        }
      })
      .catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return; // 防连点/双击重复提交（state 未及时生效前也挡住）
    if (!form.phone.trim()) { setErr('请填写主联系手机号'); return; }
    if (!/^1\d{10}$/.test(form.phone.trim())) { setErr('请输入正确的 11 位手机号'); return; }
    if (form.phone_two.trim() && !/^1\d{10}$/.test(form.phone_two.trim())) { setErr('第二联系手机号格式不正确'); return; }
    if (!form.expect_date) { setErr('请选择意向拍摄日期'); return; }
    setBusy(true); setErr('');
    try {
      await customerHttp.post('/api/customer/reservation-submit', {
        groom_name: form.groom_name.trim(),
        bride_name: form.bride_name.trim(),
        phone: form.phone.trim(),
        phone_two: form.phone_two.trim(),
        package_id: form.package_id === '' ? null : parseInt(form.package_id, 10),
        expect_date: form.expect_date,
        expect_time: form.expect_time.trim(),
        shoot_location: form.shoot_location.trim(),
        remark: form.remark.trim()
      });
      setDone(true);
    } catch (e2) { setErr((e2.response && e2.response.data && e2.response.data.error) || '提交失败'); }
    finally { setBusy(false); }
  };

  if (done) {
    return (
      <div style={{ minHeight: '100vh', background: '#F5F5F7', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
        <div style={{ fontSize: 18, color: TEXT, marginBottom: 8 }}>提交完成，请等待摄影师确认</div>
        <div style={{ fontSize: 13, color: FAINT, marginBottom: 24 }}>我们会在确认后尽快与您联系。</div>
        <button onClick={() => nav('/home')} style={{ padding: '12px 32px', borderRadius: 14, background: BRAND, color: '#fff', fontSize: 14, border: 'none', cursor: 'pointer', marginBottom: 10 }}>返回首页</button>
        <button onClick={() => nav('/customer/mine')} style={{ padding: '12px 32px', borderRadius: 14, background: '#fff', color: SUB, fontSize: 14, border: '1px solid #E4E4E7', cursor: 'pointer' }}>去我的页面查看预约进度</button>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg,#F7FAF9 0%,#EEF4F1 100%)', padding: 24, display: 'flex', flexDirection: 'column' }}>
      {/* 顶部返回键 */}
      <button onClick={() => nav('/home')} style={{ background: 'none', border: 'none', fontSize: 16, color: TEXT, cursor: 'pointer', alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 2, padding: '0 0 16px' }}>
        <span style={{ fontSize: 20, lineHeight: 1 }}>‹</span>返回
      </button>
      <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: 420, background: 'rgba(255,255,255,0.72)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderRadius: 24, padding: '28px 22px', boxShadow: '0 20px 50px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.7)' }}>
          <div style={{ fontSize: 20, color: TEXT, marginBottom: 4 }}>预约拍摄</div>
          <div style={{ fontSize: 13, color: SUB, marginBottom: 20 }}>填写信息，摄影师将尽快与您确认</div>
          <form onSubmit={submit}>
            <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
              <div style={{ flex: 1 }}>
                <input style={inputStyle} value={form.groom_name} onChange={(e) => set('groom_name')(e.target.value)} placeholder="新郎姓名" />
              </div>
              <div style={{ flex: 1 }}>
                <input style={inputStyle} value={form.bride_name} onChange={(e) => set('bride_name')(e.target.value)} placeholder="新娘姓名" />
              </div>
            </div>

            <input style={{ ...inputStyle, marginBottom: 14 }} type="tel" inputMode="numeric" maxLength={11} value={form.phone} onChange={(e) => set('phone')(e.target.value.replace(/\D/g, ''))} placeholder="主联系手机号（必填）" />
            <input style={{ ...inputStyle, marginBottom: 14 }} type="tel" inputMode="numeric" maxLength={11} value={form.phone_two} onChange={(e) => set('phone_two')(e.target.value.replace(/\D/g, ''))} placeholder="第二联系手机号（选填）" />

            <div style={{ marginBottom: 14 }}>
              <span style={labelStyle}>意向套系</span>
              <select style={{ ...inputStyle, appearance: 'none' }} value={form.package_id} onChange={(e) => set('package_id')(e.target.value)}>
                <option value="">暂未确定套系</option>
                {packages.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}（¥{p.price}）</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 14 }}>
              <span style={labelStyle}>意向拍摄日期</span>
              <input style={{ ...inputStyle, minWidth: 0, maxWidth: '100%' }} type="date" value={form.expect_date} onChange={(e) => set('expect_date')(e.target.value)} />
            </div>

            <div style={{ marginBottom: 14 }}>
              <span style={labelStyle}>拍摄时间（选填）</span>
              <select style={{ ...inputStyle, appearance: 'none' }} value={form.expect_time} onChange={(e) => set('expect_time')(e.target.value)}>
                <option value="">暂未确定时间</option>
                {PERIOD_OPTIONS.map((p) => (
                  <option key={p.label} value={p.label}>{p.label}</option>
                ))}
                {HOURS.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 14 }}>
              <span style={labelStyle}>拍摄地点</span>
              <input style={inputStyle} value={form.shoot_location} onChange={(e) => set('shoot_location')(e.target.value)} placeholder="意向拍摄地点（选填）" />
            </div>

            <div style={{ marginBottom: 12 }}>
              <span style={labelStyle}>备注说明</span>
              <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={form.remark} onChange={(e) => set('remark')(e.target.value)} placeholder="其他需求（选填）" />
            </div>

            {err && <div style={{ color: '#FF5A5F', fontSize: 12, marginBottom: 10 }}>{err}</div>}
            <button type="submit" disabled={busy}
              style={{ width: '100%', padding: '14px 0', borderRadius: 14, background: BRAND, color: '#fff', fontSize: 15, border: 'none', cursor: 'pointer', opacity: busy ? 0.5 : 1, boxShadow: '0 8px 20px rgba(126,205,187,0.35)' }}>
              {busy ? '提交中…' : '提交预约'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
