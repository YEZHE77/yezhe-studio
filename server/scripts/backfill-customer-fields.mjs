// scripts/backfill-customer-fields.mjs —— 历史订单数据回填（groom_name/bride_name/groom_phone/bride_phone）
// 用法：node server/scripts/backfill-customer-fields.mjs
// 幂等：仅回填当前为空的字段；已有值不覆盖。

import { query, run } from '../src/db.js';

const rows = await query(`
  SELECT id, customer_name, customer_phone, groom_name, bride_name, groom_phone, bride_phone, phones
  FROM orders
  WHERE cancelled = 0 AND is_deleted = 0
`);

let updated = 0;
let skipped = 0;
for (const o of rows) {
  const patch = {};

  // 1. 拆 customer_name "A & B" → groom_name=A, bride_name=B（仅当独立列空时）
  if (!o.groom_name && !o.bride_name && o.customer_name) {
    const sep = o.customer_name.includes(' & ') ? ' & ' : (o.customer_name.includes(' & ') ? ' & ' : null);
    if (sep) {
      const [a, b] = o.customer_name.split(sep);
      if (a && !o.groom_name) patch.groom_name = a.trim();
      if (b && !o.bride_name) patch.bride_name = b.trim();
    } else if (!o.groom_name) {
      patch.groom_name = o.customer_name.trim();
    }
  }

  // 2. 拆 phones → groom_phone=phones[0], bride_phone=phones[1]（仅当独立列空时）
  let phones = [];
  if (typeof o.phones === 'string') {
    try { phones = JSON.parse(o.phones); } catch {}
  } else if (Array.isArray(o.phones)) phones = o.phones;
  if (!o.groom_phone && phones[0]) patch.groom_phone = phones[0];
  if (!o.bride_phone && phones[1]) patch.bride_phone = phones[1];

  // 3. 兜底：phones 为空但 customer_phone 有值
  if (!o.groom_phone && !patch.groom_phone && o.customer_phone) patch.groom_phone = o.customer_phone;

  if (Object.keys(patch).length > 0) {
    const sets = Object.keys(patch).map((k) => `${k} = ?`).join(', ');
    const vals = Object.keys(patch).map((k) => patch[k]);
    vals.push(o.id);
    await run(`UPDATE orders SET ${sets} WHERE id = ?`, vals);
    console.log(`  #${o.id} updated:`, Object.keys(patch).join(', '));
    updated++;
  } else {
    skipped++;
  }
}

console.log(`\n=== 完成 ===`);
console.log(`总订单：${rows.length} 条；回填：${updated} 条；跳过（已填写）：${skipped} 条`);
