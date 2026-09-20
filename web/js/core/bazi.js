/* =========================================================================
 * bazi.js —— 八字排盘与五行强弱分析
 *
 * 相比 Python 版内置算法的改进：
 *   1. 年柱「立春」换年、月柱按真实节气时刻换柱（原版用固定日期近似表）。
 *   2. 时柱支持真太阳时（经度时差 + 均时差），原版只做经度换算。
 *   3. 日柱可按「23 时换日」（晚子时）处理。
 *   4. 五行力量改为「天干 + 地支藏干加权 + 月令加成」，比原版单纯数个数更接近传统判定。
 *
 * 说明：本模块追求「规则清晰、结果可解释」，不做神煞、大运、流年等推算。
 * ========================================================================= */
(function (global) {
  'use strict';
  var NS = (global.NS = global.NS || {});
  var C = NS.Calendar;

  /**
   * 计算真太阳时
   * 真太阳时 = 北京时间 + (经度 - 120) × 4 分钟 + 均时差
   */
  function trueSolar(y, m, d, hour, minute, longitude) {
    var jdBeijing = C.gregorianToJD(y, m, d, hour, minute);
    var deltaMin = (longitude - 120) * 4 + C.equationOfTime(y, m, d);
    var jd = jdBeijing + deltaMin / 1440;
    var dt = C.jdToGregorian(jd);
    dt.deltaMin = Math.round(deltaMin);
    return dt;
  }

  /**
   * 排八字
   * @param {number} year  公历年
   * @param {number} month 公历月 (1-12)
   * @param {number} day   公历日
   * @param {number} hour  小时 (0-23)，北京时间
   * @param {number} minute 分钟
   * @param {Object} [opts] { longitude, trueSolarTime, ziShiNewDay }
   * @returns {Object} { 年/月/日/时: [ganIdx, zhiIdx], meta }
   */
  function calcBazi(year, month, day, hour, minute, opts) {
    opts = opts || {};
    minute = minute || 0;

    /* ---------- 生辰模糊的三档 ----------
     *
     * 现实中经常只知道个大概：户口本只记年份、农历日子记不清、
     * 只知道「夏天生的」。所以除了「不知道几点」，还要有
     * 「不知道哪一天」与「不知道几月」两档。
     *
     * 处理原则与时辰未知完全一致：**不确定的柱直接置空，绝不瞎填**。
     * 一柱变了整张盘的五行力量就变了，算出来的喜用神是假的，比不算更糟。
     * 三档是单向包含的：
     *
     *   noMonth 只知道年份   ⇒ 月、日、时三柱全未知
     *   noDay   只知道年月   ⇒ 日、时两柱未知，月柱给推定值
     *   noHour  不知道几点   ⇒ 时柱未知
     *
     * 有两处**推定**必须讲清楚（都置了 meta 标志，界面要如实说出来）：
     *   1. noDay：月柱取决于生在哪一天有没有过当月的「节」。
     *      节的交气落在每月 3–9 日，取 15 日就一定在节后，
     *      既不踩边界，也给出最可能的那一柱。年柱同理 ——
     *      立春在 2 月 3–5 日，取 15 日足以判断立春前后。
     *   2. noMonth：没有月份就判不了立春前后，按「立春后」推定 ——
     *      一个公历年里只有 1/1–2/3 这三十来天在立春之前。
     */
    var noMonth = opts.noMonth === true;
    var noDay = noMonth || opts.noDay === true;
    var noHour = noDay || opts.noHour === true;

    var useTST = opts.trueSolarTime !== false && typeof opts.longitude === 'number'
      && isFinite(opts.longitude);
    /* 真太阳时算的正是时柱与日柱，这两柱都不存在时它没有意义 */
    if (noDay) useTST = false;
    var ziShiNewDay = opts.ziShiNewDay !== false;

    /* 年柱与月柱只取决于「过没过节」，与几点无关；
     * 日未知时用户填的那个日期只是占位值，要换成本月 15 日再来判断 */
    var jdYM = noDay
      ? C.gregorianToJD(year, month, 15, 12, 0)
      : C.gregorianToJD(year, month, day, hour, minute);

    /* 真太阳时（用于日柱/时柱） */
    var ts = useTST ? trueSolar(year, month, day, hour, minute, opts.longitude)
      : { y: year, m: month, d: day, h: hour, mi: minute, deltaMin: 0 };
    var tstHour = ts.h;
    var tstMinute = ts.mi;

    /* ---------- 年柱：立春为界 ---------- */
    /* 只知道年份时判不了立春前后，按立春后推定，并置 yearAssumed */
    var sui = noMonth ? year
      : (jdYM >= C.jieOfYear(year)[1].jdLocal ? year : year - 1);
    var yearGan = ((sui - 4) % 10 + 10) % 10;
    var yearZhi = ((sui - 4) % 12 + 12) % 12;

    /* ---------- 月柱：以「节」为界 ---------- */
    var monthGan = null, monthZhi = null, loc = null;
    if (!noMonth) {
      loc = C.locateJie(year, jdYM);
      monthZhi = loc.current.zhi;   /* 已进入的节 → 该月月支 */

      /* 五虎遁：寅月天干 = (年干 % 5) × 2 + 2；其余月按距寅的步数顺推
       * （原 Python 版写成 (年干 × 2 + 月支) % 10，结果错误） */
      var stepsFromYin = ((monthZhi - 2) % 12 + 12) % 12;
      monthGan = (((yearGan % 5) * 2 + 2) + stepsFromYin) % 10;
    }

    /* ---------- 日柱 ---------- */
    /* 不知道哪一天，就没有日柱 —— 也就没有日主。
     * 日主是身强身弱、十神、喜用神唯一的参照物，缺了它这些全算不了，
     * 所以这里置空、由 analyzeBazi 整体降级，而不是拿占位日期硬算。 */
    var dayGan = null, dayZhi = null;
    if (!noDay) {
      var dayY = ts.y, dayM = ts.m, dayD = ts.d;
      if (ziShiNewDay && tstHour >= 23) {
        /* 晚子时：日柱进一位 */
        var next = C.jdToGregorian(
          C.gregorianToJD(dayY, dayM, dayD, 12, 0) + 1
        );
        dayY = next.y; dayM = next.m; dayD = next.d;
      }
      var dn = C.dayNumber(dayY, dayM, dayD);
      dayGan = ((dn + 9) % 10 + 10) % 10;
      dayZhi = ((dn + 1) % 12 + 12) % 12;
    }

    /* ---------- 时柱 ---------- */
    /* 时干是由日干推出来的，所以日柱未知时它必然也未知
     * （noHour 已被连带置真，这里不会真的取到 null 的 dayGan） */
    var hourZhi = null, hourGan = null;
    if (!noHour) {
      hourZhi = Math.floor((((tstHour + 1) % 24) + 24) % 24 / 2);
      hourGan = ((dayGan % 5) * 2 + hourZhi) % 10;
    }

    return {
      年: [yearGan, yearZhi],
      月: noMonth ? null : [monthGan, monthZhi],
      日: noDay ? null : [dayGan, dayZhi],
      时: noHour ? null : [hourGan, hourZhi],
      meta: {
        sui: sui,
        trueSolarTime: useTST,
        noHour: noHour,
        noDay: noDay,
        noMonth: noMonth,
        /* 年柱按「立春后」推定（只有 noMonth 时才会真） */
        yearAssumed: noMonth,
        /* 月柱按「本月 15 日」推定（只有日未知、但月份已知时才会真） */
        monthAssumed: noDay && !noMonth,
        tst: { y: ts.y, m: ts.m, d: ts.d, h: tstHour, mi: tstMinute },
        deltaMin: ts.deltaMin || 0,
        jieqi: loc ? loc.current.name : null,
        jieqiTime: loc ? loc.current.date : null,
        nextJieqi: (loc && loc.next) ? loc.next.name : null,
        nextJieqiTime: (loc && loc.next) ? loc.next.date : null,
        ziShiNewDay: ziShiNewDay
      }
    };
  }

  /**
   * 四柱字符串
   */
  function baziString(bz) {
    return ['年', '月', '日', '时'].map(function (k) {
      /* 时柱未知时报「--」而不是漏掉或拿年月日凑 ——
       * 少一柱一目了然，填空值反而容易被当成算过了 */
      if (!bz[k]) return '--';
      return NS.TIANGAN[bz[k][0]] + NS.DIZHI[bz[k][1]];
    }).join(' ');
  }

  /**
   * 五行力量：天干 + 地支藏干加权，月支（月令）额外加成
   * @returns {Object} { 木: number, ... }
   */
  function wuxingStrength(bz) {
    var s = { 金: 0, 木: 0, 水: 0, 火: 0, 土: 0 };
    var pillars = ['年', '月', '日', '时'];

    pillars.forEach(function (k) {
      if (!bz[k]) return;                          /* 时柱未知则不计 */
      s[NS.TIANGAN_WUXING[bz[k][0]]] += 1.0;              /* 天干 */
      var cg = NS.DIZHI_CANGGAN[bz[k][1]];
      for (var i = 0; i < cg.length; i++) {
        var w = NS.CANGGAN_WEIGHT[i] || 0.3;
        if (k === '月') w *= 1.5;                          /* 月令当令 */
        s[NS.TIANGAN_WUXING[NS.TIANGAN.indexOf(cg[i])]] += w;
      }
    });

    /* 日主本身不计入力量对比，但显示时保留 */
    return s;
  }

  /**
   * 简单个数统计（4 天干 + 4 地支本气），便于直观展示
   */
  function wuxingCount(bz) {
    var c = { 金: 0, 木: 0, 水: 0, 火: 0, 土: 0 };
    ['年', '月', '日', '时'].forEach(function (k) {
      if (!bz[k]) return;                          /* 时柱未知则不计 */
      c[NS.TIANGAN_WUXING[bz[k][0]]] += 1;
      c[NS.DIZHI_WUXING[bz[k][1]]] += 1;
    });
    return c;
  }

  /**
   * 十神力量：用与五行力量完全相同的权重
   * （天干 1.0、藏干按本气 1.0 / 中气 0.5 / 余气 0.3、月令 ×1.5）。
   *
   * 两个容易搞错的地方：
   *  1. 日主自己不算十神 —— 它是参照物。所以日柱的**天干**跳过，
   *     但日柱的**地支藏干**要算（那是夫妻宫，是别人）。
   *  2. 十神不只看天干，藏干也要看 —— 只算四个天干会丢掉大部分信息。
   */
  function shishenStrength(bz) {
    var dayGan = bz.日[0];
    var s = Object.create(null);
    ['年', '月', '日', '时'].forEach(function (k) {
      if (!bz[k]) return;                          /* 时柱未知则不计 */
      if (k !== '日') {
        var g = NS.shishen(dayGan, bz[k][0]);
        if (g) s[g] = (s[g] || 0) + 1.0;
      }
      var cg = NS.DIZHI_CANGGAN[bz[k][1]];
      for (var i = 0; i < cg.length; i++) {
        var w = NS.CANGGAN_WEIGHT[i] || 0.3;
        if (k === '月') w *= 1.5;
        var n = NS.shishen(dayGan, NS.TIANGAN.indexOf(cg[i]));
        if (n) s[n] = (s[n] || 0) + w;
      }
    });
    return s;
  }

  /* 十神的固定展示顺序（比劫 → 印 → 食伤 → 财 → 官杀），
   * 不按数值排 —— 按数值排会让同一次八字的不同说明里顺序乱跳。 */
  var SHISHEN_ORDER = ['比肩', '劫财', '偏印', '正印', '食神', '伤官',
    '偏财', '正财', '七杀', '正官'];

  /**
   * 完整分析：五行、日主、身强身弱、喜用神
   */
  function analyzeBazi(year, month, day, hour, minute, opts) {
    var bz = calcBazi(year, month, day, hour, minute, opts);
    var count = wuxingCount(bz);
    var power = wuxingStrength(bz);

    /* 日柱未知（不知道哪一天）时**没有日主** ——
     * 身强身弱、十神、喜用神全都是拿日主当参照物推出来的，
     * 没参照物就一个都算不了。这时一律置空，让上层退回
     * 「按名字内部五行搭配评分」，而不是硬凑一个假的喜用神。 */
    var dayGan = bz.日 ? bz.日[0] : null;
    var dayWx = dayGan === null ? null : NS.TIANGAN_WUXING[dayGan];

    var powerAdj = {};
    NS.WUXING.forEach(function (w) { powerAdj[w] = power[w]; });

    /* 同党 = 比劫(同我) + 印(生我)；异党 = 食伤 + 财 + 官杀 */
    var tongDang = 0, yiDang = 0;
    var byRel = { same: 0, print: 0, output: 0, wealth: 0, officer: 0 };
    var ratio = 0;
    var strength = null;
    var candidates = [];

    if (dayGan !== null) {
      /* 日主自身的力量剔除，避免把自己算进「同党」 */
      powerAdj[dayWx] = Math.max(0, powerAdj[dayWx] - 1.0);

      NS.WUXING.forEach(function (w) {
        var rel = NS.relOf(dayWx, w);
        byRel[rel] += powerAdj[w];
        if (rel === 'same' || rel === 'print') tongDang += powerAdj[w];
        else yiDang += powerAdj[w];
      });

      var total = tongDang + yiDang;
      ratio = total > 0 ? tongDang / total : 0.5;
      if (ratio >= 0.56) strength = '身强';
      else if (ratio >= 0.44) strength = '中和';
      else strength = '身弱';

      /* 喜用神：身强宜克泄耗，身弱宜生扶；同组内优先补「力量最小」的五行 */
      if (strength === '身强') {
        candidates = [NS.KE[dayWx], NS.KE_WO[dayWx], NS.SHENG[dayWx]];
      } else if (strength === '身弱') {
        candidates = [NS.SHENG_WO[dayWx], dayWx];
      } else {
        /* 中和：不偏不倚，取最弱的两个五行来补。
         * 若把五个全列成「喜用神」，等于没说，界面也没法给人有效参考。 */
        candidates = NS.WUXING.slice().sort(function (a, b) {
          return powerAdj[a] - powerAdj[b];
        }).slice(0, 2);
      }
      candidates = candidates.filter(function (w, i) {
        return candidates.indexOf(w) === i;
      });
      candidates.sort(function (a, b) { return powerAdj[a] - powerAdj[b]; });
    }

    var missing = NS.WUXING.filter(function (w) { return count[w] === 0; });

    var result = {
      bazi: bz,
      baziStr: baziString(bz),
      pillars: ['年', '月', '日', '时'].map(function (k) {
        /* 时柱未知：给出一个占位对象，界面据此显示「时辰未知」，
         * 而不是少一格让人以为算过了 */
        if (!bz[k]) {
          return {
            label: k, unknown: true, gan: '--', zhi: '--',
            ganWx: '', zhiWx: '', ganShishen: '', ganYinYang: '', cangGan: []
          };
        }
        return {
          label: k,
          unknown: false,
          gan: NS.TIANGAN[bz[k][0]],
          zhi: NS.DIZHI[bz[k][1]],
          ganWx: NS.TIANGAN_WUXING[bz[k][0]],
          zhiWx: NS.DIZHI_WUXING[bz[k][1]],
          /* 十神相对日主而言；日柱天干就是日主本身，所以留空不标 */
          ganShishen: (k === '日') ? '日主' : NS.shishen(dayGan, bz[k][0]),
          ganYinYang: NS.ganYinYang(bz[k][0]),
          cangGan: NS.DIZHI_CANGGAN[bz[k][1]].map(function (g) {
            return {
              gan: g,
              wx: NS.TIANGAN_WUXING[NS.TIANGAN.indexOf(g)],
              shishen: NS.shishen(dayGan, NS.TIANGAN.indexOf(g)),
              yinYang: NS.ganYinYang(NS.TIANGAN.indexOf(g))
            };
          })
        };
      }),
      count: count,
      power: powerAdj,
      byRel: byRel,
      tongDang: tongDang,
      yiDang: yiDang,
      ratio: ratio,
      /* 日柱未知时没有日主，这三个为 null —— 界面必须据此说明
       * 「无法推断喜用神」，而不是显示 undefined 或留一片空白 */
      dayGan: dayGan === null ? null : NS.TIANGAN[dayGan],
      dayWx: dayWx,
      dayYinYang: dayGan === null ? null : NS.ganYinYang(dayGan),
      /* 生辰模糊标志。界面据此把对应柱标成「--」，
       * 并说明五行力量到底按哪几柱推的 */
      noHour: !!bz.meta.noHour,
      noDay: !!bz.meta.noDay,
      noMonth: !!bz.meta.noMonth,
      yearAssumed: !!bz.meta.yearAssumed,
      monthAssumed: !!bz.meta.monthAssumed,
      /* 无日主时为 null（不是 '未知' 这种假值），界面靠这个判分支 */
      strength: strength,
      xiyongshen: candidates,
      missing: missing,
      shengxiao: NS.SHENGXIAO[bz.年[1]],
      /* 十神（完整十个）。和身强身弱用的 byRel 是两回事：
       * byRel 只分 5 大类且按五行汇总，这里是按十神逐个汇总，
       * 用于展示「这个八字里哪些十神旺、哪些全无」。 */
      shishen: (function () {
        /* 十神全部相对于日主而言，没有日主就没有十神 */
        if (dayGan === null) return null;
        var power = shishenStrength(bz);
        var present = SHISHEN_ORDER.filter(function (n) { return power[n] > 0; });
        return {
          power: power,
          present: present,
          /* 八字里一个都没有的十神。传统上「缺什么」不等于「该补什么」，
           * 和 missing（五行）同理，只作展示，不直接驱动选字。 */
          missing: SHISHEN_ORDER.filter(function (n) { return !power[n]; }),
          dominant: present.slice().sort(function (a, b) {
            return power[b] - power[a];
          })[0] || null,
          dayYinYang: NS.ganYinYang(dayGan)
        };
      })(),
      /* 年柱纳音（民俗命理口径）。
       * 与年柱干支五行**不同源**，2026 丙午就是典型案例：
       * 干支是火、纳音却是「天河水」属水。所以两者要并列展示，不能合并。 */
      nayin: NS.nayinOfGanzhi ? NS.nayinOfGanzhi(bz.年[0], bz.年[1]) : null,
      meta: bz.meta
    };

    /* 调候（寒暖燥湿）。单独一步、放在最后 ——
     * 它要读刚算好的 power 与 xiyongshen，而且只做提示不改结果。 */
    result.tiaohou = NS.Tiaohou ? NS.Tiaohou.analyze(result) : null;

    /* 地支刑冲合害。同样只进展示层、不改分数 ——
     * 按地支关系去修正五行力量（合化/冲损）是有流派分歧的做法，
     * 详见 core/branches.js 头部。 */
    result.branchRel = NS.BranchRel ? NS.BranchRel.analyze(result) : null;
    return result;
  }

  NS.Bazi = {
    calcBazi: calcBazi,
    baziString: baziString,
    wuxingCount: wuxingCount,
    wuxingStrength: wuxingStrength,
    shishenStrength: shishenStrength,
    SHISHEN_ORDER: SHISHEN_ORDER,
    analyzeBazi: analyzeBazi,
    trueSolar: trueSolar
  };
})(typeof window !== 'undefined' ? window : globalThis);
