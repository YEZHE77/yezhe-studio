// 渠道来源徽标：已知渠道用品牌色（校 IMG_7522 渠道卡），未知渠道 hash 取色
// 抖音品牌色为深黑 #161823，在 20×20 小徽标 + 白底卡片上几乎看不见"抖"字（与编辑笔图标视觉混淆）。
// 改为白底黑字 + 黑边框：保留品牌调性同时保证小尺寸下的可读性。
const CHANNEL_COLORS = {
  '抖音': '#FFFFFF',         // 抖音品牌徽标：白底 + 黑字 + 黑边框（在白底卡片上对比度反转）
  '小红书': '#FF2442',       // 小红书红
  '美团': '#FFB300',         // 美团黄
  '小程序': '#07C160',       // 微信绿
  '客户推荐': '#52C8B6',     // 心形图标青绿（与小程序区分）
  '自然进店': '#5BC0DE',     // 气泡图标天蓝
  '其他来源': '#7B85F4',     // 网格图标蓝紫
};
// 渠道 → 徽标前景/边框（仅少数需要差异化，如抖音的白底黑字需要黑边框）
const CHANNEL_BADGE = {
  抖音: { color: '#000000', border: '1px solid #161823' },
};
const CHANNEL_FALLBACK = ['#FE2C55', '#FF2442', '#FFB300', '#07C160', '#2DB7F5', '#7ECDBB', '#9B7ED8', '#5A5A5A'];

export function channelColor(name) {
  if (!name) return '#8C8C8C';
  if (CHANNEL_COLORS[name]) return CHANNEL_COLORS[name];
  let h = 0;
  for (let i = 0; i < String(name).length; i++) h += String(name).charCodeAt(i);
  return CHANNEL_FALLBACK[h % CHANNEL_FALLBACK.length];
}

// 渠道 → 徽标前景/边框样式；返回 { background, color, border }，渲染处直接合并
export function channelBadgeStyle(name) {
  const background = channelColor(name);
  const custom = CHANNEL_BADGE[name];
  if (custom) return { background, ...custom };
  return { background, color: '#fff' };
}
