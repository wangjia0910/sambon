/**
 * 用户版悬赏平台前端 · 构建产物静态验证
 *
 * 目的：把用户版前端（member.*）的关键不变量固化为可复跑回归——
 *       主入口指向、三件套齐备且同源、API 调用覆盖、双语、SBC 红线、
 *       人工闸门、CSP/同源约束、零第三方依赖。不启动服务、不发真实请求。
 *
 * 运行：node tests/verify-member.mjs
 * 退出码：全绿 = 0；任一 FAIL = 1
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  console.log('=== 用户版悬赏平台前端 · 构建产物验证 ===\n');

  // 先重建，确保验证的是最新产物
  const build = spawnSync(process.execPath, ['tools/build-cloudflare.mjs'], { cwd: ROOT, encoding: 'utf8' });
  check('VM-01 构建成功', build.status === 0, `exit=${build.status}`);

  const srcFiles = ['member.html', 'member.js', 'member.css'];
  const prodFiles = srcFiles.map((f) => join(ROOT, 'prod', 'site', f));
  const outFiles = srcFiles.map((f) => join(OUT, f));
  check('VM-02 单一真源 prod/site/member.* 齐备', prodFiles.every((p) => existsSync(p)));
  check('VM-03 产物 cloudflare/member.* 齐备', outFiles.every((p) => existsSync(p)));
  check('VM-04 产物与单一真源逐字节一致',
    srcFiles.every((f) => sha(join(OUT, f)) === sha(join(ROOT, 'prod', 'site', f))));

  const redirects = read(join(OUT, '_redirects'));
  check('VM-05 根路径 / 重写到用户版 /member', /^\/\s+\/member\s+200/m.test(redirects));
  check('VM-06 操作台 /prod 与 L0 /index 入口保留',
    /\/prod\s+200/.test(redirects) && /\/index\s+200/.test(redirects));

  const headers = read(join(OUT, '_headers'));
  check('VM-07 member.js / member.css 声明正确 MIME',
    /\/member\.js[\s\S]*?text\/javascript/.test(headers) && /\/member\.css[\s\S]*?text\/css/.test(headers));
  check('VM-08 member.html 套用同源 CSP（禁止内联脚本 / 第三方）',
    /\/member\.html[\s\S]*?script-src 'self'/.test(headers) && /connect-src 'self'/.test(headers));

  const html = read(join(OUT, 'member.html'));
  check('VM-09 页面仅加载同源 member.js / member.css，无内联脚本与 CDN',
    /src="\/member\.js"/.test(html) && /href="\/member\.css"/.test(html) &&
    !/<script(?![^>]*src=)[^>]*>/.test(html) && !/https?:\/\/(cdn|unpkg|jsdelivr)/i.test(html));
  check('VM-10 默认英文 + 含中文切换入口 + 法务/账本声明',
    /lang="en"/.test(html) && /data-action="toggle-locale"/.test(html) && /legal\.html/.test(html));

  const js = read(join(OUT, 'member.js'));
  check('VM-11 无 node: / Buffer / process 依赖（浏览器 ESM 可运行）',
    !/from\s+['"]node:/.test(js) && !/\bBuffer\./.test(js) && !/\bprocess\./.test(js));
  check('VM-12 语法检查通过', spawnSync(process.execPath, ['--check', join(OUT, 'member.js')]).status === 0);

  // 覆盖核心只读 / 写端点（与契约对齐）
  const endpoints = [
    '/api/health', '/api/config', '/api/auth/me', '/api/auth/login', '/api/auth/register',
    '/api/auth/logout', '/api/tasks', '/api/leaderboard/tasks', '/api/leaderboard/users',
    '/api/ledger/', '/api/events', '/api/reports', '/api/preferences/personalized',
    '/api/auth/resend-verification',
    '/accept', '/submit', '/verify', '/dispute', '/cancel', '/feedback',
  ];
  const missing = endpoints.filter((e) => !js.includes(e));
  check('VM-13 核心 API 调用覆盖（认证/任务/榜单/账本/事件/举报/写操作）',
    missing.length === 0, missing.length ? `缺：${missing.join(', ')}` : `${endpoints.length} 项`);

  check('VM-14 会话与 CSRF 约定（credentials / X-CSRF-Token / sambon_sid 语义）',
    /credentials:\s*'same-origin'/.test(js) && /X-CSRF-Token/.test(js) && /csrf_token/.test(js));
  check('VM-15 响应包络与 401 统一处理',
    /payload\.ok\s*!==\s*true/.test(js) && /res\.status === 401/.test(js));
  check('VM-16 幂等 event_id 由前端生成', /event_id:\s*eid\(/.test(js));
  check('VM-17 mode=demo 写锁（requireWrite / canWrite）',
    /function canWrite/.test(js) && /function requireWrite/.test(js) && /mode === 'production'/.test(js));

  check('VM-18 中英双语表齐备（en / zh-CN）',
    /'en'\s*:/.test(js) && /'zh-CN'\s*:/.test(js) && /function t\(/.test(js));
  check('VM-19 SBC 合规红线（不可兑付 / 不可转让 / 无收益）',
    /不可兑付/.test(js) && /不可转让/.test(js) && /not redeemable/.test(js) && /not transferable/.test(js));
  check('VM-20 人工闸门二次确认（verify / dispute / cancel 走 humanConfirm）',
    /humanConfirm\(/.test(js) && /data-action="verify"/.test(js) &&
    /data-action="dispute"/.test(js) && /data-action="cancel"/.test(js));
  check('VM-21 模型不直判（无自动结算后门 / 状态字段用 state）',
    !/model_decision:\s*['"]approve/.test(js) && /\.state/.test(js));

  // 魔兽世界主题 / 游戏化呈现
  const css = read(join(OUT, 'member.css'));
  const mHtml = read(join(OUT, 'member.html'));
  check('VM-22 稀有度系统（普通/精良/稀有/史诗/传说 + 卡片色带）',
    /function rarityOf/.test(js) &&
    ['common', 'uncommon', 'rare', 'epic', 'legendary'].every((k) =>
      js.includes("'" + k + "'") && css.includes('.wow-contract.r-' + k)) &&
    /r-\$\{r\.key\}/.test(js));
  check('VM-23 猎人等级 / 称号 / 声望条（hunterLevel + xp-fill）',
    /function hunterLevel/.test(js) && /function hunterTitleOf/.test(js) &&
    /wow-xp-fill/.test(js) && /wow-xp-fill/.test(mHtml) && /\.wow-xp i/.test(css));
  check('VM-24 赏金猎人榜（金银铜勋章 + 称号 + 双 tab）',
    /赏金猎人榜/.test(js) && /Hunter Leaderboard/.test(js) &&
    /function rankMedal/.test(js) && /wow-rank-no/.test(js) && /\.wow-rank-no\.r1/.test(css));
  check('VM-25 金币赏金渲染（CSS 金币 + coin 帮助函数）',
    /function coin/.test(js) && /wow-coin/.test(js) && /\.wow-coin/.test(css));
  check('VM-26 公会主题骨架（徽记 / 角色卡 / 深色石板面板）',
    /wow-crest/.test(mHtml) && /wow-hero-card/.test(mHtml) &&
    /--bg:\s*#12100d/.test(css) && /--gold:/.test(css));
  check('VM-27 主题资源零外链（无图片/字体 CDN，全部 CSS 绘制）',
    !/https?:\/\//.test(css) && !/@import/.test(css) && !/url\(/.test(css));

  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log(`\n=== 结果：PASS ${pass} / FAIL ${fail} / 共 ${results.length} 项 ===`);
  if (fail) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
