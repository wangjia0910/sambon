/*
 * oracle.js — 三宝殿 · 内嵌神算模型（自进化 · 纯本地 · 零外部 API）
 * ---------------------------------------------------------------------
 * 理念：三宝者，天、地、人也；本于"天人合一"。
 *   · 天之时 → 八字（出生天时干支）
 *   · 地之象 → 六爻（阴阳爻变之卦）
 *   · 人之问 → 来客心事 + 神算子（人这一才）
 * 本模块以 bazi / liuyao / shensuan 的事实为骨，用一套"会学习的措辞/计策
 * 选择器 + 关键词→心事域 + 复访关注"引擎，随用户互动自动进化——
 *   · 多臂老虎机：每条指引(共情/症结/时机/现实之计/收束)都有多个变体，
 *     按 👍/👎 反馈更新各变体的"命中率"，越受共鸣的说法越常被选中。
 *   · 关键词学习：从来客自由描述里抽取"心事词"，建立 词→心事域 权重。
 *   · 复访关注：同一心事域反复出现，权重自然抬升（未说出口的牵挂）。
 *   · 语气偏好：暖言 / 直断 两系措辞，按共鸣自动倾向。
 * 全部状态仅存浏览器 localStorage，不上传任何数据；可导出/导入/重置。
 * 无网络、无第三方依赖，UMD：浏览器挂 window.Oracle；Node 可 require。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Oracle = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MEM_KEY = 'sambon_oracle_mem';
  var ON_KEY = 'sambon_oracle_on';
  var VERSION = 1;

  // ---------------- 记忆结构 ----------------
  function blank() {
    return {
      version: VERSION,
      sessions: 0,
      updates: 0,                 // 学习/进化次数
      enabled: true,
      resonance: { like: 0, dislike: 0 },
      profile: {
        name: '', sex: '', tone: 'warm',
        recurring: {},            // 心事域 -> 次数
        lastFingerprint: ''
      },
      terms: {},                  // 心事词 -> { 心事域: 权重 }
      themes: {},                 // 心事域 -> { like, dislike }
      slots: {},                  // slot -> 变体id -> { w, n }
      lastPlan: null,
      _seed: 1,
      _loaded: false
    };
  }
  var mem = blank();

  function load() {
    if (mem._loaded) return;
    try {
      var raw = localStorage.getItem(MEM_KEY);
      if (raw) {
        var j = JSON.parse(raw);
        if (j && j.version === VERSION) {
          mem = blank();
          for (var k in j) if (j.hasOwnProperty(k)) mem[k] = j[k];
          mem._loaded = true;
        }
      }
    } catch (e) {}
    try {
      var en = localStorage.getItem(ON_KEY);
      if (en !== null) mem.enabled = (en === '1');
    } catch (e) {}
    // 每次进入都换个随机种子，保证说法常新，但学习结果持久保留
    mem._seed = (Date.now() ^ ((mem.sessions + 1) * 2654435761)) & 0x7fffffff || 12345;
    mem._loaded = true;
  }
  function save() {
    try {
      var c = {};
      for (var k in mem) if (mem.hasOwnProperty(k) && k[0] !== '_') c[k] = mem[k];
      localStorage.setItem(MEM_KEY, JSON.stringify(c));
    } catch (e) {}
  }

  // ---------------- 随机数（线性同余，可复现种子）----------------
  function rng() {
    mem._seed = (mem._seed * 1103515245 + 12345) & 0x7fffffff;
    return mem._seed / 0x7fffffff;
  }

  // ---------------- 开关 ----------------
  function isEnabled() { load(); return mem.enabled !== false; }
  function setEnabled(b) { load(); mem.enabled = !!b; try { localStorage.setItem(ON_KEY, b ? '1' : '0'); } catch (e) {} save(); }

  // ---------------- 五行 → 方位/行业/时令（中英成对）----------------
  var ELEM = {
    '木': { dir: { zh: '东方', en: 'the East' }, field: { zh: '文教、文创、医养、成长型行业', en: 'education, culture, wellness and growth sectors' }, season: { zh: '春', en: 'spring' } },
    '火': { dir: { zh: '南方', en: 'the South' }, field: { zh: '能源、传媒、餐饮、演艺、科技', en: 'energy, media, hospitality, performance and tech' }, season: { zh: '夏', en: 'summer' } },
    '土': { dir: { zh: '本地/中原', en: 'the centre' }, field: { zh: '地产、建筑、农业、平台中介', en: 'property, construction, agriculture and platforms' }, season: { zh: '四季之交', en: 'the turn of seasons' } },
    '金': { dir: { zh: '西方', en: 'the West' }, field: { zh: '金融、法务、精密制造、军警', en: 'finance, law, precision craft and security' }, season: { zh: '秋', en: 'autumn' } },
    '水': { dir: { zh: '北方', en: 'the North' }, field: { zh: '物流、贸易、旅游、IT、咨询', en: 'logistics, trade, travel, IT and consulting' }, season: { zh: '冬', en: 'winter' } }
  };
  var PHASE_EN = { '木': 'Wood', '火': 'Fire', '土': 'Earth', '金': 'Metal', '水': 'Water' };
  var STEM = {
    '甲': ['Yang', 'Wood'], '乙': ['Yin', 'Wood'], '丙': ['Yang', 'Fire'], '丁': ['Yin', 'Fire'],
    '戊': ['Yang', 'Earth'], '己': ['Yin', 'Earth'], '庚': ['Yang', 'Metal'], '辛': ['Yin', 'Metal'],
    '壬': ['Yang', 'Water'], '癸': ['Yin', 'Water']
  };

  // ---------------- 心事词 → 心事域 ----------------
  var CAT_LEX = {
    career:   ['事业', '工作', '职业', '上班', '岗位', '跳槽', '升职', '创业', '项目', '老板', '裁员', '面试', '打工', '事业', 'job', 'career', 'work'],
    wealth:   ['财', '钱', '收入', '工资', '投资', '理财', '赚', '亏', '债', '房', '车', '经济', '财运', 'money', 'finance'],
    love:     ['感', '爱', '恋', '婚', '姻', '对象', '喜欢', '分手', '复合', '桃花', '相亲', '出轨', '单身', '娶', '嫁', 'love', 'relationship'],
    health:   ['健康', '身体', '病', '医', '睡', '失眠', '压力', '焦虑', '抑郁', '体质', '累', '康复', '运动', 'health', 'sleep', 'stress'],
    study:    ['学', '考', '试', '升学', '专业', '论文', '上岸', '考研', '留学', '成绩', '读书', 'study', 'exam'],
    relation: ['人际', '朋友', '关系', '同事', '领导', '家人', '父母', '孩子', '社交', '矛盾', '沟通', 'family', 'friend'],
    decision: ['决定', '选择', '犹豫', '迷茫', '方向', '要不要', '该不该', '取舍', '未来', '规划', '转行', 'decision', 'choose', 'future']
  };
  var CAT_LABEL = {
    career: '事业', wealth: '财运', love: '感情', health: '安康', study: '学业',
    relation: '人际', decision: '抉择', other: '心事'
  };

  function categorize(text) {
    text = String(text || '');
    var best = 'other', bestN = 0;
    for (var c in CAT_LEX) {
      if (!CAT_LEX.hasOwnProperty(c)) continue;
      var n = 0, words = CAT_LEX[c];
      for (var i = 0; i < words.length; i++) if (text.indexOf(words[i]) >= 0) n++;
      if (n > bestN) { bestN = n; best = c; }
    }
    return best;
  }
  function catLabel(c) { return CAT_LABEL[c] || CAT_LABEL.other; }

  // ---------------- 事实抽取 ----------------
  function facts(ctx) {
    var bz = ctx.bz || {};
    var gua = ctx.gua || {};
    var s = bz.strength || {};
    var score = typeof s.score === 'number' ? s.score : 50;
    var strengthZh = score >= 60 ? '偏强' : (score <= 40 ? '偏弱' : '中和');
    var strengthEn = score >= 60 ? 'strong' : (score <= 40 ? 'thin' : 'balanced');
    var like = (s.like && s.like[0]) || '';
    var el = ELEM[like] || { dir: { zh: '适宜之处', en: 'a fitting place' }, field: { zh: '与所喜五行相生的行当', en: 'a trade that nourishes you' }, season: { zh: '当下', en: 'the present' } };
    var dayGan = bz.dayGan || '';
    var dayMaster = bz.dayMaster || '';
    var dmZh = (dayGan && dayMaster && dayGan !== dayMaster) ? (dayGan + dayMaster) : (dayMaster || dayGan || '命主');
    var dmEn = (STEM[dayGan]) ? (STEM[dayGan][0] + ' ' + STEM[dayGan][1]) : (dayGan || 'Day Master');
    var concern = short(ctx.problemText || (ctx.shen && ctx.shen.domainLabel) || '心中所悬之事');
    return {
      dm: { zh: dmZh, en: dmEn },
      strength: { zh: strengthZh, en: strengthEn },
      like: { zh: like || '中和', en: PHASE_EN[like] || 'balance' },
      dir: el.dir, field: el.field, season: el.season,
      gua: gua.name || '此卦',
      bian: gua.bianName || '',
      dong: typeof gua.dong === 'number' ? gua.dong : -1,
      concern: concern,
      category: ctx.category || categorize(ctx.problemText || (ctx.shen && ctx.shen.domainLabel) || '')
    };
  }
  function short(t) {
    t = String(t || '').replace(/\s+/g, ' ').trim();
    return t.length > 20 ? t.slice(0, 20) + '…' : (t || '心中所悬之事');
  }

  // ---------------- 模板库（每槽多变体，中英双语）----------------
  var EMP = [
    { id: 'e0', zh: '客官这番心事，落在「{concern}」上，老朽看得出，你是真上了心、也真累了。', en: "You carry '{concern}' close to the heart — I can see you've taken it seriously, and that it has worn on you." },
    { id: 'e1', zh: '「{concern}」这一桩，能让你跨进三宝殿，说明它已在心里悬了有些时日了。', en: "'{concern}' has brought you to this hall — it has clearly been on your mind for a while." },
    { id: 'e2', zh: '不必急着要一个答案。你既来，我们便把「{concern}」摊开，一桩一桩看。', en: "No rush for an answer. Since you're here, let's lay '{concern}' out and look at it piece by piece." },
    { id: 'e3', zh: '先说一句：肯为「{concern}」操心的人，多半是对自己人生有要求的人。', en: "First, this: to worry over '{concern}' is often a sign someone holds themselves to a real standard." }
  ];
  var INSIGHT = [
    { id: 'i0', zh: '观你日主{dm}，气{strength}，所喜在{like}。这桩「{concern}」的结，多半不是命不帮你，而是{like}之力还没使在刀刃上。', en: 'Your Day Master is {dm}, {strength}, drawn to {like}. This knot over {concern} is rarely fate refusing help — more often {like} energy aimed slightly off-target.' },
    { id: 'i1', zh: '日主{dm}本{strength}，喜{like}。你把太多力气用在"扛"上，反把{like}该有的生机压住了——「{concern}」便成了心结。', en: 'A {dm} that is {strength} needs {like}. You spend much of your strength merely holding on, which suffocates the {like} that {concern} is really asking for.' },
    { id: 'i2', zh: '再配上这一卦「{gua}」：{dongline}你问的「{concern}」，症结常在"想得深、动得迟"上。', en: "Now this hexagram, '{gua}': {donglineEn} the crux of {concern} usually lies in thinking deeply but moving slowly." },
    { id: 'i3', zh: '命理上，日主{dm}、所喜{like}；卦象「{gua}」又{strength2}。两下相参，「{concern}」之困，在于你把自己的节奏交给了外界的风声。', en: 'In the chart, a {dm} favoring {like}; in the hexagram {gua}, {strength2En}. Together: the trouble with {concern} is that you have handed your tempo to other people\'s noise.' }
  ];
  var TIMING = [
    { id: 't0', zh: '眼下正值{season}，于你所喜之{like}最为相济——此时动手，事半而功倍。', en: 'We are in {season}, which suits your favored {like}; acting now costs you half the effort for twice the result.' },
    { id: 't1', zh: '{dongmsg}与其等一个"万全之时"，不如借这股东风，先走一小步。', en: '{dongmsgEn} Rather than wait for a "perfect moment," catch this wind and take one small step first.' },
    { id: 't2', zh: '时机不在远处，就在你把{like}相关的一件小事做成的当口。先成小事，大势自会跟来。', en: "Timing is not far away — it begins the moment you complete one small thing aligned with {like}. Finish that, and momentum follows." },
    { id: 't3', zh: '卦象示我：宜先"静观"三日，辨明何者为真、何者为惧，再定行止，于{season}最为稳妥。', en: 'The hexagram counsels three days of stillness first — telling what is real from what is fear — then act; this is safest in {season}.' }
  ];
  var PLAN = {
    career: [
      { id: 'c0', zh: '把「{concern}」拆成一件本周能交付的小事，先拿下它，让信心有处落脚。', en: "Break '{concern}' into one deliverable this week; land it, and let confidence have a foothold." },
      { id: 'c1', zh: '多往{dir}、多近{field}走动，贵人与转机常藏在你熟悉圈子的边缘。', en: "Move toward {dir} and {field}; allies and turning points often wait at the edge of your usual circle." },
      { id: 'c2', zh: '给现在的岗位/项目列一张"留与走"的清单一对比，答案会自己浮出来。', en: 'List a "stay or go" ledger for your role/project; the answer will surface on its own.' },
      { id: 'c3', zh: '与其闷头苦干，不如每周找一位前辈喝次茶，把你{like}方面的长处讲给人听。', en: 'Instead of grinding alone, meet one senior for tea weekly and voice your strengths in {like} out loud.' },
      { id: 'c4', zh: '为{concern}设一个"三个月检视点"，只问进展、不问成败，免得被焦虑带偏。', en: "Set a three-month checkpoint for {concern}; ask only about progress, never verdict, so anxiety can't steer you." }
    ],
    wealth: [
      { id: 'w0', zh: '先守后攻：把开销与债务各列一页，看清现金流，再谈进钱的门路。', en: 'Defend before you advance: page out your spending and debts, see the cash flow, then chase income.' },
      { id: 'w1', zh: '与{like}相生的行当（{field}）正当时令，可小额试水，切忌押上全部。', en: "Trades that nourish {like} ({field}) are in season — test with small sums, never bet it all." },
      { id: 'w2', zh: '设一笔"不动金"，金额再小也是底气；心定了，财决策才不慌。', en: 'Set aside an "untouchable" sum, however small — a calm mind makes money decisions clearly.' },
      { id: 'w3', zh: '把"想赚的钱"换成"能帮谁解决什么问题"，钱是价值的回声。', en: 'Reframe "money I want" as "whose problem I solve" — money is the echo of value.' },
      { id: 'w4', zh: '近{dir}之地、{field}之人，多留意；但任何"稳赚"之言，先打个问号。', en: 'Watch {dir} places and {field} people; but treat every "guaranteed gain" with a question mark.' }
    ],
    love: [
      { id: 'l0', zh: '「{concern}」最忌猜测。挑一个心平气和的黄昏，把真实的想法说给对方听。', en: "Guessing is the enemy of {concern}. Pick a calm dusk and say what you truly feel." },
      { id: 'l1', zh: '先把自己活得有光，缘分自会循光而来；这比追逐更省力、也更牢靠。', en: 'Live so you shine first; the right bond follows the light — easier and far more durable than chasing.' },
      { id: 'l2', zh: '把"他/她为何如此"换成"我要怎样的相处"，主动权就回到了你手里。', en: 'Shift from "why are they like this" to "what bond do I want" — and the wheel is back in your hands.' },
      { id: 'l3', zh: '旧情若反复，先问自己是舍不得人，还是舍不得那段用心的自己。', en: 'If an old love keeps returning, ask whether you miss the person — or the version of yourself who cared so much.' },
      { id: 'l4', zh: '感情如种花，宜{season}松土、慢浇水，急于催开反而伤了根。', en: 'Affection is a flower: loosen the soil in {season}, water slowly — forcing the bloom only hurts the root.' }
    ],
    health: [
      { id: 'h0', zh: '先把睡眠当成第一要务：固定就寝、睡前一小时离屏，比什么进补都紧要。', en: 'Treat sleep as priority one: fixed bedtime, screens off an hour before — this beats any tonic.' },
      { id: 'h1', zh: '每日散步半小时，走向{dir}，让气血如{like}般条达，郁结自松。', en: 'Walk half an hour daily toward {dir}; let your qi move like {like}, and the knots loosen.' },
      { id: 'h2', zh: '把"我必须撑住"换成"我可以求助"——示弱不是软弱，是止损。', en: 'Change "I must hold on" to "I can ask for help" — showing strain is not weakness, it is damage control.' },
      { id: 'h3', zh: '压力大的日子，给三餐与呼吸各留十分钟；身安则心定，心定则事清。', en: 'On heavy days, give ten minutes each to meals and breath; a settled body steadies the mind, and a steady mind sees clearly.' },
      { id: 'h4', zh: '若有持续的失眠、低落或身体警讯，请务必寻专业医师，莫只凭命理自解。', en: 'For lasting insomnia, low mood, or bodily warnings, please see a professional — not metaphysics alone.' }
    ],
    study: [
      { id: 's0', zh: '把大目标切成"每日一小时"的微习惯，坚持比强度更能改命。', en: 'Slice the big goal into a one-hour daily habit; consistency beats intensity.' },
      { id: 's1', zh: '用输出倒逼输入：把学过的东西讲给人听，卡壳处就是你真正的短板。', en: 'Force output through input: teach what you learn — where you stumble is your real gap.' },
      { id: 's2', zh: '近{field}之师、之书、之课，多亲近；找到同道，路就不那么黑。', en: 'Stay near {field} mentors, books, courses; with company, the road is less dark.' },
      { id: 's3', zh: '为{concern}定一个可量化的里程碑，达成便小庆一次，让大脑爱上进度。', en: 'Set a measurable milestone for {concern}; celebrate small wins so your mind learns to love progress.' },
      { id: 's4', zh: '考前/关要之时，规律作息贵过熬夜冲刺；清醒的头脑才是最好的笔墨。', en: 'Before the exam or the gate, regular rest beats cramming; a clear head is your best pen.' }
    ],
    relation: [
      { id: 'r0', zh: '矛盾当前，先复述对方的话再回应——被听见，火就消了一半。', en: 'In conflict, restate their words before replying — being heard halves the heat.' },
      { id: 'r1', zh: '把"你为何这样"换成"我需要什么"，指责变请求，路就通了。', en: 'Turn "why are you like this" into "here is what I need" — accusation into request opens the road.' },
      { id: 'r2', zh: '亲近之人也要有边界，{like}之和气，贵在有分寸、不一味讨好。', en: 'Even the closest need boundaries; the harmony of {like} lives in measure, not endless pleasing.' },
      { id: 'r3', zh: '每周主动问候一位久未联系的人，人际的河，久不疏就会淤。', en: 'Reach out to one long-lost contact weekly; rivers of relation silt up when untended.' },
      { id: 'r4', zh: '圈子不在大，在于有几人能说真话；把时间留给值得的同道。', en: 'A circle matters not in size but in how many speak truth; give your hours to those who deserve them.' }
    ],
    decision: [
      { id: 'd0', zh: '把选项各写一张纸，只列事实与代价，不写情绪——纸会比心更清醒。', en: 'Write each option on its own page: facts and costs only, no feelings — paper sees clearer than the heart.' },
      { id: 'd1', zh: '问自己"十年后回看，哪个选择更可能让我后悔没做"，往往就明了了。', en: 'Ask "a decade on, which would I more regret not doing" — that often settles it.' },
      { id: 'd2', zh: '大事不决，先设一个"可反悔的小步"，走了才知道风向。', en: 'When stuck, take a small reversible step first; walking reveals the wind.' },
      { id: 'd3', zh: '辨明这究竟是"你的渴望"，还是"别人的期待"——为谁而选，结果天差地别。', en: 'Discern whether this is your longing or someone else\'s expectation — for whom you choose changes everything.' },
      { id: 'd4', zh: '选择没有完美，只有"选了之后愿意负责"；负责的人，路会越走越宽。', en: 'No choice is perfect, only one you will own; those who own it find the road widening.' }
    ],
    other: [
      { id: 'o0', zh: '先把「{concern}」写下来，写成三行：是什么、卡在哪、下一步最小的一步。', en: "First write {concern} as three lines: what it is, where it's stuck, the smallest next step." },
      { id: 'o1', zh: '向{dir}、向{field}借一线生机，环境换新，心境常随之而开。', en: 'Borrow a thread of life from {dir} and {field}; a change of setting often opens the mind.' },
      { id: 'o2', zh: '心无头绪时，先做一件让身体舒服的小事，身安则智生。', en: 'When the mind is clouded, first do one small thing that eases the body — ease the body and clarity follows.' },
      { id: 'o3', zh: '不必一次想通所有事，允许自己"今天只懂一点点"，这也是进展。', en: "You needn't understand it all at once; allowing 'today I get a little' is also progress." },
      { id: 'o4', zh: '把注意力从"想不通"移到"手边能做"，行动是破除迷茫最好的符。', en: 'Shift attention from "I can\'t figure it out" to "what my hands can do" — action is the best talisman against confusion.' }
    ]
  };
  var CLOSING = [
    { id: 'z0', zh: '记牢：命理只是"天时之约"，不是定数。天人合一，合在"知天时、尽人事"——真正的转机，永远在你肯动的那一刻。', en: 'Remember: this is a "covenant of timing," not a verdict. Heaven-and-human as one means "know the season, then do your part" — the turning point is the moment you move.' },
    { id: 'z1', zh: '天有其时，地有其象，人有其为。把能做的做尽，把结果交给时间，这便是最好的"合"。', en: 'Heaven has its season, earth its signs, the human their doing. Do all you can, then leave the rest to time — that is the truest harmony.' },
    { id: 'z2', zh: '莫把老朽的话当成枷锁。卦是给你一个看问题的角度，路，终究是你自己走出来的。', en: "Don't take my words as chains. The hexagram is a lens, not a leash — the road is yours to walk." },
    { id: 'z3', zh: '愿你于{season}得{like}之助，把这一局「{concern}」走成往后的底气。若有回声，随时回殿里来。', en: "May {season} and {like} be with you, turning this '{concern}' into the ground you stand on. Come back to the hall whenever you have news." }
  ];

  // ---------------- 多臂老虎机：按变体 ----------------
  function slotState(slot) { if (!mem.slots[slot]) mem.slots[slot] = {}; return mem.slots[slot]; }
  function pick(slot, variants, excludeId) {
    var st = mem.slots[slot] || {};
    var cands = [];
    for (var i = 0; i < variants.length; i++) if (variants[i].id !== excludeId) cands.push(i);
    if (!cands.length) for (var j = 0; j < variants.length; j++) cands.push(j);
    var idx;
    if (rng() < 0.3) {                       // 探索
      idx = cands[Math.floor(rng() * cands.length)];
    } else {                                  // 利用：命中率(带 0.5 先验)取最大
      var best = -1, score0 = -1, ties = [];
      for (var k = 0; k < cands.length; k++) {
        var id = variants[cands[k]].id, s = st[id] || { w: 0, n: 0 };
        var sc = (s.w + 1) / (s.n + 2);
        if (sc > score0 + 1e-9) { score0 = sc; ties = [cands[k]]; }
        else if (Math.abs(sc - score0) < 1e-9) ties.push(cands[k]);
      }
      idx = ties[Math.floor(rng() * ties.length)];
    }
    return { id: variants[idx].id, obj: variants[idx] };
  }

  function pickPlan(cat, excludeIds) {
    var lib = PLAN[cat] || PLAN.other;
    excludeIds = excludeIds || {};
    var used = {}, out = [];
    for (var t = 0; t < 4; t++) {
      var p = pick('plan_' + cat, lib, null), guard = 0;
      while (used[p.id] && guard < 10) { p = pick('plan_' + cat, lib, null); guard++; }
      if (used[p.id]) {
        for (var i = 0; i < lib.length; i++) if (!used[lib[i].id]) { p = { id: lib[i].id, obj: lib[i] }; break; }
      }
      used[p.id] = true; out.push(p);
    }
    return out;
  }

  // ---------------- 填模板（中英按需取值）----------------
  function V(x, lang) { return (x && typeof x === 'object') ? (x[lang] || x.zh || x.en) : x; }
  function fill(str, f, lang) {
    var dongZh = f.dong >= 0 ? ('动爻已发，事将转向' + (f.bian || '新局') + '——') : '此卦静而不动，事在酝酿——';
    var dongEn = f.dong >= 0 ? ('A moving line shifts the hexagram toward ' + (f.bian || 'change') + ' — ') : 'The hexagram is still, matters quietly brewing — ';
    var sEn = f.strength.en;
    var map = {
      dm: V(f.dm, lang),
      strength: V(f.strength, lang),
      strength2: f.strength.zh === '偏强' ? '气偏旺' : (f.strength.zh === '偏弱' ? '气偏弱' : '气中和'),
      strength2En: sEn === 'strong' ? 'energy runs strong' : (sEn === 'thin' ? 'energy runs thin' : 'energy is balanced'),
      like: V(f.like, lang),
      dir: V(f.dir, lang),
      field: V(f.field, lang),
      season: V(f.season, lang),
      gua: f.gua,
      bian: f.bian || '新局',
      concern: f.concern,
      dongline: lang === 'en' ? dongEn : dongZh,
      donglineEn: dongEn,
      dongmsg: f.dong >= 0 ? '卦有动爻，宜乘势而动。' : '卦象主静，宜蓄势而后发。',
      dongmsgEn: f.dong >= 0 ? 'A moving line urges motion. ' : 'Stillness urges gathering. '
    };
    return String(str).replace(/\{(\w+)\}/g, function (m, k) { return (k in map) ? map[k] : m; });
  }

  // ---------------- 生成解惑 ----------------
  function generate(ctx, opts) {
    load();
    opts = opts || {};
    var lang = opts.lang === 'en' ? 'en' : 'zh';
    var prev = opts.prev || null;
    function prevId(slot) { if (prev && prev.slots) for (var i = 0; i < prev.slots.length; i++) if (prev.slots[i].slot === slot) return prev.slots[i].id; return null; }

    var f = facts(ctx);
    var cat = f.category;

    var emp = pick('empathy', EMP, prevId('empathy'));
    var ins = pick('insight', INSIGHT, prevId('insight'));
    var tim = pick('timing', TIMING, prevId('timing'));
    var clo = pick('closing', CLOSING, prevId('closing'));
    var prevPlanIds = {};
    if (prev && prev.plan) for (var p = 0; p < prev.plan.length; p++) prevPlanIds[prev.plan[p]] = true;
    var plan = pickPlan(cat, prevPlanIds);

    // 记录本次方案，供反馈归因 / "换一种说法"排除
    mem.lastPlan = {
      slots: [
        { slot: 'empathy', id: emp.id },
        { slot: 'insight', id: ins.id },
        { slot: 'timing', id: tim.id },
        { slot: 'closing', id: clo.id }
      ],
      plan: plan.map(function (p) { return p.id; }),
      category: cat,
      terms: []
    };

    var h = lang === 'en'
      ? { a: 'A word first', b: 'I. What is really at stake', c: 'II. Timing', d: 'III. Practical moves', e: 'IV. A parting word' }
      : { a: '先宽一言', b: '一、症结所在', c: '二、时机之象', d: '三、现实之计', e: '四、神算子一言' };

    var planLines = plan.map(function (p) {
      return (lang === 'en' ? '• ' : '· ') + fill(p.obj[lang === 'en' ? 'en' : 'zh'], f, lang);
    }).join('\n');

    var br = function (x) { return lang === 'en' ? x : '【' + x + '】'; };
    var out =
      '◈ ' + fill(emp.obj[lang === 'en' ? 'en' : 'zh'], f, lang) + '\n\n' +
      br(h.b) + '\n' + fill(ins.obj[lang === 'en' ? 'en' : 'zh'], f, lang) + '\n\n' +
      br(h.c) + '\n' + fill(tim.obj[lang === 'en' ? 'en' : 'zh'], f, lang) + '\n\n' +
      br(h.d) + '\n' + planLines + '\n\n' +
      br(h.e) + '\n' + fill(clo.obj[lang === 'en' ? 'en' : 'zh'], f, lang);

    // 隐式学习：把本次心事域计入复访
    bumpRecurring(cat);
    save();
    return out;
  }

  function bumpRecurring(cat) {
    mem.profile.recurring[cat] = (mem.profile.recurring[cat] || 0) + 1;
  }

  // ---------------- 隐式互动学习 ----------------
  function observe(evt) {
    load();
    evt = evt || {};
    switch (evt.type) {
      case 'session': mem.sessions++; break;
      case 'login':
        if (evt.name) mem.profile.name = evt.name;
        if (evt.sex) mem.profile.sex = evt.sex;
        break;
      case 'bazi':
        if (evt.fingerprint) mem.profile.lastFingerprint = evt.fingerprint;
        break;
      case 'domain': {
        var c1 = evt.category || categorize(evt.label || '');
        bumpRecurring(c1);
        if (mem.lastPlan) mem.lastPlan.terms.push('domain:' + c1);
        break;
      }
      case 'free': {
        var text = String(evt.text || '');
        var cat = categorize(text);
        bumpRecurring(cat);
        learnTerms(text, cat);
        if (mem.lastPlan) mem.lastPlan.terms.push('free:' + cat);
        break;
      }
    }
    save();
  }

  function learnTerms(text, cat) {
    // 简易分词：扫描心事词典里的词；也抓 2~4 字中文片段
    var found = {};
    for (var c in CAT_LEX) {
      if (!CAT_LEX.hasOwnProperty(c)) continue;
      var words = CAT_LEX[c];
      for (var i = 0; i < words.length; i++) {
        if (/^[a-z]+$/i.test(words[i])) continue; // 跳过英文词，避免噪声
        if (text.indexOf(words[i]) >= 0) found[words[i]] = c;
      }
    }
    for (var term in found) {
      if (!found.hasOwnProperty(term)) continue;
      if (!mem.terms[term]) mem.terms[term] = {};
      mem.terms[term][found[term]] = (mem.terms[term][found[term]] || 0) + 1;
    }
  }

  // ---------------- 显式反馈（驱动进化）----------------
  function feedback(kind) {
    load();
    var plan = mem.lastPlan;
    if (!plan) return stats();
    mem.updates++;
    if (kind === 'like') {
      mem.resonance.like++;
      plan.slots.forEach(function (s) { var st = mem.slots[s.slot] || (mem.slots[s.slot] = {}); var r = st[s.id] || (st[s.id] = { w: 0, n: 0 }); r.w++; r.n++; });
      plan.plan.forEach(function (id) { var st = mem.slots['plan_' + plan.category] || (mem.slots['plan_' + plan.category] = {}); var r = st[id] || (st[id] = { w: 0, n: 0 }); r.w++; r.n++; });
      bumpTheme(plan.category, 1);
    } else if (kind === 'dislike') {
      mem.resonance.dislike++;
      plan.slots.forEach(function (s) { var st = mem.slots[s.slot] || (mem.slots[s.slot] = {}); var r = st[s.id] || (st[s.id] = { w: 0, n: 0 }); r.n++; });
      plan.plan.forEach(function (id) { var st = mem.slots['plan_' + plan.category] || (mem.slots['plan_' + plan.category] = {}); var r = st[id] || (st[id] = { w: 0, n: 0 }); r.n++; });
      bumpTheme(plan.category, -1);
    }
    save();
    return stats();
  }
  function bumpTheme(cat, d) {
    mem.themes[cat] = mem.themes[cat] || { like: 0, dislike: 0 };
    if (d > 0) mem.themes[cat].like++; else mem.themes[cat].dislike++;
  }

  // ---------------- 成长面板数据 ----------------
  function stats() {
    load();
    var lr = mem.resonance.like + mem.resonance.dislike;
    // 复访 Top
    var rec = Object.keys(mem.profile.recurring).map(function (k) { return { cat: k, label: catLabel(k), n: mem.profile.recurring[k] }; });
    rec.sort(function (a, b) { return b.n - a.n; });
    // 学过的心事词 Top
    var terms = Object.keys(mem.terms).map(function (t) {
      var tot = 0, dom = '', best = 0;
      for (var c in mem.terms[t]) if (mem.terms[t].hasOwnProperty(c)) { tot += mem.terms[t][c]; if (mem.terms[t][c] > best) { best = mem.terms[t][c]; dom = c; } }
      return { term: t, cat: dom, n: tot };
    });
    terms.sort(function (a, b) { return b.n - a.n; });
    return {
      enabled: mem.enabled,
      sessions: mem.sessions,
      updates: mem.updates,
      like: mem.resonance.like,
      dislike: mem.resonance.dislike,
      resonanceRate: lr ? Math.round((mem.resonance.like / lr) * 100) : null,
      recurring: rec.slice(0, 5),
      terms: terms.slice(0, 8),
      level: levelOf(mem.updates, mem.sessions)
    };
  }
  function levelOf(updates, sessions) {
    var x = updates + sessions;
    if (x >= 40) return { n: 4, name: '洞明', en: 'Attuned' };
    if (x >= 20) return { n: 3, name: '通透', en: 'Insightful' };
    if (x >= 8) return { n: 2, name: '渐入', en: 'Learning' };
    return { n: 1, name: '初启', en: 'Awakening' };
  }

  // ---------------- 导出 / 导入 / 重置 ----------------
  function exportJSON() {
    load();
    var c = {};
    for (var k in mem) if (mem.hasOwnProperty(k) && k[0] !== '_') c[k] = mem[k];
    return JSON.stringify(c);
  }
  function importJSON(str) {
    try {
      var j = JSON.parse(str);
      if (!j || j.version !== VERSION) return { ok: false, msg: '版本不匹配' };
      mem = blank();
      for (var k in j) if (j.hasOwnProperty(k)) mem[k] = j[k];
      mem._loaded = true;
      save();
      return { ok: true };
    } catch (e) {
      return { ok: false, msg: String(e && e.message || e) };
    }
  }
  function reset() {
    mem = blank();
    try { localStorage.removeItem(MEM_KEY); } catch (e) {}
    save();
    return stats();
  }

  return {
    isEnabled: isEnabled,
    setEnabled: setEnabled,
    generate: generate,
    observe: observe,
    feedback: feedback,
    stats: stats,
    exportJSON: exportJSON,
    importJSON: importJSON,
    reset: reset,
    lastPlan: function () { load(); return mem.lastPlan; },
    _mem: function () { load(); return mem; }
  };
});
