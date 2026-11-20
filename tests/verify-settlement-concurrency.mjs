/**
 * C-01 结算双花 · 并发回归验证（零第三方依赖）
 *
 * 专项证明：同一任务的两个并发结算请求，只有一个能真实分账。
 * 用 node:sqlite 的 D1 mock 跑真实 SQL；settlement_guards(task_id PRIMARY KEY)
 * 的 INSERT OR IGNORE 在数据库层做原子占位，changes=0 者抛 SETTLEMENT_CONFLICT。
 *
 * 场景：
 *   A. 两个并发 verify（不同 event_id）——从 SUBMITTED 同时抢结算
 *   B. 两个并发 dispute resolve pay_solver（不同 event_id）——从 DISPUTED 同时抢结算
 *   C. 守卫在 hVerify 失败释放后可合法重试（不永久锁死）
 *
 * 断言重点：不能只看 HTTP 状态，必须查账本流水条数与用户余额，
 *           证明「没有第二次 CreditTransferred / 余额没有被加两次」。
 *
 * 运行：node --disable-warning=ExperimentalWarning tests/verify-settlement-concurrency.mjs
 */

import { createD1Mock } from './d1-mock.js';
import { dispatch } from '../prod/lib/api.js';
import { SCHEMA_SQL } from '../prod/lib/schema.js';

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
const eid = (tag) => `EVT-${tag}-${Math.random().toString(36).slice(2, 12)}`;

class Client {
  constructor() { this.cookie = null; this.csrf = null; }
  async call(method, path, body, opts = {}) {
    const headers = { host: 'localhost' };
    if (this.cookie) headers.cookie = this.cookie;
    if (!['GET', 'HEAD'].includes(method) && !opts.noCsrf) headers['x-csrf-token'] = this.csrf || '';
    if (body !== undefined) headers['content-type'] = 'application/json';
    const req = new Request(`http://localhost${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const res = await dispatch(req, opts.env || this.env || {});
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = { ok: false, parseError: text.slice(0, 120) }; }
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    return { status: res.status, body: json, data: json && json.data, error: json && json.error };
  }
  async register(env, email, password, role) {
    this.env = env;
    const r = await this.call('POST', '/api/auth/register', { email, password, display_name: email.split('@')[0], role }, { env });
    this.csrf = r.data?.session?.csrf_token || null;
    return r;
  }
  async login(env, email, password) {
    const r = await this.call('POST', '/api/auth/login', { email, password }, { env });
    if (r.data?.session?.csrf_token) this.csrf = r.data.session.csrf_token;
    return r;
  }
}

async function bootstrap(env) {
  const admin = new Client();
  admin.env = env;
  await admin.call('POST', '/api/admin/bootstrap', {
    bootstrap_token: 'test-bootstrap-token', email: 'root@sambon.net',
    password: 'AdminPass123!', display_name: '管理员',
  }, { env });
  await admin.login(env, 'root@sambon.net', 'AdminPass123!');
  return admin;
}

/** 走完整闭环把任务推进到 SUBMITTED，返回 taskId 与参与者 */
async function createSubmittedTask(env, admin, pub, sol, tag) {
  const created = await pub.call('POST', '/api/tasks', {
    title: `${tag} 海报设计`, description: `${tag} 公益海报`,
    category: 'design', bounty: 200, acceptance_criteria: '提供 PNG 与源文件',
    online: true, radius_km: 0, required_skills: [], deadline_hours: 72,
    event_id: eid(`${tag}-create`),
  });
  const taskId = created.data?.task?.task_id;
  if (!taskId) throw new Error(`发布失败: ${JSON.stringify(created.error)}`);
  await admin.call('POST', `/api/tasks/${taskId}/review`, { decision: 'approve', event_id: eid(`${tag}-review`) });
  await admin.call('POST', `/api/tasks/${taskId}/dispatch`, { dry_run: false, top_k: 5, batch_size: 5, event_id: eid(`${tag}-dispatch`) });
  await sol.call('POST', `/api/tasks/${taskId}/accept`, { event_id: eid(`${tag}-accept`) });
  await sol.call('POST', `/api/tasks/${taskId}/submit`, {
    content: `演示成果（虚构）${tag}`, event_id: eid(`${tag}-submit`),
  });
  return taskId;
}

/** 统计某任务的「赏金本金」入账笔数（delta = 200）；质量奖励 delta=4 不算双花 */
function countBountyCredits(raw, taskId) {
  return raw._query(
    "SELECT COUNT(*) AS n FROM ledger_entries WHERE task_id = ? AND account LIKE 'user:%' AND delta = 200",
    [taskId],
  )[0].n;
}

function solverBalance(raw, email) {
  return raw._query('SELECT available_sbc FROM users WHERE email = ?', [email])[0].available_sbc;
}

async function main() {
  console.log('=== C-01 结算双花 · 并发回归 ===\n');

  const raw = createD1Mock();
  const env = { ...BASE_ENV, DB: raw };
  const admin = await bootstrap(env);
  const pub = new Client(); await pub.register(env, 'pub@sambon.net', 'PublisherPass123!', 'publisher');
  const sol = new Client(); await sol.register(env, 'sol@sambon.net', 'SolverPass123!', 'solver');

  // ── 场景 A：两个并发 verify（不同 event_id）────────────────────────────
  console.log('[A] 两个并发验收（SUBMITTED → 同时抢结算）');
  const taskA = await createSubmittedTask(env, admin, pub, sol, 'A');
  const beforeA = solverBalance(raw, 'sol@sambon.net');
  const [a1, a2] = await Promise.all([
    pub.call('POST', `/api/tasks/${taskA}/verify`, { decision: 'approve', rating: 5, event_id: eid('A-verify-1') }),
    pub.call('POST', `/api/tasks/${taskA}/verify`, { decision: 'approve', rating: 5, event_id: eid('A-verify-2') }),
  ]);
  const okA = [a1, a2].filter((r) => r.status === 200).length;
  const rejectedA = [a1, a2].filter((r) => r.status !== 200);
  check('CA-01 两个并发验收只有一个返回 200', okA === 1,
    `status=[${a1.status},${a2.status}] codes=[${a1.error?.code},${a2.error?.code}]`);
  check('CA-02 失败方明确报双花/状态冲突', rejectedA.every((r) =>
    r.error?.code === 'SETTLEMENT_CONFLICT' || r.error?.code === 'ILLEGAL_TRANSITION'),
    `codes=[${rejectedA.map((r) => r.error?.code)}]`);
  check('CA-03 账本只有一次接单人入账（无重复 CreditTransferred）',
    countBountyCredits(raw, taskA) === 1, `count=${countBountyCredits(raw, taskA)}`);
  check('CA-04 接单人余额只 +204（非 +408）',
    solverBalance(raw, 'sol@sambon.net') === beforeA + 204,
    `${beforeA} → ${solverBalance(raw, 'sol@sambon.net')}`);
  const guardsA = raw._query('SELECT task_id FROM settlement_guards WHERE task_id = ?', [taskA]);
  check('CA-05 settlement_guards 仅一条占位', guardsA.length === 1, `rows=${guardsA.length}`);

  // ── 场景 B：两个并发 dispute resolve pay_solver（不同 event_id）────────
  console.log('\n[B] 两个并发争议裁定 pay_solver（DISPUTED → 同时抢结算）');
  const taskB = await createSubmittedTask(env, admin, pub, sol, 'B');
  await pub.call('POST', `/api/tasks/${taskB}/dispute`, { action: 'open', reason: '演示争议（虚构）', event_id: eid('B-open') });
  const beforeB = solverBalance(raw, 'sol@sambon.net');
  const [b1, b2] = await Promise.all([
    admin.call('POST', `/api/tasks/${taskB}/dispute`, { action: 'resolve', resolution: 'pay_solver', event_id: eid('B-res-1') }),
    admin.call('POST', `/api/tasks/${taskB}/dispute`, { action: 'resolve', resolution: 'pay_solver', event_id: eid('B-res-2') }),
  ]);
  const okB = [b1, b2].filter((r) => r.status === 200).length;
  check('CB-01 两个并发裁定只有一个返回 200', okB === 1,
    `status=[${b1.status},${b2.status}] codes=[${b1.error?.code},${b2.error?.code}]`);
  check('CB-02 账本只有一次入账', countBountyCredits(raw, taskB) === 1,
    `count=${countBountyCredits(raw, taskB)}`);
  check('CB-03 接单人余额只 +200（裁定无质量奖励）',
    solverBalance(raw, 'sol@sambon.net') === beforeB + 200,
    `${beforeB} → ${solverBalance(raw, 'sol@sambon.net')}`);

  // ── 场景 C：守卫释放后可合法重试（不永久锁死）──────────────────────────
  console.log('\n[C] 模拟结算失败后守卫释放，合法重试可成功');
  const taskC = await createSubmittedTask(env, admin, pub, sol, 'C');
  // 直接注入守卫占位失败场景：先手工插一条守卫，再删掉，验证释放逻辑不锁死
  raw.exec(`INSERT INTO settlement_guards (task_id, trigger, event_id, actor_id, created_at)
            VALUES ('${taskC}', 'probe', NULL, NULL, '2026-01-01T00:00:00Z')`);
  const blocked = await pub.call('POST', `/api/tasks/${taskC}/verify`, { decision: 'approve', event_id: eid('C-blocked') });
  check('CC-01 守卫占位存在时验收被 SETTLEMENT_CONFLICT 拒绝',
    blocked.status === 409 && blocked.error?.code === 'SETTLEMENT_CONFLICT',
    `status=${blocked.status} code=${blocked.error?.code}`);
  raw.exec(`DELETE FROM settlement_guards WHERE task_id = '${taskC}' AND trigger = 'probe'`);
  const retried = await pub.call('POST', `/api/tasks/${taskC}/verify`, { decision: 'approve', rating: 4, event_id: eid('C-retry') });
  check('CC-02 释放守卫后合法重试成功结算',
    retried.status === 200 && retried.data?.task?.state === 'SETTLED',
    `status=${retried.status} state=${retried.data?.task?.state}`);

  // ── 场景 D：pay_solver 与 refund 并发（跨路径互斥）──────────────────────
  console.log('\n[D] pay_solver 与 refund_publisher 并发（跨资金终局路径互斥）');
  const taskD = await createSubmittedTask(env, admin, pub, sol, 'D');
  await pub.call('POST', `/api/tasks/${taskD}/dispute`, { action: 'open', reason: '演示争议（虚构）', event_id: eid('D-open') });
  const pubBefore = raw._query("SELECT available_sbc FROM users WHERE email = 'pub@sambon.net'")[0].available_sbc;
  const [d1, d2] = await Promise.all([
    admin.call('POST', `/api/tasks/${taskD}/dispute`, { action: 'resolve', resolution: 'pay_solver', event_id: eid('D-pay') }),
    admin.call('POST', `/api/tasks/${taskD}/dispute`, { action: 'resolve', resolution: 'refund_publisher', event_id: eid('D-refund') }),
  ]);
  const okD = [d1, d2].filter((r) => r.status === 200).length;
  check('CD-01 付接单人与退发布方并发只有一个成功', okD === 1,
    `status=[${d1.status},${d2.status}] codes=[${d1.error?.code},${d2.error?.code}]`);
  const settleLinesD = raw._query("SELECT account FROM ledger_entries WHERE task_id = ? AND memo LIKE 'settle:%'", [taskD]);
  const refundLinesD = raw._query("SELECT account FROM ledger_entries WHERE task_id = ? AND memo LIKE 'refund:%'", [taskD]);
  check('CD-02 不存在「既付接单人又退发布方」',
    !(settleLinesD.length > 0 && refundLinesD.length > 0),
    `settle=${settleLinesD.length} refund=${refundLinesD.length}`);

  // ── 收尾 ──────────────────────────────────────────────────────────────
  console.log(`\n=== 结果：PASS ${pass} / FAIL ${failCount} / 共 ${pass + failCount} 项 ===`);
  if (failCount) { console.log('失败项：\n  - ' + failures.join('\n  - ')); process.exitCode = 1; }
  else console.log('结论：C-01 结算双花已从数据库层消除（原子守卫 + 跨路径互斥 + 失败可重试）。');
}

main().catch((e) => { console.error('测试异常：', e); process.exitCode = 1; });
