// pages/media/common.js —— 自媒体模块共享工具（toast / 日期 / 优先级 / 颜色 / AI 调用 / 违禁词检测）
import http from '../../api.js';

// 简易 toast（页面内固定位置，独立于 api.js 的全局 toast）
let _timer = null;
export function toast(msg, type = 'ok') {
  let el = document.getElementById('__media_toast__');
  if (!el) {
    el = document.createElement('div');
    el.id = '__media_toast__';
    el.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:99999;padding:10px 24px;border-radius:10px;font-size:14px;white-space:nowrap;box-shadow:0 4px 20px rgba(0,0,0,.2);transition:opacity .3s;pointer-events:none;font-family:inherit;';
    document.body.appendChild(el);
  }
  el.style.background = type === 'err' ? '#F47175' : type === 'warn' ? '#E6A23C' : '#1f2329';
  el.style.color = '#fff';
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(_timer);
  _timer = setTimeout(() => { if (el) el.style.opacity = '0'; }, 2800);
}

export function fmtDate(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function fmtDateTime(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 优先级选项
export const PRIORITY_OPTS = [
  { value: 'high', label: '高', color: '#F47175', bg: '#FDECEC' },
  { value: 'medium', label: '中', color: '#E6A23C', bg: '#FDF6EC' },
  { value: 'low', label: '低', color: '#999999', bg: '#F4F4F4' }
];
export function priorityOf(v) { return PRIORITY_OPTS.find((p) => p.value === (v || 'medium')) || PRIORITY_OPTS[1]; }

// 卡片颜色预设
export const COLOR_PRESETS = ['#2DB7F5', '#49C5AE', '#FAC054', '#F47175', '#9B7ED8', '#FF8F1F', '#6DB3E2', '#53CBC4', '#E6A23C', '#B8860B'];

// 来源类型
export const SOURCE_OPTS = [
  { value: 'manual', label: '手动录入' },
  { value: 'douyin', label: '抖音' },
  { value: 'xiaohongshu', label: '小红书' },
  { value: 'backflow', label: '复盘回流' }
];

// ---------- AI 调用（OpenAI 兼容接口；配置存 localStorage，不写文件、不部署；未配置回退模板） ----------
export function readAiConfig() {
  try { return JSON.parse(localStorage.getItem('media.aiConfig') || '{}') || {}; } catch { return {}; }
}
export function saveAiConfig(cfg) { try { localStorage.setItem('media.aiConfig', JSON.stringify(cfg || {})); } catch {} }

// 返回 { text, source:'ai'|'template' }；AI 失败自动回退 fallback
export async function callAI(sys, user, fallback) {
  const cfg = readAiConfig();
  if (cfg && cfg.baseUrl && cfg.apiKey) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 60000);
      const res = await fetch(String(cfg.baseUrl).replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
        body: JSON.stringify({
          model: cfg.model || 'gpt-4o-mini',
          messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
          temperature: 0.7
        }),
        signal: ctrl.signal
      });
      clearTimeout(t);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (text && String(text).trim()) return { text: String(text).trim(), source: 'ai' };
    } catch { /* 回退模板 */ }
  }
  return { text: fallback, source: 'template' };
}

// ---------- 广告违禁词检测（仅提示命中词，不拦截保存） ----------
export const BANNED_WORDS = [
  '最', '第一', '顶级', '国家级', '世界级', '极致', '独一无二', '唯一', '绝对', '永久', '百分百',
  '100%', '100％', '首选', '冠军', '领袖', '王牌', '销量第一', '全网最低', '史上最低', '最佳', '最好',
  '最强', '最高级', '最低价', '极品', '行业领先', '独家', '纯天然', '无副作用', '根治', '包治',
  '立马见效', '不反弹', '秒杀', '疯抢', '亏本', '跳楼价', '全网首发', '保底', '赚翻', '零风险', '白送'
];

// 返回命中词数组（去重）
export function checkBanned(text) {
  if (!text) return [];
  const hits = [];
  BANNED_WORDS.forEach((w) => {
    if (String(text).indexOf(w) !== -1 && !hits.includes(w)) hits.push(w);
  });
  return hits;
}

// 素材绑定选择器在各页面内联实现（拉作品相册 / 上传图片）
export default http;
