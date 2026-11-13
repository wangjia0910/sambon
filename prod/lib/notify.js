/**
 * 《三宝殿》生产系统 · 通知队列与可配置 Webhook 真实投递
 *
 * 职责：通知只入队（PENDING）；对外投递由 deliverPending 显式驱动，供 cron / admin 触发。
 * 红线：
 *   - title / body 必须为纯文本且不含 PII；模块内部再做长数字串抹除 + 300 字截断兜底。
 *   - 绝不伪造已发送：仅 2xx 响应才置 SENT；失败只累加 attempts，第 5 次置 FAILED。
 *   - 不记录 webhook secret、不记录用户邮箱 / 手机号 / token 等任何业务数据到日志。
 * 降级策略：未配置 NOTIFY_WEBHOOK_URL → 强制 queue_only（degraded:true, sent:0），
 *           通知仅入队，等待人工或后续配置后投递，绝不自称已发送。
 */

const MAX_TEXT = 300;
const MAX_ATTEMPTS = 5;
const DEFAULT_LIMIT = 50;
const FETCH_TIMEOUT_MS = 4000;

const iso = () => new Date().toISOString();

/**
 * 纯文本兜底：抹除 6 位以上连续数字（疑似手机号 / 证件号 / 单号）+ 截断。
 * 例外：EMAIL_VERIFICATION 正文里是随机 hex 验证令牌（非 PII），必须原样送达，
 * 否则用户拿到的令牌被抹成 [redacted]，永远无法完成邮箱验证。
 */
function safeText(value, kind) {
  const raw = String(value ?? '');
  if (kind === 'EMAIL_VERIFICATION') return raw.slice(0, MAX_TEXT);
  return raw.replace(/\d{6,}/g, '[redacted]').slice(0, MAX_TEXT);
}

/** HMAC-SHA256(secret, body) → hex，使用 Web Crypto，零第三方依赖 */
async function hmacHex(secret, body) {
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    'raw', enc.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(body));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 记录一次投递失败：累加 attempts，达到第 5 次置 FAILED */
async function markFailure(db, row) {
  const next = Number(row.attempts || 0) + 1;
  if (next >= MAX_ATTEMPTS) {
    await db.run("UPDATE notifications SET attempts = ?, status = 'FAILED' WHERE id = ?", [next, row.id]);
  } else {
    await db.run('UPDATE notifications SET attempts = ? WHERE id = ?', [next, row.id]);
  }
}

/** 读取时再兜底一次，保证 title / body 不回显长数字串 */
function cleanRow(row) {
  return {
    ...row,
    id: Number(row.id),
    title: safeText(row.title, row.kind),
    body: safeText(row.body, row.kind),
    attempts: Number(row.attempts || 0),
  };
}

export async function enqueue(db, { userId, kind, title, body, taskId = null }) {
  const now = iso();
  await db.run(
    `INSERT INTO notifications (user_id, kind, title, body, task_id, status, attempts, created_at)
     VALUES (?, ?, ?, ?, ?, 'PENDING', 0, ?)`,
    [String(userId), String(kind), safeText(title, kind), safeText(body, kind), taskId ?? null, now],
  );
  // AUTOINCREMENT 场景下刚插入的行即为当前最大 id（db.run 不暴露 last_row_id）
  const row = await db.first('SELECT MAX(id) AS id FROM notifications');
  return { id: row ? Number(row.id) : null, queued: true };
}

export async function deliverPending(db, env, { limit = DEFAULT_LIMIT } = {}) {
  const rows = await db.all(
    `SELECT id, user_id, kind, title, body, task_id, created_at, attempts
       FROM notifications WHERE status = 'PENDING' AND attempts < ? ORDER BY id ASC LIMIT ?`,
    [MAX_ATTEMPTS, Number(limit) || DEFAULT_LIMIT],
  );
  const pending = rows.length;
  const url = env && env.NOTIFY_WEBHOOK_URL;
  if (!url) {
    return {
      degraded: true,
      pending,
      sent: 0,
      failed: 0,
      reason: 'NOTIFY_WEBHOOK_URL 未配置：通知仅入队，未对外投递',
    };
  }
  const secret = env && env.NOTIFY_WEBHOOK_SECRET;
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const body = JSON.stringify({
      id: Number(row.id),
      user_id: row.user_id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      task_id: row.task_id ?? null,
      created_at: row.created_at,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const headers = { 'content-type': 'application/json' };
      if (secret) headers['x-sambon-signature'] = await hmacHex(secret, body);
      const resp = await fetch(String(url), {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
      if (resp && resp.ok) {
        await db.run("UPDATE notifications SET status = 'SENT', sent_at = ? WHERE id = ?", [iso(), row.id]);
        sent += 1;
      } else {
        await markFailure(db, row);
        failed += 1;
      }
    } catch {
      // 网络超时 / 签名异常 / 单条投递失败：只记失败，不影响其他条
      await markFailure(db, row);
      failed += 1;
    } finally {
      clearTimeout(timer);
    }
  }
  return { degraded: false, pending, sent, failed, channel: 'webhook' };
}

export async function listForUser(db, userId, { limit = 50, unreadOnly = false } = {}) {
  const uid = String(userId);
  const lim = Number(limit) || 50;
  // 两条完整 SQL 避免拼接；unreadOnly 是固定枚举，不含任何用户输入
  const items = unreadOnly
    ? await db.all(
      `SELECT id, user_id, kind, title, body, task_id, status, attempts, created_at, sent_at, read_at
         FROM notifications WHERE user_id = ? AND read_at IS NULL ORDER BY id DESC LIMIT ?`,
      [uid, lim],
    )
    : await db.all(
      `SELECT id, user_id, kind, title, body, task_id, status, attempts, created_at, sent_at, read_at
         FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
      [uid, lim],
    );
  const row = await db.first(
    'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL',
    [uid],
  );
  return { items: items.map(cleanRow), unread_count: Number(row?.n ?? 0) };
}

export async function markRead(db, userId, { ids = [], all = false } = {}) {
  const now = iso();
  const uid = String(userId);
  if (all) {
    const res = await db.run(
      'UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL',
      [now, uid],
    );
    return { updated: Number(res.changes) };
  }
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isFinite(n));
  if (!list.length) return { updated: 0 };
  // 拼接的仅是占位符数量，值全部参数化，杜绝 SQL 注入
  const placeholders = list.map(() => '?').join(',');
  const res = await db.run(
    `UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (${placeholders})`,
    [now, uid, ...list],
  );
  return { updated: Number(res.changes) };
}

export async function pendingCount(db) {
  const row = await db.first("SELECT COUNT(*) AS n FROM notifications WHERE status = 'PENDING'");
  return Number(row?.n ?? 0);
}

export function notifyMeta(env) {
  const configured = Boolean(env && env.NOTIFY_WEBHOOK_URL);
  return {
    configured,
    degraded: !configured,
    channel: configured ? 'webhook' : 'queue_only',
  };
}
