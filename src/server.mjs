/**
 * 《三宝殿》初版原型 · HTTP 路由与编排层（server.mjs）
 *
 * 职责：严格实现 CONTRACT.md §8 全部接口；统一 {ok,data,error}；非法状态迁移明确错误；
 *       所有写接口接受可选 event_id 并保证幂等；编排发布→审核→推送→接单→提交→验收
 *       →结算→榜单/账本/事件回放；/api/config 与个性化开关（服务端强制）；静态托管操作台。
 * 约束：仅 node: 内置模块；内存存储；PORT 可覆盖（默认 8787）。
 * 合规：无 SBC 转让/交易/法币兑换/收益承诺接口；不采集明文手机号/身份证；
 *       结算、争议裁定、处罚保留人工兜底；模型不直判；关闭个性化由服务端强制生效。
 */

// 平台适配：Node 侧按需加载内置模块；浏览器 / Workers 侧只加载纯 JS 编排逻辑。
// 这样同一个 server.mjs 可被本地 Node 服务与 Cloudflare Pages 静态版共同 import，
// 业务 handler、状态机、积分规则、权重口径完全共用一份实现（不复制、不改写）。
const IS_NODE = typeof process !== 'undefined' && Boolean(process.versions?.node);
let createServer = null;
let readFileSync = null;
let fileURLToPath = null;
let resolve = null;
if (IS_NODE) {
  ({ createServer } = await import('node:http'));
  ({ readFileSync } = await import('node:fs'));
  ({ fileURLToPath } = await import('node:url'));
  ({ resolve } = await import('node:path'));
}

import {
  canTransition,
  computeFreeze,
  computeQualityBonus,
  computeCancelSettlement,
  compliancePrecheck,
  minorRestrictionHook,
  reportEntryHook,
  sanitizeSubmissionText,
  sanitizeContact,
  makeVirtualNumber,
  extractTaskStructure,
  semanticMatchHint,
  summarizeDispute,
  scoreCandidates,
  neutralCandidates,
  rankTasks,
  hardFilter,
  MAX_REJECT,
  AUTO_VERIFY_HOURS,
  DISPUTE_CLOSE_HOURS,
  RULE_VERSION,
  WEIGHT_VERSION,
  LLM_ADAPTER_VERSION,
  round2,
  round4,
} from './domain.mjs';
import { createStore } from './store.mjs';

const PORT = Number((IS_NODE && process.env.PORT) || 8787);
const INDEX_PATH = IS_NODE ? fileURLToPath(new URL('../web/index.html', import.meta.url)) : '';

const store = createStore();

// ---------------------------------------------------------------------------
// 统一响应结构
// ---------------------------------------------------------------------------

const R = {
  ok: (data, extra = {}) => ({ status: 200, body: { ok: true, data, error: null, ...extra } }),
  created: (data) => ({ status: 201, body: { ok: true, data, error: null } }),
  fail: (code, message, status = 400) => ({
    status,
    body: { ok: false, data: null, error: { code, message } },
  }),
  notFound: (message = '资源或接口不存在') => ({
    status: 404,
    body: { ok: false, data: null, error: { code: 'NOT_FOUND', message } },
  }),
};

/** 写接口幂等封装：提供 event_id 时，重复请求返回原结果、不产生副作用 */
function withIdempotency(eventId, fn) {
  if (!eventId) return fn();
  const cached = store.getIdempotent(eventId);
  if (cached) {
    return { status: cached.status, body: { ...cached.body, idempotent: true } };
  }
  const result = fn();
  if (result && result.body && result.body.ok) store.setIdempotent(eventId, result);
  return result;
}

/** 生成记账用的 event_id（客户端未提供时自行生成，仍保证只追加一次） */
function ledgerEventId(eventId) {
  return eventId || `EVT-${globalThis.crypto.randomUUID().slice(0, 12)}`;
}

// ---------------------------------------------------------------------------
// 业务辅助
// ---------------------------------------------------------------------------

function taskView(task) {
  // 返回给操作台的视图（虚构演示数据；事件日志一律脱敏）
  return {
    task_id: task.task_id,
    state: task.state,
    publisher_id: task.publisher_id,
    title: task.title,
    description: task.description,
    category: task.category,
    bounty: task.bounty,
    service_fee: task.freeze ? task.freeze.service_fee : null,
    frozen_total: task.frozen_total ?? null,
    deadline: task.deadline,
    deadline_hours: task.deadline_hours,
    acceptance_criteria: task.acceptance_criteria,
    online: task.online,
    radius_km: task.radius_km,
    required_skills: task.required_skills,
    virtual_contact: task.virtual_contact,
    solver_id: task.solver_id ?? null,
    reject_count: task.reject_count ?? 0,
    escrowed: task.escrowed ?? false,
    structure: task.structure ?? null,
    compliance: task.compliance ?? null,
    created_at: task.created_at,
    settlement: task.settlement ?? null,
    // 成果预览为脱敏后文本；原始正文从不存入内存（CONTRACT §10.2）
    result_preview: task.result ? task.result.text : null,
    result_pii_redacted: task.result ? task.result.pii_redacted : false,
  };
}

function appendEventSafe(type, payload, taskId = null, eventId = null, actor = 'task-system') {
  return store.appendEvent({ type, task_id: taskId, event_id: eventId, actor, payload });
}

/**
 * 结算编排（验收通过 / 超时自动验收 / 争议裁定付接单人）。
 * 由 C 编排，A 记账；账本守恒；只追加流水；LedgerAnchored 演示。
 */
function settleTask(task, { rating = 0, auto = false, eventId = null, trigger = 'verify' } = {}) {
  const total = task.frozen_total;
  const bounty = task.bounty;
  const fee = task.freeze.service_fee;
  const solver = store.getUser(task.solver_id);
  const bonus = computeQualityBonus(bounty, rating);

  const legs = [
    { account: 'subject:escrow', delta: -total },
    { account: `user:${solver.user_id}`, delta: +bounty },
    { account: 'subject:platform_revenue', delta: +fee },
  ];
  if (bonus.amount > 0) {
    // 高质量奖励由生态激励池支出，仍进接单人 available 余额；按裁决不计入 net_sbc
    legs.push({ account: 'subject:eco_incentive', delta: -bonus.amount });
    legs.push({ account: `user:${solver.user_id}`, delta: +bonus.amount });
  }

  // 阶段 C 主代理裁决（路径 A）：不采用 SettlementRequested —— 该事件不在
  // CONTRACT §4 登记集合内，运行期事件名须全部收敛到契约登记集合。
  // 结算仍由 C 编排、A 记账，人工/规则兜底，模型不直判（下方为纯规则记账）。
  const entries = store.postLegs({
    event_id: ledgerEventId(eventId),
    task_id: task.task_id,
    rule_version: RULE_VERSION,
    memo: auto ? 'settle:超时自动验收结算' : 'settle:验收通过结算(赏金转付+服务费+高质量奖励)',
    legs,
  });

  // 用户积分榜聚合：方案 §4.1.5「赠送、补偿、邀请、活动奖励、争议中积分一律不计入，防止刷榜」。
  // 阶段 C 主代理最终裁决：net_sbc 只累加「已验收通过任务的赏金本金」。
  // 高质量奖励由生态激励池支出、仍进接单人 available，但属生态激励，不计入 net_sbc 与用户榜分。
  solver.stats.net_sbc = round2(solver.stats.net_sbc + bounty);
  solver.stats.completed_count += 1;
  solver.stats.total_count += 1;
  solver.stats.on_time_count += 1;
  if (Number(rating) > 0) {
    solver.stats.rating_sum += Number(rating);
    solver.stats.rating_count += 1;
  }

  task.state = 'SETTLED';
  task.settled_at = new Date().toISOString();
  task.settlement = {
    rule_version: RULE_VERSION,
    trigger,
    auto_verified: auto,
    bounty,
    service_fee: fee,
    quality_bonus: bonus,
    solver_credit: round2(bounty + bonus.amount),
    ledger_entries: entries.map((e) => e.seq),
    note: '赏金转付接单人、服务费入平台收入；模型不参与结算裁定',
  };

  appendEventSafe('CreditTransferred', {
    task_id: task.task_id, amount: bounty, to: solver.user_id, subject: 'available',
  }, task.task_id, eventId, 'ledger');
  appendEventSafe('CreditChanged', {
    task_id: task.task_id, subjects_changed: ['escrow', 'platform_revenue', 'eco_incentive', 'available'],
  }, task.task_id, eventId, 'ledger');
  appendEventSafe('SettlementCompleted', {
    task_id: task.task_id, state: 'SETTLED', bounty, service_fee: fee,
    quality_bonus: bonus.amount, auto_verified: auto,
  }, task.task_id, eventId);
  appendEventSafe('TaskDelisted', { task_id: task.task_id, reason: 'SETTLED' }, task.task_id, eventId, 'leaderboard');
  appendEventSafe('RankUpdated', { task_id: task.task_id, scope: 'user' }, task.task_id, eventId, 'leaderboard');

  // 按批次锚定流水 Merkle 根（本地演示；零 PII、零任务正文）
  const anchor = store.anchorLedger('settlement');
  task.settlement.anchor_id = anchor.anchor_id;

  return task.settlement;
}

/** 中性任务排序（关闭个性化时：时间 + 距离，不使用 RankScore 画像） */
function neutralTaskOrder(tasks) {
  return [...tasks]
    .filter((t) => !['CANCELLED', 'EXPIRED', 'CLOSED', 'REJECTED', 'DISCARDED'].includes(t.state))
    .sort((a, b) => {
      const d = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (d !== 0) return d;
      return (a.radius_km ?? 10) - (b.radius_km ?? 10);
    })
    .map((t, i) => ({
      rank: i + 1,
      task_id: t.task_id,
      title: t.title,
      state: t.state,
      bounty: t.bounty,
      rank_score: null,
      reason_codes: ['NEUTRAL_TIME', 'NEUTRAL_DISTANCE'],
      neutral_keys: { created_at: t.created_at, radius_km: t.radius_km },
    }));
}

// ---------------------------------------------------------------------------
// 接口实现（CONTRACT §8）
// ---------------------------------------------------------------------------

function hHealth() {
  return R.ok({
    status: 'healthy',
    service: 'sambon-prototype',
    version: 'v0.1',
    port: PORT,
    time: new Date().toISOString(),
    note: '零第三方依赖；内存存储，重启数据重置',
  });
}

/** POST /api/tasks 发布任务（合规预检 + 余额预校验；联系方式虚拟号占位） */
function hCreateTask(body) {
  return withIdempotency(body.event_id, () => createTaskImpl(body));
}

function createTaskImpl(body) {
  const required = ['publisher_id', 'title', 'description', 'category', 'bounty', 'acceptance_criteria'];
  for (const k of required) {
    if (body[k] === undefined || body[k] === null || body[k] === '') {
      return R.fail('MISSING_FIELD', `缺少必填字段：${k}`);
    }
  }
  const publisher = store.getUser(body.publisher_id);
  if (!publisher) return R.fail('UNKNOWN_PUBLISHER', '发布方不存在（演示用户见 /api/config）');
  if (publisher.role !== 'publisher') return R.fail('INVALID_ROLE', '该演示用户不是发布方角色');

  // 一票否决：违禁任务预检先于冻结与推送
  const check = compliancePrecheck(body.title, body.description, body.acceptance_criteria);
  if (!check.pass) {
    appendEventSafe('RiskBlocked', { reason_code: 'BANNED_WORDS', hits: check.hits }, null, body.event_id, 'risk');
    return R.fail('COMPLIANCE_BLOCKED', `合规预检未通过：命中违禁词 ${check.hits.join('、')}`, 422);
  }

  // CONTRACT §10.5 / docs/03 §4：未成年人限制准入钩子（布尔占位，零 PII 采集）
  const minorHook = minorRestrictionHook(body);
  if (!minorHook.passed) {
    appendEventSafe('RiskBlocked', {
      reason_code: minorHook.reason_code, hook: minorHook.hook, pii_collected: false,
    }, null, body.event_id, 'risk');
    return R.fail('MINOR_RESTRICTION_BLOCKED',
      '未成年人限制准入钩子拦截（布尔占位，未采集任何真实身份信息）', 422);
  }

  const bounty = round2(Number(body.bounty));
  if (!Number.isFinite(bounty) || bounty <= 0) return R.fail('INVALID_BOUNTY', '赏金必须为正数');
  const freeze = computeFreeze(bounty);
  if (publisher.available < freeze.total) {
    return R.fail('INSUFFICIENT_BALANCE', `可用 SBC 不足：需冻结 ${freeze.total}，当前 ${publisher.available}`);
  }

  const deadlineHours = Number(body.deadline_hours ?? 48);
  const now = new Date();
  const taskId = store.nextId('T');
  const task = {
    task_id: taskId,
    state: 'PENDING_REVIEW',          // 发布后待平台审核；冻结发生在审核通过（方案 §4.1.4）
    publisher_id: body.publisher_id,
    title: String(body.title),
    description: String(body.description),
    category: String(body.category),
    bounty,
    freeze,
    frozen_total: null,
    deadline_hours: deadlineHours,
    deadline: new Date(now.getTime() + deadlineHours * 3600 * 1000).toISOString(),
    acceptance_criteria: String(body.acceptance_criteria),
    online: Boolean(body.online ?? true),
    radius_km: Number(body.radius_km ?? 10),
    required_skills: Array.isArray(body.required_skills) ? body.required_skills : [],
    difficulty: Number(body.difficulty ?? 0.3),
    remaining_ratio: 1,
    publisher_credit_score: publisher.credit_score,
    exposure_accept_ratio: 0,
    qualified_solver_ratio: 0.6,
    // 联系方式一律虚拟号占位，忽略任何传入的真实号码（不存储明文 PII）
    virtual_contact: sanitizeContact(body.contact).contact,
    reject_count: 0,
    escrowed: false,
    created_at: now.toISOString(),
  };
  task.structure = extractTaskStructure(task);   // LLM 适配层规则化兜底 degraded:true
  const hooks = { minor_restriction: minorHook, report_entry: reportEntryHook() };
  const compliance = { ...check, hooks };
  task.compliance = compliance;
  store.putTask(task);

  appendEventSafe('TaskPublished', {
    task_id: taskId, state: 'PENDING_REVIEW', category: task.category,
    bounty, virtual_number_placeholder: true, compliance_pass: true,
    llm_degraded: task.structure.degraded,
    hooks_present: ['minor_restriction', 'report_entry'],
  }, taskId, body.event_id);

  return R.created({ task: taskView(task), compliance, rule_version: RULE_VERSION });
}

/** POST /api/tasks/:id/review 平台审核（通过→PUBLISHED 并冻结赏金+服务费） */
function hReview(body, [id]) {
  return withIdempotency(body.event_id, () => {
    const task = store.getTask(id);
    if (!task) return R.notFound('任务不存在');
    const decision = body.decision === 'reject' ? 'reject' : 'approve';
    const target = decision === 'reject' ? 'REJECTED' : 'PUBLISHED';
    if (!canTransition(task.state, target)) {
      return R.fail('ILLEGAL_TRANSITION', `非法状态迁移：${task.state} → ${target}`);
    }

    if (decision === 'reject') {
      task.state = 'REJECTED';
      appendEventSafe('TaskUpdated', { task_id: id, state: 'REJECTED', decision: 'reject' }, id, body.event_id);
      return R.ok({ task: taskView(task), decision });
    }

    const freeze = task.freeze;
    const publisher = store.getUser(task.publisher_id);
    if (publisher.available < freeze.total) {
      return R.fail('INSUFFICIENT_BALANCE', `可用 SBC 不足：需冻结 ${freeze.total}`);
    }
    // 审核通过：可用 → 冻结（赏金 + 5% 服务费）
    store.postLegs({
      event_id: ledgerEventId(body.event_id),
      task_id: id,
      memo: 'freeze:审核通过冻结赏金+5%服务费',
      legs: [
        { account: `user:${task.publisher_id}`, delta: -freeze.total },
        { account: 'subject:frozen', delta: +freeze.total },
      ],
    });
    task.frozen_total = freeze.total;
    task.state = 'PUBLISHED';

    appendEventSafe('CreditFrozen', {
      task_id: id, amount: freeze.total, bounty: freeze.bounty, service_fee: freeze.service_fee,
      rule_version: RULE_VERSION,
    }, id, body.event_id, 'ledger');
    appendEventSafe('TaskUpdated', { task_id: id, state: 'PUBLISHED', decision: 'approve' }, id, body.event_id);
    appendEventSafe('RankUpdated', { task_id: id, scope: 'task', action: 'listed' }, id, body.event_id, 'leaderboard');

    return R.ok({ task: taskView(task), decision, freeze, note: '赏金与 5% 服务费已冻结，等待推送' });
  });
}

/** POST /api/tasks/:id/dispatch 触发推送（Top-K + 分批扩量，支持 dry_run） */
function hDispatch(body, [id]) {
  const task = store.getTask(id);
  if (!task) return R.notFound('任务不存在');
  const dryRun = Boolean(body.dry_run);
  const ctx = {
    supply_ratio: Number(body.supply_ratio ?? 1.4),
    top_k: Number(body.top_k ?? 12),
    batch_size: Number(body.batch_size ?? 8),
    expand: body.expand !== false,
    expand_to: Number(body.expand_to ?? 30),
    channel: body.channel || 'platform_inbox',
  };

  // 服务端强制读取开关：忽略任何客户端传入的 personalized/enabled 参数
  const personalized = store.preferences.personalized_enabled;
  const compute = () => (personalized
    ? scoreCandidates(task, store.listSolvers(), ctx)
    : neutralCandidates(task, store.listSolvers(), ctx));

  let result;
  if (dryRun) {
    // dry_run 完全不落库、不改状态
    store.beginDryRun();
    try { result = compute(); } finally { store.endDryRun(); }
    return R.ok({
      dry_run: true,
      task_id: id,
      state_unchanged: task.state,
      weight_version: WEIGHT_VERSION,
      algorithm_degraded: true,
      personalized,
      ...result,
      note: 'dry_run 预览：未写入推送记录、事件与流水，任务状态不变',
    });
  }

  return withIdempotency(body.event_id, () => {
    if (!canTransition(task.state, 'DISPATCHING')) {
      return R.fail('ILLEGAL_TRANSITION', `非法状态迁移：${task.state} → DISPATCHING`);
    }
    result = compute();
    const dispatchId = store.nextId('D');
    task.state = 'DISPATCHING';

    // LLM 适配层仅产出语义匹配建议（degraded:true），不决定最终名单
    const topSolver = result.candidates.length ? store.getUser(result.candidates[0].solver_id) : null;
    const llmHint = topSolver ? semanticMatchHint(task, topSolver) : null;

    appendEventSafe('DispatchRequested', {
      task_id: id, dispatch_id: dispatchId, top_k: ctx.top_k, batch_size: ctx.batch_size,
      expand: ctx.expand, expand_to: ctx.expand_to,
    }, id, body.event_id);
    appendEventSafe('DispatchScored', {
      task_id: id, dispatch_id: dispatchId, weight_version: WEIGHT_VERSION,
      mode: result.mode, candidate_count: result.candidates.length,
      algorithm_degraded: true, llm_adapter_version: LLM_ADAPTER_VERSION,
    }, id, body.event_id, 'algorithm');
    appendEventSafe('DispatchSent', {
      task_id: id, dispatch_id: dispatchId,
      candidates: result.candidates.map((c) => ({
        solver_id: c.solver_id, rank: c.rank, score: c.score,
        reason_codes: c.reason_codes, batch: c.batch, channel: c.channel,
      })),
      batches: result.batches, weight_version: WEIGHT_VERSION,
    }, id, body.event_id, 'message');

    store.recordDispatch({
      task_id: id,
      dispatch_id: dispatchId,
      mode: result.mode,
      weight_version: WEIGHT_VERSION,
      algorithm_degraded: true,
      llm_adapter_version: LLM_ADAPTER_VERSION,
      candidates: result.candidates,
      filtered_out: result.filtered_out,
      strategy: result.strategy,
      batches: result.batches,
    });

    return R.ok({
      dispatch_id: dispatchId,
      task_id: id,
      state: task.state,
      weight_version: WEIGHT_VERSION,
      algorithm_degraded: true,        // 断言⑨：降级标记存在且推送不中断
      llm_adapter_version: LLM_ADAPTER_VERSION,
      personalized,
      personalization_enforcement: 'server_side',
      llm_hint: llmHint,
      note: personalized
        ? '规则版打分（LLM 降级为规则兜底，推送不中断）'
        : '已关闭个性化推荐：按时间 + 距离中性排序，服务端强制生效',
      ...result,
    });
  });
}

/** GET /api/tasks 任务列表（默认排除终态；?include_terminal=true 可查全量供审计） */
function hListTasks(_body, _params, query) {
  const terminal = ['REJECTED', 'CANCELLED', 'EXPIRED', 'CLOSED', 'DISCARDED'];
  const all = store.listTasks();
  const list = query.include_terminal === 'true' ? all : all.filter((t) => !terminal.includes(t.state));
  return R.ok({
    count: list.length,
    tasks: list.map(taskView),
    include_terminal: query.include_terminal === 'true',
    note: '默认不返回终态任务（PRD US-02）；带 ?include_terminal=true 可查全量供审计回放',
  });
}

/** GET /api/leaderboard/tasks 任务排行榜 */
function hLeaderboardTasks() {
  const personalized = store.preferences.personalized_enabled;
  if (!personalized) {
    return R.ok({
      rank_weight_version: 'neutral',
      mode: 'neutral',
      personalized: false,
      note: '已关闭个性化推荐：按时间 + 距离中性排序，RankScore 不参与',
      items: neutralTaskOrder(store.listTasks()),
    });
  }
  const board = rankTasks(store.listTasks(), { personalized: true, category_median_bounty: 100 });
  return R.ok(board);
}

/** GET /api/leaderboard/users 用户积分排行榜 */
function hLeaderboardUsers() {
  return R.ok(store.rankUsersSnapshot());
}

/** POST /api/tasks/:id/accept 接单（服务端原子锁，非竞赛制仅一人成功） */
function hAccept(body, [id]) {
  return withIdempotency(body.event_id, () => {
    const task = store.getTask(id);
    if (!task) return R.notFound('任务不存在');
    const solver = store.getUser(body.solver_id);
    if (!solver) return R.fail('UNKNOWN_SOLVER', '接单人不存在');
    if (solver.role !== 'solver') return R.fail('INVALID_ROLE', '该演示用户不是接单人角色');

    // 原子锁：先到先得，同步代码块在 Node 单线程内天然原子
    if (!store.tryLockTask(id, solver.user_id)) {
      return R.fail('TASK_ALREADY_ACCEPTED', '任务已被其他接单人锁定（非竞赛制仅一人成功）', 409);
    }
    if (!canTransition(task.state, 'ACCEPTED')) {
      store.releaseTaskLock(id);
      return R.fail('ILLEGAL_TRANSITION', `非法状态迁移：${task.state} → ACCEPTED`);
    }
    const filtered = hardFilter(task, solver);
    if (filtered) {
      store.releaseTaskLock(id);
      return R.fail('SOLVER_FILTERED', `接单人被硬过滤拦截：${filtered}`, 422);
    }

    // 冻结 → 托管：全额转托管（赏金 + 服务费），裁定/验收前任一方不可动
    const total = task.frozen_total;
    store.postLegs({
      event_id: ledgerEventId(body.event_id),
      task_id: id,
      memo: 'escrow:接单全额转托管(裁定前不转付)',
      legs: [
        { account: 'subject:frozen', delta: -total },
        { account: 'subject:escrow', delta: +total },
      ],
    });
    task.escrowed = true;
    task.state = 'ACCEPTED';
    task.solver_id = solver.user_id;
    solver.active_tasks = Number(solver.active_tasks ?? 0) + 1;

    appendEventSafe('TaskAccepted', {
      task_id: id, solver_id: solver.user_id, escrow_total: total, note: '全额托管，裁定前不转付',
    }, id, body.event_id);
    appendEventSafe('CreditChanged', {
      task_id: id, subjects_changed: ['frozen', 'escrow'], amount: total,
    }, id, body.event_id, 'ledger');
    appendEventSafe('TaskDelisted', { task_id: id, reason: 'ACCEPTED' }, id, body.event_id, 'leaderboard');
    appendEventSafe('RankUpdated', { task_id: id, scope: 'task', action: 'delisted_after_accept' }, id, body.event_id, 'leaderboard');

    return R.ok({
      task: taskView(task),
      escrow_total: total,
      note: '接单锁定成功；赏金全额托管，验收/裁定前不转付',
    });
  });
}

/** POST /api/tasks/:id/submit 提交成果 */
function hSubmit(body, [id]) {
  return withIdempotency(body.event_id, () => {
    const task = store.getTask(id);
    if (!task) return R.notFound('任务不存在');
    if (task.solver_id !== body.solver_id) return R.fail('NOT_ASSIGNED_SOLVER', '仅指派的接单人可提交成果');

    // 两步迁移：ACCEPTED → IN_PROGRESS → SUBMITTED（驳回后重提则仅 IN_PROGRESS → SUBMITTED）
    if (task.state === 'ACCEPTED') {
      if (!canTransition(task.state, 'IN_PROGRESS')) {
        return R.fail('ILLEGAL_TRANSITION', `非法状态迁移：${task.state} → IN_PROGRESS`);
      }
      task.state = 'IN_PROGRESS';
    }
    if (!canTransition(task.state, 'SUBMITTED')) {
      return R.fail('ILLEGAL_TRANSITION', `非法状态迁移：${task.state} → SUBMITTED`);
    }
    task.state = 'SUBMITTED';
    // 成果正文先做 PII 脱敏再落内存，原始明文不存储（CONTRACT §10.2）
    const safeResult = sanitizeSubmissionText(body.content ?? '演示成果（虚构）');
    task.result = {
      text: safeResult.text,
      pii_redacted: safeResult.pii_redacted,
      submitted_at: new Date().toISOString(),
    };
    task.submit_count = Number(task.submit_count ?? 0) + 1;

    // 事件日志不含成果正文，仅记录是否触发 PII 抹除
    appendEventSafe('TaskSubmitted', {
      task_id: id, solver_id: task.solver_id, submit_count: task.submit_count, state: 'SUBMITTED',
      pii_redacted: safeResult.pii_redacted, redacted_count: safeResult.redacted_count,
    }, id, body.event_id);

    return R.ok({ task: taskView(task), note: '成果已提交，等待发布方验收' });
  });
}

/** POST /api/tasks/:id/verify 验收（通过 / 驳回≤2次 / 超时自动验收可手动触发） */
function hVerify(body, [id]) {
  return withIdempotency(body.event_id, () => {
    const task = store.getTask(id);
    if (!task) return R.notFound('任务不存在');
    const decision = String(body.decision ?? 'approve');

    // 验收/驳回只在 SUBMITTED 受理；DISPUTED 状态必须走人工裁定，禁止借验收接口转付
    if (task.state !== 'SUBMITTED') {
      return R.fail('ILLEGAL_TRANSITION', `验收仅允许 SUBMITTED 状态，当前 ${task.state}（争议须经人工裁定）`);
    }

    if (decision === 'reject') {
      if (Number(task.reject_count ?? 0) >= MAX_REJECT) {
        return R.fail('REJECT_LIMIT', `驳回次数已达上限 ${MAX_REJECT} 次`);
      }
      if (!canTransition(task.state, 'IN_PROGRESS')) {
        return R.fail('ILLEGAL_TRANSITION', `非法状态迁移：${task.state} → IN_PROGRESS`);
      }
      task.reject_count = Number(task.reject_count ?? 0) + 1;
      task.state = 'IN_PROGRESS';
      appendEventSafe('TaskVerified', {
        task_id: id, decision: 'reject', reason: String(body.reason ?? ''), reject_count: task.reject_count,
      }, id, body.event_id);
      return R.ok({ task: taskView(task), decision, note: `驳回 ${task.reject_count}/${MAX_REJECT} 次，可重新提交` });
    }

    const auto = decision === 'auto_accept';
    if (decision !== 'approve' && !auto) return R.fail('INVALID_DECISION', 'decision 仅支持 approve / reject / auto_accept');
    if (!canTransition(task.state, 'SETTLED')) {
      return R.fail('ILLEGAL_TRANSITION', `非法状态迁移：${task.state} → SETTLED`);
    }

    const settlement = settleTask(task, {
      rating: Number(body.rating ?? 0),
      auto,
      eventId: body.event_id,
      trigger: auto ? 'auto_verify' : 'verify',
    });
    appendEventSafe('TaskVerified', {
      task_id: id, decision: auto ? 'auto_accept' : 'approve', state: 'SETTLED',
      auto_verify_hours: AUTO_VERIFY_HOURS, rating: Number(body.rating ?? 0),
    }, id, body.event_id);

    return R.ok({
      task: taskView(task),
      settlement,
      note: auto
        ? `发布方 ${AUTO_VERIFY_HOURS}h 未操作，超时自动验收（手动触发演示）`
        : '验收通过，已结算并广播 SettlementCompleted',
    });
  });
}

/** POST /api/tasks/:id/dispute 争议（全额托管，人工裁定前不转付） */
function hDispute(body, [id]) {
  return withIdempotency(body.event_id, () => {
    const task = store.getTask(id);
    if (!task) return R.notFound('任务不存在');
    const action = String(body.action ?? 'open');

    if (action === 'open') {
      if (!canTransition(task.state, 'DISPUTED')) {
        return R.fail('ILLEGAL_TRANSITION', `非法状态迁移：${task.state} → DISPUTED`);
      }
      // 确保全额托管：接单后已全额转 escrow；若仍在 frozen 则补一次转托管
      if (!task.escrowed && task.frozen_total) {
        store.postLegs({
          event_id: ledgerEventId(body.event_id),
          task_id: id,
          memo: 'escrow:争议发起全额转托管(裁定前不转付)',
          legs: [
            { account: 'subject:frozen', delta: -task.frozen_total },
            { account: 'subject:escrow', delta: +task.frozen_total },
          ],
        });
        task.escrowed = true;
      }
      task.state = 'DISPUTED';
      const summary = summarizeDispute({
        task_id: id,
        submit_count: task.submit_count ?? 1,
        reject_count: task.reject_count ?? 0,
      });
      appendEventSafe('DisputeOpened', {
        task_id: id, escrow_total: task.frozen_total, note: '全额托管，裁定前不转付',
        llm_summary_degraded: summary.degraded, model_decision: summary.decision,
        close_hours: DISPUTE_CLOSE_HOURS,
      }, id, body.event_id);
      appendEventSafe('RankUpdated', { task_id: id, scope: 'task', action: 'disputed_discount_50pct' }, id, body.event_id, 'leaderboard');

      return R.ok({
        task: taskView(task),
        escrow_total: task.frozen_total,
        escrow_subject: 'escrow',
        transferred: false,
        arbitration: '人工裁定（模型 decision=null，仅提供材料摘要）',
        llm_summary: summary,
        note: `争议中赏金全额托管于 escrow，裁定前不得转付；${DISPUTE_CLOSE_HOURS}h 内结案`,
      });
    }

    if (action === 'resolve') {
      if (task.state !== 'DISPUTED') {
        return R.fail('ILLEGAL_TRANSITION', `非法状态迁移：${task.state} 不是 DISPUTED，无法裁定`);
      }
      const resolution = String(body.resolution ?? 'refund_publisher');
      const total = task.frozen_total;
      const publisher = task.publisher_id;
      // 人工裁定（模型不直判），裁定后才分账
      if (resolution === 'pay_solver') {
        if (!canTransition(task.state, 'SETTLED')) return R.fail('ILLEGAL_TRANSITION', '非法状态迁移');
        settleTask(task, { rating: 0, eventId: body.event_id, trigger: 'dispute_resolution' });
      } else {
        store.postLegs({
          event_id: ledgerEventId(body.event_id),
          task_id: id,
          memo: 'refund:争议裁定全额退回发布方',
          legs: [
            { account: 'subject:escrow', delta: -total },
            { account: `user:${publisher}`, delta: +total },
          ],
        });
        task.state = resolution === 'close' ? 'CLOSED' : 'CANCELLED';
        appendEventSafe('CreditChanged', { task_id: id, subjects_changed: ['escrow', 'available'] }, id, body.event_id, 'ledger');
      }
      const summary = summarizeDispute({ task_id: id, submit_count: task.submit_count ?? 1, reject_count: task.reject_count ?? 0 });
      appendEventSafe('DisputeResolved', {
        task_id: id, resolution, state: task.state, arbitrator: '人工裁定演示',
        model_decision: summary.decision,
      }, id, body.event_id);

      return R.ok({
        task: taskView(task),
        resolution,
        arbitrator: '人工裁定演示',
        model_decision: null,
        llm_summary: summary,
        note: '裁定完成后才按结果分账；模型全程不直判',
      });
    }

    return R.fail('INVALID_ACTION', 'action 仅支持 open / resolve');
  });
}

/** GET /api/ledger/:userId 积分流水 + 五科目守恒 + Merkle 摘要 */
function hLedger(_body, [userId]) {
  if (!store.getUser(userId)) return R.notFound('用户不存在');
  return R.ok(store.getLedger(userId));
}

/** GET /api/events 事件流（可按 task_id 回放全链路） */
function hEvents(_body, _params, query) {
  return R.ok(store.getEvents(query.task_id || null));
}

/** GET /api/config 权重版本、算法降级状态、个性化开关 */
function hConfig() {
  return R.ok(store.config());
}

/** POST /api/preferences/personalized 关闭/开启个性化（服务端强制生效） */
function hPreferences(body) {
  return withIdempotency(body.event_id, () => {
    if (typeof body.enabled !== 'boolean') {
      return R.fail('INVALID_FIELD', 'enabled 必须为 boolean');
    }
    // 唯一写入点：服务端单一事实源，dispatch/榜单强制读取此值，忽略客户端传参
    store.preferences.personalized_enabled = body.enabled;
    appendEventSafe('PreferenceChanged', {
      personalized_enabled: body.enabled,
      enforcement: 'server_side',
      neutral_sort_rule: 'time + distance',
    }, null, body.event_id, 'compliance');
    return R.ok({
      personalized_enabled: body.enabled,
      enforcement: 'server_side',
      neutral_sort_rule: body.enabled ? null : 'time + distance',
      note: body.enabled
        ? '个性化推荐已开启，推送恢复规则版打分'
        : '个性化推荐已关闭，推送与榜单强制按时间 + 距离中性排序',
    });
  });
}

// ---------------------------------------------------------------------------
// 路由表（CONTRACT §8 全部接口；未登记路径一律 404）
// ---------------------------------------------------------------------------

const ROUTES = [
  ['GET', /^\/api\/health$/, hHealth],
  ['POST', /^\/api\/tasks$/, hCreateTask],
  ['POST', /^\/api\/tasks\/([^/]+)\/review$/, hReview],
  ['POST', /^\/api\/tasks\/([^/]+)\/dispatch$/, hDispatch],
  ['GET', /^\/api\/tasks$/, hListTasks],
  ['GET', /^\/api\/leaderboard\/tasks$/, hLeaderboardTasks],
  ['GET', /^\/api\/leaderboard\/users$/, hLeaderboardUsers],
  ['POST', /^\/api\/tasks\/([^/]+)\/accept$/, hAccept],
  ['POST', /^\/api\/tasks\/([^/]+)\/submit$/, hSubmit],
  ['POST', /^\/api\/tasks\/([^/]+)\/verify$/, hVerify],
  ['POST', /^\/api\/tasks\/([^/]+)\/dispute$/, hDispute],
  ['GET', /^\/api\/ledger\/([^/]+)$/, hLedger],
  ['GET', /^\/api\/events$/, hEvents],
  ['GET', /^\/api\/config$/, hConfig],
  ['POST', /^\/api\/preferences\/personalized$/, hPreferences],
];

let indexHtmlCache = null;
function getIndexHtml() {
  if (!IS_NODE || !readFileSync) return null;
  if (indexHtmlCache === null) {
    try { indexHtmlCache = readFileSync(INDEX_PATH, 'utf8'); } catch { indexHtmlCache = null; }
  }
  return indexHtmlCache;
}

function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let buf = '';
    req.on('data', (chunk) => {
      buf += chunk;
      if (buf.length > 1024 * 1024) {
        rejectBody(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!buf) return resolveBody({});
      try { resolveBody(JSON.parse(buf)); } catch { rejectBody(new Error('非法 JSON 请求体')); }
    });
    req.on('error', rejectBody);
  });
}

function reply(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': new TextEncoder().encode(text).length,
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

export async function handle(req, res) {
  let pathname = '/';
  let query = {};
  try {
    const url = new URL(req.url, 'http://localhost');
    pathname = url.pathname;
    query = Object.fromEntries(url.searchParams.entries());
  } catch {
    return reply(res, 400, { ok: false, data: null, error: { code: 'BAD_URL', message: '非法 URL' } });
  }

  // 静态操作台（GET / 与 /index.html）
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    const html = getIndexHtml();
    if (html === null) return reply(res, 404, R.notFound('操作台页面不存在').body);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': new TextEncoder().encode(html).length });
    return res.end(html);
  }

  let body = {};
  try {
    body = await readBody(req);
  } catch (e) {
    return reply(res, 400, R.fail('BAD_BODY', e.message).body);
  }

  for (const [method, re, handler] of ROUTES) {
    if (req.method !== method) continue;
    const m = re.exec(pathname);
    if (!m) continue;
    const params = m.slice(1).map(decodeURIComponent);
    try {
      const result = handler(body, params, query, req);
      return reply(res, result.status, result.body);
    } catch (e) {
      return reply(res, 500, R.fail('INTERNAL_ERROR', e.message, 500).body);
    }
  }

  // 未登记接口一律 404（SBC 转让/交易/法币兑换等接口从未实现 → 断言⑥）
  return reply(res, 404, R.notFound().body);
}

export function createAppServer() {
  if (!IS_NODE || !createServer) throw new Error('createAppServer 仅可在 Node.js 环境调用');
  return createServer((req, res) => { handle(req, res).catch(() => {}); });
}

// 浏览器 / Workers 侧不创建 HTTP 服务器，仅复用 handle() 编排逻辑。
export const server = IS_NODE ? createAppServer() : null;

const isMain = IS_NODE && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain && server) {
  server.listen(PORT, () => {
    console.log(`[sambon-prototype] listening on http://127.0.0.1:${PORT}`);
  });
}
