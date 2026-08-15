import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import http from '../api.js';

// ===== 消息中心（B 端管理员） =====
// 分组：customer_consult 顾客咨询 / order_msg 订单消息 / todo_alert 待办提醒 / system 系统通知
// 规则：点击单条已读；归档隐藏可切换；跳转容错（业务已删除提示）；H5 不调微信推送
const TYPE_META = {
  customer_consult: { label: '顾客咨询', color: '#FF8A5A', bg: 'rgba(255,138,90,0.12)' },
  order_msg: { label: '订单消息', color: '#2DB7F5', bg: 'rgba(45,183,245,0.12)' },
  todo_alert: { label: '待办提醒', color: '#F5A623', bg: 'rgba(245,166,35,0.12)' },
  system: { label: '系统通知', color: '#8E8E93', bg: 'rgba(142,142,147,0.12)' }
};

const BRAND = '#7ECDBB';
const TEXT = '#1D1D1F';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';

function fmtTime(t) {
  if (!t) return '';
  const d = new Date(t);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `${p(d.getHours())}:${p(d.getMinutes())}`;
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// rel_model → 跳转路径（跳转前容错校验，业务已删除则提示）
function navTarget(m) {
  switch (m.rel_model) {
    case 'order': return m.rel_id ? '/orders/' + m.rel_id : null;
    case 'customer': return '/customers';
    case 'package': return '/photo-packages';
    case 'appointment': return '/appointments';
    default: return null;
  }
}

export default function MessageCenter() {
  const nav = useNavigate();
  const [list, setList] = useState([]);
  const [type, setType] = useState('all');
  const [archived, setArchived] = useState(false);
  const [tip, setTip] = useState('');

  const load = useCallback(() => {
    http.get('/api/message', { params: { type: type === 'all' ? '' : type, archived: archived ? '1' : '' } })
      .then((r) => setList(r.data || []))
      .catch(() => setList([]));
  }, [type, archived]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 8000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [load]);

  const open = async (m) => {
    // 标记已读
    if (!m.is_read) {
      http.post('/api/message/' + m.id + '/read').then(() => setList((l) => l.map((x) => x.id === m.id ? { ...x, is_read: 1 } : x))).catch(() => {});
    }
    const target = navTarget(m);
    if (!target) { setTip('该消息无跳转目标'); setTimeout(() => setTip(''), 2000); return; }
    // 跳转容错：订单类校验业务是否存在
    if (m.rel_model === 'order' && m.rel_id) {
      try {
        await http.get('/api/orders/' + m.rel_id);
      } catch {
        setTip('该业务已被删除'); setTimeout(() => setTip(''), 2000); return;
      }
    }
    nav(target);
  };

  const toggleArchive = (m) => {
    http.post('/api/message/' + m.id + '/archive').then(() => load()).catch(() => {});
  };

  const types = [
    { key: 'all', label: '全部' },
    { key: 'customer_consult', label: '咨询' },
    { key: 'order_msg', label: '订单' },
    { key: 'todo_alert', label: '待办' },
    { key: 'system', label: '系统' }
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#F5F5F7', paddingBottom: 40 }}>
      {/* 顶部 */}
      <div style={{ background: '#fff', padding: '12px 16px', borderBottom: '1px solid #F0F0F2' }}>
        <div style={{ fontSize: 17, color: TEXT }}>消息中心</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, overflowX: 'auto' }}>
          {types.map((t) => (
            <button key={t.key} onClick={() => setType(t.key)}
              style={{ flex: '0 0 auto', padding: '6px 14px', borderRadius: 16, border: 'none', fontSize: 13, cursor: 'pointer', background: type === t.key ? BRAND : '#F0F0F2', color: type === t.key ? '#fff' : SUB }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tip && <div style={{ position: 'fixed', top: '20%', left: '50%', transform: 'translateX(-50%)', zIndex: 100, background: 'rgba(29,29,31,0.9)', color: '#fff', fontSize: 13, padding: '10px 18px', borderRadius: 18 }}>{tip}</div>}

      {/* 消息列表 */}
      <div style={{ padding: 12 }}>
        {!list.length && <div style={{ textAlign: 'center', color: FAINT, fontSize: 14, padding: '50px 0' }}>暂无消息</div>}
        {list.map((m) => {
          const meta = TYPE_META[m.message_type] || TYPE_META.system;
          return (
            <div key={m.id} onClick={() => open(m)}
              style={{ background: '#fff', borderRadius: 14, padding: '14px 16px', marginBottom: 10, cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.04)', opacity: m.is_read ? 0.75 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span style={{ flex: '0 0 auto', padding: '3px 8px', borderRadius: 6, fontSize: 11, color: meta.color, background: meta.bg }}>{meta.label}</span>
                  <span style={{ fontSize: 15, color: TEXT, fontWeight: m.is_read ? 400 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</span>
                  {!m.is_read && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#FF4D4F', flex: '0 0 auto' }} />}
                </div>
                <span style={{ flex: '0 0 auto', fontSize: 11, color: FAINT, marginLeft: 8 }}>{fmtTime(m.create_time)}</span>
              </div>
              <div style={{ fontSize: 13, color: SUB, marginTop: 6, lineHeight: 1.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.content}</div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <button onClick={(e) => { e.stopPropagation(); toggleArchive(m); }}
                  style={{ fontSize: 12, color: '#2DB7F5', background: 'none', border: 'none', cursor: 'pointer' }}>
                  {m.is_archived ? '取消归档' : '归档'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* 更多 + 惊喜任务 */}
      <div style={{ padding: '0 12px' }}>
        <div style={{ background: '#fff', borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
          <div style={{ padding: '13px 16px', fontSize: 13, color: SUB, borderBottom: '1px solid #F0F0F2', cursor: 'pointer' }} onClick={() => nav('/datacharts')}>访客 · 查看访客统计</div>
          <div style={{ padding: '13px 16px', fontSize: 13, color: SUB, borderBottom: '1px solid #F0F0F2', cursor: 'pointer' }} onClick={() => nav('/capacity')}>已用空间 · 查看 R2 存储用量</div>
          <div style={{ padding: '13px 16px', fontSize: 13, color: SUB }}>帮助中心 · 使用帮助文档</div>
        </div>

        <div style={{ background: '#fff', borderRadius: 14, padding: '14px 16px', marginTop: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: 13, color: SUB, marginBottom: 6 }}>惊喜任务</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 13, color: FAINT, flex: 1 }}>绑定微信（升级 web-view 小程序版本可接收微信消息提醒）</div>
            <button disabled style={{ padding: '6px 14px', borderRadius: 10, border: 'none', background: '#E8E8EA', color: '#AEAEB2', fontSize: 12, cursor: 'not-allowed' }}>已置灰</button>
          </div>
        </div>
      </div>
    </div>
  );
}
