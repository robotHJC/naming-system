/* 找一个带「多读音」的字典源，并看它的字段结构 */
'use strict';
const fs = require('fs');

const REPOS = [
  'mapull/chinese-dictionary',
  'pwxcoo/chinese-xinhua'
];

async function tryFetch(url, ms) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms || 20000) });
    if (!r.ok) return { status: r.status };
    return { status: 200, text: await r.text() };
  } catch (e) { return { err: e.message }; }
}

(async function () {
  const L = [];

  for (const repo of REPOS) {
    const u = 'https://data.jsdelivr.com/v1/packages/gh/' + repo;
    const r = await tryFetch(u, 25000);
    L.push('=== ' + repo + ' ===');
    if (r.status !== 200) {
      L.push('  目录 API: ' + (r.status ? 'HTTP ' + r.status : r.err));
      L.push('');
      continue;
    }
    try {
      const j = JSON.parse(r.text);
      const files = [];
      (function walk(nodes, prefix) {
        (nodes || []).forEach(n => {
          if (n.type === 'directory') walk(n.files, prefix + n.name + '/');
          else files.push(prefix + n.name + '  ' +
            (n.size ? (n.size / 1024).toFixed(0) + 'KB' : ''));
        });
      })(j.files, '');
      L.push('  ' + files.length + ' 个文件');
      files.filter(f => /\.(json|txt)$/i.test(f)).slice(0, 40)
        .forEach(f => L.push('    ' + f));
    } catch (e) {
      L.push('  解析失败 ' + e.message);
    }
    L.push('');
  }

  fs.writeFileSync(__dirname + '/_src-list.txt', L.join('\n') + '\n', 'utf8');
  console.log('done');
})();
