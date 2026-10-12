/*
 * bazi.js — 八字推演核心（四柱 / 十神 / 五行 / 日主强弱 / 大运 / 解读）
 * UMD: 浏览器挂 window.Bazi；Node 可 require 验证。
 * 说明：年/月柱未严格按节气校正（按公历月近似），仅供文化与娱乐。
 * 双语：所有输出函数支持 lang 参数（'zh' 默认 | 'en'），不传时行为与旧版一致。
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

  // ===================== 中英对照表 =====================
  var GAN_EN = {甲:'Jia',乙:'Yi',丙:'Bing',丁:'Ding',戊:'Wu',己:'Ji',庚:'Geng',辛:'Xin',壬:'Ren',癸:'Gui'};
  var ZHI_EN = {子:'Rat',丑:'Ox',寅:'Tiger',卯:'Rabbit',辰:'Dragon',巳:'Snake',
                午:'Horse',未:'Goat',申:'Monkey',酉:'Rooster',戌:'Dog',亥:'Pig'};
  var WX_EN  = {木:'Wood',火:'Fire',土:'Earth',金:'Metal',水:'Water'};
  var SS_EN  = {'比肩':'Friend','劫财':'Rob Wealth','食神':'Eating God','伤官':'Hurting Officer',
                '正财':'Direct Wealth','偏财':'Indirect Wealth','正官':'Direct Officer','七杀':'Seven Killings',
                '正印':'Direct Seal','偏印':'Indirect Seal'};
  function isEn(lang) { return lang === 'en'; }
  function W(w, lang) { return isEn(lang) ? (WX_EN[w] || w) : w; }
  function SS(name, lang) { return isEn(lang) ? (SS_EN[name] || name) : name; }
  function gz(g, z, lang) { // 干支组合展示
    return isEn(lang) ? (GAN_EN[g] + ' ' + ZHI_EN[z]) : (g + z);
  }
  function joinList(arr, lang) { return isEn(lang) ? arr.join(', ') : arr.join('、'); }

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
    '比肩': { zh: '同辈并肩、自力为主，朋友同侪之象', en: 'peers shoulder to shoulder, self-reliance; the sign of friends and companions' },
    '劫财': { zh: '同辈争财、慷慨好施，亦须防分夺', en: 'peers competing for wealth, generous giving; guard against loss to others' },
    '食神': { zh: '才华流露、口福子息，温和而能输出', en: 'talent flowing out, pleasure and offspring; gentle yet expressive' },
    '伤官': { zh: '才思外露、叛逆创新，言辞锋利不羁', en: 'brilliant unorthodoxy, sharp and unconventional speech' },
    '正财': { zh: '稳定进财、勤劳所得，男命亦主妻星', en: 'steady earnings through diligence; for men, the spouse star' },
    '偏财': { zh: '流动之财、意外之得，男命亦主偏缘', en: 'windfalls and fluid gains; for men, secondary relationships' },
    '正官': { zh: '规矩功名、职位声誉，女命亦主夫星', en: 'proper rank and reputation; for women, the husband star' },
    '七杀': { zh: '威权压力、魄力挑战，女命亦主偏夫', en: 'authority under pressure, trials of daring; for women, secondary bonds' },
    '正印': { zh: '荫护学业、文书贵人，母性之源', en: 'the sheltering seal of study, documents and benefactors; the motherly source' },
    '偏印': { zh: '冷门才学、偏业灵感，亦主孤僻', en: 'unconventional learning and quirky inspiration; also solitude' }
  };
  // 五行 → 所主脏腑（仅作文化联想，非医学）
  var ORGAN = {
    木: { zh: '肝', en: 'the liver' },
    火: { zh: '心', en: 'the heart' },
    土: { zh: '脾胃', en: 'the stomach and spleen' },
    金: { zh: '肺', en: 'the lungs' },
    水: { zh: '肾', en: 'the kidneys' }
  };

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
  function interpret(bz, lang) {
    var en = isEn(lang);
    var lines = [];
    var s = bz.strength;
    var strong = s.score >= 60 ? '偏强' : (s.score <= 40 ? '偏弱' : '中和');
    var strongEn = s.score >= 60 ? 'strong' : (s.score <= 40 ? 'weak' : 'balanced');
    var order = ['木', '火', '土', '金', '水'];

    lines.push(en ? 'I · Chart Overview' : '【一 · 命盘总览】');
    if (en) {
      lines.push('Four Pillars: ' + gz(bz.yg.gan, bz.yg.zhi, 'en') + ' (Year) · ' + gz(bz.mg.gan, bz.mg.zhi, 'en') + ' (Month) · ' +
        gz(bz.dg.gan, bz.dg.zhi, 'en') + ' (Day) · ' + gz(bz.hg.gan, bz.zhis[3], 'en') + ' (Hour).');
      lines.push('The Day Master is "I": ' + GAN_EN[bz.dayGan] + ' (' + W(bz.dayMaster, 'en') + '). Strength index ' + s.score + '/100 — a ' + strongEn + ' chart.');
    } else {
      lines.push('四柱八字：' + bz.yg.gan + bz.yg.zhi + '（年）　' + bz.mg.gan + bz.mg.zhi + '（月）　' +
        bz.dg.gan + bz.dg.zhi + '（日）　' + bz.hg.gan + bz.zhis[3] + '（时）。');
      lines.push('日主即"我"：' + bz.dayGan + '（' + bz.dayMaster + '）。强弱指数 ' + s.score + '/100，属' + strong + '之命。');
    }
    lines.push('');

    lines.push(en ? 'II · The Five Phases' : '【二 · 五行分布与偏枯】');
    var wxStr = order.map(function (w) { return W(w, lang) + bz.cnt[w]; }).join(en ? '  ' : '　');
    if (en) lines.push('Five phases (counting stems, branches and their hidden stems): ' + wxStr + '.');
    else lines.push('五行（天干、地支同计其本气）：' + wxStr + '。');
    var missing = order.filter(function (w) { return bz.cnt[w] === 0; });
    if (missing.length) {
      if (en) {
        lines.push('Missing: ' + missing.map(function (w) { return W(w, 'en'); }).join(', ') +
          '. By cultural association, ' + missing.map(function (w) { return ORGAN[w].en; }).join(', ') +
          ' may run thin — tend them gently (a cultural note, not medicine).');
      } else {
        lines.push('五行缺：' + missing.join('、') + '。于身体联想，所主' +
          missing.map(function (w) { return ORGAN[w].zh; }).join('、') + '之气偏弱，宜加顾惜（仅为文化联想，非医学论断）。');
      }
    } else {
      lines.push(en ? 'All five phases present — no glaring imbalance.' : '五行俱全，无明显偏枯。');
    }
    var balTxt = s.balance >= 70 ? (en ? 'well proportioned.' : '，五行尚匀。')
      : (s.balance >= 45 ? (en ? 'slightly tilted.' : '，略有偏倾。')
      : (en ? 'markedly skewed — mind the balancing.' : '，偏枯明显，宜留心调和。'));
    lines.push(en ? ('Balance ' + s.balance + '/100 — ' + balTxt) : ('平衡度 ' + s.balance + '/100' + balTxt));
    lines.push('');

    lines.push(en ? 'III · Favorable Elements' : '【三 · 喜用神与趋避】');
    if (en) {
      lines.push('Favorable phases: ' + s.like.map(function (w) { return W(w, 'en'); }).join(', ') + '.');
      lines.push('A weak chart is "supported" — add what is kin (peers) and what feeds you (seal); a strong chart is "drained" — check it with officer, vent it through talent, spend it through wealth.');
      lines.push('This is the old "support-and-check" method in plain words: whatever the chart lacks, that is the direction to lean.');
    } else {
      lines.push('喜用五行：' + s.like.join('、') + '。');
      lines.push('偏弱之命，宜"生扶"——补足同类（比劫）与"生我"者（印）；偏强之命，宜"克泄耗"——以官杀约之、食伤泄之、财星耗之。');
      lines.push('此乃古人"扶抑"之法的通俗表达：命局哪边缺，便往哪边补。');
    }
    lines.push('');

    lines.push(en ? 'IV · The Ten Deities in Detail' : '【四 · 十神格局详析】');
    var ss = bz.shishen;
    var pillars = en
      ? [['Year pillar (ancestors, early years)', ss.yearGan, ss.yearZhi],
         ['Month pillar (parents, career roots)', ss.monthGan, ss.monthZhi],
         ['Day branch (spouse, inner self)', ss.dayZhi],
         ['Hour pillar (children, late years)', ss.hourGan, ss.hourZhi]]
      : [['年柱（祖上、幼年）', ss.yearGan, ss.yearZhi],
         ['月柱（父母、事业根基）', ss.monthGan, ss.monthZhi],
         ['日支（配偶、内心）', ss.dayZhi],
         ['时柱（子女、晚年）', ss.hourGan, ss.hourZhi]];
    pillars.forEach(function (o) {
      var parts = [];
      for (var i = 1; i < o.length; i++) {
        if (o[i] && o[i] !== '?') {
          parts.push(SS(o[i], lang) + ' (' + SS_MEAN[o[i]][en ? 'en' : 'zh'] + ')');
        }
      }
      lines.push(o[0] + (en ? ': ' : '：') + (parts.length ? parts.join(en ? '; ' : '；') + (en ? '.' : '。') : (en ? 'no clear sign.' : '无显象。')));
    });
    var allSS = [ss.yearGan, ss.yearZhi, ss.monthGan, ss.monthZhi, ss.dayZhi, ss.hourGan, ss.hourZhi];
    var cntSS = {};
    allSS.forEach(function (x) { if (x && x !== '?') cntSS[x] = (cntSS[x] || 0) + 1; });
    var top = Object.keys(cntSS).sort(function (a, b) { return cntSS[b] - cntSS[a]; }).slice(0, 3);
    if (en) {
      lines.push('Taken together, ' + top.map(function (x) { return SS(x, 'en'); }).join(', ') + ' stand out, setting the tone of the chart and the emphasis of a life.');
    } else {
      lines.push('综合来看，' + top.join('、') + ' 三象较显，主导命局气象与人生侧重。');
    }
    lines.push('');

    lines.push(en ? 'V · Fortune Cycles' : '【五 · 大运走势】');
    var du = bz.dayun;
    if (en) {
      lines.push('Fortune cycles run ' + (du.forward ? 'forward (yang-year male / yin-year female)' : 'backward (yin-year male / yang-year female)') +
        ', starting around age ' + du.startAge + ' years ' + du.startMonth + ' months.');
      lines.push('The next five cycles: ' + du.steps.slice(0, 5).map(function (st) { return gz(st.gan, st.zhi, 'en') + ' (' + st.age.replace('岁', '') + ')'; }).join(', ') + ' …');
      lines.push('Cycles turn like seasons, one every ten years; read them against each year’s annual influence to know when to move and when to hold.');
    } else {
      lines.push('大运' + (du.forward ? '顺排（阳年男 / 阴年女）' : '逆排（阴年男 / 阳年女）') +
        '，约 ' + du.startAge + ' 岁 ' + du.startMonth + ' 个月起运。');
      lines.push('前十步大运：' + du.steps.slice(0, 5).map(function (st) { return st.gan + st.zhi + '(' + st.age + ')'; }).join('，') + ' …');
      lines.push('大运如季节轮转，十年一换；叠加逐年"流年"，方知某段顺逆、某年当动当守。');
    }
    lines.push('');

    lines.push(en ? 'VI · How Many Share Your Chart' : '【六 · 同八字之众】');
    var sb = sameBazi();
    if (en) {
      lines.push('There are ' + sb.total.toLocaleString() + ' valid charts (60×12×60×12). Among the world’s people, roughly ' +
        sb.world.toLocaleString() + ' share yours worldwide, about ' + sb.china.toLocaleString() + ' across China.');
      lines.push('Identical charts, different fates — proof that BaZi is but a momentary code of Heaven and Earth, never a fixed destiny. The turning is in human hands.');
    } else {
      lines.push('八字合法组合共 ' + sb.total.toLocaleString() + ' 局（60×12×60×12）。以当世人口计，与君同此八字者，全球约 ' +
        sb.world.toLocaleString() + ' 人、中华大地约 ' + sb.china.toLocaleString() + ' 人。');
      lines.push('同八字而命运各异，足见八字仅为天地一时之"编码"，绝非人生定数——运在人为。');
    }
    return lines.join('\n');
  }

  // =====================================================================
  //  人生推论 + 大运详批（性格 / 命运 / 事业 / 财运 / 感情人际 / 逐运解析）
  // =====================================================================
  // 日主五行 → 性格基调
  var DM_PERSONA = {
    '木': {
      core:  { zh: '木主仁，性直而向上，有生机与韧劲，如春木向阳。', en: 'Wood governs benevolence: upright and reaching upward, full of vitality and resilience, like spring wood turning to the sun.' },
      strong:{ zh: '木气偏盛，则主见强、行动果决，然亦须防过于刚直、不善迂回。', en: 'With wood in excess, opinions run firm and action is decisive — but beware bluntness and a poor gift for detours.' },
      weak:  { zh: '木气偏弱，则外柔内秀、思虑周详，然魄力稍欠，宜借火（礼）以扬、借水（智）以润。', en: 'With wood running thin, you are gentle outside and thoughtful within — yet daring lags; borrow fire (courtesy) to shine and water (wisdom) to moisten.' },
      balanced: { zh: '木性中和，刚柔相济，能直能曲，宜循势而为。', en: 'With wood in balance, firmness and pliancy blend — able to stand straight or to bend as the moment asks.' }
    },
    '火': {
      core:  { zh: '火主礼，性热而明快，热情外露、善表达，如夏日当空。', en: 'Fire governs courtesy: warm and quick, passionate and expressive, like the summer sun at noon.' },
      strong:{ zh: '火气偏盛，则精力旺、感染力强，然性急易躁，须以水（智）济之、以静制动。', en: 'With fire in excess, energy and charm abound — yet haste and temper follow; let water (wisdom) temper it, and meet motion with stillness.' },
      weak:  { zh: '火气偏弱，则内秀温和、不喜张扬，宜借木（仁）以生、借火以暖。', en: 'With fire running thin, you are warm but inward, disinclined to show; borrow wood (benevolence) to feed it and fire to warm it.' },
      balanced: { zh: '火性中和，明而不炽，热而不躁，宜以恒久养其光。', en: 'With fire in balance, bright without blazing, warm without haste — keep the flame with constancy.' }
    },
    '土': {
      core:  { zh: '土主信，性稳而包容，踏实诚信、重情义，如大地载物。', en: 'Earth governs trust: steady and containing, honest and devoted, like the ground that carries all things.' },
      strong:{ zh: '土气偏盛，则稳健可靠、能扛事，然或显迟重，宜借金（义）以疏、借木以达。', en: 'With earth in excess, you are reliable and can carry weight — but may grow heavy; borrow metal (resolve) to cut through and wood to reach out.' },
      weak:  { zh: '土气偏弱，则心性浮动、根基未稳，宜借火（礼）以生、借土以培。', en: 'With earth running thin, the heart drifts and roots are shallow; borrow fire (courtesy) to feed it and earth to build it up.' },
      balanced: { zh: '土性中和，稳而不滞，厚而不板，宜以信义立身而济之以通变。', en: 'With earth in balance, steady without stagnation, thick without stiffness — stand on trust, and keep room to adapt.' }
    },
    '金': {
      core:  { zh: '金主义，性刚而决断，重规则、有锋芒，如秋金肃杀。', en: 'Metal governs resolve: firm and decisive, rule-keeping and sharp, like autumn metal, keen and clean.' },
      strong:{ zh: '金气偏盛，则刚毅果敢、律己严，然或显冷峻，宜借水（智）以润、借火以炼。', en: 'With metal in excess, you are resolute and self-disciplined — but may turn cold; borrow water (wisdom) to moisten and fire to temper.' },
      weak:  { zh: '金气偏弱，则心软寡断、易从众，宜借土（信）以生、借金以坚。', en: 'With metal running thin, the heart is soft and slow to decide, prone to follow the crowd; borrow earth (trust) to feed it and metal to firm it.' },
      balanced: { zh: '金性中和，刚而能柔，断而不戾，宜以义断事、以礼待人。', en: 'With metal in balance, firm yet pliant, decisive without cruelty — judge by resolve, treat others with courtesy.' }
    },
    '水': {
      core:  { zh: '水主智，性灵而变通，机敏善谋、随方就圆，如江河行地。', en: 'Water governs wisdom: supple and adaptive, quick and resourceful, taking the shape of any channel, like a river finding its way.' },
      strong:{ zh: '水气偏盛，则智谋足、适应强，然或流于泛、少定性，宜借土（信）以堤、借木以导。', en: 'With water in excess, cunning and adaptability abound — yet may run scattered and rootless; borrow earth (trust) for banks and wood to channel it.' },
      weak:  { zh: '水气偏弱，则神思发散、定力不足，宜借金（义）以生、借水以养。', en: 'With water running thin, the mind scatters and focus slips; borrow metal (resolve) to feed it and water to nourish it.' },
      balanced: { zh: '水性中和，灵而不浮，变而有守，宜以智应物、以静制动。', en: 'With water in balance, clever without drifting, adaptive yet anchored — meet things with wisdom, and answer motion with stillness.' }
    }
  };
  // 主导十神 → 性格侧写
  var SS_TRAIT = {
    '比肩': { zh: '重同辈情谊、自力更生，然须防朋辈分财。', en: 'values peers and self-reliance, but must guard against friends sharing away the wealth.' },
    '劫财': { zh: '慷慨仗义、出手大方，然财易外流，宜明算账。', en: 'generous and loyal to a fault, quick to spend — keep the accounts clear.' },
    '食神': { zh: '温润有才、善表达与享生活，多具艺术或口福之缘。', en: 'warm, talented, fond of expression and the good life; often an artistic or epicurean bent.' },
    '伤官': { zh: '聪颖外露、敢破敢立，宜以才艺立身，然须谨言避锋。', en: 'brilliant and unconventional, daring to break and rebuild — live by your talent, and mind your tongue.' },
    '正财': { zh: '务实持重、勤劳生财，宜稳进积财、不宜投机。', en: 'pragmatic and steady, earning by diligence — accumulate patiently, avoid gambling on windfalls.' },
    '偏财': { zh: '机变通达、多有意外之得，宜以人脉与机会生财。', en: 'agile and well-connected, often with lucky gains — make wealth through people and openings.' },
    '正官': { zh: '循规守责、重名望，宜就公职或管理，然勿为规则所缚。', en: 'proper and dutiful, caring for standing — suits public service or management, but do not let rules own you.' },
    '七杀': { zh: '有魄力、能承压，宜闯宜管，然须防过刚招损、以印化之。', en: 'daring and pressure-proof, built to charge and to lead — but temper the edge with the seal.' },
    '正印': { zh: '沉静好学、得长辈荫护，宜以文以学立身。', en: 'quiet and studious, blessed by elders — build a life on letters and learning.' },
    '偏印': { zh: '独具冷门才华、善钻研，宜走专精之路，然防孤僻。', en: 'gifted in offbeat crafts and deep research — walk the specialist’s road, and guard against isolation.' }
  };
  function countSS(bz) {
    var ss = bz.shishen;
    var all = [ss.yearGan, ss.yearZhi, ss.monthGan, ss.monthZhi, ss.dayZhi, ss.hourGan, ss.hourZhi];
    var cnt = {};
    all.forEach(function (x) { if (x && x !== '?') cnt[x] = (cnt[x] || 0) + 1; });
    return cnt;
  }
  function topSS(bz, n) {
    var c = countSS(bz);
    return Object.keys(c).sort(function (a, b) { return c[b] - c[a]; }).slice(0, n || 2);
  }

  // 性格
  function personaText(bz, lang) {
    var en = isEn(lang);
    var s = bz.strength, dm = bz.dayMaster;
    var strong = s.score >= 60 ? '偏强' : (s.score <= 40 ? '偏弱' : '中和');
    var p = DM_PERSONA[dm];
    var mod = strong === '偏强' ? p.strong : (strong === '偏弱' ? p.weak : p.balanced);
    var top = topSS(bz, 2);
    var trait = top.map(function (t) { return SS_TRAIT[t] ? SS_TRAIT[t][en ? 'en' : 'zh'] : ''; }).join(en ? ' ' : '');
    if (en) {
      return 'A ' + GAN_EN[bz.dayGan] + ' Day Master (' + W(dm, 'en') + '): ' + p.core.en + ' ' + mod.en +
        (trait ? (' ' + top.map(function (t) { return SS(t, 'en'); }).join(' and ') + ' stand out — ' + trait) : '');
    }
    return '日主属「' + dm + '」：' + p.core.zh + mod.zh +
      (trait ? ('　命局中 ' + top.join('、') + ' 较显——' + trait) : '');
  }
  // 命运总论
  function destinyText(bz, lang) {
    var en = isEn(lang);
    var s = bz.strength, dm = bz.dayMaster, c = countSS(bz);
    var head;
    if (en) {
      head = s.score >= 60 ? 'The Day Master stands well-rooted and strong, able to carry wealth and office; life can be self-made, free to charge or to hold.'
        : (s.score <= 40 ? 'The Day Master runs weak; lean on the seal and peers, on mentors and organizations — solo struggle tires, gathering strength wins.'
        : 'The Day Master is balanced and turns with the cycles: smooth under favorable luck, hibernating under harsh luck — timing is everything.');
    } else {
      head = s.score >= 60 ? '日主得地得势、自身气足，能任财官，人生多能自立、可闯可守。'
        : (s.score <= 40 ? '日主偏弱，宜借印比之力、依贵人组织，单打独斗则易疲，聚势方成。'
        : '日主中和，随运而转，逢喜运则顺、逢忌运则蛰，重在审时。');
    }
    var body;
    if (en) {
      body = s.balance >= 70 ? 'The five phases are even, the temper seldom extreme; steady courses suit you, with few violent swings.'
        : (s.balance >= 45 ? 'The phases tilt slightly, so fortunes rise and fall a little; lean toward the favorable and ride the current.'
        : 'The phases are clearly skewed and swings run large; harmonize with the favorable phases and build the roots first.');
    } else {
      body = s.balance >= 70 ? '五行较匀，性情少偏，行事宜稳，起伏不剧。'
        : (s.balance >= 45 ? '五行略有偏倾，运程起伏稍显，宜就喜用而补、顺势而为。'
        : '五行偏枯较明显，运程起伏较大，宜以喜用五行调和、固本培元。');
    }
    var extra = '';
    if (en) {
      if ((c['正官'] || 0) + (c['七杀'] || 0) > 0 && (c['正印'] || 0) + (c['偏印'] || 0) > 0)
        extra = 'Officer and seal begetting each other — a share of foundation and reputation; ';
      else if ((c['正财'] || 0) + (c['偏财'] || 0) >= 2) extra = 'Wealth stars in force — a pragmatic bent for earning; ';
      else if ((c['食神'] || 0) + (c['伤官'] || 0) >= 2) extra = 'Talent stars spilling forth — a life built on craft and expression; ';
      return head + ' ' + body + (extra ? (extra + 'such is the chart’s leaning; when its cycle comes, it shows.') : 'such is the chart’s bearing; when its cycle comes, it shows.');
    }
    if ((c['正官'] || 0) + (c['七杀'] || 0) > 0 && (c['正印'] || 0) + (c['偏印'] || 0) > 0)
      extra = '官印相生，主有根基与名望之缘；';
    else if ((c['正财'] || 0) + (c['偏财'] || 0) >= 2) extra = '财星有气，主务实生财之缘；';
    else if ((c['食神'] || 0) + (c['伤官'] || 0) >= 2) extra = '食伤吐秀，主才艺立身之缘；';
    return head + body + (extra ? (extra + '此乃命局所偏，运来则彰。') : '此乃命局所主，运来则彰。');
  }
  // 事业
  function careerText(bz, lang) {
    var en = isEn(lang);
    var c = countSS(bz), s = bz.strength, lines = [];
    if (en) {
      if ((c['正官'] || 0) + (c['七杀'] || 0) > 0 && (c['正印'] || 0) + (c['偏印'] || 0) > 0)
        lines.push('Officer with seal — best in public service, management, education or law: a life standing on name and letters.');
      if ((c['正财'] || 0) + (c['偏财'] || 0) >= 2)
        lines.push('Wealth stars in force — good for commerce, finance and industry, making money through resources and contacts.');
      if ((c['食神'] || 0) + (c['伤官'] || 0) >= 2)
        lines.push('Talent stars spilling — craft, creativity, expression and freelance work, distinguished by skill.');
      if ((c['比肩'] || 0) + (c['劫财'] || 0) >= 2)
        lines.push('Peers in throngs — partnerships, teams and sales; get things done through your own kind.');
      if (!lines.length) lines.push('The ten deities are even — follow your nature step by step; no sudden change of track.');
      if (s.score < 45) lines.push('Yet the self runs weak: at first lean on platforms and elders; press on when a favorable cycle aids you.');
      else if (s.score >= 60) lines.push('Strong enough to carry the work — you can stand alone and take charge.');
      return lines.join(' ');
    }
    if ((c['正官'] || 0) + (c['七杀'] || 0) > 0 && (c['正印'] || 0) + (c['偏印'] || 0) > 0)
      lines.push('官印相生——最宜公职、管理、文教、法务等"以名以文立身"之途。');
    if ((c['正财'] || 0) + (c['偏财'] || 0) >= 2)
      lines.push('财星有气——宜商、宜金融实业、宜以资源与人脉生财。');
    if ((c['食神'] || 0) + (c['伤官'] || 0) >= 2)
      lines.push('食伤吐秀——宜技艺、创意、表达、自由职业，以才艺见长。');
    if ((c['比肩'] || 0) + (c['劫财'] || 0) >= 2)
      lines.push('比劫成群——宜合伙、团队、销售，借同辈之力成事。');
    if (!lines.length) lines.push('十神均衡，宜依性之所近、循序渐进，不宜贸然转轨。');
    if (s.score < 45) lines.push('唯身偏弱，初宜依托平台与长辈，待喜用大运助身再图进取。');
    else if (s.score >= 60) lines.push('身强足以任事，可独当一面、担纲负责。');
    return lines.join('　');
  }
  // 财运
  function wealthText(bz, lang) {
    var en = isEn(lang);
    var c = countSS(bz), s = bz.strength, t = [];
    var cai = (c['正财'] || 0) + (c['偏财'] || 0);
    if (en) {
      if (cai === 0) t.push('Wealth stars do not show; steady salary is not the lead note — make money from a skill (talent stars) or guard it through office, and do not stake all on windfalls.');
      else if (s.score >= 60) t.push('A strong self with wealth stars in force — "self and wealth both abundant"; advance, invest, and what comes can be kept.');
      else t.push('Wealth stars appear but the self runs weak — "much wealth, weak bearer"; share the gains with partners, accumulate small and steady, never greedy for the big score.');
      if ((c['偏财'] || 0) > 0) t.push('Indirect wealth peeks through — windfalls and money through people; widen your circle and watch for turns.');
      return t.join(' ');
    }
    if (cai === 0) t.push('命局财星不显，正财非主打，宜以一技之长（食伤）生财、或以职位（官）护财，不宜押宝横财。');
    else if (s.score >= 60) t.push('身强而财星有气，乃"身财两旺"之象，宜进取、宜理财积累，财来能守。');
    else t.push('财星虽现而身偏弱，乃"财多身弱"之象，宜合作分财、稳进积小，切忌贪大冒进、独木难支。');
    if ((c['偏财'] || 0) > 0) t.push('偏财透出，多有意外之得与人脉财机，宜广结善缘、留意机变。');
    return t.join('　');
  }
  // 感情人际
  function relationText(bz, lang) {
    var en = isEn(lang);
    var ss = bz.shishen, c = countSS(bz), s = bz.strength, sex = bz.raw.sex, t = [];
    var sp = SS(ss.dayZhi, lang);
    if (en) {
      if (sex === '男') {
        t.push('For men, wealth stars are the spouse (direct for the true match, indirect for the secondary), and the day branch is the spouse palace.');
        if ((c['正财'] || 0) + (c['偏财'] || 0) === 0) t.push('With no wealth star showing, marriage may come late or through introduction — do not rush.');
        else t.push('Wealth stars have root, so the match is not thin; the day branch sits on "' + sp + '", and the spouse’s image already shows.');
      } else {
        t.push('For women, officer stars are the husband (direct for the true match, seven killings for the secondary), and the day branch is the spouse palace.');
        if ((c['正官'] || 0) + (c['七杀'] || 0) === 0) t.push('With no officer star showing, let the match ripen slowly; you may meet them in a favorable cycle.');
        else t.push('Officer stars have root, so the bond can be expected; the day branch sits on "' + sp + '", and the spouse’s image already shows.');
      }
      if ((c['比肩'] || 0) + (c['劫财'] || 0) >= 2) t.push('Peers run strong — in love, beware the "contest" (a third party, rivalry among friends); lead with honesty and steadiness.');
      if (s.score < 45) t.push('With a weak self, you tend to yield and lack a stand in love; choose someone who can shelter and share the load.');
      return t.join(' ');
    }
    if (sex === '男') {
      t.push('男以财星为妻星（正财正缘、偏财偏缘），日支为配偶宫。');
      if ((c['正财'] || 0) + (c['偏财'] || 0) === 0) t.push('财星不显，姻缘宜迟、宜经人介绍，勿躁进。');
      else t.push('财星有根，妻缘不薄；日支坐「' + sp + '」，配偶之象已露。');
    } else {
      t.push('女以官杀为夫星（正官正缘、七杀偏缘），日支为配偶宫。');
      if ((c['正官'] || 0) + (c['七杀'] || 0) === 0) t.push('官星不显，姻缘宜缓、宜在喜用大运中遇人。');
      else t.push('官杀有根，夫缘可期；日支坐「' + sp + '」，配偶之象已露。');
    }
    if ((c['比肩'] || 0) + (c['劫财'] || 0) >= 2) t.push('比劫偏旺，感情中须防"竞夺"之象（如第三者、朋辈之争），以诚以稳为先。');
    if (s.score < 45) t.push('身偏弱，感情中易迁就、缺主见，宜择能护己、能共担之人。');
    return t.join('　');
  }

  // 大运逐运详批
  var DY_SS = {
    '正官': { zh: '利于名望职位、规矩成事，宜就公职管理', en: 'favoring standing and proper office — public service or management' },
    '七杀': { zh: '压力与机遇并存，宜闯宜担，以魄力破局', en: 'pressure and opportunity together — charge and carry, break through with daring' },
    '正印': { zh: '利于求学、得长辈贵人荫护，宜静修积累', en: 'favoring study and the shelter of elders — cultivate quietly and accumulate' },
    '偏印': { zh: '利于钻研冷门才学，宜走专精之路', en: 'favoring offbeat crafts — walk the specialist’s road' },
    '正财': { zh: '利于稳定进财、勤劳所得，宜稳积', en: 'favoring steady earnings through diligence — accumulate patiently' },
    '偏财': { zh: '利于机会之财、人脉生财，留意机变', en: 'favoring opportunistic and people-made wealth — watch for turns' },
    '食神': { zh: '利于才华流露、口福子息，宜以才艺立身', en: 'favoring talent, pleasure and offspring — live by your craft' },
    '伤官': { zh: '利于创新表达，宜展所长，然谨言避锋', en: 'favoring innovation and expression — show your gift, mind your tongue' },
    '比肩': { zh: '利于同辈并肩、自力，宜合伙，防分财', en: 'favoring peers and self-reliance — partner up, guard against sharing away gains' },
    '劫财': { zh: '利于出手帮扶，然财易外流，明算账为上', en: 'favoring help given freely — but money leaks; keep clear accounts' }
  };
  function dayunSentence(st, s, lang) {
    var en = isEn(lang);
    var key = st.ssGan !== '?' ? st.ssGan : st.ssZhi;
    var dy = DY_SS[key] ? DY_SS[key][en ? 'en' : 'zh'] : '';
    var base;
    if (en) {
      if (st.xiji === '喜') {
        if (s.score >= 60) base = '[Favorable] A favorable element in command, and the self strong enough to carry it — a season for real ambition.';
        else if (s.score <= 40) base = '[Favorable] Though favorable, the self still runs weak — advance with the current, not by force.';
        else base = '[Favorable] The favorable element takes hold and the cycle turns smooth — seize the opening.';
      } else {
        if (s.score >= 60) base = '[Unfavorable] The unfavorable stirs, but a strong self can bear it — hold the middle and the harm stays small.';
        else if (s.score <= 40) base = '[Unfavorable] Unfavorable weight on a weak self — lie low and gather strength; move not, lest loss and quarrels come.';
        else base = '[Unfavorable] The unfavorable holds the cycle under pressure — keep what you have and bide your time.';
      }
      return base + (dy ? (' ' + dy + '.') : '');
    }
    if (st.xiji === '喜') {
      if (s.score >= 60) base = '〔喜〕喜用当令，且日主足以任之，正是大有可为之时。';
      else if (s.score <= 40) base = '〔喜〕虽为喜运，日主尚弱，宜借势渐进、勿贪猛进。';
      else base = '〔喜〕喜用得力，运程转顺，宜把握机遇。';
    } else {
      if (s.score >= 60) base = '〔忌〕忌神虽扰，日主强足以扛，守中为上、可化小凶。';
      else if (s.score <= 40) base = '〔忌〕忌神叠加身弱，宜蛰伏养元、勿妄动，防灾耗是非。';
      else base = '〔忌〕忌神当值，运程承压，宜守成蓄势。';
    }
    return base + (dy ? (' ' + dy + '。') : '');
  }
  function dayunDetail(bz) {
    var du = bz.dayun, s = bz.strength, like = bz.strength.like, dg = bz.dayGan;
    return du.steps.map(function (st) {
      var wg = WX[st.gan], wz = WX[st.zhi];
      var ssG = shishen(dg, st.gan), ssZ = shishenOfZhi(dg, st.zhi);
      var xiji = (like.indexOf(wg) >= 0 || like.indexOf(wz) >= 0) ? '喜' : '忌';
      return {
        gan: st.gan, zhi: st.zhi, age: st.age,
        wxGan: wg, wxZhi: wz, ssGan: ssG, ssZhi: ssZ, xiji: xiji,
        desc: dayunSentence({ ssGan: ssG, ssZhi: ssZ, xiji: xiji }, s, 'zh')
      };
    });
  }
  function dayunDetailText(bz, lang) {
    var en = isEn(lang);
    var du = bz.dayun;
    var fav = dayunDetail(bz).filter(function (d) { return d.xiji === '喜'; }).length;
    var head;
    if (en) {
      head = 'Cycles run ' + (du.forward ? 'forward' : 'backward') + ', starting around age ' + du.startAge + ' years ' + du.startMonth +
        ' months; one every ten years, and the turns of a life show in their order. Below, each cycle in turn — [Favorable] ones to seize, [Unfavorable] ones to hold.' +
        (fav ? ('Of the eight cycles, ' + fav + ' are favorable — not a bad chart at all.') : 'Few favorable cycles in the eight — borrow from annual luck and your own diligence.');
    } else {
      head = '大运' + (du.forward ? '顺排' : '逆排') + '，约 ' + du.startAge + ' 岁 ' + du.startMonth +
        ' 个月起运；十年一换，顺逆之间见人生起伏。下列逐运，〔喜〕者当把握、〔忌〕者宜守成。' +
        (fav ? ('全运八步中有 ' + fav + ' 步为喜用之运，已属不错之命局。') : '全运八步喜用不多，宜借流年小运与自身勤勉补之。');
    }
    var lines = [head];
    dayunDetail(bz).forEach(function (d, i) {
      if (en) {
        lines.push('Cycle ' + (i + 1) + '　' + gz(d.gan, d.zhi, 'en') +
          ' (' + d.age.replace('岁', '') + ')　stem ' + GAN_EN[d.gan] + ' (' + W(d.wxGan, 'en') + '·' + SS(d.ssGan, 'en') + ')　branch ' + ZHI_EN[d.zhi] +
          ' (' + W(d.wxZhi, 'en') + '·' + SS(d.ssZhi, 'en') + '): ' + dayunSentence(d, bz.strength, 'en'));
      } else {
        lines.push('第' + ['一','二','三','四','五','六','七','八'][i] + '运　' + d.gan + d.zhi +
          '（' + d.age + '）　干' + d.gan + '（' + d.wxGan + '·' + d.ssGan + '）　支' + d.zhi +
          '（' + d.wxZhi + '·' + d.ssZhi + '）：' + dayunSentence(d, bz.strength, 'zh'));
      }
    });
    return lines.join('\n');
  }

  // 结构化人生推论
  function lifeReading(bz, lang) {
    return {
      personality: personaText(bz, lang),
      destiny: destinyText(bz, lang),
      career: careerText(bz, lang),
      wealth: wealthText(bz, lang),
      relationship: relationText(bz, lang)
    };
  }
  function lifeReadingText(bz, lang) {
    var en = isEn(lang);
    var r = lifeReading(bz, lang);
    if (en) {
      return 'Personality\n' + r.personality + '\n\nDestiny\n' + r.destiny +
        '\n\nCareer\n' + r.career + '\n\nWealth\n' + r.wealth +
        '\n\nLove & Relations\n' + r.relationship;
    }
    return '【性格】\n' + r.personality + '\n\n【命运总论】\n' + r.destiny +
      '\n\n【事业】\n' + r.career + '\n\n【财运】\n' + r.wealth +
      '\n\n【感情人际】\n' + r.relationship;
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
    interpret: interpret, sameBazi: sameBazi, fingerprint: fingerprint,
    lifeReading: lifeReading, lifeReadingText: lifeReadingText,
    dayunDetail: dayunDetail, dayunDetailText: dayunDetailText
  };
});
