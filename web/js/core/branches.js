/* =========================================================================
 * branches.js —— 地支刑冲合害
 *
 * 为什么需要它
 * ---------------------------------------------------------------
 * 八字原来只算**五行力量**（天干 + 藏干加权 + 月令），完全没看地支之间的关系。
 * 但「子午冲」「卯戌合」「申子辰三合水局」这些关系，是传统命理判断命局
 * 松紧、顺逆的基本依据 —— 报个八字出来却不说地支关系，会显得很业余。
 *
 * ⚠️ 这里只做「算出来 + 说清楚」，**不改分数**
 * ---------------------------------------------------------------
 * 有一类做法是按地支关系去修正五行力量（三合成局则该五行大增、冲则两败俱伤），
 * 进而改变喜用神。**本模块刻意不做这件事**，原因：
 *
 *   1. **「合化」与「合而不化」是有争议的。** 三合成局要不要真化成那个五行，
 *      要看月令、看有没有透干、看有没有被冲破 —— 不同书的判定条件不一样，
 *      我手上没有可校勘的原本。按一个不确定的条件去改喜用神，
 *      等于用错的依据去覆盖原本正确的结论。
 *   2. 所以本模块的输出**只进展示层**：算出来的关系列给用户看，
 *      并在「日支被冲」这种公认的情形下给一条**可操作的选字建议**，
 *      让用户自己决定要不要用（配合已有的「必含字」「偏旁」筛选就能落地）。
 *
 * 这和「生肖形义派 vs 八字」「调候 vs 扶抑」是同一套处理：
 * 并列展示、不合并、冲突时说清取舍依据。
 *
 * 收录范围
 * ---------------------------------------------------------------
 * 六冲 / 六合 / 三合局 / 三会方 / 相刑（含自刑）/ 六害。
 *
 * **不收「相破」**：六破（子酉、午卯、巳申、寅亥、辰丑、戌未）在各书里
 * 是使用最少、争议最大的一组，有的书干脆不提。少一条好过错一条。
 * ========================================================================= */
(function (global) {
  'use strict';
  var NS = (global.NS = global.NS || {});

  /* 六冲：地支在圆盘上正对，下标相差 6 */
  /* 六合：一对一，合则为「合」；传统上还有合化五行，
   * 但「合而不化」的情形很常见，所以这里只报合、不报化。 */
  var LIUHE = {
    子: '丑', 丑: '子', 寅: '亥', 亥: '寅',
    卯: '戌', 戌: '卯', 辰: '酉', 酉: '辰',
    巳: '申', 申: '巳', 午: '未', 未: '午'
  };

  /* 三合局：长生 + 帝旺 + 墓库 */
  var SANHE = [
    { zhi: ['申', '子', '辰'], wx: '水', label: '申子辰三合水局' },
    { zhi: ['亥', '卯', '未'], wx: '木', label: '亥卯未三合木局' },
    { zhi: ['寅', '午', '戌'], wx: '火', label: '寅午戌三合火局' },
    { zhi: ['巳', '酉', '丑'], wx: '金', label: '巳酉丑三合金局' }
  ];

  /* 三会方：同方位三个地支聚齐 */
  var SANHUI = [
    { zhi: ['寅', '卯', '辰'], wx: '木', label: '寅卯辰会东方木' },
    { zhi: ['巳', '午', '未'], wx: '火', label: '巳午未会南方火' },
    { zhi: ['申', '酉', '戌'], wx: '金', label: '申酉戌会西方金' },
    { zhi: ['亥', '子', '丑'], wx: '水', label: '亥子丑会北方水' }
  ];

  /* 相刑（三刑）。组内任意两个相见即成刑。 */
  var XING = [
    { zhi: ['寅', '巳', '申'], name: '无恩之刑' },
    { zhi: ['丑', '戌', '未'], name: '恃势之刑' },
    { zhi: ['子', '卯'], name: '无礼之刑' }
  ];
  /* 自刑：同一个地支出现两次 */
  var ZIXING = ['辰', '午', '酉', '亥'];

  /* 六害 */
  var LIUHAI = [
    ['子', '未'], ['丑', '午'], ['寅', '巳'],
    ['卯', '辰'], ['申', '亥'], ['酉', '戌']
  ];

  /** 两个地支是否相冲 */
  function isChong(a, b) {
    return (NS.DIZHI.indexOf(a) - NS.DIZHI.indexOf(b) + 12) % 12 === 6;
  }

  /** 两个地支是否相害 */
  function isHai(a, b) {
    return LIUHAI.some(function (p) {
      return (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a);
    });
  }

  /** 两个地支是否相刑（含自刑需要两个相同的地支，这里只管不同支） */
  function isXing(a, b, sameTwo) {
    if (a === b) return ZIXING.indexOf(a) >= 0;      /* 自刑 */
    for (var i = 0; i < XING.length; i++) {
      var g = XING[i].zhi;
      if (g.indexOf(a) >= 0 && g.indexOf(b) >= 0) return true;
    }
    return false;
  }

  /** 取相刑组的名字，用于展示 */
  function xingName(a, b) {
    if (a === b) return '自刑';
    for (var i = 0; i < XING.length; i++) {
      var g = XING[i].zhi;
      if (g.indexOf(a) >= 0 && g.indexOf(b) >= 0) return XING[i].name;
    }
    return '相刑';
  }

  /**
   * 分析四柱地支之间的关系
   * @param {Object} bz NS.Bazi.analyzeBazi() 的结果
   * @returns {Object}
   */
  function analyze(bz) {
    /* 时柱未知时只有三个地支 —— 仍要分析，但要标出来
     * （少一支会让「三合局齐了没有」的判断变化，得让用户知道） */
    var slots = (bz.pillars || []).filter(function (p) {
      return p.zhi && p.zhi !== '--';
    }).map(function (p) { return { label: p.label, zhi: p.zhi }; });

    var out = {
      pillars: slots,
      chong: [], he: [], hai: [], xing: [],
      sanhe: [], sanhui: [],
      zhiCount: slots.length,
      advice: [],
      note: ''
    };

    /* ---- 两两比对 ---- */
    for (var i = 0; i < slots.length; i++) {
      for (var j = i + 1; j < slots.length; j++) {
        var A = slots[i], B = slots[j];
        var pair = A.label + '↔' + B.label;
        if (isChong(A.zhi, B.zhi)) {
          out.chong.push({ a: A.zhi, b: B.zhi, where: pair, labels: [A.label, B.label] });
        }
        if (LIUHE[A.zhi] === B.zhi) {
          out.he.push({ a: A.zhi, b: B.zhi, where: pair, labels: [A.label, B.label] });
        }
        if (isHai(A.zhi, B.zhi)) {
          out.hai.push({ a: A.zhi, b: B.zhi, where: pair });
        }
        if (isXing(A.zhi, B.zhi)) {
          out.xing.push({
            a: A.zhi, b: B.zhi, where: pair,
            name: xingName(A.zhi, B.zhi)
          });
        }
      }
    }

    /* ---- 三合局 / 三会方：看齐了几支 ---- */
    var present = {};
    slots.forEach(function (s) { present[s.zhi] = 1; });

    [['sanhe', SANHE], ['sanhui', SANHUI]].forEach(function (entry) {
      entry[1].forEach(function (g) {
        var hit = g.zhi.filter(function (z) { return present[z]; });
        if (hit.length >= 2) {
          out[entry[0]].push({
            label: g.label,
            wuxing: g.wx,
            present: hit,
            missing: g.zhi.filter(function (z) { return !present[z]; }),
            complete: hit.length === 3
          });
        }
      });
    });

    /* ---- 三刑齐全时合并成一条 ----
     * 寅巳申 三支齐了会报出三条「无恩之刑」（寅巳、寅申、巳申），
     * 读起来像出了三次事，其实是一件事。齐了就合并成「寅巳申三刑全」。 */
    var fullXing = [];
    XING.forEach(function (g) {
      if (g.zhi.length !== 3) return;
      if (!g.zhi.every(function (z) { return present[z]; })) return;
      fullXing.push({ label: g.zhi.join(''), name: g.name });
    });
    if (fullXing.length) {
      var fullLabels = {};
      fullXing.forEach(function (f) {
        f.label.split('').forEach(function (z) { fullLabels[z] = 1; });
      });
      /* 只保留不在这套三刑里的配对 */
      out.xing = out.xing.filter(function (x) {
        return !(fullLabels[x.a] && fullLabels[x.b]);
      });
      fullXing.forEach(function (f) {
        out.xing.push({
          a: f.label, b: '', where: '三支齐全',
          name: f.name + '（三刑全）', full: true
        });
      });
    }

    /* ---- 日支被冲 → 给一条可操作的选字建议 ----
     *
     * 日支是「自身 / 配偶宫」，被冲是传统上比较在意的一件事，
     * 而「用合神解冲」是标准做法（自己查得到、各家一致）。
     * 但**只给建议，不动分数** —— 要不要采用由用户决定。 */
    var dayZhi = null;
    slots.forEach(function (s) { if (s.label === '日') dayZhi = s.zhi; });

    if (dayZhi) {
      out.chong.forEach(function (c) {
        if (c.a !== dayZhi && c.b !== dayZhi) return;
        var other = (c.a === dayZhi) ? c.b : c.a;
        var jie = LIUHE[dayZhi];
        if (!jie) return;
        out.advice.push({
          kind: 'chong',
          title: '日支「' + dayZhi + '」被「' + other + '」冲（' + c.where + '）',
          text: '日支是自身宫位，被冲主起伏不定。传统做法是用「' +
            jie + '」来合住' + dayZhi + ' 解冲 —— 名字里带 ' + jie +
            '（' + (NS.DIZHI_WUXING[NS.DIZHI.indexOf(jie)] || '?') + '）相关意象或偏旁的字，' +
            '就是这一类思路。要不要采用由你决定，本系统不因此改动推荐分数。'
        });
      });
    }

    /* ---- 三合局缺一支 → 可以提示补那一支。这也是可操作的。 ---- */
    out.sanhe.forEach(function (g) {
      if (g.complete || g.missing.length !== 1) return;
      var m = g.missing[0];
      out.advice.push({
        kind: 'sanhe',
        title: g.label + '已有 ' + g.present.join('、') + '，独缺「' + m + '」',
        text: '三合局缺一支是常见的，缺的那支往往被认为是命局的「缺口」。' +
          '传统上会在名字里补上这一支（' +
          (NS.DIZHI_WUXING[NS.DIZHI.indexOf(m)] || '?') +
          '）—— 但这只是可选思路，不是必须，也不改变本系统的推荐分数。'
      });
    });

    /* ---- 汇总 ---- */
    out.summary = {
      chong: out.chong.length,
      he: out.he.length,
      hai: out.hai.length,
      xing: out.xing.length,
      sanhe: out.sanhe.length,
      sanhui: out.sanhui.length
    };
    out.total = out.chong.length + out.he.length + out.hai.length +
      out.xing.length;

    out.note = out.zhiCount < 4
      ? '注意：时柱未填，这里只比对了年、月、日三个地支 —— ' +
      '少一支会让「三合局齐了没有」的判断不同。'
      : '';

    return out;
  }

  NS.BranchRel = {
    analyze: analyze,
    isChong: isChong,
    isHai: isHai,
    isXing: isXing,
    LIUHE: LIUHE,
    SANHE: SANHE,
    SANHUI: SANHUI,
    XING: XING,
    ZIXING: ZIXING,
    LIUHAI: LIUHAI
  };

})(typeof window !== 'undefined' ? window : globalThis);
