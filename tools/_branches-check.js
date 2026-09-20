#!/usr/bin/env node
/* 地支刑冲合害自检：
 *   1. 六冲/六合 是否两两互逆且覆盖全部十二支
 *   2. 三合局/三会方 是否各四组、每组三支、不重不漏
 *   3. 实排结果与手算对照 */
'use strict';
const path = require('path');
const fs = require('fs');
const BASE = path.join(__dirname, '..', 'web', 'js');
['core/wuxing.js', 'core/calendar.js', 'data/nayin.js', 'core/tiaohou.js',
  'core/branches.js', 'core/bazi.js'].forEach(f => require(path.join(BASE, f)));
const NS = globalThis.NS;
const B = NS.BranchRel;

const L = [];
let bad = 0;

L.push('===== 六冲 =====');
/* 六冲必须两两互逆，且十二支恰好分成 6 对 */
const chongPairs = [];
NS.DIZHI.forEach(z => {
  NS.DIZHI.forEach(w => {
    if (B.isChong(z, w) && z < w) chongPairs.push(z + w);
  });
});
L.push('  ' + chongPairs.join('　'));
if (chongPairs.length !== 6) { bad++; L.push('  ✗ 应为 6 对，实际 ' + chongPairs.length); }
NS.DIZHI.forEach(z => {
  if (B.isChong(z, z)) { bad++; L.push('  ✗ ' + z + ' 自己冲自己'); }
});

L.push('');
L.push('===== 六合（必须一对一且互逆）=====');
const heSeen = [];
NS.DIZHI.forEach(z => {
  const w = B.LIUHE[z];
  if (!w) { bad++; L.push('  ✗ ' + z + ' 没有六合对象'); return; }
  if (B.LIUHE[w] !== z) { bad++; L.push('  ✗ ' + z + '↔' + w + ' 不互逆'); }
  if (z < w) heSeen.push(z + w);
});
L.push('  ' + heSeen.join('　') + '（共 ' + heSeen.length + ' 对）');
if (heSeen.length !== 6) { bad++; L.push('  ✗ 应为 6 对'); }

L.push('');
L.push('===== 三合局 / 三会方（各 4 组、每组三支、覆盖十二支）=====');
[['三合', B.SANHE], ['三会', B.SANHUI]].forEach(([name, arr]) => {
  if (arr.length !== 4) { bad++; L.push('  ✗ ' + name + ' 应为 4 组'); }
  const all = [];
  arr.forEach(g => {
    if (g.zhi.length !== 3) { bad++; L.push('  ✗ ' + g.label + ' 不是三支'); }
    g.zhi.forEach(z => all.push(z));
  });
  const uniq = new Set(all);
  L.push('  ' + name + '：' + arr.map(g => g.label).join('　'));
  if (uniq.size !== 12 || all.length !== 12) {
    bad++; L.push('  ✗ ' + name + ' 覆盖地支数 = ' + uniq.size + '（应为 12 且不重复）');
  }
  /* 同一支不能出现在两组里 */
  if (all.length !== uniq.size) { bad++; L.push('  ✗ ' + name + ' 有地支重复'); }
});

L.push('');
L.push('===== 相刑 / 六害 =====');
L.push('  三刑：' + B.XING.map(g => g.zhi.join('') + '(' + g.name + ')').join('　'));
L.push('  自刑：' + B.ZIXING.join(''));
L.push('  六害：' + B.LIUHAI.map(p => p.join('')).join('　'));
if (B.LIUHAI.length !== 6) { bad++; L.push('  ✗ 六害应为 6 对'); }

L.push('');
L.push('===== 实排对照 =====');
/* 2026-05-20 10:00 → 丙午 癸巳 甲午 己巳
 * 地支：年午 月巳 日午 时巳
 *   午午 = 自刑（午在 ZIXING 里）
 *   巳巳 = 自刑？巳不在 ZIXING（辰午酉亥），所以不算
 *   巳午之间没有冲/合/害/刑
 *   寅午戌三合火局：有午无寅戌 → 只有 1 支，不足 2，不报
 *   巳酉丑三合金局：有巳无酉丑 → 只有 1 支，不报
 *   巳午未三会火：有巳午，缺未 → 报「已有巳午，独缺未」 */
const r = NS.Bazi.analyzeBazi(2026, 5, 20, 10, 0, {});
L.push('  四柱：' + r.baziStr + '　地支 ' +
  r.pillars.map(p => p.zhi).join(''));
const br = r.branchRel;
L.push('  冲：' + (br.chong.map(c => c.a + c.b + '(' + c.where + ')').join('　') || '无'));
L.push('  合：' + (br.he.map(c => c.a + c.b + '(' + c.where + ')').join('　') || '无'));
L.push('  刑：' + (br.xing.map(c => c.a + c.b + '(' + c.name + ')').join('　') || '无'));
L.push('  害：' + (br.hai.map(c => c.a + c.b).join('　') || '无'));
L.push('  三合：' + (br.sanhe.map(g => g.label + ' 有' + g.present.join('') +
  (g.missing.length ? ' 缺' + g.missing.join('') : ' 齐')).join('　') || '无'));
L.push('  三会：' + (br.sanhui.map(g => g.label + ' 有' + g.present.join('') +
  (g.missing.length ? ' 缺' + g.missing.join('') : ' 齐')).join('　') || '无'));
L.push('  建议条数：' + br.advice.length);
br.advice.forEach(a => {
  L.push('    [' + a.kind + '] ' + a.title);
  L.push('      ' + a.text);
});

/* 手算对照：午午自刑必须被检出 */
const selfXing = br.xing.filter(x => x.a === x.b && x.a === '午');
if (!selfXing.length) {
  bad++;
  L.push('  ✗ 未检出「午午自刑」（手算：午在自刑表里，年月日时中有两个午）');
} else {
  L.push('  ✓ 检出午午自刑：' + selfXing.map(x => x.where).join(' '));
}
/* 三会火局缺未必须被检出 */
const huiHuo = br.sanhui.filter(g => g.wuxing === '火')[0];
if (!huiHuo || huiHuo.missing.join('') !== '未') {
  bad++;
  L.push('  ✗ 巳午未三会火应报「有巳午、缺未」，实际 ' +
    (huiHuo ? '有' + huiHuo.present.join('') + '缺' + huiHuo.missing.join('') : '未报'));
} else {
  L.push('  ✓ 检出巳午未三会火缺未');
}

L.push('');
L.push('===== 日支被冲的解冲建议 =====');
/* 找一个日支被冲的八字来验证建议 */
let found = 0;
for (let y = 2026; y <= 2027 && found < 3; y++) {
  for (let mo = 1; mo <= 12 && found < 3; mo++) {
    const a = NS.Bazi.analyzeBazi(y, mo, 15, 10, 0, {});
    const adv = a.branchRel.advice.filter(x => x.kind === 'chong');
    if (adv.length) {
      found++;
      L.push('  ' + y + '-' + mo + '-' + 15 + '　' + a.baziStr);
      adv.forEach(x => {
        L.push('    ' + x.title);
        /* 建议里必须提到六合的那一支，否则解冲就是空话 */
        const dayZhi = a.pillars[2].zhi;
        const jie = B.LIUHE[dayZhi];
        const ok = jie && x.text.indexOf(jie) >= 0;
        if (!ok) { bad++; L.push('    ✗ 建议里没提到合神「' + jie + '」'); }
        else L.push('    ✓ 提到合神「' + jie + '」');
      });
    }
  }
}
if (!found) L.push('  （这一年里没找到日支被冲的样本，跳过）');

L.push('');
L.push('===== 时辰未知时只有三个地支 =====');
const noH = NS.Bazi.analyzeBazi(2026, 5, 20, 0, 0, { noHour: true });
eq3('时柱未知时地支数为 3', noH.branchRel.zhiCount, 3);
ok3('提示文案说明了少一支', noH.branchRel.note.indexOf('少一支') >= 0,
  noH.branchRel.note);

function eq3(name, got, want) {
  const ok = got === want;
  if (!ok) bad++;
  L.push((ok ? '  ✓ ' : '  ✗ ') + name + '（' + got + '）');
}
function ok3(name, cond, extra) {
  if (!cond) bad++;
  L.push((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : '　' + (extra || '')));
}

fs.writeFileSync(path.join(__dirname, '_branches-out.txt'), L.join('\n'), 'utf8');
console.log('问题 ' + bad + ' 处，详见 tools/_branches-out.txt');
