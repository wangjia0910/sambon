/**
 * 生产系统 · D1 薄适配层
 *
 * 只使用 D1 稳定接口：prepare().bind().all() / first() / run() / batch()。
 * 本地回归用 node:sqlite 实现同一接口（tests/d1-mock.js），因此 SQL 是真实执行的，
 * 不是内存对象假装数据库。首次请求自动执行 CREATE TABLE IF NOT EXISTS，
 * Git 集成部署后无需手工跑迁移。
 */

import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from './schema.js';

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

    async ensureSchema() {
      if (initialized.has(raw)) return;
      for (const sql of SCHEMA_STATEMENTS) await raw.prepare(sql).run();
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
