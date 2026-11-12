/**
 * 三宝殿 · Cloudflare 站点一键自检（浏览器内运行，零依赖）
 *
 * 用法：打开已部署站点 → DevTools Console → 粘贴：
 *   const r = await import('/site-selfcheck.mjs').then(m => m.run()); console.log(r);
 *
 * 原理：静态版的 /api/* 由页面引导层在浏览器内计算，不会到达 Cloudflare 边缘；
 *      因此本脚本能真实检验「线上页面 + 线上运行时」是否完整，而不只是看首页 200。
 * 边界：仅验证演示预览口径一致，不构成上线许可（V1–V8 未触发）。
 */

const CONTRACT_EVENTS = new Set([
  'TaskPublished', 'TaskUpdated', 'CreditFrozen', 'CreditTransferred', 'CreditChanged',
  'DispatchRequested', 'DispatchScored', 'DispatchSent', 'TaskAccepted',
  'DispatchExposed', 'DispatchIgnored', 'TaskSubmitted', 'TaskVerified',
  'DisputeOpened', 'DisputeResolved', 'SettlementCompleted', 'RankUpdated',
  'TaskDelisted', 'LedgerAnchored', 'RiskBlocked', 'PreferenceChanged',
]);
const FORBIDDEN = [
  '/api/sbc/transfer', '/api/sbc/redeem', '/api/sbc/exchange', '/api/sbc/withdraw',
  '/api/sbc/trade', '/api/sbc/cash', '/api/sbc/market', '/api/wallet/transfer',
];

export async function run() {
  const results = [];
  const check = (id, name, ok, detail = '') => {
    results.push({ id, name, ok: !!ok, detail: String(detail) });
  };
  const call = async (method, path, body) => {
    const res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
  const data = (r) => r?.json?.data ?? {};
  const tag = 'SITE-' + Date.now().toString(36).toUpperCase();

  // S-01 页面与运行时
  try {
    const text = (globalThis.document?.body?.innerText || globalThis.document?.title || '');
    const bootLoaded = typeof globalThis.window?.__installSambonRuntime === 'function';
    check('S-01', '页面含「演示」声明且运行时引导层已加载',
      text.includes('演示') && bootLoaded,
      `演示声明=${text.includes('演示')} 引导层=${bootLoaded}`);
  } catch (e) { check('S-01', '页面含「演示」声明且运行时引导层已加载', false, e.message); }

  // S-02 配置口径
  try {
    const r = await call('GET', '/api/config');
    const d = data(r);
    check('S-02', '/api/config 权重版本与降级标记正确',
      r.status === 200 && d.weight_version === 'v1.0' && d.algorithm?.degraded === true &&
      d.algorithm?.dispatch_continues_on_degrade === true && typeof d.personalized_enabled === 'boolean',
      `status=${r.status} weight_version=${d.weight_version} degraded=${d.algorithm?.degraded}`);
  } catch (e) { check('S-02', '/api/config 权重版本与降级标记正确', false, e.message); }

  // S-03 红线路径
  try {
    const codes = [];
    for (const p of FORBIDDEN) codes.push((await call('POST', p, { amount: 1 })).status);
    check('S-03', '8 个转让 / 兑换 / 收益类路径全部不存在',
      codes.every((c) => c === 404), `${codes.length} 个路径 → ${[...new Set(codes)].join(',')}`);
  } catch (e) { check('S-03', '8 个转让 / 兑换 / 收益类路径全部不存在', false, e.message); }

  // S-04 ~ S-08 端到端闭环
  let tid = null;
  try {
    const before = data(await call('GET', '/api/ledger/U-SOLVER-JIA')).available;
    const pub = await call('POST', '/api/tasks', {
      publisher_id: 'U-PUB-A', title: '站点自检任务 ' + tag,
      description: '纯虚构样例：整理社区活动资料清单，不涉及任何真实个人信息。',
      category: '资料整理', bounty: 200, deadline_hours: 48,
      acceptance_criteria: '资料清单完整、按时提交', online: true, radius_km: 10,
      required_skills: ['资料整理'], event_id: 'PUB-' + tag,
    });
    tid = data(pub).task?.task_id;
    const rev = await call('POST', `/api/tasks/${tid}/review`, { decision: 'approve', event_id: 'REV-' + tag });
    const dsp = await call('POST', `/api/tasks/${tid}/dispatch`,
      { top_k: 12, batch_size: 8, expand: true, expand_to: 30, event_id: 'DSP-' + tag });
    const acc = await call('POST', `/api/tasks/${tid}/accept`,
      { solver_id: 'U-SOLVER-JIA', event_id: 'ACC-' + tag });
    const sub = await call('POST', `/api/tasks/${tid}/submit`, {
      solver_id: 'U-SOLVER-JIA',
      content: '联系电话 13800138000，证件号 110101199001011234，演示成果（虚构）',
      event_id: 'SUB-' + tag,
    });
    const ver = await call('POST', `/api/tasks/${tid}/verify`,
      { decision: 'approve', rating: 4.8, event_id: 'VER-' + tag });

    check('S-04', '端到端闭环：发布 → 审核 → 推送 → 接单 → 提交 → 验收到达 SETTLED',
      Boolean(tid) && data(rev).task?.state === 'PUBLISHED' && data(dsp).state === 'DISPATCHING' &&
      data(acc).task?.state === 'ACCEPTED' && data(sub).task?.state === 'SUBMITTED' &&
      data(ver).task?.state === 'SETTLED',
      `task_id=${tid} 状态链=${[data(rev).task?.state, data(dsp).state, data(acc).task?.state, data(sub).task?.state, data(ver).task?.state].join('→')}`);

    const s = data(ver).settlement;
    check('S-05', '结算数值：赏金 200 / 服务费 10 / 质量奖励 4 / 到账 204',
      s?.bounty === 200 && s?.service_fee === 10 && s?.quality_bonus?.amount === 4 && s?.solver_credit === 204,
      JSON.stringify(s ?? {}));

    const led = data(await call('GET', '/api/ledger/U-SOLVER-JIA'));
    check('S-06', '账本守恒且结算到账 204',
      led.balance_check?.balanced === true && Number((led.available - before).toFixed(2)) === 204,
      `balanced=${led.balance_check?.balanced} ${before}→${led.available}`);

    const ev = data(await call('GET', `/api/events?task_id=${tid}`)).events || [];
    const types = [...new Set(ev.map((e) => e.type))];
    check('S-07', '事件可按 task_id 回放、类型 ⊆ 契约 §4、无 SettlementRequested',
      ev.length >= 10 && types.every((t) => CONTRACT_EVENTS.has(t)) && !types.includes('SettlementRequested'),
      `${ev.length} 条 / ${types.length} 种类型`);

    const preview = data(sub).task?.result_preview ?? '';
    check('S-08', '成果正文 PII 脱敏（无 ≥6 位连续数字残留）',
      data(sub).task?.result_pii_redacted === true && !/\d{6,}/.test(String(preview)),
      `preview=${String(preview).slice(0, 46)}`);
  } catch (e) {
    for (const [id, name] of [
      ['S-04', '端到端闭环'], ['S-05', '结算数值'], ['S-06', '账本守恒'],
      ['S-07', '事件回放'], ['S-08', 'PII 脱敏'],
    ]) check(id, name, false, e.message);
  }

  // S-09 个性化开关（服务端强制）+ 恢复现场
  try {
    await call('POST', '/api/preferences/personalized', { enabled: false, event_id: 'PREF-OFF-' + tag });
    const cfg = await call('GET', '/api/config');
    const board = await call('GET', '/api/leaderboard/tasks');
    const ok = data(cfg).personalized_enabled === false && data(board).mode === 'neutral' && data(board).personalized === false;
    check('S-09', '关闭个性化推荐后服务端强制中性排序', ok,
      `config=${data(cfg).personalized_enabled} 榜单 mode=${data(board).mode}`);
    await call('POST', '/api/preferences/personalized', { enabled: true, event_id: 'PREF-ON-' + tag });
  } catch (e) { check('S-09', '关闭个性化推荐后服务端强制中性排序', false, e.message); }

  // S-10 幂等：同一 event_id 重复提交不产生第二笔冻结
  try {
    const body = {
      publisher_id: 'U-PUB-A', title: '站点自检幂等任务 ' + tag,
      description: '纯虚构样例：核对幂等口径。', category: '资料整理', bounty: 50,
      deadline_hours: 24, acceptance_criteria: '无', online: true, radius_km: 5,
      required_skills: ['资料整理'], event_id: 'IDEM-' + tag,
    };
    const a = await call('POST', '/api/tasks', body);
    const b = await call('POST', '/api/tasks', body);
    check('S-10', '重复 event_id 不重复记账（同一 task_id）',
      Boolean(data(a).task?.task_id) && data(a).task?.task_id === data(b).task?.task_id,
      `${data(a).task?.task_id} / ${data(b).task?.task_id}`);
  } catch (e) { check('S-10', '重复 event_id 不重复记账（同一 task_id）', false, e.message); }

  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  const summary = { pass, fail, total: results.length, site: globalThis.location?.origin ?? '(unknown)', results };
  try {
    if (typeof console.table === 'function') {
      console.table(results.map((r) => ({ 编号: r.id, 结论: r.ok ? 'PASS' : 'FAIL', 检查项: r.name, 证据: r.detail })));
    }
    console.log(`%c三宝殿站点自检：PASS ${pass} / FAIL ${fail} / 共 ${results.length} 项`,
      `color:${fail ? '#c00' : '#080'};font-weight:bold`);
  } catch { /* 控制台不可用也不影响返回值 */ }
  console.log('结论：全绿仅表示线上静态版与本地原型口径一致；不构成上线许可（V1–V8 未触发）。');
  return summary;
}
