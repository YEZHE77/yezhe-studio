import React, { useState, useEffect } from 'react';
import http from '../api.js';

// ===== 合同模板管理（B 端管理员） =====
// 列表（名称/默认/更新时间）+ 新增/编辑（富文本粘贴合同正文带{{占位符}} + 上传备份 PDF + 默认标记）+ 删除（绑定拦截）
const BRAND = '#7ECDBB';
const TEXT = '#1D1D1F';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';

const EMPTY = { template_name: '', template_content: '', backup_word_url: '', is_default: false };

// 防篡改校验：必填业务占位符（缺失则禁止保存，与后端一致）
const REQUIRED_PLACEHOLDERS = ['groom_name', 'bride_name', 'wedding_full_date', 'shoot_position', 'total_money'];

function fmtTime(t) {
  if (!t) return '';
  const d = new Date(t);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function ContractTemplates() {
  const [list, setList] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [tip, setTip] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const flash = (m) => { setTip(m); setTimeout(() => setTip(''), 2500); };
  const load = () => http.get('/api/contract/templates').then((r) => setList(r.data || [])).catch(() => setList([]));
  useEffect(() => { load(); }, []);

  const openNew = () => { setForm(EMPTY); setEditing({}); };
  const openEdit = (t) => { setForm({ template_name: t.template_name, template_content: t.template_content || '', backup_word_url: t.backup_word_url || '', is_default: !!t.is_default }); setEditing(t); };

  const uploadBackup = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setUploading(true);
    try {
      const fd = new FormData(); fd.append('file', f);
      const r = await http.post('/api/contract/upload-backup', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setForm((x) => ({ ...x, backup_word_url: r.data.url }));
      flash('备份 PDF 已上传');
    } catch (e2) { flash('上传失败：' + (e2.response?.data?.error || e2.message)); }
    finally { setUploading(false); e.target.value = ''; }
  };

  const save = async () => {
    if (!form.template_name.trim()) return flash('请填写模板名称');
    // 防篡改校验：缺失必填业务占位符则禁止保存
    const missing = REQUIRED_PLACEHOLDERS.filter((p) => !(form.template_content || '').includes('{{' + p + '}}'));
    if (missing.length) return flash('合同正文缺失必填占位符：' + missing.map((p) => '{{' + p + '}}').join('、'));
    setBusy(true);
    try {
      if (editing && editing.id) await http.put('/api/contract/templates/' + editing.id, form);
      else await http.post('/api/contract/templates', form);
      setEditing(null); load(); flash('已保存');
    } catch (e) { flash('保存失败：' + (e.response?.data?.error || e.message)); }
    finally { setBusy(false); }
  };

  const del = async (t) => {
    if (!window.confirm(`确认删除模板「${t.template_name}」？`)) return;
    try { await http.delete('/api/contract/templates/' + t.id); load(); flash('已删除'); }
    catch (e) { flash(e.response?.data?.error || '删除失败'); }
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '16px 16px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 500, color: TEXT, margin: 0 }}>合同模板管理</h1>
          <p style={{ fontSize: 13, color: FAINT, margin: '4px 0 0' }}>合同正文带 {{占位符}}，订单一键生成 PDF 时批量替换</p>
        </div>
        <button onClick={openNew} style={{ padding: '9px 18px', borderRadius: 12, background: BRAND, color: '#fff', fontSize: 14, border: 'none', cursor: 'pointer' }}>+ 新增模板</button>
      </div>

      {tip && <div style={{ position: 'fixed', top: '18%', left: '50%', transform: 'translateX(-50%)', zIndex: 200, background: 'rgba(29,29,31,0.9)', color: '#fff', fontSize: 13, padding: '10px 18px', borderRadius: 18 }}>{tip}</div>}

      {!list.length && <div style={{ textAlign: 'center', color: FAINT, fontSize: 14, padding: '60px 0', background: '#fff', borderRadius: 16 }}>暂无模板，点击右上角新增</div>}
      {list.map((t) => (
        <div key={t.id} style={{ background: '#fff', borderRadius: 14, padding: '14px 16px', marginBottom: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 15, color: TEXT }}>{t.template_name}</span>
              {!!t.is_default && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 8, background: 'rgba(126,205,187,0.15)', color: '#3E9C8B' }}>默认</span>}
            </div>
            <div style={{ fontSize: 12, color: FAINT, marginTop: 4 }}>更新于 {fmtTime(t.update_time || t.create_time)}</div>
          </div>
          <div style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>
            <button onClick={() => openEdit(t)} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #E8E8EA', background: '#fff', color: SUB, fontSize: 13, cursor: 'pointer' }}>编辑</button>
            <button onClick={() => del(t)} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #FF5A5F', background: '#fff', color: '#FF5A5F', fontSize: 13, cursor: 'pointer' }}>删除</button>
          </div>
        </div>
      ))}

      {/* 新增/编辑弹窗 */}
      {editing && (
        <div onClick={() => setEditing(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', width: '100%', maxWidth: 720, maxHeight: '90vh', overflowY: 'auto', borderRadius: '20px 20px 0 0', padding: 20 }}>
            <div style={{ fontSize: 16, color: TEXT, marginBottom: 16 }}>{editing.id ? '编辑模板' : '新增模板'}</div>
            <label style={{ display: 'block', fontSize: 13, color: SUB, marginBottom: 12 }}>
              模板名称
              <input value={form.template_name} onChange={(e) => setForm((f) => ({ ...f, template_name: e.target.value }))}
                style={{ width: '100%', marginTop: 6, padding: '10px 12px', borderRadius: 10, border: '1px solid #E8E8EA', fontSize: 14, boxSizing: 'border-box', outline: 'none' }} />
            </label>
            <label style={{ display: 'block', fontSize: 13, color: SUB, marginBottom: 12 }}>
              合同正文（粘贴带 {{占位符}} 的完整合同）
              <textarea value={form.template_content} onChange={(e) => setForm((f) => ({ ...f, template_content: e.target.value }))}
                placeholder="粘贴合同全文，机位/价格/新人信息用 {{groom_name}} 等占位符"
                style={{ width: '100%', marginTop: 6, minHeight: 320, padding: '12px', borderRadius: 10, border: '1px solid #E8E8EA', fontSize: 13, lineHeight: 1.7, boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' }} />
            </label>
            <label style={{ display: 'block', fontSize: 13, color: SUB, marginBottom: 12 }}>
              原版合同 PDF 备份（仅后台下载，不参与渲染）
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                {form.backup_word_url && <span style={{ fontSize: 12, color: '#3E9C8B', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>已上传备份</span>}
                <button onClick={() => document.getElementById('ct-backup').click()} disabled={uploading}
                  style={{ padding: '8px 14px', borderRadius: 10, border: '1px dashed #7ECDBB', background: '#fff', color: BRAND, fontSize: 13, cursor: 'pointer' }}>{uploading ? '上传中' : '上传 PDF'}</button>
                <input id="ct-backup" type="file" accept=".pdf" onChange={uploadBackup} style={{ display: 'none' }} />
              </div>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: SUB, cursor: 'pointer', marginBottom: 16 }}>
              <input type="checkbox" checked={form.is_default} onChange={(e) => setForm((f) => ({ ...f, is_default: e.target.checked }))} />
              设为默认模板（新建订单自动选中）
            </label>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={save} disabled={busy} style={{ flex: 1, padding: '12px 0', borderRadius: 12, background: BRAND, color: '#fff', fontSize: 15, border: 'none', cursor: 'pointer' }}>{busy ? '保存中' : '保存'}</button>
              <button onClick={() => setEditing(null)} style={{ flex: 1, padding: '12px 0', borderRadius: 12, background: '#F0F0F2', color: SUB, fontSize: 15, border: 'none', cursor: 'pointer' }}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
