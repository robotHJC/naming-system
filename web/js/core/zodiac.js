/* =========================================================================
 * zodiac.js —— 生肖流派与八字的冲突分析
 *
 * 用户问：「今年马年是火年，那么是否就不能使用带水的字，更不能带火的字？」
 *
 * 这个问题把两套不同的体系叠在了一起，本模块的作用就是把它们**分开摆清楚**，
 * 并在结论冲突时明确说明谁优先 —— 而不是和稀泥给一个折中答案。
 *
 * 三套口径，三条不同的依据
 * ---------------------------------------------------------------
 *   1. 年柱干支五行 —— 年天干 + 年地支各自的五行。
 *      2026 丙午：丙火、午火 → 干支层看是「火年」。
 *
 *   2. 年柱纳音五行 —— 六十甲子纳音表，一甲子一轮换。
 *      2026 丙午（干支序 42）→ 纳音「天河水」→ **属水**。
 *      同一年，与上一套相反。
 *
 *   3. 八字喜用神 —— 以**日主**（出生日天干）为核心，看全局强弱，
 *      再定该补该泄。这是正统八字的路子。
 *      **年柱在四柱里权重最低**（年主祖上/少年），拿年份推喜忌方向就错了。
 *
 * 生肖形义派（民间）另有一套：属马忌「氵」、宜「艹/木/宀/禾」，
 * 依据是「马怕水」「马需草料与厩棚」的**字形象意**，
 * 与五行生克不是一回事。
 *
 * 本模块的立场
 * ---------------------------------------------------------------
 *   · 三套口径**并列展示**，各自标注依据与权重，不合并成一个分数
 *   · 生肖宜忌**不自动限制用字**，只提示
 *   · 与八字喜用神冲突时明确写「以八字为准」，并说明为什么
 * ========================================================================= */
(function (global) {
  'use strict';

  var NS = (global.NS = global.NS || {});

  /* 十二生肖与地支序号（子=0）的对应 */
  NS.SHENGXIAO_ZHI = {
    '鼠': 0, '牛': 1, '虎': 2, '兔': 3, '龙': 4, '蛇': 5,
    '马': 6, '羊': 7, '猴': 8, '鸡': 9, '狗': 10, '猪': 11
  };

  /* 生肖形义派的「忌用部首」。
   *
   * 说明：这一套各来源差异很大，我只收**流传最广、说法最一致**的几条，
   * 而且只用于**提示**，绝不参与打分或过滤。
   * 之所以要列出来，是因为用户会从别处听到这些说法 ——
   * 与其让他自己猜，不如摆出来并标注清楚它属于哪一派。 */
  NS.ZODIAC_FOLK_AVOID = {
    '马': { radicals: ['氵', '水', '田', '石'], why: '马怕水、马耕田劳苦、马蹄践石' },
    '牛': { radicals: ['羊', '午'], why: '丑未相冲、丑午相害' },
    '虎': { radicals: ['田', '申'], why: '虎耕田劳苦、寅申相冲' },
    '兔': { radicals: ['酉', '鸡'], why: '卯酉相冲' },
    '龙': { radicals: ['犬', '犭', '戌'], why: '辰戌相冲' },
    '蛇': { radicals: ['亥', '豕'], why: '巳亥相冲' },
    '羊': { radicals: ['牛', '丑'], why: '丑未相冲' },
    '猴': { radicals: ['虎', '寅'], why: '寅申相冲' },
    '鸡': { radicals: ['兔', '卯'], why: '卯酉相冲' },
    '狗': { radicals: ['龙', '辰'], why: '辰戌相冲' },
    '猪': { radicals: ['蛇', '巳'], why: '巳亥相冲' },
    '鼠': { radicals: ['马', '午'], why: '子午相冲' }
  };

  /**
   * 分析生肖 / 年柱的三套口径，并检测它们之间的矛盾。
   *
   * @param {Object} r NS.Bazi.analyzeBazi() 的返回值
   * @returns {Object|null}
   */
  NS.analyzeZodiac = function (r) {
    if (!r || !r.bazi) return null;
    var yii = NS.SHENGXIAO_ZHI[r.shengxiao];
    if (yii === undefined) return null;

    var yearGanWx = r.pillars[0].ganWx;   /* 年干五行 */
    var yearZhiWx = r.pillars[0].zhiWx;   /* 年支五行 */
    var nayin = NS.nayinOfGanzhi(
      NS.TIANGAN.indexOf(r.pillars[0].gan),
      NS.DIZHI.indexOf(r.pillars[0].zhi));

    var notes = [];
    var conflicts = [];

    /* ---- 矛盾一：干支五行 vs 纳音五行 ---- */
    var ganZhiAll = [yearGanWx, yearZhiWx];
    if (nayin) {
      if (ganZhiAll.indexOf(nayin.wuxing) < 0) {
        conflicts.push({
          kind: '干支与纳音不一致',
          a: '年柱干支（' + r.pillars[0].gan + r.pillars[0].zhi + '）为' +
            ganZhiAll.join('、'),
          b: '同年纳音「' + nayin.name + '」属' + nayin.wuxing,
          verdict: '两套口径本来就不同源，不存在谁对谁错；本系统不合并它们'
        });
      }
    }

    /* ---- 矛盾二：生肖形义派 vs 八字喜用神 ---- */
    var avoid = NS.ZODIAC_FOLK_AVOID[r.shengxiao];
    var xi = r.xiyongshen || [];
    if (avoid && avoid.radicals.length) {
      var xiRadicals = [];
      if (NS.Radical && NS.Radical.wuxingMap) {
        var map = NS.Radical.wuxingMap();
        xi.forEach(function (w) { if (map[w]) xiRadicals = xiRadicals.concat(map[w]); });
      }
      /* 若八字喜用神的推荐部首正好落在生肖忌用里，就是硬冲突 */
      var clash = avoid.radicals.filter(function (r) {
        return xiRadicals.indexOf(r) >= 0;
      });
      if (clash.length) {
        conflicts.push({
          kind: '生肖宜忌与八字喜用神冲突',
          a: '生肖形义派说属' + r.shengxiao + '忌用「' + clash.join('、') +
            '」（' + avoid.why + '）',
          b: '八字喜用神是「' + xi.join('、') + '」，正需要这类部首的字',
          verdict: '**以八字为准**。生肖形义派看的是字形象意（' + avoid.why +
            '），八字看的是日主强弱与五行生克，两套体系不同源。' +
            '正统八字里年支权重最低（年主祖上、少年），' +
            '拿生肖定用字方向本身就不是八字的路子。'
        });
      }
    }

    return {
      shengxiao: r.shengxiao,
      zhi: NS.DIZHI[yii],
      yearPillar: r.pillars[0].gan + r.pillars[0].zhi,
      yearGanWx: yearGanWx,
      yearZhiWx: yearZhiWx,
      nayin: nayin,
      /* 生肖形义派的民俗说法（仅提示） */
      folkAvoid: avoid || null,
      folkFavor: (NS.ZODIAC_RADICALS && NS.ZODIAC_RADICALS[r.shengxiao]) || null,
      conflicts: conflicts,
      notes: notes,
      /* 结论性的定位说明，界面直接展示 */
      stance: '三套口径（年柱干支 / 纳音 / 八字喜用神）**并列展示，不合并**。' +
        '取名**不按生肖自动限制用字** —— 因为生肖形义派与八字五行派会打架。' +
        '真要取舍时**以八字喜用神为准**：八字看的是出生那一刻的日主强弱，' +
        '年支只是四柱之一且权重最低。'
    };
  };

  /**
   * 检查某个名字的用字是否触犯生肖形义派的忌用（**仅提示，不扣分**）
   * @param {string[]} chars 名字用字
   * @param {string} shengxiao
   */
  NS.zodiacRadicalWarning = function (chars, shengxiao) {
    var avoid = NS.ZODIAC_FOLK_AVOID[shengxiao];
    if (!avoid || !NS.Radical) return null;
    var hits = [];
    (chars || []).forEach(function (c) {
      avoid.radicals.forEach(function (rad) {
        if (NS.Radical.matchAny(c, [rad]) && hits.indexOf(c + '（' + rad + '）') < 0) {
          hits.push(c + '（' + rad + '）');
        }
      });
    });
    if (!hits.length) return null;
    return {
      shengxiao: shengxiao,
      hits: hits,
      why: avoid.why,
      note: '这是**生肖形义派**的民俗说法（' + avoid.why + '），' +
        '不是八字五行判断，系统**不因此扣分**。' +
        '如果你同时按八字喜用神选字，两者冲突时以八字为准。'
    };
  };

  NS.Zodiac = {
    analyze: NS.analyzeZodiac,
    radicalWarning: NS.zodiacRadicalWarning,
    SHENGXIAO_ZHI: NS.SHENGXIAO_ZHI,
    FOLK_AVOID: NS.ZODIAC_FOLK_AVOID
  };

})(typeof window !== 'undefined' ? window : globalThis);
