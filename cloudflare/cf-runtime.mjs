/**
 * 《三宝殿》Cloudflare Pages 纯静态 Web 版 · 浏览器运行时
 *
 * 本文件是「源文件」，会被 tools/build-cloudflare.mjs 原样复制到产物根目录
 * `cloudflare/cf-runtime.mjs`。因此下面的 import 路径按【产物根目录】解析
 * （与 `cloudflare/src/` 同级），不要在 tools/ 目录下直接运行本文件。
 *
 * 设计要点：
 * 1. 不重写任何业务逻辑 —— 直接 import 共用的 `src/server.mjs` 的 handle()，
 *    状态机、积分规则、推送权重、榜单权重、脱敏、LLM 兜底与本地 Node 版完全一致。
 * 2. 用极薄的 mock req / res 适配 Node HTTP 风格，浏览器中不启动任何服务器。
 * 3. 数据保存在页面内存（模块级 store 单例），刷新即重置；与本地 Node 版一致，
 *    均为演示口径，不接真实支付 / 大模型 / 公链 / 持久化。
 */

import { handle } from './src/server.mjs';

/** 模拟 Node IncomingMessage：readBody() 只用到 on('data'|'end'|'error') 与 destroy() */
function mockReq(method, url, body) {
  const listeners = Object.create(null);
  const raw = body === undefined ? '' : JSON.stringify(body);
  queueMicrotask(() => {
    if (listeners.data && raw) listeners.data(raw);
    if (listeners.end) listeners.end();
  });
  return {
    method,
    url,
    on(event, cb) { listeners[event] = cb; return this; },
    destroy() {},
  };
}

/** 模拟 Node ServerResponse：reply() 只用到 writeHead() 与 end() */
function mockRes() {
  const out = { status: 200, headers: {}, text: '' };
  return {
    writeHead(status, headers) { out.status = status; out.headers = headers || {}; },
    end(text) { out.text = text; },
    out,
  };
}

/**
 * 处理一条 /api/* 请求，返回 {status, text, headers}。
 * 导出以便 tests/verify-cloudflare.mjs 在 Node 侧直接做跨实现一致性验证。
 */
export async function handleApiJob(job) {
  const req = mockReq(job.method, job.url, job.body);
  const res = mockRes();
  try {
    await handle(req, res);
  } catch (e) {
    return {
      status: 500,
      text: JSON.stringify({
        ok: false, data: null,
        error: { code: 'CLIENT_RUNTIME_ERROR', message: String((e && e.message) || e) },
      }),
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    };
  }
  return { status: res.out.status, text: res.out.text, headers: res.out.headers };
}

/** 页面注入的引导脚本会先排好请求队列，本模块加载完成后注册处理器并 flush。 */
if (typeof window !== 'undefined' && typeof window.__installSambonRuntime === 'function') {
  window.__installSambonRuntime(async (job) => {
    const r = await handleApiJob(job);
    const headers = {
      'Content-Type': r.headers['Content-Type'] || 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    };
    job.resolve(new Response(r.text, { status: r.status, headers }));
  });
}
