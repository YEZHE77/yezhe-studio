// db.js —— 数据库适配层
// 开发/冒烟：DATABASE_URL 留空 → 使用内置 node:sqlite 本地文件（零依赖、零账号）
// 生产部署：DATABASE_URL=postgres://...（Neon）→ 自动切换到 pg，业务代码无需改动
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const DATABASE_URL = process.env.DATABASE_URL || '';
export const dialect = DATABASE_URL.startsWith('postgres') ? 'pg' : 'sqlite';

let pgPool = null;
let sqlite = null;

if (dialect === 'pg') {
  const { Pool } = await import('pg');
  pgPool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  console.log('[db] 使用 Postgres(Neon):', DATABASE_URL.replace(/:[^:@]+@/, ':***@'));
} else {
  const { DatabaseSync } = await import('node:sqlite');
  sqlite = new DatabaseSync(path.join(dataDir, 'app.db'));
  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  console.log('[db] 使用本地 SQLite:', path.join(dataDir, 'app.db'));
}

// 把 ? 占位符转成 pg 的 $1..；sqlite 直接用 ?
function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => '$' + ++i);
}

export async function query(sql, params = []) {
  if (dialect === 'pg') {
    const r = await pgPool.query(toPg(sql), params);
    return r.rows;
  }
  return sqlite.prepare(sql).all(...params);
}

export async function all(sql, params = []) {
  return query(sql, params);
}

export async function get(sql, params = []) {
  if (dialect === 'pg') {
    const r = await pgPool.query(toPg(sql), params);
    return r.rows[0] || null;
  }
  return sqlite.prepare(sql).get(...params);
}

export async function run(sql, params = []) {
  if (dialect === 'pg') {
    await pgPool.query(toPg(sql), params);
  } else {
    sqlite.prepare(sql).run(...params);
  }
}

// 插入并返回自增 id（兼容两种方言）。
// 部分表（settings/shares）以业务字段为主键，没有 id 列；pg 下先尝试 RETURNING id，
// 若表不存在 id 列则回退到普通 INSERT，避免"column \"id\" does not exist"。
export async function insert(sql, params = []) {
  if (dialect === 'pg') {
    try {
      const r = await pgPool.query(toPg(sql + ' RETURNING id'), params);
      return r.rows[0]?.id ?? 0;
    } catch (e) {
      if (e.message && /column[^"]*"?id"?\s+does not exist/i.test(e.message)) {
        await pgPool.query(toPg(sql), params);
        return 0;
      }
      throw e;
    }
  }
  sqlite.prepare(sql).run(...params);
  return sqlite.prepare('SELECT last_insert_rowid() AS id').get().id;
}

// 事务助手：多表写入原子性（提交选片/重置选片/支付回调）。
// fn(tx) 内使用 tx.query / tx.get / tx.run / tx.insert，全部跑在同一个事务里，任一步抛错整体回滚。
// pg 走独立 client（避免污染连接池里其它并发请求）；sqlite 单连接直接 BEGIN/COMMIT。
export async function withTransaction(fn) {
  if (dialect === 'pg') {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      const tx = {
        query: async (sql, params = []) => (await client.query(toPg(sql), params)).rows,
        get: async (sql, params = []) => (await client.query(toPg(sql), params)).rows[0] || null,
        run: async (sql, params = []) => { await client.query(toPg(sql), params); },
        insert: async (sql, params = []) => {
          try {
            const r = await client.query(toPg(sql + ' RETURNING id'), params);
            return r.rows[0]?.id ?? 0;
          } catch (e) {
            if (e.message && /column[^"]*"?id"?\s+does not exist/i.test(e.message)) {
              await client.query(toPg(sql), params);
              return 0;
            }
            throw e;
          }
        }
      };
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      throw e;
    } finally {
      client.release();
    }
  }
  // sqlite：DatabaseSync 单连接，BEGIN 后 prepare/run 都在同一连接内
  sqlite.exec('BEGIN');
  try {
    const result = await fn({ query, get, run, insert });
    sqlite.exec('COMMIT');
    return result;
  } catch (e) {
    try { sqlite.exec('ROLLBACK'); } catch {}
    throw e;
  }
}

export { pgPool, sqlite };
