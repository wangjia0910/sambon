/*
 * shensuan.js — 神算子攀谈引擎
 * 输入：bz(Bazi.bazi 结果)、gua(Liuyao.cast 结果)
 * 输出：开场观象、心事领域打分、细化追问、最终归纳"客户想要解决的问题" + 详实解读。
 * UMD：浏览器挂 window.Shensuan；Node 可 require。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shensuan = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var WX_ORGAN = { 木: '肝胆', 火: '心与小肠', 土: '脾胃', 金: '肺与大肠', 水: '肾与膀胱' };

  // 白话解卦：优先调用 Liuyao.plain；Node 验证或缺模块时退化为内置简版
  function guaPlain(gua) {
    if (typeof Liuyao !== 'undefined' && Liuyao.plain) return Liuyao.plain(gua);
    return '此卦「' + gua.name + '」' +
      (gua.dong >= 0 ? ('，第 ' + (gua.dong + 1) + ' 爻发动，将变「' + gua.bianName + '」') : '，静卦无动爻') +
      '。' + gua.desc;
  }

  var DOMAIN_NAME = { cai: '财运', guan: '事业功名', qing: '姻缘情感', health: '身体安康', xue: '学业文书', ren: '人际子息' };

  var SUB_LABEL = {
    cai: { seek: '求财无门、进账艰难', lose: '财库有损、钱财外流', invest: '投资合作之疑', debt: '债务周转之困' },
    guan: { promote: '升迁受阻、怀才不遇', pay: '薪酬不满、劳多获少', people: '上下不和、小人是非', change: '转行谋变之念' },
    qing: { single: '姻缘未定、红鸾未动', couple: '夫妻不睦、情分有亏', peach: '桃花纠缠、外情之扰', leave: '分离离散之忧' },
    health: { self: '自身身体有恙', elder: '长辈父母安康', child: '子女晚辈之事' },
    xue: { exam: '考试升学金榜', paper: '论文文书之难', career: '择业前途之惑' },
    ren: { friend: '朋友反目、合伙生隙', child: '子女缘与教养', social: '人缘孤寂、少人帮扶' }
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
      { key: 'cai',    label: '钱财财运', score: cai,    hint: '财星' },
      { key: 'guan',   label: '事业功名', score: guan,   hint: '官杀' },
      { key: 'qing',   label: '姻缘情感', score: qing,   hint: '配偶宫' },
      { key: 'health', label: '身体安康', score: health, hint: '五行偏枯' },
      { key: 'xue',    label: '学业文书', score: xue,    hint: '印星' },
      { key: 'ren',    label: '人际子息', score: ren,    hint: '食伤比劫' }
    ];
  }

  function assess(bz, gua) {
    var s = bz.strength;
    var strong = s.score >= 60 ? '偏强' : (s.score <= 40 ? '偏弱' : '中和');
    var wxOrder = ['木', '火', '土', '金', '水'];
    var wxStr = wxOrder.map(function (w) { return w + bz.cnt[w]; }).join(' ');
    var miss = wxOrder.filter(function (w) { return bz.cnt[w] === 0; });
    var missStr = miss.length
      ? ('五行缺 ' + miss.join('、') + '，于 ' + miss.map(function (w) { return WX_ORGAN[w]; }).join('、') + ' 有欠')
      : '五行俱全，无显偏枯';
    var opening = '老朽观客官八字：日主 ' + bz.dayGan + '（' + bz.dayMaster + '），强弱指数 ' + s.score +
      '/100，属 ' + strong + ' 之命；五行 ' + wxStr + '，' + missStr + '。喜用 ' + s.like.join('、') + '。' +
      '再观客官所起一卦，得「' + gua.name + '」，卦辞云："' + gua.desc + '"。' +
      guaPlain(gua) +
      '此象叠而观之，客官眉间似有未决之心事——不妨道来，老朽为君参详。';

    var domains = domainScores(bz, gua).sort(function (a, b) { return b.score - a.score; }).slice(0, 5);
    return { opening: opening, domains: domains };
  }

  function refine(key) {
    var list = SUB_LABEL[key];
    if (!list) return [];
    return Object.keys(list).map(function (k) { return { key: k, label: list[k] }; });
  }

  function fieldName(key) { return DOMAIN_NAME[key] || '心事'; }
  function subLabel(key, sub) { return (SUB_LABEL[key] && SUB_LABEL[key][sub]) || ''; }

  // ---- 神算子详细解决方案（结合八字 + 大运 + 卦象，五步解惑）----
  function countSS(bz) {
    var ss = bz.shishen;
    var all = [ss.yearGan, ss.yearZhi, ss.monthGan, ss.monthZhi, ss.dayZhi, ss.hourGan, ss.hourZhi];
    var cnt = {};
    all.forEach(function (x) { if (x && x !== '?') cnt[x] = (cnt[x] || 0) + 1; });
    return cnt;
  }
  function strongWord(score) {
    return score >= 60 ? '偏强而能任事' : (score <= 40 ? '偏弱而需借力' : '中和而随运转');
  }
  function domainSignal(bz, key) {
    var c = countSS(bz), ss = bz.shishen;
    if (key === 'cai') {
      var ci = (c['正财'] || 0) + (c['偏财'] || 0);
      return '论财，命局财星' + (ci ? ('有 ' + ci + ' 现') : '不显') + '，' +
        (bz.strength.score >= 60 ? '身强足以任财，进财可期' : '身偏弱，宜合作分财、稳积为先') + '。';
    }
    if (key === 'guan') {
      var gi = (c['正官'] || 0) + (c['七杀'] || 0);
      return '论事业，官杀' + (gi ? ('有 ' + gi + ' 现，宜就名位、担责任') : '不显，宜以才（食伤）或以财立身') + '。';
    }
    if (key === 'qing') {
      var root = (bz.raw.sex === '男' && ((c['正财'] || 0) + (c['偏财'] || 0) > 0)) ||
                 (bz.raw.sex === '女' && ((c['正官'] || 0) + (c['七杀'] || 0) > 0));
      return '论情，日支（配偶宫）坐「' + ss.dayZhi + '」，' + (root ? '缘法有根，姻缘可期' : '缘法宜缓，宜在喜用大运中遇人') + '。';
    }
    if (key === 'health') {
      var miss = ['木', '火', '土', '金', '水'].filter(function (w) { return bz.cnt[w] === 0; });
      return '论身，' + (miss.length ? ('五行缺 ' + miss.join('、') + '，所主' +
        miss.map(function (w) { return WX_ORGAN[w]; }).join('、') + '之气偏弱，宜加顾惜') : '五行俱全，本元尚充') + '。';
    }
    if (key === 'xue') {
      var yi = (c['正印'] || 0) + (c['偏印'] || 0);
      return '论学，印星' + (yi ? ('有 ' + yi + ' 现，利文教文书、易得名望') : '不显，宜以勤补、以静修') + '。';
    }
    if (key === 'ren') {
      var ri = (c['食神'] || 0) + (c['伤官'] || 0) + (c['比肩'] || 0) + (c['劫财'] || 0);
      return '论人际，食伤比劫' + (ri ? ('共 ' + ri + ' 现，人缘与同辈之力可用') : '偏弱，宜主动结善、少独行') + '。';
    }
    return '综观命局，日主强弱与五行偏枯，已示君所忧之根；具体宜就喜用五行与当令大运参之。';
  }
  var WX_GUIDE = {
    '木': '木为君之所喜：宜向东方、近自然草木，从事文教、林业、创意、成长型事业；多读书、养仁心，绿色为助。',
    '火': '火为君之所喜：宜向南方、从事文化、餐饮、能源、传媒、表达类事业；主动出击、以礼待人，红色为助。',
    '土': '土为君之所喜：宜守本地中央、从事地产、稳健实业、服务类事业；踏实积累、以信立身，黄色为助。',
    '金': '金为君之所喜：宜向西方、从事金融、机械、法律、管理、规则类事业；讲决断、守义气，白色为助。',
    '水': '水为君之所喜：宜向北方、从事流通、智慧、物流、咨询、变通类事业；灵活应机、以智取胜，黑色为助。'
  };
  function wxGuide(like) {
    return like.slice(0, 2).map(function (w) { return WX_GUIDE[w] || ''; }).join(' ');
  }
  function guaHint(gua) {
    if (gua.dong >= 0) return '卦有动爻，主"变"，君所忧之事或有转机，宜审时度势、择机而动，勿胶着。';
    return '卦为静体，主"守"，君所忧之事宜先沉淀、明辨得失，暂勿轻动。';
  }

  // 详细解决方案
  function solution(bz, gua, key, sub, free) {
    var s = bz.strength, like = bz.strength.like, dm = bz.dayMaster;
    var domainWord = fieldName(key);
    var subWord = free || subLabel(key, sub) || '心中所忧';
    var details = (typeof Bazi !== 'undefined' && Bazi.dayunDetail) ? Bazi.dayunDetail(bz) : [];
    var fav = details.filter(function (d) { return d.xiji === '喜'; });
    var unfav = details.filter(function (d) { return d.xiji === '忌'; });

    var parts = [];
    parts.push('一、现状参断　日主 ' + bz.dayGan + '（' + dm + '）' + strongWord(s.score) +
      '，喜用 ' + like.join('、') + '。' + domainSignal(bz, key));
    if (fav.length) {
      var f = fav.slice(0, 2).map(function (d) { return d.gan + d.zhi + '（约' + d.age + '）'; }).join('、');
      var u = unfav.length ? ('　而 ' + unfav.slice(0, 1).map(function (d) { return d.gan + d.zhi + '（约' + d.age + '）'; }).join('、') +
        ' 〔忌〕，行此运宜守成蓄势，勿妄动。') : '';
      parts.push('二、时机·大运　君命中最得力之运在 ' + f + ' 〔喜〕，逢此龄宜把握、宜发力。' + u);
    } else {
      parts.push('二、时机·大运　君之大运喜用不显，宜以逐年"流年小运"补之；凡逢 ' +
        like.join('、') + ' 旺之年，便是小吉之机，宜相机而动。');
    }
    parts.push('三、趋避之法（依君喜用五行）　' + wxGuide(like));
    parts.push('四、卦象印证　所起「' + gua.name + '」——' + gua.desc + '。' + guaPlain(gua) +
      '　此卦与君所忧' + domainWord + '相参：' + guaHint(gua));
    var favLine = fav.length ? ('当喜用大运（' + fav.slice(0, 1).map(function (d) { return d.gan + d.zhi; }).join('') +
      ' 等）临身之时，便是最好的发力窗口') : ('逢 ' + like.join('、') + ' 旺之流年，即是小吉之机');
    parts.push('五、神算子一言　命理示"天时之约"，非"定数之锁"。' + domainWord + '·' + subWord +
      ' 之困，君可借喜用 ' + like.join('、') + ' 之向、循 ' + favLine + '。' +
      '运未至则养、运将至则动；吉凶在人，决断在君——此乃老朽助君解惑之心，非缚君之绳。');
    return parts.join('\n\n');
  }

  function conclude(bz, gua, key, sub, free) {
    var s = bz.strength;
    var strong = s.score >= 60 ? '偏强' : (s.score <= 40 ? '偏弱' : '中和');
    var organMissing = ['木', '火', '土', '金', '水'].filter(function (w) { return bz.cnt[w] === 0; })
      .map(function (w) { return WX_ORGAN[w]; });
    var domainWord = fieldName(key);
    var subWord = free || subLabel(key, sub) || '心中所忧';

    var seg = '';
    if (key === 'cai') seg = '财以食伤为源、以官杀为护，财星有气则库盈。';
    else if (key === 'guan') seg = '官杀者，功名权柄也；印者，文书根基也。';
    else if (key === 'qing') seg = '配偶宫居日支，官杀（女命）财星（男命）为其缘法。';
    else if (key === 'health') seg = '五行偏枯，则脏腑易有偏胜；日主弱则本元不充。';
    else if (key === 'xue') seg = '印星为文曲，主学业文书之途。';
    else if (key === 'ren') seg = '食伤主口才子息，比劫主同辈帮扶。';
    else seg = '万般心事，皆系于日主之强弱与运程之顺逆。';

    var reading = '老朽细参：日主 ' + bz.dayGan + '（' + bz.dayMaster + '）' + strong +
      '，喜用 ' + s.like.join('、') + '。' +
      (organMissing.length ? ('命局 ' + organMissing.join('、') + ' 之气偏弱，宜加顾惜。') : '') +
      '卦得「' + gua.name + '」——' + gua.desc + '。' + guaPlain(gua) + seg +
      '客官所言"' + domainWord + '·' + subWord + '"，正与此象相印。';

    var summary = free
      ? '客官此来三宝殿，心中所悬者，归根结底乃是：' + free + ' 之困。'
      : '客官此来三宝殿，心中所悬者，归根结底乃是：' + domainWord + '·' + subWord + ' 之困。';
    return { summary: summary, reading: reading, solution: solution(bz, gua, key, sub, free) };
  }

  return {
    WX_ORGAN: WX_ORGAN, DOMAIN_NAME: DOMAIN_NAME, SUB_LABEL: SUB_LABEL,
    assess: assess, refine: refine, fieldName: fieldName, subLabel: subLabel, conclude: conclude, solution: solution
  };
});
