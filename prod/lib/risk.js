/**
 * 《三宝殿》生产系统 · 风控评分（只标记，不自动处罚）
 *
 * 职责：发布行为 / 登录失败的风险标记，写 risk_flags 供 admin 人工处置。
 * 红线：
 *   - blocked 恒 false：绝不自动拦截任务、不自动处罚、不改任务状态（登录锁定仅为会话保护）。
 *   - 违禁词一票否决由 api.js 的 compliancePrecheck 负责，本模块只做提示。
 *   - detail_json 只存 flag / score / 计数，零正文、零 PII。
 *   - resolveFlag 必须由人工显式调用，模块内绝不自动调用。
 * 降级策略：查询异常返回安全默认值（空 flags / locked:false / 空数组 / updated:false）。
 */

const SOLICIT_RE = /免费|加微信|私聊|转账|投资|返利|博彩|套现/;
const FLAG_SCORES = Object.freeze({
  HIGH_FREQUENCY_PUBLISH: 0.6,
  ABNORMAL_BOUNTY: 0.5,
  SUSPECT_SOLICITATION: 0.8,
  DUPLICATE_TASK: 0.4,
});

const iso = () => new Date().toISOString();

/** 单条 flag 落库，detail_json 只含 flag / score / count，零正文 */
async function writeFlag(db, userId, flag, score, count) {
  await db.run(
    `INSERT INTO risk_flags (subject_type, subject_id, flag, score, detail_json, status, created_at)
     VALUES ('user', ?, ?, ?, ?, 'OPEN', ?)`,
    [String(userId), flag, Number(score), JSON.stringify({ flag, score: Number(score), count: Number(count) }), iso()],
  );
}

export async function assessNewTask(db, { userId, bounty, category, title, description, now = Date.now() }) {
  void category; // 预留类目维度，当前规则未使用
  const uid = String(userId);
  const flags = [];
  const counts = {};

  // ① 5 分钟内该用户发布 ≥5 单
  try {
    const row = await db.first(
      'SELECT COUNT(*) AS n FROM tasks WHERE publisher_id = ? AND created_at >= ?',
      [uid, new Date(now - 5 * 60 * 1000).toISOString()],
    );
    counts.publish_5m = Number(row?.n ?? 0);
    if (counts.publish_5m >= 5) {
      flags.push({ flag: 'HIGH_FREQUENCY_PUBLISH', score: FLAG_SCORES.HIGH_FREQUENCY_PUBLISH });
    }
  } catch { counts.publish_5m = 0; }

  // ② 单笔赏金 > 10000
  const bountyNum = Number(bounty);
  counts.bounty = Number.isFinite(bountyNum) ? bountyNum : 0;
  if (Number.isFinite(bountyNum) && bountyNum > 10000) {
    flags.push({ flag: 'ABNORMAL_BOUNTY', score: FLAG_SCORES.ABNORMAL_BOUNTY });
  }

  // ③ 标题 / 描述含引流诱导词
  const text = `${String(title ?? '')} ${String(description ?? '')}`;
  counts.solicit_hit = SOLICIT_RE.test(text) ? 1 : 0;
  if (counts.solicit_hit) {
    flags.push({ flag: 'SUSPECT_SOLICITATION', score: FLAG_SCORES.SUSPECT_SOLICITATION });
  }

  // ④ 同一标题 24h 内重复 ≥3 次（统计已有记录）
  try {
    const row = await db.first(
      'SELECT COUNT(*) AS n FROM tasks WHERE title = ? AND created_at >= ?',
      [String(title ?? ''), new Date(now - 24 * 3600 * 1000).toISOString()],
    );
    counts.duplicate_24h = Number(row?.n ?? 0);
    if (counts.duplicate_24h >= 3) {
      flags.push({ flag: 'DUPLICATE_TASK', score: FLAG_SCORES.DUPLICATE_TASK });
    }
  } catch { counts.duplicate_24h = 0; }

  // 命中才写 risk_flags；写库失败降级为「只返回标记」，绝不阻断发布
  const detailCounts = {
    HIGH_FREQUENCY_PUBLISH: counts.publish_5m,
    ABNORMAL_BOUNTY: counts.bounty,
    SUSPECT_SOLICITATION: counts.solicit_hit,
    DUPLICATE_TASK: counts.duplicate_24h,
  };
  for (const f of flags) {
    try {
      await writeFlag(db, uid, f.flag, f.score, detailCounts[f.flag] ?? 0);
    } catch { /* 风控标记不可用时静默降级，不影响发布 */ }
  }
  // 总分封顶 1；blocked 恒 false，绝不自动拦截或处罚
  const score = Math.min(1, Math.round(flags.reduce((s, f) => s + f.score, 0) * 100) / 100);
  return { flags, blocked: false, score };
}

export async function assessLogin(db, { userId, success }) {
  const uid = String(userId);
  try {
    const row = await db.first(
      'SELECT user_id, failed_logins, locked_until FROM users WHERE user_id = ?',
      [uid],
    );
    if (!row) return { locked: false, failed_logins: 0 };
    if (success) {
      await db.run(
        'UPDATE users SET failed_logins = 0, locked_until = NULL, last_seen_at = ? WHERE user_id = ?',
        [iso(), uid],
      );
      return { locked: false, failed_logins: 0 };
    }
    const failed = Number(row.failed_logins || 0) + 1;
    const locked = failed >= 5;
    const lockedUntil = locked ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
    await db.run(
      'UPDATE users SET failed_logins = ?, locked_until = ? WHERE user_id = ?',
      [failed, lockedUntil, uid],
    );
    return { locked, failed_logins: failed };
  } catch {
    return { locked: false, failed_logins: 0 };
  }
}

export async function isLocked(userRow, now = Date.now()) {
  if (!userRow || userRow.locked_until == null || userRow.locked_until === '') return false;
  const t = Date.parse(String(userRow.locked_until));
  return Number.isFinite(t) ? t > now : false;
}

export async function listFlags(db, { status = 'OPEN', limit = 100 } = {}) {
  try {
    return await db.all(
      `SELECT id, subject_type, subject_id, flag, score, detail_json, status, created_at, resolved_by, resolved_at
         FROM risk_flags WHERE status = ? ORDER BY id DESC LIMIT ?`,
      [String(status), Number(limit) || 100],
    );
  } catch {
    return [];
  }
}

export async function resolveFlag(db, { flagId, actorId, decision, reason }) {
  const d = String(decision);
  if (d !== 'dismiss' && d !== 'escalate') return { updated: false };
  const status = d === 'dismiss' ? 'DISMISSED' : 'ESCALATED';
  const now = iso();
  const fid = Number(flagId);
  const actor = String(actorId);
  try {
    const res = await db.run(
      "UPDATE risk_flags SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ? AND status = 'OPEN'",
      [status, actor, now, fid],
    );
    const updated = Number(res.changes) > 0;
    if (updated) {
      await db.run(
        'INSERT INTO audit_log (actor_id, action, target_id, detail_json, created_at) VALUES (?, ?, ?, ?, ?)',
        [
          actor,
          'RISK_RESOLVED_MANUAL',
          String(fid),
          JSON.stringify({
            flag_id: fid,
            decision: d,
            reason: String(reason ?? '').replace(/\d{6,}/g, '[redacted]'),
          }),
          now,
        ],
      );
    }
    return { updated };
  } catch {
    return { updated: false };
  }
}
