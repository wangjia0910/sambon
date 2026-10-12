# 三宝殿 · 八字六爻神算子

纯静态 Web 项目，融合**八字推演**与**六爻起卦**，并以「神算子」人设，通过命盘与卦象与客户攀谈，逐步揭示其心中所悬之事。

> 域名：`sambon.net`
> 定位：中国传统民俗文化（八字 / 六爻）的了解与休闲娱乐工具。

---

## 功能

1. **八字推演**：根据公历生辰排出四柱（年/月/日/时干支），给出五行分布、日主强弱、喜用神、十神格局（逐柱释义）、大运走势，并附**分章节详实解读**。
   - 新增 **【同八字之众】**：按 518,400 种合法八字组合，估算全球/中国同八字人数（约 1.5 万人 / 约 2700 人）。
   - 新增 **八字指纹**：以四柱串（如 `庚午·辛巳·乙酉·辛巳`）作为"命纹指纹"，为**后期关联同八字用户 / 同八字社群**预留匹配键。
   - 新增 **【七 · 人生推论】**：基于日主五行、十神与强弱，自动给出 **性格 / 命运总论 / 事业 / 财运 / 感情人际** 五段推论总结。
   - 新增 **【八 · 大运详批】**：将八步大运逐运解析，每运给出干支五行、干支十神、〔喜〕/〔忌〕判定，并结合日主强弱给出"当把握 / 宜守成"之详析。
2. **六爻起卦**：随机成卦，得到六十四卦之一，含卦名、上下卦五行、卦辞；偶有动爻则给出变卦。**展示区附"白话解卦"**，把卦象翻成大白话。
3. **神算子攀谈**（核心特色，需登录后使用）：神算子先观八字、再卜一卦，略陈观感（含**白话解卦**），随后依据命局十神、五行、卦象**推断客户心事领域**，经两轮引导追问，最终归纳输出
   **「客官此来三宝殿，心中所悬者，归根结底乃是：XXX 之困。」**；
   - 升级：**结合八字（强弱 / 喜用 / 十神）+ 大运（逐运喜忌）+ 卦象（白话解卦）**，输出 **「神算子解惑方案」五步法**——① 现状参断 ② 时机·大运（标注喜用大运年龄窗口）③ 趋避之法（按喜用五行给方位 / 行业 / 行为指引）④ 卦象印证 ⑤ 神算子一言，真正帮客户解惑。
   - **大模型解惑（神算子点睛）**：若用户在「⚙ 大模型」中配置了自己的 API 端点 / 密钥 / 模型，神算子会将上述**全部信息（八字命盘、十神、人生推论、逐运大运、六爻卦象与白话解卦、客户所问之事）**打包成提示词，调用大模型（OpenAI 兼容 Chat Completions 接口）实时生成**「神算子大模型解惑」**——以神算子人设给出**贴合现实、可落地**的指引，而非固定套话。未配置时自动降级到本地五步方案，不影响使用。
4. **基础科普（独立页面 `kepu.html`）**：用通俗语言详实讲解八字（天干地支 / 排盘 / 五行生克 / 十神 / 日主强弱喜用 / 大运流年 / 同八字人数）与六爻（起卦 / 动爻变卦 / 卦辞白话），含客观定位与免责声明。

---

## 技术

- 纯静态站点：**HTML + CSS + 原生 JS**，无构建步骤、无后端、无第三方依赖。
- 算法模块以 UMD 封装，浏览器与 Node 双端可用（便于测试）：
  - `assets/js/bazi.js` —— 八字核心（四柱 / 十神 / 五行 / 日主强弱 / 大运 / 解读 / 同八字人数 / 八字指纹 / 人生推论 / 大运详批）
  - `assets/js/liuyao.js` —— 六爻核心（随机成卦 / 64 卦名 / 卦辞 / 动爻变卦 / 白话解卦）
  - `assets/js/shensuan.js` —— 神算子攀谈引擎（领域打分 / 细化追问 / 归纳结论 / 白话解卦 / 五步解惑方案）
  - `assets/js/ai.js` —— 大模型解惑模块（汇总命盘/卦象/问题为提示词，调用 OpenAI 兼容接口；支持 JSON 与 SSE 流式解析；未配置/失败自动降级）
  - `assets/js/auth.js` —— 登录系统（本地演示版：注册 / 登录 / 退出 / 八字档案）
  - `assets/js/app.js` —— 交互编排（含登录闸门）
- 已用 Node 对核心算法与端到端交互做验证（四柱、十神、大运、卦名映射、同八字人数、白话解卦、登录闸门、攀谈链路均通过）。
- **关于登录的安全性**：`auth.js` 为**纯前端演示**，账号与八字档案仅存于浏览器 `localStorage`，密码仅做轻量编码，**不具备任何真实安全性**。生产环境请改用 **Cloudflare Access（零信任）** 或 **Cloudflare Workers + KV** 做真实验证，并可在后端按"八字指纹"聚合同八字用户。

---

## 本地运行

直接用浏览器打开 `index.html` 即可；或起一个静态服务器：

```bash
cd sambon
python -m http.server 8080      # 然后访问 http://localhost:8080
# 或： npx serve
```

---

## 配置大模型（神算子实时解惑）

神算子的大模型解惑由你自己的 API 驱动。两种方式：

### 方式 1：浏览器端直接配置（演示用）
1. 点击页面右上角 **「⚙ 大模型」**，填入：
   - **API 端点**：任意 OpenAI 兼容的 Chat Completions 地址，例如 `https://api.openai.com/v1/chat/completions`、DeepSeek `https://api.deepseek.com/v1/chat/completions`、或你自建网关。
   - **API 密钥**：`Bearer` 令牌。
   - **模型名**：如 `gpt-4o-mini` / `deepseek-chat`。
2. 保存后，神算子结论区会出现「神算子大模型解惑（实时生成）」块，结合你这一局的八字、卦象与所问之事实时作答。
3. 配置仅存于**本机浏览器 `localStorage`**，不会上传到本站任何服务器。

> ⚠️ 浏览器端持有密钥属于演示用法，密钥会出现在前端请求中，**切勿用于生产或暴露给他人**。

### 方式 2：Cloudflare Worker 代理（生产推荐，密钥不落前端）
把密钥放在 Worker 后端，`ai.js` 的端点指向 Worker。示例 Worker（`wrangler.toml` + `src/index.js`）：

```js
// src/index.js —— Cloudflare Worker，替前端持有 API 密钥
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/v1/chat/completions') {
      const upstream = 'https://api.openai.com/v1/chat/completions'; // 或 deepseek 等
      const auth = 'Bearer ' + env.AI_API_KEY;                        // 在 Workers 变量/密钥中配置
      const body = await request.text();                              // 透传模型与 messages
      const r = await fetch(upstream, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': auth },
        body
      });
      return new Response(await r.text(), {
        status: r.status,
        headers: { 'Content-Type': r.headers.get('Content-Type') || 'application/json',
                   'Access-Control-Allow-Origin': '*' }
      });
    }
    return new Response('Not found', { status: 404 });
  }
}
```

配套 `wrangler.toml`：

```toml
name = "sambon-ai-proxy"
main = "src/index.js"
compatibility_date = "2024-09-23"
[vars]
# 密钥请用：wrangler secret put AI_API_KEY
```

然后在前端「⚙ 大模型」把端点填成 `https://<你的worker子域>.workers.dev/v1/chat/completions`，密钥留空即可——密钥只在 Worker 侧，前端完全不接触。

> 兼容说明：`ai.js` 按 OpenAI Chat Completions 格式发送 `{ model, messages, temperature }`，并兼容非流式（JSON）与流式（`text/event-stream` SSE）两种返回；只要是同一格式的服务（OpenAI / DeepSeek / 本地 Ollama 的 `/v1/chat/completions` / 各类网关）都能直接用。

---

## 推送到 GitHub

```bash
cd sambon
git init
git add -A
git commit -m "initial: 三宝殿 八字六爻神算子"

# 在 github.com 新建仓库（建议名 sambon），拿到仓库地址后：
git remote add origin https://github.com/<你的用户名>/sambon.git
git branch -M main
git push -u origin main
```

> 推送需要 GitHub 账号与凭证：HTTPS 方式请用**个人访问令牌（PAT，classic 或 fine-grained，勾选 repo 权限）**作为密码；或配置 SSH key。

---

## 部署到 Cloudflare Pages

### 方式 A（推荐）：连接 GitHub 自动部署

1. 登录 Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → 选择 **Connect to Git**，授权并选中 `sambon` 仓库。
2. 构建设置：
   - Framework preset：**None**
   - Build command：**留空**
   - Output directory：**`/`（项目根即站点根）**
3. 点击 **Save and Deploy**，完成后获得形如 `https://sambon.pages.dev` 的地址。
4. **绑定自定义域名 `sambon.net`**：Pages 项目 → **Custom domains** → 添加 `sambon.net`，按提示在域名 DNS 处添加 CNAME 指向你的 `*.pages.dev`（若域名 DNS 也托管在 Cloudflare，可直接一键添加并启用代理）。

此后每次 `git push` 到 GitHub，Cloudflare 会自动重新部署。

### 方式 B：CLI 直接上传（需 Cloudflare 凭证）

```bash
# 需先安装并登录 wrangler：npm i -g wrangler 然后 wrangler login
# 或设置环境变量 CLOUDFLARE_API_TOKEN（含 Pages 编辑权限）
npx wrangler pages deploy . --project-name sambon
```

---

## 免责声明

本站所有内容均属**中国传统民俗文化与哲学**范畴，是古人用「阴阳五行、干支、八卦」这一套古代宇宙观去推演人生的民间实践。**它没有任何科学依据**，不可用于健康、财务、人生等重大决策。请仅作文化了解与休闲娱乐，理性看待。
