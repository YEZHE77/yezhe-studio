import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import http from '../api.js';

// 移动端「消息」列表页 —— 一级页面（架构文档 /mobile/message）
// 标题+全部已读 / 筛选(全部·未读·已读) / 卡片列表(分页) / 左滑删除 / 空态
// 规则：列表不自动置已读；仅进详情页标记单条已读
const GREEN = '#7ECDBB';
const TEXT = '#1f2329';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';
const DIV = '#F0F0F2';
const DANGER = '#FF4D4F';

// 业务来源 → 标签 + 颜色
const BIZ_META = {
  select_photo: { label: '选片', color: '#2DB7F5', bg: 'rgba(45,183,245,0.12)' },
  schedule: { label: '日程', color: '#F5A623', bg: 'rgba(245,166,35,0.12)' },
  order: { label: '订单', color: '#7ECDBB', bg: 'rgba(126,205,187,0.16)' },
  system: { label: '系统', color: '#8E8E93', bg: 'rgba(142,142,147,0.12)' }
};

function fmtTime(t) {
  if (!t) return '';
  const d = new Date(t);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `${p(d.getHours())}:${p(d.getMinutes())}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  if (sameYear) return `${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function MobileMessage() {
  const nav = useNavigate();
  const [list, setList] = useState([]);
  const [readStatus, setReadStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);
  const listRef = useRef(null);
  // 左滑删除：记录当前滑开的卡片 id 与位移
  const [swipedId, setSwipedId] = useState(null);
  const touchRef = useRef(null);

  const pageSize = 20;

  const load = useCallback(async (p = 1, append = false) => {
    if (append) setLoadingMore(true); else setLoading(true);
    try {
      const r = await http.get('/api/mobile/message/list', { params: { page: p, pageSize, read_status: readStatus } });
      const rows = Array.isArray(r.data.list) ? r.data.list : [];
      setList((prev) => (append ? [...prev, ...rows] : rows));
      setTotal(r.data.total || 0);
      setHasMore(p * pageSize < (r.data.total || 0));
      setPage(p);
    } catch { if (!append) setList([]); }
    finally { setLoading(false); setLoadingMore(false); }
  }, [readStatus]);

  useEffect(() => { load(1); }, [load]);

  // 上滑加载更多（滚动到底部）
  const onScroll = () => {
    const el = listRef.current;
    if (!el || loadingMore || !hasMore) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
      load(page + 1, true);
    }
  };

  // 下拉刷新（触顶再下拉）
  const onTouchStart = (e) => { if (listRef.current && listRef.current.scrollTop <= 0) touchRef.current = e.touches[0].clientY; };
  const onTouchEnd = (e) => {
    if (touchRef.current == null) return;
    const dy = e.changedTouches[0].clientY - touchRef.current;
    touchRef.current = null;
    if (dy > 80 && listRef.current && listRef.current.scrollTop <= 0) load(1);
  };

  const markAllRead = async () => {
    if (markingAll) return;
    setMarkingAll(true);
    try {
      await http.put('/api/mobile/message/read-all');
      load(1);
    } catch {}
    finally { setMarkingAll(false); }
  };

  const removeMsg = async (id) => {
    try {
      await http.delete('/api/mobile/message/' + id);
      setList((prev) => prev.filter((x) => x.id !== id));
      setTotal((t) => Math.max(0, t - 1));
    } catch {}
    setSwipedId(null);
  };

  // 左滑手势
  const onItemTouchStart = (e, id) => {
    const t = e.touches[0];
    touchRef.current = { id, x: t.clientX, y: t.clientY };
  };
  const onItemTouchMove = (e) => {
    const cur = touchRef.current;
    if (!cur) return;
    const dx = e.touches[0].clientX - cur.x;
    const dy = e.touches[0].clientY - cur.y;
    if (Math.abs(dx) > Math.abs(dy) && dx < 0) {
      // 左滑：露出删除按钮
      const translate = Math.max(-80, dx);
      const el = e.currentTarget;
      el.style.transform = `translateX(${translate}px)`;
      el.style.transition = 'none';
    }
  };
  const onItemTouchEnd = (e, id) => {
    const cur = touchRef.current;
    if (!cur || cur.id !== id) return;
    const el = e.currentTarget;
    const dx = cur.x - (touchEndX(e) || cur.x);
    touchRef.current = null;
    el.style.transition = 'transform .2s';
    if (dx > 40) { setSwipedId(id); el.style.transform = 'translateX(-80px)'; }
    else { setSwipedId(null); el.style.transform = 'translateX(0)'; }
  };
  const touchEndX = (e) => (e.changedTouches && e.changedTouches[0] && e.changedTouches[0].clientX) || null;

  const FILTERS = [
    { key: 'all', label: '全部' },
    { key: 'unread', label: '未读' },
    { key: 'read', label: '已读' }
  ];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#F5F5F7' }}>
      {/* 顶部栏：标题 + 全部标为已读 */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 44, padding: '0 12px', background: '#fff', borderBottom: `1px solid ${DIV}` }}>
        <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', fontSize: 17, color: TEXT, fontWeight: 500 }}>消息</div>
        <button onClick={markAllRead} disabled={markingAll}
          style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', padding: 4, fontSize: 13, color: markingAll ? FAINT : GREEN, cursor: 'pointer' }}>
          全部标为已读
        </button>
      </div>

      {/* 筛选标签 */}
      <div style={{ background: '#fff', display: 'flex', gap: 8, padding: '8px 12px', borderBottom: `1px solid ${DIV}` }}>
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => { setReadStatus(f.key); load(1); }}
            style={{ padding: '5px 16px', borderRadius: 16, border: 'none', fontSize: 13, cursor: 'pointer', background: readStatus === f.key ? GREEN : '#F0F0F2', color: readStatus === f.key ? '#fff' : SUB }}>
            {f.label}
          </button>
        ))}
      </div>

      {/* 消息列表 */}
      <div ref={listRef} onScroll={onScroll} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
        style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '10px 12px 24px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: FAINT, fontSize: 13, padding: '60px 0' }}>加载中…</div>
        ) : list.length === 0 ? (
          <div style={{ textAlign: 'center', color: FAINT, fontSize: 14, padding: '80px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
            暂无消息
          </div>
        ) : (
          <>
            {list.map((m) => {
              const meta = BIZ_META[m.biz_type] || BIZ_META.system;
              return (
                <div key={m.id} style={{ position: 'relative', marginBottom: 10, overflow: 'hidden', borderRadius: 12 }}>
                  {/* 删除按钮（左滑露出） */}
                  <button onClick={() => removeMsg(m.id)}
                    style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 80, background: DANGER, color: '#fff', fontSize: 14, border: 'none', cursor: 'pointer' }}>
                    删除
                  </button>
                  {/* 卡片主体（左滑位移） */}
                  <div
                    onClick={() => { if (swipedId === m.id) { setSwipedId(null); return; } nav('/m/msg/' + m.id); }}
                    onTouchStart={(e) => onItemTouchStart(e, m.id)}
                    onTouchMove={onItemTouchMove}
                    onTouchEnd={(e) => onItemTouchEnd(e, m.id)}
                    style={{ position: 'relative', background: '#fff', padding: '14px 16px', transform: swipedId === m.id ? 'translateX(-80px)' : 'translateX(0)', transition: 'transform .2s', touchAction: 'pan-y' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <span style={{ flex: '0 0 auto', padding: '2px 8px', borderRadius: 6, fontSize: 11, color: meta.color, background: meta.bg }}>{meta.label}</span>
                        <span style={{ fontSize: 15, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</span>
                        {!m.is_read && <span style={{ width: 8, height: 8, borderRadius: '50%', background: DANGER, flex: '0 0 auto' }} />}
                      </div>
                      <span style={{ flex: '0 0 auto', fontSize: 11, color: FAINT, marginLeft: 8 }}>{fmtTime(m.created_at)}</span>
                    </div>
                    {m.content && <div style={{ fontSize: 13, color: SUB, marginTop: 6, lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{m.content}</div>}
                  </div>
                </div>
              );
            })}
            {loadingMore && <div style={{ textAlign: 'center', color: FAINT, fontSize: 12, padding: '12px 0' }}>加载中…</div>}
            {!hasMore && list.length > 0 && <div style={{ textAlign: 'center', color: FAINT, fontSize: 12, padding: '12px 0' }}>没有更多了</div>}
          </>
        )}
      </div>
    </div>
  );
}