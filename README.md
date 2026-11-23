# 三宝殿 · 悬赏互助平台

> **无事不登三宝殿。**
>
> 三宝殿是一个悬赏互助平台：发布方悬赏、猎人接单、按时交付、验收结算。
> 生产形态为 **Cloudflare Pages + Pages Functions + D1**，零第三方运行时依赖。

| 项 | 值 |
|---|---|
| 主域 | `sambon.net` |
| 用户版入口 | `https://sambon.net/`（等价 `/app`） |
| 运营台入口 | `https://sambon.net/product`（等价 `/production`） |
| 运行时 | Cloudflare Pages（静态）+ Pages Functions（`/api/*`）+ D1（SQLite） |
| Node 版本 | 18+（本地开发与测试；生产不需要 Node） |
| 依赖 | **零第三方依赖**，无需 `npm install` |

---

## 一、平台能力

### 1. 任务全流程

发布 → 审核 → 推送 → 接单 → 进行中 → 提交成果 → 验收结算 →（争议）→ 结案。

九态状态机（`src/domain.mjs` 为唯一真源）：

```
DRAFT ──→ PENDING_REVIEW ──→ PUBLISHED ──→ DISPATCHING ──→ ACCEPTED
              │                  │              │              │
              ↓                  ↓              ↓              ↓
           REJECTED          CANCELLED      EXPIRED        IN_PROGRESS
                                                                │
                                                    ┌───────────┼───────────┐
                                                    ↓           ↓           ↓
                                                SUBMITTED   EXPIRED     DISPUTED
                                                    │                       │
                                            ┌───────┼───────┐       ┌───────┼───────┐
                                            ↓       ↓       ↓       ↓       ↓       ↓
                                        SETTLED DISPUTED IN_PROGRESS SETTLED CANCELLED CLOSED
                                            │   （驳回）                    │
                                            ↓                               ↓
                                          CLOSED                          CLOSED
```

非法迁移一律返回 `400 ILLEGAL_TRANSITION`，由服务端状态机强制校验。

### 2. 积分体系（SBC）

SBC 是**平台内贡献积分**，用于度量贡献并兑换平台内权益：不可兑付法币、不可转让、不可交易、无收益承诺、不构成资产/证券/电子货币。

| 规则 | 数值 | 说明 |
|---|---|---|
| 规则版本 | `sbc-rule-v1.0` | 账本写入时记录版本 |
| 新账号初始额度 | 1000 SBC | 环境变量 `INITIAL_SBC` 可调 |
| 服务费 | 悬赏额 × 5% | 发布时与赏金一并冻结 |
| 质量奖励 | 赏金 × 2%，上限 50 | 评价 ≥ 4.5 分时发放给接单人 |
| 已接单取消补偿 | 冻结额 × 10% | 补偿给接单人 |
| 超时未完成 | 信用分 −5 | 只影响信用分，不扣 SBC |

**资金闭环**：发布冻结 → 托管 → 验收转付。账本为只追加流水（`ledger_entries`），每次结算同时写「接单方入账 + 平台服务费入账」，哈希链串联，零 PII 上链。

**防双花**：`settlement_guards` 表以 `task_id` 为主键，结算/退款/关闭三条终局路径共用 `INSERT OR IGNORE` 原子抢锁。并发重复结算返回 `409 SETTLEMENT_CONFLICT`，余额只变动一次。

### 3. 智能推送

候选排序采用六项加权模型（`WEIGHT_VERSION = v1.0`，权重和恒为 1.00）：

| 因子 | 权重 | 含义 |
|---|---|---|
| `P_accept` | 0.30 | 预计接单概率 |
| `P_complete_on_time` | 0.35 | 预计按时完成概率 |
| `C_notify` | −0.10 | 通知成本（减项） |
| `R_risk` | −0.10 | 风险（减项） |
| `V_fairness` | 0.08 | 公平性（新人/低曝光补偿） |
| `B_supply` | 0.07 | 区域供需（供不应求时加速曝光） |

- 等级/榜单加成封顶 **总分 5%**（`LEVEL_BOOST_CAP`）。
- **硬过滤层先于打分**：风控命中一票拦截，不允许被高分覆盖。
- 每次推送记录 `weight_version` 与 `algorithm_degraded`，可审计、可复现。
- 大模型仅作适配层：未配置 `LLM_API_URL` 时自动降级为规则引擎，`algorithm_degraded=true`。

### 4. 排行榜

- **任务榜**：按热度与赏金加权。
- **猎人榜**：按净贡献 SBC（`net_sbc`）排名，含等级、称号、奖牌。
- 支持分页与 Top-K 分批。

### 5. 人工闸门

以下动作**必须人工确认**，服务端强制，不提供自动执行入口：

| 动作 | 谁执行 |
|---|---|
| 任务审核（`review`） | 管理员 |
| 任务推送（`dispatch`） | 管理员 |
| 验收结算（`verify` approve） | **发布方本人** |
| 争议裁定（`dispute` resolve） | 管理员 |
| 风控处置（`risk/resolve`） | 管理员 |
| 定时任务触发的超时工单 | 只生成工单，不自动验收/结算 |

`model_decision` 字段恒为 `null`——模型不产生任何裁决。

### 6. 其他能力

- **通知**：站内通知 + Webhook 推送（未配置 Webhook 时标注 `queue_only`，不伪造已发送）。
- **邮件验证**：可选强制（`EMAIL_VERIFICATION_REQUIRED=true`）。
- **强口令**：可选强制（`ENFORCE_STRONG_PASSWORD=true`，≥12 位 + 3 类字符）。
- **风控**：限流、异常行为标记、需人工处置。
- **审计**：全量 `audit_log`，管理员可查。
- **备份**：`GET /api/admin/backup` 导出快照；`POST /api/admin/anchor` 写账本锚点。
- **双语**：中 / 英，服务端按 `locale` 生效，前端可切换。
- **账号自服务**：数据导出（`GET /api/me/export`）、账号删除（`DELETE /api/me`，需输入 `DELETE` 二次确认）。
- **成果脱敏**：提交正文强制 PII 脱敏（证件号优先匹配 + 数字边界兜底），落库前完成。

---

## 二、系统架构

```
                      ┌──────────────────────────────────────────┐
  浏览器 ────────────→ │  Cloudflare Pages（静态资源）             │
                      │  /            → member.html（用户版 SPA）  │
                      │  /product     → prod.html（运营台）        │
                      │  /demo        → index.html（L0 演示台）    │
                      └───────────────┬──────────────────────────┘
                                      │ /api/*（_routes.json 限定）
                                      ↓
                      ┌──────────────────────────────────────────┐
                      │  Pages Functions                         │
                      │  functions/api/[[path]].js               │
                      │        ↓ dispatch()                      │
                      │  prod/lib/api.js（40 个端点编排）          │
                      │   ├─ auth.js      会话 / CSRF / RBAC     │
                      │   ├─ domain.js    状态机 / 积分 / 打分    │
                      │   ├─ db.js        D1 适配                │
                      │   ├─ schema.js    20 张表结构真源         │
                      │   ├─ risk.js      风控                   │
                      │   ├─ notify.js    通知 / Webhook         │
                      │   ├─ llm.js       大模型适配（可降级）     │
                      │   ├─ jobs.js      定时作业                │
                      │   ├─ security.js  口令 / 限流            │
                      │   └─ observability.js 指标 / 日志        │
                      └───────────────┬──────────────────────────┘
                                      ↓ 绑定变量 DB
                      ┌──────────────────────────────────────────┐
                      │  Cloudflare D1（SQLite）· 20 张表         │
                      └──────────────────────────────────────────┘
```

### 数据表（20）

| 分类 | 表 |
|---|---|
| 账号与会话 | `users` `sessions` `email_verifications` `consents` |
| 任务与派单 | `tasks` `dispatches` `dispatch_feedback` |
| 资金与账本 | `ledger_entries` `settlement_guards` `backups` |
| 事件与幂等 | `events` `idempotency` `meta` |
| 治理与风控 | `reports` `audit_log` `rate_limits` `risk_flags` `metrics` |
| 消息 | `notifications` |

表结构唯一真源为 `prod/lib/schema.js`，`schema.sql` 由构建脚本导出，**勿手改**。

### 安全设计

- 会话：`sambon_sid` Cookie（httpOnly + Secure + SameSite）。
- CSRF：所有写操作要求 `X-CSRF-Token`，令牌随会话签发。
- 幂等：写操作携带 `event_id`，重复请求返回首次结果（`idempotency` 表）。
- 权限：RBAC 三角色，越权返回 `403 FORBIDDEN`。
- 响应头：严格 CSP（`default-src 'self'`，无内联脚本、无第三方来源）、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`。
- 限流：按端点与来源计数（`rate_limits`）。

---

## 三、目录结构

```
.
├── README.md                    # 本文件
├── package.json                 # 脚本入口（零依赖）
├── schema.sql                   # D1 表结构（由 schema.js 生成，勿手改）
│
├── cloudflare/                  # Pages 构建产物（勿手改，由 npm run build 生成）
│   ├── member.html|.js|.css     # 用户版
│   ├── prod.html / app.js / styles.css   # 运营台
│   ├── index.html / demo.html   # L0 演示台（浏览器内 mock）
│   ├── seo.js / sitemap.xml / robots.txt
│   ├── _headers / _redirects / _routes.json
│   └── src/                     # L0 运行时（与 src/ 逐字节一致）
│
├── functions/api/[[path]].js    # Pages Functions 入口（/api/* → dispatch）
│
├── prod/
│   ├── lib/                     # 后端核心
│   │   ├── api.js               # 40 个端点编排、账本、事件、人工闸门
│   │   ├── auth.js db.js response.js schema.js   # 基础设施
│   │   ├── domain.js hash.js    # 由 src/ 生成的副本，勿手改
│   │   └── notify.js llm.js jobs.js risk.js security.js observability.js
│   ├── site/                    # 前端源（构建后进 cloudflare/）
│   └── wrangler.toml            # Wrangler 模板（可选，本地联调/迁移用）
│
├── src/                         # 领域口径真源 + 本地原型
│   ├── domain.mjs               # 状态机 / 积分 / 推送打分（唯一真源）
│   ├── hash.mjs                 # 零依赖 SHA-256（Node/浏览器/Workers 通用）
│   ├── store.mjs server.mjs     # L0 内存原型
│
├── web/index.html               # L0 静态演示台源
├── tests/                       # 回归测试（292 项）
├── tools/                       # 构建脚本
│   └── build-cloudflare.mjs     # 生成 cloudflare/ + schema.sql + 同步副本
│
├── ops/
│   ├── daily-agents/            # 每日多智能体运营脚本
│   ├── cron/                    # 定时任务参考实现
│   ├── multiagent-client.mjs    # 多智能体 HTTP 客户端
│   └── preview-server.mjs       # 本地联调服务（内存 D1）
│
├── docs/使用手册.md              # 完整操作手册
└── .github/workflows/daily-agents.yml   # 每日运营定时任务
```

**构建约定**：`prod/lib/domain.js`、`prod/lib/hash.js`、`cloudflare/src/*` 均为**生成副本**，由 `npm run build` 从 `src/` 逐字节同步。修改领域逻辑只改 `src/`，然后重新构建。

---

## 四、快速开始

### 4.1 本地联调（推荐）

```bash
npm run preview          # 启动 http://127.0.0.1:8788
```

- 使用真实 `dispatch()` 与应用同构的内存 D1，页面与 API 行为与生产一致。
- 内置管理员引导令牌 `preview-admin`，可直接创建管理员。
- 数据存内存，**重启即清空**，仅用于开发联调。

首次使用创建管理员：

```bash
curl -X POST http://127.0.0.1:8788/api/admin/bootstrap \
  -H 'Content-Type: application/json' \
  -d '{"bootstrap_token":"preview-admin","email":"admin@example.com","password":"Str0ng-Passw0rd!","display_name":"平台管理员"}'
```

### 4.2 本地原型（L0，零后端）

```bash
npm start                # http://127.0.0.1:8787
```

纯内存原型，用于快速验证领域规则，不涉及 D1。

### 4.3 构建产物

```bash
npm run build            # 重建 cloudflare/ 与 schema.sql
```

### 4.4 跑测试

```bash
npm test                 # 全量 292 项（自检 → 独立验证 → 静态版 → SEO → 生产回归 → 并发）
npm run test:production  # 仅生产系统 117 项（真实 SQL）
npm run test:concurrency # 仅结算并发双花专项 12 项
```

---

## 五、生产部署（Cloudflare）

### 5.1 前置条件

1. Cloudflare 账号，`sambon.net` 域名已接入。
2. 仓库已 `Connect to Git`，构建配置：
   - **构建命令**：留空（或 `npm run build`）
   - **输出目录**：`cloudflare`
3. D1 数据库已创建（`npx wrangler d1 create sanbaodian-db`）。

### 5.2 部署流程

```bash
git push origin main     # Git 集成自动构建并部署
```

- 静态产物取自 `cloudflare/`。
- `functions/` 由 Cloudflare 自动编译，`/api/*` 由 `_routes.json` 限定走 Functions，其余走静态通道。

### 5.3 一次性绑定 D1（关键）

Cloudflare 控制台 → Pages 项目 → **Settings → Functions → D1 database bindings**：

| 变量名 | 数据库 |
|---|---|
| `DB` | `sanbaodian-db` |

> 绑定变量名**必须是 `DB`**。未绑定时站点进入 `mode=demo`：可读、写操作返回 `503 WRITE_LOCKED`，不会静默失败。

初始化表结构：

```bash
npx wrangler d1 execute sanbaodian-db --file=schema.sql --remote
```

### 5.4 创建首个管理员

在 Pages 项目环境变量中临时设置 `ADMIN_BOOTSTRAP_TOKEN`（随机强字符串），部署后调用：

```bash
curl -X POST https://sambon.net/api/admin/bootstrap \
  -H 'Content-Type: application/json' \
  -d '{"bootstrap_token":"<你的引导令牌>","email":"<管理员邮箱>","password":"<≥12位强口令>","display_name":"平台管理员"}'
```

创建成功后**立即从环境变量移除** `ADMIN_BOOTSTRAP_TOKEN`（端点会自动返回 503，禁止重复引导）。

### 5.5 环境变量（可选）

在 Pages 项目 **Settings → Environment variables** 配置，密钥类请用密文保存。

| 变量 | 作用 | 默认 |
|---|---|---|
| `INITIAL_SBC` | 新账号初始 SBC | `1000` |
| `PBKDF2_ITERATIONS` | 口令派生轮数 | `120000` |
| `EMAIL_VERIFICATION_REQUIRED` | `true` 时未验证账号限制发布/接单 | 不强制 |
| `ENFORCE_STRONG_PASSWORD` | `true` 时强制 ≥12 位 + 3 类字符 | 不强制 |
| `LLM_API_URL` / `LLM_API_KEY` / `LLM_MODEL` | 大模型适配层 | 不配置则规则降级 |
| `NOTIFY_WEBHOOK_URL` / `NOTIFY_WEBHOOK_SECRET` | 通知 Webhook | 不配置则 `queue_only` |
| `CRON_SECRET` | `/api/admin/cron` 的 `X-Cron-Secret` | 不配置则端点 503 |
| `COOKIE_SECURE` | 仅本地 http 联调可设 `false` | 生产强制 Secure |
| `RATE_LIMIT_DISABLED` | 仅本地回归使用 | 生产必须留空 |

> `EMAIL_VERIFICATION_DEV_ECHO` 仅用于本地回归，**生产严禁设置**（会把验证令牌回显到响应）。

### 5.6 上线验收

```bash
curl https://sambon.net/api/health
```

期望：

```json
{
  "mode": "production",
  "db": "d1",
  "status": "healthy",
  "version": "3.0.0",
  "schema_version": "...",
  "admin_bootstrap_available": false
}
```

- `mode=production`、`db=d1` → D1 已正确绑定。
- `admin_bootstrap_available=false` → 引导令牌已移除，符合预期。

---

## 六、账号与角色

| 角色 | 能力 |
|---|---|
| **publisher（发布方）** | 发布任务、查看自己的任务、验收自己发布的任务、取消未接单任务、评价接单人、查看账本 |
| **solver（接单人）** | 浏览大厅、接单、提交成果、发起争议、查看账本与排行榜 |
| **admin（管理员）** | 审核任务、推送任务、处理争议、处置风控、查看审计/指标/备份、触发定时作业 |

注册默认角色为 `publisher` / `solver`（按注册时选择）。管理员只能通过 `/api/admin/bootstrap` 创建首名，之后由已有管理员在运营台维护。

---

## 七、API 概览

统一响应包络：`{ ok: boolean, data?: any, error?: { code, message } }`。

**通用约定**：

| 项 | 说明 |
|---|---|
| 会话 | `sambon_sid` Cookie（httpOnly，浏览器自动携带） |
| CSRF | 写操作携带 `X-CSRF-Token`（登录/注册响应中的 `data.session.csrf_token`） |
| 幂等 | 写操作携带 `event_id`，重复提交返回首次结果 |
| 错误码 | `400` 参数/状态非法、`401` 未登录、`403` 越权、`404` 不存在、`409` 冲突、`429` 限流、`503` 降级 |

| 分组 | 端点 |
|---|---|
| 系统 | `GET /api/health`、`GET /api/config`、`GET /api/events` |
| 认证 | `POST /api/auth/register`、`POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/me`、`POST /api/auth/verify-email`、`POST /api/auth/resend-verification` |
| 账号 | `GET /api/me/export`、`DELETE /api/me`、`POST /api/me/locale`、`GET /api/me/notifications`、`POST /api/me/notifications/read`、`POST /api/consents` |
| 任务 | `POST /api/tasks`、`GET /api/tasks`、`POST /api/tasks/:id/review`、`POST /api/tasks/:id/dispatch`、`POST /api/tasks/:id/accept`、`POST /api/tasks/:id/submit`、`POST /api/tasks/:id/verify`、`POST /api/tasks/:id/dispute`、`POST /api/tasks/:id/cancel`、`POST /api/tasks/:id/feedback` |
| 榜单与账本 | `GET /api/leaderboard/tasks`、`GET /api/leaderboard/users`、`GET /api/ledger/:user_id` |
| 偏好与举报 | `POST /api/preferences/personalized`、`POST /api/reports` |
| 运营管理 | `POST /api/admin/bootstrap`、`GET /api/admin/queue`、`GET /api/admin/metrics`、`GET /api/admin/audit`、`GET /api/admin/risk`、`POST /api/admin/risk/resolve`、`GET /api/admin/backup`、`POST /api/admin/anchor`、`POST /api/admin/cron`、`GET /api/admin/ops` |

> SBC 资产化相关的 8 条路径固定返回 `404`，不接受任何形式的兑付、转让、交易请求。

完整请求/响应示例见 [docs/使用手册.md](docs/使用手册.md) 第四章。

---

## 八、每日运营（多智能体）

仓库内置每日运营能力：多个账号每日发布 10 个任务、完成 1–2 个，用于保持平台活跃与验证链路。

```bash
API_BASE=https://sambon.net \
PUBLISHER_ACCOUNTS='[{"email":"..","password":".."}]' \
SOLVER_ACCOUNTS='[{"email":"..","password":".."}]' \
ADMIN_EMAIL=.. ADMIN_PASSWORD=.. \
DAILY_PUBLISH_COUNT=10 DAILY_COMPLETE_COUNT=2 \
npm run daily
```

- 云端定时：`.github/workflows/daily-agents.yml`，每日 UTC 01:00（北京 09:00）自动执行。
- 凭据通过仓库 Secrets 注入，不写入代码。
- 输出报告到 `ops/daily-agents/reports/YYYY-MM-DD.json`（已 gitignore）。
- 详见 [docs/使用手册.md](docs/使用手册.md) 第七章。

---

## 九、运维

| 场景 | 操作 |
|---|---|
| 健康检查 | `GET /api/health`，关注 `mode` / `db` / `status` |
| 指标 | `GET /api/admin/metrics`（管理员） |
| 审计 | `GET /api/admin/audit`（管理员） |
| 风控工单 | `GET /api/admin/risk` → `POST /api/admin/risk/resolve`（人工处置） |
| 备份 | `GET /api/admin/backup` 导出快照 |
| 账本锚点 | `POST /api/admin/anchor` 写批次摘要 |
| 定时作业 | `POST /api/admin/cron` + `X-Cron-Secret`（外部调度器调用） |
| 降级排查 | `mode=demo` → 检查 D1 绑定变量名是否为 `DB` |
| 写操作 503 | 同上，或 `WRITE_LOCKED`（未绑 D1） |

**变更流程**：修改 `src/`（领域）或 `prod/`（编排）→ `npm run build` → `npm test` 全绿 → 提交推送。

---

## 十、开发约定

1. **领域口径唯一真源是 `src/domain.mjs`**；`prod/lib/domain.js`、`cloudflare/src/domain.mjs` 是生成副本，不得手改。
2. **表结构唯一真源是 `prod/lib/schema.js`**；`schema.sql` 由构建导出。
3. 改完 `prod/site/` 或 `src/` 必须 `npm run build`，否则 `cloudflare/` 产物落后（生产回归 P-64/P-65/P-66 会失败）。
4. 测试全绿是提交前提（`npm test` 退出码 0）。
5. 不新增第三方运行时依赖——生产环境仅允许 Cloudflare 平台能力与标准 Web API。

---

## 十一、许可与声明

- SBC 为平台内贡献积分，不构成任何形式的金融资产、支付工具或投资标的。
- 平台不承诺具体可用性、响应时间或 SLA 指标。
- 结算、争议、审核、处罚、风控处置均保留人工确认环节，模型不产生裁决。
