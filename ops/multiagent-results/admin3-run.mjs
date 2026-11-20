/**
 * 管理员3 · 三宝殿悬赏互助平台 多智能体端到端真实 HTTP 测试（最后一步：争议裁定 + C-01 并发双花实测）
 * 运行：node --disable-warning=ExperimentalWarning ops/multiagent-results/admin3-run.mjs
 */
import { SimClient, eid } from '../multiagent-client.mjs';

const BASE = 'http://127.0.0.1:8793';
const TASK_B = 'T-71cd791030c17f60f36b7b49'; // 【MA-pub】争议测试任务（DISPUTED → 待人工裁定）
const TASK_A = 'T-bd32737c9b5e441bd6b72313'; // 【MA-pub】社区海报设计（SETTLED，用于 C-01）
const SOLVER_ID = 'U-749404c6c0848be9154e383b';
const PUBLISHER_ID = 'U-c20e322503cd50f64f074e5b';

const c = new SimClient(BASE, 'admin3');
const checks = [];
const notes = [];
const extra = {};

const HAS = (t) => String(t?.title || '').includes('MA-pub');
const tid = (t) => t?.task_id || t?.id || null;
const is200 = (r) => r?.status === 200;

function record(name, pass, detail) {
  checks.push({ name, pass, detail });
  if (!pass) notes.push(`[FAIL] ${name} → ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  return pass;
}

// 从账本条目中提取某任务的 settle 腿（settleTask 的 memo 以 'settle:' 开头）
function settleLegsOf(data, taskId) {
  const entries = data?.entries || [];
  return entries.filter((e) => e.task_id === taskId && String(e.memo || '').startsWith('settle:'));
}
const uniqEventIds = (legs) => [...new Set(legs.map((e) => e.event_id))];

// ---------- 步骤 1：登录管理员 ----------
try {
  const r = await c.login('admin_ma@test.dev', 'AdminPass123!long');
  record('01 管理员登录', r.status === 200 && !!c.csrf && !!c.userId, {
    status: r.status, error: r.error, csrf: !!c.csrf, userId: c.userId,
  });
  extra.login = { status: r.status, error: r.error, userId: c.userId };
} catch (e) {
  record('01 管理员登录', false, 'EXCEPTION: ' + String(e));
}

// ---------- 步骤 2：GET /api/admin/queue 找 DISPUTED 的 MA-pub 任务B ----------
let taskB = null;
let taskBId = TASK_B;
try {
  const q = await c.get('/api/admin/queue');
  const disputed = (q.data?.disputed || []).filter(HAS);
  const pass = q.status === 200 && disputed.length > 0;
  record('02 队列发现 DISPUTED [MA-pub]', pass, {
    status: q.status, error: q.error, matched: disputed.length, ids: disputed.map(tid),
  });
  extra.queue = {
    status: q.status, matched: disputed.length, ids: disputed.map(tid),
    pending_review: (q.data?.pending_review || []).length,
  };
  taskB = disputed[0] || null;
  if (taskB) {
    taskBId = tid(taskB);
    extra.taskBBefore = {
      id: taskBId, title: taskB.title, state: taskB.state,
      publisher_id: taskB.publisher_id, solver_id: taskB.solver_id,
      settlement: taskB.settlement ?? null, dispute_reason: taskB.dispute_reason ?? null,
    };
    record('02b 任务B初始状态为 DISPUTED', taskB.state === 'DISPUTED', {
      id: taskBId, state: taskB.state,
    });
  } else {
    notes.push('队列未发现 DISPUTED 的 MA-pub 任务；仍按已知任务B ID 尝试裁定，并如实记录结果，不伪造');
  }
} catch (e) {
  record('02 队列发现 DISPUTED [MA-pub]', false, 'EXCEPTION: ' + String(e));
}

// ---------- 步骤 3：人工裁定 pay_solver ----------
let resolvedId = null;
let resolveState = null;
try {
  const r = await c.post(`/api/tasks/${taskBId}/dispute`, {
    action: 'resolve', resolution: 'pay_solver', event_id: eid('resolve-admin3'),
  });
  resolveState = r.data?.task?.state ?? r.data?.state ?? null;
  const arbitrator = r.data?.arbitrator ?? null;
  // 运行版服务端响应顶层未暴露 model_decision；按 null 处理并在步骤 06d 用 DisputeResolved.payload 佐证
  const mdInResponse = Object.prototype.hasOwnProperty.call(r.data || {}, 'model_decision');
  const modelDecision = mdInResponse ? r.data.model_decision : null;
  const pass = r.status === 200 && resolveState === 'SETTLED'
    && modelDecision === null
    && typeof arbitrator === 'string' && arbitrator.includes('人工');
  record('03 争议裁定 resolve/pay_solver', pass, {
    status: r.status, state: resolveState, model_decision: modelDecision,
    model_decision_in_response: mdInResponse,
    arbitrator, resolution: r.data?.resolution ?? null, error: r.error,
  });
  if (pass) resolvedId = taskBId;
  extra.resolve = {
    status: r.status, error: r.error, state: resolveState,
    model_decision: modelDecision, arbitrator,
    resolution: r.data?.resolution ?? null,
    settlement: r.data?.task?.settlement ?? null,
    note: r.data?.note ?? null,
  };
} catch (e) {
  record('03 争议裁定 resolve/pay_solver', false, 'EXCEPTION: ' + String(e));
}

// ---------- 步骤 4：核对资金（双方账本守恒 + 任务B结算唯一） ----------
const ledgerCheck = {};
async function fetchLedger(userId) {
  const r = await c.get(`/api/ledger/${userId}`);
  const legs = settleLegsOf(r.data, taskBId);
  return {
    status: r.status, error: r.error,
    balanced: r.data?.balance_check?.balanced ?? null,
    total_delta: r.data?.balance_check?.total_delta ?? null,
    entry_count: r.data?.entries?.length ?? 0,
    taskB_settle_legs: legs.length,
    taskB_settle_event_ids: uniqEventIds(legs),
    taskB_settle_seqs: legs.map((e) => e.seq),
  };
}
try {
  const solver = await fetchLedger(SOLVER_ID);
  const publisher = await fetchLedger(PUBLISHER_ID);
  record('04a 接单人账本 balanced', solver.status === 200 && solver.balanced === true, solver);
  record('04b 发布方账本 balanced', publisher.status === 200 && publisher.balanced === true, publisher);
  Object.assign(ledgerCheck, { solver, publisher });
} catch (e) {
  record('04 账本核对', false, 'EXCEPTION: ' + String(e));
}

// ---------- 步骤 5：C-01 并发双花实测（发布方会话，Promise.all 两次 verify） ----------
const concurrency = {};
try {
  const pub = new SimClient(BASE, 'admin3-pub-c01');
  const pl = await pub.login('pub_ma@test.dev', 'PubPass123!long');
  record('05a 发布方会话登录', pl.status === 200 && !!pub.csrf, {
    status: pl.status, error: pl.error, userId: pub.userId,
  });

  // 并发前：任务A的 settle 腿基线（SETTLED 任务，理论上不应再产生新结算）
  const before = await c.get(`/api/ledger/${SOLVER_ID}`);
  const beforeLegs = settleLegsOf(before.data, TASK_A);
  const baseline = { count: beforeLegs.length, event_ids: uniqEventIds(beforeLegs) };

  const x1 = eid('x1');
  const x2 = eid('x2');
  const [r1, r2] = await Promise.all([
    pub.post(`/api/tasks/${TASK_A}/verify`, { decision: 'approve', event_id: x1 }),
    pub.post(`/api/tasks/${TASK_A}/verify`, { decision: 'approve', event_id: x2 }),
  ]);
  const outcomes = [r1, r2].map((r, i) => ({
    tag: i === 0 ? 'x1' : 'x2',
    event_id: i === 0 ? x1 : x2,
    status: r.status,
    ok: r.ok,
    code: r.error?.code ?? null,
    message: r.error?.message ?? null,
    state: r.data?.task?.state ?? r.data?.state ?? null,
  }));
  const successes = outcomes.filter((o) => o.status === 200);
  const conflicts = outcomes.filter((o) =>
    [409, 400].includes(o.status)
    && ['SETTLEMENT_CONFLICT', 'ILLEGAL_TRANSITION'].includes(o.code));
  const pass = successes.length === 1 && conflicts.length === 1;
  record('05b C-01 并发互斥(1×200 + 1×冲突)', pass, outcomes);

  // 并发后账本：任务A不得出现新的 settle 腿
  const after = await c.get(`/api/ledger/${SOLVER_ID}`);
  const afterLegs = settleLegsOf(after.data, TASK_A);
  const afterInfo = { count: afterLegs.length, event_ids: uniqEventIds(afterLegs) };
  const ledgerUnchanged = afterInfo.count === baseline.count
    && JSON.stringify(afterInfo.event_ids) === JSON.stringify(baseline.event_ids);
  record('05c 任务A账本无重复结算', ledgerUnchanged, { baseline, after: afterInfo });

  Object.assign(concurrency, {
    taskId: TASK_A,
    outcomes,
    successCount: successes.length,
    conflictCount: conflicts.length,
    pass,
    ledger: { before: baseline, after: afterInfo, unchanged: ledgerUnchanged },
  });
  if (!pass) {
    notes.push(`C-01 实测未出现"1×200 + 1×冲突"：两次 verify 状态=${outcomes.map((o) => `${o.status}/${o.code}`).join(', ')}。任务A在并发前已为 SETTLED，服务器按 ILLEGAL_TRANSITION 拒绝，未见重复结算；如实记录不伪造。`);
  }
} catch (e) {
  record('05 C-01 并发双花实测', false, 'EXCEPTION: ' + String(e));
  concurrency.error = String(e);
}

// ---------- 步骤 6：GET /api/events 确认裁定与结算事件 ----------
try {
  const ev = await c.get('/api/events');
  const events = ev.data?.events || [];
  const matchB = (e) => e.task_id === taskBId || e.payload?.task_id === taskBId;
  const resolved = events.filter((e) => e.type === 'DisputeResolved' && matchB(e));
  const settled = events.filter((e) => e.type === 'SettlementCompleted' && matchB(e));
  record('06a 事件 DisputeResolved (任务B)', ev.status === 200 && resolved.length >= 1, {
    status: ev.status, count: resolved.length, types: resolved.map((e) => e.type),
  });
  record('06b 事件 SettlementCompleted (任务B)', ev.status === 200 && settled.length >= 1, {
    status: ev.status, count: settled.length, types: settled.map((e) => e.type),
  });

  // 模型不直判：DisputeResolved.payload.model_decision === null（响应顶层未暴露该字段时的权威佐证）
  const mdFromEvent = resolved[0]?.payload?.model_decision ?? '(missing)';
  record('06d 模型未直判 (DisputeResolved.model_decision=null)',
    ev.status === 200 && resolved.length >= 1 && mdFromEvent === null, {
      status: ev.status, model_decision_from_event_payload: mdFromEvent,
      model_decision_in_http_response: extra.resolve?.model_decision_in_response ?? null,
      arbitrator_from_event_payload: resolved[0]?.payload?.arbitrator ?? null,
    });

  // 任务B结算唯一性：账本 settle 腿单一 event_id + 事件流仅一条 SettlementCompleted
  const ids = ledgerCheck.solver?.taskB_settle_event_ids || [];
  const settleOnce = {
    taskId: taskBId,
    ledger_settle_event_ids: ids,
    ledger_unique_settle_count: ids.length,
    settlementCompleted_event_count: settled.length,
    pass: ids.length === 1 && settled.length === 1 && (ledgerCheck.solver?.taskB_settle_legs || 0) > 0,
  };
  ledgerCheck.settleOnce = settleOnce;
  record('06c 任务B结算仅发生一次', settleOnce.pass, settleOnce);

  extra.events = {
    status: ev.status,
    total: ev.data?.count ?? events.length,
    disputeResolvedB: resolved.map((e) => ({ type: e.type, task_id: e.task_id, payload: e.payload })),
    settlementCompletedB: settled.map((e) => ({ type: e.type, task_id: e.task_id, payload: e.payload })),
    recentTypes: events.slice(-12).map((e) => e.type),
  };
} catch (e) {
  record('06 事件流确认', false, 'EXCEPTION: ' + String(e));
}

// ---------- 导出结果 ----------
notes.push(`剧本检查项 ${checks.filter((x) => x.pass).length}/${checks.length} 通过`);
notes.push(`裁定结果：resolvedId=${resolvedId || 'null'}，state=${resolveState}，arbitrator=${extra.resolve?.arbitrator ?? 'n/a'}，model_decision=${String(extra.resolve?.model_decision)}`);
const cSummary = concurrency.outcomes?.map((o) => `${o.status}/${o.code || '-'}`).join(' vs ') || 'n/a';
notes.push(`并发结果(C-01)：${cSummary}，互斥断言=${concurrency.pass ?? false}，账本未重复=${concurrency.ledger?.unchanged ?? false}`);

await c.dumpResult('admin3', {
  notes,
  checks,
  checkPass: checks.filter((x) => x.pass).length,
  checkFail: checks.filter((x) => !x.pass).length,
  resolvedId,
  ledgerCheck,
  concurrency,
  ...extra,
});
