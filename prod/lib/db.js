/**
 * 生产系统 · D1 薄适配层
 *
 * 只使用 D1 稳定接口：prepare().bind().all() / first() / run() / batch()。
 * 本地回归用 node:sqlite 实现同一接口（tests/d1-mock.js），因此 SQL 是真实执行的，
 * 不是内存对象假装数据库。首次请求自动执行 CREATE TABLE IF NOT EXISTS，
 * Git 集成部署后无需手工跑迁移。
 */

import { SCHEMA_STATEMENTS, SCHEMA_VERSION, COLUMN_MIGRATIONS } from './schema.js';

const initialized = new WeakSet();

export function createDb(env) {
  const raw = env && env.DB;
  if (!raw || typeof raw.prepare !== 'function') return null;

  const bindOne = (sql, params = []) => {
    const stmt = raw.prepare(sql);
    return params.length ? stmt.bind(...params) : stmt;
  };

  const db = {
    raw,

    async first(sql, params = []) {
      const row = await bindOne(sql, params).first();
      return row ?? null;
    },

    async all(sql, params = []) {
      const res = await bindOne(sql, params).all();
      return Array.isArray(res) ? res : (res && Array.isArray(res.results) ? res.results : []);
    },

    async run(sql, params = []) {
      const res = await bindOne(sql, params).run();
      const changes = Number(res?.meta?.changes ?? res?.changes ?? 0);
      return { changes, success: res?.success !== false };
    },

    /** 一次事务内顺序执行多条语句（D1 batch 语义） */
    async batch(statements) {
      if (!statements.length) return [];
      const prepared = statements.map(({ sql, params = [] }) => bindOne(sql, params));
      return raw.batch(prepared);
    },

    /**
     * 幂等自举：建表 + 老库补列 + 版本号。
     * COLUMN_MIGRATIONS 对 v1.0 已存在的库逐条 ALTER；新库列已存在会抛
     * "duplicate column name"，按预期忽略，其余错误必须抛出（不静默吞掉真实故障）。
     */
    async ensureSchema() {
      if (initialized.has(raw)) return;
      for (const sql of SCHEMA_STATEMENTS) await raw.prepare(sql).run();
      for (const sql of COLUMN_MIGRATIONS) {
        try {
          await raw.prepare(sql).run();
        } catch (e) {
          if (!/duplicate column|already exists/i.test(String(e && e.message))) throw e;
        }
      }
      await raw.prepare(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ).bind('schema_version', SCHEMA_VERSION).run();
      initialized.add(raw);
    },
  };

  return db;
}

export function resetSchemaCache(raw) {
  initialized.delete(raw);
}
