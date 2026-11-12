/**
 * 《三宝殿》上线准入自检（L0 演示预览 / L1 灰度 / L2 正式上线）
 *
 * 定位：docs/08-上线部署指导.md §6 的可复跑门禁。
 * 原则：只读取仓库现状与既有测试的真实结果，不预置结论、不修改任何文件；
 *       L1/L2 结论恒由 docs/07 清单勾选状态推导，禁止通过改脚本让 No-Go 变 Go。
 * 运行：node tests/predeploy-check.mjs   （零第三方依赖，Node 22+）
 * 退出码：L0 准入通过 = 0；任一 FAIL = 1
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  → ${detail}` : ''}`);
};

function runNode(file, args = []) {
  const r = spawnSync(process.execPath, [file, ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024,
  });
  return { code: r.status ?? -1, out: `${r.stdout || ''}${r.stderr || ''}` };
}

async function freePort() {
  return new Promise((ok, bad) => {
    const s = createServer();
    s.once('error', bad);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => ok(p));
    });
  });
}

async function main() {
  console.log('=== 《三宝殿》上线准入自检（docs/08 §6）===\n');

  // ---- C-01 语法 ----
  const mjs = [
    'src/domain.mjs', 'src/store.mjs', 'src/server.mjs', 'src/hash.mjs',
    'tests/smoke.mjs', 'tests/verify-local.mjs', 'tests/verify-cloudflare.mjs', 'tests/predeploy-check.mjs',
    'tools/build-cloudflare.mjs', 'tools/cf-runtime.mjs', 'cloudflare/cf-runtime.mjs',
  ];
  const badSyntax = mjs.filter((f) => !existsSync(resolve(ROOT, f)) || runNode('--check', [f]).code !== 0);
  check('C-01 全量 .mjs 语法检查（含 Cloudflare 产物与工具链）', badSyntax.length === 0,
    badSyntax.length ? `失败: ${badSyntax.join(', ')}` : `${mjs.length}/${mjs.length} 通过`);

  // ---- C-02 / C-03 两套既有测试（不复用实现，直接复跑取真实结果）----
  const smoke = runNode(resolve(ROOT, 'tests/smoke.mjs'));
  const smokePass = (smoke.out.match(/PASS\s+(\d+)/) || [])[1];
  const smokeFail = (smoke.out.match(/FAIL\s+(\d+)/) || [])[1];
  check('C-02 研发自检 tests/smoke.mjs', smoke.code === 0 && !/^FAIL\s/m.test(smoke.out),
    `exit=${smoke.code} PASS=${smokePass || '?'} FAIL=${smokeFail || '?'}`);

  const verify = runNode(resolve(ROOT, 'tests/verify-local.mjs'));
  const verifyPass = (verify.out.match(/PASS\s+(\d+)/) || [])[1];
  const verifyFail = (verify.out.match(/FAIL\s+(\d+)/) || [])[1];
  check('C-03 独立验证 tests/verify-local.mjs', verify.code === 0 && !/^FAIL\s/m.test(verify.out),
    `exit=${verify.code} PASS=${verifyPass || '?'} FAIL=${verifyFail || '?'}`);

  // ---- C-04 零第三方依赖 ----
  const srcFiles = readdirSync(resolve(ROOT, 'src')).filter((f) => f.endsWith('.mjs'));
  const externals = [];
  for (const f of srcFiles) {
    for (const line of read(`src/${f}`).split('\n')) {
      const m = line.match(/^\s*import\s+.*?\s+from\s+['"]([^'"]+)['"]/);
      if (m && !m[1].startsWith('node:') && !m[1].startsWith('.')) externals.push(`${f}:${m[1]}`);
    }
  }
  let pkgDeps = 0;
  if (existsSync(resolve(ROOT, 'package.json'))) {
    try { pkgDeps = Object.keys(JSON.parse(read('package.json')).dependencies || {}).length; } catch { pkgDeps = -1; }
  }
  check('C-04 零第三方依赖（仅 node: 内置模块）', externals.length === 0 && pkgDeps === 0 && !existsSync(resolve(ROOT, 'node_modules')),
    externals.length ? externals.join(', ') : `src ${srcFiles.length} 个文件 / package.json 依赖 ${pkgDeps}`);

  // ---- C-05 ~ C-08 真实起服务核验 ----
  const port = await freePort();
  const child = spawn(process.execPath, ['src/server.mjs'], {
    cwd: ROOT, env: { ...process.env, PORT: String(port) }, stdio: 'ignore',
  });
  const BASE = `http://127.0.0.1:${port}`;
  const call = async (method, path, body) => {
    const r = await fetch(BASE + path, {
      method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, json: await r.json().catch(() => ({})) };
  };
  try {
    let ready = false;
    for (let i = 0; i < 40 && !ready; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      try { ready = (await fetch(`${BASE}/api/health`)).ok; } catch { /* 未就绪 */ }
    }
    check('C-05 PORT 可覆盖、服务可起、/api/health 可达', ready, `随机端口 ${port}`);
    if (!ready) throw new Error('服务未就绪，后续 HTTP 检查跳过');

    const page = await call('GET', '/');
    const html = read('web/index.html');
    check('C-06 单端口同时托管静态页与 API', page.status === 200, `GET / = ${page.status}`);

    const forbidden = [
      '/api/sbc/transfer', '/api/sbc/redeem', '/api/sbc/exchange', '/api/sbc/withdraw',
      '/api/sbc/trade', '/api/sbc/cash', '/api/sbc/market', '/api/wallet/transfer',
    ];
    const codes = await Promise.all(forbidden.map((p) => call('POST', p, {}).then((r) => r.status)));
    check('C-07 转让 / 交易 / 兑换 / 收益类接口全部不存在', codes.every((c) => c === 404),
      `${forbidden.length} 个路径 → ${[...new Set(codes)].join(',')}`);

    const cfg = (await call('GET', '/api/config')).json;
    const cfgText = JSON.stringify(cfg);
    check('C-08 /api/config 暴露权重版本、算法降级与个性化开关',
      /v1\.0/.test(cfgText) && /degraded/.test(cfgText) && /personalized/.test(cfgText),
      `weight_version=${cfg?.data?.weight_version ?? cfg?.weight_version ?? '见响应'}`);
  } catch (e) {
    check('C-05~C-08 HTTP 核验', false, String(e.message || e));
  } finally {
    child.kill();
  }

  // ---- C-09 演示声明与 PII 采集红线（静态扫描）----
  const html = read('web/index.html');
  const declares = html.includes('演示') && html.includes('虚构');
  const noPiiInput = !/type=["']tel["']/i.test(html) && !/id=["'](phone|mobile|idcard|id_card|id_number)["']/i.test(html);
  const domain = read('src/domain.mjs');
  const store = read('src/store.mjs');
  check('C-09 页面「演示 / 虚构」声明 + 无真实 PII 采集 + 脱敏与白名单存在',
    declares && noPiiInput && domain.includes('sanitizeSubmissionText') && store.includes('sanitizePayload'),
    `声明=${declares} 无PII字段=${noPiiInput}`);

  // ---- C-10 合规状态标注未被误改 ----
  const readme = read('README.md');
  const compliance = read('COMPLIANCE.md');
  const contract = read('CONTRACT.md');
  check('C-10 文档仍如实标注「不构成上线 / 未上线不触发」且契约登记完整',
    /不构成|不等于发布或上线/.test(readme + compliance) && /未上线|不触发/.test(readme + compliance + contract) &&
    contract.includes('§11') && contract.includes('§4'),
    'README / COMPLIANCE / CONTRACT v0.2');

  // ---- C-11 交付文件齐备 ----
  const required = ['README.md', 'CONTRACT.md', 'COMPLIANCE.md', 'docs/07-上线检查清单.md',
    'docs/08-上线部署指导.md', 'src/server.mjs', 'web/index.html',
    'tests/smoke.mjs', 'tests/verify-local.mjs'];
  const missing = required.filter((f) => !existsSync(resolve(ROOT, f)));
  check('C-11 上线相关交付文件齐备', missing.length === 0, missing.length ? `缺少 ${missing.join(', ')}` : `${required.length} 个关键文件在位`);

  // ---- C-12 Cloudflare 静态 Web 版（会自动重建产物并做跨实现比对）----
  const cf = runNode(resolve(ROOT, 'tests/verify-cloudflare.mjs'));
  check('C-12 Cloudflare 静态版跨实现一致性（14 项断言）',
    cf.code === 0 && /PASS 14\s*\/\s*FAIL 0/.test(cf.out) && !/^FAIL\s/m.test(cf.out),
    `exit=${cf.code} ${(cf.out.match(/PASS \d+ \/ FAIL \d+ \/ 共 \d+ 项/) || ['结果未解析'])[0]}`);

  // ---- L1 / L2 判定：只读 docs/07 真实勾选状态 ----
  const checklist = read('docs/07-上线检查清单.md');
  const checked = (checklist.match(/^\s*-\s*\[[xX]\]/gm) || []).length;
  const total = (checklist.match(/^\s*-\s*\[[ xX]\]/gm) || []).length;
  const l1Go = total > 0 && checked === total;

  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log('\n=== 准入结论 ===');
  console.log(`L0 在线演示预览：${fail === 0 ? '通过（可发布/更新演示链接）' : `不通过（${fail} 项 FAIL）`}  PASS ${pass} / ${results.length}`);
  console.log(`L1 灰度 / L2 正式上线：${l1Go ? '需人工复核证据后判定' : 'No-Go'}  docs/07 已勾选 ${checked}/${total} 项；V1–V8 未完成，G6 不通过`);
  if (fail) console.log('失败项：' + results.filter((r) => !r.ok).map((r) => r.name).join(' | '));
  console.log('提示：L0 通过 ≠ L1/L2 通过；结论以法务书面意见与备案回执为准（docs/08 §1）。');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('predeploy-check 异常：', e); process.exit(1); });
