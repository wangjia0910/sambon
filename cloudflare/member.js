/* ==========================================================================
 * 三宝殿 · sambon.net — 用户版悬赏互助平台（前端 SPA，纯原生 ES module）
 *
 * 面向真实发布方（publisher）/ 接单人（solver）的产品站，作为站点主入口 `/`。
 * 无框架、无第三方依赖、无 CDN、无内联脚本。所有请求为同源真实 fetch，/api/ 开头。
 * 统一响应信封：{ ok: true|false, data: ..., error: { code, message } | null }
 * 与操作台（app.js）共用同一后端、会话 Cookie（sambon_sid）与 CSRF 约定，
 * 但界面、路由、文案完全独立，二者互不干扰。
 *
 * 合规约束：
 *   - SBC 仅表述为「平台内贡献积分，不可兑付、不可转让」，不出现资产化措辞。
 *   - 验收 / 争议裁定 / 取消等影响结算的操作保留人工二次确认闸门。
 *   - mode=demo（未绑定 D1）时禁用业务写操作；401 统一清理会话。
 *   - 双语（zh-CN / en），海外默认英文，与后端 config.default_locale 一致。
 * ========================================================================== */

/* ------------------------------------------------ 0. 国际化 I18N / t() ---- */
const I18N = {
  'en': {
    'brand.sub': 'Bounty Hunters Guild',
    'nav.hall': 'Bounty Board', 'nav.rank': 'Hunter Ranks', 'nav.publish': 'Post Bounty',
    'nav.mine': 'My Contracts', 'nav.wallet': 'Vault', 'nav.guest': 'Visitor',
    'nav.logout': 'Leave', 'nav.signin': 'Enter the Guild',
    'banner.demo': 'Demo realm: persistence is not bound; write operations are unavailable.',
    'banner.demoLink': 'Open L0 demo',
    'footer.legal': 'Privacy · Terms · AUP · AI Transparency · Minors · Report',
    'footer.console': 'Operations console', 'footer.demo': 'L0 demo',
    'footer.sbc': 'SBC is an in-platform contribution credit — not redeemable, not transferable.',
    'meta.idle': 'Scanning the realm…',
    'meta.ready': 'Realm {status} · vault {db} · v{version} · writes {lock}',
    'common.loading': 'Opening the guild hall…', 'common.retry': 'Retry',
    'common.cancel': 'Cancel', 'common.confirm': 'Confirm', 'common.refresh': 'Refresh',
    'common.humanConfirm': 'Human confirmation', 'common.empty': 'No entries found',
    'common.humanGate': 'Human gate: verification, dispute rulings and cancellations are confirmed by a person and enforced by the server (enforcement: server_side). The interface alone is not an authorization.',
    'hero.title': 'Every bounty has a hunter.',
    'hero.lead': 'Post a contract and it is matched to the hunters most likely to complete it on time. Earn SBC — an in-platform contribution credit for your standing in the guild. Rules-first matchmaking, human-reviewed outcomes.',
    'hero.cta': 'Enter the Board', 'hero.cta2': 'Post a Bounty',
    'hero.s1': 'Tracked Bounties', 'hero.s1d': 'Rules-first matching with clear reasons',
    'hero.s2': 'SBC Standing', 'hero.s2d': 'Contribution credit, never redeemable',
    'hero.s3': 'Human Judged', 'hero.s3d': 'Settlements & disputes confirmed by people',
    'hall.title': 'Bounty Board', 'hall.sub': 'Browse open contracts and hunter standings.',
    'hall.search': 'Search contracts by title or category…', 'hall.all': 'All states',
    'rarity.common': 'Common', 'rarity.uncommon': 'Uncommon', 'rarity.rare': 'Rare',
    'rarity.epic': 'Epic', 'rarity.legendary': 'Legendary',
    'rank.title': 'Hunter Ranks', 'rank.task': 'Bounty Rankings', 'rank.user': 'Hunter Leaderboard',
    'rank.note': 'Contracts are ranked within category by versioned weights. Disputed bounties are discounted; neutral order (time + distance) applies when personalization is off.',
    'rank.hunter': 'Hunter', 'rank.netSbc': 'Net SBC', 'rank.completed': 'Completed', 'rank.rating': 'Rating', 'rank.onTime': 'On-time',
    'publish.title': 'Post a Bounty', 'publish.sub': 'Describe the contract and its acceptance criteria. It enters human review after submission.',
    'publish.f.title': 'Title', 'publish.f.desc': 'Description', 'publish.f.category': 'Category',
    'publish.f.bounty': 'Bounty (SBC)', 'publish.f.criteria': 'Acceptance criteria',
    'publish.f.deadline': 'Deadline (hours)', 'publish.f.online': 'Online contract',
    'publish.f.radius': 'Radius (km)', 'publish.f.skills': 'Required skills (comma separated)',
    'publish.f.difficulty': 'Difficulty (0–1)', 'publish.submit': 'Post Bounty',
    'publish.ok': 'Bounty posted. Awaiting human review.',
    'publish.hint': 'The bounty and a 5% service fee are frozen only after a human approves the contract.',
    'mine.title': 'My Contracts', 'mine.posted': 'Bounties I Posted', 'mine.accepted': 'Contracts I Accepted',
    'wallet.title': 'Hunter Vault', 'wallet.sub': 'SBC is an in-platform contribution credit — not redeemable, not transferable, no yield.',
    'wallet.balance': 'Available SBC', 'wallet.ledger': 'Ledger Entries',
    'wallet.anchor': 'Vault Anchoring', 'wallet.balanced': 'Balanced', 'wallet.unbalanced': 'Check failed',
    'prefs.title': 'Guild Preferences', 'prefs.personalized': 'Personalized recommendations',
    'prefs.personalizedHint': 'When off, the server enforces neutral ordering by time + distance (enforcement: server_side).',
    'prefs.on': 'On', 'prefs.off': 'Off', 'prefs.saved': 'Preference saved.',
    'auth.title': 'Enter the Guild', 'auth.sub': 'Choose a role. Registration opens publisher and hunter accounts.',
    'auth.login': 'Sign in', 'auth.register': 'Register',
    'auth.email': 'Email', 'auth.password': 'Password', 'auth.name': 'Display name',
    'auth.role': 'Role', 'auth.publisher': 'Patron (poster)', 'auth.solver': 'Hunter',
    'auth.hint': 'Password: 10–128 characters. Sessions use an httpOnly cookie; a CSRF token is issued on sign in.',
    'auth.verify': 'Please verify your email before posting or accepting contracts.',
    'auth.resend': 'Resend verification',
    'task.detail': 'Contract Detail', 'task.back': 'Back to Board',
    'task.accept': 'Accept Contract', 'task.submit': 'Submit Spoils', 'task.verify': 'Confirm & Settle',
    'task.reject': 'Reject (back to work)', 'task.dispute': 'Open Dispute',
    'task.cancel': 'Cancel Contract', 'task.feedback': 'Log Exposure',
    'task.report': 'Report', 'task.events': 'Event Trail',
    'task.bounty': 'Bounty', 'task.fee': 'Service Fee', 'task.state': 'State',
    'task.category': 'Category', 'task.deadline': 'Deadline', 'task.criteria': 'Acceptance criteria',
    'task.desc': 'Description', 'task.skills': 'Required skills',
    'task.result': 'Submitted result (redacted)', 'task.note': 'Note',
    'task.ok.accepted': 'Contract accepted. Bounty moved to escrow.',
    'task.ok.submitted': 'Spoils submitted.',
    'task.ok.verified': 'Confirmed and settled.',
    'task.ok.cancelled': 'Contract cancelled.',
    'task.ok.disputed': 'Dispute opened. Full bounty held in escrow.',
    'modal.confirmAction': 'Confirm this action',
    'modal.typeWord': 'Type {word} to confirm',
    'err.requestFailed': 'Request failed',
    'err.timeout': 'Request timed out. Please retry.',
    'err.network': 'Network error: {msg}',
  },
  'zh-CN': {
    'brand.sub': '赏金猎人公会',
    'nav.hall': '悬赏大厅', 'nav.rank': '猎人榜', 'nav.publish': '发布悬赏',
    'nav.mine': '我的委托', 'nav.wallet': '猎人金库', 'nav.guest': '访客',
    'nav.logout': '离开公会', 'nav.signin': '进入公会',
    'banner.demo': '演示服务器：持久化未绑定，写操作不可用。',
    'banner.demoLink': '打开 L0 演示台',
    'footer.legal': '隐私政策 · 服务条款 · 可接受使用政策 · AI 透明度 · 未成年人限制 · 举报',
    'footer.console': '运营操作台', 'footer.demo': 'L0 演示',
    'footer.sbc': 'SBC 为平台内贡献积分，不可兑付、不可转让、无收益承诺。',
    'meta.idle': '正在扫描服务器状态…',
    'meta.ready': '服务器 {status} · 金库 {db} · v{version} · 写操作{lock}',
    'common.loading': '正在开启公会大厅…', 'common.retry': '重试',
    'common.cancel': '取消', 'common.confirm': '确认', 'common.refresh': '刷新',
    'common.humanConfirm': '人工确认', 'common.empty': '暂无记录',
    'common.humanGate': '人工闸门：验收、争议裁定与取消由人工确认、服务端强制校验（enforcement: server_side）；界面展示不构成授权。',
    'hero.title': '每一份悬赏，都有它的猎人。',
    'hero.lead': '发布委托，由规则匹配推送给最可能按时完成的猎人，用 SBC 记录你在公会中的贡献声望。规则优先排序，结算由人工把关。',
    'hero.cta': '进入悬赏大厅', 'hero.cta2': '发布悬赏令',
    'hero.s1': '在册悬赏', 'hero.s1d': '规则优先匹配，附可解释理由',
    'hero.s2': 'SBC 声望', 'hero.s2d': '贡献积分，永不可兑付',
    'hero.s3': '人工裁决', 'hero.s3d': '结算与争议由人工确认',
    'hall.title': '悬赏大厅', 'hall.sub': '浏览开放委托与猎人榜单。',
    'hall.search': '按标题或分类搜索悬赏…', 'hall.all': '全部状态',
    'rarity.common': '普通', 'rarity.uncommon': '精良', 'rarity.rare': '稀有',
    'rarity.epic': '史诗', 'rarity.legendary': '传说',
    'rank.title': '猎人榜', 'rank.task': '悬赏排行', 'rank.user': '赏金猎人榜',
    'rank.note': '同类目内按版本化权重排序；争议悬赏降权；关闭个性化后按时间 + 距离中性排序。',
    'rank.hunter': '猎人', 'rank.netSbc': '净 SBC', 'rank.completed': '完成数', 'rank.rating': '评分', 'rank.onTime': '准时率',
    'publish.title': '发布悬赏令', 'publish.sub': '填写委托与验收标准，提交后进入人工审核。',
    'publish.f.title': '标题', 'publish.f.desc': '描述', 'publish.f.category': '分类',
    'publish.f.bounty': '赏金（SBC）', 'publish.f.criteria': '验收标准',
    'publish.f.deadline': '截止时间（小时）', 'publish.f.online': '线上委托',
    'publish.f.radius': '半径（公里）', 'publish.f.skills': '所需技能（逗号分隔）',
    'publish.f.difficulty': '难度（0–1）', 'publish.submit': '发布悬赏令',
    'publish.ok': '悬赏已发布，等待人工审核。',
    'publish.hint': '赏金与 5% 服务费仅在人工审核通过后冻结。',
    'mine.title': '我的委托', 'mine.posted': '我发布的悬赏', 'mine.accepted': '我接取的委托',
    'wallet.title': '猎人金库', 'wallet.sub': 'SBC 为平台内贡献积分，不可兑付、不可转让、无收益承诺。',
    'wallet.balance': '可用 SBC', 'wallet.ledger': '流水明细',
    'wallet.anchor': '金库锚定', 'wallet.balanced': '账本守恒', 'wallet.unbalanced': '校验异常',
    'prefs.title': '公会偏好', 'prefs.personalized': '个性化推荐',
    'prefs.personalizedHint': '关闭后服务端强制按时间 + 距离中性排序（enforcement: server_side）。',
    'prefs.on': '开启', 'prefs.off': '关闭', 'prefs.saved': '偏好已保存。',
    'auth.title': '进入公会', 'auth.sub': '选择身份。注册开放委托方与猎人。',
    'auth.login': '登录', 'auth.register': '注册',
    'auth.email': '邮箱', 'auth.password': '密码', 'auth.name': '显示名',
    'auth.role': '身份', 'auth.publisher': '委托方', 'auth.solver': '赏金猎人',
    'auth.hint': '密码 10–128 位。会话使用 httpOnly Cookie，登录时下发 CSRF 令牌。',
    'auth.verify': '发布或接单前请先完成邮箱验证。',
    'auth.resend': '重发验证邮件',
    'task.detail': '委托详情', 'task.back': '返回大厅',
    'task.accept': '接取委托', 'task.submit': '交付战利品', 'task.verify': '确认并结算',
    'task.reject': '驳回（退回履约）', 'task.dispute': '发起争议',
    'task.cancel': '取消委托', 'task.feedback': '记录曝光',
    'task.report': '举报', 'task.events': '事件回放',
    'task.bounty': '赏金', 'task.fee': '服务费', 'task.state': '状态',
    'task.category': '分类', 'task.deadline': '截止时间', 'task.criteria': '验收标准',
    'task.desc': '描述', 'task.skills': '所需技能',
    'task.result': '已交付战利品（已脱敏）', 'task.note': '备注',
    'task.ok.accepted': '接单成功，赏金已转入托管。',
    'task.ok.submitted': '战利品已交付。',
    'task.ok.verified': '已验收并结算。',
    'task.ok.cancelled': '委托已取消。',
    'task.ok.disputed': '争议已发起，赏金全额托管。',
    'modal.confirmAction': '确认此操作',
    'modal.typeWord': '输入 {word} 以确认',
    'err.requestFailed': '请求失败',
    'err.timeout': '请求超时，请重试。',
    'err.network': '网络错误：{msg}',
  },
};

let LOCALE = 'en';

function initLocale() {
  const saved = (() => { try { return localStorage.getItem('sambon.locale'); } catch { return null; } })();
  LOCALE = I18N[saved] ? saved : ((navigator.language || '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en');
  document.documentElement.lang = LOCALE === 'zh-CN' ? 'zh-CN' : 'en';
}
function t(key, vars) {
  let s = (I18N[LOCALE] && I18N[LOCALE][key]) || (I18N.en[key]) || key;
  if (vars) for (const k of Object.keys(vars)) s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), String(vars[k]));
  return s;
}
function applyStaticI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.getAttribute('data-i18n')); });
}

/* ------------------------------------------------ 1. state / 工具 -------- */
const state = {
  user: null, csrf: null, mode: 'demo', config: null,
  tasks: [], events: [],
  boardTasks: [], boardUsers: [], rankTab: 'task',
  hallQuery: '', hallState: '',
  mineTab: 'posted',
  personalized: true,
  hunterCredit: 0,
  ledger: null,
  route: { name: 'hall', id: null },
  authTab: 'login',
  modal: null,
};

function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function eid(prefix) {
  return (prefix || 'EVT') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}
function toast(message, type) {
  const root = document.getElementById('wow-toast');
  const el = document.createElement('div');
  el.className = 'wow-toast ' + (type || '');
  el.textContent = message;
  root.appendChild(el);
  window.setTimeout(() => el.remove(), 4200);
}
function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleString(LOCALE === 'zh-CN' ? 'zh-CN' : 'en-US', { hour12: false });
}
function stateBadge(s) {
  const map = {
    PUBLISHED: 'ok', DISPATCHING: 'primary', ACCEPTED: 'primary', IN_PROGRESS: 'primary',
    SUBMITTED: 'warn', DISPUTED: 'danger', SETTLED: 'ok',
    PENDING_REVIEW: 'warn', REJECTED: 'danger', CANCELLED: '', EXPIRED: '', CLOSED: '', DRAFT: '',
  };
  return `<span class="wow-badge ${map[s] || ''}">${esc(s)}</span>`;
}

/* ---------- 游戏化：稀有度 / 猎人等级 / 声望条 / 金币 ---------- */
function rarityOf(bounty) {
  const b = Number(bounty) || 0;
  if (b >= 1000) return { key: 'legendary', label: t('rarity.legendary') };
  if (b >= 300) return { key: 'epic', label: t('rarity.epic') };
  if (b >= 80) return { key: 'rare', label: t('rarity.rare') };
  if (b >= 20) return { key: 'uncommon', label: t('rarity.uncommon') };
  return { key: 'common', label: t('rarity.common') };
}
function coin(amount) {
  return `<span class="wow-gold"><i class="wow-coin"></i>${esc(amount)}</span>`;
}
function hunterTitleOf(count) {
  const c = Number(count) || 0;
  const zh = ['见习猎人','青铜猎人','白银猎人','黄金猎人','铂金猎人','钻石猎人','大师猎人','传奇猎人'];
  const en = ['Novice','Bronze Hunter','Silver Hunter','Gold Hunter','Platinum Hunter','Diamond Hunter','Master Hunter','Legendary Hunter'];
  const arr = LOCALE === 'zh-CN' ? zh : en;
  const band = Math.min(arr.length - 1, Math.floor(c / 5));
  return arr[band];
}
// 猎人等级由 credit_score + 已完成任务声望共同决定（声望取用户榜 net_sbc，登录时异步补充）
function hunterLevel(user) {
  const score = Number((user && user.credit_score) ?? 100);
  const credit = Math.max(0, Number(state.hunterCredit || 0));
  const xp = score + credit;
  const level = Math.min(60, Math.max(1, Math.floor(xp / 500) + 1));
  const into = xp % 500;
  const titles = LOCALE === 'zh-CN'
    ? ['见习猎人', '青铜猎人', '白银猎人', '黄金猎人', '铂金猎人', '钻石猎人', '大师猎人', '传奇猎人']
    : ['Novice', 'Bronze Hunter', 'Silver Hunter', 'Gold Hunter', 'Platinum Hunter', 'Diamond Hunter', 'Master Hunter', 'Legendary Hunter'];
  const band = Math.min(titles.length - 1, Math.floor((level - 1) / 8));
  return { level, pct: Math.round((into / 500) * 100), title: titles[band], xp };
}
function renderHeroCard() {
  const card = document.getElementById('wow-hero-card');
  if (!card || !state.user) { if (card) card.hidden = true; return; }
  const lv = hunterLevel(state.user);
  card.hidden = false;
  document.getElementById('wow-portrait').textContent = (state.user.display_name || '?').trim().charAt(0).toUpperCase();
  document.getElementById('m-user').textContent = state.user.display_name || state.user.email || '—';
  document.getElementById('wow-level').textContent = 'Lv.' + lv.level;
  document.getElementById('wow-title').textContent = lv.title;
  document.getElementById('wow-xp-fill').style.width = lv.pct + '%';
}
function canWrite() { return state.mode === 'production'; }
function isRole(r) { return !!(state.user && state.user.role === r); }
function requireWrite() {
  if (!canWrite()) { toast(t('banner.demo'), 'error'); return false; }
  if (!state.user) { go('#/auth'); toast(t('nav.signin'), 'error'); return false; }
  return true;
}

class ApiError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

/* ------------------------------------------------ 2. api() -------------- */
async function api(path, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  const headers = Object.assign({}, opts.headers || {});
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (isWrite) headers['X-CSRF-Token'] = state.csrf || '';

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer = null;
  if (controller) timer = window.setTimeout(() => controller.abort(), opts.timeout || 15000);

  let res;
  try {
    res = await fetch(path, {
      method, headers, credentials: 'same-origin',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller ? controller.signal : undefined,
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw new ApiError('REQUEST_TIMEOUT', t('err.timeout'), 0);
    throw new ApiError('NETWORK_ERROR', t('err.network', { msg: (e && e.message) || e }), 0);
  } finally { if (timer) window.clearTimeout(timer); }

  let payload;
  try { payload = await res.json(); }
  catch { throw new ApiError('BAD_RESPONSE', 'Invalid JSON (HTTP ' + res.status + ')', res.status); }

  if (res.status === 401) {
    const err = (payload && payload.error) || { code: 'UNAUTHORIZED', message: 'Unauthorized' };
    if (opts.authAttempt) throw new ApiError(err.code, err.message, 401);
    clearSession(); go('#/auth');
    throw new ApiError(err.code, err.message, 401);
  }
  if (!res.ok || !payload || payload.ok !== true || payload.error) {
    const err = (payload && payload.error) || { code: 'HTTP_' + res.status, message: t('err.requestFailed') + ' (HTTP ' + res.status + ')' };
    throw new ApiError(err.code, err.message, res.status);
  }
  return payload.data;
}
function showError(e) { toast('[' + (e.code || 'ERROR') + '] ' + (e.message || t('err.requestFailed')), 'error'); }
function clearSession() {
  state.user = null; state.csrf = null; state.ledger = null;
}

/* ------------------------------------------------ 3. 路由 ---------------- */
function parseHash() {
  const raw = (location.hash || '#/hall').replace(/^#\/?/, '');
  const [name, id] = raw.split('/');
  return { name: name || 'hall', id: id ? decodeURIComponent(id) : null };
}
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }

/* ------------------------------------------------ 4. 渲染入口 ------------ */
async function render() {
  state.route = parseHash();
  const n = state.route.name;
  applyStaticI18n();
  highlightNav(n);
  document.getElementById('m-signin').hidden = !!state.user;
  document.getElementById('m-logout').hidden = !state.user;
  renderHeroCard();
  const app = document.getElementById('m-app');

  if (n === 'auth') return renderAuth(app);
  if (!state.user) {
    // 未登录：仅大厅 / 榜单可见（只读浏览提示），业务视图引导登录
    if (n === 'hall') return renderHall(app);
    if (n === 'rank') return renderRank(app);
    app.innerHTML = `<div class="wow-panel"><h2>${t('nav.signin')}</h2><p class="muted">${t('auth.sub')}</p><button class="wow-btn wow-btn-gold" data-action="go-auth">${t('nav.signin')}</button></div>`;
    return;
  }
  switch (n) {
    case 'hall': return renderHall(app);
    case 'rank': return renderRank(app);
    case 'publish': return renderPublish(app);
    case 'mine': return renderMine(app);
    case 'wallet': return renderWallet(app);
    case 'task': return renderTask(app, state.route.id);
    default: return renderHall(app);
  }
}
function highlightNav(n) {
  document.querySelectorAll('[data-nav]').forEach((el) => el.classList.toggle('active', el.getAttribute('data-nav') === n));
}

/* ---------- 视图：任务大厅 ---------- */
async function renderHall(app) {
  const hero = state.user ? '' : `
    <section class="wow-hero">
      <h1>${t('hero.title')}</h1>
      <p class="wow-lead">${t('hero.lead')}</p>
      <div class="wow-hero-actions">
        <a href="#/hall" class="wow-btn wow-btn-gold">${t('hero.cta')}</a>
        <a href="#/auth" class="wow-btn wow-btn-ghost">${t('hero.cta2')}</a>
      </div>
      <div class="wow-hero-stats">
        <div class="wow-stat"><b>⚔</b><span>${t('hero.s1')}</span></div>
        <div class="wow-stat"><b>◆</b><span>${t('hero.s2')}</span></div>
        <div class="wow-stat"><b>✓</b><span>${t('hero.s3')}</span></div>
      </div>
    </section>`;

  let list = '';
  if (state.user) {
    try {
      const d = await api('/api/tasks');
      state.tasks = Array.isArray(d.tasks) ? d.tasks : [];
    } catch (e) { showError(e); }
    list = taskGrid(filteredTasks(), true);
  } else {
    list = `<div class="wow-notice info">${t('hall.sub')} <a href="#/auth">${t('nav.signin')}</a></div>`;
  }

  app.innerHTML = `${hero}
    <div class="wow-section-head"><h2>${t('hall.title')}</h2><span class="muted">${t('hall.sub')}</span></div>
    ${state.user ? `
    <div class="wow-filters">
      <input class="wow-input" id="hall-q" placeholder="${t('hall.search')}" value="${esc(state.hallQuery)}">
      <select class="wow-select" id="hall-state" style="width:auto">
        <option value="">${t('hall.all')}</option>
        ${['PENDING_REVIEW','PUBLISHED','DISPATCHING','ACCEPTED','IN_PROGRESS','SUBMITTED','DISPUTED'].map((s) => `<option value="${s}" ${state.hallState === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
      <button class="wow-btn wow-btn-ghost wow-btn-sm" data-action="refresh-tasks">${t('common.refresh')}</button>
    </div>` : ''}
    <div id="hall-grid">${list}</div>`;

  const q = document.getElementById('hall-q');
  if (q) q.addEventListener('input', (e) => { state.hallQuery = e.target.value; const g = document.getElementById('hall-grid'); if (g) g.innerHTML = taskGrid(filteredTasks(), true); });
  const st = document.getElementById('hall-state');
  if (st) st.addEventListener('change', (e) => { state.hallState = e.target.value; const g = document.getElementById('hall-grid'); if (g) g.innerHTML = taskGrid(filteredTasks(), true); });
}
function filteredTasks() {
  const q = state.hallQuery.trim().toLowerCase();
  return state.tasks.filter((x) => {
    if (state.hallState && x.state !== state.hallState) return false;
    if (q && !((x.title || '').toLowerCase().includes(q) || (x.category || '').toLowerCase().includes(q))) return false;
    return true;
  });
}
function taskGrid(tasks, clickable) {
  if (!tasks.length) return `<div class="wow-empty"><b>${t('common.empty')}</b></div>`;
  return `<div class="wow-grid">${tasks.map((x) => {
    const r = rarityOf(x.bounty);
    const tstate = x.state === 'DISPUTED' ? 'danger' : '';
    return `
    <article class="wow-contract r-${r.key} ${clickable ? 'clickable' : ''}" ${clickable ? `data-action="open-task" data-id="${esc(x.task_id)}"` : ''}>
      <div class="wow-contract-head">
        <div>
          <div class="wow-rarity">${esc(r.label)}</div>
          <h3 class="wow-contract-title">${esc(x.title)}</h3>
        </div>
        ${stateBadge(x.state)}
      </div>
      <p class="small muted" style="margin:8px 0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(x.description || '')}</p>
      <div class="wow-contract-meta">
        <span class="wow-tag">${esc(x.category || '—')}</span>
        ${(x.required_skills || []).slice(0, 3).map((sk) => `<span class="wow-tag">${esc(sk)}</span>`).join('')}
      </div>
      <div class="wow-contract-foot">
        ${coin(x.bounty)}
        <span class="tiny muted mono">${esc(x.task_id)}</span>
      </div>
    </article>`;
  }).join('')}</div>`;
}

/* ---------- 视图：排行榜 ---------- */
async function renderRank(app) {
  let tk = null, us = null;
  try {
    [tk, us] = await Promise.all([
      api('/api/leaderboard/tasks').catch((e) => { showError(e); return null; }),
      api('/api/leaderboard/users').catch((e) => { showError(e); return null; }),
    ]);
  } catch (e) { showError(e); }
  state.boardTasks = tk && Array.isArray(tk.items) ? tk.items : [];
  state.boardUsers = us && Array.isArray(us.items) ? us.items : [];

  let body = '';
  if (state.rankTab === 'task') {
    body = `<div class="wow-table-wrap"><table class="wow-table"><thead><tr>
      <th>#</th><th>${t('publish.f.title')}</th><th>${t('task.state')}</th><th>${t('task.bounty')}</th><th>Rank score</th></tr></thead><tbody>
      ${state.boardTasks.map((x) => {
        const r = rarityOf(x.bounty);
        return `<tr>
          <td>${rankMedal(x.rank)}</td>
          <td><span class="wow-rarity" style="color:var(--${r.key === 'common' ? 'common' : r.key})">◆ ${esc(r.label)}</span><br>${esc(x.title)}</td>
          <td>${stateBadge(x.state)}</td>
          <td class="num">${coin(x.bounty)}</td>
          <td class="num">${x.rank_score === null ? '—' : esc(x.rank_score)}</td>
        </tr>`;
      }).join('') || `<tr><td colspan="5">${t('common.empty')}</td></tr>`}
      </tbody></table></div>
      <p class="tiny muted" style="margin-top:10px">${tk ? esc(tk.rank_weight_version) + ' · ' + esc(tk.mode) : ''}</p>`;
  } else {
    body = `<div class="wow-table-wrap"><table class="wow-table"><thead><tr>
      <th>#</th><th>${t('rank.hunter')}</th><th>${t('rank.netSbc')}</th><th>${t('rank.completed')}</th><th>${t('rank.rating')}</th><th>${t('rank.onTime')}</th></tr></thead><tbody>
      ${state.boardUsers.map((x) => `<tr>
        <td>${rankMedal(x.rank)}</td>
        <td><b class="gold">${esc(x.name)}</b><br><span class="wow-rank-title">✦ ${esc(hunterTitleOf(x.completed_count))}</span></td>
        <td class="num pos">${coin(x.net_sbc)}</td>
        <td class="num">${esc(x.completed_count)}</td>
        <td class="num">${esc(x.weighted_rating)}</td>
        <td class="num">${esc(x.on_time_rate)}</td>
      </tr>`).join('') || `<tr><td colspan="6">${t('common.empty')}</td></tr>`}
      </tbody></table></div>
      <p class="tiny muted" style="margin-top:10px">${us ? esc(us.rank_weight_version || '') : ''} ${us && us.note ? '· ' + esc(us.note) : ''}</p>`;
  }
  app.innerHTML = `
    <div class="wow-section-head"><h2>⚔ ${t('rank.title')}</h2><span class="wow-muted">${t('rank.sub') || ''}</span></div>
    <div class="wow-notice info">${t('rank.note')}</div>
    <div class="wow-panel">
      <div class="wow-tabs">
        <button class="${state.rankTab === 'task' ? 'active' : ''}" data-action="rank-tab" data-tab="task">${t('rank.task')}</button>
        <button class="${state.rankTab === 'user' ? 'active' : ''}" data-action="rank-tab" data-tab="user">${t('rank.user')}</button>
      </div>
      ${body}
    </div>`;
}
function rankMedal(n) {
  return `<span class="wow-rank-no${[1,2,3].includes(n) ? ' r' + n : ''}">${n}</span>`;
}


/* ---------- 视图：发布悬赏 ---------- */
function renderPublish(app) {
  app.innerHTML = `
    <div class="wow-section-head"><h2>${t('publish.title')}</h2><span class="muted">${t('publish.sub')}</span></div>
    <div class="wow-panel" style="max-width:720px">
      <div class="wow-notice warn">${t('publish.hint')} ${t('common.humanGate')}</div>
      <form class="wow-form" id="publish-form">
        <div class="wow-field"><label>${t('publish.f.title')} *</label><input class="wow-input" name="title" required maxlength="200"></div>
        <div class="wow-field"><label>${t('publish.f.desc')} *</label><textarea class="wow-textarea" name="description" required></textarea></div>
        <div class="wow-form-row">
          <div class="wow-field"><label>${t('publish.f.category')} *</label><input class="wow-input" name="category" required placeholder="e.g. delivery / design / translation"></div>
          <div class="wow-field"><label>${t('publish.f.bounty')} *</label><input class="wow-input" name="bounty" type="number" min="1" max="1000000" step="1" required></div>
        </div>
        <div class="wow-field"><label>${t('publish.f.criteria')} *</label><textarea class="wow-textarea" name="acceptance_criteria" required></textarea></div>
        <div class="wow-form-row">
          <div class="wow-field"><label>${t('publish.f.deadline')}</label><input class="wow-input" name="deadline_hours" type="number" min="1" max="720" value="48"></div>
          <div class="wow-field"><label>${t('publish.f.radius')}</label><input class="wow-input" name="radius_km" type="number" min="0" value="10"></div>
        </div>
        <div class="wow-field"><label>${t('publish.f.skills')}</label><input class="wow-input" name="required_skills" placeholder="e.g. translation, proofreading"></div>
        <div class="wow-field">
          <label>${t('publish.f.difficulty')}</label>
          <input class="wow-input" name="difficulty" type="number" min="0" max="1" step="0.1" value="0.3">
        </div>
        <div class="wow-field"><label class="wow-check"><input type="checkbox" name="online" checked> ${t('publish.f.online')}</label></div>
        <div class="wow-btn-row"><button class="wow-btn wow-btn-gold" type="submit">${t('publish.submit')}</button></div>
      </form>
    </div>`;
  document.getElementById('publish-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!requireWrite()) return;
    const f = new FormData(e.target);
    const body = {
      title: String(f.get('title') || '').trim(),
      description: String(f.get('description') || '').trim(),
      category: String(f.get('category') || '').trim(),
      acceptance_criteria: String(f.get('acceptance_criteria') || '').trim(),
      bounty: Number(f.get('bounty')),
      deadline_hours: Number(f.get('deadline_hours') || 48),
      radius_km: Number(f.get('radius_km') || 10),
      difficulty: Number(f.get('difficulty') || 0.3),
      online: f.get('online') === 'on',
      required_skills: String(f.get('required_skills') || '').split(',').map((s) => s.trim()).filter(Boolean),
      event_id: eid('EVT'),
    };
    try {
      await api('/api/tasks', { method: 'POST', body });
      toast(t('publish.ok'), 'ok');
      e.target.reset();
      state.mineTab = 'posted';
      go('#/mine');
    } catch (err) { showError(err); }
  });
}

/* ---------- 视图：我的任务 ---------- */
async function renderMine(app) {
  try {
    const d = await api('/api/tasks?include_terminal=true');
    state.tasks = Array.isArray(d.tasks) ? d.tasks : [];
  } catch (e) { showError(e); }
  const uid = state.user && state.user.user_id;
  const posted = state.tasks.filter((x) => x.publisher_id === uid);
  const accepted = state.tasks.filter((x) => x.solver_id === uid);
  const list = state.mineTab === 'posted' ? posted : accepted;
  app.innerHTML = `
    <div class="wow-section-head"><h2>${t('mine.title')}</h2><button class="wow-btn wow-btn-ghost wow-btn-sm" data-action="refresh-tasks">${t('common.refresh')}</button></div>
    <div class="wow-panel">
      <div class="wow-tabs">
        <button class="${state.mineTab === 'posted' ? 'active' : ''}" data-action="mine-tab" data-tab="posted">${t('mine.posted')} (${posted.length})</button>
        <button class="${state.mineTab === 'accepted' ? 'active' : ''}" data-action="mine-tab" data-tab="accepted">${t('mine.accepted')} (${accepted.length})</button>
      </div>
      ${taskGrid(list, true)}
    </div>`;
}

/* ---------- 视图：SBC 钱包 ---------- */
async function renderWallet(app) {
  const uid = state.user && state.user.user_id;
  let head = `<div class="wow-panel"><p class="muted">${t('common.loading')}</p></div>`;
  if (uid) {
    try { state.ledger = await api('/api/ledger/' + encodeURIComponent(uid)); }
    catch (e) { showError(e); }
  }
  const l = state.ledger;
  if (l) {
    const bal = (l.balance_check && typeof l.balance_check.net === 'number') ? l.balance_check.net : null;
    head = `
      <div class="wow-panel">
        <h2>${t('wallet.balance')}</h2>
        <div style="font-size:34px">${bal === null ? '—' : coin(bal)}</div>
        <p class="small muted">${t('wallet.sub')}</p>
        <div class="wow-notice ${l.balance_check && l.balance_check.balanced ? 'ok' : 'warn'}" style="margin-top:12px">
          ${t('wallet.anchor')}: ${l.balance_check && l.balance_check.balanced ? t('wallet.balanced') : t('wallet.unbalanced')}
          ${l.anchor && l.anchor.merkle_root ? ' · Merkle ' + esc(String(l.anchor.merkle_root).slice(0, 16)) + '…' : ''}
          · PII on chain: ${l.anchor ? (l.anchor.pii_on_chain ? 'YES' : 'NO') : '—'}
        </div>
      </div>
      <div class="wow-panel">
        <h3>${t('wallet.ledger')}</h3>
        <div class="wow-table-wrap"><table class="wow-table"><thead><tr>
          <th>#</th><th>${t('task.category')}</th><th>Delta</th><th>Balance</th><th>task_id</th><th>Rule</th><th>${fmtDate('') && ''}</th>
        </tr></thead><tbody>
        ${(l.entries || []).map((x) => `<tr>
          <td class="num">${esc(x.seq)}</td><td>${esc(x.account)}</td>
          <td class="num ${Number(x.delta) >= 0 ? 'pos' : 'neg'}">${Number(x.delta) >= 0 ? '+' : ''}${esc(x.delta)}</td>
          <td class="num">${esc(x.balance_after !== undefined ? x.balance_after : '—')}</td>
          <td class="tiny">${esc(x.task_id || '—')}</td><td class="tiny">${esc(x.rule_version || '—')}</td>
          <td class="tiny muted">${fmtDate(x.created_at)}</td>
        </tr>`).join('') || `<tr><td colspan="7">${t('common.empty')}</td></tr>`}
        </tbody></table></div>
      </div>`;
  }
  const prefs = `<div class="wow-panel">
    <h3>${t('prefs.title')}</h3>
    <p class="small muted">${t('prefs.personalizedHint')}</p>
    <div class="wow-btn-row">
      <button class="wow-btn ${state.personalized ? 'wow-btn-gold' : 'wow-btn-ghost'}" data-action="set-personalized" data-enabled="1">${t('prefs.on')}</button>
      <button class="wow-btn ${state.personalized ? 'wow-btn-ghost' : 'wow-btn-gold'}" data-action="set-personalized" data-enabled="0">${t('prefs.off')}</button>
    </div>
  </div>`;
  app.innerHTML = `<div class="wow-section-head"><h2>${t('wallet.title')}</h2></div>${head}${prefs}`;
}

/* ---------- 视图：任务详情 ---------- */
async function renderTask(app, id) {
  if (!id) { go('#/hall'); return; }
  let task = state.tasks.find((x) => x.task_id === id);
  try {
    const d = await api('/api/tasks?include_terminal=true');
    state.tasks = Array.isArray(d.tasks) ? d.tasks : [];
    task = state.tasks.find((x) => x.task_id === id) || task;
  } catch (e) { showError(e); }
  if (!task) { app.innerHTML = `<div class="wow-empty"><b>${t('common.empty')}</b><a href="#/hall">${t('task.back')}</a></div>`; return; }

  try { const ev = await api('/api/events?task_id=' + encodeURIComponent(id)); state.events = ev.events || []; }
  catch { state.events = []; }

  const uid = state.user && state.user.user_id;
  const isPub = task.publisher_id === uid || isRole('admin');
  const isSol = task.solver_id === uid || isRole('solver');
  const unverified = state.user && state.user.email_verified === false;

  const actions = [];
  const w = requireWrite;
  if (['DISPATCHING'].includes(task.state) && isSol) actions.push(`<button class="wow-btn wow-btn-accent" data-action="accept" data-id="${esc(id)}">${t('task.accept')}</button>`);
  if (['ACCEPTED', 'IN_PROGRESS', 'SUBMITTED'].includes(task.state) && task.solver_id === uid) actions.push(`<button class="wow-btn wow-btn-gold" data-action="submit-form" data-id="${esc(id)}">${t('task.submit')}</button>`);
  if (task.state === 'SUBMITTED' && isPub) {
    actions.push(`<button class="wow-btn wow-btn-accent" data-action="verify" data-id="${esc(id)}" data-decision="approve">${t('task.verify')}</button>`);
    actions.push(`<button class="wow-btn wow-btn-ghost" data-action="verify" data-id="${esc(id)}" data-decision="reject">${t('task.reject')}</button>`);
  }
  if (['IN_PROGRESS', 'SUBMITTED'].includes(task.state) && (isPub || isSol)) actions.push(`<button class="wow-btn wow-btn-danger" data-action="dispute" data-id="${esc(id)}">${t('task.dispute')}</button>`);
  if (['PENDING_REVIEW', 'PUBLISHED', 'DISPATCHING'].includes(task.state) && isPub) actions.push(`<button class="wow-btn wow-btn-danger" data-action="cancel" data-id="${esc(id)}">${t('task.cancel')}</button>`);
  if (isSol && ['PUBLISHED', 'DISPATCHING'].includes(task.state)) actions.push(`<button class="wow-btn wow-btn-ghost" data-action="feedback" data-id="${esc(id)}">${t('task.feedback')}</button>`);
  actions.push(`<button class="wow-btn wow-btn-ghost" data-action="report" data-id="${esc(id)}">${t('task.report')}</button>`);

  app.innerHTML = `
    <div class="wow-section-head"><h2>${t('task.detail')}</h2><a href="#/hall">← ${t('task.back')}</a></div>
    ${unverified ? `<div class="wow-notice warn">${t('auth.verify')} <button class="wow-btn wow-btn-ghost wow-btn-sm" data-action="resend-verification">${t('auth.resend')}</button></div>` : ''}
    <div class="wow-split">
      <div>
        <div class="wow-panel">
          <div class="wow-contract-head"><h2>${esc(task.title)}</h2>${stateBadge(task.state)}</div>
          <p>${esc(task.description || '')}</p>
          <h3>${t('task.criteria')}</h3><p>${esc(task.acceptance_criteria || '')}</p>
          ${task.result_preview ? `<h3>${t('task.result')} ${task.result_pii_redacted ? '<span class="wow-badge ok">redacted</span>' : ''}</h3><p class="wow-notice info">${esc(task.result_preview)}</p>` : ''}
          <h3>${t('task.events')}</h3>
          <div class="wow-table-wrap"><table class="wow-table"><thead><tr><th>#</th><th>Type</th><th>Time</th></tr></thead><tbody>
          ${(state.events || []).slice(-12).map((x) => `<tr><td>${esc(x.seq)}</td><td class="tiny">${esc(x.type)}</td><td class="tiny muted">${fmtDate(x.created_at)}</td></tr>`).join('') || `<tr><td colspan="3">${t('common.empty')}</td></tr>`}
          </tbody></table></div>
        </div>
      </div>
      <div>
        <div class="wow-panel">
          <dl class="wow-kv">
            <dt>${t('task.bounty')}</dt><dd>${coin(task.bounty)}</dd>
            <dt>${t('task.fee')}</dt><dd>${esc(task.service_fee)} SBC</dd>
            <dt>${t('task.state')}</dt><dd>${stateBadge(task.state)}</dd>
            <dt>${t('task.category')}</dt><dd>${esc(task.category || '—')}</dd>
            <dt>${t('task.deadline')}</dt><dd>${fmtDate(task.deadline)}</dd>
            <dt>${t('task.skills')}</dt><dd>${(task.required_skills || []).map((s) => `<span class="wow-tag">${esc(s)}</span>`).join(' ') || '—'}</dd>
            <dt>Task ID</dt><dd class="mono tiny">${esc(task.task_id)}</dd>
          </dl>
          <div class="wow-btn-row" style="margin-top:16px">${actions.join('')}</div>
        </div>
      </div>
    </div>`;
}

/* ---------- 视图：登录 / 注册 ---------- */
function renderAuth(app) {
  const login = state.authTab === 'login';
  app.innerHTML = `
    <div class="wow-panel" style="max-width:560px;margin:0 auto">
      <h2>${t('auth.title')}</h2><p class="muted">${t('auth.sub')}</p>
      <div class="wow-tabs">
        <button class="${login ? 'active' : ''}" data-action="auth-tab" data-tab="login">${t('auth.login')}</button>
        <button class="${!login ? 'active' : ''}" data-action="auth-tab" data-tab="register">${t('auth.register')}</button>
      </div>
      <form class="wow-form" id="auth-form">
        <div class="wow-field"><label>${t('auth.email')}</label><input class="wow-input" name="email" type="email" required autocomplete="email"></div>
        <div class="wow-field"><label>${t('auth.password')}</label><input class="wow-input" name="password" type="password" required minlength="10" autocomplete="${login ? 'current-password' : 'new-password'}"></div>
        ${login ? '' : `
        <div class="wow-field"><label>${t('auth.name')}</label><input class="wow-input" name="display_name" required></div>
        <div class="wow-field"><label>${t('auth.role')}</label>
          <select class="wow-select" name="role"><option value="solver">${t('auth.solver')}</option><option value="publisher">${t('auth.publisher')}</option></select>
        </div>`}
        <button class="wow-btn wow-btn-gold" type="submit">${login ? t('auth.login') : t('auth.register')}</button>
      </form>
      <p class="tiny muted" style="margin-top:14px">${t('auth.hint')}</p>
    </div>`;
  document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const body = login
      ? { email: String(f.get('email') || '').trim(), password: String(f.get('password') || '') }
      : {
        email: String(f.get('email') || '').trim(), password: String(f.get('password') || ''),
        display_name: String(f.get('display_name') || '').trim(), role: String(f.get('role') || 'solver'),
        locale: LOCALE,
      };
    try {
      const d = await api(login ? '/api/auth/login' : '/api/auth/register', { method: 'POST', body, authAttempt: true });
      state.user = d.user || null;
      state.csrf = (d.session && d.session.csrf_token) || '';
      if (d.verification_required && state.user) { state.user.email_verified = false; toast(t('auth.verify'), 'error'); }
      else toast(login ? t('auth.login') : t('auth.register'), 'ok');
      go('#/hall');
      render();
    } catch (err) {
      if (err.status === 401) toast('[INVALID_CREDENTIALS] ' + err.message, 'error');
      else showError(err);
    }
  });
}

/* ------------------------------------------------ 5. 人工闸门弹窗 -------- */
function humanConfirm({ title, message, word, onConfirm }) {
  state.modal = { onConfirm };
  const root = document.getElementById('wow-modal');
  root.hidden = false;
  root.innerHTML = `<div class="wow-modal">
    <h3>${esc(title)}</h3>
    <p>${esc(message)}</p>
    <p class="small muted">${t('common.humanGate')}</p>
    <div class="wow-field"><label>${t('modal.typeWord', { word: `<span class="wow-confirm-word">${esc(word)}</span>` })}</label>
      <input class="wow-input" id="m-confirm-input" autocomplete="off"></div>
    <div class="wow-btn-row">
      <button class="wow-btn wow-btn-gold" data-action="modal-confirm">${t('common.humanConfirm')}</button>
      <button class="wow-btn wow-btn-ghost" data-action="modal-cancel">${t('common.cancel')}</button>
    </div>
  </div>`;
  const input = document.getElementById('m-confirm-input');
  if (input) input.focus();
}
function closeModal() { state.modal = null; document.getElementById('wow-modal').hidden = true; document.getElementById('wow-modal').innerHTML = ''; }

/* ------------------------------------------------ 6. 写操作 ------------- */
async function doAction(action, el) {
  const id = el.getAttribute('data-id');
  if (!requireWrite()) return;
  if (action === 'accept') {
    try { await api('/api/tasks/' + encodeURIComponent(id) + '/accept', { method: 'POST', body: { event_id: eid('EVT') } }); toast(t('task.ok.accepted'), 'ok'); render(); }
    catch (e) { showError(e); }
  } else if (action === 'submit-form') {
    const msg = window.prompt(t('task.note'));
    if (msg === null) return;
    try { await api('/api/tasks/' + encodeURIComponent(id) + '/submit', { method: 'POST', body: { content: msg, event_id: eid('EVT') } }); toast(t('task.ok.submitted'), 'ok'); render(); }
    catch (e) { showError(e); }
  } else if (action === 'verify') {
    const decision = el.getAttribute('data-decision');
    humanConfirm({
      title: decision === 'approve' ? t('task.verify') : t('task.reject'),
      message: t('common.humanGate'),
      word: 'CONFIRM',
      onConfirm: async () => {
        try { await api('/api/tasks/' + encodeURIComponent(id) + '/verify', { method: 'POST', body: { decision, event_id: eid('EVT') } }); toast(t('task.ok.verified'), 'ok'); render(); }
        catch (e) { showError(e); }
      },
    });
  } else if (action === 'cancel') {
    const reason = window.prompt(t('task.note'), 'publisher_withdrawn') || 'publisher_withdrawn';
    humanConfirm({
      title: t('task.cancel'), message: t('common.humanGate'), word: 'CANCEL',
      onConfirm: async () => {
        try { await api('/api/tasks/' + encodeURIComponent(id) + '/cancel', { method: 'POST', body: { reason, event_id: eid('EVT') } }); toast(t('task.ok.cancelled'), 'ok'); render(); }
        catch (e) { showError(e); }
      },
    });
  } else if (action === 'dispute') {
    const reason = window.prompt(t('task.note')) || '';
    humanConfirm({
      title: t('task.dispute'), message: t('common.humanGate'), word: 'DISPUTE',
      onConfirm: async () => {
        try { await api('/api/tasks/' + encodeURIComponent(id) + '/dispute', { method: 'POST', body: { action: 'open', reason, event_id: eid('EVT') } }); toast(t('task.ok.disputed'), 'ok'); render(); }
        catch (e) { showError(e); }
      },
    });
  } else if (action === 'feedback') {
    try { await api('/api/tasks/' + encodeURIComponent(id) + '/feedback', { method: 'POST', body: { kind: 'EXPOSED', event_id: eid('EVT') } }); toast('OK', 'ok'); }
    catch (e) { showError(e); }
  } else if (action === 'report') {
    const reason = window.prompt(t('task.report'));
    if (!reason) return;
    try { await api('/api/reports', { method: 'POST', body: { reason, task_id: id, event_id: eid('EVT') } }); toast('OK', 'ok'); }
    catch (e) { showError(e); }
  } else if (action === 'resend-verification') {
    try { await api('/api/auth/resend-verification', { method: 'POST', body: {} }); toast('OK', 'ok'); }
    catch (e) { showError(e); }
  } else if (action === 'set-personalized') {
    const enabled = el.getAttribute('data-enabled') === '1';
    try {
      const d = await api('/api/preferences/personalized', {
        method: 'POST', body: { enabled, event_id: eid('EVT') },
      });
      state.personalized = d.personalized_enabled === true;
      toast(t('prefs.saved'), 'ok');
      render();
    } catch (e) { showError(e); }
  }
}

/* ------------------------------------------------ 7. 事件委托 ----------- */
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const action = el.getAttribute('data-action');
  switch (action) {
    case 'go-auth': state.authTab = 'login'; go('#/auth'); break;
    case 'toggle-locale':
      LOCALE = LOCALE === 'en' ? 'zh-CN' : 'en';
      try { localStorage.setItem('sambon.locale', LOCALE); } catch {}
      document.documentElement.lang = LOCALE === 'zh-CN' ? 'zh-CN' : 'en';
      applyStaticI18n(); render(); break;
    case 'logout':
      api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
      clearSession(); go('#/hall'); render(); break;
    case 'open-task': go('#/task/' + el.getAttribute('data-id')); break;
    case 'refresh-tasks': render(); break;
    case 'rank-tab': state.rankTab = el.getAttribute('data-tab'); render(); break;
    case 'mine-tab': state.mineTab = el.getAttribute('data-tab'); render(); break;
    case 'auth-tab': state.authTab = el.getAttribute('data-tab'); renderAuth(document.getElementById('m-app')); break;
    case 'modal-cancel': closeModal(); break;
    case 'modal-confirm': {
      const input = document.getElementById('m-confirm-input');
      const word = (input && input.value.trim()) || '';
      if (word !== 'CONFIRM' && word !== 'CANCEL' && word !== 'DISPUTE') { toast(t('modal.typeWord', { word: 'CONFIRM' }), 'error'); break; }
      const fn = state.modal && state.modal.onConfirm;
      closeModal();
      if (fn) fn();
      break;
    }
    case 'accept': case 'verify': case 'cancel': case 'dispute':
    case 'submit-form': case 'feedback': case 'report': case 'resend-verification':
    case 'set-personalized':
      doAction(action, el); break;
    default: break;
  }
});
window.addEventListener('hashchange', () => render());

/* ------------------------------------------------ 8. bootstrap ---------- */
async function bootstrap() {
  initLocale();
  applyStaticI18n();
  let health = null, cfg = null;
  try { health = await api('/api/health'); } catch (e) { showError(e); }
  try { cfg = await api('/api/config'); } catch (e) { showError(e); }
  state.config = cfg;
  state.mode = (health && health.mode) || (cfg && cfg.mode) || 'demo';
  if (state.mode !== 'production') document.getElementById('wow-banner-demo').hidden = false;

  const meta = document.getElementById('m-meta');
  if (health) {
    meta.textContent = t('meta.ready', {
      status: health.status, db: health.db,
      version: health.version || '—', lock: canWrite() ? t('meta.unlock') : t('meta.lock'),
    });
  } else meta.textContent = t('meta.idle');

  try {
    const me = await api('/api/auth/me', { silent401: true });
    if (me) {
      state.user = me.user || null;
      state.csrf = me.csrf_token || (me.session && me.session.csrf_token) || '';
      if (me.preferences && typeof me.preferences.personalized_enabled === 'boolean') {
        state.personalized = me.preferences.personalized_enabled;
      }
    }
  } catch {}

  // 玩家声望：从用户榜取本人 net_sbc，补充猎人等级经验（失败静默，不影响主流程）
  if (state.user) {
    try {
      const board = await api('/api/leaderboard/users');
      const mine = Array.isArray(board.items)
        ? board.items.find((i) => i.user_id === state.user.user_id) : null;
      state.hunterCredit = mine ? Number(mine.net_sbc || 0) : 0;
    } catch {}
  }

  render();
}

bootstrap();
