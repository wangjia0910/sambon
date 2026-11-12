/**
 * Cloudflare Pages 纯静态 Web 版 · 独立验证
 *
 * 目的：证明「浏览器内运行时」与「本地 Node HTTP 服务」在同一请求序列下
 *       状态迁移、积分数值、事件集合、脱敏、个性化开关、红线路径完全一致，
 *       且产物与 src/ 逐字节同源（不存在第二套业务实现）。
 *
 * 运行：node tests/verify-cloudflare.mjs   （自动重建产物、自起停 Node 服务）
 * 退出码：全绿 = 0；任一 FAIL = 1
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'cloudflare');
const SRC_FILES = ['domain.mjs', 'store.mjs', 'server.mjs', 'hash.mjs'];
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

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  → ${detail}` : ''}`);
};
const read = (p) => readFileSync(p, 'utf8');
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

async function freePort() {
  return new Promise((ok, bad) => {
    const s = createNetServer();
    s.once('error', bad);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}

/** 只保留可跨实现比较的确定性字段（剔除 task_id / 时间戳 / 端口等随机项） */
function shape(r) {
  const d = r?.json?.data;
  return {
    status: r?.status,
    ok: r?.json?.ok ?? null,
    err: r?.json?.error?.code ?? null,
    state: d?.task?.state ?? null,
    result_preview: d?.task?.result_preview ?? null,
    pii_redacted: d?.task?.result_pii_redacted ?? null,
    mode: d?.mode ?? null,
    personalized: d?.personalized ?? null,
    candidates: Array.isArray(d?.candidates) ? d.candidates.length : null,
    settlement: d?.settlement ? {
      bounty: d.settlement.bounty,
      service_fee: d.settlement.service_fee,
      bonus: d.settlement.quality_bonus?.amount,
      credit: d.settlement.solver_credit,
    } : null,
    available: d?.available ?? null,
    balanced: d?.balance_check?.balanced ?? null,
    events: d?.events ? d.events.length : null,
    event_types: d?.events ? [...new Set(d.events.map((e) => e.type))].sort() : null,
  };
}

async function runFlow(call) {
  const f = {};
  const tag = 'CFV';
  f.health = shape(await call('GET', '/api/health'));
  f.config = shape(await call('GET', '/api/config'));

  let r = await call('POST', '/api/tasks', {
    publisher_id: 'U-PUB-A', title: 'Cloudflare 一致性验证任务',
    description: '纯虚构样例：整理社区活动资料清单，不涉及任何真实个人信息。',
    category: '资料整理', bounty: 200, deadline_hours: 48,
    acceptance_criteria: '资料清单完整、按时提交', online: true, radius_km: 10,
    required_skills: ['资料整理'], event_id: 'CFV-PUB',
  });
  f.publish = shape(r);
  const id = r.json?.data?.task?.task_id;
  f.task_id_present = Boolean(id);

  r = await call('POST', `/api/tasks/${id}/review`, { decision: 'approve', event_id: 'CFV-REV' });
  f.review = shape(r);
  r = await call('POST', `/api/tasks/${id}/dispatch`, { top_k: 12, batch_size: 8, expand: true, expand_to: 30, event_id: 'CFV-DSP' });
  f.dispatch = shape(r);
  r = await call('POST', `/api/tasks/${id}/accept`, { solver_id: 'U-SOLVER-JIA', event_id: 'CFV-ACC' });
  f.accept = shape(r);
  r = await call('POST', `/api/tasks/${id}/submit`, {
    solver_id: 'U-SOLVER-JIA',
    content: '联系电话 13800138000，证件号 110101199001011234，演示成果（虚构）',
    event_id: 'CFV-SUB',
  });
  f.submit = shape(r);
  r = await call('POST', `/api/tasks/${id}/verify`, { decision: 'approve', rating: 4.8, event_id: 'CFV-VER' });
  f.verify = shape(r);
  f.ledger = shape(await call('GET', '/api/ledger/U-SOLVER-JIA'));
  f.events = shape(await call('GET', `/api/events?task_id=${id}`));
  f.forbidden = [];
  for (const p of FORBIDDEN) f.forbidden.push(shape(await call('POST', p, { amount: 1 })).status);
  r = await call('POST', '/api/preferences/personalized', { enabled: false, event_id: 'CFV-PREF' });
  f.pref = shape(r);
  f.pref_config = shape(await call('GET', '/api/config'));
  f.pref_enabled = (await call('GET', '/api/config')).json?.data?.personalized_enabled;
  return f;
}

async function main() {
  console.log('=== Cloudflare 静态 Web 版独立验证 ===\n');

  // ── A. 产物构建与同源性 ──────────────────────────────────────────
  const build = spawnSync(process.execPath, ['tools/build-cloudflare.mjs'], { cwd: ROOT, encoding: 'utf8' });
  const need = ['index.html', 'cf-runtime.mjs', '_headers', ...SRC_FILES.map((f) => `src/${f}`)];
  check('CF-01 构建脚本成功且 7 个产物齐备', build.status === 0 && need.every((f) => existsSync(join(OUT, f))),
    `exit=${build.status} 文件=${need.filter((f) => existsSync(join(OUT, f))).length}/${need.length}`);

  const same = SRC_FILES.every((f) => sha(join(ROOT, 'src', f)) === sha(join(OUT, 'src', f)));
  check('CF-02 产物 src/ 与源码逐字节一致（无第二套业务实现）', same, `${SRC_FILES.length} 个文件 SHA-256 比对`);

  const html = read(join(OUT, 'index.html'));
  check('CF-03 页面注入引导层且保留演示声明',
    html.includes('__installSambonRuntime') && html.includes("import('./cf-runtime.mjs')") &&
    html.includes('演示') && html.includes('虚构'),
    `注入次数=${(html.match(/__installSambonRuntime/g) || []).length}`);

  const headers = read(join(OUT, '_headers'));
  check('CF-04 _headers 声明 .mjs 的 JavaScript MIME', headers.includes('/src/*.mjs') && headers.includes('text/javascript'));

  const allSrc = SRC_FILES.map((f) => read(join(OUT, 'src', f))).join('\n');
  check('CF-05 产物无 node: 静态 import（可在浏览器 ESM 加载）',
    !/^\s*import\s+[^;]*\s+from\s+['"]node:/m.test(allSrc) && !/\bBuffer\./.test(allSrc));

  const { sha256Hex } = await import(pathToFileURL(join(OUT, 'src/hash.mjs')).href);
  const samples = ['sambon-genesis', '三宝殿', JSON.stringify({ a: 1 })];
  check('CF-06 纯 JS SHA-256 与 node:crypto 输出一致（Merkle 可跨平台对账）',
    samples.every((s) => sha256Hex(s) === createHash('sha256').update(s).digest('hex')));

  // ── B. 浏览器运行时加载与引导层链路 ────────────────────────────────
  let installed = null;
  globalThis.window = {
    fetch() { throw new Error('静态版不应发起真实后端 fetch'); },
    __installSambonRuntime(fn) { installed = fn; },
  };
  const runtime = await import(pathToFileURL(join(OUT, 'cf-runtime.mjs')).href + '?verify=1');
  check('CF-07 浏览器运行时可加载并注册队列处理器',
    typeof runtime.handleApiJob === 'function' && typeof installed === 'function');

  const bootRes = await new Promise((res, rej) => {
    installed({ method: 'GET', url: '/api/config', body: undefined, resolve: res, reject: rej });
  });
  const bootJson = await bootRes.json();
  check('CF-08 引导层 fetch 适配返回标准 Response 且配置口径一致',
    bootRes.status === 200 && bootJson.ok && bootJson.data.weight_version === 'v1.0',
    `weight_version=${bootJson?.data?.weight_version}`);

  const browserCall = async (method, url, body) => {
    const r = await runtime.handleApiJob({ method, url, body });
    return { status: r.status, json: JSON.parse(r.text) };
  };

  // ── C. 与本地 Node 服务同序列对比 ──────────────────────────────────
  const port = await freePort();
  const child = spawn(process.execPath, ['src/server.mjs'], {
    cwd: ROOT, env: { ...process.env, PORT: String(port) }, stdio: 'ignore',
  });
  const BASE = `http://127.0.0.1:${port}`;
  const httpCall = async (method, url, body) => {
    const r = await fetch(BASE + url, {
      method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, json: await r.json().catch(() => ({})) };
  };
  let flowHttp = null;
  let flowBrowser = null;
  try {
    let ready = false;
    for (let i = 0; i < 40 && !ready; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      try { ready = (await fetch(`${BASE}/api/health`)).ok; } catch { /* 未就绪 */ }
    }
    if (!ready) throw new Error('Node 服务未就绪');
    flowHttp = await runFlow(httpCall);
    flowBrowser = await runFlow(browserCall);
  } catch (e) {
    check('CF-09 两条通道跑通同一序列', false, String(e.message || e));
  } finally {
    child.kill();
  }

  if (flowHttp && flowBrowser) {
    const diffs = Object.keys(flowHttp).filter((k) => JSON.stringify(flowHttp[k]) !== JSON.stringify(flowBrowser[k]));
    check('CF-09 浏览器运行时与 Node 服务同序列全字段一致', diffs.length === 0,
      diffs.length ? `差异字段: ${diffs.join(', ')}` : `${Object.keys(flowHttp).length} 组字段全部一致`);

    const f = flowBrowser;
    check('CF-10 浏览器版闭环到达 SETTLED 且积分数值与本地一致',
      f.verify.state === 'SETTLED' && f.verify.settlement?.bounty === 200 &&
      f.verify.settlement?.service_fee === 10 && f.verify.settlement?.bonus === 4 &&
      f.verify.settlement?.credit === 204 && f.ledger.balanced === true,
      `state=${f.verify.state} 结算=${JSON.stringify(f.verify.settlement)} 账本平衡=${f.ledger.balanced}`);

    check('CF-11 成果正文 PII 脱敏在浏览器版同样生效',
      !/\d{6,}/.test(String(f.submit.result_preview || '')) && f.submit.pii_redacted === true,
      `preview=${String(f.submit.result_preview || '').slice(0, 46)}`);

    check('CF-12 事件名 ⊆ 契约 §4、无 SettlementRequested',
      (f.events.event_types || []).every((t) => CONTRACT_EVENTS.has(t)) &&
      !(f.events.event_types || []).includes('SettlementRequested') &&
      f.events.events >= 10,
      `回放 ${f.events.events} 条 / ${(f.events.event_types || []).length} 种类型`);

    check('CF-13 8 个转让 / 兑换路径在浏览器版全部 404',
      f.forbidden.every((s) => s === 404), `${f.forbidden.length} 个路径 → ${[...new Set(f.forbidden)].join(',')}`);

    check('CF-14 关闭个性化开关由服务端（运行时）强制生效',
      f.pref_config.ok === true && f.pref_enabled === false,
      `personalized_enabled=${f.pref_enabled}`);
  }

  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log(`\n=== 结果：PASS ${pass} / FAIL ${fail} / 共 ${results.length} 项 ===`);
  if (fail) console.log('失败项：' + results.filter((r) => !r.ok).map((r) => r.name).join(' | '));
  console.log('结论：仅证明 Cloudflare 静态版与本地原型口径一致、可离线运行；不构成上线许可（V1–V8 未触发）。');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('verify-cloudflare 异常：', e); process.exit(1); });
