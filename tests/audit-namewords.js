/* 审计：名字词表里的字是否都在字库里 */
'use strict';
const path = require('path');
const BASE = path.join(__dirname, '..', 'web', 'js');
require(path.join(BASE, 'data/chars-extra.js'));
require(path.join(BASE, 'data/chars.js'));
require(path.join(BASE, 'data/namewords.js'));
const NS = globalThis.NS;

const db = NS.CHAR_DB;
const missing = Object.create(null);
let bad = 0;
NS.NAME_WORDS.forEach(w => {
  for (const ch of w) {
    if (!db[ch]) { missing[ch] = 1; bad++; }
  }
});
const list = Object.keys(missing);
console.log('词条数: ' + NS.NAME_WORDS.length);
console.log('字库规模: ' + NS.CHAR_LIB_STATS.total);
console.log('缺字 ' + list.length + ' 个: ' + list.join(' '));
console.log('总缺字出现次数: ' + bad);
