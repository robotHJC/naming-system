#!/usr/bin/env node
/* =========================================================================
 * _verify-strokes.js —— 用已有字库反向验证「康熙笔画 = 简体 + 部首修正」
 *
 * 为什么要验：新增字的康熙笔画打算用 infer.js 的 RADICAL_DELTA 规则批量算，
 * 但那条规则是给「联网临时加字」用的近似值，从没在整库上验证过。
 * 库里 415 个字的康熙笔画是人工核定的 —— 拿它们当标准答案，
 * 就能看出哪几类部首修正其实不成立。
 *
 * 不成立就不敢用。填错笔画会静默污染三才五格与姓名卦，且不会报错。
 *
 * 运行：node tools/_verify-strokes.js   （需先跑过 _gen-chars.js 建立缓存）
 * 输出：tools/_verify-strokes-out.txt
 * ========================================================================= */
'use strict';

const path = require('path');
const fs = require('fs');

const BASE = path.join(__dirname, '..', 'web', 'js');
require(path.join(BASE, 'data/chars-extra.js'));
require(path.join(BASE, 'data/chars.js'));
require(path.join(BASE, 'core/infer.js'));

const NS = globalThis.NS;
const cache = path.join(__dirname, '_gen-cache', 'xinhua-word.json');
if (!fs.existsSync(cache)) {
  console.error('缺少缓存，请先运行 node tools/_gen-chars.js');
  process.exit(1);
}

const dict = JSON.parse(fs.readFileSync(cache, 'utf8'));
const byChar = new Map();
dict.forEach((e) => {
  const w = (e.word || '').trim();
  if (w.length === 1 && !byChar.has(w)) byChar.set(w, e);
});

const db = NS.CHAR_DB;
const chars = Object.keys(db);

const stat = Object.create(null);   /* 部首 → {n, match, miss:[...]} */
const mism = [];
let noDict = 0, noStrokes = 0;

chars.forEach((c) => {
  const info = db[c];
  const e = byChar.get(c);
  if (!e) { noDict++; return; }
  const simp = parseInt(e.strokes, 10);
  if (!isFinite(simp) || simp <= 0) { noStrokes++; return; }

  const radical = (e.radicals || '').trim();
  const est = NS.Infer.estimateKangxi(simp, c, radical);
  const stored = parseInt(info.strokes, 10);

  const k = radical || '(无部首)';
  if (!stat[k]) stat[k] = { n: 0, match: 0, miss: [] };
  stat[k].n++;

  if (est.strokes === stored) {
    stat[k].match++;
  } else {
    stat[k].miss.push(c + ' 存' + stored + ' 算' + est.strokes +
      '(简' + simp + (est.delta ? '+' + est.delta : '') + ')');
    mism.push({
      char: c, stored, est: est.strokes, simp, delta: est.delta, radical
    });
  }
});

const pad = (s, n) => {
  let w = 0;
  for (const ch of String(s)) w += ch.charCodeAt(0) > 0x2e80 ? 2 : 1;
  return String(s) + ' '.repeat(Math.max(0, n - w));
};

const L = [];
L.push('字库总字数            : ' + chars.length);
L.push('字典里查不到的        : ' + noDict);
L.push('字典无简体笔画的      : ' + noStrokes);
L.push('参与比对的            : ' + (chars.length - noDict - noStrokes));
L.push('「简体+部首修正」对上的: ' + (chars.length - noDict - noStrokes - mism.length));
L.push('对不上的              : ' + mism.length);
L.push('');
L.push('========== 按部首统计（命中率低的部首规则不可信）==========');
L.push(pad('部首', 8) + pad('总数', 6) + pad('命中', 6) + pad('命中率', 8) + '对不上的字');
const keys = Object.keys(stat).sort((a, b) => {
  const ra = stat[a].match / stat[a].n, rb = stat[b].match / stat[b].n;
  return ra - rb || stat[b].n - stat[a].n;
});
keys.forEach((k) => {
  const s = stat[k];
  const rate = (s.match / s.n * 100).toFixed(0) + '%';
  L.push(pad(k, 8) + pad(s.n, 6) + pad(s.match, 6) + pad(rate, 8) +
    s.miss.slice(0, 6).join('  '));
});
L.push('');
L.push('========== 全部对不上的字（存=字库存值，算=规则推算值）==========');
mism.forEach((m) => {
  L.push(pad(m.char, 4) + ' 部首=' + pad(m.radical, 4) +
    ' 存=' + pad(m.stored, 4) + ' 算=' + pad(m.est, 4) +
    ' 简体=' + pad(m.simp, 4) + ' 修正=' + (m.delta ? '+' + m.delta : '0'));
});

fs.writeFileSync(path.join(__dirname, '_verify-strokes-out.txt'), L.join('\n'), 'utf8');
console.log('参与比对 ' + (chars.length - noDict - noStrokes) +
  '，对不上 ' + mism.length + ' 个');
console.log('详见 tools/_verify-strokes-out.txt');
