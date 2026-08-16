import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import http from '../api.js';

// 移动端「消息」详情页 —— 二级页面（架构文档 /mobile/message/:messageId）
// 返回栏 / 完整标题+正文 / 业务跳转按钮（动态）/ 创建时间；进入即标记已读（后端处理）
const TEXT = '#1f2329';
const SUB = '#6E6E73';
const FAINT = '#AEAEB2';
const DIV = '#F0F0F2';
const GREEN = '#7ECDBB';

const BIZ_META = {
  select_photo: { label: '选片', color: '#2DB7F5', bg: 'rgba(45,183,245,0.12)' },
  schedule: { label: '日程', color: '#F5A623', bg: 'rgba(245,166,35,0.12)' },
  order: { label: '订单', color: '#7ECDBB', bg: 'rgba(126,205,187,0.16)' },
  system: { label: '系统', color: '#8E8E93', bg: 'rgba(142,142,147,0.12)' }
};

// 业务跳转按钮（按 biz_type 动态渲染；无关联业务则隐藏）
function bizAction(biz_type, biz_id) {
  switch (biz_type) {
    case 'select_photo': return biz_id ? { label: '查看选片任务', to: '/orders/' + biz_id } : null;
    case 'order': return biz_id ? { label: '查看订单', to: '/orders/' + biz_id } : null;
    case 'schedule': return biz_id ? { label: '查看摄影日程', to: '/schedule' } : null;
    case 'system': return null; // 备份导出暂不提供下载入口，隐藏按钮
    default: return null;
  }
}

function fmtFullTime(t) {
  if (!t) return '';
  const d = new Date(t);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function MobileMessageDetail() {
  const nav = useNavigate();
  const { messageId } = useParams();
  const [m, setM] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    http.get('/api/mobile/message/' + messageId)
      .then((r) => setM(r.data))
      .catch(() => setM(null))
      .finally(() => setLoading(false));
  }, [messageId]);

  const meta = m ? (BIZ_META[m.biz_type] || BIZ_META.system) : null;
  const action = m ? bizAction(m.biz_type, m.biz_id) : null;

  return (
    <div style={{ height: '100%', background: '#F5F5F7', display: 'flex', flexDirection: 'column' }}>
      {/* 返回导航栏 */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 44, padding: '0 12px', background: '#fff', borderBottom: `1px solid ${DIV}` }}>
        <button onClick={() => nav(-1)} aria-label="返回"
          style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', padding: 4, color: TEXT, display: 'flex', alignItems: 'center' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
        <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', fontSize: 17, color: TEXT, fontWeight: 500 }}>消息详情</div>
      </div>

      {/* 正文卡片 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 12px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: FAINT, fontSize: 13, padding: '60px 0' }}>加载中…</div>
        ) : !m ? (
          <div style={{ textAlign: 'center', color: FAINT, fontSize: 14, padding: '80px 0' }}>消息不存在或已删除</div>
        ) : (
          <div style={{ background: '#fff', borderRadius: 12, padding: '18px 16px' }}>
            {meta && <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 11, color: meta.color, background: meta.bg, marginBottom: 10 }}>{meta.label}</span>}
            <div style={{ fontSize: 17, color: TEXT, fontWeight: 500, lineHeight: 1.5 }}>{m.title}</div>
            <div style={{ fontSize: 11, color: FAINT, marginTop: 6 }}>{fmtFullTime(m.created_at)}</div>
            <div style={{ fontSize: 14, color: SUB, lineHeight: 1.8, marginTop: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.content || '（无正文）'}</div>

            {/* 业务跳转按钮 */}
            {action && (
              <button onClick={() => nav(action.to)}
                style={{ marginTop: 20, width: '100%', padding: '12px 0', borderRadius: 10, border: 'none', background: GREEN, color: '#fff', fontSize: 15, cursor: 'pointer' }}>
                {action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}