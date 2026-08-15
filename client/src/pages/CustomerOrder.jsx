import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import http, { img } from '../api.js';

// ===== C 端客户订单查看页（/customer-order?token=customer_token）=====
// customer_token 鉴权，与 B 端订单详情同口径：套系详细内容 + 拍摄档期/时间/地点 + 执行人 + 消费明细 + 选片入口
// 完全只读，无任何编辑/删除/上传按钮
const TEXT = '#1D1D1F';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';
const LINE = '#F0F0F2';
const BRAND = '#7ECDBB';

function Card({ children, style }) {
  return <div style={{ background: '#fff', borderRadius: 16, padding: 16, boxShadow: '0 1px 6px rgba(0,0,0,0.04)', ...style }}>{children}</div>;
}
function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid ' + LINE }}>
      <span style={{ fontSize: 13, color: SUB }}>{label}</span>
      <span style={{ fontSize: 14, color: TEXT, textAlign: 'right', maxWidth: '60%' }}>{value || '—'}</span>
    </div>
  );
}
function InfoRow({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0' }}>
      <span style={{ fontSize: 13, color: SUB }}>{label}</span>
      <span style={{ fontSize: 14, color: color || TEXT, textAlign: 'right', maxWidth: '60%', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{value || '—'}</span>
    </div>
  );
}

function fmtTime(t) {
  if (!t) return '';
  const d = new Date(t);
  if (isNaN(d.getTime())) return t;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function CustomerOrder() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const token = params.get('token') || '';
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) { setErr('无权限访问'); setLoading(false); return; }
    http.get('/api/public/order/' + token)
      .then((r) => setData(r.data))
      .catch((e) => setErr((e.response && e.response.data && e.response.data.error) || '加载失败'))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div style={{ minHeight: '100vh', background: '#F5F5F7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: FAINT, fontSize: 14 }}>加载中…</div>;

  if (err || !data) {
    return (
      <div style={{ minHeight: '100vh', background: '#F5F5F7', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
        <div style={{ fontSize: 16, color: TEXT, marginBottom: 6 }}>{err || '无权限访问该订单'}</div>
        <div style={{ fontSize: 13, color: FAINT }}>该链接无效或已失效，请联系摄影师。</div>
      </div>
    );
  }

  const pkg = data.package || {};
  const exes = data.executors || [];
  const extra = data.extra_items || [];
  const timeSlots = data.time_slots || [];

  return (
    <div style={{ minHeight: '100vh', background: '#F5F5F7', padding: 16, paddingBottom: 40 }}>
      {/* 顶部：客户 + 订单号 + 状态 */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 17, color: TEXT }}>{data.customer_name || '客户'}</div>
            <div style={{ fontSize: 12, color: FAINT, marginTop: 4 }}>订单编号 {data.order_no}</div>
          </div>
          <span style={{ padding: '5px 12px', borderRadius: 12, background: 'rgba(126,205,187,0.15)', color: '#3E9C8B', fontSize: 13 }}>{data.status_label}</span>
        </div>
        <div style={{ fontSize: 12, color: FAINT, marginTop: 10 }}>下单时间 {fmtTime(data.create_time)}</div>
      </Card>

      {/* 套系详情 */}
      {pkg.name && (
        <Card style={{ marginTop: 12 }}>
          {pkg.cover && <img src={img(pkg.cover)} alt="" style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', borderRadius: 12, marginBottom: 12 }} />}
          <div style={{ fontSize: 17, color: TEXT }}>{pkg.name}</div>
          <div style={{ fontSize: 22, color: '#FF5A5F', marginTop: 6 }}>¥{Number(pkg.price || 0).toFixed(0)}</div>
          {pkg.desc && <div style={{ fontSize: 13, color: SUB, marginTop: 8, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{pkg.desc}</div>}
          <div style={{ marginTop: 12, borderTop: '1px solid ' + LINE, paddingTop: 12 }}>
            <InfoRow label="定金" value={'¥' + Number(pkg.deposit || 0).toFixed(0)} />
            {Number(pkg.additional_price) > 0 && <InfoRow label="加片单价" value={'¥' + Number(pkg.additional_price).toFixed(0) + '/张'} />}
            {pkg.shoot_duration && <InfoRow label="拍摄时长" value={pkg.shoot_duration} />}
            {pkg.shoot_scope && <InfoRow label="拍摄范围" value={pkg.shoot_scope} />}
            <InfoRow label="照片总数" value={pkg.photo_total ? pkg.photo_total + ' 张' : ''} />
            <InfoRow label="精修张数" value={pkg.retouch_count ? pkg.retouch_count + ' 张' : ''} />
            {pkg.original_file && <InfoRow label="原片文件" value={pkg.original_file} />}
          </div>
        </Card>
      )}

      {/* 服务详情 / 温馨提示 */}
      {(pkg.other_service || pkg.notice) && (
        <Card style={{ marginTop: 12 }}>
          {pkg.other_service && (
            <div style={{ marginBottom: pkg.notice ? 14 : 0 }}>
              <div style={{ fontSize: 13, color: SUB, marginBottom: 6 }}>其他服务</div>
              <div style={{ fontSize: 14, color: TEXT, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{pkg.other_service}</div>
            </div>
          )}
          {pkg.notice && (
            <div>
              <div style={{ fontSize: 13, color: SUB, marginBottom: 6 }}>温馨提示</div>
              <div style={{ fontSize: 14, color: TEXT, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{pkg.notice}</div>
            </div>
          )}
        </Card>
      )}

      {/* 拍摄信息 */}
      <Card style={{ marginTop: 12 }}>
        <Row label="拍摄日期" value={data.date_tbd ? '日期待定' : (data.shoot_date || '未排期')} />
        <Row label="拍摄时间" value={timeSlots.length ? timeSlots.join('、') : (data.date_tbd ? '待定' : '未填写')} />
        <Row label="拍摄地点" value={data.address || '未填写'} />
        {exes.length > 0 && (
          <Row label="执行人" value={exes.map((e) => e.name).join('、')} />
        )}
      </Card>

      {/* 消费明细 */}
      {extra.length > 0 && (
        <Card style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, color: SUB, marginBottom: 10 }}>消费明细</div>
          {extra.map((x, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: i > 0 ? '1px solid ' + LINE : 'none' }}>
              <div style={{ fontSize: 14, color: TEXT }}>
                <div>{x.label || x.name || x.type || '其他消费'}</div>
                {x.note && <div style={{ fontSize: 12, color: FAINT, marginTop: 2 }}>{x.note}</div>}
              </div>
              <div style={{ fontSize: 14, color: x.amount < 0 ? '#3E9C8B' : TEXT }}>¥{Number(x.amount || 0).toFixed(2)}</div>
            </div>
          ))}
        </Card>
      )}

      {/* 金额 */}
      <Card style={{ marginTop: 12 }}>
        <Row label="支付状态" value={data.payment_status_label} />
        <Row label="订单金额" value={'¥' + Number(data.total_amount || 0).toFixed(2)} color="#FF5A5F" />
        <Row label="已付金额" value={'¥' + Number(data.paid_amount || 0).toFixed(2)} />
        <Row label="待付金额" value={'¥' + Number(data.balance || 0).toFixed(2)} color={data.balance > 0 ? '#F5A623' : TEXT} />
      </Card>

      {/* 选片入口 */}
      {data.selection_url && (
        <button onClick={() => nav(data.selection_url)}
          style={{ width: '100%', marginTop: 16, padding: '14px 0', borderRadius: 14, background: BRAND, color: '#fff', fontSize: 15, border: 'none', cursor: 'pointer', boxShadow: '0 8px 20px rgba(126,205,187,0.35)' }}>
          进入选片
        </button>
      )}

      <div style={{ textAlign: 'center', fontSize: 12, color: FAINT, marginTop: 24 }}>YEZHE WORKSHOP · 订单信息仅供查看</div>
    </div>
  );
}