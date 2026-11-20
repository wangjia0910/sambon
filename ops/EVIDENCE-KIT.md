# 运营就绪证据包索引（ops/）

> 本目录是「正式运营 20 项外部闸门」的**证据工作台**。代码侧 16/16 已自动核销（见 `tests/readiness-check.mjs`）；
> 外部 20 项须真人/律师/第三方完成并留痕，逐项填进 `ops/readiness.json`。
> 当前外部核销进度：**2/20**（E-01、E-02 已用 2026-11-13 线上 19/19 部署核验填实）。

## 文件 → 闸门映射

| 文件 | 支撑闸门 | 内容 | 还差什么才计核销 |
|---|---|---|---|
| **`SIGNING-PLAYBOOK.md`** | **全部 18 项未核销** | **签署作战包：按自签/律师/第三方/运营四类拆分，逐项可执行步骤与留痕格式** | **按包内顺序推进即可** |
| `deployment-verification.json` | E-01, E-02 | 线上 19/19 核验（含实时 `/api/health`） | 已完成（E-02 建议补控制台截图，见内文） |
| `readiness.json` | 全部 20 项 | 证据台账（已填 E-01/E-02） | 其余逐项补 verified/by/at/evidence |
| `config-audit.md` | E-03 | 当前密钥配置快照 + 轮换清单（**PAT 按用户指令保留**） | 你完成控制台密钥动作并留痕 |
| `cron/github-action.yml` | E-04 | GitHub Actions 定时调用 `/api/admin/cron` 模板 | 部署后跑满 7 天日志 |
| `cron/worker.js` | E-04 | Cloudflare Worker Cron 备选模板 | 同上 |
| `backup-runbook.md` | E-05 | 备份/恢复演练手册 | 一次真实恢复演练记录 |
| `waf-rules.md` | E-14 | WAF/速率限制/风控名单/滥用 SLA 建议 | 控制台实际配置 + 处置样例 |
| `E09-PRIVACY-COMPLIANCE-REVIEW.md` | E-09（兼 E-10/E-11/E-12） | **隐私政策合规体检：27 项差距清单（阻断10/高8/中6/低3）+ 律师签署请求清单 + 核销验收标准** | **律师按清单出正式稿并署名；AI 体检报告不构成核销** |
| `legal-drafts.md` | E-09 | 隐私/ToS/AUP 双语法务**草稿（待律师定稿）** | 律师审定签字 |
| `compliance-evidence-pack.md` | E-06/E-07/E-08/E-10/E-11/E-12/E-18 | docs/07 29 项跟踪 + 律师签署请求清单 | 各责任方补证据/签字 |

## 推进状态一览

- ✅ 已核销：E-01、E-02
- 🟡 已备草稿/模板，待真实动作：E-03、E-04、E-05、E-09、E-14
- ⚪ 需律师/第三方签署：E-06、E-07、E-08、E-10、E-11、E-12
- ⚪ 需技术演练/灰度：E-13、E-15、E-16、E-17、E-18、E-19
- ⚪ 收口：E-20（有权签字人 Go）

## 使用方式

1. 按 `compliance-evidence-pack.md` 的顺序推进。
2. 每完成一项，编辑 `readiness.json` 对应条目：`verified:true`、`by`、`at`、`evidence`。
3. 复跑 `npm run check:ready` 看进度。
4. 红线提醒：即便 20/20，对外仍称「生产系统演示环境/在线预览」，除非 E-20 签发 Go。
