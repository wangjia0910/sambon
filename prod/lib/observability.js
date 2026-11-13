/**
 * 《三宝殿》生产系统 · 结构化日志与指标
 *
 * 职责：请求上下文、单行 JSON 结构化日志、指标落库与聚合、账本完整性校验。
 * 红线：
 *   - structuredLog 只输出白名单字段；绝不记录 body / header / token / cookie / email / IP / query。
 *   - requestContext 的 path 只取 pathname，剥离 query（防 PII）。
 *   - recordMetric 的 meta 字符串值做长数字串抹除，零 PII。
 * 降级策略：查询异常返回安全默认值（0 / 空数组 / balanced:false），空数据不报错。
 *
 * 指标口径约定（由编排层调用 recordMetric 时遵循）：
 *   - 每次请求：{ scope, key:'request', value:1, meta:{ event, status, duration_ms, code } }
 *   - 限流命中：{ scope, key:'rate_limit_hit', value:1, meta:{ event } }
 */

import { randomHex } from './auth.js';
import { sha256Hex } from './hash.js';

/** 与 domain.js round2 完全一致的取整，用于按 api.js postLegs 真实公式重算 hash */
const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const round4 = (x) => Math.round((x + Number.EPSILON) * 10000) / 10000;

/** 与 jobs.js anchor 作业相同口径：两两 SHA-256 拼接，奇数补最后一条，空账本 GENESIS */
function merkleRoot(hashes) {
  if (!hashes.length) return 'GENESIS';
  let level = hashes.slice();
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(sha256Hex(level[i] + (level[i + 1] || level[i])));
    }
    level = next;
  }
  return level[0];
}

function scrubMeta(meta) {
  const out = {};
  const src = meta && typeof meta === 'object' ? meta : {};
  for (const [k, v] of Object.entries(src)) {
    out[String(k)] = typeof v === 'string' ? v.replace(/\d{6,}/g, '[redacted]') : v;
  }
  return out;
}

function safeStringify(value) {
  try { return JSON.stringify(value); } catch { return '{}'; }
}

export function requestContext(request) {
  let path = '';
  try {
    path = new URL(request.url).pathname || '';
  } catch {
    path = '';
  }
  return {
    requestId: randomHex(8),
    startedAt: Date.now(),
    method: String((request && request.method) || 'GET').toUpperCase(),
    path,
  };
}

export function structuredLog(ctx, { level = 'info', event, status = null, durationMs = null, code = null }) {
  // 单行 JSON，字段白名单，绝不夹带 body / header / token / cookie / email / IP
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level: String(level),
    event: String(event ?? ''),
    request_id: ctx?.requestId ?? null,
    method: ctx?.method ?? null,
    path: ctx?.path ?? null,
    status: status === null ? null : Number(status),
    duration_ms: durationMs === null ? null : Number(durationMs),
    code: code === null ? null : String(code),
  }));
}

export async function recordMetric(db, { scope, key, value = 1, meta = {} }) {
  await db.run(
    'INSERT INTO metrics (ts, scope, key, value, meta_json) VALUES (?, ?, ?, ?, ?)',
    [
      Date.now(),
      String(scope),
      String(key),
      Number(value) || 0,
      safeStringify(scrubMeta(meta)),
    ],
  );
  return { recorded: true };
}

export async function metricsSummary(db, { windowMinutes = 60 } = {}) {
  const window = Math.max(1, Number(windowMinutes) || 60);
  const since = Date.now() - window * 60 * 1000;
  let rows = [];
  try {
    rows = await db.all('SELECT key, value, meta_json FROM metrics WHERE ts >= ?', [since]);
  } catch {
    rows = [];
  }
  let total_requests = 0;
  let errors = 0;
  let rate_limit_hits = 0;
  const byEvent = new Map();
  const durations = [];
  for (const row of rows) {
    let meta = {};
    try { meta = JSON.parse(row.meta_json || '{}') || {}; } catch { meta = {}; }
    const key = String(row.key ?? '');
    if (key === 'rate_limit_hit' || meta.code === 'RATE_LIMITED') rate_limit_hits += 1;
    if (key !== 'request') continue;
    total_requests += 1;
    const ev = meta.event == null ? 'unknown' : String(meta.event);
    byEvent.set(ev, (byEvent.get(ev) || 0) + 1);
    const st = Number(meta.status);
    if (Number.isFinite(st) && st >= 400) errors += 1;
    const d = Number(meta.duration_ms);
    if (Number.isFinite(d) && d >= 0) durations.push(d);
  }
  durations.sort((a, b) => a - b);
  const avg_duration_ms = durations.length
    ? round2(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;
  const p95_duration_ms = durations.length
    ? round2(durations[Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1)])
    : 0;
  const error_rate = total_requests ? round4(errors / total_requests) : 0;
  const by_event = [...byEvent.entries()]
    .map(([event, count]) => ({ event, count }))
    .sort((a, b) => b.count - a.count || a.event.localeCompare(b.event));
  const ledger_integrity = await ledgerIntegrity(db);
  return {
    window_minutes: window,
    total_requests,
    error_rate,
    by_event,
    avg_duration_ms,
    p95_duration_ms,
    rate_limit_hits,
    ledger_integrity,
  };
}

export async function ledgerIntegrity(db) {
  let rows = [];
  let sumRow = null;
  try {
    rows = await db.all(
      `SELECT seq, event_id, task_id, account, delta, memo, rule_version, created_at, prev_hash, hash
         FROM ledger_entries ORDER BY seq ASC`,
    );
    sumRow = await db.first('SELECT COALESCE(SUM(delta), 0) AS total FROM ledger_entries');
  } catch {
    rows = [];
  }
  const entry_count = rows.length;
  const total = Number(sumRow?.total ?? 0);
  // 五科目守恒：全表 delta 之和容差 1e-6
  const balanced = Math.abs(total) < 1e-6;
  const merkle_root = merkleRoot(rows.map((r) => r.hash));

  // 按 api.js postLegs 的真实公式逐条重算 hash，并校验链连续性
  let hash_chain_valid = true;
  let prev = 'GENESIS';
  for (const r of rows) {
    if (String(r.prev_hash) !== prev) { hash_chain_valid = false; break; }
    const canonical = JSON.stringify({
      event_id: r.event_id,
      task_id: r.task_id,
      account: r.account,
      delta: round2(Number(r.delta)),
      memo: r.memo,
      rule_version: r.rule_version,
      prev_hash: r.prev_hash,
      created_at: r.created_at,
    });
    if (sha256Hex(canonical) !== String(r.hash)) { hash_chain_valid = false; break; }
    prev = r.hash;
  }
  return { balanced, entry_count, total, merkle_root, hash_chain_valid };
}
