/**
 * 本地回归用 D1 适配层（Node 22 内置 node:sqlite）
 *
 * 目的：让 prod/lib/api.js 在本地跑**真实 SQL**，而不是把仓储换成内存对象。
 * 实现 D1 稳定接口 prepare().bind().all()/first()/run() 与 batch()，
 * batch 用 BEGIN / COMMIT 模拟事务，失败回滚，与 D1 语义对齐。
 */

import { DatabaseSync } from 'node:sqlite';

export function createD1Mock() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');

  function prepare(sql) {
    const stmt = sqlite.prepare(sql);
    let params = [];
    const wrapper = {
      bind(...args) { params = args; return wrapper; },
      async all() { return { results: stmt.all(...params), success: true }; },
      async first() { return stmt.get(...params) ?? null; },
      async run() {
        const r = stmt.run(...params);
        return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
      },
      // 供 batch 使用：与 run() 相同，但保持同步执行以落在同一事务内
      _runSync() {
        const r = stmt.run(...params);
        return { success: true, meta: { changes: Number(r.changes) } };
      },
      sql,
      params,
    };
    return wrapper;
  }

  const raw = {
    prepare,

    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const out = statements.map((s) => (typeof s._runSync === 'function' ? s._runSync() : null));
        sqlite.exec('COMMIT');
        return out;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },

    async exec(sql) { sqlite.exec(sql); return { success: true }; },

    // 仅供测试断言，不属于 D1 接口
    _query(sql, params = []) { return sqlite.prepare(sql).all(...params); },
    _close() { sqlite.close(); },
  };

  return raw;
}
