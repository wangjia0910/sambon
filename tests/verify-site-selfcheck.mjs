/**
 * 站点一键自检脚本的本地验证
 *
 * 目的：在真正部署前，用「浏览器运行时 mock」跑一遍 tools/site-selfcheck.mjs，
 *       证明它在线上页面能拿到 10/10 PASS，而不是把未经验证的脚本交给用户。
 *
 * 运行：node tests/verify-site-selfcheck.mjs
 * 退出码：全绿 = 0；任一 FAIL = 1
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'cloudflare');
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  → ${detail}` : ''}`);
};
const read = (p) => readFileSync(p, 'utf8');
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

async function main() {
  console.log('=== Cloudflare 站点自检脚本 · 本地验证 ===\n');

  const build = spawnSync(process.execPath, ['tools/build-cloudflare.mjs'], { cwd: ROOT, encoding: 'utf8' });
  check('VS-01 构建产物含 site-selfcheck.mjs 且 _headers 声明 JS MIME',
    build.status === 0 && existsSync(join(OUT, 'site-selfcheck.mjs')) &&
    read(join(OUT, '_headers')).includes('/site-selfcheck.mjs') &&
    read(join(OUT, '_headers')).includes('text/javascript'),
    `build_exit=${build.status}`);

  check('VS-02 产物自检脚本与 tools/ 源逐字节一致',
    sha(join(OUT, 'site-selfcheck.mjs')) === sha(join(ROOT, 'tools/site-selfcheck.mjs')));

  const script = read(join(OUT, 'site-selfcheck.mjs'));
  check('VS-03 自检脚本无 node: / Buffer 依赖（可在浏览器 ESM 直接 import）',
    !/from\s+['"]node:/.test(script) && !/\bBuffer\./.test(script) && !/\bprocess\./.test(script));

  // ── 在 mock 浏览器环境里真实执行自检脚本 ──────────────────────────────
  const html = read(join(OUT, 'index.html'));
  const pageText = html.replace(/<[^>]+>/g, ' ');
  let installed = null;
  globalThis.window = {
    fetch() { throw new Error('静态版不应发起真实后端 fetch'); },
    __installSambonRuntime(fn) { installed = fn; },
  };
  globalThis.document = { title: '三宝殿 · 初版闭环操作台（演示）', body: { innerText: pageText } };
  globalThis.location = { origin: 'local-mock' };

  const runtime = await import(pathToFileURL(join(OUT, 'cf-runtime.mjs')).href + '?selfcheck=1');
  check('VS-04 浏览器运行时注册成功', typeof installed === 'function' && typeof runtime.handleApiJob === 'function');

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input?.url || '');
    const method = init.method || 'GET';
    let body;
    try { body = init.body ? JSON.parse(init.body) : undefined; } catch { body = undefined; }
    const r = await runtime.handleApiJob({ method, url, body });
    return { status: r.status, json: async () => JSON.parse(r.text) };
  };

  const mod = await import(pathToFileURL(join(OUT, 'site-selfcheck.mjs')).href + '?selfcheck=1');
  let summary = null;
  try { summary = await mod.run(); }
  catch (e) { check('VS-05 自检脚本可在浏览器式环境完整执行', false, String(e.message || e)); }

  if (summary) {
    check('VS-05 自检脚本可在浏览器式环境完整执行', summary.total === 10, `返回 ${summary.total} 项检查`);
    const failed = summary.results.filter((r) => !r.ok);
    check('VS-06 线上等价环境 10 项自检全绿',
      summary.pass === 10 && summary.fail === 0,
      failed.length ? `失败项：${failed.map((r) => r.id + ' ' + r.detail).join(' | ')}` : 'PASS 10 / FAIL 0');
    check('VS-07 关键业务断言在自检脚本中真实生效（非占位）',
      summary.results.some((r) => r.id === 'S-05' && r.ok && r.detail.includes('"bounty":200')) &&
      summary.results.some((r) => r.id === 'S-08' && r.ok && r.detail.includes('[已脱敏]')),
      'S-05 结算数值 + S-08 脱敏预览');
  }

  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log(`\n=== 结果：PASS ${pass} / FAIL ${fail} / 共 ${results.length} 项 ===`);
  if (fail) console.log('失败项：' + results.filter((r) => !r.ok).map((r) => r.name).join(' | '));
  console.log('结论：仅证明「一键自检脚本」在浏览器式运行时可用；不构成上线许可（V1–V8 未触发）。');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('verify-site-selfcheck 异常：', e); process.exit(1); });
