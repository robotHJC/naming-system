/* 确认 char_base 格式 + 常用字表能否挡住「苯/苊/芤」 */
'use strict';
const fs = require('fs');
const path = require('path');

const CACHE = path.join(__dirname, '_gen-cache');
const RAW = 'https://raw.githubusercontent.com/mapull/chinese-dictionary/master/';

async function get(p) {
  const f = path.join(CACHE, 'mapull-' + p.replace(/\//g, '_'));
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  const r = await fetch(RAW + p, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) return null;
  const t = await r.text();
  fs.writeFileSync(f, t, 'utf8');
  return t;
}

const GARBAGE = '苯苊芤茬茇芭苞荟荞';
const GOOD = '蔚蓝若兰芷荷茉萌菲菡萏茹莘芸芮芊';

(async function () {
  const L = [];

  /* char_base.json 开头字符，判断是不是 JSONL */
  const cb = await get('character/char_base.json');
  if (cb) {
    L.push('=== char_base.json 开头 260 字符 ===');
    L.push(JSON.stringify(cb.slice(0, 260)));
    L.push('  行数 ' + cb.split('\n').length);
    L.push('');
  }

  /* 常用字表 */
  const cc = await get('character/common/char_common.json');
  const common = new Set();
  if (cc) {
    JSON.parse(cc).forEach(x => common.add(x.char));
    L.push('=== char_common.json 常用字 ' + common.size + ' ===');
    L.push('');
  }

  /* 常用字 base（带拼音笔画？） */
  const ccb = await get('character/common/char_common_base.json');
  if (ccb) {
    try {
      const j = JSON.parse(ccb);
      L.push('=== char_common_base.json ' + j.length + ' 条 ===');
      L.push('  首条 ' + JSON.stringify(j[0]));
      L.push('  找「行」: ' + JSON.stringify(j.find(x => x.char === '行')));
      L.push('');
    } catch (e) { L.push('char_common_base 解析失败: ' + e.message); L.push(''); }
  }

  /* 多音字表 */
  const pp = await get('character/polyphone.json');
  const poly = new Map();
  if (pp) {
    JSON.parse(pp).forEach(x => poly.set(x.char, x.pinyin));
    L.push('=== polyphone.json 多音字 ' + poly.size + ' ===');
    ['行', '重', '乐', '长', '藏', '朝', '薄', '差', '草', '沐', '若']
      .forEach(c => L.push('  ' + c + ' → ' +
        JSON.stringify(poly.get(c) || '(不是多音字)')));
    L.push('');
  }

  /* 关键：常用字表能不能挡住垃圾字 */
  L.push('=== 常用字表对「垃圾字 vs 好字」的判定 ===');
  L.push('  垃圾字（上次实测会输出 李苛苯/李苞苊 那批）:');
  GARBAGE.split('').forEach(c => L.push('    ' + c + '  在常用字表=' +
    (common.has(c) ? '是' : '否') +
    (poly.has(c) ? '  多音字' + JSON.stringify(poly.get(c)) : '')));
  L.push('  好字（艹部适合起名的）:');
  GOOD.split('').forEach(c => L.push('    ' + c + '  在常用字表=' +
    (common.has(c) ? '是' : '否') +
    (poly.has(c) ? '  多音字' + JSON.stringify(poly.get(c)) : '')));

  fs.writeFileSync(path.join(__dirname, '_mapull3.txt'), L.join('\n') + '\n', 'utf8');
  console.log('done');
})();
