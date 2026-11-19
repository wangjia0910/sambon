# E-05 备份 / 留存 / Time Travel 恢复演练 Runbook

> 支撑闸门：E-05（基础设施）。本文件是**操作手册**，不替代「一次真实恢复演练记录」。
> 演练完成后，把演练日期、操作人、恢复后核对结果填入 `ops/readiness.json` 的 E-05。

## 1. 备份策略（自动 + 按需）

- D1 自带 **Time Travel**（默认 30 天可回滚到任意时间点）+ **每日自动备份**，无需自建。
- 应用层额外提供 `GET /api/admin/backup`：导出 18 张业务表（不含密钥）为 JSON，计算 64 位 SHA-256，写入 `backups` 表留痕，并明确「含个人数据须加密保存」。
- 建议：每日定时调用 `/api/admin/backup` → 落盘到加密对象存储（如 R2 / S3-SSE），密钥与数据库分离保管。

## 2. 手动导出（演示命令，需 admin 会话 + 备份权限）

```bash
# 1) 登录拿到 admin token（仅演示环境用 ADMIN_BOOTSTRAP_TOKEN 创建首名 admin 后移除该变量）
curl -X POST https://sambon.net/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<admin>","password":"<pw>"}'
# 取返回 cookie/session

# 2) 触发导出
curl -X GET https://sambon.net/api/admin/backup \
  -H "Cookie: session=<admin_session>" -o backup-$(date +%F).json
```

## 3. 真实恢复演练步骤（至少每季度一次）

1. 从备份 JSON 或 D1 Time Travel 时间点，创建一个**隔离的临时数据库** `sambon-restore-drill`。
2. 导入数据，确认 19 张表存在（含 `backups`、`metrics`、`risk_flags` 等新增表）。
3. 核对账本守恒：`SELECT SUM(delta) FROM ledger_entries;` 必须为 0。
4. 核对哈希链：调用 `/api/admin/metrics` 返回 `ledger_consistent:true`、`hash_chain_valid:true`。
5. 核对用户/任务数与原库一致（抽核 3~5 条）。
6. 演练结束销毁临时库，**不**对生产库执行任何 restore（避免破坏账本哈希链——见 docs/13 §3）。

## 4. 留存与加密

- 留存期限：业务数据 ≥ 法定最短留存期（建议 ≥ 12 个月），PII 按删除请求 30 天内销毁。
- 加密存储：备份文件静态加密（AES-256 / 对象存储 SSE），密钥独立于 D1，仅授权运维可解密。

## 5. 演练记录模板（填 E-05.evidence）

```
日期：YYYY-MM-DD  操作人：__  复核人：__
方式：D1 Time Travel 时间点 / /api/admin/backup 导出
恢复库：sambon-restore-drill
核对：19 表✓ 账本SUM(delta)=0✓ 哈希链valid✓ 抽核N条一致✓
结论：恢复成功，生产库未变更
```
