/**
 * 《三宝殿》生产系统 · 独立回归验证（零第三方依赖）
 *
 * 与 tests/smoke.mjs / verify-local.mjs 不同：本脚本不复用任何原型实现，
 * 直接调用 Cloudflare Pages Functions 的 dispatch(Request, env)，
 * 用 node:sqlite 模拟 D1 执行**真实 SQL**，覆盖认证、RBAC、CSRF、幂等、
 * 账本哈希链、人工闸门、PII 脱敏、账号级个性化、GDPR 与限流。
 *
 * 运行：node --disable-warning=ExperimentalWarning tests/verify-production.mjs
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createD1Mock } from './d1-mock.js';
import { dispatch, PROD_EVENTS } from '../prod/lib/api.js';
import { SCHEMA_SQL } from '../prod/lib/schema.js';
import { sha256Hex } from '../prod/lib/hash.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const sha = (p) => createHash('sha256').update(readFileSync(resolve(ROOT, p))).digest('hex');

let pass = 0;
let failCount = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failCount += 1; failures.push(name); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

const BASE_ENV = {
  ADMIN_BOOTSTRAP_TOKEN: 'test-bootstrap-token',
  PBKDF2_ITERATIONS: '2000',
  INITIAL_SBC: '1000',
  RATE_LIMIT_DISABLED: 'true',
  COOKIE_SECURE: 'false',
};

function makeEnv(overrides = {}) {
  const raw = createD1Mock();
  return { env: { ...BASE_ENV, DB: raw, ...overrides }, raw };
}

class Client {
  constructor() { this.cookie = null; this.csrf = null; }

  async call(method, path, body, opts = {}) {
    const headers = { host: 'localhost' };
    if (this.cookie) headers.cookie = this.cookie;
    if (!['GET', 'HEAD'].includes(method) && !opts.noCsrf) {
      headers['x-csrf-token'] = this.csrf || '';
    }
    if (opts.origin) headers.origin = opts.origin;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const req = new Request(`http://localhost${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const res = await dispatch(req, opts.env || this.env || {});
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { ok: false, parseError: text.slice(0, 120) }; }
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    return {
      status: res.status, body: json, data: json && json.data,
      error: json && json.error, headers: res.headers,
    };
  }

  async login(env, email, password) {
    const r = await this.call('POST', '/api/auth/login', { email, password }, { env });
    if (r.status === 200 && r.data?.session?.csrf_token) this.csrf = r.data.session.csrf_token;
    return r;
  }
}

const eid = (tag) => `EVT-${tag}-${Math.random().toString(36).slice(2, 10)}`;

async function main() {
  console.log('=== 生产系统独立回归（Pages Functions + D1 / node:sqlite） ===\n');

  // ------------------------------------------------------------------ 0. 演示降级
  console.log('[0] 未绑定 D1：只读演示模式');
  {
    const c = new Client();
    const h = await c.call('GET', '/api/health', undefined, { env: {} });
    const cfg = await c.call('GET', '/api/config', undefined, { env: {} });
    const w = await c.call('POST', '/api/tasks', { title: 'x' }, { env: {} });
    check('P-01 health 返回 mode=demo / db=missing', h.status === 200 && h.data?.mode === 'demo' && h.data?.db === 'missing');
    check('P-02 config 在演示模式仍可读（站点不崩）', cfg.status === 200 && cfg.data?.mode === 'demo');
    check('P-03 写操作明确 503 而非伪装成功', w.status === 503 && w.error?.code === 'PERSISTENCE_NOT_CONFIGURED');
  }

  // ------------------------------------------------------------------ 1. 生产模式 / schema 自举
  console.log('\n[1] 生产模式、表结构自举与配置口径');
  const { env, raw } = makeEnv();
  const admin = new Client();
  admin.env = env;
  const pub = new Client(); pub.env = env;
  const sol = new Client(); sol.env = env;
  const other = new Client(); other.env = env;

  {
    const h = await admin.call('GET', '/api/health');
    const cfg = await admin.call('GET', '/api/config');
    const tables = raw._query("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name);
    check('P-04 health 返回 mode=production / db=d1', h.status === 200 && h.data?.mode === 'production' && h.data?.db === 'd1');
    check('P-05 首次请求自动建表（无需手工迁移）',
      ['users', 'sessions', 'tasks', 'ledger_entries', 'events', 'idempotency', 'audit_log', 'consents', 'rate_limits'].every((t) => tables.includes(t)),
      `${tables.length} 张表`);
    check('P-06 config 权重版本与降级标记与契约一致',
      cfg.data?.weight_version === 'v1.0' && cfg.data?.algorithm_degraded === true && Object.keys(cfg.data?.dispatch_weights || {}).length === 6);
    check('P-07 config 声明账号级开关与 8 条红线路径',
      cfg.data?.account_level_preference === true && cfg.data?.enforcement === 'server_side' && cfg.data?.red_lines?.length === 8);
  }

  // ------------------------------------------------------------------ 2. 管理员引导
  console.log('\n[2] 首名管理员引导（不预置任何默认口令）');
  {
    const noToken = makeEnv({ ADMIN_BOOTSTRAP_TOKEN: '' });
    const r0 = await admin.call('POST', '/api/admin/bootstrap',
      { bootstrap_token: 'x', email: 'a@b.com', password: 'AdminPass123!' }, { env: noToken.env });
    check('P-08 未配置引导令牌时端点不可用 503', r0.status === 503 && r0.error?.code === 'ADMIN_BOOTSTRAP_DISABLED');
    const bad = await admin.call('POST', '/api/admin/bootstrap',
      { bootstrap_token: 'wrong', email: 'root@sambon.net', password: 'AdminPass123!' });
    check('P-09 错误引导令牌 403', bad.status === 403 && bad.error?.code === 'INVALID_BOOTSTRAP_TOKEN');
    const good = await admin.call('POST', '/api/admin/bootstrap',
      { bootstrap_token: 'test-bootstrap-token', email: 'root@sambon.net', password: 'AdminPass123!', display_name: '平台管理员' });
    check('P-10 正确令牌创建首名 admin 201', good.status === 201 && good.data?.role === 'admin');
    const dup = await admin.call('POST', '/api/admin/bootstrap',
      { bootstrap_token: 'test-bootstrap-token', email: 'root2@sambon.net', password: 'AdminPass123!' });
    check('P-11 重复引导 409（防止后门）', dup.status === 409 && dup.error?.code === 'ADMIN_EXISTS');
    const lg = await admin.login(env, 'root@sambon.net', 'AdminPass123!');
    check('P-12 管理员可登录并取得 CSRF 令牌', lg.status === 200 && typeof lg.data?.session?.csrf_token === 'string' && lg.data.session.csrf_token.length >= 32);
  }

  // ------------------------------------------------------------------ 3. 注册 / 登录 / 会话
  console.log('\n[3] 注册、登录、会话与初始额度');
  {
    const weak = await pub.call('POST', '/api/auth/register',
      { email: 'pub@sambon.net', password: '123', display_name: '发布方', role: 'publisher' });
    check('P-13 弱口令被拒绝', weak.status === 400 && weak.error?.code === 'INVALID_PASSWORD');
    const r = await pub.call('POST', '/api/auth/register',
      { email: 'pub@sambon.net', password: 'PublisherPass123!', display_name: '发布方', role: 'publisher' });
    pub.csrf = r.data?.session?.csrf_token || null;
    check('P-14 发布方注册成功且初始额度 1000 SBC', r.status === 201 && r.data?.user?.available_sbc === 1000);
    const dup = await pub.call('POST', '/api/auth/register',
      { email: 'pub@sambon.net', password: 'PublisherPass123!', display_name: '发布方2', role: 'publisher' });
    check('P-15 重复邮箱 409（不枚举账号）', dup.status === 409);
    const sr = await sol.call('POST', '/api/auth/register',
      { email: 'sol@sambon.net', password: 'SolverPass123!', display_name: '接单人', role: 'solver' });
    sol.csrf = sr.data?.session?.csrf_token || null;
    check('P-16 接单人注册成功', sr.status === 201 && sr.data?.user?.role === 'solver');
    const badLogin = await other.login(env, 'pub@sambon.net', 'WrongPass123!');
    check('P-17 错误口令统一 401 INVALID_CREDENTIALS', badLogin.status === 401 && badLogin.error?.code === 'INVALID_CREDENTIALS');
    const me0 = await other.call('GET', '/api/auth/me');
    check('P-18 未登录访问 /api/auth/me 返回 401', me0.status === 401);
    const me = await pub.call('GET', '/api/auth/me');
    check('P-19 会话恢复 200 且带回 csrf_token', me.status === 200 && me.data?.user?.email === 'pub@sambon.net' && !!me.data?.csrf_token);
  }

  // ------------------------------------------------------------------ 4. CSRF / RBAC / 合规预检
  console.log('\n[4] CSRF、跨源、RBAC 与合规预检');
  {
    const noCsrf = await pub.call('POST', '/api/tasks',
      { title: '测试', description: '测试', category: 'general', bounty: 10, acceptance_criteria: '完成' }, { noCsrf: true });
    check('P-20 写操作缺 CSRF 头 403', noCsrf.status === 403 && noCsrf.error?.code === 'CSRF_FAILED');
    const cross = await pub.call('POST', '/api/tasks',
      { title: '测试', description: '测试', category: 'general', bounty: 10, acceptance_criteria: '完成' }, { origin: 'https://evil.example' });
    check('P-21 跨源写请求 403', cross.status === 403 && cross.error?.code === 'CROSS_ORIGIN_BLOCKED');
    const wrongRole = await sol.call('POST', '/api/tasks',
      { title: '测试', description: '测试', category: 'general', bounty: 10, acceptance_criteria: '完成' });
    check('P-22 solver 不能发布任务 403', wrongRole.status === 403);
    const banned = await pub.call('POST', '/api/tasks', {
      title: '刷单任务', description: '帮忙刷单', category: 'general', bounty: 10,
      acceptance_criteria: '完成刷单', event_id: eid('banned'),
    });
    check('P-23 违禁词一票否决 422', banned.status === 422 && banned.error?.code === 'COMPLIANCE_BLOCKED');
  }

  // ------------------------------------------------------------------ 5. 端到端闭环
  console.log('\n[5] 发布→审核→推送→接单→提交→验收→结算');
  let taskId = null;
  {
    const created = await pub.call('POST', '/api/tasks', {
      title: '社区活动海报设计', description: '为社区公益活动设计一张海报',
      category: 'design', bounty: 200, acceptance_criteria: '提供 PNG 与源文件，尺寸 1080x1920',
      online: true, radius_km: 0, required_skills: [], deadline_hours: 72,
      event_id: eid('create'),
    });
    taskId = created.data?.task?.task_id || null;
    check('P-24 发布任务 201 且状态 PENDING_REVIEW', created.status === 201 && created.data?.task?.state === 'PENDING_REVIEW' && !!taskId);
    check('P-25 联系方式为虚拟号占位', String(created.data?.task?.virtual_contact || '').startsWith('虚拟号'));

    const deny = await pub.call('POST', `/api/tasks/${taskId}/review`, { decision: 'approve', event_id: eid('deny') });
    check('P-26 非 admin 审核被拒 403（人工闸门）', deny.status === 403);
    const rev = await admin.call('POST', `/api/tasks/${taskId}/review`, { decision: 'approve', event_id: eid('review') });
    check('P-27 审核通过冻结赏金 200 + 服务费 10 = 210', rev.status === 200 && rev.data?.task?.state === 'PUBLISHED' && rev.data?.task?.frozen_total === 210);
    const pubMe = await pub.call('GET', '/api/auth/me');
    check('P-28 发布方可用余额降为 790', pubMe.data?.user?.available_sbc === 790);

    const dry = await admin.call('POST', `/api/tasks/${taskId}/dispatch`, { dry_run: true, top_k: 5, batch_size: 5 });
    check('P-29 dry_run 预览不改任务状态', dry.status === 200 && dry.data?.dry_run === true && dry.data?.state_unchanged === 'PUBLISHED');
    const solId = (await sol.call('GET', '/api/auth/me')).data?.user?.user_id;
    const disp = await admin.call('POST', `/api/tasks/${taskId}/dispatch`, { dry_run: false, top_k: 5, batch_size: 5, event_id: eid('dispatch') });
    check('P-30 真实推送进入 DISPATCHING 且候选含接单人',
      disp.status === 200 && disp.data?.state === 'DISPATCHING'
      && (disp.data?.candidates || []).some((c) => c.solver_id === solId));

    const acc = await sol.call('POST', `/api/tasks/${taskId}/accept`, { event_id: eid('accept') });
    check('P-31 接单成功且赏金全额托管 210', acc.status === 200 && acc.data?.task?.state === 'ACCEPTED' && acc.data?.escrow_total === 210);
    const acc2 = await pub.call('POST', `/api/tasks/${taskId}/accept`, { event_id: eid('accept2') });
    check('P-32 发布方不能代替接单人接单（RBAC）', acc2.status === 403);

    const content = '请联系 13812345678，证件号 110101199001011234，成果已上传。';
    const sub = await sol.call('POST', `/api/tasks/${taskId}/submit`, { content, event_id: eid('submit') });
    const preview = sub.data?.task?.result_preview || '';
    check('P-33 成果正文 PII 脱敏（无 ≥6 位连续数字）',
      sub.status === 200 && preview.includes('[已脱敏]') && !/\d{6,}/.test(preview));

    const ver = await pub.call('POST', `/api/tasks/${taskId}/verify`,
      { decision: 'approve', rating: 5, event_id: eid('verify') });
    const st = ver.data?.settlement;
    check('P-34 验收通过 → SETTLED', ver.status === 200 && ver.data?.task?.state === 'SETTLED');
    check('P-35 结算口径 200 / 10 / 4 / 204（D-01～D-04）',
      st?.bounty === 200 && st?.service_fee === 10 && st?.quality_bonus?.amount === 4 && st?.solver_credit === 204);
    const double = await pub.call('POST', `/api/tasks/${taskId}/verify`, { decision: 'approve', rating: 5 });
    check('P-36 已结算任务不可重复结算（状态机阻断）',
      double.status === 400 && double.error?.code === 'ILLEGAL_TRANSITION');

    const solMe = await sol.call('GET', '/api/auth/me');
    check('P-37 接单人余额 = 1000 + 204 = 1204', solMe.data?.user?.available_sbc === 1204);
    const led = await sol.call('GET', `/api/ledger/${solMe.data.user.user_id}`);
    check('P-38 账本五科目守恒', led.data?.balance_check?.balanced === true, `total_delta=${led.data?.balance_check?.total_delta}`);
    check('P-39 哈希链摘要零 PII / 零任务正文', led.data?.anchor?.pii_on_chain === false && led.data?.anchor?.task_body_on_chain === false && !!led.data?.anchor?.merkle_root);
  }

  // ------------------------------------------------------------------ 6. 账本哈希链 / 事件 / 人工闸门 / 幂等
  console.log('\n[6] 账本哈希链、事件白名单、人工闸门与幂等');
  {
    const rows = raw._query('SELECT * FROM ledger_entries ORDER BY seq ASC');
    let chainOk = rows.length > 0;
    let prev = 'GENESIS';
    for (const r of rows) {
      if (r.prev_hash !== prev) { chainOk = false; break; }
      const canonical = JSON.stringify({
        event_id: r.event_id, task_id: r.task_id, account: r.account,
        delta: r.delta, memo: r.memo, rule_version: r.rule_version,
        prev_hash: r.prev_hash, created_at: r.created_at,
      });
      if (sha256Hex(canonical) !== r.hash) { chainOk = false; break; }
      prev = r.hash;
    }
    check('P-40 账本逐条哈希链可重算校验', chainOk, `${rows.length} 条流水`);

    const ev = await admin.call('GET', `/api/events?task_id=${encodeURIComponent(taskId)}`);
    const types = (ev.data?.events || []).map((e) => e.type);
    check('P-41 运行期事件 ⊆ 契约 §4 + 生产扩展集合',
      types.length > 0 && types.every((t) => PROD_EVENTS.includes(t)), `${new Set(types).size} 种 / ${types.length} 条`);
    const payloadText = JSON.stringify((ev.data?.events || []).map((e) => e.payload));
    check('P-42 事件 payload 无手机号 / 证件号形态',
      !/(?<!\d)1[3-9]\d{9}(?!\d)/.test(payloadText) && !/(?<!\d)\d{17}[\dXx](?!\d)/.test(payloadText));

    const audits = raw._query('SELECT action FROM audit_log').map((r) => r.action);
    check('P-43 审核 / 推送 / 验收均留人工闸门审计',
      ['TASK_REVIEW_MANUAL', 'DISPATCH_CONFIRMED', 'SETTLEMENT_CONFIRMED'].every((a) => audits.includes(a)));

    const before = raw._query('SELECT COUNT(*) AS n FROM tasks')[0].n;
    const sameId = eid('idem');
    const body = {
      title: '幂等任务', description: '重复提交不应产生两条', category: 'general',
      bounty: 10, acceptance_criteria: '完成', event_id: sameId,
    };
    const r1 = await pub.call('POST', '/api/tasks', body);
    const r2 = await pub.call('POST', '/api/tasks', body);
    const after = raw._query('SELECT COUNT(*) AS n FROM tasks')[0].n;
    check('P-44 重复 event_id 幂等回放且不重复落库',
      r1.status === 201 && r2.status === 201 && r2.headers.get('x-idempotent') === 'replayed' && after === before + 1);
  }

  // ------------------------------------------------------------------ 7. 红线路径
  console.log('\n[7] 红线接口（未登记路径一律 404）');
  {
    const reds = ['/api/sbc/transfer', '/api/sbc/trade', '/api/sbc/redeem', '/api/sbc/withdraw',
      '/api/sbc/exchange', '/api/sbc/yield', '/api/sbc/market', '/api/wallet/cashout'];
    const codes = [];
    for (const p of reds) codes.push((await admin.call('POST', p, {})).status);
    check('P-45 8 条 SBC 转让 / 交易 / 兑付路径全部 404', codes.every((s) => s === 404), codes.join(','));
    check('P-46 任意未登记路径 404', (await admin.call('GET', '/api/not-exist')).status === 404);
  }

  // ------------------------------------------------------------------ 8. 争议与人工裁定
  console.log('\n[8] 争议全额托管与人工裁定');
  let disputeId = null;
  {
    const cr = await pub.call('POST', '/api/tasks', {
      title: '争议样例任务', description: '用于验证裁定前不转付', category: 'general',
      bounty: 100, acceptance_criteria: '提交结果', event_id: eid('dispute-create'),
    });
    disputeId = cr.data?.task?.task_id;
    await admin.call('POST', `/api/tasks/${disputeId}/review`, { decision: 'approve', event_id: eid('dispute-review') });
    await admin.call('POST', `/api/tasks/${disputeId}/dispatch`, { dry_run: false, event_id: eid('dispute-dispatch') });
    await sol.call('POST', `/api/tasks/${disputeId}/accept`, { event_id: eid('dispute-accept') });
    await sol.call('POST', `/api/tasks/${disputeId}/submit`, { content: '争议成果', event_id: eid('dispute-submit') });
    const autoTry = await pub.call('POST', `/api/tasks/${disputeId}/verify`, { decision: 'auto_accept' });
    check('P-36b 超时自动验收仅 admin 可手动触发（人工闸门）',
      autoTry.status === 403 && autoTry.error?.code === 'FORBIDDEN');
    const open = await pub.call('POST', `/api/tasks/${disputeId}/dispute`,
      { action: 'open', reason: '成果与验收标准不符', event_id: eid('dispute-open') });
    check('P-47 争议开启：全额托管、不转付、模型 decision=null',
      open.status === 200 && open.data?.transferred === false && open.data?.model_decision === null && open.data?.escrow_total === 105);
    const badResolve = await pub.call('POST', `/api/tasks/${disputeId}/dispute`,
      { action: 'resolve', resolution: 'refund_publisher' });
    check('P-48 非 admin 不能裁定 403', badResolve.status === 403);
    const resolve = await admin.call('POST', `/api/tasks/${disputeId}/dispute`,
      { action: 'resolve', resolution: 'refund_publisher', reason: '人工复核后全额退回', event_id: eid('dispute-resolve') });
    check('P-49 裁定后全额退回（含 5% 服务费）→ CANCELLED',
      resolve.status === 200 && resolve.data?.task?.state === 'CANCELLED' && resolve.data?.arbitrator === '人工裁定');
    const led = await pub.call('GET', `/api/ledger/${(await pub.call('GET', '/api/auth/me')).data.user.user_id}`);
    check('P-50 争议退款后账本仍守恒', led.data?.balance_check?.balanced === true);
    const audits = raw._query('SELECT action FROM audit_log').map((r) => r.action);
    check('P-51 争议裁定留人工审计', audits.includes('DISPUTE_RESOLVED_MANUAL'));
  }

  // ------------------------------------------------------------------ 9. 账号级个性化
  console.log('\n[9] 账号级「关闭个性化推荐」（修正 D-06 全局单例）');
  {
    const off = await sol.call('POST', '/api/preferences/personalized', { enabled: false, event_id: eid('pref-off') });
    check('P-52 关闭成功且标记账号级', off.status === 200 && off.data?.account_level === true && off.data?.personalized_enabled === false);
    const cr = await pub.call('POST', '/api/tasks', {
      title: '中性排序验证任务', description: '验证服务端强制中性排序', category: 'general',
      bounty: 10, acceptance_criteria: '完成', event_id: eid('neutral-create'),
    });
    const nid = cr.data?.task?.task_id;
    await admin.call('POST', `/api/tasks/${nid}/review`, { decision: 'approve', event_id: eid('neutral-review') });
    const d = await admin.call('POST', `/api/tasks/${nid}/dispatch`,
      { dry_run: true, top_k: 5, personalized: true, event_id: eid('neutral-dispatch') });
    check('P-53 任一候选关闭后服务端强制中性排序（忽略客户端传参）',
      d.data?.mode === 'neutral' && d.data?.personalized === false && (d.data?.candidates || []).every((c) => c.score === null));
    const pubCfg = await pub.call('GET', '/api/config');
    check('P-54 他人开关不影响发布方配置', pubCfg.data?.personalized_enabled === true);
    const on = await sol.call('POST', '/api/preferences/personalized', { enabled: true, event_id: eid('pref-on') });
    check('P-55 可重新开启（可撤回同意）', on.status === 200 && on.data?.personalized_enabled === true);
  }

  // ------------------------------------------------------------------ 10. GDPR / 举报 / 同意
  console.log('\n[10] GDPR 数据可携与擦除、举报、匿名同意');
  {
    const anon = await other.call('POST', '/api/consents', { kind: 'cookie', version: 'v1', granted: true });
    check('P-56 匿名 Cookie 同意可记录（不强制登录）', anon.status === 201 && anon.data?.anonymous === true);
    const rep = await sol.call('POST', '/api/reports', { task_id: taskId, reason: '成果描述疑似不当', event_id: eid('report') });
    check('P-57 举报进入人工复核队列', rep.status === 201 && rep.data?.status === 'OPEN');
    const q = await admin.call('GET', '/api/admin/queue');
    check('P-58 admin 队列可见未处置举报', (q.data?.open_reports || []).length >= 1);
    const ex = await sol.call('GET', '/api/me/export');
    check('P-59 数据导出含 profile / tasks / ledger / consents',
      ex.status === 200 && !!ex.data?.profile && Array.isArray(ex.data?.tasks) && Array.isArray(ex.data?.ledger?.entries));
    const blocked = await pub.call('DELETE', '/api/me', undefined, {});
    check('P-60 存在进行中任务时拒绝擦除 409（保护托管赏金）',
      blocked.status === 409 && blocked.error?.code === 'ACTIVE_TASKS_EXIST');

    const fresh = makeEnv();
    const c = new Client(); c.env = fresh.env;
    const reg = await c.call('POST', '/api/auth/register',
      { email: 'erase@sambon.net', password: 'ErasePass123!', display_name: '待擦除', role: 'solver' });
    c.csrf = reg.data?.session?.csrf_token;
    const del = await c.call('DELETE', '/api/me');
    const after = await c.call('GET', '/api/auth/me');
    check('P-61 无进行中任务可擦除并立即失效会话', del.status === 200 && del.data?.deleted === true && after.status === 401);
    const anonymized = fresh.raw._query("SELECT email, display_name, deleted_at FROM users WHERE email LIKE 'deleted-%'");
    check('P-62 擦除后邮箱匿名化、保留业务留痕', anonymized.length === 1 && anonymized[0].display_name === '已注销用户' && !!anonymized[0].deleted_at);
  }

  // ------------------------------------------------------------------ 11. 限流
  console.log('\n[11] 限流（登录 10 次 / 分钟）');
  {
    const rl = makeEnv({ RATE_LIMIT_DISABLED: '' });
    const c = new Client(); c.env = rl.env;
    const statuses = [];
    for (let i = 0; i < 12; i += 1) {
      statuses.push((await c.call('POST', '/api/auth/login', { email: 'nobody@sambon.net', password: 'WhateverPass123!' })).status);
    }
    check('P-63 超过登录速率上限返回 429', statuses.slice(0, 10).every((s) => s === 401) && statuses.slice(10).every((s) => s === 429), statuses.join(','));
  }

  // ------------------------------------------------------------------ 12. 产物与单一真源
  console.log('\n[12] 产物完整性与业务口径单一真源');
  {
    check('P-64 prod/lib/domain.js 与 src/domain.mjs 逐字节一致',
      sha('prod/lib/domain.js') === sha('src/domain.mjs'));
    check('P-65 prod/lib/hash.js 与 src/hash.mjs 逐字节一致',
      sha('prod/lib/hash.js') === sha('src/hash.mjs'));
    check('P-66 根目录 schema.sql 由 schema.js 生成且一致', read('schema.sql') === SCHEMA_SQL);
    const need = ['cloudflare/prod.html', 'cloudflare/app.js', 'cloudflare/styles.css',
      'cloudflare/legal.html', 'cloudflare/_redirects', 'cloudflare/_routes.json',
      'cloudflare/index.html', 'cloudflare/cf-runtime.mjs', 'functions/api/[[path]].js'];
    check('P-67 生产前端 + Functions 入口 + L0 产物齐备', need.every((p) => existsSync(resolve(ROOT, p))));
    check('P-68 _redirects 把主入口指向生产系统、保留 L0 演示入口',
      read('cloudflare/_redirects').includes('/prod.html') && read('cloudflare/_redirects').includes('/index.html'));
    check('P-69 L0 演示页引导层未被破坏（既有回归不受影响）',
      read('cloudflare/index.html').includes('__installSambonRuntime'));
    check('P-70 生产前端无 node: 内置依赖、无第三方 CDN',
      !/from\s+['"]node:/.test(read('prod/site/app.js')) && !/https?:\/\/cdn|unpkg|jsdelivr/i.test(read('prod/site/app.js')));
    let syntaxOk = true;
    for (const f of ['prod/lib/api.js', 'prod/lib/auth.js', 'prod/lib/db.js',
      'prod/lib/schema.js', 'prod/lib/response.js', 'functions/api/[[path]].js', 'prod/site/app.js']) {
      try { execFileSync(process.execPath, ['--check', resolve(ROOT, f)], { stdio: 'pipe' }); }
      catch { syntaxOk = false; }
    }
    check('P-71 全部生产源文件通过语法检查', syntaxOk);
    check('P-72 生产前端含 Cookie 同意 / 数据导出 / 删除账号 / AI 透明度入口',
      ['/api/consents', '/api/me/export', 'DELETE', 'ai_disclosure'].every((k) => read('prod/site/app.js').includes(k)));
    // Pages 会把 functions/ 下每个 .js/.ts 都当路由文件且要求导出 onRequest*，
    // 共享库必须放在目录外；这里强制守住该约束，避免部署构建失败。
    const walk = (dir) => readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
    const fnFiles = walk(resolve(ROOT, 'functions')).filter((p) => /\.(js|ts|mjs)$/.test(p));
    check('P-73 functions/ 下仅保留 1 个路由文件（共享库在 prod/lib/）',
      fnFiles.length === 1 && fnFiles[0].endsWith('[[path]].js') && read('functions/api/[[path]].js').includes('onRequest'),
      fnFiles.map((p) => p.replace(resolve(ROOT, 'functions'), 'functions')).join(','));
    const routes = JSON.parse(read('cloudflare/_routes.json'));
    check('P-74 _routes.json 仅把 /api/* 交给 Functions（静态资源不走 Worker）',
      routes.version === 1 && routes.include.length === 1 && routes.include[0] === '/api/*');
  }

  console.log(`\n=== 结果：PASS ${pass} / FAIL ${failCount} ===`);
  if (failCount) {
    console.log('失败项：\n  - ' + failures.join('\n  - '));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('回归脚本异常：', e);
  process.exitCode = 1;
});
