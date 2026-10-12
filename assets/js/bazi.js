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

  // 十神生活化释义（用于详实解读，把"符号"翻成"人事"）
  var SS_MEAN = {
    '比肩': '同辈并肩、自力为主，朋友同侪之象',
    '劫财': '同辈争财、慷慨好施，亦须防分夺',
    '食神': '才华流露、口福子息，温和而能输出',
    '伤官': '才思外露、叛逆创新，言辞锋利不羁',
    '正财': '稳定进财、勤劳所得，男命亦主妻星',
    '偏财': '流动之财、意外之得，男命亦主偏缘',
    '正官': '规矩功名、职位声誉，女命亦主夫星',
    '七杀': '威权压力、魄力挑战，女命亦主偏夫',
    '正印': '荫护学业、文书贵人，母性之源',
    '偏印': '冷门才学、偏业灵感，亦主孤僻'
  };
  // 五行 → 所主脏腑（仅作文化联想，非医学）
  var ORGAN = { 木: '肝', 火: '心', 土: '脾胃', 金: '肺', 水: '肾' };

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

  // ---- 详实解读（分章节）----
  function interpret(bz) {
    var lines = [];
    var s = bz.strength;
    var strong = s.score >= 60 ? '偏强' : (s.score <= 40 ? '偏弱' : '中和');
    var order = ['木', '火', '土', '金', '水'];

    lines.push('【一 · 命盘总览】');
    lines.push('四柱八字：' + bz.yg.gan + bz.yg.zhi + '（年）　' + bz.mg.gan + bz.mg.zhi + '（月）　' +
      bz.dg.gan + bz.dg.zhi + '（日）　' + bz.hg.gan + bz.zhis[3] + '（时）。');
    lines.push('日主即"我"：' + bz.dayGan + '（' + bz.dayMaster + '）。强弱指数 ' + s.score + '/100，属' + strong + '之命。');
    lines.push('');

    lines.push('【二 · 五行分布与偏枯】');
    var wxStr = order.map(function (w) { return w + bz.cnt[w]; }).join('　');
    lines.push('五行（天干、地支同计其本气）：' + wxStr + '。');
    var missing = order.filter(function (w) { return bz.cnt[w] === 0; });
    if (missing.length) {
      lines.push('五行缺：' + missing.join('、') + '。于身体联想，所主' +
        missing.map(function (w) { return ORGAN[w]; }).join('、') + '之气偏弱，宜加顾惜（仅为文化联想，非医学论断）。');
    } else {
      lines.push('五行俱全，无明显偏枯。');
    }
    lines.push('平衡度 ' + s.balance + '/100' +
      (s.balance >= 70 ? '，五行尚匀。' : (s.balance >= 45 ? '，略有偏倾。' : '，偏枯明显，宜留心调和。')));
    lines.push('');

    lines.push('【三 · 喜用神与趋避】');
    lines.push('喜用五行：' + s.like.join('、') + '。');
    lines.push('偏弱之命，宜"生扶"——补足同类（比劫）与"生我"者（印）；偏强之命，宜"克泄耗"——以官杀约之、食伤泄之、财星耗之。');
    lines.push('此乃古人"扶抑"之法的通俗表达：命局哪边缺，便往哪边补。');
    lines.push('');

    lines.push('【四 · 十神格局详析】');
    var ss = bz.shishen;
    var pillars = [
      ['年柱（祖上、幼年）', ss.yearGan, ss.yearZhi],
      ['月柱（父母、事业根基）', ss.monthGan, ss.monthZhi],
      ['日支（配偶、内心）', ss.dayZhi],
      ['时柱（子女、晚年）', ss.hourGan, ss.hourZhi]
    ];
    pillars.forEach(function (o) {
      var parts = [];
      for (var i = 1; i < o.length; i++) { if (o[i] && o[i] !== '?') parts.push(o[i] + '（' + SS_MEAN[o[i]] + '）'); }
      lines.push(o[0] + '：' + (parts.length ? parts.join('；') + '。' : '无显象。'));
    });
    var allSS = [ss.yearGan, ss.yearZhi, ss.monthGan, ss.monthZhi, ss.dayZhi, ss.hourGan, ss.hourZhi];
    var cntSS = {};
    allSS.forEach(function (x) { if (x && x !== '?') cntSS[x] = (cntSS[x] || 0) + 1; });
    var top = Object.keys(cntSS).sort(function (a, b) { return cntSS[b] - cntSS[a]; }).slice(0, 3);
    lines.push('综合来看，' + top.join('、') + ' 三象较显，主导命局气象与人生侧重。');
    lines.push('');

    lines.push('【五 · 大运走势】');
    var du = bz.dayun;
    lines.push('大运' + (du.forward ? '顺排（阳年男 / 阴年女）' : '逆排（阴年男 / 阳年女）') +
      '，约 ' + du.startAge + ' 岁 ' + du.startMonth + ' 个月起运。');
    lines.push('前十步大运：' + du.steps.slice(0, 5).map(function (st) { return st.gan + st.zhi + '(' + st.age + ')'; }).join('，') + ' …');
    lines.push('大运如季节轮转，十年一换；叠加逐年"流年"，方知某段顺逆、某年当动当守。');
    lines.push('');

    lines.push('【六 · 同八字之众】');
    var sb = sameBazi();
    lines.push('八字合法组合共 ' + sb.total.toLocaleString() + ' 局（60×12×60×12）。以当世人口计，与君同此八字者，全球约 ' +
      sb.world.toLocaleString() + ' 人、中华大地约 ' + sb.china.toLocaleString() + ' 人。');
    lines.push('同八字而命运各异，足见八字仅为天地一时之"编码"，绝非人生定数——运在人为。');
    return lines.join('\n');
  }

  // ---- 同八字人数估算 ----
  // 合法八字组合：年60 × 月12（受年干约束） × 日60 × 时12（受日干约束）= 518400
  function sameBazi() {
    var TOTAL = 518400;
    var WORLD = 8100000000, CHINA = 1410000000; // 约数，仅作量级示意
    return {
      total: TOTAL,
      world: Math.round(WORLD / TOTAL),
      china: Math.round(CHINA / TOTAL)
    };
  }

  // ---- 八字指纹（四柱串，用于后期同八字社群匹配）----
  function fingerprint(bz) {
    return bz.yg.gan + bz.yg.zhi + '·' + bz.mg.gan + bz.mg.zhi + '·' +
      bz.dg.gan + bz.dg.zhi + '·' + bz.hg.gan + bz.zhis[3];
  }

  return {
    GAN: GAN, ZHI: ZHI, WX: WX, GAN_YIN: GAN_YIN, CYC: CYC,
    sheng: sheng, ke: ke, shishen: shishen, bazi: bazi, dayun: dayun,
    interpret: interpret, sameBazi: sameBazi, fingerprint: fingerprint
  };
});
