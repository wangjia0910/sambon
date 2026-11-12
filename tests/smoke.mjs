/**
 * 《三宝殿》初版原型 · 自检脚本（tests/smoke.mjs）
 *
 * 自行 spawn src/server.mjs（随机空闲端口）→ 轮询 /api/health 等待就绪 →
 * 执行断言 → 输出 PASS/FAIL 与退出码 → 结束关闭子进程。零第三方依赖。
 *
 * 运行：node tests/smoke.mjs
 */

import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createStore, scanAnchorText } from '../src/store.mjs';

const SERVER_PATH = fileURLToPath(new URL('../src/server.mjs', import.meta.url));

let pass = 0;
let fail = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log('PASS  ' + name);
  } else {
    fail += 1;
    failures.push(name + (detail ? ' | ' + detail : ''));
    console.log('FAIL  ' + name + (detail ? ' | ' + detail : ''));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const eid = (prefix) => `${prefix}-${randomUUID().slice(0, 12)}`;

/** 取一个随机空闲端口（先监听 0 再释放） */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = createNetServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}

let BASE = '';

async function call(method, path, body) {
  const resp = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = {};
  try { json = await resp.json(); } catch { /* 非 JSON 响应按空对象处理 */ }
  return { status: resp.status, ...json };
}

async function waitHealth(timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(BASE + '/api/health');
      if (r.ok) return true;
    } catch { /* 服务尚未就绪 */ }
    await sleep(120);
  }
  return false;
}

// ---------------------------------------------------------------------------
// 演示流程辅助（全部虚构数据）
// ---------------------------------------------------------------------------

async function newTask(tag, opts = {}) {
  return call('POST', '/api/tasks', {
    publisher_id: 'U-PUB-A',
    title: `演示悬赏任务 ${tag}`,
    description: '纯虚构样例：整理社区活动资料清单，按时交付，不涉及任何真实个人信息。',
    category: '资料整理',
    bounty: opts.bounty ?? 200,
    deadline_hours: 48,
    acceptance_criteria: '资料清单完整、格式清晰、按时提交',
    online: opts.online ?? true,
    radius_km: 10,
    required_skills: opts.required_skills ?? ['资料整理'],
    event_id: eid(`PUB-${tag}`),
  });
}

function review(id, tag, decision = 'approve', eventId) {
  return call('POST', `/api/tasks/${id}/review`, {
    decision, event_id: eventId || eid(`REV-${tag}`),
  });
}

function dispatch(id, tag, extra = {}) {
  return call('POST', `/api/tasks/${id}/dispatch`, {
    top_k: 12, batch_size: 8, expand: true, expand_to: 30,
    event_id: eid(`DSP-${tag}`), ...extra,
  });
}

function accept(id, solverId, tag) {
  return call('POST', `/api/tasks/${id}/accept`, { solver_id: solverId, event_id: eid(`ACC-${tag}`) });
}

function submit(id, solverId, tag) {
  return call('POST', `/api/tasks/${id}/submit`, {
    solver_id: solverId, content: '演示成果（虚构）', event_id: eid(`SUB-${tag}`),
  });
}

function verify(id, tag, extra = {}) {
  return call('POST', `/api/tasks/${id}/verify`, {
    decision: 'approve', rating: 4.8, event_id: eid(`VER-${tag}`), ...extra,
  });
}

const errOf = (r) => (r && r.error ? `${r.error.code}:${r.error.message}` : 'no-error');
const dump = (...rs) => rs.map((r) => `${r.status}/${r.ok ? 'ok' : errOf(r)}`).join(' ');

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function main() {
  const port = await freePort();
  BASE = `http://127.0.0.1:${port}`;

  const child = spawn(process.execPath, [SERVER_PATH], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOutput = '';
  child.stdout.on('data', (d) => { serverOutput += d.toString(); });
  child.stderr.on('data', (d) => { serverOutput += d.toString(); });

  try {
    if (!(await waitHealth())) {
      console.log('FAIL  服务未就绪（/api/health 超时）');
      console.log('---- server output ----\n' + serverOutput);
      fail += 1;
      return;
    }
    console.log(`INFO  服务就绪 ${BASE}\n`);

    // === ① 端到端闭环 =====================================================
    const t1 = await newTask('T1');
    const t1Id = t1.ok ? t1.data.task.task_id : null;
    const r1 = t1Id ? await review(t1Id, 'T1') : t1;
    const d1 = t1Id ? await dispatch(t1Id, 'T1') : t1;
    const a1 = t1Id ? await accept(t1Id, 'U-SOLVER-JIA', 'T1') : t1;
    const s1 = t1Id ? await submit(t1Id, 'U-SOLVER-JIA', 'T1') : t1;
    const v1 = t1Id ? await verify(t1Id, 'T1') : t1;
    const closed = [t1, r1, d1, a1, s1, v1].every((x) => x.ok);
    const settled = v1.ok && v1.data.task.state === 'SETTLED' && Boolean(v1.data.settlement);
    check('① 端到端闭环 发布→审核→推送→接单→提交→验收→结算', closed && settled,
      dump(t1, r1, d1, a1, s1, v1));

    // === ② 结算后积分流水正确且账本科目平衡 ===============================
    const led1 = await call('GET', '/api/ledger/U-SOLVER-JIA');
    const entries1 = led1.ok ? led1.data.entries : [];
    const settleEntries = entries1.filter((e) => e.task_id === t1Id && String(e.memo).startsWith('settle:'));
    const solverCredit = settleEntries.reduce((sum, e) => sum + Math.max(0, e.delta), 0);
    const subj1 = led1.ok ? led1.data.subjects : {};
    const bonus = Math.min(200 * 0.02, 50); // 4 SBC
    const fee = 200 * 0.05;                // 10 SBC
    const balanceOK = led1.ok && led1.data.balance_check.balanced;
    const flowsOK =
      solverCredit === 200 + bonus &&
      subj1.platform_revenue === fee &&
      subj1.eco_incentive === 500 - bonus &&
      subj1.escrow === 0 && subj1.frozen === 0;
    check('② 结算后积分流水正确且账本科目平衡', balanceOK && flowsOK,
      `credit=${solverCredit} subjects=${JSON.stringify(subj1)} balanced=${balanceOK}`);

    // === ③ 重复 event_id 不重复记账（幂等） ===============================
    const t2 = await newTask('T2');
    const t2Id = t2.ok ? t2.data.task.task_id : null;
    const IDEM = 'IDEM-FREEZE-0001';
    const r2a = await review(t2Id, 'T2', 'approve', IDEM);
    const r2b = await review(t2Id, 'T2', 'approve', IDEM); // 同一 event_id 重复投递
    const pubLed = await call('GET', '/api/ledger/U-PUB-A');
    const freezeLegs = pubLed.ok
      ? pubLed.data.entries.filter((e) => e.event_id === IDEM && String(e.memo).startsWith('freeze:'))
      : [];
    const ev2 = await call('GET', `/api/events?task_id=${t2Id}`);
    const frozenEvents = ev2.ok ? ev2.data.events.filter((e) => e.type === 'CreditFrozen') : [];
    check('③ 重复 event_id 不重复记账（幂等）',
      r2a.ok && r2b.ok && r2b.idempotent === true && freezeLegs.length === 1 && frozenEvents.length === 1,
      `${dump(r2a, r2b)} freezeLegs=${freezeLegs.length} frozenEvents=${frozenEvents.length}`);

    // === ④ 非法状态迁移被拒 ================================================
    const t3 = await newTask('T3');
    const t3Id = t3.ok ? t3.data.task.task_id : null;
    const illegal = await dispatch(t3Id, 'T3'); // PENDING_REVIEW → DISPATCHING 非法
    check('④ 非法状态迁移被拒',
      !illegal.ok && illegal.status === 400 && illegal.error.code === 'ILLEGAL_TRANSITION',
      dump(illegal));

    // === ⑤ 接单并发/重复接单仅一人成功 ====================================
    const t4 = await newTask('T4', { required_skills: [] });
    const t4Id = t4.ok ? t4.data.task.task_id : null;
    const r4 = await review(t4Id, 'T4');
    const d4 = await dispatch(t4Id, 'T4');
    const solvers = ['U-SOLVER-JIA', 'U-SOLVER-YI', 'U-SOLVER-BING', 'U-SOLVER-DING'];
    const conc = await Promise.all(solvers.map((sid, i) =>
      call('POST', `/api/tasks/${t4Id}/accept`, { solver_id: sid, event_id: eid(`CON-${i}`) })));
    const wins = conc.filter((r) => r.ok).length;
    check('⑤ 接单并发/重复接单仅一人成功',
      t4.ok && r4.ok && d4.ok && wins === 1,
      `wins=${wins}/4 ${dump(r4, d4)} [${conc.map((r) => r.ok ? 'ok' : r.error.code).join(',')}]`);

    // === ⑥ 不存在 SBC 转让/兑换接口（请求应 404） =========================
    const forbidden = [
      '/api/sbc/transfer', '/api/sbc/redeem', '/api/sbc/trade',
      '/api/exchange', '/api/fiat/redeem', '/api/sbc/withdraw',
    ];
    const fr = await Promise.all(forbidden.map((p) =>
      call('POST', p, { amount: 1, event_id: eid('FORBID') })));
    const cfg6 = await call('GET', '/api/config');
    check('⑥ 不存在 SBC 转让/兑换接口（请求应 404）',
      fr.every((r) => r.status === 404) && cfg6.ok && cfg6.data.compliance.sbc_transfer_or_redeem_api === false,
      `statuses=[${fr.map((r) => r.status).join(',')}]`);

    // === ⑦ 关闭个性化推荐后返回中性排序且开关在 /api/config 可见 ==========
    const prefOff = await call('POST', '/api/preferences/personalized', {
      enabled: false, event_id: eid('PREF-OFF'),
    });
    const cfgOff = await call('GET', '/api/config');
    const t5 = await newTask('T5', { required_skills: [] });
    const t5Id = t5.ok ? t5.data.task.task_id : null;
    const r5 = await review(t5Id, 'T5');
    // 客户端尝试强制开启个性化：服务端必须忽略，仍返回中性排序
    const d5 = await dispatch(t5Id, 'T5', { personalized: true, enabled: true });
    const board = await call('GET', '/api/leaderboard/tasks');
    const neutral = d5.ok && d5.data.mode === 'neutral' && d5.data.personalized === false &&
      d5.data.candidates.length > 0 &&
      d5.data.candidates.every((c) => c.score === null &&
        c.reason_codes.every((code) => code.startsWith('NEUTRAL_')));
    check('⑦ 关闭个性化推荐后返回中性排序且开关在 /api/config 可见',
      prefOff.ok && cfgOff.ok && cfgOff.data.personalized_enabled === false &&
      cfgOff.data.personalization_enforcement === 'server_side' &&
      neutral && board.ok && board.data.mode === 'neutral',
      `pref=${dump(prefOff)} cfgEnabled=${cfgOff.ok && cfgOff.data.personalized_enabled} mode=${d5.ok && d5.data.mode} board=${board.ok && board.data.mode}`);
    // 恢复开关，避免影响后续断言
    await call('POST', '/api/preferences/personalized', { enabled: true, event_id: eid('PREF-ON') });

    // === ⑧ 争议状态全额托管、裁定前不转付 ==================================
    const t6 = await newTask('T6');
    const t6Id = t6.ok ? t6.data.task.task_id : null;
    const r6 = await review(t6Id, 'T6');
    const d6 = await dispatch(t6Id, 'T6');
    const a6 = await accept(t6Id, 'U-SOLVER-YI', 'T6');
    const s6 = await submit(t6Id, 'U-SOLVER-YI', 'T6');
    const dis6 = await call('POST', `/api/tasks/${t6Id}/dispute`, {
      action: 'open', event_id: eid('DIS-T6'),
    });
    const ev6 = await call('GET', `/api/events?task_id=${t6Id}`);
    const types6 = ev6.ok ? ev6.data.events.map((e) => e.type) : [];
    const disputeEvt = ev6.ok ? ev6.data.events.find((e) => e.type === 'DisputeOpened') : null;
    const ledgerYi = await call('GET', '/api/ledger/U-SOLVER-YI');
    const yiCreditT6 = ledgerYi.ok
      ? ledgerYi.data.entries.filter((e) => e.task_id === t6Id && e.delta > 0).length : -1;
    const cfg8 = await call('GET', '/api/config');
    const escrowAmount = cfg8.ok ? cfg8.data.ledger.by_subject.escrow : -1;
    // 争议状态下借验收接口转付必须被状态机拒绝
    const illegalSettle = await call('POST', `/api/tasks/${t6Id}/verify`, {
      decision: 'approve', rating: 5, event_id: eid('BAD-VER-T6'),
    });
    check('⑧ 争议状态全额托管、裁定前不转付',
      dis6.ok && dis6.data.task.state === 'DISPUTED' &&
      Boolean(disputeEvt) && disputeEvt.payload.escrow_total === 210 &&
      !types6.includes('SettlementCompleted') && !types6.includes('CreditTransferred') &&
      yiCreditT6 === 0 && escrowAmount >= 210 &&
      !illegalSettle.ok && illegalSettle.error.code === 'ILLEGAL_TRANSITION',
      `${dump(r6, d6, a6, s6, dis6)} escrowEvt=${disputeEvt && disputeEvt.payload.escrow_total} escrow=${escrowAmount} yiCredit=${yiCreditT6} blocked=${!illegalSettle.ok && illegalSettle.error.code}`);

    // === ⑨ 算法降级标记存在且推送不中断 ====================================
    const cfg9 = await call('GET', '/api/config');
    const degradedFlag = cfg9.ok && cfg9.data.algorithm.degraded === true &&
      cfg9.data.algorithm.dispatch_continues_on_degrade === true &&
      Array.isArray(cfg9.data.algorithm.adapters) && cfg9.data.algorithm.adapters.length === 3;
    const dispatchOK = d1.ok && d1.data.algorithm_degraded === true && d1.data.candidates.length > 0;
    const llmDegraded = d1.ok && d1.data.llm_hint && d1.data.llm_hint.degraded === true;
    check('⑨ 算法降级标记存在且推送不中断', degradedFlag && dispatchOK && llmDegraded,
      `flag=${degradedFlag} dispatch=${dispatchOK} llm=${llmDegraded}`);

    // === ⑩ 事件流可按 task_id 回放完整链路 =================================
    const ev10 = await call('GET', `/api/events?task_id=${t1Id}`);
    const types10 = ev10.ok ? ev10.data.events.map((e) => e.type) : [];
    const requiredEvents = [
      'TaskPublished', 'CreditFrozen', 'DispatchRequested', 'DispatchScored', 'DispatchSent',
      'TaskAccepted', 'TaskSubmitted', 'TaskVerified', 'SettlementCompleted',
    ];
    const missing = requiredEvents.filter((t) => !types10.includes(t));
    check('⑩ 事件流可按 task_id 回放完整链路',
      ev10.ok && ev10.data.replayable === true && ev10.data.count >= requiredEvents.length && missing.length === 0,
      `count=${ev10.ok && ev10.data.count} missing=[${missing.join(',')}]`);

    // === ⑪（补充）dry_run 预览不落库、不改状态 =============================
    const t7 = await newTask('T7');
    const t7Id = t7.ok ? t7.data.task.task_id : null;
    const r7 = await review(t7Id, 'T7');
    const before7 = await call('GET', `/api/events?task_id=${t7Id}`);
    const dry7 = await dispatch(t7Id, 'T7', { dry_run: true });
    const after7 = await call('GET', `/api/events?task_id=${t7Id}`);
    const list7 = await call('GET', '/api/tasks');
    const t7State = list7.ok ? (list7.data.tasks.find((t) => t.task_id === t7Id) || {}).state : null;
    check('⑪（补充）dry_run 预览不落库、不改状态',
      t7.ok && r7.ok && dry7.ok && dry7.data.dry_run === true &&
      before7.data.count === after7.data.count && t7State === 'PUBLISHED',
      `dry=${dry7.ok && dry7.data.dry_run} events ${before7.ok && before7.data.count}->${after7.ok && after7.data.count} state=${t7State}`);

    // === ⑫ 结算编排事件名收敛 + 人工兜底（阶段 C 主代理裁决：路径 A，不采用 SettlementRequested） ===
    const ev12 = await call('GET', `/api/events?task_id=${t1Id}`);
    const types12 = ev12.ok ? ev12.data.events.map((e) => e.type) : [];
    // CONTRACT §4 登记集合（主代理 v0.2：原 8 类 + 补登记 RiskBlocked / PreferenceChanged）
    const S4_EVENTS = new Set([
      'TaskPublished', 'TaskUpdated', 'CreditFrozen', 'CreditTransferred', 'CreditChanged',
      'DispatchRequested', 'DispatchScored', 'DispatchSent', 'DispatchExposed', 'DispatchIgnored',
      'TaskAccepted', 'TaskSubmitted', 'TaskVerified', 'DisputeOpened', 'DisputeResolved',
      'SettlementCompleted', 'RankUpdated', 'TaskDelisted', 'LedgerAnchored',
      'RiskBlocked', 'PreferenceChanged',
    ]);
    const outside12 = types12.filter((t) => !S4_EVENTS.has(t));
    const noSR12 = !types12.includes('SettlementRequested');
    const ctIdx12 = types12.indexOf('CreditTransferred');
    const scIdx12 = types12.indexOf('SettlementCompleted');
    const stillBroadcast12 = ctIdx12 >= 0 && scIdx12 >= 0 && ctIdx12 < scIdx12;
    const noModelDecision12 = ev12.ok && ev12.data.events.every((e) => {
      const p = e.payload || {};
      return p.model_decision === null || p.model_decision === undefined;
    });
    // 争议态（t6，尚未裁定）不得出现转付事件：人工兜底、裁定前不转付
    const evDispute12 = await call('GET', `/api/events?task_id=${t6Id}`);
    const noTransferBeforeArbitration12 = evDispute12.ok &&
      !evDispute12.data.events.some((e) => e.type === 'CreditTransferred');
    // 全量运行期事件类型同样必须 ⊆ 契约 §4（含 PreferenceChanged / RiskBlocked 等全局事件）
    const evAll12 = await call('GET', '/api/events');
    const allTypes12 = evAll12.ok ? [...new Set(evAll12.data.events.map((e) => e.type))] : [];
    const outsideAll12 = allTypes12.filter((t) => !S4_EVENTS.has(t));
    check('⑫ 结算编排事件名收敛 + 人工兜底：结算/全量事件⊆契约§4、无 SettlementRequested、仍发 CreditTransferred/SettlementCompleted、争议态不转付、无模型决策',
      ev12.ok && outside12.length === 0 && outsideAll12.length === 0 && noSR12 && stillBroadcast12 &&
      noModelDecision12 && noTransferBeforeArbitration12,
      `outside=[${outside12.join(',')}] allOutside=[${outsideAll12.join(',')}] allTypes=${allTypes12.length} ct=${ctIdx12} sc=${scIdx12} noModel=${noModelDecision12} disputeNoTransfer=${noTransferBeforeArbitration12}`);

    // === ⑬ 未成年人限制 / 举报入口合规钩子（CONTRACT §10.5 / docs/03 §4） ===
    const cfg13 = await call('GET', '/api/config');
    const hooksOK = cfg13.ok && cfg13.data.compliance.minor_restriction_hook === true &&
      cfg13.data.compliance.report_entry_hook === true &&
      cfg13.data.compliance.hooks_pii_free === true;
    const minor = await call('POST', '/api/tasks', {
      publisher_id: 'U-PUB-A', title: '演示：未成年人限制钩子校验',
      description: '纯虚构样例，验证准入钩子占位，不含任何真实个人信息。',
      category: '资料整理', bounty: 10, acceptance_criteria: '无',
      minor_blocked: true, event_id: eid('MINOR'),
    });
    const homeResp = await fetch(BASE + '/');
    const homeHtml = await homeResp.text();
    const frontHooks = homeHtml.includes('举报入口') && homeHtml.includes('未成年人限制') &&
      !/<input[^>]*type=["']tel["']/i.test(homeHtml) &&
      !/身份证[^<]*<input|<input[^>]*身份证/i.test(homeHtml);
    check('⑬ 未成年人限制/举报入口钩子可见、占位拦截生效且前端不采集明文 PII',
      hooksOK && !minor.ok && minor.status === 422 &&
      minor.error.code === 'MINOR_RESTRICTION_BLOCKED' && frontHooks,
      `hooks=${hooksOK} block=${!minor.ok && minor.error.code} front=${frontHooks}`);

    // === ⑭ 反向流水冲正（CONTRACT §5 记账铁律 / docs/03 §4 §10.1，仓储单元级） ===
    const unitStore = createStore();
    const base14 = unitStore.balanceCheck();
    const orig14 = unitStore.postLegs({
      event_id: 'UT-FREEZE', task_id: 'T-UT', memo: 'freeze:单元测试冻结',
      legs: [
        { account: 'user:U-PUB-A', delta: -210 },
        { account: 'subject:frozen', delta: 210 },
      ],
    });
    const frozen14 = unitStore.balanceCheck();
    const rev14 = unitStore.postReversal('UT-FREEZE', 'UT-REVERSAL', '违规刷单冲正');
    const after14 = unitStore.balanceCheck();
    const origStill = unitStore.ledger.filter((l) => l.event_id === 'UT-FREEZE').length === 2;
    const revOK = rev14.length === 2 && rev14.every((r, i) =>
      r.account === orig14[i].account && r.delta === -orig14[i].delta);
    const restored = frozen14.balanced && after14.balanced &&
      after14.total === base14.total && unitStore.subjects.frozen === 0 &&
      unitStore.getUser('U-PUB-A').available === 10000;
    check('⑭ 反向流水冲正：原流水不可变、只追加、delta 取反、账本回到初始且守恒',
      origStill && revOK && restored,
      `orig=${origStill} rev=${revOK} restored=${restored}`);

    // === ⑮ 用户榜 net_sbc 计入口径（阶段 C 裁决：仅赏金本金；方案 §4.1.5 / 产品裁决 3） ===
    const ub15 = await call('GET', '/api/leaderboard/users');
    const jia15 = ub15.ok ? ub15.data.items.find((i) => i.user_id === 'U-SOLVER-JIA') : null;
    const yi15 = ub15.ok ? ub15.data.items.find((i) => i.user_id === 'U-SOLVER-YI') : null;
    // 高质量奖励仍进 available 余额（断言② 已验证 solverCredit = bounty + bonus），
    // 但按方案 §4.1.5「赠送/补偿/邀请/活动奖励/争议中积分一律不计入，防止刷榜」不混入 net_sbc。
    check('⑮ 用户榜 net_sbc 仅赏金本金：高质量奖励不混入；争议中/未结算任务为 0',
      bonus > 0 && Boolean(jia15) && jia15.net_sbc === 200 &&
      jia15.net_sbc !== 200 + bonus &&
      Boolean(yi15) && yi15.net_sbc === 0,
      `jia.net_sbc=${jia15 && jia15.net_sbc} expected=200（奖励 ${bonus} 不混入） yi(争议中)=${yi15 && yi15.net_sbc}`);

    // === ⑯ 事件日志零 PII / 零任务正文（键白名单 + 自由文本剥离）与 Merkle 锚定载荷 ===
    // 阶段 C：驳回理由夹带虚构手机号 / 证件号 / 任务正文，验证 GET /api/events payload 不含上述内容
    const t16 = await newTask('T16');
    const t16Id = t16.ok ? t16.data.task.task_id : null;
    await review(t16Id, 'T16');
    await dispatch(t16Id, 'T16');
    await accept(t16Id, 'U-SOLVER-BING', 'T16');
    await submit(t16Id, 'U-SOLVER-BING', 'T16');
    const PII16 = '13800001234';
    const IDCARD16 = '110101199001011234';
    const TASKTEXT16 = '整理社区活动资料清单';
    const rej16 = await call('POST', `/api/tasks/${t16Id}/verify`, {
      decision: 'reject',
      reason: `驳回：联系方式 ${PII16}，证件 ${IDCARD16}，${TASKTEXT16} 不合格`,
      event_id: eid('REJ-PII-16'),
    });
    const evRej16 = await call('GET', `/api/events?task_id=${t16Id}`);
    const rejPayload16 = JSON.stringify(evRej16.ok ? evRej16.data.events.map((e) => e.payload) : []);
    const rejClean16 = rej16.ok &&
      !rejPayload16.includes(PII16) && !rejPayload16.includes(IDCARD16) &&
      !rejPayload16.includes(TASKTEXT16);

    const evAll16 = await call('GET', '/api/events');
    const anchors16 = evAll16.ok ? evAll16.data.events.filter((e) => e.type === 'LedgerAnchored') : [];
    const lastAnchor16 = anchors16[anchors16.length - 1];
    const scan16 = lastAnchor16 ? lastAnchor16.payload.privacy_scan : {};
    const fields16 = lastAnchor16 ? lastAnchor16.payload.on_chain_fields : [];
    const privacyOK = scan16.pii_hits === 0 && scan16.task_text_hits === 0 &&
      scan16.pii_on_chain === false && scan16.task_text_on_chain === false;
    const whitelistOK = Array.isArray(fields16) && fields16.length === 5 &&
      !fields16.some((f) => /title|description|content|criteria|phone|name/i.test(f));
    const strings16 = [];
    const collect16 = (v) => {
      if (typeof v === 'string') strings16.push(v);
      else if (Array.isArray(v)) v.forEach(collect16);
      else if (v && typeof v === 'object') Object.values(v).forEach(collect16);
    };
    collect16(evAll16.ok ? evAll16.data.events.map((e) => e.payload) : []);
    const text16 = strings16.filter((s) => !/^[0-9a-f]{32,64}$/i.test(s)).join('|');
    const piiHits16 = (text16.match(/1[3-9]\d{9}/g) || []).length +
      (text16.match(/\d{17}[\dXx]/g) || []).length;
    const noTaskText16 = !text16.includes('整理社区活动资料清单');
    const memoNoTaskText = !led1.data.entries.map((e) => e.memo).join('|').includes('整理社区活动资料');
    check('⑯ 事件日志零 PII / 零任务正文（驳回理由夹带验证）与 Merkle 锚定载荷（可验证扫描）',
      anchors16.length > 0 && privacyOK && whitelistOK &&
      piiHits16 === 0 && noTaskText16 && memoNoTaskText && rejClean16,
      `anchors=${anchors16.length} scan=${JSON.stringify(scan16)} fields=${fields16.length} piiHits=${piiHits16} rejClean=${rejClean16}`);

    // === ⑰ Top-K 截断与分批扩量参数生效（初版为参数级 + 元数据级） ===
    const t8 = await newTask('T8');
    const t8Id = t8.ok ? t8.data.task.task_id : null;
    const r8 = await review(t8Id, 'T8');
    const d8 = await dispatch(t8Id, 'T8', {
      top_k: 2, batch_size: 1, expand: true, expand_to: 20, channel: 'demo_channel',
    });
    const s8 = d8.ok ? d8.data : {};
    const paramOK = d8.ok && r8.ok &&
      s8.strategy.top_k === 2 && s8.strategy.batch_size === 1 && s8.strategy.expand_to === 20 &&
      s8.candidates.length === 2 &&
      s8.candidates.every((c) => c.channel === 'demo_channel') &&
      s8.candidates[0].batch === 1 && s8.candidates[1].batch === 2 &&
      s8.batches.length >= 2 && s8.batches.some((b) => String(b.note || '').includes('扩量'));
    check('⑰ Top-K 截断与分批扩量参数生效（批次/通道/扩量元数据）', paramOK,
      `top_k=${s8.strategy && s8.strategy.top_k} candidates=${s8.candidates && s8.candidates.length} batches=${s8.batches && s8.batches.length}`);

    // === ⑱ 审核驳回下架（PRD US-02）与接单事件完整性（PRD US-05 / §4.1 第 7 步） ===
    const t9 = await newTask('T9');
    const t9Id = t9.ok ? t9.data.task.task_id : null;
    const rej9 = await review(t9Id, 'T9', 'reject');
    const list9 = await call('GET', '/api/tasks');
    const listAll9 = await call('GET', '/api/tasks?include_terminal=true');
    const board9 = await call('GET', '/api/leaderboard/tasks');
    const notInDefault = list9.ok && !list9.data.tasks.some((t) => t.task_id === t9Id);
    const inAudit = listAll9.ok && listAll9.data.tasks.some((t) => t.task_id === t9Id);
    const notInBoard = board9.ok && !board9.data.items.some((t) => t.task_id === t9Id);
    const evAcc1 = await call('GET', `/api/events?task_id=${t1Id}`);
    const accTypes = evAcc1.ok ? evAcc1.data.events.map((e) => e.type) : [];
    const acceptEventsOK = ['TaskAccepted', 'RankUpdated', 'TaskDelisted'].every((t) => accTypes.includes(t));
    check('⑱ 驳回任务从列表/榜单下架且接单广播 TaskAccepted/RankUpdated/TaskDelisted',
      rej9.ok && notInDefault && inAudit && notInBoard && acceptEventsOK,
      `reject=${dump(rej9)} notInDefault=${notInDefault} inAudit=${inAudit} notInBoard=${notInBoard} events=${acceptEventsOK}`);

    // === ⑲ 提交成果 PII 脱敏（CONTRACT §10.2 / PRD US-06 验收条件③） ===
    const t10 = await newTask('T10');
    const t10Id = t10.ok ? t10.data.task.task_id : null;
    await review(t10Id, 'T10');
    await dispatch(t10Id, 'T10');
    await accept(t10Id, 'U-SOLVER-BING', 'T10');
    const FAKE_PHONE = '13800001234'; // 虚构号码，仅用于脱敏验证，非真实 PII
    const sub10 = await call('POST', `/api/tasks/${t10Id}/submit`, {
      solver_id: 'U-SOLVER-BING',
      content: `演示成果（虚构）：联系方式 ${FAKE_PHONE}，证件 110101199001011234`,
      event_id: eid('SUB-PII'),
    });
    const view10 = await call('GET', '/api/tasks');
    const t10view = view10.ok ? view10.data.tasks.find((t) => t.task_id === t10Id) : null;
    const evT10 = await call('GET', `/api/events?task_id=${t10Id}`);
    const subEvt10 = evT10.ok ? evT10.data.events.find((e) => e.type === 'TaskSubmitted') : null;
    const evAll19 = await call('GET', '/api/events');
    const piiLeak = JSON.stringify(evAll19.ok ? evAll19.data.events.map((e) => e.payload) : [])
      .includes(FAKE_PHONE);
    const redactedOK = sub10.ok && Boolean(t10view) &&
      t10view.result_pii_redacted === true &&
      String(t10view.result_preview).includes('[已脱敏]') &&
      !String(t10view.result_preview).includes(FAKE_PHONE) &&
      Boolean(subEvt10) && subEvt10.payload.pii_redacted === true &&
      !piiLeak;
    check('⑲ 提交成果 PII 脱敏：明文手机号/证件号不落内存、不进事件日志',
      redactedOK,
      `sub=${dump(sub10)} redacted=${t10view && t10view.result_pii_redacted} leak=${piiLeak}`);

    // === ⑳（补充）上链摘要扫描确定性回归：hex 载荷恒为 0、真实 PII 仍可检出 ===
    // 修复前 scanAnchorText 直接对含 64 位 hex 的锚定载荷跑手机号正则，
    // hex 数字子串会偶发命中导致断言⑯非确定性失败。此处做确定性双向验证，
    // 既证明哈希不被误判，也证明扫描器未被削弱成恒返回 0。
    const HEX64_20 = 'a'.repeat(64);
    const hashScan20 = scanAnchorText(`${HEX64_20}|12|ledger-v0.1|${HEX64_20}`);
    const realPiiScan20 = scanAnchorText('13800001234|110101199001011234|任务正文|演示发布方');
    const scanStore20 = createStore();
    const anchorScans20 = [];
    for (let i = 0; i < 8; i += 1) {
      scanStore20.postLegs({
        event_id: `UT-ANCHOR-SCAN-${i}`, task_id: 'UT-ANCHOR', memo: `anchor-scan-${i}`,
        legs: [
          { account: 'user:U-PUB-A', delta: -(i + 1) },
          { account: 'subject:frozen', delta: i + 1 },
        ],
      });
      anchorScans20.push(scanStore20.anchorLedger('unit').privacy_scan);
    }
    const hashClean20 = hashScan20.pii_hits === 0 && hashScan20.task_text_hits === 0;
    const piiDetectable20 = realPiiScan20.pii_hits >= 2 && realPiiScan20.task_text_hits >= 1;
    const anchorsStable20 = anchorScans20.length === 8 &&
      anchorScans20.every((s) => s.pii_hits === 0 && s.task_text_hits === 0 &&
        s.pii_on_chain === false && s.task_text_on_chain === false);
    check('⑳ 上链摘要扫描确定性回归：hex 摘要不误判为 PII、真实 PII 仍可检出、多次锚定 privacy_scan 恒为 0',
      hashClean20 && piiDetectable20 && anchorsStable20,
      `hash=${JSON.stringify(hashScan20)} realPii=${JSON.stringify(realPiiScan20)} anchorsClean=${anchorsStable20}`);
  } finally {
    child.kill('SIGTERM');
    if (child.exitCode === null) {
      await Promise.race([
        new Promise((r) => child.once('exit', r)),
        sleep(1500),
      ]);
    }
  }

  console.log('\n---------------------------------------------');
  console.log(`自检结果：PASS ${pass} / FAIL ${fail} / 共 ${pass + fail} 项 → ${fail === 0 ? '全绿 ✓' : '未全绿 ✗'}`);
  if (fail > 0) {
    console.log('失败明细：');
    failures.forEach((f) => console.log('  - ' + f));
    if (serverOutput.trim()) console.log('---- server output ----\n' + serverOutput.trim());
  }
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.log('FAIL  自检脚本异常：' + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
});
