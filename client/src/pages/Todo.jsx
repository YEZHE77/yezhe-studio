// Todo.jsx —— 待办事项页（独立待办系统）
// 数据源：GET /api/todo（todo_items 表，含订单客户名/日期 JOIN）
// 交互：点击待办跳订单详情；「标记完成」归档（仅改待办状态，绝不动订单业务数据）
import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import http from '../api.js';
import { avatarColor, avatarText } from '../utils/avatar.js';

const GREEN = '#7ECDBB';
const TEXT = '#1f2329';
const MUTED = '#999999';
const LINE = '#F0F0F0';

// 待办类型 → 标签 + 颜色
const TYPE_META = {
  deposit: { label: '已付定金', color: '#FE2C55' },
  waiting_shoot: { label: '等待拍摄', color: GREEN },
  selecting: { label: '待选片', color: '#2DB7F5' },
  retouching: { label: '精修中', color: '#FFB900' },
  delivering: { label: '待交付', color: '#8C8C8C' },
  regen_contract: { label: '重新生成合同', color: '#FF4D4F' },
  order_request: { label: '客户申请', color: '#722ED1' }
};

function pad2(n) { return String(n).padStart(2, '0'); }

function todayInfo() {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const dow = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  return {
    monthKey: `${y}-${pad2(m)}`,
    big: pad2(day),
    monthName: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1],
    weekDay: dow,
  };
}

export default function Todo() {
  const nav = useNavigate();
  const [today] = useState(() => todayInfo());
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({ pending: 0, done: 0 });
  const [loading, setLoading] = useState(true);
  const [showDone, setShowDone] = useState(false);
  const [lunar, setLunar] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    http.get('/api/todo')
      .then((r) => {
        const list = Array.isArray(r.data.list) ? r.data.list : [];
        setItems(list);
        setCounts(r.data.counts || { pending: 0, done: 0 });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  // 切回前台刷新（配合订单状态流转后待办变化）
  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [load]);

  // 今日农历
  useEffect(() => {
    http.get('/api/schedules/lunar?month=' + today.monthKey)
      .then((r) => { const map = r.data || {}; setLunar(map[today.ymd] || ''); })
      .catch(() => {});
  }, [today.monthKey, today.ymd]);

  const markDone = async (t) => {
    if (busyId) return;
    setBusyId(t.id);
    try {
      await http.post('/api/todo/' + t.id + '/done');
      load();
    } catch (e) { alert((e.response && e.response.data && e.response.data.error) || '操作失败'); }
    finally { setBusyId(null); }
  };

  const pending = items.filter((t) => t.status === 'pending');
  const done = items.filter((t) => t.status === 'done');

  const renderRow = (t) => {
    const meta = TYPE_META[t.todo_type] || { label: t.todo_type, color: '#999' };
    const name = (t.customer_name || t.groom_name || '客户').toString();
    const first = avatarText(name);
    return (
      <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 14px', borderBottom: '1px solid ' + LINE, background: '#fff' }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: avatarColor(name), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 500, flexShrink: 0 }}>{first}</div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }} onClick={() => t.order_id && nav('/orders/' + t.order_id)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 3, color: '#fff', background: meta.color, flexShrink: 0 }}>{meta.label}</span>
            <span style={{ fontSize: 14, color: TEXT, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
          </div>
          <div style={{ fontSize: 12, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.content || t.title || ''}</div>
        </div>
        <div style={{ fontSize: 12, color: MUTED, whiteSpace: 'nowrap', flexShrink: 0, textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
          {(t.shoot_date || '').replace(/-/g, '.')}
          {t.status === 'pending' && (
            <button type="button" onClick={() => markDone(t)} disabled={busyId === t.id}
              style={{ fontSize: 12, padding: '3px 10px', borderRadius: 12, border: '1px solid ' + GREEN, color: GREEN, background: '#fff', cursor: busyId === t.id ? 'not-allowed' : 'pointer', opacity: busyId === t.id ? 0.5 : 1 }}>
              {busyId === t.id ? '…' : '标记完成'}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ minHeight: '100vh', background: '#F7F7F7', display: 'flex', flexDirection: 'column', width: '100%', maxWidth: 720, margin: '0 auto', boxShadow: '0 0 30px rgba(0,0,0,0.04)' }}>
      {/* 顶部标题栏 */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 20, background: '#1f1f1f', color: '#fff',
        paddingTop: 'env(safe-area-inset-top, 0px)', display: 'flex', alignItems: 'center', height: 44, padding: '0 12px'
      }}>
        <button onClick={() => nav(-1)} aria-label="返回"
          style={{ background: 'transparent', border: 0, padding: 6, marginRight: 4, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 16, fontWeight: 500, marginRight: 28 }}>待办事项</div>
      </div>

      {/* 日期卡片 */}
      <div style={{ background: 'linear-gradient(135deg, #2a2a2a 0%, #3a3a3a 100%)', color: '#fff', padding: '14px 16px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 36, fontWeight: 600, lineHeight: 1, letterSpacing: -1 }}>{today.big}</span>
          <span style={{ fontSize: 13, color: '#cfcfcf' }}>{today.monthName}</span>
        </div>
        <div style={{ width: 1, height: 30, background: 'rgba(255,255,255,0.18)' }} />
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: 13, color: '#cfcfcf', lineHeight: 1.6 }}>
          <span>{lunar || '加载中…'}</span>
          <span>{today.weekDay}</span>
        </div>
      </div>

      {/* 待办计数条 */}
      <div style={{ display: 'flex', gap: 8, padding: '10px 12px 0' }}>
        <span style={{ fontSize: 12, color: GREEN, background: 'rgba(126,205,187,0.12)', padding: '3px 10px', borderRadius: 10 }}>待处理 {counts.pending || pending.length}</span>
        <span style={{ fontSize: 12, color: MUTED, background: '#f0f0f0', padding: '3px 10px', borderRadius: 10 }}>已归档 {counts.done || done.length}</span>
      </div>

      {/* 待办列表 */}
      <div style={{ flex: 1, padding: '8px 12px 24px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: MUTED, padding: '40px 0', fontSize: 13 }}>加载中…</div>
        ) : pending.length === 0 ? (
          <div style={{ textAlign: 'center', color: MUTED, padding: '40px 0', fontSize: 13 }}>暂无待办</div>
        ) : (
          <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden' }}>
            {pending.map(renderRow)}
          </div>
        )}

        {/* 已归档（折叠） */}
        {done.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <button type="button" onClick={() => setShowDone((v) => !v)}
              style={{ width: '100%', padding: '10px 0', background: 'none', border: 'none', color: MUTED, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <span>{showDone ? '收起' : '展开'}已归档（{done.length}）</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: showDone ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}><polyline points="6 9 12 15 18 9"></polyline></svg>
            </button>
            {showDone && (
              <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', opacity: 0.7 }}>
                {done.map(renderRow)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}