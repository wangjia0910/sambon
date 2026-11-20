/**
 * 接单人(solver) · 三宝殿悬赏互助平台 多智能体端到端真实 HTTP 测试
 * 运行：node --disable-warning=ExperimentalWarning ops/multiagent-results/solver-run.mjs
 */
import { SimClient, eid } from '../multiagent-client.mjs';

const c = new SimClient('http://127.0.0.1:8793', 'solver');
const checks = [];
const notes = [];
const extra = {};
const acceptedIds = [];
const submittedIds = [];
const ledgerCheck = {};

function record(name, pass, detail) {
  checks.push({ name, pass, detail });
  if (!pass) notes.push(`[FAIL] ${name} → ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
}
const ok2xx = (r, s = 200) => r?.status === s && r?.ok === true;

// ---------- 步骤 1：注册 solver（初始 SBC=1000） ----------
let initBalance = null;
let regRaw = null;
try {
  const reg = await c.register('sol_ma@test.dev', 'SolverPass123!long', 'solver', 'MA接单猎人');
  regRaw = { status: reg.status, ok: reg.ok, error: reg.error, data: reg.data };
  initBalance = reg.data?.user?.available_sbc ?? null;
  const pass = reg.status === 201 && !!c.csrf && !!c.userId && Number(initBalance) === 1000;
  record('01 register solver (SBC=1000)', pass, {
    status: reg.status, error: reg.error, userId: c.userId,
    available_sbc: initBalance, csrf: !!c.csrf, role: reg.data?.user?.role,
  });
  extra.register = { status: reg.status, error: reg.error, userId: c.userId, available_sbc: initBalance };
  if (reg.status === 409) notes.push('注册返回 409（账号已存在），会话可能未建立；如实记录，不伪造成功');
} catch (e) {
  record('01 register solver (SBC=1000)', false, 'EXCEPTION: ' + String(e));
}

// ---------- 步骤 2：任务榜 + 猎人榜 ----------
let boardTasksRaw = null;
try {
  const r = await c.get('/api/leaderboard/tasks');
  boardTasksRaw = { status: r.status, error: r.error, data: r.data };
  record('02 leaderboard/tasks', ok2xx(r), {
    status: r.status, error: r.error, mode: r.data?.mode,
    items: r.data?.items?.length, personalized: r.data?.personalized,
  });
  extra.leaderboardTasks = { status: r.status, mode: r.data?.mode ?? null, items: r.data?.items?.length ?? null };
} catch (e) {
  record('02 leaderboard/tasks', false, 'EXCEPTION: ' + String(e));
}
let boardUsersRaw = null;
try {
  const r = await c.get('/api/leaderboard/users');
  boardUsersRaw = { status: r.status, error: r.error, data: r.data };
  record('02 leaderboard/users', ok2xx(r), {
    status: r.status, error: r.error, items: r.data?.items?.length, note: r.data?.note,
  });
  extra.leaderboardUsers = { status: r.status, items: r.data?.items?.length ?? null };
} catch (e) {
  record('02 leaderboard/users', false, 'EXCEPTION: ' + String(e));
}

// ---------- 步骤 3：登录后 GET /api/tasks，找 MA-pub 且 DISPATCHING ----------
let taskA = null, taskB = null;
let tasksRaw = null;
try {
  const r = await c.get('/api/tasks');
  tasksRaw = { status: r.status, error: r.error, count: r.data?.count, tasks: r.data?.tasks };
  const cand = (r.data?.tasks || []).filter((t) => String(t.title || '').includes('MA-pub'));
  const disp = cand.filter((t) => t.state === 'DISPATCHING');
  taskA = disp.find((t) => String(t.title).includes('社区海报设计')) || null;
  taskB = disp.find((t) => String(t.title).includes('争议测试')) || null;
  const pass = ok2xx(r) && !!taskA && !!taskB;
  record('03 tasks MA-pub DISPATCHING (A+B)', pass, {
    status: r.status, error: r.error, totalTasks: r.data?.count,
    maPub: cand.map((t) => ({ id: t.task_id, state: t.state, frozen_total: t.frozen_total })),
    taskA: taskA?.task_id ?? null, taskB: taskB?.task_id ?? null,
  });
  extra.dispatching = {
    status: r.status,
    taskA: taskA ? { id: taskA.task_id, state: taskA.state, bounty: taskA.bounty, frozen_total: taskA.frozen_total } : null,
    taskB: taskB ? { id: taskB.task_id, state: taskB.state, bounty: taskB.bounty, frozen_total: taskB.frozen_total } : null,
  };
  if (!pass) notes.push('未在 /api/tasks 同时找到 MA-pub 的 A(社区海报设计)/B(争议测试) 且状态 DISPATCHING；可能已被其他接单人接走');
} catch (e) {
  record('03 tasks MA-pub DISPATCHING (A+B)', false, 'EXCEPTION: ' + String(e));
}

/** 接单：断言 ACCEPTED + escrow_total */
async function acceptTask(t, label) {
  if (!t) { record(`${label} accept`, false, '无任务对象'); return null; }
  try {
    const r = await c.post(`/api/tasks/${t.task_id}/accept`, { event_id: eid(`accept${label.slice(-1)}`) });
    const state = r.data?.task?.state ?? r.data?.state ?? null;
    const escrow = r.data?.escrow_total ?? r.data?.task?.escrow_total ?? null;
    const expected = label.includes('A') ? 210 : 157.5;
    const pass = ok2xx(r) && state === 'ACCEPTED' && Number(escrow) === expected;
    record(`${label} accept`, pass, {
      status: r.status, error: r.error, taskId: t.task_id, state, escrow_total: escrow, expected,
    });
    extra[`accept${label.slice(-1)}`] = { status: r.status, error: r.error, state, escrow_total: escrow, note: r.data?.note ?? null };
    if (pass) acceptedIds.push(t.task_id);
    return r;
  } catch (e) {
    record(`${label} accept`, false, 'EXCEPTION: ' + String(e));
    return null;
  }
}

/** 提交成果：断言 result_preview 脱敏（无 >=6 位连续数字，含[已脱敏]） */
async function submitTask(t, label, content) {
  if (!t) { record(`${label} submit`, false, '无任务对象'); return null; }
  try {
    const r = await c.post(`/api/tasks/${t.task_id}/submit`, { content, event_id: eid(`submit${label.slice(-1)}`) });
    const preview = r.data?.task?.result_preview ?? r.data?.result_preview ?? null;
    const redactedFlag = r.data?.task?.result_pii_redacted ?? null;
    const longDigits = String(preview ?? '').match(/\d{6,}/g) || [];
    const hasMarker = String(preview ?? '').includes('[已脱敏]');
    const state = r.data?.task?.state ?? null;
    const pass = ok2xx(r) && !!preview && longDigits.length === 0 && hasMarker && redactedFlag === true && state === 'SUBMITTED';
    record(`${label} submit (PII redacted)`, pass, {
      status: r.status, error: r.error, taskId: t.task_id, state,
      result_preview: preview, result_pii_redacted: redactedFlag,
      longDigitRuns: longDigits, hasRedactMarker: hasMarker,
    });
    extra[`submit${label.slice(-1)}`] = {
      status: r.status, error: r.error, state, result_preview: preview,
      result_pii_redacted: redactedFlag, note: r.data?.note ?? null,
    };
    if (pass) submittedIds.push(t.task_id);
    return r;
  } catch (e) {
    record(`${label} submit (PII redacted)`, false, 'EXCEPTION: ' + String(e));
    return null;
  }
}

const PII_CONTENT = '演示成果：已完成海报设计，联系 13812345678 证件 110101199001011234';

// ---------- 步骤 4+5：任务 A 接单并提交 ----------
const acceptA = await acceptTask(taskA, '04 accept A');
await submitTask(taskA, '05 submit A', PII_CONTENT);

// ---------- 步骤 6：任务 B 接单并提交 ----------
const acceptB = await acceptTask(taskB, '06 accept B');
await submitTask(taskB, '06 submit B', PII_CONTENT + '（争议测试用）');

// ---------- 步骤 7：钱包账本 ----------
try {
  const r = await c.get(`/api/ledger/${c.userId}`);
  const balanced = r.data?.balance_check?.balanced ?? null;
  const anchor = r.data?.anchor ?? null;
  const piiOnChain = anchor?.pii_on_chain ?? null;
  const pass = ok2xx(r) && balanced === true && !!anchor && !!anchor.anchor_id && piiOnChain === false;
  record('07 ledger balanced+anchor+noPII', pass, {
    status: r.status, error: r.error, balanced, anchor_id: anchor?.anchor_id ?? null,
    merkle_root: anchor?.merkle_root ?? null, pii_on_chain: piiOnChain,
    entries: r.data?.entries?.length,
  });
  Object.assign(ledgerCheck, {
    status: r.status, balanced, anchor_id: anchor?.anchor_id ?? null,
    merkle_root: anchor?.merkle_root ?? null, pii_on_chain: piiOnChain,
    entries: r.data?.entries?.length, note: r.data?.balance_check?.note ?? null,
  });
  extra.ledger = ledgerCheck;
} catch (e) {
  record('07 ledger balanced+anchor+noPII', false, 'EXCEPTION: ' + String(e));
}

// ---------- 步骤 8：通知 + 标记已读 ----------
let notifIds = [];
let notifRaw = null;
try {
  const r = await c.get('/api/me/notifications');
  notifRaw = { status: r.status, error: r.error, data: r.data };
  notifIds = (r.data?.items || []).filter((n) => !n.read_at).map((n) => n.id);
  const pass = ok2xx(r);
  record('08 GET /api/me/notifications', pass, {
    status: r.status, error: r.error, items: r.data?.items?.length,
    unread_count: r.data?.unread_count, ids: notifIds,
  });
  extra.notifications = { status: r.status, items: r.data?.items?.length ?? null, unread_count: r.data?.unread_count ?? null, ids: notifIds };
} catch (e) {
  record('08 GET /api/me/notifications', false, 'EXCEPTION: ' + String(e));
}
try {
  const r = await c.post('/api/me/notifications/read', { ids: notifIds, event_id: eid('notif-read') });
  // 如实记录原始响应（结构若为 {updated:N} 即符合预期）
  extra.notificationsRead = { status: r.status, ok: r.ok, error: r.error, data: r.data, sentIds: notifIds };
  const pass = ok2xx(r) && typeof r.data?.updated === 'number';
  record('08 POST /api/me/notifications/read', pass, {
    status: r.status, error: r.error, data: r.data, sentIds: notifIds,
  });
  if (!pass) notes.push(`notifications/read 返回结构与预期不同，原始响应：${JSON.stringify({ status: r.status, ok: r.ok, error: r.error, data: r.data })}`);
} catch (e) {
  record('08 POST /api/me/notifications/read', false, 'EXCEPTION: ' + String(e));
}
// 复核未读数
try {
  const r = await c.get('/api/me/notifications');
  extra.notificationsAfter = { status: r.status, unread_count: r.data?.unread_count ?? null, items: r.data?.items?.length ?? null };
} catch (e) {
  notes.push('复核通知未读数异常: ' + String(e));
}

// ---------- 步骤 9：事件流 ----------
try {
  const r = await c.get('/api/events');
  const types = (r.data?.events || []).map((e) => e.type);
  const pass = ok2xx(r) && Array.isArray(r.data?.events);
  record('09 GET /api/events', pass, {
    status: r.status, error: r.error, count: r.data?.count,
    recentTypes: types.slice(-12),
  });
  extra.events = { status: r.status, count: r.data?.count ?? null, recentTypes: types.slice(-12) };
} catch (e) {
  record('09 GET /api/events', false, 'EXCEPTION: ' + String(e));
}

// ---------- 步骤 10：确认余额 ----------
try {
  const r = await c.get('/api/auth/me');
  const bal = r.data?.user?.available_sbc ?? null;
  const pass = ok2xx(r) && Number.isFinite(Number(bal));
  record('10 GET /api/auth/me balance', pass, {
    status: r.status, error: r.error, available_sbc: bal,
    before: initBalance, role: r.data?.user?.role,
  });
  extra.me = { status: r.status, available_sbc: bal, before: initBalance, role: r.data?.user?.role ?? null };
} catch (e) {
  record('10 GET /api/auth/me balance', false, 'EXCEPTION: ' + String(e));
}

// ---------- 步骤 11：导出结果 ----------
notes.push(`剧本检查项 ${checks.filter((x) => x.pass).length}/${checks.length} 通过`);
notes.push(`接单成功 ${acceptedIds.length} 个，提交成功 ${submittedIds.length} 个`);
await c.dumpResult('solver', {
  notes, checks,
  checkPass: checks.filter((x) => x.pass).length,
  checkFail: checks.filter((x) => !x.pass).length,
  acceptedIds, submittedIds, ledgerCheck,
  ...extra,
});
