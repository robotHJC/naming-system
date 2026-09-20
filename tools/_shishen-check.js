#!/usr/bin/env node
/* 十神自检：用已知对照验证 NS.shishen 与整体排盘
 * 输出写 tools/_shishen-out.txt（终端里中文会被 PowerShell 管道转码） */
'use strict';
const path = require('path');
const fs = require('fs');
const BASE = path.join(__dirname, '..', 'web', 'js');
[
  'core/wuxing.js', 'core/calendar.js',
  'data/nayin.js',
  'core/bazi.js'
].forEach(f => { require(path.join(BASE, f)); });
const NS = globalThis.NS;

/* 经典口诀对照表：日主 → 目标天干 → 应有十神。
 * 这些是任何一本命理入门书都有的固定关系，用来锁死实现别写反。 */
const CASES = [
  /* 甲木日主 */
  ['甲', '甲', '比肩'], ['甲', '乙', '劫财'],
  ['甲', '丙', '食神'], ['甲', '丁', '伤官'],
  ['甲', '戊', '偏财'], ['甲', '己', '正财'],
  ['甲', '庚', '七杀'], ['甲', '辛', '正官'],
  ['甲', '壬', '偏印'], ['甲', '癸', '正印'],
  /* 辛金日主（阴金）—— 换个阴阳看会不会全反 */
  ['辛', '辛', '比肩'], ['辛', '庚', '劫财'],
  ['辛', '壬', '伤官'], ['辛', '癸', '食神'],
  ['辛', '甲', '正财'], ['辛', '乙', '偏财'],
  ['辛', '丙', '正官'], ['辛', '丁', '七杀'],
  ['辛', '戊', '正印'], ['辛', '己', '偏印'],
  /* 壬水日主（阳水）*/
  ['壬', '甲', '食神'], ['壬', '乙', '伤官'],
  ['壬', '丙', '偏财'], ['壬', '丁', '正财'],
  ['壬', '戊', '七杀'], ['壬', '己', '正官'],
  ['壬', '庚', '偏印'], ['壬', '辛', '正印'],
  ['壬', '壬', '比肩'], ['壬', '癸', '劫财']
];

const L = [];
let bad = 0;
L.push('===== 十神口诀对照（日主 → 目标天干 = 应有十神）=====');
CASES.forEach(([d, t, want]) => {
  const got = NS.shishen(d, t);
  const ok = got === want;
  if (!ok) bad++;
  L.push((ok ? '  ✓ ' : '  ✗ ') + d + ' 见 ' + t + ' = ' + got + (ok ? '' : '  （应为 ' + want + '）'));
});
L.push('对照 ' + CASES.length + ' 条，不符 ' + bad + ' 条');

/* 阴阳是否与天干下标奇偶一致 */
L.push('');
L.push('===== 天干阴阳 =====');
L.push('  ' + NS.TIANGAN.map((g, i) => g + '=' + NS.ganYinYang(i)).join('  '));
L.push('  期望：甲丙戊庚壬为阳（偶数下标），乙丁己辛癸为阴');

/* 真实八字排盘 */
L.push('');
L.push('===== 实排：2026-05-20 10:00 =====');
const r = NS.Bazi.analyzeBazi(2026, 5, 20, 10, 0, {});
L.push('  四柱：' + r.baziStr);
L.push('  日主：' + r.dayGan + '（' + r.dayYinYang + r.dayWx + '）　' + r.strength +
  '　同党占比 ' + (r.ratio * 100).toFixed(0) + '%');
L.push('  喜用神：' + r.xiyongshen.join('、'));
L.push('  逐柱十神：');
r.pillars.forEach(p => {
  L.push('    ' + p.label + '柱 ' + p.gan + p.zhi + '　天干 ' + p.gan +
    '=' + p.ganShishen + '　藏干 ' +
    p.cangGan.map(c => c.gan + '=' + c.shishen).join(' '));
});
const pw = r.shishen.power;
const order = NS.Bazi.SHISHEN_ORDER;
L.push('  十神力量：' + order.map(n => n + ' ' + (pw[n] ? pw[n].toFixed(1) : '0')).join('　'));
L.push('  出现的十神：' + r.shishen.present.join('、'));
L.push('  没有的十神：' + (r.shishen.missing.join('、') || '（无）'));
L.push('  最旺：' + r.shishen.dominant);

/* 全十个十神是否都能被覆盖到（换不同八字试） */
L.push('');
L.push('===== 覆盖检查：随机八字能否产出全部十个十神 =====');
const seen = Object.create(null);
for (let y = 1980; y <= 2030; y += 3) {
  for (let m = 1; m <= 12; m += 2) {
    const a = NS.Bazi.analyzeBazi(y, m, 15, 10, 0, {});
    Object.keys(a.shishen.power).forEach(k => { seen[k] = 1; });
  }
}
const notSeen = order.filter(n => !seen[n]);
L.push('  已覆盖：' + order.filter(n => seen[n]).join('、'));
L.push('  未覆盖：' + (notSeen.join('、') || '（无 ✓）'));

fs.writeFileSync(path.join(__dirname, '_shishen-out.txt'), L.join('\n'), 'utf8');
console.log('十神对照不符 ' + bad + ' 条；未覆盖十神 ' + notSeen.length + ' 个');
console.log('详见 tools/_shishen-out.txt');
