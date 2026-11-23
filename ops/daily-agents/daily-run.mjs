#!/usr/bin/env node
/**
 * 三宝殿平台 · 每日多智能体互动脚本
 * ============================================================================
 * 产物目录：ops/daily-agents/（仅在本目录内新建文件，不改动平台源码）
 * 运行示例：
 *   node ops/daily-agents/daily-run.mjs
 *   API_BASE=http://127.0.0.1:8788 node ops/daily-agents/daily-run.mjs
 *
 * 【源码契约确认——全部来自必读源码，不靠猜测】
 *   1. prod/lib/api.js:47        INITIAL_SBC_DEFAULT = 1000；SBC 为平台内贡献积分，
 *                                非资产、不可兑付（CONTRACT.md §1 / §10.1）。
 *   2. prod/lib/domain.js:93     computeFreeze(bounty) → service_fee = bounty*5%，
 *                                total = bounty + service_fee；发布时仅预检，
 *                                审核通过（PUBLISHED）才冻结。
 *   3. prod/lib/api.js:698       hCreateTask 只建 PENDING_REVIEW，需合规预检与余额预校验。
 *      prod/lib/api.js:785       hReview 需 admin，approve → PUBLISHED + 冻结。
 *      prod/lib/api.js:834       hDispatch 需 admin，→ DISPATCHING。
 *      prod/lib/api.js:916       hAccept 要求任务处于 DISPATCHING 且 frozen_total > 0。
 *      prod/lib/api.js:968       hSubmit 把正文经 sanitizeSubmissionText 脱敏后落库。
 *      prod/lib/api.js:994       hVerify：decision=approve 只需 publisher 本人；
 *                                auto_accept 才 requireRole(['admin'])。生产站 admin 已关闭，
 *                                因此本脚本【绝不调用 auto_accept】，一律用 approve。
 *      prod/lib/api.js:378/391   settleTask / settleTaskCommitted：原子守卫 + 赏金转付 solver、
 *                                5% 服务费入平台收入，写 CreditTransferred 等事件。
 *   4. prod/lib/api.js:1198      hLedger 返回 entries / balance_check，用于账本校验。
 *   5. prod/lib/api.js:1705      路由表登记 41 个端点；未登记路径一律 404。
 *      prod/lib/api.js:522-525  8 条 SBC 资产化端点是从未实现的红线，本脚本只列清单做
 *                                请求前守卫，【绝不调用】。
 *   6. prod/lib/domain.js:621    sanitizeSubmissionText：证件号正则优先 + 手机号 + 长数字
 *                                兜底，均加数字边界。提交的成果正文由服务端统一脱敏。
 *   7. ops/multiagent-client.mjs SimClient 已封装 cookie(sambon_sid)/CSRF/event_id；
 *      注册 409 EMAIL_TAKEN 时需改用 login；任务状态字段是 state（不是 status）。
 *
 * 【设计要点】
 *   - 至少 2 个 publisher + 2 个 solver，注册幂等（已存在则 login）。
 *   - 每个写操作带 event_id（eid()），CSRF 由 SimClient 自动注入。
 *   - 401 → 用账号凭据重新登录并重试一次；409 区分幂等冲突与业务冲突。
 *   - 404 一律视为真实错误（红线告警）；业务预期 4xx 记入 expectedEvents，不中断整体。
 *   - 单步失败只记异常并继续；报告 JSON 落 ops/daily-agents/reports/YYYY-MM-DD.json。
 *   - 生产站 admin 关闭时：review/dispatch 前置闸门不可用，脚本不伪造成功，
 *     改为等待运营人工审核推送（DISPATCH_WAIT_MS），超时记为预期跳过；
 *     若提供了 ADMIN_EMAIL/ADMIN_PASSWORD（已存在的管理员）则可自动走完 review/dispatch。
 * ============================================================================
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SimClient, eid, waitFor, sleep } from '../multiagent-client.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = join(HERE, 'reports');

// ---------------------------------------------------------------------------
// 1. 红线清单：8 条 SBC 资产化端点，只做请求前守卫，绝不调用
//    任何 404 都会作为真实错误上报（防止有人误加调用）。
// ---------------------------------------------------------------------------
const SBC_ASSET_PATHS = Object.freeze([
  '/api/sbc/transfer', '/api/sbc/trade', '/api/sbc/redeem', '/api/sbc/withdraw',
  '/api/sbc/exchange', '/api/sbc/yield', '/api/sbc/market', '/api/wallet/cashout',
]);

function assertSafePath(path) {
  const p = String(path || '').split('?')[0].replace(/\/+$/, '') || '/';
  if (SBC_ASSET_PATHS.includes(p) || /^\/api\/(sbc|wallet)\//.test(p)) {
    throw new Error(`红线拦截：禁止调用 SBC 资产化端点 ${p}`);
  }
}

// ---------------------------------------------------------------------------
// 2. 配置：全部来自环境变量；生产环境必须显式提供账号，本地才用占位默认值
// ---------------------------------------------------------------------------
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '0.0.0.0', '[::1]']);
const pad = (n) => String(n).padStart(2, '0');

function isLocalBase(base) {
  try { return LOCAL_HOSTS.has(new URL(base).hostname.toLowerCase()); } catch { return false; }
}

function readInt(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new Error(`${name} 必须是整数，收到：${raw}`);
  return Math.max(min, Math.min(max, n));
}

/**
 * 解析账号列表。优先级：
 *   ① PUBLISHER_ACCOUNTS / SOLVER_ACCOUNTS 为 JSON 数组
 *      [{"email":"...","password":"...","display_name":"..."}]
 *   ② PUBLISHER1_EMAIL/PASSWORD、PUBLISHER2_...、SOLVER1_...（索引式）
 *   ③ 仅本地 dry-run：内置占位账号（标注 local-default，禁止用于非本地站点）
 */
function parseAccounts(envName, role, localDefaults) {
  const prefix = role === 'publisher' ? 'PUBLISHER' : 'SOLVER';
  const raw = process.env[envName];
  if (raw) {
    let arr;
    try { arr = JSON.parse(raw); } catch (e) { throw new Error(`${envName} 不是合法 JSON：${e.message}`); }
    if (!Array.isArray(arr)) throw new Error(`${envName} 必须是 JSON 数组`);
    return arr.map((x, i) => {
      const email = String(x?.email || '').trim().toLowerCase();
      const password = String(x?.password || '');
      if (!email || !password) throw new Error(`${envName}[${i}] 缺少 email 或 password`);
      return { email, password, displayName: String(x?.display_name || `${role}-${i + 1}`), source: 'env' };
    });
  }

  const indexed = [];
  for (let i = 1; i <= 4; i += 1) {
    const email = process.env[`${prefix}${i}_EMAIL`];
    const password = process.env[`${prefix}${i}_PASSWORD`];
    if (email || password) {
      if (!email || !password) throw new Error(`${prefix}${i}_EMAIL 与 ${prefix}${i}_PASSWORD 必须成对提供`);
      indexed.push({
        email: email.trim().toLowerCase(), password,
        displayName: process.env[`${prefix}${i}_NAME`] || `${role}-${i}`, source: 'env',
      });
    }
  }
  if (indexed.length) return indexed;
  return localDefaults.map((x) => ({ ...x, source: 'local-default' }));
}

/** 生产环境禁止使用内置占位口令，防止弱口令被带到线上。 */
function assertAccountsSafe(accounts, role, local) {
  if (accounts.length < 2) throw new Error(`至少需要 2 个 ${role} 账号，当前 ${accounts.length} 个`);
  if (!local && accounts.some((a) => a.source === 'local-default')) {
    throw new Error(`非本地 API_BASE 禁止使用内置占位账号，请通过 PUBLISHER_ACCOUNTS / SOLVER_ACCOUNTS 或索引式环境变量提供 ${role} 账号与密码`);
  }
}

function loadConfig() {
  const apiBase = process.env.API_BASE || 'https://sambon.net';
  const local = isLocalBase(apiBase);
  const now = new Date();
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const publishers = parseAccounts('PUBLISHER_ACCOUNTS', 'publisher', [
    { email: 'daily_pub1@local.test', password: 'LocalOnly!Pub1_2026', displayName: '每日发布方甲' },
    { email: 'daily_pub2@local.test', password: 'LocalOnly!Pub2_2026', displayName: '每日发布方乙' },
  ]);
  const solvers = parseAccounts('SOLVER_ACCOUNTS', 'solver', [
    { email: 'daily_solver1@local.test', password: 'LocalOnly!Solver1_2026', displayName: '每日接单方甲' },
    { email: 'daily_solver2@local.test', password: 'LocalOnly!Solver2_2026', displayName: '每日接单方乙' },
  ]);
  assertAccountsSafe(publishers, 'publisher', local);
  assertAccountsSafe(solvers, 'solver', local);

  // 管理员：生产站 admin 已关闭（bootstrap 返回 503）。若运营方另有已存在的 admin 凭据，
  // 可通过 ADMIN_EMAIL/ADMIN_PASSWORD 提供，用于 review/dispatch（仍不用 auto_accept）。
  // 本地 dry-run 可用 ADMIN_BOOTSTRAP_TOKEN 一次性引导（preview-server 默认 preview-admin）。
  const admin = {
    email: (process.env.ADMIN_EMAIL || (local ? 'daily_admin@local.test' : '')).trim().toLowerCase(),
    password: process.env.ADMIN_PASSWORD || (local ? 'LocalOnly!Admin2026' : ''),
    token: process.env.ADMIN_BOOTSTRAP_TOKEN || (local ? 'preview-admin' : ''),
  };

  // 默认完成 1~2 个：按日期奇偶确定性取值，便于 CI 复现；显式环境变量优先。
  const defaultComplete = ((now.getDate() % 2) === 0) ? 2 : 1;
  const completeCount = readInt('DAILY_COMPLETE_COUNT', defaultComplete, 0, 20);

  return {
    apiBase, local, date, publishers, solvers, admin,
    publishCount: readInt('DAILY_PUBLISH_COUNT', 10, 1, 200),
    completeCount,
    dispatchWaitMs: readInt('DISPATCH_WAIT_MS', 6000, 0, 120000),
    pollIntervalMs: readInt('POLL_INTERVAL_MS', 500, 100, 5000),
  };
}

// ---------------------------------------------------------------------------
// 3. 中文合规任务模板：12 组差异化标题 / 描述 / 验收标准，赏金 10~30 SBC。
//    内容均为虚构样例，避开 BANNED_WORDS（prod/lib/domain.js:576）。
// ---------------------------------------------------------------------------
const TASK_TEMPLATES = Object.freeze([
  { title: '社区读书会海报美化', category: 'design', bounty: 20,
    description: '为社区读书会设计一张竖版宣传海报，提供 PNG 成品与可编辑源文件，配色清新、层次清楚。',
    acceptance_criteria: '交付 PNG 图片与可编辑源文件各一份，画面尺寸不小于 1080×1440，文字清晰无错别字。' },
  { title: '产品说明短文润色', category: 'writing', bounty: 15,
    description: '把一段约 300 字的产品说明润色为通俗易懂的中文短文，保持原意不变，不添加夸张描述。',
    acceptance_criteria: '输出 300–400 字中文短文，语句通顺、术语一致，不含未经证实的功效承诺。' },
  { title: '英文活动公告中文转述', category: 'translation', bounty: 18,
    description: '将一段英文活动公告转述为中文，准确保留时间、地点与参与方式，语气友好自然。',
    acceptance_criteria: '中文译文信息完整，时间与地点无遗漏，术语前后一致，篇幅约 200 字。' },
  { title: '活动报名表数据整理', category: 'data', bounty: 25,
    description: '把一份字段不统一的报名表整理为列名一致的 CSV 文本，并对空缺项做显式标注。',
    acceptance_criteria: '输出可直接复制的 CSV 文本，列名统一，空缺项标注为“待补充”，不改动原始数值。' },
  { title: '城市公园半日游路线建议', category: 'research', bounty: 12,
    description: '整理一份城市公园半日游路线建议，说明步行顺序、休息点与大致用时。',
    acceptance_criteria: '给出不少于 5 个停留点，顺序合理，全程用时说明清楚，文字简洁。' },
  { title: '工具脚本中文注释补充', category: 'coding', bounty: 30,
    description: '为一个简单工具脚本补充中文注释，说明每个函数的输入、输出与使用时注意事项。',
    acceptance_criteria: '每个函数均有中文注释，不改变原有代码逻辑，注释与实现语义一致。' },
  { title: '绿色出行短视频分镜脚本', category: 'video', bounty: 22,
    description: '撰写一段 60 秒短视频分镜脚本，主题为绿色出行，风格温暖、节奏明快。',
    acceptance_criteria: '包含不少于 6 个镜头，逐镜头写明画面内容与旁白，总时长控制在 60 秒左右。' },
  { title: '图标配套文案校对', category: 'design', bounty: 14,
    description: '校对一组图标配套文案，修正错别字、标点与用词不一致之处。',
    acceptance_criteria: '按“原文 / 修改后 / 修改原因”三列列出不少于 8 条，修改理由清楚。' },
  { title: '虚构会议记录要点提炼', category: 'writing', bounty: 16,
    description: '把一段虚构会议记录提炼为 5 条要点，覆盖主要讨论与决议，不添加原文没有的结论。',
    acceptance_criteria: '恰好 5 条要点，每条不超过 30 字，语义完整、无冗余表述。' },
  { title: '问卷统计口径说明', category: 'data', bounty: 19,
    description: '编写一份问卷统计口径说明，解释均值与占比的计算方式及四舍五入规则。',
    acceptance_criteria: '说明清晰、定义明确，含 2 个计算示例，示例数据须为公开或虚构数字。' },
  { title: '日期校验正则逐段注释', category: 'coding', bounty: 24,
    description: '为一条校验日期格式的正则表达式添加逐段中文注释，并说明其匹配范围。',
    acceptance_criteria: '按片段解释含义，给出 3 个通过示例与 3 个不通过示例，示例均为虚构。' },
  { title: '青少年图书清单整理', category: 'research', bounty: 26,
    description: '整理一份适合青少年阅读的公开出版图书清单，按主题分组并附简短推荐语。',
    acceptance_criteria: '不少于 10 本书，按主题分组，每条含书名、作者与一句推荐语，信息为公开资料。' },
]);

/**
 * 交付正文：内容为虚构样例。末尾三个数字串仅用于触发服务端脱敏管线，
 * 均为虚构测试数据（pattern 与 prod/lib/domain.js:621 的证件号优先 + 数字边界对应）。
 * 原始明文不写入报告，只上报脱敏布尔值与计数。
 */
function buildSubmission(task) {
  return [
    `【每日互动自动交付】任务 ${task.task_id}`,
    '1. 已按验收标准完成全部条目，内容均为虚构样例；',
    '2. 未包含任何真实个人信息，联系方式以平台虚拟号为准；',
    '3. 脱敏自检串（虚构测试数据）：证件号 110101199001011234，手机号 13800000000，长数字 123456789012345；',
    '4. 如需补充说明，请在验收意见中留言。',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// 4. 报告收集器与 4xx 分类
// ---------------------------------------------------------------------------
let report = null;
const accountSpecs = new Map(); // email → { email, password }（仅内存，绝不写入报告）

/** 业务预期 4xx：出现即记录但不算真实错误；404 永远算真实错误。 */
const EXPECTED_CODES = new Set([
  'EMAIL_TAKEN',                 // 409 注册幂等：账号已存在 → 转 login
  'TASK_ALREADY_ACCEPTED',       // 409 已被其他接单人锁定
  'CONCURRENT_CONFLICT',         // 409 并发抢单冲突
  'IDEMPOTENCY_IN_PROGRESS',     // 409 同一 event_id 处理中 → 短暂等待重试
  'ILLEGAL_TRANSITION',          // 400 状态未推进（如前置闸门未开）
  'FORBIDDEN',                   // 403 权限闸门（如无 admin）
  'RATE_LIMITED',                // 429 限流，瞬时可恢复
  'ADMIN_BOOTSTRAP_DISABLED',    // 503 生产站 admin 关闭（预期环境限制）
  'ADMIN_EXISTS',                // 409 管理员已存在
  'SETTLEMENT_CONFLICT',         // 409 结算守卫（防双花，不重试）
  'SOLVER_FILTERED',             // 422 接单人被硬过滤
]);

function classify(result, expectedCodes) {
  if (!result) return 'error';
  const code = result.error?.code || '';
  // 404 = 未登记端点 = SBC 红线信号，必须当真实错误处理
  if (result.status === 404) return 'error';
  if (result.ok === true && result.status < 400) return 'ok';
  if (expectedCodes.includes(code) || EXPECTED_CODES.has(code)) return 'expected';
  return 'error';
}

function recordStep({ phase, action, actor, result, method, path, expectedCodes = [], detail }) {
  const classification = classify(result, expectedCodes);
  const step = {
    phase, action, actor: actor || null,
    method: method || null, path: path || null,
    status: result?.status ?? null,
    ok: result?.ok === true,
    code: result?.error?.code ?? null,
    classification,
    at: new Date().toISOString(),
  };
  if (detail !== undefined) step.detail = detail;
  report.steps.push(step);
  if (classification === 'error') {
    report.anomalies.push({
      phase, action, actor: actor || null, status: step.status, code: step.code,
      message: result?.error?.message || '网络异常或非 JSON 响应', at: step.at,
      kind: result?.status === 404 ? 'RED_LINE_404' : 'REAL_ERROR',
    });
  } else if (classification === 'expected') {
    report.expectedEvents.push({ phase, action, actor: actor || null, status: step.status, code: step.code, at: step.at });
  }
  return classification;
}

function recordException({ phase, action, actor, method, path, error }) {
  const step = {
    phase, action, actor: actor || null, method: method || null, path: path || null,
    status: null, ok: false, code: 'EXCEPTION', classification: 'error',
    detail: String(error && error.message ? error.message : error), at: new Date().toISOString(),
  };
  report.steps.push(step);
  report.anomalies.push({
    phase, action, actor: actor || null, status: null, code: 'EXCEPTION',
    message: step.detail, at: step.at, kind: 'REAL_ERROR',
  });
}

/**
 * 统一请求封装：路径红线守卫 → 发请求 → 记录 HTTP 状态 →
 * 401 自动重登重试一次 → 409 IDEMPOTENCY_IN_PROGRESS 等待重试一次。
 */
async function safeRequest(ctx) {
  const { client, method, path, body, expectedCodes = [], call } = ctx;
  assertSafePath(path);
  // call 用于注册/登录：必须走 SimClient.register/login，才能让客户端把
  // csrf_token / user_id / cookie 写入会话状态；直接裸请求会导致后续写操作 CSRF_FAILED。
  const send = () => (call ? call(client) : client.request(method, path, body));
  let result;
  try {
    result = await send();
  } catch (e) {
    recordException({ ...ctx, error: e });
    return { result: null, kind: 'error' };
  }
  let kind = recordStep({ ...ctx, result, expectedCodes });

  if (result?.status === 401 && client.email && accountSpecs.has(client.email)) {
    const spec = accountSpecs.get(client.email);
    const login = await client.login(spec.email, spec.password);
    recordStep({
      phase: 'auth', action: 'relogin', actor: spec.email, client,
      method: 'POST', path: '/api/auth/login', result: login,
    });
    if (login.status === 200) {
      result = await send();
      kind = recordStep({ ...ctx, action: `${ctx.action}(401重试)`, result, expectedCodes });
    }
  }
  if (kind === 'expected' && result?.error?.code === 'IDEMPOTENCY_IN_PROGRESS') {
    await sleep(400);
    result = await send();
    kind = recordStep({ ...ctx, action: `${ctx.action}(409重试)`, result, expectedCodes });
  }
  return { result, kind };
}

// ---------------------------------------------------------------------------
// 5. 注册 / 登录（幂等）
// ---------------------------------------------------------------------------
async function ensureAccount(spec, role) {
  const client = new SimClient(report.api_base, `${role}:${spec.email}`);
  accountSpecs.set(spec.email, spec); // 用于 401 自动重登，不写报告

  const reg = await safeRequest({
    phase: 'auth', action: 'register', actor: spec.email, client,
    method: 'POST', path: '/api/auth/register',
    call: (c) => c.register(spec.email, spec.password, role, spec.displayName),
  });
  let ready = reg.result?.status === 201;
  let loginResult = null;
  if (!ready && ['EMAIL_TAKEN', 'RATE_LIMITED', 'UNAUTHORIZED'].includes(reg.result?.error?.code)) {
    loginResult = await safeRequest({
      phase: 'auth', action: 'login', actor: spec.email, client,
      method: 'POST', path: '/api/auth/login',
      call: (c) => c.login(spec.email, spec.password),
    });
    ready = loginResult.result?.status === 200;
  }
  if (!ready) return { client: null, spec, role, account: null };

  const me = await safeRequest({
    phase: 'auth', action: 'me', actor: spec.email, client, method: 'GET', path: '/api/auth/me',
  });
  const userId = me.result?.data?.user?.user_id || client.userId || null;
  if (!userId) {
    report.anomalies.push({ phase: 'auth', action: 'resolve-user-id', actor: spec.email, status: me.result?.status ?? null,
      code: 'NO_USER_ID', message: '会话建立但未取到 user_id', at: new Date().toISOString(), kind: 'REAL_ERROR' });
    return { client: null, spec, account: null };
  }
  report.accounts.push({ role, email: spec.email, user_id: userId, source: spec.source, status: 'ready' });
  return { client, spec, role, account: { userId, email: spec.email } };
}

/**
 * 管理员会话（可选）。仅两种来源：
 *   - 已存在的 admin 凭据（ADMIN_EMAIL / ADMIN_PASSWORD）；
 *   - 本地 dry-run 的引导令牌（默认 preview-admin）。
 * 返回 null 属于预期情况：生产站 admin 已关闭，后续进入“等待人工审核”降级路径。
 */
async function setupAdmin(cfg) {
  if (!cfg.admin.email || !cfg.admin.password) return null;
  const client = new SimClient(cfg.apiBase, 'admin');
  accountSpecs.set(cfg.admin.email, { email: cfg.admin.email, password: cfg.admin.password, displayName: '每日互动管理员', source: 'env' });

  // 有引导令牌时先 bootstrap（本地首次），已存在 admin 会返回 409 ADMIN_EXISTS；
  // 生产站该端点返回 503 ADMIN_BOOTSTRAP_DISABLED（预期，不记为异常），再尝试既有凭据登录。
  if (cfg.admin.token) {
    const boot = await safeRequest({
      phase: 'admin', action: 'bootstrap', actor: cfg.admin.email, client,
      method: 'POST', path: '/api/admin/bootstrap',
      body: {
        bootstrap_token: cfg.admin.token, email: cfg.admin.email,
        password: cfg.admin.password, display_name: '每日互动管理员',
      },
    });
    if (boot.result?.status === 201 || boot.result?.error?.code === 'ADMIN_EXISTS') {
      const again = await client.login(cfg.admin.email, cfg.admin.password);
      recordStep({ phase: 'admin', action: 'login-after-bootstrap', actor: cfg.admin.email, client,
        method: 'POST', path: '/api/auth/login', result: again });
      if (again.status === 200) return client;
    }
  }

  const login = await safeRequest({
    phase: 'admin', action: 'login', actor: cfg.admin.email, client,
    method: 'POST', path: '/api/auth/login',
    call: (c) => c.login(cfg.admin.email, cfg.admin.password),
  });
  return login.result?.status === 200 ? client : null;
}

// ---------------------------------------------------------------------------
// 6. 发布任务：分散到多个 publisher，低赏金控制 SBC 消耗
// ---------------------------------------------------------------------------
function dayOfYear(date) {
  const [y, m, d] = date.split('-').map(Number);
  return Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86400000);
}

async function publishTasks(cfg, publishers) {
  const published = [];
  const offset = dayOfYear(cfg.date);
  for (let i = 0; i < cfg.publishCount; i += 1) {
    const pub = publishers[i % publishers.length];
    if (!pub?.client) {
      report.anomalies.push({ phase: 'publish', action: `publish-${i + 1}`, actor: null, status: null,
        code: 'NO_PUBLISHER', message: '没有可用的发布方会话', at: new Date().toISOString(), kind: 'REAL_ERROR' });
      continue;
    }
    const tpl = TASK_TEMPLATES[(offset + i) % TASK_TEMPLATES.length];
    const body = {
      title: `【每日互动 ${cfg.date}】${tpl.title}`,
      description: tpl.description,
      category: tpl.category,
      bounty: tpl.bounty,
      acceptance_criteria: tpl.acceptance_criteria,
      deadline_hours: 72,
      required_skills: [], // 不设技能门槛，避免接单人被硬过滤（domain.js:177）
      event_id: eid(`daily-pub-${i + 1}`),
    };
    const r = await safeRequest({
      phase: 'publish', action: `publish-${i + 1}`, actor: pub.spec.email, client: pub.client,
      method: 'POST', path: '/api/tasks', body,
    });
    const task = r.result?.data?.task || null;
    const item = {
      index: i + 1, task_id: task?.task_id || null, state: task?.state || null,
      bounty: task?.bounty ?? tpl.bounty, service_fee: task?.service_fee ?? null,
      publisher_email: pub.spec.email, publisher_id: pub.account?.userId || null,
      status: r.result?.status ?? null, code: r.result?.error?.code || null,
      ok: r.result?.status === 201 && Boolean(task?.task_id),
    };
    report.published.push(item);
    if (item.ok) published.push({ ...item, task });
  }
  return published;
}

// ---------------------------------------------------------------------------
// 7. 前置闸门：PENDING_REVIEW → PUBLISHED → DISPATCHING
//    有 admin 会话时自动 review+dispatch；无 admin（生产站常见）时等待运营人工审核。
// ---------------------------------------------------------------------------
async function advanceToDispatching(cfg, task, publisherClient, adminClient) {
  if (task.state === 'DISPATCHING') return { ready: true, via: 'already-dispatching' };

  if (!adminClient) {
    const w = await waitFor(async () => {
      const r = await publisherClient.get('/api/tasks?include_terminal=true');
      const fresh = (r.data?.tasks || []).find((x) => x.task_id === task.task_id);
      return { done: fresh?.state === 'DISPATCHING', state: fresh?.state ?? null, status: r.status };
    }, { timeout: cfg.dispatchWaitMs, interval: cfg.pollIntervalMs, label: `task ${task.task_id} DISPATCHING` });
    report.notes.push({
      type: 'ADMIN_GATE_UNAVAILABLE', task_id: task.task_id,
      last_state: w.last?.state ?? null, waited_ms: cfg.dispatchWaitMs,
      note: '审核/推送需 admin，验收 approve 不需 admin；生产站 admin 已关闭。脚本不调用 auto_accept（同样需 admin），改为等待人工闸门或标记跳过。',
    });
    return { ready: Boolean(w.done), via: 'human-review' };
  }

  if (task.state === 'PENDING_REVIEW') {
    const rev = await safeRequest({
      phase: 'advance', action: 'review-approve', actor: 'admin', client: adminClient,
      method: 'POST', path: `/api/tasks/${encodeURIComponent(task.task_id)}/review`,
      body: { decision: 'approve', event_id: eid('daily-review') },
      expectedCodes: ['ILLEGAL_TRANSITION', 'FORBIDDEN'],
    });
    if (rev.result?.status !== 200 && rev.result?.error?.code !== 'ILLEGAL_TRANSITION') {
      return { ready: false, via: 'admin' };
    }
  }
  const disp = await safeRequest({
    phase: 'advance', action: 'dispatch', actor: 'admin', client: adminClient,
    method: 'POST', path: `/api/tasks/${encodeURIComponent(task.task_id)}/dispatch`,
    body: { top_k: 12, batch_size: 8, event_id: eid('daily-dispatch') },
    expectedCodes: ['ILLEGAL_TRANSITION', 'FORBIDDEN'],
  });
  // hDispatch 的 state 在 data.state（不是 data.task.state）
  return { ready: disp.result?.status === 200 && disp.result?.data?.state === 'DISPATCHING', via: 'admin' };
}

// ---------------------------------------------------------------------------
// 8. 单个任务完整闭环：接单 → 提交 → 发布方 approve → 账本校验
// ---------------------------------------------------------------------------
async function completeOneTask(cfg, task, publisher, solver, adminClient) {
  const completion = {
    task_id: task.task_id, bounty: task.bounty, service_fee: task.service_fee,
    publisher_email: publisher.spec.email, solver_email: solver.spec.email,
    steps: {}, ledger: null, ok: false, reason: null,
  };
  report.completions.push(completion);

  // 取 solver 账本快照，用于识别本次结算新增的流水（账本只追加）。
  const before = await safeRequest({
    phase: 'complete', action: 'ledger-before', actor: solver.spec.email, client: solver.client,
    method: 'GET', path: `/api/ledger/${encodeURIComponent(solver.account.userId)}`,
  });
  const beforeSeqs = new Set((before.result?.data?.entries || []).map((e) => e.seq));

  const adv = await advanceToDispatching(cfg, task, publisher.client, adminClient);
  completion.steps.advance = { ready: adv.ready, via: adv.via };
  if (!adv.ready) {
    completion.reason = '前置 review/dispatch 闸门不可用（admin 关闭且等待人工审核超时）';
    return false;
  }

  const acc = await safeRequest({
    phase: 'complete', action: 'accept', actor: solver.spec.email, client: solver.client,
    method: 'POST', path: `/api/tasks/${encodeURIComponent(task.task_id)}/accept`,
    body: { event_id: eid('daily-accept') },
    expectedCodes: ['TASK_ALREADY_ACCEPTED', 'CONCURRENT_CONFLICT', 'ILLEGAL_TRANSITION'],
  });
  completion.steps.accept = { status: acc.result?.status ?? null, state: acc.result?.data?.task?.state ?? null };
  if (acc.result?.status !== 200) { completion.reason = '接单失败'; return false; }

  const sub = await safeRequest({
    phase: 'complete', action: 'submit', actor: solver.spec.email, client: solver.client,
    method: 'POST', path: `/api/tasks/${encodeURIComponent(task.task_id)}/submit`,
    body: { content: buildSubmission(task), event_id: eid('daily-submit') },
  });
  const submitted = sub.result?.data?.task || null;
  const preview = String(submitted?.result_preview || '');
  completion.steps.submit = {
    status: sub.result?.status ?? null, state: submitted?.state ?? null,
    pii_redacted: submitted?.result_pii_redacted === true,
    preview_has_plain_digits: /\d{11,}/.test(preview),
    note: '原始明文不落库、不写报告；仅记录服务端脱敏布尔值与预览残留检查',
  };
  if (sub.result?.status !== 200) { completion.reason = '提交成果失败'; return false; }
  if (completion.steps.submit.pii_redacted !== true || completion.steps.submit.preview_has_plain_digits) {
    report.anomalies.push({ phase: 'complete', action: 'pii-redaction-check', actor: solver.spec.email,
      status: sub.result?.status, code: 'PII_REDACTION_UNEXPECTED',
      message: '成果正文未按预期脱敏或预览残留长数字串', at: new Date().toISOString(), kind: 'REAL_ERROR' });
  }

  // 关键：验收只走 decision=approve，由 publisher 本人完成；绝不调用 auto_accept（需 admin）。
  const ver = await safeRequest({
    phase: 'complete', action: 'verify-approve', actor: publisher.spec.email, client: publisher.client,
    method: 'POST', path: `/api/tasks/${encodeURIComponent(task.task_id)}/verify`,
    body: { decision: 'approve', rating: 5, event_id: eid('daily-verify') },
    expectedCodes: ['ILLEGAL_TRANSITION', 'FORBIDDEN', 'SETTLEMENT_CONFLICT'],
  });
  const settled = ver.result?.data?.task || null;
  completion.steps.verify = {
    status: ver.result?.status ?? null, decision: 'approve', state: settled?.state ?? null,
    settlement_bounty: ver.result?.data?.settlement?.bounty ?? null,
  };
  if (ver.result?.status !== 200) { completion.reason = '发布方验收失败'; return false; }

  // 账本校验：solver 新增入账 = bounty；publisher 新增出账 = bounty + service_fee；
  // 全表 delta 守恒；任务终态 SETTLED；结算回显 bounty 与任务一致。
  const after = await safeRequest({
    phase: 'complete', action: 'ledger-after', actor: solver.spec.email, client: solver.client,
    method: 'GET', path: `/api/ledger/${encodeURIComponent(solver.account.userId)}`,
  });
  const entries = (after.result?.data?.entries || []).filter((e) => !beforeSeqs.has(e.seq));
  const credit = entries.find((e) => e.task_id === task.task_id
    && e.account === `user:${solver.account.userId}` && Math.abs(Number(e.delta) - Number(task.bounty)) < 0.001);
  const debit = entries.find((e) => e.task_id === task.task_id
    && e.account === `user:${publisher.account.userId}`
    && Math.abs(Number(e.delta) + Number(task.bounty) + Number(task.service_fee || 0)) < 0.001);
  const ledger = {
    status: after.result?.status ?? null,
    balanced: after.result?.data?.balance_check?.balanced === true,
    solver_credit_found: Boolean(credit),
    publisher_debit_found: Boolean(debit),
    settlement_bounty_ok: Number(ver.result?.data?.settlement?.bounty) === Number(task.bounty),
    final_state: settled?.state ?? null,
  };
  ledger.ok = ledger.balanced && ledger.solver_credit_found && ledger.publisher_debit_found
    && ledger.settlement_bounty_ok && ledger.final_state === 'SETTLED';
  completion.ledger = ledger;
  report.ledger_checks.push({ task_id: task.task_id, ...ledger });
  if (!ledger.ok) {
    report.anomalies.push({ phase: 'complete', action: 'ledger-check', actor: solver.spec.email,
      status: after.result?.status ?? null, code: 'LEDGER_MISMATCH',
      message: '赏金转付 / 冻结扣款 / 守恒校验未全部通过', at: new Date().toISOString(), kind: 'REAL_ERROR' });
  }
  completion.ok = ledger.ok;
  return ledger.ok;
}

// ---------------------------------------------------------------------------
// 9. 主流程：单步失败只记录、不中断
// ---------------------------------------------------------------------------
async function main() {
  const cfg = loadConfig();
  const now = new Date();
  report = {
    date: cfg.date,
    generated_at: now.toISOString(),
    api_base: cfg.apiBase,
    environment: cfg.local ? 'local-dry-run' : 'remote',
    config_summary: {
      daily_publish_count: cfg.publishCount,
      daily_complete_count: cfg.completeCount,
      dispatch_wait_ms: cfg.dispatchWaitMs,
      publisher_count: cfg.publishers.length,
      solver_count: cfg.solvers.length,
    },
    red_line_guard: {
      forbidden_sbc_asset_paths: SBC_ASSET_PATHS,
      called: false,
      note: '这些端点从未被调用；safeRequest 会在请求前拦截，任何 404 均记为 RED_LINE_404',
    },
    accounts: [],          // 仅含角色 / 邮箱 / user_id，绝不含密码
    steps: [],             // 每步 HTTP 状态、code、分类
    published: [],
    completions: [],
    ledger_checks: [],
    expectedEvents: [],    // 业务预期 4xx / 环境限制
    notes: [],
    anomalies: [],         // 真实错误清单（含 404 红线告警）
    summary: {},
  };

  const publishers = [];
  for (const spec of cfg.publishers) {
    try { publishers.push(await ensureAccount(spec, 'publisher')); }
    catch (e) { recordException({ phase: 'auth', action: 'ensure-publisher', actor: spec.email, error: e }); }
  }
  const solvers = [];
  for (const spec of cfg.solvers) {
    try { solvers.push(await ensureAccount(spec, 'solver')); }
    catch (e) { recordException({ phase: 'auth', action: 'ensure-solver', actor: spec.email, error: e }); }
  }

  let adminClient = null;
  try { adminClient = await setupAdmin(cfg); }
  catch (e) { recordException({ phase: 'admin', action: 'setup', actor: cfg.admin.email, error: e }); }
  if (!adminClient) {
    // 一期已启用自动闸门（有权人 2026-11-23 风险接受）：非本地环境下 admin 凭据
    // 已配置却拿不到会话 = 凭据错误/账号失效，必须硬性失败，禁止静默跳过完成环节
    // 造成「发布了 10 个但完成 0」的假成功。本地 dry-run 仍允许降级。
    if (!cfg.local && cfg.admin.email && cfg.admin.password) {
      throw new Error(
        'ADMIN_AUTO_GATE_ENABLED_BUT_NO_SESSION: 一期自动闸门模式要求有效 admin 会话，' +
        '但 ADMIN_EMAIL/ADMIN_PASSWORD 登录失败（凭据错误或账号不存在）。' +
        '请核对 GitHub Secrets 中的 admin 凭据；未取得会话前不会发布任务，避免产生无法完成的脏数据。',
      );
    }
    report.notes.push({
      type: 'NO_ADMIN_SESSION',
      note: '本地 dry-run：未取得 admin 会话，验收仍用 publisher 本人 approve；review/dispatch 走人工等待或标记跳过。',
    });
  }

  let published = [];
  try { published = await publishTasks(cfg, publishers); }
  catch (e) { recordException({ phase: 'publish', action: 'publish-all', error: e }); }

  // 完成候选按发布顺序取；遇到闸门不可用时顺延到下一个候选。
  let completed = 0;
  let tried = 0;
  const maxTries = Math.min(published.length, cfg.completeCount + 2);
  for (const task of published) {
    if (completed >= cfg.completeCount || tried >= maxTries) break;
    tried += 1;
    const pub = publishers.find((p) => p.account?.userId === task.publisher_id) || publishers[0];
    const solver = solvers[(completed + tried - 1) % solvers.length];
    if (!pub?.client || !solver?.client) {
      report.anomalies.push({ phase: 'complete', action: 'pick-actors', actor: null, status: null,
        code: 'ACTOR_UNAVAILABLE', message: '发布方或接单方会话不可用', at: new Date().toISOString(), kind: 'REAL_ERROR' });
      continue;
    }
    try { if (await completeOneTask(cfg, task, pub, solver, adminClient)) completed += 1; }
    catch (e) { recordException({ phase: 'complete', action: 'complete-one', actor: solver.spec.email, error: e }); }
  }

  // 每个 SimClient 自带 trace，附在报告中便于逐请求核对（不含请求体中的明文口令）。
  report.client_traces = [...publishers, ...solvers]
    .filter((x) => x.client)
    .map((x) => ({ actor: x.spec.email, role: x.role, steps: x.client.trace.length, trace: x.client.trace }));

  const realErrors = report.anomalies.filter((a) => a.kind !== 'EXPECTED');
  report.summary = {
    registered_accounts: report.accounts.length,
    published_count: report.published.filter((x) => x.ok).length,
    completed_count: completed,
    ledger_checks_passed: report.ledger_checks.filter((x) => x.ok).length,
    expected_4xx_count: report.expectedEvents.length,
    anomaly_count: realErrors.length,
    red_line_404_count: report.anomalies.filter((a) => a.kind === 'RED_LINE_404').length,
    result: realErrors.length === 0 ? 'OK' : 'WITH_ERRORS',
  };

  mkdirSync(REPORT_DIR, { recursive: true });
  const file = join(REPORT_DIR, `${cfg.date}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2), 'utf8');
  console.log(`[daily-agents] ${cfg.date} 报告 → ${file}`);
  console.log(`[daily-agents] accounts=${report.summary.registered_accounts} published=${report.summary.published_count} completed=${report.summary.completed_count} ledger_ok=${report.summary.ledger_checks_passed} anomalies=${report.summary.anomaly_count}`);
  if (realErrors.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  // 兜底：配置解析等启动期错误也要尽量落报告
  const message = String(e && e.stack ? e.stack : e);
  console.error(`[daily-agents] 启动失败：${message}`);
  if (report) {
    report.anomalies.push({ phase: 'boot', action: 'main', actor: null, status: null,
      code: 'BOOT_FAILED', message: String(e && e.message ? e.message : e),
      at: new Date().toISOString(), kind: 'REAL_ERROR' });
    try {
      mkdirSync(REPORT_DIR, { recursive: true });
      writeFileSync(join(REPORT_DIR, `${report.date}.json`), JSON.stringify(report, null, 2), 'utf8');
    } catch { /* 报告写入失败不再二次抛出 */ }
  }
  process.exitCode = 1;
});
