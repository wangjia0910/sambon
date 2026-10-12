# 三宝殿 · 八字六爻神算子
## Hall of the Three Treasures · BaZi · LiuYao · Oracle

> 域名：`sambon.net`
> 定位：以「**天 · 地 · 人**」为三宝、以「**天人合一**」为基本原理的中国传统民俗文化休闲工具（八字推演 / 六爻起卦 / 神算子攀谈）。
> A folklore &amp; culture tool built on the **Three Treasures — Heaven, Earth, Human** — and the principle of **“Heaven-and-Human as One.”**

---

## 理念 · Philosophy

三宝者，**天、地、人**也。本站三殿正对应三才：

| 殿 Hall | 三才 | 所指 |
|---|---|---|
| 八字殿 · Hall of BaZi | **天** Heaven | 出生那一刻的干支节律（天时） |
| 六爻殿 · Hall of LiuYao | **地** Earth | 阴阳爻变之卦（地理 / 事态流转） |
| 神算子殿 · Hall of the Oracle | **人** Human | 来客心中的疑问（人这一才） |

三才相参，即是「**天人合一**」：借天之时、地之象，去体贴人之问。

---

## 功能 · Features

1. **八字推演（天）**：按公历生辰排四柱，输出五行分布、日主强弱、喜用神、十神逐柱、大运详批、同八字人数估算、八字指纹、人生五段推论。
2. **六爻起卦（地）**：随机成卦，得六十四卦之一，含卦名、上下卦五行、卦辞、动爻变卦与白话解卦。
3. **神算子攀谈（人）**：神算子先观八字、再卜一卦，循循善诱，归纳出「心中所悬之事」，并给出「神算子点拨」与「传统五步推演」（见下）。
4. **基础科普（`kepu.html`）**：中英双语、通俗讲解八字与六爻，并阐明三宝与天人合一的基本原理，含客观定位与免责声明。该页文件仍保留在仓库中，当前站点未设入口。

> **国际化（i18n）**：全站中/英一键切换（顶栏 `EN / 中文`，记忆于 localStorage）。八字排盘、六爻解卦、神算子攀谈与点拨的所有生成结果均按界面语言输出——英文模式使用拼音/生肖/五行/十神通行译名（Jia Zi、Wood、Direct Officer…），不夹杂中文。

---

## 内嵌神算模型 · Embedded Oracle（核心特色）

**摒弃任何外部大模型 API。** 神算解惑由内嵌于本站的模型 `assets/js/oracle.js` 生成，并会**依据用户互动自动进化**——越聊，越懂你。

**它怎么进化（How it evolves）：**
- **多臂老虎机（措辞/计策选择）**：每段指引（共情 / 症结 / 时机 / 现实之计 / 收束）都有多个变体，按你的 👍 / 👎 更新各变体“命中率”，越受共鸣的说法越常被选中。
- **关键词 → 心事域学习**：从自由描述里抽取“心事词”，建立 词→心事域 权重，越问越懂你所忧。
- **复访关注追踪**：同一心事反复出现，权重自然抬升（未说出口的牵挂也被记下）。
- **语气倾向**：暖言 / 直断两系措辞，按共鸣自动靠拢。

**互动即教学（Interaction = training）：**
- 「神算子点拨」下方提供 **👍 有共鸣 / 👎 不太对 / 换一种说法** 三个按钮；
- 选择心事域、自由描述、复访等**隐式互动**同样会喂给模型；
- 学习状态保存在浏览器本地，支持**导出 / 导入 / 重置**（JSON），可随身携带或归零重来。

---

## 国际化 · Internationalization (i18n)

全站支持**中 / 英一键切换**（顶栏 `EN / 中文`，或科普页右上角）。切换通过给 `<html>` 加 `lang-en` 类、配合 `.zh / .en` 元素显隐实现；语言选择存 `localStorage`。神算点拨也会按当前界面语言输出中文或英文。

---

## 技术 · Tech

纯静态站点：**HTML + CSS + 原生 JS**，无构建、无后端、无第三方依赖。

算法 / 引擎模块（UMD，浏览器挂全局、Node 可 `require` 测试）：
- `assets/js/bazi.js` —— 八字核心（四柱 / 十神 / 五行 / 强弱 / 大运 / 解读 / 同八字人数 / 指纹 / 人生推论 / 大运详批）
- `assets/js/liuyao.js` —— 六爻核心（随机成卦 / 64 卦 / 卦辞 / 动爻变卦 / 白话解卦）
- `assets/js/shensuan.js` —— 神算子攀谈引擎（领域打分 / 追问 / 归纳 / 白话解卦 / 五步方案）
- `assets/js/oracle.js` —— **内嵌自进化神算模型**（多臂老虎机 + 关键词/复访学习 + 反馈闭环；导出/导入/重置）
- `assets/js/app.js` —— 交互编排（`data-action` 事件委托、中英切换）

交互全部走 `app.js` 的 `data-action` 事件委托，HTML 无内联 `onclick`。核心算法与端到端交互已用 Node 验证通过。

---

## 本地运行 · Run Locally

直接用浏览器打开 `index.html`，或起静态服务器：

```bash
cd sambon
python -m http.server 8080      # 访问 http://localhost:8080
# 或： npx serve
```

---

## 推送到 GitHub · Push to GitHub

仓库已建于 **https://github.com/wangjia0910/sambon**（公开）。后续推送：

```bash
git remote add origin https://github.com/<你的用户名>/sambon.git   # 已配置则为 wangjia0910/sambon
git add -A && git commit -m "your message"
git push -u origin main
```

> HTTPS 推送需用个人访问令牌（PAT，勾选 repo 权限）作为密码，或配置 SSH key。

---

## 部署到 Cloudflare Pages · Deploy

本站为**纯静态**（无 `functions/` 后端），部署极简。

### 方式 A（推荐）：连接 GitHub 自动部署
1. Cloudflare Dashboard → **Workers &amp; Pages** → **Create** → **Pages** → **Connect to Git**，授权并选中 `sambon`。
2. 构建设置：Framework preset **None**；Build command **留空**；Output directory **`/`**；Production branch **`main`**。
3. **Save and Deploy** → 得到 `https://sambon.pages.dev`。
4. 绑定 `sambon.net`：项目 → **Custom domains** → 添加，按提示把域名 DNS 托管到 Cloudflare。

此后每次 `git push` 到 `main`，Cloudflare 自动重新部署。

### 方式 B：CLI 直接上传
```bash
npm i -g wrangler
npx wrangler pages deploy . --project-name sambon --branch main
```

---

## 免责声明 · Disclaimer

本站所有内容均属**中国传统民俗文化与哲学**，是古人以「阴阳五行、干支、八卦」推演人生的民间实践，**无任何科学依据**，不可用于健康、财务、人生等重大决策。神算子攀谈及其点拨为娱乐化的人机互动，其“结论”由预设规则与本地学习机制生成。请仅作文化了解与休闲娱乐，理性看待。
