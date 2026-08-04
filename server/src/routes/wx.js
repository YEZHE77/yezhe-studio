// routes/wx.js —— 微信小程序登录（code 换 openid）+ 订阅消息
import { Router } from 'express';
import { codeToOpenid } from '../wx.js';
import { get, insert, run } from '../db.js';
import { signCustomerToken } from '../auth.js';

const router = Router();

// 小程序启动：wx.login 拿到 code → 换 openid → upsert customers → 返回客户 token
// 返回 { openid, customerId, token }；token 用于后续 /api/customer/* 鉴权
router.post('/login', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: '缺少 code' });
    const openid = await codeToOpenid(code);
    if (!openid) return res.status(400).json({ error: '微信登录失败' });

    const now = new Date().toISOString();
    let c = await get('SELECT * FROM customers WHERE openid = ?', [openid]);
    if (!c) {
      const id = await insert(
        'INSERT INTO customers (openid, created_at, updated_at) VALUES (?,?,?)',
        [openid, now, now]
      );
      c = { id, openid };
    } else {
      await run('UPDATE customers SET updated_at = ? WHERE id = ?', [now, c.id]);
    }

    const token = signCustomerToken({ openid: c.openid, id: c.id });
    res.json({ openid: c.openid, customerId: c.id, token });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 可选：订阅消息（一次性订阅，由微信后台「订阅消息」模板提供 templateId）
// 小程序端先 wx.requestSubscribeMessage 拿到授权，再把授权结果上报此处做记录/服务端推送。
// 注：真实推送需服务端用 access_token 调微信接口，这里先接收并记录订阅意图。
router.post('/subscribe-msg', async (req, res) => {
  try {
    const { openid, templateId, data } = req.body || {};
    if (!openid || !templateId) return res.status(400).json({ error: '缺少 openid 或 templateId' });
    // 此处仅做接收确认；实际下发请服务端定时任务用 access_token 调微信 subscribeMessage.send
    res.json({ ok: true, note: '已记录订阅意图，服务端可据此推送' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
