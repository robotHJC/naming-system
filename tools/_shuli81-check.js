#!/usr/bin/env node
/* 81 数理表自检：完整性 + 结构 + 与五格联动 */
'use strict';
const path = require('path');
const fs = require('fs');
const BASE = path.join(__dirname, '..', 'web', 'js');
['core/wuxing.js', 'core/calendar.js', 'data/shuli81.js', 'data/surnames.js',
  'data/chars-extra.js', 'data/chars.js', 'core/wuge.js'
].forEach(f => { try { require(path.join(BASE, f)); } catch (e) { } });
const NS = globalThis.NS;

const L = [];
let bad = 0;
const M = NS.SHULI81 || {};

L.push('===== 完整性 =====');
const nums = Object.keys(M).map(Number).sort((a, b) => a - b);
L.push('  收录数：' + nums.length + ' 个（应为 81）');
if (nums.length !== 81) bad++;
const missingN = [];
for (let i = 1; i <= 81; i++) if (!M[i]) missingN.push(i);
L.push('  缺：' + (missingN.join(',') || '无 ✓'));
if (missingN.length) bad++;

L.push('');
L.push('===== 分布 =====');
const dist = {};
nums.forEach(n => { dist[M[n].ji] = (dist[M[n].ji] || 0) + 1; });
Object.keys(dist).forEach(k => L.push('  ' + k + '：' + dist[k] + ' 个'));
/* 吉凶比例是否离谱：吉应该在 35-45 之间，凶在 30-42，半吉 10-16 */
if (dist['吉'] < 30 || dist['吉'] > 50) { bad++; L.push('  ✗ 吉的数量异常'); }
if (dist['凶'] < 28 || dist['凶'] > 45) { bad++; L.push('  ✗ 凶的数量异常'); }

L.push('');
L.push('===== 取模规则（超过 81 减 80，直到落回 1-81）=====');
/* 161 - 80 = 81，81 已在 1..81 内，所以停在 81 而不是继续减到 1。
 * （“81 等同 1”那套说法是另一派的做法，本表不采用，81 自带「万物回春」。）*/
[[83, 3], [90, 10], [161, 81], [162, 2]].forEach(([inp, want]) => {
  const got = NS.shuliOf(inp);
  const ok = got && got.n === want;
  if (!ok) bad++;
  L.push((ok ? '  ✓ ' : '  ✗ ') + inp + ' → ' + (got ? got.n + '「' + got.name + '」' : 'null') +
    (ok ? '' : '（应为 ' + want + '）'));
});

L.push('');
L.push('===== 与真实姓名联动 =====');
/* calcWuge 收的是**笔画数数组**，不是字符串（第一版我传错了，返回「郝1」这种东西） */
function strokesOf(name) {
  return Array.from(name).map(c => {
    const info = NS.CHAR_DB[c];
    if (info) return info.strokes;
    const s = NS.SURNAME_DB && NS.SURNAME_DB[c];
    return s ? s.strokes[0] : 0;
  });
}
[['郝', '清和'], ['郝', '嘉树'], ['欧阳', '沐涵'], ['李', '博士']]
  .forEach(([sn, gn]) => {
    let w = null;
    try { w = NS.Wuge.calcWuge(strokesOf(sn), strokesOf(gn)); }
    catch (e) { L.push('  ' + sn + gn + ' 计算失败：' + e.message); return; }
    if (!w) { L.push('  ' + sn + gn + '：无结果'); return; }
    const g = ['天格', '人格', '地格', '总格', '外格'].map(k => {
      const s = NS.shuliOf(w[k]);
      return k + ' ' + w[k] + (s ? '「' + s.name + '·' + s.ji + '」' : '');
    });
    L.push('  ' + sn + gn + '　' + g.join('　'));
    ['天格', '人格', '地格', '总格', '外格'].forEach(k => {
      if (!NS.shuliOf(w[k])) { bad++; L.push('    ✗ ' + k + ' ' + w[k] + ' 查不到'); }
    });
  });

fs.writeFileSync(path.join(__dirname, '_shuli81-out.txt'), L.join('\n'), 'utf8');
console.log('结构问题 ' + bad + ' 处；收录 ' + nums.length + '/81');
console.log('详见 tools/_shuli81-out.txt');
