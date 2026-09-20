/* =========================================================================
 * audit-library.js —— 字库覆盖率审计
 *
 * 加字时最容易漏的三件事（都踩过）：
 *   1. popularity.js 里没有热度 → 默认 35 → 被「现代感」的倒 U 曲线判为生僻
 *   2. radicals.js 里没有归组 → 「偏旁重复」和「部首偏好」都查不到
 *   3. namewords.js 用到了这个字 → 词表里出现字库外的字
 *
 * 这个脚本一次把三项都报出来，加完字跑一遍即可。
 * ========================================================================= */
'use strict';
const path = require('path');
const BASE = path.join(__dirname, '..', 'web', 'js');

require(path.join(BASE, 'data/chars-extra.js'));
require(path.join(BASE, 'data/chars.js'));
require(path.join(BASE, 'data/popularity.js'));
require(path.join(BASE, 'data/radicals.js'));
require(path.join(BASE, 'data/namewords.js'));

const NS = globalThis.NS;
const db = NS.CHAR_DB || {};
/* CHAR_LIST 是对象数组，字要按拼音排序后从 CHAR_DB 的键取，输出才稳定可读 */
const LIST = Object.keys(db).sort((a, b) =>
  (db[a].pinyin || '').localeCompare(db[b].pinyin || '') || a.localeCompare(b));
const HEAT = NS.HEAT || {};

/* radicals.js 的组是数组：[{ name, label, chars: '字符串' }, ...] */
const GROUPS = NS.RADICAL_GROUPS || [];

const noHeat = LIST.filter(c => HEAT[c] === undefined);
const radChars = Object.create(null);
const seen = Object.create(null);
const multiGroup = [];
GROUPS.forEach(g => {
  Array.from(g.chars || '').forEach(c => {
    if (seen[c]) multiGroup.push(c + '(' + seen[c] + '+' + g.name + ')');
    seen[c] = g.name;
    radChars[c] = g.name;
  });
});
const noGroup = LIST.filter(c => radChars[c] === undefined);
/* 归组里出现了字库没有的字 */
const groupGhosts = Object.keys(radChars).filter(c => !db[c]);

const missingInWords = Object.create(null);
(NS.NAME_WORDS || []).forEach(w => {
  for (const ch of w) if (!db[ch]) missingInWords[ch] = 1;
});

const pct = (n) => ((n / LIST.length) * 100).toFixed(0) + '%';
/* 不截断：直接写 UTF-8 文件。终端里中文会被 PowerShell 管道转码成乱码，
 * 所以看结果一律读文件，别读终端输出。 */
const show = (arr) => arr.join(' ') || '无 ✓';

const LINES = [
  '字库规模          : ' + LIST.length,
  '缺热度 ' + noHeat.length + ' 个      : ' + show(noHeat),
  '未归部首组 ' + noGroup.length + ' 个  : ' + show(noGroup),
  '部首覆盖          : ' + (LIST.length - noGroup.length) + '/' + LIST.length +
  ' (' + pct(LIST.length - noGroup.length) + ')',
  '一个多组的字      : ' + (multiGroup.length ? show(multiGroup) : '无 ✓'),
  '组里多余的字      : ' + (groupGhosts.length ? show(groupGhosts) : '无 ✓'),
  '词表缺字          : ' +
  (Object.keys(missingInWords).length ? show(Object.keys(missingInWords)) : '无 ✓'),
  '词条数            : ' + (NS.NAME_WORDS || []).length
];

require('fs').writeFileSync(
  path.join(__dirname, 'audit-library-out.txt'), LINES.join('\n'), 'utf8');
console.log(LINES.slice(0, 5).join('\n'));
console.log('（完整报告见 tests/audit-library-out.txt）');
