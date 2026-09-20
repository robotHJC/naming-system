/* =========================================================================
 * preview.js —— 命令行预览排出来的名字
 *
 *   node tools/preview.js
 *   node tools/preview.js --surname 郝 --year 2024 --month 5 --day 20 --hour 10
 *   node tools/preview.js --length 1 --top 12
 *   node tools/preview.js --gender 女 --style 文雅
 *
 * 用途：改完打分/词库后，先在这里看名字的实际观感，
 * 再去浏览器里验证 UI。比反复点页面快得多。
 * ========================================================================= */
'use strict';

const path = require('path');
const BASE = path.join(__dirname, '..', 'web', 'js');

[
  'data/chars-extra.js', 'data/chars.js', 'data/surnames.js', 'data/poetry.js',
  'data/homophone.js', 'data/popularity.js', 'data/radicals.js',
  'data/radical-hints.js', 'data/namewords.js',
  'core/wuxing.js', 'core/calendar.js', 'core/bazi.js', 'core/wuge.js',
  'core/pinyin.js', 'core/poetry-lib.js', 'core/score.js', 'core/generator.js',
  'core/infer.js', 'core/lexicon.js', 'core/radical.js', 'core/variant.js'
].forEach(f => require(path.join(BASE, f)));

const NS = globalThis.NS;

/* ---- 极简参数解析 ---- */
const argv = process.argv.slice(2);
const opt = {
  surname: '郝', year: 0, month: 1, day: 1, hour: 12, minute: 0,
  length: 2, top: 20, gender: '', style: '', must: '', taboo: ''
};
for (let i = 0; i < argv.length - 1; i += 2) {
  const k = argv[i].replace(/^--/, '');
  if (k in opt) opt[k] = argv[i + 1];
}
['year', 'month', 'day', 'hour', 'minute', 'length', 'top'].forEach(k => {
  if (opt[k] !== '') opt[k] = parseInt(opt[k], 10);
});
const split = s => (s ? String(s).split(/[,，、\s]+/).filter(Boolean) : []);

/* ---- 八字 ---- */
let xiyongshen = [];
let baziInfo = '';
if (opt.year) {
  const b = NS.Bazi.analyzeBazi(opt.year, opt.month, opt.day, opt.hour, opt.minute);
  xiyongshen = b.xiyongshen;
  baziInfo = `${b.baziStr}  日主${b.dayGan}(${b.dayWx}) ${b.strength}`
    + `  喜用:${b.xiyongshen.join('、')}  生肖:${b.shengxiao}`;
}

/* ---- 生成 ---- */
const plan = NS.Generator.plan({
  surname: opt.surname,
  year: opt.year || undefined, month: opt.month, day: opt.day,
  hour: opt.hour, minute: opt.minute,
  xiyongshen: xiyongshen,
  length: opt.length, pool: 100, top: opt.top,
  gender: opt.gender || undefined,
  style: opt.style || undefined,
  mustInclude: split(opt.must),
  taboo: split(opt.taboo)
});

const t = Date.now();
const results = NS.Generator.runSync(plan);
const ms = Date.now() - t;

console.log('');
console.log('='.repeat(72));
console.log(`姓氏：${opt.surname}　` + (baziInfo || '（未填生辰，按名字内部五行搭配评价）'));
console.log(`候选池：${plan.ctx ? '' : ''}${opt.length} 字名　输出 ${results.length} 个　耗时 ${ms}ms`);
console.log('='.repeat(72));

results.forEach((r, i) => {
  const rank = String(i + 1).padStart(2, ' ');
  console.log(`\n${rank}. ${r.name}   ${r.pinyin}   ${r.score}分`);
  if (r.reasons && r.reasons.length) console.log(`    ${r.reasons.join(' · ')}`);
  if (r.poetry) {
    const kind = { classic: '成词', weak: '疑似成词', line: '同句', poem: '同篇' }[r.pairKind] || '';
    console.log(`    出处${kind ? '（' + kind + '）' : ''}：《${r.poetry.source}》`
      + (r.poetry.line ? `「${r.poetry.line}」` : ''));
  }
});

/* ---- 统计：方便判断分布是否合理 ---- */
if (results.length) {
  const scores = results.map(r => r.score);
  console.log('\n' + '-'.repeat(72));
  console.log(`分数区间：最高 ${Math.max(...scores)}　最低 ${Math.min(...scores)}　`
    + `分档数 ${new Set(scores).size}`);
  const first = results.map(r => r.name.charAt(1));
  console.log(`首字去重：${new Set(first).size}/${results.length}`);
  const kinds = {};
  results.forEach(r => { kinds[r.pairKind || '无'] = (kinds[r.pairKind || '无'] || 0) + 1; });
  console.log('出处分布：' + Object.keys(kinds).map(k => k + '×' + kinds[k]).join('　'));
  const modern = results.filter(r => (r.reasons || []).some(x => x.indexOf('现代常用搭配') >= 0));
  console.log(`现代搭配命中：${modern.length}/${results.length}`);
  console.log('');
}
