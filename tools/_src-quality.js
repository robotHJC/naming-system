/* =========================================================================
 * _src-quality.js —— 新增文本源的「抽取质量」实测
 *
 * 目的：不靠猜，看每个源真正抽出来的「句内相邻二字」长什么样。
 *
 * 为什么这件事重要：诗词源的用法是「两个字在句内紧挨着出现 ⇒ 这可能是
 * 一个现成的词 ⇒ 算作出处」。这个代理指标对韵文很好，对散文很差
 * （以前 古文观止/幽梦影 就是这样被识别出噪声并拉黑的）。
 *
 * 每个源报告：
 *   · 抽出的诗篇数、建索引的相邻二字数
 *   · 其中「两字都在内置字库里」的比例（这些才是真能用于取名的）
 *   · 被「整名成词」词表命中的比例（一个粗略的噪声指标）
 *   · 高频对（出现 ≥8 次的）—— 高频往往意味着日常词语而非雅词
 *   · 抽样 24 条供人工过目
 *
 * 运行：node tools/_src-quality.js
 * 输出：tools/_src-quality-out.txt
 * ========================================================================= */
'use strict';
const path = require('path');
const fs = require('fs');

const BASE = path.join(__dirname, '..', 'web', 'js');
[
  'data/chars-extra.js', 'data/chars.js', 'data/surnames.js', 'data/poetry.js',
  'data/homophone.js', 'data/popularity.js', 'data/radicals.js',
  'data/radical-hints.js', 'data/namewords.js', 'data/era-chars.js',
  'data/nayin.js', 'data/shuli81.js', 'data/nameblock.js', 'data/fanti.js',
  'data/sources.js', 'data/cities.js', 'data/sichuan.js', 'data/nickname.js',
  'core/wuxing.js', 'core/calendar.js', 'core/lunar.js', 'core/tiaohou.js',
  'core/branches.js', 'core/bazi.js', 'core/wuge.js', 'core/pinyin.js',
  'core/poetry-lib.js', 'core/score.js', 'core/generator.js', 'core/net.js',
  'core/store.js', 'core/infer.js', 'core/dialect.js', 'core/lexicon.js',
  'core/radical.js', 'core/variant.js', 'core/hexagram.js', 'core/zodiac.js',
  'core/report.js'
].forEach(f => require(path.join(BASE, f)));

const NS = globalThis.NS;

const LOG = [];
const say = s => LOG.push(s);

/* 要检查的源：新增的全看，另取诗经与论语作对照 */
const CHECK = [
  'sanzijing', 'dizigui',
  'daxue', 'zhongyong', 'mengzi',
  'nantang', 'huajianji1', 'caocao', 'songci300', 'yuanqu',
  'shijing', 'lunyu', 'tangshi300', 'qianziwen', 'guwen'
];

async function fetchSrc(src) {
  for (const u of (src.urls || [])) {
    try {
      const r = await fetch(u);
      if (r.ok) return await r.text();
    } catch (e) { /* 试下一个 */ }
  }
  return null;
}

(async function main() {
  const builtin = NS.Poetry.builtinCount;

  const rows = [];
  for (const id of CHECK) {
    const src = NS.SOURCE_BY_ID[id];
    if (!src) { say(`?? 找不到源 ${id}`); continue; }
    const text = await fetchSrc(src);
    if (!text) { say(`XX ${src.name} 下载失败`); continue; }

    /* 每种源单独测：先退回内置诗篇，再只加这一种，
     * 然后读 NS.Poetry 真正的 bigrams —— 用的是线上那套过滤规则
     * （虚词、否定词、标点切句），不是我在这里重写一遍。 */
    NS.RAW_POEMS.length = builtin;
    NS.Poetry.rebuild();
    const before = new Set(Object.keys(NS.Poetry.bigrams));

    const pm = NS.Lexicon.parsePoems(text, src);
    NS.Poetry.addPoems(pm.poems);
    NS.Poetry.rebuild();

    const keys = Object.keys(NS.Poetry.bigrams).filter(k => !before.has(k));
    const inLib = keys.filter(k => NS.CHAR_DB[k[0]] && NS.CHAR_DB[k[1]]);
    const blocked = keys.filter(k => NS.nameBlockHit && NS.nameBlockHit(k));
    const trad = keys.filter(k => NS.FAN_JIAN && (NS.FAN_JIAN[k[0]] || NS.FAN_JIAN[k[1]]));
    const hiFreq = keys.filter(k => NS.Poetry.pairFreq[k] >= 8)
      .sort((x, y) => NS.Poetry.pairFreq[y] - NS.Poetry.pairFreq[x]);

    rows.push({
      id, name: src.name, poems: pm.poems.length, pairs: keys.length,
      inLibPct: keys.length ? (100 * inLib.length / keys.length) : 0,
      blockedPct: keys.length ? (100 * blocked.length / keys.length) : 0,
      tradPct: keys.length ? (100 * trad.length / keys.length) : 0,
      hiFreq: hiFreq.slice(0, 12).map(k => k + '(' + NS.Poetry.pairFreq[k] + ')'),
      tradSample: trad.slice(0, 8),
      sample: keys.slice(0, 24)
    });
  }

  /* 收尾：把内存里的诗篇恢复成内置状态 */
  NS.RAW_POEMS.length = builtin;
  NS.Poetry.rebuild();

  say('新增/对照文本源的抽取质量（走真实管线：NS.Poetry.bigrams）');
  say('='.repeat(96));
  say('');
  say('  源              诗篇   新增相邻二字  在字库内%  被成词表命中%  仍含繁体%');
  say('  ' + '-'.repeat(88));
  rows.forEach(r => {
    const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - String(s).length));
    say('  ' + pad(r.name, 16) + pad(r.poems, 7) + pad(r.pairs, 14) +
      pad(r.inLibPct.toFixed(1) + '%', 12) + pad(r.blockedPct.toFixed(1) + '%', 16) +
      r.tradPct.toFixed(1) + '%');
  });

  say('');
  say('说明：');
  say('  「在字库内%」= 这一对的两个字都在内置字库里的比例 —— 只有这些能直接用于取名。');
  say('  「被成词表命中%」= 命中「整名是个日常词」词表的比例，粗略的噪声指标。');
  say('  「仍含繁体%」应当接近 0；若很高说明繁简转换没生效。');

  say('');
  say('='.repeat(96));
  rows.forEach(r => {
    say('');
    say(`### ${r.name}（${r.id}）`);
    say(`  高频对（出现 ≥8 次，最容易被当成出处滥用）：`);
    say('    ' + (r.hiFreq.length ? r.hiFreq.join(' ') : '（没有 ≥8 次的）'));
    if (r.tradSample.length) say(`  未转简体的样本：${r.tradSample.join(' ')}`);
    say(`  抽样 24 条：`);
    say('    ' + r.sample.join(' '));
  });

  fs.writeFileSync(path.join(__dirname, '_src-quality-out.txt'),
    LOG.join('\n') + '\n', 'utf8');
  process.stdout.write('written\n');
})();
