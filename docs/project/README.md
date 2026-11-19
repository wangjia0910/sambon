# 三宝殿 · 悬赏互助平台 —— 项目文档集

> 本目录是《三宝殿项目方案 v1.0》落地为 **Web 单端 + Cloudflare** 形态后，面向开发/评审的**规范化项目文档**。六篇文档与代码一一对应，是本次「按文档开发用户版悬赏平台 Web 项目」的直接依据。
>
> **基线**：业务口径以 `三宝殿项目方案_v1.0.md`（只读）为准；术语、状态机、事件、权重以 `CONTRACT.md` v0.2 为准；接口以 `prod/lib/api.js` 的 `ROUTES` 常量为唯一真源；前端三件套以 `prod/site/member.*` 为单一真源。

## 文档清单

| # | 文档 | 回答什么问题 | 对应代码 |
|---|---|---|---|
| 01 | [需求规格说明书](01-需求规格说明书.md) | 做什么、为谁做、验收口径 | `三宝殿项目方案_v1.0.md`、`CONTRACT.md` |
| 02 | [系统架构设计](02-系统架构设计.md) | 系统怎么分层、怎么部署、关键取舍 | `tools/build-cloudflare.mjs`、`prod/wrangler.toml`、`cloudflare/_redirects`、`_headers`、`_routes.json` |
| 03 | [功能规格说明](03-功能规格说明.md) | 每个页面/视图有哪些功能与交互 | `prod/site/member.html`、`member.js`、`member.css` |
| 04 | [模块设计说明](04-模块设计说明.md) | 三大业务模块 + 支撑模块如何协作 | `prod/lib/{api,domain,llm,notify,jobs,risk,security,observability}.js` |
| 05 | [数据库设计](05-数据库设计.md) | 数据如何建模、账本如何防篡改 | `prod/lib/schema.js` → `schema.sql` |
| 06 | [接口设计](06-接口设计.md) | 前后端如何调用、字段与错误码 | `prod/lib/api.js`、`functions/api/[[path]].js` |

## 三通道入口（本轮新增用户版主入口）

| 入口 | 页面 | 面向 | 说明 |
|---|---|---|---|
| `/`（`/app`） | `member.html` + `member.js` | **真实发布方 / 接单人** | 本轮新增的用户版悬赏平台产品站，站点主入口 |
| `/prod`（`/product`、`/production`） | `prod.html` + `app.js` | 运营 / 评审 | 生产系统操作台，含管理端人工闸门 |
| `/index`（`/demo`） | `index.html` + `cf-runtime.mjs` | 演示 / 降级对照 | L0 浏览器内 mock 演示台 |

三者由 `cloudflare/_redirects` 控制，`/api/*` 由 `functions/api/[[path]].js` 统一接管（Pages Functions），静态资源走 CDN。

## 用户版前端功能视图

`member.js` 采用 hash 路由，视图与核心 API 对应：

| 视图 | hash | 主要 API |
|---|---|---|
| 任务大厅 | `#/hall` | `GET /api/tasks`、`/api/config`、`/api/health` |
| 排行榜 | `#/rank` | `GET /api/leaderboard/tasks`、`/api/leaderboard/users` |
| 发布悬赏 | `#/publish` | `POST /api/tasks` |
| 任务详情 | `#/task/:id` | `GET /api/events`；accept / submit / verify / dispute / cancel / feedback |
| 我的任务 | `#/mine` | `GET /api/tasks?include_terminal=true` |
| SBC 账户 | `#/wallet` | `GET /api/ledger/:userId`、`POST /api/preferences/personalized` |
| 登录 / 注册 | `#/auth` | `POST /api/auth/{register,login}`、`/api/auth/me` |

写操作统一：`X-CSRF-Token` 头 + `credentials:'same-origin'` + 幂等 `event_id`；结算/争议/取消类保留人工二次确认闸门。

## 验证

```bash
# 单次构建（生成 cloudflare/ 产物）
npm run build

# 全套回归（含用户版前端静态验证 + 前后端契约契合 + 生产 117 项）
npm test

# 单独跑用户版相关验证
node tests/verify-member.mjs           # 21 项：产物 / CSP / 双语 / 红线 / 人工闸门
node tests/verify-member-api.mjs       # 18 项：前端取值路径 ↔ 生产 API 字段契合
```

## 合规红线（务必先读）

- **SBC 非资产**：平台内贡献积分，不可兑付、不可转让、不可交易、无收益承诺；不接真实支付、不接公链。
- **人工兜底**：结算 / 争议裁定 / 审核 / 处罚 / 风控处置由人或规则裁定，模型只给建议（`model_decision` 恒 null）。
- **零 PII 上链**：账本仅本地哈希链 + Merkle 摘要，零个人信息、零任务正文上链。
- **代码完全体 ≠ 运营许可**：`docs/13` 的 20 项外部证据闸门当前 0/20 → NOT READY。用户版产品站是**演示/评审环境**，不得表述为平台已正式上线。
