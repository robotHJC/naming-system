/* 直接试候选路径，看哪个能拿到「带多读音」的字典数据 */
'use strict';
const fs = require('fs');

const BASE = 'https://cdn.jsdelivr.net/gh/';
const PATHS = [
  ['mapull/chinese-dictionary', 'character/polyphone.json'],
  ['mapull/chinese-dictionary', 'character/char_base.json'],
  ['mapull/chinese-dictionary', 'character/char_detail.json'],
  ['mapull/chinese-dictionary', 'character/related.json'],
  ['mapull/chinese-dictionary', 'word/word.json'],
  ['mapull/chinese-dictionary', 'idiom/idiom.json'],
  ['mapull/chinese-dictionary', 'dictionary/xinhua.json'],
  ['mapull/chinese-dictionary', 'xinhua.json']
];

async function head(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
    if (!r.ok) return { status: r.status };
    const t = await r.text();
    return { status: 200, text: t };
  } catch (e) { return { err: e.message }; }
}

(async function () {
  const L = [];
  for (const [repo, p] of PATHS) {
    const url = BASE + repo + '@master/' + p;
    const r = await head(url);
    if (r.status !== 200) {
      L.push(p + '  → ' + (r.status ? 'HTTP ' + r.status : r.err));
      continue;
    }
    L.push('=== ' + p + '  ' + (r.text.length / 1024).toFixed(0) + ' KB ===');
    try {
      const j = JSON.parse(r.text);
      L.push('  类型 ' + (Array.isArray(j) ? '数组 ' + j.length : '对象 ' +
        Object.keys(j).length));
      if (Array.isArray(j) && j.length) {
        L.push('  样本0: ' + JSON.stringify(j[0]).slice(0, 400));
        L.push('  样本1: ' + JSON.stringify(j[1] || null).slice(0, 400));
      } else if (!Array.isArray(j)) {
        const k = Object.keys(j)[0];
        L.push('  首键 ' + k + ' → ' + JSON.stringify(j[k]).slice(0, 400));
      }
    } catch (e) {
      L.push('  JSON 解析失败：' + e.message);
      L.push('  开头: ' + r.text.slice(0, 200));
    }
    L.push('');
  }
  fs.writeFileSync(__dirname + '/_paths.txt', L.join('\n') + '\n', 'utf8');
  console.log('done');
})();
