/**
 * 用户版前端 ↔ 生产后端 API 契合验证
 *
 * 目的：用 node:sqlite 模拟 D1，直接调用 Pages Functions 的 dispatch()，
 *       逐一验证 member.js 所依赖的响应字段真实存在（防止前后端字段漂移）。
 *       这不是后端逻辑回归（那由 verify-production.mjs 覆盖），而是
 *       "前端取值路径" 的契约契合测试。
 *
 * 运行：node --disable-warning=ExperimentalWarning tests/verify-member-api.mjs
 */

import { createD1Mock } from './d1-mock.js';
import { dispatch } from '../prod/lib/api.js';

const ENV = {
  ADMIN_BOOTSTRAP_TOKEN: 'bootstrap-fit-test',
  PBKDF2_ITERATIONS: '2000', INITIAL_SBC: '1000',
  RATE_LIMIT_DISABLED: 'true', COOKIE_SECURE: 'false',
};
const db = createD1Mock();
// 首次 dispatch 请求会自动建表（与 verify-production P-05 一致），无需手工 exec schema
const env = { ...ENV, DB: db };

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

let cookie = null, csrf = null;
async function call(method, path, body, opts = {}) {
  const headers = { host: 'localhost' };
  if (cookie) headers.cookie = cookie;
  if (!['GET', 'HEAD'].includes(method)) headers['x-csrf-token'] = csrf || '';
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await dispatch(new Request('http://localhost' + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const json = await res.json();
  return { status: res.status, data: json.data, error: json.error, ok: json.ok };
}
const has = (o, keys) => keys.every((k) => o && Object.prototype.hasOwnProperty.call(o, k));

async function main() {
  console.log('=== 用户版前端 ↔ 生产后端 API 契合验证 ===\n');

  // 前端 bootstrap 依赖
  const h = await call('GET', '/api/health');
  check('FIT-01 /api/health 字段 mode/status/db/version',
    has(h.data, ['mode', 'status', 'db', 'version']));
  const cfg = await call('GET', '/api/config');
  check('FIT-02 /api/config 字段 sbc_notice/locales/default_locale/features',
    has(cfg.data, ['sbc_notice', 'locales', 'default_locale', 'features']));

  // 注册（solver）→ 前端 auth 视图取 user/session.csrf_token/verification_required
  const reg = await call('POST', '/api/auth/register', {
    email: 'fit-solver@example.com', password: 'StrongPass123!', display_name: 'Fit Solver',
    role: 'solver', locale: 'en',
  });
  csrf = reg.data?.session?.csrf_token;
  check('FIT-03 register 响应含 user/session.csrf_token/verification_required',
    has(reg.data, ['user', 'session', 'verification_required']) && !!reg.data.session.csrf_token);
  check('FIT-04 user 含 user_id/role/display_name',
    has(reg.data?.user, ['user_id', 'role', 'display_name']));

  const me = await call('GET', '/api/auth/me');
  check('FIT-05 /api/auth/me 含 user/csrf_token/preferences',
    has(me.data, ['user', 'csrf_token', 'preferences']));
  check('FIT-06 preferences.personalized_enabled 为布尔',
    typeof me.data?.preferences?.personalized_enabled === 'boolean');

  // 注册 publisher 并建任务（frontend 任务大厅/详情字段）
  const rp = await call('POST', '/api/auth/register', {
    email: 'fit-publisher@example.com', password: 'StrongPass123!', display_name: 'Fit Publisher',
    role: 'publisher', locale: 'en',
  });
  cookie = null; csrf = null;
  const lg = await call('POST', '/api/auth/login', { email: 'fit-publisher@example.com', password: 'StrongPass123!' });
  csrf = lg.data?.session?.csrf_token;
  check('FIT-07 login 响应含 user/session.csrf_token', has(lg.data, ['user', 'session']) && !!lg.data.session.csrf_token);

  const ct = await call('POST', '/api/tasks', {
    title: 'Fit test task', description: 'contract fit check', category: 'delivery',
    bounty: 100, acceptance_criteria: 'delivered on time', required_skills: ['local'],
    event_id: 'EVT-FIT-1',
  });
  const task = ct.data?.task;
  check('FIT-08 POST /api/tasks 响应含 task/compliance/rule_version',
    has(ct.data, ['task', 'compliance', 'rule_version']));
  check('FIT-09 taskView 字段齐全（前端详情/卡片取值）',
    has(task, ['task_id', 'state', 'title', 'description', 'category', 'bounty',
      'service_fee', 'acceptance_criteria', 'required_skills', 'created_at', 'deadline',
      'publisher_id', 'solver_id']));

  const lt = await call('GET', '/api/tasks');
  check('FIT-10 GET /api/tasks 响应含 count/tasks', has(lt.data, ['count', 'tasks']));

  // 榜单字段（前端 rank 视图取 rank/title/state/bounty/rank_score 与 net_sbc 等）
  const bt = await call('GET', '/api/leaderboard/tasks');
  check('FIT-11 leaderboard/tasks 含 items（榜单模式字段）',
    Array.isArray(bt.data?.items) && has(bt.data, ['mode', 'rank_weight_version']));
  const bu = await call('GET', '/api/leaderboard/users');
  check('FIT-12 leaderboard/users items 含 rank/name/net_sbc/completed_count',
    Array.isArray(bu.data?.items) && (bu.data.items.length === 0 || has(bu.data.items[0], ['rank', 'name', 'net_sbc', 'completed_count'])));
  check('FIT-13 leaderboard/users 含 rank_weight_version/weights',
    has(bu.data, ['rank_weight_version', 'weights']));

  // 账本字段（前端 wallet 取 entries/balance_check/anchor）
  const uid = lg.data.user.user_id;
  const led = await call('GET', '/api/ledger/' + encodeURIComponent(uid));
  check('FIT-14 ledger 含 entries/balance_check/anchor',
    has(led.data, ['entries', 'balance_check', 'anchor']));
  check('FIT-15 ledger.anchor 含 pii_on_chain=false', led.data?.anchor?.pii_on_chain === false);

  // 事件回放字段
  const ev = await call('GET', '/api/events?task_id=' + encodeURIComponent(task.task_id));
  check('FIT-16 events 含 count/events，event 含 seq/type/created_at',
    Array.isArray(ev.data?.events) && (ev.data.events.length === 0 || has(ev.data.events[0], ['seq', 'type', 'created_at'])));

  // 偏好开关（前端个性化按钮）
  const pref = await call('POST', '/api/preferences/personalized', { enabled: false });
  check('FIT-17 preferences/personalized 响应含 personalized_enabled/enforcement',
    has(pref.data, ['personalized_enabled', 'enforcement']) && pref.data.personalized_enabled === false);

  // 举报（前端 report 按钮）
  const rep = await call('POST', '/api/reports', { reason: 'fit test report', task_id: task.task_id });
  check('FIT-18 reports 响应含 report_id/status',
    has(rep.data, ['report_id', 'status']));

  console.log(`\n=== 结果：PASS ${pass} / FAIL ${fail} / 共 ${pass + fail} 项 ===`);
  if (fail) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
