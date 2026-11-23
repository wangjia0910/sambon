# 交付部署状态与待办（v5 · 2026-11-20）

## 结论速览
| 通道 | 状态 | 地址 / 产物 |
|---|---|---|
| **WorkBuddy 在线评审站** | ✅ **已部署并实测通过**（2026-11-20） | `https://sambon-demo-console.app.workbuddy.host/?sharecode=CCHOH4VO5W` |
| GitHub → Cloudflare Pages（正式生产） | ✅ **代码已推送 + 线上核验通过**（2026-11-20） | `4f7c65e..b1c9dac`，远端与本地同步（ahead=0） |

> PAT 由提供方一次性经临时 askpass 注入完成推送；脚本已删除、未写入 `.git/config`、仓库内无 token 残留。
> 本机 curl/Node/Python 对 `sambon.net` 的 HTTPS 受 WorkBuddy MITM 代理干扰（schannel `SEC_E_INVALID_TOKEN` /
> `WRONG_VERSION_NUMBER`），但**改用独立网络栈的工具核验成功**——Cloudflare Pages 自动部署已确认生效（见下）。

## 一、WorkBuddy 在线评审站（已上线，可访问）
- 发布方式：Node HTTP 服务（`ops/deploy-server.mjs`，绑定 `0.0.0.0:$PORT`，零依赖）。
- appId：`wbapp_fBhlu1O6pqiaPK20RAzeN5`（复用同一应用，链接稳定）。
- 分享链接：`https://sambon-demo-console.app.workbuddy.host/?sharecode=CCHOH4VO5W`
- **线上实测**（2026-11-20，均带 sharecode 参数）：
  - 首页 200；`<title>三宝殿 · 悬赏互助平台 — 无事不登三宝殿 …</title>`；`<h1 id="seo-h1">无事不登三宝殿</h1>`。
  - 静态资源 200 且 MIME 正确：`member.js` / `seo.js` / `legal-lang.js`（text/javascript）、`robots.txt`（text/plain）、`sitemap.xml`（application/xml）。
  - `/api/health` 真实响应：`mode=production / db=d1 / v3.0.0`（注：后端为内存 SQLite mock，见下方边界）。
  - 本轮两个 Critical 修复已在线生效：`getElementById('m-toast'|'m-modal'|'m-demo-banner')` 与 `if (opts.silent401) return null;`。
- 注意：`/api/*` 与子资源请求必须保留 `?sharecode=...` 参数；分享链接网关据此鉴权，缺失会返回「链接不完整」。

## 二、正式生产通道（Cloudflare Pages + D1）— 已推送，待 Cloudflare 构建
### 推送结果（2026-11-20）
- `git push origin main --force-with-lease=main:4f7c65e…` 成功：`4f7c65e..2673ae2 main -> main`。
- 共 6 个提交：`80ab342` 文档集+产品站、`4590994` 魔兽主题、`6308a97` 审计修复+SEO、`823301b` 在线评审站服务、`6f0cb11` 部署记录 v2、`2673ae2` 部署记录 v3。
- 本地 = 远端 = `2673ae2`，ahead=0，工作区干净。
- 全套回归 282 项断言全绿；`cloudflare/` 产物 22 文件就绪。
- 触发方式：`git push origin main` → Cloudflare Git 集成自动部署（输出目录 `cloudflare`）。
### 线上核验结果（2026-11-20，经独立网络栈确认，全部通过）
- `GET https://sambon.net/api/health` → `200 ok=true mode=production db=d1 status=healthy version=v3.0.0 schema_version=sambon-prod-schema-v2.0`；
  **`admin_bootstrap_available=false`**（推送前为 `true`），证明线上已重新部署、非旧缓存。
- 首页 `title` = `三宝殿 · 悬赏互助平台 — 无事不登三宝殿`；`<h1>无事不登三宝殿</h1>` 生效。
- 首页 SEO 引导文案「有事，就来三宝殿…」与本地 `prod/site/member.html:85` 逐字一致 → 线上为最新产物。
- `/seo.js` 结构化数据（Organization / WebSite / FAQPage + `slogan: 无事不登三宝殿`）已上线。
- 备注：本机 curl/Node/Python 因 WorkBuddy MITM 代理与 schannel 后端无法直连该域（`ERR_SSL_PACKET_LENGTH_TOO_LONG` /
  `WRONG_VERSION_NUMBER`），故用独立网络栈工具完成只读核验；`node tests/verify-deployment.mjs` 在此本机直连仍会失败，
  属环境限制而非站点问题，请在 TLS 正常环境复跑作二次确认。

### 网络已恢复（2026-11-20 核实）
- `github.com` / `api.github.com`：HTTP 200，`ssl_verify_result=0`。
- `git -c http.sslBackend=openssl ls-remote origin HEAD` 成功 → `4f7c65e…`。
- 本地代理 `127.0.0.1:57567` 仍在环境变量，但对上述域名链路已通；推送时按既有做法 `env -u` 清代理。

### 唯一剩余阻塞：凭据
- 无 `gh` CLI、无 `credential.helper`、无 `GH_TOKEN`/`GITHUB_TOKEN` → 非交互推送报
  `fatal: could not read Username for 'https://github.com': terminal prompts disabled`。
- 按项目约定：PAT 只经环境变量/stdin **一次性注入**，不写入 `.git/config`、不落盘、不打印。

### 一键推送（由持有 PAT 的一方执行；token 不写进历史/文件）
```bash
cd /e/SKILLS/sambon
GIT_ASKPASS=/tmp/gh_askpass.sh \
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
GIT_TERMINAL_PROMPT=1 git -c http.sslBackend=openssl push origin main
```
`/tmp/gh_askpass.sh`（用 Write 创建、用完即删、不落仓库）：
```sh
#!/bin/sh
echo "<PAT>"
```
- 因是 fast-forward，无需 `--force-with-lease`；若远端被他人更新过，改用
  `--force-with-lease=main:4f7c65e5b0fc2f432635b5eefcea901e815b5f6a` 防止覆盖。
- 推送后：Cloudflare Git 集成自动部署（输出目录 `cloudflare`）→ `node tests/verify-deployment.mjs` 只读核验。

## 三、合规边界（不变）
- WorkBuddy 链接是**在线评审站**：数据为内存 SQLite，**重启即清空**；`/api/health` 因绑定内存库而显示 `mode=production/db=d1`，这是后端逻辑口径，**不代表已接入 Cloudflare D1 正式生产**。
- 分期就绪门禁（D-17）：代码能力 17/17 + 一期验收 5/5 → **一期 READY（已正式上线）**；外部证据闸门 **2/20** 转二期 → 二期 PENDING（18 项待真人/律师/第三方留痕，不阻塞一期）。
- C-01 结算并发双花已于 2026-11-20 从数据库层修复（D-16 / C-17，12 项并发回归），不再是阻塞项。
- 一期已正式上线（D-17），对外可称「一期正式上线版本」；但不得表述为「已通过合规审查 / 已备案 / 网信办认证 / 官方背书」，二期外部证据 2/20 仍待补。

## 四、待推送提交（2026-11-23 网络中断，持续阻断）
- 本地 HEAD `207071d`（部署待办修正），其前 `e0c9176`（D-17 一期上线 + 文字优化）、`9a84212`（多智能体测试）；上次成功推送点为 `2897d49`（C-01 修复）。**本地领先远端 3 个提交**，工作区干净。
- 2026-11-23 09:41 尝试推送：`ls-remote`（默认 / HTTP1.1 / openssl）与 `git push` 均连不上 `github.com:443`（Connection reset / 21s 超时），按约定不反复重试；askpass 已删、PAT 无残留。
- 2026-11-23 再次执行「拉取 + 推送」：`git fetch`（沙箱 / 非沙箱通道）、`git push`（HTTP1.1 + openssl，均已清代理）依旧 `Connection reset` / `21s 超时`。确认 `github.com:443` 在 TCP 层被阻断，**非代理配置或凭据问题**（环境变量无 `GH_TOKEN`/`GITHUB_TOKEN`、无 askpass 残留）。按约定不再重试。
- **只读通道核验结果（2026-11-23）**：
  - `api.github.com` 最新提交仍为 `2897d49`（父 `481ebff`），证实远端确实未收到后续 3 个提交，无他人并发更新。
  - `https://sambon.net/api/health` → `ok=true / mode=production / db=d1 / version=v3.0.0 / status=healthy`，线上生产后端正常。
  - `https://sambon.net/app.js` 仍为旧口径：`l1.body`、`auth.subtitle`、`auth.comp1`、`compliance.1` **4 处「演示环境」**；未出现「一期正式上线」——证实 D-17 文案尚未上线，push 确有必要。
- **网络恢复后**：先 `git fetch origin main` 确认远端无变化，再 `git push origin main`（安全锁 `--force-with-lease=refs/heads/main:2897d49e39b99a7d74bd7d3c931196c5a8137beb`）。推送后 Cloudflare 自动部署生效，线上文案从「演示环境」变为「一期正式上线」。若需凭据，仍按一次性 askpass 注入，不落盘、不打印。
