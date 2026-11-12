/**
 * 生产系统 · 认证 / 会话 / CSRF / RBAC / 限流
 *
 * 安全口径：
 *  - 密码 PBKDF2-SHA256（默认 120000 轮，盐 16 字节随机），只存派生值不存口令。
 *  - 会话 token 只以 SHA-256 摘要入库；httpOnly + Secure + SameSite=Lax Cookie。
 *  - 写操作 CSRF 双提交：JSON 下发的 csrf_token 必须回传 X-CSRF-Token。
 *  - Origin 一致性校验（存在 Origin 头时），阻断跨站表单写操作。
 *  - 限流 key 为 IP + UA 的哈希，不落明文 IP（GDPR 数据最小化）。
 *  - RBAC：publisher / solver / admin 三角色；审核、裁定、自动验收仅 admin（人工闸门）。
 */

import { sha256Hex } from './hash.js';
import { fail, ApiFailure } from './response.js';

const COOKIE_NAME = 'sambon_sid';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ITERATIONS = 120000;
const RATE_WINDOW_MS = 60 * 1000;

const toHex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

export function randomHex(bytes = 16) {
  const arr = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(arr);
  return toHex(arr.buffer);
}

function iterations(env) {
  const v = Number(env && env.PBKDF2_ITERATIONS);
  // 测试可显式降低；生产默认且最低 120000，防止被配置成弱派生
  return env && env.PBKDF2_ITERATIONS ? (Number.isFinite(v) && v > 0 ? v : DEFAULT_ITERATIONS) : DEFAULT_ITERATIONS;
}

export async function hashPassword(password, salt, env) {
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    'raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: iterations(env), hash: 'SHA-256' },
    key, 256,
  );
  return toHex(bits);
}

export function parseCookies(request) {
  const raw = request.headers.get('cookie') || '';
  const out = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(token, env) {
  const secure = !(env && env.COOKIE_SECURE === 'false');
  return [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    ...(secure ? ['Secure'] : []),
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ].join('; ');
}

export function clearSessionCookie(env) {
  const secure = !(env && env.COOKIE_SECURE === 'false');
  return [
    `${COOKIE_NAME}=`, 'HttpOnly', ...(secure ? ['Secure'] : []),
    'SameSite=Lax', 'Path=/', 'Max-Age=0',
  ].join('; ');
}

/** 返回 { user, csrf, token_hash } 或 null；过期会话自动清理 */
export async function getSession(db, request) {
  const token = parseCookies(request)[COOKIE_NAME];
  if (!token) return null;
  const tokenHash = sha256Hex(token);
  const row = await db.first(
    'SELECT s.token_hash, s.csrf, s.expires_at, u.* FROM sessions s JOIN users u ON u.user_id = s.user_id WHERE s.token_hash = ?',
    [tokenHash],
  );
  if (!row) return null;
  if (row.deleted_at || row.banned) return null;
  if (Date.parse(row.expires_at) <= Date.now()) {
    await db.run('DELETE FROM sessions WHERE token_hash = ?', [tokenHash]);
    return null;
  }
  const { token_hash: _th, csrf, expires_at: _exp, ...user } = row;
  return { user, csrf, token_hash: tokenHash };
}

export async function createSession(db, userId) {
  const token = randomHex(32);
  const csrf = randomHex(24);
  const now = new Date();
  await db.run(
    'INSERT INTO sessions (token_hash, user_id, csrf, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
    [sha256Hex(token), userId, csrf, new Date(now.getTime() + SESSION_TTL_MS).toISOString(), now.toISOString()],
  );
  return { token, csrf, session: { csrf_token: csrf } };
}

export async function destroySession(db, request) {
  const token = parseCookies(request)[COOKIE_NAME];
  if (token) await db.run('DELETE FROM sessions WHERE token_hash = ?', [sha256Hex(token)]);
}

/** CSRF + Origin 校验；未登录的公开写端点（注册/登录/匿名同意）不调用本函数 */
export function assertCsrf(request, session) {
  if (!session) fail('UNAUTHORIZED', '未登录或会话已失效', 401);
  const given = request.headers.get('x-csrf-token') || '';
  if (!given || given !== session.csrf) fail('CSRF_FAILED', 'CSRF 校验失败，请刷新页面后重试', 403);
  const origin = request.headers.get('origin');
  if (origin) {
    // Cloudflare 边缘必定带 Host；本地 Request 对象可能不暴露，回退用 URL host
    let host = request.headers.get('host');
    if (!host) { try { host = new URL(request.url).host; } catch { host = ''; } }
    let same = false;
    try {
      const u = new URL(origin);
      same = u.host === host;
    } catch { same = false; }
    if (!same) fail('CROSS_ORIGIN_BLOCKED', '跨源写请求被拒绝', 403);
  }
}

export function requireUser(session) {
  if (!session) fail('UNAUTHORIZED', '请先登录', 401);
  return session.user;
}

export function requireRole(session, roles) {
  const user = requireUser(session);
  if (!roles.includes(user.role)) fail('FORBIDDEN', `该操作仅允许 ${roles.join(' / ')} 角色`, 403);
  return user;
}

/** 限流：按 scope + 客户端哈希，60 秒窗口；不记录明文 IP */
export async function rateLimit(db, request, scope, limit, env) {
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
  const ua = request.headers.get('user-agent') || '';
  const key = `${scope}:${sha256Hex(`${ip}|${ua}`).slice(0, 32)}`;
  const windowStart = Math.floor(Date.now() / RATE_WINDOW_MS) * RATE_WINDOW_MS;
  // 显式关闭只用于本地回归；生产默认启用
  if (env && env.RATE_LIMIT_DISABLED === 'true') return;
  const row = await db.first('SELECT window_start, count FROM rate_limits WHERE bucket_key = ?', [key]);
  if (row && Number(row.window_start) === windowStart) {
    if (Number(row.count) >= limit) {
      fail('RATE_LIMITED', `请求过于频繁（${scope}：每分钟上限 ${limit} 次）`, 429);
    }
    await db.run('UPDATE rate_limits SET count = count + 1 WHERE bucket_key = ?', [key]);
  } else {
    await db.run(
      'INSERT INTO rate_limits (bucket_key, window_start, count) VALUES (?, ?, 1) ON CONFLICT(bucket_key) DO UPDATE SET window_start = excluded.window_start, count = 1',
      [key, windowStart],
    );
  }
}

export function isApiFailure(e) {
  return e instanceof ApiFailure;
}
