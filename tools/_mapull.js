/* 看 mapull/chinese-dictionary 的字段结构：多音字 / 常用字 / 基础信息 */
'use strict';
const fs = require('fs');
const path = require('path');

const CACHE = path.join(__dirname, '_gen-cache');
const RAW = 'https://raw.githubusercontent.com/mapull/chinese-dictionary/master/';

async function get(p) {
  const f = path.join(CACHE, 'mapull-' + p.replace(/\//g, '_'));
  if (fs.existsSync(f)) return { text: fs.readFileSync(f, 'utf8'), cached: 1 };
  const r = await fetch(RAW + p, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) return { status: r.status };
  const t = await r.text();
  fs.writeFileSync(f, t, 'utf8');
  return { text: t, cached: 0 };
}

async function listDir(dir) {
  const u = 'https://api.github.com/repos/mapull/chinese-dictionary/contents/' + dir;
  const r = await fetch(u, {
    headers: { 'User-Agent': 'node', Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(25000)
  });
  if (!r.ok) return [];
  const j = await r.json();
  return Array.isArray(j) ? j.map(x => x.name + '  ' +
    ((x.size || 0) / 1024).toFixed(0) + 'KB') : [];
}

(async function () {
  const L = [];
  L.push('=== character/common 目录 ===');
  (await listDir('character/common')).forEach(x => L.push('  ' + x));
  L.push('');

  for (const p of ['character/polyphone.json', 'character/common/common.json',
    'character/common/char_common.json', 'character/char_base.json']) {
    const r = await get(p);
    if (r.status) { L.push(p + ' → HTTP ' + r.status); continue; }
    L.push('=== ' + p + (r.cached ? '（缓存）' : '（下载）') + ' ' +
      (r.text.length / 1024).toFixed(0) + 'KB ===');
    try {
      const j = JSON.parse(r.text);
      if (Array.isArray(j)) {
        L.push('  数组 ' + j.length + ' 条');
        L.push('  首条 ' + JSON.stringify(j[0]).slice(0, 300));
        /* 找多音字样本 */
        const multi = j.filter(x => {
          const p2 = x.pinyin || x.pinyins || x.pronunciation;
          return Array.isArray(p2) && p2.length > 1;
        });
        L.push('  带多个读音的条目数 ' + multi.length);
        multi.slice(0, 3).forEach(x => L.push('    ' +
          JSON.stringify(x).slice(0, 300)));
      } else {
        const ks = Object.keys(j);
        L.push('  对象 ' + ks.length + ' 键');
        ks.slice(0, 5).forEach(k => L.push('    ' + k + ' → ' +
          JSON.stringify(j[k]).slice(0, 200)));
      }
    } catch (e) { L.push('  解析失败 ' + e.message); }
    L.push('');
  }
  fs.writeFileSync(path.join(__dirname, '_mapull2.txt'), L.join('\n') + '\n', 'utf8');
  console.log('done');
})();
