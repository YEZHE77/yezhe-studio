// scripts/import-photo-packages.mjs
// 将 packages 表（订单套系，启用态）导入 photo_package 表（对外报价套系），幂等
// 用途：底部 Tab「套系」= 套系中心（读 photo_package/public-list），首次上线或新建项目时跑一次
// 用法：node scripts/import-photo-packages.mjs
import crypto from 'node:crypto';
import { sqlite } from '../src/db.js';

const PRESERVE = ['package_name', 'price', 'cover_image', 'package_desc', 'shoot_duration', 'shoot_scope',
  'photo_total', 'retouch_count', 'original_file', 'price', 'additional_price', 'other_service', 'notice'];

// 字段映射：packages → photo_package
function mapPackage(p) {
  return {
    package_name: p.name,
    package_desc: p.description || '',
    cover_image: p.cover_url || '',
    price: Number(p.price) || 0,
    additional_price: 0,
    photo_total: 0,
    retouch_count: 0,
    is_enable: p.status === 'on' ? 1 : 0
  };
}

// 16 位随机 hex token（参照其他表 share_token 格式）
function genToken() {
  return crypto.randomBytes(16).toString('hex');
}

// 幂等导入：按 name 匹配，已存在跳过
function importAll() {
  const rows = sqlite.prepare("SELECT id, name, price, cover_url, description, status FROM packages").all();
  const existed = new Set(sqlite.prepare("SELECT package_name FROM photo_package").all().map(r => r.package_name));

  let added = 0, skipped = 0;
  const tx = sqlite.prepare('BEGIN'); tx.run();
  try {
    const insert = sqlite.prepare(
      `INSERT INTO photo_package (package_name, package_desc, cover_image, price, additional_price, photo_total, retouch_count, is_enable, share_token) VALUES (?,?,?,?,?,?,?,?,?)`
    );
    for (const p of rows) {
      if (existed.has(p.name)) { skipped++; continue; }
      const m = mapPackage(p);
      const token = genToken();
      insert.run(m.package_name, m.package_desc, m.cover_image, m.price, m.additional_price, m.photo_total, m.retouch_count, m.is_enable, token);
      added++;
    }
    sqlite.prepare('COMMIT').run();
  } catch (e) {
    sqlite.prepare('ROLLBACK').run();
    throw e;
  }

  console.log(`导入完成：新增 ${added} 条，跳过已存在 ${skipped} 条（按名称匹配）`);
  const total = sqlite.prepare('SELECT COUNT(*) AS c, SUM(is_enable) AS en FROM photo_package').get();
  console.log(`photo_package 现状：总数 ${total.c || 0}，启用 ${total.en || 0} 条`);
  // 列出来看看
  const list = sqlite.prepare('SELECT id, package_name, price, is_enable, share_token FROM photo_package ORDER BY id').all();
  list.forEach(r => console.log(`  #${r.id} ${r.is_enable ? '启用' : '停用'} ¥${r.price} ${r.package_name} token=${(r.share_token || '').slice(0, 10)}…`));
  process.exit(0);
}

importAll();
