/**
 * 管理员角色 · 多智能体端到端真实 HTTP 测试脚本
 * 运行：node --disable-warning=ExperimentalWarning ops/multiagent-results/admin-run.mjs
 */
import { SimClient, eid, waitFor } from '../multiagent-client.mjs';

const c = new SimClient('http://127.0.0.1:8793', 'admin');
const checks = [];
const notes = [];
const extra = {};

const HAS = (t) => String(t?.title || '').includes('[MA-pub]');
const is200 = (r) => r?.status === 200;

function record(name, pass, detail) {
  checks.push({ name, pass, detail });
  if (!pass) notes.push(`[FAIL] ${name} → ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
}

// ---------- 步骤 1：bootstrapAdmin ----------
try {
  const b = await c.bootstrapAdmin('ma-test-admin-token', 'admin_ma@test.dev', 'AdminPass123!long');
  const sessionOk = !!c.csrf && !!c.userId;
  const pass = ([201, 200].includes(b.status) || (b.status === 409 && sessionOk)) && sessionOk;
  record('01 bootstrapAdmin', pass, { status: b.status, error: b.error, sessionOk });
  extra.bootstrap = { status: b.status, error: b.error, sessionOk, userId: c.userId };
  if (b.status === 409) notes.push('bootstrap 返回 409（管理员已由先前探测创建），已通过 login 取得稳定会话');
} catch (e) {
  record('01 bootstrapAdmin', false, 'EXCEPTION: ' + String(e));
}

// ---------- 步骤 2：health + config ----------
try {
  const h = await c.get('/api/health');
  const cfg = await c.get('/api/config');
  const pass = is200(h) && is200(cfg);
  record('02 health+config', pass, { health: h.status, config: cfg.status });
  extra.health = { status: h.status, mode: h.data?.mode, version: h.data?.version, db: h.data?.db, health: h.data?.status };
  extra.config = {
    status: cfg.status, mode: cfg.data?.mode, version: cfg.data?.version,
    redLinesCount: cfg.data?.red_lines?.length ?? null,
  };
} catch (e) {
  record('02 health+config', false, 'EXCEPTION: ' + String(e));
}

// ---------- 步骤 3：等待待审核 [MA-pub] 任务 ----------
let pendingItems = [];
try {
  const w = await waitFor(async () => {
    const r = await c.get('/api/admin/queue');
    const items = (r.data?.pending_review || []).filter(HAS);
    return { done: r.status === 200 && items.length > 0, items, status: r.status };
  }, { timeout: 60000, label: 'pending_review [MA-pub]' });
  pendingItems = w.items || w.last?.items || [];
  record('03 wait pending_review [MA-pub]', !!w.done, {
    done: !!w.done, timeout: !!w.timeout, matched: pendingItems.length,
    ids: pendingItems.map((t) => t.task_id),
  });
  extra.pendingReview = { matched: pendingItems.length, ids: pendingItems.map((t) => t.task_id) };
} catch (e) {
  record('03 wait pending_review [MA-pub]', false, 'EXCEPTION: ' + String(e));
}

// ---------- 步骤 4：审核通过 ----------
const reviewed = [];
for (const t of pendingItems) {
  try {
    const r = await c.post(`/api/tasks/${t.task_id}/review`, { decision: 'approve', event_id: eid('review') });
    const pass = r.status === 200 && r.ok === true;
    record(`04 review ${t.task_id}`, pass, { status: r.status, state: r.data?.task?.state, error: r.error });
    reviewed.push({ id: t.task_id, status: r.status, state: r.data?.task?.state ?? null });
  } catch (e) {
    record(`04 review ${t.task_id}`, false, 'EXCEPTION: ' + String(e));
    reviewed.push({ id: t.task_id, error: String(e) });
  }
}
extra.reviewed = reviewed;

// ---------- 步骤 5：等待 PUBLISHED 并推送 ----------
let publishedItems = [];
try {
  const w = await waitFor(async () => {
    const r = await c.get('/api/tasks');
    const items = (r.data?.tasks || []).filter((t) => t.state === 'PUBLISHED' && HAS(t));
    return { done: r.status === 200 && items.length > 0, items, status: r.status };
  }, { timeout: 60000, label: 'PUBLISHED [MA-pub]' });
  publishedItems = w.items || w.last?.items || [];
  record('05 wait PUBLISHED [MA-pub]', !!w.done, {
    done: !!w.done, matched: publishedItems.length, ids: publishedItems.map((t) => t.task_id),
  });
  extra.published = { matched: publishedItems.length, ids: publishedItems.map((t) => t.task_id) };
} catch (e) {
  record('05 wait PUBLISHED [MA-pub]', false, 'EXCEPTION: ' + String(e));
}

const dispatched = [];
for (const t of publishedItems) {
  try {
    const r = await c.post(`/api/tasks/${t.task_id}/dispatch`, {
      dry_run: false, top_k: 5, batch_size: 5, event_id: eid('dispatch'),
    });
    const pass = r.status === 200 && r.ok === true;
    record(`05 dispatch ${t.task_id}`, pass, {
      status: r.status, dispatch_id: r.data?.dispatch_id ?? r.data?.dispatch?.dispatch_id ?? null, error: r.error,
    });
    dispatched.push({ id: t.task_id, status: r.status, dispatch_id: r.data?.dispatch_id ?? null });
  } catch (e) {
    record(`05 dispatch ${t.task_id}`, false, 'EXCEPTION: ' + String(e));
    dispatched.push({ id: t.task_id, error: String(e) });
  }
}
extra.dispatched = dispatched;

// ---------- 步骤 6：运维端点全部 200 ----------
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

// ---------- 步骤 7：账本锚定 ----------
try {
  const a = await c.post('/api/admin/anchor', { event_id: eid('anchor') });
  record('07 anchor', is200(a), { status: a.status, error: a.error });
  extra.anchor = { status: a.status, data: a.data, error: a.error };
} catch (e) {
  record('07 anchor', false, 'EXCEPTION: ' + String(e));
}

// ---------- 步骤 8：定时任务 cron ----------
try {
  const cr = await c.post('/api/admin/cron', { event_id: eid('cron') }, { headers: { 'x-cron-secret': '' } });
  record('08 cron', is200(cr), { status: cr.status, error: cr.error, mode: cr.data?.mode });
  extra.cron = { status: cr.status, mode: cr.data?.mode ?? null, data: cr.data, error: cr.error };
  notes.push(`cron 观察：status=${cr.status} mode=${cr.data?.mode ?? 'null'} error=${cr.error?.code ?? 'null'}`);
} catch (e) {
  record('08 cron', false, 'EXCEPTION: ' + String(e));
}

// ---------- 步骤 9：等待 DISPUTED 并人工裁定 ----------
let disputedItems = [];
try {
  const w = await waitFor(async () => {
    const r = await c.get('/api/admin/queue');
    const items = (r.data?.disputed || []).filter(HAS);
    return { done: r.status === 200 && items.length > 0, items, status: r.status };
  }, { timeout: 60000, label: 'DISPUTED [MA-pub]' });
  disputedItems = w.items || w.last?.items || [];
  record('09 wait DISPUTED [MA-pub]', !!w.done, {
    done: !!w.done, timeout: !!w.timeout, matched: disputedItems.length,
    ids: disputedItems.map((t) => t.task_id),
  });
  extra.disputed = { matched: disputedItems.length, ids: disputedItems.map((t) => t.task_id) };
} catch (e) {
  record('09 wait DISPUTED [MA-pub]', false, 'EXCEPTION: ' + String(e));
}

const resolved = [];
for (const t of disputedItems) {
  try {
    const r = await c.post(`/api/tasks/${t.task_id}/dispute`, {
      action: 'resolve', resolution: 'pay_solver', event_id: eid('dispute-resolve'),
    });
    const pass = r.status === 200 && r.ok === true;
    record(`09 dispute resolve ${t.task_id}`, pass, {
      status: r.status, state: r.data?.task?.state ?? r.data?.state ?? null, error: r.error,
    });
    resolved.push({ id: t.task_id, status: r.status });
  } catch (e) {
    record(`09 dispute resolve ${t.task_id}`, false, 'EXCEPTION: ' + String(e));
    resolved.push({ id: t.task_id, error: String(e) });
  }
}
extra.resolved = resolved;

// ---------- 步骤 10：终态确认 ----------
try {
  const fq = await c.get('/api/admin/queue');
  const fe = await c.get('/api/events');
  record('10 final queue', is200(fq), { status: fq.status, error: fq.error });
  record('10 final events', is200(fe), { status: fe.status, error: fe.error });
  extra.final = {
    queue: {
      status: fq.status,
      pendingCount: fq.data?.pending_review?.length ?? null,
      disputedCount: fq.data?.disputed?.length ?? null,
      openReportsCount: fq.data?.open_reports?.length ?? null,
    },
    events: {
      status: fe.status, count: fe.data?.count ?? null,
      recentTypes: (fe.data?.events || []).slice(-8).map((e) => e.type),
    },
  };
} catch (e) {
  record('10 final', false, 'EXCEPTION: ' + String(e));
}

// ---------- 步骤 11：导出结果 ----------
notes.push(`剧本检查项 ${checks.filter((x) => x.pass).length}/${checks.length} 通过`);
await c.dumpResult('admin', {
  notes,
  checks,
  checkPass: checks.filter((x) => x.pass).length,
  checkFail: checks.filter((x) => !x.pass).length,
  ...extra,
});
