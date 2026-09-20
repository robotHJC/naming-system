#!/usr/bin/env node
/* 调候自检 + 十神自检合并运行 */
'use strict';
const path = require('path');
const fs = require('fs');
const BASE = path.join(__dirname, '..', 'web', 'js');
['core/wuxing.js', 'core/calendar.js', 'data/nayin.js',
  'core/tiaohou.js', 'core/bazi.js'].forEach(f => require(path.join(BASE, f)));
const NS = globalThis.NS;

const L = [];
let bad = 0;

L.push('===== 调候：季节判定 =====');
const ZHI = NS.DIZHI;
const seasonRows = ZHI.map(z => z + '=' + (NS.Tiaohou.SEASON_OF[z] || '?'));
L.push('  ' + seasonRows.join('  '));
/* 十二地支必须全部有归属，且四季各三个 */
const cnt = {};
ZHI.forEach(z => { const s = NS.Tiaohou.SEASON_OF[z]; cnt[s] = (cnt[s] || 0) + 1; });
Object.keys(cnt).forEach(k => {
  L.push('  ' + k + '：' + cnt[k] + ' 个月支' + (cnt[k] === 3 ? '' : '  ← 应为 3！'));
  if (cnt[k] !== 3) bad++;
});
if (ZHI.some(z => !NS.Tiaohou.SEASON_OF[z])) { bad++; L.push('  ✗ 有地支没归季'); }

L.push('');
L.push('===== 调候：冬夏必须给方向，春秋必须不判定 =====');
[['亥', '火'], ['子', '火'], ['丑', '火'],
['巳', '水'], ['午', '水'], ['未', '水']].forEach(([z, wx]) => {
  if (NS.Tiaohou.NEED[NS.Tiaohou.SEASON_OF[z]] !== wx) { bad++; L.push('  ✗ ' + z + ' 应为 ' + wx); }
});
['寅', '卯', '辰', '申', '酉', '戌'].forEach(z => {
  const s = NS.Tiaohou.SEASON_OF[z];
  if (NS.Tiaohou.NEED[s]) { bad++; L.push('  ✗ ' + z + ' 属' + s + ' 却给了方向'); }
});
L.push('  冬→火、夏→水，春秋不判定  ✓');

L.push('');
L.push('===== 调候：真实排盘结果 =====');
const CASES = [
  [2026, 5, 20, 10, 0, '夏（巳月）'],
  [2026, 1, 20, 10, 0, '冬（丑月）'],
  [2026, 4, 20, 10, 0, '春（辰月）'],
  [2026, 10, 20, 10, 0, '秋（戌月）']
];
CASES.forEach(([y, m, d, h, mi, label]) => {
  const r = NS.Bazi.analyzeBazi(y, m, d, h, mi, {});
  const t = r.tiaohou;
  L.push('  ' + y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0') +
    '（' + label + '）' + '　四柱 ' + r.baziStr);
  L.push('    月支 ' + t.monthZhi + ' → ' + (t.seasonLabel || '—') +
    '　适用=' + t.applies + '　宜见=' + (t.needWx || '—') +
    '　占比=' + (t.ratio * 100).toFixed(0) + '%　偏虚=' + t.weak + '　冲突=' + t.conflict);
  L.push('    喜用神（扶抑法）：' + r.xiyongshen.join('、'));
  L.push('    ' + t.note);
});

L.push('');
L.push('===== 冲突样本扫描（2020-2030 全部月份）=====');
let conf = 0, applied = 0, rows = [];
for (let y = 2020; y <= 2030; y++) {
  for (let m = 1; m <= 12; m++) {
    const r = NS.Bazi.analyzeBazi(y, m, 15, 10, 0, {});
    const t = r.tiaohou;
    if (!t.applies) continue;
    applied++;
    if (t.conflict) {
      conf++;
      if (rows.length < 8) {
        rows.push('    ' + y + '-' + m + ' ' + r.baziStr + '　调候宜' + t.needWx +
          '（占' + (t.ratio * 100).toFixed(0) + '%）　但喜用神=' + r.xiyongshen.join('、'));
      }
    }
  }
}
L.push('  参与判定 ' + applied + ' 例，其中口径冲突 ' + conf + ' 例（' +
  (conf / applied * 100).toFixed(0) + '%）');
rows.forEach(r => L.push(r));

fs.writeFileSync(path.join(__dirname, '_tiaohou-out.txt'), L.join('\n'), 'utf8');
console.log('结构错误 ' + bad + ' 处；冲突样本 ' + conf + '/' + applied);
console.log('详见 tools/_tiaohou-out.txt');
