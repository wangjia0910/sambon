/**
 * 发布方角色（续）· 三宝殿悬赏互助平台 多智能体端到端真实 HTTP 测试
 * 场景：两个 MA-pub 任务已被管理员推送、接单人提交，当前均为 SUBMITTED；
 *       本轮完成「任务A验收结算 + 任务B发起争议」及账本/导出核验。
 * 运行：node --disable-warning=ExperimentalWarning ops/multiagent-results/publisher2-run.mjs
 */
import { SimClient, eid } from '../multiagent-client.mjs';

const c = new SimClient('http://127.0.0.1:8793', 'publisher2');
const checks = [];
const notes = [];
const extra = {};

const TITLE_A = '社区海报设计';
const TITLE_B = '争议测试';

function record(name, pass, detail) {
  checks.push({ name, pass, detail });
  if (!pass) notes.push(`[FAIL] ${name} → ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
}
const ok2xx = (r, s = 200) => r?.status === s && r?.ok === true;

// ---------- 步骤 1：登录发布方 ----------
let balanceAtLogin = null;
try {
  const lr = await c.login('pub_ma@test.dev', 'PubPass123!long');
  balanceAtLogin = lr.data?.user?.available_sbc ?? null;
  const pass = ok2xx(lr) && !!c.csrf && !!c.userId;
  record('01 login publisher', pass, {
    status: lr.status, error: lr.error, userId: c.userId,
    role: lr.data?.user?.role, available_sbc: balanceAtLogin, csrf: !!c.csrf,
  });
  extra.login = { status: lr.status, error: lr.error, userId: c.userId, available_sbc: balanceAtLogin };
} catch (e) {
  record('01 login publisher', false, 'EXCEPTION: ' + String(e));
}

// ---------- 步骤 2：GET /api/tasks 找到两个 SUBMITTED 的 MA-pub 任务 ----------
let taskA = null, taskB = null;
try {
  const r = await c.get('/api/tasks?include_terminal=true');
  const ma = (r.data?.tasks || []).filter((t) => String(t.title || '').includes('MA-pub'));
  taskA = ma.find((t) => String(t.title).includes(TITLE_A)) || null;
  taskB = ma.find((t) => String(t.title).includes(TITLE_B)) || null;
  const pass = ok2xx(r) && taskA?.state === 'SUBMITTED' && taskB?.state === 'SUBMITTED';
  record('02 find A+B SUBMITTED', pass, {
    status: r.status, error: r.error,
    maPub: ma.map((t) => ({ id: t.task_id, title: t.title, state: t.state, bounty: t.bounty })),
    A: { id: taskA?.task_id ?? null, state: taskA?.state ?? null, bounty: taskA?.bounty ?? null },
    B: { id: taskB?.task_id ?? null, state: taskB?.state ?? null, bounty: taskB?.bounty ?? null },
  });
  extra.tasksFound = {
    status: r.status,
    A: taskA ? { id: taskA.task_id, title: taskA.title, state: taskA.state, bounty: taskA.bounty } : null,
    B: taskB ? { id: taskB.task_id, title: taskB.title, state: taskB.state, bounty: taskB.bounty } : null,
  };
  if (taskA?.state !== 'SUBMITTED') notes.push(`任务A 当前状态为 ${taskA?.state ?? '未找到'}，非 SUBMITTED（如实记录，不伪造）`);
  if (taskB?.state !== 'SUBMITTED') notes.push(`任务B 当前状态为 ${taskB?.state ?? '未找到'}，非 SUBMITTED（如实记录，不伪造）`);
} catch (e) {
  record('02 find A+B SUBMITTED', false, 'EXCEPTION: ' + String(e));
}

// ---------- 步骤 3：验收任务 A → SETTLED，断言结算数值 ----------
let settlement = null;
let verifyRaw = null;
if (!taskA) {
  record('03 verify A settlement', false, '未找到任务A，跳过');
} else {
  try {
    const r = await c.post(`/api/tasks/${taskA.task_id}/verify`, {
      decision: 'approve', rating: 5, event_id: eid('verifyA2'),
    });
    verifyRaw = { status: r.status, ok: r.ok, error: r.error, data: r.data };
    settlement = r.data?.settlement ?? null;
    const state = r.data?.task?.state ?? null;
    const b = settlement?.quality_bonus ?? {};
    const pass = ok2xx(r)
      && state === 'SETTLED'
      && Number(settlement?.bounty) === 200
      && Number(settlement?.service_fee) === 10
      && Number(b.amount) === 4
      && Number(settlement?.solver_credit) === 204;
    record('03 verify A settlement', pass, {
      status: r.status, error: r.error, state,
      bounty: settlement?.bounty, service_fee: settlement?.service_fee,
      quality_bonus: b, solver_credit: settlement?.solver_credit,
      expected: { state: 'SETTLED', bounty: 200, service_fee: 10, quality_bonus_amount: 4, solver_credit: 204 },
    });
    extra.verifyA = { status: r.status, error: r.error, state, settlement };
    if (!pass) notes.push(`任务A验收未达预期（status=${r.status}, state=${state}, error=${JSON.stringify(r.error)}），按真实响应记录`);
  } catch (e) {
    record('03 verify A settlement', false, 'EXCEPTION: ' + String(e));
  }
}

// ---------- 步骤 4：任务 B 发起争议 → DISPUTED，断言 transferred=false / model_decision=null ----------
let disputeRaw = null;
let disputedId = taskB?.task_id ?? null;
if (!taskB) {
  record('04 dispute B open', false, '未找到任务B，跳过');
} else {
  try {
    const r = await c.post(`/api/tasks/${taskB.task_id}/dispute`, {
      action: 'open', reason: '成果与验收标准不符', event_id: eid('disputeB2'),
    });
    disputeRaw = { status: r.status, ok: r.ok, error: r.error, data: r.data };
    const state = r.data?.task?.state ?? null;
    const pass = ok2xx(r)
      && state === 'DISPUTED'
      && r.data?.transferred === false
      && r.data?.model_decision === null;
    record('04 dispute B open', pass, {
      status: r.status, error: r.error, state,
      transferred: r.data?.transferred, model_decision: r.data?.model_decision,
      escrow_total: r.data?.escrow_total ?? null,
      expected: { state: 'DISPUTED', transferred: false, model_decision: null },
    });
    extra.disputeB = {
      status: r.status, error: r.error, state,
      transferred: r.data?.transferred, model_decision: r.data?.model_decision,
      escrow_total: r.data?.escrow_total ?? null, arbitration: r.data?.arbitration ?? null,
    };
    if (!pass) notes.push(`任务B发起争议未达预期（status=${r.status}, state=${state}, error=${JSON.stringify(r.error)}），按真实响应记录`);
  } catch (e) {
    record('04 dispute B open', false, 'EXCEPTION: ' + String(e));
  }
}

// ---------- 步骤 5：确认发布方余额变化 ----------
let balanceAfter = null;
try {
  const me = await c.get('/api/auth/me');
  balanceAfter = me.data?.user?.available_sbc ?? null;
  // 注册基线 1000；发布 A(200+10=210) 与 B(150+7.5=157.5) 时冻结共 367.5 → 632.5
  const baseline = 1000;
  const expectedAfterFreeze = 632.5;
  const changedFromBaseline = Number.isFinite(Number(balanceAfter)) && Number(balanceAfter) !== baseline;
  const changedInSession = Number.isFinite(Number(balanceAfter)) && Number(balanceAfter) !== Number(balanceAtLogin);
  const pass = ok2xx(me) && changedFromBaseline && Number(balanceAfter) === expectedAfterFreeze;
  record('05 auth/me balance', pass, {
    status: me.status, error: me.error,
    baseline, balanceAtLogin, balanceAfter,
    changedFromBaseline, changedInSession, expectedAfterFreeze,
  });
  extra.me = {
    status: me.status, baseline, balanceAtLogin, balanceAfter,
    changedFromBaseline, changedInSession,
  };
  if (!changedInSession) {
    notes.push(`本次会话内 available_sbc 未变化（登录时 ${balanceAtLogin} → 操作后 ${balanceAfter}）：验收结算是 escrow→接单人、争议是全额继续冻结，均不动发布方可用余额；相对注册基线 1000 已因发布冻结 367.5 变为 ${balanceAfter}`);
  }
} catch (e) {
  record('05 auth/me balance', false, 'EXCEPTION: ' + String(e));
}

// ---------- 步骤 6：GDPR 导出 ----------
let exportRaw = null;
try {
  const ex = await c.get('/api/me/export');
  exportRaw = { status: ex.status, ok: ex.ok, error: ex.error, data: ex.data };
  const pass = ok2xx(ex) && Array.isArray(ex.data?.tasks) && !!ex.data?.profile && !!ex.data?.ledger;
  record('06 GET /api/me/export', pass, {
    status: ex.status, error: ex.error,
    tasks: ex.data?.tasks?.length, consents: ex.data?.consents?.length,
    profile: !!ex.data?.profile, ledger: !!ex.data?.ledger,
    notice: ex.data?.notice,
  });
  extra.export = {
    status: ex.status, tasks: ex.data?.tasks?.length ?? null,
    consents: ex.data?.consents?.length ?? null,
    profile: !!ex.data?.profile, ledger: !!ex.data?.ledger,
    exported_at: ex.data?.exported_at ?? null,
  };
} catch (e) {
  record('06 GET /api/me/export', false, 'EXCEPTION: ' + String(e));
}

// ---------- 步骤 7：钱包账本 balanced ----------
try {
  const r = await c.get(`/api/ledger/${c.userId}`);
  const bc = r.data?.balance_check ?? {};
  const anchor = r.data?.anchor ?? {};
  const pass = ok2xx(r) && bc.balanced === true && !!anchor.anchor_id && anchor.pii_on_chain === false;
  record('07 ledger balanced', pass, {
    status: r.status, error: r.error,
    balanced: bc.balanced, total_delta: bc.total_delta,
    anchor_id: anchor.anchor_id, pii_on_chain: anchor.pii_on_chain,
    entries: r.data?.entries?.length,
  });
  extra.ledger = {
    status: r.status, balanced: bc.balanced, total_delta: bc.total_delta,
    anchor_id: anchor.anchor_id ?? null, merkle_root: anchor.merkle_root ?? null,
    pii_on_chain: anchor.pii_on_chain, entries: r.data?.entries?.length ?? null,
  };
} catch (e) {
  record('07 ledger balanced', false, 'EXCEPTION: ' + String(e));
}

// ---------- 导出结果 ----------
notes.push(`剧本检查项 ${checks.filter((x) => x.pass).length}/${checks.length} 通过`);
await c.dumpResult('publisher2', {
  notes, checks,
  checkPass: checks.filter((x) => x.pass).length,
  checkFail: checks.filter((x) => !x.pass).length,
  taskA: taskA?.task_id ?? null,
  taskB: taskB?.task_id ?? null,
  settlement,          // 完整结算对象
  disputedId,          // 发起争议的 task_id
  verifyRaw, disputeRaw, exportRaw,
  ...extra,
});
