// routes/systemConfig.js —— 系统级配置（离散键值，与 settings 对外资料 JSON 区分）
// GET  /api/system-config  —— 读取全部已知系统配置（当前：订单分享默认备注）
// PUT  /api/system-config  —— 需商户登录；更新指定配置项（当前支持 customer_order_share_default_note）
import { Router } from 'express';
import { authRequired } from '../auth.js';
import { getConfig, setConfig } from '../configStore.js';

const router = Router();

// 已知配置键（白名单，避免任意写库）
const KNOWN_KEYS = ['customer_order_share_default_note'];

router.get('/', async (req, res) => {
  try {
    const note = await getConfig('customer_order_share_default_note', '');
    res.json({ customer_order_share_default_note: note || '' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/', authRequired, async (req, res) => {
  try {
    const b = req.body || {};
    const patch = {};
    for (const k of KNOWN_KEYS) {
      if (b[k] !== undefined) {
        if (typeof b[k] !== 'string') return res.status(400).json({ error: `配置项 ${k} 必须为字符串` });
        patch[k] = b[k];
      }
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: '无有效配置项' });
    for (const [k, v] of Object.entries(patch)) await setConfig(k, v);
    res.json({ ok: true, ...patch });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
