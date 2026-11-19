# E-14 WAF / 风控名单 / 滥用处置 建议清单

> 支撑闸门：E-14（运营）。本文件是**建议模板**，需在 Cloudflare 控制台实际配置并验证后才计核销。
> 应用层 `prod/lib/risk.js` 已做四类评分（高频发布/异常赏金/疑似引流/重复任务）→ `risk_flags`，且 `blocked` 恒 false，只标记不自动处罚，需 admin 二次确认（docs/13 §1 #6）。

## 1. Cloudflare WAF（控制台 → Security → WAF）

| 规则 | 作用 | 动作 | 优先级 |
|---|---|---|---|
| 登录限流 | `/api/auth/login` 单 IP 每分钟 > 20 次 | 挑战 (JS Challenge) | 高 |
| 管理端点保护 | `/api/admin/*` 非可信网段/无有效会话 | Block | 高 |
| OWASP 托管规则集 | SQLi/XSS/路径穿越等 | Block（先 Log 观察 7 天再 Block） | 高 |
| 热门 Bot 管理 | 已知恶意爬虫 | Block | 中 |
| IP 信誉 | Cloudflare 情报命中 | Challenge | 中 |
| 国别封禁（如需） | 仅服务海外则封特定地区 | Block | 按需 |

## 2. 速率限制（Rate Limiting）

- 全局：每 IP 每 10 秒 ≤ 60 请求；`/api/auth/*` 每 IP 每 60 秒 ≤ 30。
- 超限返回 429（应用层 `auth.js` 另有登录失败 5 次锁定 423）。

## 3. 风控名单与滥用处置流程

1. `risk_flags` 命中 → 进入运营待办，admin 在「运维 → 风控」二次确认。
2. 制裁/PEP 名单筛查：接入 OFAC / EU Consolidated / UN 名单，命中即人工复核（不自动封禁）。
3. 滥用举报入口：用户可 `POST /api/me/report`（事件 `ReportFiled`，见 docs/13 §3）；运营 48h 内响应，SLA 留痕。
4. 处置记录写入 `audit_log`，可追溯；任何封禁/处罚均保留人工闸门。

## 4. 核销所需真实证据

- WAF 规则截图 + 规则 ID 列表；
- 速率限制配置截图；
- 制裁名单筛查流程文档 + 一次人工复核样例；
- 滥用举报 SLA 说明与一条处理记录。
