import React, { useState, useEffect, useRef, useCallback } from 'react';
import http, { thumb, uploadBatch } from '../api.js';

// ===== 选片工具 · B 端商家后台（100% 原版复刻） =====
// 功能：订单选片任务总览 / 配置 / 底片上传删除(商家全设备) / 实时监控 / 待支付登记收款 / 重置 / 导出
// 原版：无历史快照，重置后系统内历史丢失；商家手机可上传删除底片；仅已完成可正式导出
const BRAND = '#7ECDBB';
const TEXT = '#1D1D1F';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';
const KEEP = '#FF5A5F';
const REJECT = '#8E8E93';

const TASK_STATUS_LABEL = { not_started: '未开启', selecting: '选片中', pending_payment: '待支付', completed: '已完成', reset: '已重置' };
const STATUS_COLOR = { not_started: '#C77B00', selecting: '#C77B00', pending_payment: '#F5A623', completed: '#3E9C8B', reset: '#8E8E93' };

function toast(msg) {
  const id = '__sel_admin_toast__';
  let el = document.getElementById(id);
  if (!el) { el = document.createElement('div'); el.id = id; el.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999;background:#1f2329;color:#fff;padding:10px 20px;border-radius:10px;font-size:14px;box-shadow:0 4px 20px rgba(0,0,0,.2);transition:opacity .3s;pointer-events:none;'; document.body.appendChild(el); }
  el.textContent = msg; el.style.opacity = '1';
  clearTimeout(toast._t); toast._t = setTimeout(() => { el.style.opacity = '0'; }, 2500);
}

export default function SelectionAdmin() {
  const [orders, setOrders] = useState([]);
  const [active, setActive] = useState(null);
  const [tab, setTab] = useState('overview'); // overview | photos | monitor
  const [task, setTask] = useState(null);
  const [stats, setStats] = useState({ keep: 0, reject: 0, unmarked: 0, total: 0 });
  const [extra, setExtra] = useState({ extraCount: 0, extraFee: 0 });
  const [shareUrl, setShareUrl] = useState('');
  const [photoTotal, setPhotoTotal] = useState(0);

  const [form, setForm] = useState({ min_retouch: 0, extra_price: 0, password: '', expire_at: '', watermark_enabled: false, shuffle_enabled: false, screenshot_guard: false, thumb_only: false });
  const [saving, setSaving] = useState(false);

  const [photos, setPhotos] = useState([]);
  const [filter, setFilter] = useState('all');
  const [uploading, setUploading] = useState(false);

  const [payModal, setPayModal] = useState(false);
  const [payForm, setPayForm] = useState({ pay_flow_no: '', channel: 'wechat' });

  const [q, setQ] = useState('');
  const fileRef = useRef(null);

  const loadOrders = useCallback(() => {
    http.get('/api/orders?statuses=todo_selecting&pageSize=200')
      .then((r) => setOrders(r.data.list || []))
      .catch(() => setOrders([]));
  }, []);
  useEffect(loadOrders, [loadOrders]);

  const loadTask = useCallback(async (orderId) => {
    if (!orderId) return;
    try {
      const r = await http.get('/api/selection/orders/' + orderId + '/task');
      const d = r.data || {};
      setTask(d.task);
      setStats(d.stats || { keep: 0, reject: 0, unmarked: 0, total: 0 });
      setExtra(d.extra || { extraCount: 0, extraFee: 0 });
      setShareUrl(d.share_url || '');
      setPhotoTotal(d.photo_total || 0);
      if (d.task) {
        setForm({
          min_retouch: d.task.min_retouch || 0,
          extra_price: d.task.extra_price || 0,
          password: '',
          expire_at: d.task.expire_at || '',
          watermark_enabled: !!d.task.watermark_enabled,
          shuffle_enabled: !!d.task.shuffle_enabled,
          screenshot_guard: !!d.task.screenshot_guard,
          thumb_only: !!d.task.thumb_only
        });
      }
    } catch (e) { toast('加载失败：' + (e.response?.data?.error || e.message)); }
  }, []);

  const loadMonitor = useCallback(async () => {
    if (!active) return;
    try {
      const r = await http.get('/api/selection/orders/' + active.id + '/monitor?filter=' + filter);
      const d = r.data || {};
      setPhotos(d.photos || []);
      setStats(d.stats || { keep: 0, reject: 0, unmarked: 0, total: 0 });
      setExtra(d.extra || { extraCount: 0, extraFee: 0 });
      if (d.task) setTask((t) => (t ? { ...t, status: d.task.status, pending_fee: d.task.pending_fee } : t));
    } catch (e) { /* 静默 */ }
  }, [active, filter]);

  useEffect(() => { if (active) { loadTask(active.id); setTab('overview'); } }, [active, loadTask]);

  useEffect(() => {
    if (!active || tab !== 'monitor') return;
    loadMonitor();
    const t = setInterval(loadMonitor, 3000);
    return () => clearInterval(t);
  }, [active, tab, filter, loadMonitor]);

  const saveConfig = async () => {
    if (!active) return;
    setSaving(true);
    try {
      await http.post('/api/selection/orders/' + active.id + '/config', {
        min_retouch: parseInt(form.min_retouch, 10) || 0,
        extra_price: parseFloat(form.extra_price) || 0,
        password: form.password,
        expire_at: form.expire_at,
        watermark_enabled: form.watermark_enabled,
        shuffle_enabled: form.shuffle_enabled,
        screenshot_guard: form.screenshot_guard,
        thumb_only: form.thumb_only
      });
      toast('配置已保存');
      loadTask(active.id);
    } catch (e) { toast('保存失败：' + (e.response?.data?.error || e.message)); }
    finally { setSaving(false); }
  };

  const upload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    try {
      const res = await uploadBatch(files, { category: 'negative' });
      const okItems = res.items.filter(Boolean);
      if (!okItems.length) { toast('上传失败'); return; }
      const photos = okItems.map((it, i) => ({ key: 'p_' + Date.now() + '_' + i, url: it.url, thumb_url: it.url }));
      const r = await http.post('/api/selection/orders/' + active.id + '/photos', { photos });
      toast(`已上传 ${r.data.added} 张底片（共 ${r.data.total} 张）`);
      loadTask(active.id);
      if (tab === 'photos' || tab === 'monitor') loadMonitor();
    } catch (e2) { toast('上传失败：' + (e2.response?.data?.error || e2.message)); }
    finally { setUploading(false); e.target.value = ''; }
  };

  const removePhoto = async (photoId) => {
    if (!window.confirm('确定删除这张底片？删除后该照片的全部标记会被清除，统计将自动重算。')) return;
    try {
      await http.delete('/api/selection/orders/' + active.id + '/photos/' + photoId);
      toast('已删除');
      loadTask(active.id); loadMonitor();
    } catch (e) { toast('删除失败：' + (e.response?.data?.error || e.message)); }
  };

  const reset = async () => {
    if (!window.confirm('⚠️ 重置选片将清空全部标记与历史选片记录，客户需要重新选片。\n\n系统内历史将丢失，请确认已导出备份。\n\n确定重置？')) return;
    try {
      await http.post('/api/selection/orders/' + active.id + '/reset', {});
      toast('已重置，等待客户重新选片');
      loadTask(active.id);
    } catch (e) { toast('重置失败：' + (e.response?.data?.error || e.message)); }
  };

  const recordPay = async () => {
    try {
      await http.post(`/api/selection/orders/${active.id}/pay`, { pay_flow_no: payForm.pay_flow_no, channel: payForm.channel });
      toast('已登记收款，订单尾款已入账，选片已锁定');
      setPayModal(false); setPayForm({ pay_flow_no: '', channel: 'wechat' });
      loadTask(active.id);
    } catch (e) { toast('登记失败：' + (e.response?.data?.error || e.message)); }
  };

  const exportList = async (format) => {
    if (!active) return;
    try {
      const r = await http.get('/api/selection/orders/' + active.id + '/export?format=' + format, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      const cd = (r.headers && r.headers['content-disposition']) || '';
      const m = cd.match(/filename="?([^";]+)"?/);
      a.href = url;
      a.download = m ? m[1] : ('selection_' + (active.order_no || active.id) + (format === 'excel' ? '.xls' : '.txt'));
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { toast(e.response && e.response.data && e.response.data.error ? e.response.data.error : '导出失败'); }
  };

  const copyLink = () => {
    if (!shareUrl) return;
    if (navigator.clipboard) navigator.clipboard.writeText(shareUrl);
    else { const ta = document.createElement('textarea'); ta.value = shareUrl; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); }
    toast('选片链接已复制');
  };

  const filtered = orders.filter((o) => !q || (o.customer_name || '').includes(q) || (o.order_no || '').includes(q));
  const completed = task && task.status === 'completed';
  const pendingPay = task && task.status === 'pending_payment';

  return (
    <div style={{ maxWidth: 1160, margin: '0 auto', padding: '16px 16px 40px' }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, color: TEXT, margin: 0 }}>在线选片</h1>
        <p style={{ fontSize: 13, color: SUB, margin: '4px 0 0' }}>上传底片 · 客户 H5 选片 · 实时监控 · 待支付对账</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16, alignItems: 'start' }}>
        <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 6px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid #F0F0F2' }}>
            <div style={{ fontSize: 13, color: SUB }}>待选片订单（{filtered.length}）</div>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索客户 / 单号"
              style={{ width: '100%', marginTop: 8, padding: '8px 12px', borderRadius: 10, border: '1px solid #E8E8EA', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div style={{ maxHeight: '64vh', overflow: 'auto' }}>
            {filtered.map((o) => (
              <div key={o.id} onClick={() => setActive(o)}
                style={{ padding: '12px 14px', borderBottom: '1px solid #F5F5F6', cursor: 'pointer', background: active && active.id === o.id ? 'rgba(126,205,187,0.08)' : 'transparent' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 14, color: TEXT }}>{o.customer_name || '客户'}</span>
                  {o.selection_status && o.selection_status !== 'not_started' && (
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 8, background: 'rgba(126,205,187,0.18)', color: STATUS_COLOR[o.selection_status] || '#3E9C8B' }}>
                      {TASK_STATUS_LABEL[o.selection_status] || o.selection_status}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: FAINT, marginTop: 3 }}>单号 {o.order_no}</div>
              </div>
            ))}
            {!filtered.length && <div style={{ padding: '30px 0', textAlign: 'center', fontSize: 13, color: FAINT }}>暂无待选片订单</div>}
          </div>
        </div>

        <div style={{ minHeight: 420 }}>
          {!active && (
            <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 6px rgba(0,0,0,0.05)', height: 420, display: 'flex', alignItems: 'center', justifyContent: 'center', color: FAINT, fontSize: 14 }}>
              ← 从左侧选择一个订单
            </div>
          )}

          {active && (
            <div>
              <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
                {[{ k: 'overview', t: '总览' }, { k: 'photos', t: '底片' }, { k: 'monitor', t: '监控' }].map((tb) => (
                  <button key={tb.k} onClick={() => setTab(tb.k)}
                    style={{ padding: '9px 16px', borderRadius: 12, border: 'none', cursor: 'pointer', fontSize: 13, background: tab === tb.k ? BRAND : '#fff', color: tab === tb.k ? '#fff' : SUB, boxShadow: tab === tb.k ? '0 4px 12px rgba(126,205,187,0.3)' : '0 1px 4px rgba(0,0,0,0.04)' }}>
                    {tb.t}
                  </button>
                ))}
              </div>

              {tab === 'overview' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <Card>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                      <div style={{ fontSize: 15, color: TEXT }}>选片任务 · {active.customer_name || '客户'}</div>
                      <span style={{ fontSize: 12, padding: '3px 12px', borderRadius: 10, background: 'rgba(126,205,187,0.18)', color: task ? (STATUS_COLOR[task.status] || '#3E9C8B') : '#C77B00' }}>
                        {task ? (TASK_STATUS_LABEL[task.status] || task.status) : '未开启'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <Metric label="底片" value={photoTotal + ' 张'} color={TEXT} />
                      <Metric label="保留" value={stats.keep + ' 张'} color={KEEP} />
                      <Metric label="淘汰" value={stats.reject + ' 张'} color={REJECT} />
                      <Metric label="加选" value={extra.extraCount + ' 张'} color={extra.extraCount > 0 ? '#F5A623' : TEXT} />
                      <Metric label="加选金额" value={'¥' + extra.extraFee.toFixed(2)} color={extra.extraCount > 0 ? '#F5A623' : TEXT} />
                      {pendingPay && <Metric label="待支付" value={'¥' + ((task.pending_fee || 0).toFixed(2))} color="#F5A623" />}
                    </div>
                    {!task && <div style={{ marginTop: 12, fontSize: 13, color: FAINT }}>尚未开启选片，请在下方配置并上传底片。</div>}
                    {task && !photoTotal && <div style={{ marginTop: 12, fontSize: 13, color: '#C77B00' }}>尚未上传底片，请在「底片」页上传。</div>}
                    {pendingPay && (
                      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 12, background: 'rgba(245,166,35,0.1)' }}>
                        <span style={{ fontSize: 13, color: '#C77B00', flex: 1 }}>客户已提交，待支付加片费 ¥{(task.pending_fee || 0).toFixed(2)}（待支付金额仅预览，未入账）</span>
                        <Btn onClick={() => { setPayModal(true); setPayForm({ pay_flow_no: '', channel: 'wechat' }); }} primary>登记收款</Btn>
                      </div>
                    )}
                  </Card>

                  <Card title="任务配置">
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                      <Field label="免费精修张数"><input type="number" min="0" value={form.min_retouch} onChange={(e) => setForm((f) => ({ ...f, min_retouch: e.target.value }))} /></Field>
                      <Field label="加片单价（元/张）"><input type="number" min="0" step="0.1" value={form.extra_price} onChange={(e) => setForm((f) => ({ ...f, extra_price: e.target.value }))} /></Field>
                      <Field label="访问密码（留空=无密码）"><input type="text" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder="不填则不修改" /></Field>
                      <Field label="选片有效期（留空=永久）"><input type="date" value={form.expire_at} onChange={(e) => setForm((f) => ({ ...f, expire_at: e.target.value }))} /></Field>
                    </div>
                    <div style={{ display: 'flex', gap: 18, marginTop: 14 }}>
                      <Check label="图片水印" checked={form.watermark_enabled} onChange={(v) => setForm((f) => ({ ...f, watermark_enabled: v }))} />
                      <Check label="底片随机打乱" checked={form.shuffle_enabled} onChange={(v) => setForm((f) => ({ ...f, shuffle_enabled: v }))} />
                      <Check label="防截图提示层" checked={form.screenshot_guard} onChange={(v) => setForm((f) => ({ ...f, screenshot_guard: v }))} />
                      <Check label="未交付仅预览缩略图" checked={form.thumb_only} onChange={(v) => setForm((f) => ({ ...f, thumb_only: v }))} />
                    </div>
                    <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
                      <Btn onClick={saveConfig} disabled={saving} primary>{saving ? '保存中…' : '保存配置'}</Btn>
                      <Btn onClick={copyLink} disabled={!shareUrl}>复制选片链接</Btn>
                      <Btn onClick={() => exportList('txt')} disabled={!completed}>导出 TXT</Btn>
                      <Btn onClick={() => exportList('excel')} disabled={!completed}>导出 Excel</Btn>
                      <Btn onClick={reset} danger disabled={!task || task.status === 'selecting'}>重置选片</Btn>
                    </div>
                    {!completed && <div style={{ marginTop: 10, fontSize: 12, color: FAINT }}>提示：仅「已完成」状态可正式交付导出；待支付仅可预览。</div>}
                    {shareUrl && <div style={{ marginTop: 12, fontSize: 12, color: FAINT, wordBreak: 'break-all' }}>链接：{shareUrl}</div>}
                  </Card>
                </div>
              )}

              {tab === 'photos' && (
                <Card title={`底片管理（${photoTotal} 张）`}>
                  <input ref={fileRef} type="file" accept="image/*" multiple onChange={upload} style={{ display: 'none' }} />
                  <Btn onClick={() => fileRef.current && fileRef.current.click()} disabled={uploading} primary>{uploading ? '上传中…' : '+ 批量上传底片'}</Btn>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6, marginTop: 14 }}>
                    {(photos || []).map((p, i) => (
                      <div key={p.id} style={{ position: 'relative', aspectRatio: '1', borderRadius: 8, overflow: 'hidden', background: '#F5F5F7' }}>
                        <img src={thumb(p.thumb_url || p.url, 200)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        <span style={{ position: 'absolute', top: 3, left: 3, fontSize: 10, color: '#fff', background: 'rgba(0,0,0,0.5)', padding: '1px 5px', borderRadius: 4 }}>{i + 1}</span>
                        <button onClick={() => removePhoto(p.id)} title="删除"
                          style={{ position: 'absolute', top: 3, right: 3, width: 18, height: 18, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 11, border: 'none', cursor: 'pointer', lineHeight: 1 }}>×</button>
                      </div>
                    ))}
                    {!photos.length && <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: FAINT, fontSize: 13, padding: '40px 0' }}>暂无底片，请上传</div>}
                  </div>
                </Card>
              )}

              {tab === 'monitor' && (
                <Card title="实时监控">
                  <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                    {[{ k: 'all', t: '全部' }, { k: 'keep', t: '保留' }, { k: 'reject', t: '淘汰' }, { k: 'unmarked', t: '未标记' }].map((f) => (
                      <button key={f.k} onClick={() => setFilter(f.k)}
                        style={{ padding: '7px 14px', borderRadius: 10, border: '1px solid #E8E8EA', background: filter === f.k ? 'rgba(126,205,187,0.12)' : '#fff', color: filter === f.k ? '#3E9C8B' : SUB, fontSize: 12, cursor: 'pointer' }}>
                        {f.t}
                      </button>
                    ))}
                    <div style={{ marginLeft: 'auto', fontSize: 12, color: SUB, alignSelf: 'center' }}>保留 {stats.keep} · 淘汰 {stats.reject} · 加选 ¥{extra.extraFee.toFixed(2)}</div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                    {photos.map((p) => (
                      <div key={p.id} style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', background: '#F5F5F7' }}>
                        <div style={{ aspectRatio: '1' }}><img src={thumb(p.thumb_url || p.url, 300)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div>
                        {p.status && (
                          <span style={{ position: 'absolute', top: 5, left: 5, padding: '2px 8px', borderRadius: 8, background: p.status === 'keep' ? KEEP : REJECT, color: '#fff', fontSize: 11 }}>
                            {p.status === 'keep' ? '保留' : '淘汰'}
                          </span>
                        )}
                        {p.remark && <div style={{ padding: '5px 8px', fontSize: 11, color: SUB, background: '#fff' }}>💬 {p.remark}</div>}
                      </div>
                    ))}
                    {!photos.length && <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: FAINT, fontSize: 13, padding: '40px 0' }}>暂无底片</div>}
                  </div>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>

      {payModal && (
        <Modal title={`登记收款 · 加片费 ¥${((task && task.pending_fee) || 0).toFixed(2)}`} onClose={() => setPayModal(false)}>
          <div style={{ fontSize: 13, color: SUB, marginBottom: 12 }}>线下收款需手动录入；线上缴费会自动入账。登记后选片锁定、订单尾款相应扣减。</div>
          <Field label="支付流水号"><input value={payForm.pay_flow_no} onChange={(e) => setPayForm((f) => ({ ...f, pay_flow_no: e.target.value }))} placeholder="选填" /></Field>
          <div style={{ marginTop: 10, fontSize: 13, color: SUB }}>收款渠道</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            {[['wechat', '微信'], ['alipay', '支付宝'], ['cash', '现金'], ['bank', '银行转账']].map(([k, t]) => (
              <button key={k} onClick={() => setPayForm((f) => ({ ...f, channel: k }))}
                style={{ padding: '7px 14px', borderRadius: 10, border: '1px solid #E8E8EA', background: payForm.channel === k ? 'rgba(126,205,187,0.12)' : '#fff', color: payForm.channel === k ? '#3E9C8B' : SUB, fontSize: 12, cursor: 'pointer' }}>{t}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
            <Btn onClick={() => setPayModal(false)}>取消</Btn>
            <Btn onClick={recordPay} primary>确认收款</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 6px rgba(0,0,0,0.05)', padding: 18 }}>
      {title && <div style={{ fontSize: 14, color: TEXT, marginBottom: 14 }}>{title}</div>}
      {children}
    </div>
  );
}
function Metric({ label, value, color }) {
  return (
    <div style={{ flex: 1, minWidth: 72, background: '#F9F9FA', borderRadius: 12, padding: '12px', textAlign: 'center' }}>
      <div style={{ fontSize: 18, color }}>{value}</div>
      <div style={{ fontSize: 11, color: FAINT, marginTop: 3 }}>{label}</div>
    </div>
  );
}
function Field({ label, children }) {
  return <label style={{ fontSize: 12, color: SUB }}>{label}<div style={{ marginTop: 5 }}>{children}</div></label>;
}
function Check({ label, checked, onChange }) {
  return <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: SUB, cursor: 'pointer' }}><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />{label}</label>;
}
function Btn({ children, onClick, disabled, primary, danger }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ padding: '9px 18px', borderRadius: 12, fontSize: 13, border: primary ? 'none' : '1px solid #E8E8EA', cursor: disabled ? 'not-allowed' : 'pointer', background: primary ? BRAND : '#fff', color: primary ? '#fff' : (danger ? '#FF5A5F' : SUB), opacity: disabled ? 0.5 : 1, boxShadow: primary ? '0 4px 12px rgba(126,205,187,0.3)' : 'none' }}>
      {children}
    </button>
  );
}
function Modal({ title, onClose, children }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 520, maxHeight: '80vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 15, color: TEXT }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontSize: 20, lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
