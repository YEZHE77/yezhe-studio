// schema.js —— 建表与向前兼容迁移
// 两种方言各自 DDL；首次启动自动创建；后续新增列用 ensureColumn 增量迁移，绝不破坏已有数据。
import { dialect, run, query, get, insert } from './db.js';

// 表结构版本号：已初始化的库启动时跳过全量 DDL/ensureColumn（Render 冷启动加速，130+ 次 DB 往返 → 1 次 SELECT）。
// 约定：新增表/列/约束时同步 +1，下次启动自动全量幂等重跑并回写新版本号。
const SCHEMA_VERSION = 3;

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
  id SERIAL PRIMARY KEY, order_no TEXT, customer_name TEXT, package_id INTEGER, status TEXT NOT NULL DEFAULT 'deposit',
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
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_no TEXT, customer_name TEXT, package_id INTEGER, status TEXT NOT NULL DEFAULT 'deposit',
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
// method 分组线上/线下（online/offline）；channel 记录具体收款渠道：
// wechat=微信、alipay=支付宝、cash=现金、bank=银行转账、online=线上支付（线上不细分时）
const PG_PAYMENTS = `
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY, order_id INTEGER, order_no TEXT, type TEXT NOT NULL DEFAULT 'deposit',
  amount REAL NOT NULL DEFAULT 0, method TEXT NOT NULL DEFAULT 'offline', channel TEXT NOT NULL DEFAULT 'cash',
  note TEXT, created_at TIMESTAMPTZ DEFAULT now()
);`;
const SQLITE_PAYMENTS = `
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER, order_no TEXT, type TEXT NOT NULL DEFAULT 'deposit',
  amount REAL NOT NULL DEFAULT 0, method TEXT NOT NULL DEFAULT 'offline', channel TEXT NOT NULL DEFAULT 'cash',
  note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
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

// 选片工具（对标拾光盒子 Lite）：selection_tasks 选片任务（业务配置 + 图片 URL JSON）+ selection_marks 逐张三态标记
// token 复用 shares 表（type='selection', ref_id=selection_tasks.id），密码/有效期/启停走 shares 通用内核
const PG_SELECTION_TABLES = `
CREATE TABLE IF NOT EXISTS selection_tasks (
  id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL,
  min_retouch INTEGER NOT NULL DEFAULT 0, extra_price REAL NOT NULL DEFAULT 0,
  watermark_enabled INTEGER NOT NULL DEFAULT 0, photos TEXT,
  submitted INTEGER NOT NULL DEFAULT 0, submitted_at TEXT,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS selection_marks (
  id SERIAL PRIMARY KEY, task_id INTEGER NOT NULL, photo_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(task_id, photo_key)
);`;
const SQLITE_SELECTION_TABLES = `
CREATE TABLE IF NOT EXISTS selection_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL,
  min_retouch INTEGER NOT NULL DEFAULT 0, extra_price REAL NOT NULL DEFAULT 0,
  watermark_enabled INTEGER NOT NULL DEFAULT 0, photos TEXT,
  submitted INTEGER NOT NULL DEFAULT 0, submitted_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS selection_marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL, photo_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(task_id, photo_key)
);`;

// ===== 选片模块 V2（三表架构，贴合原版；旧 selection_tasks/selection_marks/photo_select 弃用保留） =====
// ① order_photo 底片元数据（属于订单，跨选片轮次持久，重置选片不清底片）
// ② order_select_task 本轮选片任务状态机 + 缓存统计（每订单一行）
//    status 枚举：not_started 未开启 / selecting 选片中 / pending_payment 待支付加片费 / completed 已完成 / reset 已重置
//    pending_fee/pending_count 待支付加片金额/数量（原版：有加片费提交后进入待支付，选片不锁定）
// ③ order_select_mark 单张照片标记 + 备注（status: keep 保留 / reject 淘汰；无行=未标记）
// 支付流水复用 payments 表（不新增快照表，贴合原版数据结构）
const PG_SELECTION_V2_TABLES = `
CREATE TABLE IF NOT EXISTS order_photo (
  id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), photo_key TEXT NOT NULL,
  url TEXT NOT NULL, thumb_url TEXT, sort INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(order_id, photo_key),
  CONSTRAINT chk_order_photo_ge0 CHECK (sort >= 0 AND deleted >= 0)
);
CREATE INDEX IF NOT EXISTS idx_order_photo_order ON order_photo(order_id, deleted, sort);
CREATE TABLE IF NOT EXISTS order_select_task (
  id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  status TEXT NOT NULL DEFAULT 'not_started',
  password_hash TEXT, expire_at TEXT,
  shuffle_enabled INTEGER NOT NULL DEFAULT 0, watermark_enabled INTEGER NOT NULL DEFAULT 0,
  min_retouch INTEGER NOT NULL DEFAULT 0, extra_price REAL NOT NULL DEFAULT 0,
  like_count INTEGER NOT NULL DEFAULT 0, exclude_count INTEGER NOT NULL DEFAULT 0,
  extra_count INTEGER NOT NULL DEFAULT 0, extra_fee REAL NOT NULL DEFAULT 0,
  pending_fee REAL NOT NULL DEFAULT 0, pending_count INTEGER NOT NULL DEFAULT 0,
  paid_at TEXT, pay_flow_no TEXT,
  version INTEGER NOT NULL DEFAULT 0, submitted_at TEXT, reset_at TEXT,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT chk_order_select_task_status CHECK (status IN ('not_started','selecting','pending_payment','completed','reset')),
  CONSTRAINT chk_order_select_task_ge0 CHECK (min_retouch >= 0 AND extra_price >= 0 AND like_count >= 0 AND exclude_count >= 0 AND extra_count >= 0 AND extra_fee >= 0 AND pending_fee >= 0 AND pending_count >= 0 AND version >= 0)
);
CREATE TABLE IF NOT EXISTS order_select_mark (
  id SERIAL PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES order_select_task(id), photo_id INTEGER NOT NULL REFERENCES order_photo(id),
  status TEXT NOT NULL DEFAULT 'keep', remark TEXT,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(task_id, photo_id),
  CONSTRAINT chk_order_select_mark_status CHECK (status IN ('keep','reject'))
);
CREATE INDEX IF NOT EXISTS idx_order_select_mark_task ON order_select_mark(task_id);`;
const SQLITE_SELECTION_V2_TABLES = `
CREATE TABLE IF NOT EXISTS order_photo (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id), photo_key TEXT NOT NULL,
  url TEXT NOT NULL, thumb_url TEXT, sort INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(order_id, photo_key),
  CHECK (sort >= 0 AND deleted >= 0)
);
CREATE INDEX IF NOT EXISTS idx_order_photo_order ON order_photo(order_id, deleted, sort);
CREATE TABLE IF NOT EXISTS order_select_task (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  status TEXT NOT NULL DEFAULT 'not_started',
  password_hash TEXT, expire_at TEXT,
  shuffle_enabled INTEGER NOT NULL DEFAULT 0, watermark_enabled INTEGER NOT NULL DEFAULT 0,
  min_retouch INTEGER NOT NULL DEFAULT 0, extra_price REAL NOT NULL DEFAULT 0,
  like_count INTEGER NOT NULL DEFAULT 0, exclude_count INTEGER NOT NULL DEFAULT 0,
  extra_count INTEGER NOT NULL DEFAULT 0, extra_fee REAL NOT NULL DEFAULT 0,
  pending_fee REAL NOT NULL DEFAULT 0, pending_count INTEGER NOT NULL DEFAULT 0,
  paid_at TEXT, pay_flow_no TEXT,
  version INTEGER NOT NULL DEFAULT 0, submitted_at TEXT, reset_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  CHECK (status IN ('not_started','selecting','pending_payment','completed','reset')),
  CHECK (min_retouch >= 0 AND extra_price >= 0 AND like_count >= 0 AND exclude_count >= 0 AND extra_count >= 0 AND extra_fee >= 0 AND pending_fee >= 0 AND pending_count >= 0 AND version >= 0)
);
CREATE TABLE IF NOT EXISTS order_select_mark (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL REFERENCES order_select_task(id), photo_id INTEGER NOT NULL REFERENCES order_photo(id),
  status TEXT NOT NULL DEFAULT 'keep', remark TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(task_id, photo_id),
  CHECK (status IN ('keep','reject'))
);
CREATE INDEX IF NOT EXISTS idx_order_select_mark_task ON order_select_mark(task_id);`;

// 消息中心（B 端管理员）：system_message 系统消息表
// message_type: customer_consult 顾客咨询 / order_msg 订单消息 / todo_alert 待办提醒 / system 系统通知
// 去重：business_event + rel_id，5 分钟内相同事件不重复生成
const PG_MESSAGE_TABLES = `
CREATE TABLE IF NOT EXISTS system_message (
  id SERIAL PRIMARY KEY, receiver_uid INTEGER, message_type TEXT NOT NULL DEFAULT 'system',
  business_event TEXT, title TEXT, content TEXT, rel_id TEXT, rel_model TEXT,
  is_read INTEGER NOT NULL DEFAULT 0, is_archived INTEGER NOT NULL DEFAULT 0,
  can_wechat_push INTEGER NOT NULL DEFAULT 0, wechat_push_status TEXT NOT NULL DEFAULT 'none',
  create_time TIMESTAMPTZ DEFAULT now(), read_time TEXT
);
CREATE INDEX IF NOT EXISTS idx_system_message_receiver ON system_message(receiver_uid, is_read, is_archived);
CREATE INDEX IF NOT EXISTS idx_system_message_dedup ON system_message(business_event, rel_id, create_time);`;
const SQLITE_MESSAGE_TABLES = `
CREATE TABLE IF NOT EXISTS system_message (
  id INTEGER PRIMARY KEY AUTOINCREMENT, receiver_uid INTEGER, message_type TEXT NOT NULL DEFAULT 'system',
  business_event TEXT, title TEXT, content TEXT, rel_id TEXT, rel_model TEXT,
  is_read INTEGER NOT NULL DEFAULT 0, is_archived INTEGER NOT NULL DEFAULT 0,
  can_wechat_push INTEGER NOT NULL DEFAULT 0, wechat_push_status TEXT NOT NULL DEFAULT 'none',
  create_time TEXT DEFAULT CURRENT_TIMESTAMP, read_time TEXT
);
CREATE INDEX IF NOT EXISTS idx_system_message_receiver ON system_message(receiver_uid, is_read, is_archived);
CREATE INDEX IF NOT EXISTS idx_system_message_dedup ON system_message(business_event, rel_id, create_time);`;

// 移动端业务消息中心：biz_message（与 system_message 独立，与 todo_items 独立）
// user_id 账号隔离；biz_type 业务来源（select_photo/schedule/order/system）；biz_id 关联业务主键
// 仅做业务事件通知，非 IM；PC + H5 共用一套数据
const PG_BIZ_MESSAGE = `
CREATE TABLE IF NOT EXISTS biz_message (
  id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL,
  title TEXT NOT NULL, content TEXT,
  biz_type TEXT NOT NULL DEFAULT 'system', biz_id TEXT, biz_extra TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_biz_message_user ON biz_message(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_biz_message_biz ON biz_message(biz_type, biz_id);`;
const SQLITE_BIZ_MESSAGE = `
CREATE TABLE IF NOT EXISTS biz_message (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
  title TEXT NOT NULL, content TEXT,
  biz_type TEXT NOT NULL DEFAULT 'system', biz_id TEXT, biz_extra TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_biz_message_user ON biz_message(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_biz_message_biz ON biz_message(biz_type, biz_id);`;

// 访客埋点（C 端 H5 访问日志）：visitor_id 由浏览器 localStorage uuid 生成，H5 无微信环境故 nickname/phone 恒空
const PG_VISITOR_LOG = `
CREATE TABLE IF NOT EXISTS visitor_log (
  id SERIAL PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  nickname TEXT, phone TEXT,
  visit_time TEXT, visit_page TEXT, source TEXT,
  business_uid INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_visitor_log_vid ON visitor_log(visitor_id, created_at DESC);`;
const SQLITE_VISITOR_LOG = `
CREATE TABLE IF NOT EXISTS visitor_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id TEXT NOT NULL,
  nickname TEXT, phone TEXT,
  visit_time TEXT, visit_page TEXT, source TEXT,
  business_uid INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_visitor_log_vid ON visitor_log(visitor_id, created_at DESC);`;

// 访客设置（business_uid 主键；visitor_password 存 bcrypt 哈希，非空=已开启；only_show_nickname 已废弃不展示）
const PG_VISITOR_SETTING = `
CREATE TABLE IF NOT EXISTS visitor_setting (
  business_uid INTEGER PRIMARY KEY,
  visitor_password TEXT,
  only_show_nickname INTEGER NOT NULL DEFAULT 0
);`;
const SQLITE_VISITOR_SETTING = `
CREATE TABLE IF NOT EXISTS visitor_setting (
  business_uid INTEGER PRIMARY KEY,
  visitor_password TEXT,
  only_show_nickname INTEGER NOT NULL DEFAULT 0
);`;

// 访客黑名单 / 免打扰（visitor_id 维度，独立于日志）
const PG_VISITOR_BLACKLIST = `CREATE TABLE IF NOT EXISTS visitor_blacklist (visitor_id TEXT PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now());`;
const SQLITE_VISITOR_BLACKLIST = `CREATE TABLE IF NOT EXISTS visitor_blacklist (visitor_id TEXT PRIMARY KEY, created_at TEXT DEFAULT CURRENT_TIMESTAMP);`;
const PG_VISITOR_NO_DISTURB = `CREATE TABLE IF NOT EXISTS visitor_no_disturb (visitor_id TEXT PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now());`;
const SQLITE_VISITOR_NO_DISTURB = `CREATE TABLE IF NOT EXISTS visitor_no_disturb (visitor_id TEXT PRIMARY KEY, created_at TEXT DEFAULT CURRENT_TIMESTAMP);`;

// 套系对外分享（C 端浏览报价）：photo_package 套系表（独立于 B 端内部 packages）
// share_token 随机不可猜测字符串，对外鉴权；is_enable 控制外部访问
const PG_PHOTO_PACKAGE = `
CREATE TABLE IF NOT EXISTS photo_package (
  id SERIAL PRIMARY KEY, package_name TEXT NOT NULL, cover_image TEXT, package_desc TEXT,
  shoot_duration TEXT, shoot_scope TEXT, photo_total INTEGER NOT NULL DEFAULT 0,
  retouch_count INTEGER NOT NULL DEFAULT 0, original_file TEXT,
  price REAL NOT NULL DEFAULT 0, additional_price REAL NOT NULL DEFAULT 0,
  other_service TEXT, notice TEXT, share_token TEXT, is_enable INTEGER NOT NULL DEFAULT 1,
  create_time TIMESTAMPTZ DEFAULT now(), update_time TIMESTAMPTZ DEFAULT now()
);`;
const SQLITE_PHOTO_PACKAGE = `
CREATE TABLE IF NOT EXISTS photo_package (
  id INTEGER PRIMARY KEY AUTOINCREMENT, package_name TEXT NOT NULL, cover_image TEXT, package_desc TEXT,
  shoot_duration TEXT, shoot_scope TEXT, photo_total INTEGER NOT NULL DEFAULT 0,
  retouch_count INTEGER NOT NULL DEFAULT 0, original_file TEXT,
  price REAL NOT NULL DEFAULT 0, additional_price REAL NOT NULL DEFAULT 0,
  other_service TEXT, notice TEXT, share_token TEXT, is_enable INTEGER NOT NULL DEFAULT 1,
  create_time TEXT DEFAULT CURRENT_TIMESTAMP, update_time TEXT DEFAULT CURRENT_TIMESTAMP
);`;

// 合同模板（订单一键生成 PDF）：template_content 富文本带 {{占位符}} 为渲染唯一数据源
// backup_word_url 仅后台备份下载；is_default 新建订单自动选中
const PG_CONTRACT_TEMPLATE = `
CREATE TABLE IF NOT EXISTS contract_template (
  id SERIAL PRIMARY KEY, template_name TEXT NOT NULL, template_content TEXT,
  backup_word_url TEXT, is_default INTEGER NOT NULL DEFAULT 0,
  create_time TIMESTAMPTZ DEFAULT now(), update_time TIMESTAMPTZ DEFAULT now()
);`;
const SQLITE_CONTRACT_TEMPLATE = `
CREATE TABLE IF NOT EXISTS contract_template (
  id INTEGER PRIMARY KEY AUTOINCREMENT, template_name TEXT NOT NULL, template_content TEXT,
  backup_word_url TEXT, is_default INTEGER NOT NULL DEFAULT 0,
  create_time TEXT DEFAULT CURRENT_TIMESTAMP, update_time TEXT DEFAULT CURRENT_TIMESTAMP
);`;

// 电子服务协议签署记录（C端客户手写签名，绑定订单；签署后不可篡改，仅允许追加历史版本）
// content_snapshot = 签署当时的协议全文快照（防篡改）；signature = 手写签名图片(base64 或对象 key)
const PG_AGREEMENT_SIGN = `
CREATE TABLE IF NOT EXISTS agreement_sign (
  id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL,
  customer_name TEXT, signer_phone TEXT,
  signature TEXT, content_snapshot TEXT,
  signed_at TEXT, device TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agreement_sign_order ON agreement_sign(order_id, created_at);`;
const SQLITE_AGREEMENT_SIGN = `
CREATE TABLE IF NOT EXISTS agreement_sign (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL,
  customer_name TEXT, signer_phone TEXT,
  signature TEXT, content_snapshot TEXT,
  signed_at TEXT, device TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_agreement_sign_order ON agreement_sign(order_id, created_at);`;

// 合同历史版本归档（重新生成/作废时旧文件归档，保留期内可恢复）
const PG_CONTRACT_ARCHIVE = `
CREATE TABLE IF NOT EXISTS contract_archive (
  id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL, file_key TEXT NOT NULL, file_md5 TEXT,
  generated_at TEXT, archived_at TEXT, reason TEXT, operator_uid INTEGER,
  destroyed_at TEXT
);`;
const SQLITE_CONTRACT_ARCHIVE = `
CREATE TABLE IF NOT EXISTS contract_archive (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, file_key TEXT NOT NULL, file_md5 TEXT,
  generated_at TEXT, archived_at TEXT, reason TEXT, operator_uid INTEGER,
  destroyed_at TEXT
);`;

// 合同操作审计日志（上传/下载/作废/恢复/销毁，全流程留痕）
const PG_CONTRACT_AUDIT = `
CREATE TABLE IF NOT EXISTS contract_audit (
  id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL, operator_uid INTEGER, operator_name TEXT,
  action TEXT NOT NULL, ip TEXT, token TEXT, detail TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);`;
const SQLITE_CONTRACT_AUDIT = `
CREATE TABLE IF NOT EXISTS contract_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, operator_uid INTEGER, operator_name TEXT,
  action TEXT NOT NULL, ip TEXT, token TEXT, detail TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
  ['address', 'TEXT'], // 拍摄地址
  // ↓↓ 新增订单弹窗（2026-08 重构）：多值字段统一以 JSON 文本存储，读取时 parseRow 解析
  ['order_name', 'TEXT'], // 订单名称（如「张先生婚礼跟拍」）
  ['phones', 'TEXT'], // 联系电话数组 JSON: ["138...","139..."]
  ['time_slots', 'TEXT'], // 场次时间标签数组 JSON: ["09:00","10:00"]
  ['period', `TEXT NOT NULL DEFAULT 'full'`], // 档期时长类型：full 全天 / half 半天
  ['extra_items', 'TEXT'], // 其他消费数组 JSON: [{name,amount}]
  ['executors', 'TEXT'], // 执行人数组 JSON: [{id,name,avatar}]
  ['channel', 'TEXT'], // 渠道来源名称快照（渠道被删也保留历史）
  ['channel_id', 'INTEGER'], // 渠道 id（关联 channels 表）
  ['date_tbd', 'INTEGER NOT NULL DEFAULT 0'], // 1=日期待定（意向订单，不占日历档期）
  ['payment_status', `TEXT NOT NULL DEFAULT 'deposit'`], // unpaid 未付定金 / deposit 已付定金 / paid 已付全款
  // ↓↓ C 端预约转订单体系（2026-08-17）：双手机号 + 来源预约 + 简化订单状态 + 定金支付时间
  ['package_name', 'TEXT'], // 套系名称快照（预约转订单时写入；历史订单回退 package_snapshot.name）
  ['phone_two', 'TEXT'], // 第二联系手机号（非必填，支持登录）
  ['reservation_id', 'INTEGER'], // 来源预约 id（预约转订单时写入，可为 null）
  ['order_status', `TEXT NOT NULL DEFAULT 'pending_deposit'`], // 简化订单状态：pending_deposit 待付定金 / deposit_paid 已付定金 / shot_done 拍摄完成 / completed 已完结 / cancelled 已取消
  ['deposit_amount', 'REAL NOT NULL DEFAULT 0'], // 定金金额（预约转订单体系）
  ['deposit_pay_time', 'TEXT'], // 定金支付时间（可为空）
  // ↓↓ 订单分享备注（C 端免登录订单详情页顶部灰色卡片展示；建单时从 system_config 默认值带入，单订单可单独覆盖）
  ['share_note', 'TEXT']
];

// 渠道来源表（后端可配置，前端下拉实时读取，绝不写死）
const PG_CHANNELS = `
CREATE TABLE IF NOT EXISTS channels (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1, deleted INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);`;
const SQLITE_CHANNELS = `
CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1, deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);`;

// 作品访问记录（谁看了预览页）
const PG_WORK_VISITS = `
CREATE TABLE IF NOT EXISTS work_visits (
  id SERIAL PRIMARY KEY, work_id INTEGER NOT NULL,
  visitor_name TEXT, visitor_phone TEXT, source TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);`;
const SQLITE_WORK_VISITS = `
CREATE TABLE IF NOT EXISTS work_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT, work_id INTEGER NOT NULL,
  visitor_name TEXT, visitor_phone TEXT, source TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);`;

// 作品评论（客户留言）
const PG_WORK_COMMENTS = `
CREATE TABLE IF NOT EXISTS work_comments (
  id SERIAL PRIMARY KEY, work_id INTEGER NOT NULL,
  author_name TEXT, content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);`;
const SQLITE_WORK_COMMENTS = `
CREATE TABLE IF NOT EXISTS work_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, work_id INTEGER NOT NULL,
  author_name TEXT, content TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);`;

// ===== 自媒体工作台 7 表（灵感库/状态列/选题/草稿/分发记录/复盘/标签）=====
// media_inspiration.pain_points / tags 存 JSON 数组字符串；media_topic.tags 同上；
// media_topic.material_ref 存 JSON { type:'album'|'upload', album_ids:[], urls:[] }；
// media_draft.alt_titles / hashtags / image_ideas 存 JSON；media_review.record_ids / pain_points 存 JSON。
const PG_MEDIA_WORKBENCH = `
CREATE TABLE IF NOT EXISTS media_tag (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, color TEXT DEFAULT '#2DB7F5', created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS media_status_column (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS media_inspiration (
  id SERIAL PRIMARY KEY, title TEXT NOT NULL DEFAULT '', content TEXT,
  source_type TEXT NOT NULL DEFAULT 'manual', source_url TEXT,
  pain_points TEXT, pain_strength INTEGER NOT NULL DEFAULT 3,
  tags TEXT, card_color TEXT DEFAULT '#2DB7F5',
  deleted INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS media_topic (
  id SERIAL PRIMARY KEY, title TEXT NOT NULL DEFAULT '', core_pain TEXT,
  target_platform TEXT, content_form TEXT, priority TEXT NOT NULL DEFAULT 'medium',
  expect_publish_time TEXT, reference_url TEXT,
  status_id INTEGER, sort INTEGER NOT NULL DEFAULT 0,
  card_color TEXT DEFAULT '#2DB7F5', material_ref TEXT,
  inspiration_id INTEGER, tags TEXT,
  deleted INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS media_draft (
  id SERIAL PRIMARY KEY, topic_id INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  content TEXT, alt_titles TEXT, hashtags TEXT, image_ideas TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS media_publish_record (
  id SERIAL PRIMARY KEY, topic_id INTEGER, platform TEXT, publish_url TEXT,
  publish_time TEXT, likes INTEGER NOT NULL DEFAULT 0, favorites INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0, inquiries INTEGER NOT NULL DEFAULT 0, note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS media_review (
  id SERIAL PRIMARY KEY, record_ids TEXT, content TEXT, pain_points TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);`;
const SQLITE_MEDIA_WORKBENCH = `
CREATE TABLE IF NOT EXISTS media_tag (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, color TEXT DEFAULT '#2DB7F5', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS media_status_column (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS media_inspiration (
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL DEFAULT '', content TEXT,
  source_type TEXT NOT NULL DEFAULT 'manual', source_url TEXT,
  pain_points TEXT, pain_strength INTEGER NOT NULL DEFAULT 3,
  tags TEXT, card_color TEXT DEFAULT '#2DB7F5',
  deleted INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS media_topic (
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL DEFAULT '', core_pain TEXT,
  target_platform TEXT, content_form TEXT, priority TEXT NOT NULL DEFAULT 'medium',
  expect_publish_time TEXT, reference_url TEXT,
  status_id INTEGER, sort INTEGER NOT NULL DEFAULT 0,
  card_color TEXT DEFAULT '#2DB7F5', material_ref TEXT,
  inspiration_id INTEGER, tags TEXT,
  deleted INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS media_draft (
  id INTEGER PRIMARY KEY AUTOINCREMENT, topic_id INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  content TEXT, alt_titles TEXT, hashtags TEXT, image_ideas TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS media_publish_record (
  id INTEGER PRIMARY KEY AUTOINCREMENT, topic_id INTEGER, platform TEXT, publish_url TEXT,
  publish_time TEXT, likes INTEGER NOT NULL DEFAULT 0, favorites INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0, inquiries INTEGER NOT NULL DEFAULT 0, note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS media_review (
  id INTEGER PRIMARY KEY AUTOINCREMENT, record_ids TEXT, content TEXT, pain_points TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);`;

// ===== 自媒体 · 对标账号库（media_competitor_account）=====
// analyze_report 存 AI 深度分析完整报告（固定 6 段结构），随时查看历史、不重复调用 AI。
const PG_MEDIA_COMPETITOR = `
CREATE TABLE IF NOT EXISTS media_competitor_account (
  id SERIAL PRIMARY KEY,
  account_name TEXT NOT NULL DEFAULT '', home_url TEXT NOT NULL DEFAULT '', platform TEXT NOT NULL DEFAULT '',
  brief TEXT, manual_note TEXT, analyze_report TEXT,
  create_time TIMESTAMPTZ DEFAULT now()
);`;
const SQLITE_MEDIA_COMPETITOR = `
CREATE TABLE IF NOT EXISTS media_competitor_account (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_name TEXT NOT NULL DEFAULT '', home_url TEXT NOT NULL DEFAULT '', platform TEXT NOT NULL DEFAULT '',
  brief TEXT, manual_note TEXT, analyze_report TEXT,
  create_time TEXT DEFAULT CURRENT_TIMESTAMP
);`;

// ===== 自媒体 · AI Skill 模板（后端内部 Prompt 模板，Web 运行时取模板填业务数据后直连大模型）=====
// system_prompt / user_template 支持 {{占位符}}；后端 /api/ai/render 按 skill 取业务数据填充后返回完整 prompt。
const PG_AI_SKILL = `
CREATE TABLE IF NOT EXISTS ai_skill (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  description TEXT,
  system_prompt TEXT,
  user_template TEXT,
  placeholders TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);`;
const SQLITE_AI_SKILL = `
CREATE TABLE IF NOT EXISTS ai_skill (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  description TEXT,
  system_prompt TEXT,
  user_template TEXT,
  placeholders TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);`;

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

// 选片三表外键 + CHECK 约束补齐：
// - PG：ALTER TABLE ADD CONSTRAINT（按约束名幂等判断，仅当缺失时添加）
// - SQLite：旧结构空表直接重建（DROP + 按新 DDL 重造 + 重建索引）；非空则跳过并告警（绝不破坏数据）
async function ensureSelectionConstraints() {
  if (dialect === 'pg') {
    const hasC = async (tbl, name) => {
      const r = await query('SELECT 1 FROM information_schema.table_constraints WHERE table_name = $1 AND constraint_name = $2', [tbl, name]);
      return r.length > 0;
    };
    const fk = async (tbl, col, ref, name) => {
      if (await hasC(tbl, name)) return;
      try { await run(`ALTER TABLE ${tbl} ADD CONSTRAINT ${name} FOREIGN KEY (${col}) REFERENCES ${ref}(id)`); } catch (e) { console.error(`[schema] ${name} 外键添加失败：`, e.message); }
    };
    const chk = async (tbl, name, expr) => {
      if (await hasC(tbl, name)) return;
      try { await run(`ALTER TABLE ${tbl} ADD CONSTRAINT ${name} CHECK (${expr})`); } catch (e) { console.error(`[schema] ${name} 约束添加失败：`, e.message); }
    };
    await fk('order_photo', 'order_id', 'orders', 'fk_order_photo_order');
    await fk('order_select_task', 'order_id', 'orders', 'fk_order_select_task_order');
    await fk('order_select_mark', 'task_id', 'order_select_task', 'fk_order_select_mark_task');
    await fk('order_select_mark', 'photo_id', 'order_photo', 'fk_order_select_mark_photo');
    await chk('order_select_task', 'chk_order_select_task_status', "status IN ('not_started','selecting','pending_payment','completed','reset')");
    await chk('order_select_mark', 'chk_order_select_mark_status', "status IN ('keep','reject')");
    await chk('order_select_task', 'chk_order_select_task_ge0', 'min_retouch >= 0 AND extra_price >= 0 AND like_count >= 0 AND exclude_count >= 0 AND extra_count >= 0 AND extra_fee >= 0 AND pending_fee >= 0 AND pending_count >= 0 AND version >= 0');
    await chk('order_photo', 'chk_order_photo_ge0', 'sort >= 0 AND deleted >= 0');
    return;
  }
  // SQLite：空表重建补齐约束（新 DDL 已含 REFERENCES + CHECK）
  const stmts = SQLITE_SELECTION_V2_TABLES.split(';').map((x) => x.trim()).filter(Boolean);
  for (const t of ['order_photo', 'order_select_task', 'order_select_mark']) {
    const row = (await query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", [t]))[0];
    if (row && !/REFERENCES/i.test(row.sql || '')) {
      const cnt = (await query(`SELECT COUNT(*) AS c FROM ${t}`))[0].c;
      if (Number(cnt) === 0) {
        const create = stmts.find((s) => s.toUpperCase().includes(`CREATE TABLE IF NOT EXISTS ${t.toUpperCase()}`));
        if (create) {
          await run(`DROP TABLE ${t}`);
          await run(create);
          console.log(`[schema] 重建 ${t} 以补齐外键/CHECK 约束`);
        }
      } else {
        console.warn(`[schema] ${t} 已有 ${cnt} 行数据且缺外键约束，跳过重建（需手动迁移）`);
      }
    }
  }
  // DROP 表会连带删除其索引，重建索引
  for (const s of stmts) if (/CREATE INDEX/i.test(s)) await run(s);
}

export async function initSchema() {
  // 系统级配置表（离散系统开关/默认值，如「订单分享默认备注」；与 settings 表的对外资料 JSON 区分）
  // 提前到最前创建：schema_version 版本标记就存这里，表不存在时无法读取
  const SYSTEM_CONFIG_DDL = dialect === 'pg'
    ? `CREATE TABLE IF NOT EXISTS system_config (
        id SERIAL PRIMARY KEY, key TEXT NOT NULL UNIQUE, value TEXT,
        updated_at TIMESTAMPTZ DEFAULT now()
      )`
    : `CREATE TABLE IF NOT EXISTS system_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, value TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`;
  for (const s of SYSTEM_CONFIG_DDL.split(';').map((x) => x.trim()).filter(Boolean)) {
    try {
      await run(s);
    } catch (e) {
      console.error('[schema] system_config DDL 执行失败：\n>>', s, '\n<< 报错：', e.message);
      throw e;
    }
  }

  // 冷启动加速：库已初始化（schema_version 标记命中）则跳过全量 DDL/ensureColumn/数据迁移，仅 1 次 SELECT
  try {
    const row = await get("SELECT value FROM system_config WHERE key = 'schema_version'");
    if (row && Number(row.value) >= SCHEMA_VERSION) {
      console.log('[schema] 已是最新 v' + SCHEMA_VERSION + '，跳过');
      return;
    }
  } catch (e) { console.warn('[schema] 读取版本标记失败，走全量初始化：', e.message); }

  const ddl = dialect === 'pg' ? PG_DDL : SQLITE_DDL;
  const stmts = ddl.split(';').map((s) => s.trim()).filter(Boolean);
  for (const s of stmts) await run(s);

  // 新增表
  for (const s of (dialect === 'pg' ? PG_PACKAGES : SQLITE_PACKAGES).split(';').map((x) => x.trim()).filter(Boolean)) await run(s);
  for (const s of (dialect === 'pg' ? PG_SCHEDULES : SQLITE_SCHEDULES).split(';').map((x) => x.trim()).filter(Boolean)) await run(s);
  for (const s of (dialect === 'pg' ? PG_PAYMENTS : SQLITE_PAYMENTS).split(';').map((x) => x.trim()).filter(Boolean)) await run(s);

  // 客户侧新表
  for (const s of (dialect === 'pg' ? PG_CUSTOMER_TABLES : SQLITE_CUSTOMER_TABLES).split(';').map((x) => x.trim()).filter(Boolean)) await run(s);

  // 选片工具表（selection_tasks + selection_marks）
  for (const s of (dialect === 'pg' ? PG_SELECTION_TABLES : SQLITE_SELECTION_TABLES).split(';').map((x) => x.trim()).filter(Boolean)) await run(s);

  // 选片模块 V2 三表（order_photo / order_select_task / order_select_mark）
  for (const s of (dialect === 'pg' ? PG_SELECTION_V2_TABLES : SQLITE_SELECTION_V2_TABLES).split(';').map((x) => x.trim()).filter(Boolean)) await run(s);
  // 待支付加片费相关字段（最终版新增，老库增量补列）
  await ensureColumn('order_select_task', 'pending_fee', 'REAL NOT NULL DEFAULT 0');
  await ensureColumn('order_select_task', 'pending_count', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('order_select_task', 'paid_at', 'TEXT');
  await ensureColumn('order_select_task', 'pay_flow_no', 'TEXT');
  // 外键 + CHECK 约束补齐（旧结构无约束：空表重建 / PG ALTER 增约束）
  await ensureSelectionConstraints();

  // 消息中心表（system_message）
  for (const s of (dialect === 'pg' ? PG_MESSAGE_TABLES : SQLITE_MESSAGE_TABLES).split(';').map((x) => x.trim()).filter(Boolean)) await run(s);
  // 移动端业务消息表（biz_message）
  for (const s of (dialect === 'pg' ? PG_BIZ_MESSAGE : SQLITE_BIZ_MESSAGE).split(';').map((x) => x.trim()).filter(Boolean)) await run(s);
  await ensureColumn('biz_message', 'biz_extra', 'TEXT');
  // PC 端消息中心归档（PC/H5 共用一套 biz_message 数据，归档仅在 PC 端使用）
  await ensureColumn('biz_message', 'is_archived', 'INTEGER NOT NULL DEFAULT 0');
  // 订单消息子类型（order_status_change 状态变更 / file_expire 文件到期 / reserve 预约）
  await ensureColumn('biz_message', 'sub_type', 'TEXT');

  // 访客埋点模块（V2：visitor_log 访问日志 / visitor_setting 设置 / 黑名单 / 免打扰）
  for (const s of (dialect === 'pg' ? PG_VISITOR_LOG : SQLITE_VISITOR_LOG).split(';').map((x) => x.trim()).filter(Boolean)) await run(s);
  for (const s of (dialect === 'pg' ? PG_VISITOR_SETTING : SQLITE_VISITOR_SETTING).split(';').map((x) => x.trim()).filter(Boolean)) await run(s);
  for (const s of (dialect === 'pg' ? PG_VISITOR_BLACKLIST : SQLITE_VISITOR_BLACKLIST).split(';').map((x) => x.trim()).filter(Boolean)) await run(s);
  for (const s of (dialect === 'pg' ? PG_VISITOR_NO_DISTURB : SQLITE_VISITOR_NO_DISTURB).split(';').map((x) => x.trim()).filter(Boolean)) await run(s);

  // 套系对外分享表（photo_package）
  for (const s of (dialect === 'pg' ? PG_PHOTO_PACKAGE : SQLITE_PHOTO_PACKAGE).split(';').map((x) => x.trim()).filter(Boolean)) await run(s);

  // C 端客户手机号验证码登录体系（与管理员 users 表完全隔离）：手机号 + 最近登录 + 会话
  const CUSTOMER_USER_DDL = dialect === 'pg'
    ? `CREATE TABLE IF NOT EXISTS customer_user (
        id SERIAL PRIMARY KEY, phone TEXT NOT NULL UNIQUE,
        last_login_at TEXT, session_id TEXT, session_expire_at TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      )`
    : `CREATE TABLE IF NOT EXISTS customer_user (
        id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT NOT NULL UNIQUE,
        last_login_at TEXT, session_id TEXT, session_expire_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`;
  for (const s of CUSTOMER_USER_DDL.split(';').map((x) => x.trim()).filter(Boolean)) await run(s);

  // C 端预约表（预约转订单体系，2026-08-17）：双手机号（phone 主 / phone_two 副）+ 意向套系 + 状态机 + 转订单绑定
  const RESERVATIONS_DDL = dialect === 'pg'
    ? `CREATE TABLE IF NOT EXISTS reservations (
        id SERIAL PRIMARY KEY, groom_name TEXT, bride_name TEXT,
        phone TEXT NOT NULL, phone_two TEXT,
        package_id INTEGER, expect_date TEXT, shoot_location TEXT, remark TEXT,
        status TEXT NOT NULL DEFAULT 'pending', order_id INTEGER,
        create_time TIMESTAMPTZ DEFAULT now()
      )`
    : `CREATE TABLE IF NOT EXISTS reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT, groom_name TEXT, bride_name TEXT,
        phone TEXT NOT NULL, phone_two TEXT,
        package_id INTEGER, expect_date TEXT, shoot_location TEXT, remark TEXT,
        status TEXT NOT NULL DEFAULT 'pending', order_id INTEGER,
        create_time TEXT DEFAULT CURRENT_TIMESTAMP
      )`;
  for (const s of RESERVATIONS_DDL.split(';').map((x) => x.trim()).filter(Boolean)) await run(s);
  await ensureColumn('reservations', 'is_read', 'INTEGER NOT NULL DEFAULT 0'); // 进入详情自动标记已读
  await ensureColumn('reservations', 'expect_time', 'TEXT'); // 意向拍摄时间 HH:MM

  // 合同模板表（contract_template）
  for (const s of (dialect === 'pg' ? PG_CONTRACT_TEMPLATE : SQLITE_CONTRACT_TEMPLATE).split(';').map((x) => x.trim()).filter(Boolean)) await run(s);
  // 电子服务协议签署记录表（agreement_sign）
  for (const s of (dialect === 'pg' ? PG_AGREEMENT_SIGN : SQLITE_AGREEMENT_SIGN).split(';').map((x) => x.trim()).filter(Boolean)) await run(s);
  // 合同历史版本归档表 + 合同操作审计日志表
  for (const s of (dialect === 'pg' ? PG_CONTRACT_ARCHIVE : SQLITE_CONTRACT_ARCHIVE).split(';').map((x) => x.trim()).filter(Boolean)) await run(s);
  for (const s of (dialect === 'pg' ? PG_CONTRACT_AUDIT : SQLITE_CONTRACT_AUDIT).split(';').map((x) => x.trim()).filter(Boolean)) await run(s);

  // 订单改期/取消申请表（C端 token 提交，B端审核；status: pending/approved/rejected）
  const ORDER_REQUESTS_DDL = dialect === 'pg'
    ? `CREATE TABLE IF NOT EXISTS order_requests (
        id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL, type TEXT NOT NULL,
        reason TEXT, desired_date TEXT, status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT now(), handled_at TEXT
      )`
    : `CREATE TABLE IF NOT EXISTS order_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, type TEXT NOT NULL,
        reason TEXT, desired_date TEXT, status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, handled_at TEXT
      )`;
  for (const s of ORDER_REQUESTS_DDL.split(';').map((x) => x.trim()).filter(Boolean)) await run(s);

  // 数据一致性巡检异常记录表（每日凌晨自动巡检 + 手动触发；只存最近一次巡检的异常清单，异常入库 + 推送提醒）
  const CONSISTENCY_ISSUES_DDL = dialect === 'pg'
    ? `CREATE TABLE IF NOT EXISTS consistency_issues (
        id SERIAL PRIMARY KEY, check_run TEXT NOT NULL, check_type TEXT NOT NULL,
        rel_id TEXT, summary TEXT, detail TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      )`
    : `CREATE TABLE IF NOT EXISTS consistency_issues (
        id INTEGER PRIMARY KEY AUTOINCREMENT, check_run TEXT NOT NULL, check_type TEXT NOT NULL,
        rel_id TEXT, summary TEXT, detail TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`;
  for (const s of CONSISTENCY_ISSUES_DDL.split(';').map((x) => x.trim()).filter(Boolean)) await run(s);

  // 独立待办事项表（完整独立待办系统：订单阶段待办 + 事件待办，可标记完成归档，与订单业务状态解耦）
  const TODO_ITEMS_DDL = dialect === 'pg'
    ? `CREATE TABLE IF NOT EXISTS todo_items (
        id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL, todo_type TEXT NOT NULL,
        title TEXT, content TEXT, status TEXT NOT NULL DEFAULT 'pending',
        biz_key TEXT, created_at TIMESTAMPTZ DEFAULT now(), done_at TEXT
      )`
    : `CREATE TABLE IF NOT EXISTS todo_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, todo_type TEXT NOT NULL,
        title TEXT, content TEXT, status TEXT NOT NULL DEFAULT 'pending',
        biz_key TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, done_at TEXT
      )`;
  for (const s of TODO_ITEMS_DDL.split(';').map((x) => x.trim()).filter(Boolean)) await run(s);

  // 下载记录表（作品/合同下载留痕：C端/B端下载行为统一记录，B端订单详情可查）
  const DOWNLOAD_LOGS_DDL = dialect === 'pg'
    ? `CREATE TABLE IF NOT EXISTS download_logs (
        id SERIAL PRIMARY KEY, order_id INTEGER, item_type TEXT, item_name TEXT,
        operator_uid INTEGER, operator_name TEXT, created_at TIMESTAMPTZ DEFAULT now()
      )`
    : `CREATE TABLE IF NOT EXISTS download_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER, item_type TEXT, item_name TEXT,
        operator_uid INTEGER, operator_name TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`;
  for (const s of DOWNLOAD_LOGS_DDL.split(';').map((x) => x.trim()).filter(Boolean)) await run(s);

  // 系统设置表
  for (const s of (dialect === 'pg' ? PG_SETTINGS : SQLITE_SETTINGS).split(';').map((x) => x.trim()).filter(Boolean)) await run(s);

  // 统一分享内核表（shares + share_logs）
  for (const s of (dialect === 'pg' ? PG_SHARE_TABLES : SQLITE_SHARE_TABLES).split(';').map((x) => x.trim()).filter(Boolean)) await run(s);

  // 媒资元数据表（容量管理：按业务分类汇总）
  for (const s of (dialect === 'pg' ? PG_MEDIA : SQLITE_MEDIA).split(';').map((x) => x.trim()).filter(Boolean)) await run(s);

  // 客片电子相册表（C 端对外分享）
  for (const s of (dialect === 'pg' ? PG_GALLERIES : SQLITE_GALLERIES).split(';').map((x) => x.trim()).filter(Boolean)) await run(s);

  // 渠道来源表（新增订单弹窗「渠道来源」下拉的数据源，后端可配置）
  for (const s of (dialect === 'pg' ? PG_CHANNELS : SQLITE_CHANNELS).split(';').map((x) => x.trim()).filter(Boolean)) await run(s);

  // 作品访问记录 + 评论
  for (const s of (dialect === 'pg' ? PG_WORK_VISITS : SQLITE_WORK_VISITS).split(';').map((x) => x.trim()).filter(Boolean)) await run(s);
  for (const s of (dialect === 'pg' ? PG_WORK_COMMENTS : SQLITE_WORK_COMMENTS).split(';').map((x) => x.trim()).filter(Boolean)) await run(s);

  // 自媒体工作台 7 表（灵感库/状态列/选题/草稿/分发记录/复盘/标签）
  for (const s of (dialect === 'pg' ? PG_MEDIA_WORKBENCH : SQLITE_MEDIA_WORKBENCH).split(';').map((x) => x.trim()).filter(Boolean)) await run(s);
  // 自媒体 · 对标账号库
  for (const s of (dialect === 'pg' ? PG_MEDIA_COMPETITOR : SQLITE_MEDIA_COMPETITOR).split(';').map((x) => x.trim()).filter(Boolean)) await run(s);
  // AI Skill 模板表（后端内部 Prompt 模板）
  for (const s of (dialect === 'pg' ? PG_AI_SKILL : SQLITE_AI_SKILL).split(';').map((x) => x.trim()).filter(Boolean)) await run(s);
  // 默认选题状态列种子（幂等：表空才插 5 列，与需求「默认状态列：待构思、撰写中、待发布、已发布、归档」一致）
  try {
    const c = await get('SELECT COUNT(*) AS c FROM media_status_column');
    if (!Number(c.c)) {
      const DEFS = ['待构思', '撰写中', '待发布', '已发布', '归档'];
      for (let i = 0; i < DEFS.length; i++) await insert('INSERT INTO media_status_column (name, sort, is_default) VALUES (?,?,?)', [DEFS[i], i, 1]);
      console.log('[schema] 自媒体默认状态列已种入 5 列');
    }
  } catch (e) { console.error('[schema] media_status_column 默认列种子失败', e.message); }
  // AI Skill 模板种子（幂等：表空才种 6 套；后续可在「后端配置」中编辑，不覆盖已有）
  try {
    const sc = await get('SELECT COUNT(*) AS c FROM ai_skill');
    if (!Number(sc.c)) {
      const SKILLS = [
        {
          key: 'inspiration_parse', name: '灵感解析', description: '粘贴抖音/小红书链接或分享文案，提炼结构化灵感（标题/内容摘要/用户痛点）',
          system_prompt: '你是一位自媒体灵感策展助手。用户会粘贴一条抖音/小红书作品链接或分享文案。请从中提炼结构化灵感：一个吸睛标题、一段内容摘要（含用户痛点洞察）、以及 1-3 个可深挖的用户痛点。只输出结构化内容，不要解释或前后缀。',
          user_template: '链接：{{url}}\n用户粘贴内容：{{rawText}}\n请提炼：\n标题：\n内容摘要：\n用户痛点：',
          placeholders: ['url', 'rawText']
        },
        {
          key: 'topic_generate', name: '选题生成', description: '基于一条灵感，生成可执行的选题方案（标题/核心痛点/平台/形式）',
          system_prompt: '你是一位婚礼/摄影垂类内容策划。基于给定灵感，生成一个可执行的短视频/图文选题方案，只输出方案要点，不要解释。',
          user_template: '灵感标题：{{inspirationTitle}}\n灵感内容：{{inspirationContent}}\n关联痛点：{{painPoints}}\n来源：{{sourceType}}\n请生成选题建议：\n标题：\n核心痛点：\n建议平台（小红书/抖音）：\n内容形式（图文/短视频）：',
          placeholders: ['inspirationTitle', 'inspirationContent', 'painPoints', 'sourceType']
        },
        {
          key: 'draft_generate', name: '文案初稿生成', description: '根据选题信息输出可直接发布的完整文案初稿',
          system_prompt: '你是一位资深自媒体文案写作者。根据选题信息输出一条可直接发布的完整文案初稿。只输出正文，不要输出任何解释、标题或前后缀。',
          user_template: '选题标题：{{topicTitle}}\n核心痛点：{{corePain}}\n目标平台：{{targetPlatform}}\n内容形式：{{contentForm}}\n参考链接：{{referenceUrl}}\n请生成适合该平台的完整文案初稿（图文约 300-500 字；短视频为口播脚本格式）。',
          placeholders: ['topicTitle', 'corePain', 'targetPlatform', 'contentForm', 'referenceUrl']
        },
        {
          key: 'banned_check', name: '违禁词检测', description: '审核文案中的绝对化/夸大/违规宣传用语，仅标记文本中实际存在的命中词',
          system_prompt: '你是广告合规审核员。只检查用户文本中是否含有绝对化、夸大或违规宣传用语。仅列出文本【实际存在】的命中词并给修改建议，严禁虚构文本中没有的内容。若无风险请明确说「未发现明显违禁词」。',
          user_template: '待审核文本：{{text}}\n请逐条列出命中词（如「最」「第一」「绝对」等）及修改建议，格式：命中词|建议替换。',
          placeholders: ['text']
        },
        {
          key: 'competitor_analyze', name: '对标账号分析', description: '基于账号档案与人工粘贴的爆款链接，输出固定 6 段深度分析报告',
          system_prompt: '你是婚礼/摄影垂类自媒体分析师。基于账号档案与用户手动粘贴的爆款链接，输出结构化深度分析。只基于给定信息推理，禁止编造。严格按 6 个小标题输出：账号定位人设 / 高频选题方向 / 爆款共性拆解 / 评论区客户痛点 / 适合本摄影工作室借鉴点 / 需要避开点。其中「评论区客户痛点」每条一行，格式：痛点标题|痛点说明。',
          user_template: '对标账号：{{accountName}}\n平台：{{platform}}\n主页：{{homeUrl}}\n账号简介：{{brief}}\n手动备注：{{manualNote}}\n用户手动粘贴的爆款作品链接：\n{{links}}\n请生成深度分析报告。',
          placeholders: ['accountName', 'platform', 'homeUrl', 'brief', 'manualNote', 'links']
        },
        {
          key: 'review_report', name: '复盘报告', description: '基于真实发布数据生成复盘（数据概览/亮点/待改进/下期建议/用户痛点）',
          system_prompt: '你是严谨的数据复盘分析师。只能基于用户提供的真实发布数据做归纳与洞察，禁止编造任何数据。输出格式：\n【数据概览】\n【表现亮点】\n【待改进】\n【下期建议】\n【识别出的用户痛点】（每条痛点一行，格式：痛点标题|痛点说明）',
          user_template: '以下是本期发布记录的真实回填数据：\n{{recordsText}}\n请基于这些真实数据生成复盘报告。',
          placeholders: ['recordsText']
        }
      ];
      for (const s of SKILLS) {
        await insert('INSERT INTO ai_skill (key, name, description, system_prompt, user_template, placeholders) VALUES (?,?,?,?,?,?)',
          [s.key, s.name, s.description, s.system_prompt, s.user_template, JSON.stringify(s.placeholders)]);
      }
      console.log('[schema] AI Skill 模板已种入 6 套');
    }
  } catch (e) { console.error('[schema] ai_skill 种子失败', e.message); }

  // orders 增量补列
  for (const [col, def] of ORDERS_NEW_COLUMNS) await ensureColumn('orders', col, def);
  // 执行人头像（复用 users 表作为人员表，头像可空）
  await ensureColumn('users', 'avatar', 'TEXT');
  // 安全模块：子账号权限集合（JSON 数组，如 ["view_orders","edit_price"]）+ 禁用标记
  await ensureColumn('users', 'permissions', 'TEXT');
  await ensureColumn('users', 'disabled', 'INTEGER NOT NULL DEFAULT 0');
  // 客户绑定列 + 成片下载开关
  await ensureColumn('orders', 'openid', 'TEXT');
  // 订单图片管理：原片 / 精修片 URL 列表（JSON：{raw:[...], retouched:[...]}），选片复用 photo_select
  await ensureColumn('orders', 'order_photos', 'TEXT');
  // 客户专属访问令牌（C 端 /customer-order?token= 鉴权，只读查看自己订单）
  await ensureColumn('orders', 'customer_token', 'TEXT');
  // 安全模块：客户私有链接有效期（过期后 token 失效，仅可读提示）
  await ensureColumn('orders', 'customer_token_expire_at', 'TEXT');
  // 合同：关联模板 / 生成后 PDF 链接 / 单订单专属补充条款
  await ensureColumn('orders', 'contract_template_id', 'INTEGER');
  await ensureColumn('orders', 'contract_pdf_url', 'TEXT');
  await ensureColumn('orders', 'contract_extra_text', 'TEXT');
  // 合同渲染专用业务字段（数据一致性强制规则：每个 {{占位符}} 唯一绑定订单字段，PDF 渲染只读订单表，绝不读套系兜底）
  await ensureColumn('orders', 'groom_phone', 'TEXT');            // 新郎电话
  await ensureColumn('orders', 'bride_phone', 'TEXT');            // 新娘电话
  await ensureColumn('orders', 'shoot_position', 'TEXT');         // 机位（单机位/多机位）
  await ensureColumn('orders', 'total_negatives', 'INTEGER NOT NULL DEFAULT 0'); // 底片数量
  await ensureColumn('orders', 'retouch_count', 'INTEGER NOT NULL DEFAULT 0');   // 精修张数
  await ensureColumn('orders', 'album_electronic_num', 'INTEGER NOT NULL DEFAULT 1'); // 电子相册数量
  await ensureColumn('orders', 'album_price', 'REAL NOT NULL DEFAULT 0');        // 相册单价
  await ensureColumn('orders', 'shoot_cost', 'REAL NOT NULL DEFAULT 0');         // 基础拍摄费
  await ensureColumn('orders', 'quick_repair_cost', 'REAL NOT NULL DEFAULT 0');  // 快修费
  await ensureColumn('orders', 'pay_cash', 'INTEGER NOT NULL DEFAULT 0');        // 现金支付勾选
  await ensureColumn('orders', 'pay_wechat', 'INTEGER NOT NULL DEFAULT 0');      // 微信支付勾选
  await ensureColumn('orders', 'pay_alipay', 'INTEGER NOT NULL DEFAULT 0');      // 支付宝勾选
  await ensureColumn('orders', 'pay_account_info', 'TEXT');        // 收款账户信息
  // 合同生成版本追溯：最近生成时间 + 生成时完整订单快照 JSON（用于「订单已变更，旧PDF未同步」比对）
  await ensureColumn('orders', 'contract_generate_time', 'TEXT');
  await ensureColumn('orders', 'contract_order_snapshot', 'TEXT');
  // 合同安全存储与溯源（安全规范）：操作人 / 文件 md5 / 作废标记 / 私有对象 key（后端下载中转用）
  await ensureColumn('orders', 'contract_operator_uid', 'INTEGER');
  await ensureColumn('orders', 'contract_file_md5', 'TEXT');
  await ensureColumn('orders', 'contract_invalid', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('orders', 'contract_file_key', 'TEXT');
  // 订单备注分组：生日/纪念日 / 预约备注 / 内部备注 / 外部备注（问卷答案 questionnaire_answers 已在 DDL）
  await ensureColumn('orders', 'birthday', 'TEXT');
  await ensureColumn('orders', 'appointment_remark', 'TEXT');
  await ensureColumn('orders', 'internal_remark', 'TEXT');
  await ensureColumn('orders', 'external_remark', 'TEXT');
  // 安全模块：电子服务协议（订单维度强制签署开关 + 签署状态）
  await ensureColumn('orders', 'force_agreement', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('orders', 'agreement_signed', 'INTEGER NOT NULL DEFAULT 0');
  // 安全模块：选片防截图提示层 / 未交付仅预览缩略图（订单维度开关）
  await ensureColumn('orders', 'screenshot_guard', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('orders', 'thumb_only', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('works', 'allow_download', 'INTEGER NOT NULL DEFAULT 0');
  // 相册级配置（客户相册密码 / 自定义文案 / 有效期）——挂在作品维度（作品相册即交付客户的客片相册）
  await ensureColumn('works', 'album_copy', 'TEXT');
  await ensureColumn('works', 'album_password_enabled', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('works', 'album_password', 'TEXT');
  await ensureColumn('works', 'album_expires_at', 'TEXT');
  // 多分类支持：category_ids 以逗号分隔存储分类 id；不为旧数据回填（category_id→category_ids）
  await ensureColumn('works', 'category_ids', 'TEXT');
  // 浏览量统计（C 端公开作品详情加载时自增）
  await ensureColumn('works', 'views', 'INTEGER NOT NULL DEFAULT 0');
  // 相册照片去重检测：存原始文件名 + 字节数，组合签名 key = `${original_name}_${original_size}`
  // 小程序端无真实文件名（临时路径），由 wx.getFileInfo 取 size+digest，original_name 存 digest。
  await ensureColumn('albums', 'original_name', 'TEXT');
  await ensureColumn('albums', 'original_size', dialect === 'pg' ? 'BIGINT' : 'INTEGER');
  // 同步上传模式：相册照片状态仅一个取值 'normal'（无 processing/failed），默认 normal
  await ensureColumn('albums', 'status', `TEXT NOT NULL DEFAULT 'normal'`);
  // 缩略图 URL（同步模式由上传接口写入，未生成独立缩略图时与 photo_url 同值，前端可按需取 ?w= 变体）
  await ensureColumn('albums', 'thumb_url', 'TEXT');
  // 作品 / 相册照片自定义排序字段（schema DDL 已含，旧库通过 ensureColumn 补列）
  await ensureColumn('works', 'sort', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('albums', 'sort', 'INTEGER NOT NULL DEFAULT 0');

  // media 补列：处理状态（同步写入后恒为 ready）+ 内容 hash（内容级去重，best-effort）
  await ensureColumn('media', 'status', `TEXT NOT NULL DEFAULT 'ready'`);
  await ensureColumn('media', 'hash', 'TEXT');

  // payments 补列：收款渠道（线下区分微信/支付宝/现金/转账，线上为 online）
  await ensureColumn('payments', 'channel', `TEXT NOT NULL DEFAULT 'cash'`);

  // categories 增量补列（is_active 启用/禁用、deleted 软删、preset 预设保护）
  await ensureColumn('categories', 'is_active', 'INTEGER NOT NULL DEFAULT 1');
  await ensureColumn('categories', 'deleted', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('categories', 'preset', 'INTEGER NOT NULL DEFAULT 0');
  // 一次性迁移：旧单分类数据落到 category_ids（仅当 category_ids 为空且 category_id 有值）
  await run(`UPDATE works SET category_ids = CAST(category_id AS TEXT) WHERE category_ids IS NULL AND category_id IS NOT NULL`);
  await run(`UPDATE works SET category_ids = '' WHERE category_ids IS NULL`);
  // 同步上传模式迁移：旧相册可能有 'processing'/'ready'/'failed' 等状态，统一归一为 'normal'，
  // 保证历史老图片继续正常展示（历史缩略图缺失则补为 photo_url 同值）。
  await run(`UPDATE albums SET status = 'normal' WHERE status IS NULL OR status <> 'normal'`);
  await run(`UPDATE albums SET thumb_url = photo_url WHERE thumb_url IS NULL AND photo_url IS NOT NULL`);
  // packages / schedules 增量补列
  const PACKAGES_NEW_COLUMNS = [
    ['deposit', 'REAL NOT NULL DEFAULT 0'],
    ['retouch_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['raw_policy', 'TEXT'],
    ['duration', 'TEXT'],
    ['questionnaire', 'TEXT'],
    ['specs', 'TEXT'], // 多规格配置（同一套系多个版本，独立价格/服务）
    ['details', 'TEXT'], // 4-Tab 套系编辑页（2026-08-09）聚合存储：详情图/视频/价格隐藏/退订政策/问卷可见性/服务模板/加片/标签/协议等
    ['contract_template_id', 'INTEGER'] // 套系绑定的协议模板（开关开启时选定；新建订单自动带入）
  ];
  for (const [col, def] of PACKAGES_NEW_COLUMNS) await ensureColumn('packages', col, def);
  await ensureColumn('schedules', 'lunar_date', 'TEXT');
  // 档期客户信息（婚礼场景）
  const SCHEDULES_NEW_COLUMNS = [
    ['groom_name', 'TEXT'],
    ['bride_name', 'TEXT'],
    ['contact_phone', 'TEXT'],
    ['address', 'TEXT'],
    ['periods', 'TEXT'], // 时间段数组（00:00-23:00 小时标签多选），JSON 存储
    ['date_tbd', 'INTEGER NOT NULL DEFAULT 0'], // 1=日期待定（意向档期，不占具体日历日）
    ['executor_id', 'INTEGER'], // 绑定执行人（personnel.id）
    ['executor_name', 'TEXT'] // 绑定执行人姓名（冗余，便于筛选/展示）
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
    ['spec_id', 'INTEGER'], // 客户预约时选中的套系规格（多规格场景下定位具体版本）
    ['style_req', 'TEXT'], // 风格需求（C 端预约表单填写，如 户外/室内/纪实/胶片）
    ['shoot_type', 'TEXT'], // 拍摄类型（婚纱/写真/亲子/跟拍/活动/其他）
    ['location', 'TEXT'], // 意向拍摄地点
    ['budget', 'TEXT'] // 预算
  ];
  for (const [col, def] of APPOINTMENT_NEW_COLUMNS) await ensureColumn('appointments', col, def);

  // 同步顾客协议模板（2026-08-15）：清空所有套系/订单快照的自定义 customer_agreement，统一回落到前端默认模板
  try {
    const rows = await query('SELECT id, details FROM packages');
    for (const r of rows) {
      let d = {};
      if (r.details) { try { d = JSON.parse(r.details); } catch { d = {}; } }
      if (d && typeof d === 'object' && !Array.isArray(d) && d.customer_agreement) {
        d.customer_agreement = '';
        await run('UPDATE packages SET details = ? WHERE id = ?', [JSON.stringify(d), r.id]);
      }
    }
  } catch (e) { console.error('[schema] 同步顾客协议(packages.details)失败', e); }
  // 订单快照里的旧协议一并清空，使打印单据统一走新默认模板
  try {
    const orders = await query('SELECT id, package_snapshot FROM orders');
    for (const o of orders) {
      let snap = {};
      if (o.package_snapshot) { try { snap = JSON.parse(o.package_snapshot); } catch { snap = {}; } }
      const sd = snap && typeof snap === 'object' && snap.details && typeof snap.details === 'object' ? snap.details : null;
      if (sd && sd.customer_agreement) {
        sd.customer_agreement = '';
        await run('UPDATE orders SET package_snapshot = ? WHERE id = ?', [JSON.stringify(snap), o.id]);
      }
    }
  } catch (e) { console.error('[schema] 同步顾客协议(orders.package_snapshot)失败', e); }
  // 旧版顶层 customer_agreement 列（若存在）一并清空
  try {
    await run(`UPDATE packages SET customer_agreement = '' WHERE customer_agreement IS NOT NULL AND customer_agreement <> ''`);
  } catch (e) { /* 列不存在则忽略 */ }

  // 同步套系服务详情文本（2026-08-15）：清空旧脏的 service_detail_text 与 description，统一回落到前端默认文案
  try {
    const rows = await query('SELECT id, details FROM packages');
    for (const r of rows) {
      let d = {};
      if (r.details) { try { d = JSON.parse(r.details); } catch { d = {}; } }
      if (d && typeof d === 'object' && !Array.isArray(d) && (d.service_detail_text || d.description)) {
        d.service_detail_text = '';
        d.description = '';
        await run('UPDATE packages SET details = ? WHERE id = ?', [JSON.stringify(d), r.id]);
      }
    }
  } catch (e) { console.error('[schema] 同步套系服务详情失败', e); }
  // 订单快照里的旧服务详情一并清空
  try {
    const orders = await query('SELECT id, package_snapshot FROM orders');
    for (const o of orders) {
      let snap = {};
      if (o.package_snapshot) { try { snap = JSON.parse(o.package_snapshot); } catch { snap = {}; } }
      const sd = snap && typeof snap === 'object' && snap.details && typeof snap.details === 'object' ? snap.details : null;
      if (sd && (sd.service_detail_text || sd.description)) {
        sd.service_detail_text = '';
        sd.description = '';
        await run('UPDATE orders SET package_snapshot = ? WHERE id = ?', [JSON.stringify(snap), o.id]);
      }
    }
  } catch (e) { console.error('[schema] 同步订单快照服务详情失败', e); }

  // 同步退订政策（2026-08-15）：清空所有套系/订单快照里旧版的 refund_policy 字段，统一用前端 refundPolicy.js 的 OFFICIAL_POLICY 默认文案
  try {
    const pkgs = await query('SELECT id, details FROM packages');
    for (const r of pkgs) {
      let d = {};
      if (r.details) { try { d = JSON.parse(r.details); } catch { d = {}; } }
      if (d && typeof d === 'object' && !Array.isArray(d) && d.refund_policy) {
        delete d.refund_policy;
        await run('UPDATE packages SET details = ? WHERE id = ?', [JSON.stringify(d), r.id]);
      }
    }
  } catch (e) { console.error('[schema] 同步退订政策(packages.details)失败', e); }
  try {
    const orders = await query('SELECT id, package_snapshot FROM orders');
    for (const o of orders) {
      let snap = {};
      if (o.package_snapshot) { try { snap = JSON.parse(o.package_snapshot); } catch { snap = {}; } }
      const sd = snap && typeof snap === 'object' && snap.details && typeof snap.details === 'object' ? snap.details : null;
      if (sd && sd.refund_policy) {
        delete sd.refund_policy;
        await run('UPDATE orders SET package_snapshot = ? WHERE id = ?', [JSON.stringify(snap), o.id]);
      }
    }
  } catch (e) { console.error('[schema] 同步退订政策(orders.package_snapshot)失败', e); }

  // 三端统一前端异常日志表（异常监控 / 告警审计；最近 5000 条自动轮转）
  // 注意：列名 end 是 PostgreSQL 保留字，必须用双引号 "end" 转义（SQLite 宽松可不加，但统一加引号两库一致）。
  // 否则生产 PG 执行 DDL 会报「syntax error at or near "end"」(42601) 导致后端启动崩溃。
  const CLIENT_ERROR_LOG_DDL = dialect === 'pg'
    ? `CREATE TABLE IF NOT EXISTS client_error_log (
        id SERIAL PRIMARY KEY, type TEXT NOT NULL DEFAULT 'js',
        "end" TEXT NOT NULL DEFAULT 'unknown', severity TEXT NOT NULL DEFAULT 'normal',
        message TEXT NOT NULL, stack TEXT, url TEXT, ua TEXT, app_version TEXT,
        context TEXT, client_ts TEXT, created_at TIMESTAMPTZ DEFAULT now()
      )`
    : `CREATE TABLE IF NOT EXISTS client_error_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL DEFAULT 'js',
        "end" TEXT NOT NULL DEFAULT 'unknown', severity TEXT NOT NULL DEFAULT 'normal',
        message TEXT NOT NULL, stack TEXT, url TEXT, ua TEXT, app_version TEXT,
        context TEXT, client_ts TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`;
  // DDL 拆语句执行：单条失败打印具体 SQL 片段，便于定位 parser 错误（避免盲猜第几条 SQL 挂了）。
  for (const s of CLIENT_ERROR_LOG_DDL.split(';').map((x) => x.trim()).filter(Boolean)) {
    try {
      await run(s);
    } catch (e) {
      console.error('[schema] client_error_log DDL 执行失败：\n>>', s, '\n<< 报错：', e.message);
      throw e; // 保留原行为（建表失败即抛出，便于部署健康检查捕获）
    }
  }

  // （system_config 建表已上移至 initSchema 开头，供 schema_version 标记使用）

  // 默认值种子：仅当 key 不存在时写入（管理员清空后不会回填；清空即代表「新订单不带默认备注」）
  try {
    const DEFAULT_ORDER_SHARE_NOTE = '这是我们团队开发的软件，此链接为专属访问地址，受微信环境限制，请复制链接（链接填写在此处），在手机浏览器打开查看订单详情。';
    const ex = await get("SELECT key FROM system_config WHERE key = 'customer_order_share_default_note'");
    if (!ex) await insert("INSERT INTO system_config (key, value) VALUES (?, ?)", ['customer_order_share_default_note', DEFAULT_ORDER_SHARE_NOTE]);
  } catch (e) { console.error('[schema] system_config 默认值种子失败', e.message); }

  // 回写表结构版本标记：下次启动命中即跳过全量初始化（冷启动加速）
  try {
    const ex = await get("SELECT 1 FROM system_config WHERE key = 'schema_version'");
    if (ex) await run("UPDATE system_config SET value = ? WHERE key = 'schema_version'", [String(SCHEMA_VERSION)]);
    else await insert("INSERT INTO system_config (key, value) VALUES (?, ?)", ['schema_version', String(SCHEMA_VERSION)]);
  } catch (e) { console.error('[schema] 写版本标记失败', e.message); }

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
