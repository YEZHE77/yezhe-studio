import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import http from '../api.js';
import { getServiceAgreement, getPhotoAuthAgreement } from '../utils/customerAgreement.js';

/* ============================================================
   顾客协议编辑页（B 端管理员，从套系编辑 MRow 跳转进入）
   —— 路由 /packages/:id/agreement/edit
   —— 与之前的 /packages/:id/agreement 查看页不同：这里是 toggle+textarea 完整编辑
   —— 数据来源 GET /api/packages/:id（details JSON 包含 enabled/required/content 字段）
   —— 字段：
       customer_agreement_enabled       服务协议 toggle
       signature_required               手写签名 toggle
       customer_agreement               服务协议内容（向后兼容）
       photo_authorization_agreement    照片授权协议内容
   —— 交互：toggle 立即乐观更新；文本默认只读，点「编辑」进 textarea，点「保存」PUT
   ============================================================ */

const MGREEN = '#07C160';
const MRED = '#FA5151';
const MGRAY = '#999999';
const MTEXT = '#1f2329';
const MBG = '#FAFAFA';
const MBORDER = '#F0F0F0';
const ORANGE = '#FA8C16';

function IconBack() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function IconHelp() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#bbb" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function IconEdit() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7ECDBB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

// 移动端自定义 Toggle（避免依赖问题；与现有 PackageEdit 的 MSwitch 风格一致）
function Toggle({ checked, onChange, accent = MGREEN }) {
  return (
    <button type="button" role="switch" aria-checked={!!checked}
      onClick={() => onChange(!checked)}
      style={{
        width: 44, height: 26, borderRadius: 13,
        background: checked ? accent : '#E5E5E5',
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

// 单个协议区块：默认只读，点击「编辑」进入 textarea 模式
function ProtocolBlock({ title, content, defaultSigned, onSave, placeholder }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content || '');
  const [busy, setBusy] = useState(false);

  const openEdit = () => { setDraft(content || ''); setEditing(true); };
  const cancel = () => { setEditing(false); setDraft(content || ''); };
  const save = async () => {
    setBusy(true);
    try {
      await onSave(draft);
      setEditing(false);
    } catch (e) {
      alert('保存失败：' + (e.message || '未知错误'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', border: '1px solid #EFEFEF' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px 14px' }}>
        <span style={{ width: 3, height: 16, background: ORANGE, borderRadius: 2, marginRight: 10, flexShrink: 0 }} />
        <span style={{ fontSize: 15, color: MTEXT, fontWeight: 500 }}>{title}</span>
        {defaultSigned ? (
          <span style={{ marginLeft: 8, fontSize: 11, color: MGRAY }}>（默认签署）</span>
        ) : null}
        <span style={{ flex: 1 }} />
        {!editing && (
          <button type="button" onClick={openEdit}
            style={{ background: 'none', border: 'none', color: '#7ECDBB', fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <IconEdit />
            <span>编辑</span>
          </button>
        )}
      </div>
      {editing ? (
        <div style={{ padding: '0 14px 14px' }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder || '请填写协议条款内容'}
            rows={6}
            style={{
              width: '100%', resize: 'vertical', fontSize: 13, lineHeight: 1.7,
              padding: '10px 12px', borderRadius: 8,
              border: '1px dashed ' + ORANGE, background: '#FFFAF0',
              boxSizing: 'border-box', color: MTEXT, outline: 'none', fontFamily: 'inherit'
            }}
          />
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <button type="button" onClick={cancel} disabled={busy}
              style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid #E5E5E5', background: '#fff', fontSize: 14, color: MGRAY, cursor: busy ? 'not-allowed' : 'pointer' }}>
              取消
            </button>
            <button type="button" onClick={save} disabled={busy}
              style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', background: MGREEN, color: '#fff', fontSize: 14, fontWeight: 500, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1 }}>
              {busy ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      ) : (
        content ? (
          <div style={{
            margin: '0 14px 14px', padding: '10px 12px', border: '1px dashed ' + ORANGE, borderRadius: 8,
            background: '#FFFAF0', fontSize: 13, color: MTEXT, lineHeight: 1.7,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', minHeight: 60
          }}>
            {content}
          </div>
        ) : (
          <div style={{ margin: '0 14px 14px', padding: '14px 12px', border: '1px dashed ' + '#E5E5E5', borderRadius: 8, textAlign: 'center', color: MGRAY, fontSize: 13 }}>
            未填写，点击右上「编辑」添加协议内容
          </div>
        )
      )}
    </div>
  );
}

export default function CustomerAgreementEdit() {
  const { id } = useParams();
  const nav = useNavigate();
  const [pkg, setPkg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tip, setTip] = useState('');
  const [tipKey, setTipKey] = useState(0);
  const [contractTemplates, setContractTemplates] = useState([]);
  const flash = (m) => { setTip(m); setTipKey((k) => k + 1); setTimeout(() => setTip(''), 2000); };
  // 防抖保存 toggle：避免快速点击触发多次 PUT
  const saveTimerRef = useRef(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    http.get('/api/packages/' + id)
      .then((r) => setPkg(r.data || null))
      .catch(() => setPkg(null))
      .finally(() => setLoading(false));
    // 拉取协议模板列表（绑定下拉用）
    http.get('/api/contract/templates').then((r) => setContractTemplates(r.data || [])).catch(() => setContractTemplates([]));
  }, [id]);

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
        <button onClick={() => nav('/packages')} style={{ marginTop: 16, fontSize: 14, color: MGREEN, background: 'none', border: 'none', cursor: 'pointer' }}>返回套系列表</button>
      </div>
    );
  }

  const d = pkg.details || {};
  const packageName = pkg.name || pkg.title || '';
  const agreementEnabled = !!d.customer_agreement_enabled;
  const signatureRequired = !!d.signature_required;
  const serviceAgreementContent = getServiceAgreement(d);
  const photoAuthContent = getPhotoAuthAgreement(d);

  // 合并保存：保留 details 全部字段，仅覆盖当前修改的字段
  const saveDetails = async (patch) => {
    const nextDetails = { ...d, ...patch };
    try {
      await http.put('/api/packages/' + id, { details: nextDetails });
      setPkg({ ...pkg, details: nextDetails });
      flash('已保存');
    } catch (e) {
      throw e;
    }
  };

  // toggle 立即乐观更新 + 防抖 PUT
  const toggleAgreement = (v) => {
    // 开启协议但未绑定模板 → 拦截提示（PRD 场景1.3：开启合同未绑定模板无法保存）
    if (v && !(pkg?.contract_template_id)) {
      alert('请先在下拉中绑定「协议模板」，再开启服务协议。');
      return;
    }
    setPkg((p) => p ? { ...p, details: { ...p.details, customer_agreement_enabled: v } } : p);
    scheduleSave({ customer_agreement_enabled: v });
  };
  const toggleSignature = (v) => {
    setPkg((p) => p ? { ...p, details: { ...p.details, signature_required: v } } : p);
    scheduleSave({ signature_required: v });
  };
  const scheduleSave = (patch) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
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

  // 协议模板绑定（packages.contract_template_id 独立字段，不在 details 里）
  const contractTemplateId = pkg?.contract_template_id ?? null;
  const changeTemplate = (v) => {
    const newId = v ? parseInt(v, 10) : null;
    setPkg((p) => p ? { ...p, contract_template_id: newId } : p);
    http.put('/api/packages/' + id, { contract_template_id: newId })
      .then(() => flash('已保存'))
      .catch(() => flash('保存失败'));
  };

  return (
    <div style={{ minHeight: '100vh', background: MBG, paddingBottom: 32 }}>
      {/* 顶部导航 */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50, background: '#fff',
        height: 48, display: 'flex', alignItems: 'center', padding: '0 12px',
        borderBottom: '1px solid ' + MBORDER
      }}>
        <button type="button" onClick={() => nav(-1)} aria-label="返回"
          style={{ width: 36, height: 36, background: 'none', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}>
          <IconBack />
        </button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 16, fontWeight: 600, color: MTEXT, marginRight: 36 }}>
          顾客协议
        </div>
      </div>

      {/* 提示条 */}
      {tip && (
        <div key={tipKey} style={{ position: 'fixed', top: '18%', left: '50%', transform: 'translateX(-50%)', zIndex: 200, background: 'rgba(29,29,31,0.9)', color: '#fff', fontSize: 13, padding: '8px 16px', borderRadius: 18 }}>
          {tip}
        </div>
      )}

      {/* 套系名（让用户知道是为哪个套系设置） */}
      {packageName ? (
        <div style={{ margin: '12px 12px 0', padding: '10px 14px', background: '#fff', borderRadius: 10, fontSize: 13, color: MGRAY, lineHeight: 1.6 }}>
          <span style={{ color: MTEXT }}>{packageName}</span>
        </div>
      ) : null}

      {/* Toggles */}
      <div style={{ margin: '12px 12px 0', background: '#fff', borderRadius: 10, overflow: 'hidden', border: '1px solid #EFEFEF' }}>
        {/* 服务协议 toggle */}
        <div style={{ padding: '14px 14px 12px', borderBottom: '1px solid #F5F5F5' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 15, color: MTEXT }}>服务协议</span>
            <Toggle checked={agreementEnabled} onChange={toggleAgreement} />
          </div>
          <div style={{ fontSize: 12, color: MGRAY, marginTop: 8, lineHeight: 1.6 }}>
            开启后，客户需同意协议才可在小程序进行预约
          </div>
          {/* 协议模板绑定：开关开启后出现（绑定一套合同模板，订单生成 PDF 用） */}
          {agreementEnabled && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, color: '#666', marginBottom: 6 }}>协议模板（生成合同 PDF 用）</div>
              {contractTemplates.length ? (
                <select
                  value={contractTemplateId ?? ''}
                  onChange={(e) => changeTemplate(e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #E8E8E8', fontSize: 14, background: '#fff', outline: 'none' }}
                >
                  <option value="">未绑定模板</option>
                  {contractTemplates.map((t) => (
                    <option key={t.id} value={t.id}>{t.template_name}{t.is_default ? '（默认）' : ''}</option>
                  ))}
                </select>
              ) : (
                <div style={{ fontSize: 13, color: MGRAY }}>暂无合同模板，请先到「合同模板管理」创建</div>
              )}
            </div>
          )}
        </div>
        {/* 手写签名 toggle + ? */}
        <div style={{ padding: '14px 14px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 15, color: MTEXT }}>手写签名</span>
              <span
                title="开启后客户在预约时需要在协议上手写签名确认"
                style={{ width: 18, height: 18, borderRadius: '50%', background: '#F5F5F5', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'help' }}
              >
                <IconHelp />
              </span>
            </div>
            <Toggle checked={signatureRequired} onChange={toggleSignature} />
          </div>
          <div style={{ fontSize: 12, color: MGRAY, marginTop: 8, lineHeight: 1.6 }}>
            开启后客户在预约时需要手写签名确认
          </div>
        </div>
      </div>

      {/* 协议区块 */}
      <div style={{ margin: '12px 12px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <ProtocolBlock
          title="服务协议"
          content={serviceAgreementContent}
          defaultSigned={false}
          onSave={(text) => saveDetails({ customer_agreement: text })}
          placeholder="例：在预约服务之前，请您务必审慎阅读…"
        />
        <ProtocolBlock
          title="照片授权协议"
          defaultSigned={true}
          content={photoAuthContent}
          onSave={(text) => saveDetails({ photo_authorization_agreement: text })}
          placeholder="例：您完全理解并同意授予我方下列权利…"
        />
      </div>

      <div style={{ margin: '16px 14px 0', padding: '10px 14px', background: '#F5F9FA', borderRadius: 6, fontSize: 12, color: MGRAY, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <span>💡</span>
        <span>两个协议默认为「照片授权协议」签署，「服务协议」需手动开启；可在每张协议卡片右上「编辑」修改条款。</span>
      </div>
    </div>
  );
}
