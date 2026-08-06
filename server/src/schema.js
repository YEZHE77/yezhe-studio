// schema.js —— 建表与向前兼容迁移
// 两种方言各自 DDL；首次启动自动创建；后续新增列用 ensureColumn 增量迁移，绝不破坏已有数据。
import { dialect, run, query } from './db.js';

const PG_DDL = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'photographer', name TEXT, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'work', sort INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1, deleted INTEGER NOT NULL DEFAULT 0, preset INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS works (
  id SERIAL PRIMARY KEY, title TEXT NOT NULL, category_id INTEGER, is_public INTEGER NOT NULL DEFAULT 1,
  is_private INTEGER NOT NULL DEFAULT 0, cover_url TEXT, description TEXT, blessing TEXT,
  tags TEXT, live INTEGER NOT NULL DEFAULT 0, customer_name TEXT, order_id INTEGER, category_ids TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS albums (
  id SERIAL PRIMARY KEY, work_id INTEGER NOT NULL, zone TEXT NOT NULL DEFAULT 'sample',
  photo_url TEXT, local_path TEXT, sort INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS selections (
  id SERIAL PRIMARY KEY, work_id INTEGER NOT NULL, client_openid TEXT, selected TEXT, extra_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY, order_no TEXT, customer_name TEXT, package_id INTEGER, status TEXT NOT NULL DEFAULT 'unpaid',
  deposit REAL NOT NULL DEFAULT 0, balance REAL NOT NULL DEFAULT 0, deposit_method TEXT, balance_method TEXT,
  shoot_date TEXT, executor TEXT, created_at TIMESTAMPTZ DEFAULT now()
);`;

const SQLITE_DDL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'photographer', name TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'work', sort INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1, deleted INTEGER NOT NULL DEFAULT 0, preset INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS works (
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, category_id INTEGER, is_public INTEGER NOT NULL DEFAULT 1,
  is_private INTEGER NOT NULL DEFAULT 0, cover_url TEXT, description TEXT, blessing TEXT,
  tags TEXT, live INTEGER NOT NULL DEFAULT 0, customer_name TEXT, order_id INTEGER, category_ids TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS albums (
  id INTEGER PRIMARY KEY AUTOINCREMENT, work_id INTEGER NOT NULL, zone TEXT NOT NULL DEFAULT 'sample',
  photo_url TEXT, local_path TEXT, sort INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS selections (
  id INTEGER PRIMARY KEY AUTOINCREMENT, work_id INTEGER NOT NULL, client_openid TEXT, selected TEXT, extra_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_no TEXT, customer_name TEXT, package_id INTEGER, status TEXT NOT NULL DEFAULT 'unpaid',
  deposit REAL NOT NULL DEFAULT 0, balance REAL NOT NULL DEFAULT 0, deposit_method TEXT, balance_method TEXT,
  shoot_date TEXT, executor TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);`;

// 系统设置（工作室资料等键值对，公开读 / 商户写）
const PG_SETTINGS = `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);`;
const SQLITE_SETTINGS = `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);`;

// 套系管理
const PG_PACKAGES = `
CREATE TABLE IF NOT EXISTS packages (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, category_id INTEGER,
  cover_url TEXT, description TEXT, addons TEXT, marketing TEXT, status TEXT NOT NULL DEFAULT 'on',
  sort INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now()
);`;
const SQLITE_PACKAGES = `
CREATE TABLE IF NOT EXISTS packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, category_id INTEGER,
  cover_url TEXT, description TEXT, addons TEXT, marketing TEXT, status TEXT NOT NULL DEFAULT 'on',
  sort INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);`;

// 档期管理
const PG_SCHEDULES = `
CREATE TABLE IF NOT EXISTS schedules (
  id SERIAL PRIMARY KEY, date TEXT NOT NULL, period TEXT NOT NULL DEFAULT 'full',
  status TEXT NOT NULL DEFAULT 'free', order_no TEXT, photographer TEXT, note TEXT, created_at TIMESTAMPTZ DEFAULT now()
);`;
const SQLITE_SCHEDULES = `
CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, period TEXT NOT NULL DEFAULT 'full',
  status TEXT NOT NULL DEFAULT 'free', order_no TEXT, photographer TEXT, note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);`;

// 收款流水（财务看板与资金流水的唯一可信来源）
const PG_PAYMENTS = `
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY, order_id INTEGER, order_no TEXT, type TEXT NOT NULL DEFAULT 'deposit',
  amount REAL NOT NULL DEFAULT 0, method TEXT NOT NULL DEFAULT 'offline', note TEXT, created_at TIMESTAMPTZ DEFAULT now()
);`;
const SQLITE_PAYMENTS = `
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER, order_no TEXT, type TEXT NOT NULL DEFAULT 'deposit',
  amount REAL NOT NULL DEFAULT 0, method TEXT NOT NULL DEFAULT 'offline', note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);`;

// 统一分享内核（5 大 C 端模块共用底座）：shares 分享令牌表 + share_logs 访问留痕
// token 为主键（公开访问标识）；type 区分 order/work/package/schedule/bill；password_hash 可选密码(bcrypt)；
// expire_at 可选有效期(ISO日期)；disabled 启停；share_logs 记录 view/verify/deny 等动作。
const PG_SHARE_TABLES = `
CREATE TABLE IF NOT EXISTS shares (
  token TEXT PRIMARY KEY, type TEXT NOT NULL DEFAULT 'order', ref_id INTEGER,
  title TEXT, password_hash TEXT, expire_at TEXT, disabled INTEGER NOT NULL DEFAULT 0,
  created_by TEXT, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS share_logs (
  id SERIAL PRIMARY KEY, token TEXT NOT NULL, action TEXT NOT NULL DEFAULT 'view',
  detail TEXT, ip TEXT, ua TEXT, created_at TIMESTAMPTZ DEFAULT now()
);`;
const SQLITE_SHARE_TABLES = `
CREATE TABLE IF NOT EXISTS shares (
  token TEXT PRIMARY KEY, type TEXT NOT NULL DEFAULT 'order', ref_id INTEGER,
  title TEXT, password_hash TEXT, expire_at TEXT, disabled INTEGER NOT NULL DEFAULT 0,
  created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS share_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL, action TEXT NOT NULL DEFAULT 'view',
  detail TEXT, ip TEXT, ua TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);`;

// 媒资元数据表（容量管理模块）：按业务分类记录每张图片的 URL / 字节数 / 是否公开
// 用于存储空间「按业务分类统计」——走 SQL 聚合，绝不整桶遍历 R2（约束 3）。
// totalUsed 的实际桶大小由 Cloudflare API 提供（接入 R2 时），本地模式则回退到本表汇总 + 目录扫描。
const PG_MEDIA = `
CREATE TABLE IF NOT EXISTS media (
  id SERIAL PRIMARY KEY, url TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'uncategorized',
  r2_key TEXT, bytes BIGINT NOT NULL DEFAULT 0, is_public INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_url ON media(url);`;
const SQLITE_MEDIA = `
CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'uncategorized',
  r2_key TEXT, bytes INTEGER NOT NULL DEFAULT 0, is_public INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_url ON media(url);`;

// 客片电子相册（C 端对外分享：婚礼/领证等客片轮播页）
// 单表存元数据 + 照片 URL 数组（JSON）；分享令牌复用 shares 表的 album 类型；绝不含 local 原片。
const PG_GALLERIES = `
CREATE TABLE IF NOT EXISTS galleries (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  subtitle TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '婚礼',
  blessing TEXT NOT NULL DEFAULT '',
  cover_url TEXT NOT NULL DEFAULT '',
  photos TEXT NOT NULL DEFAULT '[]',
  brand_name TEXT NOT NULL DEFAULT '',
  brand_slogan TEXT NOT NULL DEFAULT '',
  brand_logo TEXT NOT NULL DEFAULT '',
  order_id INTEGER,
  share_token TEXT,
  is_public INTEGER NOT NULL DEFAULT 1,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);`;
const SQLITE_GALLERIES = `
CREATE TABLE IF NOT EXISTS galleries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '',
  subtitle TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '婚礼',
  blessing TEXT NOT NULL DEFAULT '',
  cover_url TEXT NOT NULL DEFAULT '',
  photos TEXT NOT NULL DEFAULT '[]',
  brand_name TEXT NOT NULL DEFAULT '',
  brand_slogan TEXT NOT NULL DEFAULT '',
  brand_logo TEXT NOT NULL DEFAULT '',
  order_id INTEGER,
  share_token TEXT,
  is_public INTEGER NOT NULL DEFAULT 1,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);`;

// 客户侧（C 端小程序）新表：customers / appointments / photo_select / evaluates
// 双方言 DDL；首次启动自动创建；向前兼容用 ensureColumn 给 orders/works 补列。
const PG_CUSTOMER_TABLES = `
CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY, openid TEXT UNIQUE NOT NULL, nickname TEXT, avatar TEXT, phone TEXT,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS appointments (
  id SERIAL PRIMARY KEY, openid TEXT NOT NULL, name TEXT, phone TEXT, package_id INTEGER,
  hope_date TEXT, remark TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS photo_select (
  id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL, openid TEXT NOT NULL, marks TEXT,
  draft TEXT, submitted INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS evaluates (
  id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL, openid TEXT NOT NULL, stars INTEGER NOT NULL DEFAULT 5,
  text TEXT, images TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT now()
);`;
const SQLITE_CUSTOMER_TABLES = `
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, openid TEXT UNIQUE NOT NULL, nickname TEXT, avatar TEXT, phone TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, openid TEXT NOT NULL, name TEXT, phone TEXT, package_id INTEGER,
  hope_date TEXT, remark TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS photo_select (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, openid TEXT NOT NULL, marks TEXT,
  draft TEXT, submitted INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS evaluates (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, openid TEXT NOT NULL, stars INTEGER NOT NULL DEFAULT 5,
  text TEXT, images TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);`;

// orders 的向前兼容新增列（仅当不存在时补加，绝不删列/不破坏数据）
const ORDERS_NEW_COLUMNS = [
  ['customer_phone', 'TEXT'],
  ['package_snapshot', dialect === 'pg' ? 'TEXT' : 'TEXT'],
  ['addons_snapshot', dialect === 'pg' ? 'TEXT' : 'TEXT'],
  ['total_amount', 'REAL NOT NULL DEFAULT 0'],
  ['paid_amount', 'REAL NOT NULL DEFAULT 0'],
  ['remark', 'TEXT'],
  ['logs', dialect === 'pg' ? 'TEXT' : 'TEXT'],
  ['refund_amount', 'REAL NOT NULL DEFAULT 0'],
  ['cancelled', 'INTEGER NOT NULL DEFAULT 0'],
  ['is_deleted', 'INTEGER NOT NULL DEFAULT 0'],
  ['deleted_at', 'TEXT'],
  ['raw_storage_days', 'INTEGER NOT NULL DEFAULT 30'],
  ['retouch_storage_days', 'INTEGER NOT NULL DEFAULT 180'],
  ['raw_expire_at', 'TEXT'],
  ['retouch_expire_at', 'TEXT'],
  ['share_token', 'TEXT'],
  ['qr_url', 'TEXT'],
  ['questionnaire_answers', 'TEXT'], // 客户拍摄问卷答案（确认后回写，与下单时刻套系快照隔离）
  ['groom_name', 'TEXT'], // 新郎姓名
  ['bride_name', 'TEXT'], // 新娘姓名
  ['address', 'TEXT'] // 拍摄地址
];

async function colsOf(table) {
  if (dialect === 'pg') {
    const r = await query(`SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [table]);
    return r.map((x) => x.column_name);
  }
  const r = await query(`PRAGMA table_info(${table})`);
  return r.map((x) => x.name);
}

async function ensureColumn(table, col, def) {
  const cols = await colsOf(table);
  if (!cols.includes(col)) {
    await run(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    console.log(`[schema] 增量补列 ${table}.${col}`);
  }
}

export async function initSchema() {
  const ddl = dialect === 'pg' ? PG_DDL : SQLITE_DDL;
  const stmts = ddl.split(';').map((s) => s.trim()).filter(Boolean);
  for (const s of stmts) await run(s);

  // 新增表
  for (const s of (dialect === 'pg' ? PG_PACKAGES : SQLITE_PACKAGES).split(';').map((x) => x.trim()).filter(Boolean)) await run(s);
  for (const s of (dialect === 'pg' ? PG_SCHEDULES : SQLITE_SCHEDULES).split(';').map((x) => x.trim()).filter(Boolean)) await run(s);
  for (const s of (dialect === 'pg' ? PG_PAYMENTS : SQLITE_PAYMENTS).split(';').map((x) => x.trim()).filter(Boolean)) await run(s);

  // 客户侧新表
  for (const s of (dialect === 'pg' ? PG_CUSTOMER_TABLES : SQLITE_CUSTOMER_TABLES).split(';').map((x) => x.trim()).filter(Boolean)) await run(s);

  // 系统设置表
  for (const s of (dialect === 'pg' ? PG_SETTINGS : SQLITE_SETTINGS).split(';').map((x) => x.trim()).filter(Boolean)) await run(s);

  // 统一分享内核表（shares + share_logs）
  for (const s of (dialect === 'pg' ? PG_SHARE_TABLES : SQLITE_SHARE_TABLES).split(';').map((x) => x.trim()).filter(Boolean)) await run(s);

  // 媒资元数据表（容量管理：按业务分类汇总）
  for (const s of (dialect === 'pg' ? PG_MEDIA : SQLITE_MEDIA).split(';').map((x) => x.trim()).filter(Boolean)) await run(s);

  // 客片电子相册表（C 端对外分享）
  for (const s of (dialect === 'pg' ? PG_GALLERIES : SQLITE_GALLERIES).split(';').map((x) => x.trim()).filter(Boolean)) await run(s);

  // orders 增量补列
  for (const [col, def] of ORDERS_NEW_COLUMNS) await ensureColumn('orders', col, def);
  // 客户绑定列 + 成片下载开关
  await ensureColumn('orders', 'openid', 'TEXT');
  await ensureColumn('works', 'allow_download', 'INTEGER NOT NULL DEFAULT 0');
  // 相册级配置（客户相册密码 / 自定义文案 / 有效期）——挂在作品维度（作品相册即交付客户的客片相册）
  await ensureColumn('works', 'album_copy', 'TEXT');
  await ensureColumn('works', 'album_password_enabled', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('works', 'album_password', 'TEXT');
  await ensureColumn('works', 'album_expires_at', 'TEXT');
  // 多分类支持：category_ids 以逗号分隔存储分类 id；不为旧数据回填（category_id→category_ids）
  await ensureColumn('works', 'category_ids', 'TEXT');
  // 相册照片去重检测：存原始文件名 + 字节数，组合签名 key = `${original_name}_${original_size}`
  // 小程序端无真实文件名（临时路径），由 wx.getFileInfo 取 size+digest，original_name 存 digest。
  await ensureColumn('albums', 'original_name', 'TEXT');
  await ensureColumn('albums', 'original_size', dialect === 'pg' ? 'BIGINT' : 'INTEGER');

  // categories 增量补列（is_active 启用/禁用、deleted 软删、preset 预设保护）
  await ensureColumn('categories', 'is_active', 'INTEGER NOT NULL DEFAULT 1');
  await ensureColumn('categories', 'deleted', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('categories', 'preset', 'INTEGER NOT NULL DEFAULT 0');
  // 一次性迁移：旧单分类数据落到 category_ids（仅当 category_ids 为空且 category_id 有值）
  await run(`UPDATE works SET category_ids = CAST(category_id AS TEXT) WHERE category_ids IS NULL AND category_id IS NOT NULL`);
  await run(`UPDATE works SET category_ids = '' WHERE category_ids IS NULL`);
  // packages / schedules 增量补列
  const PACKAGES_NEW_COLUMNS = [
    ['deposit', 'REAL NOT NULL DEFAULT 0'],
    ['retouch_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['raw_policy', 'TEXT'],
    ['duration', 'TEXT'],
    ['questionnaire', 'TEXT'],
    ['specs', 'TEXT'] // 多规格配置（同一套系多个版本，独立价格/服务）
  ];
  for (const [col, def] of PACKAGES_NEW_COLUMNS) await ensureColumn('packages', col, def);
  await ensureColumn('schedules', 'lunar_date', 'TEXT');
  // 档期客户信息（婚礼场景）
  const SCHEDULES_NEW_COLUMNS = [
    ['groom_name', 'TEXT'],
    ['bride_name', 'TEXT'],
    ['contact_phone', 'TEXT'],
    ['address', 'TEXT']
  ];
  for (const [col, def] of SCHEDULES_NEW_COLUMNS) await ensureColumn('schedules', col, def);

  // 预约扩展列（档期预约模块：时段 period / 拒绝原因 / 来源标记 / 关联档期与订单 / 处理时间）
  // 状态语义：pending(待确认) / confirmed(已确认生成订单) / rejected(已拒绝) / cancelled(已取消)
  const APPOINTMENT_NEW_COLUMNS = [
    ['period', 'TEXT'],
    ['reject_reason', 'TEXT'],
    ['source', 'TEXT'],
    ['schedule_id', 'INTEGER'],
    ['order_id', 'INTEGER'],
    ['handled_at', 'TEXT'],
    ['spec_id', 'INTEGER'] // 客户预约时选中的套系规格（多规格场景下定位具体版本）
  ];
  for (const [col, def] of APPOINTMENT_NEW_COLUMNS) await ensureColumn('appointments', col, def);

  console.log('[schema] 表结构已就绪');
}

// 小工具：把数据库行里的 json 文本列解析成对象
export function parseRow(row, jsonCols = []) {
  if (!row) return row;
  const out = { ...row };
  for (const c of jsonCols) {
    if (out[c] && typeof out[c] === 'string') {
      try { out[c] = JSON.parse(out[c]); } catch { out[c] = []; }
    }
  }
  return out;
}

export { query };
