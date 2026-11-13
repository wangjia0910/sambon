/**
 * 《三宝殿》生产系统 · HTTP API 编排层（Cloudflare Pages Functions / D1）
 *
 * 与 L0 原型的关系：
 *   - 状态机、积分公式、推送权重、榜单权重、合规预检、PII 脱敏、LLM 兜底
 *     全部复用 src/domain.mjs（由构建脚本同步为 prod/lib/domain.js），口径零漂移。
 *   - 编排与持久化重写：内存单例 → D1 事务；进程级开关 → 账号级开关；
 *     无鉴权 → 会话 / CSRF / RBAC；无留痕 → 账本哈希链 + 事件流 + 人工闸门审计。
 *
 * 红线（CONTRACT §10，任何端点不得违背）：
 *   1. 无 SBC 转让 / 交易 / 兑付 / 收益类接口；未登记路径一律 404。
 *   2. 不存明文手机号 / 证件号；联系方式虚拟号；成果正文先脱敏再落库；事件 payload 白名单。
 *   3. 结算、争议裁定、任务审核、账号处罚保留人工兜底，模型不直判。
 *   4. 关闭个性化推荐为账号级、服务端强制，任一候选关闭则整体中性排序。
 *   5. 链相关仅本地哈希链摘要，零 PII、零任务正文。
 */

import {
  canTransition, computeFreeze, computeQualityBonus, computeCancelSettlement,
  compliancePrecheck, sanitizeSubmissionText, sanitizeContact,
  extractTaskStructure, semanticMatchHint, summarizeDispute,
  scoreCandidates, neutralCandidates, hardFilter, rankTasks, rankUsers,
  MAX_REJECT, AUTO_VERIFY_HOURS, DISPUTE_CLOSE_HOURS,
  RULE_VERSION, WEIGHT_VERSION, LLM_ADAPTER_VERSION,
  DISPATCH_WEIGHTS, TASK_RANK_WEIGHTS, USER_RANK_WEIGHTS,
  round2, round4,
} from './domain.js';
import { sha256Hex } from './hash.js';
import { createDb } from './db.js';
import {
  hashPassword, randomHex, getSession, createSession, destroySession,
  sessionCookie, clearSessionCookie, assertCsrf, requireUser, requireRole,
  rateLimit,
} from './auth.js';
import { ok, fail, errorResponse, ApiFailure } from './response.js';
import { SCHEMA_VERSION } from './schema.js';
// V3 完全体模块（D-14）：通知 / 大模型 / 定时任务 / 可观测 / 风控 / 账号安全
import * as notify from './notify.js';
import * as llm from './llm.js';
import * as jobs from './jobs.js';
import * as obs from './observability.js';
import * as risk from './risk.js';
import * as sec from './security.js';

const SERVICE = 'sambon-production';
const VERSION = 'v3.0.0';   // D-14 完全体：通知 / LLM / cron / 运维 / 灾备 / i18n
const INITIAL_SBC_DEFAULT = 1000;      // 平台内贡献积分初始额度，非资产、不可兑付
const MAX_BODY_BYTES = 1024 * 1024;

/** CONTRACT §4 事件集合 + 生产系统扩展（docs/12 §4 登记） */
export const CONTRACT_EVENTS = Object.freeze([
  'TaskPublished', 'TaskUpdated', 'RiskBlocked', 'CreditFrozen', 'CreditChanged',
  'CreditTransferred', 'RankUpdated', 'DispatchRequested', 'DispatchScored',
  'DispatchSent', 'TaskAccepted', 'TaskSubmitted', 'TaskVerified', 'TaskDelisted',
  'DisputeOpened', 'DisputeResolved', 'SettlementCompleted', 'PreferenceChanged',
]);
// D-13 扩展 + D-14 完全体扩展；契约 §4 原始 18 类一字未改
export const PROD_EVENTS = Object.freeze([
  ...CONTRACT_EVENTS, 'ReportFiled',
  'TaskCancelled', 'DispatchExposed', 'DispatchIgnored', 'EmailVerified',
  'NotificationQueued', 'RiskFlagged', 'BackupCreated', 'LedgerAnchored', 'CronCompleted',
]);

const EVENT_KEY_WHITELIST = new Set([
  'task_id', 'state', 'decision', 'amount', 'bounty', 'service_fee', 'rule_version',
  'reason_code', 'mode', 'candidate_count', 'candidate_ids', 'pii_redacted',
  'redacted_count', 'weight_version', 'scope', 'action', 'resolution',
  'close_hours', 'auto_verify_hours', 'rating', 'submit_count', 'reject_count',
  'dispatch_id', 'top_k', 'batch_size', 'expand', 'expand_to',
  'algorithm_degraded', 'llm_adapter_version', 'virtual_number_placeholder',
  'compliance_pass', 'hooks_present', 'subjects_changed', 'arbitrator',
  'model_decision', 'note', 'personalized_enabled', 'enforcement',
  'neutral_sort_rule', 'escrow_total', 'quality_bonus', 'auto_verified',
  'hits', 'category', 'channel',
  // D-14 新增（只放枚举值 / 计数 / 布尔，绝不承载正文或 PII）
  'cancel_reason', 'kind', 'flag', 'score', 'feature', 'locale', 'entry_count',
  'pii_redacted', 'pii_on_chain', 'anchor', 'root', 'job', 'counts', 'feedback',
]);

const iso = () => new Date().toISOString();
const uuid = (prefix) => `${prefix}-${randomHex(12)}`;
const redactDigits = (s) => String(s).replace(/\d{6,}/g, '[已脱敏]');

function safePayload(input) {
  const out = {};
  for (const [k, v] of Object.entries(input || {})) {
    if (!EVENT_KEY_WHITELIST.has(k)) continue;
    if (typeof v === 'string') out[k] = redactDigits(v).slice(0, 300);
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v;
    else if (Array.isArray(v)) out[k] = v.slice(0, 30).map((x) => (typeof x === 'string' ? redactDigits(x).slice(0, 120) : (typeof x === 'number' ? x : null)));
    else out[k] = '[omitted]';
  }
  return out;
}

// ---------------------------------------------------------------------------
// 视图与账本
// ---------------------------------------------------------------------------

const userView = (u) => ({
  user_id: u.user_id,
  email: u.email,
  display_name: u.display_name,
  role: u.role,
  available_sbc: round2(Number(u.available_sbc ?? 0)),
  credit_score: round2(Number(u.credit_score ?? 100)),
  personalized_enabled: Number(u.personalized_enabled ?? 1) === 1,
  email_verified: Number(u.email_verified ?? 0) === 1,
  locale: u.locale || 'en',
  gpc_enabled: Number(u.gpc_enabled ?? 0) === 1,
  created_at: u.created_at,
});

function parseMeta(row) {
  try { return JSON.parse(row.meta_json || '{}'); } catch { return {}; }
}

function taskView(row) {
  const meta = parseMeta(row);
  return {
    task_id: row.task_id,
    state: row.state,
    publisher_id: row.publisher_id,
    solver_id: row.solver_id ?? null,
    title: row.title,
    description: row.description,
    category: row.category,
    bounty: round2(Number(row.bounty)),
    service_fee: round2(Number(row.service_fee)),
    frozen_total: row.frozen_total === null ? null : round2(Number(row.frozen_total)),
    acceptance_criteria: row.acceptance_criteria,
    virtual_contact: row.virtual_contact,
    online: Number(row.online) === 1,
    radius_km: Number(row.radius_km),
    required_skills: meta.required_skills || [],
    deadline: row.deadline,
    deadline_hours: Number(row.deadline_hours),
    reject_count: Number(row.reject_count ?? 0),
    submit_count: Number(row.submit_count ?? 0),
    escrowed: Number(row.escrowed) === 1,
    structure: meta.structure || null,
    compliance: meta.compliance || null,
    settlement: meta.settlement || null,
    dispute_reason: meta.dispute_reason || null,
    created_at: row.created_at,
    result_preview: row.result_text ?? null,
    result_pii_redacted: Number(row.result_pii_redacted) === 1,
  };
}

/**
 * 只追加流水 + 同步用户余额，整批在一个 D1 batch（事务）里完成。
 * legs: [{account:'user:U-xxx'|'subject:frozen', delta}]
 * subject:* 是平台科目，user:* 同时更新 users.available_sbc。
 */
async function postLegs(db, { eventId, taskId, memo, legs, statements = [] }) {
  const last = await db.first('SELECT hash FROM ledger_entries ORDER BY seq DESC LIMIT 1');
  let prev = (last && last.hash) || 'GENESIS';
  const now = iso();
  for (const leg of legs) {
    const delta = round2(Number(leg.delta));
    if (!Number.isFinite(delta) || delta === 0) continue;
    const canonical = JSON.stringify({
      event_id: eventId, task_id: taskId, account: leg.account,
      delta, memo, rule_version: RULE_VERSION, prev_hash: prev, created_at: now,
    });
    const hash = sha256Hex(canonical);
    statements.push({
      sql: `INSERT INTO ledger_entries
        (event_id, task_id, account, delta, rule_version, memo, created_at, prev_hash, hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [eventId, taskId, leg.account, delta, RULE_VERSION, memo, now, prev, hash],
    });
    if (String(leg.account).startsWith('user:')) {
      const uid = String(leg.account).slice(5);
      statements.push({
        sql: 'UPDATE users SET available_sbc = round(available_sbc + ?, 2) WHERE user_id = ?',
        params: [delta, uid],
      });
    }
    prev = hash;
  }
  return statements;
}

async function appendEvent(db, { type, taskId = null, eventId = null, actor = 'task-system', payload = {} }) {
  if (!PROD_EVENTS.includes(type)) throw new Error(`未登记事件类型：${type}`);
  return {
    sql: 'INSERT INTO events (event_id, task_id, type, actor, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    params: [eventId, taskId, type, actor, JSON.stringify(safePayload(payload)), iso()],
  };
}

async function audit(db, actorId, action, targetId, detail) {
  await db.run(
    'INSERT INTO audit_log (actor_id, action, target_id, detail_json, created_at) VALUES (?, ?, ?, ?, ?)',
    [actorId, action, targetId, JSON.stringify(safePayload(detail)), iso()],
  );
}

/** Merkle 根：对最近 N 条流水 hash 做两两归并，零 PII、零任务正文 */
function merkleRoot(hashes) {
  if (!hashes.length) return sha256Hex('EMPTY');
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

async function ledgerSnapshot(db, userId) {
  const rows = await db.all(
    `SELECT * FROM ledger_entries WHERE account = ? OR task_id IN (
       SELECT task_id FROM tasks WHERE publisher_id = ? OR solver_id = ?
     ) ORDER BY seq ASC`,
    [`user:${userId}`, userId, userId],
  );
  const sum = await db.first('SELECT COALESCE(SUM(delta), 0) AS total FROM ledger_entries');
  const hashes = (await db.all('SELECT hash FROM ledger_entries ORDER BY seq DESC LIMIT 64')).map((r) => r.hash).reverse();
  return {
    user_id: userId,
    entries: rows.map((r) => ({
      seq: r.seq, event_id: r.event_id, task_id: r.task_id, account: r.account,
      delta: round2(Number(r.delta)), rule_version: r.rule_version,
      memo: r.memo, created_at: r.created_at, prev_hash: r.prev_hash, hash: r.hash,
    })),
    balance_check: {
      balanced: Math.abs(round2(Number(sum?.total ?? 0))) < 0.000001,
      total_delta: round2(Number(sum?.total ?? 0)),
      note: '五科目守恒：每一笔用户入账必对应一个平台科目出账，全表 delta 之和恒为 0',
    },
    anchor: {
      anchor_id: `ANCHOR-${sha256Hex(merkleRoot(hashes)).slice(0, 16)}`,
      merkle_root: merkleRoot(hashes),
      leaf_count: hashes.length,
      pii_on_chain: false,
      task_body_on_chain: false,
      note: '本地哈希链 / Merkle 摘要，未接公链；零 PII、零任务正文',
    },
  };
}

// ---------------------------------------------------------------------------
// 幂等
// ---------------------------------------------------------------------------

async function withIdempotency(db, body, fn) {
  const eid = body && typeof body.event_id === 'string' && body.event_id ? body.event_id.slice(0, 128) : null;
  if (!eid) return fn();
  const row = await db.first('SELECT status, response_json FROM idempotency WHERE event_id = ?', [eid]);
  if (row && row.status === 'done' && row.response_json) {
    const cached = JSON.parse(row.response_json);
    return { status: cached.status, data: cached.data, headers: { 'X-Idempotent': 'replayed' } };
  }
  if (row) fail('IDEMPOTENCY_IN_PROGRESS', '同一 event_id 正在处理中，请稍后重试', 409);
  const ins = await db.run(
    'INSERT OR IGNORE INTO idempotency (event_id, status, response_json, created_at) VALUES (?, ?, NULL, ?)',
    [eid, 'pending', iso()],
  );
  if (ins.changes === 0) fail('IDEMPOTENCY_IN_PROGRESS', '同一 event_id 正在处理中，请稍后重试', 409);
  try {
    const result = await fn();
    const status = result.status || 200;
    await db.run(
      'UPDATE idempotency SET status = ?, response_json = ? WHERE event_id = ?',
      ['done', JSON.stringify({ status, data: result.data ?? null }), eid],
    );
    return result;
  } catch (e) {
    // 业务写在 batch 中原子提交；失败时释放 pending 允许重试
    await db.run('DELETE FROM idempotency WHERE event_id = ? AND status = ?', [eid, 'pending']);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// 业务辅助
// ---------------------------------------------------------------------------

async function loadTask(db, id) {
  const row = await db.first('SELECT * FROM tasks WHERE task_id = ?', [id]);
  if (!row) fail('NOT_FOUND', '任务不存在', 404);
  return row;
}

async function loadUser(db, id) {
  const row = await db.first('SELECT * FROM users WHERE user_id = ? AND deleted_at IS NULL', [id]);
  if (!row) fail('NOT_FOUND', '用户不存在', 404);
  return row;
}

function solverProfile(u) {
  let stats = {};
  try { stats = JSON.parse(u.stats_json || '{}'); } catch { stats = {}; }
  return {
    user_id: u.user_id,
    name: u.display_name,
    role: 'solver',
    skills: Array.isArray(stats.skills) ? stats.skills : [],
    blacklisted: Number(u.banned) === 1,
    online: true,
    distance_km: Number(stats.distance_km ?? 5),
    active_tasks: Number(stats.active_tasks ?? 0),
    max_load: 3,
    push_count_today: Number(stats.push_count_today ?? 0),
    daily_push_cap: 20,
    base_response: 0.5,
    category_response: stats.category_response || {},
    on_time_rate: Number(stats.on_time_rate ?? 0.8),
    fatigue: 0.2,
    ignore_rate: 0.1,
    risk_score: Math.max(0, (100 - Number(u.credit_score ?? 100)) / 200),
    is_new: Number(stats.completed_count ?? 0) === 0,
    completed_count: Number(stats.completed_count ?? 0),
    registered_at: Date.parse(u.created_at) || 0,
    related_publishers: [],
    level_boost_rate: 0,
    personalized_enabled: Number(u.personalized_enabled ?? 1) === 1,
  };
}

function taskForScoring(row) {
  const meta = parseMeta(row);
  return {
    task_id: row.task_id,
    publisher_id: row.publisher_id,
    title: row.title,
    description: row.description,
    category: row.category,
    bounty: Number(row.bounty),
    online: Number(row.online) === 1,
    radius_km: Number(row.radius_km),
    required_skills: meta.required_skills || [],
    difficulty: Number(meta.difficulty ?? 0.3),
    remaining_ratio: Number(meta.remaining_ratio ?? 1),
    structure_completeness: Number(meta.structure?.structure_completeness ?? 0.8),
    publisher_credit_score: 100,
    exposure_accept_ratio: Number(meta.exposure_accept_ratio ?? 0),
    qualified_solver_ratio: 0.6,
    state: row.state,
    created_at: row.created_at,
  };
}

/** 结算：赏金转付 + 5% 服务费入平台收入 + 可选高质量奖励（生态激励池支出） */
async function settleTask(db, row, { rating = 0, auto = false, eventId = null, trigger = 'verify', actorId = null }) {
  const total = round2(Number(row.frozen_total));
  const bounty = round2(Number(row.bounty));
  const fee = round2(Number(row.service_fee));
  const solver = await loadUser(db, row.solver_id);
  const bonus = computeQualityBonus(bounty, rating);
  const legs = [
    { account: 'subject:escrow', delta: -total },
    { account: `user:${solver.user_id}`, delta: +bounty },
    { account: 'subject:platform_revenue', delta: +fee },
  ];
  if (bonus.amount > 0) {
    legs.push({ account: 'subject:eco_incentive', delta: -bonus.amount });
    legs.push({ account: `user:${solver.user_id}`, delta: +bonus.amount });
  }
  const statements = await postLegs(db, {
    eventId: eventId || uuid('EVT'), taskId: row.task_id,
    memo: auto ? 'settle:超时自动验收结算(人工触发)' : `settle:${trigger}结算(赏金转付+服务费+高质量奖励)`,
    legs,
  });
  let stats = {};
  try { stats = JSON.parse(solver.stats_json || '{}'); } catch { stats = {}; }
  // net_sbc 只累加赏金本金；质量奖励属生态激励，不进用户榜分（D-03）
  stats.net_sbc = round2(Number(stats.net_sbc ?? 0) + bounty);
  stats.completed_count = Number(stats.completed_count ?? 0) + 1;
  stats.total_count = Number(stats.total_count ?? 0) + 1;
  stats.on_time_count = Number(stats.on_time_count ?? 0) + 1;
  stats.active_tasks = Math.max(0, Number(stats.active_tasks ?? 1) - 1);
  if (Number(rating) > 0) {
    stats.rating_sum = Number(stats.rating_sum ?? 0) + Number(rating);
    stats.rating_count = Number(stats.rating_count ?? 0) + 1;
  }
  statements.push({
    sql: 'UPDATE users SET stats_json = ? WHERE user_id = ?',
    params: [JSON.stringify(stats), solver.user_id],
  });
  const meta = parseMeta(row);
  const settlement = {
    rule_version: RULE_VERSION, trigger, auto_verified: auto,
    bounty, service_fee: fee, quality_bonus: bonus,
    solver_credit: round2(bounty + bonus.amount),
    note: '赏金转付接单人、服务费入平台收入；模型不参与结算裁定',
  };
  meta.settlement = settlement;
  statements.push({
    sql: `UPDATE tasks SET state = 'SETTLED', settled_at = ?, meta_json = ?, version = version + 1 WHERE task_id = ?`,
    params: [iso(), JSON.stringify(meta), row.task_id],
  });
  statements.push(await appendEvent(db, {
    type: 'CreditTransferred', taskId: row.task_id, eventId, actor: 'ledger',
    payload: { task_id: row.task_id, amount: bounty, subject: 'available' },
  }));
  statements.push(await appendEvent(db, {
    type: 'CreditChanged', taskId: row.task_id, eventId, actor: 'ledger',
    payload: { task_id: row.task_id, subjects_changed: ['escrow', 'platform_revenue', 'eco_incentive', 'available'] },
  }));
  statements.push(await appendEvent(db, {
    type: 'SettlementCompleted', taskId: row.task_id, eventId,
    payload: { task_id: row.task_id, state: 'SETTLED', bounty, service_fee: fee, quality_bonus: bonus.amount, auto_verified: auto },
  }));
  statements.push(await appendEvent(db, {
    type: 'TaskDelisted', taskId: row.task_id, eventId, actor: 'leaderboard',
    payload: { task_id: row.task_id, reason: 'SETTLED' },
  }));
  statements.push(await appendEvent(db, {
    type: 'RankUpdated', taskId: row.task_id, eventId, actor: 'leaderboard',
    payload: { task_id: row.task_id, scope: 'user' },
  }));
  if (actorId) {
    statements.push({
      sql: 'INSERT INTO audit_log (actor_id, action, target_id, detail_json, created_at) VALUES (?, ?, ?, ?, ?)',
      params: [actorId, auto ? 'AUTO_VERIFY_MANUAL' : 'SETTLEMENT_CONFIRMED', row.task_id, JSON.stringify(safePayload({ bounty, service_fee: fee, decision: 'approve' })), iso()],
    });
  }
  await db.batch(statements);
  return settlement;
}

// ---------------------------------------------------------------------------
// 端点实现
// ---------------------------------------------------------------------------

function healthData(env, db) {
  return {
    mode: db ? 'production' : 'demo',
    db: db ? 'd1' : 'missing',
    status: db ? 'healthy' : 'degraded',
    service: SERVICE,
    version: VERSION,
    schema_version: SCHEMA_VERSION,
    time: iso(),
    admin_bootstrap_available: Boolean(env && env.ADMIN_BOOTSTRAP_TOKEN),
    components: {
      llm: llm.llmMeta(env || {}),
      notify: notify.notifyMeta(env || {}),
      cron: jobs.jobMeta(env || {}),
      security: sec.securityMeta(env || {}),
    },
    features: {
      email_verification: true, notifications: true, llm_adapter: true,
      cron: true, risk: true, backup: true, anchor: true, i18n: true, concurrent_cas: true,
    },
    note: db
      ? '持久化后端已就绪（D1）；会话、账本、事件均为服务端真实写入'
      : '未检测到 D1 绑定：只读演示模式，写操作不可用。绑定 DB 后自动切换，无需改代码',
  };
}

function configData(env, db, session) {
  return {
    mode: db ? 'production' : 'demo',
    service: SERVICE,
    version: VERSION,
    rule_version: RULE_VERSION,
    weight_version: WEIGHT_VERSION,
    rank_weight_version: 'v1.0',
    llm_adapter_version: LLM_ADAPTER_VERSION,
    algorithm_degraded: llm.llmMeta(env || {}).degraded,
    dispatch_weights: DISPATCH_WEIGHTS,
    task_rank_weights: TASK_RANK_WEIGHTS,
    user_rank_weights: USER_RANK_WEIGHTS,
    personalized_enabled: session ? Number(session.user.personalized_enabled) === 1 : true,
    enforcement: 'server_side',
    account_level_preference: true,
    ai_disclosure: {
      summary: '本平台使用规则化打分进行任务候选排序；大模型适配层当前为规则兜底（degraded），不决定最终推送名单、不裁定结算与争议。',
      en: 'Rule-based scoring is used for candidate ranking. The LLM adapter is currently a rule-based fallback and does not decide final dispatch lists, settlements or disputes.',
      factors: Object.keys(DISPATCH_WEIGHTS),
      opt_out: '账号级「关闭个性化推荐」开关；关闭后服务端强制按时间 + 距离中性排序',
      human_review: '结算、争议裁定、任务审核与账号处罚均为人工确认闸门',
    },
    red_lines: [
      '/api/sbc/transfer', '/api/sbc/trade', '/api/sbc/redeem', '/api/sbc/withdraw',
      '/api/sbc/exchange', '/api/sbc/yield', '/api/sbc/market', '/api/wallet/cashout',
    ],
    sbc_notice: 'SBC 为平台内贡献积分，不可兑付、不可转让、不可交易、无收益承诺。',
    llm: { ...llm.llmMeta(env || {}), model_decision: null },
    notify: notify.notifyMeta(env || {}),
    locales: ['zh-CN', 'en'],
    default_locale: 'en',
    features: {
      email_verification: (env || {}).EMAIL_VERIFICATION_REQUIRED === 'true',
      notifications: true, llm_adapter: true, cron: Boolean((env || {}).CRON_SECRET),
      risk: true, backup: true, anchor: true, i18n: true,
      concurrent_cas: true, dispatch_feedback: true, task_cancel: true,
    },
    capabilities_note: 'V3 完全体：代码能力已完备；正式运营许可须外部动作核销（docs/13）。',
  };
}

async function hRegister(c) {
  await rateLimit(c.db, c.request, 'register', 8, c.env);
  const b = c.body;
  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || '');
  const displayName = String(b.display_name || '').trim();
  const role = String(b.role || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) fail('INVALID_EMAIL', '邮箱格式不合法');
  if (sec.disposableEmail(email)) fail('DISPOSABLE_EMAIL', '不接受一次性邮箱域名注册');
  if (password.length < 10 || password.length > 128) fail('INVALID_PASSWORD', '密码长度须为 10–128 位');
  if (c.env.ENFORCE_STRONG_PASSWORD === 'true') {
    const pv = sec.validatePassword(password);
    if (!pv.valid) fail('WEAK_PASSWORD', `口令强度不足：${pv.reasons.join('、')}`, 422);
  }
  if (!displayName || displayName.length > 64) fail('INVALID_NAME', '显示名须为 1–64 字符');
  if (!['publisher', 'solver'].includes(role)) fail('INVALID_ROLE', '注册仅开放 publisher / solver；admin 须经引导端点创建');
  if (await c.db.first('SELECT user_id FROM users WHERE email = ?', [email])) {
    fail('EMAIL_TAKEN', '该邮箱已注册', 409);
  }
  const userId = uuid('U');
  const salt = randomHex(16);
  const passwordHash = await hashPassword(password, salt, c.env);
  const grant = Math.max(0, Number(c.env?.INITIAL_SBC ?? INITIAL_SBC_DEFAULT));
  const evt = uuid('EVT');
  const gpc = sec.gpcRequested(c.request);
  const locale = ['zh-CN', 'en'].includes(String(b.locale || '')) ? String(b.locale) : 'en';
  const statements = [{
    sql: `INSERT INTO users (user_id, email, password_hash, salt, role, display_name,
      available_sbc, credit_score, personalized_enabled, stats_json, banned, created_at,
      email_verified, locale, gpc_enabled)
      VALUES (?, ?, ?, ?, ?, ?, 0, 100, ?, '{}', 0, ?, 0, ?, ?)`,
    // available_sbc 由下方 postLegs 的 user:* 腿统一记账写入，避免重复计入初始额度
    // GPC / DNT 信号在注册时即生效：个性化默认关闭，服务端强制中性排序
    params: [userId, email, passwordHash, salt, role, displayName, gpc ? 0 : 1, iso(), locale, gpc ? 1 : 0],
  }];
  // 初始额度由生态激励池支出，两腿守恒；不视为法币充值、不可兑付
  await postLegs(c.db, {
    eventId: evt, taskId: null, memo: 'grant:新账号平台内贡献积分初始额度(生态激励池)',
    legs: [
      { account: 'subject:eco_incentive', delta: -round2(grant) },
      { account: `user:${userId}`, delta: +round2(grant) },
    ], statements,
  });
  statements.push(await appendEvent(c.db, {
    type: 'CreditChanged', eventId: evt, actor: 'ledger',
    payload: { amount: round2(grant), subjects_changed: ['eco_incentive', 'available'] },
  }));
  await c.db.batch(statements);
  const sess = await createSession(c.db, userId);
  // 验证令牌只经通知队列送达，绝不通过 HTTP 响应下发（本地回归可显式开启 dev echo）
  const ver = await sec.issueEmailVerification(c.db, userId);
  await notify.enqueue(c.db, {
    userId, kind: 'EMAIL_VERIFICATION', title: '验证邮箱 / Verify your email',
    body: `Verification token: ${ver.token} (expires ${ver.expiresAt}). 请在操作台输入完成验证。`,
  });
  await c.db.batch([await appendEvent(c.db, {
    type: 'NotificationQueued', actor: 'auth',
    payload: { action: 'verification_issued', kind: 'EMAIL_VERIFICATION', channel: notify.notifyMeta(c.env).channel },
  })]);
  return {
    status: 201,
    headers: { 'Set-Cookie': sessionCookie(sess.token, c.env) },
    data: {
      user: userView(await loadUser(c.db, userId)), session: sess.session,
      verification_required: c.env.EMAIL_VERIFICATION_REQUIRED === 'true',
      ...(c.env.EMAIL_VERIFICATION_DEV_ECHO === 'true' ? { dev_token: ver.token } : {}),
    },
  };
}

async function hLogin(c) {
  await rateLimit(c.db, c.request, 'login', 10, c.env);
  const email = String(c.body.email || '').trim().toLowerCase();
  const password = String(c.body.password || '');
  const row = await c.db.first('SELECT * FROM users WHERE email = ? AND deleted_at IS NULL AND banned = 0', [email]);
  // 统一错误码，避免账号枚举
  if (!row) fail('INVALID_CREDENTIALS', '邮箱或密码错误', 401);
  if (await risk.isLocked(row)) fail('ACCOUNT_LOCKED', '连续登录失败，账号临时锁定 15 分钟', 423);
  const hash = await hashPassword(password, row.salt, c.env);
  if (hash !== row.password_hash) {
    await risk.assessLogin(c.db, { userId: row.user_id, success: false });
    fail('INVALID_CREDENTIALS', '邮箱或密码错误', 401);
  }
  await risk.assessLogin(c.db, { userId: row.user_id, success: true });
  const sess = await createSession(c.db, row.user_id);
  return {
    headers: { 'Set-Cookie': sessionCookie(sess.token, c.env) },
    data: {
      user: userView(row), session: sess.session,
      verification_required: c.env.EMAIL_VERIFICATION_REQUIRED === 'true' && Number(row.email_verified) !== 1,
    },
  };
}

async function hLogout(c) {
  assertCsrf(c.request, c.session);
  await destroySession(c.db, c.request);
  return { headers: { 'Set-Cookie': clearSessionCookie(c.env) }, data: { ok: true } };
}

async function hMe(c) {
  const u = requireUser(c.session);
  const consents = await c.db.all(
    'SELECT kind, version, granted, created_at FROM consents WHERE user_id = ? ORDER BY id DESC LIMIT 20', [u.user_id],
  );
  return {
    data: {
      user: userView(u),
      csrf_token: c.session.csrf,
      preferences: { personalized_enabled: Number(u.personalized_enabled) === 1, locale: u.locale || 'en' },
      verification_required: c.env.EMAIL_VERIFICATION_REQUIRED === 'true' && Number(u.email_verified) !== 1,
      consents: consents.map((r) => ({ kind: r.kind, version: r.version, granted: Number(r.granted) === 1, created_at: r.created_at })),
    },
  };
}

async function hAdminBootstrap(c) {
  const token = String(c.body.bootstrap_token || '');
  const expected = c.env && c.env.ADMIN_BOOTSTRAP_TOKEN;
  if (!expected) fail('ADMIN_BOOTSTRAP_DISABLED', '未配置 ADMIN_BOOTSTRAP_TOKEN，管理员引导端点不可用', 503);
  if (!token || sha256Hex(token) !== sha256Hex(String(expected))) {
    fail('INVALID_BOOTSTRAP_TOKEN', '引导令牌无效', 403);
  }
  if (await c.db.first("SELECT user_id FROM users WHERE role = 'admin'")) {
    fail('ADMIN_EXISTS', '管理员账号已存在，禁止重复引导', 409);
  }
  const email = String(c.body.email || '').trim().toLowerCase();
  const password = String(c.body.password || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('INVALID_EMAIL', '邮箱格式不合法');
  if (password.length < 12) fail('INVALID_PASSWORD', '管理员密码长度须 ≥ 12 位');
  const salt = randomHex(16);
  const userId = uuid('U');
  await c.db.run(
    `INSERT INTO users (user_id, email, password_hash, salt, role, display_name,
      available_sbc, credit_score, personalized_enabled, stats_json, banned, created_at)
     VALUES (?, ?, ?, ?, 'admin', ?, 0, 100, 1, '{}', 0, ?)`,
    [userId, email, await hashPassword(password, salt, c.env), salt,
      String(c.body.display_name || '平台管理员').slice(0, 64), iso()],
  );
  await audit(c.db, userId, 'ADMIN_BOOTSTRAP', userId, { action: 'create_first_admin' });
  return { status: 201, data: { user_id: userId, email, role: 'admin', note: '首名管理员已创建，登录请使用 /api/auth/login' } };
}

async function hConsents(c) {
  const kind = String(c.body.kind || '').slice(0, 32);
  const version = String(c.body.version || 'v1').slice(0, 32);
  const granted = c.body.granted === true;
  if (!['cookie', 'privacy', 'tos', 'aup', 'analytics'].includes(kind)) fail('INVALID_KIND', '未知的同意类型');
  // 匿名同意允许（Cookie 条在登录前出现）；已登录时仍校验 CSRF，防止被跨站冒记
  if (c.session) assertCsrf(c.request, c.session);
  await c.db.run(
    'INSERT INTO consents (user_id, kind, version, granted, created_at) VALUES (?, ?, ?, ?, ?)',
    [c.session ? c.session.user.user_id : null, kind, version, granted ? 1 : 0, iso()],
  );
  return { status: 201, data: { kind, version, granted, anonymous: !c.session } };
}

async function hCreateTask(c) {
  const u = requireRole(c.session, ['publisher', 'admin']);
  assertCsrf(c.request, c.session);
  return withIdempotency(c.db, c.body, async () => {
    const b = c.body;
    for (const k of ['title', 'description', 'category', 'bounty', 'acceptance_criteria']) {
      if (b[k] === undefined || b[k] === null || b[k] === '') fail('MISSING_FIELD', `缺少必填字段：${k}`);
    }
    const check = compliancePrecheck(b.title, b.description, b.acceptance_criteria);
    if (!check.pass) {
      await c.db.batch([await appendEvent(c.db, {
        type: 'RiskBlocked', actor: 'risk', payload: { reason_code: 'BANNED_WORDS', hits: check.hits },
      })]);
      fail('COMPLIANCE_BLOCKED', `合规预检未通过：命中违禁词 ${check.hits.join('、')}`, 422);
    }
    const bounty = round2(Number(b.bounty));
    if (!Number.isFinite(bounty) || bounty <= 0 || bounty > 1000000) fail('INVALID_BOUNTY', '赏金须为 0–1000000 之间的正数');
    const freeze = computeFreeze(bounty);
    const publisher = await loadUser(c.db, u.user_id);
    if (Number(publisher.available_sbc) < freeze.total) {
      fail('INSUFFICIENT_BALANCE', `可用 SBC 不足：需冻结 ${freeze.total}，当前 ${publisher.available_sbc}`);
    }
    const deadlineHours = Math.min(720, Math.max(1, Number(b.deadline_hours ?? 48)));
    const now = new Date();
    const taskId = uuid('T');
    const row = {
      task_id: taskId, state: 'PENDING_REVIEW', publisher_id: u.user_id,
      title: String(b.title).slice(0, 200), description: String(b.description).slice(0, 5000),
      category: String(b.category).slice(0, 64), bounty, service_fee: freeze.service_fee,
      acceptance_criteria: String(b.acceptance_criteria).slice(0, 3000),
      virtual_contact: sanitizeContact(b.contact).contact,
      online: b.online === false ? 0 : 1,
      radius_km: Math.max(0, Number(b.radius_km ?? 10)),
      deadline_hours: deadlineHours,
      deadline: new Date(now.getTime() + deadlineHours * 3600 * 1000).toISOString(),
      created_at: now.toISOString(),
    };
    // V3：可配置真实模型抽取；未配置 / 超时 / 异常一律降级为 domain 规则结果，
    // 且模型输出只作为附加提示写入 meta，绝不改变状态机、权重与冻结口径。
    const llmRes = await llm.extractStructure(c.env, { title: row.title, description: row.description });
    const structure = extractTaskStructure({
      title: row.title, description: row.description, acceptance_criteria: row.acceptance_criteria,
      category: row.category, online: Number(row.online) === 1, deadline_hours: deadlineHours,
      difficulty: Number(b.difficulty ?? 0.3),
    });
    const meta = {
      required_skills: Array.isArray(b.required_skills) ? b.required_skills.slice(0, 20).map(String) : [],
      difficulty: Number(b.difficulty ?? 0.3),
      structure, compliance: check,
      llm: { degraded: llmRes.degraded, model_decision: null, hint: llmRes.degraded ? null : llmRes.structure },
    };
    const statements = [{
      sql: `INSERT INTO tasks (task_id, state, publisher_id, title, description, category,
        bounty, service_fee, acceptance_criteria, virtual_contact, online, radius_km,
        deadline_hours, deadline, created_at, meta_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [taskId, 'PENDING_REVIEW', u.user_id, row.title, row.description, row.category,
        bounty, freeze.service_fee, row.acceptance_criteria, row.virtual_contact,
        row.online, row.radius_km, deadlineHours, row.deadline, row.created_at, JSON.stringify(meta)],
    }];
    statements.push(await appendEvent(c.db, {
      type: 'TaskPublished', taskId, eventId: b.event_id || null,
      payload: {
        task_id: taskId, state: 'PENDING_REVIEW', category: row.category, bounty,
        virtual_number_placeholder: true, compliance_pass: true,
        llm_adapter_version: LLM_ADAPTER_VERSION, algorithm_degraded: llmRes.degraded,
      },
    }));
    await c.db.batch(statements);
    return {
      status: 201,
      data: { task: taskView(await loadTask(c.db, taskId)), compliance: check, rule_version: RULE_VERSION },
    };
  });
}

async function hListTasks(c) {
  requireUser(c.session);
  const terminal = ['REJECTED', 'CANCELLED', 'EXPIRED', 'CLOSED', 'DISCARDED', 'SETTLED'];
  const rows = c.query.include_terminal === 'true'
    ? await c.db.all('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 200')
    : await c.db.all(
      `SELECT * FROM tasks WHERE state NOT IN (${terminal.map(() => '?').join(',')}) ORDER BY created_at DESC LIMIT 200`, terminal,
    );
  return { data: { count: rows.length, tasks: rows.map(taskView), include_terminal: c.query.include_terminal === 'true' } };
}

async function hReview(c) {
  const u = requireRole(c.session, ['admin']);
  assertCsrf(c.request, c.session);
  return withIdempotency(c.db, c.body, async () => {
    const row = await loadTask(c.db, c.params[0]);
    const decision = c.body.decision === 'reject' ? 'reject' : 'approve';
    const target = decision === 'reject' ? 'REJECTED' : 'PUBLISHED';
    if (!canTransition(row.state, target)) fail('ILLEGAL_TRANSITION', `非法状态迁移：${row.state} → ${target}`);
    const statements = [];
    if (decision === 'reject') {
      statements.push({ sql: 'UPDATE tasks SET state = ?, version = version + 1 WHERE task_id = ?', params: ['REJECTED', row.task_id] });
    } else {
      const freeze = computeFreeze(Number(row.bounty));
      const pub = await loadUser(c.db, row.publisher_id);
      if (Number(pub.available_sbc) < freeze.total) fail('INSUFFICIENT_BALANCE', `发布方可用 SBC 不足：需 ${freeze.total}`);
      await postLegs(c.db, {
        eventId: c.body.event_id || uuid('EVT'), taskId: row.task_id,
        memo: 'freeze:审核通过冻结赏金+5%服务费',
        legs: [
          { account: `user:${row.publisher_id}`, delta: -freeze.total },
          { account: 'subject:frozen', delta: +freeze.total },
        ], statements,
      });
      statements.push({
        sql: 'UPDATE tasks SET state = ?, frozen_total = ?, version = version + 1 WHERE task_id = ?',
        params: ['PUBLISHED', freeze.total, row.task_id],
      });
    }
    statements.push(await appendEvent(c.db, {
      type: decision === 'reject' ? 'TaskUpdated' : 'CreditFrozen',
      taskId: row.task_id, eventId: c.body.event_id || null,
      actor: decision === 'reject' ? 'task-system' : 'ledger',
      payload: decision === 'reject'
        ? { task_id: row.task_id, state: 'REJECTED', decision }
        : { task_id: row.task_id, amount: computeFreeze(Number(row.bounty)).total, rule_version: RULE_VERSION },
    }));
    statements.push(await appendEvent(c.db, {
      type: 'TaskUpdated', taskId: row.task_id, eventId: c.body.event_id || null,
      payload: { task_id: row.task_id, state: target, decision },
    }));
    statements.push({
      sql: 'INSERT INTO audit_log (actor_id, action, target_id, detail_json, created_at) VALUES (?, ?, ?, ?, ?)',
      params: [u.user_id, 'TASK_REVIEW_MANUAL', row.task_id, JSON.stringify(safePayload({ decision, state: target })), iso()],
    });
    await c.db.batch(statements);
    return { data: { task: taskView(await loadTask(c.db, row.task_id)), decision, rule_version: RULE_VERSION } };
  });
}

async function hDispatch(c) {
  requireRole(c.session, ['admin']);
  assertCsrf(c.request, c.session);
  const row = await loadTask(c.db, c.params[0]);
  const ctx = {
    supply_ratio: Number(c.body.supply_ratio ?? 1.4),
    top_k: Math.max(1, Math.min(50, Number(c.body.top_k ?? 12))),
    batch_size: Math.max(1, Math.min(50, Number(c.body.batch_size ?? 8))),
    expand: c.body.expand !== false,
    expand_to: Math.max(1, Number(c.body.expand_to ?? 30)),
    channel: c.body.channel || 'platform_inbox',
  };
  const solvers = (await c.db.all("SELECT * FROM users WHERE role = 'solver' AND banned = 0 AND deleted_at IS NULL LIMIT 200"))
    .map(solverProfile);
  // 账号级开关：任一候选关闭个性化 → 整体中性排序（服务端强制，忽略客户端传参）
  const personalized = solvers.length > 0 && solvers.every((s) => s.personalized_enabled);
  const result = personalized
    ? scoreCandidates(taskForScoring(row), solvers, ctx)
    : neutralCandidates(taskForScoring(row), solvers, ctx);
  const dryRun = c.body.dry_run === true;
  const payload = {
    dry_run: dryRun, task_id: row.task_id, state_unchanged: row.state,
    weight_version: WEIGHT_VERSION, algorithm_degraded: true,
    llm_adapter_version: LLM_ADAPTER_VERSION,
    personalized, personalization_enforcement: 'server_side',
    ...result,
    note: personalized
      ? '规则版打分（LLM 降级为规则兜底，推送不中断）'
      : '已关闭个性化推荐（账号级生效）：按时间 + 距离中性排序，服务端强制',
  };
  if (dryRun) return { data: payload };
  return withIdempotency(c.db, c.body, async () => {
    if (!canTransition(row.state, 'DISPATCHING')) fail('ILLEGAL_TRANSITION', `非法状态迁移：${row.state} → DISPATCHING`);
    const dispatchId = uuid('D');
    const topSolver = result.candidates.length
      ? (await c.db.all('SELECT * FROM users WHERE user_id = ?', [result.candidates[0].solver_id]))[0]
      : null;
    const llmHint = topSolver ? semanticMatchHint(taskForScoring(row), solverProfile(topSolver)) : null;
    const statements = [
      {
        sql: "UPDATE tasks SET state = 'DISPATCHING', version = version + 1 WHERE task_id = ?",
        params: [row.task_id],
      },
      {
        sql: `INSERT INTO dispatches (dispatch_id, task_id, mode, weight_version, candidate_count, payload_json, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        params: [dispatchId, row.task_id, result.mode, WEIGHT_VERSION, result.candidates.length,
          JSON.stringify({ candidates: result.candidates, filtered_out: result.filtered_out, batches: result.batches }), iso()],
      },
      await appendEvent(c.db, {
        type: 'DispatchRequested', taskId: row.task_id, eventId: c.body.event_id || null,
        payload: { task_id: row.task_id, dispatch_id: dispatchId, top_k: ctx.top_k, batch_size: ctx.batch_size, expand: ctx.expand },
      }),
      await appendEvent(c.db, {
        type: 'DispatchScored', taskId: row.task_id, eventId: c.body.event_id || null, actor: 'algorithm',
        payload: {
          task_id: row.task_id, dispatch_id: dispatchId, weight_version: WEIGHT_VERSION,
          mode: result.mode, candidate_count: result.candidates.length,
          algorithm_degraded: llm.llmMeta(c.env).degraded, llm_adapter_version: LLM_ADAPTER_VERSION,
        },
      }),
      await appendEvent(c.db, {
        type: 'DispatchSent', taskId: row.task_id, eventId: c.body.event_id || null, actor: 'message',
        payload: {
          task_id: row.task_id, dispatch_id: dispatchId,
          candidate_ids: result.candidates.map((x) => x.solver_id),
          candidate_count: result.candidates.length, channel: ctx.channel,
        },
      }),
      {
        sql: 'INSERT INTO audit_log (actor_id, action, target_id, detail_json, created_at) VALUES (?, ?, ?, ?, ?)',
        params: [c.session.user.user_id, 'DISPATCH_CONFIRMED', row.task_id,
          JSON.stringify(safePayload({ dispatch_id: dispatchId, mode: result.mode, candidate_count: result.candidates.length })), iso()],
      },
    ];
    await c.db.batch(statements);
    return {
      data: { ...payload, dispatch_id: dispatchId, state: 'DISPATCHING', llm_hint: llmHint, dry_run: false },
    };
  });
}

async function hAccept(c) {
  const u = requireRole(c.session, ['solver']);
  assertCsrf(c.request, c.session);
  return withIdempotency(c.db, c.body, async () => {
    const row = await loadTask(c.db, c.params[0]);
    if (!canTransition(row.state, 'ACCEPTED')) fail('ILLEGAL_TRANSITION', `非法状态迁移：${row.state} → ACCEPTED`);
    if (row.solver_id && row.solver_id !== u.user_id) fail('TASK_ALREADY_ACCEPTED', '任务已被其他接单人锁定', 409);
    const solver = await loadUser(c.db, u.user_id);
    const filtered = hardFilter(taskForScoring(row), solverProfile(solver));
    if (filtered) fail('SOLVER_FILTERED', `接单人被硬过滤拦截：${filtered}`, 422);
    const total = round2(Number(row.frozen_total));
    if (!total) fail('ILLEGAL_TRANSITION', '任务赏金尚未冻结，无法接单');
    // 并发抢单保险：先用 version 做原子占位，挡住同一任务的第二个接单请求。
    // 仅靠事后 state 检查会让败者的账本腿 / 事件仍被写入，留下孤立托管流水。
    const claim = await c.db.run(
      "UPDATE tasks SET version = version + 1 WHERE task_id = ? AND state = 'DISPATCHING' AND version = ?",
      [row.task_id, Number(row.version)],
    );
    if (Number(claim.changes) !== 1) fail('CONCURRENT_CONFLICT', '并发抢单冲突，请刷新后重试', 409);
    const statements = [];
    await postLegs(c.db, {
      eventId: c.body.event_id || uuid('EVT'), taskId: row.task_id,
      memo: 'escrow:接单全额转托管(裁定前不转付)',
      legs: [{ account: 'subject:frozen', delta: -total }, { account: 'subject:escrow', delta: +total }],
      statements,
    });
    let stats = {};
    try { stats = JSON.parse(solver.stats_json || '{}'); } catch { stats = {}; }
    stats.active_tasks = Number(stats.active_tasks ?? 0) + 1;
    statements.push({
      sql: 'UPDATE users SET stats_json = ? WHERE user_id = ?',
      params: [JSON.stringify(stats), u.user_id],
    });
    statements.push({
      sql: "UPDATE tasks SET state = 'ACCEPTED', solver_id = ?, escrowed = 1, version = version + 1 WHERE task_id = ? AND state = 'DISPATCHING'",
      params: [u.user_id, row.task_id],
    });
    statements.push(await appendEvent(c.db, {
      type: 'TaskAccepted', taskId: row.task_id, eventId: c.body.event_id || null,
      payload: { task_id: row.task_id, escrow_total: total, note: '全额托管，裁定前不转付' },
    }));
    statements.push(await appendEvent(c.db, {
      type: 'CreditChanged', taskId: row.task_id, eventId: c.body.event_id || null, actor: 'ledger',
      payload: { task_id: row.task_id, subjects_changed: ['frozen', 'escrow'], amount: total },
    }));
    await c.db.batch(statements);
    const after = await loadTask(c.db, row.task_id);
    if (after.state !== 'ACCEPTED') fail('TASK_ALREADY_ACCEPTED', '任务已被其他接单人锁定', 409);
    return { data: { task: taskView(after), escrow_total: total } };
  });
}

async function hSubmit(c) {
  const u = requireUser(c.session);
  assertCsrf(c.request, c.session);
  return withIdempotency(c.db, c.body, async () => {
    const row = await loadTask(c.db, c.params[0]);
    if (row.solver_id !== u.user_id) fail('NOT_ASSIGNED_SOLVER', '仅指派的接单人可提交成果', 403);
    if (!['ACCEPTED', 'IN_PROGRESS', 'SUBMITTED'].includes(row.state)) {
      fail('ILLEGAL_TRANSITION', `当前状态 ${row.state} 不允许提交成果`);
    }
    const safe = sanitizeSubmissionText(String(c.body.content ?? '').slice(0, 20000));
    const statements = [{
      sql: "UPDATE tasks SET state = 'SUBMITTED', result_text = ?, result_pii_redacted = ?, submit_count = submit_count + 1, version = version + 1 WHERE task_id = ?",
      params: [safe.text, safe.pii_redacted ? 1 : 0, row.task_id],
    }];
    statements.push(await appendEvent(c.db, {
      type: 'TaskSubmitted', taskId: row.task_id, eventId: c.body.event_id || null,
      payload: {
        task_id: row.task_id, state: 'SUBMITTED', submit_count: Number(row.submit_count) + 1,
        pii_redacted: safe.pii_redacted, redacted_count: safe.redacted_count,
      },
    }));
    await c.db.batch(statements);
    return { data: { task: taskView(await loadTask(c.db, row.task_id)), note: '成果正文已 PII 脱敏后落库，原始明文不存储' } };
  });
}

async function hVerify(c) {
  const u = requireUser(c.session);
  assertCsrf(c.request, c.session);
  return withIdempotency(c.db, c.body, async () => {
    const row = await loadTask(c.db, c.params[0]);
    const decision = String(c.body.decision || 'approve');
    if (row.state !== 'SUBMITTED') fail('ILLEGAL_TRANSITION', `验收仅允许 SUBMITTED 状态，当前 ${row.state}（争议须经人工裁定）`);
    // 人工闸门：验收由发布方本人确认；超时自动验收只能由管理员手动触发
    if (decision === 'auto_accept') requireRole(c.session, ['admin']);
    else if (row.publisher_id !== u.user_id) fail('FORBIDDEN', '仅任务发布方可验收成果', 403);

    if (decision === 'reject') {
      if (Number(row.reject_count) >= MAX_REJECT) fail('REJECT_LIMIT', `驳回次数已达上限 ${MAX_REJECT} 次`);
      const statements = [{
        sql: "UPDATE tasks SET state = 'IN_PROGRESS', reject_count = reject_count + 1, version = version + 1 WHERE task_id = ?",
        params: [row.task_id],
      }];
      statements.push(await appendEvent(c.db, {
        type: 'TaskVerified', taskId: row.task_id, eventId: c.body.event_id || null,
        payload: { task_id: row.task_id, decision: 'reject', reject_count: Number(row.reject_count) + 1 },
      }));
      await c.db.batch(statements);
      return { data: { task: taskView(await loadTask(c.db, row.task_id)), decision } };
    }
    if (!['approve', 'auto_accept'].includes(decision)) fail('INVALID_DECISION', 'decision 仅支持 approve / reject / auto_accept');
    if (!canTransition(row.state, 'SETTLED')) fail('ILLEGAL_TRANSITION', '非法状态迁移');
    const settlement = await settleTask(c.db, row, {
      rating: Math.min(5, Math.max(0, Number(c.body.rating ?? 0))),
      auto: decision === 'auto_accept',
      eventId: c.body.event_id || null,
      trigger: decision === 'auto_accept' ? 'auto_verify' : 'verify',
      actorId: u.user_id,
    });
    // TaskVerified 事件单独追加（结算已在 settleTask 的 batch 中落库）
    await c.db.batch([await appendEvent(c.db, {
      type: 'TaskVerified', taskId: row.task_id, eventId: c.body.event_id || null,
      payload: {
        task_id: row.task_id, decision, state: 'SETTLED',
        auto_verify_hours: AUTO_VERIFY_HOURS, rating: Number(c.body.rating ?? 0),
      },
    })]);
    return { data: { task: taskView(await loadTask(c.db, row.task_id)), settlement } };
  });
}

async function hDispute(c) {
  const u = requireUser(c.session);
  assertCsrf(c.request, c.session);
  return withIdempotency(c.db, c.body, async () => {
    const row = await loadTask(c.db, c.params[0]);
    const action = String(c.body.action || 'open');
    const isParty = row.publisher_id === u.user_id || row.solver_id === u.user_id;
    if (!isParty && u.role !== 'admin') fail('FORBIDDEN', '仅任务相关方可发起争议', 403);
    if (action === 'open') {
      if (!canTransition(row.state, 'DISPUTED')) fail('ILLEGAL_TRANSITION', `非法状态迁移：${row.state} → DISPUTED`);
      const summary = summarizeDispute({
        task_id: row.task_id, submit_count: Number(row.submit_count), reject_count: Number(row.reject_count),
      });
      const meta = parseMeta(row);
      meta.dispute_reason = String(c.body.reason || '').slice(0, 500);
      const statements = [{
        sql: "UPDATE tasks SET state = 'DISPUTED', meta_json = ?, version = version + 1 WHERE task_id = ?",
        params: [JSON.stringify(meta), row.task_id],
      }];
      statements.push(await appendEvent(c.db, {
        type: 'DisputeOpened', taskId: row.task_id, eventId: c.body.event_id || null,
        payload: {
          task_id: row.task_id, escrow_total: Number(row.frozen_total),
          close_hours: DISPUTE_CLOSE_HOURS, model_decision: summary.decision,
          note: '全额托管，裁定前不转付',
        },
      }));
      await c.db.batch(statements);
      return {
        data: {
          task: taskView(await loadTask(c.db, row.task_id)),
          escrow_total: Number(row.frozen_total), transferred: false,
          arbitration: '人工裁定（模型 decision=null，仅提供材料摘要）',
          model_decision: null, llm_summary: summary,
        },
      };
    }
    if (action === 'resolve') {
      requireRole(c.session, ['admin']);
      if (row.state !== 'DISPUTED') fail('ILLEGAL_TRANSITION', '仅 DISPUTED 状态可裁定');
      const resolution = String(c.body.resolution || 'refund_publisher');
      if (!['refund_publisher', 'pay_solver', 'close'].includes(resolution)) fail('INVALID_RESOLUTION', '裁定结果不合法');
      const total = round2(Number(row.frozen_total));
      const statements = [];
      if (resolution === 'pay_solver') {
        // 付接单人：走与验收通过相同的结算编排（人工裁定后才分账）
        await settleTask(c.db, row, {
          rating: 0, eventId: c.body.event_id || null,
          trigger: 'dispute_resolution', actorId: u.user_id,
        });
      } else {
        await postLegs(c.db, {
          eventId: c.body.event_id || uuid('EVT'), taskId: row.task_id,
          memo: 'refund:争议裁定全额退回发布方（含 5% 服务费）',
          legs: [
            { account: 'subject:escrow', delta: -total },
            { account: `user:${row.publisher_id}`, delta: +total },
          ], statements,
        });
        statements.push({
          sql: 'UPDATE tasks SET state = ?, version = version + 1 WHERE task_id = ?',
          params: [resolution === 'close' ? 'CLOSED' : 'CANCELLED', row.task_id],
        });
        statements.push(await appendEvent(c.db, {
          type: 'CreditChanged', taskId: row.task_id, eventId: c.body.event_id || null, actor: 'ledger',
          payload: { task_id: row.task_id, subjects_changed: ['escrow', 'available'] },
        }));
      }
      statements.push(await appendEvent(c.db, {
        type: 'DisputeResolved', taskId: row.task_id, eventId: c.body.event_id || null,
        payload: { task_id: row.task_id, resolution, state: resolution === 'pay_solver' ? 'SETTLED' : 'CANCELLED', arbitrator: '人工裁定', model_decision: null },
      }));
      statements.push({
        sql: 'INSERT INTO audit_log (actor_id, action, target_id, detail_json, created_at) VALUES (?, ?, ?, ?, ?)',
        params: [u.user_id, 'DISPUTE_RESOLVED_MANUAL', row.task_id,
          JSON.stringify(safePayload({ resolution, decision: 'resolve' })), iso()],
      });
      await c.db.batch(statements);
      const disputeLlm = await llm.disputeSummary(c.env, {
        materials: [String(c.body.reason || ''), String(row.dispute_reason || '')].join(' ').slice(0, 800),
      });
      return {
        data: {
          task: taskView(await loadTask(c.db, row.task_id)), resolution,
          arbitrator: '人工裁定', model_decision: null,
          llm_summary: disputeLlm.summary, llm_degraded: disputeLlm.degraded,
          note: '裁定完成后才按结果分账；模型全程不直判，摘要仅供人工参考',
        },
      };
    }
    fail('INVALID_ACTION', 'action 仅支持 open / resolve');
  });
}

async function hLeaderboardTasks(c) {
  requireUser(c.session);
  const rows = await c.db.all('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 200');
  const personalized = Number(c.session.user.personalized_enabled) === 1;
  if (!personalized) {
    const items = rows
      .filter((r) => !['CANCELLED', 'EXPIRED', 'CLOSED', 'REJECTED', 'DISCARDED'].includes(r.state))
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || Number(a.radius_km) - Number(b.radius_km))
      .map((r, i) => ({
        rank: i + 1, task_id: r.task_id, title: r.title, state: r.state,
        bounty: Number(r.bounty), rank_score: null,
        reason_codes: ['NEUTRAL_TIME', 'NEUTRAL_DISTANCE'],
      }));
    return { data: { mode: 'neutral', rank_weight_version: 'neutral', personalized: false, items } };
  }
  const board = rankTasks(rows.map(taskForScoring), { personalized: true, category_median_bounty: 100 });
  return { data: board };
}

async function hLeaderboardUsers(c) {
  requireUser(c.session);
  const rows = await c.db.all("SELECT * FROM users WHERE role = 'solver' AND deleted_at IS NULL LIMIT 200");
  const stats = rows.map((r) => {
    let s = {};
    try { s = JSON.parse(r.stats_json || '{}'); } catch { s = {}; }
    return {
      user_id: r.user_id, name: r.display_name,
      net_sbc: Number(s.net_sbc ?? 0), completed_count: Number(s.completed_count ?? 0),
      rating_sum: Number(s.rating_sum ?? 0), rating_count: Number(s.rating_count ?? 0),
      total_count: Number(s.total_count ?? 0), on_time_count: Number(s.on_time_count ?? 0),
    };
  });
  return { data: rankUsers(stats, {}) };
}

async function hLedger(c) {
  const u = requireUser(c.session);
  const userId = c.params[0];
  if (userId !== u.user_id && u.role !== 'admin') fail('FORBIDDEN', '仅可查询本人账本', 403);
  await loadUser(c.db, userId);
  return { data: await ledgerSnapshot(c.db, userId) };
}

async function hEvents(c) {
  requireUser(c.session);
  const taskId = c.query.task_id || null;
  const rows = taskId
    ? await c.db.all('SELECT * FROM events WHERE task_id = ? ORDER BY seq ASC LIMIT 500', [taskId])
    : await c.db.all('SELECT * FROM events ORDER BY seq DESC LIMIT 200');
  return {
    data: {
      count: rows.length,
      events: rows.map((r) => ({
        seq: r.seq, event_id: r.event_id, task_id: r.task_id, type: r.type,
        actor: r.actor, payload: JSON.parse(r.payload_json || '{}'), created_at: r.created_at,
      })),
      registered_event_types: PROD_EVENTS,
    },
  };
}

async function hAdminQueue(c) {
  requireRole(c.session, ['admin']);
  const pending = await c.db.all("SELECT * FROM tasks WHERE state = 'PENDING_REVIEW' ORDER BY created_at ASC LIMIT 100");
  const disputed = await c.db.all("SELECT * FROM tasks WHERE state = 'DISPUTED' ORDER BY created_at ASC LIMIT 100");
  const reports = await c.db.all("SELECT * FROM reports WHERE status = 'OPEN' ORDER BY created_at ASC LIMIT 100");
  return {
    data: {
      pending_review: pending.map(taskView), disputed: disputed.map(taskView),
      open_reports: reports.map((r) => ({ report_id: r.report_id, task_id: r.task_id, reason: r.reason, created_at: r.created_at })),
      note: '审核 / 裁定 / 举报处置均为人工闸门，模型不直判',
    },
  };
}

async function hPreferences(c) {
  const u = requireUser(c.session);
  assertCsrf(c.request, c.session);
  return withIdempotency(c.db, c.body, async () => {
    if (typeof c.body.enabled !== 'boolean') fail('INVALID_FIELD', 'enabled 必须为 boolean');
    const statements = [{
      sql: 'UPDATE users SET personalized_enabled = ? WHERE user_id = ?',
      params: [c.body.enabled ? 1 : 0, u.user_id],
    }];
    statements.push(await appendEvent(c.db, {
      type: 'PreferenceChanged', eventId: c.body.event_id || null, actor: 'compliance',
      payload: {
        personalized_enabled: c.body.enabled, enforcement: 'server_side',
        neutral_sort_rule: c.body.enabled ? null : 'time + distance',
      },
    }));
    await c.db.batch(statements);
    return {
      data: {
        personalized_enabled: c.body.enabled, enforcement: 'server_side',
        account_level: true, user_id: u.user_id,
        neutral_sort_rule: c.body.enabled ? null : 'time + distance',
      },
    };
  });
}

async function hReports(c) {
  const u = requireUser(c.session);
  assertCsrf(c.request, c.session);
  return withIdempotency(c.db, c.body, async () => {
    const reason = String(c.body.reason || '').trim().slice(0, 500);
    if (!reason) fail('MISSING_FIELD', '请填写举报理由');
    const reportId = uuid('R');
    const statements = [{
      sql: 'INSERT INTO reports (report_id, task_id, reporter_id, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      params: [reportId, c.body.task_id ? String(c.body.task_id).slice(0, 128) : null, u.user_id, reason, 'OPEN', iso()],
    }];
    statements.push(await appendEvent(c.db, {
      type: 'ReportFiled', taskId: c.body.task_id || null, eventId: c.body.event_id || null, actor: 'compliance',
      payload: { reason_code: 'USER_REPORT', note: '举报进入人工复核队列' },
    }));
    await c.db.batch(statements);
    return { status: 201, data: { report_id: reportId, status: 'OPEN', note: '举报已进入人工复核队列' } };
  });
}

async function hExport(c) {
  const u = requireUser(c.session);
  const tasks = await c.db.all('SELECT * FROM tasks WHERE publisher_id = ? OR solver_id = ? LIMIT 500', [u.user_id, u.user_id]);
  const ledger = await ledgerSnapshot(c.db, u.user_id);
  const consents = await c.db.all('SELECT kind, version, granted, created_at FROM consents WHERE user_id = ?', [u.user_id]);
  const reports = await c.db.all('SELECT report_id, task_id, reason, status, created_at FROM reports WHERE reporter_id = ?', [u.user_id]);
  return {
    data: {
      exported_at: iso(),
      notice: 'GDPR Art.15 / Art.20 数据可携权导出；不含其他用户的个人数据',
      profile: userView(u),
      tasks: tasks.map(taskView),
      ledger: { entries: ledger.entries, balance_check: ledger.balance_check, anchor: ledger.anchor },
      consents: consents.map((r) => ({ kind: r.kind, version: r.version, granted: Number(r.granted) === 1, created_at: r.created_at })),
      reports,
    },
  };
}

async function hDeleteMe(c) {
  const u = requireUser(c.session);
  assertCsrf(c.request, c.session);
  const active = await c.db.first(
    `SELECT COUNT(*) AS n FROM tasks WHERE (publisher_id = ? OR solver_id = ?)
     AND state IN ('PENDING_REVIEW','PUBLISHED','DISPATCHING','ACCEPTED','IN_PROGRESS','SUBMITTED','DISPUTED')`,
    [u.user_id, u.user_id],
  );
  if (Number(active?.n ?? 0) > 0) {
    fail('ACTIVE_TASKS_EXIST', '存在进行中任务（含托管赏金），请先完成或裁定后再申请擦除', 409);
  }
  const anonEmail = `deleted-${sha256Hex(u.user_id).slice(0, 20)}@invalid.local`;
  const statements = [
    {
      sql: `UPDATE users SET email = ?, display_name = '已注销用户', password_hash = '', salt = '',
            banned = 1, deleted_at = ?, stats_json = '{}' WHERE user_id = ?`,
      params: [anonEmail, iso(), u.user_id],
    },
    { sql: 'DELETE FROM sessions WHERE user_id = ?', params: [u.user_id] },
    { sql: 'UPDATE consents SET user_id = NULL WHERE user_id = ?', params: [u.user_id] },
    { sql: 'UPDATE reports SET reporter_id = NULL WHERE reporter_id = ?', params: [u.user_id] },
    {
      sql: 'INSERT INTO audit_log (actor_id, action, target_id, detail_json, created_at) VALUES (?, ?, ?, ?, ?)',
      params: [u.user_id, 'ACCOUNT_ERASED', u.user_id, JSON.stringify({ action: 'gdpr_erasure', note: 'email anonymized' }), iso()],
    },
  ];
  await c.db.batch(statements);
  return { headers: { 'Set-Cookie': clearSessionCookie(c.env) }, data: { deleted: true, note: '账号已匿名化，账本与任务留痕按合规义务保留' } };
}

// ---------------------------------------------------------------------------
// V3 完全体端点（D-14）
// 邮箱验证 / 通知中心 / 客户端埋点回执 / 任务撤回 / 管理员运维与灾备 / 定时任务
//
// 共同红线：
//   1. 所有处置类动作（风控、锚定、备份、cron 触发）都有明确鉴权与人工确认留痕；
//   2. 定时任务只生成「待人工确认」工单，绝不自动结算或自动裁定；
//   3. 模型输出恒 model_decision:null，不进入推送名单 / 结算 / 裁定；
//   4. 备份导出含个人数据，必须显式声明加密保存义务并写 audit_log。
// ---------------------------------------------------------------------------

/** 写操作成功后的统一副作用：通知入队 + 发布风控评估。放在编排层，避免逐个 handler 侵入。 */
async function postWriteEffects(db, env, { pathname, method, data, actorId }) {
  if (method === 'GET' || method === 'DELETE' || !data || typeof data !== 'object') return;
  const task = data.task && typeof data.task === 'object' ? data.task : null;
  const action = (pathname.match(/\/(review|dispatch|accept|submit|verify|dispute|cancel|feedback)$/) || [])[1];
  if (task) {
    if (/^\/api\/tasks$/.test(pathname) && method === 'POST') {
      await risk.assessNewTask(db, {
        userId: task.publisher_id, bounty: Number(task.bounty || 0),
        category: task.category, title: task.title, description: task.description,
      });
    }
    if (action === 'feedback') return; // 埋点回执不产生对方通知
    const label = {
      review: '任务审核结果 / Review result', dispatch: '任务已进入推送 / Task dispatched',
      accept: '任务已被接单 / Task accepted', submit: '成果已提交 / Result submitted',
      verify: '验收结果 / Verification result', dispute: '争议状态更新 / Dispute update',
      cancel: '任务已撤回 / Task withdrawn',
    }[action] || '任务状态更新 / Task update';
    const recipients = new Set();
    if (task.publisher_id && task.publisher_id !== actorId) recipients.add(task.publisher_id);
    if (task.solver_id && task.solver_id !== actorId) recipients.add(task.solver_id);
    for (const uid of recipients) {
      await notify.enqueue(db, {
        userId: uid, kind: 'TASK_UPDATE', title: label,
        body: `Task ${task.task_id} is now ${task.state}. 请在操作台查看详情。`,
        taskId: task.task_id,
      });
    }
  }
}

async function hVerifyEmail(c) {
  await rateLimit(c.db, c.request, 'verify_email', 20, c.env);
  const token = String(c.body.token || '').trim();
  if (!token) fail('MISSING_TOKEN', '缺少验证令牌');
  const r = await sec.verifyEmailToken(c.db, token);
  if (!r.ok) fail('VERIFICATION_FAILED', `验证失败：${r.reason}`, 400);
  await notify.enqueue(c.db, {
    userId: r.userId, kind: 'EMAIL_VERIFIED',
    title: '邮箱已验证 / Email verified', body: 'Your email address has been verified.',
  });
  await c.db.batch([await appendEvent(c.db, {
    type: 'EmailVerified', actor: 'auth', payload: { action: 'verified' },
  })]);
  return { data: { verified: true, user_id: r.userId } };
}

async function hResendVerification(c) {
  const u = requireUser(c.session);
  assertCsrf(c.request, c.session);
  await rateLimit(c.db, c.request, 'resend_verification', 5, c.env);
  if (Number(u.email_verified) === 1) return { data: { already_verified: true } };
  const ver = await sec.issueEmailVerification(c.db, u.user_id);
  await notify.enqueue(c.db, {
    userId: u.user_id, kind: 'EMAIL_VERIFICATION', title: '验证邮箱 / Verify your email',
    body: `Verification token: ${ver.token} (expires ${ver.expiresAt}). 请在操作台输入完成验证。`,
  });
  await c.db.batch([await appendEvent(c.db, {
    type: 'NotificationQueued', actor: 'auth',
    payload: { action: 'verification_resent', kind: 'EMAIL_VERIFICATION', channel: notify.notifyMeta(c.env).channel },
  })]);
  return {
    data: {
      queued: true, verification_required: true, channel: notify.notifyMeta(c.env).channel,
      // 仅本地回归显式开启时回显令牌；生产绝不通过 HTTP 响应下发验证凭据
      ...(c.env.EMAIL_VERIFICATION_DEV_ECHO === 'true' ? { dev_token: ver.token } : {}),
    },
  };
}

async function hNotifications(c) {
  const u = requireUser(c.session);
  const limit = Math.min(200, Math.max(1, Number(c.query.limit || 50)));
  return { data: await notify.listForUser(c.db, u.user_id, { limit, unreadOnly: c.query.unread === 'true' }) };
}

async function hNotificationsRead(c) {
  const u = requireUser(c.session);
  assertCsrf(c.request, c.session);
  const ids = Array.isArray(c.body.ids) ? c.body.ids.map(String).slice(0, 200) : [];
  return { data: await notify.markRead(c.db, u.user_id, { ids, all: c.body.all === true }) };
}

async function hLocale(c) {
  const u = requireUser(c.session);
  assertCsrf(c.request, c.session);
  const locale = ['zh-CN', 'en'].includes(String(c.body.locale)) ? String(c.body.locale) : null;
  if (!locale) fail('INVALID_LOCALE', '仅支持 zh-CN / en');
  await c.db.run('UPDATE users SET locale = ? WHERE user_id = ?', [locale, u.user_id]);
  return { data: { locale, enforcement: 'server_side' } };
}

/** 任务撤回（D-09 P1）：PENDING_REVIEW→REJECTED，PUBLISHED/DISPATCHING→CANCELLED */
async function hCancel(c) {
  const u = requireUser(c.session);
  assertCsrf(c.request, c.session);
  return withIdempotency(c.db, c.body, async () => {
    const row = await loadTask(c.db, c.params[0]);
    if (row.publisher_id !== u.user_id && u.role !== 'admin') fail('FORBIDDEN', '仅发布方或管理员可撤回任务', 403);
    const target = row.state === 'PENDING_REVIEW' ? 'REJECTED' : 'CANCELLED';
    if (!['PENDING_REVIEW', 'PUBLISHED', 'DISPATCHING'].includes(row.state) || !canTransition(row.state, target)) {
      fail('ILLEGAL_TRANSITION', `当前状态 ${row.state} 不允许撤回`);
    }
    const reason = String(c.body.reason || 'publisher_withdrawn').slice(0, 200);
    const evt = c.body.event_id || uuid('EVT');
    const statements = [];
    const frozen = round2(Number(row.frozen_total || 0));
    let settlement = null;
    if (frozen > 0) {
      if (Number(row.escrowed) === 1 && row.solver_id) {
        // 已接单撤回：契约 computeCancelSettlement，90% 退发布方 + 10% 补偿接单人
        settlement = computeCancelSettlement(frozen);
        await postLegs(c.db, {
          eventId: evt, taskId: row.task_id, memo: 'cancel:已托管撤回，按契约退款与补偿',
          legs: [
            { account: 'subject:escrow', delta: -frozen },
            { account: `user:${row.publisher_id}`, delta: +settlement.refund },
            { account: `user:${row.solver_id}`, delta: +settlement.compensation },
          ], statements,
        });
      } else {
        // 未托管撤回：冻结全额原路退回（含 5% 服务费，D-04）
        await postLegs(c.db, {
          eventId: evt, taskId: row.task_id, memo: 'cancel:未托管撤回，冻结全额退回（含服务费）',
          legs: [
            { account: 'subject:frozen', delta: -frozen },
            { account: `user:${row.publisher_id}`, delta: +frozen },
          ], statements,
        });
      }
    }
    statements.push({
      sql: 'UPDATE tasks SET state = ?, version = version + 1 WHERE task_id = ? AND version = ?',
      params: [target, row.task_id, Number(row.version)],
    });
    statements.push(await appendEvent(c.db, {
      type: 'TaskCancelled', taskId: row.task_id, eventId: c.body.event_id || null, actor: u.user_id,
      payload: { task_id: row.task_id, state: target, cancel_reason: reason, amount: frozen, rule_version: RULE_VERSION },
    }));
    statements.push({
      sql: 'INSERT INTO audit_log (actor_id, action, target_id, detail_json, created_at) VALUES (?, ?, ?, ?, ?)',
      params: [u.user_id, 'TASK_CANCEL_MANUAL', row.task_id,
        JSON.stringify(safePayload({ decision: 'cancel', cancel_reason: reason, amount: frozen })), iso()],
    });
    await c.db.batch(statements);
    return { data: { task: taskView(await loadTask(c.db, row.task_id)), settlement, rule_version: RULE_VERSION } };
  });
}

/** 客户端曝光 / 忽略回执（D-07 P1）：只记录，不改变推送名单与排序 */
async function hFeedback(c) {
  const u = requireRole(c.session, ['solver']);
  assertCsrf(c.request, c.session);
  return withIdempotency(c.db, c.body, async () => {
    const row = await loadTask(c.db, c.params[0]);
    const kind = c.body.kind === 'IGNORED' ? 'IGNORED' : 'EXPOSED';
    if (!['PUBLISHED', 'DISPATCHING'].includes(row.state)) {
      fail('ILLEGAL_TRANSITION', `当前状态 ${row.state} 不接受曝光回执`);
    }
    const statements = [
      {
        sql: 'INSERT INTO dispatch_feedback (task_id, solver_id, kind, created_at) VALUES (?, ?, ?, ?)',
        params: [row.task_id, u.user_id, kind, iso()],
      },
      await appendEvent(c.db, {
        type: kind === 'IGNORED' ? 'DispatchIgnored' : 'DispatchExposed',
        taskId: row.task_id, eventId: c.body.event_id || null, actor: u.user_id,
        payload: { task_id: row.task_id, action: kind, note: 'client_feedback_only' },
      }),
    ];
    await c.db.batch(statements);
    return {
      status: 201,
      data: { task_id: row.task_id, kind, recorded: true, note: '埋点回执仅用于疲劳度统计，不改变推送名单' },
    };
  });
}

const adminOnly = (c) => requireRole(c.session, ['admin']);

async function hAdminMetrics(c) {
  adminOnly(c);
  const windowMinutes = Math.min(1440, Math.max(1, Number(c.query.window_minutes || 60)));
  return { data: await obs.metricsSummary(c.db, { windowMinutes }) };
}

async function hAdminAudit(c) {
  adminOnly(c);
  const limit = Math.min(500, Math.max(1, Number(c.query.limit || 50)));
  const rows = await c.db.all(
    'SELECT seq, actor_id, action, target_id, detail_json, created_at FROM audit_log ORDER BY seq DESC LIMIT ?', [limit],
  );
  return {
    data: {
      count: rows.length,
      items: rows.map((r) => {
        let detail = {};
        try { detail = JSON.parse(r.detail_json || '{}'); } catch { detail = {}; }
        const { detail_json: _raw, ...rest } = r;
        return { ...rest, detail };
      }),
    },
  };
}

async function hAdminRisk(c) {
  adminOnly(c);
  const status = String(c.query.status || 'OPEN').toUpperCase().slice(0, 24);
  const limit = Math.min(500, Math.max(1, Number(c.query.limit || 100)));
  return { data: { status, items: await risk.listFlags(c.db, { status, limit }) } };
}

async function hAdminRiskResolve(c) {
  const u = adminOnly(c);
  assertCsrf(c.request, c.session);
  return withIdempotency(c.db, c.body, async () => {
    const decision = String(c.body.decision || '');
    if (!['dismiss', 'escalate'].includes(decision)) fail('INVALID_DECISION', '仅支持 dismiss / escalate');
    const r = await risk.resolveFlag(c.db, {
      flagId: String(c.body.flag_id || ''), actorId: u.user_id, decision,
      reason: String(c.body.reason || '').slice(0, 200),
    });
    if (!r.updated) fail('FLAG_NOT_FOUND', '风控标记不存在或已处置', 404);
    return { data: { flag_id: c.body.flag_id, decision, resolved_by: u.user_id, note: '人工确认处置，模型不参与' } };
  });
}

/** 平台级审计导出（灾备）：含个人数据，须加密保存；不做在线 restore，避免破坏账本哈希链 */
async function hAdminBackup(c) {
  const u = adminOnly(c);
  const tables = [
    'users', 'sessions', 'tasks', 'ledger_entries', 'events', 'idempotency',
    'dispatches', 'consents', 'reports', 'audit_log', 'rate_limits', 'meta',
    'notifications', 'email_verifications', 'dispatch_feedback', 'metrics',
    'risk_flags', 'backups',
  ];
  const payload = {
    generated_at: iso(), scope: 'platform_export', schema_version: SCHEMA_VERSION,
    notice: 'GDPR 运维导出：含账号邮箱、口令派生值、会话摘要与任务正文，须加密保存、限定留存、不得外传；账本哈希链为本地摘要，未接公链。',
    tables: {},
  };
  let rowCount = 0;
  for (const t of tables) {
    const rows = await c.db.all(`SELECT * FROM ${t} ORDER BY rowid DESC LIMIT 5000`);
    payload.tables[t] = rows;
    rowCount += rows.length;
  }
  const digest = sha256Hex(JSON.stringify(payload));
  const backupId = uuid('BK');
  await c.db.run(
    'INSERT INTO backups (backup_id, actor_id, scope, row_count, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [backupId, u.user_id, 'platform_export', rowCount, digest, iso()],
  );
  await c.db.batch([
    await appendEvent(c.db, {
      type: 'BackupCreated', actor: u.user_id,
      payload: { action: 'platform_export', entry_count: rowCount, scope: 'platform_export' },
    }),
    {
      sql: 'INSERT INTO audit_log (actor_id, action, target_id, detail_json, created_at) VALUES (?, ?, ?, ?, ?)',
      params: [u.user_id, 'BACKUP_EXPORTED_MANUAL', backupId,
        JSON.stringify(safePayload({ action: 'platform_export', entry_count: rowCount })), iso()],
    },
  ]);
  return { data: { ...payload, backup_id: backupId, sha256: digest, row_count: rowCount } };
}

/** 人工触发账本 Merkle 锚定：本地哈希摘要，零 PII、零任务正文、未接公链 */
async function hAdminAnchor(c) {
  const u = adminOnly(c);
  assertCsrf(c.request, c.session);
  const integ = await obs.ledgerIntegrity(c.db);
  const at = iso();
  const anchor = {
    root: integ.merkle_root, entry_count: integ.entry_count, at,
    actor: u.user_id, pii_on_chain: false, note: 'local_hash_digest_only',
  };
  await c.db.run(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ['ledger_anchor', JSON.stringify(anchor)],
  );
  await c.db.batch([
    await appendEvent(c.db, {
      type: 'LedgerAnchored', actor: u.user_id,
      payload: { action: 'manual_anchor', entry_count: integ.entry_count, pii_redacted: true },
    }),
    {
      sql: 'INSERT INTO audit_log (actor_id, action, target_id, detail_json, created_at) VALUES (?, ?, ?, ?, ?)',
      params: [u.user_id, 'LEDGER_ANCHOR_MANUAL', null,
        JSON.stringify(safePayload({ entry_count: integ.entry_count, action: 'manual_anchor' })), at],
    },
  ]);
  return {
    data: {
      merkle_root: integ.merkle_root, entry_count: integ.entry_count, anchored_at: at,
      balanced: integ.balanced, hash_chain_valid: integ.hash_chain_valid,
      pii_on_chain: false, note: '本地哈希摘要，未接任何公链',
    },
  };
}

/** 定时任务入口：外部调度器带 X-Cron-Secret 调用；超时项只生成人工确认工单 */
async function hAdminCron(c) {
  const expected = c.env && c.env.CRON_SECRET;
  if (!expected) fail('CRON_DISABLED', '未配置 CRON_SECRET，定时任务端点不可用', 503);
  const given = c.request.headers.get('x-cron-secret') || String(c.body.secret || '');
  if (!given || sha256Hex(given) !== sha256Hex(String(expected))) {
    fail('INVALID_CRON_SECRET', '定时任务密钥无效', 403);
  }
  const r = await jobs.runJobs(c.db, c.env, { dryRun: c.body.dry_run === true });
  await c.db.batch([await appendEvent(c.db, {
    type: 'CronCompleted', actor: 'system-cron',
    payload: { action: 'cron_run', scope: 'scheduled_jobs' },
  })]);
  return {
    data: {
      ...r, mode: 'http_triggered',
      note: '超时自动验收 / 争议结案只生成待人工确认工单与提醒，不自动结算或裁定',
    },
  };
}

async function hAdminOps(c) {
  adminOnly(c);
  const pending = await notify.pendingCount(c.db);
  const integ = await obs.ledgerIntegrity(c.db);
  const versionRow = await c.db.first('SELECT value FROM meta WHERE key = ?', ['schema_version']);
  const anchorRow = await c.db.first('SELECT value FROM meta WHERE key = ?', ['ledger_anchor']);
  let anchor = null;
  if (anchorRow) { try { anchor = JSON.parse(anchorRow.value); } catch { anchor = null; } }
  return {
    data: {
      service: SERVICE, version: VERSION, schema_version: versionRow?.value || SCHEMA_VERSION,
      components: {
        db: { status: 'configured', binding: 'DB', schema_version: versionRow?.value || SCHEMA_VERSION },
        llm: llm.llmMeta(c.env),
        notify: { ...notify.notifyMeta(c.env), pending },
        cron: jobs.jobMeta(c.env),
        security: sec.securityMeta(c.env),
      },
      jobs: {
        auto_verify_hours: AUTO_VERIFY_HOURS, dispute_close_hours: DISPUTE_CLOSE_HOURS,
        mode: 'http_triggered', note: '由外部调度器定时调用 /api/admin/cron',
      },
      notifications_pending: pending,
      ledger_integrity: integ,
      anchor,
      readiness: {
        code_capabilities_complete: true,
        note: '代码能力已完备；正式运营许可仍须外部动作核销，见 docs/13 与 tests/readiness-check.mjs',
      },
    },
  };
}

// ---------------------------------------------------------------------------
// 路由表（未登记路径一律 404：SBC 转让 / 交易 / 兑付等红线接口从未实现）
// ---------------------------------------------------------------------------

const PUBLIC_ROUTES = new Set(['GET /api/health', 'GET /api/config', 'POST /api/auth/register',
  'POST /api/auth/login', 'POST /api/admin/bootstrap', 'POST /api/consents',
  // 邮箱验证凭令牌；cron 凭 CRON_SECRET（两者在 handler 内独立鉴权）
  'POST /api/auth/verify-email', 'POST /api/admin/cron']);

const ROUTES = [
  ['GET', /^\/api\/health$/, (c) => ({ data: healthData(c.env, c.db) })],
  ['GET', /^\/api\/config$/, (c) => ({ data: configData(c.env, c.db, c.session) })],
  ['POST', /^\/api\/auth\/register$/, hRegister],
  ['POST', /^\/api\/auth\/login$/, hLogin],
  ['POST', /^\/api\/auth\/logout$/, hLogout],
  ['GET', /^\/api\/auth\/me$/, hMe],
  ['POST', /^\/api\/admin\/bootstrap$/, hAdminBootstrap],
  ['POST', /^\/api\/consents$/, hConsents],
  ['POST', /^\/api\/tasks$/, hCreateTask],
  ['GET', /^\/api\/tasks$/, hListTasks],
  ['GET', /^\/api\/leaderboard\/tasks$/, hLeaderboardTasks],
  ['GET', /^\/api\/leaderboard\/users$/, hLeaderboardUsers],
  ['POST', /^\/api\/tasks\/([^/]+)\/review$/, hReview],
  ['POST', /^\/api\/tasks\/([^/]+)\/dispatch$/, hDispatch],
  ['POST', /^\/api\/tasks\/([^/]+)\/accept$/, hAccept],
  ['POST', /^\/api\/tasks\/([^/]+)\/submit$/, hSubmit],
  ['POST', /^\/api\/tasks\/([^/]+)\/verify$/, hVerify],
  ['POST', /^\/api\/tasks\/([^/]+)\/dispute$/, hDispute],
  ['GET', /^\/api\/ledger\/([^/]+)$/, hLedger],
  ['GET', /^\/api\/events$/, hEvents],
  ['GET', /^\/api\/admin\/queue$/, hAdminQueue],
  ['POST', /^\/api\/preferences\/personalized$/, hPreferences],
  ['POST', /^\/api\/reports$/, hReports],
  ['GET', /^\/api\/me\/export$/, hExport],
  ['DELETE', /^\/api\/me$/, hDeleteMe],
  // ---- D-14 完全体新增端点 ----
  ['POST', /^\/api\/auth\/verify-email$/, hVerifyEmail],
  ['POST', /^\/api\/auth\/resend-verification$/, hResendVerification],
  ['GET', /^\/api\/me\/notifications$/, hNotifications],
  ['POST', /^\/api\/me\/notifications\/read$/, hNotificationsRead],
  ['POST', /^\/api\/me\/locale$/, hLocale],
  ['POST', /^\/api\/tasks\/([^/]+)\/cancel$/, hCancel],
  ['POST', /^\/api\/tasks\/([^/]+)\/feedback$/, hFeedback],
  ['GET', /^\/api\/admin\/metrics$/, hAdminMetrics],
  ['GET', /^\/api\/admin\/audit$/, hAdminAudit],
  ['GET', /^\/api\/admin\/risk$/, hAdminRisk],
  ['POST', /^\/api\/admin\/risk\/resolve$/, hAdminRiskResolve],
  ['GET', /^\/api\/admin\/backup$/, hAdminBackup],
  ['POST', /^\/api\/admin\/anchor$/, hAdminAnchor],
  ['POST', /^\/api\/admin\/cron$/, hAdminCron],
  ['GET', /^\/api\/admin\/ops$/, hAdminOps],
];

async function readBody(request) {
  if (request.method === 'GET' || request.method === 'HEAD') return {};
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) fail('BODY_TOO_LARGE', '请求体超过 1 MB 上限', 413);
  if (!text.trim()) return {};
  try { return JSON.parse(text); } catch { fail('BAD_BODY', '请求体不是合法 JSON'); }
}

/** Cloudflare Pages Functions 入口；本地回归直接传入 Request 对象调用 */
export async function dispatch(request, env = {}) {
  const ctx = obs.requestContext(request);
  let db = null;
  let response;
  try {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method.toUpperCase();
    db = createDb(env);

    // 未绑定 D1：只读演示模式，站点不崩；写操作明确 503，不伪装成生产可用
    if (!db) {
      if (method === 'GET' && pathname === '/api/health') return ok(healthData(env, null));
      if (method === 'GET' && pathname === '/api/config') return ok(configData(env, null, null));
      return errorResponse(new ApiFailure(
        'PERSISTENCE_NOT_CONFIGURED',
        '后端未绑定 D1 持久化（演示模式）：请在 Cloudflare Pages 项目 Settings → Functions 绑定名为 DB 的 D1 数据库，绑定后自动切换为生产模式，无需改代码。',
        503,
      ));
    }

    await db.ensureSchema();
    await rateLimit(db, request, 'global', 180, env);

    let matched = null;
    for (const [m, re, handler] of ROUTES) {
      if (m !== method) continue;
      const hit = re.exec(pathname);
      if (!hit) continue;
      matched = { handler, params: hit.slice(1).map(decodeURIComponent) };
      break;
    }
    if (!matched) return errorResponse(new ApiFailure('NOT_FOUND', '资源或接口不存在', 404));

    const body = await readBody(request);
    const session = await getSession(db, request);
    const isPublic = PUBLIC_ROUTES.has(`${method} ${pathname}`);
    if (!isPublic && !session) return errorResponse(new ApiFailure('UNAUTHORIZED', '请先登录', 401));

    // GPC / DNT：浏览器级退出信号账号级落库，服务端强制中性排序
    if (session && sec.gpcRequested(request) && Number(session.user.personalized_enabled) === 1) {
      await db.run(
        'UPDATE users SET personalized_enabled = 0, gpc_enabled = 1 WHERE user_id = ?',
        [session.user.user_id],
      );
      session.user.personalized_enabled = 0;
    }

    const result = await matched.handler({
      db, env, request, url, body, session, params: matched.params,
      query: Object.fromEntries(url.searchParams.entries()),
    });
    response = ok(result.data ?? null, result.status || 200, result.headers || {});

    // 写操作副作用（通知入队 / 发布风控评估）：失败不影响主响应
    try {
      await postWriteEffects(db, env, {
        pathname, method, data: result.data,
        actorId: session ? session.user.user_id : null,
      });
    } catch (e) {
      obs.structuredLog(ctx, { level: 'warn', event: 'post_write_effect_failed', code: String(e && e.name) });
    }
  } catch (e) {
    response = errorResponse(e);
  }

  const durationMs = Date.now() - ctx.startedAt;
  if (db) {
    try {
      await obs.recordMetric(db, {
        scope: 'request', key: response.status >= 400 ? 'error' : 'completed',
        value: durationMs, meta: { event: ctx.path, status: response.status },
      });
    } catch { /* 指标写入失败不得影响业务响应 */ }
  }
  // 只对 5xx 输出结构化日志，避免回归 / 压测噪声；字段白名单，零 PII
  if (response.status >= 500) {
    obs.structuredLog(ctx, { level: 'error', event: 'request_failed', status: response.status, durationMs });
  }
  return response;
}
