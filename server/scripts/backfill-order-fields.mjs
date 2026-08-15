// scripts/backfill-order-fields.mjs —— 一次性数据迁移
// 历史订单的 shoot_position / total_negatives / retouch_count 等字段为 0，因为之前订单创建只读 packages 表字段，
// 而 PackageEdit.jsx 的 PUT 请求体只传 details JSON 不传这些独立列。修复：
//   对每个订单，从 package_snapshot.details.* 读真实值，回填到 orders 表对应列（仅当当前为 0/空/null 时）。
// 幂等：只补当前为空但 snapshot 有值的字段，重复执行不会破坏现有数据。
import { query, get, run } from '../src/db.js';

const FALLBACK = {
  shoot_position: (snap) => {
    if (snap.details && typeof snap.details.shoot_position === 'string' && snap.details.shoot_position) return snap.details.shoot_position;
    const name = snap.name || '';
    if (/多机位|双机位/.test(name)) return '多机位';
    if (/单机位/.test(name)) return '单机位';
    return '';
  },
  total_negatives: (snap) => {
    if (snap.details && parseInt(snap.details.raw_count, 10) > 0) return parseInt(snap.details.raw_count, 10);
    const text = ((snap.raw_policy || '') + ' ' + (snap.description || ''));
    const m = text.match(/底片\s*(?:大约|约)?\s*(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  },
  retouch_count: (snap) => {
    if (snap.details && parseInt(snap.details.retouch_count, 10) > 0) return parseInt(snap.details.retouch_count, 10);
    if (parseInt(snap.retouch_count, 10) > 0) return parseInt(snap.retouch_count, 10);
    return 0;
  },
  album_electronic_num: (snap) => {
    if (snap.details && parseInt(snap.details.album_electronic_num, 10) > 0) return parseInt(snap.details.album_electronic_num, 10);
    return 1;
  },
  album_price: (snap) => {
    if (snap.details && parseFloat(snap.details.album_price) > 0) return parseFloat(snap.details.album_price);
    return 0;
  },
  shoot_cost: (snap) => {
    if (parseFloat(snap.price) > 0) return parseFloat(snap.price);
    if (snap.details && parseFloat(snap.details.shoot_cost) > 0) return parseFloat(snap.details.shoot_cost);
    return 0;
  },
  quick_repair_cost: (snap) => {
    if (snap.details && parseFloat(snap.details.quick_repair_cost) > 0) return parseFloat(snap.details.quick_repair_cost);
    return 0;
  }
};

const COLS = ['shoot_position', 'total_negatives', 'retouch_count', 'album_electronic_num', 'album_price', 'shoot_cost', 'quick_repair_cost'];

const rows = await query('SELECT id, package_snapshot FROM orders WHERE package_snapshot IS NOT NULL AND package_snapshot != \'\'');
let updated = 0;
let checked = 0;
for (const r of rows) {
  checked++;
  let snap = {};
  try { snap = JSON.parse(r.package_snapshot) || {}; } catch { continue; }
  const cur = await get('SELECT ' + COLS.join(', ') + ' FROM orders WHERE id = ?', [r.id]);
  if (!cur) continue;
  const updates = [];
  const params = [];
  for (const col of COLS) {
    const curVal = cur[col];
    const isEmpty = curVal == null || curVal === '' || curVal === 0;
    if (!isEmpty) continue;
    const newVal = FALLBACK[col](snap);
    if (!newVal) continue;
    updates.push(`${col} = ?`);
    params.push(newVal);
  }
  if (updates.length) {
    await run(`UPDATE orders SET ${updates.join(', ')} WHERE id = ?`, [...params, r.id]);
    updated++;
  }
}
console.log(`检查 ${checked} 条订单，补全 ${updated} 条`);