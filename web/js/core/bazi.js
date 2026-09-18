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

    var useTST = opts.trueSolarTime !== false && typeof opts.longitude === 'number'
      && isFinite(opts.longitude);
    var ziShiNewDay = opts.ziShiNewDay !== false;

    /* 北京时间（用于年柱/月柱的节气边界比较） */
    var jdBeijing = C.gregorianToJD(year, month, day, hour, minute);

    /* 真太阳时（用于日柱/时柱） */
    var ts = useTST ? trueSolar(year, month, day, hour, minute, opts.longitude)
      : { y: year, m: month, d: day, h: hour, mi: minute, deltaMin: 0 };
    var tstHour = ts.h;
    var tstMinute = ts.mi;

    /* ---------- 年柱：立春为界 ---------- */
    var lichunCur = C.jieOfYear(year)[1];              /* 该年立春 */
    var sui = jdBeijing >= lichunCur.jdLocal ? year : year - 1;
    var yearGan = ((sui - 4) % 10 + 10) % 10;
    var yearZhi = ((sui - 4) % 12 + 12) % 12;

    /* ---------- 月柱：以「节」为界 ---------- */
    var loc = C.locateJie(year, jdBeijing);
    var monthZhi = loc.current.zhi;   /* 已进入的节 → 该月月支 */

    /* 五虎遁：寅月天干 = (年干 % 5) × 2 + 2；其余月按距寅的步数顺推
     * （原 Python 版写成 (年干 × 2 + 月支) % 10，结果错误） */
    var stepsFromYin = ((monthZhi - 2) % 12 + 12) % 12;
    var monthGan = (((yearGan % 5) * 2 + 2) + stepsFromYin) % 10;

    /* ---------- 日柱 ---------- */
    var dayY = ts.y, dayM = ts.m, dayD = ts.d;
    if (ziShiNewDay && tstHour >= 23) {
      /* 晚子时：日柱进一位 */
      var next = C.jdToGregorian(
        C.gregorianToJD(dayY, dayM, dayD, 12, 0) + 1
      );
      dayY = next.y; dayM = next.m; dayD = next.d;
    }
    var dn = C.dayNumber(dayY, dayM, dayD);
    var dayGan = ((dn + 9) % 10 + 10) % 10;
    var dayZhi = ((dn + 1) % 12 + 12) % 12;

    /* ---------- 时柱 ---------- */
    var hourZhi = Math.floor((((tstHour + 1) % 24) + 24) % 24 / 2);
    var hourGan = ((dayGan % 5) * 2 + hourZhi) % 10;

    return {
      年: [yearGan, yearZhi],
      月: [monthGan, monthZhi],
      日: [dayGan, dayZhi],
      时: [hourGan, hourZhi],
      meta: {
        sui: sui,
        trueSolarTime: useTST,
        tst: { y: ts.y, m: ts.m, d: ts.d, h: tstHour, mi: tstMinute },
        deltaMin: ts.deltaMin || 0,
        jieqi: loc.current.name,
        jieqiTime: loc.current.date,
        nextJieqi: loc.next ? loc.next.name : null,
        nextJieqiTime: loc.next ? loc.next.date : null,
        ziShiNewDay: ziShiNewDay
      }
    };
  }

  /**
   * 四柱字符串
   */
  function baziString(bz) {
    return ['年', '月', '日', '时'].map(function (k) {
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
      c[NS.TIANGAN_WUXING[bz[k][0]]] += 1;
      c[NS.DIZHI_WUXING[bz[k][1]]] += 1;
    });
    return c;
  }

  /**
   * 完整分析：五行、日主、身强身弱、喜用神
   */
  function analyzeBazi(year, month, day, hour, minute, opts) {
    var bz = calcBazi(year, month, day, hour, minute, opts);
    var count = wuxingCount(bz);
    var power = wuxingStrength(bz);

    var dayGan = bz.日[0];
    var dayWx = NS.TIANGAN_WUXING[dayGan];

    /* 日主自身的力量剔除，避免把自己算进「同党」 */
    var selfPower = 1.0;
    var powerAdj = {};
    NS.WUXING.forEach(function (w) { powerAdj[w] = power[w]; });
    powerAdj[dayWx] = Math.max(0, powerAdj[dayWx] - selfPower);

    /* 同党 = 比劫(同我) + 印(生我)；异党 = 食伤 + 财 + 官杀 */
    var tongDang = 0, yiDang = 0;
    var byRel = { same: 0, print: 0, output: 0, wealth: 0, officer: 0 };
    NS.WUXING.forEach(function (w) {
      var rel = NS.relOf(dayWx, w);
      byRel[rel] += powerAdj[w];
      if (rel === 'same' || rel === 'print') tongDang += powerAdj[w];
      else yiDang += powerAdj[w];
    });

    var total = tongDang + yiDang;
    var ratio = total > 0 ? tongDang / total : 0.5;
    var strength;
    if (ratio >= 0.56) strength = '身强';
    else if (ratio >= 0.44) strength = '中和';
    else strength = '身弱';

    /* 喜用神：身强宜克泄耗，身弱宜生扶；同组内优先补「力量最小」的五行 */
    var candidates;
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

    var missing = NS.WUXING.filter(function (w) { return count[w] === 0; });

    return {
      bazi: bz,
      baziStr: baziString(bz),
      pillars: ['年', '月', '日', '时'].map(function (k) {
        return {
          label: k,
          gan: NS.TIANGAN[bz[k][0]],
          zhi: NS.DIZHI[bz[k][1]],
          ganWx: NS.TIANGAN_WUXING[bz[k][0]],
          zhiWx: NS.DIZHI_WUXING[bz[k][1]],
          cangGan: NS.DIZHI_CANGGAN[bz[k][1]].map(function (g) {
            return { gan: g, wx: NS.TIANGAN_WUXING[NS.TIANGAN.indexOf(g)] };
          })
        };
      }),
      count: count,
      power: powerAdj,
      byRel: byRel,
      tongDang: tongDang,
      yiDang: yiDang,
      ratio: ratio,
      dayGan: NS.TIANGAN[dayGan],
      dayWx: dayWx,
      strength: strength,
      xiyongshen: candidates,
      missing: missing,
      shengxiao: NS.SHENGXIAO[bz.年[1]],
      meta: bz.meta
    };
  }

  NS.Bazi = {
    calcBazi: calcBazi,
    baziString: baziString,
    wuxingCount: wuxingCount,
    wuxingStrength: wuxingStrength,
    analyzeBazi: analyzeBazi,
    trueSolar: trueSolar
  };
})(typeof window !== 'undefined' ? window : globalThis);
