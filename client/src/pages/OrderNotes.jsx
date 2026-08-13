import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import http from '../api.js';

const TEAL = '#7ECDBB';
const GRAY = '#BBBBBB';

function toast(msg) {
  let el = document.getElementById('__order_notes_toast__');
  if (!el) {
    el = document.createElement('div');
    el.id = '__order_notes_toast__';
    el.style.cssText = 'position:fixed;left:50%;top:18%;transform:translateX(-50%);background:rgba(0,0,0,.8);color:#fff;padding:8px 16px;border-radius:6px;font-size:14px;z-index:3000;transition:opacity .3s;pointer-events:none;white-space:nowrap;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el.__t);
  el.__t = setTimeout(() => { el.style.opacity = '0'; }, 2400);
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0;';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); toast('已复制'); }
  catch (e) { toast('复制失败'); }
  document.body.removeChild(ta);
}

function doCopy(text) {
  if (!text) return toast('暂无内容可复制');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => toast('已复制')).catch(() => fallbackCopy(text));
  } else fallbackCopy(text);
}

const IconClose = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#7ECDBB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const IconBack = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

export default function OrderNotes() {
  const { id } = useParams();
  const nav = useNavigate();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [remark, setRemark] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    http.get('/api/orders/' + id).then((r) => {
      setOrder(r.data);
      setRemark(r.data?.remark || '');
    }).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  const saveRemark = async () => {
    if (!order) return;
    setSaving(true);
    try {
      await http.put('/api/orders/' + id, { remark });
      setOrder((o) => ({ ...o, remark }));
      setEditing(false);
      toast('保存成功');
    } catch (e) {
      toast(e.response?.data?.error || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#999' }}>加载中…</span>
      </div>
    );
  }

  const sections = [
    { key: 'remark', title: '订单备注', value: order?.remark },
    { key: 'birthday', title: '生日 / 纪念日', value: order?.birthday || '', empty: '未设置' },
    { key: 'appointment', title: '预约备注', value: order?.appointment_remark || '', empty: '客户未填写' },
    { key: 'questionnaire', title: '调查问卷', value: order?.questionnaire_answers ? '已填写' : '', empty: '未设置调查问卷' },
    { key: 'internal', title: '内部备注', value: order?.internal_remark || '', empty: '未填写' },
    { key: 'external', title: '外部备注', value: order?.external_remark || '', empty: '未填写' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#fff', paddingBottom: 'calc(24px + env(safe-area-inset-bottom))' }}>
      {/* 顶部 */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50, background: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', borderBottom: '1px solid #F5F5F5'
      }}>
        <button onClick={() => nav(-1)} style={{ background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center' }}><IconBack /></button>
        <div style={{ fontSize: 17, fontWeight: 500, color: '#1f2329' }}>订单备注</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => doCopy(order?.remark || '')} style={{ background: 'none', border: 'none', fontSize: 14, color: TEAL }}>复制</button>
          <button onClick={() => setEditing((v) => !v)} style={{ background: 'none', border: 'none', fontSize: 14, color: TEAL }}>{editing ? '取消' : '编辑'}</button>
        </div>
      </div>

      {/* 编辑区 */}
      {editing && (
        <div style={{ padding: 16, borderBottom: '1px solid #F5F5F5' }}>
          <textarea
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            placeholder="请输入订单备注…"
            style={{ width: '100%', minHeight: 120, border: '1px solid #E5E5E5', borderRadius: 8, padding: 12, fontSize: 14, outline: 'none', resize: 'vertical' }}
          />
          <button onClick={saveRemark} disabled={saving} style={{
            width: '100%', marginTop: 12, padding: '12px 0', borderRadius: 8, border: 'none',
            background: TEAL, color: '#fff', fontSize: 15
          }}>{saving ? '保存中…' : '保存'}</button>
        </div>
      )}

      {/* 内容区 */}
      <div style={{ padding: '20px 16px' }}>
        {sections.map((s) => (
          <div key={s.key} style={{ marginBottom: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{ width: 3, height: 16, borderRadius: 2, background: TEAL }} />
              <span style={{ fontSize: 15, color: '#1f2329', fontWeight: 500 }}>{s.title}</span>
            </div>
            <div style={{ paddingLeft: 11, fontSize: 14, color: s.value ? '#666' : GRAY, lineHeight: 1.6 }}>
              {s.value || s.empty}
            </div>
          </div>
        ))}
      </div>

      {/* 底部关闭 */}
      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 'calc(24px + env(safe-area-inset-bottom))', display: 'flex', justifyContent: 'center', zIndex: 40 }}>
        <button onClick={() => nav(-1)} style={{ background: 'none', border: 'none', padding: 8 }}><IconClose /></button>
      </div>
    </div>
  );
}
