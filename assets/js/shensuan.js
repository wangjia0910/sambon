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
      '卦得「' + gua.name + '」——' + gua.desc + '。' + seg +
      '客官所言"' + domainWord + '·' + subWord + '"，正与此象相印。' +
      '老朽进一言：命理者，天时之约也，运未至则守，运将至则动；' + s.like.join('、') +
      '为君之向，顺势而为可减蹉跎。此乃参详，吉凶在人，决断在君。';

    var summary = free
      ? '客官此来三宝殿，心中所悬者，归根结底乃是：' + free + ' 之困。'
      : '客官此来三宝殿，心中所悬者，归根结底乃是：' + domainWord + '·' + subWord + ' 之困。';
    return { summary: summary, reading: reading };
  }

  return {
    WX_ORGAN: WX_ORGAN, DOMAIN_NAME: DOMAIN_NAME, SUB_LABEL: SUB_LABEL,
    assess: assess, refine: refine, fieldName: fieldName, subLabel: subLabel, conclude: conclude
  };
});
