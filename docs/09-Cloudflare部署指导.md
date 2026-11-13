# 《三宝殿》Cloudflare Web 版部署指导 v1.2

> 用户指令（2026-11-12）：**「只做 Web 版，在 Cloudflare 上线」**  
> 基线：`CONTRACT.md` §11 D-10（产品形态收敛）、`docs/08-上线部署指导.md`、`docs/07-上线检查清单.md`  
> 地域口径（2026-11-12）：按契约 §11 **D-12**，服务**面向海外（中国境外）**、Cloudflare 部署；两项中国境内备案、ICP 备案与境内安全评估报告**不作为境外版上线闸门**，改以 `docs/11` 的 **V2-O 六组**为 G6 门槛；`docs/10` / D-11 归档为境内触发式预案。
> **本文件是部署指导，不是上线许可。** V1–V8 仍为「未上线、不触发」；站点仍属 L0 演示预览。
>
> **D-13 补注（2026-11-12，务必先读）**：本文件 §1–§8 描述的是 **L0 纯静态演示版**的历史实现与验收口径，作为过程基线保留。用户随后要求「开发适用于 Cloudflare 部署的生产系统并上线」，本轮已新增 **Pages Functions + D1 生产系统**（`functions/`、`prod/site/`、`docs/12`），并由 `cloudflare/_redirects` 把站点主入口 `/` 重写到生产台 `prod.html`；L0 演示台改由 `/index.html`、`/demo.html` 访问。因此：
> - §1 表格中「Pages Functions / Workers ❌」指的是**旧 `src/server.mjs` 不能直接搬上云**，生产系统已重写编排与持久化（业务口径仍复用 `src/domain.mjs`），并非 Pages Functions 不可用；
> - §5「静态版 `/api/*` 用 curl 测会 404」只对 **L0 演示页**成立；生产台的 `/api/*` 由 Pages Functions 在边缘真实处理，可直接用 curl 测 `GET /api/health`（期望 `mode=production`）；
> - Git 集成的 Production branch / Build command / Output directory 四项配置**不变**（`main` / 留空或 `npm run build` / `cloudflare`），`git push origin main` 会自动编译 `functions/` 并上传 15 个静态文件；
> - 唯一新增的一次性动作是在控制台绑定名为 `DB` 的 D1 数据库，未绑定时生产台显示演示横幅并禁用写操作，详见 `docs/12` §3。



---

## 0. 结论先讲

- 本轮交付形态收敛为 **Web 单端**：`sambon.net` Web 站 + 同源的本地 Node 原型；小程序 / APP / 智能硬件移出本轮范围（方案 v1.0 为只读基线，差异登记在契约 §11 D-10）。
- Cloudflare 侧采用 **Pages 纯静态 Web 版**：产物目录 `cloudflare/`，无需服务器、无需数据库、无需 Workers 计费，**单端口长驻 Node 进程在 Pages 上跑不了**，因此不是把 `src/server.mjs` 直接搬上云。
- 业务口径**没有第二套实现**：`cloudflare/src/*.mjs` 由 `src/*.mjs` 逐字节复制，浏览器运行时直接调用共用的 `handle()`。`tests/verify-cloudflare.mjs` 用同一请求序列对比浏览器运行时与 Node 服务，**14 项断言全绿、15 组字段完全一致**。
- 仍是 **L0 演示预览**：虚构数据、内存存储（刷新即重置）、无真实支付 / 大模型 / 公链 / 账号；不得表述为「平台已上线」。
- **部署状态（2026-11-12）**：用户已在 Cloudflare 控制台完成 **Connect to Git** 连接（`wangjia0910/sambon` → 分支 `main`），后续每次 `git push origin main` 自动触发部署。本轮已加固构建命令兜底并推送一次用于触发部署；线上结果需在 Deployments 页面或站点链接核验，见 §3.1。

---

## 1. 为什么必须改成静态 Web 版

| Cloudflare 能力             | 能否直接跑原项目                              | 原因                                                              |
| ------------------------- | ------------------------------------- | --------------------------------------------------------------- |
| Pages 静态托管                | ❌ 原项目无根目录 `index.html`，且 `/api/*` 无后端 | 需要入口页 + API 承载                                                  |
| Pages Functions / Workers | ❌                                     | 原 `src/server.mjs` 用 `node:http` 起服务；Workers 不提供 `createServer` |
| Cloudflare Containers     | ✅ 但要容器与计费                             | 超出「只做 Web 版」范围                                                  |

**改造方式**（已完成，见 `src/hash.mjs`、`src/server.mjs` 顶部平台适配、`tools/cf-runtime.mjs`）：

1. `src/store.mjs` 去掉 `node:crypto` 静态依赖，改用零依赖 SHA-256（`src/hash.mjs`，输出与 `node:crypto` 逐字节一致）与全局 `crypto.randomUUID()`。
2. `src/server.mjs` 把 Node 内置模块改为**按需动态加载**，浏览器侧只加载纯 JS 编排；导出 `handle(req, res)`，本地 Node 服务与浏览器运行时共用同一函数。业务 handler、状态机、积分规则、权重、脱敏、LLM 兜底**一行未改**。
3. `web/index.html` 不改动；构建脚本在产物副本的 `<head>` 注入引导层，把 `/api/*` 的 `fetch` 请求排入队列，异步加载 `cf-runtime.mjs` 后 flush，返回标准 `Response`。因此页面初始化时立即发出的 `/api/config` 也能正常返回。
4. 浏览器运行时用极薄的 mock `req` / `res` 适配 Node HTTP 风格，不启动任何服务器；数据只存在页面内存。

> 回归证据：`node tests/smoke.mjs` 20/20、`node tests/verify-local.mjs` 32/32、`node tests/verify-cloudflare.mjs` 14/14、`node tests/predeploy-check.mjs` 全绿。

---

## 2. 产物结构

`node tools/build-cloudflare.mjs` 生成（**修改 `src/` 或 `web/index.html` 后必须重跑**）：

```
cloudflare/                      ← Cloudflare Pages 的「输出目录 / 上传目录」
├── index.html                   ← web/index.html + 注入的浏览器运行时引导层
├── cf-runtime.mjs               ← 浏览器运行时（mock req/res，调用共用 handle）
├── site-selfcheck.mjs           ← 站点一键自检（浏览器控制台 import 即用，见 §3.2）
├── _headers                     ← .mjs 的 JavaScript MIME + no-store 等响应头
└── src/
    ├── domain.mjs               ← 规则 / 权重 / 状态机 / 脱敏（与 src/ 逐字节一致）
    ├── store.mjs                ← 内存账本 / 事件 / Merkle 演示
    ├── server.mjs               ← 编排与 16 个接口（与 src/ 逐字节一致）
    └── hash.mjs                 ← 零依赖 SHA-256
```

`_headers` 必须保留：部分托管环境会把 `.mjs` 返回成 `application/octet-stream`，浏览器会因严格 MIME 检查拒绝加载 ESM。

---

## 3. 三条部署路径（任选其一）

### 路径 A · Wrangler CLI（可脚本化，需要 API Token）

```bash
# 1) 准备凭据（不要写进任何文件、不要提交）
export CLOUDFLARE_API_TOKEN="<具备 Pages 编辑权限的 token>"
export CLOUDFLARE_ACCOUNT_ID="<账户 ID>"

# 2) 生成产物
node tools/build-cloudflare.mjs

# 3) 首次创建项目并部署
npx wrangler pages deploy cloudflare --project-name=sambon-web --branch=main

# 4) 后续更新（同一项目、链接不变）
npx wrangler pages deploy cloudflare --project-name=sambon-web --branch=main
```

Token 获取：Cloudflare Dashboard → My Profile → API Tokens → 「Create Custom Token」→ 权限 `Account · Cloudflare Pages · Edit`（或直接用「Edit Cloudflare Workers」模板）；Account ID 在 Dashboard 右侧栏。

### 路径 B · Dashboard 直接上传（无需 token，最快）

1. `node tools/build-cloudflare.mjs`
2. 把 `cloudflare/` 目录整体压缩或直接拖拽到 **Cloudflare Dashboard → Workers & Pages → Create → Pages → Upload assets**
3. 项目名填 `sambon-web`，上传目录选 `cloudflare/`，**构建命令留空、输出目录留空**（上传的就是产物本身）
4. 部署完成得到 `https://sambon-web.pages.dev`

### 路径 C · Git 集成（连 GitHub，后续 push 自动部署）

在 Cloudflare Dashboard → Create → Pages → **Connect to Git**，选择 `wangjia0910/sambon`：

| 配置项               | 值                              |
| ----------------- | ------------------------------ |
| Production branch | `main`                         |
| Build command     | **留空**（`cloudflare/` 产物已提交进仓库） |
| Output directory  | `cloudflare`                   |
| Root directory    | `/`                            |

若不想把产物提交进仓库，可把 Build command 设为 `node tools/build-cloudflare.mjs`，Output directory 仍是 `cloudflare`；此时需把 `cloudflare/` 加入 `.gitignore`。**两种只能选一种**，否则会出现「构建前产物被清空、构建后又重新生成」的重复。

**构建命令兜底（2026-11-12 加固）**：仓库根新增 `package.json`（`private: true`、**零 dependencies**、`scripts.build = node tools/build-cloudflare.mjs`）。即使 Cloudflare 预填了 `npm run build` 或 `npm install && npm run build`，也不会因缺 `package.json` / 缺脚本而失败，产物会被重新生成到 `cloudflare/`。构建命令留空时该文件不参与，仍直接使用已提交的产物。**Output directory 仍必须填 `cloudflare`**，兜底解决不了目录填错。

### 3.1 部署状态核验（Git 集成已连接后）

| 看哪里                                    | 成功标志                                                                                | 失败信号                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Workers & Pages → 项目 → **Deployments** | 最新一条 `Success`、分支 `main`、commit 与 `git rev-parse HEAD` 一致                           | `Failed` / `Build failed` / 长时间卡在 `Building`                                 |
| 构建日志                                   | 无 `npm ERR!`；若跑了构建，出现「共 8 个文件」                                                      | `Missing script: "build"`、`ENOENT package.json`、`Output directory not found` |
| Deployment 详情 → Assets                 | 8 个文件：`index.html`、`cf-runtime.mjs`、`site-selfcheck.mjs`、`_headers`、`src/*.mjs` × 4 | 缺 `_headers` 或 `src/`，或出现旧命理页的 `assets/`、`kepu.html`                         |
| 项目 → **Custom domains**                | `sambon.net` 状态 `Active`（证书已签发）                                                     | `Pending`，或提示域名已被其他项目占用                                                      |

**四类常见失败与处置**

| 症状                                                   | 根因                                | 修复                                                                   |
| ---------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------- |
| 日志 `npm ERR! Missing script` / `ENOENT package.json` | 预填构建命令但当时没有 build 脚本              | 已由根 `package.json` 兜底；或把 Build command **清空**                        |
| 构建成功但打开是 404 / 白屏，浏览器里 `/api/*` 报错                   | Output directory 填成 `web/` 或留空    | 改成 `cloudflare`，保存后 Retry deployment                                 |
| 打开是旧命理页（八字六爻 / 神算子）                                  | 绑错分支，或 `sambon.net` 仍指向旧 Pages 项目 | Production branch 改 `main`；到旧项目 Custom domains 解绑 `sambon.net` 后重新绑定 |
| 控制台 ESM MIME 报错（`Failed to load module script`）      | `_headers` 未随产物上传或不在产物根目录         | 确认 8 个文件齐全、`_headers` 位于上传目录根部                                       |

> 每次 `git push origin main` 会自动触发一次新部署，**不需要在控制台手动 Retry**；若确需重试，先在 Build settings 核对 Production branch / Build command / Output directory / Root directory 四项再点 Retry。  
> 站点最终验收必须在浏览器里做（§5 B-1～B-8）。从公司网络用 `curl` 测 `*.pages.dev` / `sambon.net` 可能被 DNS 或代理拦截，**不能据此判定部署失败**。

### 3.2 真实上线 · 用户侧三步（主代理无法代做）

> **本机硬阻塞（2026-11-12 实测）**：无 `CLOUDFLARE_API_TOKEN` / Account ID，可用连接器里也没有 Cloudflare；公司网络对 `api.cloudflare.com`、`*.pages.dev`、`sambon.net` 的直连与代理均返回 `000`（`github.com` 与 `git ls-remote` 正常）。因此 Cloudflare **账号内的点击、证书签发只能由你在控制台完成**；代码侧已全部就绪并推送，无需再改。

| 步骤         | 位置                                         | 操作                                                               | 完成标志                                       |
| ---------- | ------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------ |
| **1 确认部署** | Workers & Pages → 项目 → **Deployments**     | 看最新一条；若 `Failed`，按 §3.1 四类失败处置                                   | `Success`、分支 `main`、commit 与最新一次 push 一致   |
| **2 绑定域名** | 项目 → **Custom domains** → Add              | 添加 `sambon.net` 与 `www.sambon.net`；提示被占用则先到旧命理 Pages 项目解绑（详见 §4） | 状态 `Active`、证书已签发；Zone 开启 Always Use HTTPS |
| **3 一键验收** | 打开 `https://sambon.net` → DevTools Console | 执行下方命令                                                           | 输出 `PASS 10 / FAIL 0`                      |

**一键验收命令**（也可先在 `<project>.pages.dev` 上跑）：

```js
const r = await import('/site-selfcheck.mjs').then(m => m.run()); console.log(r);
```

脚本随产物部署在 `cloudflare/site-selfcheck.mjs`，10 项覆盖：页面演示声明与运行时引导层、`/api/config` 权重版本与降级标记、8 个红线路径 404、端到端闭环到 `SETTLED`、结算 200/10/4/204、账本守恒、事件回放 ⊆ 契约 §4、成果 PII 脱敏、个性化开关服务端强制中性排序、重复 `event_id` 幂等。本地已用浏览器式运行时验证 `node tests/verify-site-selfcheck.mjs`（7/7，脚本本身 10/10）。把控制台输出或 `r.results` 发我即可判定成败，不用截图。

**站点可达 ≠ 平台正式运营**：当前仍是 **L0 演示预览**（内存存储、刷新归零、虚构数据、无账号与资金）。要对外称「正式上线 / 开放注册」，须先完成 `docs/07` 九组清单（当前 **0/29**）与 **V1–V8**。**地域口径（2026-11-12，契约 §11 D-12）**：服务**面向海外（中国境外）**、Cloudflare 全球边缘部署，算法规定 §2 / 区块链规定 §2 适用范围均为「在中华人民共和国境内」，故**算法推荐服务备案、区块链信息服务备案、ICP 备案与境内安全评估报告不作为境外版上线闸门**；原 D-11 / V2-a / V2-b 与 `docs/10` 归档为境内市场触发式预案，仅在 `docs/11` §1.3 复评条件命中时恢复。境外版 V2 改判为 **V2-O 境外发布合规基线六组**（地域界定与协议、隐私与 Cookie、跨境传输、自动化决策与算法透明度、SBC 非资产与支付税务、未成年人与内容治理，见 `docs/07` §2 / `docs/11`），仍为 G6 一票否决项。**「无需境内备案」不等于「无合规义务」，也不等于静态演示站点自动具备生产可用性**：L1/L2 仍须完成 `docs/08` §4 的 P0 改造与持久化后端。G1–G7 闸门与回滚触发线见 `docs/08`。
>
> **D-14 补注（2026-11-13）**：本页描述的「纯静态 / 内存存储 / L0 演示预览」仅适用于 `/index.html`、`/demo.html` 的 L0 通道；站点主入口 `/` 已由 `_redirects` 指向 Pages Functions + D1 的**V3 完全体生产台**（`docs/12`、`docs/13`）。生产台具备持久化、账号、通知、定时任务、运维与灾备能力，但**仍属生产系统演示环境**：D1 绑定与 20 项外部闸门未核销前，`docs/07` 0/29、L1/L2 No-Go 不变。
>
> **D-14 补注（2026-11-13）**：本页描述的「纯静态 / 内存存储 / L0 演示预览」仅适用于 `/index.html`、`/demo.html` 的 L0 通道；站点主入口 `/` 已由 `_redirects` 指向 Pages Functions + D1 的**V3 完全体生产台**（`docs/12`、`docs/13`）。生产台具备持久化、账号、通知、定时任务、运维与灾备能力，但**仍属生产系统演示环境**：D1 绑定与 20 项外部闸门未核销前，`docs/07` 0/29、L1/L2 No-Go 不变。

---

## 4. 绑定自定义域 `sambon.net`

1. Cloudflare 先把 `sambon.net` 接入为 Zone（改 NS 到 Cloudflare 分配的两台）。
2. Pages 项目 → **Custom domains** → Add `sambon.net` 与 `www.sambon.net`；Cloudflare 自动签发 HTTPS 证书。
3. DNS 由 Cloudflare 自动写入 CNAME 指向 `<project>.pages.dev`，不要手工再建 A 记录。
4. 生效后验证 `https://sambon.net` 与证书状态；HTTP→HTTPS 在 Zone 的「Always Use HTTPS」开启。

> 若该域名此前绑定过旧命理项目，绑定前先确认旧 Pages 项目已解绑或删除，避免同名域冲突。

---

## 5. 部署后验收（**必须在浏览器里测，不能用 curl 测 `/api/*`**）

静态版的 `/api/*` 请求被浏览器引导层拦截并在页面内计算，**不会到达 Cloudflare 边缘**；用 `curl https://<站点>/api/config` 得到 404 是预期行为，不代表故障。


| #   | 检查                                                                                | 期望                                                                            |
| --- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| B-1 | 打开站点                                                                              | 显示「三宝殿 · 初版闭环操作台（演示）」，控制台无 ESM MIME 报错                                        |
| B-2 | 页面初始化自动请求 `/api/config`                                                           | 配置面板显示 `weight_version=v1.0`、算法 `degraded=true`、个性化开关可见                       |
| B-3 | 发布 → 审核 → 推送 → 接单 → 提交 → 验收                                                       | 到达 `SETTLED`；赏金 200 → 服务费 10 → 质量奖励 4 → 入账 204                                |
| B-4 | 账本与事件                                                                             | `balance_check.balanced=true`；按 `task_id` 回放 18 条事件、14 种类型，全部 ⊆ 契约 §4         |
| B-5 | 成果正文填手机号 / 证件号                                                                    | 预览为 `[已脱敏]`，无 ≥6 位连续数字残留                                                      |
| B-6 | 浏览器控制台执行 `fetch('/api/sbc/transfer',{method:'POST',body:'{}'}).then(r=>r.status)` | `404`（红线接口不存在）                                                                |
| B-7 | 关闭个性化推荐后再次推送                                                                      | 中性排序（`mode=neutral`、分数为 `null`），`/api/config` 可见 `personalized_enabled=false` |
| B-8 | 刷新页面                                                                              | 数据回到初始状态（内存存储，符合演示口径）                                                         |

本地等价验证（无需 Cloudflare）：`node tests/verify-cloudflare.mjs`，14 项断言覆盖 B-2～B-7。

---

## 6. 本地复跑与重建

```bash
cd E:/SKILLS/sambon

node tools/build-cloudflare.mjs          # 重建 cloudflare/ 产物
node tests/verify-cloudflare.mjs         # 静态版跨实现一致性（PASS 14 / FAIL 0）
node tests/smoke.mjs                     # 研发自检 20/20
node tests/verify-local.mjs              # 独立验证 32/32
node tests/predeploy-check.mjs           # 上线准入门禁
node src/server.mjs                      # 本地 Node 版，http://127.0.0.1:8787
```

**产物一致性铁律**：`cloudflare/src/*.mjs` 必须与 `src/*.mjs` 逐字节相同（`verify-cloudflare.mjs` CF-02 用 SHA-256 强制校验）。要改业务逻辑，改 `src/`，然后重建；**不要直接改 `cloudflare/` 里的副本**。

---

## 7. 回滚 / 下线

- **回滚**：Cloudflare Pages 每次部署生成一个 deployment，在项目 → Deployments 里对上一个成功版本点 **Rollback**，即时生效；本地对应操作是 `git revert` 后重建产物再部署。
- **下线**：Pages 项目可暂停 / 删除；自定义域解绑后 `sambon.net` 不再指向该站点。
- **同时保留的说明**：本轮之前发布的 WorkBuddy L0 演示链接与本 Cloudflare 站点是**两个独立应用**；是否下线旧链接由你决定，下线会使已分享的链接失效。

---

## 8. 边界与红线

1. 静态 Web 版**没有后端**：所有「接口」都在浏览器内计算，不产生服务器日志、不落库、不跨用户共享数据；这适合演示，**不能接真实用户与资金**。
2. 仍不接真实支付 / 大模型 / 公链 / 消息通道；不采集真实 PII；结算与争议保留人工兜底；模型不直判。
3. V1–V8 一票否决清单仍为「未上线、不触发」，法务维持「有条件通过」；**Cloudflare 部署属于 L0 演示预览，不构成发布或上线运营**。
4. 不得把 `https://sambon.net` 或 `*.pages.dev` 表述为「平台已上线 / 已开放注册」；对外只能说「项目原型在线演示」。
5. 不得在静态版里加入 SBC 转让、交易、兑付、收益类入口或文案；`SBC` 始终为平台内贡献积分凭证。
6. 后续若要进入 L1 灰度，仍需按 `docs/08` §4 完成 12 项 P0 改造（持久化、账号级开关、真实时钟、支付托管、消息通道等）并让 G1–G7 / V1–V8 全部通过 —— **换部署平台不能绕过 G6**。

---

## 9. 交付物索引

| 用途             | 文件                            |
| -------------- | ----------------------------- |
| 本指导            | `docs/09-Cloudflare部署指导.md`   |
| 上线分层与 L1/L2 阻断 | `docs/08-上线部署指导.md`           |
| 上线检查清单         | `docs/07-上线检查清单.md`           |
| 产物构建脚本         | `tools/build-cloudflare.mjs`  |
| 浏览器运行时（源）      | `tools/cf-runtime.mjs`        |
| 产物目录           | `cloudflare/`                 |
| 静态版独立验证        | `tests/verify-cloudflare.mjs` |
| 零依赖 SHA-256    | `src/hash.mjs`                |
| 产品形态裁决         | `CONTRACT.md` §11 D-10        |
