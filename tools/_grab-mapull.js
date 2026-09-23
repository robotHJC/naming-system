/* 拉 mapull/chinese-dictionary 的几个文件，看结构与规模 */
'use strict';
const fs = require('fs');
const path = require('path');

const CACHE = path.join(__dirname, '_gen-cache');
const BASE = 'https://cdn.jsdelivr.net/gh/mapull/chinese-dictionary@master/';
const ALT = 'https://raw.githubusercontent.com/mapull/chinese-dictionary/master/';

const WANT = [
  ['char_common_base', 'character/common/char_common_base.json'],
  ['polyphone', 'character/polyphone.json'],
  ['char_common', 'character/common/char_common.json']
];

async function grab(name, p) {
  const f = path.join(CACHE, 'mapull-' + name + '.json');
  if (fs.existsSync(f)) {
    const t = fs.readFileSync(f, 'utf8');
    return { name, text: t, cached: true };
  }
  for (const base of [BASE, ALT]) {
    try {
      const r = await fetch(base + p, { signal: AbortSignal.timeout(40000) });
      if (!r.ok) continue;
      const t = await r.text();
      fs.writeFileSync(f, t, 'utf8');
      return { name, text: t, cached: false, from: base };
    } catch (e) { /* 换镜像 */ }
  }
  return { name, failed: true };
}

(async function () {
  const L = [];
  for (const [name, p] of WANT) {
    const r = await grab(name, p);
    if (r.failed) { L.push(name + ': 两个镜像都不通'); continue; }
    let j = null;
    try { j = JSON.parse(r.text); } catch (e) {
      L.push(name + ': JSON 解析失败 ' + e.message); continue;
    }
    const kind = Array.isArray(j) ? '数组' : '对象';
    L.push('=== ' + name + ' (' + r.cached ? '缓存' : '下载' + ') ===');
    L.push('  类型 ' + kind + '，大小 ' + (r.text.length / 1024).toFixed(0) + ' KB');
    if (Array.isArray(j)) {
      L.push('  条数 ' + j.length);
      L.push('  第 1 条: ' + JSON.stringify(j[0]).slice(0, 300));
      L.push('  第 2 条: ' + JSON.stringify(j[1] || null).slice(0, 300));
      /* 找多音字样本 */
      const multi = j.filter(x => {
        const p2 = x && (x.pinyin || x.pinyins || x.pinyin2);
        return Array.isArray(p2) ? p2.length > 1
          : (typeof p2 === 'string' && /[,，;；\/]/.test(p2));
      }).slice(0, 3);
      if (multi.length) {
        L.push('  多音样本:');
        multi.forEach(x => L.push('    ' + JSON.stringify(x).slice(0, 220)));
      }
    } else {
      const ks = Object.keys(j);
      L.push('  键数 ' + ks.length);
      L.push('  前 3 个键: ' + ks.slice(0, 3).join(','));
      L.push('  样本: ' + JSON.stringify(j[ks[0]]).slice(0, 300));
    }
    L.push('');
  }
  fs.writeFileSync(path.join(__dirname, '_mapull-out.txt'),
    L.join('\n') + '\n', 'utf8');
  console.log('done');
})();
