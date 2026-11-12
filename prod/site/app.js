/* ==========================================================================
 * 三宝殿 · sambon.net — 生产系统操作台（前端 SPA，纯原生 ES module）
 *
 * 无框架、无第三方依赖、无 CDN。所有请求为同源真实 fetch，路径以 /api/ 开头。
 * 统一响应信封：{ ok: true|false, data: ..., error: { code, message } | null }
 *
 * 模块职责：
 *   A. 常量 / state   全局内存状态（会话、配置、任务、面板数据、表单草稿）
 *   B. 工具函数       HTML 转义、事件 ID、toast、通用表格、键值网格
 *   C. api()          统一 fetch 封装：CSRF 头、JSON、错误解包、401 跳转
 *   D. load*()        各 GET 数据加载器（任务、榜单、账本、事件、队列）
 *   E. render*()      纯字符串模板渲染：顶栏、认证视图、操作台各面板
 *   F. 二次确认弹窗   人工闸门（审核/推送/验收/裁定/处罚）与 DELETE 账号校验
 *   G. actions        所有写操作，写后统一刷新任务列表与详情
 *   H. bootstrap()    启动顺序：先 /api/health 判定模式与写锁，再配置与会话
 *   I. 事件委托       单一 click / input / change / submit / keydown 处理器
 * ========================================================================== */

/* ------------------------------------------------------------------ A. 状态 */

const CONSENT_KEY = 'sambon.cookie_consent.v1';

// 演示模式（/api/health 的 mode !== 'production'）下需要禁用的业务写动作。
// 说明：会话退出（logout）与 Cookie 同意属于会话/合规控制，不属于业务写入，
// 故不纳入写锁，避免把用户锁在界面内或阻断合规选择；其余 POST/DELETE 全覆盖。
const WRITE_ACTIONS = new Set([
  'publish-task', 'review', 'dispatch', 'accept', 'submit-result',
  'verify', 'dispute-open', 'dispute-resolve', 'report',
  'delete-me', 'toggle-personalized',
]);

const state = {
  health: null,            // GET /api/health 的 data
  config: null,            // GET /api/config 的 data
  writeLocked: true,       // fail-closed：健康检查通过且 mode=production 才解锁
  user: null,              // { user_id, email, display_name, role, available_sbc }
  csrf: null,              // 写操作 X-CSRF-Token 的值
  preferences: { personalized_enabled: true },
  consents: [],            // GET /api/auth/me 的 data.consents

  tasks: [],               // GET /api/tasks 的 tasks
  taskCount: 0,
  selectedTaskId: null,
  events: [],              // GET /api/events 的 events
  boardTasks: [],          // GET /api/leaderboard/tasks 的 items
  boardUsers: [],          // GET /api/leaderboard/users 的 items
  ledger: null,            // GET /api/ledger/:userId 的 data
  queue: null,             // GET /api/admin/queue 的 data（仅 admin）
  dispatchResult: null,    // POST /api/tasks/:id/dispatch 的 data

  authTab: 'login',
  authDraft: { email: '', password: '', display_name: '', role: 'publisher' },
  publishDraft: {
    title: '', description: '', category: 'general', bounty: '10',
    acceptance_criteria: '', online: 'true', radius_km: '0',
    required_skills: '', deadline_hours: '72',
  },
  detailDraft: {
    content: '', reason: '', dispute_reason: '', resolve_reason: '',
    resolution: 'close', rating: '5', top_k: '5', batch_size: '10',
    dry_run: true, report_reason: '', event_task_id: '', ledger_user_id: '',
  },
  cookieBarForced: false,  // 「Cookie 偏好」手动重新打开同意条
  modal: null,             // 当前二次确认弹窗
};

/* ------------------------------------------------------------------ B. 工具 */

class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

// 所有服务端返回的内容进入 DOM 前一律转义，避免任务标题/描述造成 XSS。
function esc(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return s.replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

// 写操作请求体中的 event_id：优先使用浏览器原生 UUID。
function newEventId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}

// localStorage 在部分隐私模式下会抛异常，统一兜底。
function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function lsSet(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* 忽略 */ } }

// 统一 toast：错误一律显示 error.code + error.message，不静默失败。
function toast(message, type = 'ok') {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'toast ' + (type === 'error' ? 'toast-error' : 'toast-ok');
  el.textContent = message;
  root.appendChild(el);
  window.setTimeout(() => {
    el.classList.add('toast-out');
    window.setTimeout(() => el.remove(), 260);
  }, 4200);
}

function showError(err) {
  const code = (err && err.code) || 'UNKNOWN';
  const message = (err && err.message) || '未知错误';
  toast('[' + code + '] ' + message, 'error');
}

function shortId(id) {
  const s = String(id || '');
  return s.length > 14 ? s.slice(0, 12) + '…' : s;
}

function cell(v) {
  if (v === null || v === undefined || v === '') return '<span class="muted">—</span>';
  if (typeof v === 'boolean') return v ? '是' : '否';
  if (typeof v === 'object') return '<code>' + esc(JSON.stringify(v)) + '</code>';
  return esc(v);
}

// 用首行对象的并集键渲染未知结构的数组（榜单 / 事件 / 队列 / 批次等）。
function genericTable(items, emptyText = '暂无数据') {
  if (!Array.isArray(items) || items.length === 0) {
    return '<p class="muted">' + esc(emptyText) + '</p>';
  }
  const keys = [];
  const seen = new Set();
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    for (const k of Object.keys(it)) {
      if (!seen.has(k)) { seen.add(k); keys.push(k); }
    }
  }
  const cols = keys.slice(0, 12);
  if (cols.length === 0) return '<p class="muted">' + esc(emptyText) + '</p>';
  const head = cols.map(k => '<th>' + esc(k) + '</th>').join('');
  const rows = items.map(it =>
    '<tr>' + cols.map(k => '<td>' + cell(it && it[k]) + '</td>').join('') + '</tr>'
  ).join('');
  return '<div class="table-wrap"><table class="table"><thead><tr>' + head +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}

function kv(rows) {
  return rows.map(([k, v]) =>
    '<div class="kv-row"><span class="kv-key">' + esc(k) +
    '</span><span class="kv-val">' + cell(v) + '</span></div>'
  ).join('');
}

function badgeClass(s) {
  const v = String(s || '').toUpperCase();
  if (v.includes('DISPUT')) return 'badge-danger';
  if (v.includes('REJECT') || v.includes('FAIL') || v.includes('TERMINAL')) return 'badge-warn';
  if (v.includes('DONE') || v.includes('APPROV') || v.includes('COMPLET') || v.includes('SUCCESS')) return 'badge-ok';
  if (v.includes('PENDING') || v.includes('REVIEW')) return 'badge-warn';
  return 'badge-info';
}

function currentTask() {
  return state.tasks.find(t => t.task_id === state.selectedTaskId) || null;
}

function taskPath(suffix) {
  return '/api/tasks/' + encodeURIComponent(state.selectedTaskId) + '/' + suffix;
}

function isAdmin() {
  return !!(state.user && state.user.role === 'admin');
}

/* ------------------------------------------------------------------ C. api() */

/**
 * 统一 API 调用。
 * @param {string} path 同源 /api/ 路径
 * @param {object} opts { method, body, silent401, authAttempt }
 *   - silent401 : 401 时清理会话并返回 null（用于启动探测 /api/auth/me），不弹错误
 *   - authAttempt : 登录/注册的 401 属于凭据错误，不触发会话跳转，交由调用方 toast
 * @returns {Promise<any|null>} 解包后的 data
 * @throws {ApiError} 网络错误 / 非法响应 / !ok / 401
 */
async function api(path, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  const isWrite = method === 'POST' || method === 'DELETE' || method === 'PUT' || method === 'PATCH';
  const headers = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  // 契约：所有写操作必须携带 X-CSRF-Token。值来自登录/注册响应
  // data.session.csrf_token，或 GET /api/auth/me 的 data.csrf_token。
  // 匿名阶段（首次 Cookie 同意）尚无会话时携带空值，由后端按匿名请求处理；
  // 一旦登录，state.csrf 即替换为服务端签发的真实令牌。
  // 会话 Cookie 为 httpOnly，由浏览器同源请求自动携带，前端不接触、不存储。
  if (isWrite) headers['X-CSRF-Token'] = state.csrf || '';

  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    throw new ApiError('NETWORK_ERROR', '网络请求失败：' + (e && e.message ? e.message : e), 0);
  }

  let payload;
  try {
    payload = await res.json();
  } catch (e) {
    throw new ApiError('BAD_RESPONSE', '响应不是合法 JSON（HTTP ' + res.status + '）', res.status);
  }

  // 401 统一跳转：清理登录态并回到认证视图。登录/注册失败不跳转。
  if (res.status === 401) {
    const err = (payload && payload.error) || { code: 'UNAUTHORIZED', message: '未登录或登录已失效' };
    if (opts.authAttempt) throw new ApiError(err.code, err.message, 401);
    clearSession();
    if (opts.silent401) return null;
    render();
    toast('[' + err.code + '] ' + err.message, 'error');
    throw new ApiError(err.code, err.message, 401);
  }

  if (!res.ok || !payload || payload.ok !== true || payload.error) {
    const err = (payload && payload.error) ||
      { code: 'HTTP_' + res.status, message: '请求失败（HTTP ' + res.status + '）' };
    throw new ApiError(err.code, err.message, res.status);
  }
  return payload.data;
}

function clearSession() {
  state.user = null;
  state.csrf = null;
  state.preferences = { personalized_enabled: true };
  state.consents = [];
  state.selectedTaskId = null;
  state.queue = null;
  state.dispatchResult = null;
}

/* ------------------------------------------------------------------ D. 加载器 */

async function loadTasks() {
  try {
    const d = await api('/api/tasks?include_terminal=true');
    state.tasks = Array.isArray(d.tasks) ? d.tasks : [];
    state.taskCount = d.count === undefined ? state.tasks.length : d.count;
    if (state.selectedTaskId && !state.tasks.some(t => t.task_id === state.selectedTaskId)) {
      state.selectedTaskId = null;
      state.dispatchResult = null;
    }
  } catch (e) { showError(e); }
}

async function loadEvents() {
  const id = state.detailDraft.event_task_id || state.selectedTaskId;
  if (!id) { state.events = []; return; }
  try {
    const d = await api('/api/events?task_id=' + encodeURIComponent(id));
    state.events = Array.isArray(d.events) ? d.events : [];
  } catch (e) { showError(e); }
}

async function loadBoards() {
  const [t, u] = await Promise.all([
    api('/api/leaderboard/tasks').catch(e => { showError(e); return null; }),
    api('/api/leaderboard/users').catch(e => { showError(e); return null; }),
  ]);
  state.boardTasks = t && Array.isArray(t.items) ? t.items : [];
  state.boardUsers = u && Array.isArray(u.items) ? u.items : [];
}

async function loadLedger() {
  const uid = state.detailDraft.ledger_user_id || (state.user && state.user.user_id);
  if (!uid) { state.ledger = null; return; }
  try {
    state.ledger = await api('/api/ledger/' + encodeURIComponent(uid));
  } catch (e) { showError(e); }
}

async function loadQueue() {
  // 仅 admin 请求队列，避免非管理员每次刷新都收到 401。
  if (!isAdmin()) { state.queue = null; return; }
  try { state.queue = await api('/api/admin/queue'); }
  catch (e) { showError(e); }
}

async function refreshMe() {
  const me = await api('/api/auth/me', { silent401: true });
  if (!me) return;
  state.user = me.user || state.user;
  state.csrf = me.csrf_token || state.csrf;
  state.preferences = me.preferences || state.preferences;
  state.consents = Array.isArray(me.consents) ? me.consents : [];
  syncConsentFromServer();
}

// 契约要求：每个写操作调用后刷新任务列表与详情。
// 详情数据来自任务列表，故统一刷新全部只读面板并整体重绘。
async function refreshAfterWrite() {
  await Promise.all([loadTasks(), loadEvents(), loadBoards(), loadLedger(), loadQueue()]);
  render();
}

async function loadConsoleData() {
  if (!state.user) return;
  if (!state.detailDraft.ledger_user_id) state.detailDraft.ledger_user_id = state.user.user_id;
  await Promise.all([loadTasks(), loadEvents(), loadBoards(), loadLedger(), loadQueue()]);
}

/* ------------------------------------------------------------------ E. 渲染 */

function render() {
  renderTopbar();
  renderBanners();
  const app = document.getElementById('app');
  app.innerHTML = state.user ? renderConsole() : renderAuthView();
  applyWriteLock();
  renderCookieBar();
  renderMeta();
}

function renderTopbar() {
  const mode = (state.health && state.health.mode) || '—';
  const badge = document.getElementById('mode-badge');
  if (badge) {
    badge.textContent = 'mode: ' + mode;
    badge.className = 'badge ' + (mode === 'production' ? 'badge-ok' : 'badge-warn');
  }
  const chip = document.getElementById('user-chip');
  if (chip) {
    chip.textContent = state.user
      ? state.user.display_name + '（' + state.user.email + '）· 角色 ' + state.user.role
      : '未登录';
  }
  const out = document.getElementById('logout-btn');
  if (out) out.hidden = !state.user;
}

function renderBanners() {
  const el = document.getElementById('demo-banner');
  if (el) el.hidden = !state.writeLocked;
}

function renderMeta() {
  const el = document.getElementById('meta-line');
  if (!el) return;
  const h = state.health;
  el.textContent = h
    ? '后端状态 ' + (h.status || '—') + ' · 数据库 ' + (h.db || '—') +
      ' · 版本 ' + (h.version || '—') + ' · 时间 ' + (h.time || '—') +
      ' · 写操作' + (state.writeLocked ? '已禁用' : '可用')
    : '健康检查未通过，写操作已禁用';
}

// 演示模式：把所有业务写按钮置为 disabled（视觉）+ 处理器内二次拦截（逻辑）。
function applyWriteLock() {
  document.querySelectorAll('#app [data-action]').forEach(el => {
    if (state.writeLocked && WRITE_ACTIONS.has(el.dataset.action)) {
      el.disabled = true;
      el.title = '演示模式：后端未绑定 D1 持久化，写操作不可用';
    }
  });
}

function renderCookieBar() {
  const bar = document.getElementById('cookie-bar');
  if (!bar) return;
  bar.hidden = !state.cookieBarForced && !!lsGet(CONSENT_KEY);
}

// 服务端已有 Cookie 同意记录时，回填 localStorage，避免重复弹出。
function syncConsentFromServer() {
  if (lsGet(CONSENT_KEY)) return;
  const rec = (state.consents || []).find(c => c && c.kind === 'cookie');
  if (rec) lsSet(CONSENT_KEY, rec.granted ? 'all' : 'necessary');
}

/* ---- E1. 认证视图 ---- */

function renderAuthView() {
  const d = state.authDraft;
  const isLogin = state.authTab === 'login';
  const fields = isLogin ? `
      <label class="form-row"><span>邮箱</span><input type="email" name="email" data-model="authDraft.email" value="${esc(d.email)}" required autocomplete="username" placeholder="name@example.com"></label>
      <label class="form-row"><span>密码</span><input type="password" name="password" data-model="authDraft.password" value="${esc(d.password)}" required autocomplete="current-password"></label>
      <button type="submit" class="btn btn-primary" data-action="login">登录</button>` : `
      <label class="form-row"><span>邮箱</span><input type="email" name="email" data-model="authDraft.email" value="${esc(d.email)}" required autocomplete="username" placeholder="name@example.com"></label>
      <label class="form-row"><span>密码</span><input type="password" name="password" data-model="authDraft.password" value="${esc(d.password)}" required autocomplete="new-password"></label>
      <label class="form-row"><span>显示名</span><input type="text" name="display_name" data-model="authDraft.display_name" value="${esc(d.display_name)}" required></label>
      <label class="form-row"><span>角色</span>
        <select name="role" data-model="authDraft.role">
          <option value="publisher" ${d.role === 'publisher' ? 'selected' : ''}>发布方 publisher</option>
          <option value="solver" ${d.role === 'solver' ? 'selected' : ''}>解决方 solver</option>
        </select>
      </label>
      <button type="submit" class="btn btn-primary" data-action="register">注册</button>`;

  return `
  <div class="auth-wrap">
    <div class="card auth-card">
      <h2>账号接入</h2>
      <p class="muted">本站为生产系统演示环境，账号接入仅用于内部核验，不构成服务对外开放或运营许可。</p>
      <div class="tabs">
        <button type="button" class="tab ${isLogin ? 'active' : ''}" data-action="auth-tab" data-tab="login">登录</button>
        <button type="button" class="tab ${!isLogin ? 'active' : ''}" data-action="auth-tab" data-tab="register">注册</button>
      </div>
      <form data-form="${isLogin ? 'login' : 'register'}" class="stack">${fields}</form>
      ${state.writeLocked ? '<p class="banner-demo inline">演示模式：后端未绑定 D1 持久化，写操作不可用。<a href="/index.html">L0 演示台</a></p>' : ''}
      <p class="muted">登录 / 注册响应中的 <code>data.session.csrf_token</code> 将用于后续所有写操作的 <code>X-CSRF-Token</code> 请求头；会话 Cookie 为 httpOnly，由浏览器自动携带。</p>
    </div>
    <div class="card">
      <h3>合规要点 / Compliance Notes (EN)</h3>
      <ul class="en-list">
        <li>Demonstration environment only; no operating licence is granted (docs/07 G1–G7 / V1–V8 not fully discharged).</li>
        <li>SBC is an in-platform contribution point, non-redeemable and non-transferable; not an asset, security or investment product. No redeemable value or value guarantee is offered.</li>
        <li>Settlement, dispute resolution, task review and sanctions are manual gates with explicit human confirmation.</li>
        <li>AI ranking is disclosed and personalisation can be disabled; enforcement is server-side (enforcement: server_side).</li>
        <li>GDPR rights and Cloudflare DPA / EU SCC cross-border safeguards apply; adults only (18+).</li>
        <li>No specific SLA, uptime or response-time figure is promised. Contact: privacy@sambon.net (placeholder).</li>
      </ul>
      <p><a href="/legal.html">完整政策：隐私政策 / 服务条款 / 可接受使用政策 / AI 透明度 / 未成年人限制 / 举报通道</a></p>
    </div>
  </div>`;
}

/* ---- E2. 操作台视图 ---- */

function renderConsole() {
  return `
  <div class="layout">
    <section class="col col-left">
      ${renderTasksCard()}
      ${renderPublishCard()}
      ${renderComplianceCard()}
    </section>
    <section class="col col-right">
      ${renderDetailCard()}
      ${renderQueueCard()}
      ${renderBoardsCard()}
      ${renderLedgerCard()}
      ${renderEventsCard()}
      ${renderAICard()}
      ${renderAccountCard()}
    </section>
  </div>`;
}

function renderTasksCard() {
  return `
  <div class="card">
    <div class="card-head">
      <h3>任务列表</h3>
      <div class="card-tools">
        <span class="muted">共 ${esc(state.taskCount)} 条（含终态）</span>
        <button type="button" class="btn btn-ghost btn-sm" data-action="refresh-tasks">刷新</button>
      </div>
    </div>
    <p class="muted">悬赏以 SBC 计量；SBC 为平台内贡献积分，不可兑付、不可转让，不构成资产或投资标的。点击行查看详情。</p>
    ${renderTasksTable()}
  </div>`;
}

function renderTasksTable() {
  if (!state.tasks.length) return '<p class="muted">暂无任务数据；可发布任务或点击「刷新」。</p>';
  const rows = state.tasks.map(t => `
    <tr data-action="select-task" data-id="${esc(t.task_id)}" class="clickable-row ${t.task_id === state.selectedTaskId ? 'row-selected' : ''}" title="${esc(t.task_id)}">
      <td><code>${esc(shortId(t.task_id))}</code></td>
      <td><span class="badge ${badgeClass(t.state)}">${esc(t.state)}</span></td>
      <td>${esc(t.title)}</td>
      <td>${esc(t.category)}</td>
      <td>${esc(t.bounty)}</td>
      <td>${esc(t.service_fee)}</td>
      <td>${esc(t.frozen_total)}</td>
      <td class="muted">${esc(t.created_at)}</td>
    </tr>`).join('');
  return `<div class="table-wrap"><table class="table">
    <thead><tr><th>任务 ID</th><th>状态</th><th>标题</th><th>分类</th><th>悬赏 SBC</th><th>服务费</th><th>冻结合计</th><th>创建时间</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function renderPublishCard() {
  const d = state.publishDraft;
  return `
  <div class="card">
    <h3>发布任务</h3>
    <form data-form="publish-task" class="stack">
      <label class="form-row"><span>标题</span><input type="text" data-model="publishDraft.title" value="${esc(d.title)}" required></label>
      <label class="form-row"><span>描述</span><textarea rows="2" data-model="publishDraft.description">${esc(d.description)}</textarea></label>
      <div class="grid-2">
        <label class="form-row"><span>分类</span><input type="text" data-model="publishDraft.category" value="${esc(d.category)}"></label>
        <label class="form-row"><span>悬赏（SBC 贡献积分）</span><input type="number" min="0" step="1" data-model="publishDraft.bounty" value="${esc(d.bounty)}"></label>
      </div>
      <label class="form-row"><span>验收标准</span><textarea rows="2" data-model="publishDraft.acceptance_criteria">${esc(d.acceptance_criteria)}</textarea></label>
      <div class="grid-2">
        <label class="form-row"><span>线上 / 线下</span>
          <select data-model="publishDraft.online">
            <option value="true" ${d.online === 'true' ? 'selected' : ''}>线上 online</option>
            <option value="false" ${d.online === 'false' ? 'selected' : ''}>线下 offline</option>
          </select>
        </label>
        <label class="form-row"><span>半径（公里）</span><input type="number" min="0" data-model="publishDraft.radius_km" value="${esc(d.radius_km)}"></label>
      </div>
      <div class="grid-2">
        <label class="form-row"><span>所需技能（逗号分隔）</span><input type="text" data-model="publishDraft.required_skills" value="${esc(d.required_skills)}" placeholder="例如：翻译,校对"></label>
        <label class="form-row"><span>截止（小时）</span><input type="number" min="1" data-model="publishDraft.deadline_hours" value="${esc(d.deadline_hours)}"></label>
      </div>
      <button type="submit" class="btn btn-primary" data-action="publish-task">提交任务（POST /api/tasks）</button>
      <p class="muted">提交后进入 PENDING_REVIEW，由管理员人工审核；<code>event_id</code> 由前端自动生成。</p>
    </form>
  </div>`;
}

function renderComplianceCard() {
  return `
  <div class="card">
    <h3>合规要点 / Compliance Notes (EN)</h3>
    <ul class="en-list">
      <li>Demonstration environment only. G1–G7 and V1–V8 (docs/07) are not fully discharged; no operating licence is granted.</li>
      <li>SBC is an in-platform contribution point: non-redeemable and non-transferable. It is not an asset, security, e-money or investment product; no redeemable value or value guarantee is offered.</li>
      <li>Settlement, dispute resolution, task review and sanctions are manual gates confirmed by a human administrator; no automated adjudication has legal effect.</li>
      <li>AI-assisted candidate ranking is disclosed via weight_version / algorithm_degraded. Personalisation may be disabled here and is enforced server-side (enforcement: server_side).</li>
      <li>GDPR rights: access, rectification, erasure, portability, objection and consent withdrawal. Cross-border transfers rely on the Cloudflare DPA and EU Standard Contractual Clauses (SCC).</li>
      <li>Adults only (18+). No knowing collection of children's data. Reports: in-app report channel or privacy@sambon.net.</li>
      <li>No specific uptime, response-time or SLA figure is promised in this environment. Full texts: <a href="/legal.html">legal.html</a>.</li>
    </ul>
  </div>`;
}

function renderDetailCard() {
  const t = currentTask();
  if (!t) {
    return '<div class="card"><h3>详情 / 操作面板</h3><p class="muted">从左侧任务列表选择一条任务以查看详情与按状态可用动作。</p></div>';
  }
  const fields = [
    ['task_id', t.task_id], ['state', t.state], ['title', t.title],
    ['category', t.category], ['bounty', t.bounty], ['service_fee', t.service_fee],
    ['frozen_total', t.frozen_total], ['publisher_id', t.publisher_id],
    ['solver_id', t.solver_id], ['reject_count', t.reject_count], ['created_at', t.created_at],
  ];
  return `
  <div class="card">
    <div class="card-head"><h3>详情 / 操作面板</h3><span class="badge ${badgeClass(t.state)}">${esc(t.state)}</span></div>
    <div class="kv">${kv(fields)}</div>
    <div class="block">
      <h4>任务描述</h4><p class="pre">${esc(t.description || '—')}</p>
      <h4>验收标准</h4><p class="pre">${esc(t.acceptance_criteria || '—')}</p>
      <h4>虚拟联系方式</h4><p class="pre">${esc(t.virtual_contact || '—')}</p>
      <h4>成果预览 <span class="badge badge-info">成果正文已 PII 脱敏</span></h4>
      <p class="pre">${esc(t.result_preview || '—')}</p>
    </div>
    ${renderActionPanel(t)}
    ${renderDispatchResult()}
    ${renderReportBox()}
  </div>`;
}

// 按 task.state 动态显示可用动作；admin 专属按钮仅 isAdmin() 时渲染。
function renderActionPanel(t) {
  const s = String(t.state || '').toUpperCase();
  const d = state.detailDraft;
  const admin = isAdmin();
  let body = '';

  if (s === 'PENDING_REVIEW') {
    body = admin ? `
      <div class="action-row">
        <button type="button" class="btn btn-primary" data-action="review" data-decision="approve">审核通过</button>
        <button type="button" class="btn btn-danger" data-action="review" data-decision="reject">审核驳回</button>
      </div>` : '<p class="muted">任务待人工审核；审核按钮仅对 admin 角色显示。</p>';

  } else if (s === 'PUBLISHED') {
    body = admin ? `
      <div class="grid-3">
        <label class="form-row"><span>top_k</span><input type="number" min="1" data-model="detailDraft.top_k" value="${esc(d.top_k)}"></label>
        <label class="form-row"><span>batch_size</span><input type="number" min="1" data-model="detailDraft.batch_size" value="${esc(d.batch_size)}"></label>
        <label class="form-row check"><span>dry_run（仅预演）</span><input type="checkbox" data-model="detailDraft.dry_run" ${d.dry_run ? 'checked' : ''}></label>
      </div>
      <div class="action-row"><button type="button" class="btn btn-primary" data-action="dispatch">推送候选（人工闸门）</button></div>`
      : '<p class="muted">推送（dispatch）按钮仅对 admin 角色显示。</p>';

  } else if (s === 'DISPATCHING') {
    body = `
      <div class="action-row"><button type="button" class="btn btn-primary" data-action="accept">接单（solver）</button></div>
      <p class="muted">服务端按角色强制校验；仅合规的 solver 可接单。</p>`;

  } else if (s === 'ACCEPTED' || s === 'IN_PROGRESS') {
    body = `
      <label class="form-row"><span>成果内容（提交后将按规则做 PII 脱敏）</span><textarea rows="3" data-model="detailDraft.content">${esc(d.content)}</textarea></label>
      <div class="action-row"><button type="button" class="btn btn-primary" data-action="submit-result">提交成果</button></div>`;

  } else if (s === 'SUBMITTED') {
    body = `
      <div class="grid-3">
        <label class="form-row"><span>评分 rating</span><input type="number" min="1" max="5" data-model="detailDraft.rating" value="${esc(d.rating)}"></label>
        <label class="form-row"><span>验收理由 reason</span><input type="text" data-model="detailDraft.reason" value="${esc(d.reason)}"></label>
        <label class="form-row"><span>争议理由</span><input type="text" data-model="detailDraft.dispute_reason" value="${esc(d.dispute_reason)}"></label>
      </div>
      <div class="action-row">
        <button type="button" class="btn btn-primary" data-action="verify" data-decision="approve">验收通过</button>
        <button type="button" class="btn btn-danger" data-action="verify" data-decision="reject">验收驳回</button>
        ${admin ? '<button type="button" class="btn btn-ghost" data-action="verify" data-decision="auto_accept">自动验收（admin）</button>' : ''}
        <button type="button" class="btn btn-ghost" data-action="dispute-open">开启争议</button>
      </div>
      <p class="muted">approve / reject 仅发布方可执行，auto_accept 仅 admin；服务端按角色强制校验。</p>`;

  } else if (s === 'DISPUTED') {
    body = `
      <div class="grid-2">
        <label class="form-row"><span>裁定结果 resolution</span>
          <select data-model="detailDraft.resolution">
            <option value="refund_publisher" ${d.resolution === 'refund_publisher' ? 'selected' : ''}>退回发布方 refund_publisher</option>
            <option value="pay_solver" ${d.resolution === 'pay_solver' ? 'selected' : ''}>判给解决方 pay_solver</option>
            <option value="close" ${d.resolution === 'close' ? 'selected' : ''}>关闭 close</option>
          </select>
        </label>
        <label class="form-row"><span>裁定理由</span><input type="text" data-model="detailDraft.resolve_reason" value="${esc(d.resolve_reason)}"></label>
      </div>
      ${admin
        ? '<div class="action-row"><button type="button" class="btn btn-primary" data-action="dispute-resolve">人工裁定（admin）</button></div>'
        : '<p class="muted">争议裁定为管理员人工闸门，仅 admin 可提交。</p>'}`;

  } else {
    body = '<p class="muted">当前状态 <code>' + esc(s) + '</code> 无前端可用动作（终态或由系统流转）。</p>';
  }

  return `
    <div class="action-box">
      <h4>按状态可用动作 · <code>${esc(s)}</code></h4>
      <p class="muted">所有动作由服务端按角色与状态强制校验（enforcement: server_side）；前端展示不代表授权。结算、争议裁定、任务审核、处罚均为人工闸门，执行前需二次确认。</p>
      ${body}
    </div>`;
}

function renderDispatchResult() {
  const r = state.dispatchResult;
  if (!r) return '';
  const meta = kv([
    ['mode', r.mode], ['personalized', r.personalized],
    ['candidates', Array.isArray(r.candidates) ? r.candidates.length : 0],
    ['batches', Array.isArray(r.batches) ? r.batches.length : 0],
  ]);
  return `
  <div class="block">
    <h4>推送结果（dry_run 预演）</h4>
    <div class="kv">${meta}</div>
    <h5>候选 candidates</h5>${genericTable(r.candidates, '无候选')}
    <h5>批次 batches</h5>${genericTable(r.batches, '无批次')}
  </div>`;
}

function renderReportBox() {
  const d = state.detailDraft;
  return `
  <div class="block">
    <h4>举报通道</h4>
    <p class="muted">举报提交后进入人工复核；详见 <a href="/legal.html#report">legal.html 举报通道</a>。</p>
    <div class="action-row">
      <label class="form-row"><span>举报理由</span><input type="text" data-model="detailDraft.report_reason" value="${esc(d.report_reason)}" placeholder="填写举报理由"></label>
      <button type="button" class="btn btn-ghost" data-action="report">举报该任务</button>
    </div>
  </div>`;
}

function renderQueueCard() {
  const admin = isAdmin();
  const q = state.queue;
  return `
  <div class="card">
    <div class="card-head">
      <h3>管理员队列</h3>
      ${admin ? '<button type="button" class="btn btn-ghost btn-sm" data-action="refresh-queue">刷新队列</button>' : ''}
    </div>
    ${admin ? `
      <h4>待审核 pending_review</h4>${genericTable(q && q.pending_review, '队列为空')}
      <h4>争议中 disputed</h4>${genericTable(q && q.disputed, '队列为空')}
    ` : `<p class="muted">管理员队列区仅对 admin 角色开放；当前角色为 ${esc(state.user ? state.user.role : '—')}。审核、推送、裁定、自动验收等 admin 操作按钮亦仅对 admin 显示。</p>`}
  </div>`;
}

function renderBoardsCard() {
  return `
  <div class="card">
    <div class="card-head"><h3>榜单</h3><button type="button" class="btn btn-ghost btn-sm" data-action="refresh-boards">刷新</button></div>
    <h4>任务榜 leaderboard/tasks</h4>${genericTable(state.boardTasks, '暂无榜单数据')}
    <h4>用户榜 leaderboard/users</h4>${genericTable(state.boardUsers, '暂无榜单数据')}
  </div>`;
}

function renderLedgerCard() {
  const l = state.ledger;
  const check = l && l.balance_check ? l.balance_check : null;
  return `
  <div class="card">
    <div class="card-head"><h3>积分账本</h3><button type="button" class="btn btn-ghost btn-sm" data-action="refresh-ledger">刷新</button></div>
    <div class="action-row">
      <label class="form-row"><span>用户 ID（GET /api/ledger/:userId）</span><input type="text" data-model="detailDraft.ledger_user_id" value="${esc(state.detailDraft.ledger_user_id)}"></label>
    </div>
    <p class="muted">账本仅记录平台内贡献积分的冻结与记账调整，用于核对平衡；不构成任何可兑付余额。</p>
    ${l ? `
      <div class="kv">${kv([
        ['balanced', check && check.balanced],
        ['条目数', Array.isArray(l.entries) ? l.entries.length : 0],
        ['anchor', l.anchor],
      ])}</div>
      <h4>流水 entries</h4>${genericTable(l.entries, '无流水')}
    ` : '<p class="muted">暂无账本数据。</p>'}
  </div>`;
}

function renderEventsCard() {
  const d = state.detailDraft;
  return `
  <div class="card">
    <div class="card-head"><h3>事件回放</h3><button type="button" class="btn btn-ghost btn-sm" data-action="refresh-events">刷新</button></div>
    <div class="action-row">
      <label class="form-row"><span>task_id（GET /api/events?task_id=）</span><input type="text" data-model="detailDraft.event_task_id" value="${esc(d.event_task_id)}" placeholder="输入任务 ID"></label>
    </div>
    ${genericTable(state.events, '暂无事件（请先选择任务或填写 task_id）')}
  </div>`;
}

function renderAICard() {
  const c = state.config || {};
  const pref = !!(state.preferences && state.preferences.personalized_enabled);
  const degraded = c.algorithm_degraded === true || c.algorithm_degraded === 'true';
  const reds = Array.isArray(c.red_lines) ? c.red_lines : [];
  return `
  <div class="card">
    <h3>AI 透明度与配置</h3>
    <div class="kv">${kv([
      ['weight_version', c.weight_version],
      ['algorithm_degraded', c.algorithm_degraded],
      ['personalized_enabled（账号级）', pref],
      ['personalized_enabled（全局）', c.personalized_enabled],
      ['enforcement', c.enforcement || 'server_side'],
      ['rule_version', c.rule_version],
      ['mode', c.mode],
    ])}</div>
    <div class="block">
      <h4>算法说明 ai_disclosure</h4>
      <p class="pre">${esc(c.ai_disclosure || '服务端未提供说明文本。')}</p>
      <p class="muted">候选排序仅用于辅助分派，不自动完成任务审核、验收、争议裁定或处罚；上述环节均为人工闸门。${degraded ? '当前算法处于降级模式（algorithm_degraded），仅使用保守排序。' : ''}</p>
    </div>
    <div class="block">
      <label class="switch-row">
        <input type="checkbox" data-action="toggle-personalized" ${pref ? '' : 'checked'}>
        <span>关闭个性化推荐</span>
      </label>
      <p class="muted">勾选＝关闭；取消勾选＝开启。<strong>服务端强制生效</strong>（enforcement: server_side），客户端无法绕过；关闭方式亦见 <a href="/legal.html#ai">legal.html AI 透明度</a>。</p>
    </div>
    <div class="block">
      <h4>红线 red_lines</h4>
      ${reds.length
        ? '<ul class="plain-list">' + reds.map(r => '<li>' + esc(typeof r === 'object' ? JSON.stringify(r) : r) + '</li>').join('') + '</ul>'
        : '<p class="muted">服务端未返回红线条目。</p>'}
      <p class="en">Algorithm-assisted ranking is disclosed above; personalisation is enforced server-side and may be disabled without affecting task integrity. No automated decision produces legal effects.</p>
    </div>
  </div>`;
}

function renderAccountCard() {
  return `
  <div class="card">
    <h3>数据与账号（GDPR）</h3>
    <div class="action-row">
      <button type="button" class="btn btn-ghost" data-action="export-me">导出我的数据（JSON）</button>
      <button type="button" class="btn btn-danger" data-action="delete-me">删除我的账号</button>
      <button type="button" class="btn btn-ghost" data-action="cookie-settings">Cookie 偏好</button>
    </div>
    <p class="muted">导出对应 <code>GET /api/me/export</code>（数据可携带权）；删除对应 <code>DELETE /api/me</code>，需输入 <code>DELETE</code> 二次确认，处理后自动退出登录。详细权利见 <a href="/legal.html#gdpr">legal.html 隐私政策</a>。</p>
    <p class="muted">删除账号属高影响操作，前端要求显式输入确认；服务端按 enforcement: server_side 校验。</p>
  </div>`;
}

/* ------------------------------------------------------------------ F. 弹窗 */

const GATE_NOTE = '<p class="gate-note">人工闸门：结算、争议裁定、任务审核与处罚均须经人工确认后由服务端执行；服务端按角色与状态强制校验（enforcement: server_side），前端展示不构成授权。</p>';

// 管理员/闸门类操作统一走此弹窗，确认按钮文案固定为「人工确认」。
function confirmGate(title, detailHtml, danger = false) {
  return openConfirm({
    title: title,
    bodyHtml: '<p>' + detailHtml + '</p>' + GATE_NOTE,
    confirmLabel: '人工确认',
    danger: danger,
  });
}

function openConfirm(cfg) {
  return new Promise(resolve => {
    state.modal = {
      title: cfg.title,
      bodyHtml: cfg.bodyHtml,
      confirmLabel: cfg.confirmLabel || '人工确认',
      danger: !!cfg.danger,
      requireText: cfg.requireText || null,
      resolve: resolve,
    };
    renderModal();
  });
}

function resolveModal(value) {
  const m = state.modal;
  if (!m) return;
  if (value && m.requireText) {
    const input = document.getElementById('modal-input');
    const typed = input ? input.value.trim() : '';
    if (typed !== m.requireText) {
      toast('[CONFIRM_REQUIRED] 请输入 ' + m.requireText + ' 以确认该操作', 'error');
      return;
    }
  }
  state.modal = null;
  renderModal();
  m.resolve(value);
}

function renderModal() {
  const root = document.getElementById('modal-root');
  const m = state.modal;
  if (!m) { root.hidden = true; root.innerHTML = ''; return; }
  root.hidden = false;
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal card" role="dialog" aria-modal="true" aria-label="${esc(m.title)}">
        <h3 class="modal-title">${esc(m.title)}</h3>
        <div class="modal-body">${m.bodyHtml}</div>
        ${m.requireText
          ? '<label class="form-row"><span>请输入 <code>' + esc(m.requireText) + '</code> 以确认</span><input id="modal-input" type="text" autocomplete="off" spellcheck="false" placeholder="' + esc(m.requireText) + '"></label>'
          : ''}
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-action="modal-cancel">取消</button>
          <button type="button" class="btn ${m.danger ? 'btn-danger' : 'btn-primary'}" data-action="modal-confirm">${esc(m.confirmLabel)}</button>
        </div>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ G. 动作 */

async function doAuth(kind) {
  const d = state.authDraft;
  const path = kind === 'login' ? '/api/auth/login' : '/api/auth/register';
  const body = kind === 'login'
    ? { email: d.email, password: d.password }
    : { email: d.email, password: d.password, display_name: d.display_name, role: d.role };
  try {
    const data = await api(path, { method: 'POST', body: body, authAttempt: true });
    state.user = data.user;
    state.csrf = (data.session && data.session.csrf_token) || state.csrf;
    state.consents = [];
    state.preferences = { personalized_enabled: true };
    if (data.user) state.detailDraft.ledger_user_id = data.user.user_id;
    toast('账号已接入：' + (data.user.display_name || data.user.email));
    // 以 /api/auth/me 校准偏好、同意记录与 CSRF（契约规定的令牌来源之一）
    try { await refreshMe(); } catch (e) { showError(e); }
    await loadConsoleData();
    render();
    renderCookieBar();
  } catch (e) {
    showError(e);
  }
}

async function doLogout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
    toast('已退出登录');
  } catch (e) {
    showError(e);
  }
  clearSession();
  state.tasks = [];
  state.taskCount = 0;
  state.events = [];
  state.boardTasks = [];
  state.boardUsers = [];
  state.ledger = null;
  state.queue = null;
  render();
}

async function doPublish() {
  const d = state.publishDraft;
  const body = {
    title: String(d.title).trim(),
    description: String(d.description).trim(),
    category: String(d.category).trim() || 'general',
    bounty: Number(d.bounty),
    acceptance_criteria: String(d.acceptance_criteria).trim(),
    online: d.online === true || d.online === 'true',
    radius_km: Number(d.radius_km),
    required_skills: String(d.required_skills).split(/[,，\s]+/).map(s => s.trim()).filter(Boolean),
    deadline_hours: Number(d.deadline_hours),
    event_id: newEventId(),
  };
  if (!body.title) { toast('[VALIDATION] 请填写任务标题', 'error'); return; }
  try {
    const data = await api('/api/tasks', { method: 'POST', body: body });
    const id = data && data.task ? data.task.task_id : '';
    toast('任务已提交' + (id ? '：' + id : '') + '（合规校验已由服务端返回）');
    await refreshAfterWrite();
  } catch (e) { showError(e); }
}

function selectTask(id) {
  state.selectedTaskId = id;
  state.detailDraft.event_task_id = id;
  state.dispatchResult = null;
  render();
  void loadEvents().then(render);
}

async function doReview(decision) {
  const t = currentTask();
  if (!t) return;
  const label = decision === 'approve' ? '审核通过' : '审核驳回';
  const ok = await confirmGate('人工确认 · 任务审核',
    '任务 <code>' + esc(t.task_id) + '</code> 将执行「' + label + '」。', decision === 'reject');
  if (!ok) return;
  try {
    await api(taskPath('review'), { method: 'POST', body: { decision: decision, event_id: newEventId() } });
    toast('审核结果已提交（人工闸门）');
    await refreshAfterWrite();
  } catch (e) { showError(e); }
}

async function doDispatch() {
  const t = currentTask();
  if (!t) return;
  const d = state.detailDraft;
  const ok = await confirmGate('人工确认 · 候选推送',
    '任务 <code>' + esc(t.task_id) + '</code> 将执行算法候选推送（dry_run 预演）。', false);
  if (!ok) return;
  try {
    const data = await api(taskPath('dispatch'), {
      method: 'POST',
      body: {
        dry_run: d.dry_run !== false,
        top_k: Number(d.top_k),
        batch_size: Number(d.batch_size),
        event_id: newEventId(),
      },
    });
    state.dispatchResult = data;
    toast('推送已执行（mode：' + (data && data.mode ? data.mode : '—') + '，人工确认）');
    await refreshAfterWrite();
  } catch (e) { showError(e); }
}

async function doAccept() {
  if (!currentTask()) return;
  try {
    await api(taskPath('accept'), { method: 'POST', body: { event_id: newEventId() } });
    toast('已提交接单');
    await refreshAfterWrite();
  } catch (e) { showError(e); }
}

async function doSubmitResult() {
  if (!currentTask()) return;
  const content = String(state.detailDraft.content).trim();
  if (!content) { toast('[VALIDATION] 请填写成果内容', 'error'); return; }
  try {
    await api(taskPath('submit'), { method: 'POST', body: { content: content, event_id: newEventId() } });
    toast('成果已提交');
    await refreshAfterWrite();
  } catch (e) { showError(e); }
}

async function doVerify(decision) {
  const t = currentTask();
  if (!t) return;
  const label = decision === 'approve' ? '验收通过' : (decision === 'reject' ? '验收驳回' : '自动验收');
  const ok = await confirmGate('人工确认 · 成果验收',
    '任务 <code>' + esc(t.task_id) + '</code> 将执行「' + label + '」。', decision === 'reject');
  if (!ok) return;
  const d = state.detailDraft;
  try {
    await api(taskPath('verify'), {
      method: 'POST',
      body: {
        decision: decision,
        rating: Number(d.rating),
        reason: String(d.reason).trim(),
        event_id: newEventId(),
      },
    });
    toast('验收结果已提交（人工闸门）');
    await refreshAfterWrite();
  } catch (e) { showError(e); }
}

async function doDisputeOpen() {
  const t = currentTask();
  if (!t) return;
  const reason = String(state.detailDraft.dispute_reason).trim();
  if (!reason) { toast('[VALIDATION] 请填写争议理由', 'error'); return; }
  try {
    await api(taskPath('dispute'), {
      method: 'POST',
      body: { action: 'open', reason: reason, event_id: newEventId() },
    });
    toast('争议已开启，进入人工复核');
    await refreshAfterWrite();
  } catch (e) { showError(e); }
}

async function doDisputeResolve() {
  const t = currentTask();
  if (!t) return;
  const d = state.detailDraft;
  const ok = await confirmGate('人工确认 · 争议裁定',
    '任务 <code>' + esc(t.task_id) + '</code> 将按 <code>' + esc(d.resolution) + '</code> 裁定。该裁定仅调整平台内贡献积分记账科目。', false);
  if (!ok) return;
  try {
    await api(taskPath('dispute'), {
      method: 'POST',
      body: {
        action: 'resolve',
        resolution: d.resolution,
        reason: String(d.resolve_reason).trim(),
        event_id: newEventId(),
      },
    });
    toast('裁定已提交（人工闸门）');
    await refreshAfterWrite();
  } catch (e) { showError(e); }
}

async function doReport() {
  if (!currentTask()) return;
  const reason = String(state.detailDraft.report_reason).trim();
  if (!reason) { toast('[VALIDATION] 请填写举报理由', 'error'); return; }
  try {
    await api('/api/reports', {
      method: 'POST',
      body: { task_id: state.selectedTaskId, reason: reason, event_id: newEventId() },
    });
    toast('举报已提交，进入人工复核');
    await refreshAfterWrite();
  } catch (e) { showError(e); }
}

// 「关闭个性化推荐」开关：勾选即 enabled=false；服务端强制生效。
async function onTogglePersonalized(checked) {
  if (state.writeLocked) {
    toast('[WRITE_LOCKED] 演示模式：后端未绑定 D1 持久化，写操作不可用', 'error');
    render();
    return;
  }
  const enabled = !checked;
  try {
    await api('/api/preferences/personalized', {
      method: 'POST',
      body: { enabled: enabled, event_id: newEventId() },
    });
    state.preferences = { personalized_enabled: enabled };
    if (state.config) state.config.personalized_enabled = enabled;
    toast(enabled ? '个性化推荐已开启（服务端强制生效）' : '个性化推荐已关闭（服务端强制生效）');
    await refreshAfterWrite();
  } catch (e) { showError(e); render(); }
}

async function doExport() {
  try {
    const data = await api('/api/me/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sambon-my-data-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('已导出我的数据（JSON 文件）');
  } catch (e) { showError(e); }
}

async function doDeleteAccount() {
  const ok = await openConfirm({
    title: '删除我的账号（GDPR 擦除）',
    bodyHtml: '<p>该操作将注销当前账号并删除关联的个人数据，且不可撤销。处理后将自动退出登录。</p>' + GATE_NOTE,
    confirmLabel: '确认删除',
    danger: true,
    requireText: 'DELETE',
  });
  if (!ok) return;
  try {
    await api('/api/me', { method: 'DELETE' });
    toast('账号已注销，已自动退出登录');
    clearSession();
    state.tasks = [];
    state.taskCount = 0;
    render();
  } catch (e) { showError(e); }
}

async function onConsent(granted) {
  // 匿名阶段尝试补齐 CSRF；若仍无会话则按契约携带空头，由后端按匿名请求处理。
  if (!state.csrf) {
    try { await refreshMe(); } catch (e) { /* 匿名：保持空值 */ }
  }
  try {
    await api('/api/consents', {
      method: 'POST',
      body: { kind: 'cookie', version: 'v1', granted: granted },
    });
  } catch (e) {
    showError(e); // 不静默失败：后端异常仍以 toast 呈现
  }
  lsSet(CONSENT_KEY, granted ? 'all' : 'necessary');
  state.cookieBarForced = false;
  renderCookieBar();
  toast(granted ? '已记录：必要 + 分析 Cookie 同意' : '已记录：仅必要 Cookie');
}

/* ------------------------------------------------------------------ 动作派发 */

async function handleAction(action, el) {
  const ds = el && el.dataset ? el.dataset : {};
  // 开关由 change 事件统一处理，click 不重复派发。
  if (action === 'toggle-personalized') return;
  // 演示模式写锁：业务写操作统一拦截，不静默失败。
  if (state.writeLocked && WRITE_ACTIONS.has(action)) {
    toast('[WRITE_LOCKED] 演示模式：后端未绑定 D1 持久化，写操作不可用', 'error');
    return;
  }
  switch (action) {
    case 'auth-tab': state.authTab = ds.tab || 'login'; render(); break;
    case 'login': await doAuth('login'); break;
    case 'register': await doAuth('register'); break;
    case 'logout': await doLogout(); break;
    case 'select-task': selectTask(ds.id); break;
    case 'publish-task': await doPublish(); break;
    case 'review': await doReview(ds.decision); break;
    case 'dispatch': await doDispatch(); break;
    case 'accept': await doAccept(); break;
    case 'submit-result': await doSubmitResult(); break;
    case 'verify': await doVerify(ds.decision); break;
    case 'dispute-open': await doDisputeOpen(); break;
    case 'dispute-resolve': await doDisputeResolve(); break;
    case 'report': await doReport(); break;
    case 'export-me': await doExport(); break;
    case 'delete-me': await doDeleteAccount(); break;
    case 'cookie-accept-all': await onConsent(true); break;
    case 'cookie-necessary': await onConsent(false); break;
    case 'cookie-settings': state.cookieBarForced = true; renderCookieBar(); break;
    case 'refresh-tasks': await loadTasks(); render(); break;
    case 'refresh-events': await loadEvents(); render(); break;
    case 'refresh-ledger': await loadLedger(); render(); break;
    case 'refresh-boards': await loadBoards(); render(); break;
    case 'refresh-queue': await loadQueue(); render(); break;
    case 'modal-confirm': resolveModal(true); break;
    case 'modal-cancel': resolveModal(false); break;
    default: break;
  }
}

/* ------------------------------------------------------------------ H. 启动 */

function applyHealthGate() {
  const h = state.health;
  // fail-closed：健康检查失败或 mode 非 production 时一律上锁。
  state.writeLocked = !h || h.mode !== 'production';
}

async function bootstrap() {
  const app = document.getElementById('app');
  app.innerHTML = '<div class="card"><p class="muted">正在请求 /api/health 与系统配置…</p></div>';

  // 1) 契约要求：前端启动必须先请求 /api/health，并据 mode 决定写锁与横幅。
  try {
    state.health = await api('/api/health', { silent401: true });
  } catch (e) {
    showError(e);
    state.health = null;
  }
  applyHealthGate();
  renderBanners();

  // 2) 配置与会话并行加载；/api/auth/me 未登录返回 401，silent401 下安静降级。
  const [config, me] = await Promise.all([
    api('/api/config', { silent401: true }).catch(e => { showError(e); return null; }),
    api('/api/auth/me', { silent401: true }).catch(e => { showError(e); return null; }),
  ]);
  state.config = config || null;
  if (me) {
    state.user = me.user || null;
    state.csrf = me.csrf_token || null;
    state.preferences = me.preferences || { personalized_enabled: true };
    state.consents = Array.isArray(me.consents) ? me.consents : [];
    if (state.user) state.detailDraft.ledger_user_id = state.user.user_id;
    syncConsentFromServer();
  }
  if (state.user) await loadConsoleData();
  render();
}

/* ------------------------------------------------------------------ I. 事件委托 */

// 所有输入通过 data-model="分组.字段" 回写 state，重绘后值不丢失。
function bindModel(el) {
  if (!el || !el.dataset || !el.dataset.model) return;
  const parts = el.dataset.model.split('.');
  if (parts.length !== 2 || !state[parts[0]]) return;
  state[parts[0]][parts[1]] = el.type === 'checkbox' ? el.checked : el.value;
}

document.addEventListener('click', e => {
  const el = e.target.closest && e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  // 表单内 submit 按钮统一由本处理器派发动作，阻止原生提交跳转。
  if (el.tagName === 'BUTTON' && el.type === 'submit') e.preventDefault();
  void handleAction(el.dataset.action, el);
});

// 任何 form 都不允许原生提交（Enter / 默认行为），动作走 click 或 keydown 派发。
document.addEventListener('submit', e => e.preventDefault());

document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA') return;
  const form = e.target.closest && e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  void handleAction(form.dataset.form, { dataset: {} });
});

document.addEventListener('input', e => bindModel(e.target));

document.addEventListener('change', e => {
  bindModel(e.target);
  if (e.target.dataset && e.target.dataset.action === 'toggle-personalized') {
    void onTogglePersonalized(e.target.checked);
  }
});

// 启动
void bootstrap();
