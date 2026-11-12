/**
 * 《三宝殿》初版 · 主代理独立本地验证脚本（tests/verify-local.mjs）
 *
 * 与 tests/smoke.mjs（研发自检）相互独立：本脚本由整合方编写，基准取自
 * CONTRACT.md v0.2 / 三宝殿项目方案_v1.0.md，不复用自检的断言实现。
 *
 * 覆盖：白盒规则单测 → HTTP 端到端数值勾稽 → 状态机/幂等/并发 →
 *       个性化开关 → 争议人工兜底 → 合规红线 → 静态页 → 性能 → 重启重置。
 *
 * 运行：node tests/verify-local.mjs   （零第三方依赖，自动起停子进程）
 * 退出码：0 = 全绿；1 = 存在 FAIL。
 */

import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import * as D from '../src/domain.mjs';

const SERVER_PATH = fileURLToPath(new URL('../src/server.mjs', import.meta.url));

// 验收基准：CONTRACT.md v0.2 §4 登记事件集合（独立于实现硬编码）
const CONTRACT_EVENTS = new Set([
  'TaskPublished', 'TaskUpdated', 'CreditFrozen', 'CreditTransferred', 'CreditChanged',
  'DispatchRequested', 'DispatchScored', 'DispatchSent', 'TaskAccepted',
  'DispatchExposed', 'DispatchIgnored', 'TaskSubmitted', 'TaskVerified',
  'DisputeOpened', 'DisputeResolved', 'SettlementCompleted', 'RankUpdated',
  'TaskDelisted', 'LedgerAnchored', 'RiskBlocked', 'PreferenceChanged',
]);

// 键名严格照 CONTRACT §6/§7 与 domain.mjs 导出的符号（大小写敏感）
const DISPATCH_W = { P_accept: 0.30, P_complete_on_time: 0.35, C_notify: 0.10, R_risk: 0.10, V_fairness: 0.08, B_supply: 0.07 };
const TASK_W = { value: 0.25, urgency: 0.20, feasibility: 0.20, publisher_credit: 0.15, heat: 0.10, quality: 0.10 };
const USER_W = { net_sbc: 0.55, completed_count: 0.20, weighted_rating: 0.15, on_time_rate: 0.10 };

let pass = 0;
let fail = 0;
const failures = [];
const metrics = {};

function check(name, cond, detail = '') {
  if (cond) {
    pass += 1;
    console.log('PASS  ' + name + (detail ? '  · ' + detail : ''));
  } else {
    fail += 1;
    failures.push(name + (detail ? ' | ' + detail : ''));
    console.log('FAIL  ' + name + (detail ? '  · ' + detail : ''));
  }
}
function group(t) { console.log('\n── ' + t + ' ──'); }
async function run(name, fn) {
  try { await fn(); } catch (e) { check(name + ' [执行异常]', false, String(e && e.message || e)); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const eid = (p) => `${p}-${randomUUID().slice(0, 12)}`;
const near = (a, b, eps = 1e-6) => Math.abs(Number(a) - Number(b)) < eps;

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createNetServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

let BASE = '';
let child = null;

function startServer(port) {
  child = spawn(process.execPath, [SERVER_PATH], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => { output += d.toString(); });
  child.stderr.on('data', (d) => { output += d.toString(); });
  child.on('error', () => {});
  BASE = `http://127.0.0.1:${port}`;
  return output;
}

async function waitHealth(timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(BASE + '/api/health'); if (r.ok) return true; } catch { /* 未就绪 */ }
    await sleep(100);
  }
  return false;
}

async function stopServer() {
  if (!child || child.killed) return;
  const p = child;
  await new Promise((resolve) => {
    p.once('exit', resolve);
    p.kill();
    setTimeout(resolve, 3000); // 兜底，避免卡死
  });
  child = null;
}

async function call(method, path, body) {
  const canHaveBody = method !== 'GET' && method !== 'HEAD';
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: canHaveBody && body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = {};
  try { json = JSON.parse(text); } catch { /* 静态页等非 JSON 响应 */ }
  return { status: r.status, text, ...json };
}

const errOf = (r) => (r && r.error ? `${r.error.code}:${r.error.message}` : 'no-error');

// 演示任务（全部虚构数据，bounty 由发布方余额自适应）
function taskBody(tag, bounty, extra = {}) {
  return {
    publisher_id: 'U-PUB-A',
    title: `本地验证任务 ${tag}`,
    description: '虚构样例：整理社区活动资料清单，按时交付，不涉及真实个人信息。',
    category: '资料整理',
    bounty,
    deadline_hours: 48,
    acceptance_criteria: '资料清单完整、格式清晰、按时提交',
    online: true,
    radius_km: 10,
    required_skills: ['资料整理'],
    event_id: eid('VPUB-' + tag),
    ...extra,
  };
}

async function fullFlow(tag, bounty, solver) {
  const pub = await call('POST', '/api/tasks', taskBody(tag, bounty));
  const tid = pub.ok ? pub.data.task.task_id : null;
  if (!tid) return { pub, tid: null };
  const rev = await call('POST', `/api/tasks/${tid}/review`, { decision: 'approve', event_id: eid('VREV-' + tag) });
  const dsp = await call('POST', `/api/tasks/${tid}/dispatch`, { top_k: 12, batch_size: 8, event_id: eid('VDSP-' + tag) });
  const acc = await call('POST', `/api/tasks/${tid}/accept`, { solver_id: solver, event_id: eid('VACC-' + tag) });
  const sub = await call('POST', `/api/tasks/${tid}/submit`, { solver_id: solver, content: '演示成果（虚构）', event_id: eid('VSUB-' + tag) });
  return { pub, tid, rev, dsp, acc, sub, solver };
}

// ---------------------------------------------------------------------------
async function main() {
  const port = await freePort();
  startServer(port);
  if (!(await waitHealth())) throw new Error('服务未在 12s 内就绪');
  metrics.port = port;

  try {
    // ── A. 基础、静态页、路由白名单、配置权重 ───────────────────────────
    group('A. 服务基础 / 静态页 / 路由白名单 / 配置权重');

    await run('A 组', async () => {
      const h = await call('GET', '/api/health');
      check('V-01 健康检查返回 200 且含版本与内存存储声明',
        h.status === 200 && h.ok === true && h.data.status === 'healthy' && /重启数据重置/.test(h.data.note),
        `${h.status} ${h.data.version} port=${h.data.port}`);

      const page = await call('GET', '/');
      const extScript = /<script[^>]+src=/i.test(page.text);
      const extLink = /<link[^>]+href=/i.test(page.text);
      check('V-02 静态操作台可访问、中文内容完整、零外部 CDN',
        page.status === 200 && /<html/i.test(page.text) && /三宝殿/.test(page.text) && !extScript && !extLink,
        `HTTP ${page.status}, ${page.text.length} 字符, 外链 script=${extScript} link=${extLink}`);

      const forbidden = [
        ['POST', '/api/sbc/transfer'], ['POST', '/api/sbc/redeem'], ['POST', '/api/sbc/exchange'],
        ['POST', '/api/sbc/withdraw'], ['POST', '/api/sbc/trade'], ['POST', '/api/payment/pay'],
        ['GET', '/api/wallet/cash'], ['POST', '/api/admin/auto_settle'],
      ];
      const fr = await Promise.all(forbidden.map(([m, p]) => call(m, p, { amount: 1 })));
      check('V-03 转让/兑换/交易/收益/越权结算类 8 个路径全部 404',
        fr.every((r) => r.status === 404 && r.ok === false),
        fr.map((r) => r.status).join(','));

      const cfg = await call('GET', '/api/config');
      const c = cfg.data;
      const eqW = (a, b) => Object.keys(a).length === Object.keys(b).length &&
        Object.keys(b).every((k) => near(a[k], b[k]));
      const weightsOK = eqW(c.dispatch_weights, DISPATCH_W) && eqW(c.task_rank_weights, TASK_W) && eqW(c.user_rank_weights, USER_W);
      check('V-04 三组权重与契约 §6/§7 完全一致，等级加权封顶 5%、超时扣分 −5',
        cfg.status === 200 && weightsOK && near(c.level_boost_cap, 0.05) && near(c.timeout_credit_penalty, -5),
        `dispatch=${Object.values(c.dispatch_weights).join('/')} task=${Object.values(c.task_rank_weights).join('/')} user=${Object.values(c.user_rank_weights).join('/')}`);
      metrics.demo_users = c.demo_users;
      metrics.initial_total = c.ledger.total;
      metrics.initial_publisher_available = c.demo_users.find((u) => u.user_id === 'U-PUB-A')?.available;
    });

    // 预算：按发布方余额自适应，留足 10 个任务的冻结余量
    const bounty = metrics.initial_publisher_available >= 2000 ? 100 : 20;
    metrics.bounty = bounty;
    metrics.freeze_total = D.computeFreeze(bounty).total;

    // ── B. 白盒规则单测（直接调用 domain 纯函数） ─────────────────────
    group('B. 白盒规则单测（积分 / 权重 / LLM 边界）');

    await run('B 组', async () => {
      const f = D.computeFreeze(100);
      check('V-05 冻结口径：赏金 100 → 服务费 5 → 合计 105，规则版本固定',
        f.bounty === 100 && f.service_fee === 5 && f.total === 105 && f.rule_version === 'sbc-rule-v1.0',
        JSON.stringify(f));

      const b1 = D.computeQualityBonus(100, 4.4);
      const b2 = D.computeQualityBonus(100, 4.5);
      const b3 = D.computeQualityBonus(5000, 5);
      check('V-06 质量奖励阈值 4.5 / 比例 2% / 单任务封顶 50 SBC',
        b1.applied === false && b1.amount === 0 && b2.applied === true && b2.amount === 2 &&
        b3.amount === 50 && b3.capped === true,
        `4.4→${b1.amount} 4.5→${b2.amount} 5000→${b3.amount}(capped=${b3.capped})`);

      const cancel = D.computeCancelSettlement(105);
      check('V-07 已接单取消 90% 解冻 + 10% 补偿；超时信用分 −5',
        near(cancel.refund, 94.5) && near(cancel.compensation, 10.5) &&
        D.timeoutCreditPenalty().credit_delta === -5,
        JSON.stringify(cancel) + ' penalty=' + JSON.stringify(D.timeoutCreditPenalty()));

      const sum = (o) => Object.values(o).reduce((s, x) => s + x, 0);
      const struct = D.extractTaskStructure({ title: '虚构', description: '虚构', category: '资料整理', bounty: 100 });
      const hint = D.semanticMatchHint({ category: '资料整理' }, { skills: ['资料整理'] });
      const dispute = D.summarizeDispute({ task_id: 'T-TEST' });
      const adapters = [struct, hint, dispute];
      check('V-08 三组权重和恒为 1；LLM 三适配器均 degraded 且 decision=null',
        near(sum(D.DISPATCH_WEIGHTS), 1) && near(sum(D.TASK_RANK_WEIGHTS), 1) && near(sum(D.USER_RANK_WEIGHTS), 1) &&
        adapters.every((a) => a.degraded === true && (a.decision === null || a.decision === undefined)),
        `dispatch=${sum(D.DISPATCH_WEIGHTS)} task=${sum(D.TASK_RANK_WEIGHTS)} user=${sum(D.USER_RANK_WEIGHTS)}`);
    });

    // ── C. 端到端主闭环 + 数值勾稽 ───────────────────────────────────
    group('C. 端到端主闭环与积分数值勾稽');

    let mainId = null;
    await run('C 组', async () => {
      const beforeCfg = (await call('GET', '/api/config')).data;
      const pub = await call('POST', '/api/tasks', taskBody('MAIN', bounty, { contact: '13800138000' }));
      mainId = pub.ok ? pub.data.task.task_id : null;
      const afterPub = (await call('GET', '/api/config')).data;
      check('V-09 发布 → PENDING_REVIEW；发布不冻结、联系方式仅虚拟号占位',
        pub.ok && pub.data.task.state === 'PENDING_REVIEW' &&
        near(afterPub.ledger.total, beforeCfg.ledger.total) &&
        afterPub.ledger.by_subject.frozen === 0 &&
        pub.data.task.virtual_contact !== '13800138000' &&
        pub.data.compliance.hooks.minor_restriction.passed === true,
        `state=${pub.data?.task?.state} contact=${pub.data?.task?.virtual_contact}`);

      const rev = await call('POST', `/api/tasks/${mainId}/review`, { decision: 'approve', event_id: eid('VREV-MAIN') });
      const cfgAfterRev = (await call('GET', '/api/config')).data;
      check('V-10 审核通过 → PUBLISHED 才冻结「赏金 + 5% 服务费」',
        rev.ok && rev.data.task.state === 'PUBLISHED' &&
        near(rev.data.freeze.total, metrics.freeze_total) &&
        near(cfgAfterRev.ledger.by_subject.frozen, metrics.freeze_total),
        `freeze=${rev.data?.freeze?.total} frozen=${cfgAfterRev.ledger.by_subject.frozen}`);

      const evBefore = (await call('GET', '/api/events')).data.events.length;
      const dry = await call('POST', `/api/tasks/${mainId}/dispatch`, {
        top_k: 12, batch_size: 8, dry_run: true, event_id: eid('VDRY-MAIN'),
      });
      const evAfter = (await call('GET', '/api/events')).data.events.length;
      const cfgAfterDry = (await call('GET', '/api/config')).data;
      check('V-11 dry_run 预览不落库：状态、事件数、流水数、账本均不变',
        dry.ok && dry.data.dry_run === true && dry.data.state_unchanged === 'PUBLISHED' &&
        evAfter === evBefore && cfgAfterDry.ledger.ledger_entries === cfgAfterRev.ledger.ledger_entries,
        `events ${evBefore}→${evAfter}, ledger=${cfgAfterDry.ledger.ledger_entries}`);

      const dsp = await call('POST', `/api/tasks/${mainId}/dispatch`, {
        top_k: 8, batch_size: 4, expand: true, expand_to: 20, event_id: eid('VDSP-MAIN'),
      });
      const cands = dsp.data?.candidates || [];
      const desc = cands.every((c, i) => i === 0 || (c.score ?? 0) <= (cands[i - 1].score ?? 0));
      check('V-12 推送：候选非空、按 Score 降序、reason_codes 可解释、Top-K 截断、降级标记',
        dsp.ok && cands.length > 0 && cands.length <= 8 && desc &&
        cands.every((c) => Array.isArray(c.reason_codes) && c.reason_codes.length > 0) &&
        dsp.data.weight_version === 'v1.0' && dsp.data.algorithm_degraded === true &&
        Array.isArray(dsp.data.batches) && dsp.data.batches.length > 0,
        `候选=${cands.length} 首位=${cands[0]?.solver_id} score=${cands[0]?.score} 批次=${dsp.data?.batches?.length}`);
      metrics.top_candidate = cands[0] ? { solver_id: cands[0].solver_id, score: cands[0].score, reasons: cands[0].reason_codes } : null;

      const solver = cands[0]?.solver_id || 'U-SOLVER-JIA';
      const acc = await call('POST', `/api/tasks/${mainId}/accept`, { solver_id: solver, event_id: eid('VACC-MAIN') });
      const cfgAfterAcc = (await call('GET', '/api/config')).data;
      check('V-13 接单原子锁 → 全额转托管，冻结归零、裁定前不转付',
        acc.ok && acc.data.task.state === 'ACCEPTED' &&
        near(acc.data.escrow_total, metrics.freeze_total) &&
        cfgAfterAcc.ledger.by_subject.frozen === 0 &&
        near(cfgAfterAcc.ledger.by_subject.escrow, metrics.freeze_total),
        `escrow=${cfgAfterAcc.ledger.by_subject.escrow} frozen=${cfgAfterAcc.ledger.by_subject.frozen}`);
      metrics.main_solver = solver;

      const PII_PHONE = '13800138000';
      const PII_ID = '110101199001011234';
      const sub = await call('POST', `/api/tasks/${mainId}/submit`, {
        solver_id: solver,
        content: `演示成果（虚构）：联系电话 ${PII_PHONE}，证件号 ${PII_ID}，请核对。`,
        event_id: eid('VSUB-MAIN'),
      });
      const evMainAtSubmit = (await call('GET', `/api/events?task_id=${mainId}`)).data.events;
      const evText = JSON.stringify(evMainAtSubmit);
      const submitEvt = evMainAtSubmit.find((e) => e.type === 'TaskSubmitted');
      const preview = String(sub.data?.task?.result_preview || '');
      // 强断言：脱敏后不得残留任何 ≥6 位连续数字（防止证件号被手机号正则部分截断后留下地区码/末位）
      const noDigitFragment = !/\d{6,}/.test(preview);
      check('V-14 成果正文 PII 脱敏：手机号/证件号完整抹除、无长数字残留、不进事件日志',
        sub.ok && sub.data.task.state === 'SUBMITTED' &&
        !preview.includes(PII_PHONE) && !preview.includes(PII_ID) && noDigitFragment &&
        !evText.includes(PII_PHONE) && !evText.includes(PII_ID) &&
        sub.data.task.result_pii_redacted === true &&
        submitEvt?.payload?.pii_redacted === true && submitEvt?.payload?.redacted_count >= 2,
        `result_pii_redacted=${sub.data?.task?.result_pii_redacted} 事件标记=${submitEvt?.payload?.pii_redacted}/${submitEvt?.payload?.redacted_count} 无长数字残留=${noDigitFragment} preview=${preview.slice(0, 46)}`);

      const ver = await call('POST', `/api/tasks/${mainId}/verify`, {
        decision: 'approve', rating: 4.8, event_id: eid('VVER-MAIN'),
      });
      const s = ver.data?.settlement;
      const fee = D.round2(bounty * 0.05);
      const bonus = D.computeQualityBonus(bounty, 4.8).amount;
      check('V-15 验收 → SETTLED；赏金/服务费/质量奖励/到账额逐项勾稽',
        ver.ok && ver.data.task.state === 'SETTLED' &&
        near(s.bounty, bounty) && near(s.service_fee, fee) &&
        near(s.quality_bonus.amount, bonus) && near(s.solver_credit, bounty + bonus) &&
        s.auto_verified === false && s.rule_version === 'sbc-rule-v1.0',
        `bounty=${s?.bounty} fee=${s?.service_fee} bonus=${s?.quality_bonus?.amount} credit=${s?.solver_credit}`);

      const led = (await call('GET', `/api/ledger/${solver}`)).data;
      check('V-16 五科目守恒：平台收入仅计服务费、生态激励支出奖励、Merkle 已锚定',
        led.balance_check.balanced === true &&
        near(led.subjects.platform_revenue, fee) &&
        led.entries.length >= 2 && led.merkle.root && led.merkle.anchored_batches >= 1,
        `balanced=${led.balance_check.balanced} total=${led.balance_check.total}/${led.balance_check.expected} ` +
        `platform_revenue=${led.subjects.platform_revenue} eco=${led.subjects.eco_incentive} anchors=${led.merkle.anchored_batches}`);
      metrics.settlement = s;

      const board = (await call('GET', '/api/leaderboard/users')).data;
      const me = board.items.find((x) => x.user_id === solver);
      check('V-17 用户榜 net_sbc 仅赏金本金，+2% 质量奖励不混入榜单分',
        near(me?.net_sbc, bounty) && me?.completed_count === 1,
        `net_sbc=${me?.net_sbc} (期望 ${bounty}) completed=${me?.completed_count} rank_score=${me?.rank_score}`);

      // 结算完成后重新取快照（V-14 时取的是提交阶段快照，不含结算事件）
      const replay = (await call('GET', `/api/events?task_id=${mainId}`)).data.events;
      const types = replay.map((e) => e.type);
      const mustHave = ['TaskPublished', 'CreditFrozen', 'DispatchRequested', 'DispatchScored', 'DispatchSent',
        'TaskAccepted', 'TaskSubmitted', 'TaskVerified', 'CreditTransferred', 'SettlementCompleted', 'TaskDelisted'];
      const allEvents = (await call('GET', '/api/events')).data.events.map((e) => e.type);
      check('V-18 事件按 task_id 可完整回放；事件名全部 ⊆ 契约 §4，无 SettlementRequested',
        mustHave.every((t) => types.includes(t)) && !allEvents.includes('SettlementRequested') &&
        allEvents.every((t) => CONTRACT_EVENTS.has(t)),
        `回放 ${replay.length} 条 [${[...new Set(types)].join(',')}] / 全局 ${allEvents.length} 条 / 唯一事件 ${new Set(allEvents).size} 种`);
      metrics.main_events = replay.length;
    });

    // ── D. 幂等 / 状态机 / 并发 / 驳回 ────────────────────────────────
    group('D. 幂等、状态机、并发接单与驳回上限');

    await run('D 组', async () => {
      const IDEM = eid('VIDEM');
      const body = taskBody('IDEM', bounty, { event_id: IDEM });
      const p1 = await call('POST', '/api/tasks', body);
      const p2 = await call('POST', '/api/tasks', body);
      const list = (await call('GET', '/api/tasks?include_terminal=true')).data.tasks;
      const same = list.filter((t) => t.task_id === p1.data?.task?.task_id);
      check('V-19 重复 event_id 幂等：同一 task_id、任务不重复创建',
        p1.ok && p2.ok && p1.data.task.task_id === p2.data.task.task_id && same.length === 1,
        `task_id=${p1.data?.task?.task_id}`);

      const illegal = await call('POST', `/api/tasks/${mainId}/accept`, {
        solver_id: 'U-SOLVER-YI', event_id: eid('VILLEGAL'),
      });
      check('V-20 非法状态迁移被拒：SETTLED 任务不可再接单',
        illegal.ok === false && illegal.status >= 400 &&
        /ILLEGAL_TRANSITION|TASK_ALREADY_ACCEPTED/.test(errOf(illegal)),
        `${illegal.status} ${errOf(illegal)}`);

      const cflow = await fullFlow('CONC', bounty, 'U-SOLVER-JIA');
      const solvers = ['U-SOLVER-YI', 'U-SOLVER-BING', 'U-SOLVER-DING'];
      const race = await Promise.all(solvers.map((sid, i) =>
        call('POST', `/api/tasks/${cflow.tid}/accept`, { solver_id: sid, event_id: eid('VRACE-' + i) })));
      // fullFlow 已由 U-SOLVER-JIA 接单，后续 3 人并发均应失败
      check('V-21 并发抢单：原子锁生效，后续 3 个并发请求全部被拒',
        cflow.acc?.ok === true && race.every((r) => r.ok === false && r.status === 409),
        `首个=${cflow.acc?.data?.task?.solver_id} 并发结果=${race.map((r) => r.status + '/' + errOf(r)).join(' | ')}`);

      const rflow = await fullFlow('REJ', bounty, 'U-SOLVER-BING');
      const r1 = await call('POST', `/api/tasks/${rflow.tid}/verify`, { decision: 'reject', reason: '格式不清', event_id: eid('VREJ1') });
      const s2 = await call('POST', `/api/tasks/${rflow.tid}/submit`, { solver_id: 'U-SOLVER-BING', content: '重提成果（虚构）', event_id: eid('VRESUB2') });
      const r2 = await call('POST', `/api/tasks/${rflow.tid}/verify`, { decision: 'reject', reason: '仍不清晰', event_id: eid('VREJ2') });
      const s3 = await call('POST', `/api/tasks/${rflow.tid}/submit`, { solver_id: 'U-SOLVER-BING', content: '二次重提（虚构）', event_id: eid('VRESUB3') });
      const r3 = await call('POST', `/api/tasks/${rflow.tid}/verify`, { decision: 'reject', reason: '第三次', event_id: eid('VREJ3') });
      check('V-22 驳回 ≤2 次、可重提；第 3 次触发 REJECT_LIMIT',
        r1.ok && r1.data.task.state === 'IN_PROGRESS' && s2.ok && r2.ok && s3.ok &&
        r3.ok === false && /REJECT_LIMIT/.test(errOf(r3)),
        `r1=${r1.data?.task?.state} r2=${r2.data?.task?.state} r3=${r3.status}/${errOf(r3)}`);
    });

    // ── E. 个性化推荐关闭（服务端强制） ──────────────────────────────
    group('E. 个性化推荐开关与中性排序');

    await run('E 组', async () => {
      const off = await call('POST', '/api/preferences/personalized', { enabled: false, event_id: eid('VPREF-OFF') });
      const cfg = (await call('GET', '/api/config')).data;
      const taskForNeutral = await call('POST', '/api/tasks', taskBody('NEUTRAL', bounty));
      const tid = taskForNeutral.data?.task?.task_id;
      await call('POST', `/api/tasks/${tid}/review`, { decision: 'approve', event_id: eid('VREV-NEUTRAL') });
      const d = await call('POST', `/api/tasks/${tid}/dispatch`, {
        top_k: 12, personalized: true, // 客户端试图覆盖，服务端必须忽略
        event_id: eid('VDSP-NEUTRAL'),
      });
      const board = (await call('GET', '/api/leaderboard/tasks')).data;
      check('V-23 关闭开关后 config 可见、服务端强制中性排序，客户端参数无法覆盖',
        off.ok && cfg.personalized_enabled === false && cfg.personalization_enforcement === 'server_side' &&
        d.ok && d.data.mode === 'neutral' && d.data.personalized === false &&
        d.data.candidates.length > 0 && d.data.candidates.every((c) => c.score === null) &&
        board.mode === 'neutral' && board.rank_weight_version === 'neutral' &&
        board.items.every((x) => x.rank_score === null),
        `mode=${d.data?.mode} 候选=${d.data?.candidates?.length} board=${board.mode}`);

      const on = await call('POST', '/api/preferences/personalized', { enabled: true, event_id: eid('VPREF-ON') });
      const board2 = (await call('GET', '/api/leaderboard/tasks')).data;
      check('V-24 重新开启后恢复 RankScore 打分（版本 v1.0）',
        on.ok && board2.rank_weight_version === 'v1.0' &&
        board2.items.length > 0 && board2.items.every((x) => typeof x.rank_score === 'number'),
        `榜单条目=${board2.items?.length} 首位 rank_score=${board2.items?.[0]?.rank_score}`);
    });

    // ── F. 争议与人工兜底 ────────────────────────────────────────────
    group('F. 争议全额托管与人工裁定');

    await run('F 组', async () => {
      const f = await fullFlow('DISP', bounty, 'U-SOLVER-YI');
      const pubBefore = (await call('GET', '/api/ledger/U-PUB-A')).data.available;
      // escrow 是全局科目（含其他未结任务托管额），故用「争议前后增量」而非绝对值判定
      const escrowBefore = (await call('GET', '/api/config')).data.ledger.by_subject.escrow;
      const open = await call('POST', `/api/tasks/${f.tid}/dispute`, { action: 'open', event_id: eid('VDISP-OPEN') });
      const escrowAfter = (await call('GET', '/api/config')).data.ledger.by_subject.escrow;
      const solverLed = (await call('GET', '/api/ledger/U-SOLVER-YI')).data;
      const paidBeforeRuling = solverLed.entries.filter((e) => e.task_id === f.tid && e.delta > 0).length;
      const openedEvt = (await call('GET', `/api/events?task_id=${f.tid}`)).data.events
        .find((e) => e.type === 'DisputeOpened');
      // 「模型不直判」的证据：DisputeOpened 事件 payload.model_decision 与 llm_summary.decision 均为 null
      const noModelVerdict = openedEvt?.payload?.model_decision === null &&
        open.data?.llm_summary?.degraded === true && open.data?.llm_summary?.decision === null;
      check('V-25 争议发起 → DISPUTED，赏金+服务费全额托管、transferred=false、模型 decision=null',
        open.ok && open.data.task.state === 'DISPUTED' && open.data.transferred === false &&
        near(open.data.escrow_total, metrics.freeze_total) && open.data.escrow_subject === 'escrow' &&
        noModelVerdict &&
        escrowAfter >= metrics.freeze_total && near(escrowAfter - escrowBefore, 0) &&
        paidBeforeRuling === 0,
        `escrow ${escrowBefore}→${escrowAfter} (Δ=0，接单时已全额托管) 裁定前转付笔数=${paidBeforeRuling} 事件 model_decision=${openedEvt?.payload?.model_decision}`);

      const bypass = await call('POST', `/api/tasks/${f.tid}/verify`, { decision: 'approve', rating: 5, event_id: eid('VDISP-BYPASS') });
      check('V-26 争议态禁止借验收接口转付，必须走人工裁定',
        bypass.ok === false && /ILLEGAL_TRANSITION/.test(errOf(bypass)),
        `${bypass.status} ${errOf(bypass)}`);

      const resolve = await call('POST', `/api/tasks/${f.tid}/dispute`, {
        action: 'resolve', resolution: 'refund_publisher', event_id: eid('VDISP-RES'),
      });
      const pubAfter = (await call('GET', '/api/ledger/U-PUB-A')).data;
      check('V-27 人工裁定退款：赏金 + 5% 服务费全额原路退回，模型全程不直判',
        resolve.ok && resolve.data.model_decision === null &&
        ['CANCELLED', 'CLOSED'].includes(resolve.data.task.state) &&
        near(pubAfter.available - pubBefore, metrics.freeze_total) &&
        pubAfter.balance_check.balanced === true,
        `发布方余额 ${pubBefore} → ${pubAfter.available} (Δ=${D.round2(pubAfter.available - pubBefore)}, 期望 ${metrics.freeze_total})`);
    });

    // ── G. 合规红线 ──────────────────────────────────────────────────
    group('G. 合规预检与全量日志脱敏');

    await run('G 组', async () => {
      const word = D.BANNED_WORDS[0];
      const bad = await call('POST', '/api/tasks', taskBody('BANNED', bounty, {
        title: `违禁预检验证 ${word}`, description: `包含 ${word} 的虚构测试描述`,
      }));
      const ev = (await call('GET', '/api/events')).data.events;
      check('V-28 违禁任务预检先于冻结，返回 422 并留痕 RiskBlocked',
        bad.status === 422 && /COMPLIANCE_BLOCKED/.test(errOf(bad)) &&
        ev.some((e) => e.type === 'RiskBlocked' && e.payload?.reason_code === 'BANNED_WORDS'),
        `命中词="${word}" ${bad.status}/${errOf(bad)} RiskBlocked=${ev.filter((e) => e.type === 'RiskBlocked').length}`);

      const allEv = JSON.stringify((await call('GET', '/api/events')).data.events);
      const phoneHit = /1[3-9]\d{9}/.test(allEv);
      const idHit = /\d{17}[\dXx]/.test(allEv);
      const taskTextHit = allEv.includes('整理社区活动资料清单');
      const cfgC = (await call('GET', '/api/config')).data;
      check('V-29 全量事件日志零 PII / 零任务正文；合规开关在 config 可核',
        !phoneHit && !idHit && !taskTextHit &&
        cfgC.compliance.zero_pii_on_chain === true && cfgC.compliance.zero_task_text_on_chain === true &&
        cfgC.compliance.sbc_transfer_or_redeem_api === false && cfgC.compliance.manual_arbitration_required === true,
        `phone=${phoneHit} id=${idHit} taskText=${taskTextHit} hooks=${cfgC.compliance.minor_restriction_hook}/${cfgC.compliance.report_entry_hook}`);
    });

    // ── H. 性能与稳定性 ──────────────────────────────────────────────
    group('H. 并发读取、推送耗时与重启数据重置');

    await run('H 组', async () => {
      const t0 = performance.now();
      const reads = await Promise.all(Array.from({ length: 100 }, () => call('GET', '/api/config')));
      const readMs = performance.now() - t0;
      check('V-30 100 并发读 /api/config：全部 200、无 5xx',
        reads.every((r) => r.status === 200) && !reads.some((r) => r.status >= 500),
        `总耗时 ${readMs.toFixed(1)}ms / 平均 ${(readMs / 100).toFixed(2)}ms`);
      metrics.read_100_concurrent_ms = Number(readMs.toFixed(1));

      const tid = mainId;
      const times = [];
      for (let i = 0; i < 20; i += 1) {
        const t = performance.now();
        const r = await call('POST', `/api/tasks/${tid}/dispatch`, { dry_run: true, top_k: 12, event_id: eid('VPERF-' + i) });
        times.push({ ms: performance.now() - t, ok: r.ok });
      }
      const ms = times.map((x) => x.ms).sort((a, b) => a - b);
      const avg = ms.reduce((s, x) => s + x, 0) / ms.length;
      const p95 = ms[Math.floor(ms.length * 0.95) - 1];
      check('V-31 20 次推送打分预览：全部成功、P95 延迟 < 500ms',
        times.every((x) => x.ok) && p95 < 500,
        `avg=${avg.toFixed(2)}ms p95=${p95.toFixed(2)}ms max=${ms.at(-1).toFixed(2)}ms`);
      metrics.dispatch_avg_ms = Number(avg.toFixed(2));
      metrics.dispatch_p95_ms = Number(p95.toFixed(2));

      const tasksBefore = (await call('GET', '/api/tasks?include_terminal=true')).data.count;
      await stopServer();
      const p2 = await freePort();
      startServer(p2);
      const restarted = await waitHealth();
      const cfg2 = restarted ? (await call('GET', '/api/config')).data : null;
      const tasksAfter = restarted ? (await call('GET', '/api/tasks?include_terminal=true')).data.count : -1;
      check('V-32 进程重启数据归零（内存存储）：任务清空、账本回到初始、偏好复位',
        restarted && tasksBefore > 0 && tasksAfter === 0 &&
        near(cfg2.ledger.total, metrics.initial_total) &&
        cfg2.personalized_enabled === true,
        `重启前任务=${tasksBefore} → 重启后=${tasksAfter}, total=${cfg2?.ledger?.total}/${metrics.initial_total}`);
    });
  } finally {
    await stopServer();
  }

  console.log('\n' + '='.repeat(64));
  console.log(`独立验证结果：PASS ${pass} / FAIL ${fail} / 共 ${pass + fail} 项`);
  if (failures.length) { console.log('失败项：'); failures.forEach((f) => console.log('  - ' + f)); }
  console.log('关键指标：' + JSON.stringify(metrics, null, 2));
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => { console.error('FATAL', e); process.exitCode = 1; });
