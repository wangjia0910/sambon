/**
 * 《三宝殿》生产系统 · 口令策略 / 邮箱验证 / GPC / 会话轮换
 *
 * 职责：注册与登录的安全辅助能力；邮箱验证 token 只存摘要、验证用 batch 原子化。
 * 红线：
 *   - 邮箱 token 明文只返回给服务端调用方（由调用方放进通知队列），绝不返回给客户端、绝不落库。
 *   - verifyEmailToken 不抛异常，失败返回 { ok:false, reason }。
 *   - validatePassword 不做全局强制：仅由主代理在 ENFORCE_STRONG_PASSWORD==='true' 时条件启用
 *     （现有回归使用较短测试口令，故本函数默认不参与注册链路）。
 *   - 不记录任何口令 / token / email 明文到日志。
 * 降级策略：可预期异常吞掉返回安全默认值；db 故障由编排层统一 500。
 */

import { randomHex } from './auth.js';
import { sha256Hex } from './hash.js';

const DISPOSABLE_DOMAINS = [
  /^mailinator\.com$/i,
  /^10minutemail\.com$/i,
  /^guerrillamail\.com$/i,
  /^tempmail\./i,
  /^yopmail\.com$/i,
  /^trashmail\.com$/i,
  /^disposable\./i,
];

export function validatePassword(password) {
  const pwd = String(password ?? '');
  const reasons = [];
  if (pwd.length < 12) reasons.push('长度不足 12 位');
  const classes = [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(pwd)).length;
  if (classes < 3) reasons.push('至少包含大写 / 小写 / 数字 / 符号中的 3 类');
  if (/password|123456|qwerty|sambon/i.test(pwd)) reasons.push('包含常见弱口令串');
  return { valid: reasons.length === 0, reasons };
}

export function disposableEmail(email) {
  const e = String(email ?? '').trim().toLowerCase();
  const m = /^([^@\s]+)@([^@\s]+)$/.exec(e);
  if (!m) return true;
  const domain = m[2];
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return true;
  if (!/^[a-z0-9.-]+$/.test(domain)) return true;
  return DISPOSABLE_DOMAINS.some((re) => re.test(domain));
}

export function gpcRequested(request) {
  try {
    const h = request.headers;
    return h.get('sec-gpc') === '1' || h.get('dnt') === '1';
  } catch {
    return false;
  }
}

export async function issueEmailVerification(db, userId, { ttlHours = 24 } = {}) {
  const token = randomHex(24);
  const tokenHash = sha256Hex(token); // 只存摘要，明文绝不落库
  const now = new Date();
  const hours = Number(ttlHours) || 24;
  const expiresAt = new Date(now.getTime() + hours * 3600 * 1000).toISOString();
  const createdAt = now.toISOString();
  await db.run(
    `INSERT INTO email_verifications (user_id, token_hash, expires_at, created_at, verified_at)
     VALUES (?, ?, ?, ?, NULL)
     ON CONFLICT(user_id) DO UPDATE SET
       token_hash = excluded.token_hash,
       expires_at = excluded.expires_at,
       created_at = excluded.created_at,
       verified_at = NULL`,
    [String(userId), tokenHash, expiresAt, createdAt],
  );
  // token 仅交给服务端调用方（放进通知队列），本函数不面向客户端
  return { token, expiresAt };
}

export async function verifyEmailToken(db, token) {
  const tokenHash = sha256Hex(String(token ?? ''));
  let row;
  try {
    row = await db.first(
      'SELECT user_id, expires_at, verified_at FROM email_verifications WHERE token_hash = ?',
      [tokenHash],
    );
  } catch {
    return { ok: false, reason: 'NOT_FOUND' };
  }
  if (!row) return { ok: false, reason: 'NOT_FOUND' };
  if (row.verified_at) return { ok: false, reason: 'INVALID' };
  const exp = Date.parse(String(row.expires_at));
  if (!Number.isFinite(exp) || exp <= Date.now()) return { ok: false, reason: 'EXPIRED' };
  const now = new Date().toISOString();
  try {
    await db.batch([
      {
        sql: 'UPDATE users SET email_verified = 1 WHERE user_id = ?',
        params: [row.user_id],
      },
      {
        sql: 'UPDATE email_verifications SET verified_at = ? WHERE user_id = ?',
        params: [now, row.user_id],
      },
    ]);
  } catch {
    return { ok: false, reason: 'INVALID' };
  }
  return { ok: true, userId: row.user_id };
}

export async function rotateSessions(db, userId) {
  const res = await db.run('DELETE FROM sessions WHERE user_id = ?', [String(userId)]);
  return { revoked: Number(res.changes) };
}

export function securityMeta(env) {
  return {
    strong_password_enforced: Boolean(env && env.ENFORCE_STRONG_PASSWORD === 'true'),
    // 与 api.js 一致：默认不强制（保证既有回归与平滑升级），生产显式设 'true' 开启
    email_verification_enabled: Boolean(env && env.EMAIL_VERIFICATION_REQUIRED === 'true'),
    gpc_supported: true,
  };
}
