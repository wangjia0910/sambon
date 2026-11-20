/**
 * 多智能体端到端模拟 · 共享 HTTP 客户端
 *
 * 让每个智能体用「真人操作」的方式通过 HTTP 请求访问共享测试服务，
 * 而不是直接调用 dispatch() 或跑现成测试脚本。封装 cookie / CSRF / event_id，
 * 智能体只需关心业务动作语义。
 *
 * 用法（智能体在 Bash 里）：
 *   import { SimClient, eid } from './ops/multiagent-client.mjs';
 *   const c = new SimClient('http://127.0.0.1:8793');
 *   await c.register('pub_a@test.dev', 'PubPass123!long', 'publisher');
 *   const r = await c.post('/api/tasks', {...});
 *   console.log(JSON.stringify(r));
 */
export class SimClient {
  constructor(base = 'http://127.0.0.1:8793', label = '') {
    this.base = base.replace(/\/$/, '');
    this.label = label;
    this.cookie = null;
    this.csrf = null;
    this.userId = null;
    this.email = null;
    this.role = null;
    this.trace = []; // 操作轨迹：{step, method, path, status, ok, code, at}
  }

  _record(method, path, r) {
    this.trace.push({
      step: this.trace.length + 1, method, path,
      status: r.status, ok: r.data !== undefined && r.error === null && r.status < 400,
      code: r.error?.code || null, at: new Date().toISOString(),
    });
  }

  async request(method, path, body, opts = {}) {
    const headers = { host: new URL(this.base).host };
    if (this.cookie) headers.cookie = this.cookie;
    if (!['GET', 'HEAD'].includes(method) && !opts.noCsrf && this.csrf) {
      headers['x-csrf-token'] = this.csrf;
    }
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (opts.headers) Object.assign(headers, opts.headers);
    const res = await fetch(this.base + path, {
      method, headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { ok: false, error: { code: 'NON_JSON', message: text.slice(0, 120) } }; }
    const out = { status: res.status, ok: json.ok, data: json.data ?? null, error: json.error ?? null };
    this._record(method, path, out);
    return out;
  }

  get(path, opts) { return this.request('GET', path, undefined, opts); }
  post(path, body, opts) { return this.request('POST', path, body, opts); }
  del(path, body, opts) { return this.request('DELETE', path, body, opts); }

  async register(email, password, role, displayName) {
    const r = await this.post('/api/auth/register', {
      email, password, role, display_name: displayName || email.split('@')[0],
      locale: 'zh-CN', event_id: eid('reg'),
    });
    if (r.status === 201) {
      this.csrf = r.data?.session?.csrf_token || null;
      this.userId = r.data?.user?.user_id || null;
      this.email = email;
      this.role = role;
    }
    return r;
  }

  async login(email, password) {
    const r = await this.post('/api/auth/login', { email, password, event_id: eid('login') });
    if (r.status === 200) {
      this.csrf = r.data?.session?.csrf_token || null;
      this.userId = r.data?.user?.user_id || null;
      this.email = email;
    }
    return r;
  }

  async bootstrapAdmin(token, email, password) {
    const r = await this.post('/api/admin/bootstrap', {
      bootstrap_token: token, email, password, display_name: '多智能体测试管理员',
    }, { noCsrf: true });
    if (r.status === 201) { this.csrf = r.data?.session?.csrf_token || null; this.userId = r.data?.user?.user_id || null; }
    // bootstrap 之后需要登录以取得稳定会话
    if (r.status === 201 || r.status === 409) await this.login(email, password);
    return r;
  }

  async dumpResult(name, extra = {}) {
    const { writeFileSync } = await import('node:fs');
    const summary = {
      agent: name, label: this.label, role: this.role, email: this.email, userId: this.userId,
      trace: this.trace,
      steps: this.trace.length,
      pass: this.trace.filter((t) => t.ok).length,
      fail: this.trace.filter((t) => !t.ok).length,
      failedSteps: this.trace.filter((t) => !t.ok),
      ...extra,
    };
    const file = `ops/multiagent-results/${name}.json`;
    writeFileSync(file, JSON.stringify(summary, null, 2), 'utf8');
    console.log(`[${name}] steps=${summary.steps} pass=${summary.pass} fail=${summary.fail} → ${file}`);
    return summary;
  }
}

export const eid = (tag) => `EVT-MA-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

/** 轮询等待某条件，模拟真人反复刷新页面观察状态变化 */
export async function waitFor(fn, { timeout = 15000, interval = 300, label = 'condition' } = {}) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    last = await fn();
    if (last && last.done) return last;
    await new Promise((r) => setTimeout(r, interval));
  }
  return { done: false, timeout: true, last, label };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
