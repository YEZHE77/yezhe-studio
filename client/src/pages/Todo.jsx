// Todo.jsx —— 待办事项页（独立待办系统 + 卡片 Tab 分类）
// 数据源：GET /api/todo（todo_items 表，含订单客户名/日期 JOIN）
// 交互：横向卡片 Tab 分类（已付定金/等待拍摄/待选片/精修中/待交付/重新生成合同/客户申请）
//      点击待办跳订单详情；「标记完成」归档（仅改待办状态，绝不动订单业务数据）
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import http from '../api.js';
import { avatarColor, avatarText } from '../utils/avatar.js';

const GREEN = '#7ECDBB';
const TEXT = '#1f2329';
const MUTED = '#999999';
const LINE = '#F0F0F0';

// 横向卡片 Tab 定义（key 对应 todo_type，accent 为底部色条颜色）
const TAB_DEFS = [
  { key: 'deposit', label: '已付定金', accent: '#FE2C55' },
  { key: 'waiting_shoot', label: '等待拍摄', accent: GREEN },
  { key: 'selecting', label: '待选片', accent: '#2DB7F5' },
  { key: 'retouching', label: '精修中', accent: '#FFB900' },
  { key: 'delivering', label: '待交付', accent: '#8C8C8C' },
  { key: 'regen_contract', label: '重新生成合同', accent: '#FF4D4F' },
  { key: 'order_request', label: '客户申请', accent: '#722ED1' }
];

function pad2(n) { return String(n).padStart(2, '0'); }

function todayInfo() {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const dow = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  return {
    ymd: `${y}-${pad2(m)}-${pad2(day)}`,
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
  const [loading, setLoading] = useState(true);
  const [activeKey, setActiveKey] = useState('deposit');
  const [showDone, setShowDone] = useState(false);
  const [lunar, setLunar] = useState('');
  const [busyId, setBusyId] = useState(null);
  const tabsScrollRef = useRef(null);
  const tabRefs = useRef({});

  const load = useCallback(() => {
    http.get('/api/todo')
      .then((r) => setItems(Array.isArray(r.data.list) ? r.data.list : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
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
  const activeList = pending.filter((t) => t.todo_type === activeKey);

  // 切换 Tab 时滚动到视口中央
  useEffect(() => {
    const el = tabRefs.current[activeKey];
    const scroller = tabsScrollRef.current;
    if (!el || !scroller) return;
    requestAnimationFrame(() => {
      const elRect = el.getBoundingClientRect();
      const scRect = scroller.getBoundingClientRect();
      const elCenter = elRect.left + elRect.width / 2;
      const scCenter = scRect.left + scRect.width / 2;
      scroller.scrollBy({ left: elCenter - scCenter, behavior: 'smooth' });
    });
  }, [activeKey]);

  const renderRow = (t) => {
    const name = (t.customer_name || t.groom_name || '客户').toString();
    const first = avatarText(name);
    return (
      <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 14px', borderBottom: '1px solid ' + LINE, background: '#fff' }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: avatarColor(name), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 500, flexShrink: 0 }}>{first}</div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4, cursor: 'pointer' }} onClick={() => t.order_id && nav('/orders/' + t.order_id)}>
          <span style={{ fontSize: 14, color: TEXT, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
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

      {/* 横向卡片 Tab 分类 */}
      <div style={{ background: '#fff', borderBottom: '1px solid ' + LINE }}>
        <div
          ref={tabsScrollRef}
          style={{
            display: 'flex', overflowX: 'auto', WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none', msOverflowStyle: 'none', touchAction: 'pan-x'
          }}
          className="todo-tabs-scroll"
        >
          {TAB_DEFS.map((t) => {
            const isActive = activeKey === t.key;
            const count = pending.filter((x) => x.todo_type === t.key).length;
            return (
              <button
                key={t.key}
                ref={(el) => { tabRefs.current[t.key] = el; }}
                type="button"
                onClick={() => setActiveKey(t.key)}
                style={{
                  flex: '0 0 auto', minWidth: 86,
                  padding: '12px 6px 10px', margin: 0, border: 0,
                  background: isActive ? GREEN : 'transparent',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                  position: 'relative', cursor: 'pointer', color: isActive ? '#fff' : TEXT
                }}
              >
                <span style={{ fontSize: 18, fontWeight: 600, lineHeight: 1 }}>{count || 0}</span>
                <span style={{ fontSize: 12, opacity: isActive ? 0.9 : 0.7 }}>{t.label}</span>
                {!isActive && (
                  <span style={{ position: 'absolute', left: '20%', right: '20%', bottom: 0, height: 3, background: t.accent, borderRadius: 2 }} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 待办列表 */}
      <div style={{ flex: 1, padding: '8px 12px 24px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: MUTED, padding: '40px 0', fontSize: 13 }}>加载中…</div>
        ) : activeList.length === 0 ? (
          <div style={{ textAlign: 'center', color: MUTED, padding: '40px 0', fontSize: 13 }}>暂无待办</div>
        ) : (
          <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden' }}>
            {activeList.map(renderRow)}
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

      {/* 隐藏滚动条 */}
      <style>{`.todo-tabs-scroll::-webkit-scrollbar{ display:none; }`}</style>
    </div>
  );
}