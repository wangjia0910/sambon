/**
 * 《三宝殿》线上部署核验（零第三方依赖，Node >= 18 全局 fetch）
 *
 * 用途：部署完成后对真实站点做只读技术核验，生成可作为 E-01 / E-02 证据材料的报告。
 * 边界：本脚本 **不核销任何外部闸门**，不读写 ops/readiness.json，
 *       不签署上线许可，不构成法律意见。证据仍需真人填写 verified/by/at/evidence。
 *
 * 用法：
 *   node tests/verify-deployment.mjs
 *   node tests/verify-deployment.mjs --url=https://sanbao-temple.pages.dev
 *   node tests/verify-deployment.mjs --strict     # 出现 FAIL 或 WARN 时退出码 1（供 CI）
 *
 * 产物：ops/deployment-verification.json（不入库，.gitignore 排除）
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const urlOpt = argv.find((a) => a.startsWith('--url='));
const BASE = String(urlOpt ? urlOpt.slice(6) : (process.env.SAMBON_URL || 'https://sambon.net')).replace(/\/+$/, '');
const STRICT = argv.includes('--strict');
const EXPECT_SCHEMA = 'sambon-prod-schema-v2.0';

const checks = [];

function record(id, name, status, detail) {
  checks.push({ id, name, status, detail });
  console.log(`  ${status.padEnd(4)} ${id} ${name} — ${detail}`);
}

/** 单次只读探测；静态页不是 JSON 时 json 为 null */
async function probe(path, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(BASE + path, { ...opts, signal: ctrl.signal });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* 静态页 */ }
    return { status: r.status, text, json, contentType: r.headers.get('content-type') || '' };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log('=== 三宝殿 · 线上部署核验（只读） ===');
  console.log(`目标：${BASE}`);
  console.log(`时间：${new Date().toISOString()}\n`);

  let health;
  try {
    health = await probe('/api/health');
  } catch (e) {
    console.error(`健康接口不可达：${e.message}`);
    console.error('请确认自定义域 / TLS / Pages 部署状态，或改用 --url 指定 pages.dev 域名。');
    process.exitCode = 1;
    return;
  }

  const hd = health.json?.data || {};
  record('D-01', '健康接口可达', health.status === 200 && health.json?.ok === true ? 'PASS' : 'FAIL',
    `http=${health.status}, ok=${health.json?.ok}`);
  record('D-02', 'V3 完全体版本已部署', hd.schema_version === EXPECT_SCHEMA ? 'PASS' : 'FAIL',
    `schema_version=${hd.schema_version}, version=${hd.version}`);
  record('D-03', 'D1 持久化已生效', hd.mode === 'production' && hd.db === 'd1' ? 'PASS' : 'WARN',
    `mode=${hd.mode}, db=${hd.db}, status=${hd.status}`);
  record('D-04', '九项代码能力齐备',
    ['i18n', 'concurrent_cas', 'notifications', 'llm_adapter', 'cron', 'risk', 'backup', 'anchor', 'email_verification']
      .every((k) => hd.features?.[k] === true) ? 'PASS' : 'FAIL',
    `features=${Object.keys(hd.features || {}).length}`);

  const comps = hd.components || {};
  const truthful = ['llm', 'notify'].every((k) => comps[k] && comps[k].degraded === !comps[k].configured);
  record('D-05', '组件降级如实上报', truthful ? 'PASS' : 'FAIL',
    `llm=${comps.llm?.configured ? 'configured' : 'degraded'}, notify=${comps.notify?.configured ? 'configured' : 'queue_only'}`);
  record('D-06', '大模型不参与决策', comps.llm?.model_decision === null ? 'PASS' : 'FAIL',
    `model_decision=${comps.llm?.model_decision}`);

  const cfg = await probe('/api/config');
  const cd = cfg.json?.data || {};
  record('D-07', '配置端点可达', cfg.status === 200 && cfg.json?.ok === true ? 'PASS' : 'FAIL', `http=${cfg.status}`);
  record('D-08', '八条 SBC 红线声明', Array.isArray(cd.red_lines) && cd.red_lines.length === 8 ? 'PASS' : 'FAIL',
    `count=${cd.red_lines?.length}`);
  record('D-09', '服务端强制与账号级开关',
    cd.enforcement === 'server_side' && cd.account_level_preference === true ? 'PASS' : 'FAIL',
    `enforcement=${cd.enforcement}, account_level=${cd.account_level_preference}`);
  record('D-10', '海外默认英文双语',
    Array.isArray(cd.locales) && cd.locales.includes('en') && cd.default_locale === 'en' ? 'PASS' : 'FAIL',
    `locales=${JSON.stringify(cd.locales)}, default=${cd.default_locale}`);
  record('D-11', 'AI 透明度英文说明',
    typeof cd.ai_disclosure?.en === 'string' && cd.ai_disclosure.en.length > 40 ? 'PASS' : 'FAIL', 'ai_disclosure.en');
  record('D-12', 'SBC 非资产声明',
    /不可兑付/.test(cd.sbc_notice || '') && /不可转让/.test(cd.sbc_notice || '') ? 'PASS' : 'FAIL', 'sbc_notice');

  const root = await probe('/');
  record('D-13', '根路径为生产操作台',
    root.status === 200 && /app\.js/.test(root.text) && /styles\.css/.test(root.text) ? 'PASS' : 'FAIL',
    `http=${root.status}, bytes=${root.text.length}`);
  const legal = await probe('/legal.html');
  record('D-14', '双语法务页面',
    legal.status === 200 && /lang="en"/.test(legal.text) && /[\u4e00-\u9fa5]/.test(legal.text) ? 'PASS' : 'FAIL',
    `http=${legal.status}`);
  const appjs = await probe('/app.js');
  record('D-15', 'ESM 资源 MIME 正确',
    appjs.status === 200 && /javascript/.test(appjs.contentType) ? 'PASS' : 'FAIL',
    `content-type=${appjs.contentType}`);
  const demo = await probe('/demo.html');
  record('D-16', 'L0 演示台保留', demo.status === 200 ? 'PASS' : 'FAIL', `http=${demo.status}`);

  // 演示模式会先返回 503 PERSISTENCE_NOT_CONFIGURED，生产模式返回 404；两者都证明端点未实现
  const red = await probe('/api/sbc/transfer', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  record('D-17', 'SBC 资产化端点未实现', [404, 503].includes(red.status) ? 'PASS' : 'FAIL', `http=${red.status}`);
  const me = await probe('/api/auth/me');
  record('D-18', '未登录受保护端点拒绝', [401, 503].includes(me.status) ? 'PASS' : 'FAIL', `http=${me.status}`);
  const write = await probe('/api/tasks', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  record('D-19', '未认证写操作不得成功', [400, 401, 403, 409, 503].includes(write.status) ? 'PASS' : 'FAIL',
    `http=${write.status}`);

  const pass = checks.filter((c) => c.status === 'PASS').length;
  const warn = checks.filter((c) => c.status === 'WARN').length;
  const fail = checks.filter((c) => c.status === 'FAIL').length;

  const report = {
    generated_at: new Date().toISOString(),
    base_url: BASE,
    expected_commit: 'dece57e',
    expected_schema_version: EXPECT_SCHEMA,
    live: {
      mode: hd.mode, db: hd.db, status: hd.status,
      service: hd.service, version: hd.version, schema_version: hd.schema_version,
      time: hd.time, features: hd.features || {}, components: comps,
    },
    checks,
    summary: { pass, warn, fail, total: checks.length },
    evidence_hints: {
      'E-01': {
        auto_observable: true,
        observation: `GET ${BASE}/api/health → mode=${hd.mode}, db=${hd.db}, schema_version=${hd.schema_version}`,
        note: '仅当 mode=production 且 db=d1 时本项具备技术证据；仍需真人填写 verified/by/at/evidence。',
      },
      'E-02': {
        auto_observable: true,
        observation: `GET ${BASE}/api/health 返回 HTTP ${health.status}，TLS 握手与自定义域解析成功`,
        note: 'DNS / 证书 / Pages 自定义域状态截图仍须人工归档。',
      },
    },
    disclaimer: '本报告只做技术核验，不核销外部闸门、不构成正式运营许可或法律意见（CONTRACT §11 D-14、docs/13 §5）。',
  };

  const opsDir = resolve(ROOT, 'ops');
  if (!existsSync(opsDir)) mkdirSync(opsDir, { recursive: true });
  writeFileSync(resolve(opsDir, 'deployment-verification.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`\n=== 汇总：PASS ${pass} / WARN ${warn} / FAIL ${fail}（共 ${checks.length} 项）===`);
  console.log(`运行模式：${hd.mode} / ${hd.db}`);
  console.log(`核验报告：ops/deployment-verification.json（不入库）`);
  if (fail > 0) {
    console.log('结论：部署核验未通过，请按 FAIL 项排查。');
  } else if (warn > 0) {
    console.log('结论：代码部署已生效，但 D1 未绑定，站点为只读演示模式，不可运营。');
  } else {
    console.log('结论：代码部署与 D1 持久化均已生效；正式运营仍须核销 20 项外部证据。');
  }
  console.log('提示：本脚本不替人签字。证据请填入 ops/readiness.json（node tests/readiness-check.mjs --init）。');

  if (fail > 0 || (STRICT && warn > 0)) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`核验脚本异常：${e.message}`);
  process.exitCode = 1;
});
