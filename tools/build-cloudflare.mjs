/**
 * 生成 Cloudflare Pages 产物目录 `cloudflare/` + 生产系统 Functions 依赖
 *
 * 运行：node tools/build-cloudflare.mjs   （零第三方依赖）
 *
 * 本脚本同时维护两条通道，且**单一真源**始终是 `src/*.mjs` 与 `prod/site/*`：
 *
 *  ① L0 静态演示（保留，不破坏既有回归）
 *     web/index.html + 浏览器运行时引导层 → cloudflare/index.html
 *     src/*.mjs → cloudflare/src/*.mjs（逐字节复制）
 *     访问 /index.html 或 /demo.html 进入；/api/* 由页面内运行时计算，不发真实请求。
 *
 *  ② L1 生产系统（本轮新增）
 *     prod/site/* → cloudflare/（prod.html / app.js / styles.css / legal.html）
 *     src/domain.mjs、src/hash.mjs → prod/lib/（Pages Functions 打包依赖）
 *     cloudflare/_redirects 把 `/` 重写到 /prod.html，使站点主入口为生产系统。
 *     生产前端走同源真实 fetch → functions/api/[[path]].js → D1 持久化。
 *
 * 注意：Pages Functions 目录 `functions/` 位于仓库根，Cloudflare Git 集成会
 * 自动编译它，与「输出目录 = cloudflare」互不冲突（Functions 路由优先于静态资源）。
 * 修改 src/ 或 prod/site/ 后必须重跑本脚本，否则产物会落后。
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'cloudflare');
const FN_LIB = join(ROOT, 'prod', 'lib');
const SITE = join(ROOT, 'prod', 'site');
const SRC_FILES = ['domain.mjs', 'store.mjs', 'server.mjs', 'hash.mjs'];

// 同步注入到 <head>：先把 /api/* 请求排入队列，异步 import 运行时就绪后 flush，
// 因此页面底部主脚本 init() 里立即发出的 /api/config 等请求也能正常拿到结果。
const BOOTSTRAP = `<script>
/* 三宝殿 · Cloudflare 静态版引导层（浏览器内运行，不发起任何真实后端请求） */
(function () {
  var queue = [], handler = null;
  var nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var rawUrl = typeof input === 'string' ? input : ((input && input.url) || '');
    var u = new URL(rawUrl, location.href);
    if (u.pathname.indexOf('/api/') !== 0) return nativeFetch(input, init);
    return new Promise(function (resolve, reject) {
      var body;
      try { body = (init && init.body) ? JSON.parse(init.body) : undefined; }
      catch (e) { body = undefined; }
      var job = {
        method: (init && init.method) || (input && input.method) || 'GET',
        url: u.pathname + u.search,
        body: body, resolve: resolve, reject: reject
      };
      if (handler) { handler(job); } else { queue.push(job); }
    });
  };
  window.__installSambonRuntime = function (fn) {
    handler = fn;
    while (queue.length) { handler(queue.shift()); }
  };
  import('./cf-runtime.mjs').catch(function (e) {
    console.error('[sambon-static] 浏览器运行时加载失败', e);
  });
})();
</script>
`;

const HEADERS = `# Cloudflare Pages 响应头：确保 ESM 模块以正确 MIME 返回
/src/*.mjs
  Content-Type: text/javascript; charset=utf-8
  X-Content-Type-Options: nosniff

/cf-runtime.mjs
  Content-Type: text/javascript; charset=utf-8
  X-Content-Type-Options: nosniff

/site-selfcheck.mjs
  Content-Type: text/javascript; charset=utf-8
  X-Content-Type-Options: nosniff

/app.js
  Content-Type: text/javascript; charset=utf-8
  X-Content-Type-Options: nosniff

/*.html
  Cache-Control: no-store
  X-Content-Type-Options: nosniff

# 生产页 CSP：禁止内联脚本 / 第三方来源；legal.html 有内联 <style>，故 style 允许 unsafe-inline。
# L0 演示页（/index.html、/demo.html）带内联引导层，不套用此 CSP，避免破坏既有演示。
/
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()

/prod.html
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()

/legal.html
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()

/styles.css
  Content-Type: text/css; charset=utf-8
  X-Content-Type-Options: nosniff

/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY
`;

// 站点主入口重写为生产系统；L0 演示仍可通过 /index.html、/demo.html 访问。
// /api/* 不在此规则内，由 Pages Functions 直接接管。
const REDIRECTS = `# 三宝殿 · Cloudflare Pages 路由（Git 集成部署自动生效）
# 主入口：生产系统操作台（200 rewrite，不改地址栏）
/               /prod.html        200
/production     /prod.html        200
# L0 静态演示台保留，供对照与降级验收
/demo           /index.html       200
`;

// 一旦项目存在 functions/ 目录，Pages 默认会把所有请求都交给 Function。
// 显式限定只有 /api/* 走 Functions，静态资源仍走静态通道（免费额度与性能）。
// 参考：developers.cloudflare.com/pages/functions/routing/#functions-invocation-routes
const ROUTES_JSON = `${JSON.stringify({
  version: 1,
  include: ['/api/*'],
  exclude: [],
}, null, 2)}\n`;

function sha(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 12);
}

// 产物目录整体重建（cloudflare/ 是纯生成物，不含项目数据）
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'src'), { recursive: true });
mkdirSync(FN_LIB, { recursive: true });

// ---- ① L0 静态演示产物（保持原有 8 文件不变） ----
const html = readFileSync(join(ROOT, 'web/index.html'), 'utf8');
if (!html.includes('</head>')) throw new Error('web/index.html 缺少 </head>，无法注入引导层');
if (html.includes('__installSambonRuntime')) throw new Error('web/index.html 不应包含静态版引导层（应由构建脚本注入）');
writeFileSync(join(OUT, 'index.html'), html.replace('</head>', BOOTSTRAP + '</head>'), 'utf8');
writeFileSync(join(OUT, 'demo.html'), html.replace('</head>', BOOTSTRAP + '</head>'), 'utf8');

writeFileSync(join(OUT, 'cf-runtime.mjs'), readFileSync(join(ROOT, 'tools/cf-runtime.mjs')), 'utf8');
writeFileSync(join(OUT, 'site-selfcheck.mjs'), readFileSync(join(ROOT, 'tools/site-selfcheck.mjs')), 'utf8');
for (const f of SRC_FILES) {
  writeFileSync(join(OUT, 'src', f), readFileSync(join(ROOT, 'src', f)), 'utf8');
}
writeFileSync(join(OUT, '_headers'), HEADERS, 'utf8');

// ---- ② 生产系统前端 ----
const SITE_FILES = ['index.html', 'app.js', 'styles.css', 'legal.html'];
for (const f of SITE_FILES) {
  const src = join(SITE, f);
  if (!existsSync(src)) throw new Error(`缺少生产前端文件：prod/site/${f}`);
  const destName = f === 'index.html' ? 'prod.html' : f;
  writeFileSync(join(OUT, destName), readFileSync(src), 'utf8');
}
writeFileSync(join(OUT, '_redirects'), REDIRECTS, 'utf8');
writeFileSync(join(OUT, '_routes.json'), ROUTES_JSON, 'utf8');

// ---- ③ Pages Functions 的领域层依赖（单一真源 = src/） ----
// 不能复制 server.mjs / store.mjs：它们含 node: 动态 import 与进程级单例，
// 生产后端只用 domain.mjs 的纯函数口径，编排与持久化在 prod/lib 重写。
for (const [from, to] of [['domain.mjs', 'domain.js'], ['hash.mjs', 'hash.js']]) {
  writeFileSync(join(FN_LIB, to), readFileSync(join(ROOT, 'src', from)), 'utf8');
}

// ---- ④ 生成根目录 schema.sql（真源为 prod/lib/schema.js） ----
const { SCHEMA_SQL } = await import('../prod/lib/schema.js');
writeFileSync(join(ROOT, 'schema.sql'), SCHEMA_SQL, 'utf8');

const files = [
  'index.html', 'cf-runtime.mjs', 'site-selfcheck.mjs', '_headers',
  ...SRC_FILES.map((f) => `src/${f}`),
  'prod.html', 'app.js', 'styles.css', 'legal.html', '_redirects', '_routes.json', 'demo.html',
];
console.log('=== Cloudflare Pages 产物 ===');
for (const f of files) {
  const p = join(OUT, f);
  console.log(`${f.padEnd(24)} ${String(statSync(p).size).padStart(8)} bytes  ${sha(p)}`);
}
console.log('\n=== Pages Functions 领域层（与 src/ 逐字节一致） ===');
for (const f of ['domain.js', 'hash.js']) {
  console.log(`prod/lib/${f.padEnd(12)} ${String(statSync(join(FN_LIB, f)).size).padStart(8)} bytes`);
}
console.log(`\n产物目录：${OUT}`);
console.log(`共 ${files.length} 个文件；L0 8 文件保持原样，生产前端 + Functions 依赖已同步。`);
console.log('下一步：Cloudflare Pages 输出目录设为 cloudflare；git push origin main 自动部署。');
