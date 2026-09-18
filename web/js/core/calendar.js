/* =========================================================================
 * calendar.js —— 历法与天文计算
 *
 * 相比 Python 版内置的「固定节气日期表」（每月固定 6/4/6/5… 号），
 * 这里改用真实的太阳视黄经计算节气时刻（Meeus 低精度太阳位置公式），
 * 精度约 ±0.01°（≈ ±15 分钟），足以正确处理年柱「立春」与月柱「节令」换柱。
 *
 * 约定：对外接口使用北京时间（UTC+8）的「本地日期时间」，
 *       内部换算成 UT 儒略日后再做天文计算。
 * ========================================================================= */
(function (global) {
  'use strict';
  var NS = (global.NS = global.NS || {});

  var DEG = Math.PI / 180;
  var TZ = 8 / 24;                /* 北京时间为 UT+8 */
  var J2000 = 2451545.0;
  var MEAN_RATE = 365.2422 / 360; /* 太阳黄经平均变化：1° ≈ 1.0146 天 */

  /* ---------- 儒略日 ---------- */

  /** 公历日期 → 儒略日（0h UT，含小数） */
  function gregorianToJD(y, m, d, h, mi, s) {
    h = h || 0; mi = mi || 0; s = s || 0;
    var yy = y, mm = m;
    if (mm <= 2) { yy -= 1; mm += 12; }
    var a = Math.floor(yy / 100);
    var b = 2 - a + Math.floor(a / 4);
    var dayFrac = d + (h + mi / 60 + s / 3600) / 24;
    return Math.floor(365.25 * (yy + 4716))
      + Math.floor(30.6001 * (mm + 1))
      + dayFrac + b - 1524.5;
  }

  /** 儒略日 → 公历（返回 {y,m,d,h,mi}） */
  function jdToGregorian(jd) {
    var z = Math.floor(jd + 0.5);
    var f = jd + 0.5 - z;
    var a;
    if (z < 2299161) {
      a = z;
    } else {
      var alpha = Math.floor((z - 1867216.25) / 36524.25);
      a = z + 1 + alpha - Math.floor(alpha / 4);
    }
    var b = a + 1524;
    var c = Math.floor((b - 122.1) / 365.25);
    var dd = Math.floor(365.25 * c);
    var e = Math.floor((b - dd) / 30.6001);

    var dayF = b - dd - Math.floor(30.6001 * e) + f;
    var day = Math.floor(dayF);
    var frac = dayF - day;
    var month = (e < 14) ? e - 1 : e - 13;
    var year = (month > 2) ? c - 4716 : c - 4715;

    var totalMin = Math.round(frac * 24 * 60);
    var hh = Math.floor(totalMin / 60);
    var mi = totalMin % 60;
    if (hh >= 24) { hh -= 24; }
    return { y: year, m: month, d: day, h: hh, mi: mi };
  }

  /** 整数儒略日数（用于日干支） */
  function dayNumber(y, m, d) {
    return Math.floor(gregorianToJD(y, m, d, 12, 0, 0) + 0.5);
  }

  /* ---------- 太阳位置 ---------- */

  /**
   * 太阳视黄经（度，0-360）。jd 为 UT 儒略日。
   * 采用 Meeus《Astronomical Algorithms》第 25 章低精度公式，
   * 含中心差、光行差(-0.00569°)与章动主项(-0.00478°·sinΩ)，
   * 精度约 0.01°，对应时间误差 1-2 分钟。
   */
  function solarLongitude(jd) {
    var T = (jd - J2000) / 36525;

    /* 太阳几何平黄经 */
    var L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
    /* 太阳平近点角 */
    var M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * DEG;
    /* 中心差 */
    var C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M)
      + (0.019993 - 0.000101 * T) * Math.sin(2 * M)
      + 0.000289 * Math.sin(3 * M);

    var trueLong = L0 + C;
    /* 升交点黄经 → 章动主项 */
    var omega = (125.04 - 1934.136 * T) * DEG;
    var lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega);

    return ((lambda % 360) + 360) % 360;
  }

  /** 均时差（分钟）：真太阳时 = 平太阳时 + 均时差 */
  function equationOfTime(y, m, d) {
    var N = dayOfYear(y, m, d);
    var B = (360 * (N - 81) / 364) * DEG;
    return 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  }

  function dayOfYear(y, m, d) {
    var days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) days[1] = 29;
    var n = d;
    for (var i = 0; i < m - 1; i++) n += days[i];
    return n;
  }

  /* ---------- 二十四节气 ---------- */

  /* 十二「节」（换月柱用）：名称 → [太阳黄经, 近似公历月, 近似日] */
  var JIE = [
    { name: '小寒', deg: 285, month: 1, day: 6 },
    { name: '立春', deg: 315, month: 2, day: 4 },
    { name: '惊蛰', deg: 345, month: 3, day: 6 },
    { name: '清明', deg: 15, month: 4, day: 5 },
    { name: '立夏', deg: 45, month: 5, day: 6 },
    { name: '芒种', deg: 75, month: 6, day: 6 },
    { name: '小暑', deg: 105, month: 7, day: 7 },
    { name: '立秋', deg: 135, month: 8, day: 8 },
    { name: '白露', deg: 165, month: 9, day: 8 },
    { name: '寒露', deg: 195, month: 10, day: 8 },
    { name: '立冬', deg: 225, month: 11, day: 7 },
    { name: '大雪', deg: 255, month: 12, day: 7 }
  ];

  /* 节 → 月支序号（寅=2 起） */
  var JIE_ZHI = {
    立春: 2, 惊蛰: 3, 清明: 4, 立夏: 5, 芒种: 6, 小暑: 7,
    立秋: 8, 白露: 9, 寒露: 10, 立冬: 11, 大雪: 0, 小寒: 1
  };

  /** 求某年某个节气的 UT 儒略日（牛顿迭代） */
  function jieJD(year, jie) {
    var jd = gregorianToJD(year, jie.month, jie.day, 12, 0, 0);
    for (var i = 0; i < 12; i++) {
      var lon = solarLongitude(jd);
      var diff = ((jie.deg - lon + 540) % 360) - 180; /* 归一到 (-180,180] */
      jd += diff * MEAN_RATE;
      if (Math.abs(diff) < 1e-7) break;
    }
    return jd;
  }

  /**
   * 某年 12 个「节」的时刻（北京时间儒略日）
   * @returns {Array<{name:string, zhi:number, jdLocal:number, date:Object}>}
   */
  var _jieCache = Object.create(null);
  function jieOfYear(year) {
    if (_jieCache[year]) return _jieCache[year];
    var list = JIE.map(function (j) {
      var jdUT = jieJD(year, j);
      var jdLocal = jdUT + TZ;
      return {
        name: j.name,
        zhi: JIE_ZHI[j.name],
        jdLocal: jdLocal,
        date: jdToGregorian(jdLocal)
      };
    });
    _jieCache[year] = list;
    return list;
  }

  /** 取跨 year-1 ~ year+1 的所有节，按时间升序（用于定位月柱区间） */
  function jieRange(year) {
    var all = [];
    for (var y = year - 1; y <= year + 1; y++) {
      jieOfYear(y).forEach(function (x) { all.push(x); });
    }
    all.sort(function (a, b) { return a.jdLocal - b.jdLocal; });
    return all;
  }

  /**
   * 按北京时间定位出生点所在的「节」区间
   * @returns {{current:Object, next:Object, prev:Object}}
   */
  function locateJie(year, jdLocal) {
    var all = jieRange(year);
    var idx = -1;
    for (var i = 0; i < all.length; i++) {
      if (all[i].jdLocal <= jdLocal) idx = i; else break;
    }
    if (idx < 0) idx = 0;
    return {
      current: all[idx],
      prev: all[idx - 1] || null,
      next: all[idx + 1] || null,
      list: all
    };
  }

  NS.Calendar = {
    TZ: TZ,
    gregorianToJD: gregorianToJD,
    jdToGregorian: jdToGregorian,
    dayNumber: dayNumber,
    solarLongitude: solarLongitude,
    equationOfTime: equationOfTime,
    dayOfYear: dayOfYear,
    jieJD: jieJD,
    jieOfYear: jieOfYear,
    jieRange: jieRange,
    locateJie: locateJie,
    JEI_NAMES: JIE.map(function (j) { return j.name; })
  };
})(typeof window !== 'undefined' ? window : globalThis);
