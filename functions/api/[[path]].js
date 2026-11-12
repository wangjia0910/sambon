/**
 * 《三宝殿》生产系统 · Cloudflare Pages Functions 通用入口
 *
 * 文件名 [[path]].js 为 Pages 的「可选 catch-all」路由：
 *   /api/health、/api/tasks、/api/tasks/T-xxx/review … 全部由此接管。
 * Cloudflare Git 集成在每次 git push 后自动编译 functions/ 目录，
 * 与「输出目录 = cloudflare」的静态产物互不冲突（Functions 路由优先）。
 *
 * 所有业务逻辑在 prod/lib/api.js；本文件只做平台适配，便于本地用 Request/Response 回归。
 */

import { dispatch } from '../../prod/lib/api.js';

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Allow': 'GET, POST, DELETE, OPTIONS' } });
  }
  return dispatch(context.request, context.env || {});
}
