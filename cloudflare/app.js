/* ==========================================================================
 * 三宝殿 · sambon.net — 生产系统操作台（前端 SPA，纯原生 ES module）
 *
 * 无框架、无第三方依赖、无 CDN、无内联脚本。所有请求为同源真实 fetch，/api/ 开头。
 * 统一响应信封：{ ok: true|false, data: ..., error: { code, message } | null }
 * 生产页 CSP 为 script-src 'self'：本文件是唯一入口模块。
 *
 * 模块职责：
 *   0. I18N / t()     中英双语文案表与渲染函数（界面全部可见文案经此输出）
 *   A. 常量 / state   全局内存状态
 *   B. 工具函数       HTML 转义、事件 ID、toast、通用表格、键值网格
 *   C. api()          统一 fetch 封装：CSRF 头、JSON、401、错误 toast、请求超时
 *   D. load*()        各 GET 数据加载器（含通知 / 运维 / 能力矩阵）
 *   E. render*()      纯字符串模板渲染：顶栏、认证、工作台、运维面板、弹窗
 *   F. 二次确认弹窗   人工闸门（审核/推送/验收/裁定/撤回/风控/锚定/定时任务）
 *                     与 DELETE 账号校验；确认按钮固定写明「人工确认」
 *   G. actions        所有写操作，写后统一刷新相关只读面板
 *   H. bootstrap()    启动顺序：health 判定模式与写锁 → 配置与会话 → 通知轮询
 *   I. 事件委托       单一 click / input / change / submit / keydown 处理器
 *
 * 合规约束：SBC 仅表述为「平台内贡献积分，不可兑付、不可转让」；
 * 结算、争议裁定、任务审核、自动验收、风控处置、账号处罚一律 admin 人工确认弹窗。
 * ========================================================================== */

/* ------------------------------------------------ 0. 国际化：I18N / t() ---- */

const I18N = {
  'zh-CN': {
    /* 通用 */
    'common.refresh': '刷新',
    'common.humanConfirm': '人工确认',
    'common.cancel': '取消',
    'common.confirmDelete': '确认删除',
    'common.yes': '是',
    'common.no': '否',
    'common.empty': '暂无数据',
    'common.loading': '正在请求 /api/health 与系统配置…',
    'common.humanGate': '人工确认闸门：结算、争议裁定、任务审核、自动验收、风控处置与账号处罚均须经人工确认后由服务端执行；服务端按角色与状态强制校验（enforcement: server_side），前端展示不构成授权。',
    'common.confirmRequired': '[CONFIRM_REQUIRED] 请输入 {word} 以确认该操作',
    'common.typeToConfirm': '请输入 {word} 以确认',

    /* 静态骨架（index.html 的 data-i18n） */
    'brand.sub': '悬赏互助平台 · 生产系统操作台',
    'topbar.logout': '退出登录',
    'topbar.notLoggedIn': '未登录',
    'topbar.userChip': '{name}（{email}）· 角色 {role}',
    'topbar.notifications': '通知 ({n})',
    'l1.title': 'L1 状态声明',
    'l1.body': '本站为生产系统演示环境，未完成 docs/07 的 G1–G7 与 V1–V8 全部核销，不构成正式运营许可；不承诺任何服务等级（SLA）或可用性指标。',
    'demo.body': '演示模式：后端未绑定 D1 持久化，写操作不可用。',
    'demo.link': 'L0 演示台',
    'demo.writeLocked': '演示模式：后端未绑定 D1 持久化，写操作不可用',
    'demo.writeLockedToast': '[WRITE_LOCKED] 演示模式：后端未绑定 D1 持久化，写操作不可用',
    'footer.legal': '隐私政策 / 服务条款 / 可接受使用政策 / AI 透明度 / 未成年人限制 / 举报通道',
    'footer.sbc': 'SBC 为平台内贡献积分，不可兑付、不可转让。',
    'cookie.title': 'Cookie 与同意',
    'cookie.body': '必要 Cookie 用于会话与 CSRF 安全（httpOnly 会话 Cookie 由浏览器自动携带）；分析 Cookie 仅用于匿名统计，可选。你可在「数据与账号」中随时调整。',
    'cookie.link': '查看隐私政策',
    'cookie.accept': '接受必要+分析',
    'cookie.necessary': '仅必要',
    'cookie.recordedAll': '已记录：必要 + 分析 Cookie 同意',
    'cookie.recordedNecessary': '已记录：仅必要 Cookie',
    'meta.ready': '后端状态 {status} · 数据库 {db} · 版本 {version} · 时间 {time} · 写操作{lock}',
    'meta.lock': '已禁用',
    'meta.unlock': '可用',
    'meta.fail': '健康检查未通过，写操作已禁用',
    'meta.notReady': '健康检查未就绪',

    /* 错误 */
    'err.timeout': '请求超时，请稍后重试',
    'err.network': '网络请求失败：{msg}',

    /* 认证视图 */
    'auth.title': '账号接入',
    'auth.subtitle': '本站为生产系统演示环境，账号接入仅用于内部核验，不构成服务对外开放或运营许可。',
    'auth.tab.login': '登录',
    'auth.tab.register': '注册',
    'auth.email': '邮箱',
    'auth.password': '密码',
    'auth.displayName': '显示名',
    'auth.role': '角色',
    'auth.rolePublisher': '发布方 publisher',
    'auth.roleSolver': '解决方 solver',
    'auth.login': '登录',
    'auth.register': '注册',
    'auth.csrfNote': '登录 / 注册响应中的 <code>data.session.csrf_token</code> 将用于后续所有写操作的 <code>X-CSRF-Token</code> 请求头；会话 Cookie 为 httpOnly，由浏览器自动携带。',
    'auth.complianceTitle': '合规要点 / Compliance Notes',
    'auth.comp1': '本站仅为演示环境，docs/07 的 G1–G7 / V1–V8 尚未全部核销，未取得运营许可。',
    'auth.comp2': 'SBC 为平台内贡献积分，不可兑付、不可转让；不构成资产、证券或电子货币，平台不提供任何价值保证。',
    'auth.comp3': '结算、争议裁定、任务审核与账号处罚均为须经人工确认的人工闸门。',
    'auth.comp4': 'AI 辅助排序已披露，个性化可关闭且由服务端强制生效（enforcement: server_side）。',
    'auth.comp5': '适用 GDPR / UK GDPR 权利与 Cloudflare DPA / SCC 跨境传输保障；仅限成年人（18+）。',
    'auth.comp6': '不承诺任何具体 SLA、可用性或响应时间。联系：privacy@sambon.net（占位）。',
    'auth.fullPolicy': '完整政策：隐私政策 / 服务条款 / 可接受使用政策 / AI 透明度 / 未成年人限制 / 举报通道',
    'auth.ok': '账号已接入：{name}',
    'auth.loggedOut': '已退出登录',

    /* 工作台标签 */
    'tab.workbench': '工作台',
    'tab.ops': '运维',

    /* 任务列表 */
    'task.listTitle': '任务列表',
    'task.count': '共 {n} 条（含终态）',
    'task.listHint': '悬赏以 SBC 计量；SBC 为平台内贡献积分，不可兑付、不可转让，不构成资产或投资标的。点击行查看详情。',
    'task.empty': '暂无任务数据；可发布任务或点击「刷新」。',
    'task.th.id': '任务 ID',
    'task.th.state': '状态',
    'task.th.title': '标题',
    'task.th.category': '分类',
    'task.th.bounty': '悬赏 SBC',
    'task.th.fee': '服务费',
    'task.th.frozen': '冻结合计',
    'task.th.created': '创建时间',

    /* 发布任务 */
    'publish.title': '发布任务',
    'publish.f.title': '标题',
    'publish.f.description': '描述',
    'publish.f.category': '分类',
    'publish.f.bounty': '悬赏（SBC 贡献积分）',
    'publish.f.criteria': '验收标准',
    'publish.f.online': '线上 / 线下',
    'publish.f.radius': '半径（公里）',
    'publish.f.skills': '所需技能（逗号分隔）',
    'publish.f.deadline': '截止（小时）',
    'publish.onlineOpt': '线上 online',
    'publish.offlineOpt': '线下 offline',
    'publish.skillsPlaceholder': '例如：翻译,校对',
    'publish.submit': '提交任务（POST /api/tasks）',
    'publish.hint': '提交后进入 PENDING_REVIEW，由管理员人工审核；<code>event_id</code> 由前端自动生成。',
    'publish.validationTitle': '[VALIDATION] 请填写任务标题',
    'publish.ok': '任务已提交{id}（合规校验已由服务端返回）',
    'publish.unverified': '邮箱未验证：发布任务前需先完成邮箱验证。服务端会拒绝未验证账号的发布请求，前端不提供可用入口。',

    /* 合规要点卡片 */
    'compliance.title': '合规要点 / Compliance Notes',
    'compliance.1': '本站仅为演示环境，docs/07 的 G1–G7 与 V1–V8 尚未全部核销，未取得运营许可。',
    'compliance.2': 'SBC 为平台内贡献积分，不可兑付、不可转让；不构成资产、证券或电子货币，平台不提供任何价值保证。',
    'compliance.3': '结算、争议裁定、任务审核与处罚均为由管理员人工确认的人工闸门；自动裁决不产生法律效力。',
    'compliance.4': 'AI 辅助候选排序通过 weight_version / algorithm_degraded 披露；个性化可在此关闭，且由服务端强制生效（enforcement: server_side）。',
    'compliance.5': 'GDPR / UK GDPR 权利：访问、更正、删除、可携带、反对与撤回同意；跨境传输依托 Cloudflare DPA 与 EU SCC / UK Addendum。',
    'compliance.6': '仅限成年人（18+），不故意收集未成年人数据；举报走站内通道或 privacy@sambon.net。',
    'compliance.7': '本环境不承诺任何具体可用性、响应时间或 SLA 数字。完整文本见 <a href="/legal.html">legal.html</a>。',

    /* 详情与动作面板 */
    'detail.empty': '从左侧任务列表选择一条任务以查看详情与按状态可用动作。',
    'detail.title': '详情 / 操作面板',
    'detail.h.description': '任务描述',
    'detail.h.criteria': '验收标准',
    'detail.h.contact': '虚拟联系方式',
    'detail.h.resultPreview': '成果预览',
    'detail.resultMasked': '成果正文已 PII 脱敏',
    'detail.actionTitle': '按状态可用动作 ·',
    'detail.actionHint': '所有动作由服务端按角色与状态强制校验（enforcement: server_side）；前端展示不代表授权。结算、争议裁定、任务审核、自动验收、风控处置与处罚均为人工闸门，执行前需二次确认。',
    'action.reviewApprove': '审核通过',
    'action.reviewReject': '审核驳回',
    'action.pendingReviewNote': '任务待人工审核；审核按钮仅对 admin 角色显示。',
    'action.topK': 'top_k',
    'action.batchSize': 'batch_size',
    'action.dryRun': 'dry_run（仅预演）',
    'action.dispatch': '推送候选（人工闸门）',
    'action.publishedNote': '推送（dispatch）按钮仅对 admin 角色显示。',
    'action.accept': '接单（solver）',
    'action.acceptNote': '服务端按角色强制校验；仅合规的 solver 可接单。',
    'action.unverified': '邮箱未验证：接单前需先完成邮箱验证；服务端会拒绝未验证账号的接单请求，前端已禁用该按钮。',
    'action.resultContent': '成果内容（提交后将按规则做 PII 脱敏）',
    'action.submitResult': '提交成果',
    'action.rating': '评分 rating',
    'action.reason': '验收理由 reason',
    'action.disputeReason': '争议理由',
    'action.verifyApprove': '验收通过',
    'action.verifyReject': '验收驳回',
    'action.autoAccept': '自动验收（admin）',
    'action.disputeOpen': '开启争议',
    'action.submittedNote': 'approve / reject 仅发布方可执行，auto_accept 仅 admin；服务端按角色强制校验。',
    'action.resolution': '裁定结果 resolution',
    'action.refundPublisher': '退回发布方 refund_publisher',
    'action.paySolver': '判给解决方 pay_solver',
    'action.close': '关闭 close',
    'action.resolveReason': '裁定理由',
    'action.disputeResolve': '人工裁定（admin）',
    'action.disputedNote': '争议裁定为管理员人工闸门，仅 admin 可提交。',
    'action.noAction': '当前状态 {state} 无前端可用动作（终态或由系统流转）。',

    /* 推送结果 */
    'dispatch.title': '推送结果（dry_run 预演）',
    'dispatch.candidates': '候选 candidates',
    'dispatch.batches': '批次 batches',
    'dispatch.noCandidates': '无候选',
    'dispatch.noBatches': '无批次',

    /* 举报 */
    'report.title': '举报通道',
    'report.hint': '举报提交后进入人工复核；详见 ',
    'report.legalLink': 'legal.html 举报通道',
    'report.reasonLabel': '举报理由',
    'report.reasonPlaceholder': '填写举报理由',
    'report.button': '举报该任务',
    'report.validation': '[VALIDATION] 请填写举报理由',
    'report.ok': '举报已提交，进入人工复核',

    /* 管理员队列 */
    'queue.title': '管理员队列',
    'queue.refresh': '刷新队列',
    'queue.pending': '待审核 pending_review',
    'queue.disputed': '争议中 disputed',
    'queue.empty': '队列为空',
    'queue.nonAdmin': '管理员队列区仅对 admin 角色开放；当前角色为 {role}。审核、推送、裁定、自动验收等 admin 操作按钮亦仅对 admin 显示。',

    /* 榜单 */
    'boards.title': '榜单',
    'boards.tasksTitle': '任务榜 leaderboard/tasks',
    'boards.usersTitle': '用户榜 leaderboard/users',
    'boards.empty': '暂无榜单数据',

    /* 账本 */
    'ledger.title': '积分账本',
    'ledger.uidLabel': '用户 ID（GET /api/ledger/:userId）',
    'ledger.hint': '账本仅记录平台内贡献积分的冻结与记账调整，用于核对平衡；纯记账记录，不具货币价值。',
    'ledger.entryCount': '条目数',
    'ledger.entriesTitle': '流水 entries',
    'ledger.noEntries': '无流水',
    'ledger.empty': '暂无账本数据。',

    /* 事件 */
    'events.title': '事件回放',
    'events.taskIdLabel': 'task_id（GET /api/events?task_id=）',
    'events.placeholder': '输入任务 ID',
    'events.empty': '暂无事件（请先选择任务或填写 task_id）',

    /* AI 透明度 */
    'ai.title': 'AI 透明度与配置',
    'ai.kv.weightVersion': 'weight_version',
    'ai.kv.algorithmDegraded': 'algorithm_degraded',
    'ai.kv.personalizedAccount': 'personalized_enabled（账号级）',
    'ai.kv.personalizedGlobal': 'personalized_enabled（全局）',
    'ai.kv.enforcement': 'enforcement',
    'ai.kv.ruleVersion': 'rule_version',
    'ai.kv.llmAdapterVersion': 'llm_adapter_version',
    'ai.kv.mode': 'mode',
    'ai.disclosureTitle': '算法说明 ai_disclosure',
    'ai.disclosureZh': 'AI 透明度说明（中文）',
    'ai.disclosureEn': 'AI 透明度说明（English）',
    'ai.disclosureEmpty': '服务端未提供说明文本。',
    'ai.disclosureHint': '候选排序仅用于辅助分派，不自动完成任务审核、验收、争议裁定或处罚；上述环节均为人工闸门。',
    'ai.degradedNote': '当前算法处于降级模式（algorithm_degraded），仅使用保守排序。',
    'ai.weightsTitle': '六项权重 ranking weights',
    'ai.weightsEmpty': '服务端未返回权重明细。',
    'ai.switchLabel': '关闭个性化推荐',
    'ai.switchHint': '勾选＝关闭；取消勾选＝开启。<strong>服务端强制生效</strong>（enforcement: server_side），客户端无法绕过；关闭方式亦见 ',
    'ai.switchLegalLink': 'legal.html AI 透明度',
    'ai.redlinesTitle': '红线 red_lines',
    'ai.redlinesEmpty': '服务端未返回红线条目。',
    'ai.enNote': 'Algorithm-assisted ranking is disclosed above; personalisation is enforced server-side and may be disabled without affecting task integrity. No automated decision produces legal effects.',
    'ai.personalOn': '个性化推荐已开启（服务端强制生效）',
    'ai.personalOff': '个性化推荐已关闭（服务端强制生效）',

    /* 数据与账号 */
    'account.title': '数据与账号（GDPR）',
    'account.export': '导出我的数据（JSON）',
    'account.delete': '删除我的账号',
    'account.cookieSettings': 'Cookie 偏好',
    'account.hint': '导出对应 <code>GET /api/me/export</code>（数据可携带权）；删除对应 <code>DELETE /api/me</code>，需输入 <code>DELETE</code> 二次确认，处理后自动退出登录。详细权利见 ',
    'account.legalLink': 'legal.html 隐私政策',
    'account.hint2': '删除账号属高影响操作，前端要求显式输入确认；服务端按 enforcement: server_side 校验。',
    'account.exportOk': '已导出我的数据（JSON 文件）',
    'account.deleteTitle': '删除我的账号（GDPR 擦除）',
    'account.deleteBody': '该操作将注销当前账号并删除关联的个人数据，且不可撤销。处理后将自动退出登录。',
    'account.deleteOk': '账号已注销，已自动退出登录',

    /* 闸门与结果 toast */
    'gate.reviewTitle': '人工确认 · 任务审核',
    'gate.reviewDetail': '任务 <code>{id}</code> 将执行「{label}」。',
    'gate.dispatchTitle': '人工确认 · 候选推送',
    'gate.dispatchDetail': '任务 <code>{id}</code> 将执行算法候选推送（dry_run 预演）。',
    'gate.verifyTitle': '人工确认 · 成果验收',
    'gate.verifyDetail': '任务 <code>{id}</code> 将执行「{label}」。',
    'gate.disputeTitle': '人工确认 · 争议裁定',
    'gate.disputeDetail': '任务 <code>{id}</code> 将按 <code>{resolution}</code> 裁定。该裁定仅调整平台内贡献积分记账科目。',
    'gate.cancelTitle': '人工确认 · 撤回任务',
    'gate.cancelDetail': '任务 <code>{id}</code> 将被撤回，撤回后不可继续流转。请填写撤回原因。',
    'gate.cancelReason': '撤回原因 reason',
    'gate.riskTitle': '人工确认 · 风控处置',
    'gate.riskDetail': '风控标记 <code>{id}</code> 将按人工处置结论处理；该操作仅调整风控队列状态。',
    'gate.riskDecision': '处置结论 decision',
    'gate.riskReason': '处置理由 reason',
    'gate.riskDismiss': '忽略 dismiss',
    'gate.riskEscalate': '升级 escalate',
    'gate.anchorTitle': '人工确认 · 本地锚定',
    'gate.anchorDetail': '将生成本地哈希摘要（Merkle root）；未接公链、零 PII。',
    'gate.cronTitle': '人工确认 · 定时任务',
    'gate.cronDetail': '将触发一次定时任务运行（dry_run: false）。生产应由外部调度器定时调用。',
    'gate.reasonGeneric': '理由 reason',
    'toast.reviewOk': '审核结果已提交（人工闸门）',
    'toast.dispatchOk': '推送已执行（mode：{mode}，人工确认）',
    'toast.acceptOk': '已提交接单',
    'toast.resultValidation': '[VALIDATION] 请填写成果内容',
    'toast.resultOk': '成果已提交',
    'toast.verifyOk': '验收结果已提交（人工闸门）',
    'toast.disputeReasonValidation': '[VALIDATION] 请填写争议理由',
    'toast.disputeOpenOk': '争议已开启，进入人工复核',
    'toast.disputeResolveOk': '裁定已提交（人工闸门）',

    /* 邮箱验证 */
    'verify.title': '邮箱验证',
    'verify.pending': '请查收验证邮件（如未配置邮件通道，请在通知中心查看验证信息）',
    'verify.tokenLabel': '验证码 token',
    'verify.tokenPlaceholder': '输入邮箱验证码',
    'verify.submit': '验证',
    'verify.unverified': '邮箱未验证：为保护账号安全，未完成邮箱验证前不可发布任务或接单。服务端会拒绝相关请求，前端不提供可用入口。',
    'verify.resend': '重发验证',
    'verify.ok': '邮箱验证成功',
    'verify.resendOk': '验证邮件已重发（如未配置邮件通道，请在通知中心查看）',
    'verify.tokenValidation': '[VALIDATION] 请输入验证码',

    /* 通知中心 */
    'notif.title': '通知中心',
    'notif.refresh': '刷新',
    'notif.readAll': '全部已读',
    'notif.readOne': '标记已读',
    'notif.empty': '暂无通知',
    'notif.close': '关闭',
    'notif.readOk': '已标记为已读',

    /* 客户端埋点回执 */
    'feedback.title': '任务曝光回执',
    'feedback.hint': '作为候选解决方，请回执是否已看到此任务；回执仅用于算法透明度说明，不改变人工闸门的结果。',
    'feedback.exposed': '已看到此任务',
    'feedback.ignored': '忽略',
    'feedback.acked': '已回执（{kind}）',
    'feedback.ok': '回执已提交（{kind}）',

    /* 取消任务 */
    'cancel.title': '任务撤回',
    'cancel.button': '撤回任务',
    'cancel.ok': '任务已撤回',

    /* 运维面板 */
    'ops.overviewTitle': '总览 /api/admin/ops',
    'ops.componentsTitle': '组件 components',
    'ops.jobsTitle': '任务 jobs',
    'ops.notificationsPending': '待发通知 notifications_pending',
    'ops.readinessTitle': '就绪度 readiness',
    'ops.configured': 'configured',
    'ops.degraded': 'degraded',
    'ops.metricsTitle': '指标 /api/admin/metrics',
    'ops.requests': '请求量 requests',
    'ops.errorRate': '错误率 error_rate',
    'ops.latency': '延迟 latency',
    'ops.ledgerBalanced': '账本平衡 ledger_integrity.balanced',
    'ops.hashChain': '哈希链有效 hash_chain_valid',
    'ops.metricsAlert': '警示：账本平衡校验未通过（balanced ≠ true），请人工核查。',
    'ops.auditTitle': '审计日志 /api/admin/audit',
    'ops.audit.empty': '暂无审计记录',
    'ops.riskTitle': '风控队列 /api/admin/risk',
    'ops.risk.empty': '风控队列为空',
    'ops.risk.handle': '人工处置',
    'ops.risk.flag': 'flag',
    'ops.risk.score': 'score',
    'ops.risk.subject': 'subject',
    'ops.risk.ok': '风控处置已提交（人工确认）',
    'ops.reportsTitle': '举报队列 /api/admin/queue',
    'ops.reports.pending': '待审核 pending_review',
    'ops.reports.disputed': '争议中 disputed',
    'ops.backupTitle': '备份与锚定 /api/admin/backup',
    'ops.backup.sha256': 'sha256',
    'ops.backup.rowCount': 'row_count',
    'ops.backup.tables': '各表条数 tables',
    'ops.backup.download': '下载 JSON',
    'ops.backup.anchor': '生成本地锚定',
    'ops.backup.merkle': 'merkle_root',
    'ops.backup.anchoredAt': 'anchored_at',
    'ops.backup.hint': '本地哈希摘要，未接公链、零 PII。',
    'ops.backup.downloadOk': '备份 JSON 已下载',
    'ops.backup.anchorOk': '本地锚定已生成',
    'ops.cronTitle': '定时任务 /api/admin/cron',
    'ops.cron.secretLabel': 'CRON_SECRET（X-Cron-Secret 请求头）',
    'ops.cron.secretPlaceholder': '输入外部调度器共享密钥',
    'ops.cron.run': '触发一次运行',
    'ops.cron.ran': 'ran',
    'ops.cron.counts': 'counts',
    'ops.cron.hint': '生产应由外部调度器定时调用本端点；此处仅用于人工核验。密钥只在本次请求中使用，不写入本地存储。',
    'ops.cron.secretValidation': '[VALIDATION] 请填写 CRON_SECRET',
    'ops.cron.ok': '定时任务已触发',
    'ops.noData': '暂无数据',
    'ops.notAdmin': '运维面板仅对 admin 角色开放。',

    /* 能力矩阵 */
    'cap.title': '能力矩阵 /api/config',
    'cap.feature': '能力 feature',
    'cap.state': '状态',
    'cap.localesTitle': '支持语言 locales',
    'cap.on': '启用',
    'cap.off': '未启用',
    'cap.hint': '下表为 GET /api/config 返回的 features 与 locales；能力开关以服务端为准。',
  },

  en: {
    /* Common */
    'common.refresh': 'Refresh',
    'common.humanConfirm': 'Confirm (human)',
    'common.cancel': 'Cancel',
    'common.confirmDelete': 'Delete account',
    'common.yes': 'Yes',
    'common.no': 'No',
    'common.empty': 'No data',
    'common.loading': 'Requesting /api/health and system configuration…',
    'common.humanGate': 'Human-confirmation gate: settlement, dispute resolution, task review, auto-acceptance, risk disposition and account sanctions are executed by the server only after explicit human confirmation. Role and state checks are enforced server-side (enforcement: server_side); a visible control is not an authorisation.',
    'common.confirmRequired': '[CONFIRM_REQUIRED] Type {word} to confirm this operation',
    'common.typeToConfirm': 'Type {word} to confirm',

    /* Static skeleton */
    'brand.sub': 'Bounty & Mutual-Aid Platform · Production Console',
    'topbar.logout': 'Sign out',
    'topbar.notLoggedIn': 'Not signed in',
    'topbar.userChip': '{name} ({email}) · role {role}',
    'topbar.notifications': 'Notifications ({n})',
    'l1.title': 'L1 Status Declaration',
    'l1.body': 'This site is a production-system demonstration environment. The G1–G7 and V1–V8 gates in docs/07 have not all been discharged and no operating licence is granted. No service level agreement (SLA) or availability commitment is made.',
    'demo.body': 'Demo mode: D1 persistence is not bound; all write operations are disabled.',
    'demo.link': 'L0 demo console',
    'demo.writeLocked': 'Demo mode: D1 persistence is not bound; writes are disabled',
    'demo.writeLockedToast': '[WRITE_LOCKED] Demo mode: D1 persistence is not bound; write operations are disabled',
    'footer.legal': 'Privacy / Terms / Acceptable Use / AI Transparency / Minor Restrictions / Reporting',
    'footer.sbc': 'SBC is an in-platform contribution point, non-redeemable and non-transferable.',
    'cookie.title': 'Cookies & Consent',
    'cookie.body': 'Necessary cookies keep the session and CSRF protection secure (the httpOnly session cookie is sent by the browser automatically); analytics cookies are used only for anonymous statistics and are optional. You can change this at any time under Data & Account.',
    'cookie.link': 'Read the privacy policy',
    'cookie.accept': 'Accept necessary + analytics',
    'cookie.necessary': 'Necessary only',
    'cookie.recordedAll': 'Recorded: necessary + analytics consent',
    'cookie.recordedNecessary': 'Recorded: necessary cookies only',
    'meta.ready': 'Backend {status} · database {db} · version {version} · time {time} · writes {lock}',
    'meta.lock': 'disabled',
    'meta.unlock': 'enabled',
    'meta.fail': 'Health check failed; write operations are disabled',
    'meta.notReady': 'Health check not ready',

    /* Errors */
    'err.timeout': 'Request timed out; please retry shortly',
    'err.network': 'Network request failed: {msg}',

    /* Auth view */
    'auth.title': 'Account access',
    'auth.subtitle': 'This is a production-system demonstration environment. Account access exists solely for internal verification; it is neither a public launch nor an operating licence.',
    'auth.tab.login': 'Sign in',
    'auth.tab.register': 'Register',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'auth.displayName': 'Display name',
    'auth.role': 'Role',
    'auth.rolePublisher': 'Publisher',
    'auth.roleSolver': 'Solver',
    'auth.login': 'Sign in',
    'auth.register': 'Register',
    'auth.csrfNote': 'The <code>data.session.csrf_token</code> returned by sign-in / registration is used as the <code>X-CSRF-Token</code> header on every subsequent write. The session cookie is httpOnly and sent by the browser automatically.',
    'auth.complianceTitle': 'Compliance Notes',
    'auth.comp1': 'Demonstration environment only; the G1–G7 / V1–V8 gates in docs/07 are not fully discharged and no operating licence is granted.',
    'auth.comp2': 'SBC is an in-platform contribution point, non-redeemable and non-transferable; it is not an asset, security or e-money, and the platform offers no value guarantee.',
    'auth.comp3': 'Settlement, dispute resolution, task review and account sanctions are human gates requiring explicit human confirmation.',
    'auth.comp4': 'AI-assisted ranking is disclosed; personalisation can be disabled and is enforced server-side (enforcement: server_side).',
    'auth.comp5': 'GDPR / UK GDPR rights and Cloudflare DPA / SCC cross-border safeguards apply; adults only (18+).',
    'auth.comp6': 'No specific SLA, availability or response-time figure is promised. Contact: privacy@sambon.net (placeholder).',
    'auth.fullPolicy': 'Full policies: Privacy / Terms / Acceptable Use / AI Transparency / Minor Restrictions / Reporting',
    'auth.ok': 'Account connected: {name}',
    'auth.loggedOut': 'Signed out',

    /* Console tabs */
    'tab.workbench': 'Workbench',
    'tab.ops': 'Operations',

    /* Task list */
    'task.listTitle': 'Tasks',
    'task.count': '{n} total (including terminal states)',
    'task.listHint': 'Bounties are denominated in SBC. SBC is an in-platform contribution point, non-redeemable and non-transferable; it is not an asset or investment product. Click a row for details.',
    'task.empty': 'No tasks yet; publish one or click Refresh.',
    'task.th.id': 'Task ID',
    'task.th.state': 'State',
    'task.th.title': 'Title',
    'task.th.category': 'Category',
    'task.th.bounty': 'Bounty SBC',
    'task.th.fee': 'Service fee',
    'task.th.frozen': 'Frozen total',
    'task.th.created': 'Created at',

    /* Publish */
    'publish.title': 'Publish a task',
    'publish.f.title': 'Title',
    'publish.f.description': 'Description',
    'publish.f.category': 'Category',
    'publish.f.bounty': 'Bounty (SBC contribution points)',
    'publish.f.criteria': 'Acceptance criteria',
    'publish.f.online': 'Online / On-site',
    'publish.f.radius': 'Radius (km)',
    'publish.f.skills': 'Required skills (comma separated)',
    'publish.f.deadline': 'Deadline (hours)',
    'publish.onlineOpt': 'Online',
    'publish.offlineOpt': 'On-site',
    'publish.skillsPlaceholder': 'e.g. translation, proofreading',
    'publish.submit': 'Submit task (POST /api/tasks)',
    'publish.hint': 'Submitted tasks enter PENDING_REVIEW for manual administrator review; <code>event_id</code> is generated by the client.',
    'publish.validationTitle': '[VALIDATION] Please enter a task title',
    'publish.ok': 'Task submitted{id} (compliance checks returned by the server)',
    'publish.unverified': 'Email not verified: complete email verification before publishing. The server rejects publishing from unverified accounts, so no usable control is offered here.',

    /* Compliance card */
    'compliance.title': 'Compliance Notes',
    'compliance.1': 'Demonstration environment only. The G1–G7 and V1–V8 gates in docs/07 are not fully discharged; no operating licence is granted.',
    'compliance.2': 'SBC is an in-platform contribution point, non-redeemable and non-transferable; it is not an asset, security or e-money, and the platform offers no value guarantee.',
    'compliance.3': 'Settlement, dispute resolution, task review and sanctions are human gates confirmed by an administrator; no automated adjudication has legal effect.',
    'compliance.4': 'AI-assisted candidate ranking is disclosed via weight_version / algorithm_degraded. Personalisation can be disabled here and is enforced server-side (enforcement: server_side).',
    'compliance.5': 'GDPR / UK GDPR rights: access, rectification, erasure, portability, objection and consent withdrawal. Cross-border transfers rely on the Cloudflare DPA and EU SCC / UK Addendum.',
    'compliance.6': 'Adults only (18+); we do not knowingly collect data from children. Reports: in-app channel or privacy@sambon.net.',
    'compliance.7': 'No specific uptime, response-time or SLA figure is promised in this environment. Full texts: <a href="/legal.html">legal.html</a>.',

    /* Detail & action panel */
    'detail.empty': 'Select a task from the list on the left to view details and the actions available for its state.',
    'detail.title': 'Details / Actions',
    'detail.h.description': 'Task description',
    'detail.h.criteria': 'Acceptance criteria',
    'detail.h.contact': 'Virtual contact',
    'detail.h.resultPreview': 'Result preview',
    'detail.resultMasked': 'Result body is PII-redacted',
    'detail.actionTitle': 'Actions for state ·',
    'detail.actionHint': 'Every action is validated by the server against role and state (enforcement: server_side); a visible control is not an authorisation. Settlement, dispute resolution, task review, auto-acceptance, risk disposition and sanctions are human gates requiring a second confirmation.',
    'action.reviewApprove': 'Approve',
    'action.reviewReject': 'Reject',
    'action.pendingReviewNote': 'Task awaits manual review; review controls are shown to admin only.',
    'action.topK': 'top_k',
    'action.batchSize': 'batch_size',
    'action.dryRun': 'dry_run (preview only)',
    'action.dispatch': 'Dispatch candidates (human gate)',
    'action.publishedNote': 'Dispatch is shown to admin only.',
    'action.accept': 'Accept task (solver)',
    'action.acceptNote': 'The server enforces role checks; only eligible solvers may accept.',
    'action.unverified': 'Email not verified: complete email verification before accepting. The server rejects acceptance from unverified accounts, so this control is disabled.',
    'action.resultContent': 'Result content (PII-redacted on submission)',
    'action.submitResult': 'Submit result',
    'action.rating': 'Rating',
    'action.reason': 'Verification reason',
    'action.disputeReason': 'Dispute reason',
    'action.verifyApprove': 'Approve result',
    'action.verifyReject': 'Reject result',
    'action.autoAccept': 'Auto-accept (admin)',
    'action.disputeOpen': 'Open dispute',
    'action.submittedNote': 'approve / reject are publisher-only, auto_accept is admin-only; the server enforces these roles.',
    'action.resolution': 'Resolution',
    'action.refundPublisher': 'Refund to publisher',
    'action.paySolver': 'Award to solver',
    'action.close': 'Close',
    'action.resolveReason': 'Resolution reason',
    'action.disputeResolve': 'Manual resolution (admin)',
    'action.disputedNote': 'Dispute resolution is an administrator human gate; admin only may submit.',
    'action.noAction': 'State {state} has no client-side action (terminal or system-driven transition).',

    /* Dispatch result */
    'dispatch.title': 'Dispatch result (dry_run preview)',
    'dispatch.candidates': 'Candidates',
    'dispatch.batches': 'Batches',
    'dispatch.noCandidates': 'No candidates',
    'dispatch.noBatches': 'No batches',

    /* Report */
    'report.title': 'Reporting channel',
    'report.hint': 'Reports enter manual review; see ',
    'report.legalLink': 'legal.html reporting channel',
    'report.reasonLabel': 'Reason',
    'report.reasonPlaceholder': 'Enter a reason',
    'report.button': 'Report this task',
    'report.validation': '[VALIDATION] Please enter a reason',
    'report.ok': 'Report submitted for manual review',

    /* Admin queue */
    'queue.title': 'Administrator queue',
    'queue.refresh': 'Refresh queue',
    'queue.pending': 'Pending review',
    'queue.disputed': 'In dispute',
    'queue.empty': 'Queue is empty',
    'queue.nonAdmin': 'The administrator queue is available to admin only; your current role is {role}. Admin-only controls (review, dispatch, resolution, auto-acceptance) are likewise shown to admin only.',

    /* Leaderboards */
    'boards.title': 'Leaderboards',
    'boards.tasksTitle': 'Task leaderboard',
    'boards.usersTitle': 'User leaderboard',
    'boards.empty': 'No leaderboard data',

    /* Ledger */
    'ledger.title': 'Points ledger',
    'ledger.uidLabel': 'User ID (GET /api/ledger/:userId)',
    'ledger.hint': 'The ledger records only freezes and bookkeeping adjustments of in-platform contribution points for reconciliation; it is not a balance that can be drawn down.',
    'ledger.entryCount': 'Entry count',
    'ledger.entriesTitle': 'Entries',
    'ledger.noEntries': 'No entries',
    'ledger.empty': 'No ledger data.',

    /* Events */
    'events.title': 'Event replay',
    'events.taskIdLabel': 'task_id (GET /api/events?task_id=)',
    'events.placeholder': 'Enter a task ID',
    'events.empty': 'No events (select a task or enter a task ID first)',

    /* AI transparency */
    'ai.title': 'AI Transparency & Configuration',
    'ai.kv.weightVersion': 'weight_version',
    'ai.kv.algorithmDegraded': 'algorithm_degraded',
    'ai.kv.personalizedAccount': 'personalized_enabled (account)',
    'ai.kv.personalizedGlobal': 'personalized_enabled (global)',
    'ai.kv.enforcement': 'enforcement',
    'ai.kv.ruleVersion': 'rule_version',
    'ai.kv.llmAdapterVersion': 'llm_adapter_version',
    'ai.kv.mode': 'mode',
    'ai.disclosureTitle': 'Algorithm disclosure ai_disclosure',
    'ai.disclosureZh': 'AI transparency statement (Chinese)',
    'ai.disclosureEn': 'AI transparency statement (English)',
    'ai.disclosureEmpty': 'No disclosure text was returned by the server.',
    'ai.disclosureHint': 'Candidate ranking only assists dispatch; it never completes review, verification, dispute resolution or sanctions automatically. Those stages are human gates.',
    'ai.degradedNote': 'The algorithm is currently in degraded mode (algorithm_degraded) and uses conservative ranking only.',
    'ai.weightsTitle': 'Six ranking weights',
    'ai.weightsEmpty': 'No weight detail was returned by the server.',
    'ai.switchLabel': 'Disable personalised recommendations',
    'ai.switchHint': 'Checked means disabled; unchecked means enabled. <strong>Enforced server-side</strong> (enforcement: server_side) and cannot be bypassed by the client; see also ',
    'ai.switchLegalLink': 'legal.html AI transparency',
    'ai.redlinesTitle': 'Red lines',
    'ai.redlinesEmpty': 'No red-line entries were returned by the server.',
    'ai.enNote': 'Algorithm-assisted ranking is disclosed above; personalisation is enforced server-side and may be disabled without affecting task integrity. No automated decision produces legal effects.',
    'ai.personalOn': 'Personalisation enabled (enforced server-side)',
    'ai.personalOff': 'Personalisation disabled (enforced server-side)',

    /* Data & account */
    'account.title': 'Data & Account (GDPR)',
    'account.export': 'Export my data (JSON)',
    'account.delete': 'Delete my account',
    'account.cookieSettings': 'Cookie preferences',
    'account.hint': 'Export maps to <code>GET /api/me/export</code> (portability); deletion maps to <code>DELETE /api/me</code> and requires typing <code>DELETE</code> to confirm, after which you are signed out. Full rights: ',
    'account.legalLink': 'legal.html privacy policy',
    'account.hint2': 'Deletion is a high-impact operation: the client requires explicit typed confirmation and the server validates it (enforcement: server_side).',
    'account.exportOk': 'My data exported (JSON file)',
    'account.deleteTitle': 'Delete my account (GDPR erasure)',
    'account.deleteBody': 'This will close the current account and delete associated personal data, and cannot be undone. You will be signed out afterwards.',
    'account.deleteOk': 'Account closed; signed out automatically',

    /* Gates & result toasts */
    'gate.reviewTitle': 'Human confirmation · Task review',
    'gate.reviewDetail': 'Task <code>{id}</code> will be {label}.',
    'gate.dispatchTitle': 'Human confirmation · Candidate dispatch',
    'gate.dispatchDetail': 'Task <code>{id}</code> will run algorithm-assisted candidate dispatch (dry_run preview).',
    'gate.verifyTitle': 'Human confirmation · Result verification',
    'gate.verifyDetail': 'Task <code>{id}</code> will be {label}.',
    'gate.disputeTitle': 'Human confirmation · Dispute resolution',
    'gate.disputeDetail': 'Task <code>{id}</code> will be resolved as <code>{resolution}</code>. This only adjusts in-platform contribution-point bookkeeping accounts.',
    'gate.cancelTitle': 'Human confirmation · Withdraw task',
    'gate.cancelDetail': 'Task <code>{id}</code> will be withdrawn and can no longer progress. Please provide a reason.',
    'gate.cancelReason': 'Withdrawal reason',
    'gate.riskTitle': 'Human confirmation · Risk disposition',
    'gate.riskDetail': 'Risk flag <code>{id}</code> will be handled according to the human decision; this only changes the risk-queue state.',
    'gate.riskDecision': 'Decision',
    'gate.riskReason': 'Reason',
    'gate.riskDismiss': 'Dismiss',
    'gate.riskEscalate': 'Escalate',
    'gate.anchorTitle': 'Human confirmation · Local anchor',
    'gate.anchorDetail': 'A local hash digest (Merkle root) will be generated; no public chain, zero PII.',
    'gate.cronTitle': 'Human confirmation · Scheduled job',
    'gate.cronDetail': 'This will trigger one scheduled-job run (dry_run: false). In production an external scheduler should call this endpoint on a timer.',
    'gate.reasonGeneric': 'Reason',
    'toast.reviewOk': 'Review result submitted (human gate)',
    'toast.dispatchOk': 'Dispatch executed (mode: {mode}, human confirmation)',
    'toast.acceptOk': 'Acceptance submitted',
    'toast.resultValidation': '[VALIDATION] Please enter result content',
    'toast.resultOk': 'Result submitted',
    'toast.verifyOk': 'Verification result submitted (human gate)',
    'toast.disputeReasonValidation': '[VALIDATION] Please enter a dispute reason',
    'toast.disputeOpenOk': 'Dispute opened for manual review',
    'toast.disputeResolveOk': 'Resolution submitted (human gate)',

    /* Email verification */
    'verify.title': 'Email verification',
    'verify.pending': 'Please check your verification email (if no mail channel is configured, look for the verification details in the notification centre)',
    'verify.tokenLabel': 'Verification code',
    'verify.tokenPlaceholder': 'Enter the verification code',
    'verify.submit': 'Verify',
    'verify.unverified': 'Email not verified: for account security you cannot publish or accept tasks until verification is complete. The server rejects such requests, so no usable control is offered here.',
    'verify.resend': 'Resend verification',
    'verify.ok': 'Email verified successfully',
    'verify.resendOk': 'Verification email resent (if no mail channel is configured, check the notification centre)',
    'verify.tokenValidation': '[VALIDATION] Please enter the verification code',

    /* Notification centre */
    'notif.title': 'Notifications',
    'notif.refresh': 'Refresh',
    'notif.readAll': 'Mark all read',
    'notif.readOne': 'Mark read',
    'notif.empty': 'No notifications',
    'notif.close': 'Close',
    'notif.readOk': 'Marked as read',

    /* Client feedback receipts */
    'feedback.title': 'Task exposure receipt',
    'feedback.hint': 'As a candidate solver, please acknowledge whether you have seen this task. The receipt serves algorithmic transparency only and never changes a human-gated outcome.',
    'feedback.exposed': 'Seen this task',
    'feedback.ignored': 'Ignore',
    'feedback.acked': 'Receipt recorded ({kind})',
    'feedback.ok': 'Receipt submitted ({kind})',

    /* Cancel task */
    'cancel.title': 'Task withdrawal',
    'cancel.button': 'Withdraw task',
    'cancel.ok': 'Task withdrawn',

    /* Operations panel */
    'ops.overviewTitle': 'Overview /api/admin/ops',
    'ops.componentsTitle': 'Components',
    'ops.jobsTitle': 'Jobs',
    'ops.notificationsPending': 'Notifications pending',
    'ops.readinessTitle': 'Readiness',
    'ops.configured': 'configured',
    'ops.degraded': 'degraded',
    'ops.metricsTitle': 'Metrics /api/admin/metrics',
    'ops.requests': 'Requests',
    'ops.errorRate': 'Error rate',
    'ops.latency': 'Latency',
    'ops.ledgerBalanced': 'Ledger balanced',
    'ops.hashChain': 'Hash chain valid',
    'ops.metricsAlert': 'Alert: ledger integrity check failed (balanced is not true). Please investigate manually.',
    'ops.auditTitle': 'Audit log /api/admin/audit',
    'ops.audit.empty': 'No audit records',
    'ops.riskTitle': 'Risk queue /api/admin/risk',
    'ops.risk.empty': 'Risk queue is empty',
    'ops.risk.handle': 'Human disposition',
    'ops.risk.flag': 'flag',
    'ops.risk.score': 'score',
    'ops.risk.subject': 'subject',
    'ops.risk.ok': 'Risk disposition submitted (human confirmation)',
    'ops.reportsTitle': 'Report queue /api/admin/queue',
    'ops.reports.pending': 'Pending review',
    'ops.reports.disputed': 'In dispute',
    'ops.backupTitle': 'Backup & anchoring /api/admin/backup',
    'ops.backup.sha256': 'sha256',
    'ops.backup.rowCount': 'row_count',
    'ops.backup.tables': 'Table row counts',
    'ops.backup.download': 'Download JSON',
    'ops.backup.anchor': 'Create local anchor',
    'ops.backup.merkle': 'merkle_root',
    'ops.backup.anchoredAt': 'anchored_at',
    'ops.backup.hint': 'Local hash digest, not written to any public chain, zero PII.',
    'ops.backup.downloadOk': 'Backup JSON downloaded',
    'ops.backup.anchorOk': 'Local anchor created',
    'ops.cronTitle': 'Scheduled job /api/admin/cron',
    'ops.cron.secretLabel': 'CRON_SECRET (X-Cron-Secret header)',
    'ops.cron.secretPlaceholder': 'Enter the external scheduler shared secret',
    'ops.cron.run': 'Trigger one run',
    'ops.cron.ran': 'ran',
    'ops.cron.counts': 'counts',
    'ops.cron.hint': 'In production an external scheduler should call this endpoint on a timer; this control is for manual verification only. The secret is used for this request only and is never stored locally.',
    'ops.cron.secretValidation': '[VALIDATION] Please enter CRON_SECRET',
    'ops.cron.ok': 'Scheduled job triggered',
    'ops.noData': 'No data',
    'ops.notAdmin': 'The operations panel is available to admin only.',

    /* Capability matrix */
    'cap.title': 'Capability matrix /api/config',
    'cap.feature': 'Feature',
    'cap.state': 'State',
    'cap.localesTitle': 'Supported locales',
    'cap.on': 'Enabled',
    'cap.off': 'Disabled',
    'cap.hint': 'The table shows the features and locales returned by GET /api/config; server-side flags are authoritative.',
  },
};

const LOCALE_KEY = 'sambon.locale';

// 语言优先级：localStorage > navigator.language（以 zh 开头为中文，否则英文；海外默认英文）。
function initLocale() {
  const saved = lsGet(LOCALE_KEY);
  if (saved === 'en' || saved === 'zh-CN') return saved;
  const nav = (navigator.language || '').toLowerCase();
  return nav.startsWith('zh') ? 'zh-CN' : 'en';
}

// 统一的文案渲染。vars 中的动态值一律 HTML 转义后替换，避免拼接注入。
// 返回值为可信 HTML 片段（静态文案由本文件定义，可含少量既定标签）；插入模板时不再二次转义。
function t(key, vars) {
  const dict = I18N[state.locale] || I18N['zh-CN'];
  const hasOwn = Object.prototype.hasOwnProperty;
  let s = hasOwn.call(dict, key) ? dict[key]
    : (hasOwn.call(I18N['zh-CN'], key) ? I18N['zh-CN'][key] : key);
  if (vars) {
    for (const k of Object.keys(vars)) {
      const v = vars[k];
      s = s.split('{' + k + '}').join(esc(v === null || v === undefined ? '' : v));
    }
  }
  return s;
}

function setLocale(locale) {
  const next = locale === 'en' ? 'en' : 'zh-CN';
  state.locale = next;
  lsSet(LOCALE_KEY, next);
  applyStaticI18n();
  render();
  // 尽力同步至服务端；失败不阻塞界面。
  if (state.user) {
    void api('/api/me/locale', {
      method: 'POST',
      body: { locale: next, event_id: newEventId() },
    }).catch(() => { /* 语言切换不依赖服务端回执 */ });
  }
}

// index.html 中静态骨架的 data-i18n 元素按当前语言填充，并同步 <html lang>。
function applyStaticI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  const zh = document.getElementById('lang-btn-zh');
  const en = document.getElementById('lang-btn-en');
  if (zh) zh.classList.toggle('active', state.locale === 'zh-CN');
  if (en) en.classList.toggle('active', state.locale === 'en');
  document.documentElement.lang = state.locale === 'zh-CN' ? 'zh-CN' : 'en';
}

/* ------------------------------------------------------------------ A. 状态 */

const CONSENT_KEY = 'sambon.cookie_consent.v1';

// 演示模式（/api/health 的 mode !== 'production'）下需要禁用的业务写动作。
// 会话退出、Cookie 同意与语言偏好属于会话/合规控制，不纳入写锁，避免把用户锁在界面内。
const WRITE_ACTIONS = new Set([
  'publish-task', 'review', 'dispatch', 'accept', 'submit-result',
  'verify', 'dispute-open', 'dispute-resolve', 'report',
  'delete-me', 'toggle-personalized',
  'verify-email', 'resend-verification', 'notification-read',
  'task-feedback', 'cancel-task', 'risk-resolve', 'anchor', 'cron',
]);

function emptyOps() {
  return { overview: null, metrics: null, audit: null, risk: null, backup: null, anchor: null, cron: null };
}

const state = {
  locale: initLocale(),
  health: null,            // GET /api/health 的 data
  config: null,            // GET /api/config 的 data
  writeLocked: true,       // fail-closed：健康检查通过且 mode=production 才解锁
  user: null,              // { user_id, email, display_name, role, email_verified, ... }
  csrf: null,              // 写操作 X-CSRF-Token 的值
  preferences: { personalized_enabled: true },
  consents: [],            // GET /api/auth/me 的 data.consents

  tasks: [],
  taskCount: 0,
  selectedTaskId: null,
  events: [],
  boardTasks: [],
  boardUsers: [],
  ledger: null,
  queue: null,             // GET /api/admin/queue 的 data（仅 admin）
  dispatchResult: null,

  consoleTab: 'workbench', // 'workbench' | 'ops'（ops 仅 admin 可见）
  notifOpen: false,
  notifications: [],
  notifUnread: 0,
  emailVerification: { required: false, token: '' },
  feedbackDone: {},        // task_id -> 'EXPOSED' | 'IGNORED'
  ops: emptyOps(),
  opsLoaded: false,
  opsDraft: { cron_secret: '' },

  authTab: 'login',
  authDraft: { email: '', password: '', display_name: '', role: 'publisher' },
  publishDraft: {
    title: '', description: '', category: 'general', bounty: '10',
    acceptance_criteria: '', online: 'true', radius_km: '0',
    required_skills: '', deadline_hours: '72',
  },
  detailDraft: {
    content: '', reason: '', dispute_reason: '', resolve_reason: '',
    resolution: 'close', rating: '5', top_k: '5', batch_size: '10',
    dry_run: true, report_reason: '', event_task_id: '', ledger_user_id: '',
  },
  cookieBarForced: false,
  modal: null,
};

/* ------------------------------------------------------------------ B. 工具 */

class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.toasted = false; // api() 已统一提示时置位，避免 showError 重复 toast
  }
}

// 所有服务端返回内容进入 DOM 前一律转义，避免任务标题/描述造成 XSS。
function esc(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return s.replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

// 写操作请求体中的 event_id：优先使用浏览器原生 UUID。
function newEventId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}

// localStorage 在部分隐私模式下会抛异常，统一兜底。
function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function lsSet(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* 忽略 */ } }

// 统一 toast：错误一律显示 error.code + error.message，不静默失败。
function toast(message, type = 'ok') {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'toast ' + (type === 'error' ? 'toast-error' : 'toast-ok');
  el.textContent = message;
  root.appendChild(el);
  window.setTimeout(() => {
    el.classList.add('toast-out');
    window.setTimeout(() => el.remove(), 260);
  }, 4200);
}

// 统一错误 toast 入口；若 api() 已提示则跳过，避免重复。
function showError(err) {
  if (err && err.toasted) return;
  const code = (err && err.code) || 'UNKNOWN';
  const message = (err && err.message) || '未知错误';
  toast('[' + code + '] ' + message, 'error');
}

function shortId(id) {
  const s = String(id || '');
  return s.length > 14 ? s.slice(0, 12) + '…' : s;
}

function cell(v) {
  if (v === null || v === undefined || v === '') return '<span class="muted">—</span>';
  if (typeof v === 'boolean') return v ? t('common.yes') : t('common.no');
  if (typeof v === 'object') return '<code>' + esc(JSON.stringify(v)) + '</code>';
  return esc(v);
}

// 用首行对象的并集键渲染未知结构的数组（榜单 / 事件 / 队列 / 批次等）。
function genericTable(items, emptyText) {
  const empty = emptyText === undefined ? t('common.empty') : emptyText;
  if (!Array.isArray(items) || items.length === 0) {
    return '<p class="muted">' + esc(empty) + '</p>';
  }
  const keys = [];
  const seen = new Set();
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    for (const k of Object.keys(it)) {
      if (!seen.has(k)) { seen.add(k); keys.push(k); }
    }
  }
  const cols = keys.slice(0, 12);
  if (cols.length === 0) return '<p class="muted">' + esc(empty) + '</p>';
  const head = cols.map(k => '<th>' + esc(k) + '</th>').join('');
  const rows = items.map(it =>
    '<tr>' + cols.map(k => '<td>' + cell(it && it[k]) + '</td>').join('') + '</tr>'
  ).join('');
  return '<div class="table-wrap"><table class="table"><thead><tr>' + head +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}

function kv(rows) {
  return rows.map(([k, v]) =>
    '<div class="kv-row"><span class="kv-key">' + esc(k) +
    '</span><span class="kv-val">' + cell(v) + '</span></div>'
  ).join('');
}

// 从对象里按候选键取第一个有值项，兼容后端字段命名差异。
function pick(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

function badgeClass(s) {
  const v = String(s || '').toUpperCase();
  if (v.includes('DISPUT')) return 'badge-danger';
  if (v.includes('REJECT') || v.includes('FAIL') || v.includes('TERMINAL')) return 'badge-warn';
  if (v.includes('DONE') || v.includes('APPROV') || v.includes('COMPLET') || v.includes('SUCCESS')) return 'badge-ok';
  if (v.includes('PENDING') || v.includes('REVIEW')) return 'badge-warn';
  return 'badge-info';
}

function currentTask() {
  return state.tasks.find(task => task.task_id === state.selectedTaskId) || null;
}

function taskPath(suffix) {
  return '/api/tasks/' + encodeURIComponent(state.selectedTaskId) + '/' + suffix;
}

function isAdmin() {
  return !!(state.user && state.user.role === 'admin');
}

function isUnverified() {
  return !!(state.user && state.user.email_verified === false);
}

// DISPATCHING 阶段的「当前用户是 solver」：角色为 solver，或已被指定为该任务的解决方。
function isSolver() {
  if (!state.user) return false;
  if (state.user.role === 'solver') return true;
  const task = currentTask();
  return !!(task && task.solver_id && task.solver_id === state.user.user_id);
}

/* ------------------------------------------------------------------ C. api() */

/**
 * 统一 API 调用。
 * @param {string} path 同源 /api/ 路径
 * @param {object} opts { method, body, headers, timeout, silent401, authAttempt }
 *   - headers    : 额外请求头（如 X-Cron-Secret）
 *   - timeout    : 超时毫秒数，默认 15000
 *   - silent401  : 401 时清理会话并返回 null（用于启动探测），不弹错误
 *   - authAttempt: 登录/注册的 401 属于凭据错误，不触发会话跳转
 * 统一处理：CSRF 头、JSON 解包、401 会话清理与跳转、错误 toast、请求超时。
 */
async function api(path, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  const isWrite = method === 'POST' || method === 'DELETE' || method === 'PUT' || method === 'PATCH';
  const headers = Object.assign({}, opts.headers || {});
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  // 契约：所有写操作必须携带 X-CSRF-Token。值来自登录/注册响应
  // data.session.csrf_token，或 GET /api/auth/me 的 data.csrf_token。
  // 会话 Cookie 为 httpOnly，由浏览器同源请求自动携带，前端不接触、不存储。
  if (isWrite) headers['X-CSRF-Token'] = state.csrf || '';

  // 请求超时：AbortController + 定时器，避免界面永久等待。
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer = null;
  if (controller) {
    timer = window.setTimeout(() => controller.abort(), opts.timeout || 15000);
  }

  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller ? controller.signal : undefined,
    });
  } catch (e) {
    if (e && e.name === 'AbortError') {
      throw new ApiError('REQUEST_TIMEOUT', t('err.timeout'), 0);
    }
    throw new ApiError('NETWORK_ERROR', t('err.network', { msg: (e && e.message ? e.message : e) }), 0);
  } finally {
    if (timer) window.clearTimeout(timer);
  }

  let payload;
  try {
    payload = await res.json();
  } catch (e) {
    throw new ApiError('BAD_RESPONSE', 'Response is not valid JSON (HTTP ' + res.status + ')', res.status);
  }

  // 401 统一跳转：清理登录态并回到认证视图。登录/注册失败不跳转。
  if (res.status === 401) {
    const err = (payload && payload.error) || { code: 'UNAUTHORIZED', message: 'Not signed in or session expired' };
    if (opts.authAttempt) throw new ApiError(err.code, err.message, 401);
    clearSession();
    if (opts.silent401) return null;
    render();
    toast('[' + err.code + '] ' + err.message, 'error');
    const thrown = new ApiError(err.code, err.message, 401);
    thrown.toasted = true; // 已统一提示，避免调用方 showError 重复
    throw thrown;
  }

  if (!res.ok || !payload || payload.ok !== true || payload.error) {
    const err = (payload && payload.error) ||
      { code: 'HTTP_' + res.status, message: 'Request failed (HTTP ' + res.status + ')' };
    throw new ApiError(err.code, err.message, res.status);
  }
  return payload.data;
}

function clearSession() {
  state.user = null;
  state.csrf = null;
  state.preferences = { personalized_enabled: true };
  state.consents = [];
  state.selectedTaskId = null;
  state.queue = null;
  state.dispatchResult = null;
  state.notifications = [];
  state.notifUnread = 0;
  state.notifOpen = false;
  state.emailVerification = { required: false, token: '' };
  state.consoleTab = 'workbench';
  state.ops = emptyOps();
  state.opsLoaded = false;
  state.feedbackDone = {};
}

/* ------------------------------------------------------------------ D. 加载器 */

async function loadTasks() {
  try {
    const d = await api('/api/tasks?include_terminal=true');
    state.tasks = Array.isArray(d.tasks) ? d.tasks : [];
    state.taskCount = d.count === undefined ? state.tasks.length : d.count;
    if (state.selectedTaskId && !state.tasks.some(task => task.task_id === state.selectedTaskId)) {
      state.selectedTaskId = null;
      state.dispatchResult = null;
    }
  } catch (e) { showError(e); }
}

async function loadEvents() {
  const id = state.detailDraft.event_task_id || state.selectedTaskId;
  if (!id) { state.events = []; return; }
  try {
    const d = await api('/api/events?task_id=' + encodeURIComponent(id));
    state.events = Array.isArray(d.events) ? d.events : [];
  } catch (e) { showError(e); }
}

async function loadBoards() {
  const [tk, u] = await Promise.all([
    api('/api/leaderboard/tasks').catch(e => { showError(e); return null; }),
    api('/api/leaderboard/users').catch(e => { showError(e); return null; }),
  ]);
  state.boardTasks = tk && Array.isArray(tk.items) ? tk.items : [];
  state.boardUsers = u && Array.isArray(u.items) ? u.items : [];
}

async function loadLedger() {
  const uid = state.detailDraft.ledger_user_id || (state.user && state.user.user_id);
  if (!uid) { state.ledger = null; return; }
  try {
    state.ledger = await api('/api/ledger/' + encodeURIComponent(uid));
  } catch (e) { showError(e); }
}

async function loadQueue() {
  // 仅 admin 请求队列，避免非管理员每次刷新都收到 401。
  if (!isAdmin()) { state.queue = null; return; }
  try { state.queue = await api('/api/admin/queue'); }
  catch (e) { showError(e); }
}

async function refreshMe() {
  const me = await api('/api/auth/me', { silent401: true });
  if (!me) return;
  state.user = me.user || state.user;
  state.csrf = me.csrf_token || (me.session && me.session.csrf_token) || state.csrf;
  state.preferences = me.preferences || state.preferences;
  state.consents = Array.isArray(me.consents) ? me.consents : [];
  syncConsentFromServer();
}

// 契约要求：每个写操作调用后刷新任务列表与详情。
async function refreshAfterWrite() {
  await Promise.all([loadTasks(), loadEvents(), loadBoards(), loadLedger(), loadQueue()]);
  render();
}

async function loadConsoleData() {
  if (!state.user) return;
  if (!state.detailDraft.ledger_user_id) state.detailDraft.ledger_user_id = state.user.user_id;
  await Promise.all([loadTasks(), loadEvents(), loadBoards(), loadLedger(), loadQueue()]);
}

/* ---- D2. 通知中心 ---- */

function countUnread(items) {
  return items.filter(n => String((n && n.status) || '').toLowerCase() !== 'read').length;
}

async function loadNotifications(silent = false) {
  if (!state.user) return;
  try {
    const d = await api('/api/me/notifications');
    const items = Array.isArray(d) ? d
      : (Array.isArray(d && d.notifications) ? d.notifications
        : (Array.isArray(d && d.items) ? d.items : []));
    state.notifications = items;
    state.notifUnread = (d && typeof d.unread_count === 'number') ? d.unread_count : countUnread(items);
    updateNotifButton();
    // 轮询（silent）只更新未读数，不重绘正文、不写入 console。
    if (!silent) renderNotifPanel();
  } catch (e) { showError(e); }
}

function updateNotifButton() {
  const btn = document.getElementById('notif-btn');
  if (!btn) return;
  btn.textContent = t('topbar.notifications', { n: state.notifUnread });
  btn.hidden = !state.user;
}

// 每 60 秒轮询一次未读数；页面隐藏时跳过。通知正文不写入 console。
function startNotifPolling() {
  window.setInterval(() => {
    if (document.hidden || !state.user) return;
    void loadNotifications(true);
  }, 60000);
}

/* ---- D3. 管理员运维面板 ---- */

async function loadOpsBlock(block) {
  if (!isAdmin()) return;
  const map = {
    overview: ['/api/admin/ops', 'overview'],
    metrics: ['/api/admin/metrics', 'metrics'],
    audit: ['/api/admin/audit?limit=50', 'audit'],
    risk: ['/api/admin/risk?status=OPEN', 'risk'],
    backup: ['/api/admin/backup', 'backup'],
  };
  if (block === 'cron') { state.ops.cron = null; return; } // 无 GET 数据源，刷新即清空上次结果
  const entry = map[block];
  if (!entry) return;
  try {
    state.ops[entry[1]] = await api(entry[0]);
  } catch (e) { showError(e); }
}

async function loadAllOps() {
  if (!isAdmin()) return;
  await Promise.all(['overview', 'metrics', 'audit', 'risk', 'backup'].map(loadOpsBlock));
  await loadQueue(); // 举报队列复用 /api/admin/queue
}

/* ------------------------------------------------------------------ E. 渲染 */

function render() {
  renderTopbar();
  renderBanners();
  const app = document.getElementById('app');
  app.innerHTML = state.user ? renderConsole() : renderAuthView();
  renderVerifyBar();
  renderNotifPanel();
  applyWriteLock();
  renderCookieBar();
  renderMeta();
}

function renderTopbar() {
  const mode = (state.health && state.health.mode) || '—';
  const badge = document.getElementById('mode-badge');
  if (badge) {
    badge.textContent = 'mode: ' + mode;
    badge.className = 'badge ' + (mode === 'production' ? 'badge-ok' : 'badge-warn');
  }
  const chip = document.getElementById('user-chip');
  if (chip) {
    chip.textContent = state.user
      ? t('topbar.userChip', {
          name: state.user.display_name, email: state.user.email, role: state.user.role,
        })
      : t('topbar.notLoggedIn');
  }
  const out = document.getElementById('logout-btn');
  if (out) out.hidden = !state.user;
  updateNotifButton();
}

function renderBanners() {
  const el = document.getElementById('demo-banner');
  if (el) el.hidden = !state.writeLocked;
}

function renderMeta() {
  const el = document.getElementById('meta-line');
  if (!el) return;
  const h = state.health;
  el.textContent = h
    ? t('meta.ready', {
        status: h.status || '—', db: h.db || '—', version: h.version || '—', time: h.time || '—',
        lock: state.writeLocked ? t('meta.lock') : t('meta.unlock'),
      })
    : t('meta.fail');
}

// 演示模式：把所有业务写按钮置为 disabled（视觉）+ 处理器内二次拦截（逻辑）。
function applyWriteLock() {
  document.querySelectorAll('[data-action]').forEach(el => {
    if (state.writeLocked && WRITE_ACTIONS.has(el.dataset.action)) {
      el.disabled = true;
      el.title = t('demo.writeLocked');
    }
  });
}

function renderCookieBar() {
  const bar = document.getElementById('cookie-bar');
  if (!bar) return;
  bar.hidden = !state.cookieBarForced && !!lsGet(CONSENT_KEY);
}

// 服务端已有 Cookie 同意记录时，回填 localStorage，避免重复弹出。
function syncConsentFromServer() {
  if (lsGet(CONSENT_KEY)) return;
  const rec = (state.consents || []).find(c => c && c.kind === 'cookie');
  if (rec) lsSet(CONSENT_KEY, rec.granted ? 'all' : 'necessary');
}

/* ---- E0. 邮箱验证常驻提示条 ---- */

function renderVerifyBar() {
  const root = document.getElementById('verify-bar');
  if (!root) return;
  const needsResend = isUnverified();
  const pending = state.emailVerification.required;
  if (!needsResend && !pending) { root.innerHTML = ''; return; }
  let body = '';
  if (pending) {
    body += `<div class="notice notice-info">
      <strong>${t('verify.title')}</strong>
      <div>${t('verify.pending')}</div>
      <div class="notice-actions">
        <label class="form-row"><span>${t('verify.tokenLabel')}</span><input type="text" data-model="emailVerification.token" value="${esc(state.emailVerification.token)}" placeholder="${esc(t('verify.tokenPlaceholder'))}" autocomplete="off"></label>
        <button type="button" class="btn btn-primary" data-action="verify-email">${t('verify.submit')}</button>
      </div>
    </div>`;
  }
  if (needsResend) {
    body += `<div class="notice notice-warn">
      <strong>${t('verify.title')}</strong>
      <div>${t('verify.unverified')}</div>
      <div class="notice-actions"><button type="button" class="btn btn-ghost" data-action="resend-verification">${t('verify.resend')}</button></div>
    </div>`;
  }
  root.innerHTML = body;
}

/* ---- E0b. 通知中心面板 ---- */

function renderNotifPanel() {
  const root = document.getElementById('notif-panel');
  if (!root) return;
  root.hidden = !state.notifOpen;
  if (!state.notifOpen) { root.innerHTML = ''; return; }
  const items = Array.isArray(state.notifications) ? state.notifications : [];
  const list = items.length ? items.map(n => {
    const unread = String((n && n.status) || '').toLowerCase() !== 'read';
    const nid = n && (n.id || n.notification_id) ? (n.id || n.notification_id) : '';
    return `<div class="notif-item ${unread ? 'unread' : ''}">
      <div class="notif-item-top">
        <span class="notif-kind">${esc((n && n.kind) || '—')}</span>
        <span class="badge ${unread ? 'badge-info' : 'badge-ok'}">${esc((n && n.status) || '—')}</span>
      </div>
      <div class="notif-title">${esc((n && n.title) || '—')}</div>
      <div class="notif-body">${esc((n && n.body) || '')}</div>
      <div class="notif-meta">${esc((n && n.created_at) || '')}${nid ? ' · <code>' + esc(shortId(nid)) + '</code>' : ''}</div>
      ${unread ? `<div class="notif-actions"><button type="button" class="btn btn-ghost btn-sm" data-action="notification-read" data-id="${esc(nid)}">${t('notif.readOne')}</button></div>` : ''}
    </div>`;
  }).join('') : `<p class="notif-empty">${t('notif.empty')}</p>`;
  root.innerHTML = `<div class="notif-head">
      <h4>${t('notif.title')} (${items.length})</h4>
      <div class="inline-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-action="refresh-notifications">${t('notif.refresh')}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-action="notification-read" data-all="1">${t('notif.readAll')}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-action="notif-close">${t('notif.close')}</button>
      </div>
    </div><div class="notif-list">${list}</div>`;
}

/* ---- E1. 认证视图 ---- */

function renderAuthView() {
  const d = state.authDraft;
  const isLogin = state.authTab === 'login';
  const fields = isLogin ? `
      <label class="form-row"><span>${t('auth.email')}</span><input type="email" name="email" data-model="authDraft.email" value="${esc(d.email)}" required autocomplete="username" placeholder="name@example.com"></label>
      <label class="form-row"><span>${t('auth.password')}</span><input type="password" name="password" data-model="authDraft.password" value="${esc(d.password)}" required autocomplete="current-password"></label>
      <button type="submit" class="btn btn-primary" data-action="login">${t('auth.login')}</button>` : `
      <label class="form-row"><span>${t('auth.email')}</span><input type="email" name="email" data-model="authDraft.email" value="${esc(d.email)}" required autocomplete="username" placeholder="name@example.com"></label>
      <label class="form-row"><span>${t('auth.password')}</span><input type="password" name="password" data-model="authDraft.password" value="${esc(d.password)}" required autocomplete="new-password"></label>
      <label class="form-row"><span>${t('auth.displayName')}</span><input type="text" name="display_name" data-model="authDraft.display_name" value="${esc(d.display_name)}" required></label>
      <label class="form-row"><span>${t('auth.role')}</span>
        <select name="role" data-model="authDraft.role">
          <option value="publisher" ${d.role === 'publisher' ? 'selected' : ''}>${t('auth.rolePublisher')}</option>
          <option value="solver" ${d.role === 'solver' ? 'selected' : ''}>${t('auth.roleSolver')}</option>
        </select>
      </label>
      <button type="submit" class="btn btn-primary" data-action="register">${t('auth.register')}</button>`;

  const comp = [1, 2, 3, 4, 5, 6].map(i => `<li>${t('auth.comp' + i)}</li>`).join('');

  return `
  <div class="auth-wrap">
    <div class="card auth-card">
      <h2>${t('auth.title')}</h2>
      <p class="muted">${t('auth.subtitle')}</p>
      <div class="tabs">
        <button type="button" class="tab ${isLogin ? 'active' : ''}" data-action="auth-tab" data-tab="login">${t('auth.tab.login')}</button>
        <button type="button" class="tab ${!isLogin ? 'active' : ''}" data-action="auth-tab" data-tab="register">${t('auth.tab.register')}</button>
      </div>
      <form data-form="${isLogin ? 'login' : 'register'}" class="stack">${fields}</form>
      ${state.writeLocked ? `<p class="banner-demo inline">${t('demo.body')} <a href="/index.html">${t('demo.link')}</a></p>` : ''}
      <p class="muted">${t('auth.csrfNote')}</p>
    </div>
    <div class="card">
      <h3>${t('auth.complianceTitle')}</h3>
      <ul class="en-list">${comp}</ul>
      <p><a href="/legal.html">${t('auth.fullPolicy')}</a></p>
    </div>
  </div>`;
}

/* ---- E2. 操作台视图（工作台 / 运维 两个标签） ---- */

function renderConsole() {
  const tabs = `<div class="tabs console-tabs">
      <button type="button" class="tab ${state.consoleTab === 'workbench' ? 'active' : ''}" data-action="console-tab" data-tab="workbench">${t('tab.workbench')}</button>
      ${isAdmin() ? `<button type="button" class="tab ${state.consoleTab === 'ops' ? 'active' : ''}" data-action="console-tab" data-tab="ops">${t('tab.ops')}</button>` : ''}
    </div>`;
  const body = (state.consoleTab === 'ops' && isAdmin()) ? renderOpsView() : renderWorkbench();
  return tabs + body;
}

function renderWorkbench() {
  return `
  <div class="layout">
    <section class="col col-left">
      ${renderTasksCard()}
      ${renderPublishCard()}
      ${renderComplianceCard()}
    </section>
    <section class="col col-right">
      ${renderDetailCard()}
      ${renderQueueCard()}
      ${renderBoardsCard()}
      ${renderLedgerCard()}
      ${renderEventsCard()}
      ${renderAICard()}
      ${renderCapabilitiesCard()}
      ${renderAccountCard()}
    </section>
  </div>`;
}

function renderTasksCard() {
  return `
  <div class="card">
    <div class="card-head">
      <h3>${t('task.listTitle')}</h3>
      <div class="card-tools">
        <span class="muted">${t('task.count', { n: state.taskCount })}</span>
        <button type="button" class="btn btn-ghost btn-sm" data-action="refresh-tasks">${t('common.refresh')}</button>
      </div>
    </div>
    <p class="muted">${t('task.listHint')}</p>
    ${renderTasksTable()}
  </div>`;
}

function renderTasksTable() {
  if (!state.tasks.length) return '<p class="muted">' + esc(t('task.empty')) + '</p>';
  const rows = state.tasks.map(task => `
    <tr data-action="select-task" data-id="${esc(task.task_id)}" class="clickable-row ${task.task_id === state.selectedTaskId ? 'row-selected' : ''}" title="${esc(task.task_id)}">
      <td><code>${esc(shortId(task.task_id))}</code></td>
      <td><span class="badge ${badgeClass(task.state)}">${esc(task.state)}</span></td>
      <td>${esc(task.title)}</td>
      <td>${esc(task.category)}</td>
      <td>${esc(task.bounty)}</td>
      <td>${esc(task.service_fee)}</td>
      <td>${esc(task.frozen_total)}</td>
      <td class="muted">${esc(task.created_at)}</td>
    </tr>`).join('');
  return `<div class="table-wrap"><table class="table">
    <thead><tr><th>${t('task.th.id')}</th><th>${t('task.th.state')}</th><th>${t('task.th.title')}</th><th>${t('task.th.category')}</th><th>${t('task.th.bounty')}</th><th>${t('task.th.fee')}</th><th>${t('task.th.frozen')}</th><th>${t('task.th.created')}</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function renderPublishCard() {
  const d = state.publishDraft;
  const blocked = isUnverified();
  return `
  <div class="card">
    <h3>${t('publish.title')}</h3>
    ${blocked ? `<div class="notice notice-warn"><strong>${t('verify.title')}</strong>${t('publish.unverified')}</div>` : ''}
    <form data-form="publish-task" class="stack">
      <label class="form-row"><span>${t('publish.f.title')}</span><input type="text" data-model="publishDraft.title" value="${esc(d.title)}" required></label>
      <label class="form-row"><span>${t('publish.f.description')}</span><textarea rows="2" data-model="publishDraft.description">${esc(d.description)}</textarea></label>
      <div class="grid-2">
        <label class="form-row"><span>${t('publish.f.category')}</span><input type="text" data-model="publishDraft.category" value="${esc(d.category)}"></label>
        <label class="form-row"><span>${t('publish.f.bounty')}</span><input type="number" min="0" step="1" data-model="publishDraft.bounty" value="${esc(d.bounty)}"></label>
      </div>
      <label class="form-row"><span>${t('publish.f.criteria')}</span><textarea rows="2" data-model="publishDraft.acceptance_criteria">${esc(d.acceptance_criteria)}</textarea></label>
      <div class="grid-2">
        <label class="form-row"><span>${t('publish.f.online')}</span>
          <select data-model="publishDraft.online">
            <option value="true" ${d.online === 'true' ? 'selected' : ''}>${t('publish.onlineOpt')}</option>
            <option value="false" ${d.online === 'false' ? 'selected' : ''}>${t('publish.offlineOpt')}</option>
          </select>
        </label>
        <label class="form-row"><span>${t('publish.f.radius')}</span><input type="number" min="0" data-model="publishDraft.radius_km" value="${esc(d.radius_km)}"></label>
      </div>
      <div class="grid-2">
        <label class="form-row"><span>${t('publish.f.skills')}</span><input type="text" data-model="publishDraft.required_skills" value="${esc(d.required_skills)}" placeholder="${esc(t('publish.skillsPlaceholder'))}"></label>
        <label class="form-row"><span>${t('publish.f.deadline')}</span><input type="number" min="1" data-model="publishDraft.deadline_hours" value="${esc(d.deadline_hours)}"></label>
      </div>
      <button type="submit" class="btn btn-primary" data-action="publish-task" ${blocked ? 'disabled' : ''}>${t('publish.submit')}</button>
      <p class="muted">${t('publish.hint')}</p>
    </form>
  </div>`;
}

function renderComplianceCard() {
  const items = [1, 2, 3, 4, 5, 6, 7].map(i => `<li>${t('compliance.' + i)}</li>`).join('');
  return `
  <div class="card">
    <h3>${t('compliance.title')}</h3>
    <ul class="en-list">${items}</ul>
  </div>`;
}

function renderDetailCard() {
  const task = currentTask();
  if (!task) {
    return `<div class="card"><h3>${t('detail.title')}</h3><p class="muted">${t('detail.empty')}</p></div>`;
  }
  const fields = [
    ['task_id', task.task_id], ['state', task.state], ['title', task.title],
    ['category', task.category], ['bounty', task.bounty], ['service_fee', task.service_fee],
    ['frozen_total', task.frozen_total], ['publisher_id', task.publisher_id],
    ['solver_id', task.solver_id], ['reject_count', task.reject_count], ['created_at', task.created_at],
  ];
  return `
  <div class="card">
    <div class="card-head"><h3>${t('detail.title')}</h3><span class="badge ${badgeClass(task.state)}">${esc(task.state)}</span></div>
    <div class="kv">${kv(fields)}</div>
    <div class="block">
      <h4>${t('detail.h.description')}</h4><p class="pre">${esc(task.description || '—')}</p>
      <h4>${t('detail.h.criteria')}</h4><p class="pre">${esc(task.acceptance_criteria || '—')}</p>
      <h4>${t('detail.h.contact')}</h4><p class="pre">${esc(task.virtual_contact || '—')}</p>
      <h4>${t('detail.h.resultPreview')} <span class="badge badge-info">${t('detail.resultMasked')}</span></h4>
      <p class="pre">${esc(task.result_preview || '—')}</p>
    </div>
    ${renderActionPanel(task)}
    ${renderFeedbackBox(task)}
    ${renderCancelBox(task)}
    ${renderDispatchResult()}
    ${renderReportBox()}
  </div>`;
}

// 按 task.state 动态显示可用动作；admin 专属按钮仅 isAdmin() 时渲染。
function renderActionPanel(task) {
  const s = String(task.state || '').toUpperCase();
  const d = state.detailDraft;
  const admin = isAdmin();
  let body = '';

  if (s === 'PENDING_REVIEW') {
    body = admin ? `
      <div class="action-row">
        <button type="button" class="btn btn-primary" data-action="review" data-decision="approve">${t('action.reviewApprove')}</button>
        <button type="button" class="btn btn-danger" data-action="review" data-decision="reject">${t('action.reviewReject')}</button>
      </div>` : `<p class="muted">${t('action.pendingReviewNote')}</p>`;

  } else if (s === 'PUBLISHED') {
    body = admin ? `
      <div class="grid-3">
        <label class="form-row"><span>${t('action.topK')}</span><input type="number" min="1" data-model="detailDraft.top_k" value="${esc(d.top_k)}"></label>
        <label class="form-row"><span>${t('action.batchSize')}</span><input type="number" min="1" data-model="detailDraft.batch_size" value="${esc(d.batch_size)}"></label>
        <label class="form-row check"><span>${t('action.dryRun')}</span><input type="checkbox" data-model="detailDraft.dry_run" ${d.dry_run ? 'checked' : ''}></label>
      </div>
      <div class="action-row"><button type="button" class="btn btn-primary" data-action="dispatch">${t('action.dispatch')}</button></div>`
      : `<p class="muted">${t('action.publishedNote')}</p>`;

  } else if (s === 'DISPATCHING') {
    const blocked = isUnverified();
    body = (blocked
      ? `<div class="notice notice-warn">${t('action.unverified')}</div>
         <div class="action-row"><button type="button" class="btn btn-primary" data-action="accept" disabled>${t('action.accept')}</button></div>`
      : `<div class="action-row"><button type="button" class="btn btn-primary" data-action="accept">${t('action.accept')}</button></div>`)
      + `<p class="muted">${t('action.acceptNote')}</p>`;

  } else if (s === 'ACCEPTED' || s === 'IN_PROGRESS') {
    body = `
      <label class="form-row"><span>${t('action.resultContent')}</span><textarea rows="3" data-model="detailDraft.content">${esc(d.content)}</textarea></label>
      <div class="action-row"><button type="button" class="btn btn-primary" data-action="submit-result">${t('action.submitResult')}</button></div>`;

  } else if (s === 'SUBMITTED') {
    body = `
      <div class="grid-3">
        <label class="form-row"><span>${t('action.rating')}</span><input type="number" min="1" max="5" data-model="detailDraft.rating" value="${esc(d.rating)}"></label>
        <label class="form-row"><span>${t('action.reason')}</span><input type="text" data-model="detailDraft.reason" value="${esc(d.reason)}"></label>
        <label class="form-row"><span>${t('action.disputeReason')}</span><input type="text" data-model="detailDraft.dispute_reason" value="${esc(d.dispute_reason)}"></label>
      </div>
      <div class="action-row">
        <button type="button" class="btn btn-primary" data-action="verify" data-decision="approve">${t('action.verifyApprove')}</button>
        <button type="button" class="btn btn-danger" data-action="verify" data-decision="reject">${t('action.verifyReject')}</button>
        ${admin ? `<button type="button" class="btn btn-ghost" data-action="verify" data-decision="auto_accept">${t('action.autoAccept')}</button>` : ''}
        <button type="button" class="btn btn-ghost" data-action="dispute-open">${t('action.disputeOpen')}</button>
      </div>
      <p class="muted">${t('action.submittedNote')}</p>`;

  } else if (s === 'DISPUTED') {
    body = `
      <div class="grid-2">
        <label class="form-row"><span>${t('action.resolution')}</span>
          <select data-model="detailDraft.resolution">
            <option value="refund_publisher" ${d.resolution === 'refund_publisher' ? 'selected' : ''}>${t('action.refundPublisher')}</option>
            <option value="pay_solver" ${d.resolution === 'pay_solver' ? 'selected' : ''}>${t('action.paySolver')}</option>
            <option value="close" ${d.resolution === 'close' ? 'selected' : ''}>${t('action.close')}</option>
          </select>
        </label>
        <label class="form-row"><span>${t('action.resolveReason')}</span><input type="text" data-model="detailDraft.resolve_reason" value="${esc(d.resolve_reason)}"></label>
      </div>
      ${admin
        ? `<div class="action-row"><button type="button" class="btn btn-primary" data-action="dispute-resolve">${t('action.disputeResolve')}</button></div>`
        : `<p class="muted">${t('action.disputedNote')}</p>`}`;

  } else {
    body = '<p class="muted">' + t('action.noAction', { state: s }) + '</p>';
  }

  return `
    <div class="action-box">
      <h4>${t('detail.actionTitle')} <code>${esc(s)}</code></h4>
      <p class="muted">${t('detail.actionHint')}</p>
      ${body}
    </div>`;
}

/* 客户端埋点回执（D-07 P1）：DISPATCHING 且当前用户为 solver 时显示。 */
function renderFeedbackBox(task) {
  const s = String(task.state || '').toUpperCase();
  if (s !== 'DISPATCHING' || !isSolver()) return '';
  const done = state.feedbackDone[task.task_id];
  if (done) {
    return `<div class="block"><h4>${t('feedback.title')}</h4><p class="muted">${t('feedback.acked', { kind: done })}</p></div>`;
  }
  return `
  <div class="block">
    <h4>${t('feedback.title')}</h4>
    <p class="muted">${t('feedback.hint')}</p>
    <div class="action-row">
      <button type="button" class="btn btn-primary" data-action="task-feedback" data-kind="EXPOSED">${t('feedback.exposed')}</button>
      <button type="button" class="btn btn-ghost" data-action="task-feedback" data-kind="IGNORED">${t('feedback.ignored')}</button>
    </div>
  </div>`;
}

/* 取消任务（D-09 P1）：可撤回状态且当前用户为发布方或 admin 时显示。 */
function renderCancelBox(task) {
  const s = String(task.state || '').toUpperCase();
  const cancellable = s === 'PENDING_REVIEW' || s === 'PUBLISHED' || s === 'DISPATCHING';
  if (!cancellable) return '';
  const owner = state.user && (task.publisher_id === state.user.user_id || isAdmin());
  if (!owner) return '';
  return `
  <div class="block">
    <h4>${t('cancel.title')}</h4>
    <div class="action-row"><button type="button" class="btn btn-danger" data-action="cancel-task">${t('cancel.button')}</button></div>
  </div>`;
}

function renderDispatchResult() {
  const r = state.dispatchResult;
  if (!r) return '';
  const meta = kv([
    ['mode', r.mode], ['personalized', r.personalized],
    ['candidates', Array.isArray(r.candidates) ? r.candidates.length : 0],
    ['batches', Array.isArray(r.batches) ? r.batches.length : 0],
  ]);
  return `
  <div class="block">
    <h4>${t('dispatch.title')}</h4>
    <div class="kv">${meta}</div>
    <h5>${t('dispatch.candidates')}</h5>${genericTable(r.candidates, t('dispatch.noCandidates'))}
    <h5>${t('dispatch.batches')}</h5>${genericTable(r.batches, t('dispatch.noBatches'))}
  </div>`;
}

function renderReportBox() {
  const d = state.detailDraft;
  return `
  <div class="block">
    <h4>${t('report.title')}</h4>
    <p class="muted">${t('report.hint')}<a href="/legal.html#report">${t('report.legalLink')}</a>。</p>
    <div class="action-row">
      <label class="form-row"><span>${t('report.reasonLabel')}</span><input type="text" data-model="detailDraft.report_reason" value="${esc(d.report_reason)}" placeholder="${esc(t('report.reasonPlaceholder'))}"></label>
      <button type="button" class="btn btn-ghost" data-action="report">${t('report.button')}</button>
    </div>
  </div>`;
}

function renderQueueCard() {
  const admin = isAdmin();
  const q = state.queue;
  return `
  <div class="card">
    <div class="card-head">
      <h3>${t('queue.title')}</h3>
      ${admin ? `<button type="button" class="btn btn-ghost btn-sm" data-action="refresh-queue">${t('queue.refresh')}</button>` : ''}
    </div>
    ${admin ? `
      <h4>${t('queue.pending')}</h4>${genericTable(q && q.pending_review, t('queue.empty'))}
      <h4>${t('queue.disputed')}</h4>${genericTable(q && q.disputed, t('queue.empty'))}
    ` : `<p class="muted">${t('queue.nonAdmin', { role: state.user ? state.user.role : '—' })}</p>`}
  </div>`;
}

function renderBoardsCard() {
  return `
  <div class="card">
    <div class="card-head"><h3>${t('boards.title')}</h3><button type="button" class="btn btn-ghost btn-sm" data-action="refresh-boards">${t('common.refresh')}</button></div>
    <h4>${t('boards.tasksTitle')}</h4>${genericTable(state.boardTasks, t('boards.empty'))}
    <h4>${t('boards.usersTitle')}</h4>${genericTable(state.boardUsers, t('boards.empty'))}
  </div>`;
}

function renderLedgerCard() {
  const l = state.ledger;
  const check = l && l.balance_check ? l.balance_check : null;
  return `
  <div class="card">
    <div class="card-head"><h3>${t('ledger.title')}</h3><button type="button" class="btn btn-ghost btn-sm" data-action="refresh-ledger">${t('common.refresh')}</button></div>
    <div class="action-row">
      <label class="form-row"><span>${t('ledger.uidLabel')}</span><input type="text" data-model="detailDraft.ledger_user_id" value="${esc(state.detailDraft.ledger_user_id)}"></label>
    </div>
    <p class="muted">${t('ledger.hint')}</p>
    ${l ? `
      <div class="kv">${kv([
        ['balanced', check && check.balanced],
        [t('ledger.entryCount'), Array.isArray(l.entries) ? l.entries.length : 0],
        ['anchor', l.anchor],
      ])}</div>
      <h4>${t('ledger.entriesTitle')}</h4>${genericTable(l.entries, t('ledger.noEntries'))}
    ` : `<p class="muted">${t('ledger.empty')}</p>`}
  </div>`;
}

function renderEventsCard() {
  const d = state.detailDraft;
  return `
  <div class="card">
    <div class="card-head"><h3>${t('events.title')}</h3><button type="button" class="btn btn-ghost btn-sm" data-action="refresh-events">${t('common.refresh')}</button></div>
    <div class="action-row">
      <label class="form-row"><span>${t('events.taskIdLabel')}</span><input type="text" data-model="detailDraft.event_task_id" value="${esc(d.event_task_id)}" placeholder="${esc(t('events.placeholder'))}"></label>
    </div>
    ${genericTable(state.events, t('events.empty'))}
  </div>`;
}

function renderAICard() {
  const c = state.config || {};
  const pref = !!(state.preferences && state.preferences.personalized_enabled);
  const degraded = c.algorithm_degraded === true || c.algorithm_degraded === 'true';
  const reds = Array.isArray(c.red_lines) ? c.red_lines : [];

  // ai_disclosure 可能是 { 'zh-CN': ..., en: ... }，也可能是纯字符串。
  const disclosure = c.ai_disclosure;
  let disclosureHtml;
  if (disclosure && typeof disclosure === 'object') {
    disclosureHtml = `<h5>${t('ai.disclosureZh')}</h5><p class="pre">${esc(pick(disclosure, ['zh-CN', 'zh', 'zh_CN', 'zhCN']) || t('ai.disclosureEmpty'))}</p>
      <h5>${t('ai.disclosureEn')}</h5><p class="pre">${esc(pick(disclosure, ['en', 'en-US', 'en_US']) || t('ai.disclosureEmpty'))}</p>`;
  } else {
    disclosureHtml = `<p class="pre">${esc(disclosure || t('ai.disclosureEmpty'))}</p>`;
  }

  const weights = c.weights || c.ranking_weights || c.weight_values || {};
  const wkeys = weights && typeof weights === 'object' ? Object.keys(weights) : [];
  const weightsHtml = wkeys.length
    ? `<div class="kv">${kv(wkeys.map(k => [k, weights[k]]))}</div>`
    : `<p class="muted">${t('ai.weightsEmpty')}</p>`;

  return `
  <div class="card">
    <h3>${t('ai.title')}</h3>
    <div class="kv">${kv([
      [t('ai.kv.weightVersion'), c.weight_version],
      [t('ai.kv.algorithmDegraded'), c.algorithm_degraded],
      [t('ai.kv.personalizedAccount'), pref],
      [t('ai.kv.personalizedGlobal'), c.personalized_enabled],
      [t('ai.kv.enforcement'), c.enforcement || 'server_side'],
      [t('ai.kv.ruleVersion'), c.rule_version],
      [t('ai.kv.llmAdapterVersion'), c.llm_adapter_version],
      [t('ai.kv.mode'), c.mode],
    ])}</div>
    <div class="block">
      <h4>${t('ai.disclosureTitle')}</h4>
      ${disclosureHtml}
      <p class="muted">${t('ai.disclosureHint')}${degraded ? ' ' + t('ai.degradedNote') : ''}</p>
    </div>
    <div class="block">
      <h4>${t('ai.weightsTitle')}</h4>
      ${weightsHtml}
    </div>
    <div class="block">
      <label class="switch-row">
        <input type="checkbox" data-action="toggle-personalized" ${pref ? '' : 'checked'}>
        <span>${t('ai.switchLabel')}</span>
      </label>
      <p class="muted">${t('ai.switchHint')}<a href="/legal.html#ai">${t('ai.switchLegalLink')}</a>。</p>
    </div>
    <div class="block">
      <h4>${t('ai.redlinesTitle')}</h4>
      ${reds.length
        ? '<ul class="plain-list">' + reds.map(r => '<li>' + esc(typeof r === 'object' ? JSON.stringify(r) : r) + '</li>').join('') + '</ul>'
        : `<p class="muted">${t('ai.redlinesEmpty')}</p>`}
      <p class="en">${t('ai.enNote')}</p>
    </div>
  </div>`;
}

/* 能力矩阵：GET /api/config 的 features 与 locales。 */
function renderCapabilitiesCard() {
  const c = state.config || {};
  const features = (c.features && typeof c.features === 'object') ? c.features : {};
  const localesRaw = c.locales;
  const locales = Array.isArray(localesRaw) ? localesRaw
    : (localesRaw && typeof localesRaw === 'object' ? Object.keys(localesRaw) : []);
  const fkeys = Object.keys(features);
  const rows = fkeys.length ? fkeys.map(k => {
    const v = features[k];
    const on = v === true || v === 'true' || v === 1 ||
      (v && typeof v === 'object' ? v.enabled !== false : false);
    return `<tr><td>${esc(k)}</td><td><span class="badge ${on ? 'badge-ok' : 'badge-warn'}">${on ? t('cap.on') : t('cap.off')}</span></td><td>${cell(v)}</td></tr>`;
  }).join('') : `<tr><td colspan="3" class="muted">${t('ops.noData')}</td></tr>`;
  const localeHtml = locales.length
    ? locales.map(l => `<span class="badge badge-info">${esc(l)}</span>`).join(' ')
    : `<span class="muted">${t('ops.noData')}</span>`;
  return `
  <div class="card">
    <h3>${t('cap.title')}</h3>
    <div class="table-wrap"><table class="table matrix-table">
      <thead><tr><th>${t('cap.feature')}</th><th>${t('cap.state')}</th><th>value</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <h4>${t('cap.localesTitle')}</h4><div class="locale-list">${localeHtml}</div>
    <p class="muted">${t('cap.hint')}</p>
  </div>`;
}

function renderAccountCard() {
  return `
  <div class="card">
    <h3>${t('account.title')}</h3>
    <div class="action-row">
      <button type="button" class="btn btn-ghost" data-action="export-me">${t('account.export')}</button>
      <button type="button" class="btn btn-danger" data-action="delete-me">${t('account.delete')}</button>
      <button type="button" class="btn btn-ghost" data-action="cookie-settings">${t('account.cookieSettings')}</button>
    </div>
    <p class="muted">${t('account.hint')}<a href="/legal.html#gdpr">${t('account.legalLink')}</a>。</p>
    <p class="muted">${t('account.hint2')}</p>
  </div>`;
}

/* ---- E3. 运维面板（仅 admin） ---- */

function renderOpsView() {
  if (!isAdmin()) return `<div class="card"><p class="muted">${t('ops.notAdmin')}</p></div>`;
  return `<div class="ops-grid">
    ${renderOpsOverview()}
    ${renderOpsMetrics()}
    ${renderOpsRisk()}
    ${renderOpsReports()}
    ${renderOpsBackup()}
    ${renderOpsCron()}
    ${renderOpsAuditFull()}
  </div>`;
}

function opsRefreshBtn(block) {
  return `<button type="button" class="btn btn-ghost btn-sm" data-action="ops-refresh" data-block="${esc(block)}">${t('common.refresh')}</button>`;
}

function renderOpsOverview() {
  const d = state.ops.overview || {};
  const comps = (d.components && typeof d.components === 'object') ? d.components : {};
  const ckeys = Object.keys(comps);
  const compHtml = ckeys.length ? ckeys.map(k => {
    const v = comps[k];
    const isObj = v && typeof v === 'object';
    const status = isObj ? String(pick(v, ['status', 'state', 'configured']) || '') : String(v);
    const bad = /degrad|down|error|fail|false|off/i.test(status);
    return `<span class="badge ${bad ? 'badge-degraded' : 'badge-configured'}">${esc(k)}: ${esc(isObj ? (pick(v, ['status', 'state']) || JSON.stringify(v)) : v)}</span>`;
  }).join('') : `<span class="muted">${t('ops.noData')}</span>`;
  const jobs = d.jobs;
  return `
  <div class="card">
    <div class="card-head"><h3>${t('ops.overviewTitle')}</h3>${opsRefreshBtn('overview')}</div>
    <h4>${t('ops.componentsTitle')}</h4><div class="comp-list">${compHtml}</div>
    <div class="kv">${kv([
      [t('ops.notificationsPending'), d.notifications_pending],
      [t('ops.readinessTitle'), d.readiness],
    ])}</div>
    ${Array.isArray(jobs) ? `<h4>${t('ops.jobsTitle')}</h4>${genericTable(jobs, t('ops.noData'))}` : ''}
  </div>`;
}

function renderOpsMetrics() {
  const d = state.ops.metrics || {};
  const li = (d.ledger_integrity && typeof d.ledger_integrity === 'object') ? d.ledger_integrity : {};
  const balanced = li.balanced !== undefined ? li.balanced : d.ledger_integrity_balanced;
  // 仅在已加载指标且平衡校验明确不为 true 时显示红色警示，避免未加载时误报。
  const alert = (state.ops.metrics && balanced !== true) ? `<div class="metric-alert">${t('ops.metricsAlert')}</div>` : '';
  return `
  <div class="card">
    <div class="card-head"><h3>${t('ops.metricsTitle')}</h3>${opsRefreshBtn('metrics')}</div>
    ${alert}
    <div class="kv">${kv([
      [t('ops.requests'), pick(d, ['requests', 'request_count', 'total_requests'])],
      [t('ops.errorRate'), pick(d, ['error_rate', 'errorRate'])],
      [t('ops.latency'), pick(d, ['latency', 'latency_ms', 'p95_latency_ms'])],
      [t('ops.ledgerBalanced'), balanced],
      [t('ops.hashChain'), pick(d, ['hash_chain_valid', 'hashChainValid'])],
    ])}</div>
  </div>`;
}

function renderOpsRisk() {
  const d = state.ops.risk;
  const items = Array.isArray(d) ? d
    : (d && Array.isArray(d.items) ? d.items : (d && Array.isArray(d.flags) ? d.flags : []));
  let table;
  if (!items.length) {
    table = `<p class="muted">${t('ops.risk.empty')}</p>`;
  } else {
    const rows = items.map(it => {
      const id = (it && (it.flag_id || it.id)) || '';
      return `<tr>
        <td><code>${esc(shortId(id))}</code></td>
        <td>${esc(it && it.flag)}</td>
        <td>${esc(it && it.score)}</td>
        <td>${esc(it && it.subject)}</td>
        <td><button type="button" class="btn btn-ghost btn-sm" data-action="risk-resolve" data-id="${esc(id)}">${t('ops.risk.handle')}</button></td>
      </tr>`;
    }).join('');
    table = `<div class="table-wrap"><table class="table"><thead><tr>
      <th>flag_id</th><th>${t('ops.risk.flag')}</th><th>${t('ops.risk.score')}</th><th>${t('ops.risk.subject')}</th><th>${t('common.humanConfirm')}</th>
      </tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  return `
  <div class="card">
    <div class="card-head"><h3>${t('ops.riskTitle')}</h3>${opsRefreshBtn('risk')}</div>
    ${table}
  </div>`;
}

function renderOpsReports() {
  const q = state.queue;
  return `
  <div class="card">
    <div class="card-head"><h3>${t('ops.reportsTitle')}</h3><button type="button" class="btn btn-ghost btn-sm" data-action="refresh-queue">${t('common.refresh')}</button></div>
    <h4>${t('ops.reports.pending')}</h4>${genericTable(q && q.pending_review, t('queue.empty'))}
    <h4>${t('ops.reports.disputed')}</h4>${genericTable(q && q.disputed, t('queue.empty'))}
  </div>`;
}

function renderOpsBackup() {
  const d = state.ops.backup || {};
  const a = state.ops.anchor;
  const tables = pick(d, ['tables', 'table_counts', 'row_counts', 'counts']) || {};
  const tkeys = (tables && typeof tables === 'object') ? Object.keys(tables) : [];
  const tablesHtml = tkeys.length
    ? `<div class="kv">${kv(tkeys.map(k => [k, tables[k]]))}</div>`
    : `<p class="muted">${t('ops.noData')}</p>`;
  return `
  <div class="card">
    <div class="card-head"><h3>${t('ops.backupTitle')}</h3>${opsRefreshBtn('backup')}</div>
    <div class="kv">${kv([
      [t('ops.backup.sha256'), d.sha256],
      [t('ops.backup.rowCount'), d.row_count],
    ])}</div>
    <h4>${t('ops.backup.tables')}</h4>${tablesHtml}
    <div class="inline-actions">
      <button type="button" class="btn btn-ghost" data-action="backup-download">${t('ops.backup.download')}</button>
      <button type="button" class="btn btn-primary" data-action="anchor">${t('ops.backup.anchor')}</button>
    </div>
    <p class="ops-hint">${t('ops.backup.hint')}</p>
    ${a ? `<div class="kv">${kv([[t('ops.backup.merkle'), a.merkle_root], [t('ops.backup.anchoredAt'), a.anchored_at]])}</div>` : ''}
  </div>`;
}

function renderOpsCron() {
  const r = state.ops.cron;
  return `
  <div class="card">
    <div class="card-head"><h3>${t('ops.cronTitle')}</h3>${opsRefreshBtn('cron')}</div>
    <div class="ops-inline">
      <label class="form-row"><span>${t('ops.cron.secretLabel')}</span><input type="password" data-model="opsDraft.cron_secret" value="${esc(state.opsDraft.cron_secret)}" placeholder="${esc(t('ops.cron.secretPlaceholder'))}" autocomplete="off"></label>
      <button type="button" class="btn btn-primary" data-action="cron">${t('ops.cron.run')}</button>
    </div>
    <p class="ops-hint">${t('ops.cron.hint')}</p>
    ${r ? `<div class="kv">${kv([[t('ops.cron.ran'), r.ran], [t('ops.cron.counts'), r.counts]])}</div>` : ''}
  </div>`;
}

function renderOpsAuditFull() {
  const d = state.ops.audit;
  const items = Array.isArray(d) ? d
    : (d && Array.isArray(d.items) ? d.items : (d && Array.isArray(d.audit) ? d.audit : []));
  let table;
  if (!items.length) {
    table = `<p class="muted">${t('ops.audit.empty')}</p>`;
  } else {
    const rows = items.map(it => `<tr>
      <td><code>${esc(shortId(it && it.actor_id))}</code></td>
      <td>${esc(it && it.action)}</td>
      <td><code>${esc(shortId(it && it.target_id))}</code></td>
      <td class="muted">${esc(it && it.created_at)}</td>
      <td>${cell(it && it.detail)}</td>
    </tr>`).join('');
    table = `<div class="table-wrap"><table class="table"><thead><tr>
      <th>actor_id</th><th>action</th><th>target_id</th><th>created_at</th><th>detail</th>
      </tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  return `
  <div class="card ops-full">
    <div class="card-head"><h3>${t('ops.auditTitle')}</h3>${opsRefreshBtn('audit')}</div>
    ${table}
  </div>`;
}

/* ------------------------------------------------------------------ F. 弹窗 */

function gateNoteHtml() {
  return `<p class="gate-note">${t('common.humanGate')}</p>`;
}

// 管理员/闸门类操作统一走此弹窗，确认按钮文案固定写明「人工确认」。
// extra 可含 { withReason, reasonLabel, withSelect, selectLabel, selectOptions }。
function confirmGate(title, detailHtml, danger = false, extra = {}) {
  return openConfirm(Object.assign({
    title: title,
    bodyHtml: '<p>' + detailHtml + '</p>' + gateNoteHtml(),
    confirmLabel: t('common.humanConfirm'),
    danger: danger,
  }, extra));
}

function openConfirm(cfg) {
  return new Promise(resolve => {
    state.modal = {
      title: cfg.title,
      bodyHtml: cfg.bodyHtml,
      confirmLabel: cfg.confirmLabel || t('common.humanConfirm'),
      danger: !!cfg.danger,
      requireText: cfg.requireText || null,
      withReason: !!cfg.withReason,
      reasonLabel: cfg.reasonLabel || t('gate.reasonGeneric'),
      withSelect: !!cfg.withSelect,
      selectLabel: cfg.selectLabel || '',
      selectOptions: Array.isArray(cfg.selectOptions) ? cfg.selectOptions : [],
      resolve: resolve,
    };
    renderModal();
  });
}

function resolveModal(value) {
  const m = state.modal;
  if (!m) return;
  let result = value;
  if (value) {
    if (m.requireText) {
      const input = document.getElementById('modal-input');
      const typed = input ? input.value.trim() : '';
      if (typed !== m.requireText) {
        toast(t('common.confirmRequired', { word: m.requireText }), 'error');
        return;
      }
    }
    // 带自由文本 / 下拉选择的弹窗 resolve 一个对象，普通弹窗仍 resolve 布尔值。
    if (m.withReason || m.withSelect) {
      result = { ok: true };
      if (m.withReason) {
        const ri = document.getElementById('modal-reason');
        result.reason = ri ? ri.value.trim() : '';
      }
      if (m.withSelect) {
        const si = document.getElementById('modal-select');
        result.select = si ? si.value : '';
      }
    }
  }
  state.modal = null;
  renderModal();
  m.resolve(result);
}

function renderModal() {
  const root = document.getElementById('modal-root');
  const m = state.modal;
  if (!m) { root.hidden = true; root.innerHTML = ''; return; }
  root.hidden = false;
  const extraHtml = (m.requireText || m.withSelect || m.withReason) ? `<div class="modal-extra">
      ${m.requireText ? `<label class="form-row"><span>${t('common.typeToConfirm', { word: m.requireText })}</span><input id="modal-input" type="text" autocomplete="off" spellcheck="false" placeholder="${esc(m.requireText)}"></label>` : ''}
      ${m.withSelect ? `<label class="form-row"><span>${esc(m.selectLabel)}</span><select id="modal-select">${m.selectOptions.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select></label>` : ''}
      ${m.withReason ? `<label class="form-row"><span>${esc(m.reasonLabel)}</span><input id="modal-reason" type="text" autocomplete="off" placeholder="${esc(m.reasonLabel)}"></label>` : ''}
    </div>` : '';
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal card" role="dialog" aria-modal="true" aria-label="${esc(m.title)}">
        <h3 class="modal-title">${esc(m.title)}</h3>
        <div class="modal-body">${m.bodyHtml}</div>
        ${extraHtml}
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-action="modal-cancel">${t('common.cancel')}</button>
          <button type="button" class="btn ${m.danger ? 'btn-danger' : 'btn-primary'}" data-action="modal-confirm">${esc(m.confirmLabel)}</button>
        </div>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ G. 动作 */

async function doAuth(kind) {
  const d = state.authDraft;
  const path = kind === 'login' ? '/api/auth/login' : '/api/auth/register';
  const body = kind === 'login'
    ? { email: d.email, password: d.password }
    : { email: d.email, password: d.password, display_name: d.display_name, role: d.role };
  try {
    const data = await api(path, { method: 'POST', body: body, authAttempt: true });
    state.user = data.user;
    state.csrf = (data.session && data.session.csrf_token) || data.csrf_token || state.csrf;
    state.consents = [];
    state.preferences = { personalized_enabled: true };
    state.emailVerification = { required: kind === 'register' && !!data.verification_required, token: '' };
    if (data.user) state.detailDraft.ledger_user_id = data.user.user_id;
    toast(t('auth.ok', { name: data.user.display_name || data.user.email }));
    // 以 /api/auth/me 校准偏好、同意记录、邮箱验证状态与 CSRF。
    try { await refreshMe(); } catch (e) { showError(e); }
    await loadConsoleData();
    void loadNotifications(true);
    render();
    renderCookieBar();
  } catch (e) {
    showError(e);
  }
}

async function doLogout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
    toast(t('auth.loggedOut'));
  } catch (e) {
    showError(e);
  }
  clearSession();
  state.tasks = [];
  state.taskCount = 0;
  state.events = [];
  state.boardTasks = [];
  state.boardUsers = [];
  state.ledger = null;
  state.queue = null;
  render();
}

async function doPublish() {
  const d = state.publishDraft;
  const body = {
    title: String(d.title).trim(),
    description: String(d.description).trim(),
    category: String(d.category).trim() || 'general',
    bounty: Number(d.bounty),
    acceptance_criteria: String(d.acceptance_criteria).trim(),
    online: d.online === true || d.online === 'true',
    radius_km: Number(d.radius_km),
    required_skills: String(d.required_skills).split(/[,，\s]+/).map(s => s.trim()).filter(Boolean),
    deadline_hours: Number(d.deadline_hours),
    event_id: newEventId(),
  };
  if (!body.title) { toast(t('publish.validationTitle'), 'error'); return; }
  try {
    const data = await api('/api/tasks', { method: 'POST', body: body });
    const id = data && data.task ? data.task.task_id : '';
    toast(t('publish.ok', { id: id ? '：' + id : '' }));
    await refreshAfterWrite();
  } catch (e) { showError(e); }
}

function selectTask(id) {
  state.selectedTaskId = id;
  state.detailDraft.event_task_id = id;
  state.dispatchResult = null;
  render();
  void loadEvents().then(render);
}

async function doReview(decision) {
  const task = currentTask();
  if (!task) return;
  const label = decision === 'approve' ? t('action.reviewApprove') : t('action.reviewReject');
  const ok = await confirmGate(t('gate.reviewTitle'),
    t('gate.reviewDetail', { id: task.task_id, label: label }), decision === 'reject');
  if (!ok) return;
  try {
    await api(taskPath('review'), { method: 'POST', body: { decision: decision, event_id: newEventId() } });
    toast(t('toast.reviewOk'));
    await refreshAfterWrite();
  } catch (e) { showError(e); }
}

async function doDispatch() {
  const task = currentTask();
  if (!task) return;
  const d = state.detailDraft;
  const ok = await confirmGate(t('gate.dispatchTitle'),
    t('gate.dispatchDetail', { id: task.task_id }), false);
  if (!ok) return;
  try {
    const data = await api(taskPath('dispatch'), {
      method: 'POST',
      body: {
        dry_run: d.dry_run !== false,
        top_k: Number(d.top_k),
        batch_size: Number(d.batch_size),
        event_id: newEventId(),
      },
    });
    state.dispatchResult = data;
    toast(t('toast.dispatchOk', { mode: data && data.mode ? data.mode : '—' }));
    await refreshAfterWrite();
  } catch (e) { showError(e); }
}

async function doAccept() {
  if (!currentTask()) return;
  try {
    await api(taskPath('accept'), { method: 'POST', body: { event_id: newEventId() } });
    toast(t('toast.acceptOk'));
    await refreshAfterWrite();
  } catch (e) { showError(e); }
}

async function doSubmitResult() {
  if (!currentTask()) return;
  const content = String(state.detailDraft.content).trim();
  if (!content) { toast(t('toast.resultValidation'), 'error'); return; }
  try {
    await api(taskPath('submit'), { method: 'POST', body: { content: content, event_id: newEventId() } });
    toast(t('toast.resultOk'));
    await refreshAfterWrite();
  } catch (e) { showError(e); }
}

async function doVerify(decision) {
  const task = currentTask();
  if (!task) return;
  const label = decision === 'approve' ? t('action.verifyApprove')
    : (decision === 'reject' ? t('action.verifyReject') : t('action.autoAccept'));
  const ok = await confirmGate(t('gate.verifyTitle'),
    t('gate.verifyDetail', { id: task.task_id, label: label }), decision === 'reject');
  if (!ok) return;
  const d = state.detailDraft;
  try {
    await api(taskPath('verify'), {
      method: 'POST',
      body: {
        decision: decision,
        rating: Number(d.rating),
        reason: String(d.reason).trim(),
        event_id: newEventId(),
      },
    });
    toast(t('toast.verifyOk'));
    await refreshAfterWrite();
  } catch (e) { showError(e); }
}

async function doDisputeOpen() {
  const task = currentTask();
  if (!task) return;
  const reason = String(state.detailDraft.dispute_reason).trim();
  if (!reason) { toast(t('toast.disputeReasonValidation'), 'error'); return; }
  try {
    await api(taskPath('dispute'), {
      method: 'POST',
      body: { action: 'open', reason: reason, event_id: newEventId() },
    });
    toast(t('toast.disputeOpenOk'));
    await refreshAfterWrite();
  } catch (e) { showError(e); }
}

async function doDisputeResolve() {
  const task = currentTask();
  if (!task) return;
  const d = state.detailDraft;
  const ok = await confirmGate(t('gate.disputeTitle'),
    t('gate.disputeDetail', { id: task.task_id, resolution: d.resolution }), false);
  if (!ok) return;
  try {
    await api(taskPath('dispute'), {
      method: 'POST',
      body: {
        action: 'resolve',
        resolution: d.resolution,
        reason: String(d.resolve_reason).trim(),
        event_id: newEventId(),
      },
    });
    toast(t('toast.disputeResolveOk'));
    await refreshAfterWrite();
  } catch (e) { showError(e); }
}

async function doReport() {
  if (!currentTask()) return;
  const reason = String(state.detailDraft.report_reason).trim();
  if (!reason) { toast(t('report.validation'), 'error'); return; }
  try {
    await api('/api/reports', {
      method: 'POST',
      body: { task_id: state.selectedTaskId, reason: reason, event_id: newEventId() },
    });
    toast(t('report.ok'));
    await refreshAfterWrite();
  } catch (e) { showError(e); }
}

// 「关闭个性化推荐」开关：勾选即 enabled=false；服务端强制生效。
async function onTogglePersonalized(checked) {
  if (state.writeLocked) {
    toast(t('demo.writeLockedToast'), 'error');
    render();
    return;
  }
  const enabled = !checked;
  try {
    await api('/api/preferences/personalized', {
      method: 'POST',
      body: { enabled: enabled, event_id: newEventId() },
    });
    state.preferences = { personalized_enabled: enabled };
    if (state.config) state.config.personalized_enabled = enabled;
    toast(enabled ? t('ai.personalOn') : t('ai.personalOff'));
    await refreshAfterWrite();
  } catch (e) { showError(e); render(); }
}

async function doExport() {
  try {
    const data = await api('/api/me/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sambon-my-data-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast(t('account.exportOk'));
  } catch (e) { showError(e); }
}

async function doDeleteAccount() {
  const ok = await openConfirm({
    title: t('account.deleteTitle'),
    bodyHtml: '<p>' + t('account.deleteBody') + '</p>' + gateNoteHtml(),
    confirmLabel: t('common.confirmDelete'),
    danger: true,
    requireText: 'DELETE',
  });
  if (!ok) return;
  try {
    await api('/api/me', { method: 'DELETE' });
    toast(t('account.deleteOk'));
    clearSession();
    state.tasks = [];
    state.taskCount = 0;
    render();
  } catch (e) { showError(e); }
}

async function onConsent(granted) {
  // 匿名阶段尝试补齐 CSRF；若仍无会话则按契约携带空头，由后端按匿名请求处理。
  if (!state.csrf) {
    try { await refreshMe(); } catch (e) { /* 匿名：保持空值 */ }
  }
  try {
    await api('/api/consents', {
      method: 'POST',
      body: { kind: 'cookie', version: 'v1', granted: granted },
    });
  } catch (e) {
    showError(e); // 不静默失败：后端异常仍以 toast 呈现
  }
  lsSet(CONSENT_KEY, granted ? 'all' : 'necessary');
  state.cookieBarForced = false;
  renderCookieBar();
  toast(granted ? t('cookie.recordedAll') : t('cookie.recordedNecessary'));
}

/* ---- G2. 邮箱验证 ---- */

async function doVerifyEmail() {
  const token = String(state.emailVerification.token || '').trim();
  if (!token) { toast(t('verify.tokenValidation'), 'error'); return; }
  try {
    await api('/api/auth/verify-email', { method: 'POST', body: { token: token } });
    state.emailVerification = { required: false, token: '' };
    toast(t('verify.ok'));
    try { await refreshMe(); } catch (e) { showError(e); }
    render();
  } catch (e) { showError(e); }
}

async function doResendVerification() {
  try {
    await api('/api/auth/resend-verification', { method: 'POST', body: { event_id: newEventId() } });
    toast(t('verify.resendOk'));
  } catch (e) { showError(e); }
}

/* ---- G3. 通知中心 ---- */

async function doNotificationRead(all, id) {
  const body = all
    ? { all: true, event_id: newEventId() }
    : { ids: [id], event_id: newEventId() };
  try {
    await api('/api/me/notifications/read', { method: 'POST', body: body });
    toast(t('notif.readOk'));
    await loadNotifications();
    render();
  } catch (e) { showError(e); }
}

/* ---- G4. 埋点回执 ---- */

async function doFeedback(kind) {
  const task = currentTask();
  if (!task) return;
  try {
    await api(taskPath('feedback'), { method: 'POST', body: { kind: kind, event_id: newEventId() } });
    state.feedbackDone[task.task_id] = kind;
    toast(t('feedback.ok', { kind: kind }));
    render();
  } catch (e) { showError(e); }
}

/* ---- G5. 取消任务 ---- */

async function doCancel() {
  const task = currentTask();
  if (!task) return;
  const r = await confirmGate(t('gate.cancelTitle'),
    t('gate.cancelDetail', { id: task.task_id }), true,
    { withReason: true, reasonLabel: t('gate.cancelReason') });
  if (!r) return;
  try {
    await api(taskPath('cancel'), {
      method: 'POST',
      body: { reason: r.reason || '', event_id: newEventId() },
    });
    toast(t('cancel.ok'));
    await refreshAfterWrite();
  } catch (e) { showError(e); }
}

/* ---- G6. 运维动作 ---- */

async function doRiskResolve(flagId) {
  const r = await confirmGate(t('gate.riskTitle'),
    t('gate.riskDetail', { id: flagId }), false, {
      withReason: true,
      reasonLabel: t('gate.riskReason'),
      withSelect: true,
      selectLabel: t('gate.riskDecision'),
      selectOptions: [
        { value: 'dismiss', label: t('gate.riskDismiss') },
        { value: 'escalate', label: t('gate.riskEscalate') },
      ],
    });
  if (!r) return;
  try {
    await api('/api/admin/risk/resolve', {
      method: 'POST',
      body: {
        flag_id: flagId,
        decision: r.select || 'dismiss',
        reason: r.reason || '',
        event_id: newEventId(),
      },
    });
    toast(t('ops.risk.ok'));
    await loadOpsBlock('risk');
    render();
  } catch (e) { showError(e); }
}

function doBackupDownload() {
  const d = state.ops.backup;
  if (!d) { toast(t('ops.noData'), 'error'); return; }
  const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'sambon-backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast(t('ops.backup.downloadOk'));
}

async function doAnchor() {
  const ok = await confirmGate(t('gate.anchorTitle'), t('gate.anchorDetail'), false);
  if (!ok) return;
  try {
    state.ops.anchor = await api('/api/admin/anchor', { method: 'POST', body: { event_id: newEventId() } });
    toast(t('ops.backup.anchorOk'));
    render();
  } catch (e) { showError(e); }
}

async function doCron() {
  const secret = String(state.opsDraft.cron_secret || '').trim();
  if (!secret) { toast(t('ops.cron.secretValidation'), 'error'); return; }
  const ok = await confirmGate(t('gate.cronTitle'), t('gate.cronDetail'), false);
  if (!ok) return;
  try {
    state.ops.cron = await api('/api/admin/cron', {
      method: 'POST',
      body: { dry_run: false, event_id: newEventId() },
      headers: { 'X-Cron-Secret': secret },
    });
    toast(t('ops.cron.ok'));
    render();
  } catch (e) { showError(e); }
}

/* ------------------------------------------------------------------ 动作派发 */

async function handleAction(action, el) {
  const ds = el && el.dataset ? el.dataset : {};
  // 开关由 change 事件统一处理，click 不重复派发。
  if (action === 'toggle-personalized') return;
  // 演示模式写锁：业务写操作统一拦截，不静默失败。
  if (state.writeLocked && WRITE_ACTIONS.has(action)) {
    toast(t('demo.writeLockedToast'), 'error');
    return;
  }
  switch (action) {
    case 'set-locale': setLocale(ds.locale); break;
    case 'console-tab':
      state.consoleTab = (ds.tab === 'ops' && isAdmin()) ? 'ops' : 'workbench';
      if (state.consoleTab === 'ops' && !state.opsLoaded) {
        state.opsLoaded = true;
        await loadAllOps();
      }
      render();
      break;
    case 'auth-tab': state.authTab = ds.tab || 'login'; render(); break;
    case 'login': await doAuth('login'); break;
    case 'register': await doAuth('register'); break;
    case 'logout': await doLogout(); break;
    case 'select-task': selectTask(ds.id); break;
    case 'publish-task': await doPublish(); break;
    case 'review': await doReview(ds.decision); break;
    case 'dispatch': await doDispatch(); break;
    case 'accept': await doAccept(); break;
    case 'submit-result': await doSubmitResult(); break;
    case 'verify': await doVerify(ds.decision); break;
    case 'dispute-open': await doDisputeOpen(); break;
    case 'dispute-resolve': await doDisputeResolve(); break;
    case 'report': await doReport(); break;
    case 'export-me': await doExport(); break;
    case 'delete-me': await doDeleteAccount(); break;
    case 'cookie-accept-all': await onConsent(true); break;
    case 'cookie-necessary': await onConsent(false); break;
    case 'cookie-settings': state.cookieBarForced = true; renderCookieBar(); break;
    case 'refresh-tasks': await loadTasks(); render(); break;
    case 'refresh-events': await loadEvents(); render(); break;
    case 'refresh-ledger': await loadLedger(); render(); break;
    case 'refresh-boards': await loadBoards(); render(); break;
    case 'refresh-queue': await loadQueue(); render(); break;
    /* 邮箱验证 */
    case 'verify-email': await doVerifyEmail(); break;
    case 'resend-verification': await doResendVerification(); break;
    /* 通知中心 */
    case 'notif-toggle':
      state.notifOpen = !state.notifOpen;
      if (state.notifOpen) await loadNotifications();
      renderNotifPanel();
      break;
    case 'notif-close': state.notifOpen = false; renderNotifPanel(); break;
    case 'refresh-notifications': await loadNotifications(); render(); break;
    case 'notification-read': await doNotificationRead(ds.all === '1', ds.id); break;
    /* 埋点回执 / 取消任务 */
    case 'task-feedback': await doFeedback(ds.kind); break;
    case 'cancel-task': await doCancel(); break;
    /* 运维面板 */
    case 'ops-refresh':
      if (ds.block === 'all') await loadAllOps();
      else if (ds.block === 'queue') await loadQueue();
      else await loadOpsBlock(ds.block);
      render();
      break;
    case 'risk-resolve': await doRiskResolve(ds.id); break;
    case 'backup-download': doBackupDownload(); break;
    case 'anchor': await doAnchor(); break;
    case 'cron': await doCron(); break;
    /* 弹窗 */
    case 'modal-confirm': resolveModal(true); break;
    case 'modal-cancel': resolveModal(false); break;
    default: break;
  }
}

/* ------------------------------------------------------------------ H. 启动 */

function applyHealthGate() {
  const h = state.health;
  // fail-closed：健康检查失败或 mode 非 production 时一律上锁。
  state.writeLocked = !h || h.mode !== 'production';
}

async function bootstrap() {
  // 0) 先按语言填充静态骨架（含 L1 声明、<html lang> 与语言按钮高亮）。
  applyStaticI18n();
  const app = document.getElementById('app');
  app.innerHTML = `<div class="card"><p class="muted">${esc(t('common.loading'))}</p></div>`;

  // 1) 契约要求：前端启动必须先请求 /api/health，并据 mode 决定写锁与横幅。
  try {
    state.health = await api('/api/health', { silent401: true });
  } catch (e) {
    showError(e);
    state.health = null;
  }
  applyHealthGate();
  renderBanners();

  // 2) 配置与会话并行加载；/api/auth/me 未登录返回 401，silent401 下安静降级。
  const [config, me] = await Promise.all([
    api('/api/config', { silent401: true }).catch(e => { showError(e); return null; }),
    api('/api/auth/me', { silent401: true }).catch(e => { showError(e); return null; }),
  ]);
  state.config = config || null;
  if (me) {
    state.user = me.user || null;
    state.csrf = me.csrf_token || (me.session && me.session.csrf_token) || null;
    state.preferences = me.preferences || { personalized_enabled: true };
    state.consents = Array.isArray(me.consents) ? me.consents : [];
    if (state.user) state.detailDraft.ledger_user_id = state.user.user_id;
    syncConsentFromServer();
  }
  if (state.user) {
    await loadConsoleData();
    void loadNotifications(true); // 启动拉取未读数
  }
  render();
  startNotifPolling();
}

/* ------------------------------------------------------------------ I. 事件委托 */

// 所有输入通过 data-model="分组.字段" 回写 state，重绘后值不丢失。
function bindModel(el) {
  if (!el || !el.dataset || !el.dataset.model) return;
  const parts = el.dataset.model.split('.');
  if (parts.length !== 2 || !state[parts[0]]) return;
  state[parts[0]][parts[1]] = el.type === 'checkbox' ? el.checked : el.value;
}

document.addEventListener('click', e => {
  const el = e.target.closest && e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  // 表单内 submit 按钮统一由本处理器派发动作，阻止原生提交跳转。
  if (el.tagName === 'BUTTON' && el.type === 'submit') e.preventDefault();
  void handleAction(el.dataset.action, el);
});

// 任何 form 都不允许原生提交（Enter / 默认行为），动作走 click 或 keydown 派发。
document.addEventListener('submit', e => e.preventDefault());

document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA') return;
  const form = e.target.closest && e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  void handleAction(form.dataset.form, { dataset: {} });
});

document.addEventListener('input', e => bindModel(e.target));

document.addEventListener('change', e => {
  bindModel(e.target);
  if (e.target.dataset && e.target.dataset.action === 'toggle-personalized') {
    void onTogglePersonalized(e.target.checked);
  }
});

// 兜底：任何未被显式 catch 的 ApiError 统一以 toast 呈现，绝不静默失败。
window.addEventListener('unhandledrejection', e => {
  if (e.reason instanceof ApiError) {
    showError(e.reason);
    e.preventDefault();
  }
});

// 启动
void bootstrap();
