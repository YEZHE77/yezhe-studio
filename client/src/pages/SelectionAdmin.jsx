import React, { useState, useEffect, useRef, useCallback } from 'react';
import http, { img } from '../api.js';

// ===== 选片工具 · B 端摄影师后台 =====
// 功能：订单绑定选片任务 / 配置(保底精修/加片单价/密码/有效期/水印/启停) / 图片上传 R2 存 URL
//       实时查看客户三态标记 + 统计 + 预估加片金额 / 导出 txt 选片清单
const BRAND = '#7ECDBB';
const MARK_META = {
  like: { label: '喜欢', color: '#FF5A5F', icon: '♥' },
  exclude: { label: '排除', color: '#8E8E93', icon: '✕' },
  pending: { label: '待定', color: '#C7C7CC', icon: '—' }
};

export default function SelectionAdmin() {
  const [orders, setOrders] = useState([]);
  const [active, setActive] = useState(null);        // 选中的订单
  const [task, setTask] = useState(null);            // 选片任务
  const [share, setShare] = useState(null);          // 分享信息
  const [marks, setMarks] = useState({});
  const [stats, setStats] = useState({ like: 0, exclude: 0, pending: 0, total: 0 });
  const [extra, setExtra] = useState({ extraCount: 0, extraFee: 0 });
  const [submitted, setSubmitted] = useState(false);

  // 表单
  const [form, setForm] = useState({ min_retouch: 0, extra_price: 0, password: '', expire_at: '', watermark_enabled: false });
  const [photos, setPhotos] = useState([]);          // 本地待保存的图片 [{key,url}]
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tip, setTip] = useState('');
  const [q, setQ] = useState('');
  const fileRef = useRef(null);

  const flash = (msg) => { setTip(msg); setTimeout(() => setTip(''), 3000); };

  // 拉取选片中的订单（todo_selecting = shot/selecting）
  const loadOrders = useCallback(() => {
    http.get('/api/orders?statuses=todo_selecting&pageSize=100')
      .then((r) => setOrders(r.data.list || []))
      .catch(() => setOrders([]));
  }, []);
  useEffect(loadOrders, [loadOrders]);

  // 选中订单 → 加载任务
  const loadTask = useCallback(async (orderId) => {
    if (!orderId) return;
    try {
      const r = await http.get('/api/selection/tasks/' + orderId);
      const d = r.data;
      setTask(d.task);
      setShare(d.share);
      setMarks(d.marks || {});
      setStats(d.stats || { like: 0, exclude: 0, pending: 0, total: 0 });
      setExtra(d.extra || { extraCount: 0, extraFee: 0 });
      setSubmitted(!!(d.task && d.task.submitted));
      if (d.task) {
        setForm({
          min_retouch: d.task.min_retouch || 0,
          extra_price: d.task.extra_price || 0,
          password: '',                                  // 密码不回显，留空=不改
          expire_at: (d.share && d.share.expire_at) || '',
          watermark_enabled: !!d.task.watermark_enabled
        });
        setPhotos(d.task.photos || []);
      }
    } catch (e) { flash('加载失败：' + (e.response?.data?.error || e.message)); }
  }, []);

  // 实时统计轮询（B 端查看客户标记进度）
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      http.get('/api/selection/tasks/' + active.id + '/stats')
        .then((r) => {
          if (r.data && r.data.ok) {
            setMarks(r.data.marks || {});
            setStats(r.data.stats || { like: 0, exclude: 0, pending: 0, total: 0 });
            setExtra(r.data.extra || { extraCount: 0, extraFee: 0 });
            setSubmitted(!!r.data.submitted);
          }
        }).catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [active]);

  // 上传图片到 R2
  const upload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      const r = await http.post('/api/upload-multiple', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const urls = r.data.urls || [];
      const base = photos.length;
      const next = urls.map((url, i) => ({ key: 'p_' + (base + i), url }));
      setPhotos((p) => [...p, ...next]);
      flash('已上传 ' + urls.length + ' 张到云端，记得点「保存任务」');
    } catch (e2) { flash('上传失败：' + (e2.response?.data?.error || e2.message)); }
    finally { setUploading(false); e.target.value = ''; }
  };

  const removePhoto = (key) => setPhotos((p) => p.filter((x) => x.key !== key));

  // 保存任务（含配置 + 图片 URL）
  const save = async () => {
    if (!active) return;
    setSaving(true);
    try {
      const r = await http.post('/api/selection/tasks/' + active.id, {
        min_retouch: parseInt(form.min_retouch, 10) || 0,
        extra_price: parseFloat(form.extra_price) || 0,
        password: form.password,          // 空串=清除密码
        expire_at: form.expire_at,
        watermark_enabled: form.watermark_enabled,
        photos
      });
      setTask(r.data.task);
      setShare(r.data.share);
      setPhotos(r.data.task.photos || []);
      flash('选片任务已保存');
    } catch (e) { flash('保存失败：' + (e.response?.data?.error || e.message)); }
    finally { setSaving(false); }
  };

  const toggle = async () => {
    if (!active || !share) return;
    try {
      const r = await http.post('/api/selection/tasks/' + active.id + '/toggle');
      setShare((s) => (s ? { ...s, disabled: r.data.disabled } : s));
      flash(r.data.disabled ? '链接已禁用' : '链接已启用');
    } catch (e) { flash('操作失败：' + (e.response?.data?.error || e.message)); }
  };

  const copyLink = () => {
    if (!share || !share.share_url) return;
    if (navigator.clipboard) navigator.clipboard.writeText(share.share_url);
    else {
      const ta = document.createElement('textarea');
      ta.value = share.share_url; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    }
    flash('分享链接已复制');
  };

  const exportTxt = () => {
    if (!active) return;
    window.open((http.defaults.baseURL || '') + '/api/selection/tasks/' + active.id + '/export', '_blank');
  };

  const filtered = orders.filter((o) => !q || (o.customer_name || '').includes(q) || (o.order_no || '').includes(q));

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '16px 16px 40px' }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: '#1D1D1F', margin: 0 }}>在线选片工具</h1>
        <p style={{ fontSize: 13, color: '#8E8E93', margin: '4px 0 0' }}>绑定订单 · 客户 H5 选片（喜欢/排除/待定）· 实时统计加片金额</p>
      </div>

      {tip && <div style={{ marginBottom: 12, fontSize: 13, padding: '10px 14px', borderRadius: 10, background: 'rgba(126,205,187,0.12)', color: '#3E9C8B', border: '1px solid rgba(126,205,187,0.3)' }}>{tip}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16, alignItems: 'start' }}>
        {/* 左：订单列表 */}
        <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 6px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid #F0F0F2' }}>
            <div style={{ fontSize: 13, color: '#8E8E93' }}>待选片订单（{filtered.length}）</div>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索客户 / 单号"
              style={{ width: '100%', marginTop: 8, padding: '8px 12px', borderRadius: 10, border: '1px solid #E8E8EA', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
            {filtered.map((o) => (
              <div key={o.id} onClick={() => { setActive(o); loadTask(o.id); }}
                style={{ padding: '12px 14px', borderBottom: '1px solid #F5F5F6', cursor: 'pointer', background: active && active.id === o.id ? 'rgba(126,205,187,0.08)' : 'transparent' }}>
                <div style={{ fontSize: 14, color: '#1D1D1F' }}>{o.customer_name || '客户'}</div>
                <div style={{ fontSize: 12, color: '#AEAEB2', marginTop: 3 }}>单号 {o.order_no}</div>
              </div>
            ))}
            {!filtered.length && <div style={{ padding: '30px 0', textAlign: 'center', fontSize: 13, color: '#C7C7CC' }}>暂无待选片订单</div>}
          </div>
        </div>

        {/* 右：任务管理 */}
        <div style={{ minHeight: 400 }}>
          {!active && (
            <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 6px rgba(0,0,0,0.05)', height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#C7C7CC', fontSize: 14 }}>
              ← 从左侧选择一个订单，创建或管理选片任务
            </div>
          )}

          {active && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* 配置卡片 */}
              <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 6px rgba(0,0,0,0.05)', padding: 18 }}>
                <div style={{ fontSize: 14, color: '#1D1D1F', marginBottom: 14 }}>选片任务配置 · {active.customer_name || '客户'}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <label style={{ fontSize: 13, color: '#6E6E73' }}>
                    保底精修张数
                    <input type="number" min="0" value={form.min_retouch} onChange={(e) => setForm((f) => ({ ...f, min_retouch: e.target.value }))}
                      style={{ width: '100%', marginTop: 6, padding: '9px 12px', borderRadius: 10, border: '1px solid #E8E8EA', fontSize: 14, boxSizing: 'border-box', outline: 'none' }} />
                  </label>
                  <label style={{ fontSize: 13, color: '#6E6E73' }}>
                    加片单价（元/张）
                    <input type="number" min="0" step="0.1" value={form.extra_price} onChange={(e) => setForm((f) => ({ ...f, extra_price: e.target.value }))}
                      style={{ width: '100%', marginTop: 6, padding: '9px 12px', borderRadius: 10, border: '1px solid #E8E8EA', fontSize: 14, boxSizing: 'border-box', outline: 'none' }} />
                  </label>
                  <label style={{ fontSize: 13, color: '#6E6E73' }}>
                    访问密码（留空=无密码）
                    <input type="text" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder="不填则保持/清除"
                      style={{ width: '100%', marginTop: 6, padding: '9px 12px', borderRadius: 10, border: '1px solid #E8E8EA', fontSize: 14, boxSizing: 'border-box', outline: 'none' }} />
                  </label>
                  <label style={{ fontSize: 13, color: '#6E6E73' }}>
                    选片有效期（留空=永久）
                    <input type="date" value={form.expire_at} onChange={(e) => setForm((f) => ({ ...f, expire_at: e.target.value }))}
                      style={{ width: '100%', marginTop: 6, padding: '9px 12px', borderRadius: 10, border: '1px solid #E8E8EA', fontSize: 14, boxSizing: 'border-box', outline: 'none' }} />
                  </label>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 13, color: '#6E6E73', cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.watermark_enabled} onChange={(e) => setForm((f) => ({ ...f, watermark_enabled: e.target.checked }))} />
                  开启预览水印（客户选片页图片叠加工作室水印）
                </label>
                <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                  <button onClick={save} disabled={saving}
                    style={{ padding: '10px 20px', borderRadius: 12, background: BRAND, color: '#fff', fontSize: 14, border: 'none', cursor: 'pointer', opacity: saving ? 0.5 : 1 }}>
                    {saving ? '保存中…' : '保存任务'}
                  </button>
                  {share && (
                    <>
                      <button onClick={toggle}
                        style={{ padding: '10px 20px', borderRadius: 12, background: share.disabled ? '#FF5A5F' : '#fff', color: share.disabled ? '#fff' : '#6E6E73', fontSize: 14, border: '1px solid #E8E8EA', cursor: 'pointer' }}>
                        {share.disabled ? '链接已禁用（点击启用）' : '链接已启用（点击禁用）'}
                      </button>
                      <button onClick={copyLink} style={{ padding: '10px 20px', borderRadius: 12, background: '#fff', color: '#2DB7F5', fontSize: 14, border: '1px solid #2DB7F5', cursor: 'pointer' }}>复制选片链接</button>
                    </>
                  )}
                </div>
                {share && share.share_url && (
                  <div style={{ marginTop: 12, fontSize: 12, color: '#AEAEB2', wordBreak: 'break-all' }}>链接：{share.share_url}</div>
                )}
              </div>

              {/* 图片管理 + 实时统计 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
                {/* 图片管理 */}
                <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 6px rgba(0,0,0,0.05)', padding: 18 }}>
                  <div style={{ fontSize: 14, color: '#1D1D1F', marginBottom: 12 }}>选片图片（{photos.length} 张 · 存 R2 URL）</div>
                  <input ref={fileRef} type="file" accept="image/*" multiple onChange={upload} style={{ display: 'none' }} />
                  <button onClick={() => fileRef.current && fileRef.current.click()} disabled={uploading}
                    style={{ padding: '9px 16px', borderRadius: 10, background: '#fff', color: BRAND, fontSize: 13, border: '1px dashed #7ECDBB', cursor: 'pointer', width: '100%' }}>
                    {uploading ? '上传中…' : '+ 上传图片（支持多选）'}
                  </button>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 12, maxHeight: 300, overflow: 'auto' }}>
                    {photos.map((p, i) => (
                      <div key={p.key} style={{ position: 'relative', aspectRatio: '1', borderRadius: 8, overflow: 'hidden', background: '#F5F5F7' }}>
                        <img src={img(p.url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        <span style={{ position: 'absolute', top: 3, left: 3, fontSize: 10, color: '#fff', background: 'rgba(0,0,0,0.5)', padding: '1px 5px', borderRadius: 4 }}>{i + 1}</span>
                        <button onClick={() => removePhoto(p.key)} title="移除"
                          style={{ position: 'absolute', top: 3, right: 3, width: 18, height: 18, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 11, border: 'none', cursor: 'pointer', lineHeight: 1 }}>×</button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 实时统计 */}
                <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 6px rgba(0,0,0,0.05)', padding: 18 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div style={{ fontSize: 14, color: '#1D1D1F' }}>客户选片实时统计</div>
                    <button onClick={exportTxt} style={{ padding: '8px 14px', borderRadius: 10, background: '#fff', color: '#6E6E73', fontSize: 13, border: '1px solid #E8E8EA', cursor: 'pointer' }}>导出 txt 清单</button>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {['like', 'exclude', 'pending'].map((s) => {
                      const m = MARK_META[s];
                      const count = stats[s] || 0;
                      return (
                        <div key={s} style={{ flex: 1, background: '#F9F9FA', borderRadius: 12, padding: '12px', textAlign: 'center' }}>
                          <div style={{ fontSize: 20, color: m.color, marginBottom: 4 }}>{count}</div>
                          <div style={{ fontSize: 12, color: '#8E8E93' }}>{m.icon} {m.label}</div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: 12, fontSize: 13, color: '#6E6E73', lineHeight: 1.8 }}>
                    <div>保底精修：<span style={{ color: '#1D1D1F' }}>{task ? task.min_retouch : 0} 张</span></div>
                    <div>预估加片：<span style={{ color: extra.extraCount > 0 ? '#F5A623' : '#1D1D1F' }}>{extra.extraCount} 张 · ¥{extra.extraFee.toFixed(2)}</span></div>
                    <div>提交状态：<span style={{ color: submitted ? '#3E9C8B' : '#F5A623' }}>{submitted ? '客户已完成选片' : '选片中'}</span></div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
