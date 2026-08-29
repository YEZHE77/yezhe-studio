// routes/systemConfig.js —— 系统级配置（离散键值，与 settings 对外资料 JSON 区分）
// GET  /api/system-config  —— 读取全部已知系统配置（当前：订单分享默认备注 / 消息保留天数）
// PUT  /api/system-config  —— 需商户登录；更新指定配置项
// POST /api/system-config/cleanup —— 需商户登录；手动触发一次消息清理（按当前保留天数）
import { Router } from 'express';
import { authRequired } from '../auth.js';
import { getConfig, setConfig } from '../configStore.js';
import { serverError } from '../httpError.js';
import { cleanupOldMessages, getRetentionDays } from './message.js';

const router = Router();

// 已知配置键（白名单，避免任意写库）
const KNOWN_KEYS = ['customer_order_share_default_note', 'msg_retention_days'];
const STRING_KEYS = new Set(['customer_order_share_default_note']);
const INT_KEYS = new Set(['msg_retention_days']);

router.get('/', async (req, res) => {
  try {
    const note = await getConfig('customer_order_share_default_note', '');
    const retention = await getRetentionDays();
    res.json({ customer_order_share_default_note: note || '', msg_retention_days: retention });
  } catch (e) { serverError(res, e); }
});

router.put('/', authRequired, async (req, res) => {
  try {
    const b = req.body || {};
    const patch = {};
    for (const k of KNOWN_KEYS) {
      if (b[k] === undefined) continue;
      if (STRING_KEYS.has(k)) {
        if (typeof b[k] !== 'string') return res.status(400).json({ error: `配置项 ${k} 必须为字符串` });
        patch[k] = b[k];
      } else if (INT_KEYS.has(k)) {
        const n = parseInt(b[k], 10);
        if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: `配置项 ${k} 必须为非负整数（天）` });
        patch[k] = String(n);
      }
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: '无有效配置项' });
    for (const [k, v] of Object.entries(patch)) await setConfig(k, v);
    res.json({ ok: true, ...patch });
  } catch (e) { serverError(res, e); }
});

// 手动触发一次消息清理（按当前保留天数），返回清理条数
router.post('/cleanup', authRequired, async (req, res) => {
  try {
    const r = await cleanupOldMessages();
    res.json({ ok: true, ...r });
  } catch (e) { serverError(res, e); }
});

export default router;
