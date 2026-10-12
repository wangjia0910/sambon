/* app.js — 三宝殿交互编排（依赖 Bazi / Liuyao / Auth / Shensuan 全局） */
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
        '<button class="ghost small" onclick="doLogout()">退出</button>';
    } else {
      a.innerHTML = '<button class="ghost small" onclick="openLogin()">登录 / 注册</button>';
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
      opts += '<button class="small" onclick="shenPickDomain(\'' + d.key + '\')">' + d.label + '</button>';
    });
    opts += '<button class="small ghost" onclick="shenFree()">都不是，我想直说</button>';
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
      opts += '<button class="small" onclick="shenPickSub(\'' + s.key + '\')">' + s.label + '</button>';
    });
    $('shen-box').innerHTML +=
      '<div class="shen-box fade">' +
        '<div class="say">神算子捻须："' + Shensuan.fieldName(key) + '之事，老朽再问一句——"</div>' +
        '<div class="opts">' + opts + '</div>' +
      '</div>';
    $('shen-box').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function shenPickSub(sub) {
    var c = Shensuan.conclude(currentBz, currentGua, shenState.domain, sub, '');
    renderConclusion(c);
  }

  function shenFree() {
    $('shen-box').innerHTML +=
      '<div class="shen-box fade">' +
        '<div class="say">神算子微笑："客官但说无妨。"</div>' +
        '<div class="opts"><input id="freeText" placeholder="说来听听，你最牵挂的是何事？" style="max-width:340px">' +
        '<button class="small" onclick="shenFreeSubmit()">禀上</button></div>' +
      '</div>';
    $('shen-box').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function shenFreeSubmit() {
    var t = $('freeText').value.trim();
    if (!t) { alert('请先说说你的心事'); return; }
    var c = Shensuan.conclude(currentBz, currentGua, 'other', '', t);
    renderConclusion(c);
  }

  function renderConclusion(c) {
    $('shen-box').innerHTML +=
      '<div class="shen-box fade" style="border-color:var(--accent)">' +
        '<div class="say" style="font-weight:600;color:var(--accent)">' + c.summary + '</div>' +
        '<div class="say" style="margin-top:10px">' + c.reading + '</div>' +
      '</div>';
    $('shen-box').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // 暴露给内联 onclick
  window.doBazi = doBazi;
  window.doGua = doGua;
  window.startShen = startShen;
  window.shenPickDomain = shenPickDomain;
  window.shenPickSub = shenPickSub;
  window.shenFree = shenFree;
  window.shenFreeSubmit = shenFreeSubmit;
  window.openLogin = openLogin;
  window.closeLogin = closeLogin;
  window.doLogin = doLogin;
  window.doRegister = doRegister;
  window.doLogout = doLogout;
  window.renderAuth = renderAuth;

  // 初始化
  renderAuth();
})();
