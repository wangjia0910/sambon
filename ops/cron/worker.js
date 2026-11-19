// E-04 外部定时任务调度器配置（Cloudflare Worker 方案，备选）
// 用途：用 Cloudflare Workers 的 Cron Triggers 每 15 分钟调用一次 /api/admin/cron。
// 与 docs/13 §6 一致：Pages Functions 不支持 scheduled handler，故用「HTTP 触发 + 外部调度器」。
//
// 部署步骤：
//   1. 新建 Worker，把本文件作为入口（默认 export default）。
//   2. wrangler.toml 增加：
//        name = "sambon-cron"
//        [[triggers]]
//        crons = ["*/15 * * * *"]
//   3. 在 Worker 的 Variables/Secrets 里设置 CRON_SECRET（与 Pages 环境变量一致）。
//   4. 部署：wrangler deploy
//   5. 连续 7 天运行无误后，把 Workers 日志/Analytics 截图作为 E-04 的 evidence。

export default {
  async scheduled(event, env, ctx) {
    const url = 'https://sambon.net/api/admin/cron';
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cron-Secret': env.CRON_SECRET || '',
        },
        body: JSON.stringify({ dry_run: false }),
      });
      const text = await res.text();
      console.log(`[sambon-cron] status=${res.status} body=${text.slice(0, 200)}`);
      return new Response(text, { status: res.status });
    } catch (e) {
      console.error('[sambon-cron] failed', e);
      return new Response('cron failed: ' + e.message, { status: 500 });
    }
  },
};
