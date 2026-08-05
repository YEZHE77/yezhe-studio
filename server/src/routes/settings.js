// routes/settings.js —— 系统设置（工作室资料：logo/封面/名称/简介/联系方式）
// GET /api/settings/studio  —— 公开（C 端小程序"关于我们"实时读取）
// PUT /api/settings/studio  —— 需商户登录（B 端"资料设置"保存）
import { Router } from 'express';
import { get, insert, run } from '../db.js';
import { authRequired } from '../auth.js';

const router = Router();

const DEFAULT_STUDIO = {
  name: '叶哲 Studio',
  logo: '',
  cover: '',
  intro: '海口婚礼 / 人像摄影 · YEZHE WORKSHOP',
  contact: { phone: '', wechat: '', address: '' },
  tabs: [
    { id: 'home', label: '首页', visible: true },
    { id: 'works', label: '作品', visible: true },
    { id: 'packages', label: '套餐', visible: true },
    { id: 'about', label: '关于我们', visible: true }
  ]
};

function safeParse(v) {
  if (!v) return null;
  try { return JSON.parse(v); } catch { return null; }
}

router.get('/studio', async (req, res) => {
  try {
    const r = await get("SELECT value FROM settings WHERE key = 'studio'");
    const data = safeParse(r && r.value) || DEFAULT_STUDIO;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/studio', authRequired, async (req, res) => {
  try {
    const body = req.body || {};
    const value = JSON.stringify(body);
    const exists = await get("SELECT key FROM settings WHERE key = 'studio'");
    if (exists) await run("UPDATE settings SET value = ? WHERE key = 'studio'", [value]);
    else await insert("INSERT INTO settings (key, value) VALUES (?, ?)", ['studio', value]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== 预约全局设置（对外预约开关 + 每周开放日）=====
// GET /api/settings/booking —— 公开（C 端小程序读取是否开放预约、哪几天可约）
// PUT /api/settings/booking —— 需商户登录（B 端"对外预约开关"与"每周开放日"）
const DEFAULT_BOOKING = {
  open: true,
  openDays: [0, 1, 2, 3, 4, 5, 6] // 0=周日 ... 6=周六，默认全周开放
};

router.get('/booking', async (req, res) => {
  try {
    const r = await get("SELECT value FROM settings WHERE key = 'booking'");
    const data = safeParse(r && r.value) || DEFAULT_BOOKING;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/booking', authRequired, async (req, res) => {
  try {
    const b = req.body || {};
    const open = b.open !== undefined ? !!b.open : true;
    const openDays = Array.isArray(b.openDays)
      ? b.openDays.map((d) => Number(d)).filter((d) => d >= 0 && d <= 6)
      : DEFAULT_BOOKING.openDays;
    const value = JSON.stringify({ open, openDays });
    const exists = await get("SELECT key FROM settings WHERE key = 'booking'");
    if (exists) await run("UPDATE settings SET value = ? WHERE key = 'booking'", [value]);
    else await insert("INSERT INTO settings (key, value) VALUES (?, ?)", ['booking', value]);
    res.json({ ok: true, booking: { open, openDays } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
