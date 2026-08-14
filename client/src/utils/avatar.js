// utils/avatar.js —— 统一的头像色块算法（订单列表 / 待办 Tab 共用）
// 同一客户名在任何页面都算出同一颜色 + 同一首字符，避免核对不上
// 哈希算法：乘 31 散列（Java String.hashCode 同款）；调色板 8 色平衡品牌色与高对比色
const PALETTE = ['#7ECDBB', '#2DB7F5', '#FFA940', '#FE2C55', '#9B7ED8', '#52C41A', '#EB2F96', '#13C2C2'];

export function avatarColor(name) {
  if (!name) return PALETTE[0];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// 客户名首字符（中文/英文/数字均取第一个字）
export function avatarText(name) {
  return String(name || '').slice(0, 1);
}
