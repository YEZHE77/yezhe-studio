// routes/users.js —— 团队管理（仅 admin 主账号）：子账号 CRUD + 角色权限集合 + 禁用
import { Router } from 'express';
import { query, get, insert, run } from '../db.js';
import { authRequired, requireRole, hashPassword, validatePasswordStrength, parsePermissions, PERMISSION_LABELS } from '../auth.js';
import { serverError } from '../httpError.js';

const router = Router();
const PRESET_ROLES = ['admin', 'photographer', 'selector', 'finance'];

// 安全：输出账号时反序列化 permissions + 附权限标签，避免把 password_hash 泄露出去
function sanitize(u) {
  if (!u) return null;
  const perms = parsePermissions(u.permissions);
  return {
    id: u.id, username: u.username, role: u.role, name: u.name || '',
    permissions: perms,
    permission_labels: perms.map((p) => PERMISSION_LABELS[p] || p),
    disabled: !!u.disabled, created_at: u.created_at
  };
}

// 列出所有账号（admin only）
router.get('/', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const rows = await query('SELECT id, username, role, name, permissions, disabled, created_at FROM users ORDER BY id ASC');
    res.json({
      list: rows.map(sanitize),
      me: { id: req.user.uid, username: req.user.username, role: req.user.role, name: req.user.name || '', permissions: req.user.permissions || [], disabled: false },
      preset_roles: PRESET_ROLES, permission_labels: PERMISSION_LABELS
    });
  } catch (e) { serverError(res, e); }
});

// 创建子账号（admin only；密码强度校验）
router.post('/', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const b = req.body || {};
    const username = String(b.username || '').trim();
    const password = String(b.password || '');
    if (!username) return res.status(400).json({ error: '请填写账号名' });
    if (username.length < 3) return res.status(400).json({ error: '账号名至少 3 位' });
    const weak = validatePasswordStrength(password);
    if (weak) return res.status(400).json({ error: weak });
    const exist = await get('SELECT id FROM users WHERE username = ?', [username]);
    if (exist) return res.status(400).json({ error: '账号名已存在' });
    const role = PRESET_ROLES.includes(b.role) ? b.role : (b.role || 'photographer');
    const perms = Array.isArray(b.permissions) ? b.permissions.filter((p) => p in PERMISSION_LABELS) : [];
    const password_hash = await hashPassword(password);
    const id = await insert(
      'INSERT INTO users (username, password_hash, role, name, permissions, disabled) VALUES (?,?,?,?,?,0)',
      [username, password_hash, role, String(b.name || '').trim(), JSON.stringify(perms)]
    );
    const u = await get('SELECT id, username, role, name, permissions, disabled, created_at FROM users WHERE id = ?', [id]);
    res.json({ ok: true, user: sanitize(u) });
  } catch (e) { serverError(res, e); }
});

// 更新子账号（admin only；角色/权限集合/禁用/改名/重置密码）
router.put('/:id', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const u = await get('SELECT * FROM users WHERE id = ?', [id]);
    if (!u) return res.status(404).json({ error: '账号不存在' });
    // admin 主账号保护：不允许降级/禁用/删除 admin 主账号（含自己与其他 admin）
    if (u.role === 'admin' && Number(u.id) !== Number(req.user.uid)) {
      // 其它 admin 子账号也受保护，仅允许改 name
      return res.status(403).json({ error: 'admin 主账号不可被修改权限' });
    }
    const b = req.body || {};
    const sets = [];
    const vals = [];
    if (b.name !== undefined) { sets.push('name = ?'); vals.push(String(b.name).trim()); }
    if (b.role !== undefined) {
      const role = PRESET_ROLES.includes(b.role) ? b.role : 'photographer';
      sets.push('role = ?'); vals.push(role);
    }
    if (b.permissions !== undefined) {
      const perms = Array.isArray(b.permissions) ? b.permissions.filter((p) => p in PERMISSION_LABELS) : [];
      sets.push('permissions = ?'); vals.push(JSON.stringify(perms));
    }
    if (b.disabled !== undefined) {
      // 不允许禁用 admin 主账号自己
      if (u.role === 'admin') return res.status(403).json({ error: 'admin 主账号不可禁用' });
      sets.push('disabled = ?'); vals.push(b.disabled ? 1 : 0);
    }
    if (b.password) {
      const weak = validatePasswordStrength(String(b.password));
      if (weak) return res.status(400).json({ error: weak });
      sets.push('password_hash = ?'); vals.push(await hashPassword(String(b.password)));
    }
    if (!sets.length) return res.json({ ok: true });
    vals.push(id);
    await run('UPDATE users SET ' + sets.join(', ') + ' WHERE id = ?', vals);
    const fresh = await get('SELECT id, username, role, name, permissions, disabled, created_at FROM users WHERE id = ?', [id]);
    res.json({ ok: true, user: sanitize(fresh) });
  } catch (e) { serverError(res, e); }
});

// 删除子账号（admin only；admin 主账号不可删）
router.delete('/:id', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const u = await get('SELECT * FROM users WHERE id = ?', [id]);
    if (!u) return res.status(404).json({ error: '账号不存在' });
    if (u.role === 'admin') return res.status(403).json({ error: 'admin 主账号不可删除' });
    if (Number(id) === Number(req.user.uid)) return res.status(400).json({ error: '不能删除自己' });
    await run('DELETE FROM users WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

export default router;
