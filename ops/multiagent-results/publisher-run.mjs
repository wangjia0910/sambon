/**
 * 发布方角色 · 多智能体端到端真实 HTTP 测试脚本
 * 运行：node --disable-warning=ExperimentalWarning ops/multiagent-results/publisher-run.mjs
 */
import { SimClient, eid, waitFor } from '../multiagent-client.mjs';

const c = new SimClient('http://127.0.0.1:8793', 'publisher');
const checks = [];
const notes = [];
const extra = {};

const MARK = '[MA-pub]';
const TITLE_A = '【MA-pub】社区海报设计 [MA-pub]';
const TITLE_B = '【MA-pub】争议测试任务 [MA-pub]';

function record(name, pass, detail) {
  checks.push({ name, pass, detail });
  if (!pass) notes.push(`[FAIL] ${name} → ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
}

/** 从任务列表（含终态）里按 task_id 找当前状态 */
async function stateOf(taskId) {
  const r = await c.get('/api/tasks?include_terminal=true');
  const t = (r.data?.tasks || []).find((x) => x.task_id === taskId);
  return { r, t, state: t?.state ?? null };
}

// ---------- 步骤 1：注册 publisher ----------
let initBalance = null;
try {
  const reg = await c.register('pub_ma@test.dev', 'PubPass123!long', 'publisher', 'MA发布方');
  initBalance = reg.data?.user?.available_sbc ?? null;
  const pass = reg.status === 201 && !!c.csrf && !!c.userId && Number(initBalance) === 1000;
  record('01 register publisher', pass, {
    status: reg.status, error: reg.error, userId: c.userId,
    available_sbc: initBalance, csrf: !!c.csrf,
  });
  extra.register = { status: reg.status, error: reg.error, userId: c.userId, available_sbc: initBalance };
  if (reg.status === 409) notes.push('注册返回 409：pub_ma@test.dev 已存在，会话未建立，后续步骤会失败');
} catch (e) {
  record('01 register publisher', false, 'EXCEPTION: ' + String(e));
}

// ---------- 步骤 2：立即发布任务 A ----------
let taskIdA = null;
try {
  const r = await c.post('/api/tasks', {
    title: TITLE_A,
    description: '为社区活动设计宣传海报，输出 PNG 源文件，风格简洁明快。',
    category: 'design',
    bounty: 200,
    acceptance_criteria: '提供PNG源文件',
    deadline_hours: 72,
    event_id: eid('taskA'),
  });
  taskIdA = r.data?.task?.task_id ?? null;
  const pass = r.status === 201 && !!taskIdA && r.data?.task?.state === 'PENDING_REVIEW'
    && Number(r.data?.task?.bounty) === 200 && String(r.data?.task?.title).includes('MA-pub');
  record('02 create task A', pass, {
    status: r.status, error: r.error, taskId: taskIdA,
    state: r.data?.task?.state, bounty: r.data?.task?.bounty, title: r.data?.task?.title,
  });
  extra.taskA = { status: r.status, error: r.error, taskId: taskIdA, state: r.data?.task?.state ?? null, title: r.data?.task?.title ?? null };
} catch (e) {
  record('02 create task A', false, 'EXCEPTION: ' + String(e));
}

// ---------- 步骤 3：立即发布任务 B ----------
let taskIdB = null;
try {
  const r = await c.post('/api/tasks', {
    title: TITLE_B,
    description: '制作一份活动说明图，用于后续争议流程测试。',
    category: 'design',
    bounty: 150,
    acceptance_criteria: '提供清晰可读的说明图',
    deadline_hours: 72,
    event_id: eid('taskB'),
  });
  taskIdB = r.data?.task?.task_id ?? null;
  const pass = r.status === 201 && !!taskIdB && r.data?.task?.state === 'PENDING_REVIEW'
    && Number(r.data?.task?.bounty) === 150 && String(r.data?.task?.title).includes('MA-pub');
  record('03 create task B', pass, {
    status: r.status, error: r.error, taskId: taskIdB,
    state: r.data?.task?.state, bounty: r.data?.task?.bounty, title: r.data?.task?.title,
  });
  extra.taskB = { status: r.status, error: r.error, taskId: taskIdB, state: r.data?.task?.state ?? null, title: r.data?.task?.title ?? null };
} catch (e) {
  record('03 create task B', false, 'EXCEPTION: ' + String(e));
}

// ---------- 步骤 4：列出任务，确认两个都在 PENDING_REVIEW ----------
try {
  const r = await c.get('/api/tasks');
  const a = (r.data?.tasks || []).find((t) => t.task_id === taskIdA);
  const b = (r.data?.tasks || []).find((t) => t.task_id === taskIdB);
  const pass = r.status === 200 && a?.state === 'PENDING_REVIEW' && b?.state === 'PENDING_REVIEW';
  record('04 list tasks PENDING_REVIEW', pass, {
    status: r.status, error: r.error, count: r.data?.count,
    A: a?.state ?? null, B: b?.state ?? null,
  });
  extra.pending = { status: r.status, A: a?.state ?? null, B: b?.state ?? null, count: r.data?.count ?? null };
} catch (e) {
  record('04 list tasks PENDING_REVIEW', false, 'EXCEPTION: ' + String(e));
}

// ---------- 步骤 5：任务榜单 ----------
let board = null;
try {
  board = await c.get('/api/leaderboard/tasks');
  record('05 leaderboard tasks', board.status === 200, {
    status: board.status, error: board.error, mode: board.data?.mode, items: board.data?.items?.length,
  });
  extra.boardInitial = { status: board.status, mode: board.data?.mode ?? null, items: board.data?.items?.length ?? null };
} catch (e) {
  record('05 leaderboard tasks', false, 'EXCEPTION: ' + String(e));
}

// ---------- 步骤 6：轮询任务 A → SUBMITTED（最多 90 秒） ----------
let aLastState = null;
try {
  const w = await waitFor(async () => {
    const s = await stateOf(taskIdA);
    aLastState = s.state;
    return { done: s.state === 'SUBMITTED', state: s.state, status: s.r.status };
  }, { timeout: 90000, interval: 1500, label: 'task A SUBMITTED' });
  record('06 wait task A SUBMITTED', !!w.done, {
    done: !!w.done, timeout: !!w.timeout, lastState: aLastState, taskId: taskIdA,
  });
  extra.waitA = { done: !!w.done, timeout: !!w.timeout, lastState: aLastState };
  if (!w.done) notes.push(`任务 A 未在 90 秒内到达 SUBMITTED（最后状态 ${aLastState}）：管理员审核/推送或接单人接单提交环节可能未完成，不伪造结果`);
} catch (e) {
  record('06 wait task A SUBMITTED', false, 'EXCEPTION: ' + String(e));
}

// ---------- 步骤 7：验收任务 A，断言 settlement ----------
let settlement = null;
try {
  const r = await c.post(`/api/tasks/${taskIdA}/verify`, {
    decision: 'approve', rating: 5, event_id: eid('verifyA'),
  });
  settlement = r.data?.settlement ?? null;
  const pass = r.status === 200 && Number(settlement?.bounty) === 200 && Number(settlement?.service_fee) === 10;
  record('07 verify task A settlement', pass, {
    status: r.status, error: r.error,
    settlement, state: r.data?.task?.state,
    precheck: aLastState,
  });
  extra.verifyA = {
    status: r.status, error: r.error, state: r.data?.task?.state ?? null,
    settlement: settlement ? {
      bounty: settlement.bounty, service_fee: settlement.service_fee,
      quality_bonus: settlement.quality_bonus, trigger: settlement.trigger,
    } : null,
  };
} catch (e) {
  record('07 verify task A settlement', false, 'EXCEPTION: ' + String(e));
}

// ---------- 步骤 8：轮询任务 B → SUBMITTED 并发起争议 ----------
let bLastState = null;
try {
  const w = await waitFor(async () => {
    const s = await stateOf(taskIdB);
    bLastState = s.state;
    return { done: s.state === 'SUBMITTED', state: s.state, status: s.r.status };
  }, { timeout: 90000, interval: 1500, label: 'task B SUBMITTED' });
  record('08 wait task B SUBMITTED', !!w.done, {
    done: !!w.done, timeout: !!w.timeout, lastState: bLastState, taskId: taskIdB,
  });
  extra.waitB = { done: !!w.done, timeout: !!w.timeout, lastState: bLastState };
  if (!w.done) notes.push(`任务 B 未在 90 秒内到达 SUBMITTED（最后状态 ${bLastState}），争议发起可能因状态非法而失败`);
} catch (e) {
  record('08 wait task B SUBMITTED', false, 'EXCEPTION: ' + String(e));
}

try {
  const r = await c.post(`/api/tasks/${taskIdB}/dispute`, {
    action: 'open', reason: '成果与要求不符', event_id: eid('disputeB'),
  });
  const pass = r.status === 200 && r.data?.task?.state === 'DISPUTED';
  record('08 dispute task B open', pass, {
    status: r.status, error: r.error, state: r.data?.task?.state ?? null,
    escrow_total: r.data?.escrow_total ?? null, precheck: bLastState,
  });
  extra.disputeB = {
    status: r.status, error: r.error, state: r.data?.task?.state ?? null,
    escrow_total: r.data?.escrow_total ?? null, arbitration: r.data?.arbitration ?? null,
  };
} catch (e) {
  record('08 dispute task B open', false, 'EXCEPTION: ' + String(e));
}

// ---------- 步骤 9：GDPR 导出 + 通知 ----------
try {
  const ex = await c.get('/api/me/export');
  record('09 GET /api/me/export', ex.status === 200 && Array.isArray(ex.data?.tasks), {
    status: ex.status, error: ex.error, tasks: ex.data?.tasks?.length, profile: !!ex.data?.profile,
  });
  extra.export = {
    status: ex.status, tasks: ex.data?.tasks?.length ?? null,
    consents: ex.data?.consents?.length ?? null, ledger: !!ex.data?.ledger,
  };
} catch (e) {
  record('09 GET /api/me/export', false, 'EXCEPTION: ' + String(e));
}

try {
  const n = await c.get('/api/me/notifications');
  record('09 GET /api/me/notifications', n.status === 200, {
    status: n.status, error: n.error, data: n.data,
  });
  extra.notifications = { status: n.status, data: n.data };
} catch (e) {
  record('09 GET /api/me/notifications', false, 'EXCEPTION: ' + String(e));
}

// ---------- 步骤 10：关闭个性化，榜单确认 mode=neutral ----------
try {
  const p = await c.post('/api/preferences/personalized', { enabled: false, event_id: eid('prefs') });
  record('10 disable personalized', p.status === 200 && p.data?.personalized_enabled === false, {
    status: p.status, error: p.error, data: p.data,
  });
  extra.preferences = { status: p.status, error: p.error, data: p.data };
} catch (e) {
  record('10 disable personalized', false, 'EXCEPTION: ' + String(e));
}

try {
  const bc = await c.get('/api/leaderboard/tasks');
  record('10 leaderboard neutral', bc.status === 200 && bc.data?.mode === 'neutral', {
    status: bc.status, error: bc.error, mode: bc.data?.mode, personalized: bc.data?.personalized,
  });
  extra.boardNeutral = { status: bc.status, mode: bc.data?.mode ?? null, personalized: bc.data?.personalized ?? null };
} catch (e) {
  record('10 leaderboard neutral', false, 'EXCEPTION: ' + String(e));
}

// ---------- 步骤 11：切语言 + 记录同意偏好 ----------
try {
  const l = await c.post('/api/me/locale', { locale: 'en', event_id: eid('locale') });
  record('11 set locale en', l.status === 200 && l.data?.locale === 'en', {
    status: l.status, error: l.error, data: l.data,
  });
  extra.locale = { status: l.status, error: l.error, data: l.data };
} catch (e) {
  record('11 set locale en', false, 'EXCEPTION: ' + String(e));
}

try {
  const cs = await c.post('/api/consents', {
    kind: 'marketing', version: 'v1', granted: false, event_id: eid('consent'),
  });
  record('11 consent marketing=false', cs.status === 200 || cs.status === 201, {
    status: cs.status, error: cs.error, data: cs.data,
  });
  extra.consent = { status: cs.status, error: cs.error, data: cs.data };
  if (cs.status >= 400) {
    notes.push(`consents kind='marketing' 被服务端拒绝（${cs.error?.code}）：API 允许的 kind 为 cookie/privacy/tos/aup/analytics，剧本取值与接口枚举不一致，已如实记录未伪造成功`);
  }
} catch (e) {
  record('11 consent marketing=false', false, 'EXCEPTION: ' + String(e));
}

// ---------- 步骤 12：确认发布方余额变化 ----------
try {
  const me = await c.get('/api/auth/me');
  const bal = me.data?.user?.available_sbc ?? null;
  const changed = Number.isFinite(Number(bal)) && Number(bal) !== Number(initBalance);
  const pass = me.status === 200 && changed;
  record('12 auth/me balance changed', pass, {
    status: me.status, error: me.error, before: initBalance, after: bal,
    role: me.data?.user?.role, prefs: me.data?.preferences,
  });
  extra.me = {
    status: me.status, before: initBalance, after: bal, changed,
    role: me.data?.user?.role ?? null, preferences: me.data?.preferences ?? null,
  };
} catch (e) {
  record('12 auth/me balance changed', false, 'EXCEPTION: ' + String(e));
}

// ---------- 步骤 13：导出结果 ----------
notes.push(`剧本检查项 ${checks.filter((x) => x.pass).length}/${checks.length} 通过`);
await c.dumpResult('publisher', {
  notes,
  checks,
  checkPass: checks.filter((x) => x.pass).length,
  checkFail: checks.filter((x) => !x.pass).length,
  taskA: taskIdA,
  taskB: taskIdB,
  settlement,
  ...extra,
});
