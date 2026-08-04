// seed.js —— 初始化演示数据（默认 admin/admin123 + 每模块样例）
import './env.js';
import { get, insert, run, query } from './db.js';
import { initSchema } from './schema.js';
import { hashPassword } from './auth.js';

export async function seedIfNeeded() {
  const exist = await get('SELECT id FROM users WHERE username = ?', ['admin']);
  if (!exist) {
    const hash = await hashPassword('admin123');
    await insert('INSERT INTO users (username, password_hash, role, name) VALUES (?,?,?,?)',
      ['admin', hash, 'admin', '叶哲']);
    console.log('✓ 已创建管理员  admin / admin123');
  }

  const catCount = await get('SELECT COUNT(*) AS c FROM categories');
  if (catCount.c === 0) {
    for (const [name, kind] of [['婚礼', 'work'], ['领证', 'work'], ['孕妇照', 'work'], ['写真', 'work']]) {
      await insert('INSERT INTO categories (name, kind, sort) VALUES (?,?,?)', [name, kind, 0]);
    }
    console.log('✓ 已创建作品分类');
  }

  // 套系（2 条）
  const pkgCount = await get('SELECT COUNT(*) AS c FROM packages');
  let firstPkgId = null;
  if (pkgCount.c === 0) {
    firstPkgId = await insert(
      `INSERT INTO packages (name, price, category_id, description, addons, marketing, status, sort)
       VALUES (?,?,?,?,?,?,?,?)`,
      ['经典单机位套餐', 2680, (await get("SELECT id FROM categories WHERE name='婚礼'")).id,
        '单机位全天跟拍 + 精修 50 张 + 全部底片',
        JSON.stringify([{ name: '加精修/张', price: 60 }, { name: '相册制作', price: 380 }]),
        JSON.stringify({ coupon: '新客立减200', activity: '转发朋友圈送摆台' }),
        'on', 0]
    );
    await insert(
      `INSERT INTO packages (name, price, category_id, description, addons, marketing, status, sort)
       VALUES (?,?,?,?,?,?,?,?)`,
      ['尊享双机位套餐', 4680, (await get("SELECT id FROM categories WHERE name='婚礼'")).id,
        '双机位全天跟拍 + 精修 80 张 + 快剪短视频',
        JSON.stringify([{ name: '加精修/张', price: 60 }, { name: '同款相册', price: 480 }]),
        JSON.stringify({ coupon: '', activity: '老客户推荐返现' }),
        'on', 1]
    );
    console.log('✓ 已创建演示套系');
  } else {
    firstPkgId = (await get('SELECT id FROM packages ORDER BY id ASC')).id;
  }

  // 档期（1 条）
  const scCount = await get('SELECT COUNT(*) AS c FROM schedules');
  if (scCount.c === 0) {
    const today = new Date();
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 3);
    const ds = d.toISOString().slice(0, 10);
    await insert(
      `INSERT INTO schedules (date, period, status, order_no, photographer, note)
       VALUES (?,?,?,?,?,?)`,
      [ds, 'full', 'booked', 'NO20260801', '叶哲', '婚礼跟拍']
    );
    console.log('✓ 已创建演示档期');
  }

  // 演示订单（引用套系 + 收款流水）
  const oCount = await get('SELECT COUNT(*) AS c FROM orders');
  if (oCount.c === 0) {
    const pkg = await get('SELECT * FROM packages WHERE id = ?', [firstPkgId]);
    const snapshot = JSON.stringify({ id: pkg.id, name: pkg.name, price: pkg.price });
    const order_no = 'NO20260801';
    const total = parseFloat(pkg.price);
    const oid = await insert(
      `INSERT INTO orders (order_no, customer_name, customer_phone, package_id, package_snapshot, addons_snapshot,
        status, deposit, balance, deposit_method, balance_method, shoot_date, executor, total_amount, paid_amount, remark, logs)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [order_no, 'demo客户', '13800000000', pkg.id, snapshot, JSON.stringify([]),
        'deposit', 2580, 2100, 'online', 'offline', '2026-08-10', '叶哲', total, 2580, '首单演示',
        JSON.stringify([{ t: new Date().toISOString(), text: '创建订单' }])]
    );
    await insert('INSERT INTO payments (order_id, order_no, type, amount, method, note) VALUES (?,?,?,?,?,?)',
      [oid, order_no, 'deposit', 2580, 'online', '微信定金']);
    console.log('✓ 已创建演示订单 + 定金流水');
  }

  // 演示作品
  const wCount = await get('SELECT COUNT(*) AS c FROM works');
  if (wCount.c === 0) {
    const cid = (await get("SELECT id FROM categories WHERE name = '婚礼'")).id;
    const wid = await insert(
      `INSERT INTO works (title, category_id, is_public, is_private, cover_url, description, tags, customer_name)
       VALUES (?,?,?,?,?,?,?,?)`,
      ['海边婚礼客片', cid, 1, 0, '', '2026 夏季海边婚礼纪实', JSON.stringify(['婚礼', '海景']), 'demo客户']
    );
    await insert('INSERT INTO albums (work_id, zone, photo_url, sort) VALUES (?,?,?,?)', [wid, 'sample', '', 0]);
    console.log('✓ 已创建演示作品');
  }

  console.log('种子数据完成（演示套系/档期/订单+收款/作品，重启部署数据持久化不会丢失）');
}

// 命令行直接执行时运行
if (import.meta.url === `file://${process.argv[1]}`) {
  initSchema().then(async () => {
    await seedIfNeeded();
    process.exit(0);
  }).catch((e) => { console.error(e); process.exit(1); });
}
