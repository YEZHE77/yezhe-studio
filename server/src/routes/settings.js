// routes/settings.js —— 系统设置（工作室资料：logo/封面/名称/简介/联系方式）
// GET /api/settings/studio  —— 公开（C 端小程序"关于我们"实时读取）
// PUT /api/settings/studio  —— 需商户登录（B 端"资料设置"保存）
import { Router } from 'express';
import { get, insert, run } from '../db.js';
import { authRequired } from '../auth.js';
import QRCode from 'qrcode';

const router = Router();

const DEFAULT_STUDIO = {
  name: '叶哲 Studio',
  logo: '',
  cover: '',
  // 幻灯片背景音乐（BGM）HTTPS 地址，如《梦中的婚礼》钢琴曲 MP3；
  // 留空则播放幻灯片无声，但播放/暂停/进度记忆逻辑保持完整。建议上传 R2 经代理访问。
  bgmUrl: '',
  heroImages: [],
  intro: '海口婚礼 / 人像摄影 · YEZHE WORKSHOP',
  // 品牌 Slogan（首页工作室名称下方浅灰小字；为空时客户端不渲染该行）
  slogan: '拍摄有温度的照片，记录平凡生活中的美好。',
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
    const data = { ...DEFAULT_STUDIO, ...(safeParse(r && r.value) || {}) };
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 生成分享二维码（公开）：GET /api/qrcode?text=URL  → 返回 PNG dataURL
// 二维码内容即当前相册详情访问地址，扫码直达 H5 相册页
router.get('/qrcode', async (req, res) => {
  try {
    const text = (req.query.text || '').toString();
    if (!text) return res.status(400).json({ error: 'missing text' });
    const dataUrl = await QRCode.toDataURL(text, { width: 480, margin: 2, color: { dark: '#1a1a1a', light: '#ffffff' } });
    res.json({ dataUrl });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/studio', authRequired, async (req, res) => {
  try {
    const body = req.body || {};
    // 与默认值合并：旧版前端可能缺少新增字段（如 heroImages），避免直接覆盖导致字段丢失
    const merged = {
      ...DEFAULT_STUDIO,
      ...body,
      contact: { ...DEFAULT_STUDIO.contact, ...(body.contact || {}) }
    };
    const value = JSON.stringify(merged);
    const exists = await get("SELECT key FROM settings WHERE key = 'studio'");
    if (exists) await run("UPDATE settings SET value = ? WHERE key = 'studio'", [value]);
    else await insert("INSERT INTO settings (key, value) VALUES (?, ?)", ['studio', value]);
    res.json({ ok: true, studio: merged });
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
