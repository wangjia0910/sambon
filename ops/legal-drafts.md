# E-09 隐私政策 / 服务条款 / 可接受使用政策（双语法务定稿草稿）

> 支撑闸门：E-09（合规）。**本文件为 DRAFT，须由目标市场执业律师审定版本号、发布日期与同意留痕方案后方可引用。**
> 依据：docs/13 §5 E-09、docs/11 境外发布合规基线、平台实际能力（SBC 非资产、18+ 限制、人工闸门、AI 透明度、Cloudflare DPA/SCC）。

---

## 中文 · 隐私政策（摘要，待补全为正式稿）

**1. 数据控制者**：三宝殿（sambon.net）运营方（实体信息待补）。
**2. 我们收集的数据**：账号信息（邮箱、口令哈希）、任务内容（标题/描述/地点/现象，经 PII 脱敏）、接单与结算记录（SBC 积分流水）、风控与审计日志、Cookie/同意偏好。
**3. 处理目的与法律依据**：履行合同（撮合悬赏任务）、合法利益（防欺诈/安全）、同意（Cookie/个性化）、法定义务。
**4. 国际传输**：基础设施位于 Cloudflare 全球网络，依赖 Cloudflare DPA + 标准合同条款（SCC）+ 传输影响评估（TIA）；见 E-08。
**5. 您的权利（GDPR/UK GDPR 等）**：访问、更正、删除、限制、可携、反对自动化决策（本平台模型 `model_decision` 恒 null，不据此自动裁定/结算）、撤回同意、投诉至监管机构。账号擦除端点 `ACCOUNT_ERASED` 已落地。
**6. SBC 性质声明**：SBC 是平台内贡献积分，**非加密资产、非支付工具、不可兑付/转让/交易/收益**，详见 SBC 白皮书与 E-12 法律意见。
**7. 未成年人**：限定 18 岁以上使用；年龄核验方案见 E-11。
**8. AI 透明度**：大模型仅用于描述抽取/语义提示/争议材料摘要，不参与决策；详见 `/legal` 英文 AI Disclosure。
**9. 留存与删除**：业务数据按法定最短期限留存；删除请求 30 天内处理；备份按 E-05 加密留存。
**10. 联系**：DPO/欧盟代表见 E-15。

## English · Privacy Policy (summary, pending finalization)

**1. Data Controller**: Sanbaodian (sambon.net) operator (entity TBD).
**2. Data We Collect**: account info (email, password hash), task content (title/description/location/symptom, PII-sanitized), match & settlement records (SBC ledger), risk & audit logs, cookie/consent preferences.
**3. Purposes & Legal Basis**: contract performance (reward task matching), legitimate interests (fraud/security), consent (cookies/personalization), legal obligation.
**4. International Transfer**: infrastructure on Cloudflare global network, relying on Cloudflare DPA + Standard Contractual Clauses (SCC) + Transfer Impact Assessment (TIA); see E-08.
**5. Your Rights (GDPR/UK GDPR etc.)**: access, rectification, erasure, restriction, portability, object to automated decisions (our model `model_decision` is always null and never auto-decides/settles), withdraw consent, complain to a supervisory authority. Account erasure endpoint `ACCOUNT_ERASED` implemented.
**6. SBC Nature**: SBC is an in-platform contribution credit, **not a crypto-asset, not a payment instrument, not redeemable/transferable/tradable/yield-bearing**; see SBC whitepaper and E-12 legal opinion.
**7. Minors**: restricted to users 18+; age-verification scheme see E-11.
**8. AI Transparency**: LLM used only for structure extraction / semantic hints / dispute summaries, never for decisions; see `/legal` AI Disclosure (en).
**9. Retention & Deletion**: retained per statutory minimum; deletion requests honored within 30 days; backups stored encrypted per E-05.
**10. Contact**: DPO / EU representative see E-15.

---

## 服务条款 ToS（要点）

- 服务性质：悬赏互助撮合信息平台；平台仅居间，任务履约争议由双方/人工裁定，平台不自动结算（人工闸门）。
- 账号：18+，强口令建议，禁止一次性域名注册，GPC 注册即关个性化。
- SBC 积分：平台内贡献度量，**无货币价值、不可提现/交易**，违规可依规扣减（人工确认）。
- 责任限制：平台对任务真实性不担保；不可抗力与第三方（Cloudflare）故障免责范围内。
- 终止：用户可随时删除账号；平台对滥用可经人工复核后限制。

## 可接受使用政策 AUP（要点）

- 禁止发布违法、侵权、欺诈、赌博、色情、暴力、仇恨、武器、医疗/金融误导内容。
- 禁止利用平台从事洗钱、制裁规避、爬虫滥用、刷量引流。
- 违规经风控标记 + 人工复核后处置，记录入 `audit_log`。

---

## 待律师定稿清单（转为 E-09.evidence）

- [ ] 隐私政策正式稿（zh + en 成对），版本号 + 发布日期
- [ ] ToS 正式稿（zh + en）
- [ ] AUP 正式稿（zh + en）
- [ ] 同意留痕方案（Cookie 同意 + 注册勾选 + 版本绑定）
- [ ] 律师审定签署日期与签字
