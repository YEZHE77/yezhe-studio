// configStore.js —— 系统级配置键值存储（system_config 表）
// 与 settings 表（工作室对外资料 JSON）区分：此处用于离散的系统开关/默认值，
// 例如「订单分享默认备注」(customer_order_share_default_note)。
import { get, insert, run } from './db.js';

// 读取配置值；不存在或 value 为 NULL 时返回 fallback。
export async function getConfig(key, fallback = '') {
  const r = await get('SELECT value FROM system_config WHERE key = ?', [key]);
  if (!r || r.value == null) return fallback;
  return r.value;
}

// 写入配置值（存在则更新，不存在则插入）。value 统一存字符串。
export async function setConfig(key, value) {
  const v = value == null ? '' : String(value);
  const exists = await get('SELECT key FROM system_config WHERE key = ?', [key]);
  if (exists) {
    await run('UPDATE system_config SET value = ? WHERE key = ?', [v, key]);
  } else {
    await insert('INSERT INTO system_config (key, value) VALUES (?, ?)', [key, v]);
  }
  return true;
}
