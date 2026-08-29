// routes/auth.js —— 登录 / 当前用户
import { Router } from 'express';
import { get, run } from '../db.js';
import { signToken, verifyPassword, hashPassword, authRequired, validatePasswordStrength } from '../auth.js';
import { serverError } from '../httpError.js';

const router = Router();

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const u = await get('SELECT * FROM users WHERE username = ?', [username]);
    if (!u || !(await verifyPassword(password, u.password_hash))) {
      return res.status(401).json({ error: '账号或密码错误' });
    }
    const token = signToken(u);
    res.json({ token, user: { id: u.id, username: u.username, role: u.role, name: u.name } });
  } catch (e) { serverError(res, e); }
});

router.get('/me', authRequired, async (req, res) => {
  try {
    const u = await get('SELECT id, username, role, name, avatar FROM users WHERE id = ?', [req.user.uid]);
    res.json(u);
  } catch (e) { serverError(res, e); }
});

// 更新当前登录账号资料（头像 / 名称）
router.put('/me', authRequired, async (req, res) => {
  try {
    const { name, avatar } = req.body || {};
    const sets = [];
    const vals = [];
    if (name !== undefined) { sets.push('name = ?'); vals.push(String(name)); }
    if (avatar !== undefined) { sets.push('avatar = ?'); vals.push(String(avatar)); }
    if (sets.length) {
      vals.push(req.user.uid);
      await run('UPDATE users SET ' + sets.join(', ') + ' WHERE id = ?', vals);
    }
    const u = await get('SELECT id, username, role, name, avatar FROM users WHERE id = ?', [req.user.uid]);
    res.json(u);
  } catch (e) { serverError(res, e); }
});

// 修改当前登录账号的密码：需验证旧密码 → 写入新 bcrypt 哈希
router.put('/password', authRequired, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: '请填写旧密码和新密码' });
    }
    const weak = validatePasswordStrength(newPassword);
    if (weak) return res.status(400).json({ error: weak });
    const u = await get('SELECT * FROM users WHERE id = ?', [req.user.uid]);
    if (!u) return res.status(404).json({ error: '用户不存在' });
    const ok = await verifyPassword(oldPassword, u.password_hash);
    if (!ok) return res.status(400).json({ error: '旧密码不正确' });
    const newHash = await hashPassword(newPassword);
    await run('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, u.id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

export default router;
