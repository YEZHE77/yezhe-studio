import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import http from '../api.js';

// 移动端「访客详情」页 —— Glassmorphism + Soft-UI，禁止字体加粗
// 展示完整访问轨迹 + 黑名单/免打扰状态与操作
const TEXT = '#1f2329';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';
const DIV = '#EEF0F3';
const DANGER = '#E5484D';
const BRAND = '#4A9FD8';

const BackIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#1f2329" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

function fmtTime(t) {
  if (!t) return '';
  const d = new Date(t);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function pageLabel(page) {
  const p = page || '';
  if (p.includes('/home')) return '浏览微官网首页';
  if (p.includes('/works')) return '浏览作品';
  if (p.includes('/package')) return '浏览套系';
  if (p.includes('/appointment')) return '提交预约';
  if (p.includes('/customer-order')) return '查看订单';
  return '访问 ' + (p || '页面');
}

export default function VisitorDetail() {
  const nav = useNavigate();
  const { visitorId } = useParams();
  const vid = decodeURIComponent(visitorId || '');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    http.get('/api/visitor/' + encodeURIComponent(vid)).then((r) => setData(r.data)).catch(() => setData(null)).finally(() => setLoading(false));
  }, [vid]);

  useEffect(() => { load(); }, [load]);

  const toggleBlacklist = async () => {
    try {
      if (data.is_blacklist) await http.delete('/api/visitor/blacklist/' + encodeURIComponent(vid));
      else await http.post('/api/visitor/blacklist', { visitor_id: vid });
      load();
    } catch {}
  };
  const toggleNoDisturb = async () => {
    try {
      if (data.is_no_disturb) await http.delete('/api/visitor/no-disturb/' + encodeURIComponent(vid));
      else await http.post('/api/visitor/no-disturb', { visitor_id: vid });
      load();
    } catch {}
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #EEF1F5 0%, #F5F7FA 100%)', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部玻璃栏 */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'rgba(255,255,255,0.66)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.6)' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 44, padding: '0 12px' }}>
          <button onClick={() => nav(-1)} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center' }}><BackIcon /></button>
          <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', fontSize: 17, color: TEXT }}>访客详情</div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: FAINT, fontSize: 13, padding: '60px 0' }}>加载中…</div>
      ) : !data ? (
        <div style={{ textAlign: 'center', color: FAINT, fontSize: 14, padding: '80px 0' }}>访客不存在</div>
      ) : (
        <>
          {/* 访客信息 + 操作 */}
          <div style={{ background: '#FFFFFF', margin: '12px', borderRadius: 16, padding: 16, boxShadow: '0 8px 24px rgba(31,35,41,0.06), 0 1px 3px rgba(31,35,41,0.04)' }}>
            <div style={{ fontSize: 12, color: FAINT }}>访客标识</div>
            <div style={{ fontSize: 16, color: TEXT, marginTop: 4, wordBreak: 'break-all' }}>{vid}</div>
            <div style={{ fontSize: 12, color: FAINT, marginTop: 8 }}>累计访问 {data.count} 次</div>
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button onClick={toggleBlacklist}
                style={{ flex: 1, padding: '10px', borderRadius: 10, border: `1px solid ${data.is_blacklist ? DANGER : DIV}`, background: data.is_blacklist ? '#FDEBEB' : '#fff', color: data.is_blacklist ? DANGER : SUB, fontSize: 13 }}>
                {data.is_blacklist ? '移出黑名单' : '加入黑名单'}
              </button>
              <button onClick={toggleNoDisturb}
                style={{ flex: 1, padding: '10px', borderRadius: 10, border: `1px solid ${data.is_no_disturb ? BRAND : DIV}`, background: data.is_no_disturb ? '#EAF3FB' : '#fff', color: data.is_no_disturb ? BRAND : SUB, fontSize: 13 }}>
                {data.is_no_disturb ? '取消免打扰' : '设为免打扰'}
              </button>
            </div>
          </div>

          {/* 访问轨迹 */}
          <div style={{ fontSize: 13, color: SUB, padding: '4px 16px 8px' }}>访问轨迹</div>
          <div style={{ background: '#FFFFFF', margin: '0 12px 20px', borderRadius: 16, overflow: 'hidden', boxShadow: '0 8px 24px rgba(31,35,41,0.06), 0 1px 3px rgba(31,35,41,0.04)' }}>
            {data.logs.length === 0 ? (
              <div style={{ textAlign: 'center', color: FAINT, fontSize: 13, padding: '40px 0' }}>暂无访问记录</div>
            ) : (
              data.logs.map((l, i) => (
                <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: i < data.logs.length - 1 ? `1px solid ${DIV}` : 'none' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, color: TEXT }}>{pageLabel(l.visit_page)}</div>
                    <div style={{ fontSize: 12, color: FAINT, marginTop: 3 }}>{fmtTime(l.visit_time)} · {l.source || 'h5'}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
