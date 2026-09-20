/* =========================================================================
 * tiaohou.js —— 调候（寒暖燥湿）
 *
 * ⚠️ 为什么这里**没有**做《穷通宝鉴》那种「日干 × 月令 → 用神」的 120 条查表
 * -------------------------------------------------------------------------
 * 一开始的计划是把那张表录进来。但逐条写的时候发现两件事：
 *
 *   1. 那张表各版本之间**本来就有出入**。同是「庚金生未月」，
 *      不同印本给的用神不完全一致，我手上没有可校勘的原本。
 *   2. 更关键：**凭记忆录 120 条，错了不会有任何报错**，
 *      而错的后果是系统会拿一个错的依据去反驳原本正确的扶抑法结论 ——
 *      这比不做更糟。这和字库康熙笔画那条教训是同一件事
 *      （见 chars-extra.js 头部：规则推算在库内只有 76% 命中）。
 *
 * 所以这里只做**无争议的那部分核心原则**：
 *
 *     冬月（亥子丑）天寒 → 命局宜见火暖局
 *     夏月（巳午未）天燥 → 命局宜见水润局
 *     春月（寅卯辰）、秋月（申酉戌）→ **不判定**
 *
 * 春秋两季的调候取向随日干而变（春木喜火泄秀、秋金喜水润或火炼，
 * 说法不一），既然没有把握，就不装作有把握 —— 少说一条，好过说错一条。
 *
 * 判定结果只作**并列提示**，不参与评分、不改推荐：
 * 与扶抑法取的喜用神冲突时，明确告诉用户冲突在哪、本系统默认以扶抑法为准。
 * 这个处理方式和「生肖形义派 vs 八字」（zodiac.js）完全一致 ——
 * 不同流派并列展示、不合并、冲突时说明取舍依据。
 * ========================================================================= */
(function (global) {
  'use strict';
  var NS = (global.NS = global.NS || {});

  /* 月支 → 季节（调候只看寒暖燥湿，所以按四季分而不是按十二节） */
  var SEASON_OF = {
    亥: '冬', 子: '冬', 丑: '冬',
    巳: '夏', 午: '夏', 未: '夏',
    寅: '春', 卯: '春', 辰: '春',
    申: '秋', 酉: '秋', 戌: '秋'
  };

  var NEED = { 冬: '火', 夏: '水' };

  /* 「明显不足」的门槛：该五行占总力量的比例低于 15% 就算不足。
   * 定 15% 是因为五行的平均期望值是 20%，低于 15% 才称得上「虚」；
   * 门槛定高了会把大量正常命局误判成「需要调候」。 */
  var WEAK_RATIO = 0.15;

  /**
   * 调候分析
   * @param {Object} bz NS.Bazi.analyzeBazi() 的结果
   * @returns {Object} {
   *   season, monthZhi, applies, needWx, ratio, weak, conflict, xiyongshen, note
   * }
   */
  function analyze(bz) {
    /* 月柱未知（只知道年份）时 pillars[1] 的 zhi 是占位符 '--'，
     * SEASON_OF 取不到就成了「未知季节」，下面会直接返回 —— 正是想要的 */
    var monthZhi = bz.pillars[1].zhi;
    if (monthZhi === '--') monthZhi = '';
    var season = SEASON_OF[monthZhi] || '';

    var out = {
      season: season,
      seasonLabel: season ? season + '月' : '',
      monthZhi: monthZhi,
      applies: false,
      needWx: null,
      ratio: 0,
      weak: false,
      conflict: false,
      xiyongshen: (bz.xiyongshen || []).slice(),
      note: ''
    };

    /* 春秋不判定 —— 见文件头说明 */
    if (season !== '冬' && season !== '夏') {
      out.note = season
        ? '生月属' + season + '，调候取向随日干而变、各家说法不一，本系统不做判定，只看扶抑法。'
        : '生月未知（只知道年份），调候无从判断 —— 它要看的正是月令的寒暖燥湿。';
      return out;
    }

    var need = NEED[season];
    out.applies = true;
    out.needWx = need;

    var total = 0;
    NS.WUXING.forEach(function (w) { total += (bz.power[w] || 0); });
    out.ratio = total > 0 ? (bz.power[need] || 0) / total : 0;
    out.weak = out.ratio < WEAK_RATIO;

    /* 与扶抑法的喜用神是否冲突：调候需要的五行不在喜用神里。
     * 缺日柱时扶抑法根本给不出喜用神（空列表），此时无从对比 ——
     * 不能把「没有」当成「不一致」报出来。 */
    out.conflict = out.weak && out.xiyongshen.length > 0 &&
      out.xiyongshen.indexOf(need) < 0;

    var pct = (out.ratio * 100).toFixed(0);
    if (!out.weak) {
      out.note = '生月属' + season + '月，调候上宜见' + need + '；' +
        '本命局' + need + '占 ' + pct + '%，不虚，无需特别调候。';
    } else if (out.conflict) {
      out.note = '生月属' + season + '月，调候上宜见' + need + '暖局/润局，' +
        '而本命局' + need + '仅占 ' + pct + '%；' +
        '但扶抑法给出的喜用神是「' + (bz.xiyongshen.join('、') || '—') +
        '」，两者不一致。';
    } else {
      out.note = '生月属' + season + '月，调候上宜见' + need + '；' +
        '本命局' + need + '占 ' + pct + '%，偏虚，' +
        '而扶抑法的喜用神也包含' + need + '，两种口径方向一致。';
    }
    return out;
  }

  NS.Tiaohou = {
    analyze: analyze,
    SEASON_OF: SEASON_OF,
    NEED: NEED,
    WEAK_RATIO: WEAK_RATIO
  };

})(typeof window !== 'undefined' ? window : globalThis);
