# 三宝殿 · 八字六爻神算子

纯静态 Web 项目，融合**八字推演**与**六爻起卦**，并以「神算子」人设，通过命盘与卦象与客户攀谈，逐步揭示其心中所悬之事。

> 域名：`sambon.net`
> 定位：中国传统民俗文化（八字 / 六爻）的了解与休闲娱乐工具。

---

## 功能

1. **八字推演**：根据公历生辰排出四柱（年/月/日/时干支），给出五行分布、日主强弱、喜用神、十神格局、大运走势，并附详实解读。
2. **六爻起卦**：随机成卦，得到六十四卦之一，含卦名、上下卦五行、卦辞；偶有动爻则给出变卦。
3. **神算子攀谈**（核心特色）：神算子先观八字、再卜一卦，略陈观感，随后依据命局十神、五行、卦象**推断客户心事领域**，经两轮引导追问，最终归纳输出
   **「客官此来三宝殿，心中所悬者，归根结底乃是：XXX 之困。」** 并附一段八字＋卦象的详实解读。
4. **基础科普**：八字与六爻的原理说明（四柱、干支、五行、十神、大运；八卦、六十四卦、动爻变卦）。

---

## 技术

- 纯静态站点：**HTML + CSS + 原生 JS**，无构建步骤、无后端、无第三方依赖。
- 算法模块以 UMD 封装，浏览器与 Node 双端可用（便于测试）：
  - `assets/js/bazi.js` —— 八字核心（四柱 / 十神 / 五行 / 日主强弱 / 大运 / 解读）
  - `assets/js/liuyao.js` —— 六爻核心（随机成卦 / 64 卦名 / 卦辞 / 动爻变卦）
  - `assets/js/shensuan.js` —— 神算子攀谈引擎（领域打分 / 细化追问 / 归纳结论）
  - `assets/js/app.js` —— 交互编排
- 已用 Node 对核心算法与端到端交互做验证（四柱、十神、大运、卦名映射、攀谈链路均通过）。

---

## 本地运行

直接用浏览器打开 `index.html` 即可；或起一个静态服务器：

```bash
cd sambon
python -m http.server 8080      # 然后访问 http://localhost:8080
# 或： npx serve
```

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
