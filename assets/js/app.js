/* app.js — 三宝殿交互编排（依赖 Bazi / Liuyao / Shensuan / Oracle 全局）
 * 事件统一走 data-action 委托，HTML 不再内联 onclick。
 * 国际化：中/英切换（给 <html> 加 lang-en 类，配合 .zh/.en 显隐）。
 * 神算：内嵌模型 Oracle 随互动自动进化，解惑在攀谈中自然给出，无任何外部调用。
 */
(function () {
  'use strict';
  var currentBz = null, currentGua = null, shenState = {};
  var currentLang = 'zh';

  function $(id) { return document.getElementById(id); }

  // ===================== 国际化（中 / 英）=====================
  function isEn() { return currentLang === 'en'; }
  function t(zh, en) { return isEn() ? en : zh; }

  function initLang() {
    var l = 'zh';
    try { l = localStorage.getItem('sambon_lang') || 'zh'; } catch (e) {}
    setLang(l, true);
  }
  function setLang(l, noSave) {
    currentLang = (l === 'en') ? 'en' : 'zh';
    var root = document.documentElement;
    if (currentLang === 'en') root.classList.add('lang-en');
    else root.classList.remove('lang-en');
    root.lang = currentLang === 'en' ? 'en' : 'zh-CN';
    if (!noSave) { try { localStorage.setItem('sambon_lang', currentLang); } catch (e) {} }
    renderLang();
    applyLangVisibility();
  }
  // 双语显隐的 JS 层双保险：直接给 .zh/.en 设 inline display，
  // 即使 CSS 被压缩/缓存/覆盖导致 class 规则失效，也不会中英同显。
  function applyLangVisibility() {
    var en = currentLang === 'en';
    var nodes = document.querySelectorAll('.zh,.en');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var nodeIsEn = n.classList.contains('en');
      n.style.display = (nodeIsEn === en) ? '' : 'none';
    }
  }
  function renderLang() {
    var b = $('langBtn'); if (!b) return;
    b.textContent = isEn() ? '中文' : 'EN';
    b.title = isEn() ? 'Switch to Chinese / 切换中文' : 'Switch to English / 切换英文';
  }
  function langToggle() { setLang(isEn() ? 'zh' : 'en'); }

  // ===================== 八字 =====================
  function doBazi() {
    var name = $('name').value.trim();
    var sex = $('sex').value;
    var bd = $('bdate').value;
    var h = parseInt($('bhour').value, 10);
    if (!bd) { alert(t('请填写出生日期', 'Please enter your date of birth.')); return; }
    if (isNaN(h) || h < 0 || h > 23) { alert(t('小时请填 0~23', 'Hour must be 0–23.')); return; }
    var p = bd.split('-').map(Number);
    currentBz = Bazi.bazi(p[0], p[1], p[2], h, sex);
    Oracle.observe({ type: 'bazi', fingerprint: Bazi.fingerprint(currentBz) });
    var el = $('bazi-result');
    el.classList.remove('hidden');
    var L = currentLang;
    var sexW = L === 'en' ? (sex === '男' ? 'Male' : 'Female') : sex;
    var text = (name ? ('【' + name + ' · ' + sexW + '】\n') : '') + Bazi.interpret(currentBz, L);
    text += '\n\n' + (L === 'en'
      ? 'VII · Life Reading (Character · Destiny · Career · Wealth · Love & Relations)\n'
      : '【七 · 人生推论（性格 · 命运 · 事业 · 财运 · 感情人际）】\n') + Bazi.lifeReadingText(currentBz, L);
    text += '\n\n' + (L === 'en'
      ? 'VIII · Fortune Cycles (ten years each, read one by one)\n'
      : '【八 · 大运详批（十年一运，逐运解析）】\n') + Bazi.dayunDetailText(currentBz, L);
    text += '\n\n' + (L === 'en' ? 'Chart Fingerprint\n' : '【命纹指纹 · 同八字匹配串】\n') + Bazi.fingerprint(currentBz) +
      (L === 'en'
        ? '\n(This four-pillar string is your chart fingerprint — for matching fellow travelers who share your chart.)'
        : '\n（此四柱串即你的"八字指纹"。日后开启同八字社群，可凭此匹配同道中人。）');
    el.textContent = text;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ===================== 六爻 =====================
  var WX_EN_MAP = { 木: 'Wood', 火: 'Fire', 土: 'Earth', 金: 'Metal', 水: 'Water' };
  function renderGua(gua) {
    var en = currentLang === 'en';
    var yaos = '';
    gua.lines.forEach(function (v, i) {
      var cls = 'yao' + (v ? '' : ' yin') + (gua.dong === i ? ' dong' : '');
      yaos += '<div class="' + cls + '"></div>';
    });
    var gName = en ? gua.nameEn : gua.name;
    var upName = en ? gua.upperNameEn : gua.upperName;
    var loName = en ? gua.lowerNameEn : gua.lowerName;
    var upWX = en ? WX_EN_MAP[gua.upperWX] : gua.upperWX;
    var loWX = en ? WX_EN_MAP[gua.lowerWX] : gua.lowerWX;
    var bian = en ? (gua.bianNameEn || gua.bianName) : gua.bianName;
    var dongLine = en
      ? ((gua.dong >= 0)
          ? ('Moving line ' + (gua.dong + 1) + ' → changes to ' + bian)
          : 'Still hexagram (no moving line)')
      : ((gua.dong >= 0)
          ? ('动爻第' + (gua.dong + 1) + '爻 → 变卦 ' + bian)
          : '静卦（无动爻）');
    $('gua-result').classList.remove('hidden');
    $('gua-result').innerHTML =
      '<div class="gua-box">' +
        '<div class="yaos">' + yaos + '</div>' +
        '<div class="gua-meta">' +
          '<div>' + (en ? 'Hexagram: ' : '卦名：') + '<b>' + gName + '</b></div>' +
          '<div>' + (en ? ('Upper ' + upName + ' (' + upWX + ') · Lower ' + loName + ' (' + loWX + ')')
                       : ('上' + upName + '(' + upWX + ') 下' + loName + '(' + loWX + ')')) + '</div>' +
          '<div>' + dongLine + '</div>' +
          '<div style="margin-top:8px;max-width:520px">' + (en ? 'Judgment: ' : '卦辞：') + '"' + (en ? gua.descEn : gua.desc) + '"</div>' +
          '<div style="margin-top:8px;max-width:520px;color:var(--mut)">' + Liuyao.plain(gua, currentLang) + '</div>' +
        '</div>' +
      '</div>';
  }

  function doGua() {
    currentGua = Liuyao.cast();
    renderGua(currentGua);
    $('gua-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ===================== 神算子攀谈 =====================
  function startShen() {
    var box = $('shen-box');
    if (!currentBz || !currentGua) {
      box.innerHTML = '<div class="note">' + t('请先完成「八字推演」与「六爻起卦」，神算子方能起局参详。', 'Please run both the BaZi chart and cast a hexagram first.') + '</div>';
      return;
    }
    var a = Shensuan.assess(currentBz, currentGua, currentLang);
    shenState = {};
    var opts = '';
    a.domains.forEach(function (d) {
      opts += '<button class="btn-secondary btn-sm" data-action="pick-domain" data-key="' + d.key + '">' + d.label + '</button>';
    });
    opts += '<button class="btn-ghost btn-sm" data-action="free">' + t('都不是，我想直说', 'None of these — let me say it') + '</button>';
    box.innerHTML =
      '<div class="shen-box fade">' +
        '<div class="say">' + a.opening + '</div>' +
        '<div class="opts"><p class="muted">' + t('客官此来，可是为以下哪桩心事？', 'Which of these weighs on you?') + '</p>' + opts + '</div>' +
      '</div>';
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function shenPickDomain(key) {
    shenState.domain = key;
    shenState.domainLabel = Shensuan.fieldName(key, currentLang);
    Oracle.observe({ type: 'domain', label: shenState.domainLabel });
    var subs = Shensuan.refine(key, currentLang);
    var opts = '';
    subs.forEach(function (s) {
      opts += '<button class="btn-secondary btn-sm" data-action="pick-sub" data-key="' + s.key + '">' + s.label + '</button>';
    });
    $('shen-box').innerHTML +=
      '<div class="shen-box fade">' +
        '<div class="say">' + t('神算子捻须："' + Shensuan.fieldName(key) + '之事，老朽再问一句——"',
          'The Oracle strokes his beard: "On ' + Shensuan.fieldName(key, 'en') + ', one more question—"') + '</div>' +
        '<div class="opts">' + opts + '</div>' +
      '</div>';
    $('shen-box').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function shenPickSub(sub) {
    shenState.sub = sub;
    var c = Shensuan.conclude(currentBz, currentGua, shenState.domain, sub, '', currentLang);
    renderConclusion(c);
  }

  function shenFree() {
    $('shen-box').innerHTML +=
      '<div class="shen-box fade">' +
        '<div class="say">神算子微笑："' + t('客官但说无妨。', 'Speak freely, friend.') + '"</div>' +
        '<div class="opts"><input id="freeText" placeholder="' + t('说来听听，你最牵挂的是何事？', 'Tell me what weighs on you most.') + '" style="max-width:340px">' +
        '<button class="btn-secondary btn-sm" data-action="free-submit">' + t('禀上', 'Tell him') + '</button></div>' +
      '</div>';
    $('shen-box').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function shenFreeSubmit() {
    var txt = $('freeText').value.trim();
    if (!txt) { alert(t('请先说说你的心事', 'Please say what is on your mind.')); return; }
    shenState.free = txt;
    shenState.sub = '';
    Oracle.observe({ type: 'free', text: txt });
    var c = Shensuan.conclude(currentBz, currentGua, 'other', '', txt, currentLang);
    renderConclusion(c);
  }

  function problemText() {
    var key = shenState.domain, sub = shenState.sub, free = shenState.free;
    if (free) return free;
    var w = Shensuan.fieldName(key, currentLang) + (currentLang === 'en' ? ' · ' : '·') + Shensuan.subLabel(key, sub, currentLang);
    return w || t('心中所忧', 'a worry in the heart');
  }

  // ===================== 神算子点拨（内嵌模型，随互动进化）=====================
  function oracleCtx() {
    return {
      bz: currentBz, gua: currentGua,
      problemText: problemText(),
      shen: { domainLabel: shenState.domainLabel || problemText() }
    };
  }
  function oracleResolve() {
    var box = $('oracleText'); if (!box) return;
    try {
      box.textContent = Oracle.generate(oracleCtx(), { lang: currentLang });
      var note = $('oracleNote'); if (note) {
        note.textContent = isEn()
          ? '(Tell him what lands and what misses — he takes it to heart and grows attuned to you.)'
          : '（解得准与不准，尽可点破——他听在耳里、记在心上，越聊越懂你。）';
      }
    } catch (e) {
      box.textContent = t('（神算子沉吟片刻，暂未开言……', '(The Oracle pauses, lost in thought…');
    }
  }
  function fb(kind) {
    Oracle.feedback(kind);
    var note = $('oracleNote');
    if (note) {
      if (kind === 'like') note.textContent = isEn() ? 'He nods — he will lean into this kind of counsel.' : '神算子颔首——往后便多说这类话。';
      else if (kind === 'dislike') note.textContent = isEn() ? 'He strokes his beard — he will try another angle.' : '神算子捻须——往后便换些说法。';
    }
  }
  function fbResample() {
    Oracle.feedback('resample');
    var box = $('oracleText'); if (!box) return;
    try {
      box.textContent = Oracle.generate(oracleCtx(), { lang: currentLang, prev: Oracle.lastPlan() });
    } catch (e) {
      box.textContent = String((e && e.message) || e);
    }
    var note = $('oracleNote'); if (note) {
      note.textContent = isEn()
        ? '(He rephrases his counsel. Keep telling him what lands.)'
        : '（神算子换了一种说法；准与不准，继续点破便是。）';
    }
  }

  function renderConclusion(c) {
    var oracleBlock =
      '<div class="shen-box fade oracle" id="oracleBox">' +
        '<div class="say oracle-title">◈ <span class="zh">神算子点拨</span><span class="en">The Oracle’s Counsel</span></div>' +
        '<div class="say oracle-text" id="oracleText">' + t('神算子正在凝神参详……', 'The Oracle is gathering his thoughts…') + '</div>' +
        '<div class="fb"><span class="muted">' + t('这一解，可说到你心坎？', 'Did this land for you?') + '</span>' +
          '<button class="btn-secondary btn-sm" data-action="fb-like">👍 ' + t('有共鸣', 'Resonates') + '</button>' +
          '<button class="btn-ghost btn-sm" data-action="fb-dislike">👎 ' + t('不太对', 'Not quite') + '</button>' +
          '<button class="btn-ghost btn-sm" data-action="fb-resample">' + t('换一种说法', 'Rephrase') + '</button></div>' +
        '<div class="ai-note" id="oracleNote"></div>' +
      '</div>';

    var solutionHtml = c.solution
      ? '<details class="solution"><summary>◈ <span class="zh">传统五步推演</span><span class="en">Traditional five-step reading</span></summary>' +
        c.solution.split('\n\n').map(function (p) {
          var idx = p.indexOf('　');
          var head = idx > 0 ? p.slice(0, idx) : '';
          var body = idx > 0 ? p.slice(idx + 1) : p;
          return '<div class="sol-item"><b>' + head + '</b><span>' + body + '</span></div>';
        }).join('') + '</details>'
      : '';

    $('shen-box').innerHTML +=
      '<div class="shen-box fade" style="border-color:var(--cinnabar)">' +
        '<div class="say" style="font-weight:600;color:var(--cinnabar-soft)">' + c.summary + '</div>' +
        '<div class="say" style="margin-top:10px">' + c.reading + '</div>' +
      '</div>' +
      oracleBlock + solutionHtml;
    $('shen-box').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    oracleResolve();
  }

  // ===================== 统一事件委托 =====================
  function dispatch(e) {
    var tg = e.target.closest('[data-action]');
    if (!tg) return;
    var action = tg.getAttribute('data-action');
    var key = tg.getAttribute('data-key') || '';
    switch (action) {
      case 'lang-toggle': langToggle(); break;
      case 'bazi': doBazi(); break;
      case 'gua': doGua(); break;
      case 'shen': startShen(); break;
      case 'pick-domain': shenPickDomain(key); break;
      case 'pick-sub': shenPickSub(key); break;
      case 'free': shenFree(); break;
      case 'free-submit': shenFreeSubmit(); break;
      case 'fb-like': fb('like'); break;
      case 'fb-dislike': fb('dislike'); break;
      case 'fb-resample': fbResample(); break;
    }
  }

  // ===================== 初始化 =====================
  document.addEventListener('click', dispatch);
  initLang();
  Oracle.observe({ type: 'session' });
})();
