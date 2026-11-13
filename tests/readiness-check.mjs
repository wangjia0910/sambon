/**
 * 《三宝殿》V3 · 正式运营就绪门禁（零第三方依赖）
 *
 * 设计原则：**代码能力可以自动核销，真实世界的动作不能**。
 *   ① CODE_CHECKS：只读静态扫描，验证代码侧能力确实落地、红线未被突破；
 *   ② EXTERNAL_ITEMS：必须由真人在真实世界完成并留下证据，读取
 *      `ops/readiness.json` 逐项核销。每项必须同时有 verified/by/at/evidence，
 *      缺一即视为 UNVERIFIED。脚本**绝不会因为代码存在就替人签字**。
 *
 * 用法：
 *   node tests/readiness-check.mjs              # 打印门禁报告，退出码恒 0
 *   node tests/readiness-check.mjs --strict     # NOT READY 时退出码 1（供 CI 使用）
 *   node tests/readiness-check.mjs --init       # 从模板生成 ops/readiness.json
 *
 * 证据文件 ops/readiness.json 不入库（.gitignore 排除），模板见
 * ops/readiness.template.json；复评触发条件见 docs/11 §1.3。
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => (existsSync(resolve(ROOT, p)) ? readFileSync(resolve(ROOT, p), 'utf8') : '');
const strict = process.argv.includes('--strict');
const init = process.argv.includes('--init');

const EVIDENCE_PATH = 'ops/readiness.json';
const TEMPLATE_PATH = 'ops/readiness.template.json';

/** 代码侧能力：只读扫描，命中即核销；任何一处缺失都会让「完全体」不成立 */
const CODE_CHECKS = [
  ['C-01', 'D1 表结构 v2.0 与老库幂等补列', () =>
    read('prod/lib/schema.js').includes("sambon-prod-schema-v2.0")
    && read('prod/lib/schema.js').includes('COLUMN_MIGRATIONS')
    && read('prod/lib/db.js').includes('duplicate column')],
  ['C-02', '8 条 SBC 资产化红线未实现', () => {
    const api = read('prod/lib/api.js');
    // 这些路径在 configData.red_lines 中作为「声明」出现是正常的；只检查 ROUTES 段不得注册
    const seg = api.slice(api.indexOf('const ROUTES = ['), api.indexOf('async function readBody'));
    return seg.length > 100 && api.includes('red_lines: [')
      && ['/api/sbc/transfer', '/api/sbc/trade', '/api/sbc/redeem', '/api/sbc/withdraw',
        '/api/sbc/exchange', '/api/sbc/yield', '/api/sbc/market', '/api/wallet/cashout']
        .every((p) => !seg.includes(p));
  }],
  ['C-03', '无内置默认账号 / 口令', () =>
    !/default\s*(admin|password)|password\s*:\s*['"]admin['"]/i.test(read('prod/lib/api.js'))],
  ['C-04', 'LLM 适配层可配置降级且模型不决策', () =>
    read('prod/lib/llm.js').includes('LLM_API_URL')
    && read('prod/lib/llm.js').includes('model_decision')
    && read('prod/lib/api.js').includes('llm.extractStructure')],
  ['C-05', '通知通道 queue_only 降级不伪造已发送', () =>
    read('prod/lib/notify.js').includes('NOTIFY_WEBHOOK_URL')
    && read('prod/lib/notify.js').includes('degraded: true')
    && read('prod/lib/notify.js').includes('sent: 0')],
  ['C-06', '定时任务只出人工确认工单、不自动结算', () =>
    read('prod/lib/jobs.js').includes('AUTO_VERIFY_DUE')
    && read('prod/lib/jobs.js').includes('DISPUTE_CLOSE_DUE')
    && !/settleTask|computeQualityBonus|CreditTransferred/.test(read('prod/lib/jobs.js'))],
  ['C-07', '并发抢单 version CAS', () =>
    read('prod/lib/api.js').includes("'CONCURRENT_CONFLICT'")
    && read('prod/lib/api.js').includes('AND version = ?')],
  ['C-08', '人工闸门与审计留痕', () =>
    read('prod/lib/api.js').includes("'TASK_REVIEW_MANUAL'")
    && read('prod/lib/api.js').includes("'DISPUTE_RESOLVED_MANUAL'")
    && read('prod/lib/api.js').includes('audit_log')],
  ['C-09', 'GDPR 导出 / 擦除与 Cookie 同意', () =>
    read('prod/lib/api.js').includes('hExport')
    && read('prod/lib/api.js').includes('ACCOUNT_ERASED')
    && read('prod/site/app.js').includes('/api/consents')],
  ['C-10', '面向海外默认英文的双语界面', () =>
    read('prod/site/app.js').includes("LOCALE_KEY = 'sambon.locale'")
    && read('prod/site/app.js').includes("startsWith('zh')")
    && /lang="en"/.test(read('prod/site/legal.html'))],
  ['C-11', '安全响应头与 Function 调用范围收敛', () =>
    read('tools/build-cloudflare.mjs').includes("Content-Security-Policy")
    && JSON.parse(read('cloudflare/_routes.json')).include.join(',') === '/api/*'],
  ['C-12', 'PII 脱敏与事件 payload 白名单', () =>
    read('prod/lib/api.js').includes('EVENT_KEY_WHITELIST')
    && read('prod/lib/api.js').includes('sanitizeSubmissionText')],
  ['C-13', '未绑定 D1 时明确降级、不伪装生产可用', () =>
    read('prod/lib/api.js').includes('PERSISTENCE_NOT_CONFIGURED')
    && read('prod/lib/api.js').includes("db ? 'production' : 'demo'")],
  ['C-14', '全套回归脚本齐备（6 套）', () =>
    ['smoke', 'verify-local', 'verify-cloudflare', 'verify-site-selfcheck',
      'verify-production', 'predeploy-check'].every((t) => read(`tests/${t}.mjs`).length > 100)],
  ['C-15', '生产回归覆盖 V3 新增能力（≥ 110 项）', () =>
    (read('tests/verify-production.mjs').match(/check\('P-\d+/g) || []).length >= 110],
  ['C-16', '契约 D-14 与本文档已登记', () =>
    read('CONTRACT.md').includes('| D-14 |') && read('docs/13-完全体能力与运营就绪.md').length > 1000],
];

/**
 * 外部闸门：**代码无法代做**。每项都要求一份可追溯的人工证据。
 * 与 docs/07 的 29 项、docs/11 的 V2-O 六组、V1–V8 一票否决清单对应但不重复计数，
 * 本表是「运营准入的证据清单」，不替代法务核销表。
 */
const EXTERNAL_ITEMS = [
  ['E-01', '基础设施', 'D1 数据库已绑定并生效', 'Pages 项目 Settings → Functions 绑定 DB（Production + Preview）后重新部署；GET /api/health 返回 mode=production / db=d1 的实际响应'],
  ['E-02', '基础设施', '自定义域与 TLS 生效', 'sambon.net 的 DNS / 证书 / Pages 自定义域状态截图与验证日期'],
  ['E-03', '基础设施', '生产环境变量已配置且密钥已轮换', 'ADMIN_BOOTSTRAP_TOKEN 用后移除、CRON_SECRET / LLM_API_KEY / NOTIFY_WEBHOOK_SECRET 等密文配置清单；GitHub PAT 撤销记录'],
  ['E-04', '基础设施', '外部定时任务调度器已上线', 'Cloudflare Worker Cron / GitHub Actions / 其他调度器对 /api/admin/cron 的定时调用配置与连续 7 天执行日志'],
  ['E-05', '基础设施', '备份、留存与 Time Travel 演练', 'D1 备份策略配置、一次真实恢复演练记录、留存期限与加密存储说明'],
  ['E-06', '合规', 'V2-O 六组全部核销', 'docs/11 §2 六组逐项证据（地域与协议、隐私与 Cookie、跨境传输、自动化决策、SBC 非资产与税务、未成年人与内容治理）'],
  ['E-07', '合规', '目标市场执业律师书面复核意见', 'GDPR/UK GDPR、ePrivacy、CCPA/CPRA、COPPA、DSA Art.27、EU AI Act Art.50、GDPR Art.22 的书面意见与签署日期'],
  ['E-08', '合规', 'Cloudflare DPA + SCC / TIA 已签署', 'DPA 版本、SCC 签署件、传输影响评估 TIA、EU-US DPF 回退方案'],
  ['E-09', '合规', '隐私政策 / ToS / AUP 法务定稿', 'legal.html 中英双语法务审定稿、版本号、发布日期与同意留痕方案'],
  ['E-10', '合规', 'PIPL 第 3 条适用性评估', '运营 / 开发 / 客服 / 数据处理实际发生地的书面判定；若涉及境内，数据出境合规结论'],
  ['E-11', '合规', '未成年人年龄核验（V8）', '真实年龄核验方案与供应商评估，或明确限定 18+ 且可执行的技术与流程证据'],
  ['E-12', '合规', 'SBC 非资产与支付税务书面结论', 'SBC 不构成加密资产 / 支付工具 / 收益承诺的法律意见；DAC7 / 1099-K / VAT 适用性判定'],
  ['E-13', '运营', '真实通知 / 邮件通道已接通', 'NOTIFY_WEBHOOK_URL 指向的真实邮件或推送服务商、合同与送达率验证记录（queue_only 不算核销）'],
  ['E-14', '运营', 'WAF / 风控名单与滥用处置流程', 'Cloudflare WAF 规则、风控名单、滥用举报 SLA 与制裁名单筛查流程'],
  ['E-15', '运营', '安全事件响应与 DPO / 代表指定', '事件响应预案、72 小时通报流程、DPO 或欧盟代表指定文件、联系方式可用性验证'],
  ['E-16', '运营', '渗透测试 / 压测 / 灾备演练', '第三方或内部渗透测试报告、压测结论（P95 / 错误率）、灾备切换演练记录'],
  ['E-17', '运营', '人工闸门演练与值班安排', '审核 / 推送 / 验收 / 争议裁定 / 风控处置的人工确认演练记录与值班表'],
  ['E-18', '准入', 'docs/07 全部 29 项与 G1–G7 核销', 'docs/07 勾选证据包；G1–G7 数值达标记录；V1–V8 一票否决清单逐项书面结论'],
  ['E-19', '准入', 'L1 灰度结果复核', '单一海外区域灰度数据、回滚触发线监测记录、无重大事故说明'],
  ['E-20', '准入', '正式上线批准签发', '有权签字人书面 Go 决定、日期、批准范围与对外表述口径'],
];

function loadEvidence() {
  const p = resolve(ROOT, EVIDENCE_PATH);
  if (!existsSync(p)) return {};
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    return j && typeof j.items === 'object' && j.items ? j.items : {};
  } catch {
    return {};
  }
}

function verified(entry) {
  if (!entry || entry.verified !== true) return false;
  return ['by', 'at', 'evidence'].every((k) => typeof entry[k] === 'string' && entry[k].trim().length > 0);
}

if (init) {
  const dir = resolve(ROOT, 'ops');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const target = resolve(ROOT, EVIDENCE_PATH);
  if (existsSync(target)) {
    console.log(`已存在，不覆盖：${EVIDENCE_PATH}`);
  } else {
    const tpl = existsSync(resolve(ROOT, TEMPLATE_PATH))
      ? readFileSync(resolve(ROOT, TEMPLATE_PATH), 'utf8')
      : JSON.stringify({ version: 'v3.0', note: '逐项填写后本文件才生效', items: {} }, null, 2) + '\n';
    writeFileSync(target, tpl, 'utf8');
    console.log(`已生成证据模板：${EVIDENCE_PATH}（不入库）`);
  }
  process.exit(0);
}

console.log('=== 三宝殿 · 正式运营就绪门禁（V3 / D-14）===\n');

console.log('[A] 代码能力（自动静态核销）');
let codePass = 0;
for (const [id, name, fn] of CODE_CHECKS) {
  let okFlag = false;
  try { okFlag = Boolean(fn()); } catch { okFlag = false; }
  if (okFlag) codePass += 1;
  console.log(`  ${okFlag ? 'PASS' : 'FAIL'}  ${id} ${name}`);
}

console.log('\n[B] 外部闸门（必须人工提供证据，代码不得代签）');
const evidence = loadEvidence();
const pending = [];
let extPass = 0;
for (const [id, group, title] of EXTERNAL_ITEMS) {
  const okFlag = verified(evidence[id]);
  if (okFlag) extPass += 1; else pending.push(`${id} [${group}] ${title}`);
  console.log(`  ${okFlag ? 'VERIFIED  ' : 'UNVERIFIED'} ${id} [${group}] ${title}`);
}

const ready = codePass === CODE_CHECKS.length && extPass === EXTERNAL_ITEMS.length;
console.log(`\n=== 核销汇总 ===`);
console.log(`代码能力：${codePass}/${CODE_CHECKS.length}`);
console.log(`外部闸门：${extPass}/${EXTERNAL_ITEMS.length}`);
console.log(`证据文件：${EVIDENCE_PATH} ${existsSync(resolve(ROOT, EVIDENCE_PATH)) ? '（已存在）' : '（不存在，全部未核销）'}`);
console.log(`\n结论：${ready ? 'READY — 可提交有权签字人做最终 Go 决定' : 'NOT READY — 代码完全体 ≠ 正式运营许可'}`);
if (!ready) {
  console.log(`\n未核销 ${pending.length} 项外部动作：`);
  for (const p of pending) console.log(`  - ${p}`);
  console.log(`\n操作：node tests/readiness-check.mjs --init 生成 ${EVIDENCE_PATH}，`);
  console.log('      逐项填入 verified / by / at / evidence 后复跑。缺任一字段不计核销。');
  console.log('      口径依据：docs/13 §5、docs/07、docs/11、CONTRACT §11 D-14。');
}
console.log('\n提示：本门禁只做证据完整性与代码红线检查，不构成法律意见，不替代法务书面复核。');

if (strict && !ready) process.exitCode = 1;
