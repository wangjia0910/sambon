/**
 * 《三宝殿》生产系统 · 定时任务 runner（HTTP 触发，不自动结算）
 *
 * 职责：由 /api/admin/cron 显式调用的 5 个作业，顺序执行、逐作业隔离错误。
 * 红线：
 *   - auto_verify_due / dispute_due 只写 risk_flags 标记 + 入队提醒，绝不自动结算、不改任务状态；
 *     所有到期提醒进入 admin 人工闸门，由人工处置。
 *   - audit_log 的 detail_json 只含计数与 at，零 PII、零任务正文。
 *   - dryRun=true 只统计不写入（含 audit_log 也不写）。
 *   - 外部投递一律走 notify 模块既有降级策略，本 runner 不伪造成功。
 * 降级策略：任一作业抛错 → ran 里记 { job, error: code } 并继续后续作业，整体不抛。
 */

import { AUTO_VERIFY_HOURS, DISPUTE_CLOSE_HOURS } from './domain.js';
import { sha256Hex } from './hash.js';
import { enqueue, deliverPending, pendingCount } from './notify.js';

const iso = () => new Date().toISOString();
const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Merkle 根：与 observability.js 口径一致，两两 SHA-256 拼接，奇数补最后一条，空账本 GENESIS */
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

export function jobMeta(env) {
  return {
    cron_secret_configured: Boolean(env && env.CRON_SECRET),
    auto_verify_hours: AUTO_VERIFY_HOURS,
    dispute_close_hours: DISPUTE_CLOSE_HOURS,
    mode: 'http_triggered',
  };
}

/** ① SUBMITTED 到期：只打标 + 通知发布方，保留人工闸门 */
async function jobAutoVerifyDue(ctx) {
  const cutoff = new Date(ctx.now - AUTO_VERIFY_HOURS * HOUR_MS).toISOString();
  const rows = await ctx.db.all(
    "SELECT task_id, publisher_id FROM tasks WHERE state = 'SUBMITTED' AND created_at < ?",
    [cutoff],
  );
  let flagged = 0;
  let notified = 0;
  for (const row of rows) {
    const exists = await ctx.db.first(
      `SELECT id FROM risk_flags WHERE subject_type = 'task' AND subject_id = ?
         AND flag = 'AUTO_VERIFY_DUE' AND status = 'OPEN'`,
      [row.task_id],
    );
    if (!exists) {
      if (!ctx.dryRun) {
        await ctx.db.run(
          `INSERT INTO risk_flags (subject_type, subject_id, flag, score, detail_json, status, created_at)
           VALUES ('task', ?, 'AUTO_VERIFY_DUE', 0, ?, 'OPEN', ?)`,
          [row.task_id, JSON.stringify({ task_id: row.task_id, due_hours: AUTO_VERIFY_HOURS }), iso()],
        );
      }
      flagged += 1;
    }
    if (!ctx.dryRun) {
      await enqueue(ctx.db, {
        userId: row.publisher_id,
        kind: 'AUTO_VERIFY_DUE',
        title: '任务验收提醒',
        body: '您发布的任务已到自动验收时点，请人工复核后再行结算（系统不会自动结算）。',
        taskId: row.task_id,
      });
    }
    notified += 1;
  }
  return { count: rows.length, detail: { tasks: rows.length, flagged, notified } };
}

/** ② DISPUTED 到期：只打标 + 通知全部 admin，保留人工闸门 */
async function jobDisputeDue(ctx) {
  const cutoff = new Date(ctx.now - DISPUTE_CLOSE_HOURS * HOUR_MS).toISOString();
  const rows = await ctx.db.all(
    "SELECT task_id FROM tasks WHERE state = 'DISPUTED' AND created_at < ?",
    [cutoff],
  );
  const admins = await ctx.db.all(
    "SELECT user_id FROM users WHERE role = 'admin' AND deleted_at IS NULL",
  );
  let flagged = 0;
  let notified = 0;
  for (const row of rows) {
    const exists = await ctx.db.first(
      `SELECT id FROM risk_flags WHERE subject_type = 'task' AND subject_id = ?
         AND flag = 'DISPUTE_CLOSE_DUE' AND status = 'OPEN'`,
      [row.task_id],
    );
    if (!exists) {
      if (!ctx.dryRun) {
        await ctx.db.run(
          `INSERT INTO risk_flags (subject_type, subject_id, flag, score, detail_json, status, created_at)
           VALUES ('task', ?, 'DISPUTE_CLOSE_DUE', 0, ?, 'OPEN', ?)`,
          [row.task_id, JSON.stringify({ task_id: row.task_id, due_hours: DISPUTE_CLOSE_HOURS }), iso()],
        );
      }
      flagged += 1;
    }
    for (const admin of admins) {
      if (!ctx.dryRun) {
        await enqueue(ctx.db, {
          userId: admin.user_id,
          kind: 'DISPUTE_CLOSE_DUE',
          title: '争议待人工结案',
          body: '有争议任务已到结案时点，请人工复核材料后裁定（系统不会自动裁定）。',
          taskId: row.task_id,
        });
      }
      notified += 1;
    }
  }
  return {
    count: rows.length,
    detail: { tasks: rows.length, flagged, notified, admins: admins.length },
  };
}

/** ③ 清理：dryRun 用 SELECT COUNT 统计，否则 DELETE 取 db.run().changes */
async function jobCleanup(ctx) {
  const nowIso = new Date(ctx.now).toISOString();
  const cutoff30 = new Date(ctx.now - 30 * DAY_MS).toISOString();
  const cutoff7 = new Date(ctx.now - 7 * DAY_MS).toISOString();
  const rateCutoff = ctx.now - HOUR_MS; // rate_limits.window_start 为 INTEGER 毫秒
  const specs = [
    {
      key: 'sessions',
      del: 'DELETE FROM sessions WHERE expires_at < ?',
      cnt: 'SELECT COUNT(*) AS n FROM sessions WHERE expires_at < ?',
      params: [nowIso],
    },
    {
      key: 'idempotency',
      del: 'DELETE FROM idempotency WHERE created_at < ?',
      cnt: 'SELECT COUNT(*) AS n FROM idempotency WHERE created_at < ?',
      params: [cutoff30],
    },
    {
      key: 'notifications',
      del: 'DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < ?',
      cnt: 'SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NOT NULL AND created_at < ?',
      params: [cutoff30],
    },
    {
      key: 'email_verifications',
      del: 'DELETE FROM email_verifications WHERE verified_at IS NOT NULL AND created_at < ?',
      cnt: 'SELECT COUNT(*) AS n FROM email_verifications WHERE verified_at IS NOT NULL AND created_at < ?',
      params: [cutoff7],
    },
    {
      key: 'rate_limits',
      del: 'DELETE FROM rate_limits WHERE window_start < ?',
      cnt: 'SELECT COUNT(*) AS n FROM rate_limits WHERE window_start < ?',
      params: [rateCutoff],
    },
  ];
  const detail = {};
  let total = 0;
  for (const s of specs) {
    let n;
    if (ctx.dryRun) {
      const row = await ctx.db.first(s.cnt, s.params);
      n = Number(row?.n ?? 0);
    } else {
      const res = await ctx.db.run(s.del, s.params);
      n = Number(res.changes);
    }
    detail[s.key] = n;
    total += n;
  }
  return { count: total, detail };
}

/** ④ 账本锚点：算 Merkle 根写 meta，不改动任何流水 */
async function jobAnchor(ctx) {
  const rows = await ctx.db.all('SELECT hash FROM ledger_entries ORDER BY seq');
  const hashes = rows.map((r) => r.hash);
  const root = merkleRoot(hashes);
  const entry_count = hashes.length;
  const value = JSON.stringify({ root, entry_count, at: ctx.at, pii_on_chain: false });
  if (!ctx.dryRun) {
    await ctx.db.run(
      `INSERT INTO meta (key, value) VALUES ('ledger_anchor', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [value],
    );
  }
  return { count: entry_count, detail: { root, entry_count } };
}

/** ⑤ 通知投递：交给 notify 模块执行真实 / 降级投递 */
async function jobNotifyDelivery(ctx) {
  if (ctx.dryRun) {
    const pending = await pendingCount(ctx.db);
    return { count: pending, detail: { dry_run: true, pending } };
  }
  const result = await deliverPending(ctx.db, ctx.env);
  return { count: Number(result.sent ?? 0), detail: result };
}

export async function runJobs(db, env, { dryRun = false, now = Date.now() } = {}) {
  // 写库时间统一 new Date().toISOString()；now 仅作为到期判断基准
  const at = iso();
  const ctx = { db, env, now, dryRun: Boolean(dryRun), at };
  const ran = [];
  const counts = {};
  const jobs = [
    ['auto_verify_due', jobAutoVerifyDue],
    ['dispute_due', jobDisputeDue],
    ['cleanup', jobCleanup],
    ['anchor', jobAnchor],
    ['notify_delivery', jobNotifyDelivery],
  ];
  for (const [name, fn] of jobs) {
    try {
      const r = await fn(ctx);
      if (!ctx.dryRun) {
        await db.run(
          'INSERT INTO audit_log (actor_id, action, target_id, detail_json, created_at) VALUES (?, ?, ?, ?, ?)',
          ['system-cron', `CRON_${name.toUpperCase()}`, null, JSON.stringify({ count: r.count, at }), iso()],
        );
      }
      ran.push({ job: name, count: r.count });
      counts[name] = r.detail;
    } catch (e) {
      // 单作业失败隔离：只记错误码，继续跑后续作业，整体不抛
      ran.push({ job: name, error: (e && (e.code || e.name)) || 'JOB_FAILED' });
      counts[name] = { count: 0, error: true };
    }
  }
  return { ran, counts, at, dry_run: ctx.dryRun };
}
