/* =========================================================================
 * _probe-xhdict.js —— 验证新华字典四份数据的解析器
 *   node tools/_probe-xhdict.js
 * 结果写 UTF-8 文件，避免 PowerShell 重定向乱码。
 * ========================================================================= */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASE = path.join(ROOT, 'web', 'js');
const CACHE = path.join(__dirname, '_gen-cache');
const OUT = path.join(__dirname, '_probe-xhdict-out.txt');

[
  'data/chars-extra.js', 'data/chars.js', 'data/surnames.js', 'data/poetry.js',
  'data/homophone.js', 'data/popularity.js', 'data/radicals.js',
  'data/radical-hints.js', 'data/namewords.js', 'data/era-chars.js',
  'data/nayin.js', 'data/shuli81.js', 'data/nameblock.js',
  'data/namefilter.js',
  'data/fanti.js', 'data/sources.js',
  'core/net.js', 'core/store.js', 'core/dialect.js',
  'core/wuxing.js', 'core/calendar.js', 'core/lunar.js',
  'core/tiaohou.js', 'core/branches.js', 'core/bazi.js', 'core/wuge.js',
  'core/pinyin.js', 'core/poetry-lib.js', 'core/score.js', 'core/generator.js',
  'core/infer.js', 'core/lexicon.js', 'core/radical.js', 'core/variant.js',
  'core/hexagram.js', 'core/zodiac.js', 'core/report.js'
].forEach(function (f) {
  try { require(path.join(BASE, f)); } catch (e) {
    console.log('LOAD FAIL ' + f + ': ' + e.message);
  }
});

const NS = globalThis.NS;
const Lex = NS.Lexicon;

const L = [];
const say = function (s) { L.push(s); };
function ok(name, cond, extra) {
  say((cond ? '  OK   ' : '  FAIL ') + name + (cond ? '' : '  -> ' + (extra || '')));
  return cond;
}

say('# 新华字典解析器验证');
say('');

/* ---- 读取缓存 ---- */
function readCache(f) {
  const p = path.join(CACHE, f);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

const baseTxt = readCache('mapull-char_base.json');
const polyTxt = readCache('mapull-polyphone.json');
const commonTxt = readCache('mapull-char_common.json');
const detailTxt = readCache('mapull-char_detail.json');

say('缓存：base=' + (baseTxt ? baseTxt.length : 'null') +
  ' poly=' + (polyTxt ? polyTxt.length : 'null') +
  ' common=' + (commonTxt ? commonTxt.length : 'null') +
  ' detail=' + (detailTxt ? detailTxt.length : 'null'));
say('');

/* ---- 字表 ---- */
if (baseTxt) {
  const r = Lex.parseXhBase(baseTxt);
  say('== xhbase ==');
  say('  count=' + r.count + ' mapKeys=' + Object.keys(r.map).length +
    ' allKeys=' + Object.keys(r.all).length);
  ok('字表 > 20000', r.count > 20000, r.count);
  const yi = r.map['一'];
  say('  一 = ' + JSON.stringify(yi));
  ok('一 的笔画=1', yi && yi[0] === 1, yi && yi[0]);
  ok('一 的部首', yi && yi[1] === '一', yi && yi[1]);
  ok('一 的读音', yi && yi[2] === 'yī', yi && yi[2]);
  ok('一 的释义留空待 detail 填', yi && yi[3] === '', yi && yi[3]);
  /* 多音字 */
  const xingAll = r.all['行'];
  say('  行 = ' + JSON.stringify(xingAll));
  ok('行 多读音 >= 3', xingAll && xingAll.length >= 3, xingAll && xingAll.length);
  const ruo = r.all['若'];
  say('  若 = ' + JSON.stringify(ruo));
  ok('若 多读音 >= 2', ruo && ruo.length >= 2, ruo && ruo.length);
  /* g 形符号污染检查（旧源的问题） */
  let bad = 0;
  Object.keys(r.all).forEach(function (ch) {
    r.all[ch].forEach(function (p) { if (p.indexOf('\u0261') >= 0) bad++; });
  });
  ok('无 U+0261(g形) 污染', bad === 0, bad);
  /* 工 在原始数据里是 ɡōnɡ（两个字母都是 U+0261） */
  const gong = r.all['工'];
  say('  工 = ' + JSON.stringify(gong));
  ok('工 的 g 已归一化为 ASCII', gong && gong[0] === 'gōng',
    gong && JSON.stringify(gong));
  ok('工 的拼音全是 ASCII + 带调元音', gong && gong.every(function (p) {
    return !/[\u0261\u0251]/.test(p);
  }));
  /* 拼音里混汉字的两条应当被丢弃 */
  let cjkInPy = 0;
  Object.keys(r.all).forEach(function (ch) {
    r.all[ch].forEach(function (p) {
      if (/[\u3400-\u9fff\uf900-\ufaff]/.test(p)) cjkInPy++;
    });
  });
  ok('拼音字段里没有汉字', cjkInPy === 0, cjkInPy);
}

/* ---- 多音字表 ---- */
if (polyTxt) {
  const r = Lex.parseXhPoly(polyTxt);
  say('');
  say('== xhpoly ==');
  say('  count=' + r.count);
  ok('多音字表 > 2000', r.count > 2000, r.count);
  const p = r.map['厂'];
  say('  厂 = ' + JSON.stringify(p));
  ok('厂 多读音 3', p && p.length === 3, p && p.length);
  let one = 0;
  Object.keys(r.map).forEach(function (ch) { if (r.map[ch].length < 2) one++; });
  ok('多音字表里没有单读音', one === 0, one);
}

/* ---- 常用字表 ---- */
if (commonTxt) {
  const r = Lex.parseXhCommon(commonTxt);
  say('');
  say('== xhcommon ==');
  say('  count=' + r.count);
  ok('常用字表 3500', r.count === 3500, r.count);
  ok('含 一', !!r.map['一']);
  /* 3500 是《通用规范汉字表》**一级**字表；芷/菡/萏 在二级，
   * 所以「不在表里」是这个表的正常表现，不能当作质量判据单用。 */
  ok('芷 不在一级字表（符合预期，说明该表不能单独当质量门）', !r.map['芷']);
  ok('含 苯？(预期 false)', !r.map['苯']);
  ok('含 苞？(预期 true)', !!r.map['苞']);
  say('  一级字表命中情况：' + ['芷', '菡', '萏', '茹', '芸', '芮', '芊', '萱', '沐', '涵', '宁', '安']
    .map(function (c) { return c + (r.map[c] ? 'Y' : 'N'); }).join(' '));
}

/* ---- 释义 ---- */
if (detailTxt) {
  const r = Lex.parseXhDetail(detailTxt);
  say('');
  say('== xhdetail ==');
  say('  count=' + r.count);
  ok('释义 > 15000', r.count > 15000, r.count);
  const yi = r.map['一'];
  say('  一 = ' + JSON.stringify(yi));
  ok('一 有逐读音释义', yi && yi.length >= 1, yi && yi.length);
  ok('一 的释义非空', yi && yi[0].exp.length >= 1, yi && JSON.stringify(yi));
  ok('一 的释义没被去括号洗成空', yi && yi[0].exp[0].length >= 4,
    yi && yi[0].exp[0]);
  const xing = r.map['行'];
  say('  行 读音数 = ' + (xing ? xing.length : 0) +
    ' -> ' + (xing ? xing.map(function (x) { return x.pinyin; }).join('/') : ''));
  ok('行 释义分列 >= 2 个读音', xing && xing.length >= 2, xing && xing.length);
  let tooLong = 0;
  Object.keys(r.map).forEach(function (ch) {
    r.map[ch].forEach(function (pr) {
      if (pr.exp.length > 3) tooLong++;
      pr.exp.forEach(function (e) { if (e.length > 95) tooLong++; });
    });
  });
  ok('释义已按 3 条 / 90 字截断', tooLong === 0, tooLong);
}

/* ---- 入库（模拟同步顺序：大文件先到） ---- */
say('');
say('== 入库 ==');
Lex.ensureLoaded && Lex.ensureLoaded();
Lex.pinyinAll = Object.create(null);
Lex.polyMap = Object.create(null);
Lex.commonSet = Object.create(null);
Lex.meanings = Object.create(null);
Lex.dict = Object.create(null);

if (detailTxt) {
  const d = Lex.parseXhDetail(detailTxt);
  const n = Lex.applyXhDetail(d);
  say('  applyXhDetail +' + n);
}
if (baseTxt) {
  const b = Lex.parseXhBase(baseTxt);
  const n = Lex.applyXhBase(b);
  say('  applyXhBase +' + n);
  /* 关键：字表不能把 detail 刚写好的释义清掉 */
  const yi = Lex.dict['一'];
  ok('字表入库后 一 的释义仍在', yi && !!yi[3], yi && JSON.stringify(yi));
  say('  一 = ' + JSON.stringify(yi));
  say('  行(字表) = ' + JSON.stringify(b.map['行']));
  say('  行(字表全部读音) = ' + JSON.stringify(b.all['行']));
  say('  行(pinyinAll) = ' + JSON.stringify(Lex.pinyinAll['行']));
  var hx = Lex.dict['行'];
  say('  行(入库后) = ' + JSON.stringify(hx));
  ok('行 的 dict[2] 与 dict[3] 读音对齐', hx && hx[3] &&
    Lex.briefMeaning('行', hx[2]) === hx[3],
    hx && ('pinyin=' + hx[2] + ' brief=' + hx[3]));
}
if (polyTxt) {
  const p = Lex.parseXhPoly(polyTxt);
  say('  applyXhPoly +' + Lex.applyXhPoly(p));
}
if (commonTxt) {
  const c = Lex.parseXhCommon(commonTxt);
  say('  applyXhCommon +' + Lex.applyXhCommon(c));
}

say('');
say('== 查询接口 ==');
say('  readingsOf(行) = ' + JSON.stringify(Lex.readingsOf('行')));
say('  readingsOf(若) = ' + JSON.stringify(Lex.readingsOf('若')));
say('  readingsOf(一) = ' + JSON.stringify(Lex.readingsOf('一')));
ok('isPolyphone(行)', Lex.isPolyphone('行'));
ok('isPolyphone(若)', Lex.isPolyphone('若'));
ok('!isPolyphone(一)', !Lex.isPolyphone('一'));
ok('isCommon(一)', Lex.isCommon('一'));
ok('!isCommon(芷)（一级表不含）', !Lex.isCommon('芷'));
ok('!isCommon(苯)', !Lex.isCommon('苯'));
const m = Lex.meaningsOf('行');
say('  meaningsOf(行) 读音数 = ' + m.length);
ok('meaningsOf(行) >= 2', m.length >= 2, m.length);
say('  meaningsOf(行)[0] = ' + JSON.stringify(m[0]));
ok('meaningsOf(一) 非空', Lex.meaningsOf('一').length >= 1);

/* ---- 偏旁浏览 ---- */
say('');
say('== 按部首找字 ==');
function showRad(nm, limit) {
  const r = NS.Radical.fromDict(nm, { limit: limit || 24 });
  say('  [' + nm + '] name=' + r.name + ' available=' + r.available +
    ' total=' + r.total + ' suitable=' + r.suitableTotal +
    ' notable=' + r.notableTotal + ' poly=' + r.polyTotal);
  r.items.slice(0, 24).forEach(function (x) {
    say('    ' + x.char + '  ' + x.strokes + '画  ' + x.pinyin +
      (x.poly ? '  [多音 ' + x.allPinyin.join('/') + ']' : '') +
      (x.common ? ' [常用]' : '') + (x.literary ? ' [诗词]' : '') +
      '  ' + String(x.meaning).slice(0, 40));
  });
}
showRad('艹');
showRad('草字头', 6);
['氵', '宀', '辶'].forEach(function (nm) { showRad(nm, 8); });

/* 直接验证：前 20 个里有多少是「有依据」的 */
(function () {
  const r = NS.Radical.fromDict('艹', { limit: 20 });
  const good = r.items.filter(function (x) { return x.notable; }).length;
  say('');
  say('  艹 前 20 个里有依据的：' + good + '/20');
  ok('艹 排前列的是有依据的字', good >= 12, good);
  const first = r.items[0];
  say('  第一个 = ' + JSON.stringify({ char: first.char, pinyin: first.pinyin,
    poly: first.poly, common: first.common, meaning: first.meaning,
    meanings: first.meanings.length }));
  ok('条目带 allPinyin/meanings 字段', 'allPinyin' in first && 'meanings' in first);
})();

/* ---- status ---- */
say('');
say('== status ==');
const st = Lex.status();
say('  ' + JSON.stringify({
  dict: st.dictCount, pinyinAllCount: st.pinyinAllCount,
  polyCount: st.polyCount, commonCount: st.commonCount,
  meaningCount: st.meaningCount
}));

/* ---- 端到端取名 ---- */
say('');
say('== 只用新华字典取名（每场景独立进程，避免字库互相污染） ==');

const SCENARIOS = [
  ['来源=新华字典', {
    surname: '李', gender: '中性', mode: 'simple', length: 2,
    charSources: ['xhbase']
  }],
  ['来源=新华字典+部首=艹氵宀辶', {
    surname: '马', gender: '中性', mode: 'simple', length: 2,
    charSources: ['xhbase'], preferRadicals: ['艹', '氵', '宀', '辶']
  }],
  ['只部首=艹氵宀辶（不勾字典）', {
    surname: '马', gender: '中性', mode: 'simple', length: 2,
    preferRadicals: ['艹', '氵', '宀', '辶']
  }],
  ['来源=新华字典（八字模式）', {
    surname: '李', gender: '中性', mode: 'bazi', length: 2,
    birth: { y: 2026, m: 1, d: 15, h: 10, mi: 0 },
    charSources: ['xhbase']
  }],
  ['对照：无约束', { surname: '李', gender: '中性', mode: 'simple', length: 2 }]
];

if (process.env.NS_E2E === 'pollute') {
  /* 导出「有依据但仍不宜入名」的高频字 —— 用于人工编写不宜入名表 */
  Lex.applyXhBase(Lex.parseXhBase(baseTxt));
  Lex.applyXhPoly(Lex.parseXhPoly(polyTxt));
  Lex.applyXhCommon(Lex.parseXhCommon(commonTxt));
  Lex.applyXhDetail(Lex.parseXhDetail(detailTxt));
  Lex.applySimplifiedStrokes();
  const all = NS.Radical.dictCandidates({ order: 'heat' }).items;
  const lib = Object.create(null);
  NS.CHAR_LIST.forEach(function (c) { lib[c.char] = 1; });
  const rows = all.filter(function (x) {
    return x.suitable && x.notable && !lib[x.char];
  });
  const litOnly = all.filter(function (x) {
    return x.suitable && x.literary && !lib[x.char];
  });
  const cmnOnly = all.filter(function (x) {
    return x.suitable && x.common && !x.literary && !lib[x.char];
  });
  /* 按部首分组统计「只有诗词依据」的字 —— 这决定来源模式还能不能用部首 */
  const byRad = Object.create(null);
  litOnly.forEach(function (x) {
    byRad[x.radical] = (byRad[x.radical] || 0) + 1;
  });
  const radTop = Object.keys(byRad).sort(function (a, b) {
    return byRad[b] - byRad[a];
  }).slice(0, 40).map(function (k) { return k + byRad[k]; }).join(' ');

  fs.writeFileSync(path.join(__dirname, '_dump.txt'),
    '有依据且不在内置字库里的候选：' + rows.length + ' 个\n' +
    '  其中「诗词里出现过」：' + litOnly.length + '\n' +
    '  其中「仅一级常用字」：' + cmnOnly.length + '\n\n' +
    '仅诗词依据的字前 400 个（按热度）：\n' +
    litOnly.slice(0, 400).map(function (x) { return x.char; }).join('') + '\n\n' +
    '按部首分布（前列）：\n' + radTop + '\n\n' +
    rows.slice(0, 400).map(function (x) {
      return x.char + ' ' + x.strokes + ' ' + x.pinyin +
        (x.common ? ' 常' : '    ') + (x.literary ? '诗' : '  ') +
        ' h' + x.heat;
    }).join('\n'), 'utf8');
  process.exit(0);
}

if (process.env.NS_E2E !== undefined) {
  /* 子进程模式：只跑一个场景，结果打到 stdout */
  const idx = process.env.NS_E2E;
  const sc = SCENARIOS[+idx];
  const t0 = Date.now();
  const plan = NS.Generator.plan(sc[1]);
  const out = NS.Generator.runSync(plan, { full: true });
  const dri = plan.ctx.dictRadicalInfo || {};
  process.stdout.write(
    '[' + (Date.now() - t0) + 'ms] 池=' + plan.poolInfo.pickedSize +
    ' 补字=' + dri.added + ' 想要=' + dri.wanted +
    ' 无依据跳过=' + dri.skippedNoEvidence + ' mode=' + dri.mode + '\n    ' +
    (out || []).slice(0, 10).map(function (r) { return r.name; }).join(' ') + '\n');
  if (process.env.NS_DUMP) {
    /* 直接写文件 —— 走 PowerShell 重定向会被按 GBK 解码，中文全乱 */
    fs.writeFileSync(path.join(__dirname, '_dump.txt'),
      (out || []).slice(0, 20).map(function (r) {
        return r.name + '  ' + r.pinyin + '  ' + r.score.toFixed(1) + '  ' +
          r.meaning.slice(0, 30);
      }).join('\n') +
      '\n\n候选池 ' + plan.pool.length + ' 字：\n' +
      plan.pool.map(function (r) { return r.char; }).join(''), 'utf8');
  }
  process.exit(0);
}

SCENARIOS.forEach(function (sc, i) {
  let out;
  try {
    out = require('child_process').execFileSync(process.execPath, [__filename], {
      env: Object.assign({}, process.env, { NS_E2E: String(i) }),
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (e) {
    out = '失败: ' + String((e && e.stderr) || (e && e.message) || e);
  }
  say('  ' + sc[0] + '  ' + String(out).trim());
});

fs.writeFileSync(OUT, L.join('\n'), 'utf8');
console.log('wrote ' + OUT + ' (' + L.length + ' lines)');
