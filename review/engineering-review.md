# 工程交叉评审记录（阶段 B · 研发负责人）

| 项 | 内容 |
|---|---|
| 评审角色 | 研发负责人（对应 CONTRACT §2 归属：`src/`、`web/`、`tests/`、`docs/02`） |
| 阶段 | B 交叉评审与收敛（CONTRACT §9 阶段 B） |
| 评审对象 | `README.md`、`docs/01-产品需求与路线图.md`、`COMPLIANCE.md`、`docs/03-合规基线与SBC白皮书要点.md`、`docs/07-上线检查清单.md`（均**已实际阅读**） |
| 基线 | `三宝殿项目方案_v1.0.md`（只读）+ `CONTRACT.md` v0.1；冲突以方案为准并登记差异（契约 §0） |
| 本轮整改范围 | 仅 `src/domain.mjs`、`src/store.mjs`、`src/server.mjs`、`web/index.html`、`tests/smoke.mjs`、`docs/02-技术架构与接口契约.md`；**未修改任何他方文件** |
| 结论 | **通过（有条件）**：8 项「必须修改项」已全部补齐并新增断言验证；自检 **20/20 全绿**；剩 3 项跨角色口径需主代理 / 产品 / 法务拍板（见 §3、§5） |

---

## 0. 评审方法与结论摘要

方法：逐条把 `docs/01` 的 US-01～US-08 与 §2 范围表需求点映射到本人实现的接口与函数；把 CONTRACT §10 七条红线与 `docs/03` §4 的「对研发的硬性约束」逐行映射到代码落点与自检断言；对发现的差异按「必须修改项 / 建议项 / 结论」三类处置，并对 5 个待定技术口径明确表态。所有代码改动后重跑 `node tests/smoke.mjs`。

| 类别 | 内容 | 状态 |
|---|---|---|
| **必须修改项** | M1 `SettlementRequested` 事件缺失；M2 未成年人限制 / 举报入口钩子缺失；M3 反向流水冲正未实现；M4 用户榜 `net_sbc` 计入高质量奖励口径偏离；M5 成果正文直接落内存、未做 PII 脱敏；M6 审核驳回任务仍出现在任务列表；M7 接单缺 `RankUpdated` 事件；M8 `scanAnchorText()` 对 hex 摘要偶发误判为 PII（断言 ⑯ 非确定性失败） | **8/8 已补齐**，对应新增断言 ⑫⑬⑭⑮⑱⑲⑳ |
| **建议项** | S1 产品修订 PRD 冻结时点措辞；S2 主代理在 CONTRACT 登记 `SettlementRequested` 差异；S3 对齐 PRD §4.1 与 `docs/03` §4 的事件口径；S4 发布方资质预检、推送「结果」字段、真实时钟 / 消息通道 / 审批留痕列入 P1 | 已写入 §3 / §4，不阻塞本轮 |
| **结论** | **通过（有条件）** —— 原型闭环、合规红线、可验证性均达标；3 项口径待拍板，不影响本轮初版交付 | — |

> 与首轮（阶段 A）相比：自检断言 **11 → 20**（原 11 条一条未删，新增 9 条 ⑫～⑳）；6 个自有文件均发生实质整改，`docs/02` 同步升版 v0.2。

---

## 一、PRD ↔ 接口对齐矩阵（`docs/01` US-01～US-08 逐条）

标记：✅ 全覆盖 ｜ ⚠ 部分覆盖（口径差异 / 参数级 / 占位钩子）｜ ❌ 未覆盖（明确列入 P1/P2，不伪装已交付）。
「代码落点」列中 `domain/store/server` 分别指 `src/domain.mjs` / `src/store.mjs` / `src/server.mjs`。

### US-01 发布悬赏任务

| 需求点（出处） | 对应接口 / 代码落点 | 覆盖 | 差异与补救方式 |
|---|---|---|---|
| 生成全局唯一 `task_id`（US-01、§2） | `POST /api/tasks` → `server:createTaskImpl()` → `store.nextId('T')` | ✅ | — |
| 合规预检：违禁内容 / 余额不足 / 资质不符三类拦截 100%（US-01 ①③、§2 F-02、§9） | `domain:compliancePrecheck()` + `BANNED_WORDS`；`server:createTaskImpl()` 的 `INSUFFICIENT_BALANCE`；`domain:hardFilter()`（接单人侧） | ⚠ | 违禁词、余额不足已 100% 拦截；**发布方资质预检未实现**（仅校验 role / 存在性）。补救：P1 接模块 A 实名与资质绑定（已登记 `docs/02` §10.1 第 11 条） |
| 冻结「赏金 + 5% 服务费」、写 `CreditFrozen` 流水（US-01 期望结果、§4.1 第 2 步、§0.5） | `server:hReview()` 审核通过 → `store.postLegs()` + `CreditFrozen` 事件 | ⚠ | **口径差异**：研发按方案 §4.1.4 / §5.2、CONTRACT §5、PRD §0.5「审核通过冻结」实现；PRD US-01 与 §4.1 第 2 步写「发布即冻结、`PENDING_REVIEW` 写流水」，与 PRD §0.5 自相矛盾。补救：**裁决 1**（维持审核通过冻结，请产品修订 PRD 措辞），研发不改代码 |
| 状态进入 `PENDING_REVIEW`（US-01） | `server:createTaskImpl()` | ✅ | — |
| 联系方式虚拟号占位、无明文 PII（US-01 ③、§2） | `domain:sanitizeContact()` / `makeVirtualNumber()`；`web/index.html` 无手机号 / 证件输入控件 | ✅ | 断言 ⑬⑯⑲ 交叉验证 |
| 余额不足不允许发布（US-01 ④） | `server:createTaskImpl()` 预校验 | ✅ | — |
| 未成年人限制发布前置（PRD §9 交接点、docs/03 §3） | `domain:minorRestrictionHook()` + `server:createTaskImpl()` 准入拦截 + `store:config().compliance.minor_restriction_hook` | ⚠ | **M2 已补齐钩子占位**（布尔准入、零 PII、422 `MINOR_RESTRICTION_BLOCKED`，断言 ⑬）；真实实名核验为上线一票否决项 V8，未实现、不伪装 |

### US-02 平台审核

| 需求点 | 对应接口 / 代码落点 | 覆盖 | 差异与补救方式 |
|---|---|---|---|
| `PENDING_REVIEW → PUBLISHED / REJECTED`（US-02、§0.2） | `POST /api/tasks/:id/review` → `server:hReview()` + `domain:canTransition()` | ✅ | 断言 ④ 验证非法迁移被拒 |
| 审核 ≤ 30 min、超时告警并自动转人工（US-02 ①、§4.2） | 仅 `deadline` 元数据 | ❌ | 无真实时钟；P1 定时器 + 告警（§10.1 第 2 条） |
| 驳回后不再出现在任务列表与榜单（US-02 ③） | `server:hListTasks()` 默认过滤终态 + `?include_terminal=true` 供审计；`domain:rankTasks()` 过滤终态 | ✅ | **M6 阶段 B 补齐**，断言 ⑱ 验证「默认列表无 / 审计模式有 / 榜单无」 |
| 通过 → 发 `TaskPublished`、榜单按 RankScore 上架（US-02 期望、§4.1 第 3 步） | `TaskPublished` / `TaskUpdated` / `RankUpdated` 事件 + `GET /api/leaderboard/tasks` | ✅ | 断言 ⑩⑱ |

### US-03 触发推送与候选预览

| 需求点 | 对应接口 / 代码落点 | 覆盖 | 差异与补救方式 |
|---|---|---|---|
| 状态进入 `DISPATCHING`（US-03） | `POST /api/tasks/:id/dispatch` → `server:hDispatch()` | ✅ | — |
| 六层漏斗 L1 硬过滤 → L6 触达编排（US-03 期望、§0.4） | `domain:hardFilter()` → `normalizeInCategory()` → `scoreCandidates()` → `buildBatches()` → `store.recordDispatch()` | ⚠ | 规则版实为「硬过滤 + 类目内归一化 + 六项加权 + 重排 + 分批元数据」；无真实多路召回 / 精排 / 触达 / 曝光反馈闭环。补救：P1 / M3（方案 §2.2） |
| Top-K 有序候选 + 分数 + `reason_codes` + `weight_version="v1.0"`（US-03 ②、§0.4） | `domain:scoreCandidates()`、`DISPATCH_WEIGHTS`、`WEIGHT_VERSION` | ✅ | 断言 ⑰ 验证 Top-K / batch / channel / 扩量元数据；断言 ⑦ 验证中性排序 |
| 落库 8 类字段完整率 100%（US-03 ②、CONTRACT §6） | `store.recordDispatch()`：`task_id / dispatch_id / candidates(含分数、reason_codes、批次、通道) / weight_version / batches / strategy / filtered_out` | ⚠ | 已落 7 类；**「触达结果」字段未显式落库**（以 `mode` / `algorithm_degraded` 元数据近似）。补救：P1 接真实消息通道后补 `result` 并纳入 F-03 抽样 |
| `dry_run` 只预览不触达（US-03 ③） | `server:hDispatch(dry_run)` + `store.beginDryRun()/endDryRun()` | ✅ | 断言 ⑪：不落库、不改状态 |
| 模型不可用自动降级、推送不中断、`/api/config` 可见（US-03 ④、§4.2 算法降级） | `domain` 三适配接口 `degraded:true`；`store:config().algorithm.degraded` | ✅ | 断言 ⑨ |
| 达扩量上限转运营干预并留痕（§2、§4.2） | `domain:buildBatches()` 元数据 | ⚠→❌ | 参数级元数据（断言 ⑰）；无审批留痕。P1（§10.1 第 9 条） |

### US-04 浏览任务、任务榜与用户积分榜

| 需求点 | 对应接口 / 代码落点 | 覆盖 | 差异与补救方式 |
|---|---|---|---|
| `GET /api/tasks` 返回任务及状态（US-04、§2） | `server:hListTasks()` | ✅ | 默认过滤终态（M6），审计模式可查全量 |
| 任务榜六维权重 0.25/0.20/0.20/0.15/0.10/0.10（US-04、§0.4） | `GET /api/leaderboard/tasks` → `domain:rankTasks()` / `TASK_RANK_WEIGHTS` | ✅ | 输出 Top3 影响因子；争议中降权 50% |
| 用户榜四维权重 0.55/0.20/0.15/0.10（US-04、§0.4） | `GET /api/leaderboard/users` → `domain:rankUsers()` / `USER_RANK_WEIGHTS`（贝叶斯 m=10） | ✅ | — |
| 自然榜付费置顶混入数 = 0（US-04 ①、§2） | 无广告位实现，`rankTasks()` 不接受外部权重注入 | ✅ | — |
| Top20 中已下架 / 已完成任务数 = 0（US-04 ②） | `domain:rankTasks()` 过滤 `CANCELLED/EXPIRED/CLOSED/REJECTED/DISCARDED` | ✅ | 断言 ⑱ 补强 |
| 用户榜不计入项混入数 = 0（US-04 ③、§2） | `store:userRankStats()` 仅聚合 `stats.net_sbc / completed_count / rating / on_time` | ✅ | **M4 阶段 B 修正口径后**断言 ⑮ 验证：结算者 = bounty + bonus，争议中接单人 = 0 |
| 关闭个性化后按时间 + 距离中性排序（US-04 ④、§9、D8） | `domain:neutralCandidates()` / `server:neutralTaskOrder()` | ✅ | 断言 ⑦，服务端强制 |

### US-05 接单（原子锁）

| 需求点 | 对应接口 / 代码落点 | 覆盖 | 差异与补救方式 |
|---|---|---|---|
| 非竞赛制 1000 次并发仅 1 个成功（US-05 ①、§2 F-04） | `POST /api/tasks/:id/accept` → `store.tryLockTask()` + Node 单线程同步代码块 | ✅ | 原型以 **4 人并发**验证（断言 ⑤：wins=1）；1000 次压测属 V5，未做 |
| `DISPATCHING → ACCEPTED`、赏金转托管（US-05 期望） | `server:hAccept()` → `store.postLegs(frozen→escrow)` | ✅ | 断言 ①⑧ |
| 榜单 ≤ 1s 下架、`TaskAccepted`/`RankUpdated`/`TaskDelisted`（US-05 期望、§4.1 第 7 步） | `server:hAccept()` 三个事件 | ✅ | **M7 阶段 B 补齐 `RankUpdated`**，断言 ⑱ 验证三事件齐备；无真实时钟，下架为即时事件 |
| 重复 `event_id` 返回原结果、无重复流水 / 推送 / 榜单变更（US-05 ②） | `server:withIdempotency()` + `store.ledgerEventIds` + `canTransition` | ✅ | 断言 ③ |
| 独占窗口 3 min / 15 min 超时释放（US-05 ③、§0.2） | 仅参数 | ❌ | 无真实时钟；P1 |
| 资质 / 信用 / 负载 / 关联关系校验前置（US-05 ④） | `domain:hardFilter()` 六项 | ⚠ | 资质、负载、黑名单、关联、半径、频次已实现；**信用分仅作数据字段，未作为接单硬门槛**。补救：P1 接信用分中心 |

### US-06 提交成果

| 需求点 | 对应接口 / 代码落点 | 覆盖 | 差异与补救方式 |
|---|---|---|---|
| `ACCEPTED → IN_PROGRESS → SUBMITTED`、发 `TaskSubmitted`（US-06 期望） | `POST /api/tasks/:id/submit` → `server:hSubmit()` | ✅ | 断言 ①⑩ |
| 成果含文本 / 图片 / 视频 / 定位打卡 / 硬件凭证（US-06 动作、§2） | `server:hSubmit()` 仅 `content` 文本 | ⚠ | 仅文本；附件与硬件凭证 P1 / P3（§10.1 第 10 条） |
| 按 deadline 计时、剩余 20% 提醒、超期 `EXPIRED` + 信用分 −5 + 释放冻结（US-06 ②、§4.2） | `domain:timeoutCreditPenalty()` 纯函数已实现 | ❌ | 纯函数已实现但 **HTTP 未编排**、无时钟；P1（§10.1 第 2、7 条） |
| 提交内容不含明文联系方式（US-06 ③、CONTRACT §10.2） | `domain:sanitizeSubmissionText()` + `server:hSubmit()` / `taskView()` | ✅ | **M5 阶段 B 补齐**：落内存前做手机号 / 证件号正则脱敏，只存脱敏文本；事件仅记 `pii_redacted` 布尔。断言 ⑲ |

### US-07 验收、结算与流水核对

| 需求点 | 对应接口 / 代码落点 | 覆盖 | 差异与补救方式 |
|---|---|---|---|
| 通过 → `SUBMITTED → SETTLED`；流水含赏金 + 5% 服务费 + 评价 ≥4.5 额外 2%（上限 50 SBC）（US-07 期望、§0.5） | `POST /api/tasks/:id/verify` → `server:settleTask()` + `store.postLegs()` + `domain:computeQualityBonus()` | ✅ | 断言 ①② 验证流水齐全、五科目平衡、上限口径 |
| 广播 `SettlementCompleted` / `CreditChanged`（US-07 期望、§4.1 第 11 步） | `server:settleTask()` | ✅ | **M1 阶段 B 补 `SettlementRequested`**（方案 §4.3.3 环节 5 / §5.1 第 10 步），顺序 `SettlementRequested → CreditTransferred → SettlementCompleted`，断言 ⑫ |
| 驳回需理由且 ≤ 2 次、超限被拒（US-07 ②） | `server:hVerify()` + `domain:MAX_REJECT` | ✅ | 理由字段已记录；超限返回 `REJECT_LIMIT` |
| `SUBMITTED` 24h 未操作自动验收（US-07 ③、§4.2） | `decision:'auto_accept'` 手动触发 | ⚠ | 触发路径已实现并标注 `AUTO_VERIFY_HOURS`；无真实时钟自动触发，P1 |
| `GET /api/ledger/:userId` 可见不可变流水、冲正以反向流水实现（US-07 ④、CONTRACT §5） | `store.getLedger()` / `store.postLegs()` / **`store.postReversal()`** | ✅ | **M3 阶段 B 补齐冲正**，断言 ⑭（仓储单元级）验证原流水不可变、只追加、delta 取反、守恒 |
| `GET /api/events` 可完整回放该 `task_id` 全链路（US-07 ⑤） | `store.getEvents(taskId)` | ✅ | 断言 ⑩⑫⑱ |
| `SETTLED` 且流水齐全 = 100%，孤立冻结 / 托管记录 = 0（US-07 ①、G4） | `store.balanceCheck()` 守恒 + `hVerify` 限定 `SUBMITTED` | ✅ | 断言 ②⑧：争议态借验收转付被拒 |
| 结算回写 ≤ 10s（§0.2） | 同步编排 | ✅ | — |

### US-08 合规开关、争议与系统可观测

| 需求点 | 对应接口 / 代码落点 | 覆盖 | 差异与补救方式 |
|---|---|---|---|
| 关闭个性化后服务端强制中性排序、因子影响 = 0（US-08 ①、§9、D8、docs/03 §4 §10.4） | `POST /api/preferences/personalized` → `store.preferences`（唯一写入点）；`server:hDispatch()` 忽略客户端传参 | ✅ | 断言 ⑦：客户端强传 `personalized:true` 仍返回 neutral |
| 开关状态在 `/api/config` 可见（US-08 期望、§2） | `store:config().personalized_enabled` / `personalization_enforcement` | ✅ | 断言 ⑦ |
| 争议全额托管、裁定前不转付、人工裁定（US-08 ②、§9） | `POST /api/tasks/:id/dispute` → `server:hDispute()` | ✅ | 断言 ⑧：`DISPUTED` 下借验收转付被拒、无 `CreditTransferred` / `SettlementCompleted` |
| `DISPUTED` 72h 结案、仲裁 72h 结案率 ≥ 95%（US-08 ②、G5） | `DISPUTE_CLOSE_HOURS` 元数据 | ❌ | 无真实时钟；P1（§10.1 第 2 条） |
| LLM 直判结算次数 = 0，仅 `summarizeDispute()` 做摘要（US-08 ③、docs/03 §4 §10.3） | `domain:summarizeDispute()` 固定 `decision:null`；`SettlementRequested.model_decision=null` | ✅ | 断言 ⑨⑫ |
| `GET /api/events` 回放完整率、`GET /api/health` 200、`GET /` 返回操作台（US-08 ④⑤） | `GET /api/events` / `hHealth` / 静态托管 | ✅ | curl 确认 `GET /` 200 `text/html`，`/api/sbc/transfer` 404 |
| 举报入口、未成年人限制在产品流程中落位（PRD §9 交接结论「需研发补齐入口」、docs/03 §3） | `domain:reportEntryHook()` / `minorRestrictionHook()`；`web/index.html` 前端入口占位 + 钩子状态展示 | ⚠ | **M2 阶段 B 补齐钩子与前端占位**（断言 ⑬）；不新增 §8 之外的 HTTP 路径；真实处置闭环 V8 未实现 |

**接口总数核对**：CONTRACT §8 的 15 个 API + `GET /` 静态页 = 16 个路由，`server.mjs:ROUTES` 全部登记；`docs/01` §0.6 的索引表逐字对齐。自检 20 项覆盖全部 15 个 API 与静态页，另含 2 项仓储 / 域函数单元级验证（冲正 ⑭、上链摘要扫描 ⑳，均不通过 HTTP）。

---

## 二、合规可实现性逐条核验

### 2.1 CONTRACT §10 七条红线

| # | 红线 | 代码落点（文件 + 函数） | 自检断言 | 是否满足 |
|---|---|---|---|---|
| 1 | SBC 不得转让 / 交易 / 法币兑换 / 收益承诺 / 二级市场接口或文案 | `server.mjs:ROUTES`（白名单）+ `handle()` 404 分支；`store.mjs:config().compliance.sbc_transfer_or_redeem_api=false`；`store.mjs:postLegs()` 仅五科目流转；`web/index.html` 徽章「不可转让、不可兑付法币」 | ⑥、②、⑭ | **满足** |
| 2 | 不存明文手机号 / 身份证 / 精确定位轨迹；联系方式虚拟号；日志与事件脱敏 | `domain.mjs:sanitizeContact()/makeVirtualNumber()/compliancePrecheck()/sanitizeSubmissionText()/minorRestrictionHook()`；`server.mjs:createTaskImpl()/hSubmit()/taskView()`；`store.mjs:sanitizePayload()`；`web/index.html` 无任何 PII 输入控件；用户仅 `distance_km` 粗粒度标量 | ⑬、⑯、⑲、②③⑧ | **满足**（阶段 B 补齐成果正文脱敏） |
| 3 | 结算 / 争议裁定 / 账号处罚人工兜底，禁止模型直判 | `server.mjs:settleTask()` 纯规则记账；`SettlementRequested.model_decision=null / arbitrator`；`hVerify()` 限定 `SUBMITTED`；`hDispute(resolve)` 标注 `arbitrator:'人工裁定演示'`；`domain.mjs:summarizeDispute()` 固定 `decision:null` | ⑧、⑨、⑫ | **满足**（阶段 B 补齐 `SettlementRequested`） |
| 4 | 关闭个性化开关，关闭后时间 + 距离中性排序 | `server.mjs:hPreferences()` 唯一写入点；`hDispatch()/hLeaderboardTasks()` 只读服务端值、忽略客户端 `personalized/enabled`；`domain.mjs:neutralCandidates()/neutralTaskOrder()`；`store.mjs:config().personalized_enabled` | ⑦ | **满足** |
| 5 | 未成年人限制、违禁预检、举报入口、算法 / 区块链备案为上线一票否决 | `domain.mjs:compliancePrecheck()`（违禁预检）；`minorRestrictionHook()/reportEntryHook()`（钩子占位）；`server.mjs:createTaskImpl()` 发布前置准入；`store.mjs:config().compliance.minor_restriction_hook/report_entry_hook`；`web/index.html` 前端入口占位 | ⑬（+ 操作台违禁词演示） | **满足（钩子层）**；真实实名核验 / 举报 24h 处置 / 两项备案为 V8 上线闸门，`docs/02` §10.1 明示未实现，不伪装 |
| 6 | 链仅本地 Merkle + 可插拔锚定；零 PII、零任务正文上链 | `store.mjs:computeMerkleRoot()/anchorLedger()/scanAnchorText()`；`on_chain_fields` 白名单；`LedgerAnchored.payload.on_chain_fields + privacy_scan`；流水 hash 输入仅数值与元数据 | ⑯ | **满足**（阶段 B 补齐可验证扫描） |
| 7 | 演示数据全部虚构，不得出现真实个人信息 | `store.mjs:demoUsers()` 全为虚构名；`domain.mjs:makeVirtualNumber()`；`web/index.html` 顶部声明；自检中 `13800001234` / 证件号均为**虚构脱敏测试串**，不对应任何真实主体 | ⑥、⑬、⑯、⑲、⑳ | **满足** |

### 2.2 `docs/03` §4「对研发的硬性约束」逐行

| 契约条款 | 禁止项 / 必须项（法务口径） | 代码落点 | 自检断言 | 是否满足 |
|---|---|---|---|---|
| §10.1 | 禁止 §8 之外新增转让类路径；积分变动仅限五科目；**冲正以反向流水实现**；流水含 `event_id/科目/前后余额/task_id/规则版本` | `server.mjs:ROUTES`；`store.mjs:postLegs()`（守恒 + 全字段）；**`store.mjs:postReversal()`（M3 补齐）** | ⑥、②、**⑭** | **满足**（首轮仅文档预留 `reversal:` memo，本轮补齐实现） |
| §10.2 | 禁止明文 PII；虚拟号；PII 字段级脱敏；`/api/events`、`/api/ledger` 脱敏；上链 PII 命中 = 0 | `domain.mjs:sanitizeContact()/sanitizeSubmissionText()`；`store.mjs:sanitizePayload()`；`server.mjs:hSubmit()/taskView()`；`store.mjs:anchorLedger()` 的 `privacy_scan` | **⑬、⑯、⑲、⑳** | **满足**（首轮成果正文有明文 PII 落内存风险，本轮补齐脱敏） |
| §10.3 | 禁止模型直判；**`SettlementRequested` / `DisputeOpened` / `DisputeResolved` 保留人工兜底**；`summarizeDispute()` 仅摘要 | `server.mjs:settleTask()` 补发 `SettlementRequested`（M1）；`hDispute()` 的 open / resolve；`domain.mjs:summarizeDispute()` | **⑫**、⑧、⑨ | **满足**（首轮缺 `SettlementRequested`，本轮补齐） |
| §10.4 | 关闭状态不得被客户端覆盖；`GET /api/config` 暴露开关；每条命中输出 `reason_codes` | `server.mjs:hPreferences()/hDispatch()`；`domain.mjs:scoreCandidates()` 的 `reason_codes`；`store.mjs:config()` | ⑦ | **满足** |
| §10.5 | 禁止裁剪未成年人限制 / 违禁预检 / 举报入口**钩子**；备案回执为上线闸门 | `domain.mjs:minorRestrictionHook()/reportEntryHook()/compliancePrecheck()`；`server.mjs:createTaskImpl()`；`store.mjs:config().compliance` 钩子标记 | **⑬** | **满足（钩子层）**（首轮完全缺失，本轮补齐） |
| §10.6 | 禁止 PII / 任务正文写入 Merkle 或锚定载荷；初版禁止接公链 | `store.mjs:computeMerkleRoot()/anchorLedger()/scanAnchorText()`；`on_chain_fields` 白名单（5 字段）；`privacy_scan` 扫描 | **⑯、⑳** | **满足**（⑳ 修复 hex 摘要偶发假阳性并做确定性回归） |
| §10.7 | 禁止写入任何真实个人信息 | `store.mjs:demoUsers()`；`domain.mjs:makeVirtualNumber()` | ⑥、⑬、⑯、⑲、⑳ | **满足** |

### 2.3 `docs/03` §4 补充硬性项

| 补充项 | 代码落点 | 自检断言 | 是否满足 |
|---|---|---|---|
| 模型降级：三接口规则化兜底、闭环不中断 | `domain.mjs:extractTaskStructure()/semanticMatchHint()/summarizeDispute()` 均 `degraded:true`；`store.mjs:config().algorithm` | ⑨ | 满足 |
| 幂等与可审计：`task_id + event_id + version`、重复返回原结果、事件全链路回放 | `server.mjs:withIdempotency()`；`store.mjs:appendEvent()` 顶层 `version`；流水 `rule_version`；`store.getEvents()` | ③、⑩ | 满足 |
| 服务端强制中性排序 | `server.mjs:hPreferences()/hDispatch()`；`domain.mjs:neutralCandidates()` | ⑦ | 满足 |
| Merkle 演示零 PII | `store.mjs:anchorLedger()` + `LedgerAnchored.payload.privacy_scan` | ⑯ | 满足 |
| 权重版本留痕 `weight_version="v1.0"` / `rank_weight_version="v1.0"` | `domain.mjs:WEIGHT_VERSION/RANK_WEIGHT_VERSION`；`store.mjs:config()`；`DispatchSent` / `recordDispatch` 落 `weight_version` | ⑦、⑨、⑰ | 满足 |

### 2.4 本轮整改重点五项核验（任务书「必须补」）

| 整改重点 | 首轮状态 | 本轮动作 | 验证 |
|---|---|---|---|
| 不存在任何 SBC 转让 / 交易 / 兑换 / 收益类接口 | 已满足 | 保持 `ROUTES` 白名单；新增 6 个禁用路径的 404 断言与 `config` 标记 | ⑥ ✅ |
| 无明文手机号 / 身份证采集，事件日志与前端展示脱敏 | **有缺口**：成果正文 `content` 直接落内存 | 补 `domain:sanitizeSubmissionText()` + `hSubmit()` 脱敏 + `taskView()` 只暴露脱敏预览；前端补未成年人 / 举报钩子说明与入口占位 | ⑬、⑯、**⑲** ✅ |
| 关闭个性化由服务端强制中性排序、开关在 `/api/config` 可见 | 已满足 | 保持；新增客户端强传 `personalized:true` 仍返回 neutral 的断言 | ⑦ ✅ |
| 模型降级标记与人工兜底可验证 | 部分可验证（缺 `SettlementRequested`） | 补 `SettlementRequested`（`model_decision:null`、`no_ledger_write:true`、顺序先于记账） | ⑨、**⑫**、⑧ ✅ |
| Merkle 演示不含 PII 与任务正文 | 有扫描但不可外部验证 | `LedgerAnchored.payload` 补 `on_chain_fields` + `privacy_scan`；自检 ⑯ 全量事件载荷扫描（排除哈希）与流水 memo 扫描 | **⑯** ✅ |

### 2.5 本轮「必须修改项」清单与完成情况

| 编号 | 缺口（来源） | 补齐动作 | 新增断言 | 状态 |
|---|---|---|---|---|
| M1 | 缺 `SettlementRequested`（方案 §4.3.3/§5.1、docs/03 §4 §10.3） | `settleTask()` 在 `postLegs()` 前补发编排事件 | ⑫ | 已完成 |
| M2 | 缺未成年人 / 举报钩子（docs/03 §4 §10.5、PRD §9） | `domain:minorRestrictionHook()/reportEntryHook()` + 发布准入 + config 标记 + 前端入口 | ⑬ | 已完成 |
| M3 | 冲正仅文档预留（CONTRACT §5、docs/03 §4 §10.1） | `store:postReversal()` 反向流水 | ⑭ | 已完成 |
| M4 | `net_sbc` 漏计高质量奖励（PRD §2/§4.1.5） | `settleTask()` 改 `bounty + bonus.amount` | ⑮ | 已完成 |
| M5 | 成果正文未脱敏（CONTRACT §10.2、PRD US-06③） | `domain:sanitizeSubmissionText()` + 落内存前脱敏 | ⑲ | 已完成 |
| M6 | 驳回任务仍在任务列表（PRD US-02③） | `hListTasks()` 默认过滤终态 + `?include_terminal=true` | ⑱ | 已完成 |
| M7 | 接单缺 `RankUpdated`（PRD §4.1 第 7 步） | `hAccept()` 补发 | ⑱ | 已完成 |
| M8 | `scanAnchorText()` 直接对含 64 位 hex 的锚定载荷跑 PII 正则，hex 数字子串偶发命中导致断言 ⑯ 非确定性失败（CONTRACT §10.6） | `store.mjs:scanAnchorText()` 先剥离 32–64 位 hex 摘要再扫描，并导出供自检做确定性双向回归 | ⑳ | 已完成 |

---

## 三、技术裁决建议（明确表态，供主代理定稿）

### 裁决 1 · 冻结时点 → **维持「审核通过后冻结」，请产品修订 PRD 措辞**

**表态：不改代码，改文档。** 依据：方案 §4.1.4「发布悬赏 | 触发时点＝审核通过」、§5.2「冻结进入条件＝任务审核通过」、CONTRACT §5「发布审核通过｜冻结 赏金 + 5% 服务费」、PRD §0.5 自身表格，四处一致；CONTRACT §0 规定「与方案冲突时以方案为准」。PRD **US-01 期望结果与 §4.1 主流程第 2 步**写「发布即冻结 / `PENDING_REVIEW` 写 `CreditFrozen`」，与 PRD §0.5 自相矛盾；方案 §1.5 / §4.3.3 / §5.1 的旅程描述亦为「发布即冻结」，属方案内部描述的流程叙述差异。

技术理由：`PENDING_REVIEW` 若已冻结，审核驳回（`REJECTED` 终态）缺少契约定义的「审核驳回解冻」编排，会产生孤立冻结记录，直接违反 G4「孤立托管记录 = 0」与方案 §5.2 离开条件（只有「取消解冻 / 接单转托管」）。按「审核通过冻结」，`PUBLISHED` 状态语义与「赏金已冻结」完全自洽。

需主代理定稿：① 请产品把 US-01 与 §4.1 第 2–3 步改为「发布做合规预检 + 余额预校验，审核通过进入 `PUBLISHED` 并冻结、写 `CreditFrozen`」；② 请主代理把 CONTRACT §8 括注「发布任务（合规预检 + 冻结积分）」同步为「发布任务（合规预检 + 余额校验）」，或明确其为简写。

### 裁决 2 · 是否补发 `SettlementRequested` → **已补发，建议主代理登记契约差异**

**表态：补，且本轮已落地。** 依据：方案 §4.3.3 环节 5、§5.1 第 10 步、§4.4 模块 C 关键事件三处点名；`docs/03` §4 §10.3 把 `SettlementRequested` 列为代码层必须项；按契约 §0「方案优先」执行。CONTRACT §4 清单未列该事件，属**清单遗漏**（同清单亦未列方案 §4.4 的 `RiskBlocked`，而首轮已实现）。PRD §4.1 口径说明「事件名统一采用 §4、不补 SettlementRequested」需由产品同步修订。

对事件流的影响：在 `settleTask()` 的 `postLegs()` **之前**新增一条编排事件，顺序变为 `SettlementRequested → CreditTransferred → CreditChanged → SettlementCompleted`；该事件 `no_ledger_write:true`、不改变状态机、不新增接口、不写流水。
对自检的影响：新增断言 ⑫（存在性、顺序、`model_decision:null`、`no_ledger_write`、`rule_version`）；原有 10 条断言全部不受影响（⑩ 检查的是「必需事件子集 + count ≥ 下限」，新增事件使 count 更大、子集不变）。争议态不调用 `settleTask()`，故 ⑧ 的「无 `SettlementCompleted` / `CreditTransferred`」断言仍成立。
废弃的替代方案：不采用「PRD §4.1 只用 §4 三个事件」的口径，因其与方案三处明文及法务硬性项冲突。

### 裁决 3 · 用户榜 `net_sbc` 计入口径 → **已修正为「赏金本金 + 高质量奖励」，请产品确认**

**表态：改，且本轮已落地。** 方案 §4.1.5 / §7 与 PRD §2 明确排除的是「赠送 / 补偿 / 邀请 / 活动奖励 / 争议中积分」；「评价 ≥4.5 额外 +2% 赏金」是**已验收通过任务的有效完成报酬**，不在排除项内，首轮把它排除属研发自行加严、偏离基线。本轮 `settleTask()` 改为 `net_sbc += bounty + bonus.amount`，生态激励池自身支出属平台科目、不计入用户净获得。
验证：断言 ⑮ 检查结算者 `net_sbc = 200 + 4 = 204`、争议中接单人 `net_sbc = 0`。请产品确认「高质量奖励计入」为最终白皮书口径（若法务要求排除，需同步修订方案 §4.1.5 排除项枚举）。

### 裁决 4 · 争议退款时服务费处理 → **维持「全额托管、退款时服务费一并退回」，请财务 / 法务确认**

**表态：不改代码。** 原型把「赏金 + 5% 服务费」全额转托管，裁定 `refund_publisher` 时全额退回发布方（未成交不收服务费）。依据方案 §5.2「平台收入 | 进入条件＝结算」——争议退款未进入结算，服务费不应确认为平台收入。
若法务改判「服务费不退 / 部分退」，需在裁定前就把服务费记入 `platform_revenue`，这会与「裁定前不转付」的严格口径（CONTRACT §5「争议：全额转托管，裁定前不得转付」、断言 ⑧）冲突，必须先在状态机与账本规则上开例外并重跑自检。故维持现状，列为需法务书面明确的口径。

### 裁决 5 · dry_run 与分批扩量在初版的实现程度 → **维持「参数级 + 元数据级」，不建议本轮继续扩**

**表态：不再扩，如实登记为 P1。**
- `dry_run`：已做到「完全不落库、不改状态、任意状态可预览」（`store.beginDryRun()/endDryRun()` 使 `appendEvent/postLegs/recordDispatch` 变 no-op），断言 ⑪；比 PRD「只预览不触达」更严格。
- 分批扩量参数：`top_k / batch_size / expand / expand_to / supply_ratio / channel` 已生效并落库为可回放元数据（`DispatchRequested` / `DispatchSent` / `recordDispatch` / `batches[]`），断言 ⑰ 验证 Top-K 截断、batch 编号、channel、扩量 note。
- **未实现**：真实消息通道触达、时钟驱动的 T+3/T+10 扩量、独占窗口、「运营暂停 / 重试 / 扩量审批留痕」（方案 §4.3.3 环节 2、PRD §4.2）、`DispatchExposed/Ignored` 客户端反馈事件。这些依赖定时器、消息服务与运营后台，属 **P1（M3 / M5）**，本轮不实现也不伪装（`docs/02` §10.1 第 2、9 条明示）。
- 理由：初版目标是「跑通一条闭环证明口径可落地」，引入定时器与消息通道会显著扩大范围并削弱可复算性；参数级实现已足以证明 §3.4 / §6 的权重与分批口径。

---

## 四、初版已知限制与 P1 / P2 演进建议（不夸大实现范围）

### 4.1 已知限制（与 `docs/02` §10.1 一致）

1. **内存存储**：重启重置，无持久化 / 事务 / 并发隔离；接单原子锁依赖 Node 单线程同步代码块，非数据库锁。
2. **无真实时钟**：超时自动验收、独占窗口、审核 ≤30min、72h 争议结案、分批扩量、DRAFT 清理均为参数 / 元数据或手动触发（`auto_accept` 手动触发）。
3. **LLM 全降级**：三接口规则兜底，无向量召回、离线回放校准（AUC/ECE）、A/B 与权重灰度。
4. **榜单全量实时重算**：无增量、缓存分片、快照降级、反作弊回溯重算与公示。
5. **无真实外围系统**：消息通道、虚拟号真实分配、实名 / 资质、支付托管、风控模型、审计导出、鉴权限流、运营审批留痕。**未成年人限制与举报入口仅为钩子占位**（M2），真实核验与 24h 处置为 V8 一票否决项。
6. **链为本地演示**：仅 Merkle 摘要 + 可插拔接口，无许可链 / 备案 / T+1 对账 / 用户自查页。
7. **部分积分规则未接 HTTP**：取消已接单分账、超时信用分 −5、双向评价、邀请、违规冲正的编排未暴露（冲正能力已在仓储层，待 P1 接运营后台）。
8. **竞赛制 S3 多中标未实现**；**提交成果仅文本**，无附件 / 图像预检 / 定位打卡 / 硬件凭证。
9. **推送「结果」字段未显式落库**（以元数据近似），F-03 抽样 100 单的口径待 P1 补齐。
10. **发布方资质预检未实现**（PRD US-01「资质不符」第三类拦截仅覆盖接单人侧）。
11. **压测与灰度指标未验证**：PRD 的 1000 次并发、闭环成功率 ≥99.5%、榜单 P95 ≤5s、G1–G7 均属灰度 / 上线阶段，原型未做（V5/V6 闸门）。

### 4.2 演进建议

| 阶段 | 建议（按优先级） | 对应方案 / 文档 |
|---|---|---|
| **P1（首个完整版本）** | 持久化与真实事务；定时器驱动超时 / 独占 / 扩量与告警；运营后台接入取消、冲正、双向评价、邀请与频次上限；争议仲裁中心与人工后台；未成年人实名核验与举报 24h 处置闭环（V8）；发布方资质 + 图像 / 附件内容安全；真实消息通道与 `DispatchExposed/Ignored` 反馈；补推送「结果」字段；LLM 接入但保留降级与留痕；链下 / 链上锚定与 T+1 对账；榜单增量 + 快照降级 + 反作弊；鉴权限流、审计导出；权重版本灰度与公示 7 天 | M2–M5、P1 MVP 灰度、`docs/07` §8–§9 |
| **P2（完整版）** | 推送 v2 多目标模型 + 在线反馈校准；实时多维榜单与账号级个性化；竞赛制 S3 多中标；企业发布方对账 / 发票；开放 API；算法备案 + 区块链信息服务备案 + 白皮书正式稿 + 第三方安全测试 | P2 完整版、V1/V2/V4 |
| **P3** | 智能硬件终端（大屏播报、身份核验打卡、离线队列补传），依赖 P2 接口冻结 | 方案 §2.1、D7 |

> **上线一票否决提醒**（致主代理 / 法务）：`docs/07` 的 V1–V8 与 G6 在初版状态为「未上线、不触发」，**不等于已通过**；尤其 V2（两份备案回执）、V8（未成年人限制与举报通道可用）在原型中仅为钩子占位，需按 `docs/03` §5 与 `docs/07` 逐项核销后方可进入灰度。

---

## 五、结论与自检结果

**评审结论：通过（有条件）。**

- 8 项「必须修改项」M1–M8 **全部补齐**，每项均有对应新增断言（⑫⑬⑭⑮⑱⑲⑳）；原 11 条断言**一条未删、全部保留**。其中 M8 为最终复核重跑时发现的偶发缺陷：`scanAnchorText()` 对 hex 摘要误判导致断言 ⑯ 非确定性失败，已补确定性回归断言 ⑳，连跑 3 次均全绿。
- 5 项整改重点（无 SBC 转让 / 交易 / 兑换 / 收益接口；零明文 PII 采集与日志 / 前端脱敏；服务端强制个性化开关；模型降级与人工兜底可验证；Merkle 零 PII 零任务正文）**逐项核验满足**，见 §2.4。
- CONTRACT §10 七条红线、`docs/03` §4 七行硬性约束 + 五项补充硬性项，**逐条给出代码落点与自检断言编号，全部满足**；其中 §10.5 为「钩子层满足」，真实能力如实列为 V8 上线闸门，未夸大。
- 文件边界：本轮仅新建 `review/engineering-review.md`，并修订本人首轮负责的 6 个文件；**未修改** `README.md`、`CONTRACT.md`、`三宝殿项目方案_v1.0.md`、`COMPLIANCE.md`、`docs/01`、`docs/03`、`docs/07` 及 `review/` 下他人文件。

**自检结果**

```
$ node tests/smoke.mjs
PASS ① … PASS ⑳（共 20 项）
自检结果：PASS 20 / FAIL 0 / 共 20 项 → 全绿 ✓    退出码 0
```

- 语法检查：`node --check` 对 `src/domain.mjs`、`src/store.mjs`、`src/server.mjs`、`tests/smoke.mjs` 均通过。
- 静态页：`curl` 确认 `GET /` → 200 `text/html; charset=utf-8`；`GET /index.html` → 200；`POST /api/sbc/transfer` → 404；`GET /api/health` → 200。
- PASS 数量变化：**阶段 A 11 → 阶段 B 20**（新增 9 项 ⑫～⑳；原 11 项全部保留且通过）。新增 ⑳ 把「上链摘要零 PII」从偶发通过变为确定性可验证。

**仍需拍板事项（3 项，均不影响本轮初版交付）**

1. **产品 / 主代理**：冻结时点口径统一 —— 请修订 PRD US-01、§4.1 第 2–3 步与 CONTRACT §8 括注，统一到「审核通过后冻结」（裁决 1）。
2. **主代理 / 产品 / 法务**：`SettlementRequested` 契约差异登记 —— 请主代理在 CONTRACT 登记该事件，产品修订 PRD §4.1 口径说明，法务确认与 `docs/03` §4 §10.3 一致（裁决 2）。
3. **法务 / 财务 / 产品**：两项积分口径确认 —— 争议退款时服务费是否一并退回（裁决 4）、用户榜 `net_sbc` 是否计入高质量奖励（裁决 3，代码已按计入实现）。

*本记录与 `docs/02-技术架构与接口契约.md` v0.2、`tests/smoke.mjs` 20 项自检同版本。*
