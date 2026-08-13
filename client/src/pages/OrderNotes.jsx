import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import http from '../api.js';

const TEAL = '#7ECDBB';
const ORANGE = '#FF7A45';
const TAB_UNDERLINE = TEAL;
const BOX_BG = '#FFF8E5';
const BOX_BORDER = '#F2DFA0';

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

const IconBack = ({ color = '#fff' }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

const IconHelp = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#BBBBBB" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const IconPencil = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={TEAL} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

const IconSetting = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={TEAL} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

export default function OrderNotes() {
  const { id } = useParams();
  const nav = useNavigate();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('order'); // order=预约备注 / staff=员工备注
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState({
    birthday: '',
    appointment_remark: '',
    questionnaire_answers: '',
    internal_remark: '',
    external_remark: ''
  });

  useEffect(() => {
    http.get('/api/orders/' + id).then((r) => {
      const o = r.data || {};
      setOrder(o);
      let qa = o.questionnaire_answers || '';
      if (qa && typeof qa !== 'string') qa = JSON.stringify(qa, null, 2);
      setFields({
        birthday: o.birthday || '',
        appointment_remark: o.appointment_remark || '',
        questionnaire_answers: qa,
        internal_remark: o.internal_remark || '',
        external_remark: o.external_remark || ''
      });
    }).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  const setField = (k, v) => setFields((p) => ({ ...p, [k]: v }));

  const saveAll = async () => {
    if (!order) return;
    setSaving(true);
    try {
      const payload = {
        birthday: fields.birthday,
        appointment_remark: fields.appointment_remark,
        internal_remark: fields.internal_remark,
        external_remark: fields.external_remark,
        questionnaire_answers: fields.questionnaire_answers
      };
      await http.put('/api/orders/' + id, payload);
      setOrder((o) => ({ ...o, ...payload }));
      toast('保存成功');
    } catch (e) {
      toast(e.response?.data?.error || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const copyAll = () => {
    const lines = [];
    if (fields.birthday) lines.push('生日/纪念日：' + fields.birthday);
    if (fields.appointment_remark) lines.push('预约备注：' + fields.appointment_remark);
    if (fields.questionnaire_answers) lines.push('调查问卷：' + fields.questionnaire_answers);
    if (fields.internal_remark) lines.push('内部备注：' + fields.internal_remark);
    if (fields.external_remark) lines.push('外部备注：' + fields.external_remark);
    doCopy(lines.join('\n'));
  };

  const inviteQuestionnaire = () => {
    toast('问卷分享链接生成中，请稍到后后');
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#999' }}>加载中…</span>
      </div>
    );
  }

  const Section = ({ title, subtitle, value, onChange, placeholder, multiline = true }) => (
    <div style={{ padding: '20px 16px', borderBottom: '1px solid #F5F5F5' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 3, height: 16, borderRadius: 2, background: ORANGE }} />
          <span style={{ fontSize: 15, color: '#1f2329', fontWeight: 500 }}>{title}</span>
          {subtitle ? <span style={{ fontSize: 12, color: '#999' }}>{subtitle}</span> : null}
        </div>
      </div>
      <textarea value={value || ''} onChange={(e) => onChange(e.target.value)}
        rows={multiline ? 4 : 2}
        placeholder={placeholder}
        style={{ width: '100%', minHeight: 80, border: `1px dashed ${BOX_BORDER}`, borderRadius: 8, padding: 12, fontSize: 14, background: BOX_BG, color: '#333', outline: 'none', resize: 'vertical' }} />
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#fff', paddingBottom: 'calc(96px + env(safe-area-inset-bottom))' }}>
      {/* 顶栏（深色） */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50, height: 48, background: '#3F3F3F',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 12px'
      }}>
        <button onClick={() => nav(-1)} style={{ background: 'none', border: 'none', padding: 6, display: 'flex', alignItems: 'center', color: '#fff' }}>
          <IconBack color="#fff" />
        </button>
        <div style={{ fontSize: 16, color: '#fff' }}>编辑备注</div>
        <button onClick={saveAll} disabled={saving}
          style={{ background: 'none', border: 'none', color: '#fff', fontSize: 15, padding: '6px 4px' }}>
          {saving ? '保存中…' : '保存'}
        </button>
      </div>

      {/* Tab */}
      <div style={{ display: 'flex', background: '#fff', borderBottom: '1px solid #F5F5F5' }}>
        {[
          { k: 'order', label: '预约备注' },
          { k: 'staff', label: '员工备注' }
        ].map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)}
            style={{ flex: 1, padding: '14px 0 12px', background: 'none', border: 'none', position: 'relative', color: tab === t.k ? TEAL : '#666', fontSize: 15, fontWeight: tab === t.k ? 500 : 400 }}>
            {t.label}
            <span style={{ position: 'absolute', left: '50%', bottom: 0, transform: 'translateX(-50%)', width: tab === t.k ? 56 : 0, height: 2, background: TAB_UNDERLINE, borderRadius: 1, transition: 'width .2s' }} />
          </button>
        ))}
      </div>

      {/* 分区 */}
      {tab === 'order' && (
        <div>
          <Section
            title="生日/纪念日"
            value={fields.birthday}
            onChange={(v) => setField('birthday', v)}
            placeholder="未设置"
          />
          <Section
            title="预约备注"
            subtitle={<span title="客户在下单时可填写预约要求">?</span>}
            value={fields.appointment_remark}
            onChange={(v) => setField('appointment_remark', v)}
            placeholder="客户未填写"
          />
          <Section
            title="调查问卷"
            subtitle={<span title="调查问卷可在套系管理中配置">?</span>}
            value={fields.questionnaire_answers}
            onChange={(v) => setField('questionnaire_answers', v)}
            placeholder="未设置调查问卷"
          />
        </div>
      )}

      {tab === 'staff' && (
        <div>
          <Section
            title="内部备注"
            subtitle={<span style={{ color: '#999' }}>(该备注对客户不可见)</span>}
            value={fields.internal_remark}
            onChange={(v) => setField('internal_remark', v)}
            placeholder="未填写"
          />
          <Section
            title="外部备注"
            subtitle={<span style={{ color: '#999' }}>(该备注客户可见并支持打印)</span>}
            value={fields.external_remark}
            onChange={(v) => setField('external_remark', v)}
            placeholder="未填写"
          />
        </div>
      )}

      {/* 底部按钮 */}
      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, padding: '12px 16px calc(16px + env(safe-area-inset-bottom))',
        background: '#fff', borderTop: '1px solid #F5F5F5', display: 'flex', gap: 12, zIndex: 40
      }}>
        <button onClick={copyAll}
          style={{ flex: 1, padding: '12px 0', borderRadius: 4, border: `1px solid ${TEAL}`, background: '#fff', color: TEAL, fontSize: 15 }}>
          复制内容
        </button>
        <button onClick={inviteQuestionnaire}
          style={{ flex: 1.6, padding: '12px 0', borderRadius: 4, border: 'none', background: '#D8D8D8', color: '#999', fontSize: 15 }}>
          邀请客户填写问卷
        </button>
      </div>
    </div>
  );
}