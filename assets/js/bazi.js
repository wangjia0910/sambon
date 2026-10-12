/*
 * bazi.js — 八字推演核心（四柱 / 十神 / 五行 / 日主强弱 / 大运 / 解读）
 * UMD: 浏览器挂 window.Bazi；Node 可 require 验证。
 * 说明：年/月柱未严格按节气校正（按公历月近似），仅供文化与娱乐。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Bazi = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var GAN  = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];
  var ZHI  = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
  var WX   = {甲:'木',乙:'木',丙:'火',丁:'火',戊:'土',己:'土',庚:'金',辛:'金',壬:'水',癸:'水',
              子:'水',丑:'土',寅:'木',卯:'木',辰:'土',巳:'火',午:'火',未:'土',申:'金',酉:'金',戌:'土',亥:'水'};
  // 天干阴阳：1=阳 0=阴
  var GAN_YIN = {甲:1,乙:0,丙:1,丁:0,戊:1,己:0,庚:1,辛:0,壬:1,癸:0};
  // 地支本气天干（简化，用于地支十神）
  var ZHI_BENQI = {子:'癸',丑:'己',寅:'甲',卯:'乙',辰:'戊',巳:'丙',午:'丁',未:'己',申:'庚',酉:'辛',戌:'戊',亥:'壬'};
  // 五行生克循环
  var CYC = ['木','火','土','金','水'];
  function sheng(a, b) { var i = CYC.indexOf(a), j = CYC.indexOf(b); return (i + 1) % 5 === j; } // a 生 b
  function ke(a, b)   { var i = CYC.indexOf(a), j = CYC.indexOf(b); return (i + 2) % 5 === j; }   // a 克 b

  // ---- 干支换算 ----
  function jdn(y, m, d) {
    if (m <= 2) { m += 12; y -= 1; }
    var a = Math.floor((14 - m) / 12);
    var yy = y + 4800 - a;
    var mm = m + 12 * a - 3;
    return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
  }
  function dayGZ(y, m, d) {
    var N = jdn(y, m, d);
    var g = ((N + 9) % 10 + 10) % 10, z = ((N + 1) % 12 + 12) % 12;
    return { gan: GAN[g], zhi: ZHI[z], gi: g, zi: z };
  }
  function yearGZ(y) {
    var n = y - 4, g = ((n % 10) + 10) % 10, z = (((n % 12) + 12) % 12);
    return { gan: GAN[g], zhi: ZHI[z], gi: g, zi: z };
  }
  // 公历月 → 月支（近似：按节气，简化为公历月映射）
  var MONTH_ZHI = {1:'丑',2:'寅',3:'卯',4:'辰',5:'巳',6:'午',7:'未',8:'申',9:'酉',10:'戌',11:'亥',12:'子'};
  function monthGZ(y, m) {
    var yz = yearGZ(y), zi = ZHI.indexOf(MONTH_ZHI[m]);
    var g = ((yz.gi * 2 + zi) % 10 + 10) % 10;
    return { gan: GAN[g], zhi: MONTH_ZHI[m], gi: g, zi: zi };
  }
  function hourZhi(h) { if (h === 23 || h === 0) return 0; return (Math.floor((h + 1) / 2)) % 12; }

  // ---- 十神 ----
  // 以 dayGan 为"我"，otherGan 为对方天干，返回十神名
  function shishen(dayGan, otherGan) {
    var dw = WX[dayGan], ow = WX[otherGan];
    var dy = GAN_YIN[dayGan], oy = GAN_YIN[otherGan];
    if (dw === ow) return dy === oy ? '比肩' : '劫财';          // 同我
    if (sheng(ow, dw)) return dy === oy ? '偏印' : '正印';        // 生我
    if (sheng(dw, ow)) return dy === oy ? '食神' : '伤官';        // 我生
    if (ke(ow, dw))    return dy === oy ? '七杀' : '正官';        // 克我
    if (ke(dw, ow))    return dy === oy ? '偏财' : '正财';        // 我克
    return '?';
  }
  function shishenOfZhi(dayGan, zhi) { return shishen(dayGan, ZHI_BENQI[zhi]); }

  // ---- 八字排盘 ----
  function bazi(y, m, d, h, sex) {
    var yg = yearGZ(y), mg = monthGZ(y, m), dg = dayGZ(y, m, d);
    var hz = hourZhi(h);
    var hg = { gan: GAN[(dg.gi * 2 + hz) % 10], gi: (dg.gi * 2 + hz) % 10 };
    var pillars = [yg.gan, mg.gan, dg.gan, hg.gan];
    var zhis = [yg.zhi, mg.zhi, dg.zhi, ZHI[hz]];
    var cnt = {木:0,火:0,土:0,金:0,水:0};
    pillars.forEach(function (g) { cnt[WX[g]]++; });
    zhis.forEach(function (z) { cnt[WX[z]]++; });

    var dayMaster = WX[dg.gan], dayGan = dg.gan;
    // 日主强弱（简化）
    var monthWX = WX[mg.zhi];
    var score = 30;
    if (monthWX === dayMaster) score += 20; else if (sheng(monthWX, dayMaster)) score += 12;
    zhis.forEach(function (z) { if (WX[z] === dayMaster) score += 8; });
    pillars.forEach(function (g) { var w = WX[g]; if (w === dayMaster) score += 6; else if (sheng(w, dayMaster)) score += 3; });
    score = Math.max(0, Math.min(100, score));
    var like;
    if (score >= 60) {
      like = [CYC[(CYC.indexOf(dayMaster) + 2) % 5], CYC[(CYC.indexOf(dayMaster) + 1) % 5], CYC[(CYC.indexOf(dayMaster) + 3) % 5]];
    } else {
      like = [dayMaster, CYC[(CYC.indexOf(dayMaster) + 4) % 5]];
    }
    var vals = Object.keys(cnt).map(function (k) { return cnt[k]; });
    var balance = Math.max(0, Math.min(100, 100 - (Math.max.apply(null, vals) - Math.min.apply(null, vals)) * 7));

    var ss = {
      yearGan:  shishen(dayGan, yg.gan),
      yearZhi:  shishenOfZhi(dayGan, yg.zhi),
      monthGan: shishen(dayGan, mg.gan),
      monthZhi: shishenOfZhi(dayGan, mg.zhi),
      dayZhi:   shishenOfZhi(dayGan, dg.zhi),
      hourGan:  shishen(dayGan, hg.gan),
      hourZhi:  shishenOfZhi(dayGan, ZHI[hz])
    };

    var du = dayun(y, m, d, mg, sex);

    return {
      raw: { y: y, m: m, d: d, h: h, sex: sex },
      yg: yg, mg: mg, dg: dg, hg: hg, hz: hz,
      pillars: pillars, zhis: zhis, cnt: cnt,
      dayMaster: dayMaster, dayGan: dayGan,
      strength: { score: score, like: like, balance: balance },
      shishen: ss, dayun: du
    };
  }

  // ---- 大运（节气近似）----
  // 节（进入各月支之节）公历近似日期
  var JIE = [
    {m:1,d:6},{m:2,d:4},{m:3,d:6},{m:4,d:5},{m:5,d:6},{m:6,d:6},
    {m:7,d:7},{m:8,d:8},{m:9,d:8},{m:10,d:8},{m:11,d:7},{m:12,d:7}
  ];
  function daysBetween(y1, m1, d1, y2, m2, d2) {
    var t1 = Date.UTC(y1, m1 - 1, d1), t2 = Date.UTC(y2, m2 - 1, d2);
    return Math.round((t2 - t1) / 86400000);
  }
  function dayun(y, m, d, mg, sex) {
    var yangYear = GAN_YIN[yearGZ(y).gan] === 1;
    var male = sex === '男';
    var forward = (yangYear && male) || (!yangYear && !male); // 阳男阴女顺，阴男阳女逆
    var birthT = Date.UTC(y, m - 1, d);
    // 收集出生年前后共三年的所有"节"，找紧邻出生日之后(顺)/之前(逆)的那一个
    var jies = [];
    [y - 1, y, y + 1].forEach(function (yy) {
      JIE.forEach(function (j) { jies.push(Date.UTC(yy, j.m - 1, j.d)); });
    });
    jies.sort(function (a, b) { return a - b; });
    var targetT = null;
    for (var k = 0; k < jies.length; k++) {
      if (forward) { if (jies[k] > birthT) { targetT = jies[k]; break; } }
      else { if (jies[k] < birthT) targetT = jies[k]; }
    }
    var days = forward
      ? Math.round((targetT - birthT) / 86400000)
      : Math.round((birthT - targetT) / 86400000);
    days = Math.max(0, days);
    var startAge = Math.floor(days / 3);
    var startMonth = (days % 3) * 4; // 1 天 ≈ 4 个月

    var g0 = mg.gi, z0 = mg.zi, steps = [];
    for (var i = 1; i <= 8; i++) {
      var g, z;
      if (forward) { g = (g0 + i) % 10; z = (z0 + i) % 12; }
      else { g = ((g0 - i) % 10 + 10) % 10; z = ((z0 - i) % 12 + 12) % 12; }
      var a0 = startAge + (i - 1) * 10;
      steps.push({ gan: GAN[g], zhi: ZHI[z], age: a0 + '–' + (a0 + 9) + '岁' });
    }
    return { forward: forward, days: days, startAge: startAge, startMonth: startMonth, steps: steps };
  }

  // ---- 详实解读 ----
  function interpret(bz) {
    var lines = [];
    var s = bz.strength;
    var strong = s.score >= 60 ? '偏强' : (s.score <= 40 ? '偏弱' : '中和');
    lines.push('【命盘总览】四柱：' + bz.yg.gan + bz.yg.zhi + ' ' + bz.mg.gan + bz.mg.zhi + ' ' +
      bz.dg.gan + bz.dg.zhi + ' ' + bz.hg.gan + bz.zhis[3] + '。');
    lines.push('日主为 ' + bz.dayGan + '（' + bz.dayMaster + '），强弱指数 ' + s.score + '/100，属' + strong + '之命。');
    var wxOrder = ['木','火','土','金','水'];
    var wxStr = wxOrder.map(function (w) { return w + bz.cnt[w]; }).join(' ');
    lines.push('五行分布：' + wxStr + '。');
    var missing = wxOrder.filter(function (w) { return bz.cnt[w] === 0; });
    lines.push(missing.length ? ('五行缺：' + missing.join('、') + '。') : '五行俱全，无明显偏枯。');
    lines.push('喜用五行：' + s.like.join('、') + '（趋吉补缺之向）。');
    // 十神格局简述
    var ss = bz.shishen;
    var allSS = [ss.yearGan, ss.yearZhi, ss.monthGan, ss.monthZhi, ss.dayZhi, ss.hourGan, ss.hourZhi];
    var countSS = {};
    allSS.forEach(function (x) { countSS[x] = (countSS[x] || 0) + 1; });
    var top = Object.keys(countSS).sort(function (a, b) { return countSS[b] - countSS[a]; }).slice(0, 3);
    lines.push('十神格局：以日主为轴，见 ' + top.join('、') + ' 较显，主其事象。');
    // 大运
    var du = bz.dayun;
    lines.push('大运：' + (du.forward ? '顺排' : '逆排') + '，约 ' + du.startAge + '岁' + du.startMonth + '个月起运；首运 ' +
      du.steps[0].gan + du.steps[0].zhi + '（' + du.steps[0].age + '）。');
    return lines.join('\n');
  }

  return {
    GAN: GAN, ZHI: ZHI, WX: WX, GAN_YIN: GAN_YIN, CYC: CYC,
    sheng: sheng, ke: ke, shishen: shishen, bazi: bazi, dayun: dayun, interpret: interpret
  };
});
