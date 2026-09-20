/* =========================================================================
 * _lunar-ref.js —— 与第三方成熟库逐日对拍
 *
 * 参照物：lunar-javascript 1.7.7（6tail/lunar-javascript，lunar 的 JS 版，
 * 有大量测试用例，支持 1900 起）。它只用于**开发期验证**，不进入产物。
 *
 * 首次使用要先装参照库（tools/_ref/ 已在 .gitignore 里，不会入库）：
 *   mkdir tools\_ref & cd tools\_ref & npm init -y & npm i lunar-javascript
 *
 * 对拍内容（1901–2100 每一天，约 73000 天）：
 *   · 农历年 / 月 / 日 / 是否闰月
 *   · 反方向：农历 → 公历
 * 只要有任意一天不一致就打印出来。
 *
 * 运行： node tools/_lunar-ref.js
 * 输出： tools/_lunar-ref-out.txt
 * ========================================================================= */
'use strict';
const path = require('path');
const fs = require('fs');

const BASE = path.join(__dirname, '..', 'web', 'js');
['core/calendar.js', 'core/lunar.js'].forEach(f => require(path.join(BASE, f)));
const NS = globalThis.NS, C = NS.Calendar, L = NS.Lunar;

const { Solar, Lunar } = require(path.join(__dirname, '_ref', 'node_modules', 'lunar-javascript'));

const LOG = [];
const say = s => LOG.push(s);
const pad = n => String(n).padStart(2, '0');

const Y0 = 1901, Y1 = 2100;

let n = 0, diff = 0;
const diffs = [];
let refFail = 0;

for (let y = Y0; y <= Y1; y++) {
  for (let m = 1; m <= 12; m++) {
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (let d = 1; d <= dim; d++) {
      n++;
      let rl;
      try {
        rl = Solar.fromYmd(y, m, d).getLunar();
      } catch (e) { refFail++; continue; }

      const ry = rl.getYear();
      const rmRaw = rl.getMonth();       /* 闰月为负数 */
      const rLeap = rmRaw < 0;
      const rm = Math.abs(rmRaw);
      const rd = rl.getDay();

      const mine = L.toLunar(y, m, d);
      const bad = !mine || mine.y !== ry || mine.m !== rm || mine.d !== rd || mine.leap !== rLeap;
      if (bad) {
        diff++;
        if (diffs.length < 40) {
          diffs.push(`${y}-${pad(m)}-${pad(d)}  我 ${mine ? mine.y + '/' + mine.monthName + '/' + mine.dayName : 'null'}` +
            `  参照 ${ry}/${rLeap ? '闰' : ''}${rm}月/${rd}`);
        }
      }
    }
  }
}

say('=== 与 lunar-javascript 逐日对拍 ===');
say(`范围 ${Y0}-${Y1}，共 ${n} 天，参照库异常 ${refFail} 次`);
say(`不一致 ${diff} 天`);
if (diffs.length) {
  say('前若干条不一致：');
  diffs.forEach(x => say('  ' + x));
}

/* 反向：农历 → 公历 */
let backDiff = 0;
const backDiffs = [];
for (let y = Y0; y <= Y1; y++) {
  const ms = L.monthListOf(y);
  for (const mm of ms) {
    for (let d = 1; d <= mm.days; d++) {
      const g = L.toGregorian(y, mm.m, d, mm.leap);
      let rl;
      try { rl = Lunar.fromYmd(y, mm.leap ? -mm.m : mm.m, d).getSolar(); } catch (e) { continue; }
      if (!g || g.y !== rl.getYear() || g.m !== rl.getMonth() || g.d !== rl.getDay()) {
        backDiff++;
        if (backDiffs.length < 20) {
          backDiffs.push(`农历 ${y}/${mm.leap ? '闰' : ''}${mm.m}月/${d}  我 ${g ? g.y + '-' + pad(g.m) + '-' + pad(g.d) : 'null'}` +
            `  参照 ${rl.getYear()}-${pad(rl.getMonth())}-${pad(rl.getDay())}`);
        }
      }
    }
  }
}
say(`\n=== 反向：农历 → 公历 ===`);
say(`不一致 ${backDiff} 处`);
if (backDiffs.length) backDiffs.forEach(x => say('  ' + x));

/* 闰月年份清单对比 */
const mineLeaps = [], refLeaps = [];
for (let y = Y0; y <= Y1; y++) {
  const a = L.leapMonthOf(y);
  const b = Lunar.fromYmd(y, 1, 1).getYear();  /* 占位，避免未用变量 */
  /* 参照库直接给该农历年的闰月 */
  const rl = Lunar.fromYmd(y, 1, 1);
  let ref = 0;
  for (let m = 1; m <= 12; m++) {
    try { if (Lunar.fromYmd(y, -m, 1).getMonth() === -m) { ref = m; break; } } catch (e) { }
  }
  if (a !== ref) mineLeaps.push(`${y}: 我闰${a || '无'} 参照闰${ref || '无'}`);
}
say(`\n=== 闰月清单对比 ===`);
say(`不一致 ${mineLeaps.length} 年`);
mineLeaps.slice(0, 30).forEach(x => say('  ' + x));

say('\n=== 结论 ===');
say(diff === 0 && backDiff === 0 && mineLeaps.length === 0
  ? '  双向完全一致。'
  : '  存在差异，需查阅上面明细。');

fs.writeFileSync(path.join(__dirname, '_lunar-ref-out.txt'), LOG.join('\n') + '\n', 'utf8');
process.exitCode = (diff || backDiff || mineLeaps.length) ? 1 : 0;
