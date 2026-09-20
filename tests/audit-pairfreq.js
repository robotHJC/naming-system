/* 看诗库里相邻二字词的词频分布，用来定 COMMON_PAIR_THRESHOLD */
'use strict';
const path = require('path');
const BASE = path.join(__dirname, '..', 'web', 'js');
[
  'data/chars-extra.js', 'data/chars.js', 'data/poetry.js', 'data/sources.js',
  'data/popularity.js', 'data/namewords.js',
  'core/poetry-lib.js'
].forEach(f => require(path.join(BASE, f)));
const NS = globalThis.NS;

const lib = NS.Poetry;
console.log('诗篇数：' + lib.poems.length);
console.log('相邻对去重后：' + lib.bigramCount);

const pairs = Object.keys(lib.pairFreq);
console.log('pairFreq 条目：' + pairs.length);

const byFreq = {};
pairs.forEach(k => {
  const f = lib.pairFreq[k];
  byFreq[f] = (byFreq[f] || 0) + 1;
});
console.log('\n词频分布（出现次数 → 有多少个不同的词）：');
Object.keys(byFreq).map(Number).sort((a, b) => b - a).forEach(f => {
  console.log(`  ${String(f).padStart(3)} 次  ${String(byFreq[f]).padStart(6)} 个`
    + (f >= 3 ? '   ← 会被判为日常词语' : ''));
});

console.log('\n最高频 30 个相邻对：');
lib.topPairs(30).forEach(x => console.log(`  ${x.pair}  ${x.freq}`));

/* 关键样例：好名字的用词 vs 普通名词 */
console.log('\n样例对照：');
[['风', '雨'], ['潮', '水'], ['江', '潮'], ['碧', '霄'], ['明', '月'],
['望', '舒'], ['静', '姝'], ['琼', '琚'], ['若', '水'], ['嘉', '树'],
['清', '和'], ['沐', '涵'], ['汀', '澜'], ['海', '平']].forEach(([a, b]) => {
  const f = lib.pairFreq[a + b] || 0;
  const hit = lib._pair(a, b);
  console.log(`  ${a}${b}  词频=${String(f).padStart(3)}  `
    + (hit ? (hit.everyday ? '日常词语（不算成词）' : '雅词（算成词）')
      + '  来源《' + hit.source + '》' : '库里没有'));
});
