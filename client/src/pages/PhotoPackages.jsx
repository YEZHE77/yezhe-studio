import React, { useState, useEffect } from 'react';
import http, { img } from '../api.js';

// ===== 套系对外分享（B 端管理） =====
// photo_package 表：卡片列表 + 新增/编辑/启停/生成分享链接+二维码/删除；share_token 对外鉴权
const BRAND = '#7ECDBB';
const TEXT = '#1D1D1F';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';

const EMPTY = {
  package_name: '', cover_image: '', package_desc: '', shoot_duration: '', shoot_scope: '',
  photo_total: 0, retouch_count: 0, original_file: '', price: 0, additional_price: 0,
  other_service: '', notice: ''
};

function Field({ label, children }) {
  return (
    <label style={{ display: 'block', fontSize: 13, color: SUB, marginBottom: 10 }}>
      {label}
      <div style={{ marginTop: 4 }}>{children}</div>
    </label>
  );
}
const inputStyle = { width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #E8E8EA', fontSize: 14, boxSizing: 'border-box', outline: 'none' };

export default function PhotoPackages() {
  const [list, setList] = useState([]);
  const [editing, setEditing] = useState(null);   // null=关闭；对象=编辑
  const [form, setForm] = useState(EMPTY);
  const [share, setShare] = useState(null);       // { pkg, url, qr }
  const [tip, setTip] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const flash = (m) => { setTip(m); setTimeout(() => setTip(''), 2500); };
  const load = () => http.get('/api/photo-package').then((r) => setList(r.data || [])).catch(() => setList([]));
  useEffect(() => { load(); }, []);

  const openNew = () => { setForm(EMPTY); setEditing({}); };
  const openEdit = (p) => { setForm({ ...EMPTY, ...p }); setEditing(p); };

  const uploadCover = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setUploading(true);
    try {
      const fd = new FormData(); fd.append('file', f);
      const r = await http.post('/api/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setForm((x) => ({ ...x, cover_image: r.data.url }));
    } catch (e2) { flash('封面上传失败'); }
    finally { setUploading(false); e.target.value = ''; }
  };

  const save = async () => {
    if (!form.package_name.trim()) return flash('请填写套系名称');
    setBusy(true);
    try {
      if (editing && editing.id) await http.put('/api/photo-package/' + editing.id, form);
      else await http.post('/api/photo-package', form);
      setEditing(null); load(); flash('已保存');
    } catch (e) { flash('保存失败：' + (e.response?.data?.error || e.message)); }
    finally { setBusy(false); }
  };

  const toggle = async (p) => {
    try { await http.post('/api/photo-package/' + p.id + '/toggle'); load(); } catch (e) { flash('操作失败'); }
  };

  const del = async (p) => {
    if (!window.confirm(`确认删除套系「${p.package_name}」？删除后外部链接将提示「该套系不存在」。`)) return;
    try { await http.delete('/api/photo-package/' + p.id); load(); flash('已删除'); } catch (e) { flash('删除失败'); }
  };

  const genShare = async (p) => {
    try {
      let token = p.share_token;
      if (!token) { const r = await http.post('/api/photo-package/' + p.id + '/share'); token = r.data.share_token; }
      const base = (http.defaults.baseURL || '').replace(/\/+$/, '').replace(/\/api$/, '');
      const url = `${window.location.origin}/package?token=${token}`;
      const qr = await http.get('/api/qrcode', { params: { text: url } });
      setShare({ pkg: p, url, qr: qr.data && qr.data.qr ? qr.data.qr : qr.data });
    } catch (e) { flash('生成分享链接失败'); }
  };

  const copy = (txt) => {
    if (navigator.clipboard) navigator.clipboard.writeText(txt);
    else { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); }
    flash('链接已复制');
  };

  return (
    <div style={{ minHeight: '100vh', background: '#F5F5F7', padding: '12px 16px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontSize: 17, color: TEXT }}>套系管理</div>
        <button onClick={openNew} style={{ padding: '8px 16px', borderRadius: 12, background: BRAND, color: '#fff', fontSize: 14, border: 'none', cursor: 'pointer' }}>+ 新增套系</button>
      </div>

      {tip && <div style={{ position: 'fixed', top: '18%', left: '50%', transform: 'translateX(-50%)', zIndex: 200, background: 'rgba(29,29,31,0.9)', color: '#fff', fontSize: 13, padding: '10px 18px', borderRadius: 18 }}>{tip}</div>}

      {/* 卡片列表 */}
      {!list.length && <div style={{ textAlign: 'center', color: FAINT, fontSize: 14, padding: '60px 0' }}>暂无套系，点击右上角新增</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        {list.map((p) => (
          <div key={p.id} style={{ background: '#fff', borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 6px rgba(0,0,0,0.05)' }}>
            <div style={{ aspectRatio: '4/3', background: '#EEE', overflow: 'hidden' }}>
              {p.cover_image ? <img src={img(p.cover_image)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#C7C7CC' }}>无封面</div>}
            </div>
            <div style={{ padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 15, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.package_name}</span>
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 8, background: p.is_enable ? 'rgba(126,205,187,0.15)' : '#F0F0F2', color: p.is_enable ? '#3E9C8B' : '#AEAEB2' }}>{p.is_enable ? '启用中' : '已禁用'}</span>
              </div>
              <div style={{ fontSize: 17, color: '#FF5A5F', marginTop: 4 }}>¥{Number(p.price || 0).toFixed(0)}</div>
              <div style={{ fontSize: 12, color: FAINT, marginTop: 4 }}>{p.shoot_duration ? p.shoot_duration + ' · ' : ''}精修 {p.retouch_count} 张</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                <button onClick={() => openEdit(p)} style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid #E8E8EA', background: '#fff', color: SUB, fontSize: 12, cursor: 'pointer' }}>编辑</button>
                <button onClick={() => toggle(p)} style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid #E8E8EA', background: '#fff', color: SUB, fontSize: 12, cursor: 'pointer' }}>{p.is_enable ? '禁用' : '启用'}</button>
                <button onClick={() => genShare(p)} style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid #2DB7F5', background: '#fff', color: '#2DB7F5', fontSize: 12, cursor: 'pointer' }}>分享</button>
                <button onClick={() => del(p)} style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid #FF5A5F', background: '#fff', color: '#FF5A5F', fontSize: 12, cursor: 'pointer' }}>删除</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 新增/编辑弹窗 */}
      {editing && (
        <div onClick={() => setEditing(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', width: '100%', maxWidth: 520, maxHeight: '88vh', overflowY: 'auto', borderRadius: '20px 20px 0 0', padding: 20 }}>
            <div style={{ fontSize: 16, color: TEXT, marginBottom: 16 }}>{editing.id ? '编辑套系' : '新增套系'}</div>
            <Field label="套系名称"><input style={inputStyle} value={form.package_name} onChange={(e) => setForm((f) => ({ ...f, package_name: e.target.value }))} /></Field>
            <Field label="封面图">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {form.cover_image && <img src={img(form.cover_image)} alt="" style={{ width: 60, height: 60, borderRadius: 10, objectFit: 'cover' }} />}
                <button onClick={() => document.getElementById('pp-cover').click()} disabled={uploading} style={{ padding: '8px 14px', borderRadius: 10, border: '1px dashed #7ECDBB', background: '#fff', color: BRAND, fontSize: 13, cursor: 'pointer' }}>{uploading ? '上传中' : '上传封面'}</button>
                <input id="pp-cover" type="file" accept="image/*" onChange={uploadCover} style={{ display: 'none' }} />
              </div>
            </Field>
            <Field label="套系简介"><textarea style={{ ...inputStyle, minHeight: 60 }} value={form.package_desc} onChange={(e) => setForm((f) => ({ ...f, package_desc: e.target.value }))} /></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="拍摄时长"><input style={inputStyle} value={form.shoot_duration} onChange={(e) => setForm((f) => ({ ...f, shoot_duration: e.target.value }))} placeholder="如 全天 / 4小时" /></Field>
              <Field label="拍摄范围"><input style={inputStyle} value={form.shoot_scope} onChange={(e) => setForm((f) => ({ ...f, shoot_scope: e.target.value }))} placeholder="如 海口市区" /></Field>
              <Field label="照片总数"><input style={inputStyle} type="number" value={form.photo_total} onChange={(e) => setForm((f) => ({ ...f, photo_total: e.target.value }))} /></Field>
              <Field label="精修张数"><input style={inputStyle} type="number" value={form.retouch_count} onChange={(e) => setForm((f) => ({ ...f, retouch_count: e.target.value }))} /></Field>
              <Field label="原片文件"><input style={inputStyle} value={form.original_file} onChange={(e) => setForm((f) => ({ ...f, original_file: e.target.value }))} placeholder="如 底片全送 / 不送" /></Field>
              <Field label="标价（元）"><input style={inputStyle} type="number" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} /></Field>
              <Field label="加片单价（元）"><input style={inputStyle} type="number" value={form.additional_price} onChange={(e) => setForm((f) => ({ ...f, additional_price: e.target.value }))} /></Field>
            </div>
            <Field label="其他服务"><textarea style={{ ...inputStyle, minHeight: 50 }} value={form.other_service} onChange={(e) => setForm((f) => ({ ...f, other_service: e.target.value }))} /></Field>
            <Field label="温馨提示"><textarea style={{ ...inputStyle, minHeight: 50 }} value={form.notice} onChange={(e) => setForm((f) => ({ ...f, notice: e.target.value }))} /></Field>
            <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
              <button onClick={save} disabled={busy} style={{ flex: 1, padding: '12px 0', borderRadius: 12, background: BRAND, color: '#fff', fontSize: 15, border: 'none', cursor: 'pointer' }}>{busy ? '保存中' : '保存'}</button>
              <button onClick={() => setEditing(null)} style={{ flex: 1, padding: '12px 0', borderRadius: 12, background: '#F0F0F2', color: SUB, fontSize: 15, border: 'none', cursor: 'pointer' }}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 分享弹窗 */}
      {share && (
        <div onClick={() => setShare(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: 24, maxWidth: 340, width: '100%', textAlign: 'center' }}>
            <div style={{ fontSize: 16, color: TEXT, marginBottom: 4 }}>分享「{share.pkg.package_name}」</div>
            <div style={{ fontSize: 12, color: FAINT, marginBottom: 16 }}>客户扫码或打开链接即可查看套系报价</div>
            {share.qr ? <img src={share.qr} alt="二维码" style={{ width: 180, height: 180, margin: '0 auto 16px', display: 'block' }} /> : <div style={{ width: 180, height: 180, margin: '0 auto 16px', background: '#F0F0F2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#C7C7CC' }}>二维码</div>}
            <div style={{ fontSize: 12, color: SUB, wordBreak: 'break-all', marginBottom: 14 }}>{share.url}</div>
            <button onClick={() => copy(share.url)} style={{ width: '100%', padding: '11px 0', borderRadius: 12, background: BRAND, color: '#fff', fontSize: 15, border: 'none', cursor: 'pointer' }}>复制链接</button>
          </div>
        </div>
      )}
    </div>
  );
}
