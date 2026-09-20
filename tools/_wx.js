#!/usr/bin/env node
/* 统计现有字库里「部首 → 五行」的house convention，新增字照此办理，避免口径跑偏。
 * 输出写 tools/_wx-out.txt（终端里中文会被 PowerShell 管道转码） */
'use strict';
const path = require('path');
const fs = require('fs');
const BASE = path.join(__dirname, '..', 'web', 'js');
require(path.join(BASE, 'data/chars-extra.js'));
require(path.join(BASE, 'data/chars.js'));

const NS = globalThis.NS;
const cache = path.join(__dirname, '_gen-cache', 'xinhua-word.json');
const dict = JSON.parse(fs.readFileSync(cache, 'utf8'));
const byChar = new Map();
dict.forEach(e => {
  const w = (e.word || '').trim();
  if (w.length === 1 && !byChar.has(w)) byChar.set(w, e);
});

const stat = Object.create(null);
Object.keys(NS.CHAR_DB).forEach(c => {
  const e = byChar.get(c);
  if (!e) return;
  const r = (e.radicals || '').trim() || '(无)';
  if (!stat[r]) stat[r] = Object.create(null);
  const w = NS.CHAR_DB[c].wuxing;
  stat[r][w] = (stat[r][w] || 0) + 1;
});

const rows = Object.keys(stat).map(r => {
  const m = stat[r];
  const total = Object.keys(m).reduce((s, k) => s + m[k], 0);
  const sorted = Object.keys(m).sort((a, b) => m[b] - m[a]);
  return { r, total, top: sorted[0], n: m[sorted[0]], dist: sorted.map(k => k + m[k]).join(' ') };
});
rows.sort((a, b) => b.total - a.total);

const pad = (s, n) => {
  let w = 0;
  for (const ch of String(s)) w += ch.charCodeAt(0) > 0x2e80 ? 2 : 1;
  return String(s) + ' '.repeat(Math.max(0, n - w));
};
const L = ['部首   总数  主流五行  一致率   分布'];
rows.forEach(x => {
  L.push(pad(x.r, 7) + pad(x.total, 6) + pad(x.top, 10) +
    pad((x.n / x.total * 100).toFixed(0) + '%', 9) + x.dist);
});
fs.writeFileSync(path.join(__dirname, '_wx-out.txt'), L.join('\n'), 'utf8');
console.log('共 ' + rows.length + ' 个部首，详见 tools/_wx-out.txt');
