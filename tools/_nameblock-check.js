#!/usr/bin/env node
/* 验证「整名成词」降权是否真的把 X博士 从显眼位置赶走了。
 * 输出写 tools/_nameblock-out.txt（终端里中文会被 PowerShell 管道转码） */
'use strict';
const path = require('path');
const fs = require('fs');
const BASE = path.join(__dirname, '..', 'web', 'js');
[
  'data/chars-extra.js', 'data/chars.js', 'data/surnames.js', 'data/poetry.js',
  'data/homophone.js', 'data/popularity.js', 'data/radicals.js',
  'data/radical-hints.js', 'data/namewords.js', 'data/era-chars.js',
  'data/nayin.js', 'data/shuli81.js', 'data/nameblock.js',
  'core/wuxing.js', 'core/calendar.js', 'core/tiaohou.js', 'core/bazi.js',
  'core/wuge.js', 'core/pinyin.js', 'core/poetry-lib.js', 'core/score.js',
  'core/generator.js', 'core/infer.js', 'core/lexicon.js', 'core/radical.js',
  'core/variant.js', 'core/hexagram.js', 'core/zodiac.js', 'core/report.js'
].forEach(f => require(path.join(BASE, f)));
const NS = globalThis.NS;

const L = [];
let bad = 0;

L.push('===== 词表规模 =====');
L.push('  收录 ' + NS.NAMEBLOCK_WORDS.length + ' 个词，去重后 ' +
  Object.keys(NS.NAMEBLOCK_SET).length + ' 个');
if (Object.keys(NS.NAMEBLOCK_SET).length !== NS.NAMEBLOCK_WORDS.length) {
  L.push('  （有重复项，不影响正确性但表不干净）');
}
L.push('  扣分力度：' + NS.NAMEBLOCK_PENALTY);

L.push('');
L.push('===== 关键验证：博士 / 斯文 的分数与名次 =====');
const WORDS = NS.NAMEBLOCK_WORDS;
const TARGETS = ['博士', '斯文'];

[['郝', ''], ['郝', '男'], ['李', '男'], ['王', '男'], ['陈', '男'], ['张', '男'],
['刘', '男'], ['杨', '女'], ['赵', '男'], ['孙', '女']].forEach(([sn, g]) => {
  const opts = { surname: sn, length: 2, birth: '2026-05-20T10:00', top: 20 };
  if (g) opts.gender = g;
  const p = NS.Generator.plan(opts);
  const r = NS.Generator.runSync(p, opts);
  const top20 = r.slice(0, 20);
  const hits = top20.filter(x => WORDS.indexOf(x.given) >= 0);
  /* 目标词现在排第几（在完整排序里找） */
  const where = TARGETS.map(t => {
    const idx = r.findIndex(x => x.given === t);
    return t + (idx < 0 ? '：不在前 200' : '：第 ' + (idx + 1) + ' 名（' + r[idx].score + ' 分）');
  });
  L.push('  ' + sn + (g || '不限') + '　前20名里的日常词：' +
    (hits.length ? hits.map(x => x.given + '(第' + (top20.indexOf(x) + 1) + '名)').join(' ') : '无 ✓'));
  L.push('        ' + where.join('　'));
  if (hits.length) bad++;
});

L.push('');
L.push('===== 逐词自检：这些词作为名字必须被扣分 =====');
/* 注意：有些词的字不在字库里（机/题/虎/睛/授…），评估会返回 null ——
 * 那是「认不得这些字」，不是「检查没生效」，所以分开统计。 */
let skipped = 0;
['博士', '手机', '问题', '老虎', '眼睛', '傻子', '教授', '校长', '苹果', '医生']
  .forEach(w => {
    const rep = NS.Report.evaluate('郝', w, {});
    if (!rep) { skipped++; L.push('  – 郝' + w + '　字库外字，无法评估（跳过）'); return; }
    const hit = rep.score && rep.score.detail && rep.score.detail.modern
      ? rep.score.detail.modern.block : null;
    const hitReason = rep.reasons
      ? rep.reasons.some(x => String(x).indexOf('日常词') >= 0) : false;
    const ok = hit === w && hitReason;
    if (!ok) bad++;
    L.push((ok ? '  ✓ ' : '  ✗ ') + '郝' + w + '　命中=' + hit +
      '　有说明=' + hitReason + '　' + rep.total + '分');
  });
L.push('  （跳过 ' + skipped + ' 个含字库外字的词）');

/* 直接测判定函数本身，绕开字库限制 —— 这才是词表的真正覆盖度 */
L.push('');
L.push('===== 词表判定函数本身 =====');
let fnBad = 0;
NS.NAMEBLOCK_WORDS.slice(0, 400).forEach(w => {
  if (NS.nameBlockHit(w) !== w) { fnBad++; L.push('  ✗ ' + w + ' 未命中'); }
});
L.push('  ' + NS.NAMEBLOCK_WORDS.length + ' 个词全部能命中：' +
  (fnBad === 0 ? '✓' : '不符 ' + fnBad + ' 个'));
if (fnBad) bad += fnBad;

L.push('');
L.push('===== 反向自检：这些是雅词，绝不能被扣分 =====');
/* 这一组是这道检查的边界。放宽了会误伤传统好名，收窄了挡不住 博士。 */
['清和', '若水', '嘉树', '云舒', '知微', '星和', '安和', '林溪', '沐涵', '清可']
  .forEach(w => {
    const rep = NS.Report.evaluate('郝', w, {});
    const hit = rep && rep.score && rep.score.detail && rep.score.detail.modern
      ? rep.score.detail.modern.block : null;
    const ok = !hit;
    if (!ok) bad++;
    L.push((ok ? '  ✓ ' : '  ✗ ') + '郝' + w + '　未被误伤' +
      (ok ? '' : '（却被判为「' + hit + '」）'));
  });

L.push('');
L.push('===== 单名不应命中（单字成不了词）=====');
const single = NS.Report.evaluate('郝', '博', {});
const sHit = single && single.score && single.score.detail.modern
  ? single.score.detail.modern.block : null;
if (sHit) bad++;
L.push((sHit ? '  ✗ ' : '  ✓ ') + '郝博（单名）　命中=' + (sHit || '无'));

fs.writeFileSync(path.join(__dirname, '_nameblock-out.txt'), L.join('\n'), 'utf8');
console.log('问题 ' + bad + ' 处，详见 tools/_nameblock-out.txt');
