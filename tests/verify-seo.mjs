/**
 * 用户版前端 SEO · 静态验证
 *
 * 验证核心口号「无事不登三宝殿」的 SEO 落地是否完整：
 *   meta / OG / Twitter / canonical / hreflang / 语义化 / noscript /
 *   JSON-LD（外部同源脚本注入，兼容严格 CSP）/ sitemap / robots。
 * 运行：node tests/verify-seo.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'cloudflare');
const SITE = join(ROOT, 'prod', 'site');
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  → ${detail}` : ''}`);
};
const read = (p) => readFileSync(p, 'utf8');
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

async function main() {
  console.log('=== SEO 落地静态验证（核心：无事不登三宝殿）===\n');

  const build = spawnSync(process.execPath, ['tools/build-cloudflare.mjs'], { cwd: ROOT, encoding: 'utf8' });
  check('VSX-01 构建成功', build.status === 0,
    `exit=${build.status}${build.status !== 0 ? ' stderr=' + String(build.stderr || '').slice(-300) : ''}`);

  const seoAssets = ['seo.js', 'sitemap.xml', 'robots.txt'];
  check('VSX-02 SEO 产物齐备', seoAssets.every((f) => existsSync(join(OUT, f))));
  check('VSX-03 SEO 产物与单一真源一致',
    seoAssets.every((f) => sha(join(OUT, f)) === sha(join(SITE, f))));

  const html = read(join(OUT, 'member.html'));
  check('VSX-04 核心口号进入 title / description / keywords',
    html.includes('无事不登三宝殿') &&
    /<title>[^<]*无事不登三宝殿/.test(html) &&
    /name="description"[^>]*无事不登三宝殿/.test(html) &&
    /name="keywords"/.test(html));
  check('VSX-05 canonical + hreflang 中英双语 + x-default',
    /rel="canonical" href="https:\/\/sambon\.net\/"/.test(html) &&
    /hreflang="zh-CN"/.test(html) && /hreflang="en"/.test(html) &&
    /hreflang="x-default"/.test(html));
  check('VSX-06 Open Graph + Twitter Card 齐备',
    /og:type/.test(html) && /og:title/.test(html) && /og:description/.test(html) &&
    /og:locale:alternate/.test(html) && /twitter:card/.test(html));
  check('VSX-06b OG/Twitter description 锚定核心口号（与 title 口径一致）',
    /property="og:description"[^>]*无事不登三宝殿/.test(html) &&
    /name="twitter:description"[^>]*无事不登三宝殿/.test(html));
  check('VSX-07 robots 指令为可索引（主入口去 noindex）',
    /name="robots" content="index, follow/.test(html) && !/name="robots" content="noindex/.test(html));
  check('VSX-08 语义化：h1 口号 / header / nav / main / footer',
    /<h1[^>]*>无事不登三宝殿<\/h1>/.test(html) &&
    /<header/.test(html) && /<nav/.test(html) && /<main/.test(html) && /<footer/.test(html));
  check('VSX-09 noscript 兜底含核心语义与 SBC 声明',
    /<noscript>/.test(html) && /无事不登三宝殿/.test(html) && /不可兑付/.test(html));
  check('VSX-10 theme-color + viewport + lang 属性',
    /name="theme-color"/.test(html) && /name="viewport"/.test(html) && /<html lang=/.test(html));
  check('VSX-11 结构化数据走同源外部脚本（兼容 CSP script-src self）',
    /<script src="\/seo\.js">/.test(html) && !/application\/ld\+json/.test(html));

  const seo = read(join(OUT, 'seo.js'));
  check('VSX-12 JSON-LD 由 seo.js 运行时注入 head',
    /type\s*=\s*'application\/ld\+json'/.test(seo) &&
    /createElement\('script'\)/.test(seo) && /appendChild/.test(seo));
  check('VSX-13 结构化数据含 Organization / WebSite / FAQPage + SearchAction',
    /'Organization'/.test(seo) && /'WebSite'/.test(seo) &&
    /'FAQPage'/.test(seo) && /'SearchAction'/.test(seo));
  // 去掉块注释后再判定（注释里出现了“不宣称已上线”这类合规说明，属正常文案）
  const seoCode = seo.replace(/\/\*[\s\S]*?\*\//g, '');
  check('VSX-14 结构化数据锚定核心口号且零 PII / 无虚假背书',
    seoCode.includes('无事不登三宝殿') &&
    !/网信办认证|官方认证|已上线|已通过备案/.test(seoCode) &&
    !/@[\w.]+@/.test(seoCode));
  check('VSX-15 JSON-LD 可解析（语法 + JSON.stringify 结构合法）',
    spawnSync(process.execPath, ['--check', join(OUT, 'seo.js')]).status === 0);

  const sm = read(join(OUT, 'sitemap.xml'));
  check('VSX-16 sitemap 含主入口 + 法务页 + hreflang 交替链接',
    /<loc>https:\/\/sambon\.net\/<\/loc>/.test(sm) &&
    /legal\.html/.test(sm) && /xhtml:link rel="alternate"/.test(sm));
  const rb = read(join(OUT, 'robots.txt'));
  check('VSX-17 robots 允许抓取 + 屏蔽 API/演示/操作台 + 指向 sitemap',
    /Allow: \//.test(rb) && /Disallow: \/api\//.test(rb) &&
    /Disallow: \/prod\.html/.test(rb) && /Sitemap: https:\/\/sambon\.net\/sitemap\.xml/.test(rb));
  check('VSX-18 robots 对搜索引擎与 AI 爬虫显式放行（AEO）',
    /User-agent: Googlebot/.test(rb) && /User-agent: GPTBot/.test(rb) && /User-agent: ClaudeBot/.test(rb));
  // 审计回归：具名 UA 段不继承 * 段，须各自显式屏蔽内部/演示页
  const uaBlocks = [...rb.matchAll(/User-agent:\s*(Googlebot|Bingbot|GPTBot|ClaudeBot)[\s\S]*?(?=\nUser-agent:|\nSitemap:|$)/g)].map((m) => m[0]);
  check('VSX-18b 每个具名 UA 段均显式屏蔽内部/演示页（不依赖 * 段继承）',
    uaBlocks.length === 4 && uaBlocks.every((b) =>
      /Disallow: \/api\//.test(b) && /Disallow: \/prod\.html/.test(b) &&
      /Disallow: \/index\.html/.test(b) && /Disallow: \/demo/.test(b)),
    `${uaBlocks.length} 个具名 UA 段`);

  // 审计回归：法务页 hreflang 落地一致性（?lang= 真正驱动语言 + x-default）
  const legalHtml = read(join(OUT, 'legal.html'));
  check('VSX-18c 法务页 index,follow + canonical + hreflang 三语（含 x-default）',
    /name="robots" content="index, follow/.test(legalHtml) &&
    /rel="canonical" href="https:\/\/sambon\.net\/legal\.html"/.test(legalHtml) &&
    /hreflang="zh-CN"/.test(legalHtml) && /hreflang="en"/.test(legalHtml) &&
    /hreflang="x-default"/.test(legalHtml));
  const legalJs = read(join(OUT, 'legal-lang.js'));
  check('VSX-18d 法务页 ?lang= 落地脚本存在且由 legal.html 同源加载（兼容 CSP）',
    /<script src="\/legal-lang\.js">/.test(legalHtml) &&
    /URLSearchParams\(location\.search\)\.get\('lang'\)/.test(legalJs) &&
    /doc-lang-en/.test(legalJs) && /doc-lang-zh/.test(legalJs) &&
    spawnSync(process.execPath, ['--check', join(OUT, 'legal-lang.js')]).status === 0);

  const headers = read(join(OUT, '_headers'));
  check('VSX-19 seo.js/legal-lang.js/sitemap/robots 声明正确 MIME',
    /\/seo\.js[\s\S]*?text\/javascript/.test(headers) &&
    /\/legal-lang\.js[\s\S]*?text\/javascript/.test(headers) &&
    /\/sitemap\.xml[\s\S]*?application\/xml/.test(headers) &&
    /\/robots\.txt[\s\S]*?text\/plain/.test(headers));
  check('VSX-20 主入口 CSP 未因 SEO 弱化（script-src self）',
    /\/\s*\n?[\s\S]*?script-src 'self'/.test(headers) && !/script-src[^;]*'unsafe-inline'/.test(headers));

  // 前端 lang 查询参数支持（hreflang 落地）
  const js = read(join(OUT, 'member.js'));
  check('VSX-21 前端支持 ?lang= 初始化语言（hreflang 落地）',
    /URLSearchParams\(location\.search\)\.get\('lang'\)/.test(js) && /og:locale/.test(js));

  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log(`\n=== 结果：PASS ${pass} / FAIL ${fail} / 共 ${results.length} 项 ===`);
  if (fail) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
