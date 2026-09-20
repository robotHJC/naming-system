'use strict';
const path = require('path');
const BASE = path.join(__dirname, '..', 'web', 'js');
require(path.join(BASE, 'data/chars-extra.js'));
require(path.join(BASE, 'data/chars.js'));
require(path.join(BASE, 'data/popularity.js'));
const NS = globalThis.NS;
const out = Object.keys(NS.HEAT).filter(c => !NS.CHAR_DB[c]);
require('fs').writeFileSync(path.join(__dirname, '_outside-out.txt'),
  '热度表有、字库没有的字（' + out.length + ' 个）：\n' + out.join(' '), 'utf8');
console.log(out.length + ' 个，详见 tools/_outside-out.txt');
