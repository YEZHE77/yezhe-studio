import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import http from '../api.js';

// 移动端「名单管理」页 —— 黑名单 / 免打扰 共用（?type=blacklist | no-disturb）
// Glassmorphism + Soft-UI，禁止字体加粗
const TEXT = '#1f2329';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';
const DIV = '#EEF0F3';
const DANGER = '#E5484D';

const BackIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#1f2329" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

function fmtTime(t) {
  if (!t) return '—';
  const d = new Date(t);
  if (isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function VisitorBlacklist() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const type = params.get('type') === 'no-disturb' ? 'no-disturb' : 'blacklist';
  const isBlack = type === 'blacklist';
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addId, setAddId] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    http.get('/api/visitor/' + type).then((r) => setList(r.data.list || [])).catch(() => setList([])).finally(() => setLoading(false));
  }, [type]);

  useEffect(() => { load(); }, [load]);

  const remove = async (vid) => {
    try { await http.delete('/api/visitor/' + type + '/' + vid); load(); } catch {}
  };

  const add = async () => {
    const vid = addId.trim();
    if (!vid) return;
    try { await http.post('/api/visitor/' + type, { visitor_id: vid }); setAddId(''); load(); } catch {}
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #EEF1F5 0%, #F5F7FA 100%)', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部玻璃栏 */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'rgba(255,255,255,0.66)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.6)' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 44, padding: '0 12px' }}>
          <button onClick={() => nav(-1)} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center' }}><BackIcon /></button>
          <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', fontSize: 17, color: TEXT }}>{isBlack ? '黑名单' : '免打扰'}</div>
        </div>
        {/* 手动添加 */}
        <div style={{ display: 'flex', gap: 8, padding: '8px 12px 12px' }}>
          <input value={addId} onChange={(e) => setAddId(e.target.value)} placeholder={isBlack ? '输入访客ID 加入黑名单' : '输入访客ID 加入免打扰'}
            style={{ flex: 1, boxSizing: 'border-box', border: `1px solid ${DIV}`, borderRadius: 10, padding: '9px 12px', fontSize: 13, color: TEXT, outline: 'none', background: 'rgba(255,255,255,0.8)' }} />
          <button onClick={add} style={{ padding: '0 16px', borderRadius: 10, border: 'none', background: isBlack ? DANGER : '#4A9FD8', color: '#fff', fontSize: 13 }}>添加</button>
        </div>
      </div>

      {/* 名单列表 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 12px 24px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: FAINT, fontSize: 13, padding: '60px 0' }}>加载中…</div>
        ) : list.length === 0 ? (
          <div style={{ textAlign: 'center', color: FAINT, fontSize: 14, padding: '80px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
            暂无{isBlack ? '黑名单' : '免打扰'}访客
          </div>
        ) : (
          <div style={{ background: '#FFFFFF', borderRadius: 16, overflow: 'hidden', boxShadow: '0 8px 24px rgba(31,35,41,0.06), 0 1px 3px rgba(31,35,41,0.04)' }}>
            {list.map((r, i) => (
              <div key={r.visitor_id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: i < list.length - 1 ? `1px solid ${DIV}` : 'none' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.visitor_id}</div>
                  <div style={{ fontSize: 12, color: FAINT, marginTop: 3 }}>最后访问 {fmtTime(r.last_visit)}</div>
                </div>
                <button onClick={() => remove(r.visitor_id)} style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${DIV}`, background: '#fff', color: DANGER, fontSize: 12, flexShrink: 0 }}>移除</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
