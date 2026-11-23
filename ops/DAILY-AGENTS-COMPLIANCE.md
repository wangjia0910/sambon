# 三宝殿平台「每日多智能体互动运营」合规与风险边界审查报告

> 审查日期：2026-11-23　｜　审查对象：`.github/workflows/daily-agents.yml` 及其驱动的自动化运营行为
> 审查基线：`CONTRACT.md` §10 六条红线、§11 **D-17**（一期正式上线 / 20 项外部证据转二期）；`docs/一期正式上线运营手册.md` v2.0
> 核对方式：**逐行读源码**，不引用泛化判断。所有结论均附 `文件:行号` 锚点。
> 性质声明：本报告为运营风险审查，**不构成法律意见**；一期「正式上线」不等于「通过合规审查 / 已备案 / 网信办认证 / 官方背书」。

---

## 0. 事实基线与两个前置发现

### 0.1 运营现状（来自 workflow，非推测）

| 项 | 事实 | 锚点 |
|---|---|---|
| 触发 | 每日 UTC 01:00（北京 09:00）+ 手动 `workflow_dispatch`；并发互斥 `cancel-in-progress:false` | `.github/workflows/daily-agents.yml:33-43` |
| 凭据池 | 3 个发布者（PUB1-3）+ 2 个完成者（WORKER1-2），仅邮箱/密码 secret，**无 admin secret** | `daily-agents.yml:70-82` |
| 业务量 | 每日合计发布 10 个任务、完成 1~2 个（`DAILY_COMPLETE_COUNT: '2'`） | `daily-agents.yml:66-68` |
| 目标站 | `API_BASE: https://sambon.net`，一期生产环境 `production/d1/v3.0.0`、真实 D1、真实账本 | `daily-agents.yml:66`；`prod/lib/api.js:45-47`、`api.js:493-495`；`ops/readiness.json:9` |
| 报告留存 | 写入 `ops/daily-agents/reports/YYYY-MM-DD.json`，上传 artifact 保留 **30 天** | `daily-agents.yml:98-102, 132-140` |
| 云端原因 | 本机网络对 sambon.net 做 TLS 中间人拦截，改由 GitHub runner 执行 | `daily-agents.yml:3-8` |

### 0.2 前置发现 A（落地缺口）：workflow 入口脚本当前不存在

workflow 第 130 行执行 `node ops/daily-agents/daily-run.mjs`，但仓库当前 **没有 `ops/daily-agents/` 目录及该脚本**；注释称脚本「由另一智能体编写」（`daily-agents.yml:85`）。

**结论**：该工作流目前会直接在运行脚本步骤失败；本报告对「自动化运营」的评估必须以**补齐并重新审查该脚本**为前提。若补脚本时擅自加入 admin 凭据或自动调用人工闸门，则构成红线回退（见 §2、§7）。

### 0.3 前置发现 B（可行性缺口）：现有凭据池无法走完状态机

状态机要求：`PENDING_REVIEW → PUBLISHED → DISPATCHING → ACCEPTED`（`src/domain.mjs:47-53`）。而：

- `hCreateTask` 只能建到 `PENDING_REVIEW`（`api.js:723-724, 766-769`）；
- 审核 `hReview` 是 **adminOnly**（`api.js:785-787`），通过后才冻结赏金并转 `PUBLISHED`（`api.js:797-811`）；
- 推送 `hDispatch` 是 **adminOnly**（`api.js:834-836`），之后任务才进入 `DISPATCHING`；
- 接单 `hAccept` 只允许 `DISPATCHING → ACCEPTED`（`api.js:916-925, 950`）。

**结论**：仅凭 PUB/WORKER 凭据，10 个任务会永久停在 `PENDING_REVIEW`，worker 根本无法接单，「每日完成 1~2 个」在代码层不可达。要闭环只有两条路：
1. **保留人工**：由有权人每日在运营台审核并触发推送（人工闸门不被脚本替代）——合规推荐；
2. **加入 admin secret 由脚本审核+推送**：把 §10.3 的「任务审核人工兜底」变成自动化，触碰红线，**不建议**，若采用须经有权人书面风险接受并保留审计留痕。

另注：本机 TLS 拦截的规避方式**不得**是关闭证书校验（如设置 `NODE_TLS_REJECT_UNAUTHORIZED=0`）；那会把真实账本的写操作暴露在中间人风险下，等同主动放弃传输层完整性。

---

## 1. 对真实账本的影响评估

### 1.1 资金腿的真实路径（非模拟）

| 动作 | 账本腿 | 锚点 |
|---|---|---|
| 账号注册 | `eco_incentive -1000` → `user:<id> +1000`（初始额度，非法币、不可兑付） | `api.js:563-583`（`INITIAL_SBC_DEFAULT=1000` 见 `api.js:47`） |
| 创建任务 | **不动账本**，仅余额预校验 + 违禁词预检 | `api.js:703-719` |
| 审核通过 | `user:publisher -(bounty+5%)` → `subject:frozen +(...)`，转 `PUBLISHED` | `api.js:797-811`；`domain.mjs:92-102` |
| 接单 | `subject:frozen -total` → `subject:escrow +total`，全额托管裁定前不转付 | `api.js:936-941, 950` |
| 验收通过 | `escrow -total` → `solver +bounty`、`platform_revenue +fee`；评价 ≥4.5 再 `eco_incentive -bonus`、`solver +bonus` | `api.js:391-410`；`domain.mjs:115-129` |
| 未托管撤回 | `frozen -total` → `publisher +total`（含 5% 服务费原路退） | `api.js:1467-1474` |
| 争议退款 | `escrow -total` → `publisher +total` | `api.js:1094-1101` |

结算同时写 `CreditTransferred` / `CreditChanged` / `SettlementCompleted` / `TaskDelisted` / `RankUpdated` 及 `audit_log`（`api.js:439-464`），并受 `settlement_guards` 原子守卫保护（D-16，`api.js:357-388`，已修复双花）。

### 1.2 SBC 转移量演算（按单任务赏金 B）

- 每任务冻结 `1.05B`；10 任务/日 → **发布方合计冻结 10.5B/日**（仅在实际审核通过后发生）。
- 完成 1~2 个 → **接单方入账 1B~2B/日**，平台收入 `0.05B~0.1B/日`；可选质量奖励上限 50 SBC/任务入接单方（`domain.mjs:87-88`）。
- 赏金**不回流发布方**：发布方可用 SBC 单调递减；无转让/兑付端点可补给（`api.js:522-525, 1795`）。

**余额耗尽风险**：3 个发布账号初始共 3000 SBC，按 B=100、10 任务/日即 1050 SBC/日冻结 → 约第 3 日触发 `INSUFFICIENT_BALANCE`（`api.js:717-719`、审核时 `api.js:799`）。
**禁止的「补救」**：每日新注册账号重复领取 1000 SBC 初始额度（`api.js:563-583`）属于刷初始额度 + 榜单污染，等同伪造生态激励支出；也不得由管理员直接改余额（无此端点，直接改 D1 属绕过账本哈希链）。
**可行控制**：固定账号池 + 低赏金（建议 ≤20~50 SBC，试运行手册测试上限 100）+ 只审核与当日完成数匹配的任务量 + 其余用 `hCancel` 未托管撤回（全额退，`api.js:1467-1474`）。

### 1.3 排行榜与任务列表污染

- **用户榜**：仅计「已验收通过任务的赏金本金」`net_sbc`（`domain.mjs:394-399, 462-499`；`api.js:1182-1195` 取全部 solver）。每日 1~2 个完成会让 agent worker 账号在榜上持续爬升；质量奖励、赠送、补偿不计入（`api.js:413-414`）。**不得**把 agent 完成量对外宣称为真实用户活跃。
- **任务榜**：`hLeaderboardTasks` 取 `created_at DESC LIMIT 200`（`api.js:1165`），过滤集合不含 `SETTLED`（`api.js:1169`、`domain.mjs:409`）。10 任务/日约 20 日即可占满榜单窗口，且已结算 agent 任务仍留在榜内，挤压真实用户任务曝光。
- **任务列表**：`hListTasks` 默认仅过滤终态（`REJECTED/CANCELLED/EXPIRED/CLOSED/DISCARDED/SETTLED`，`api.js:776-781`），`PENDING_REVIEW/PUBLISHED/DISPATCHING` 对全体登录用户可见；若无人审核，`PENDING_REVIEW` 无自动过期路径（`jobs.js` 不处理该状态），会永久堆积并污染运营队列（`api.js:1226`）。
- **风控副作用**：`postWriteEffects` 会对发布/验收等写动作做风控评估并可能写 `risk_flags`（`api.js:1345-1350`）；自动化高频写入需监控误报。

### 1.4 每日累积与账本守恒

- `jobs.cleanup` 只清理 `sessions`、`idempotency`、`notifications`、`email_verifications`、`rate_limits`（`jobs.js:131-168`）；**不清理 tasks / events / ledger_entries / audit_log / dispatches / reports / metrics / risk_flags**。
- 每任务约产生 1 个 `TaskPublished` + 1 个 `TaskUpdated/CreditFrozen` + 多个结算事件（13 类事件定义见 `api.js:51-62`），以及 2~4 条账本腿。90 天约 900 任务、上万条事件/账本行。
- 账本哈希链与 Merkle 锚定要求 `ledger_entries` 不可删（`schema.sql:65-76`；`api.js:1614-1644`），否则完整性校验失败。**不能**用删库方式控膨胀，只能控增量 + 外部归档。
- 运营纪律：每日做账本守恒 + 哈希链校验（手册 §4.2 / §5），差异 ≠ 0 立即冻结排查（手册 §6）。

---

## 2. 红线逐条核对（CONTRACT §10 + D-17）

| # | 红线 | 源码落地 | 本运营触碰点 | 结论 |
|---|---|---|---|---|
| 1 | SBC 非资产 | `/api/sbc/{transfer,trade,redeem,withdraw,exchange,yield,market}`、`/api/wallet/cashout` 共 8 条列于 `api.js:522-525`，**ROUTES 未登记**（`api.js:1710-1752`），未匹配即 404（`api.js:1795`）；文案 `sbc_notice` 见 `api.js:526` | 脚本不得实现/调用上述路径；成果与任务文案禁「提现/兑换/收益」 | **保持**。8 端点仍 404；出现任一可用即停服（手册 §5） |
| 2 | 零真实 PII | `sanitizeSubmissionText`（`domain.mjs:621-641`）、`sanitizeContact` 虚拟号（`domain.mjs:588-602`）、`hSubmit`（`api.js:977-990`）、`safePayload` 键白名单 + `redactDigits`（`api.js:64-94`） | 任务正文、成果正文、event payload；详见 §3 | **保持**，前提是脚本提交文本全为虚构样例 |
| 3 | 人工兜底 / 模型不直判 | `hVerify` 本人 approve、`auto_accept` 需 admin（`api.js:994-1003`）；`hReview` admin（`api.js:785-787`）；`hDispute(resolve)` admin（`api.js:1076-1080`）；`model_decision:null` 遍布 `api.js:527, 747, 1062, 1072, 1112, 1130, 1139, 1153`；cron 只出工单（`api.js:1663`） | **核心风险**：脚本自动 approve / 自动 review 会把人工闸门退化为账号自动闸门；worker 代验会被 403 | **形式满足、实质待补强**（见 §2.1） |
| 4 | 个性化可关 | GPC 自动关（`api.js:1802-1809`）；账号级开关；`hDispatch` 任一候选关闭即整体中性排序（`api.js:846-852`） | 脚本不得批量改偏好以操纵曝光；不得关闭 GPC 语义 | **保持** |
| 5 | 18+/违禁预检/举报 | `compliancePrecheck` 一票否决（`api.js:706-712`；词表 `domain.mjs:576-580`）；`hReports`（`api.js:1265-1282`）；未成年人仅钩子占位（`domain.mjs:653-663`） | 任务文案命中违禁词会被 422 并写 `RiskBlocked`；**不得**声称已做真实年龄核验（E-11 未核销） | **保持**（钩子层面）；真实验证能力属二期 |
| 6 | 零 PII 上链 | `hAdminAnchor` 只做本地 Merkle 摘要，`pii_on_chain:false`（`api.js:1614-1644`）；`domain.mjs:653-676` 钩子不采 PII | 脚本不得把任务正文/成果写入锚定材料或 meta 自由文本 | **保持** |
| 7 | 虚构样例 | `domain.mjs:7` 声明、手册 §2.3、红线 §10.7 | agent 任务的标题/描述/验收/成果必须虚构并标注 | **取决于脚本内容**，须在补脚本时逐条审 |
| D-17④ | 不宣称合规审查/备案/认证/背书 | 手册 §1、§7 明示；`ops/readiness.json` 仅 E-01/E-02 为 true（2/20） | 报告、提交信息、任务正文、对外公告均不得出现上述措辞 | **保持**，需写入脚本输出模板 |
| D-17③ | 20 项证据不阻塞、不伪造核销 | `ops/readiness.json:1-166` 原样保留 2/20 | 自动化脚本不得生成/修改 `readiness.json`，不得自称把闸门跑绿 | **保持** |

### 2.1 如何保持「发布方本人确认」语义（关键）

源码语义（`api.js:994-1003`）：

```
decision === 'auto_accept'  → requireRole(admin)          // 管理员代确认，写 auto_verified:true
decision === 'approve'      → row.publisher_id === u.user_id，否则 403 FORBIDDEN
decision === 'reject'       → 同样限本人，≤2 次（api.js:1005-1007）
```

必须遵守的四条：

1. **同一 user_id**：由「创建该任务」的那个 PUBn 账号调用 `/verify`，不能由 WORKER、其他 PUB 或共享账号代验（否则 `FORBIDDEN 403`）。
2. **禁用 `auto_accept`**：一旦使用即切换为 admin 身份、写 `trigger:auto_verify`、`auto_verified:true`、`actorId=admin`（`api.js:1020-1026, 462`），「本人确认」语义丢失且留下自动验收审计痕迹。
3. **完整会话与 CSRF**：SimClient 已封装 cookie/CSRF/event_id（`ops/multiagent-client.mjs:35-55, 62-74`）；脚本不得绕过 CSRF 或用静态 token 复用会话。
4. **幂等**：每步带 `event_id`（`api.js:997` 的 `withIdempotency`），避免重放导致重复结算。

**形式满足 ≠ 实质满足**：若脚本持有发布方凭据自动 approve，代码闸门会通过，但「人工兜底」在实质上退化为「凭据持有者自动兜底」。这与 §10.3 / D-17⑤ 的立法意图存在张力。建议二选一：

- **推荐**：把 `/verify`（以及 `/review`）保留为人工步骤，由有权人在运营台点击确认；脚本只做到「提交成果」为止；
- **若业务必须全自动**：至少做「预授权 + 事后人工复核」——每日人工核对 `audit_log` 中 `SETTLEMENT_CONFIRMED`（`api.js:462`）与账本守恒，保留停止开关；且**绝不在同一个脚本内串起 发布→审核→推送→接单→提交→验收→结算 全链**。

---

## 3. PII 与脱敏要求（智能体成果文本如何合规）

### 3.1 三层防护与源码顺序

1. **提交正文层**：`sanitizeSubmissionText`（`domain.mjs:621-641`）按以下顺序替换，均加数字边界 `(?<!\d)…(?!\d)`：
   - `(?<!\d)\d{17}[\dXx](?!\d)` → 18 位证件号**优先**；
   - `(?<!\d)1[3-9]\d{9}(?!\d)` → 11 位手机号次之；
   - `(?<!\d)\d{6,}(?!\d)` → 兜底任意 ≥6 位连续数字。
   
   顺序原因是 18 位证件号中间含可被手机号规则命中的 11 位串（V-14 边界缺陷，`domain.mjs:624-633`）。返回 `pii_redacted / redacted_count / original_stored:false`。
2. **落库层**：`hSubmit` 只把 `safe.text` 写入 `tasks.result_text`，并置 `result_pii_redacted`；事件只记布尔与计数，**不记正文**（`api.js:977-990`）。
3. **事件/日志层**：`safePayload` 键白名单 + `redactDigits` 对字符串值再脱敏（`api.js:64-94`）；联系方式一律虚拟号（`api.js:728`）。

### 3.2 脚本必须内建的断言

- 提交成功后取 `result_preview`（`taskView` 提供）断言 **`!/\d{6,}/.test(preview)` 且 `result_pii_redacted === true`**——与现有回归同口径（`tests/verify-cloudflare.mjs:214`、`tests/verify-production.mjs:225`、`tests/verify-local.mjs:305-312`）。断言失败立即停止当日运营并告警。
- 成果文本切片上限 20000 字符（`api.js:977`）；不要绕过截断。
- 正文不得包含：真实姓名+证件号/手机号组合、门牌地址、精确经纬度（schema 无坐标字段，勿在 meta 自由文本里写）、真实邮箱（注册邮箱仅作账号凭据，使用专门受控域名，不冒充真实用户）。
- 发布前 `compliancePrecheck`（`api.js:706`）自动拦截违禁词；脚本不得通过拆词/编码绕过预检。
- 误填真实 PII 的处置：运营立即编辑脱敏或 `hCancel`，记入 `ops/pilot-incidents.md`（手册 §2.3），**不得**直接改 D1 绕过脱敏与审计。

---

## 4. 数据留存 / 清理建议（每日 10 任务累积）

| 对象 | 现状 | 建议 |
|---|---|---|
| `tasks` | 无自动清理；非终态对全体用户可见（`api.js:776-781`） | 固定账号池 + 低赏金；当日只审核与完成数匹配的任务，其余用 `hCancel` 撤回（全额退，`api.js:1467-1474`），避免 `PENDING_REVIEW` 永久堆积 |
| `events` / `ledger_entries` / `audit_log` | 无清理；账本哈希链 + Merkle 锚定要求不可删（`schema.sql:65-76`；`api.js:1614-1644`） | **不删**；每日跑账本守恒 + 哈希链校验（`hAdminOps` 提供 `ledger_integrity`，`api.js:1668-1698`）；异常冻结（手册 §4/§6） |
| `idempotency` / `sessions` / `notifications` | `jobs.cleanup` 已按 30 天/过期清理（`jobs.js:137-167`） | 保持定时调用 `/api/admin/cron`（需 `CRON_SECRET`，`api.js:1648-1665`），但注意 cron **只出工单不结算** |
| `reports` / `risk_flags` / `metrics` | 无自动清理 | 设月度归档与阈值熔断；`risk_flags` 误报需 admin 人工 resolve（`api.js:1558`） |
| 本地报告 `ops/daily-agents/reports/*.json` | artifact 保留 30 天（`daily-agents.yml:139`） | 仓库内按月压缩归档或定期清理；**不写 D1**；报告只含 trace/计数，不含 PII 与正文 |
| 账号擦除 `DELETE /api/me` | 仅匿名化用户，且存在非终态任务时 409（`api.js:1307-1331`） | **不得**用它「清空 agent 痕迹」；tasks/ledger 依法/按设计保留 |
| 标记与可追溯 | 无内建 agent 标记 | 任务标题固定前缀（如 `【AGENT-DAILY】`）+ `meta_json` 内加 `kind:'agent_daily'` 枚举值（只放枚举/布尔，不放 PII），便于批量检索与单独统计 |

**熔断阈值建议**（触发即暂停 workflow、人工评估，对齐手册 §6）：任务总数或 90 日事件数超预设值；发布方可用 SBC 低于 3 日所需；任务榜前 200 中 agent 任务占比 > 50%；账本差异 ≠ 0；出现无人工确认的结算记录。

---

## 5. 对外口径边界（账号 / 任务如何标注，避免误导真实用户）

**允许说**（手册 §7）：

- 「三宝殿一期正式上线版本」「面向公众开放，真实账号与账本，SBC 为平台内贡献积分，不可兑付」。

**禁止说**：

- 「已通过合规审查 / 已备案 / 网信办认证 / 官方背书」——D-17④ 明确禁止，是对有权人风险接受的如实记录（手册 §1、§7）；
- 宽泛的「平台已上线运营 / 已开放注册」——手册 §7 同时列为禁止，只说「一期正式上线」；
- SBC 可「提现 / 兑换 / 交易 / 变现 / 产生收益」；
- 把 2/20 外部证据说成「已核销」，或把 agent 运营说成「L1 灰度结果 / 二期证据」（E-19 未核销）。

**智能体账号标注**：

- `display_name` 明确含「智能体 / AGENT / 自动化运营」，如 `AGENT-PUB-01`、`AGENT-SOLVER-01`；注册邮箱用专门受控域名，**不使用真人姓名或真实组织身份**。
- 任务标题与描述首行标注「【自动化运营任务 · 虚构样例】」，与真实用户发布的需求明确区分；`acceptance_criteria` 同样虚构。
- 不宣称智能体是真人、不代表平台官方立场、不为任何真实用户/商户背书。

**数据口径**：对外披露的 DAU / 真实任务完成量 / 榜单数据须**剔除** agent 账号贡献；内部报告单列 agent 指标，防止把自动化活跃包装成真实用户增长。隐私政策 / ToS / AUP 尚未法务定稿（E-09 未核销），公告保持保守。

---

## 6. 与 D-17 分期口径一致性结论

| D-17 条款 | 本运营一致性 | 说明 |
|---|---|---|
| ① 一期正式上线 / 二期增强 | **一致** | 在一期真实 D1 上运营，与「一期正式上线」定位相符；不据本运营主张二期能力 |
| ② 上线依据（17/17 + 6 角色/847 请求/98 检查项） | **一致但不替代** | 本运营不是验收依据；补齐 `daily-run.mjs` 后应作为新增回归项，不得回写 readiness 结果 |
| ③ 20 项证据 2/20、不阻塞、不伪造 | **一致** | `ops/readiness.json` 原样保留；脚本禁止生成/修改核销字段 |
| ④ 不宣称合规审查/备案/认证/背书 | **一致（需持续约束）** | 报告、脚本输出、任务文案、公告均按 §5 执行 |
| ⑤ §10 六条红线仍是产品不变量 | **形式一致，实质有两点张力** | (a) 现有凭据池缺 admin，审核/推送无法自动完成，若补 admin secret 自动化则弱化「人工兜底」；(b) 若脚本自动 approve，结算「本人确认」退化为凭据自动确认（§2.1） |
| ⑥ 全仓文字统一为「一期正式上线」 | **一致** | 本报告沿用一期口径并保留真实性声明 |

**总体结论**：在满足以下前提时，本运营与 D-17 **一致**：
1. 补齐并重新审查 `ops/daily-agents/daily-run.mjs`（当前缺失）；
2. 低赏金 + 固定账号池，禁止每日新注册刷初始额度；
3. **保留人工审核（`hReview`）与人工推送（`hDispatch`）**，不向脚本注入 admin 凭据替代人工闸门；
4. `/verify` 由发布方本人账号确认，且建议由人工在运营台点击或事前授权 + 当日审计复核；禁用 `auto_accept`；
5. 任务/账号按 §5 标注，对外数据剔除 agent 贡献；
6. 每日账本守恒 + 审计抽查，不删账本/事件，设熔断阈值。

若不满足第 3/4 项（尤其「同一脚本全链自动结算」），则构成对 D-17⑤「人工兜底」的**实质回退**，应暂停运营并提请有权人书面风险接受。

---

## 7. 「必须人工确认」vs「可自动化」动作分界表

| 动作 | 端点 | 源码闸门 | 分类 | 执行条件 / 备注 |
|---|---|---|---|---|
| 注册智能体账号 | `POST /api/auth/register` | 仅 publisher/solver、非一次性邮箱、密码 10–128（`api.js:548-556`） | **一次性可自动化**（禁止每日新建） | 固定账号池；每日新建=刷初始额度（`api.js:563-583`） |
| 创建任务 | `POST /api/tasks` | publisher/admin 角色、违禁词预检、余额预校验（`api.js:698-719`） | **可自动化** | 虚构样例 + `【AGENT-DAILY】` 标注 + 低赏金 |
| 审核任务 | `POST /api/tasks/:id/review` | `requireRole(admin)` + `TASK_REVIEW_MANUAL` 审计（`api.js:785-787, 825-828`） | **必须人工（admin）** | 有权人在运营台确认；脚本不得代点（§0.3） |
| 触发推送 | `POST /api/tasks/:id/dispatch` | `requireRole(admin)`（`api.js:834-836`）；任一候选关个性化即中性排序（`api.js:846-852`） | **必须人工授权（admin）** | 可脚本触发但属管理动作；不得用于操纵榜单曝光 |
| 接单 | `POST /api/tasks/:id/accept` | solver 角色 + `hardFilter` + `version` CAS（`api.js:916-934`） | **可自动化** | WORKER 账号；不得与发布方互为关联方（`domain.mjs:191`） |
| 提交成果 | `POST /api/tasks/:id/submit` | 仅指派 solver + `sanitizeSubmissionText`（`api.js:968-981`） | **可自动化** | 正文虚构 + §3.2 断言（无 ≥6 位连续数字） |
| 验收 `approve` / `reject` | `POST /api/tasks/:id/verify` | **本人** `publisher_id === user_id`，否则 403；`reject ≤2`（`api.js:994-1007`） | **必须人工（形式可由本人账号执行，实质建议人工点击）** | 同一 PUBn 账号；**禁用 `auto_accept`**；禁 worker 代验；当日审计 `SETTLEMENT_CONFIRMED` |
| 自动验收 `auto_accept` | 同上 | `requireRole(admin)`（`api.js:1002`） | **禁止自动化** | 会写 `auto_verified:true`，破坏「本人确认」 |
| 发起争议 `open` | `POST /api/tasks/:id/dispute` | 仅相关方或 admin（`api.js:1045-1046`） | **可自动化但仅限真实争议** | 不得为凑流程伪造争议 |
| 争议裁定 `resolve` | 同上 `action=resolve` | `requireRole(admin)` + `arbitrator:'人工裁定'` + `model_decision:null`（`api.js:1076-1080, 1112-1130`） | **必须人工（admin）** | 脚本不得调用；全额托管裁定前不转付 |
| 取消任务（清理用） | `POST /api/tasks/:id/cancel` | 发布方/admin + `TASK_CANCEL_MANUAL` 审计（`api.js:1438-1490`） | **可自动化** | 未托管全额退（含服务费）；用于抑制任务堆积 |
| 风控处置 | `POST /api/admin/risk/resolve` | admin（`api.js:1558`） | **必须人工（admin）** | 自动化运营触发的 `risk_flags` 由人工复核 |
| 备份 / 锚定 / cron | `/api/admin/backup|anchor|cron` | admin 或 `CRON_SECRET`；cron 只出工单（`api.js:1574, 1614, 1648-1665`） | **必须人工授权** | 锚定零 PII、零正文；不得删账本 |
| 数据导出 / 擦除 | `GET /api/me/export`、`DELETE /api/me` | 本人 + CSRF；非终态任务 409（`api.js:1285-1331`） | **按需，不用于日常清理** | 不得借此抹除 agent 运营留痕 |
| 8 条 SBC 资产化端点 | `/api/sbc/*`、`/api/wallet/cashout` | 路由未登记 → 404（`api.js:1795`） | **严禁触碰** | 出现任一可用 = 立即停服（手册 §5） |

---

## 8. 核心结论摘要（≤10 条）

1. **当前 workflow 不可落地**：`ops/daily-agents/daily-run.mjs` 不存在，运行即失败；补齐后须重新按本报告审查。
2. **现有凭据池无法闭环**：PUB/WORKER 无 admin，`hReview`/`hDispatch` 均 adminOnly，任务停在 `PENDING_REVIEW`，worker 无法接单；「每日完成 1~2 个」代码上不可达。
3. **最大红线风险是「人工闸门自动化」**：若补 admin secret 让脚本审核/推送，或脚本自动 `/verify`，则会把 §10.3/D-17⑤「人工兜底」实质回退——这是是否允许上线的分水岭。
4. **「发布方本人确认」必须同 user_id**：由创建任务的 PUBn 账号 approve，禁用 `auto_accept`，禁 worker/其他账号代验；形式满足仍建议人工点击或事前授权 + 当日审计。
5. **真实账本会单调消耗 SBC**：10 任务/日按 B=100 即冻结 1050 SBC/日，3 个初始账号约 3 日耗尽；禁止每日新注册刷 1000 初始额度。
6. **榜单与列表会被污染**：用户榜累积 agent `net_sbc`，任务榜 `LIMIT 200` 且不排除 `SETTLED`，约 20 日挤满；需标注、低量、撤回未审核任务并对外数据剔除。
7. **PII 脱敏机制完备但需脚本自检**：证件号→手机号→≥6 位数字三段正则 + 数字边界，落库只存脱敏文本、事件只存计数；提交后断言 `!/\d{6,}/` 与 `result_pii_redacted`。
8. **数据不能靠删库控膨胀**：cleanup 只清 5 类短生命周期表；ledger/events/audit 因哈希链与审计须保留，改为控增量 + 每日守恒校验 + 熔断阈值。
9. **对外口径必须双标**：可说「一期正式上线」，禁止「已通过合规审查/已备案/网信办认证/官方背书」与宽泛「平台已上线运营」；智能体账号与任务需显式标注为自动化虚构样例。
10. **与 D-17 有条件一致**：满足「补脚本、低赏金固定池、人工 review/dispatch、本人 verify、标注、对账、不伪造 2/20」即一致；否则暂停运营并提请有权人书面风险接受。本报告不构成法律意见。
