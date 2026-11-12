# 法务交叉评审 · 阶段 B（legal-review.md）

| 项 | 内容 |
|---|---|
| 评审角色 | 法务合规负责人（依 `CONTRACT.md` §9 对红线行使一票否决权） |
| 评审阶段 | 阶段 B 交叉评审（契约 §9：三方各读另外两方产出，写 `review/*-review.md`） |
| 核验基线 | `三宝殿项目方案_v1.0.md`（只读）、`CONTRACT.md` v0.1、`COMPLIANCE.md`、`docs/03`、`docs/07` |
| 实读范围 | `README.md`、`docs/01-产品需求与路线图.md`、`docs/02-技术架构与接口契约.md`、`src/domain.mjs`、`src/store.mjs`、`src/server.mjs`、`web/index.html`、`tests/smoke.mjs` |
| 核验方式 | Read 全文 + Grep 定向检索取证（文件名 + 函数名 / 关键行内容），**不采信文档自述** |
| 本轮性质 | 项目初版演示（契约 §0）：不接真实支付 / 真实大模型 / 公链，演示数据全部虚构，不构成上线运营或法律意见 |
| 判定尺度 | 不把「尚未生产化」误判为违规；但「存在转让接口」「明文 PII」「模型直判结算」「无个性化开关」四条属真实红线，出现即一律不通过 |

## 0. 核验结论摘要

四条真实红线**逐条证伪（未出现）**：

| 真实红线 | 核验结果 | 关键证据 |
|---|---|---|
| 存在 SBC 转让 / 兑换 / 交易 / 法币 / 收益类接口或文案 | 未出现 | `server.mjs:750-766 ROUTES` 仅登记契约 §8 路径；`server.mjs:843-844` 未登记一律 404；`tests/smoke.mjs:216-226` ⑥ 对 6 个禁用路径断言 404；`store.mjs:595` `sbc_transfer_or_redeem_api:false`；`domain.mjs:576-580` 的「收益承诺 / 法币兑换 / 二级市场」为 `BANNED_WORDS` 发布拦截词，非鼓励性文案 |
| 采集 / 存储明文手机号 / 身份证 / 精确定位轨迹 | 未出现 | `domain.mjs:596-602 sanitizeContact()` 忽略输入、只返回 `makeVirtualNumber()` 占位且 `stored_plaintext_pii:false`；`server.mjs:284` 仅用 `sanitizeContact(body.contact).contact`；`web/index.html:168` 明示「无需也不允许填写真实号码 / 证件信息」，全页无手机号 / 身份证输入控件；`store.mjs:73-217 demoUsers()` 只有 `distance_km` 标量，无轨迹 |
| 结算 / 争议裁定 / 账号处罚由模型直判 | 未出现 | `server.mjs:124-191 settleTask()` 纯规则记账、无任何模型调用；`domain.mjs:554-569 summarizeDispute()` 固定 `decision:null`；`server.mjs:662-699 hDispute(resolve)` 需显式 `action:'resolve'`，返回 `arbitrator:'人工裁定演示'` / `model_decision:null`；`server.mjs:567-570 hVerify` 限定 `SUBMITTED`，阻断争议态借验收转付 |
| 无「关闭个性化推荐」开关 / 非服务端强制 | 未出现 | `server.mjs:723-744 hPreferences` 为 `store.preferences` 唯一写入点；`server.mjs:363` `const personalized = store.preferences.personalized_enabled` 忽略客户端传参；`server.mjs:456` 榜单同源读取；`store.mjs:592` `personalization_enforcement:'server_side'`；`tests/smoke.mjs:228-249` ⑦ 断言客户端强制开启仍返回 `mode:'neutral'` |

统计：红线核验 **12 项** → 符合 **9**、部分符合 **3**、不符合 **0**（详见第一节）。

> **评审期间代码变更复核**：本轮评审过程中，产品 / 研发交付物被并行更新（`README.md`、`docs/01`、`docs/02`、`src/`、`web/`、`tests/` 时间戳 14:04–14:17）。法务已对四条真实红线重新 Grep 复核：`ROUTES` / 404、虚拟号与 `sanitizePayload`、`settleTask` 人工兜底、服务端个性化开关、`on_chain_fields` 均仍成立（行号以复核时点为准）。但研发在复核时点**新增了 `SettlementRequested` 事件**（`server.mjs:144-150`、`tests/smoke.mjs:318-329` 断言 ⑫），而 `CONTRACT.md` 未同步（时间戳仍 13:40）、`docs/01:306` 与 `review/product-review.md:79-83` 裁决不采用，形成三方事件名分裂 —— 详见 M3 与第三节.2。

---

## 一、红线核验表（CONTRACT §10 七条 + docs/03 §4 硬性约束，逐条取证）

| # | 依据 | 核验项 | 结论 | 证据（文件 + 函数 / 关键行内容） | 风险等级 |
|---|---|---|---|---|---|
| R1 | §10.1 / §4-1 | 禁止 SBC 转让、交易、法币兑换、收益承诺、二级市场类接口或文案 | **符合** | `server.mjs:750-766 ROUTES` 仅契约 §8 的 15 条 API + 静态页；`server.mjs:843` 「未登记接口一律 404」；`tests/smoke.mjs:217-225` ⑥ 6 个禁用路径全 404 且 `compliance.sbc_transfer_or_redeem_api === false`；`web/index.html:300` 徽章「SBC 转让/兑换 **不提供**」；全库 Grep 无正向交易 / 升值 / 投资表述 | 低 |
| R2 | §10.2 / §4-2 | 禁止明文 PII；联系方式虚拟号；日志与事件脱敏 | **部分符合** | 符合面：`domain.mjs:588-602 makeVirtualNumber()/sanitizeContact()` 无条件返回虚拟号、`stored_plaintext_pii:false`；`server.mjs:284` 只取虚拟号；`store.mjs:40-57 sanitizePayload()` 剥离 `phone/mobile/id_card/...` 敏感键并对字符串抹除 `1[3-9]\d{9}` 与 `\d{17}[\dXx]`；`store.mjs:329-342 appendEvent()` 强制 `Object.freeze(sanitizePayload(payload))`。缺口：`store.mjs:38 SENSITIVE_KEY` 为**键黑名单**，`server.mjs:582` `TaskVerified` reject 的 `payload.reason = String(body.reason ?? '')` 等自由文本键未纳入剥离，仅靠字符串正则兜底，任务正文 / 非标准 PII 可经自由文本进入 `GET /api/events`；而 `docs/02:83` 与 `web/index.html:533` 宣称「剥离 PII 与任务正文键」「零 PII / 零任务正文」 | 中（见 S1） |
| R3 | §10.3 / §4-3 | 结算、争议裁定、账号处罚不得由模型直判 | **符合** | `server.mjs:124-191 settleTask()` 纯规则 `legs` + `postLegs`，无模型调用；`domain.mjs:566` `decision:null`；`server.mjs:669` 注释「人工裁定（模型不直判）」、`server.mjs:688` `arbitrator:'人工裁定演示'`、`server.mjs:696` `model_decision:null`；`tests/smoke.mjs:269-279` ⑧ 断言争议态无 `SettlementCompleted` / `CreditTransferred` 且借验收接口被 `ILLEGAL_TRANSITION` 拒绝 | 低 |
| R4 | §10.4 / §4-4 | 必须提供关闭个性化开关，服务端强制生效，关闭后时间 + 距离中性排序 | **符合** | `store.mjs:245 this.preferences = { personalized_enabled: true }` 单一事实源；`server.mjs:723-744 hPreferences` 唯一写入点、`enforcement:'server_side'`；`server.mjs:362-366 hDispatch` 忽略 `body.personalized/enabled`，关闭时走 `neutralCandidates`；`server.mjs:455-464 hLeaderboardTasks` 关闭时走 `neutralTaskOrder`；`domain.mjs:338-377 neutralCandidates()` 仅用 `registered_at` + `distance_km`、`score:null`、`reason_codes` 仅 `NEUTRAL_*`；`tests/smoke.mjs:236-247` ⑦ 客户端强开仍中性 | 低（账号级差异见 M2） |
| R5 | §10.5 / §4-5 | 未成年人限制、违禁任务预检、举报入口、算法 / 区块链备案列为上线一票否决 | **部分符合** | 已落地：`domain.mjs:604-615 compliancePrecheck()` + `server.mjs:245-250` 发布时命中 `BANNED_WORDS` 即 `COMPLIANCE_BLOCKED` 并落 `RiskBlocked`；`web/index.html:341-348` 「试一下违禁词拦截」按钮。未实现但**已如实登记**：`docs/02:260` 「未成年人限制、举报入口、两项备案为原型未实现」、`docs/02:237` §10.1 已知限制、`docs/01:411` §9 交接结论、`README.md:83` 「初版仅演示其在产品流程中的位置，不替代真实核验与备案」。按契约 §0 / §10.5 属「上线一票否决项」，本轮未上线，**不误判为违规** | 高（上线前，见 V8 / S3） |
| R6 | §10.6 / §4-6 | 链仅本地 Merkle + 可插拔锚定；零 PII、零任务正文上链 | **符合** | `store.mjs:421-424 postLegs()` 的 `hashInput` 只含 `seq/event_id/task_id/rule_version/account/delta/before/after/safeMemo/prevHash`，且 `safeMemo`（:394）已抹除手机号 / 身份证；`store.mjs:509-541 anchorLedger()` 的 `on_chain_fields` 白名单仅哈希与元数据、`privacy_scan` 结果 `pii_on_chain:false / task_text_on_chain:false`；`store.mjs:60-67 scanAnchorText()`；`store.mjs:603-606 config.chain.mode:'local-merkle-demo'`，无公链调用 | 低 |
| R7 | §10.7 / §4-7 | 演示数据全部虚构，无真实个人信息 | **符合** | `store.mjs:73-217 demoUsers()` 为「演示发布方A / 接单人甲…戊 / 平台运营演示」；`tests/smoke.mjs:76-90 newTask()` 描述含「纯虚构样例…不涉及任何真实个人信息」；`web/index.html:106/161/549`、`server.mjs:613` 明示虚构；全库 Grep 无真实姓名 / 证件 / 联系方式 | 低 |
| R8 | §4-补1 | 模型降级：三适配接口规则化兜底，模型不可用推送不中断 | **符合** | `domain.mjs:512-533 extractTaskStructure()` / `:536-551 semanticMatchHint()` / `:554-569 summarizeDispute()` 均 `degraded:true`；`store.mjs:583-590 config.algorithm` 固定 `degraded:true / llm_mode:'rule_fallback' / dispatch_continues_on_degrade:true`；`tests/smoke.mjs:281-289` ⑨ | 低 |
| R9 | §4-补2 | 幂等与可审计（task_id + event_id + version、只追加、可回放） | **符合** | `server.mjs:67-76 withIdempotency()`；`store.mjs:383-441 postLegs()` 二级幂等 `ledgerEventIds` + `Σdelta===0` + `Object.freeze`；`store.mjs:329-342 appendEvent()` 只追加冻结对象；`server.mjs:713-715 hEvents` 按 `task_id` 回放；`tests/smoke.mjs:179-193` ③、`:291-301` ⑩ | 低 |
| R10 | §4-补3 | 服务端强制中性排序（非客户端） | **符合** | 与 R4 同源但独立核验：`server.mjs:194-212 neutralTaskOrder()`（按 `created_at` + `radius_km`）、`domain.mjs:338-377 neutralCandidates()`；`server.mjs:363` 与 `:456` 两处读取点均只读服务端值；`tests/smoke.mjs:237` 注释「客户端尝试强制开启个性化：服务端必须忽略」 | 低 |
| R11 | §4-补4 | Merkle 演示不上链 PII / 任务正文 | **符合** | 与 R6 同源但独立核验：哈希输入与 `on_chain_fields` 白名单均不含 PII / 正文；`LedgerAnchored` 事件载荷（`store.mjs:530-539`）仅 `anchor_id / merkle_root / ledger_count / privacy_scan` | 低 |
| R12 | §4-补5 | 权重版本留痕（评审 + 公示 7 天 + 可回滚） | **部分符合** | 已落地：`domain.mjs:149 WEIGHT_VERSION='v1.0'`、`:383 RANK_WEIGHT_VERSION='v1.0'`、`store.mjs:575-576` 随 `/api/config` 暴露、每条命中带 `weight_version`。未落地：`docs/02:236` §10.1 第 4/6 条明列「无 A/B 与权重灰度发布」「无反作弊回溯重算、公示记录」为 P1；F-08「记录完整率 100%」的评审签字 / 公示 7 天 / 可回滚本轮未实现。属初版范围外且已如实登记，不误判为违规 | 低（见 S4） |

> 说明：R5「部分符合」与 R12「部分符合」均为「初版范围外、已如实登记、上线前必须完成」，不是红线被违反；R2「部分符合」为可立即收紧的实现缺口。R10 / R11 与 R4 / R6 同源，按 `docs/03` §4 补充项独立取证。

---

## 二、发现的问题清单

### 2.1 必须整改（阻断通过，共 4 项）

> 以下问题只写整改要求与验收方式，**由对应责任方自行修改文件**；法务本轮不改动代码、README、CONTRACT、方案及他人评审文件。

**M1【产品｜冻结时点口径与基线 / 实现冲突】**

- 问题：`docs/01:202-203`（US-01 期望「冻结…状态进入 `PENDING_REVIEW`，写 `CreditFrozen`」）、`docs/01:162`（§2 范围表「`POST /api/tasks` 冻结额 = 赏金 + 5% 服务费」）、`docs/01:285`（§4.1 主流程第 2 步「C 调 A 冻结…`PENDING_REVIEW`｜`CreditFrozen`」）均写「发布即冻结」；而 `CONTRACT.md:70`（§5「发布审核通过｜冻结 赏金 + 5% 服务费」）、方案 `:283`（§4.1.4「触发＝审核通过」）、方案 `:406`（§4.3.2「`PUBLISHED`＝已发布、赏金已冻结」）、`server.mjs:254-271 createTaskImpl()`（仅 `INSUFFICIENT_BALANCE` 预校验，`frozen_total:null`）、`server.mjs:319-335 hReview()`（approve 才 `postLegs` 冻结）、`web/index.html:128/171`（「平台审核（冻结…）」「赏金在审核通过时冻结」）均为「审核通过时冻结」。产品 PRD 与唯一共同基线及代码 / 操作台冲突。
- 可执行要求：① 产品把 `docs/01` 三处统一为「发布阶段仅合规预检 + 余额预校验（不划转），状态 `PENDING_REVIEW`；审核通过进入 `PUBLISHED` 时冻结赏金 + 5% 服务费并写 `CreditFrozen`」；② 主代理在 `CONTRACT.md` 登记两处差异：`§8` 括注「发布任务（合规预检 + 冻结积分）」与 `§5` 的冲突、方案 §5.1 时序第 2 步（`:499` 冻结）与 §4.1.4 / §4.3.2 的内部冲突，按契约文末「变更须由主代理统一更新版本号并通知三方」处理；③ 三方交付物不再出现「发布即冻结」表述。
- 验收方式：全库 Grep「冻结」口径一致；实跑 `POST /api/tasks` 后查 `GET /api/ledger/U-PUB-A` 无 `freeze:` 流水、`frozen_total` 为 null，再 `POST /api/tasks/:id/review` approve 后出现唯一 `CreditFrozen` 事件与冻结流水（`tests/smoke.mjs:179-193` ③ 已覆盖该幂等口径）；`docs/01` 与代码、操作台表述一致。

**M2【产品 + 研发｜D8「账号级」不实表述与差异登记】**

- 问题：方案 `:609`（§7.5 D8）建议「账号级，且服务端强制执行」；`docs/01:395`（§8）「按建议：`POST /api/preferences/personalized` 服务端强制生效」、`docs/01:405`（§9）「实现层级按 D8 定账号级」；但 `store.mjs:245 this.preferences = { personalized_enabled: true }` 为**进程级全局单例**，`server.mjs:723-744 hPreferences(body)` 只写单一布尔值、不接收 `user_id`，`server.mjs:363` / `:456` 全局读取 —— 一人关闭即全进程用户生效，并非账号级。法务首轮 `COMPLIANCE.md:32` 亦写「账号级」（本轮自修，见下）。
- 可执行要求：① 研发在 `docs/02` §10.1 已知限制与 §11 待确认项如实登记「初版为进程级全局开关（关闭影响全进程），账号级按 `user_id` 隔离列 P1」；② 产品把 `docs/01:395` D8 本轮处置改为「初版为进程级全局开关（服务端强制），账号级列 P1」，`docs/01:405` 删除「按 D8 定账号级」已完成式表述；③ 法务在 `docs/07` 增列上线前「账号级隔离」验收项；④ 任何演示 / 对外材料不得宣称已实现账号级。
- 验收方式：全库 Grep「账号级」无「已实现」表述；`docs/02` §10.1 有差异登记；`docs/07` 有对应检查项；正式上线前以两个不同 `user_id` 分别关闭 / 开启，验证互不影响、且关闭后各自仍按时间 + 距离中性排序。

**M3【主代理 + 产品 + 研发｜`SettlementRequested` 事件名三方分裂，须二选一收敛】**

- 问题：方案 `:425`（§5.1 第 5 步）、`:466`（§4.3.1 模块表）、`:507`（§5.1 第 10 步）出现 `SettlementRequested`；但 `CONTRACT.md:53-64` §4 事件清单（唯一事件总线契约）**未收录**，`docs/01:47-58` §0.3 照抄契约 §4。产品侧已明确收敛：`docs/01:306` §4.1 口径说明「产品侧不引入该事件名」、`review/product-review.md:79-83` 裁决 2「初版**不采用** `SettlementRequested`」，并要求主代理登记差异、法务对齐 `docs/03`。**但研发在阶段 B 并行更新中单方补发了该事件**：`server.mjs:144-150` 在 `settleTask()` 内先发 `SettlementRequested`（`arbitrator:'人工/规则编排（模型不直判）'`、`model_decision:null`、自身不记账），`tests/smoke.mjs:318-329` 新增断言 ⑫ 校验其先于 `CreditTransferred` / `SettlementCompleted`。而 `CONTRACT.md` 时间戳仍为 13:40、主代理未登记差异 —— 形成「产品不采用 / 研发已采用 / 契约未登记」的**三方分裂**，违反契约 §0「三方产出必须与本契约的术语、状态、事件、数值口径一致」。法务首轮 `docs/03` §4 亦曾误用该名（本轮已自修）。
- 可执行要求（**二选一，不得维持分裂**）：① **路径 A（法务推荐）**：按 `CONTRACT.md` §4 与产品裁决，研发回退该事件（删除 `server.mjs:144-150` 与 `tests/smoke.mjs` ⑫，或改为不发事件的内部编排），交付事件名统一为 `CreditTransferred` / `SettlementCompleted` / `CreditChanged`；法务 `docs/03` 已对齐。② **路径 B**：若确因方案 §4.3.1 / §5.1 需保留，须由主代理按契约文末「统一更新版本号并通知三方」在 `CONTRACT.md` 登记差异并升版本，把该事件补入 §4，同步 `docs/01` §0.3 / §4.1、`docs/02` §6.1、`review/product-review.md` 裁决 2、`tests/smoke.mjs` ⑩ / ⑫、`docs/03`、`docs/07`，三方一致后生效；并明确其为「C → A 内部结算编排信号」，先于记账事件、自身不记账、`model_decision:null`、不引入结算端点。③ 顺带由主代理明确 `RiskBlocked` / `PreferenceChanged`（`docs/02:156` 已列、契约 §4 未列，`review/product-review.md:151` 亦提出）是否补登记，避免同类分裂。
- 验收方式：全库 Grep `SettlementRequested`，确认「只读基线方案之外，三方交付物要么全无、要么全部有且契约 §4 已登记」；`GET /api/events` 出现的事件类型 ⊆ 登记后的契约 §4；`docs/03` §4、`docs/07` 组 8 检查项与最终口径一致；`node tests/smoke.mjs` 全绿且断言数与事件口径匹配。

**M4【产品 + 法务｜白皮书三项口径定稿】**

- 问题：`docs/02:266-268` §11 挂起三项待确认（冻结时点、高质量奖励是否计入用户榜、服务费争议期是否托管）、`docs/01:391` §8 D4「待法务在白皮书要点中确认」，导致方案 §4.1.3 十项要素中要点 5 / 6 口径未定稿，本轮「有条件通过」前提「白皮书十项要素齐备」未闭环。
- 可执行要求：按本评审第三节法务倾向定稿并写入 SBC 白皮书与法务书面意见：① 用户榜 `net_sbc` 仅计「已验收通过任务的赏金本金」，评价 ≥ 4.5 的 +2% 高质量奖励不计入；② 争议裁定 `refund_publisher` / `close`、取消、超时未成交时，赏金与 5% 服务费全额原路退回，仅在 `SETTLED` 时将 5% 服务费计入 `platform_revenue`；③ D4 维持「待评审」，本轮不设值，正式上线前由法务书面意见确定；④ 法务在 `docs/03` 要点 5 / 6 补记上述倾向（自修）。
- 验收方式：`docs/03` 要点 5 / 6 含明确法务结论；白皮书正式稿对应条款一致；产品书面确认；实跑 `POST /api/tasks/:id/dispute` → `resolve(refund_publisher)` 后 `GET /api/config` 的 `ledger.by_subject.platform_revenue` 不增加、发布方 `available` 回退 `total`（含 5% 服务费）；`settleTask` 后 `net_sbc` 增量 = `bounty`、不含 `quality_bonus.amount`（`server.mjs:150` 已实现，需固化断言）。

### 2.2 建议整改（不阻断本轮通过，共 5 项）

| # | 责任方 | 问题与可执行要求 | 验收方式 |
|---|---|---|---|
| S1 | 研发 | `store.mjs:38 SENSITIVE_KEY` 为键黑名单，`server.mjs:582` 的 `payload.reason`、`server.mjs:248` 的 `hits`、`docs/02:83` 宣称的「零任务正文」存在自由文本绕过；建议改为**键白名单**，或把 `reason` / `hits` / `note` / `summary` 纳入剥离与扫描，使声明与实现一致 | 构造含虚构手机号、身份证号、任务正文的驳回理由 → `POST /api/tasks/:id/verify` reject → `GET /api/events?task_id=` 断言 `payload` 不含上述内容 |
| S2 | 研发 | `store.mjs:60-67 scanAnchorText()` 任务正文关键词仅 4 个演示词，接入真实锚定前不足以证明「零任务正文」 | 注入含任意任务正文的锚定载荷，扫描命中 ≠ 0 且拒绝锚定；`on_chain_fields` 白名单做结构化校验 |
| S3 | 产品 + 研发 | 未成年人限制、举报入口当前未实现（`docs/01:411`、`docs/02:260`、`README.md:83` 已如实登记），按 `docs/07` 组 7 在 P1 落地、操作台补齐入口，上线前 100% 可用 | 上线前功能验收记录 + 举报 24h 处置率 100% 报表；不得在演示中伪装已交付 |
| S4 | 研发 | 权重变更「离线回放 + 评审签字 + 公示 7 天 + 可回滚」（F-08）列 P1 未实现（`docs/02:236` 已登记），本轮保留版本常量 | P1 交付时提供版本记录、离线回放报告、公示记录与回滚预案，F-08 记录完整率 100% |
| S5 | 产品 | **已闭环**：`docs/01:306` 已补充「方案 §4.3.3 的 `SettlementRequested` 未被 CONTRACT §4 收录，产品侧不引入该事件名，差异见 `review/product-review.md`」。剩余「主代理登记差异 / 三方事件名收敛」并入 M3，不再单列 | 以 M3 验收方式为准 |

---

## 三、对三方口径冲突的法务意见

> 以下为**合规口径意见**，用于统一术语、事件与账本勾稽，**不构成任何商业承诺、费率承诺、功能上线承诺或法律意见书**；正式结论以法务书面意见与备案回执为准。

**1. 冻结时点**

- **法务倾向**：**审核通过（进入 `PUBLISHED`）时冻结**「赏金 + 5% 服务费」；发布阶段仅做合规预检 + 余额预校验，不产生资金划转。
- **理由**：① `CONTRACT.md:70` §5 明确「发布审核通过｜冻结」，方案 `:283` §4.1.4 表「触发＝审核通过」、`:406` §4.3.2「`PUBLISHED`＝赏金已冻结」与之互证；② 未审核内容不应先行占用用户积分，`PENDING_REVIEW → REJECTED` 若已冻结则需额外冲正 / 解冻流水，徒增资金占用争议，与最小必要不符；③ 代码与操作台已按此实现（`server.mjs:254-271` / `:319-335`、`web/index.html:171`），统一成本最低；④ `CONTRACT.md:119` §8 括注与方案 `:499` §5.1 时序第 2 步属用途简写 / 内部时序，与规则表冲突时以规则表为准，差异须按契约文末登记。

**2. `SettlementRequested` 事件**

- **法务倾向**：本轮**按 `CONTRACT.md` §4 不采用**该事件（路径 A，与 `review/product-review.md` 裁决 2、`docs/01:306`、法务 `docs/03` 一致）；若主代理按契约 §0「与方案冲突时以方案为准**并在此文件登记差异**」选择保留（路径 B），须升版本并三方同步一致。**不得维持「产品不采用 / 研发已采用 / 契约未登记」的分裂状态**。
- **理由**：① 契约 §0 / §2 规定「三方产出必须与本契约的术语、状态、事件、数值口径一致」，§4 是唯一的事件总线契约；② 产品侧已书面裁决不采用、法务首轮误用已自修，研发单方补发使事件回放与对账勾稽出现契约外事件，属**口径不一致**而非功能增强；③ 契约 §0 的「以方案为准」附有「**并在此文件登记差异**」前置条件，主代理未登记时方案条款不当然覆盖契约 §4，单方引用方案引入事件名不成立；④ 两条路径下均须保证结算人工兜底（`model_decision:null`、自身不记账、不设结算端点）—— 研发补发事件已满足这些实质要求，争议仅在口径一致性。不作商业承诺。

**3. 用户榜 `net_sbc` 计入口径**

- **法务倾向**：支持研发现行口径 —— `net_sbc` **仅计已验收通过任务的赏金本金**；评价 ≥ 4.5 的 +2% 高质量奖励（由 `eco_incentive` 支出）**不计入**。
- **理由**：① 方案 `:300` §4.1.5 明确「仅已验收通过任务的净获得 SBC 计入；赠送、补偿、邀请、活动奖励、争议中积分一律不计入，防止刷榜」；② 奖励由生态激励池支出、非发布方支付的任务对价，计入会放大「自评高评价刷奖励 → 刷榜」激励，破坏「不计入项混入数 = 0」验收口径；③ 代码 `server.mjs:150` 只累加 `bounty`，口径清晰可复算。须在白皮书要点 5 写明以消除「+2% 是否属活动奖励」的解释二义。

**4. 争议退款时 5% 服务费是否退回**

- **法务倾向**：**未成交全额原路退回，含 5% 服务费**；仅在 `SETTLED`（有效完成 / `pay_solver`）时将 5% 服务费计入 `platform_revenue`。
- **理由**：① 方案 `:518` §5.2 科目表「平台收入｜服务费｜**进入条件＝结算**」，即服务费收入在结算时确认，争议退款 / 关闭未进入结算；② 服务费的对价是平台撮合与结算服务的完成，交易未成交缺乏收费对价基础；③ `CONTRACT.md:71` §5「取消（未接单）全额解冻」、`:76`「争议全额转托管」均未授权平台在未成交时留存服务费；④ 预收不退易被认定为加重用户责任的格式条款，且与「SBC 非支付工具、平台不设资金池」口径冲突。代码 `server.mjs:674-682` 全额退回、`server.mjs:134` 仅在结算入账，符合该倾向。

**5. D4（SBC 是否设 12 个月有效期）**

- **法务倾向**：本轮**维持「待评审」，不设值、不作结论**；正式上线前由法务书面意见确定后再写入白皮书与用户协议。
- **理由**：① 方案 `:605` §7.5 D4 仅为「建议 12 个月滚动并提前 30 天提醒」，属待评审项；契约 §5 未定义有效期；② 初版无时钟、无持久化（`docs/02:233-234` §10.1），不接真实账本，有效期无实现载体，设值反成不实交付；③ 有效期涉及用户积分权益预期，若未来采纳，必须在白皮书与协议中同时写明有效期、提前 30 天提醒、过期积分处理与注销回收，不得通过格式条款单方缩短或无偿清零。

**6. D8（个性化开关账号级）**

- **法务倾向**：**账号级为正式上线前要求**；初版「进程级全局开关 + 服务端强制」满足 `CONTRACT.md:146` §10.4 红线，本轮不因此否决，但**不得宣称已满足方案 `:609` §7.5 D8 的账号级建议**，差异须如实登记（M2）。
- **理由**：① 契约 §10.4 只要求开关存在、服务端强制、关闭后中性排序，未规定粒度；② 但全局开关会导致一人关闭影响全部用户，与用户自主选择权、最小必要及 `§6.2` 「关闭开关可用率 100%」在账号级口径下冲突；③ 服务端强制不可回退为设备级 / 客户端级，账号级实现须与账号体系绑定并保留 `PreferenceChanged` 留痕。

---

## 四、一票否决判定

**判定口径**：`CONTRACT.md:147` §10.5 与方案 `:548-556` §6 明确下列 8 项为**上线**一票否决项、`方案 §7.3 G6` 要求「一票否决清单（§6）全项通过｜观测窗口＝上线前」。本轮为契约 §0 定义的「项目初版」（不接真实支付 / 大模型 / 公链、不采集真实 PII、不做生产部署、本轮不推送 GitHub），**未进入上线阶段**，故逐项状态为「延期核验（未上线，不触发）」，而非「通过」或「不通过」。

| 编号 | 一票否决项（方案 §6） | 本轮实际状态与证据 | 判定 |
|---|---|---|---|
| V1 | 法务书面意见与白皮书签字 | `docs/03` 已展开十项要素并补记三项口径倾向；正式《法务意见书》与白皮书签字页本轮未产出，且 M4 三项口径待定稿 | 延期核验（未上线，不触发） |
| V2 | 算法备案 / 区块链信息服务备案回执 | 未取得；`docs/02:238` §10.1「无许可链、无备案」、`README.md:79`「不接公链」、`store.mjs:604` `mode:'local-merkle-demo'`。按契约 §0 属初版范围外，**不误判为违规** | 延期核验（未上线，不触发） |
| V3 | 支付托管协议 | 未签；`docs/02:15`「不做真实支付 / 持牌托管 / 法币计价」、`README.md:79`「不接真实支付」 | 延期核验（未上线，不触发） |
| V4 | 渗透测试无高危 | 本轮仅 `tests/smoke.mjs` 11 项功能自检，无第三方渗透测试报告 | 延期核验（未上线，不触发） |
| V5 | 压测报告达标 | 无压测报告；`docs/02:218` 期望「PASS 11 / FAIL 0」为功能自检，非 §7.2 压测 | 延期核验（未上线，不触发） |
| V6 | 灾备与回滚演练记录 | 无；`docs/02:236` §10.1 已登记「无增量更新、快照降级、公示记录」 | 延期核验（未上线，不触发） |
| V7 | 隐私政策与用户协议上线 | 未上线；`COMPLIANCE.md` 已给出对口径，但协议 / 隐私政策正式版本与发布记录本轮无 | 延期核验（未上线，不触发） |
| V8 | 未成年人限制与举报通道可用 | **未实现**；`docs/01:411`、`docs/02:260`、`README.md:83` 已如实登记为「初版仅标注位置 / 原型未实现」，操作台无对应入口 | 延期核验（未上线，不触发）；**登记为上线前必须完成且不得宣称已交付** |

**一票否决权行使结论**：本轮初版**不触发一票否决**。四条真实红线（转让接口 / 明文 PII / 模型直判结算 / 无个性化开关）经代码核验**均未出现**，满足「一律不通过」的反面条件；8 项否决清单均为上线前闸门且被三方如实登记为未交付。

**保留否决声明**：若任何一方在演示材料、对外声明或交付文档中宣称 V1–V8 任一「已通过 / 已交付」（尤其 V8 未成年人限制与举报入口、V2 两项备案回执），或后续出现 R1 / R2 / R3 / R4 任一红线回退（新增转让 / 兑换接口、明文 PII、模型直判、删除或弱化个性化开关），法务将**立即行使一票否决，结论改为不通过**。

---

## 五、结论

**结论：有条件通过。**

适用范围：仅限本轮「项目初版」（契约 §0）的**三方产出与红线合规状态**；不构成上线运营许可、不构成法律意见，不表示任何功能已具备生产可用性。

**条件与责任方**：

| 条件 | 内容 | 责任方 |
|---|---|---|
| C1 | 完成 4 项**必须整改**（M1 冻结时点口径、M2 D8 账号级差异登记、M3 `SettlementRequested` 事件名三方收敛、M4 白皮书三项口径定稿）并逐项按验收方式复核 | 产品 / 研发 / 主代理 / 法务 |
| C2 | 四条真实红线保持零违背；任何新增接口、文案、事件名、字段须经法务复核后并入契约版本 | 研发（主代理登记） |
| C3 | R2（事件日志脱敏）、R5（V8 两项功能）、R12（权重留痕）的 5 项建议整改纳入 P1 与 `docs/07` 上线清单，在正式上线前闭环 | 研发 / 产品 |
| C4 | 一票否决清单 V1–V8 在正式上线前全项通过（G6）；本轮为「未上线、不触发」，三方不得宣称已通过；账号级个性化开关按 M2 列为上线前验收项 | 全体 |
| C5 | 正式上线以法务书面意见、白皮书签字与备案回执齐备为前提，并逐级复跑 G1–G7（方案 §7.3） | 法务 / 全体 |

**法务自修记录（本轮同步完成，未触碰他人文件）**：`COMPLIANCE.md` 第 4 节去除「账号级」已完成式表述；`docs/03` 要点 5 / 6 补记三项口径法务倾向、§3 个性化开关节点改为「初版进程级全局、账号级列 P1」、§4 §10.3 事件名改为契约 §4、§5 结论引用本评审；`docs/07` 组 7 增列「账号级隔离」检查项、组 8 增列「`SettlementRequested` 差异登记」检查项。

---

*本评审依 `CONTRACT.md` §9 与 `docs/03` §5 出具；一票否决清单编号 V1–V8、上线闸门 G1–G7、阈值均引用方案 §6 / §7.3，未自造数值。*
