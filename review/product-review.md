# 阶段 B · 产品负责人交叉评审记录

| 项 | 内容 |
|---|---|
| 角色 | 产品负责人（阶段 B 交叉评审与收敛） |
| 评审对象 | 研发 `docs/02-技术架构与接口契约.md`、`src/server.mjs`（路由表 `ROUTES` 与结算编排 `settleTask` / `hReview` / `hDispute`）；法务 `COMPLIANCE.md`、`docs/03-合规基线与SBC白皮书要点.md`、`docs/07-上线检查清单.md` |
| 评审依据 | `CONTRACT.md`（唯一共同基线）、`三宝殿项目方案_v1.0.md`（只读基线）、本方 `README.md`、`docs/01-产品需求与路线图.md` |
| 结论 | **有条件通过**（详见第五部分） |
| 版本 | v0.1 |

> 本记录只评审产品口径与流程落点，不含代码实现；对契约本身疑似错误只提出裁决建议，**由主代理统一修契约，产品侧不自行改动**。以上他方产出均已实际阅读，非凭记忆。

---

## 一、对研发的评审

### 1.1 PRD 用户故事 / 需求点 → 实际接口 → 是否覆盖 → 差异

| PRD 用户故事 / 需求点 | 实际接口（`src/server.mjs` 路由） | 是否覆盖 | 差异 / 未覆盖项 |
|---|---|---|---|
| US-01 发布任务 | `POST /api/tasks` | **部分覆盖** | 原 PRD 写「发布即冻结」与研发不符：`createTaskImpl` 只做合规预检 ＋ **余额预校验**、状态 `PENDING_REVIEW`、发 `TaskPublished`，**不冻结、不写积分流水**；冻结在 `hReview`。→ 我方已修订 PRD，见第三部分裁决 1 |
| US-02 平台审核 | `POST /api/tasks/:id/review` | **覆盖** | approve → `PUBLISHED` ＋ `postLegs` 冻结（`CreditFrozen`）＋ `TaskUpdated` ＋ `RankUpdated`；reject → `REJECTED` ＋ `TaskUpdated`。差异：研发 `TaskPublished` 在**发布时**发（非审核时），PRD §4.1 已按研发时点修订，事件名仍全部取自 CONTRACT §4 |
| US-03 触发推送 / `dry_run` | `POST /api/tasks/:id/dispatch` | **覆盖** | 差异：研发默认 `top_k=12 / batch_size=8 / expand_to=30`（方案 §3.4 S1 首批 K=8），参数可覆盖；`algorithm_degraded` 恒 true（初版全降级，符合契约 §6） |
| US-04 任务列表 / 任务榜 / 用户榜 | `GET /api/tasks`、`/api/leaderboard/tasks`、`/api/leaderboard/users` | **覆盖** | 差异：关闭个性化时研发任务榜返回 `rank_weight_version:'neutral'`（中性排序无权重版本），合理；用户榜 `net_sbc` 只累加 `bounty`（符合裁决 3） |
| US-05 接单（原子锁） | `POST /api/tasks/:id/accept` | **覆盖（原子性）** | **未覆盖**：PRD「1000 次并发仅 1 个成功」为方案 F-04 压测口径，本轮自检 ⑤ 仅验证 **4 人并发**；独占窗口 3 / 15 min 无计时器（P1） |
| US-06 提交成果 | `POST /api/tasks/:id/submit` | **部分覆盖** | **未覆盖**：研发 `content` 仅字符串，无图片 / 视频 / 定位打卡 / 硬件凭证；「剩余 20% 提醒」「超 deadline 转 `EXPIRED`」「信用分 −5」无真实时钟（研发 `docs/02` §10.1 第 2 / 7 项已如实登记）。PRD 已标注初版范围与 P1 |
| US-07 验收 / 结算 / 流水核对 | `POST /api/tasks/:id/verify`、`GET /api/ledger/:userId`、`GET /api/events` | **覆盖** | 差异：24h 自动验收初版由 `decision:'auto_accept'` **手动触发演示**、无真实时钟；结算**不单设端点**（与我方阶段 A 收敛一致）；事件为 `CreditTransferred` / `CreditChanged` / `SettlementCompleted` / `TaskDelisted` / `RankUpdated` |
| US-08 合规开关 / 争议 / 可观测 | `POST /api/preferences/personalized`、`GET /api/config`、`POST /api/tasks/:id/dispute`、`GET /api/events`、`GET /api/health`、`GET /` | **覆盖** | 差异：争议 `resolve(refund_publisher)` 把 `total = bounty + 5% fee` **全额退回**（含服务费），见裁决 4 |
| 任务状态机 / 幂等 | 全写接口 `withIdempotency` ＋ `canTransition` | **覆盖** | 自检 ③（重复 `event_id` 不重复记账）、④（非法迁移被拒） |
| 结算编排 / 五科目守恒 | `settleTask` ＋ `store.postLegs()` | **覆盖** | Σdelta 恒为 0、`Object.freeze` 只追加流水；自检 ② |
| 事件流全链路回放 | `GET /api/events?task_id=` | **覆盖** | 自检 ⑩；`payload` 经 `sanitizePayload` 脱敏 |
| 关闭个性化 / 算法降级 / `dry_run` / 转让接口 404 | 对应接口 ＋ `GET /api/config` | **覆盖** | 自检 ⑥⑦⑨⑪ |
| **取消、超时信用分 −5、双向评价、邀请、违规冲正** | 无 HTTP 端点 | **未覆盖（后续）** | `computeCancelSettlement()` / `timeoutCreditPenalty()` 等纯函数已实现，因 CONTRACT §8 无对应端点未暴露（研发 `docs/02` §7.2 / §10.1 第 7 项如实登记）→ P1 |
| **举报入口、未成年人限制、协议与隐私政策、注销与删除权** | 无 HTTP 端点 | **未覆盖（后续）** | 研发 `docs/02` §11 第 5 条 / §10.1 第 5 条明确列为原型未实现、上线闸门 → 见第二部分 |
| **CONTRACT §4 事件 `DispatchExposed` / `DispatchIgnored`** | 无客户端回传端点 | **未覆盖（后续）** | 初版未产生这两个事件（§8 无对应端点）→ P1 客户端埋点，需研发在 `docs/02` §10.1 登记 |
| **研发新增 `RiskBlocked` / `PreferenceChanged` 事件** | `server.mjs` 第 248 / 730 行、`docs/02` §6.1 | **口径越界** | CONTRACT §4 事件清单**未列**这两个事件名，违反「事件名不得自造」→ 需主代理补登记或研发改用既有 `TaskUpdated` / `CreditChanged` 承载；我方 PRD 不引用 |

**点名的未覆盖项汇总**：① 成果形态（仅文本）；② 全部时钟类编排（自动验收 / 独占窗口 / 超时 / 72h 结案 / 剩余 20% 提醒 / DRAFT 清理）；③ 1000 次并发压测口径；④ 取消端点与 90%/10% 分账编排；⑤ 举报入口、未成年人限制、协议与隐私政策、注销与删除权 4 个合规节点；⑥ `DispatchExposed` / `DispatchIgnored` 事件；⑦ 双向评价 / 邀请 / 违规冲正编排；⑧ 竞赛制 S3 多中标。以上均为 P1／上线闸门项，研发 `docs/02` §10.1 已如实登记，不破坏本轮「一条闭环」目标。

### 1.2 README 启动命令与自检说明与研发实现的一致性

| README 表述 | 研发实际实现 | 结论 |
|---|---|---|
| `node src/server.mjs` | `src/server.mjs` 默认 `PORT=8787`、可用 `PORT` 覆盖、监听 `127.0.0.1`；`docs/02` §9 为 `PORT=8787 node src/server.mjs` | **一致**（PORT 可省略）；已补 `PORT` 可覆盖说明 |
| `http://localhost:8787` | `docs/02` §9 用 `http://127.0.0.1:8787/` | 等价；已补注 `127.0.0.1` 与 `/index.html` 同样可访问 |
| `node tests/smoke.mjs` | `docs/02` §9：自行 spawn 随机空闲端口、轮询 `/api/health`、结束关闭子进程；期望 `PASS 11 / FAIL 0`、退出码 0 | **一致** |
| 「16 个 HTTP 接口」 | `ROUTES` 15 条 ＋ 静态 `GET /`／`/index.html` ＝ 16，与 CONTRACT §8 一致；但 `docs/02` §1 写「**15 个 HTTP 接口**」、§3 表列 16 行 | 数值**与契约一致**；研发文档内部 15 / 16 表述不统一 → 需研发修订 |
| 「逐接口校验发布、审核、……」 | 自检为 **11 项断言**（① 端到端闭环 ② 结算流水守恒 ③ 重复 `event_id` ④ 非法迁移 ⑤ 4 人并发 ⑥ 转让接口 404 ⑦ 个性化开关 ⑧ 争议托管 ⑨ 算法降级 ⑩ 事件回放 ⑪ `dry_run`），**非逐接口 16 个逐一校验** | **表述夸大** → 我方已修订 README 为「11 项断言覆盖核心链路」 |
| 零第三方依赖 / Node.js 22+ | `docs/02` §1：仅 `node:` 内置模块、无 `package.json`、无 `npm install`、Node.js 22 ESM | **一致** |

---

## 二、对法务的响应：7 个合规节点落点

> 依据 `docs/03` §3（「缺一即视为本轮不通过」）。逐条给出「已落点位置 / 缺失 / 初版最小体现方式」；缺的直接补进 PRD §9「合规节点落点表」（含双端位置列）。

| 合规节点 | 法务要求位置 | 已落点位置 / 缺失 | 初版最小体现方式 | PRD 落点 |
|---|---|---|---|---|
| **1 个性化推荐关闭开关** | 账号级设置、注册后可见、服务端强制 | **已落点**：`POST /api/preferences/personalized` 为唯一写入点；`hDispatch` / `hLeaderboardTasks` 忽略客户端传参 | 已具备（自检 ⑦）：关闭后按时间 ＋ 距离中性排序 | §9 节点 1、US-08、§2 |
| **2 未成年人限制** | 注册 / 实名绑定；发布与接单前校验 | **缺失**（研发 `docs/02` §11 第 5 条如实登记） | 以「注册／实名准入 → 发布前置校验」写入 PRD §9 ＋ §1 旅程；`POST /api/tasks` 合规预检保留准入校验位、虚拟号占位、不采集真实 PII；功能列 V8 一票否决、状态「未上线、不触发」 | §9 节点 2（**补强**） |
| **3 违禁任务预检** | 发布提交前 ＋ 平台审核人工抽检 | **已落点** | 违禁词一票拦截（`COMPLIANCE_BLOCKED`）＋ 操作台「试一下违禁词拦截」演示；图像预检 / 人工抽检 P1 | §9 节点 3、US-01、§2 |
| **4 举报入口** | 任务详情页与客户端全局常驻 | **缺失**（研发 `docs/02` §10.1 第 5 条如实登记） | §8 无独立端点 → **不新增端点、不伪造处置闭环**；以 PRD §9 位置标注 ＋ `docs/07` §7 的 V8 核销项体现；P1 补入口与运营审批留痕（可经 `GET /api/events` 回放） | §9 节点 4（**补强**：明确「入口占位 ＋ 上线闸门」） |
| **5 人工仲裁入口** | 争议发起 → 全额托管 → 人工裁定（`DISPUTED`） | **已落点** | `action:'open'` 全额托管 ＋ `action:'resolve'` 人工裁定后分账；`hVerify` 限定 `SUBMITTED` 阻断借验收接口转付；`summarizeDispute()` `decision:null` | §9 节点 5（由原「结算与争议人工兜底」**拆分单列**）、US-08、§4.2 |
| **6 协议与隐私政策** | 注册 / 首次使用强制确认，上线前上线 | **缺失**（研发 `docs/02` §10.1 第 5 条如实登记） | 以「注册／首次使用强制确认（平台服务协议明确非劳动关系 ＋ 隐私政策）」写入 PRD §9；初版不新增端点、不采集同意记录；功能列 V7 一票否决 | §9 节点 6（**新增**） |
| **7 注销与删除权** | 账户设置；删除 PII、保留不可变流水摘要 | **缺失**（研发 `docs/02` §10.1 第 5 条如实登记） | 以「账户设置 → 注销：删除 PII、保留不可变流水摘要」写入 PRD §9；演示数据全虚构不含真实 PII；留存以 `docs/03` §6（业务流水 ≥ 3 年 / 埋点 180 天 / 定位轨迹 30 天）为基线；功能列 V7 | §9 节点 7（**新增**） |

> 结论：7 项中 **3 项已落点（1 / 3 / 5）**，**4 项缺失（2 / 4 / 6 / 7）已补进 PRD §9**，均以「文档标注 ＋ 上线闸门核销」为初版最小体现，不伪装已交付。法务要求的「双端用户旅程」因初版无独立小程序／APP 客户端，按发布方端／接单人端／平台运营端标注，统一由操作台承载并注明占位；产品侧不越界改 `web/index.html`。

---

## 三、口径冲突的产品侧裁决建议

### 裁决 1 · 积分冻结时点

- **冲突**：研发＝审核通过后冻结（`hReview` → `postLegs`，与状态机语义 `PUBLISHED ＝ 赏金已冻结` 一致）；CONTRACT §8 括注＝「发布任务（合规预检 ＋ 冻结积分）」；CONTRACT §5＝「发布审核通过｜冻结」；方案 §4.1.4＝「提交审核时冻结…平台审核通过后生效」；方案 §5.1 第 2 步＝`PENDING_REVIEW` 阶段即冻结。
- **裁决**：统一为「**提交审核 → 审核通过后冻结赏金 ＋ 5% 服务费**」。`POST /api/tasks` 只做合规预检 ＋ 余额预校验（仅校验、不冻结、不写流水）；`POST /api/tasks/:id/review` 审核通过进入 `PUBLISHED` 才冻结并落 `CreditFrozen`。依据：CONTRACT §5（积分规则唯一事实源）＋ 方案 §4.1.4 ＋ 研发实现 ＋ 状态机语义。
- **契约处理**：CONTRACT §8 括注「发布即冻结」为表述误差，建议主代理统一改为「发布任务（合规预检 ＋ 余额预校验；审核通过后冻结积分）」；方案 §5.1 第 2 / 3 步时点差异登记。**产品侧不改契约**（我方已修订 README 与 PRD：§0.5 冻结时点说明、§0.6 注、§2、US-01 / 02、§4.1 第 1–3 步）。

### 裁决 2 · 方案 §4.3.3 的 `SettlementRequested` 事件与研发采用的事件名

- **冲突**：方案 §4.3.3 环节 5 与 `docs/03` §4（§10.3 行）出现 `SettlementRequested`；研发 `settleTask` 采用 `CreditTransferred` / `CreditChanged` / `SettlementCompleted` / `TaskDelisted` / `RankUpdated`；CONTRACT §4 事件清单**未列** `SettlementRequested`，且 §8 无独立结算端点。
- **裁决**：初版**不采用** `SettlementRequested`；结算由 `POST /api/tasks/:id/verify` 验收通过后内部编排，事件统一用 CONTRACT §4 的 `CreditTransferred` / `CreditChanged` / `SettlementCompleted`。产品 PRD 不引入契约外事件名（本方阶段 A 已如此收敛）。
- **需修订**：请法务将 `docs/03` §4 表格中的 `SettlementRequested` 对齐为 `SettlementCompleted`（或提请主代理在契约 §4 补登记）；请主代理登记方案 §4.3.3 与实现的差异。

### 裁决 3 · 用户榜 `net_sbc` 是否计入「评价 ≥ 4.5 的 2% 质量奖励」

- **冲突**：方案 §4.1.5 只排除「赠送、补偿、邀请、活动奖励」，未明确完成奖励；研发 `settleTask` 只把 `bounty` 累加进 `net_sbc`，`bonus.amount` 经 `eco_incentive` 池进接单人 `available` 余额。
- **裁决**：**不计入**。`net_sbc` 仅指「已验收通过任务的赏金本金净获得」；高质量奖励（＋2%、单任务上限 50 SBC）**计入接单人可用余额，但不计入 `net_sbc` 与榜单分**（防刷榜）。依据方案 §4.1.5 延伸 ＋ 研发实现 ＋ 榜单公平性护栏。
- **我方已修订**：PRD §0.4 新增「用户榜计入口径」段、§2 用户积分排行榜行、US-04 验收条件 ③。
- **需法务修订**：`docs/03` §1 要点 5 补一句明确此口径，供白皮书勾稽。

### 裁决 4 · 争议退款时 5% 服务费是否一并退回

- **冲突**：研发 `hDispute(resolve, refund_publisher)` 把 `total = bounty + 5% fee` 从 `escrow` 全额退回发布方；方案 §5.2「平台收入在结算时确认」；研发 `docs/02` §11 待确认项 3 提请财务 / 法务确认。
- **裁决**：**一并全额退回**（未成交不收服务费）。争议退款未进入结算，`platform_revenue` 科目不确认收入；`POST /api/tasks/:id/dispute` 裁定 `refund_publisher` 时 `escrow −total` / `user:pub +total`。产品侧认可研发实现。
- **我方已修订**：PRD §2 争议行、§4.2 争议分支补「裁定退款时赏金 ＋ 5% 服务费全额退回发布方（未成交不收服务费）」。
- **需法务 / 财务修订**：白皮书与对账口径明确「服务费仅在结算时确认收入、争议退款全额退回」，与 `docs/03` §1 要点 4 / 要点 7 勾稽。

### 裁决 5 · 取消、举报在初版没有独立端点时，操作台 / 运营留痕的最小可行落点

- **事实**：CONTRACT §8 无 `/api/tasks/:id/cancel`、无举报端点；研发 `ROUTES` 只登记 §8 的 15 条，未登记路径一律 404；`computeCancelSettlement()` 纯函数已实现但未暴露。
- **裁决（不新增端点、不越界、不伪造闭环）**：
  1. **已接单／争议态取消**：复用 `POST /api/tasks/:id/dispute` 人工裁定通道（`action:'open'` → `action:'resolve'`，`resolution:'refund_publisher'` → `CANCELLED` / `'close'` → `CLOSED`），由运营在操作台「任务详情 → 运营干预」触发；`DisputeOpened` / `DisputeResolved` / `CreditChanged` 事件经 `GET /api/events` 自动留痕、可回放。这是初版唯一可把任务合法变更到 `CANCELLED` / `CLOSED` 的路径。
  2. **未接单取消（`PUBLISHED` / `DISPATCHING`）**：初版**确无 HTTP 路径**（review 只受理 `PENDING_REVIEW`，dispute `open` 只受理 `IN_PROGRESS` / `SUBMITTED`，`resolve` 只受理 `DISPUTED`）。如实登记为缺口，以 `CANCELLED` 终态 ＋ `computeCancelSettlement()` 纯函数占位；P1 补 `/api/tasks/:id/cancel`（需先在契约 §8 补登记）与 90% / 10% 分账编排。
  3. **举报**：操作台任务详情 / 任务榜条目 / 全局常驻「举报」为**入口占位**；初版不新增举报端点、不伪造处置闭环与 24h 时效报表；以 PRD §9 位置标注 ＋ `docs/07` §7 的 V8 核销项体现，P1 补端点与运营审批留痕（可经 `GET /api/events` 回放）。
- **我方已修订**：PRD §4.2 取消分支、§7 范围外清单、§9 节点 4。

---

## 四、必须修改项

### 4.1 我方已自行修订（`README.md`、`docs/01-产品需求与路线图.md`）

| # | 修订内容 | 文件 / 位置 |
|---|---|---|
| 1 | 冻结时点统一为「提交审核 → 审核通过后冻结赏金 ＋ 5% 服务费」；发布环节改为合规预检 ＋ 余额预校验（仅校验、不冻结） | PRD §0.5 冻结时点说明、§0.6 注、§2 任务发布 / 平台审核行、US-01 / 02、§4.1 第 1–3 步 |
| 2 | §4.1 事件时点对齐研发：第 1 步 `TaskPublished`（发布提交）、第 3 步 `TaskUpdated` / `CreditFrozen` / `RankUpdated`；登记与方案 §5.1 差异 | PRD §4.1 |
| 3 | 明确用户榜 `net_sbc` 计入口径：仅赏金本金；质量奖励计入余额、不计入榜单分 | PRD §0.4、§2、US-04 |
| 4 | 争议退款全额退回（含 5% 服务费） | PRD §2 争议行、§4.2 争议分支 |
| 5 | §9 由 5 项扩展为**法务 7 个合规节点落点表**，新增「双端位置」「已落点 / 缺失」「初版最小体现方式」列；新增协议与隐私政策、注销与删除权；人工仲裁入口单列 | PRD §9 |
| 6 | 初版能力边界如实登记：成果仅文本、无真实时钟（自动验收 / 独占窗口 / 超时 / 72h 结案 / 剩余 20% 提醒）、1000 并发为压测口径、自检 11 项断言 | PRD §2、US-05 / 06 / 07、§4.1 第 6 步、§4.2、§7 |
| 7 | 明确「不新增 CONTRACT §8 之外的端点」，取消 / 举报 / 注销 / 协议确认以流程标注 ＋ 纯函数占位 ＋ 上线闸门核销体现 | PRD §7 |
| 8 | README 快速开始：补 `PORT` 可覆盖、`127.0.0.1` 与 `/index.html` 等价、接口数澄清（15 API ＋ 静态 `GET /` ＝ 16）；自检说明由「逐接口校验」改为「11 项断言覆盖核心链路（PASS 11 / FAIL 0）」；状态与边界补阶段 B 评审索引 | README 快速开始、状态与边界 |
| 9 | PRD 版本升 v0.2，口径约束补「契约有错由主代理统一修、产品侧不自行改」 | PRD 元信息 |

### 4.2 需研发修订

| # | 事项 | 优先级 |
|---|---|---|
| 1 | `docs/02` §1「15 个 HTTP 接口」与 §3 表 16 行、CONTRACT §8 16 行不一致 → 统一为「15 个 `/api/*` 端点 ＋ 静态 `GET /` ＝ 16 个接口」 | 本轮（表述） |
| 2 | 研发实际产生的 `RiskBlocked` / `PreferenceChanged` 不在 CONTRACT §4 事件清单 → 请主代理补登记，或改用既有 `TaskUpdated` / `CreditChanged` 承载；补登记前产品侧不引用 | 本轮（口径） |
| 3 | CONTRACT §4 的 `DispatchExposed` / `DispatchIgnored` 初版未产生（无客户端回传端点）→ 在 `docs/02` §10.1 明确登记为 P1 埋点 | 本轮（登记） |
| 4 | 举报入口、未成年人限制、协议与隐私政策、注销与删除权的客户端入口占位（初版保持「未实现」如实登记，不伪装交付） | P1 |
| 5 | 真实时钟编排：超时自动验收、独占窗口 3 / 15 min、分批扩量、72h 争议结案、DRAFT 7 天清理、剩余 20% 提醒 | P1 |
| 6 | `/api/tasks/:id/cancel` 独立端点 ＋ `computeCancelSettlement()` 90% / 10% 分账编排（需先在契约 §8 补登记）；成果图片 / 视频 / 定位打卡；双向评价、邀请、违规冲正编排 | P1 |
| 7 | 1000 次并发接单压测（F-04）与五科目守恒压测（账本写入 ≥ 500 TPS、推送决策 P95 ≤ 200ms） | 压测阶段 |

### 4.3 需法务修订

| # | 事项 | 依据 |
|---|---|---|
| 1 | `docs/03` §4（§10.3 行）的 `SettlementRequested` 对齐为 CONTRACT §4 的 `SettlementCompleted`（或提请主代理补登记契约） | 裁决 2 |
| 2 | `docs/03` §1 要点 5 明确「评价 ≥ 4.5 的 ＋2% 质量奖励计入余额、不计入用户榜 `net_sbc`」 | 裁决 3 |
| 3 | 白皮书 / 对账口径明确「服务费仅在结算时确认收入、争议退款时赏金 ＋ 5% 服务费全额退回」 | 裁决 4 |
| 4 | **D4（SBC 是否设 12 个月有效期）拍板**并写入白皮书；未拍板前保持「待评审」标注，不自造数值 | `docs/03` §1 要点 6、V1 / F-10 |
| 5 | 细化 V7（协议与隐私政策）与 V8（未成年人限制、举报 24h 处置率 100%）的功能验收证据形式；明确 4 项初版缺失节点状态为「未上线、不触发」，不得表述为已通过 | `docs/07` §6 / §7 |

### 4.4 需主代理统一修契约（产品侧不自行改动）

1. CONTRACT §8 `POST /api/tasks` 括注「发布任务（合规预检 ＋ 冻结积分）」→ 建议改为「发布任务（合规预检 ＋ 余额预校验；审核通过后冻结积分）」，与 §5 一致（裁决 1）。
2. CONTRACT §4 是否补登记 `RiskBlocked` / `PreferenceChanged`，或要求研发改用既有事件；并登记方案 §4.3.3 `SettlementRequested` 与实现的差异（裁决 2）。
3. 登记方案 §5.1 第 2 / 3 步（冻结与 `TaskPublished` 时点）与 CONTRACT §5、研发实现的差异。
4. 若 P1 新增 `/api/tasks/:id/cancel`，先在契约 §8 补登记后实施（裁决 5）。

---

## 五、结论

**结论：有条件通过**（仅针对本轮「项目初版」＝可本地运行最小闭环原型 ＋ 三类评审文档；不构成任何上线许可，法务对红线保留一票否决权）。

**前置条件（全部满足方可维持）**：

1. 我方已完成 4.1 全部 9 项修订，PRD 升 v0.2；README 启动 / 自检表述与研发实现一致。
2. 主代理按 4.4 统一修契约并登记三处口径差异；产品侧未改动契约、方案与任何他人文件。
3. 研发按 4.2 第 1–3 项完成本轮表述 / 口径 / 登记修订；P1 项保持 `docs/02` §10.1「如实登记、不伪装交付」。
4. 法务按 4.3 完成 5 项确认，其中 D4 拍板、V7 / V8 证据形式细化；7 个合规节点中 4 项缺失节点状态为「未上线、不触发」。
5. 一票否决清单 V1–V8 在本轮为「未上线、不触发」，不得表述为已通过（`docs/03` §5 口径）。
6. 阶段 C 由主代理汇总三方评审、落实必须修改项，并跑通 `node tests/smoke.mjs`（`PASS 11 / FAIL 0`、退出码 0）后产出 `docs/04-协作评审记录.md` 与 `docs/05-初版验收自检.md`。

> 若 4.4 契约修订未落实，则「冻结时点」「`RiskBlocked` / `PreferenceChanged` 事件名」仍存在契约与实现不一致，本结论退为「不通过」，须回阶段 C 重新收敛。
