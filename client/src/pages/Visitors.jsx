import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import http from '../api.js';

// 移动端「访客列表」页 —— Glassmorphism + Soft-UI，禁止字体加粗
// 顶部：返回 + 搜索框 + 帮助 + 设置齿轮；列表按日期分组、时间倒序、分页加载
// 已彻底删除：VIP 底部弹窗、开通 VIP 按钮、最多查看 10 条限制（展示全部访客记录）
const TEXT = '#1f2329';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';
const DIV = '#EEF0F3';
const BRAND = '#4A9FD8';

const BackIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#1f2329" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);
const SearchIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#AEAEB2" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" />
  </svg>
);
const HelpIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#1f2329" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);
const GearIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#1f2329" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

function fmtDay(t) {
  if (!t) return '更早';
  const d = new Date(t);
  if (isNaN(d.getTime())) return '更早';
  const p = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const today = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  const y = new Date(now.getTime() - 86400000);
  const yesterday = `${y.getFullYear()}-${p(y.getMonth() + 1)}-${p(y.getDate())}`;
  const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  if (day === today) return '今天';
  if (day === yesterday) return '昨天';
  if (d.getFullYear() === now.getFullYear()) return `${p(d.getMonth() + 1)}月${p(d.getDate())}日`;
  return `${d.getFullYear()}年${p(d.getMonth() + 1)}月${p(d.getDate())}日`;
}
function fmtClock(t) {
  if (!t) return '';
  const d = new Date(t);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
function shortVid(vid) {
  return vid && vid.length > 12 ? vid.slice(0, 12) + '…' : (vid || '');
}
// 访问页面 → 友好行为文案
function pageLabel(page) {
  const p = page || '';
  if (p.includes('/home')) return '浏览微官网首页';
  if (p.includes('/works')) return '浏览作品';
  if (p.includes('/package')) return '浏览套系';
  if (p.includes('/appointment')) return '提交预约';
  if (p.includes('/customer-order')) return '查看订单';
  return '访问 ' + (p || '页面');
}

export default function Visitors() {
  const nav = useNavigate();
  const [list, setList] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [q, setQ] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const listRef = useRef(null);
  const pageSize = 30;

  const load = useCallback(async (p = 1, append = false, keyword = q) => {
    if (append) setLoadingMore(true); else setLoading(true);
    try {
      const r = await http.get('/api/visitor/list', { params: { page: p, pageSize, q: keyword } });
      const rows = Array.isArray(r.data.list) ? r.data.list : [];
      setList((prev) => (append ? [...prev, ...rows] : rows));
      setTotal(r.data.total || 0);
      setHasMore(p * pageSize < (r.data.total || 0));
      setPage(p);
    } catch { if (!append) setList([]); }
    finally { setLoading(false); setLoadingMore(false); }
  }, [q]);

  useEffect(() => { load(1); }, [load]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el || loadingMore || !hasMore) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) load(page + 1, true);
  };

  // 按日期分组
  const groups = [];
  for (const item of list) {
    const key = item.visit_time ? String(item.visit_time).slice(0, 10) : '__';
    const g = groups[groups.length - 1];
    if (g && g.key === key) g.items.push(item);
    else groups.push({ key, items: [item] });
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'linear-gradient(180deg, #EEF1F5 0%, #F5F7FA 100%)' }}>
      {/* 顶部玻璃栏：返回 + 搜索框 + 帮助 + 设置 */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'rgba(255,255,255,0.66)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 48, padding: '0 12px' }}>
          <button onClick={() => nav(-1)} style={{ background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center', flexShrink: 0 }}><BackIcon /></button>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.8)', borderRadius: 10, padding: '0 10px', height: 32 }}>
            <SearchIcon />
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') load(1, false, q); }} placeholder="搜索访客ID"
              style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: TEXT }} />
          </div>
          <button onClick={() => setHelpOpen(true)} style={{ background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center', flexShrink: 0 }}><HelpIcon /></button>
          <button onClick={() => nav('/visitor-settings')} style={{ background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center', flexShrink: 0 }}><GearIcon /></button>
        </div>
      </div>

      {/* 列表（按日期分组） */}
      <div ref={listRef} onScroll={onScroll} style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '8px 12px 24px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: FAINT, fontSize: 13, padding: '60px 0' }}>加载中…</div>
        ) : list.length === 0 ? (
          <div style={{ textAlign: 'center', color: FAINT, fontSize: 14, padding: '80px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>👣</div>
            暂无访客记录
          </div>
        ) : (
          <>
            {groups.map((g) => (
              <div key={g.key}>
                <div style={{ fontSize: 13, color: SUB, padding: '10px 4px 6px' }}>{fmtDay(g.items[0].visit_time)}</div>
                <div style={{ background: '#FFFFFF', borderRadius: 16, overflow: 'hidden', boxShadow: '0 8px 24px rgba(31,35,41,0.06), 0 1px 3px rgba(31,35,41,0.04)' }}>
                  {g.items.map((m, i) => (
                    <button key={m.id} onClick={() => nav('/visitor/' + encodeURIComponent(m.visitor_id))}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', border: 'none', background: '#fff', textAlign: 'left', cursor: 'pointer', borderBottom: i < g.items.length - 1 ? `1px solid ${DIV}` : 'none' }}>
                      <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#EAF3FB', color: BRAND, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>访</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortVid(m.visitor_id)}</div>
                        <div style={{ fontSize: 12, color: FAINT, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pageLabel(m.visit_page)}</div>
                      </div>
                      <span style={{ fontSize: 11, color: FAINT, flexShrink: 0 }}>{fmtClock(m.visit_time)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {loadingMore && <div style={{ textAlign: 'center', color: FAINT, fontSize: 12, padding: '12px 0' }}>加载中…</div>}
            {!hasMore && <div style={{ textAlign: 'center', color: FAINT, fontSize: 12, padding: '12px 0' }}>共 {total} 条访客记录 · 没有更多了</div>}
          </>
        )}
      </div>

      {/* 帮助弹窗 */}
      {helpOpen && (
        <div onClick={() => setHelpOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 320, boxShadow: '0 16px 48px rgba(0,0,0,0.16)' }}>
            <div style={{ fontSize: 15, color: TEXT, marginBottom: 10 }}>访客说明</div>
            <div style={{ fontSize: 13, color: SUB, lineHeight: 1.7 }}>
              访客记录来自 C 端微官网的访问埋点，以浏览器设备标识区分访客。本项目为 H5 网页，无法获取访客微信昵称与手机号。全部访客记录无数量限制。
            </div>
            <button onClick={() => setHelpOpen(false)} style={{ width: '100%', marginTop: 16, padding: '10px', borderRadius: 10, border: 'none', background: BRAND, color: '#fff', fontSize: 14 }}>知道了</button>
          </div>
        </div>
      )}
    </div>
  );
}
