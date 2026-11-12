/**
 * 《三宝殿》初版原型 · 内存仓储层（store.mjs）
 *
 * 职责：内存状态、幂等集合、不可变事件日志、不可变积分流水、五账本科目、
 *       node:crypto 流水 Merkle 摘要（LedgerAnchored 演示）、dry_run 不落库。
 * 约束：进程重启数据重置；零第三方依赖；零 PII、零任务正文写入流水/锚定摘要。
 * 口径来源：CONTRACT.md §4/§5/§10 与方案 §4.1.4、§5.2。
 */

import { sha256Hex, uuid } from './hash.mjs';
import {
  SUBJECTS,
  WEIGHT_VERSION,
  RANK_WEIGHT_VERSION,
  DISPATCH_WEIGHTS,
  TASK_RANK_WEIGHTS,
  USER_RANK_WEIGHTS,
  LLM_ADAPTER_VERSION,
  RULE_VERSION,
  LEVEL_BOOST_CAP,
  BANNED_WORDS,
  TIMEOUT_CREDIT_PENALTY,
  round2,
  round4,
  rankUsers,
} from './domain.mjs';

// ---------------------------------------------------------------------------
// 常量（虚构演示口径，非真实业务参数）
// ---------------------------------------------------------------------------

const ECO_POOL_INIT = 500;          // 生态激励池初始注入（虚构）
const LEDGER_VERSION = 'ledger-v0.1';

const sha256 = (s) => sha256Hex(String(s));

/**
 * 事件 payload 脱敏（阶段 C 收敛：键白名单 + 自由文本统一剥离）。
 *
 * - 键白名单：仅登记过的结构化 / 枚举 / 数值 / 标识 / 容器键允许进入事件日志，
 *   未登记键一律丢弃（description / title / content / criteria / phone / id_card 等
 *   任务正文与 PII 字段根本不落库），使「零 PII、零任务正文进入事件日志」与实现一致。
 * - 自由文本键（reason / note / hits / summary / memo / text / message 等）：只保留
 *   「存在性」，值一律替换为 '[已剥离]'，杜绝驳回理由等夹带手机号 / 证件号 / 任务正文。
 * - 白名单内的字符串仍做 PII 正则兜底抹除（纵深防御）。
 */
const PAYLOAD_KEY_ALLOWLIST = new Set([
  // 标识
  'task_id', 'dispatch_id', 'solver_id', 'publisher_id', 'user_id', 'to', 'anchor_id',
  // 版本 / 枚举 / 状态 / 规则
  'state', 'decision', 'action', 'resolution', 'scope', 'mode', 'subject', 'hook',
  'reason_code', 'trigger', 'enforcement', 'neutral_sort_rule', 'arbitrator', 'category',
  'account', 'channel', 'type', 'rule_version', 'weight_version', 'llm_adapter_version',
  'ledger_version', 'rank_weight_version', 'version',
  // 数值 / 计数 / 布尔
  'bounty', 'service_fee', 'quality_bonus', 'escrow_total', 'amount', 'total', 'fee',
  'top_k', 'batch_size', 'expand', 'expand_to', 'supply_ratio', 'rating', 'reject_count',
  'submit_count', 'candidate_count', 'ledger_count', 'redacted_count', 'close_hours',
  'auto_verify_hours', 'rank', 'score', 'batch', 'pii_hits', 'task_text_hits',
  'auto_verified', 'algorithm_degraded', 'llm_degraded', 'llm_summary_degraded',
  'compliance_pass', 'virtual_number_placeholder', 'pii_redacted', 'pii_collected',
  'personalized_enabled', 'no_ledger_write', 'model_decision', 'pii_on_chain',
  'task_text_on_chain', 'passed', 'enabled', 'degraded', 'dry_run', 'transferred',
  // 容器 / 数组 / 对象（其元素再递归）
  'candidates', 'batches', 'subjects_changed', 'on_chain_fields', 'privacy_scan',
  'reason_codes', 'hooks_present', 'weights', 'factors', 'contributions', 'neutral_keys',
  'filtered_out', 'items', 'ledger_entries', 'compliance', 'hooks', 'chain', 'ledger',
  // 锚定 / Merkle 元数据
  'merkle_root', 'prev_anchor_hash', 'anchor_hash',
  // 自由文本键：登记「存在性」，值在下方统一剥离
  'reason', 'note', 'summary', 'hits', 'memo', 'text', 'message', 'llm_summary',
]);

const FREE_TEXT_KEY = new Set([
  'reason', 'note', 'summary', 'hits', 'memo', 'text', 'message', 'llm_summary',
]);

function sanitizePayload(value, key = null) {
  if (Array.isArray(value)) return value.map((v) => sanitizePayload(v, key));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (!PAYLOAD_KEY_ALLOWLIST.has(k)) continue; // 键白名单：未登记键不写入事件日志
      if (FREE_TEXT_KEY.has(k)) { out[k] = '[已剥离]'; continue; } // 自由文本不落原值
      out[k] = sanitizePayload(v, k);
    }
    return out;
  }
  if (typeof value === 'string') {
    // 白名单内字符串仍做 PII 兜底抹除
    return value
      .replace(/1[3-9]\d{9}/g, '[已脱敏]')
      .replace(/\d{17}[\dXx]/g, '[已脱敏]');
  }
  return value;
}

/**
 * 上链摘要 PII / 任务正文扫描（演示用，结果应恒为 0）。
 *
 * 上链载荷由 Merkle 根 / 前序锚定哈希（32–64 位十六进制）与元数据拼成，
 * 哈希中的数字子串会偶发命中手机号 / 证件号正则而被误判为 PII（非确定性假阳性）。
 * 摘要是哈希值而非文本字段，故先剥离纯 hex 摘要片段，再对剩余明文扫描；
 * 口径与 tests/smoke.mjs 断言⑯对事件日志的过滤保持一致。
 * 导出供自检做确定性回归验证：真实 PII 文本仍必须能被检出，防止扫描被削弱成恒返回 0。
 */
export function scanAnchorText(text) {
  const s = String(text);
  const plain = s.replace(/[0-9a-f]{32,64}/gi, '[hash]');
  const piiHits =
    (plain.match(/1[3-9]\d{9}/g) || []).length +
    (plain.match(/\d{17}[\dXx]/g) || []).length;
  const taskTextHits = ['演示发布方', '接单人甲', '任务正文', '验收标准'].filter((w) => plain.includes(w)).length;
  return { pii_hits: piiHits, task_text_hits: taskTextHits };
}

// ---------------------------------------------------------------------------
// 演示用户（全部虚构，禁止替换成真实个人信息）
// ---------------------------------------------------------------------------

function demoUsers() {
  return [
    {
      user_id: 'U-PUB-A',
      name: '演示发布方A',
      role: 'publisher',
      available: 10000,          // 虚构演示余额，供多任务自检冻结使用
      credit_score: 100,
      registered_at: 1,
    },
    {
      user_id: 'U-OPS',
      name: '平台运营演示',
      role: 'ops',
      available: 0,
      credit_score: 100,
      registered_at: 0,
    },
    {
      user_id: 'U-SOLVER-JIA',
      name: '接单人甲',
      role: 'solver',
      available: 100,
      credit_score: 100,
      skills: ['资料整理', '跑腿', '社区服务'],
      on_time_rate: 0.95,
      base_response: 0.72,
      category_response: { 社区服务: 0.85, 资料整理: 0.8 },
      fatigue: 0.15,
      ignore_rate: 0.08,
      risk_score: 0.05,
      is_new: false,
      level_boost_rate: 0.03,          // < 5% 封顶
      completed_count: 12,
      active_tasks: 0,
      max_load: 3,
      push_count_today: 2,
      daily_push_cap: 20,
      distance_km: 1.2,
      blacklisted: false,
      related_publishers: [],
      registered_at: 5,
    },
    {
      user_id: 'U-SOLVER-YI',
      name: '接单人乙',
      role: 'solver',
      available: 100,
      credit_score: 98,
      skills: ['资料整理', '翻译', '设计'],
      on_time_rate: 0.88,
      base_response: 0.6,
      category_response: { 资料整理: 0.7, 翻译: 0.9 },
      fatigue: 0.35,
      ignore_rate: 0.2,
      risk_score: 0.12,
      is_new: false,
      level_boost_rate: 0.08,          // 超过 5%，应被封顶
      completed_count: 30,
      active_tasks: 1,
      max_load: 3,
      push_count_today: 8,
      daily_push_cap: 20,
      distance_km: 3.5,
      blacklisted: false,
      related_publishers: [],
      registered_at: 3,
    },
    {
      user_id: 'U-SOLVER-BING',
      name: '接单人丙',
      role: 'solver',
      available: 100,
      credit_score: 100,
      skills: ['资料整理', '社区服务'],
      on_time_rate: 0.8,
      base_response: 0.5,
      category_response: { 社区服务: 0.6 },
      fatigue: 0.1,
      ignore_rate: 0.05,
      risk_score: 0.08,
      is_new: true,                    // 新人探索池
      level_boost_rate: 0,
      completed_count: 0,
      active_tasks: 0,
      max_load: 3,
      push_count_today: 1,
      daily_push_cap: 20,
      distance_km: 0.8,
      blacklisted: false,
      related_publishers: [],
      registered_at: 9,
    },
    {
      user_id: 'U-SOLVER-DING',
      name: '接单人丁',
      role: 'solver',
      available: 100,
      credit_score: 92,
      skills: ['跑腿', '社区服务'],
      on_time_rate: 0.7,
      base_response: 0.4,
      category_response: { 社区服务: 0.5 },
      fatigue: 0.6,
      ignore_rate: 0.35,
      risk_score: 0.25,
      is_new: false,
      level_boost_rate: 0.02,
      completed_count: 8,
      active_tasks: 2,
      max_load: 3,
      push_count_today: 15,
      daily_push_cap: 20,
      distance_km: 6.0,
      blacklisted: false,
      related_publishers: [],
      registered_at: 2,
    },
    {
      user_id: 'U-SOLVER-WU',
      name: '接单人戊·风控演示',
      role: 'solver',
      available: 100,
      credit_score: 40,
      skills: ['资料整理'],
      on_time_rate: 0.5,
      base_response: 0.9,
      category_response: { 资料整理: 0.95 },
      fatigue: 0.0,
      ignore_rate: 0.0,
      risk_score: 0.9,
      is_new: false,
      level_boost_rate: 0,
      completed_count: 50,
      active_tasks: 0,
      max_load: 3,
      push_count_today: 0,
      daily_push_cap: 20,
      distance_km: 0.5,
      blacklisted: true,               // 风控黑名单：硬过滤一票拦截
      related_publishers: [],
      registered_at: 1,
    },
  ];
}

function emptyStats() {
  return {
    net_sbc: 0,            // 仅已验收通过任务的净获得 SBC
    completed_count: 0,
    rating_sum: 0,
    rating_count: 0,
    on_time_count: 0,
    total_count: 0,
  };
}

// ---------------------------------------------------------------------------
// MemoryStore
// ---------------------------------------------------------------------------

export class MemoryStore {
  constructor() {
    this.users = new Map();
    this.tasks = new Map();
    this.dispatches = [];            // 不可变推送记录
    this.events = [];                // 不可变事件日志
    this.ledger = [];                // 不可变积分流水（只追加）
    this.anchors = [];               // Merkle 锚定演示记录
    this.idempotency = new Map();    // event_id -> 缓存的响应结果（server 层）
    this.ledgerEventIds = new Set(); // 记账二级幂等（store 层铁律）
    this.taskLocks = new Map();      // task_id -> solver_id（服务端原子锁）
    this.preferences = { personalized_enabled: true }; // 服务端单一事实源，强制生效
    this.dryRun = false;
    this._seqEvent = 0;
    this._seqLedger = 0;
    this._lastLedgerHash = sha256('sambon-genesis');

    for (const u of demoUsers()) {
      this.users.set(u.user_id, { ...u, stats: emptyStats() });
    }
    this.subjects = {
      [SUBJECTS.FROZEN]: 0,
      [SUBJECTS.ESCROW]: 0,
      [SUBJECTS.PLATFORM_REVENUE]: 0,
      [SUBJECTS.ECO_INCENTIVE]: ECO_POOL_INIT,
    };
    this.totalSupply = round2(
      [...this.users.values()].reduce((s, u) => s + u.available, 0) + ECO_POOL_INIT,
    );
  }

  // -- 基础读写 -------------------------------------------------------------

  nextId(prefix) {
    return `${prefix}-${uuid().slice(0, 8)}`;
  }

  getUser(id) {
    return this.users.get(id) || null;
  }

  listUsers() {
    return [...this.users.values()];
  }

  listSolvers() {
    return this.listUsers().filter((u) => u.role === 'solver');
  }

  getTask(id) {
    return this.tasks.get(id) || null;
  }

  putTask(task) {
    this.tasks.set(task.task_id, task);
    return task;
  }

  listTasks() {
    return [...this.tasks.values()];
  }

  // -- dry_run --------------------------------------------------------------

  beginDryRun() { this.dryRun = true; }
  endDryRun() { this.dryRun = false; }

  // -- 幂等（server 层） ----------------------------------------------------

  getIdempotent(eventId) {
    return eventId ? this.idempotency.get(eventId) : undefined;
  }

  setIdempotent(eventId, result) {
    if (eventId) this.idempotency.set(eventId, result);
  }

  // -- 接单原子锁（非竞赛制先到先得） --------------------------------------

  tryLockTask(taskId, solverId) {
    if (this.taskLocks.has(taskId)) return false;
    this.taskLocks.set(taskId, solverId); // 同步代码块，Node 单线程内天然原子
    return true;
  }

  getTaskLock(taskId) {
    return this.taskLocks.get(taskId) || null;
  }

  releaseTaskLock(taskId) {
    return this.taskLocks.delete(taskId);
  }

  // -- 不可变事件日志 -------------------------------------------------------

  appendEvent({ type, task_id = null, event_id = null, actor = 'system', payload = {} }) {
    const rec = Object.freeze({
      seq: ++this._seqEvent,
      ts: new Date().toISOString(),
      type,
      task_id,
      event_id,
      version: 'v0.1',
      actor,
      payload: Object.freeze(sanitizePayload(payload)), // 零 PII、零任务正文
    });
    if (!this.dryRun) this.events.push(rec);
    return rec;
  }

  /** 事件流：可按 task_id 回放全链路 */
  getEvents(taskId = null) {
    const list = taskId ? this.events.filter((e) => e.task_id === taskId) : [...this.events];
    return {
      count: list.length,
      task_id: taskId,
      replayable: true,
      events: list,
    };
  }

  // -- 不可变积分流水 -------------------------------------------------------

  /** 读取某账户当前余额（account: "user:<id>" 或 "subject:<name>"） */
  getBalance(account) {
    const [kind, id] = String(account).split(':');
    if (kind === 'user') {
      const u = this.users.get(id);
      if (!u) throw new Error(`未知用户账户：${id}`);
      return u.available;
    }
    if (kind === 'subject') {
      if (!(id in this.subjects)) throw new Error(`未知账本科目：${id}`);
      return this.subjects[id];
    }
    throw new Error(`非法账户格式：${account}`);
  }

  _setBalance(account, value) {
    const [kind, id] = String(account).split(':');
    if (kind === 'user') this.users.get(id).available = round2(value);
    else this.subjects[id] = round2(value);
  }

  /**
   * 记账（只追加、不可变；冲正以反向流水实现）。
   * legs: [{ account: 'user:U-PUB-A', delta: -105 }, { account:'subject:frozen', delta:+105 }]
   * 铁律：legs 的 delta 之和必须为 0（五科目守恒）；同一 event_id 不重复记账。
   */
  postLegs({ event_id, task_id, rule_version = RULE_VERSION, memo = '', legs = [] }) {
    if (!event_id) throw new Error('记账必须携带 event_id');
    if (!this.dryRun && this.ledgerEventIds.has(event_id)) {
      // 二级幂等：直接返回已有流水，绝不追加第二条
      return this.ledger.filter((l) => l.event_id === event_id);
    }
    const sum = legs.reduce((s, l) => s + Number(l.delta), 0);
    if (Math.abs(sum) > 1e-6) {
      throw new Error(`账本不守恒：legs 合计 ${sum}，拒绝记账（event_id=${event_id}）`);
    }

    const safeMemo = String(memo).replace(/1[3-9]\d{9}/g, '[已脱敏]').replace(/\d{17}[\dXx]/g, '[已脱敏]');
    const batchId = this.nextId('BATCH');
    const ts = new Date().toISOString();

    // dry_run：基于当前余额计算预览，不写库、不改余额
    if (this.dryRun) {
      return legs.map((l, i) => ({
        seq: null, ts, event_id, batch_id: batchId, task_id, rule_version,
        account: l.account,
        subject: l.account.startsWith('subject:') ? l.account.split(':')[1] : SUBJECTS.AVAILABLE,
        delta: round2(l.delta),
        before: round2(this.getBalance(l.account)),
        after: round2(this.getBalance(l.account) + Number(l.delta)),
        direction: l.delta >= 0 ? 'credit' : 'debit',
        memo: safeMemo, leg_index: i, dry_run: true,
      }));
    }

    const entries = [];
    let prevHash = this._lastLedgerHash;
    for (let i = 0; i < legs.length; i += 1) {
      const l = legs[i];
      const before = round2(this.getBalance(l.account));
      const delta = round2(l.delta);
      const after = round2(before + delta);
      const seq = ++this._seqLedger;
      // 哈希输入只含数值与元数据：零 PII、零任务正文
      const hashInput = [
        seq, event_id, task_id, rule_version, l.account, delta, before, after, safeMemo, prevHash,
      ].join('|');
      const hash = sha256(hashInput);
      entries.push(Object.freeze({
        seq, ts, event_id, batch_id: batchId, task_id, rule_version,
        account: l.account,
        subject: l.account.startsWith('subject:') ? l.account.split(':')[1] : SUBJECTS.AVAILABLE,
        delta, before, after,
        direction: delta >= 0 ? 'credit' : 'debit',
        memo: safeMemo,
        prev_hash: prevHash,
        hash,
      }));
      this._setBalance(l.account, after);
      prevHash = hash;
    }
    for (const e of entries) this.ledger.push(e);
    this._lastLedgerHash = prevHash;
    this.ledgerEventIds.add(event_id);
    return entries;
  }

  /**
   * 反向流水冲正（CONTRACT §5 记账铁律 / docs/03 §4 §10.1 代码层必须项）。
   * 不删改原流水，按原 legs 逐条取反生成只追加的新流水，并复用 postLegs 的守恒校验与哈希链。
   * originalEventId 对应的原流水保持不可变；reversalEventId 为独立幂等键。
   */
  postReversal(originalEventId, reversalEventId, reason = '违规刷单冲正') {
    if (!reversalEventId) throw new Error('冲正必须携带独立 event_id');
    const originals = this.ledger.filter((l) => l.event_id === originalEventId);
    if (originals.length === 0) throw new Error(`无可冲正流水：${originalEventId}`);
    if (this.ledgerEventIds.has(reversalEventId)) {
      return this.ledger.filter((l) => l.event_id === reversalEventId);
    }
    const legs = originals.map((l) => ({ account: l.account, delta: -l.delta }));
    return this.postLegs({
      event_id: reversalEventId,
      task_id: originals[0].task_id,
      memo: `reversal:${reason}(原 event_id=${originalEventId})`,
      legs,
    });
  }

  /** 账本科目守恒校验（smoke 断言②用） */
  balanceCheck() {
    const userAvailable = round2([...this.users.values()].reduce((s, u) => s + u.available, 0));
    const total = round2(
      userAvailable +
      this.subjects[SUBJECTS.FROZEN] +
      this.subjects[SUBJECTS.ESCROW] +
      this.subjects[SUBJECTS.PLATFORM_REVENUE] +
      this.subjects[SUBJECTS.ECO_INCENTIVE],
    );
    return {
      balanced: Math.abs(total - this.totalSupply) < 1e-6,
      total,
      expected: round2(this.totalSupply),
      by_subject: {
        available_user_sum: userAvailable,
        frozen: round2(this.subjects[SUBJECTS.FROZEN]),
        escrow: round2(this.subjects[SUBJECTS.ESCROW]),
        platform_revenue: round2(this.subjects[SUBJECTS.PLATFORM_REVENUE]),
        eco_incentive: round2(this.subjects[SUBJECTS.ECO_INCENTIVE]),
      },
      ledger_entries: this.ledger.length,
    };
  }

  /** 用户积分流水查询（含科目快照与守恒结果） */
  getLedger(userId) {
    const user = this.getUser(userId);
    const account = `user:${userId}`;
    const entries = this.ledger.filter((l) => l.account === account);
    return {
      user_id: userId,
      name: user ? user.name : null,
      available: user ? round2(user.available) : null,
      credit_score: user ? user.credit_score : null,
      entries,
      subjects: this.balanceCheck().by_subject,
      balance_check: this.balanceCheck(),
      merkle: {
        root: this.computeMerkleRoot(),
        ledger_version: LEDGER_VERSION,
        anchored_batches: this.anchors.length,
      },
    };
  }

  // -- Merkle 摘要与 LedgerAnchored 演示 -----------------------------------

  /** 以流水 hash 为叶子计算 Merkle 根（本地演示，可插拔替换为许可链锚定） */
  computeMerkleRoot() {
    let level = this.ledger.map((l) => l.hash);
    if (level.length === 0) return sha256('empty-ledger');
    while (level.length > 1) {
      const next = [];
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i];
        const right = i + 1 < level.length ? level[i + 1] : left; // 奇数补位
        next.push(sha256(`${left}${right}`));
      }
      level = next;
    }
    return level[0];
  }

  /** 生成一次锚定记录并演示 LedgerAnchored 事件（零 PII、零任务正文上链） */
  anchorLedger(trigger = 'manual') {
    const root = this.computeMerkleRoot();
    const prev = this.anchors.length ? this.anchors[this.anchors.length - 1].anchor_hash : sha256('anchor-genesis');
    const anchorPayloadText = [root, this.ledger.length, LEDGER_VERSION, prev].join('|');
    const scan = scanAnchorText(anchorPayloadText);
    const anchorHash = sha256(anchorPayloadText);
    const rec = Object.freeze({
      anchor_id: this.nextId('ANCHOR'),
      ts: new Date().toISOString(),
      trigger,
      merkle_root: root,
      ledger_count: this.ledger.length,
      ledger_version: LEDGER_VERSION,
      prev_anchor_hash: prev,
      anchor_hash: anchorHash,
      // 上链内容仅哈希与元数据
      on_chain_fields: ['merkle_root', 'ledger_count', 'ledger_version', 'prev_anchor_hash', 'ts'],
      privacy_scan: { ...scan, pii_on_chain: false, task_text_on_chain: false },
      note: '本地 Merkle 摘要演示；零 PII、零任务正文；可插拔替换为许可链/合规 BaaS 锚定',
    });
    this.anchors.push(rec);
    this.appendEvent({
      type: 'LedgerAnchored',
      actor: 'ledger',
      payload: {
        anchor_id: rec.anchor_id,
        merkle_root: rec.merkle_root,
        ledger_count: rec.ledger_count,
        privacy_scan: rec.privacy_scan,
        on_chain_fields: rec.on_chain_fields, // 供自检验证上链白名单
      },
    });
    return rec;
  }

  // -- 推送记录 -------------------------------------------------------------

  recordDispatch(rec) {
    const frozen = Object.freeze({ ...rec, recorded_at: new Date().toISOString() });
    if (!this.dryRun) this.dispatches.push(frozen);
    return frozen;
  }

  getDispatches(taskId = null) {
    return taskId ? this.dispatches.filter((d) => d.task_id === taskId) : [...this.dispatches];
  }

  // -- 用户榜聚合（只计已验收通过净获得 SBC） ------------------------------

  userRankStats() {
    return this.listSolvers().map((u) => ({
      user_id: u.user_id,
      name: u.name,
      ...u.stats,
    }));
  }

  rankUsersSnapshot() {
    return rankUsers(this.userRankStats());
  }

  // -- 配置（GET /api/config 的数据源） ------------------------------------

  config() {
    return {
      service: 'sambon-prototype',
      version: 'v0.1',
      weight_version: WEIGHT_VERSION,
      rank_weight_version: RANK_WEIGHT_VERSION,
      rule_version: RULE_VERSION,
      dispatch_weights: DISPATCH_WEIGHTS,
      task_rank_weights: TASK_RANK_WEIGHTS,
      user_rank_weights: USER_RANK_WEIGHTS,
      level_boost_cap: LEVEL_BOOST_CAP,
      timeout_credit_penalty: TIMEOUT_CREDIT_PENALTY,
      algorithm: {
        degraded: true,                       // 断言⑨：降级标记存在
        llm_mode: 'rule_fallback',
        adapter_version: LLM_ADAPTER_VERSION,
        adapters: ['extractTaskStructure', 'semanticMatchHint', 'summarizeDispute'],
        llm_boundary: '模型仅做结构化抽取/语义匹配建议/争议材料摘要；不决定推送名单、结算与争议裁定',
        dispatch_continues_on_degrade: true,
      },
      personalized_enabled: this.preferences.personalized_enabled, // 断言⑦：开关可见
      personalization_enforcement: 'server_side',                  // 服务端强制生效
      neutral_sort_rule: 'time + distance',
      compliance: {
        sbc_transfer_or_redeem_api: false,   // 断言⑥：不存在转让/兑换接口
        plaintext_pii_storage: false,
        virtual_number_only: true,
        banned_words_count: BANNED_WORDS.length,
        manual_arbitration_required: true,
        zero_pii_on_chain: true,
        zero_task_text_on_chain: true,
        // CONTRACT §10.5：未成年人限制 / 举报入口钩子只保留占位，不新增 §8 之外的路径
        minor_restriction_hook: true,
        report_entry_hook: true,
        hooks_pii_free: true,
        hooks_note: '未成年人限制与举报入口仅保留钩子占位；真实实名核验与举报 24h 处置为上线一票否决项 V8，本轮不伪装已交付',
      },
      chain: {
        mode: 'local-merkle-demo',
        ledger_version: LEDGER_VERSION,
        anchors: this.anchors.length,
        merkle_root: this.computeMerkleRoot(),
      },
      ledger: this.balanceCheck(),
      demo_users: this.listUsers().map((u) => ({
        user_id: u.user_id, name: u.name, role: u.role, available: round2(u.available),
      })),
      note: '全部演示数据均为虚构样例；SBC 为平台内贡献积分凭证，不可转让、不可兑付法币、无收益承诺',
    };
  }
}

/** 工厂：每个进程一个实例，重启即重置 */
export function createStore() {
  return new MemoryStore();
}
