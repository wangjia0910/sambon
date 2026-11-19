# E-03 生产环境变量与密钥状态审计

> 支撑闸门：E-03（基础设施）。数据来自 `ops/deployment-verification.json`（2026-11-13T07:09Z 线上 `/api/health` 实时快照）。
> 本文件是**现状快照**，E-03 核销还需你完成「密钥轮换/移除」等真实动作并留痕。

## 1. 当前线上配置（来自 health 组件快照）

| 项 | 状态 | 说明 |
|---|---|---|
| D1 绑定 (DB) | ✅ 已绑定 | mode=production, db=d1 |
| `CRON_SECRET` | ❌ 未配置 | `/api/admin/cron` 当前 503，需配置后外部调度器才能调用 |
| `LLM_API_URL/KEY/MODEL` | ❌ 未配置 | `algorithm_degraded=true`，全走规则降级，功能不中断 |
| `NOTIFY_WEBHOOK_URL/SECRET` | ❌ 未配置 | 通知仅入队 `queue_only`，sent=0（E-13 前置） |
| `ENFORCE_STRONG_PASSWORD` | ❌ 未启用 | 当前不强口令（注册仅基础校验） |
| `EMAIL_VERIFICATION_REQUIRED` | ❌ 未强制 | 邮箱验证能力已就绪，未强制 |
| GPC / DNT 支持 | ✅ 支持 | 注册即关闭个性化 |

## 2. 需你完成的真实动作（在 Cloudflare Pages → Settings → Environment variables）

1. 若首名 admin 已创建：**移除 `ADMIN_BOOTSTRAP_TOKEN`**（移除后该端点 503，防滥用）。
2. 配置 `CRON_SECRET`（与 E-04 调度器里的 `SAMBON_CRON_SECRET` 一致）。
3. 视需要配置 `NOTIFY_WEBHOOK_URL/SECRET`（E-13）、`LLM_*`、`ENFORCE_STRONG_PASSWORD=true`、`EMAIL_VERIFICATION_REQUIRED=true`。
4. 确认 `COOKIE_SECURE`/`RATE_LIMIT_DISABLED`/`EMAIL_VERIFICATION_DEV_ECHO` **保持为空**（仅本地用）。

## 3. 密钥轮换说明（PAT 按用户指令保留）

> **2026-11-13 用户明确：GitHub PAT 还要用，不撤销。**
> 因此 E-03 的「GitHub PAT 撤销记录」一项**不适用**，改为以下记录口径：
> - PAT 用途：仅用于 `git push` 到 `github.com/wangjia0910/sambon`（Cloudflare Git 集成自动部署）。
> - 权限范围：仅仓库 contents（最小权限），不含 admin/其他组织。
> - 轮换策略：按需由用户在 GitHub 控制台重新生成；本环境不落盘、不打印。
> - 历史对话中提取的 PAT 仅经环境变量一次性注入，建议用户定期轮换并在控制台审计最近使用记录。

## 4. 核销证据模板（填 E-03.evidence）

```
by: __  at: YYYY-MM-DD
- ADMIN_BOOTSTRAP_TOKEN：已移除 / 仍保留（说明）
- CRON_SECRET：已配置（不打印值）
- 其他密钥：已配置清单
- GitHub PAT：按用户指令保留，仅限仓库推送最小权限，未撤销（2026-11-13）
- 轮换记录：__
```
