/* =========================================================================
 * wuxing.js —— 天干地支、五行关系、地支藏干等基础常量
 * ========================================================================= */
(function (global) {
  'use strict';
  var NS = (global.NS = global.NS || {});

  NS.TIANGAN = '甲乙丙丁戊己庚辛壬癸'.split('');
  NS.DIZHI = '子丑寅卯辰巳午未申酉戌亥'.split('');

  /* 天干五行 */
  NS.TIANGAN_WUXING = ['木', '木', '火', '火', '土', '土', '金', '金', '水', '水'];
  /* 地支五行（本气） */
  NS.DIZHI_WUXING = ['水', '土', '木', '木', '土', '火', '火', '土',
    '金', '金', '土', '水'];

  NS.WUXING = ['金', '木', '水', '火', '土'];

  /* 五行相生：木→火→土→金→水→木 */
  NS.SHENG = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' };
  /* 五行相克：木克土，土克水，水克火，火克金，金克木 */
  NS.KE = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' };
  NS.SHENG_WO = { 火: '木', 土: '火', 金: '土', 水: '金', 木: '水' };
  NS.KE_WO = { 土: '木', 水: '土', 火: '水', 金: '火', 木: '金' };

  /* 十神关系名（相对日主而言） */
  NS.REL_NAME = {
    same: '比劫',    /* 同我 */
    print: '印星',   /* 生我 */
    output: '食伤',  /* 我生 */
    wealth: '财星',  /* 我克 */
    officer: '官杀'  /* 克我 */
  };

  /* 地支藏干：[本气, 中气, 余气(无则省略)] */
  NS.DIZHI_CANGGAN = [
    ['癸'],              /* 子 */
    ['己', '癸', '辛'],   /* 丑 */
    ['甲', '丙', '戊'],   /* 寅 */
    ['乙'],              /* 卯 */
    ['戊', '乙', '癸'],   /* 辰 */
    ['丙', '庚', '戊'],   /* 巳 */
    ['丁', '己'],        /* 午 */
    ['己', '丁', '乙'],   /* 未 */
    ['庚', '壬', '戊'],   /* 申 */
    ['辛'],              /* 酉 */
    ['戊', '辛', '丁'],   /* 戌 */
    ['壬', '甲']         /* 亥 */
  ];
  /* 藏干权重：本气 / 中气 / 余气 */
  NS.CANGGAN_WEIGHT = [1.0, 0.5, 0.3];

  /* 生肖 */
  NS.SHENGXIAO = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊',
    '猴', '鸡', '狗', '猪'];

  /* 五行 → 三才吉凶表用的编号：1木 2火 3土 4金 5水 */
  NS.WUXING_NUM = { 木: 1, 火: 2, 土: 3, 金: 4, 水: 5 };

  /* 三才吉凶简表（天格五行编号, 人格五行编号）→ 吉凶
   * 相生 / 比和为吉，相克为中吉（沿用原 Python 版的判定表） */
  NS.SANCAI_JI = (function () {
    var m = Object.create(null);
    var daJi = [[1, 1], [1, 3], [1, 5], [2, 2], [2, 4], [3, 1], [3, 3],
      [3, 5], [4, 2], [4, 4], [5, 1], [5, 3], [5, 5]];
    var zhongJi = [[1, 2], [1, 4], [2, 1], [2, 3], [2, 5], [3, 2], [3, 4],
      [4, 1], [4, 3], [4, 5], [5, 2], [5, 4]];
    daJi.forEach(function (k) { m[k[0] + '-' + k[1]] = '大吉'; });
    zhongJi.forEach(function (k) { m[k[0] + '-' + k[1]] = '中吉'; });
    return m;
  })();

  /* 相对日主的十神归类 */
  NS.relOf = function (dayWx, wx) {
    if (wx === dayWx) return 'same';
    if (NS.SHENG[wx] === dayWx) return 'print';
    if (NS.SHENG[dayWx] === wx) return 'output';
    if (NS.KE[dayWx] === wx) return 'wealth';
    if (NS.KE[wx] === dayWx) return 'officer';
    return 'same';
  };

  /* ---------------- 十神（完整十个） ----------------
   *
   * relOf 给的只是 5 类粗分（比劫/印星/食伤/财星/官杀），
   * 用来算身强身弱够用，但展示给人看不够 —— 八字工具都该显示完整的十神。
   * 区分办法是再看「阴阳异同」：
   *
   *   同我：同阴阳=比肩   异阴阳=劫财
   *   生我：同阴阳=偏印   异阴阳=正印
   *   我生：同阴阳=食神   异阴阳=伤官
   *   我克：同阴阳=偏财   异阴阳=正财
   *   克我：同阴阳=七杀   异阴阳=正官
   *
   * 口诀是「同性为偏、异性为正」（偏印/偏财/七杀都带偏字），
   * 只有比劫一对反着来 —— 同阴阳是比肩（兄弟同心），异阴阳才是劫财。
   *
   * 阴阳不用另建表：甲乙丙丁戊己庚辛壬癸 下标偶数为阳、奇数为阴，
   * 所以直接看下标奇偶即可。
   * 验证：甲(0,阳)见庚(6,阳) → 金克木、同为阳 → 七杀 ✓
   *       甲见辛(7,阴) → 阴阳异 → 正官 ✓
   *       甲见丙(2,阳) → 木生火、同阳 → 食神 ✓
   *       甲见乙(1,阴) → 同为木、阴阳异 → 劫财 ✓ */
  NS.SHISHEN = {
    same: ['比肩', '劫财'],
    print: ['偏印', '正印'],
    output: ['食神', '伤官'],
    wealth: ['偏财', '正财'],
    officer: ['七杀', '正官']
  };

  /* 十神 → 所属大类（用于汇总展示） */
  NS.SHISHEN_GROUP = {
    比肩: '比劫', 劫财: '比劫',
    偏印: '印星', 正印: '印星',
    食神: '食伤', 伤官: '食伤',
    偏财: '财星', 正财: '财星',
    七杀: '官杀', 正官: '官杀'
  };

  /** 天干的阴阳 */
  NS.ganYinYang = function (gan) {
    var i = (typeof gan === 'number') ? gan : NS.TIANGAN.indexOf(gan);
    if (i < 0) return '';
    return (i % 2 === 0) ? '阳' : '阴';
  };

  /**
   * 求某天干相对日主的十神
   * @param {number|string} dayGan 日主天干（下标或字）
   * @param {number|string} gan    被判断的天干
   * @returns {string} 十神名，无法判断时返回 ''
   */
  NS.shishen = function (dayGan, gan) {
    var d = (typeof dayGan === 'number') ? dayGan : NS.TIANGAN.indexOf(dayGan);
    var t = (typeof gan === 'number') ? gan : NS.TIANGAN.indexOf(gan);
    if (d < 0 || t < 0) return '';
    var rel = NS.relOf(NS.TIANGAN_WUXING[d], NS.TIANGAN_WUXING[t]);
    var same = ((d % 2) === (t % 2));
    return NS.SHISHEN[rel][same ? 0 : 1];
  };
})(typeof window !== 'undefined' ? window : globalThis);
