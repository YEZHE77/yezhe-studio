import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import http from '../api.js';

// 移动端「订单消息」二级页 —— 从消息页点击【订单消息】进入
// 规范：Glassmorphism 玻璃顶栏 + Soft-UI 卡片；禁止字体加粗，仅灰度/字号/间距分层
// 顶部：返回 + 标题 + ⋯ 菜单（批量标记已读 / 清空消息）
// 分类卡片：仅「订单消息 / 预约消息」两个入口（营销通知已移除）
// 列表：时间倒序、分页滚动加载；点击按 sub_type 跳转订单详情或预约管理，并标记已读
const TEXT = '#1f2329';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';
const DIV = '#EEF0F3';
const DANGER = '#E5484D';
const BRAND = '#4A9FD8';

function fmtTime(t) {
  if (!t) return '';
  const d = new Date(t);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `${p(d.getHours())}:${p(d.getMinutes())}`;
  if (d.getFullYear() === now.getFullYear()) return `${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const MoreIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#1f2329" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="5" r="1" fill="#1f2329" /><circle cx="12" cy="12" r="1" fill="#1f2329" /><circle cx="12" cy="19" r="1" fill="#1f2329" />
  </svg>
);
const BackIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#1f2329" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

export default function OrderMessages() {
  const nav = useNavigate();
  const [tab, setTab] = useState('order'); // 'order' 订单消息 | 'reserve' 预约消息
  const [list, setList] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const listRef = useRef(null);

  const pageSize = 20;

  // 当前 tab 的筛选参数：订单消息 = 排除预约；预约消息 = 仅预约
  const queryOf = (t) => t === 'reserve'
    ? { biz_type: 'order', sub_type: 'reserve' }
    : { biz_type: 'order', sub_type_not: 'reserve' };

  const load = useCallback(async (p = 1, append = false) => {
    if (append) setLoadingMore(true); else setLoading(true);
    try {
      const r = await http.get('/api/mobile/message/list', { params: { page: p, pageSize, ...queryOf(tab) } });
      const rows = Array.isArray(r.data.list) ? r.data.list : [];
      setList((prev) => (append ? [...prev, ...rows] : rows));
      setTotal(r.data.total || 0);
      setHasMore(p * pageSize < (r.data.total || 0));
      setPage(p);
    } catch { if (!append) setList([]); }
    finally { setLoading(false); setLoadingMore(false); }
  }, [tab]);

  useEffect(() => { load(1); }, [load]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el || loadingMore || !hasMore) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) load(page + 1, true);
  };

  // 点击消息：标记已读 + 按 sub_type 跳转（reserve → 预约管理；其余 → 订单详情）
  const onItemClick = (m) => {
    http.put('/api/mobile/message/' + m.id + '/read').catch(() => {});
    setList((prev) => prev.map((x) => (x.id === m.id ? { ...x, is_read: 1 } : x)));
    if (m.sub_type === 'reserve') nav('/appointments');
    else if (m.biz_id) nav('/orders/' + m.biz_id);
    else nav('/appointments');
  };

  const markAllRead = async () => {
    try { await http.put('/api/mobile/message/read-all', { params: queryOf(tab) }); load(1); } catch {}
    setMenuOpen(false);
  };

  const clearAll = async () => {
    setMenuOpen(false);
    if (!window.confirm('确定清空当前分类的全部消息？此操作不可恢复。')) return;
    try { await http.delete('/api/mobile/message/clear', { params: queryOf(tab) }); load(1); } catch {}
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'linear-gradient(180deg, #EEF1F5 0%, #F5F7FA 100%)' }}>
      {/* 顶部玻璃栏 */}
      <div style={{ position: 'sticky', top: 0, zIndex: 20, background: 'rgba(255,255,255,0.66)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.6)' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 44, padding: '0 12px' }}>
          <button onClick={() => nav(-1)} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center' }}><BackIcon /></button>
          <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', fontSize: 17, color: TEXT }}>订单消息</div>
          <button onClick={() => setMenuOpen((v) => !v)} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center' }}><MoreIcon /></button>

          {/* 更多菜单弹层 */}
          {menuOpen && (
            <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', right: 12, top: 40, zIndex: 30, background: '#fff', borderRadius: 12, boxShadow: '0 12px 36px rgba(31,35,41,0.14)', overflow: 'hidden', minWidth: 160 }}>
              <button onClick={markAllRead} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '13px 16px', background: '#fff', border: 'none', fontSize: 14, color: TEXT, borderBottom: `1px solid ${DIV}` }}>批量标记已读</button>
              <button onClick={clearAll} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '13px 16px', background: '#fff', border: 'none', fontSize: 14, color: DANGER }}>清空消息</button>
            </div>
          )}
        </div>

        {/* 分类卡片：仅订单消息 / 预约消息（营销通知已移除） */}
        <div style={{ display: 'flex', gap: 8, padding: '8px 12px 12px' }}>
          {[{ key: 'order', label: '订单消息' }, { key: 'reserve', label: '预约消息' }].map((t) => (
            <button key={t.key} onClick={() => { setTab(t.key); setMenuOpen(false); }}
              style={{ padding: '6px 18px', borderRadius: 16, border: 'none', fontSize: 13, cursor: 'pointer', background: tab === t.key ? BRAND : 'rgba(255,255,255,0.7)', color: tab === t.key ? '#fff' : SUB }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* 消息列表 */}
      <div ref={listRef} onScroll={onScroll} style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '4px 12px 24px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: FAINT, fontSize: 13, padding: '60px 0' }}>加载中…</div>
        ) : list.length === 0 ? (
          <div style={{ textAlign: 'center', color: FAINT, fontSize: 14, padding: '80px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
            暂无消息
          </div>
        ) : (
          <div style={{ background: '#FFFFFF', borderRadius: 16, overflow: 'hidden', boxShadow: '0 8px 24px rgba(31,35,41,0.06), 0 1px 3px rgba(31,35,41,0.04)' }}>
            {list.map((m, i) => (
              <button key={m.id} onClick={() => onItemClick(m)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '15px 16px', border: 'none', background: '#fff', textAlign: 'left', cursor: 'pointer', borderBottom: i < list.length - 1 ? `1px solid ${DIV}` : 'none' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <span style={{ fontSize: 15, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</span>
                    {!m.is_read && <span style={{ width: 8, height: 8, borderRadius: '50%', background: DANGER, flex: '0 0 auto' }} />}
                  </div>
                  {m.content && <div style={{ fontSize: 13, color: SUB, marginTop: 5, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{m.content}</div>}
                </div>
                <span style={{ flex: '0 0 auto', fontSize: 11, color: FAINT, alignSelf: 'flex-start', marginTop: 2 }}>{fmtTime(m.created_at)}</span>
              </button>
            ))}
          </div>
        )}

        {loadingMore && <div style={{ textAlign: 'center', color: FAINT, fontSize: 12, padding: '12px 0' }}>加载中…</div>}
        {!hasMore && list.length > 0 && <div style={{ textAlign: 'center', color: FAINT, fontSize: 12, padding: '12px 0' }}>没有更多了</div>}
      </div>
    </div>
  );
}
