// ConsistencyCheck.jsx —— 数据一致性巡检（B 端管理员）
// 手动触发一次巡检（POST /api/admin/consistency-check）+ 查看最近一次巡检异常清单（GET /api/admin/consistency-check/issues）
// 四类校验：档期冲突 / 精修超额 / 合同快照不匹配 / 套系开协议未绑模板
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import http from '../api.js';

const TYPE_META = {
  schedule_conflict: { label: '档期冲突', color: '#FF4D4F' },
  retouch_exceed: { label: '精修超额', color: '#FA8C16' },
  contract_stale: { label: '合同待更新', color: '#2DB7F5' },
  pkg_missing_template: { label: '套系未绑模板', color: '#722ED1' }
};

function useIsMobile() {
  const [m, setM] = useState(false);
  useEffect(() => {
    const on = () => setM(window.innerWidth < 768);
    on();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return m;
}

export default function ConsistencyCheck() {
  const nav = useNavigate();
  const isMobile = useIsMobile();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [tip, setTip] = useState('');

  const flash = (m) => { setTip(m); setTimeout(() => setTip(''), 2500); };

  const load = useCallback(() => {
    http.get('/api/admin/consistency-check/issues')
      .then((r) => setData(r.data || { issues: [] }))
      .catch(() => setData({ issues: [], check_run: null }))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const runCheck = async () => {
    setRunning(true);
    try {
      const r = await http.post('/api/admin/consistency-check');
      flash(r.data && r.data.total === 0 ? '巡检完成：未发现异常' : `巡检完成：发现 ${r.data.total} 处异常`);
      load();
    } catch (e) {
      flash('巡检失败：' + (e.response?.data?.error || e.message));
    } finally { setRunning(false); }
  };

  const issues = (data && data.issues) || [];
  const lastRun = data && data.check_run;

  const CARD = { background: '#fff', borderRadius: 12, padding: 16, marginBottom: 12 };
  const TITLE = { fontSize: isMobile ? 18 : 20, fontWeight: 600, color: '#1f2329' };

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: isMobile ? '12px 12px 40px' : '16px 16px 40px', minHeight: '100%', background: isMobile ? '#F8F8F8' : 'transparent' }}>
      {/* 顶部 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {isMobile && (
            <button onClick={() => nav(-1)} style={{ background: 'none', border: 'none', fontSize: 20, color: '#333', cursor: 'pointer', padding: 0, lineHeight: 1 }}>‹</button>
          )}
          <div>
            <h1 style={{ ...TITLE, margin: 0 }}>数据一致性巡检</h1>
            <p style={{ fontSize: 12, color: '#999', margin: '4px 0 0' }}>每日凌晨自动巡检 · 支持手动触发 · 异常入库并推送提醒</p>
          </div>
        </div>
        <button onClick={runCheck} disabled={running}
          style={{ padding: '9px 18px', borderRadius: 10, border: 'none', background: '#7ECDBB', color: '#fff', fontSize: 14, cursor: running ? 'not-allowed' : 'pointer', opacity: running ? 0.6 : 1 }}>
          {running ? '巡检中…' : '立即巡检'}
        </button>
      </div>

      {tip && <div style={{ position: 'fixed', top: '18%', left: '50%', transform: 'translateX(-50%)', zIndex: 200, background: 'rgba(29,29,31,0.9)', color: '#fff', fontSize: 13, padding: '10px 18px', borderRadius: 18 }}>{tip}</div>}

      {/* 巡检概览 */}
      <div style={CARD}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14, color: '#333' }}>最近一次巡检</span>
          <span style={{ fontSize: 13, color: '#999' }}>{lastRun ? new Date(lastRun).toLocaleString('zh-CN') : '尚未巡检'}</span>
        </div>
        <div style={{ marginTop: 12, fontSize: 15, color: issues.length ? '#FF4D4F' : '#10b981', fontWeight: 600 }}>
          {issues.length ? `发现 ${issues.length} 处异常` : '未发现异常 ✓'}
        </div>
      </div>

      {/* 异常清单 */}
      {loading ? (
        <div style={{ textAlign: 'center', color: '#999', fontSize: 14, padding: '60px 0' }}>加载中…</div>
      ) : issues.length === 0 ? (
        <div style={{ ...CARD, textAlign: 'center', color: '#999', fontSize: 14, padding: '48px 16px' }}>
          暂无异常记录。巡检会校验：档期冲突 / 精修超额 / 合同快照不匹配 / 套系未绑模板。
        </div>
      ) : (
        <div>
          {issues.map((it) => {
            const meta = TYPE_META[it.check_type] || { label: it.check_type, color: '#999' };
            return (
              <div key={it.id} style={CARD}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 4, color: '#fff', background: meta.color, flexShrink: 0 }}>{meta.label}</span>
                  <span style={{ fontSize: 12, color: '#999' }}>{it.rel_id ? '关联：' + it.rel_id : ''}</span>
                </div>
                <div style={{ fontSize: 14, color: '#333', lineHeight: 1.6 }}>{it.summary}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
