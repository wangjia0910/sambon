/*
 * ai.js — 神算子大模型解惑模块（三宝殿）
 * 把八字命盘 + 六爻卦象 + 大运 + 客户问题 的全部结构化信息，
 * 以"神算子"人设打包成提示词，调用 OpenAI 兼容的 Chat Completions 接口，
 * 让大模型产出"现实的、可落地"的神算解惑。
 *
 * 设计要点：
 *  - 纯前端调用，配置（endpoint / apiKey / model）存于 localStorage，由用户自己填。
 *  - 未配置或调用失败时抛 NOT_CONFIGURED / 错误信息，由 app.js 降级到本地五步方案。
 *  - 生产部署建议把密钥放在后端（如 Cloudflare Worker 代理），勿把密钥硬编码进仓库。
 * UMD：浏览器挂 window.AI；Node 可 require（测试用，内部 fetch/localStorage 仅在运行时使用）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AI = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CFG_KEY = 'sambon_ai_cfg';

  function loadCfg() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveCfg(cfg) {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {}
  }
  function isConfigured() {
    var c = loadCfg();
    return !!(c.endpoint && c.apiKey && c.model);
  }
  function configure(part) {
    var c = loadCfg();
    for (var k in part) if (part.hasOwnProperty(k)) c[k] = part[k];
    saveCfg(c);
    return c;
  }

  // ---- 把命盘/卦象/问题汇总成结构化上下文 ----
  function buildContext(bz, gua, problem) {
    var s = bz.strength;
    var strong = s.score >= 60 ? '偏强而能任事' : (s.score <= 40 ? '偏弱而需借力' : '中和而随运转');
    var wxOrder = ['木', '火', '土', '金', '水'];
    var wxStr = wxOrder.map(function (w) { return w + bz.cnt[w]; }).join(' ');
    var missing = wxOrder.filter(function (w) { return bz.cnt[w] === 0; });
    var organOf = { 木: '肝胆', 火: '心与小肠', 土: '脾胃', 金: '肺与大肠', 水: '肾与膀胱' };
    var missStr = missing.length
      ? ('五行缺 ' + missing.join('、') + '（主 ' + missing.map(function (w) { return organOf[w]; }).join('、') + ' 之气偏弱）')
      : '五行俱全，无显偏枯';

    // 四柱
    var pillars = [
      '年柱 ' + bz.yg.gan + bz.yg.zhi,
      '月柱 ' + bz.mg.gan + bz.mg.zhi,
      '日柱 ' + bz.dg.gan + bz.dg.zhi,
      '时柱 ' + bz.hg.gan + bz.zhis[3]
    ].join('　');

    // 十神（逐柱，来自 bz.shishen）
    var ss = bz.shishen;
    var ssLines = [
      '年柱：' + bz.yg.gan + '(' + ss.yearGan + ')　' + bz.yg.zhi + '(' + ss.yearZhi + ')',
      '月柱：' + bz.mg.gan + '(' + ss.monthGan + ')　' + bz.mg.zhi + '(' + ss.monthZhi + ')',
      '日支：' + bz.dg.zhi + '(' + ss.dayZhi + ')',
      '时柱：' + bz.hg.gan + '(' + ss.hourGan + ')　' + bz.zhis[3] + '(' + ss.hourZhi + ')'
    ].join('\n');

    var lifeText = (typeof Bazi !== 'undefined' && Bazi.lifeReadingText) ? Bazi.lifeReadingText(bz) : '';
    var dayunText = (typeof Bazi !== 'undefined' && Bazi.dayunDetailText) ? Bazi.dayunDetailText(bz) : '';
    var plain = (typeof Liuyao !== 'undefined' && Liuyao.plain) ? Liuyao.plain(gua) : '';

    return [
      '【八字命盘】',
      '四柱：' + pillars,
      '日主：' + bz.dayGan + '（' + bz.dayMaster + '），强弱指数 ' + s.score + '/100（' + strong + '）',
      '五行分布：' + wxStr,
      '偏枯：' + missStr,
      '喜用神：' + s.like.join('、'),
      '同八字指纹：' + (Bazi.fingerprint ? Bazi.fingerprint(bz) : ''),
      '',
      '【十神格局（逐柱）】',
      ssLines,
      '',
      '【人生推论（性格 · 命运 · 事业 · 财运 · 感情人际）】',
      lifeText,
      '',
      '【大运逐运（十年一运）】',
      dayunText,
      '',
      '【六爻卦象】',
      '卦名：' + gua.name + '（上' + gua.upperName + '(' + gua.upperWX + ')　下' + gua.lowerName + '(' + gua.lowerWX + ')）',
      '卦辞：' + gua.desc,
      (gua.dong >= 0 ? ('动爻：第 ' + (gua.dong + 1) + ' 爻发动 → 变卦 ' + gua.bianName) : '动爻：静卦（无动爻）'),
      '白话解卦：' + plain,
      '',
      '【客官此来所问】',
      problem
    ].join('\n');
  }

  var SYSTEM_PROMPT = [
    '你是「三宝殿」里的神算子——一位深谙八字命理与六爻卦象、阅历深厚、半文半白、温厚而清醒的民间智者。',
    '你的职责是基于客官的命盘与所问之事，给出"现实的神算解惑"：既借传统命理框架（阴阳五行、干支、十神、大运、卦象）',
    '点出问题症结，更必须落脚于现实、可操作的人生建议，而不是宿命恐吓或空泛套话。',
    '',
    '你作答时必须遵守：',
    '1) 先共情。用一两句体察客官处境，语气如长者攀谈，不端着、不说教。',
    '2) 再点症结。结合命盘关键信息（日主强弱、喜用五行、十神格局、大运喜忌、卦象白话）说清"为什么这件事会成为心结"，要点到要害，用现代人听得懂的话。',
    '3) 给出现实建议。给出 3–5 条具体、可落地的行动指引，覆盖：职业/财务/人际/心态/下一步该做什么。避免"多积德、少冲动"这类空话，要能落到近一两周就能做的事。',
    '4) 清醒收束。点明命理只是"天时之约"而非定数，真正的转机在行动；重大健康、财务、人生决定应以现实信息与专业意见为准。',
    '5) 严禁：恐吓、宣扬"改运/化煞"收费、用宿命论断言"你注定如何"、冒充医学/法律/投资建议。',
    '',
    '输出格式：用 3–6 段自然段落（可带 1–2 个小标题如"一、症结所在""二、现实之计"），半文半白、亲切、有条理，总长度约 350–550 字。'
  ].join('\n');

  function buildMessages(context) {
    return [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: '以下是这位客官的命理信息与心事，请据此给出"现实的神算解惑"：\n\n' + context + '\n\n请务必结合上述全部信息作答，不要遗漏卦象与八字的关键判断。' }
    ];
  }

  // ---- 解析响应（兼容 JSON 与非流式 SSE）----
  function extractContent(text, contentType) {
    if (contentType && contentType.indexOf('text/event-stream') >= 0) {
      var out = '';
      var lines = text.split('\n');
      for (var i = 0; i < lines.length; i++) {
        var ln = lines[i].trim();
        if (ln.indexOf('data:') === 0) {
          var d = ln.slice(5).trim();
          if (d === '[DONE]') continue;
          try {
            var j = JSON.parse(d);
            var delta = j.choices && j.choices[0] && (j.choices[0].delta ? j.choices[0].delta.content : (j.choices[0].message ? j.choices[0].message.content : ''));
            if (delta) out += delta;
          } catch (e) {}
        }
      }
      return out;
    }
    var j = JSON.parse(text);
    return j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content
      ? j.choices[0].message.content : '';
  }

  // ---- 异步调用大模型；未配置抛 NOT_CONFIGURED ----
  async function resolve(bz, gua, problem, opts) {
    opts = opts || {};
    var c = loadCfg();
    if (!isConfigured()) {
      var err = new Error('NOT_CONFIGURED');
      err.code = 'NOT_CONFIGURED';
      throw err;
    }
    var messages = buildMessages(buildContext(bz, gua, problem));
    var body = { model: c.model, messages: messages, temperature: 0.75, stream: !!opts.stream };
    if (c.maxTokens) body.max_tokens = c.maxTokens;

    var res = await fetch(c.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + c.apiKey
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      var detail = '';
      try { detail = (await res.text()).slice(0, 200); } catch (e) {}
      var e2 = new Error('接口返回 ' + res.status + (detail ? ('：' + detail) : ''));
      e2.code = 'HTTP_' + res.status;
      throw e2;
    }
    var ct = res.headers && res.headers.get ? (res.headers.get('content-type') || '') : '';
    var raw = await res.text();
    var content = extractContent(raw, ct);
    if (!content) {
      var e3 = new Error('模型返回内容为空（请检查 endpoint 是否为标准 Chat Completions 格式）');
      e3.code = 'EMPTY';
      throw e3;
    }
    return content.trim();
  }

  return {
    CFG_KEY: CFG_KEY,
    loadCfg: loadCfg,
    saveCfg: saveCfg,
    isConfigured: isConfigured,
    configure: configure,
    buildContext: buildContext,
    buildMessages: buildMessages,
    resolve: resolve
  };
});
