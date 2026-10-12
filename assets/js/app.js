/* app.js — 三宝殿交互编排（依赖 Bazi / Liuyao / Auth / Shensuan / Oracle 全局）
 * 事件统一走 data-action 委托，HTML 不再内联 onclick。
 * 国际化：中/英切换（给 <html> 加 lang-en 类，配合 .zh/.en 显隐）。
 * 神算：接入内嵌模型 Oracle（纯本地、随互动自动进化），零外部 API。
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
  }
  function renderLang() {
    var b = $('langBtn'); if (!b) return;
    b.textContent = isEn() ? '中文' : 'EN';
    b.title = isEn() ? 'Switch to Chinese / 切换中文' : 'Switch to English / 切换英文';
  }
  function langToggle() { setLang(isEn() ? 'zh' : 'en'); }

  // ===================== 登录区 =====================
  function renderAuth() {
    var a = $('authArea'); if (!a) return;
    if (Auth.isLogin()) {
      var m = Auth.me();
      a.innerHTML = '<span class="welcome">' + t('欢迎，', 'Hi, ') + m.name + '</span>' +
        '<button class="btn-ghost btn-sm" data-action="logout">' +
          '<span class="zh">退出</span><span class="en">Sign out</span></button>';
    } else {
      a.innerHTML = '<button class="btn-ghost btn-sm" data-action="login">' +
        '<span class="zh">登录 / 注册</span><span class="en">Sign in</span></button>';
    }
  }
  function openLogin(note) {
    $('lgMsg').textContent = note || '';
    $('loginModal').classList.remove('hidden');
    var n = $('lgName'); if (n) n.focus();
  }
  function closeLogin() { $('loginModal').classList.add('hidden'); }
  function doLogin() {
    var r = Auth.login($('lgName').value, $('lgPass').value);
    $('lgMsg').textContent = r.msg;
    if (r.ok) {
      Oracle.observe({ type: 'login', name: $('lgName').value });
      closeLogin(); renderAuth();
    }
  }
  function doRegister() {
    var r = Auth.register($('lgName').value, $('lgPass').value);
    $('lgMsg').textContent = r.msg;
    if (r.ok) {
      Oracle.observe({ type: 'login', name: $('lgName').value });
      closeLogin(); renderAuth();
    }
  }
  function doLogout() { Auth.logout(); renderAuth(); }

  // ===================== 内嵌模型：成长指示 & 面板 =====================
  function updateGrowth() {
    var el = $('growthPill'); if (!el) return;
    var st = Oracle.stats();
    el.innerHTML =
      '<span class="zh">🌱 ' + st.level.name + ' · 进化 ' + st.updates + '</span>' +
      '<span class="en">🌱 ' + st.level.en + ' · Lv.' + st.updates + '</span>';
  }

  function openModel() {
    renderModelPanel();
    $('oracleModal').classList.remove('hidden');
  }
  function closeModel() { $('oracleModal').classList.add('hidden'); }

  function renderModelPanel() {
    var st = Oracle.stats();
    function set(id, txt) { var e = $(id); if (e) e.textContent = txt; }
    set('omLevel', (isEn() ? st.level.en : st.level.name) + '（' + st.level.n + '/4）');
    set('omSessions', st.sessions);
    set('omUpdates', st.updates);
    set('omResonance', st.resonanceRate === null ? '—' : (st.resonanceRate + '%'));
    set('omLike', st.like + ' / ' + st.dislike);
    var rec = st.recurring.length
      ? st.recurring.map(function (r) { return (isEn() ? r.cat : r.label) + ' ×' + r.n; }).join('　')
      : (isEn() ? '(none yet)' : '（尚未形成）');
    set('omRecurring', rec);
    var terms = st.terms.length
      ? st.terms.map(function (x) { return x.term; }).join('、')
      : (isEn() ? '(none yet)' : '（尚未学到）');
    set('omTerms', terms);
    var tog = $('omToggle'); if (tog) {
      tog.innerHTML = Oracle.isEnabled()
        ? '<span class="zh">内嵌解惑：开</span><span class="en">Oracle: ON</span>'
        : '<span class="zh">内嵌解惑：关</span><span class="en">Oracle: OFF</span>';
    }
    updateGrowth();
  }
  function modelToggle() { Oracle.setEnabled(!Oracle.isEnabled()); renderModelPanel(); }
  function modelExport() {
    try {
      var blob = new Blob([Oracle.exportJSON()], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'sambon-oracle-model.json';
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      $('oracleMsg').textContent = isEn() ? 'Exported model file.' : '已导出模型文件。';
    } catch (e) {
      $('oracleMsg').textContent = (isEn() ? 'Export failed: ' : '导出失败：') + e.message;
    }
  }
  function modelImport() {
    var file = $('oracleFile') && $('oracleFile').files && $('oracleFile').files[0];
    var finish = function (text) {
      var r = Oracle.importJSON(text);
      $('oracleMsg').textContent = r.ok
        ? (isEn() ? 'Model restored.' : '导入成功，模型已恢复。')
        : ((isEn() ? 'Import failed: ' : '导入失败：') + r.msg);
      renderModelPanel();
    };
    if (file) {
      var fr = new FileReader();
      fr.onload = function () { finish(String(fr.result || '')); };
      fr.readAsText(file);
    } else {
      var ta = $('oraclePaste'); var txt = ta ? ta.value.trim() : '';
      if (!txt) { $('oracleMsg').textContent = isEn() ? 'Paste model JSON or pick a file first.' : '请先粘贴模型 JSON 或选择文件。'; return; }
      finish(txt);
    }
  }
  function modelReset() {
    if (!confirm(isEn() ? 'Reset the model? All learned signals will be cleared.' : '确定重置模型？将清空所有已学习的互动记录。')) return;
    Oracle.reset();
    $('oracleMsg').textContent = isEn() ? 'Model reset.' : '模型已重置。';
    renderModelPanel();
  }

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
    var text = (name ? ('【' + name + ' · ' + sex + '】\n') : '') + Bazi.interpret(currentBz);
    text += '\n\n【七 · 人生推论（性格 · 命运 · 事业 · 财运 · 感情人际）】\n' + Bazi.lifeReadingText(currentBz);
    text += '\n\n【八 · 大运详批（十年一运，逐运解析）】\n' + Bazi.dayunDetailText(currentBz);
    text += '\n\n【命纹指纹 · 同八字匹配串】\n' + Bazi.fingerprint(currentBz) +
      '\n（此四柱串即你的"八字指纹"。日后开启同八字社群，可凭此匹配同道中人；亦可用于关联同八字用户。）';
    if (Auth.isLogin()) {
      var m = Auth.me();
      Auth.setProfile({ name: name || m.name, sex: sex, bdate: bd, bhour: h,
        fingerprint: Bazi.fingerprint(currentBz), ts: Date.now() });
      text += '\n\n已记入「' + m.name + '」的档案（登录用户专属）。';
    }
    el.textContent = text;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ===================== 六爻 =====================
  function renderGua(gua) {
    var yaos = '';
    gua.lines.forEach(function (v, i) {
      var cls = 'yao' + (v ? '' : ' yin') + (gua.dong === i ? ' dong' : '');
      yaos += '<div class="' + cls + '"></div>';
    });
    $('gua-result').classList.remove('hidden');
    $('gua-result').innerHTML =
      '<div class="gua-box">' +
        '<div class="yaos">' + yaos + '</div>' +
        '<div class="gua-meta">' +
          '<div>卦名：<b>' + gua.name + '</b></div>' +
          '<div>上' + gua.upperName + '(' + gua.upperWX + ') 下' + gua.lowerName + '(' + gua.lowerWX + ')</div>' +
          '<div>' + (gua.dong >= 0 ? ('动爻第' + (gua.dong + 1) + '爻 → 变卦 ' + gua.bianName) : '静卦（无动爻）') + '</div>' +
          '<div style="margin-top:8px;max-width:520px">卦辞："' + gua.desc + '"</div>' +
          '<div style="margin-top:8px;max-width:520px;color:var(--mut)">' + Liuyao.plain(gua) + '</div>' +
        '</div>' +
      '</div>';
  }

  function doGua() {
    currentGua = Liuyao.cast();
    renderGua(currentGua);
    $('gua-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ===================== 神算子攀谈（须登录）=====================
  function startShen() {
    if (!Auth.isLogin()) { openLogin(t('神算子攀谈需登录后使用，请先登录或注册（免费演示账号）。', 'Sign in to consult the Oracle (free demo account).')); return; }
    var box = $('shen-box');
    if (!currentBz || !currentGua) {
      box.innerHTML = '<div class="note">' + t('请先完成「八字推演」与「六爻起卦」，神算子方能起局参详。', 'Please run both the BaZi chart and cast a hexagram first.') + '</div>';
      return;
    }
    var a = Shensuan.assess(currentBz, currentGua);
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
    shenState.domainLabel = Shensuan.fieldName(key);
    Oracle.observe({ type: 'domain', label: shenState.domainLabel });
    var subs = Shensuan.refine(key);
    var opts = '';
    subs.forEach(function (s) {
      opts += '<button class="btn-secondary btn-sm" data-action="pick-sub" data-key="' + s.key + '">' + s.label + '</button>';
    });
    $('shen-box').innerHTML +=
      '<div class="shen-box fade">' +
        '<div class="say">神算子捻须："' + Shensuan.fieldName(key) + '之事，老朽再问一句——"</div>' +
        '<div class="opts">' + opts + '</div>' +
      '</div>';
    $('shen-box').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function shenPickSub(sub) {
    shenState.sub = sub;
    var c = Shensuan.conclude(currentBz, currentGua, shenState.domain, sub, '');
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
    var t2 = $('freeText').value.trim();
    if (!t2) { alert(t('请先说说你的心事', 'Please say what is on your mind.')); return; }
    shenState.free = t2;
    shenState.sub = '';
    Oracle.observe({ type: 'free', text: t2 });
    var c = Shensuan.conclude(currentBz, currentGua, 'other', '', t2);
    renderConclusion(c);
  }

  function problemText() {
    var key = shenState.domain, sub = shenState.sub, free = shenState.free;
    if (free) return free;
    var w = Shensuan.fieldName(key) + '·' + Shensuan.subLabel(key, sub);
    return w || t('心中所忧', 'a worry in the heart');
  }

  // ===================== 内嵌模型解惑 =====================
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
      var txt = Oracle.generate(oracleCtx(), { lang: currentLang });
      box.textContent = txt;
      var note = $('oracleNote'); if (note) {
        note.textContent = isEn()
          ? '(Generated on-device by the embedded model — no external API. It learns from your reactions and evolves as you interact.)'
          : '（由内嵌模型在本机实时生成，零外部调用；会依据你的 👍/👎 与互动自动进化。）';
      }
      updateGrowth();
    } catch (e) {
      box.textContent = t('（内嵌模型暂时无法生成：', '(Oracle unavailable: ') + ((e && e.message) || e) + '）';
    }
  }
  function fb(kind) {
    Oracle.feedback(kind);
    var note = $('oracleNote');
    if (note) {
      if (kind === 'like') note.textContent = isEn() ? 'Noted — it will lean into this kind of counsel. 🌱' : '已记下你的共鸣，模型会多说这类话 🌱';
      else if (kind === 'dislike') note.textContent = isEn() ? 'Noted — it will try a different angle.' : '已记下，模型会换些说法。';
    }
    updateGrowth();
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
        ? '(Re-phrased. Keep teaching it with your reactions.)'
        : '（已换一种说法；仍可继续 👍/👎 教它。）';
    }
    updateGrowth();
  }

  function renderConclusion(c) {
    var oracleOn = Oracle.isEnabled();
    var oracleBlock = oracleOn
      ? '<div class="shen-box fade oracle" id="oracleBox">' +
          '<div class="say oracle-title">◈ <span class="zh">神算子内嵌解惑 · 随互动进化</span><span class="en">Embedded Oracle · evolving with you</span></div>' +
          '<div class="say oracle-text" id="oracleText">' + t('神算子正在凝神参详……', 'The Oracle is gathering his thoughts…') + '</div>' +
          '<div class="fb"><span class="muted">' + t('这一解，可说到你心坎？', 'Did this land for you?') + '</span>' +
            '<button class="btn-secondary btn-sm" data-action="fb-like">👍 ' + t('有共鸣', 'Resonates') + '</button>' +
            '<button class="btn-ghost btn-sm" data-action="fb-dislike">👎 ' + t('不太对', 'Not quite') + '</button>' +
            '<button class="btn-ghost btn-sm" data-action="fb-resample">' + t('换一种说法', 'Rephrase') + '</button></div>' +
          '<div class="ai-note" id="oracleNote"></div>' +
        '</div>'
      : '<div class="shen-box fade oracle off">' +
          '<div class="say oracle-title">◈ <span class="zh">内嵌神算模型（已关闭）</span><span class="en">Embedded Oracle (off)</span></div>' +
          '<div class="say">' + t('内嵌解惑已关闭，点右上角「神算模型」可重新开启。下方仍保留传统五步推演。', 'The embedded oracle is off — open "Oracle Model" (top right) to switch it back on. The traditional five-step reading remains below.') + '</div>' +
        '</div>';

    var detailsOpen = oracleOn ? '' : ' open';
    var solutionHtml = c.solution
      ? '<details class="solution"' + detailsOpen + '><summary>◈ <span class="zh">传统五步推演（离线可用）</span><span class="en">Traditional five-step reading</span></summary>' +
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
    if (oracleOn) oracleResolve();
  }

  // ===================== 统一事件委托 =====================
  function dispatch(e) {
    var tg = e.target.closest('[data-action]');
    if (!tg) return;
    var action = tg.getAttribute('data-action');
    var key = tg.getAttribute('data-key') || '';
    switch (action) {
      case 'lang-toggle': langToggle(); break;
      case 'model-panel': openModel(); break;
      case 'close-model': closeModel(); break;
      case 'model-toggle': modelToggle(); break;
      case 'model-export': modelExport(); break;
      case 'model-import': modelImport(); break;
      case 'model-reset': modelReset(); break;
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
      case 'login': openLogin(); break;
      case 'close-login': closeLogin(); break;
      case 'do-login': doLogin(); break;
      case 'do-register': doRegister(); break;
      case 'logout': doLogout(); break;
    }
  }

  // ===================== 初始化 =====================
  document.addEventListener('click', dispatch);
  initLang();
  renderAuth();
  Oracle.observe({ type: 'session' });
  updateGrowth();
})();
