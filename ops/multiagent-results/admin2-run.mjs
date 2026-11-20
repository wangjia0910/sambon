/**
 * 管理员2 · 三宝殿悬赏互助平台 多智能体端到端真实 HTTP 测试
 * 运行：node --disable-warning=ExperimentalWarning ops/multiagent-results/admin2-run.mjs
 */
import { SimClient, eid, waitFor } from '../multiagent-client.mjs';

const c = new SimClient('http://127.0.0.1:8793', 'admin2');
const checks = [];
const notes = [];
const extra = {};

const HAS = (t) => String(t?.title || '').includes('MA-pub');
const tid = (t) => t?.task_id || t?.id || null;
const isOk = (r) => r?.status === 200 && r?.ok === true;
const is200 = (r) => r?.status === 200;

function record(name, pass, detail) {
  checks.push({ name, pass, detail });
  if (!pass) notes.push(`[FAIL] ${name} → ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
}

// ---------- 步骤 1：登录管理员（401 则 bootstrap） ----------
try {
  let login = await c.login('admin_ma@test.dev', 'AdminPass123!long');
  let bootstrapped = false;
  if (login.status === 401) {
    const b = await c.bootstrapAdmin('ma-test-admin-token', 'admin_ma@test.dev', 'AdminPass123!long');
    bootstrapped = true;
    login = await c.login('admin_ma@test.dev', 'AdminPass123!long');
    extra.bootstrap = { status: b.status, error: b.error };
    notes.push(`登录返回 401，已用 bootstrapAdmin 创建管理员（status=${b.status}）后重新登录`);
  }
  const pass = login.status === 200 && !!c.csrf && !!c.userId;
  record('01 login admin', pass, { status: login.status, error: login.error, csrf: !!c.csrf, userId: c.userId, bootstrapped });
  extra.login = { status: login.status, error: login.error, userId: c.userId, role: c.role, bootstrapped };
} catch (e) {
  record('01 login admin', false, 'EXCEPTION: ' + String(e));
}

// ---------- 步骤 2：GET /api/admin/queue，找 MA-pub PENDING_REVIEW ----------
let pendingItems = [];
try {
  const w = await waitFor(async () => {
    const r = await c.get('/api/admin/queue');
    const items = (r.data?.pending_review || []).filter(HAS);
    return { done: r.status === 200 && items.length > 0, items, status: r.status, error: r.error };
  }, { timeout: 30000, interval: 800, label: 'pending_review [MA-pub]' });
  pendingItems = w.items || w.last?.items || [];
  record('02 queue pending_review [MA-pub]', !!w.done, {
    status: w.status, done: !!w.done, timeout: !!w.timeout, matched: pendingItems.length,
    ids: pendingItems.map(tid),
  });
  extra.pendingReview = { matched: pendingItems.length, ids: pendingItems.map(tid) };
  if (!w.done) notes.push('等待 30s 未在队列发现 MA-pub PENDING_REVIEW 任务，后续审核步骤可能无对象，不伪造');
} catch (e) {
  record('02 queue pending_review [MA-pub]', false, 'EXCEPTION: ' + String(e));
}

// ---------- 步骤 3：逐个审核通过 ----------
const reviewedIds = [];
for (const t of pendingItems) {
  const id = tid(t);
  try {
    const r = await c.post(`/api/tasks/${id}/review`, { decision: 'approve', event_id: eid('review') });
    const pass = isOk(r);
    record(`03 review ${id}`, pass, { status: r.status, state: r.data?.task?.state, error: r.error });
    reviewedIds.push({ id, status: r.status, state: r.data?.task?.state ?? null, pass });
  } catch (e) {
    record(`03 review ${id}`, false, 'EXCEPTION: ' + String(e));
    reviewedIds.push({ id, error: String(e), pass: false });
  }
}
extra.reviewed = reviewedIds;

// ---------- 步骤 4：GET /api/tasks 确认 PUBLISHED ----------
let publishedItems = [];
try {
  const w = await waitFor(async () => {
    const r = await c.get('/api/tasks');
    const items = (r.data?.tasks || []).filter((t) => t.state === 'PUBLISHED' && HAS(t));
    return { done: r.status === 200 && items.length > 0, items, status: r.status, error: r.error };
  }, { timeout: 30000, interval: 800, label: 'PUBLISHED [MA-pub]' });
  publishedItems = w.items || w.last?.items || [];
  record('04 tasks PUBLISHED [MA-pub]', !!w.done, {
    status: w.status, done: !!w.done, timeout: !!w.timeout, matched: publishedItems.length,
    ids: publishedItems.map(tid),
  });
  extra.published = { matched: publishedItems.length, ids: publishedItems.map(tid) };
  if (!w.done) notes.push('审核后 30s 内未发现 PUBLISHED 的 MA-pub 任务，推送步骤可能无对象，不伪造');
} catch (e) {
  record('04 tasks PUBLISHED [MA-pub]', false, 'EXCEPTION: ' + String(e));
}

// ---------- 步骤 5：逐个推送（dispatch） ----------
const pushedIds = [];
for (const t of publishedItems) {
  const id = tid(t);
  try {
    const r = await c.post(`/api/tasks/${id}/dispatch`, {
      dry_run: false, top_k: 5, batch_size: 5, event_id: eid('dispatch'),
    });
    const pass = isOk(r);
    record(`05 dispatch ${id}`, pass, {
      status: r.status, dispatch_id: r.data?.dispatch_id ?? r.data?.dispatch?.dispatch_id ?? null, error: r.error,
    });
    pushedIds.push({ id, status: r.status, dispatch_id: r.data?.dispatch_id ?? null, pass });
  } catch (e) {
    record(`05 dispatch ${id}`, false, 'EXCEPTION: ' + String(e));
    pushedIds.push({ id, error: String(e), pass: false });
  }
}
extra.pushed = pushedIds;

// ---------- 步骤 6：运维端点全部 200 + 账本锚定 ----------
const opsStatus = {};
for (const p of ['/api/admin/metrics', '/api/admin/audit', '/api/admin/risk', '/api/admin/backup', '/api/admin/ops']) {
  try {
    const r = await c.get(p);
    opsStatus[p] = r.status;
    record(`06 GET ${p}`, is200(r), { status: r.status, error: r.error });
  } catch (e) {
    opsStatus[p] = 'EXCEPTION';
    record(`06 GET ${p}`, false, 'EXCEPTION: ' + String(e));
  }
}
extra.opsEndpoints = opsStatus;

try {
  const a = await c.post('/api/admin/anchor', { event_id: eid('anchor') });
  record('06 POST /api/admin/anchor', is200(a), { status: a.status, error: a.error });
  extra.anchor = { status: a.status, error: a.error, data: a.data };
} catch (e) {
  record('06 POST /api/admin/anchor', false, 'EXCEPTION: ' + String(e));
}

// ---------- 步骤 7：轮询 DISPUTED（最多 90s）并裁定 ----------
let disputedItems = [];
try {
  const w = await waitFor(async () => {
    const r = await c.get('/api/admin/queue');
    const items = (r.data?.disputed || []).filter(HAS);
    return { done: r.status === 200 && items.length > 0, items, status: r.status, error: r.error };
  }, { timeout: 90000, interval: 1500, label: 'DISPUTED [MA-pub]' });
  disputedItems = w.items || w.last?.items || [];
  record('07 queue DISPUTED [MA-pub]', !!w.done, {
    status: w.status, done: !!w.done, timeout: !!w.timeout, matched: disputedItems.length,
    ids: disputedItems.map(tid),
  });
  extra.disputed = { matched: disputedItems.length, ids: disputedItems.map(tid), timeout: !!w.timeout };
  if (!w.done) notes.push('等待 90s 未出现 MA-pub DISPUTED 任务（发布方未发起争议或接单人未提交），未裁定，不伪造');
} catch (e) {
  record('07 queue DISPUTED [MA-pub]', false, 'EXCEPTION: ' + String(e));
}

let resolvedId = null;
for (const t of disputedItems) {
  const id = tid(t);
  try {
    const r = await c.post(`/api/tasks/${id}/dispute`, {
      action: 'resolve', resolution: 'pay_solver', event_id: eid('dispute-resolve'),
    });
    const pass = isOk(r);
    record(`07 dispute resolve ${id}`, pass, {
      status: r.status, state: r.data?.task?.state ?? r.data?.state ?? null, error: r.error,
    });
    if (pass && !resolvedId) resolvedId = id;
    extra.resolution = { id, status: r.status, state: r.data?.task?.state ?? r.data?.state ?? null, error: r.error, pass };
  } catch (e) {
    record(`07 dispute resolve ${id}`, false, 'EXCEPTION: ' + String(e));
  }
}

// ---------- 步骤 8：事件流确认 ----------
try {
  const ev = await c.get('/api/events');
  record('08 GET /api/events', is200(ev), { status: ev.status, error: ev.error });
  extra.events = {
    status: ev.status, count: ev.data?.count ?? null,
    recentTypes: (ev.data?.events || []).slice(-10).map((e) => e.type),
  };
} catch (e) {
  record('08 GET /api/events', false, 'EXCEPTION: ' + String(e));
}

// ---------- 导出结果 ----------
notes.push(`剧本检查项 ${checks.filter((x) => x.pass).length}/${checks.length} 通过`);
await c.dumpResult('admin2', {
  notes,
  checks,
  checkPass: checks.filter((x) => x.pass).length,
  checkFail: checks.filter((x) => !x.pass).length,
  reviewedIds,
  pushedIds,
  resolvedId,
  ...extra,
});
