/**
 * 三宝殿 · 在线评审站点服务（WorkBuddy Sites 单端口部署入口）
 *
 * 与 ops/preview-server.mjs 的区别：
 *   - 绑定 0.0.0.0 并读取 $PORT（部署沙箱要求）；preview 版固定 127.0.0.1。
 *   - 注入基础安全响应头（与主站 _headers 一致的最小集）。
 *   - 后端不可用时优雅降级为只读静态站（demo 模式），不会整站 500。
 *
 * 数据为内存 SQLite（重启即清空）——本站点是**在线评审/演示环境**，
 * 不是 Cloudflare Pages + D1 的正式生产（后者需 git push 触发自动部署）。
 *
 * 启动：PORT=xxxx node ops/deploy-server.mjs
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'cloudflare');
const PORT = Number(process.env.PORT || 8787);

// 发布沙箱可能不携带构建产物：缺产物时从单一真源（src/ + prod/site/）现场重建。
if (!existsSync(join(OUT, 'member.html'))) {
  const r = spawnSync(process.execPath, ['tools/build-cloudflare.mjs'], { cwd: ROOT, encoding: 'utf8' });
  console.log('[sambon] 现场重建 cloudflare/ 产物：exit=' + r.status);
  if (r.status !== 0) console.error(String(r.stderr || '').slice(-500));
}

// 后端延迟加载：node:sqlite 在运行环境不可用时仍可托管静态站
let dispatch = null;
let ENV = null;
try {
  const [{ createD1Mock }, api] = await Promise.all([
    import('../tests/d1-mock.js'),
    import('../prod/lib/api.js'),
  ]);
  dispatch = api.dispatch;
  ENV = {
    DB: createD1Mock(),
    ADMIN_BOOTSTRAP_TOKEN: process.env.ADMIN_BOOTSTRAP_TOKEN || 'review-admin',
    PBKDF2_ITERATIONS: '2000',
    INITIAL_SBC: '1000',
    RATE_LIMIT_DISABLED: 'true',
    COOKIE_SECURE: 'false',
  };
  console.log('[sambon] 后端已加载（真实 SQL / 内存 D1），/api/* 可用');
} catch (e) {
  console.warn('[sambon] 后端不可用，降级为只读静态评审站：' + (e && e.message));
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

const REWRITE = {
  '/': '/member.html', '/app': '/member.html', '/member': '/member.html',
  '/prod': '/prod.html', '/product': '/prod.html', '/production': '/prod.html',
  '/index': '/index.html', '/demo': '/index.html',
};

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
  + "img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; "
  + "frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

function securityHeaders(res, isHtml) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  if (isHtml) res.setHeader('Content-Security-Policy', CSP);
}

const server = createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); }
  catch { res.statusCode = 400; res.end('Bad request'); return; }

  if (url.pathname.startsWith('/api/')) {
    if (!dispatch) {
      res.statusCode = 503;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: false, error: { code: 'BACKEND_UNAVAILABLE', message: '评审站后端未加载' } }));
      return;
    }
    const headers = { host: req.headers.host || 'localhost' };
    for (const k of ['cookie', 'x-csrf-token', 'content-type', 'origin', 'sec-gpc', 'dnt']) {
      if (req.headers[k]) headers[k] = req.headers[k];
    }
    let body;
    if (!['GET', 'HEAD'].includes(req.method)) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      body = Buffer.concat(chunks).toString('utf8');
    }
    try {
      const r = await dispatch(new Request('http://localhost' + req.url, {
        method: req.method, headers, body,
      }), ENV);
      res.statusCode = r.status;
      for (const [k, v] of r.headers) {
        if (k.toLowerCase() === 'set-cookie') res.setHeader(k, v);
      }
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(await r.text());
    } catch (e) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: false, error: { code: 'REVIEW_ERROR', message: e.message } }));
    }
    return;
  }

  const path = REWRITE[url.pathname] || url.pathname;
  let file = join(OUT, path === '/' ? 'member.html' : path);
  try {
    let s = await stat(file);
    if (s.isDirectory()) file = join(file, 'index.html');
    const buf = await readFile(file);
    res.statusCode = 200;
    res.setHeader('content-type', MIME[extname(file)] || 'application/octet-stream');
    res.setHeader('cache-control', 'no-store');
    securityHeaders(res, extname(file) === '.html');
    res.end(buf);
  } catch {
    res.statusCode = 404; res.end('Not found: ' + path);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[sambon] 在线评审站 http://0.0.0.0:${PORT}  （用户版主入口 /member；内存数据重启清空）`);
});
