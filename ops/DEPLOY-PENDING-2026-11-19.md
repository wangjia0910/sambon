# 交付部署状态与待办（2026-11-19，v2）

## 本地状态（已提交、工作区干净）
- 分支：`main`，HEAD = `823301b`（完整 `823301be17c1f37ddeaa38d4df77a67af34fd741`）
- 远端 `origin/main` = `4f7c65e`（完整 `4f7c65e5b0fc2f432635b5eefcea901e815b5f6a`）
- **领先 4 个提交，无分叉**：
  - `80ab342` 规范项目文档集 + 用户版悬赏平台 Web 产品站（主入口 /）
  - `4590994` 用户版前端魔兽世界主题（赏金猎人公会）
  - `6308a97` feat(audit+seo): 全盘代码审计修复与 SEO 强化
  - `823301b` feat(deploy): 在线评审站服务（0.0.0.0/$PORT + 真实后端 + 优雅降级）
- 全套回归 **282 项断言全绿**（20/32/14/10/7/32/7/25/18/117）。
- 代码与构建产物（`cloudflare/`，22 文件）100% 就绪。

## 生产部署（Cloudflare Pages + D1）阻塞原因
两条发布通道均被本机网络阻断，非项目缺陷：

1. **GitHub push**：
   - 默认 schannel 后端 `CRYPT_E_REVOCATION_OFFLINE (0x80092013)` → 加 `-c http.sslBackend=openssl` 可连通。
   - 本机无持久 GitHub 凭据、无 `gh` CLI、无环境变量 PAT → `could not read Username`。
   - 探测：`github.com` / `api.github.com` 经本地代理 `127.0.0.1:57567` 均 TLS 失败（curl 返回 000）。
2. **WorkBuddy 站点发布**（本轮换用的备用通道）：
   - 上传阶段失败：`SITES_UPLOAD_FAILED`（retryable=true）。
   - 数据面错误：`ERR_SSL_WRONG_VERSION_NUMBER`（boringssl TLS 握手失败），
     同源本地代理拦截所致。按工具约定：已如实告知用户并**提供一次重试**，未自动重试、未改参数硬闯、未另建应用。

> 根因：本机 HTTP(S) 代理 `127.0.0.1:57567` 公司网络 TLS 拦截。需在网络侧放行或对上述域名直连后重试。

## 通道 A：注入 PAT 后推送（正式生产路径）
在 bash 中执行（`<PAT>` 换成有 repo 权限的 GitHub PAT；token 不写进命令历史/文件）：

```bash
cd /e/SKILLS/sambon
GIT_ASKPASS=/tmp/gh_askpass.sh \
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
git -c http.sslBackend=openssl push origin main \
  --force-with-lease=main:4f7c65e5b0fc2f432635b5eefcea901e815b5f6a
```
`/tmp/gh_askpass.sh`（用 Write 创建、用完即删、不落仓库）：
```sh
#!/bin/sh
echo "<PAT>"
```
推送后：Cloudflare Git 集成自动部署（输出目录 `cloudflare`）→ `node tests/verify-deployment.mjs` 只读核验。

## 通道 B：WorkBuddy 站点发布（在线评审站）
网络恢复后重试一次即可（复用同一 appId `wbapp_fBhlu1O6pqiaPK20RAzeN5`，链接稳定）：
```
directory = E:\SKILLS\sambon
language = node, port = 3000
startCmd = node ops/deploy-server.mjs   （installCmd 留空，零依赖）
```
`ops/deploy-server.mjs` 已实现：绑定 0.0.0.0:$PORT、托管 cloudflare/ 静态产物、
`/api/*` 走真实后端（内存 D1）、后端不可用时降级为只读静态站、现场重建产物。
本地已实测：首页标题/SEO h1 正确、`/api/health` 真实响应、seo.js/legal-lang.js MIME 正确。

## 合规边界（不变）
- 在线评审站数据为**内存 SQLite，重启即清空**；不是 Cloudflare Pages + D1 正式生产。
- docs/13 的 20 项外部证据闸门 0/20 → NOT READY；C-01 结算双花为正式运营一号阻塞。
- 不得表述为「平台已正式上线 / 已通过备案 / 网信办认证」。
