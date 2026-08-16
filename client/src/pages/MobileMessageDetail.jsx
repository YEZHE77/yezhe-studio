import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import http from '../api.js';

// 移动端「消息」详情页 —— 二级页面（/mobile/message/:messageId）
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

// 业务按钮描述：无关联业务返回 null（隐藏）；system 备份返回 download 类型
function bizAction(biz_type, biz_id) {
  switch (biz_type) {
    case 'select_photo': return biz_id ? { label: '查看选片任务', kind: 'order', id: biz_id } : null;
    case 'order': return biz_id ? { label: '查看订单', kind: 'order', id: biz_id } : null;
    case 'schedule': return biz_id ? { label: '查看摄影日程', kind: 'schedule', id: biz_id } : null;
    case 'system': return biz_id ? { label: '下载备份文件', kind: 'download', id: biz_id } : null;
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
  const [bizDeleted, setBizDeleted] = useState(false); // 关联业务已删除 → 按钮置灰
  const [downloading, setDownloading] = useState(false);

  // 拉取详情（后端自动置已读）
  useEffect(() => {
    http.get('/api/mobile/message/' + messageId)
      .then((r) => {
        setM(r.data);
        // 通知底部 Tab 刷新未读角标（多端同步）
        try { window.dispatchEvent(new CustomEvent('biz-message-read')); } catch {}
      })
      .catch(() => setM(null))
      .finally(() => setLoading(false));
  }, [messageId]);

  // 校验关联业务是否存在（订单/日程）；已删除则按钮置灰
  useEffect(() => {
    if (!m) return;
    const action = bizAction(m.biz_type, m.biz_id);
    if (!action) return;
    if (action.kind === 'order') {
      http.get('/api/orders/' + action.id).then(() => setBizDeleted(false)).catch(() => setBizDeleted(true));
    } else if (action.kind === 'schedule') {
      http.get('/api/schedules/' + action.id).then(() => setBizDeleted(false)).catch(() => setBizDeleted(true));
    }
  }, [m]);

  const action = m ? bizAction(m.biz_type, m.biz_id) : null;
  const meta = m ? (BIZ_META[m.biz_type] || BIZ_META.system) : null;

  // 下载备份文件（system 类型）
  const downloadBackup = async () => {
    if (!action || downloading) return;
    setDownloading(true);
    try {
      const r = await http.get('/api/mobile/message/backup/' + action.id, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = action.id;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert((e.response && e.response.data && e.response.data.error) || '下载失败');
    } finally { setDownloading(false); }
  };

  const onClickAction = () => {
    if (!action) return;
    if (action.kind === 'download') { downloadBackup(); return; }
    if (bizDeleted) return; // 业务已删除，置灰不可点
    if (action.kind === 'order') nav('/orders/' + action.id);
    else if (action.kind === 'schedule') nav('/schedule');
  };

  return (
    <div style={{ height: '100%', background: '#F5F5F7', display: 'flex', flexDirection: 'column' }}>
      {/* 返回导航栏 */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 44, padding: '0 12px', background: '#fff', borderBottom: `1px solid ${DIV}` }}>
        <button onClick={() => nav(-1)} aria-label="返回"
          style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', padding: 4, color: TEXT, display: 'flex', alignItems: 'center' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
        <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', fontSize: 17, color: TEXT, fontWeight: 400 }}>消息详情</div>
      </div>

      {/* 正文卡片 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 12px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: FAINT, fontSize: 13, padding: '60px 0' }}>加载中…</div>
        ) : !m ? (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
            <div style={{ fontSize: 14, color: FAINT }}>消息不存在或已删除</div>
            <button onClick={() => nav(-1)}
              style={{ marginTop: 20, padding: '10px 28px', borderRadius: 10, border: 'none', background: GREEN, color: '#fff', fontSize: 14, cursor: 'pointer' }}>
              返回消息列表
            </button>
          </div>
        ) : (
          <div style={{ background: '#fff', borderRadius: 12, padding: '18px 16px' }}>
            {meta && <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 11, color: meta.color, background: meta.bg, marginBottom: 10 }}>{meta.label}</span>}
            <div style={{ fontSize: 17, color: TEXT, fontWeight: 400, lineHeight: 1.5 }}>{m.title}</div>
            <div style={{ fontSize: 11, color: FAINT, marginTop: 6 }}>{fmtFullTime(m.created_at)}</div>
            <div style={{ fontSize: 14, color: SUB, lineHeight: 1.8, marginTop: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.content || '（无正文）'}</div>

            {/* 业务操作按钮 */}
            {action && (
              <button onClick={onClickAction} disabled={action.kind !== 'download' && bizDeleted}
                style={{
                  marginTop: 20, width: '100%', padding: '12px 0', borderRadius: 10, border: 'none',
                  background: (action.kind !== 'download' && bizDeleted) ? '#E8E8EA' : GREEN,
                  color: (action.kind !== 'download' && bizDeleted) ? '#AEAEB2' : '#fff',
                  fontSize: 15, cursor: (action.kind !== 'download' && bizDeleted) ? 'not-allowed' : 'pointer'
                }}>
                {downloading ? '下载中…' : (action.kind !== 'download' && bizDeleted ? '业务已删除' : action.label)}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}