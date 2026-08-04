// routes/auth.js —— 登录 / 当前用户
import { Router } from 'express';
import { get } from '../db.js';
import { signToken, verifyPassword, authRequired } from '../auth.js';

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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/me', authRequired, async (req, res) => {
  try {
    const u = await get('SELECT id, username, role, name FROM users WHERE id = ?', [req.user.uid]);
    res.json(u);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
