/**
 * 《三宝殿》初版原型 · 领域纯函数层（domain.mjs）
 *
 * 职责：状态机、积分规则、推送打分、榜单口径、LLM 适配层、合规预检。
 * 约束：纯函数、无副作用、不 import 任何外部模块（只用语言内置能力）。
 * 口径来源：CONTRACT.md §3/§5/§6/§7/§10 与《三宝殿项目方案_v1.0.md》。
 * 所有演示数据均为虚构样例。
 */

// ---------------------------------------------------------------------------
// 0. 通用小工具（纯函数）
// ---------------------------------------------------------------------------

export const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
export const round4 = (x) => Math.round((x + Number.EPSILON) * 10000) / 10000;
export const clamp01 = (x) => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));

/** 线性分位数（P5–P95 截断用），输入需已升序 */
function quantile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * 类目内 P5–P95 截断 + min-max 归一化（CONTRACT §6 / 方案 §3.3、§4.2.2）。
 * 全组同值时返回 0.5 中性值，避免 0 分导致排序失真。
 */
export function normalizeInCategory(values) {
  const n = values.length;
  if (n === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const p5 = quantile(sorted, 0.05);
  const p95 = quantile(sorted, 0.95);
  const span = p95 - p5;
  if (span < 1e-9) return values.map(() => 0.5);
  return values.map((v) => (Math.min(Math.max(v, p5), p95) - p5) / span);
}

// ---------------------------------------------------------------------------
// 1. 任务状态机（CONTRACT §3，唯一事实源在 C 任务管理系统）
// ---------------------------------------------------------------------------

export const STATE_MACHINE = Object.freeze({
  DRAFT: Object.freeze(['PENDING_REVIEW', 'DISCARDED']),
  PENDING_REVIEW: Object.freeze(['PUBLISHED', 'REJECTED']),
  PUBLISHED: Object.freeze(['DISPATCHING', 'CANCELLED']),
  DISPATCHING: Object.freeze(['ACCEPTED', 'EXPIRED', 'CANCELLED']),
  ACCEPTED: Object.freeze(['IN_PROGRESS', 'CANCELLED', 'EXPIRED']),
  IN_PROGRESS: Object.freeze(['SUBMITTED', 'EXPIRED', 'DISPUTED']),
  SUBMITTED: Object.freeze(['SETTLED', 'DISPUTED', 'IN_PROGRESS']), // IN_PROGRESS 为驳回
  DISPUTED: Object.freeze(['SETTLED', 'CANCELLED', 'CLOSED']),
  SETTLED: Object.freeze(['CLOSED']),
  REJECTED: Object.freeze([]),
  CANCELLED: Object.freeze([]),
  EXPIRED: Object.freeze([]),
  CLOSED: Object.freeze([]),
  DISCARDED: Object.freeze([]),
});

export const TERMINAL_STATES = Object.freeze(
  Object.keys(STATE_MACHINE).filter((s) => STATE_MACHINE[s].length === 0),
);

export const MAX_REJECT = 2;             // 驳回 ≤ 2 次
export const AUTO_VERIFY_HOURS = 24;     // 发布方 24h 未操作 → 自动验收（可手动触发）
export const DISPUTE_CLOSE_HOURS = 72;   // 争议 72h 结案

export function canTransition(from, to) {
  return (STATE_MACHINE[from] || []).includes(to);
}

export function isTerminal(state) {
  return TERMINAL_STATES.includes(state);
}

// ---------------------------------------------------------------------------
// 2. 积分规则（CONTRACT §5 / 方案 §4.1.4）
// ---------------------------------------------------------------------------

export const RULE_VERSION = 'sbc-rule-v1.0';
export const SERVICE_FEE_RATE = 0.05;            // 服务费 5%
export const CANCEL_COMPENSATION_RATE = 0.10;    // 已接单取消：10% 补偿接单人
export const QUALITY_BONUS_RATE = 0.02;          // 评价 ≥4.5 额外 +2% 赏金
export const QUALITY_BONUS_CAP = 50;             // 单任务上限 50 SBC
export const QUALITY_RATING_THRESHOLD = 4.5;
export const TIMEOUT_CREDIT_PENALTY = -5;        // 超时未完成信用分 −5

/** 发布审核通过：冻结 赏金 + 5% 服务费（可用 → 冻结） */
export function computeFreeze(bounty) {
  const amount = round2(bounty);
  const serviceFee = round2(amount * SERVICE_FEE_RATE);
  return {
    rule_version: RULE_VERSION,
    bounty: amount,
    service_fee: serviceFee,
    total: round2(amount + serviceFee),
  };
}

/** 取消（已接单，发布方原因）：90% 解冻 + 10% 补偿接单人 */
export function computeCancelSettlement(frozenTotal) {
  const compensation = round2(frozenTotal * CANCEL_COMPENSATION_RATE);
  return {
    rule_version: RULE_VERSION,
    total: round2(frozenTotal),
    refund: round2(frozenTotal - compensation),
    compensation,
  };
}

/** 高质量奖励：评价 ≥4.5 额外 +2% 赏金，单任务上限 50 SBC，生态激励支出 */
export function computeQualityBonus(bounty, rating) {
  if (Number(rating) < QUALITY_RATING_THRESHOLD) {
    return { rule_version: RULE_VERSION, applied: false, amount: 0, cap: QUALITY_BONUS_CAP };
  }
  const raw = round2(Number(bounty) * QUALITY_BONUS_RATE);
  const capped = Math.min(raw, QUALITY_BONUS_CAP);
  return {
    rule_version: RULE_VERSION,
    applied: true,
    amount: capped,
    cap: QUALITY_BONUS_CAP,
    capped: capped < raw,
  };
}

/** 超时未完成：不结算赏金，信用分 −5，释放冻结 */
export function timeoutCreditPenalty() {
  return { rule_version: RULE_VERSION, credit_delta: TIMEOUT_CREDIT_PENALTY };
}

/** 五个账本科目（CONTRACT §5 / 方案 §5.2） */
export const SUBJECTS = Object.freeze({
  AVAILABLE: 'available',
  FROZEN: 'frozen',
  ESCROW: 'escrow',
  PLATFORM_REVENUE: 'platform_revenue',
  ECO_INCENTIVE: 'eco_incentive',
});

// ---------------------------------------------------------------------------
// 3. 推送打分 Score(t,u)（CONTRACT §6 / 方案 §3.3）
// ---------------------------------------------------------------------------

export const WEIGHT_VERSION = 'v1.0';

/** 六项权重，和恒为 1.00 */
export const DISPATCH_WEIGHTS = Object.freeze({
  P_accept: 0.30,
  P_complete_on_time: 0.35,
  C_notify: 0.10,   // 减项
  R_risk: 0.10,     // 减项
  V_fairness: 0.08,
  B_supply: 0.07,
});

export const LEVEL_BOOST_CAP = 0.05; // 等级/榜单推送加权封顶总分 5%

/** 区域供需分段函数（B_supply 的原始值，0..1） */
function supplyScore(ratio) {
  // ratio = 待推送任务数 / 在线可接单数，越大越需要加速曝光
  if (!Number.isFinite(ratio) || ratio <= 0) return 0.2;
  if (ratio < 0.5) return 0.3;
  if (ratio < 1) return 0.5;
  if (ratio < 2) return 0.75;
  return 0.95;
}

/**
 * 硬过滤层（永远先于打分，风控一票拦截，不允许被高分覆盖）。
 * 返回 null 表示通过；否则返回过滤原因码。
 */
export function hardFilter(task, u) {
  if (!u || u.blacklisted) return 'RISK_BLACKLIST';
  const required = Array.isArray(task.required_skills) ? task.required_skills : [];
  const skills = Array.isArray(u.skills) ? u.skills : [];
  if (required.length > 0 && !required.some((s) => skills.includes(s))) {
    return 'QUALIFICATION_MISMATCH';
  }
  if (!task.online) {
    const radius = Number(task.radius_km ?? 10);
    const distance = Number(u.distance_km ?? 999);
    if (distance > radius) return 'OUT_OF_RADIUS';
  }
  if (Number(u.active_tasks ?? 0) >= Number(u.max_load ?? 3)) return 'LOAD_FULL';
  if (Number(u.push_count_today ?? 0) >= Number(u.daily_push_cap ?? 20)) return 'DAILY_PUSH_CAP';
  if ((u.related_publishers || []).includes(task.publisher_id)) return 'RELATED_PARTY';
  return null;
}

function rawFactors(task, u, ctx) {
  const categoryResp = (u.category_response && u.category_response[task.category]) ?? u.base_response ?? 0.5;
  const difficulty = Number(task.difficulty ?? 0.3);
  const remaining = Number(task.remaining_ratio ?? 1);
  return {
    P_accept: clamp01(categoryResp),
    P_complete_on_time: clamp01(
      Number(u.on_time_rate ?? 0.8) * (1 - difficulty * 0.2) * (1 - (1 - remaining) * 0.1),
    ),
    // 打扰成本：疲劳度 + 忽略率 + 当日推送占比，越高越差
    C_notify: clamp01(
      Number(u.fatigue ?? 0.2) * 0.6 +
        Number(u.ignore_rate ?? 0.1) * 0.4 +
        Number(u.push_count_today ?? 0) / Number(u.daily_push_cap ?? 20) * 0.3,
    ),
    R_risk: clamp01(Number(u.risk_score ?? 0.1)),
    // 长尾/新人探索曝光
    V_fairness: u.is_new ? 0.9 : clamp01(0.55 - Number(u.completed_count ?? 0) * 0.02),
    B_supply: supplyScore(ctx && ctx.supply_ratio),
  };
}

function buildReasonCodes(f, task, u, boostApplied) {
  const codes = [];
  if (f.P_accept >= 0.6) codes.push('HIGH_ACCEPT_PROB');
  if (f.P_complete_on_time >= 0.6) codes.push('HIGH_ON_TIME_COMPLETE');
  if (f.C_notify <= 0.4) codes.push('LOW_NOTIFY_COST');
  if (f.R_risk <= 0.3) codes.push('LOW_RISK');
  if (f.V_fairness >= 0.6) codes.push(u.is_new ? 'NEW_SOLVER_EXPLORE' : 'LONG_TAIL_EXPLORE');
  if (f.B_supply >= 0.6) codes.push('SUPPLY_BOOST');
  if (task.online || Number(u.distance_km ?? 999) <= Number(task.radius_km ?? 10) * 0.5) {
    codes.push('NEAR_DISTANCE');
  }
  const skills = Array.isArray(u.skills) ? u.skills : [];
  if ((task.required_skills || []).some((s) => skills.includes(s))) codes.push('CATEGORY_MATCH');
  if (boostApplied) codes.push('LEVEL_BOOST_CAPPED_5PCT'); // 等级加权已封顶 5%
  if (codes.length === 0) codes.push('BASELINE_RULE_MATCH');
  return codes;
}

/**
 * 个性化推送打分：硬过滤 → 类目内归一化 → 六项加权 → 等级加权（封顶 5%）。
 * ctx: { supply_ratio, top_k, batch_size, expand, expand_to, channel }
 */
export function scoreCandidates(task, users, ctx = {}) {
  const filteredOut = [];
  const pool = [];
  for (const u of users) {
    if (u.role && u.role !== 'solver') continue;
    const reason = hardFilter(task, u);
    if (reason) {
      filteredOut.push({ solver_id: u.user_id, name: u.name, reason_code: reason });
    } else {
      pool.push(u);
    }
  }

  const raws = pool.map((u) => rawFactors(task, u, ctx));
  const keys = Object.keys(DISPATCH_WEIGHTS);
  const norm = {};
  for (const k of keys) norm[k] = normalizeInCategory(raws.map((r) => r[k]));

  const topK = Math.max(1, Number(ctx.top_k ?? 12));
  const batchSize = Math.max(1, Number(ctx.batch_size ?? 8));
  const expandTo = Math.max(topK, Number(ctx.expand_to ?? 30));

  const scored = pool.map((u, i) => {
    const f = {};
    for (const k of keys) f[k] = round4(norm[k][i]);
    const contributions = {
      P_accept: round4(DISPATCH_WEIGHTS.P_accept * f.P_accept),
      P_complete_on_time: round4(DISPATCH_WEIGHTS.P_complete_on_time * f.P_complete_on_time),
      C_notify: round4(-DISPATCH_WEIGHTS.C_notify * f.C_notify),
      R_risk: round4(-DISPATCH_WEIGHTS.R_risk * f.R_risk),
      V_fairness: round4(DISPATCH_WEIGHTS.V_fairness * f.V_fairness),
      B_supply: round4(DISPATCH_WEIGHTS.B_supply * f.B_supply),
    };
    const rawScore = Object.values(contributions).reduce((a, b) => a + b, 0);
    // 等级/榜单加权封顶总分 5%：最多 +5%
    const requestedBoost = Math.max(0, Number(u.level_boost_rate ?? 0));
    const boost = Math.min(requestedBoost, LEVEL_BOOST_CAP);
    const score = round4(rawScore * (1 + boost));
    return {
      solver_id: u.user_id,
      name: u.name,
      score,
      raw_score: round4(rawScore),
      factors: f,
      contributions,
      weights: DISPATCH_WEIGHTS,
      weight_version: WEIGHT_VERSION,
      level_boost_applied: round4(boost),
      reason_codes: buildReasonCodes(f, task, u, boost > 0),
    };
  });

  scored.sort((a, b) => b.score - a.score || a.solver_id.localeCompare(b.solver_id));

  // Top-K 截断 + 分批扩量节奏（方案 §3.4 S1/S2 基线）
  const winners = scored.slice(0, topK).map((c, i) => ({
    ...c,
    rank: i + 1,
    batch: Math.floor(i / batchSize) + 1,
    channel: ctx.channel || 'platform_inbox',
  }));
  const batches = buildBatches(winners.length, batchSize, expandTo, ctx.expand !== false);

  return {
    mode: 'personalized',
    personalized: true,
    scoring: 'weighted_v1.0',
    weight_version: WEIGHT_VERSION,
    dispatch_weights: DISPATCH_WEIGHTS,
    level_boost_cap: LEVEL_BOOST_CAP,
    strategy: { top_k: topK, batch_size: batchSize, expand: ctx.expand !== false, expand_to: expandTo },
    batches,
    candidates: winners,
    filtered_out: filteredOut,
    pool_size: pool.length,
  };
}

/** 分批扩量节奏描述（仅编排元数据，不真实触达） */
function buildBatches(selected, batchSize, expandTo, expand) {
  const out = [];
  let offset = 0;
  let batch = 1;
  while (offset < selected) {
    const size = Math.min(batchSize, selected - offset);
    out.push({ batch, size: size, from_rank: offset + 1, to_rank: offset + size, window_min: batch === 1 ? 3 : 10 });
    offset += size;
    batch += 1;
  }
  if (expand && out.length) {
    out.push({ batch: batch, size: 0, note: `无响应则扩量至 ${expandTo} 人并放宽半径 20%（转人工干预上限）` });
  }
  return out;
}

/**
 * 中性排序（关闭个性化推荐后，服务端强制生效，CONTRACT §10.4）。
 * 只按「时间 + 距离」，不使用任何个性化因子，不产出个性化 reason_codes。
 */
export function neutralCandidates(task, users, ctx = {}) {
  const filteredOut = [];
  const pool = [];
  for (const u of users) {
    if (u.role && u.role !== 'solver') continue;
    const reason = hardFilter(task, u);
    if (reason) filteredOut.push({ solver_id: u.user_id, name: u.name, reason_code: reason });
    else pool.push(u);
  }
  // 中性键：注册时间（早者优先）+ 距离（近者优先）；二者皆非个性化画像
  pool.sort((a, b) => {
    const t = (a.registered_at ?? 0) - (b.registered_at ?? 0);
    if (t !== 0) return t;
    return (a.distance_km ?? 0) - (b.distance_km ?? 0);
  });
  const topK = Math.max(1, Number(ctx.top_k ?? 12));
  const candidates = pool.slice(0, topK).map((u, i) => ({
    solver_id: u.user_id,
    name: u.name,
    rank: i + 1,
    score: null,                    // 中性排序不使用打分
    personalized: false,
    reason_codes: ['NEUTRAL_DISTANCE', 'NEUTRAL_TIME'],
    neutral_keys: { distance_km: u.distance_km ?? null, registered_at: u.registered_at ?? null },
    batch: 1,
    channel: ctx.channel || 'platform_inbox',
  }));
  return {
    mode: 'neutral',
    personalized: false,
    scoring: 'bypassed',           // 打分器不参与
    weight_version: WEIGHT_VERSION,
    note: '已关闭个性化推荐：按时间 + 距离中性排序，服务端强制生效',
    strategy: { top_k: topK, expand: false },
    batches: [{ batch: 1, size: candidates.length, note: '中性批次，不做扩量加权' }],
    candidates,
    filtered_out: filteredOut,
    pool_size: pool.length,
  };
}

// ---------------------------------------------------------------------------
// 4. 榜单口径（CONTRACT §7 / 方案 §4.1.5、§4.2.2）
// ---------------------------------------------------------------------------

export const RANK_WEIGHT_VERSION = 'v1.0';

export const TASK_RANK_WEIGHTS = Object.freeze({
  value: 0.25,            // 悬赏价值
  urgency: 0.20,          // 紧迫度
  feasibility: 0.20,      // 完成可行性
  publisher_credit: 0.15, // 发布方信用
  heat: 0.10,             // 热度/竞争度（过度竞争反向降权）
  quality: 0.10,          // 质量与清晰度
});

export const USER_RANK_WEIGHTS = Object.freeze({
  net_sbc: 0.55,          // 净获得 SBC（仅已验收通过任务）
  completed_count: 0.20,  // 有效完成单量
  weighted_rating: 0.15,  // 加权评价（贝叶斯平滑 m=10）
  on_time_rate: 0.10,     // 准时率
});

export const BAYES_M = 10;
export const BAYES_PRIOR = 4.2;

/**
 * 任务榜：六维在同类目内归一化后加权。
 * 争议中任务打标降权 50%；付费置顶不参与自然排序（本原型不实现广告位）。
 */
export function rankTasks(tasks, ctx = {}) {
  const valid = tasks.filter((t) => !['CANCELLED', 'EXPIRED', 'CLOSED', 'REJECTED', 'DISCARDED'].includes(t.state));
  const median = Number(ctx.category_median_bounty ?? 100);
  const raw = valid.map((t) => {
    const bounty = Number(t.bounty ?? 0);
    return {
      value: Math.log1p(bounty / Math.max(1, median)),
      urgency: clamp01(1 - Number(t.remaining_ratio ?? 1)) + (Number(t.remaining_ratio ?? 1) < 0.3 ? 0.3 : 0),
      feasibility: clamp01(0.55 + Number(t.qualified_solver_ratio ?? 0.3) * 0.5),
      publisher_credit: clamp01(Number(t.publisher_credit_score ?? 100) / 100),
      // 热度：过度竞争反向降权（曝光-接单比越高越降）
      heat: clamp01(0.6 - Number(t.exposure_accept_ratio ?? 0) * 0.05),
      quality: clamp01(Number(t.structure_completeness ?? 0.8)),
    };
  });
  const keys = Object.keys(TASK_RANK_WEIGHTS);
  const norm = {};
  for (const k of keys) norm[k] = normalizeInCategory(raw.map((r) => r[k]));
  const scored = valid.map((t, i) => {
    const f = {};
    for (const k of keys) f[k] = round4(norm[k][i]);
    let score = keys.reduce((s, k) => s + TASK_RANK_WEIGHTS[k] * f[k], 0);
    const disputed = t.state === 'DISPUTED';
    if (disputed) score *= 0.5; // 争议中降权 50%
    const topFactors = keys
      .map((k) => ({ factor: k, weight: TASK_RANK_WEIGHTS[k], contribution: round4(TASK_RANK_WEIGHTS[k] * f[k]) }))
      .sort((a, b) => b.contribution - a.contribution)
      .slice(0, 3);
    return {
      task_id: t.task_id,
      title: t.title,
      category: t.category,
      state: t.state,
      bounty: t.bounty,
      rank_score: round4(score),
      factors: f,
      top_factors: topFactors,
      disputed_discount: disputed,
    };
  });
  scored.sort((a, b) => b.rank_score - a.rank_score || a.task_id.localeCompare(b.task_id));
  return {
    rank_weight_version: RANK_WEIGHT_VERSION,
    weights: TASK_RANK_WEIGHTS,
    mode: ctx.personalized === false ? 'neutral' : 'natural',
    personalized: ctx.personalized !== false,
    items: scored.map((s, i) => ({ ...s, rank: i + 1 })),
  };
}

/**
 * 用户积分榜：四维加权（CONTRACT §7）。
 * 仅「已验收通过任务的净获得 SBC」计入；补偿/邀请/活动/争议中一律不计入（由 store 聚合保证）。
 */
export function rankUsers(userStats, ctx = {}) {
  const list = Array.isArray(userStats) ? userStats : [];
  const raw = list.map((s) => ({
    net_sbc: Math.log1p(Math.max(0, Number(s.net_sbc ?? 0))),
    completed_count: Number(s.completed_count ?? 0),
    // 贝叶斯平滑 (sum + m·prior)/(n + m)
    weighted_rating:
      (Number(s.rating_sum ?? 0) + BAYES_M * BAYES_PRIOR) /
      (Number(s.rating_count ?? 0) + BAYES_M),
    // 样本 < 5 单取类目先验
    on_time_rate: Number(s.total_count ?? 0) < 5
      ? Number(ctx.category_on_time_prior ?? 0.9)
      : clamp01(Number(s.on_time_count ?? 0) / Number(s.total_count ?? 1)),
  }));
  const keys = Object.keys(USER_RANK_WEIGHTS);
  const norm = {};
  for (const k of keys) norm[k] = normalizeInCategory(raw.map((r) => r[k]));
  const scored = list.map((s, i) => {
    const f = {};
    for (const k of keys) f[k] = round4(norm[k][i]);
    const score = keys.reduce((sum, k) => sum + USER_RANK_WEIGHTS[k] * f[k], 0);
    return {
      user_id: s.user_id,
      name: s.name,
      net_sbc: round2(s.net_sbc ?? 0),
      completed_count: s.completed_count ?? 0,
      weighted_rating: round4(raw[i].weighted_rating),
      on_time_rate: round4(raw[i].on_time_rate),
      rank_score: round4(score),
      factors: f,
    };
  });
  scored.sort((a, b) => b.rank_score - a.rank_score || a.user_id.localeCompare(b.user_id));
  return {
    rank_weight_version: RANK_WEIGHT_VERSION,
    weights: USER_RANK_WEIGHTS,
    note: '计入口径：仅已验收通过任务的净获得 SBC；赠送/补偿/邀请/活动/争议中积分不计入',
    items: scored.map((s, i) => ({ ...s, rank: i + 1 })),
  };
}

// ---------------------------------------------------------------------------
// 5. LLM 适配层（CONTRACT §6 / 方案 §3.4）：只留三个可替换接口
//    初版一律返回「规则化兜底结果 + degraded:true」；
//    不决定最终推送名单、不决定积分结算、不裁定争议（人工兜底）。
// ---------------------------------------------------------------------------

export const LLM_ADAPTER_VERSION = 'llm-adapter-rule-fallback-v1.0';

/** ① 任务描述结构化抽取与质量评分 */
export function extractTaskStructure(task) {
  const text = `${task.title || ''} ${task.description || ''} ${task.acceptance_criteria || ''}`;
  const hasCriteria = Boolean(task.acceptance_criteria && String(task.acceptance_criteria).trim());
  const hasCategory = Boolean(task.category);
  const hasDeadline = Boolean(task.deadline_hours || task.deadline);
  const completeness = clamp01((hasCriteria ? 0.4 : 0) + (hasCategory ? 0.3 : 0) + (hasDeadline ? 0.3 : 0));
  return {
    degraded: true,                       // 规则化兜底，未接真实大模型
    adapter_version: LLM_ADAPTER_VERSION,
    category: task.category || '未分类',
    structured: {
      标的: task.title || '（未提供）',
      线上或线下: task.online ? '线上' : '线下',
      工作量估计: text.length > 120 ? '较大' : text.length > 40 ? '中等' : '较小',
      难度系数: Number(task.difficulty ?? 0.3),
      验收标准明确度: hasCriteria ? '已填写' : '缺失',
    },
    quality_score: round4(completeness),
    structure_completeness: round4(completeness),
    note: '规则抽取兜底；真实模型接入后此字段可版本化替换，输出仅作特征，不决定结算/推送名单',
  };
}

/** ② 非标任务语义匹配打分与推荐理由（仅作为附加特征） */
export function semanticMatchHint(task, user) {
  const skills = Array.isArray(user.skills) ? user.skills : [];
  const required = Array.isArray(task.required_skills) ? task.required_skills : [];
  const hit = required.filter((s) => skills.includes(s));
  const matchScore = required.length === 0 ? 0.5 : clamp01(hit.length / required.length);
  return {
    degraded: true,
    adapter_version: LLM_ADAPTER_VERSION,
    task_id: task.task_id,
    solver_id: user.user_id,
    match_score: round4(matchScore),
    hint: hit.length ? `规则命中技能标签：${hit.join('、')}` : '无显式技能命中，使用类目先验',
    reason_codes: hit.length ? ['SEMANTIC_SKILL_MATCH'] : ['SEMANTIC_CATEGORY_PRIOR'],
    note: '仅作附加特征与理由文案；最终名单由规则打分层裁定',
  };
}

/** ③ 争议材料摘要与事实抽取（辅助人工，绝不直判） */
export function summarizeDispute(dispute) {
  return {
    degraded: true,
    adapter_version: LLM_ADAPTER_VERSION,
    task_id: dispute.task_id,
    summary: '规则化摘要：已汇总提交成果与验收记录，未做事实真伪判定。',
    facts: [
      { key: '提交次数', value: dispute.submit_count ?? 1 },
      { key: '驳回次数', value: dispute.reject_count ?? 0 },
      { key: '赏金托管状态', value: '全额托管，裁定前不转付' },
    ],
    suggested_actions: ['人工复核成果与验收标准', '按裁定结果分账或全额退回'],
    decision: null, // 模型不产出裁定结论
    note: '争议裁定必须由人工完成；模型输出仅为材料摘要，留痕可审计',
  };
}

// ---------------------------------------------------------------------------
// 6. 合规预检与虚拟号占位（CONTRACT §10.2 / §10.7 / 方案 §6.4）
// ---------------------------------------------------------------------------

/** 违禁词（仅用于发布预检，非用户输入采集项） */
export const BANNED_WORDS = Object.freeze([
  '代考', '代刷', '刷单', '赌博', '洗钱', '套现', '返利', '资金盘',
  '收益承诺', '保本', '法币兑换', '场外交易', '二级市场', '代币发行',
  '私聊交易', '加微信', '加QQ', '身份证号', '银行卡号', '真实手机号',
]);

export const VIRTUAL_NUMBER_PREFIX = '170';

/**
 * 虚拟号占位：始终返回虚构的虚拟号，绝不接收/存储真实号码。
 * seed 仅用于生成稳定的后 4 位，输入什么都不会被回显。
 */
export function makeVirtualNumber(seed = 'demo') {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const tail = String(h % 10000).padStart(4, '0');
  return `虚拟号 ${VIRTUAL_NUMBER_PREFIX}****${tail}`;
}

/** 联系方式脱敏：无论传入什么，只返回虚拟号占位，并声明已丢弃原始输入 */
export function sanitizeContact(_raw) {
  return {
    contact: makeVirtualNumber('sambon-contact'),
    stored_plaintext_pii: false,
    note: '联系方式一律使用平台虚拟号占位；不采集、不存储明文手机号/身份证',
  };
}

/** 发布合规预检：命中违禁词即拦截（一票否决，先于冻结与推送） */
export function compliancePrecheck(...texts) {
  const joined = texts.filter(Boolean).map(String).join(' \n ');
  const hits = BANNED_WORDS.filter((w) => joined.includes(w));
  return {
    pass: hits.length === 0,
    hits,
    virtual_number: makeVirtualNumber('precheck'),
    checked_at_rule: 'compliance-precheck-v1.0',
    note: hits.length ? `命中违禁词：${hits.join('、')}，禁止发布` : '未命中违禁词，进入人工抽检口径',
  };
}

/**
 * 成果正文 PII 脱敏（CONTRACT §10.2 / PRD US-06 验收条件③）。
 * 只返回脱敏后文本，绝不把原始明文（手机号/身份证号）写入内存任务对象。
 */
export function sanitizeSubmissionText(text) {
  const raw = String(text ?? '');
  let redacted = 0;
  // 顺序与边界很关键：18 位证件号中间恰好含一段可被手机号正则命中的 11 位数字，
  // 若先跑手机号会截断证件号、导致剩余地区码与末位残留。故证件号优先，且两条正则
  // 均加数字边界，避免长数字串被部分匹配（本地验证 V-14 发现的边界缺陷）。
  const cleaned = raw
    .replace(/(?<!\d)\d{17}[\dXx](?!\d)/g, () => { redacted += 1; return '[已脱敏]'; })
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, () => { redacted += 1; return '[已脱敏]'; });
  return {
    text: cleaned,
    pii_redacted: redacted > 0,
    redacted_count: redacted,
    original_stored: false,
    note: '成果正文统一做 PII 正则脱敏后才落内存；不存储明文手机号/身份证号',
  };
}

// ---------------------------------------------------------------------------
// 7. 上线一票否决项的「钩子占位」（CONTRACT §10.5 / docs/03 §4）
//    初版只保留可扩展钩子、布尔占位与可回放留痕，不新增 §8 之外的 HTTP 路径，
//    不采集任何真实身份信息；真实核验与处置流程为上线一票否决项（V8），不伪装已交付。
// ---------------------------------------------------------------------------

/**
 * 未成年人限制准入钩子：只读取布尔准入结论占位，绝不接收/存储生日、证件号、真实姓名。
 * 真实实名核验由客户端与模块 A 在上线前实现（V8）。
 */
export function minorRestrictionHook(input = {}) {
  const blocked = input.minor_blocked === true;
  return {
    hook: 'minor_restriction',
    hook_version: 'minor-restriction-hook-v0.1',
    enabled: true,
    passed: !blocked,
    reason_code: blocked ? 'MINOR_RESTRICTION_BLOCKED' : 'ADULT_VERIFIED_PLACEHOLDER',
    pii_collected: false,
    note: '初版仅保留准入钩子与布尔占位；不采集生日/证件/真实姓名，真实实名核验为上线一票否决项（V8）',
  };
}

/** 举报入口钩子：§8 无独立举报端点，初版只保留入口占位与运营处置留痕位置 */
export function reportEntryHook() {
  return {
    hook: 'report_entry',
    hook_version: 'report-entry-hook-v0.1',
    enabled: true,
    endpoint: null, // 严守 CONTRACT §8 接口清单，不新增路径
    entry_points: ['操作台任务详情/榜单条目入口占位', '运营处置留痕（事件流可回放）'],
    note: '初版仅保留入口钩子；举报 24h 处置率 100% 为上线一票否决项（V8），不伪装已交付',
  };
}
