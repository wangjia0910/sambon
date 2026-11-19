/**
 * 本地预览服务（一次性，供部署前肉眼验收用户版前端）
 * 把 Pages Functions dispatch() 包装为真实 HTTP 服务，并托管 cloudflare/ 静态产物。
 * 运行：node ops/preview-server.mjs [port]   默认 8788
 * 数据为内存 D1 mock，重启即清空；绝不可用于生产。
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createD1Mock } from '../tests/d1-mock.js';
import { dispatch } from '../prod/lib/api.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'cloudflare');
const PORT = Number(process.argv[2] || 8788);
const db = createD1Mock();
const ENV = {
  DB: db, ADMIN_BOOTSTRAP_TOKEN: 'preview-admin', PBKDF2_ITERATIONS: '2000',
  INITIAL_SBC: '1000', RATE_LIMIT_DISABLED: 'true', COOKIE_SECURE: 'false',
};

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
};

// _redirects → 无扩展名 rewrite 映射
const REWRITE = {
  '/': '/member.html', '/app': '/member.html', '/member': '/member.html',
  '/prod': '/prod.html', '/product': '/prod.html', '/production': '/prod.html',
  '/index': '/index.html', '/demo': '/index.html',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
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
      for (const [k, v] of r.headers) res.setHeader(k, v);
      res.end(await r.text());
    } catch (e) {
      res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: { code: 'PREVIEW_ERROR', message: e.message } }));
    }
    return;
  }
  let path = REWRITE[url.pathname] || url.pathname;
  let file = join(OUT, path === '/' ? 'member.html' : path);
  try {
    let s = await stat(file);
    if (s.isDirectory()) file = join(file, 'index.html');
    const buf = await readFile(file);
    res.statusCode = 200;
    res.setHeader('content-type', MIME[extname(file)] || 'application/octet-stream');
    res.setHeader('cache-control', 'no-store');
    res.end(buf);
  } catch {
    res.statusCode = 404; res.end('Not found: ' + path);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[sambon preview] http://localhost:${PORT}  （用户版主入口，数据为内存 mock，重启清空）`);
});
