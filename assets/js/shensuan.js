/*
 * shensuan.js — 神算子攀谈引擎
 * 输入：bz(Bazi.bazi 结果)、gua(Liuyao.cast 结果)
 * 输出：开场观象、心事领域打分、细化追问、最终归纳"客户想要解决的问题" + 详实解读。
 * UMD：浏览器挂 window.Shensuan；Node 可 require。
 * 双语：所有输出函数支持 lang 参数（'zh' 默认 | 'en'）；solution 头体间以全角空格分隔，供渲染层拆分。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shensuan = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var WX_ORGAN = {
    木: { zh: '肝胆', en: 'liver and gall' },
    火: { zh: '心与小肠', en: 'the heart and small intestine' },
    土: { zh: '脾胃', en: 'the stomach and spleen' },
    金: { zh: '肺与大肠', en: 'the lungs and large intestine' },
    水: { zh: '肾与膀胱', en: 'the kidneys and bladder' }
  };
  function isEn(lang) { return lang === 'en'; }
  function WX_EN(w) { return {木:'Wood',火:'Fire',土:'Earth',金:'Metal',水:'Water'}[w] || w; }
  function joinList(arr, lang) { return isEn(lang) ? arr.join(', ') : arr.join('、'); }
  // 英文输出用的拼音/生肖/十神映射
  var GAN_PINYIN = {甲:'Jia',乙:'Yi',丙:'Bing',丁:'Ding',戊:'Wu',己:'Ji',庚:'Geng',辛:'Xin',壬:'Ren',癸:'Gui'};
  var ZHI_ANIMAL = {子:'Rat',丑:'Ox',寅:'Tiger',卯:'Rabbit',辰:'Dragon',巳:'Snake',
                    午:'Horse',未:'Goat',申:'Monkey',酉:'Rooster',戌:'Dog',亥:'Pig'};
  var SS_EN = {'比肩':'Friend','劫财':'Rob Wealth','食神':'Eating God','伤官':'Hurting Officer',
               '正财':'Direct Wealth','偏财':'Indirect Wealth','正官':'Direct Officer','七杀':'Seven Killings',
               '正印':'Direct Seal','偏印':'Indirect Seal'};
  function gzEn(g, z) { return GAN_PINYIN[g] + ' ' + ZHI_ANIMAL[z]; }
  function ssEn(name) { return SS_EN[name] || name; }

  // 白话解卦：优先调用 Liuyao.plain；Node 验证或缺模块时退化为内置简版
  function guaPlain(gua, lang) {
    var en = isEn(lang);
    if (typeof Liuyao !== 'undefined' && Liuyao.plain) return Liuyao.plain(gua, lang);
    if (en) {
      return 'In plain words: this hexagram is "' + (gua.nameEn || gua.name) + '"' +
        (gua.dong >= 0 ? (', its ' + (gua.dong + 1) + 'th line moving, turning to "' + (gua.bianNameEn || gua.bianName) + '"') : ', still, with no moving line') +
        '. ' + (gua.descEn || gua.desc) + '.';
    }
    return '此卦「' + gua.name + '」' +
      (gua.dong >= 0 ? ('，第 ' + (gua.dong + 1) + ' 爻发动，将变「' + gua.bianName + '」') : '，静卦无动爻') +
      '。' + gua.desc;
  }

  var DOMAIN_NAME = {
    cai:    { zh: '财运', en: 'Wealth & Finance' },
    guan:   { zh: '事业功名', en: 'Career & Standing' },
    qing:   { zh: '姻缘情感', en: 'Love & Bonds' },
    health: { zh: '身体安康', en: 'Health & Wellbeing' },
    xue:    { zh: '学业文书', en: 'Study & Letters' },
    ren:    { zh: '人际子息', en: 'Relations & Family' },
    other:  { zh: '心事', en: 'a matter of the heart' }
  };

  var SUB_LABEL = {
    cai: {
      seek:   { zh: '求财无门、进账艰难', en: 'no way to earn, income hard to come by' },
      lose:   { zh: '财库有损、钱财外流', en: 'the store is leaking, money flowing out' },
      invest: { zh: '投资合作之疑', en: 'doubts over an investment or partnership' },
      debt:   { zh: '债务周转之困', en: 'the squeeze of debts and repayments' }
    },
    guan: {
      promote: { zh: '升迁受阻、怀才不遇', en: 'promotion blocked, talent unseen' },
      pay:     { zh: '薪酬不满、劳多获少', en: 'pay too little for the labor' },
      people:  { zh: '上下不和、小人是非', en: 'friction above and below, petty troublemakers' },
      change:  { zh: '转行谋变之念', en: 'the thought of changing trade or track' }
    },
    qing: {
      single: { zh: '姻缘未定、红鸾未动', en: 'no match yet, the matchmaker star still' },
      couple: { zh: '夫妻不睦、情分有亏', en: 'discord between spouses, affection worn thin' },
      peach:  { zh: '桃花纠缠、外情之扰', en: 'entangling charms and outside attachments' },
      leave:  { zh: '分离离散之忧', en: 'fear of parting and separation' }
    },
    health: {
      self:  { zh: '自身身体有恙', en: 'ailments of your own body' },
      elder: { zh: '长辈父母安康', en: 'the health of elders and parents' },
      child: { zh: '子女晚辈之事', en: 'matters of children and the young' }
    },
    xue: {
      exam:   { zh: '考试升学金榜', en: 'exams and advancement, the honor roll' },
      paper:  { zh: '论文文书之难', en: 'the toil of thesis and documents' },
      career: { zh: '择业前途之惑', en: 'confusion over which trade to enter' }
    },
    ren: {
      friend: { zh: '朋友反目、合伙生隙', en: 'friends turned foes, partnerships cracking' },
      child:  { zh: '子女缘与教养', en: 'the bond with children and their upbringing' },
      social: { zh: '人缘孤寂、少人帮扶', en: 'loneliness, few to lend a hand' }
    }
  };

  function domainScores(bz, gua) {
    var ss = bz.shishen, cnt = bz.cnt, s = bz.strength;
    var all = [ss.yearGan, ss.yearZhi, ss.monthGan, ss.monthZhi, ss.dayZhi, ss.hourGan, ss.hourZhi];
    var count = function (x) { return all.filter(function (v) { return v === x; }).length; };
    var gx = function (k) { return (gua.name.indexOf(k) >= 0); };

    var cai = count('正财') * 2 + count('偏财') * 2 + (s.score < 45 ? 2 : 0) + ((gua.upperWX === '金' || gua.lowerWX === '金') ? 1 : 0);
    var guan = count('正官') * 2 + count('七杀') * 2 + ((count('正官') > 0 && count('七杀') > 0) ? 3 : 0) + (gx('乾') ? 1 : 0);
    var qing = ((ss.dayZhi === '正官' || ss.dayZhi === '七杀' || ss.dayZhi === '正财' || ss.dayZhi === '偏财') ? 3 : 0) +
               ((gx('兑') || gx('泽')) ? 1 : 0) + (gx('坎') ? 1 : 0);
    var health = (cnt['木'] === 0 ? 2 : 0) + (cnt['火'] === 0 ? 2 : 0) + (cnt['土'] === 0 ? 2 : 0) +
                 (cnt['金'] === 0 ? 2 : 0) + (cnt['水'] === 0 ? 2 : 0) + (s.score < 40 ? 2 : 0);
    var xue = count('正印') * 2 + count('偏印') * 2 + (gx('艮') ? 1 : 0);
    var ren = count('食神') * 2 + count('伤官') * 2 + count('比肩') + count('劫财');

    return [
      { key: 'cai',    label: '钱财财运', labelEn: 'Wealth & Money', score: cai,    hint: '财星' },
      { key: 'guan',   label: '事业功名', labelEn: 'Career & Standing', score: guan,   hint: '官杀' },
      { key: 'qing',   label: '姻缘情感', labelEn: 'Love & Bonds', score: qing,   hint: '配偶宫' },
      { key: 'health', label: '身体安康', labelEn: 'Health & Wellbeing', score: health, hint: '五行偏枯' },
      { key: 'xue',    label: '学业文书', labelEn: 'Study & Letters', score: xue,    hint: '印星' },
      { key: 'ren',    label: '人际子息', labelEn: 'Relations & Family', score: ren,   hint: '食伤比劫' }
    ];
  }

  function assess(bz, gua, lang) {
    var en = isEn(lang);
    var s = bz.strength;
    var strong = s.score >= 60 ? '偏强' : (s.score <= 40 ? '偏弱' : '中和');
    var strongEn = s.score >= 60 ? 'strong' : (s.score <= 40 ? 'weak' : 'balanced');
    var wxOrder = ['木', '火', '土', '金', '水'];
    var wxStr = wxOrder.map(function (w) { return (en ? WX_EN(w) : w) + bz.cnt[w]; }).join(en ? ', ' : ' ');
    var miss = wxOrder.filter(function (w) { return bz.cnt[w] === 0; });
    var missStr;
    if (en) {
      missStr = miss.length
        ? ('missing ' + miss.map(function (w) { return WX_EN(w); }).join(', ') + ', leaving ' +
           miss.map(function (w) { return WX_ORGAN[w].en; }).join(', ') + ' thin')
        : 'all five phases present, no glaring skew';
    } else {
      missStr = miss.length
        ? ('五行缺 ' + miss.join('、') + '，于 ' + miss.map(function (w) { return WX_ORGAN[w].zh; }).join('、') + ' 有欠')
        : '五行俱全，无显偏枯';
    }
    var opening;
    if (en) {
      opening = 'The old man studies your chart: the Day Master is ' + GAN_PINYIN[bz.dayGan] + ' (' + WX_EN(bz.dayMaster) + '), strength index ' + s.score +
        '/100 — a ' + strongEn + ' chart; the phases read ' + wxStr + ', ' + missStr + '. Favorable: ' + s.like.map(function (w) { return WX_EN(w); }).join(', ') + '.' +
        ' Then he studies the hexagram you cast: "' + (gua.nameEn || gua.name) + '", whose judgment says: "' + (gua.descEn || gua.desc) + '".' +
        guaPlain(gua, 'en') +
        ' Layer upon layer, he sees an unsettled matter between your brows — speak it, and let the old man counsel you.';
    } else {
      opening = '老朽观客官八字：日主 ' + bz.dayGan + '（' + bz.dayMaster + '），强弱指数 ' + s.score +
        '/100，属 ' + strong + ' 之命；五行 ' + wxStr + '，' + missStr + '。喜用 ' + s.like.join('、') + '。' +
        '再观客官所起一卦，得「' + gua.name + '」，卦辞云："' + gua.desc + '"。' +
        guaPlain(gua, 'zh') +
        '此象叠而观之，客官眉间似有未决之心事——不妨道来，老朽为君参详。';
    }

    var domains = domainScores(bz, gua).sort(function (a, b) { return b.score - a.score; }).slice(0, 5)
      .map(function (d) { return { key: d.key, label: en ? d.labelEn : d.label, score: d.score }; });
    return { opening: opening, domains: domains };
  }

  function refine(key, lang) {
    var en = isEn(lang);
    var list = SUB_LABEL[key];
    if (!list) return [];
    return Object.keys(list).map(function (k) {
      return { key: k, label: en ? list[k].en : list[k].zh };
    });
  }

  function fieldName(key, lang) {
    var d = DOMAIN_NAME[key];
    if (!d) return isEn(lang) ? 'a matter of the heart' : '心事';
    return isEn(lang) ? d.en : d.zh;
  }
  function subLabel(key, sub, lang) {
    var list = SUB_LABEL[key];
    if (!list || !list[sub]) return '';
    return isEn(lang) ? list[sub].en : list[sub].zh;
  }

  // ---- 神算子详细解决方案（结合八字 + 大运 + 卦象，五步解惑）----
  function countSS(bz) {
    var ss = bz.shishen;
    var all = [ss.yearGan, ss.yearZhi, ss.monthGan, ss.monthZhi, ss.dayZhi, ss.hourGan, ss.hourZhi];
    var cnt = {};
    all.forEach(function (x) { if (x && x !== '?') cnt[x] = (cnt[x] || 0) + 1; });
    return cnt;
  }
  function strongWord(score, lang) {
    var en = isEn(lang);
    return score >= 60 ? (en ? 'strong enough to carry the work' : '偏强而能任事')
      : (score <= 40 ? (en ? 'weak, needing to borrow strength' : '偏弱而需借力')
      : (en ? 'balanced, turning with the cycles' : '中和而随运转'));
  }
  function domainSignal(bz, key, lang) {
    var en = isEn(lang);
    var c = countSS(bz), ss = bz.shishen;
    if (key === 'cai') {
      var ci = (c['正财'] || 0) + (c['偏财'] || 0);
      return en
        ? ('On wealth: the chart shows ' + (ci ? (ci + ' wealth star(s)') : 'no wealth star') + ' — ' +
           (bz.strength.score >= 60 ? 'a strong self can carry wealth; gains are in sight' : 'the self runs weak, so share the gains with partners and accumulate steadily first') + '.')
        : ('论财，命局财星' + (ci ? ('有 ' + ci + ' 现') : '不显') + '，' +
           (bz.strength.score >= 60 ? '身强足以任财，进财可期' : '身偏弱，宜合作分财、稳积为先') + '。');
    }
    if (key === 'guan') {
      var gi = (c['正官'] || 0) + (c['七杀'] || 0);
      return en
        ? ('On career: officer stars ' + (gi ? ('appear ' + gi + ' time(s) — take a post and bear responsibility') : ('do not show — stand on talent or on wealth')) + '.')
        : ('论事业，官杀' + (gi ? ('有 ' + gi + ' 现，宜就名位、担责任') : '不显，宜以才（食伤）或以财立身') + '。');
    }
    if (key === 'qing') {
      var caiN = (c['正财'] || 0) + (c['偏财'] || 0);
      var guanN = (c['正官'] || 0) + (c['七杀'] || 0);
      var root = bz.raw.sex === '男' ? caiN > 0 : (bz.raw.sex === '女' ? guanN > 0 : (caiN + guanN > 0));
      return en
        ? ('On love: the day branch (spouse palace) holds "' + ssEn(ss.dayZhi) + '" — ' + (root ? 'the bond has root; a match can be expected' : 'let it ripen slowly; you may meet them in a favorable cycle') + '.')
        : ('论情，日支（配偶宫）坐「' + ss.dayZhi + '」，' + (root ? '缘法有根，姻缘可期' : '缘法宜缓，宜在喜用大运中遇人') + '。');
    }
    if (key === 'health') {
      var miss = ['木', '火', '土', '金', '水'].filter(function (w) { return bz.cnt[w] === 0; });
      return en
        ? ('On the body: ' + (miss.length ? ('missing ' + miss.map(function (w) { return WX_EN(w); }).join(', ') + ', leaving ' +
           miss.map(function (w) { return WX_ORGAN[w].en; }).join(', ') + ' thin — tend them') : 'all five phases present, the root is sound') + '.')
        : ('论身，' + (miss.length ? ('五行缺 ' + miss.join('、') + '，所主' +
           miss.map(function (w) { return WX_ORGAN[w].zh; }).join('、') + '之气偏弱，宜加顾惜') : '五行俱全，本元尚充') + '。');
    }
    if (key === 'xue') {
      var yi = (c['正印'] || 0) + (c['偏印'] || 0);
      return en
        ? ('On study: seal stars ' + (yi ? ('appear ' + yi + ' time(s) — letters and documents favor you, standing comes easily') : ('do not show — make up with diligence and quiet cultivation')) + '.')
        : ('论学，印星' + (yi ? ('有 ' + yi + ' 现，利文教文书、易得名望') : '不显，宜以勤补、以静修') + '。');
    }
    if (key === 'ren') {
      var ri = (c['食神'] || 0) + (c['伤官'] || 0) + (c['比肩'] || 0) + (c['劫财'] || 0);
      return en
        ? ('On relations: talent and peer stars ' + (ri ? ('number ' + ri + ' — the strength of companions is yours to use') : ('run thin — reach out and make friends; do not walk alone')) + '.')
        : ('论人际，食伤比劫' + (ri ? ('共 ' + ri + ' 现，人缘与同辈之力可用') : '偏弱，宜主动结善、少独行') + '。');
    }
    return en
      ? 'Taken whole: the strength of the Day Master and the skew of the five phases already show the root of your worry; weigh the favorable phases and the cycle now in command.'
      : '综观命局，日主强弱与五行偏枯，已示君所忧之根；具体宜就喜用五行与当令大运参之。';
  }
  var WX_GUIDE = {
    '木': { zh: '木为君之所喜：宜向东方、近自然草木，从事文教、林业、创意、成长型事业；多读书、养仁心，绿色为助。',
            en: 'Wood favors you: face the east, keep close to nature and green things; letters, forestry, creative and growth-minded work; read widely, keep a benevolent heart; the color green helps.' },
    '火': { zh: '火为君之所喜：宜向南方、从事文化、餐饮、能源、传媒、表达类事业；主动出击、以礼待人，红色为助。',
            en: 'Fire favors you: face the south; culture, food and drink, energy, media, expressive work; take the initiative, treat others with courtesy; the color red helps.' },
    '土': { zh: '土为君之所喜：宜守本地中央、从事地产、稳健实业、服务类事业；踏实积累、以信立身，黄色为助。',
            en: 'Earth favors you: stay central and local; property, steady industry, service work; accumulate honestly, stand on trust; the color yellow helps.' },
    '金': { zh: '金为君之所喜：宜向西方、从事金融、机械、法律、管理、规则类事业；讲决断、守义气，白色为助。',
            en: 'Metal favors you: face the west; finance, machinery, law, management, rule-bound work; be decisive, keep your word; the color white helps.' },
    '水': { zh: '水为君之所喜：宜向北方、从事流通、智慧、物流、咨询、变通类事业；灵活应机、以智取胜，黑色为助。',
            en: 'Water favors you: face the north; flow and exchange, wisdom, logistics, consulting, adaptive work; answer flexibly, win by insight; the color black helps.' }
  };
  function wxGuide(like, lang) {
    var en = isEn(lang);
    return like.slice(0, 2).map(function (w) { return WX_GUIDE[w] ? WX_GUIDE[w][en ? 'en' : 'zh'] : ''; }).filter(Boolean).join(en ? ' ' : ' ');
  }
  function guaHint(gua, lang) {
    var en = isEn(lang);
    if (gua.dong >= 0) {
      return en
        ? 'The hexagram has a moving line — it means "change": your worry may turn; weigh the hour and move when it comes; do not get stuck.'
        : '卦有动爻，主"变"，君所忧之事或有转机，宜审时度势、择机而动，勿胶着。';
    }
    return en
      ? 'The hexagram is still — it means "hold": let your worry settle first, weigh gain and loss, and for now move not.'
      : '卦为静体，主"守"，君所忧之事宜先沉淀、明辨得失，暂勿轻动。';
  }

  // 详细解决方案（头体间以全角空格分隔，供渲染层拆分标题与正文）
  function solution(bz, gua, key, sub, free, lang) {
    var en = isEn(lang);
    var s = bz.strength, like = bz.strength.like, dm = bz.dayMaster;
    var domainWord = fieldName(key, lang);
    var subWord = free || subLabel(key, sub, lang) || (en ? 'the worry in your heart' : '心中所忧');
    var details = (typeof Bazi !== 'undefined' && Bazi.dayunDetail) ? Bazi.dayunDetail(bz) : [];
    var fav = details.filter(function (d) { return d.xiji === '喜'; });
    var unfav = details.filter(function (d) { return d.xiji === '忌'; });

    var parts = [];
    parts.push(en
      ? ('I · Where You Stand　Day Master ' + GAN_PINYIN[bz.dayGan] + ' (' + WX_EN(dm) + ') ' + strongWord(s.score, 'en') +
         ', favorable ' + like.map(function (w) { return WX_EN(w); }).join(', ') + '. ' + domainSignal(bz, key, 'en'))
      : ('一、现状参断　日主 ' + bz.dayGan + '（' + dm + '）' + strongWord(s.score, 'zh') +
         '，喜用 ' + like.join('、') + '。' + domainSignal(bz, key, 'zh')));
    if (fav.length) {
      var f = fav.slice(0, 2).map(function (d) {
        return (en ? gzEn(d.gan, d.zhi) : (d.gan + d.zhi)) + (en ? (' (around ' + d.age.replace('岁', '') + ')') : ('（约' + d.age + '）'));
      }).join(en ? ', ' : '、');
      var u = unfav.length ? ((en ? '　while ' : '　而 ') + unfav.slice(0, 1).map(function (d) {
        return (en ? gzEn(d.gan, d.zhi) : (d.gan + d.zhi)) + (en ? (' (around ' + d.age.replace('岁', '') + ') [Unfavorable]') : ('（约' + d.age + '）〔忌〕'));
      }).join(en ? ', ' : '、') +
        (en ? ' — in that cycle hold what you have and move not.' : '，行此运宜守成蓄势，勿妄动。')) : '';
      parts.push((en ? 'II · Timing & Cycles　' : '二、时机·大运　') +
        (en ? ('Your most favorable cycles are ' + f + ' [Favorable] — at those ages, seize them and press hard.' + u)
            : ('君命中最得力之运在 ' + f + ' 〔喜〕，逢此龄宜把握、宜发力。' + u)));
    } else {
      parts.push((en ? 'II · Timing & Cycles　' : '二、时机·大运　') +
        (en ? ('Your great cycles show no clear favorable phase — borrow from annual luck; in years when ' + like.map(function (w) { return WX_EN(w); }).join(', ') + ' runs strong, small openings appear; move as they come.')
            : ('君之大运喜用不显，宜以逐年"流年小运"补之；凡逢 ' + like.join('、') + ' 旺之年，便是小吉之机，宜相机而动。')));
    }
    parts.push((en ? 'III · How to Lean (by your favorable phases)　' : '三、趋避之法（依君喜用五行）　') + wxGuide(like, lang));
    parts.push((en ? 'IV · The Hexagram Confirms　' : '四、卦象印证　') +
      (en ? ('The hexagram you cast is "' + (gua.nameEn || gua.name) + '" — ' + (gua.descEn || gua.desc) + '. ' + guaPlain(gua, 'en') +
        '　Read with your worry over ' + domainWord + ': ' + guaHint(gua, 'en'))
        : ('所起「' + gua.name + '」——' + gua.desc + '。' + guaPlain(gua, 'zh') +
        '　此卦与君所忧' + domainWord + '相参：' + guaHint(gua, 'zh'))));
    var favLine = fav.length
      ? (en ? ('when a favorable cycle (' + fav.slice(0, 1).map(function (d) { return gzEn(d.gan, d.zhi); }).join('') + ' and its like) reaches you, that is the window to push')
            : ('当喜用大运（' + fav.slice(0, 1).map(function (d) { return d.gan + d.zhi; }).join('') + ' 等）临身之时，便是最好的发力窗口'))
      : (en ? ('in years when ' + like.map(function (w) { return WX_EN(w); }).join(', ') + ' runs strong, that is the small opening')
            : ('逢 ' + like.join('、') + ' 旺之流年，即是小吉之机'));
    parts.push((en ? 'V · One Last Word　' : '五、神算子一言　') +
      (en ? ('Metaphysics shows the "appointment of timing", not the "lock of fate". The trouble of ' + domainWord + ' · ' + subWord +
        ' can be met by leaning toward ' + like.map(function (w) { return WX_EN(w); }).join(', ') + ', following ' + favLine + '. ' +
        'When the cycle has not come, gather; when it is at hand, move. Fortune and misfortune rest in human hands, the decision is yours — this is the old man’s counsel, not a rope to bind you.')
        : ('命理示"天时之约"，非"定数之锁"。' + domainWord + '·' + subWord +
        ' 之困，君可借喜用 ' + like.join('、') + ' 之向、循 ' + favLine + '。' +
        '运未至则养、运将至则动；吉凶在人，决断在君——此乃老朽助君解惑之心，非缚君之绳。')));
    return parts.join('\n\n');
  }

  function conclude(bz, gua, key, sub, free, lang) {
    var en = isEn(lang);
    var s = bz.strength;
    var strong = s.score >= 60 ? '偏强' : (s.score <= 40 ? '偏弱' : '中和');
    var strongEn = s.score >= 60 ? 'strong' : (s.score <= 40 ? 'weak' : 'balanced');
    var organMissing = ['木', '火', '土', '金', '水'].filter(function (w) { return bz.cnt[w] === 0; })
      .map(function (w) { return isEn(lang) ? WX_ORGAN[w].en : WX_ORGAN[w].zh; });
    var domainWord = fieldName(key, lang);
    var subWord = free || subLabel(key, sub, lang) || (en ? 'the worry in your heart' : '心中所忧');

    var seg = '';
    if (en) {
      if (key === 'cai') seg = 'Wealth is fed by talent stars and guarded by officer stars; when wealth stars hold breath, the store fills.';
      else if (key === 'guan') seg = 'Officer stars are standing and authority; the seal is the root of documents.';
      else if (key === 'qing') seg = 'The spouse palace sits in the day branch; officer stars (for women) and wealth stars (for men) are its bonds.';
      else if (key === 'health') seg = 'When a phase is skewed, its organs tend to run hot or cold; a weak Day Master leaves the root unsupplied.';
      else if (key === 'xue') seg = 'The seal star is the star of letters, governing study and documents.';
      else if (key === 'ren') seg = 'Talent stars govern speech and offspring; peer stars govern the help of equals.';
      else seg = 'All worries trace back to the strength of the Day Master and the turns of the cycles.';

      var reading = 'The old man reads closely: the Day Master is ' + GAN_PINYIN[bz.dayGan] + ' (' + WX_EN(bz.dayMaster) + '), ' + strongEn +
        ', favorable ' + s.like.map(function (w) { return WX_EN(w); }).join(', ') + '.' +
        (organMissing.length ? (' ' + organMissing.join(', ') + ' run thin in this chart — tend them.') : '') +
        ' The hexagram is "' + (gua.nameEn || gua.name) + '" — ' + (gua.descEn || gua.desc) + '. ' + guaPlain(gua, 'en') + seg +
        ' What you named — "' + domainWord + ' · ' + subWord + '" — answers to this very picture.';
      var summary = free
        ? 'You came to the Hall of the Three Treasures, and what weighs on you comes down in the end to: ' + free + '.'
        : 'You came to the Hall of the Three Treasures, and what weighs on you comes down in the end to: ' + domainWord + ' · ' + subWord + '.';
      return { summary: summary, reading: reading, solution: solution(bz, gua, key, sub, free, 'en') };
    }

    if (key === 'cai') seg = '财以食伤为源、以官杀为护，财星有气则库盈。';
    else if (key === 'guan') seg = '官杀者，功名权柄也；印者，文书根基也。';
    else if (key === 'qing') seg = '配偶宫居日支，官杀（女命）财星（男命）为其缘法。';
    else if (key === 'health') seg = '五行偏枯，则脏腑易有偏胜；日主弱则本元不充。';
    else if (key === 'xue') seg = '印星为文曲，主学业文书之途。';
    else if (key === 'ren') seg = '食伤主口才子息，比劫主同辈帮扶。';
    else seg = '万般心事，皆系于日主之强弱与运程之顺逆。';

    var readingZh = '老朽细参：日主 ' + bz.dayGan + '（' + bz.dayMaster + '）' + strong +
      '，喜用 ' + s.like.join('、') + '。' +
      (organMissing.length ? ('命局 ' + organMissing.join('、') + ' 之气偏弱，宜加顾惜。') : '') +
      '卦得「' + gua.name + '」——' + gua.desc + '。' + guaPlain(gua, 'zh') + seg +
      '客官所言"' + domainWord + '·' + subWord + '"，正与此象相印。';

    var summaryZh = free
      ? '客官此来三宝殿，心中所悬者，归根结底乃是：' + free + ' 之困。'
      : '客官此来三宝殿，心中所悬者，归根结底乃是：' + domainWord + '·' + subWord + ' 之困。';
    return { summary: summaryZh, reading: readingZh, solution: solution(bz, gua, key, sub, free, 'zh') };
  }

  return {
    WX_ORGAN: WX_ORGAN, DOMAIN_NAME: DOMAIN_NAME, SUB_LABEL: SUB_LABEL,
    assess: assess, refine: refine, fieldName: fieldName, subLabel: subLabel, conclude: conclude, solution: solution
  };
});
