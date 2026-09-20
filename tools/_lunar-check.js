/* =========================================================================
 * _lunar-check.js —— 农历算法的穷举验证
 *
 * 分两层：
 *   A. 结构性检查（不依赖任何记忆，覆盖 1901–2100 全部 73000+ 天）
 *   B. 对已知日期的抽查（春节 / 闰月）—— 这部分依赖外部数据，
 *      若 A 全过而 B 有偏差，首先应怀疑 B 的输入而不是算法。
 *
 * 运行： node tools/_lunar-check.js
 * 输出： tools/_lunar-out.txt（UTF-8，避免 PowerShell 重定向乱码）
 * ========================================================================= */
'use strict';
const path = require('path');
const fs = require('fs');

const BASE = path.join(__dirname, '..', 'web', 'js');
['core/calendar.js', 'core/lunar.js'].forEach(f => require(path.join(BASE, f)));
const NS = globalThis.NS;
const C = NS.Calendar;
const L = NS.Lunar;

const LOG = [];
const say = s => { LOG.push(s); process.stdout.write(s + '\n'); };

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; fails.push(name + (extra ? '  → ' + extra : '')); }
}

const pad = n => String(n).padStart(2, '0');
const dstr = d => `${d.y}-${pad(d.m)}-${pad(d.d)}`;

/* =====================================================================
 * A. 结构性检查
 * ===================================================================== */
say('=== A. 结构性检查（1901–2100 穷举） ===');

const Y0 = 1901, Y1 = 2100;

/* ---------- A1. 逐日往返转换恒等 ---------- */
let dayTotal = 0, roundTripBad = 0, nullCount = 0;
const notFound = [];
for (let y = Y0; y <= Y1; y++) {
  for (let m = 1; m <= 12; m++) {
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (let d = 1; d <= dim; d++) {
      dayTotal++;
      const lu = L.toLunar(y, m, d);
      if (!lu) { nullCount++; if (notFound.length < 5) notFound.push(dstr({ y, m, d })); continue; }
      const back = L.toGregorian(lu.y, lu.m, lu.d, lu.leap);
      if (!back || back.y !== y || back.m !== m || back.d !== d) {
        roundTripBad++;
        if (roundTripBad <= 5) {
          say(`   往返失败 ${y}-${pad(m)}-${pad(d)} → 农历 ${lu.y}/${lu.monthName}/${lu.dayName}` +
            ` → 公历 ${back ? dstr(back) : 'null'}`);
        }
      }
    }
  }
}
say(`  总天数 ${dayTotal}`);
ok('逐日「公历→农历→公历」往返恒等', roundTripBad === 0, roundTripBad + ' 天不匹配');
ok('每一天都能查到农历', nullCount === 0, nullCount + ' 天查不到 ' + notFound.join(','));

/* ---------- A2. 每月 29 或 30 天；每年 12 或 13 个月 ---------- */
const badMonthLen = [], badYearLen = [], leapCountBad = [];
const leapYears = [];
for (let Y = Y0; Y <= Y1; Y++) {
  const ms = L.monthsOfYear(Y);
  if (ms.length !== 12 && ms.length !== 13) badYearLen.push(Y + ':' + ms.length);
  const leaps = ms.filter(x => x.leap);
  if (ms.length === 13 && leaps.length !== 1) leapCountBad.push(Y + ':' + leaps.length);
  if (ms.length === 12 && leaps.length !== 0) leapCountBad.push(Y + ':' + leaps.length);
  if (ms.length === 13) leapYears.push(Y);
  ms.forEach(x => {
    if (x.days !== 29 && x.days !== 30) badMonthLen.push(`${Y}/${x.monthName}:${x.days}`);
  });
  /* 月号必须是 1..12：闰月与前一个月同号，且 13 个月时仍只占 12 个号 */
  const labels = ms.map(x => x.m);
  const uniq = Array.from(new Set(labels));
  if (uniq.length !== 12) {
    badYearLen.push(`${Y}:月号异常 ${labels.join(',')}`);
  }
}
ok('每个月恰为 29 或 30 天', badMonthLen.length === 0, badMonthLen.slice(0, 5).join(' '));
ok('每个农历年恰为 12 或 13 个月', badYearLen.length === 0, badYearLen.slice(0, 5).join(' '));
ok('13 个月的年恰有 1 个闰月、12 个月的年没有闰月',
  leapCountBad.length === 0, leapCountBad.slice(0, 5).join(' '));

/* ---------- A3. 中气与月数的守恒关系 ----------
 *
 * 注意：「非闰月一定含中气」是**假命题** —— 1985 年的正月就没有中气
 * （雨水落在十二月），而这并不使它成为闰月。同理「每月最多一个中气」
 * 也是假的：1984 年十一月同时含冬至与大寒。
 * 真正成立的是下面的守恒关系。 */
let leapWithZq = 0, monthTooManyZq = 0;
const zqOdd = [];
let badConserve = 0, badRange = 0, zqTotal = 0, zqPeriods = 0;
const conserveMiss = [];
for (let Y = Y0; Y <= Y1; Y++) {
  /* 逐月数中气 */
  L.monthsOfYear(Y).forEach(x => {
    let n = 0, t = L.nextZhongQiAfter(x.startJd);
    while (t < x.endJd) { n++; t = L.nextZhongQiAfter(t + 0.5); }
    if (x.leap && n !== 0) { leapWithZq++; if (zqOdd.length < 5) zqOdd.push(`${Y}/${x.monthName}=${n}`); }
    if (n > 2) { monthTooManyZq++; if (zqOdd.length < 5) zqOdd.push(`${Y}/${x.monthName}=${n}`); }
  });

  /* 编年周期与中气的关系。
   *
   * 一开始我以为「每个周期恒含 12 个中气」——不成立：周期的边界是朔日
   * 00:00，而 2033 年的小雪恰好落在 11-22 那天，落到了下一个周期里，
   * 于是周期 2033 只有 11 个、周期 2034 有 13 个。
   * 真正成立的是：
   *   · 每个周期的中气数只能是 11 / 12 / 13
   *   · 长期平均恰好 12（中气与朔望月两条独立天文节律的长期守恒）
   *   · 恒等式 cnt + 无中气月数 − 双中气月数 = 月数（计数自洽）
   */
  const per = L.periodOf(Y);
  let cnt = 0, zero = 0, two = 0;
  per.forEach(x => {
    let n = 0, t = L.nextZhongQiAfter(x.startJd);
    while (t < x.endJd) { n++; t = L.nextZhongQiAfter(t + 0.5); }
    cnt += n;
    if (n === 0) zero++;
    if (n >= 2) two++;
  });
  zqTotal += cnt;
  zqPeriods++;
  if (cnt < 11 || cnt > 13) badRange++;
  if (cnt + zero - two !== per.length) {
    badConserve++;
    if (conserveMiss.length < 5) {
      conserveMiss.push(`周期${Y}: ${per.length}月/${cnt}中气, 0中气${zero}个, 2中气${two}个`);
    }
  }
}
const avgZq = zqTotal / zqPeriods;
say(`  周期数 ${zqPeriods}，中气合计 ${zqTotal}，平均每周期 ${avgZq.toFixed(4)} 个`);
ok('闰月一定不含中气', leapWithZq === 0, leapWithZq + ' 例 ' + zqOdd.join(' '));
ok('任何月份都不含超过两个中气', monthTooManyZq === 0, monthTooManyZq + ' 例 ' + zqOdd.join(' '));
ok('每个编年周期的中气数只能是 11 / 12 / 13', badRange === 0, badRange + ' 例越界');
ok('长期平均中气数 = 12（中气与朔望月的守恒）',
  Math.abs(avgZq - 12) < 0.01, '平均 ' + avgZq.toFixed(4));
ok('恒等式「中气数 + 无中气月数 − 双中气月数 = 月数」处处成立',
  badConserve === 0, badConserve + ' 例 ' + conserveMiss.join('; '));

/* ---------- A4. 冬至必在十一月 ---------- */
const badDz = [];
for (let Y = Y0; Y <= Y1; Y++) {
  const jd = L.winterSolsticeJD(Y);
  const g = C.jdToGregorian(jd);
  const lu = L.toLunar(g.y, g.m, g.d);
  if (!lu || lu.m !== 11 || lu.leap || lu.y !== Y) {
    badDz.push(`${Y}冬至${dstr(g)}→${lu ? lu.y + '/' + lu.monthName : 'null'}`);
  }
}
ok('冬至永远落在「十一月」且属于农历年 Y',
  badDz.length === 0, badDz.slice(0, 5).join(' '));

/* ---------- A5. 春节落在 1/21 – 2/21 ---------- */
let springOut = 0;
const springList = [];
for (let Y = Y0; Y <= Y1; Y++) {
  const g = L.toGregorian(Y, 1, 1, false);
  if (!g) { springOut++; continue; }
  springList.push({ Y, g });
  const doy = C.dayOfYear(g.y, g.m, g.d);
  const jan21 = C.dayOfYear(g.y, 1, 21);
  const feb21 = C.dayOfYear(g.y, 2, 21);
  if (!(doy >= jan21 && doy <= feb21)) { springOut++; }
}
ok('春节永远落在公历 1/21 – 2/21 之间', springOut === 0, springOut + ' 例出界');
ok('每年都能算出正月初一', springList.length === Y1 - Y0 + 1,
  springList.length + ' / ' + (Y1 - Y0 + 1));

/* ---------- A6. 19 年 7 闰 ---------- */
/* 以 1901 起的连续 19 年窗口，闰年数应为 7 */
const leapSet = new Set(leapYears);
let bad19 = 0;
const bad19list = [];
for (let Y = 1901; Y + 18 <= 2100; Y++) {
  let n = 0;
  for (let i = 0; i < 19; i++) if (leapSet.has(Y + i) || leapSet.has(Y + i - 1)) { }
  /* 更严谨：数「正月落在 Y 年」的这一批年份不合适，
   * 用朔望月数直接算：19 个回归年 ≈ 235 个朔望月，其中 7 个闰月 */
  n = 0;
  for (let i = 0; i < 19; i++) {
    if (L.monthsOfYear(Y + i).length === 13) n++;
  }
  if (n !== 7 && bad19list.length < 8) bad19list.push(`${Y}..${Y + 18}:${n}`);
  if (n !== 7) bad19++;
}
const pct19 = (100 * (1 - bad19 / (2100 - 1901 - 17))).toFixed(1);
say(`  19 年窗口共 ${2100 - 1901 - 17} 个，闰年数≠7 的有 ${bad19} 个（符合率 ${pct19}%）`);
ok('19 年 7 闰的长期规律成立（至少 95% 的窗口）',
  bad19 / (2100 - 1901 - 17) < 0.05, bad19 + ' 个窗口不符');

/* ---------- A7. 农历年长度合理 ---------- */
const badYearDays = [];
for (let Y = Y0; Y <= Y1; Y++) {
  const d = L.lunarYearDays(Y);
  if (d < 353 || d > 385) badYearDays.push(Y + ':' + d);
}
ok('农历年长度落在 353–385 天', badYearDays.length === 0, badYearDays.slice(0, 5).join(' '));

/* ---------- A8. 每个月的日数与该月实际覆盖的日数一致 ---------- */
/* 用「相邻两个正月相隔的天数」交叉验证 */
let badSpan = 0;
for (let Y = Y0; Y <= Y1 - 1; Y++) {
  const a = L.toGregorian(Y, 1, 1, false);
  const b = L.toGregorian(Y + 1, 1, 1, false);
  if (!a || !b) { badSpan++; continue; }
  const span = C.dayNumber(b.y, b.m, b.d) - C.dayNumber(a.y, a.m, a.d);
  if (span !== L.lunarYearDays(Y)) badSpan++;
}
ok('「下一年正月初一 − 本年正月初一」= 本年总天数',
  badSpan === 0, badSpan + ' 年不符');

/* ---------- A9. 朔日校准表的自检 ----------
 * 校准表只有 4 条，是「算法分辨不了的刀口值」。这里断言：
 *   · 条目数恰为 4
 *   · 每一条对应的朔确实落在北京时间午夜 10 分钟内（否则它就不该在表里）
 *   · 落在午夜 ±5 分钟内的朔总数与记录一致（防止公式改动后刀口集合漂移）
 */
const fixKeys = Object.keys(L.NM_DAY_FIX);
ok('朔日校准表恰有 4 条', fixKeys.length === 4, JSON.stringify(L.NM_DAY_FIX));

function minsFromMidnight(k) {
  const p = C.jdToGregorian(L.newMoonLocalJD(k));
  const z = Math.floor(L.newMoonLocalJD(k) + 0.5);
  const f = L.newMoonLocalJD(k) + 0.5 - z;
  const m = f * 1440;
  return Math.min(m, 1440 - m);
}
const badFix = [];
fixKeys.forEach(k => {
  const d = minsFromMidnight(+k);
  if (d > 10) badFix.push(`${k} 距午夜 ${d.toFixed(1)} 分`);
});
ok('校准表里每一条都真的落在午夜 10 分钟内',
  badFix.length === 0, badFix.join('; '));

const kA = L.nmIndexOnOrBefore(L.winterSolsticeJD(Y0 - 1));
const kB = L.nmIndexOnOrBefore(L.winterSolsticeJD(Y1 + 1));
let nmTotal = 0, nm5 = 0, nm10 = 0;
const nm5list = [];
for (let k = kA; k <= kB; k++) {
  nmTotal++;
  const d = minsFromMidnight(k);
  if (d <= 5) { nm5++; nm5list.push(`${dayStr(L.newMoonLocalJD(k))}(${d.toFixed(1)}分)`); }
  if (d <= 10) nm10++;
}
say(`  范围内朔共 ${nmTotal} 个，距午夜 ≤5 分钟的 ${nm5} 个，≤10 分钟的 ${nm10} 个`);
say(`    ≤5 分钟的：${nm5list.join(' ')}`);
ok('范围内朔总数与已知一致', nmTotal === 2487, String(nmTotal));
ok('落在午夜 ±5 分钟内的朔数与已知一致（13 个）', nm5 === 13, String(nm5));

function dayStr(jd) {
  const g = C.jdToGregorian(jd);
  return `${g.y}-${pad(g.m)}-${pad(g.d)}`;
}

/* =====================================================================
 * B. 对已知日期的抽查
 * ===================================================================== */
say('\n=== B. 抽查（依赖外部已知数据） ===');

/* 春节（正月初一）公历日期。这些是公开常识性数据。 */
const SPRING = {
  1985: '1985-02-20', 1986: '1986-02-09', 1987: '1987-01-29', 1988: '1988-02-17',
  1989: '1989-02-06', 1990: '1990-01-27', 1991: '1991-02-15', 1992: '1992-02-04',
  1993: '1993-01-23', 1994: '1994-02-10', 1995: '1995-01-31', 1996: '1996-02-19',
  1997: '1997-02-07', 1998: '1998-01-28', 1999: '1999-02-16', 2000: '2000-02-05',
  2001: '2001-01-24', 2002: '2002-02-12', 2003: '2003-02-01', 2004: '2004-01-22',
  2005: '2005-02-09', 2006: '2006-01-29', 2007: '2007-02-18', 2008: '2008-02-07',
  2009: '2009-01-26', 2010: '2010-02-14', 2011: '2011-02-03', 2012: '2012-01-23',
  2013: '2013-02-10', 2014: '2014-01-31', 2015: '2015-02-19', 2016: '2016-02-08',
  2017: '2017-01-28', 2018: '2018-02-16', 2019: '2019-02-05', 2020: '2020-01-25',
  2021: '2021-02-12', 2022: '2022-02-01', 2023: '2023-01-22', 2024: '2024-02-10',
  2025: '2025-01-29', 2026: '2026-02-17', 2027: '2027-02-06', 2028: '2028-01-26',
  2029: '2029-02-13', 2030: '2030-02-03', 2031: '2031-01-23', 2032: '2032-02-11',
  2033: '2033-01-31', 2034: '2034-02-19', 2035: '2035-02-08', 2036: '2036-01-28',
  2037: '2037-02-15', 2038: '2038-02-04', 2039: '2039-01-24', 2040: '2040-02-12',
  2041: '2041-02-01', 2042: '2042-01-22', 2043: '2043-02-10', 2044: '2044-01-30',
  2045: '2045-02-17', 2046: '2046-02-06', 2047: '2047-01-26', 2048: '2048-02-14',
  2049: '2049-02-02', 2050: '2050-01-23'
};
let springBad = 0;
const springMiss = [];
Object.keys(SPRING).forEach(k => {
  const Y = +k;
  const g = L.toGregorian(Y, 1, 1, false);
  const got = g ? dstr(g) : 'null';
  if (got !== SPRING[k]) {
    springBad++;
    if (springMiss.length < 10) springMiss.push(`${Y} 实得 ${got} 期望 ${SPRING[k]}`);
  }
});
say(`  抽查 ${Object.keys(SPRING).length} 个年份的春节`);
ok('春节日期与已知数据一致', springBad === 0, '\n      ' + springMiss.join('\n      '));

/* 闰月：年份 → 闰几月 */
const LEAP = {
  2001: 4, 2004: 2, 2006: 7, 2009: 5, 2012: 4, 2014: 9, 2017: 6, 2020: 4,
  2023: 2, 2025: 6, 2028: 5, 2031: 3, 2033: 11, 2036: 6, 2039: 5, 2042: 2,
  2044: 7, 2047: 5, 2050: 3
};
let leapBad = 0;
const leapMiss = [];
Object.keys(LEAP).forEach(k => {
  const Y = +k;
  const got = L.leapMonthOf(Y);
  if (got !== LEAP[k]) {
    leapBad++;
    if (leapMiss.length < 10) leapMiss.push(`${Y} 实得 闰${got || '无'} 期望 闰${LEAP[k]}`);
  }
});
say(`  抽查 ${Object.keys(LEAP).length} 个闰月年份`);
ok('闰月月份与已知数据一致', leapBad === 0, '\n      ' + leapMiss.join('\n      '));

/* 反向抽查：已知公历日期对应的农历日期 */
const BACK = [
  [2024, 2, 10, 2024, 1, 1],   // 2024 春节
  [2020, 1, 25, 2020, 1, 1],   // 2020 春节
  [2020, 5, 23, 2020, 4, 1],   // 2020 闰四月初一（2020-05-23）
  [2033, 12, 22, 2033, 11, 1], // 2033 闰十一月初一
  [2025, 1, 29, 2025, 1, 1],   // 2025 春节
  [2026, 2, 17, 2026, 1, 1],   // 2026 春节
  [2000, 1, 1, 1999, 11, 25]   // 2000-01-01 = 农历 1999 年十一月廿五
];
let backBad = 0;
const backMiss = [];
BACK.forEach(([y, m, d, ly, lm, ld]) => {
  const lu = L.toLunar(y, m, d);
  if (!lu || lu.y !== ly || lu.m !== lm || lu.d !== ld) {
    backBad++;
    backMiss.push(`${dstr({ y, m, d })} 实得 ${lu ? lu.y + '/' + lu.monthName + '/' + lu.dayName : 'null'}` +
      ` 期望 ${ly}/${lm}月/${ld}日`);
  }
});
ok('公历→农历 反向抽查一致', backBad === 0, '\n      ' + backMiss.join('\n      '));

/* 2033 闰十一月 必须真的是闰月且不含中气 */
const m2033 = L.monthListOf(2033);
const leap2033 = m2033.filter(x => x.leap);
ok('2033 年闰十一月存在', leap2033.length === 1 && leap2033[0].m === 11,
  JSON.stringify(leap2033));
ok('2033 年共 13 个月', m2033.length === 13, String(m2033.length));

/* =====================================================================
 * 汇总
 * ===================================================================== */
say('\n=== 汇总 ===');
say(`  通过 ${pass} 项，失败 ${fail} 项`);
if (fails.length) {
  say('  失败明细：');
  fails.forEach(f => say('   ✗ ' + f));
}
say(`  演示：2026-02-15 → ${JSON.stringify(L.toLunar(2026, 2, 15))}`);
say(`  演示：农历 2020 年闰四月初一 → ${JSON.stringify(L.toGregorian(2020, 4, 1, true))}`);
say(`  演示：2033 年月表 → ${m2033.map(x => x.monthName + x.days).join(' ')}`);

fs.writeFileSync(path.join(__dirname, '_lunar-out.txt'), LOG.join('\n') + '\n', 'utf8');
process.exitCode = fail ? 1 : 0;
