import React, { useState, useEffect, useCallback } from 'react';
import http from '../api.js';

// 权限集合（与后端 auth.js PERMISSIONS 对齐）
const PERMS = [
  { key: 'view_orders', label: '查看订单' },
  { key: 'edit_price', label: '修改价格' },
  { key: 'export_customers', label: '导出客户资料' },
  { key: 'delete_data', label: '删除数据' }
];
const ROLES = [
  { key: 'photographer', label: '摄影师' },
  { key: 'selector', label: '选片师' },
  { key: 'finance', label: '财务' },
  { key: 'admin', label: '主账号' }
];
const ROLE_LABEL = { admin: '主账号', photographer: '摄影师', selector: '选片师', finance: '财务' };

// 前端密码强度校验（与后端 validatePasswordStrength 同规则）
function passwordError(pwd) {
  const s = String(pwd || '');
  if (s.length < 8) return '密码至少 8 位';
  if (!/[A-Z]/.test(s)) return '密码需包含大写字母';
  if (!/[a-z]/.test(s)) return '密码需包含小写字母';
  if (!/[0-9]/.test(s)) return '密码需包含数字';
  return '';
}

export default function Team() {
  const [list, setList] = useState([]);
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tip, setTip] = useState('');
  const [busyId, setBusyId] = useState(null);

  // 创建表单
  const [showForm, setShowForm] = useState(false);
  const [f, setF] = useState({ username: '', name: '', password: '', role: 'photographer', permissions: ['view_orders'] });

  const load = useCallback(async () => {
    try {
      const r = await http.get('/api/users');
      setList(r.data.list || []);
      setMe(r.data.me || null);
    } catch (e) { setTip((e.response && e.response.data && e.response.data.error) || '加载失败'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const isAdmin = me ? me.role === 'admin' : null;

  function togglePerm(key) {
    setF((p) => ({ ...p, permissions: p.permissions.includes(key) ? p.permissions.filter((k) => k !== key) : [...p.permissions, key] }));
  }

  async function createUser() {
    const weak = passwordError(f.password);
    if (!f.username.trim()) return setTip('请填写账号名');
    if (weak) return setTip(weak);
    setTip('');
    try {
      await http.post('/api/users', { ...f, username: f.username.trim(), name: f.name.trim() });
      setShowForm(false);
      setF({ username: '', name: '', password: '', role: 'photographer', permissions: ['view_orders'] });
      await load();
    } catch (e) { setTip((e.response && e.response.data && e.response.data.error) || '创建失败'); }
  }

  async function toggleDisable(u) {
    setBusyId(u.id);
    try { await http.put('/api/users/' + u.id, { disabled: !u.disabled }); await load(); }
    catch (e) { setTip((e.response && e.response.data && e.response.data.error) || '操作失败'); }
    finally { setBusyId(null); }
  }

  async function removeUser(u) {
    if (!window.confirm(`确定删除账号「${u.username}」吗？此操作不可恢复。`)) return;
    setBusyId(u.id);
    try { await http.delete('/api/users/' + u.id); await load(); }
    catch (e) { setTip((e.response && e.response.data && e.response.data.error) || '删除失败'); }
    finally { setBusyId(null); }
  }

  if (loading) return <div style={{ padding: 24, color: '#999', fontSize: 13 }}>加载中…</div>;
  if (isAdmin === false) return <div style={{ padding: 24, color: '#999', fontSize: 13 }}>仅主账号可管理团队。</div>;

  const inputCls = 'w-full border border-[#E5E6EB] rounded-md px-3 py-2 text-sm outline-none focus:border-[#7ecdbb]';

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 16, minHeight: '100vh' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ fontSize: 18, color: '#1f2329' }}>团队管理</div>
        <button type="button" onClick={() => { setShowForm((v) => !v); setTip(''); }}
          style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#7ecdbb', color: '#fff', fontSize: 13, cursor: 'pointer' }}>
          {showForm ? '取消' : '＋ 新建子账号'}
        </button>
      </div>

      {tip && <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 8, background: '#FFF3F3', color: '#D93025', fontSize: 13 }}>{tip}</div>}

      {/* 创建表单 */}
      {showForm && (
        <div style={{ background: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, border: '1px solid #EFEFF0' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 6 }}>账号名（登录用，≥3 位）</div>
              <input className={inputCls} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} placeholder="如 photographer2" />
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 6 }}>姓名</div>
              <input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="如 张三" />
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 6 }}>初始密码（≥8 位 + 大小写 + 数字）</div>
              <input className={inputCls} type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="Abc12345" />
              {f.password && passwordError(f.password) && <div style={{ fontSize: 12, color: '#D93025', marginTop: 4 }}>{passwordError(f.password)}</div>}
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 6 }}>岗位角色</div>
              <select className={inputCls} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
                {ROLES.filter((r) => r.key !== 'admin').map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            </div>
          </div>
          <div style={{ fontSize: 12, color: '#999', margin: '12px 0 6px' }}>权限集合</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {PERMS.map((p) => (
              <label key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: '1px solid ' + (f.permissions.includes(p.key) ? '#7ecdbb' : '#E5E6EB'), background: f.permissions.includes(p.key) ? '#F0FAF7' : '#fff', cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={f.permissions.includes(p.key)} onChange={() => togglePerm(p.key)} style={{ accentColor: '#7ecdbb' }} />
                {p.label}
              </label>
            ))}
          </div>
          <button type="button" onClick={createUser} style={{ marginTop: 14, padding: '9px 20px', borderRadius: 8, border: 'none', background: '#7ecdbb', color: '#fff', fontSize: 13, cursor: 'pointer' }}>创建</button>
        </div>
      )}

      {/* 账号列表 */}
      <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', border: '1px solid #EFEFF0' }}>
        {list.map((u) => (
          <div key={u.id} style={{ display: 'flex', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid #F5F5F7' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, color: '#1f2329' }}>{u.username}</span>
                {u.name && <span style={{ fontSize: 12, color: '#999' }}>（{u.name}）</span>}
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: u.role === 'admin' ? '#F0FAF7' : '#F5F5F7', color: u.role === 'admin' ? '#3E9C8B' : '#666' }}>{ROLE_LABEL[u.role] || u.role}</span>
                {u.disabled ? <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#FFF3F3', color: '#D93025' }}>已禁用</span> : null}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                {u.role === 'admin' ? (
                  <span style={{ fontSize: 11, color: '#999' }}>全部权限</span>
                ) : (
                  (u.permissions && u.permissions.length ? u.permissions : []).map((p) => (
                    <span key={p} style={{ fontSize: 11, padding: '1px 8px', borderRadius: 8, background: '#F0FDFF', color: '#2DB7F5' }}>{PERMS.find((x) => x.key === p)?.label || p}</span>
                  ))
                )}
                {(u.role !== 'admin' && (!u.permissions || !u.permissions.length)) && <span style={{ fontSize: 11, color: '#ccc' }}>无额外权限</span>}
              </div>
            </div>
            {u.role !== 'admin' && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => toggleDisable(u)} disabled={busyId === u.id}
                  style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #E5E6EB', background: '#fff', color: u.disabled ? '#3E9C8B' : '#666', fontSize: 12, cursor: busyId === u.id ? 'not-allowed' : 'pointer' }}>
                  {u.disabled ? '启用' : '禁用'}
                </button>
                <button type="button" onClick={() => removeUser(u)} disabled={busyId === u.id}
                  style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #E5E6EB', background: '#fff', color: '#D93025', fontSize: 12, cursor: busyId === u.id ? 'not-allowed' : 'pointer' }}>
                  删除
                </button>
              </div>
            )}
          </div>
        ))}
        {!list.length && <div style={{ padding: 32, textAlign: 'center', color: '#999', fontSize: 13 }}>暂无账号</div>}
      </div>
    </div>
  );
}
