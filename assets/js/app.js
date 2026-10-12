/* app.js — 三宝殿交互编排（依赖 Bazi / Liuyao / Auth / Shensuan / AI 全局）
 * 事件统一走 data-action 委托，HTML 不再内联 onclick。 */
(function () {
  'use strict';
  var currentBz = null, currentGua = null, shenState = {};

  function $(id) { return document.getElementById(id); }

  // ---- 登录区渲染 ----
  function renderAuth() {
    var a = $('authArea'); if (!a) return;
    if (Auth.isLogin()) {
      var m = Auth.me();
      a.innerHTML = '<span class="welcome">欢迎，' + m.name + '</span>' +
        '<button class="btn-ghost btn-sm" data-action="logout">退出</button>';
    } else {
      a.innerHTML = '<button class="btn-ghost btn-sm" data-action="login">登录 / 注册</button>';
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
    if (r.ok) { closeLogin(); renderAuth(); }
  }
  function doRegister() {
    var r = Auth.register($('lgName').value, $('lgPass').value);
    $('lgMsg').textContent = r.msg;
    if (r.ok) { closeLogin(); renderAuth(); }
  }
  function doLogout() { Auth.logout(); renderAuth(); }

  // ---- 大模型配置（存本机浏览器 localStorage）----
  function openAIConfig() {
    var c = AI.loadCfg();
    $('aiEndpoint').value = c.endpoint || '';
    $('aiKey').value = c.apiKey || '';
    $('aiModel').value = c.model || '';
    $('aiMsg').textContent = AI.isConfigured() ? '已配置，可重新保存或清除。' : '';
    $('aiModal').classList.remove('hidden');
    var ep = $('aiEndpoint'); if (ep) ep.focus();
  }
  function closeAIConfig() { $('aiModal').classList.add('hidden'); }
  function saveAIConfig() {
    var ep = $('aiEndpoint').value.trim(), key = $('aiKey').value.trim(), model = $('aiModel').value.trim();
    if (!ep || !key || !model) { $('aiMsg').textContent = '三项均需填写'; return; }
    AI.configure({ endpoint: ep, apiKey: key, model: model });
    $('aiMsg').textContent = '已保存（仅存本机浏览器）';
    setTimeout(closeAIConfig, 700);
  }
  function clearAIConfig() {
    AI.configure({ endpoint: '', apiKey: '', model: '' });
    $('aiMsg').textContent = '已清除配置';
  }

  // ---- 八字 ----
  function doBazi() {
    var name = $('name').value.trim();
    var sex = $('sex').value;
    var bd = $('bdate').value;
    var h = parseInt($('bhour').value, 10);
    if (!bd) { alert('请填写出生日期'); return; }
    if (isNaN(h) || h < 0 || h > 23) { alert('小时请填 0~23'); return; }
    var p = bd.split('-').map(Number);
    currentBz = Bazi.bazi(p[0], p[1], p[2], h, sex);
    var el = $('bazi-result');
    el.classList.remove('hidden');
    var text = (name ? ('【' + name + ' · ' + sex + '】\n') : '') + Bazi.interpret(currentBz);
    // 人生推论（性格 / 命运 / 事业 / 财运 / 感情人际）
    text += '\n\n【七 · 人生推论（性格 · 命运 · 事业 · 财运 · 感情人际）】\n' + Bazi.lifeReadingText(currentBz);
    // 大运逐运详批
    text += '\n\n【八 · 大运详批（十年一运，逐运解析）】\n' + Bazi.dayunDetailText(currentBz);
    // 八字指纹（同八字匹配串）+ 登录用户档案
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

  // ---- 六爻 ----
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

  // ---- 神算子攀谈（须登录）----
  function startShen() {
    if (!Auth.isLogin()) { openLogin('神算子攀谈需登录后使用，请先登录或注册（免费演示账号）。'); return; }
    var box = $('shen-box');
    if (!currentBz || !currentGua) {
      box.innerHTML = '<div class="note">请先完成「八字推演」与「六爻起卦」，神算子方能起局参详。</div>';
      return;
    }
    var a = Shensuan.assess(currentBz, currentGua);
    shenState = {};
    var opts = '';
    a.domains.forEach(function (d) {
      opts += '<button class="btn-secondary btn-sm" data-action="pick-domain" data-key="' + d.key + '">' + d.label + '</button>';
    });
    opts += '<button class="btn-ghost btn-sm" data-action="free">都不是，我想直说</button>';
    box.innerHTML =
      '<div class="shen-box fade">' +
        '<div class="say">' + a.opening + '</div>' +
        '<div class="opts"><p class="muted">客官此来，可是为以下哪桩心事？</p>' + opts + '</div>' +
      '</div>';
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function shenPickDomain(key) {
    shenState.domain = key;
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
        '<div class="say">神算子微笑："客官但说无妨。"</div>' +
        '<div class="opts"><input id="freeText" placeholder="说来听听，你最牵挂的是何事？" style="max-width:340px">' +
        '<button class="btn-secondary btn-sm" data-action="free-submit">禀上</button></div>' +
      '</div>';
    $('shen-box').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function shenFreeSubmit() {
    var t = $('freeText').value.trim();
    if (!t) { alert('请先说说你的心事'); return; }
    shenState.free = t;
    shenState.sub = '';
    var c = Shensuan.conclude(currentBz, currentGua, 'other', '', t);
    renderConclusion(c);
  }

  function problemText() {
    var key = shenState.domain, sub = shenState.sub, free = shenState.free;
    if (free) return free;
    var w = Shensuan.fieldName(key) + '·' + Shensuan.subLabel(key, sub);
    return w || '心中所忧';
  }

  function formatAI(txt) {
    return (txt || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
  }

  // 大模型异步解惑：成功渲染，失败/未配置则降级提示，保留本地五步
  async function aiResolve() {
    var box = $('aiText'); if (!box) return;
    try {
      var txt = await AI.resolve(currentBz, currentGua, problemText());
      box.innerHTML = formatAI(txt);
      var note = $('aiNote'); if (note) note.textContent = '（由大模型实时生成，结合你这一局的八字、卦象与所问之事）';
    } catch (e) {
      var msg = (e && e.code === 'NOT_CONFIGURED') ? '尚未配置大模型' :
        ('调用失败：' + ((e && e.message) || e));
      box.innerHTML = '（大模型解惑暂不可用：' + msg + '。已为你保留下方本地传统推演方案。）';
    }
  }

  function renderConclusion(c) {
    var aiOn = (typeof AI !== 'undefined') && AI.isConfigured();
    var aiBlock = aiOn
      ? '<div class="shen-box fade" id="aiBox" style="border-color:var(--gold)">' +
          '<div class="say" style="font-weight:600;color:var(--gold-bright)">◈ 神算子大模型解惑（实时生成）</div>' +
          '<div class="say" id="aiText">神算子正在凝神参详，请稍候……（大模型推理中）</div>' +
          '<div class="ai-note" id="aiNote"></div>' +
        '</div>'
      : '<div class="shen-box fade" style="border-color:var(--gold)">' +
          '<div class="say" style="font-weight:600;color:var(--gold-bright)">◈ 神算子大模型解惑（未启用）</div>' +
          '<div class="say">尚未配置大模型。点击右上角「⚙ 大模型」填入你的 API 端点与密钥，神算子便能以大模型实时参详你这一局，给出更贴合现实的指引。</div>' +
        '</div>';

    var detailsOpen = aiOn ? '' : ' open';
    var solutionHtml = c.solution
      ? '<details class="solution"' + detailsOpen + '><summary>◈ 传统五步推演（离线可用）</summary>' +
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
      aiBlock + solutionHtml;
    $('shen-box').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (aiOn) aiResolve();
  }

  // ---- 统一事件委托 ----
  function dispatch(e) {
    var t = e.target.closest('[data-action]');
    if (!t) return;
    var action = t.getAttribute('data-action');
    var key = t.getAttribute('data-key') || '';
    switch (action) {
      case 'ai-config': openAIConfig(); break;
      case 'bazi': doBazi(); break;
      case 'gua': doGua(); break;
      case 'shen': startShen(); break;
      case 'pick-domain': shenPickDomain(key); break;
      case 'pick-sub': shenPickSub(key); break;
      case 'free': shenFree(); break;
      case 'free-submit': shenFreeSubmit(); break;
      case 'login': openLogin(); break;
      case 'close-login': closeLogin(); break;
      case 'do-login': doLogin(); break;
      case 'do-register': doRegister(); break;
      case 'logout': doLogout(); break;
      case 'close-ai': closeAIConfig(); break;
      case 'save-ai': saveAIConfig(); break;
      case 'clear-ai': clearAIConfig(); break;
    }
  }

  // 初始化
  document.addEventListener('click', dispatch);
  renderAuth();
})();
