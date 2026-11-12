/**
 * 生产系统 · 统一响应信封与安全响应头
 *
 * 前端 prod/site/app.js 的 api() 依赖此格式：
 *   成功 { ok:true, data:..., error:null }
 *   失败 { ok:false, data:null, error:{code,message} }
 * 所有异常在入口层统一转成 ApiFailure，绝不把堆栈 / SQL / PII 回给客户端。
 */

const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

export class ApiFailure extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'ApiFailure';
    this.code = code;
    this.status = status;
  }
}

export const fail = (code, message, status = 400) => {
  throw new ApiFailure(code, message, status);
};

export function ok(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify({ ok: true, data, error: null }), {
    status,
    headers: { ...BASE_HEADERS, ...extraHeaders },
  });
}

export function errorResponse(err) {
  const known = err instanceof ApiFailure;
  const status = known ? err.status : 500;
  const code = known ? err.code : 'INTERNAL_ERROR';
  // 生产环境不回显内部错误细节，避免泄露表结构 / 凭据 / PII
  const message = known ? err.message : '服务内部错误，请稍后重试';
  return new Response(JSON.stringify({ ok: false, data: null, error: { code, message } }), {
    status,
    headers: BASE_HEADERS,
  });
}

/** 把 Response 的 body 读回对象（本地回归测试用，生产链路不调用） */
export async function readEnvelope(response) {
  return { status: response.status, body: JSON.parse(await response.text()) };
}
