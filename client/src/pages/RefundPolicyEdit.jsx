// RefundPolicyEdit.jsx —— 退订政策编辑页（B 端管理员，从套系编辑 MRow 跳转进入）
// 路由 /packages/:id/refund/edit
// 字段：hide_refund / refund_policy / refund_policy_lax_text / refund_policy_strict_text
// 切换：toggle/radio 立即乐观更新+防抖；文案点「编辑」进 textarea，点「保存」PUT
import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import http from '../api.js';
import { FIELD_LAX, FIELD_STRICT, normalizePolicy, getRefundText } from '../utils/refundPolicy.js';

const MRED = '#FF4D4F';
const MGRAY = '#999999';
const MTEXT = '#1f2329';
const MBG = '#FAFAFA';
const MBORDER = '#F0F0F0';

function IconBack() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

// 自定义红色 toggle
function Toggle({ checked, onChange }) {
  return (
    <button type="button" role="switch" aria-checked={!!checked}
      onClick={() => onChange(!checked)}
      style={{
        width: 44, height: 26, borderRadius: 13,
        background: checked ? MRED : '#E5E5E5',
        border: 'none', padding: 0, position: 'relative',
        cursor: 'pointer', transition: 'background .2s'
      }}>
      <span style={{
        position: 'absolute', top: 3, left: checked ? 21 : 3,
        width: 20, height: 20, borderRadius: '50%', background: '#fff',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left .2s'
      }} />
    </button>
  );
}

export default function RefundPolicyEdit() {
  const { id } = useParams();
  const nav = useNavigate();

  // ★ 所有 hooks 必须无条件、连续调用（React #310 修复）
  const [pkg, setPkg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tip, setTip] = useState('');
  const [tipKey, setTipKey] = useState(0);
  // 文案编辑 state 提前到 early-return 之前
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [editingBusy, setEditingBusy] = useState(false);
  // policy 提升为 state，便于 useEffect 同步 + 切换 policy 时立即更新
  const [policy, setPolicy] = useState('严格');
  const saveTimerRef = useRef(null);

  const flash = (m) => { setTip(m); setTipKey((k) => k + 1); setTimeout(() => setTip(''), 2000); };

  // 加载套系
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    http.get('/api/packages/' + id)
      .then((r) => setPkg(r.data || null))
      .catch(() => setPkg(null))
      .finally(() => setLoading(false));
  }, [id]);

  // pkg 变化时同步 policy / draft（draft 仅在加载完成 + 切换 policy 时重置）
  useEffect(() => {
    if (!pkg) return;
    const next = normalizePolicy(pkg.details && pkg.details.refund_policy);
    setPolicy((prev) => {
      if (prev !== next) setDraft(getRefundText(pkg.details || {}, next));
      return next;
    });
  }, [pkg]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: MBG, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: MGRAY, fontSize: 13 }}>加载中…</div>
      </div>
    );
  }

  if (!pkg) {
    return (
      <div style={{ minHeight: '100vh', background: MBG, paddingTop: 80, textAlign: 'center' }}>
        <div style={{ fontSize: 14, color: MGRAY }}>套系不存在或已删除</div>
        <button onClick={() => nav('/packages')} style={{ marginTop: 16, fontSize: 14, color: '#07C160', background: 'none', border: 'none', cursor: 'pointer' }}>返回套系列表</button>
      </div>
    );
  }

  const d = pkg.details || {};
  const hideRefund = !!d.hide_refund;
  const currentText = getRefundText(d, policy);

  // 防抖保存：保留 details 全部字段，仅覆盖本次修改
  const scheduleSave = (patch) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setPkg((p) => p ? { ...p, details: { ...p.details, ...patch } } : p);
    saveTimerRef.current = setTimeout(async () => {
      try {
        const nextDetails = { ...d, ...patch };
        await http.put('/api/packages/' + id, { details: nextDetails });
        setPkg((p) => p ? { ...p, details: nextDetails } : p);
        flash('已保存');
      } catch (e) {
        flash('保存失败');
      }
    }, 500);
  };

  const toggleVisible = (v) => scheduleSave({ hide_refund: v });
  const selectPolicy = (v) => {
    if (v === policy) return;
    setPolicy(v);
    setDraft(getRefundText(d, v)); // 切换 policy 立即用新策略的文案初始化 draft
    scheduleSave({ refund_policy: v });
  };

  const openEdit = () => { setDraft(currentText); setEditing(true); };
  const cancelEdit = () => { setDraft(currentText); setEditing(false); };
  const saveEdit = async () => {
    if (editingBusy) return;
    const key = policy === '宽松' ? FIELD_LAX : FIELD_STRICT;
    setEditingBusy(true);
    try {
      await http.put('/api/packages/' + id, { details: { ...d, [key]: draft } });
      setPkg((p) => p ? { ...p, details: { ...p.details, [key]: draft } } : p);
      setEditing(false);
      flash('已保存');
    } catch (e) {
      flash('保存失败');
    } finally {
      setEditingBusy(false);
    }
  };

  const handleDone = () => { nav(-1); };

  // 渲染当前 policy 文案（每行一段）
  const paragraphs = currentText ? currentText.split('\n').filter(Boolean) : [];

  return (
    <div style={{ minHeight: '100vh', background: MBG, paddingBottom: 32 }}>
      {/* 顶部导航：返回 + 退订政策 + 完成 */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50, background: '#fff',
        height: 48, display: 'flex', alignItems: 'center', padding: '0 12px',
        borderBottom: '1px solid ' + MBORDER
      }}>
        <button type="button" onClick={() => nav(-1)} aria-label="返回"
          style={{ width: 36, height: 36, background: 'none', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}>
          <IconBack />
        </button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 16, fontWeight: 600, color: MTEXT }}>
          退订政策
        </div>
        <button type="button" onClick={handleDone}
          style={{ background: 'none', border: 'none', color: MTEXT, fontSize: 15, cursor: 'pointer', padding: '4px 8px' }}>
          完成
        </button>
      </div>

      {/* 提示条 */}
      {tip && (
        <div key={tipKey} style={{ position: 'fixed', top: '18%', left: '50%', transform: 'translateX(-50%)', zIndex: 200, background: 'rgba(29,29,31,0.9)', color: '#fff', fontSize: 13, padding: '8px 16px', borderRadius: 18 }}>
          {tip}
        </div>
      )}

      {/* 是否展示退订政策 */}
      <div style={{ margin: '12px 12px 0', background: '#fff', borderRadius: 10, padding: '14px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid #EFEFEF' }}>
        <span style={{ fontSize: 15, color: MTEXT }}>是否展示退订政策</span>
        <Toggle checked={!hideRefund} onChange={toggleVisible} />
      </div>

      {/* 宽松 / 严格 两栏选择 */}
      <div style={{ margin: '12px 12px 0', background: '#fff', borderRadius: 10, overflow: 'hidden', border: '1px solid #EFEFEF' }}>
        <div style={{ display: 'flex', borderBottom: '1px solid #F5F5F5' }}>
          {['宽松', '严格'].map((opt) => {
            const active = policy === opt;
            return (
              <button key={opt} type="button" onClick={() => selectPolicy(opt)}
                style={{
                  flex: 1, padding: '14px 0', fontSize: 15,
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: active ? MRED : MTEXT,
                  fontWeight: active ? 600 : 400,
                  borderBottom: active ? '2px solid ' + MRED : '2px solid transparent',
                  transition: 'all .15s'
                }}>
                {opt}
              </button>
            );
          })}
        </div>
        {/* 当前选中类型的文案（可编辑：点编辑进 textarea） */}
        <div style={{ padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 15, color: MTEXT, fontWeight: 600, flex: 1 }}>{policy}</span>
            {!editing && (
              <button type="button" onClick={openEdit}
                style={{ background: 'none', border: 'none', color: '#07C160', fontSize: 13, cursor: 'pointer' }}>
                编辑
              </button>
            )}
          </div>
          {editing ? (
            <div>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="请填写退订条款，每行一段"
                rows={5}
                style={{
                  width: '100%', resize: 'vertical', fontSize: 13, lineHeight: 1.7,
                  padding: '10px 12px', borderRadius: 8,
                  border: '1px solid #E5E5E5', background: '#FAFAFA',
                  boxSizing: 'border-box', color: MTEXT, outline: 'none', fontFamily: 'inherit'
                }}
              />
              <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                <button type="button" onClick={cancelEdit} disabled={editingBusy}
                  style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid #E5E5E5', background: '#fff', fontSize: 14, color: MGRAY, cursor: editingBusy ? 'not-allowed' : 'pointer' }}>
                  取消
                </button>
                <button type="button" onClick={saveEdit} disabled={editingBusy}
                  style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', background: MRED, color: '#fff', fontSize: 14, fontWeight: 500, cursor: editingBusy ? 'not-allowed' : 'pointer', opacity: editingBusy ? 0.6 : 1 }}>
                  {editingBusy ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: '#555', lineHeight: 1.8 }}>
              {paragraphs.length === 0 ? (
                <div style={{ color: MGRAY, fontSize: 13 }}>未填写，点击右上「编辑」添加条款</div>
              ) : (
                paragraphs.map((line, i, arr) => (
                  <div key={i} style={{ marginBottom: i < arr.length - 1 ? 6 : 0 }}>{line}</div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <div style={{ margin: '16px 14px 0', padding: '10px 14px', background: '#F5F9FA', borderRadius: 6, fontSize: 12, color: MGRAY, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <span>💡</span>
        <span>关闭「是否展示」后，套系预览页面将不再显示退订政策区块；切换「宽松 / 严格」立即生效。</span>
      </div>
    </div>
  );
}