// routes/settings.js —— 系统设置（工作室资料：logo/封面/名称/简介/联系方式）
// GET /api/settings/studio  —— 公开（C 端小程序"关于我们"实时读取）
// PUT /api/settings/studio  —— 需商户登录（B 端"资料设置"保存）
import { Router } from 'express';
import { get, insert, run } from '../db.js';
import { authRequired } from '../auth.js';
import QRCode from 'qrcode';

const router = Router();

const DEFAULT_STUDIO = {
  name: '岛像微电影',
  logo: '',
  cover: '',
  // 幻灯片背景音乐（BGM）HTTPS 地址（可选）。
  // 留空则自动回退到前端【本地打包】的默认 BGM（H5: public/bgm/bgm.mp3，
  // 小程序: /assets/bgm/bgm.mp3；当前默认曲《Kiss The Rain - Yiruma》），
  // 彻底规避网易云/QQ 音乐等防盗链导致线上与小程序播放失败；
  // 填了自有 CDN / R2 代理地址则优先使用（切勿填网易云等防盗链网页链接）。
  bgmUrl: '',
  heroImages: [],
  // 客服微信二维码（小程序首页「添加客服」弹窗展示）：B 端后台上传的图片 HTTPS 地址，
  // 留空则小程序弹窗提示「暂未配置客服二维码」并隐藏二维码区域；小程序仅展示、不解析识别。
  serviceQr: '',
  intro: '海口婚礼 / 人像摄影 · YEZHE WORKSHOP',
  // 品牌 Slogan（首页工作室名称下方浅灰小字；为空时客户端不渲染该行）
  slogan: '拍摄有温度的照片，记录平凡生活中的美好。',
  contact: { phone: '', wechat: '', address: '' },
  tabs: [
    { id: 'home', label: '首页', visible: true },
    { id: 'works', label: '作品', visible: true },
    { id: 'packages', label: '套餐', visible: true },
    { id: 'about', label: '关于我们', visible: true }
  ],
  // 手机端「编辑资料」扩展字段
  subTitle: '', // 名称下方副标题，如「婚纱照 | 婚礼跟拍 | 人物肖像」
  tags: [], // 标签数组，如 ['婚纱电影','婚前影像','婚礼拍摄']
  address: '', // 地址文字
  location: null, // { lat, lng, name }
  socials: { wechat: '', weibo: '', phone: '', douyin: '' },
  members: [], // [{ id, name, avatar, sort }]
  website: { enabled: false, domain: '' }, // 我的网站
  miniProgram: { enabled: false }, // 小程序
  agreement: { enabled: false } // 顾客协议
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

// 生成分享二维码（公开）：GET /api/qrcode?text=URL 或 ?albumId=ID  → 返回 PNG dataURL
// 二维码内容即当前相册详情访问地址，扫码直达 H5 相册页
router.get('/qrcode', async (req, res) => {
  try {
    let text = (req.query.text || '').toString();
    // 兼容小程序端：传 albumId 时由后端拼装相册 H5 地址
    if (!text && req.query.albumId) {
      text = 'https://yezhe-studio.pages.dev/w/' + req.query.albumId;
    }
    if (!text) return res.status(400).json({ error: 'missing text or albumId' });
    const dataUrl = await QRCode.toDataURL(text, { width: 480, margin: 2, color: { dark: '#1a1a1a', light: '#ffffff' } });
    res.json({ dataUrl });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/studio', authRequired, async (req, res) => {
  try {
    const body = req.body || {};
    // 以「库里已有值」为基准合并，再叠加本次提交的字段。
    // 关键修复：之前以 DEFAULT_STUDIO 为基准，导致只提交部分字段（如仅 bgmUrl）时，
    // 会把其它已存字段（slogan/intro/名称/轮播图等）覆盖回默认值、造成数据丢失。
    const r = await get("SELECT value FROM settings WHERE key = 'studio'");
    const existing = safeParse(r && r.value) || {};
    const merged = {
      ...DEFAULT_STUDIO,
      ...existing,
      ...body,
      contact: { ...DEFAULT_STUDIO.contact, ...(existing.contact || {}), ...(body.contact || {}) },
      socials: { ...DEFAULT_STUDIO.socials, ...(existing.socials || {}), ...(body.socials || {}) },
      website: { ...DEFAULT_STUDIO.website, ...(existing.website || {}), ...(body.website || {}) },
      miniProgram: { ...DEFAULT_STUDIO.miniProgram, ...(existing.miniProgram || {}), ...(body.miniProgram || {}) },
      agreement: { ...DEFAULT_STUDIO.agreement, ...(existing.agreement || {}), ...(body.agreement || {}) }
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
