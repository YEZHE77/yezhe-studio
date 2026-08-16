import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import http, { img } from '../api.js';

// ===== 套系中心（公开页）：展示所有公开套系给顾客查看报价 =====
// 只读，无编辑；右上角「分享」分享整个页面（复制链接 / 系统分享）
// 顾客不可修改；点击卡片进入单套系详情（/package?token=）
const BRAND = '#7ECDBB';
const TEXT = '#1D1D1F';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';
const DIV = '#F0F0F2';

const ShareIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#1f2329" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
    <polyline points="16 6 12 2 8 6" />
    <line x1="12" y1="2" x2="12" y2="15" />
  </svg>
);

export default function PackageCenter() {
  const nav = useNavigate();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tip, setTip] = useState('');

  useEffect(() => {
    http.get('/api/photo-package/public-list')
      .then((r) => setList(r.data.list || []))
      .catch(() => setList([]))
      .finally(() => setLoading(false));
  }, []);

  const flash = (m) => { setTip(m); setTimeout(() => setTip(''), 2200); };

  const sharePage = async () => {
    const url = window.location.origin + '/package-center';
    const title = '套系报价 · YEZHE WORKSHOP';
    if (navigator.share) {
      try { await navigator.share({ title, url }); } catch { /* 用户取消 */ }
    } else if (navigator.clipboard) {
      try { await navigator.clipboard.writeText(url); flash('链接已复制，可发给顾客查看'); } catch { flash(url); }
    } else {
      flash(url);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#fff', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部：标题 + 右上角分享 */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: '#fff', borderBottom: `1px solid ${DIV}` }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 44, padding: '0 12px' }}>
          <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', fontSize: 17, color: TEXT }}>套系中心</div>
          <button onClick={sharePage} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', padding: 4, display: 'flex', alignItems: 'center' }} aria-label="分享"><ShareIcon /></button>
        </div>
      </div>

      {tip && (
        <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'rgba(0,0,0,0.78)', color: '#fff', fontSize: 13, padding: '10px 16px', borderRadius: 8, zIndex: 100, whiteSpace: 'nowrap' }}>{tip}</div>
      )}

      {/* 套系列表（只读报价） */}
      <div style={{ flex: 1, padding: '12px 12px 24px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: FAINT, fontSize: 13, padding: '60px 0' }}>加载中…</div>
        ) : list.length === 0 ? (
          <div style={{ textAlign: 'center', color: FAINT, fontSize: 14, padding: '80px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📷</div>
            暂无公开套系
          </div>
        ) : (
          list.map((p) => (
            <button key={p.id} onClick={() => nav('/package?token=' + encodeURIComponent(p.share_token || ''))}
              style={{ width: '100%', display: 'flex', gap: 14, padding: 14, marginBottom: 12, background: '#fff', border: `1px solid ${DIV}`, borderRadius: 14, textAlign: 'left', cursor: 'pointer', alignItems: 'stretch' }}>
              {/* 封面 */}
              <div style={{ width: 92, height: 92, borderRadius: 10, background: '#F5F5F7', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {p.cover_image ? (
                  <img src={img(p.cover_image)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <span style={{ fontSize: 28, color: '#D8D8DC' }}>📷</span>
                )}
              </div>
              {/* 信息 */}
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ fontSize: 16, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.package_name}</div>
                <div style={{ fontSize: 17, color: BRAND, marginTop: 6 }}>
                  ¥{Number(p.price || 0).toLocaleString()}
                  {Number(p.additional_price || 0) > 0 && <span style={{ fontSize: 12, color: FAINT }}> 起</span>}
                </div>
                {p.package_desc && (
                  <div style={{ fontSize: 12, color: FAINT, marginTop: 6, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.package_desc}</div>
                )}
                {p.photo_total > 0 && (
                  <div style={{ fontSize: 12, color: SUB, marginTop: 6 }}>{p.photo_total} 张 · {p.retouch_count || 0} 张精修</div>
                )}
              </div>
            </button>
          ))
        )}
      </div>

      {/* 底部联系提示 */}
      <div style={{ textAlign: 'center', fontSize: 12, color: FAINT, padding: '12px 0 20px' }}>如需预订，请联系摄影师 · 报价仅供参考</div>
    </div>
  );
}
