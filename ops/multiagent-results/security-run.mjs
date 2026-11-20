/**
 * 安全探测者(security) · 三宝殿悬赏互助平台 多智能体端到端真实 HTTP 安全探测
 *
 * 像攻击者/审计员一样，通过真实 HTTP 逐项尝试越权与违规操作，断言护栏生效。
 * 所有断言均为「应被拒绝 / 应脱敏」；若实际与预期不符，expected:false 如实记录。
 *
 * 运行：node --disable-warning=ExperimentalWarning ops/multiagent-results/security-run.mjs
 */
import { SimClient, eid } from '../multiagent-client.mjs';

const BASE = 'http://127.0.0.1:8793';
const c = new SimClient(BASE, 'security');          // 恶意 solver
const pub = new SimClient(BASE, 'security-pub');    // 恶意 publisher（用于 CSRF/合规探测）
const checks = [];
const notes = [];

/**
 * 记录一项探测。
 *  expectedStatus/expectedCode：预期护栏表现
 *  expected：是否符合预期（false = 异常发现，红线可能失守）
 */
function addCheck({ id, attack, method, path, expectedStatus, expectedCode, r, conform: conformOverride, extra = {}, skipReason = null }) {
  const status = r?.status ?? null;
  const code = r?.error?.code ?? null;
  let expected;
  if (skipReason) {
    expected = null; // 跳过：不下结论
  } else {
    const statusOk = Array.isArray(expectedStatus) ? expectedStatus.includes(status) : status === expectedStatus;
    const codeOk = expectedCode == null ? true : (Array.isArray(expectedCode) ? expectedCode.includes(code) : code === expectedCode);
    // conform 不为 null 时，以语义断言（如脱敏、GPC 关闭）作为最终结论
    expected = (conformOverride === undefined || conformOverride === null)
      ? (statusOk && codeOk)
      : Boolean(conformOverride);
  }
  const item = {
    id,
    attack,
    method,
    path,
    expectedStatus: expectedStatus ?? null,
    expectedCode: expectedCode ?? null,
    status,
    code,
    ok: r?.ok ?? null,
    error: r?.error ?? null,
    expected,                       // 是否符合预期；false=异常发现
    pass: expected === true,        // 与 dumpResult 兼容：符合预期即 pass
    skipped: skipReason ? true : false,
    detail: { ...extra, ...(skipReason ? { skipReason } : {}) },
  };
  checks.push(item);
  if (expected === false) {
    notes.push(`[ANOMALY] ${id} ${attack} → 实际 HTTP ${status} code=${code}，预期 ${expectedStatus}/${expectedCode}`);
  } else if (skipReason) {
    notes.push(`[SKIP] ${id} ${attack} → ${skipReason}`);
  }
  return item;
}

function banner(id, attack) {
  console.log(`\n[${id}] ${attack}`);
}

/** 注册；若账号已存在（脚本重跑），回退登录复用会话 */
async function ensureAccount(client, email, password, role, name) {
  const reg = await client.register(email, password, role, name);
  if (reg.status === 201 || reg.status === 200) return { reg, reused: false, ready: true };
  if (reg.error?.code === 'EMAIL_TAKEN' || reg.status === 409) {
    const login = await client.login(email, password);
    const ready = login.status === 200 && !!client.csrf && !!client.userId;
    return { reg, reused: true, ready, login };
  }
  return { reg, reused: false, ready: false };
}

// 有效但内容恶意的发布请求体（结构完整，确保仅被角色/合规/CSRF 护栏拦截）
function evilTaskBody(tag, title = '恶意越权发布探测任务') {
  return {
    title,
    description: '这是一次安全探测用的任务描述，用于验证服务端护栏。',
    category: '设计',
    bounty: 50,
    acceptance_criteria: '提交一份演示成果即可',
    event_id: eid(tag),
  };
}

// =========================================================================
// 1. 注册恶意用户（solver 角色）
// =========================================================================
banner('01', '注册恶意用户 solver evil_ma@test.dev');
let regSolver;
try {
  const acc = await ensureAccount(c, 'evil_ma@test.dev', 'EvilPass123!long', 'solver', '探测者');
  regSolver = acc.reg;
  const ok = acc.ready && !!c.csrf && !!c.userId;
  if (acc.reused) notes.push('01 账号 evil_ma@test.dev 已存在（脚本重跑），已回退登录复用会话');
  addCheck({
    id: '01', attack: '注册恶意 solver 账号', method: 'POST', path: '/api/auth/register',
    expectedStatus: 201, expectedCode: null, r: regSolver, conform: ok,
    extra: { registered: ok, reused: acc.reused, userId: c.userId, role: regSolver.data?.user?.role ?? null },
  });
} catch (e) {
  addCheck({ id: '01', attack: '注册恶意 solver 账号', method: 'POST', path: '/api/auth/register',
    expectedStatus: 201, r: { status: null, error: { code: 'EXCEPTION', message: String(e) } } });
}

// 发现一个 MA-pub 任务 id（供后续越权审核使用）
let maPubTaskId = null;
let tasksSnapshot = [];
try {
  const lr = await c.get('/api/tasks');
  tasksSnapshot = lr.data?.tasks || [];
  const cand = tasksSnapshot.filter((t) => String(t.title || '').includes('MA-pub'));
  maPubTaskId = (cand[0] || tasksSnapshot[0])?.task_id ?? null;
  notes.push(`任务发现：/api/tasks 共 ${tasksSnapshot.length} 条，其中 MA-pub ${cand.length} 条，选用 id=${maPubTaskId}`);
} catch (e) {
  notes.push('任务发现失败：' + String(e));
}
if (!maPubTaskId) maPubTaskId = 'T-nonexistent-probe'; // 角色校验先于任务存在性校验

// =========================================================================
// 2. 越权发布：普通 solver POST /api/tasks → 403
// =========================================================================
banner('02', '越权发布：solver 调用 POST /api/tasks');
try {
  const r = await c.post('/api/tasks', evilTaskBody('esc-publish'));
  addCheck({
    id: '02', attack: '越权发布：普通 solver 发布任务', method: 'POST', path: '/api/tasks',
    expectedStatus: 403, expectedCode: 'FORBIDDEN', r,
  });
} catch (e) {
  addCheck({ id: '02', attack: '越权发布：普通 solver 发布任务', method: 'POST', path: '/api/tasks',
    expectedStatus: 403, expectedCode: 'FORBIDDEN', r: { status: null, error: { code: 'EXCEPTION', message: String(e) } } });
}

// =========================================================================
// 3. 越权审核：非 admin POST /api/tasks/{id}/review → 403
// =========================================================================
banner('03', `越权审核：POST /api/tasks/${maPubTaskId}/review approve`);
try {
  const r = await c.post(`/api/tasks/${maPubTaskId}/review`, { decision: 'approve', event_id: eid('esc-review') });
  addCheck({
    id: '03', attack: '越权审核：非 admin 审核通过任务', method: 'POST', path: `/api/tasks/${maPubTaskId}/review`,
    expectedStatus: 403, expectedCode: 'FORBIDDEN', r, extra: { taskId: maPubTaskId },
  });
} catch (e) {
  addCheck({ id: '03', attack: '越权审核：非 admin 审核通过任务', method: 'POST', path: `/api/tasks/${maPubTaskId}/review`,
    expectedStatus: 403, expectedCode: 'FORBIDDEN', r: { status: null, error: { code: 'EXCEPTION', message: String(e) } } });
}

// =========================================================================
// 4. 越权管理端点：GET /api/admin/{audit,queue,metrics} → 403
// =========================================================================
banner('04', '越权管理端点：GET /api/admin/audit|queue|metrics');
for (const [suffix, path] of [
  ['audit', '/api/admin/audit'],
  ['queue', '/api/admin/queue'],
  ['metrics', '/api/admin/metrics'],
]) {
  try {
    const r = await c.get(path);
    addCheck({
      id: `04-${suffix}`, attack: `越权管理端点：普通用户访问 ${path}`, method: 'GET', path,
      expectedStatus: 403, expectedCode: 'FORBIDDEN', r,
    });
  } catch (e) {
    addCheck({ id: `04-${suffix}`, attack: `越权管理端点：普通用户访问 ${path}`, method: 'GET', path,
      expectedStatus: 403, expectedCode: 'FORBIDDEN', r: { status: null, error: { code: 'EXCEPTION', message: String(e) } } });
  }
}

// =========================================================================
// 5. 违禁任务：publisher 发布含「刷单/赌博/洗钱」→ 422 COMPLIANCE_BLOCKED
// =========================================================================
banner('05', '违禁任务：publisher 发布含违禁词任务');
let pubRegistered = false;
try {
  const acc = await ensureAccount(pub, 'evil_pub@test.dev', 'EvilPub123!long', 'publisher', '恶意发布者');
  pubRegistered = acc.ready;
  notes.push(`publisher 注册：HTTP ${acc.reg.status} code=${acc.reg.error?.code ?? 'OK'} reused=${acc.reused}`);
} catch (e) {
  notes.push('publisher 注册异常：' + String(e));
}
if (pubRegistered) {
  try {
    const r = await pub.post('/api/tasks', {
      title: '刷单返利赚钱任务',
      description: '参与赌博平台洗钱活动，日进斗金',
      category: '其他',
      bounty: 100,
      acceptance_criteria: '完成刷单并协助洗钱',
      event_id: eid('banned-words'),
    });
    addCheck({
      id: '05', attack: '违禁任务：发布含「刷单/赌博/洗钱」的任务', method: 'POST', path: '/api/tasks',
      expectedStatus: 422, expectedCode: 'COMPLIANCE_BLOCKED', r,
      extra: { hitsExpected: ['刷单', '赌博', '洗钱'] },
    });
  } catch (e) {
    addCheck({ id: '05', attack: '违禁任务：发布含违禁词任务', method: 'POST', path: '/api/tasks',
      expectedStatus: 422, expectedCode: 'COMPLIANCE_BLOCKED', r: { status: null, error: { code: 'EXCEPTION', message: String(e) } } });
  }
} else {
  addCheck({ id: '05', attack: '违禁任务：发布含违禁词任务', method: 'POST', path: '/api/tasks',
    expectedStatus: 422, expectedCode: 'COMPLIANCE_BLOCKED', r: null, skipReason: 'publisher 账号注册失败，无法以发布方身份探测' });
}

// =========================================================================
// 6. SBC 资产化红线：8 条路径 POST → 全部 404
// =========================================================================
banner('06', 'SBC 资产化红线：8 条端点全部应 404');
const RED_LINES = [
  '/api/sbc/transfer', '/api/sbc/trade', '/api/sbc/redeem', '/api/sbc/withdraw',
  '/api/sbc/exchange', '/api/sbc/yield', '/api/sbc/market', '/api/wallet/cashout',
];
for (let i = 0; i < RED_LINES.length; i++) {
  const path = RED_LINES[i];
  try {
    const r = await c.post(path, { amount: 100, to: 'evil', event_id: eid(`redline${i}`) });
    addCheck({
      id: `06-${i + 1}`, attack: `SBC 资产化红线端点 ${path}`, method: 'POST', path,
      expectedStatus: 404, expectedCode: 'NOT_FOUND', r,
    });
  } catch (e) {
    addCheck({ id: `06-${i + 1}`, attack: `SBC 资产化红线端点 ${path}`, method: 'POST', path,
      expectedStatus: 404, expectedCode: 'NOT_FOUND', r: { status: null, error: { code: 'EXCEPTION', message: String(e) } } });
  }
}

// =========================================================================
// 7. 缺 CSRF 写操作：publisher POST /api/tasks noCsrf → 403 CSRF_FAILED
// =========================================================================
banner('07', '缺 CSRF：publisher POST /api/tasks {noCsrf:true}');
if (pubRegistered) {
  try {
    const r = await pub.post('/api/tasks', evilTaskBody('no-csrf'), { noCsrf: true });
    addCheck({
      id: '07', attack: '缺 CSRF 的写操作', method: 'POST', path: '/api/tasks',
      expectedStatus: 403, expectedCode: 'CSRF_FAILED', r, extra: { noCsrf: true },
    });
  } catch (e) {
    addCheck({ id: '07', attack: '缺 CSRF 的写操作', method: 'POST', path: '/api/tasks',
      expectedStatus: 403, expectedCode: 'CSRF_FAILED', r: { status: null, error: { code: 'EXCEPTION', message: String(e) } } });
  }
} else {
  addCheck({ id: '07', attack: '缺 CSRF 的写操作', method: 'POST', path: '/api/tasks',
    expectedStatus: 403, expectedCode: 'CSRF_FAILED', r: null, skipReason: 'publisher 账号不可用' });
}

// =========================================================================
// 8. 跨源请求：带 origin=https://evil.example 的写操作 → 403 CROSS_ORIGIN_BLOCKED
//    注意：CSRF token 默认携带，确保先过 CSRF 再被 origin 拦截。
// =========================================================================
banner('08', '跨源请求：写操作带 origin=https://evil.example');
if (pubRegistered) {
  try {
    const r = await pub.post('/api/tasks', evilTaskBody('cross-origin'), {
      headers: { origin: 'https://evil.example' },
    });
    addCheck({
      id: '08', attack: '跨源写请求（伪造 Origin）', method: 'POST', path: '/api/tasks',
      expectedStatus: 403, expectedCode: 'CROSS_ORIGIN_BLOCKED', r,
      extra: { origin: 'https://evil.example', csrfIncluded: true },
    });
  } catch (e) {
    addCheck({ id: '08', attack: '跨源写请求（伪造 Origin）', method: 'POST', path: '/api/tasks',
      expectedStatus: 403, expectedCode: 'CROSS_ORIGIN_BLOCKED', r: { status: null, error: { code: 'EXCEPTION', message: String(e) } } });
  }
} else {
  addCheck({ id: '08', attack: '跨源写请求（伪造 Origin）', method: 'POST', path: '/api/tasks',
    expectedStatus: 403, expectedCode: 'CROSS_ORIGIN_BLOCKED', r: null, skipReason: 'publisher 账号不可用' });
}

// =========================================================================
// 9. GPC 隐私信号：注册带 sec-gpc:1 → personalized_enabled=0
// =========================================================================
banner('09', 'GPC：新用户注册带 sec-gpc:1');
try {
  const gpc = new SimClient(BASE, 'security-gpc');
  const r = await gpc.request('POST', '/api/auth/register', {
    email: `gpc_${Date.now()}@test.dev`, password: 'GpcPass123!long', role: 'solver',
    display_name: 'GPC探测', locale: 'zh-CN', event_id: eid('gpc-reg'),
  }, { headers: { 'sec-gpc': '1' } });
  gpc.csrf = r.data?.session?.csrf_token ?? null;
  gpc.userId = r.data?.user?.user_id ?? null;
  let personalized = r.data?.user?.personalized_enabled ?? null;
  let meStatus = null;
  if (gpc.csrf) {
    const me = await gpc.get('/api/auth/me');
    meStatus = me.status;
    if (me.data?.user?.personalized_enabled !== undefined) personalized = me.data.user.personalized_enabled;
  }
  addCheck({
    id: '09', attack: 'GPC 隐私信号强制关闭个性化', method: 'POST', path: '/api/auth/register',
    expectedStatus: 201, expectedCode: null, r,
    conform: r.status === 201 && (personalized === 0 || personalized === false),
    extra: { personalized_enabled: personalized, gpcRequested: true, me_status: meStatus,
      conform: personalized === 0 || personalized === false },
  });
} catch (e) {
  addCheck({ id: '09', attack: 'GPC 隐私信号强制关闭个性化', method: 'POST', path: '/api/auth/register',
    expectedStatus: 201, r: { status: null, error: { code: 'EXCEPTION', message: String(e) } } });
}

// =========================================================================
// 10. PII 存储探测：接单后提交明文手机号+证件号 → result_preview 应脱敏
// =========================================================================
banner('10', 'PII 存储探测：提交含明文手机号+证件号的成果');
try {
  const PII = '演示成果：联系手机 13812345678，证件号 110101199001011234，请查收。';
  // 优先选择 MA-pub 且 DISPATCHING 的任务
  const candidates = tasksSnapshot.filter((t) => t.state === 'DISPATCHING');
  let target = null, acceptR = null;
  for (const t of candidates) {
    const ar = await c.post(`/api/tasks/${t.task_id}/accept`, { event_id: eid('pii-accept') });
    if (ar.status === 200 || ar.status === 201) { target = t; acceptR = ar; break; }
    notes.push(`接单候选 ${t.task_id} 失败：HTTP ${ar.status} code=${ar.error?.code}`);
  }
  if (!target) {
    // 只读旁证：检查已有任务的 result_preview 是否已脱敏（不冒充本次提交探测）
    try {
      const hist = await c.get('/api/tasks?include_terminal=true');
      const evidence = (hist.data?.tasks || [])
        .filter((t) => t.result_preview || t.result_pii_redacted)
        .map((t) => ({
          taskId: t.task_id,
          preview: t.result_preview,
          redacted: t.result_pii_redacted,
          hasLongDigits: /\d{6,}/.test(String(t.result_preview || '')),
          hasMarker: String(t.result_preview || '').includes('[已脱敏]'),
        }));
      notes.push(`PII 只读旁证（历史任务 result_preview）：${JSON.stringify(evidence)}`);
    } catch (e) {
      notes.push('PII 只读旁证读取失败：' + String(e));
    }
    addCheck({ id: '10', attack: 'PII 明文提交后 result_preview 脱敏', method: 'POST', path: '/api/tasks/{id}/submit',
      expectedStatus: 200, expectedCode: null, r: null,
      skipReason: `当前无处于 DISPATCHING 且可接单的任务（共 ${candidates.length} 个候选，历史任务均已 SETTLED），无法成为接单人，跳过` });
  } else {
    const sub = await c.post(`/api/tasks/${target.task_id}/submit`, { content: PII, event_id: eid('pii-submit') });
    // 从提交响应或任务列表中取 result_preview
    let taskView = sub.data?.task ?? null;
    if (!taskView) {
      const lr = await c.get('/api/tasks?include_terminal=true');
      taskView = (lr.data?.tasks || []).find((t) => t.task_id === target.task_id) ?? null;
    }
    const preview = taskView?.result_preview ?? null;
    const redactedFlag = taskView?.result_pii_redacted ?? null;
    const longDigits = String(preview ?? '').match(/\d{6,}/g) || [];
    const hasMarker = String(preview ?? '').includes('[已脱敏]');
    const conform = sub.status === 200 && longDigits.length === 0 && hasMarker && redactedFlag === true;
    addCheck({
      id: '10', attack: 'PII 明文提交后 result_preview 脱敏', method: 'POST', path: `/api/tasks/${target.task_id}/submit`,
      expectedStatus: 200, expectedCode: null, r: sub, conform,
      extra: { taskId: target.task_id, accept_status: acceptR?.status ?? null,
        result_preview: preview, result_pii_redacted: redactedFlag,
        longDigitRuns: longDigits, hasRedactMarker: hasMarker, conform },
    });
    // 按剧本要求：再经 GET /api/auth/me /任务详情复核确认
    const verify = await c.get('/api/tasks?include_terminal=true');
    const vTask = (verify.data?.tasks || []).find((t) => t.task_id === target.task_id) ?? null;
    notes.push(`PII 复核(任务详情)：preview=${JSON.stringify(vTask?.result_preview)} pii_redacted=${vTask?.result_pii_redacted}`);
  }
} catch (e) {
  addCheck({ id: '10', attack: 'PII 明文提交后 result_preview 脱敏', method: 'POST', path: '/api/tasks/{id}/submit',
    expectedStatus: 200, r: { status: null, error: { code: 'EXCEPTION', message: String(e) } } });
}

// =========================================================================
// 11. 重复注册 / 弱口令：弱口令 400；重复邮箱 409
// =========================================================================
banner('11', '重复注册 / 弱口令');
// 11a 弱口令（短口令，<10 位 → INVALID_PASSWORD 400）
try {
  const weak = new SimClient(BASE, 'security-weak');
  const r = await weak.request('POST', '/api/auth/register', {
    email: 'weak_ma@test.dev', password: '123456', role: 'solver',
    display_name: '弱口令探测', event_id: eid('weak-pwd'),
  });
  addCheck({
    id: '11-1', attack: '弱口令注册（password=123456）', method: 'POST', path: '/api/auth/register',
    expectedStatus: 400, expectedCode: 'INVALID_PASSWORD', r, extra: { password: '123456' },
  });
} catch (e) {
  addCheck({ id: '11-1', attack: '弱口令注册', method: 'POST', path: '/api/auth/register',
    expectedStatus: 400, expectedCode: 'INVALID_PASSWORD', r: { status: null, error: { code: 'EXCEPTION', message: String(e) } } });
}
// 11b 重复邮箱（复用 evil_ma@test.dev）
try {
  const dup = new SimClient(BASE, 'security-dup');
  const r = await dup.request('POST', '/api/auth/register', {
    email: 'evil_ma@test.dev', password: 'AnotherPass123!long', role: 'solver',
    display_name: '重复注册探测', event_id: eid('dup-reg'),
  });
  addCheck({
    id: '11-2', attack: '重复邮箱注册（evil_ma@test.dev）', method: 'POST', path: '/api/auth/register',
    expectedStatus: 409, expectedCode: 'EMAIL_TAKEN', r,
  });
} catch (e) {
  addCheck({ id: '11-2', attack: '重复邮箱注册', method: 'POST', path: '/api/auth/register',
    expectedStatus: 409, expectedCode: 'EMAIL_TAKEN', r: { status: null, error: { code: 'EXCEPTION', message: String(e) } } });
}

// 附加观察：本环境是否强制强口令（安全态势信息，不计入剧本预期）
try {
  const h = await c.get('/api/health');
  const enforced = h.data?.components?.security?.strong_password_enforced ?? null;
  notes.push(`环境安全开关：strong_password_enforced=${enforced}（若为 false，则长度达标的弱口令仍可注册，建议生产开启）`);
} catch (e) {
  notes.push('读取 health 安全开关失败：' + String(e));
}

// =========================================================================
// 12. 汇总并导出
// =========================================================================
banner('12', '导出结果 security.json');
const total = checks.length;
const conform = checks.filter((x) => x.expected === true).length;
const anomalies = checks.filter((x) => x.expected === false);
const skipped = checks.filter((x) => x.skipped);
notes.push(`剧本检查项：共 ${total} 项，符合预期 ${conform} 项，异常发现 ${anomalies.length} 项，跳过 ${skipped.length} 项`);
notes.push('说明：安全探测中 HTTP 4xx 表示护栏正确拦截攻击；trace 内 fail 多为预期拒绝，请以 checks.expected 为准。');
if (anomalies.length) {
  notes.push('异常发现清单：' + anomalies.map((a) => `${a.id}(${a.attack}) HTTP${a.status}/${a.code}`).join('；'));
}

const summary = await c.dumpResult('security', {
  notes, checks,
  checkTotal: total,
  checkConform: conform,
  checkAnomaly: anomalies.length,
  checkSkipped: skipped.length,
  anomalies: anomalies.map((a) => ({ id: a.id, attack: a.attack, status: a.status, code: a.code, expectedStatus: a.expectedStatus, expectedCode: a.expectedCode })),
  maPubTaskId,
});

console.log('\n==== 安全探测汇总 ====');
console.log(`检查项 ${total} / 符合预期 ${conform} / 异常 ${anomalies.length} / 跳过 ${skipped.length}`);
for (const a of anomalies) console.log(`  [ANOMALY] ${a.id} ${a.attack} → HTTP ${a.status} ${a.code}（预期 ${a.expectedStatus}/${a.expectedCode}）`);
for (const s of skipped) console.log(`  [SKIP] ${s.id} ${s.attack} → ${s.detail.skipReason}`);
