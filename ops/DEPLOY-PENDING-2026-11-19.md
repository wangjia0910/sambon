# 本轮交付部署待办（2026-11-19）

## 本地状态
- 分支：`main`
- 本地提交（待推送 2 个）：
  - `4590994`（feat: 用户版前端改为魔兽世界主题 / 赏金猎人公会）
  - `80ab342`（feat: 规范项目文档集 + 用户版悬赏平台 Web 产品站）
- 远端 `origin/main`：`4f7c65e`（探测时间 2026-11-19）
- 领先 2 个提交，无分叉；代码与构建产物（`cloudflare/`）已 100% 就绪。
- 全套回归 245 项断言全绿（20/32/14/10/7/27/18/117）。

## 推送阻塞原因
1. **TLS 拦截**：默认 schannel 后端报 `CRYPT_E_REVOCATION_OFFLINE (0x80092013)`。
   - 已解决：加 `-c http.sslBackend=openssl` 可正常连通（ls-remote 成功）。
2. **缺少凭据**：本机无持久 GitHub 凭据、无 `gh` CLI、无环境变量 PAT，
   推送报 `could not read Username for 'https://github.com'`。
   - 按项目约定：PAT 只经环境变量/stdin 一次性注入，不写入 `.git/config`、不落盘、不打印。

## 一键推送（注入 PAT 后执行，勿把 token 写进命令历史/文件）
在 bash 中执行（`<PAT>` 换成你的 GitHub Personal Access Token，需 repo 权限）：

```bash
cd /e/SKILLS/sambon
GIT_ASKPASS=/tmp/gh_askpass.sh \
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
git -c http.sslBackend=openssl push origin main \
  --force-with-lease=main:4f7c65e5b0fc2f432635b5eefcea901e815b5f6a
```

其中 `/tmp/gh_askpass.sh` 内容（用 Write 创建，用完删除，token 不落仓库）：
```sh
#!/bin/sh
echo "<PAT>"
```
> 更安全的替代：让 WorkBuddy 在一次工具调用里用 stdin/环境变量注入 PAT 并立即推送，
> 推送后清除，全程不回显。

## 推送后
- Cloudflare Git 集成自动部署（`main` → 产物目录 `cloudflare`，构建命令留空）。
- 主入口 `/` 即为新用户版悬赏平台；`/prod` 操作台、`/index` L0 演示保留。
- 线上只读核验：`node tests/verify-deployment.mjs`（D-13/D-13b/D-13c 校验新入口）。

## 合规边界（不变）
- 用户版是演示/评审环境；docs/13 的 20 项外部证据闸门 0/20 → NOT READY。
- 不得表述为「平台已正式上线 / 已通过备案 / 网信办认证」。
