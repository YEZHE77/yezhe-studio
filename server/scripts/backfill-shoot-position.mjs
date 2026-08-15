// scripts/backfill-shoot-position.mjs —— 历史订单 shoot_position 反归一
// 用法：node server/scripts/backfill-shoot-position.mjs
// 幂等：仅把已归一为「多机位」的字段还原为 details.camera_count 原值（双机位/三机位等）；只回填 cancelled=0 AND is_deleted=0 的订单。

import { query, run } from '../src/db.js';

const rows = await query(`
  SELECT id, shoot_position, package_snapshot
  FROM orders
  WHERE cancelled = 0 AND is_deleted = 0
`);

let updated = 0;
let skipped = 0;
let noop = 0;

for (const r of rows) {
  let snap = {};
  try { snap = JSON.parse(r.package_snapshot || '{}'); } catch {}
  const cam = (snap.details && snap.details.camera_count) || '';

  // 跳过：相机位为空、已是原值
  if (!cam) { noop++; continue; }
  if (r.shoot_position === cam) { noop++; continue; }

  // 旧归一逻辑：双机位/三机位/多机位 → '多机位'；现在还原
  if (r.shoot_position === '多机位' && /双机位|三机位/.test(cam)) {
    await run('UPDATE orders SET shoot_position = ? WHERE id = ?', [cam, r.id]);
    console.log(`  #${r.id} '${r.shoot_position}' → '${cam}'`);
    updated++;
  } else if (!r.shoot_position && cam) {
    // 空字段也补一下（兼容历史脏数据）
    await run('UPDATE orders SET shoot_position = ? WHERE id = ?', [cam, r.id]);
    console.log(`  #${r.id} '' → '${cam}'`);
    updated++;
  } else {
    skipped++;
  }
}

console.log(`\n=== 完成 ===`);
console.log(`总订单：${rows.length} 条；还原：${updated} 条；跳过（已是原值）：${noop} 条；不变（不匹配）：${skipped} 条`);