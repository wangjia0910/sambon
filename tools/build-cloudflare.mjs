/**
 * 生成 Cloudflare Pages 纯静态 Web 版产物目录 `cloudflare/`
 *
 * 运行：node tools/build-cloudflare.mjs   （零第三方依赖）
 * 产物可直接拖进 Cloudflare Pages 上传，或在 Pages Git 集成中把
 * 「输出目录」设为 cloudflare、「构建命令」留空。
 *
 * 单一真源：业务逻辑只存在于 src/*.mjs，这里是复制 + 注入，不改写逻辑。
 * 修改 src/ 或 web/index.html 后必须重跑本脚本，否则产物会落后。
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'cloudflare');
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

/index.html
  Cache-Control: no-store
  X-Content-Type-Options: nosniff

/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
`;

function sha(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 12);
}

// 产物目录整体重建（cloudflare/ 是纯生成物，不含项目数据）
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'src'), { recursive: true });

const html = readFileSync(join(ROOT, 'web/index.html'), 'utf8');
if (!html.includes('</head>')) throw new Error('web/index.html 缺少 </head>，无法注入引导层');
if (html.includes('__installSambonRuntime')) throw new Error('web/index.html 不应包含静态版引导层（应由构建脚本注入）');
writeFileSync(join(OUT, 'index.html'), html.replace('</head>', BOOTSTRAP + '</head>'), 'utf8');

writeFileSync(join(OUT, 'cf-runtime.mjs'), readFileSync(join(ROOT, 'tools/cf-runtime.mjs')), 'utf8');
for (const f of SRC_FILES) {
  writeFileSync(join(OUT, 'src', f), readFileSync(join(ROOT, 'src', f)), 'utf8');
}
writeFileSync(join(OUT, '_headers'), HEADERS, 'utf8');

const files = ['index.html', 'cf-runtime.mjs', '_headers', ...SRC_FILES.map((f) => `src/${f}`)];
console.log('=== Cloudflare Pages 静态产物 ===');
for (const f of files) {
  const p = join(OUT, f);
  console.log(`${f.padEnd(24)} ${String(statSync(p).size).padStart(8)} bytes  ${sha(p)}`);
}
console.log(`\n产物目录：${OUT}`);
console.log(`共 ${files.length} 个文件；业务逻辑与 src/ 逐字节一致，页面已注入浏览器运行时引导层。`);
console.log('下一步：Cloudflare Pages 上传该目录，或 Git 集成设输出目录为 cloudflare（构建命令留空）。');
