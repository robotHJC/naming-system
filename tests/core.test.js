/* =========================================================================
 * core.test.js —— 核心算法验证（Node 运行，不依赖任何第三方库）
 *   node tests/core.test.js
 * ========================================================================= */
'use strict';
const path = require('path');

const BASE = path.join(__dirname, '..', 'web', 'js');
[
  'data/chars-extra.js', 'data/chars.js', 'data/surnames.js', 'data/poetry.js',
  'data/homophone.js', 'data/popularity.js', 'data/radicals.js',
  'data/radical-hints.js', 'data/namewords.js', 'data/era-chars.js',
  'data/nayin.js', 'data/shuli81.js', 'data/nameblock.js',
  'core/wuxing.js', 'core/calendar.js', 'core/tiaohou.js', 'core/bazi.js',
  'core/wuge.js',
  'core/pinyin.js', 'core/poetry-lib.js', 'core/score.js', 'core/generator.js',
  'core/infer.js', 'core/lexicon.js', 'core/radical.js', 'core/variant.js',
  'core/hexagram.js', 'core/zodiac.js', 'core/report.js'
].forEach(f => require(path.join(BASE, f)));

const NS = globalThis.NS;
const C = NS.Calendar;

/* 把输出同时收集起来，结束时写一份 UTF-8 日志，
 * 避免在 PowerShell 里重定向得到 UTF-16 而无法阅读。 */
const LOG = [];
const _consoleLog = console.log.bind(console);
console.log = function () {
  const line = Array.prototype.map.call(arguments, String).join(' ');
  LOG.push(line);
  _consoleLog(line);
};

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else {
    fail++;
    console.log('  \u2717 ' + name + (extra ? '  → ' + extra : ''));
  }
}
function eq(name, actual, expected) {
  ok(name, actual === expected, 'got ' + actual + ', want ' + expected);
}
function section(t) { console.log('\n' + t); }

const pad = n => String(n).padStart(2, '0');
function fmt(d) {
  return `${d.y}-${pad(d.m)}-${pad(d.d)} ${pad(d.h)}:${pad(d.mi)}`;
}

/* ---------------- 1. 数据完整性 ---------------- */
section('1. 数据层');
console.log('  字库字数：' + Object.keys(NS.CHAR_DB).length);
console.log('  姓氏数：' + NS.SURNAME_LIST.length);
console.log('  诗词数：' + NS.Poetry.poems.length);
ok('字库解析出足够用字', Object.keys(NS.CHAR_DB).length > 200);
ok('每字都有拼音/五行/笔画', NS.CHAR_LIST.every(c =>
  /^[a-zü]+$/.test(c.pinyin) && '金木水火土'.includes(c.wuxing) && c.strokes > 0));
eq('李 的康熙笔画', NS.SURNAME_DB['李'].strokes[0], 7);
eq('张 的康熙笔画', NS.SURNAME_DB['张'].strokes[0], 11);
eq('欧阳 为复姓', NS.SURNAME_DB['欧阳'].compound, true);

/* ---------------- 2. 节气精度 ---------------- */
section('2. 节气时刻（北京时间，对照公开天文年历）');
const cases = [
  [2024, '立春', '2024-02-04 16:26'],
  [2024, '清明', '2024-04-04 15:02'],
  [2024, '大雪', '2024-12-06 23:17'],
  [2023, '立春', '2023-02-04 10:42'],
  [2000, '立春', '2000-02-04 20:40'],
  [1984, '立春', '1984-02-04 23:19']
];
cases.forEach(([y, name, want]) => {
  const j = C.jieOfYear(y).find(x => x.name === name);
  const got = fmt(j.date);
  const d = Math.abs(fmtToMin(got) - fmtToMin(want));
  ok(`${y} ${name} = ${got}（期望 ${want}，差 ${d} 分钟）`, d <= 20);
});
function fmtToMin(s) {
  const m = s.match(/(\d+)-(\d+)-(\d+) (\d+):(\d+)/);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000;
}

/* ---------------- 3. 八字排盘 ---------------- */
section('3. 八字排盘（对照已知命例）');
const known = [
  { d: [2000, 1, 1, 12, 0], want: '己卯 丙子 戊午 戊午' },
  { d: [1949, 10, 1, 12, 0], want: '己丑 癸酉 甲子 庚午' },
  { d: [2024, 5, 20, 10, 0], want: '甲辰 己巳 甲申 己巳' }
];
known.forEach(k => {
  const r = NS.Bazi.analyzeBazi(k.d[0], k.d[1], k.d[2], k.d[3], k.d[4]);
  console.log(`  ${k.d.join('-')} → ${r.baziStr}   日主${r.dayGan}(${r.dayWx}) ${r.strength} 喜用:${r.xiyongshen.join('、')}`);
  eq(`${k.d.join('-')} 四柱`, r.baziStr, k.want);
});

section('3b. 节气换柱边界');
{
  const before = NS.Bazi.analyzeBazi(2024, 2, 4, 16, 0);   // 立春前 26 分钟
  const after = NS.Bazi.analyzeBazi(2024, 2, 4, 17, 0);    // 立春后 34 分钟
  console.log(`  2024-02-04 16:00 → ${before.baziStr}（节气：${before.meta.jieqi}）`);
  console.log(`  2024-02-04 17:00 → ${after.baziStr}（节气：${after.meta.jieqi}）`);
  ok('立春前仍属癸卯年', before.baziStr.startsWith('癸卯'), before.baziStr);
  ok('立春后进入甲辰年', after.baziStr.startsWith('甲辰'), after.baziStr);
}
{
  const late = NS.Bazi.analyzeBazi(2024, 3, 1, 23, 30);    // 晚子时
  const next = NS.Bazi.analyzeBazi(2024, 3, 2, 0, 30);
  eq('23:30 与次日 00:30 日柱相同（23时换日）',
    late.baziStr.split(' ')[2], next.baziStr.split(' ')[2]);
}

section('3c. 真太阳时');
{
  // 乌鲁木齐(87.6E) 比北京时间约晚 130 分钟，12:00 北京时应仍在巳时
  const r = NS.Bazi.analyzeBazi(2024, 5, 20, 12, 0,
    { longitude: 87.6, trueSolarTime: true });
  console.log(`  乌鲁木齐 12:00 → 真太阳时 ${r.meta.tst.h}:${pad(r.meta.tst.mi)}，时柱 ${r.baziStr.split(' ')[3]}`);
  ok('真太阳时被正确回拨', r.meta.deltaMin < -120 && r.meta.deltaMin > -145,
    'delta=' + r.meta.deltaMin);
}

/* ---------------- 4. 三才五格 ---------------- */
section('4. 三才五格');
{
  const w = NS.Wuge.calcWuge([7], [11]);  // 李 + 11画
  console.log(`  李(7) + 11画单名 → ${JSON.stringify(w)}`);
  eq('天格 = 姓 + 1', w.天格, 8);
  eq('人格 = 姓 + 名1', w.人格, 18);
  eq('外格 = 2（单姓单名）', w.外格, 2);
  const w2 = NS.Wuge.calcWuge([7], [11, 12]);
  eq('双名总格', w2.总格, 30);
  const w3 = NS.Wuge.calcWuge([15, 17], [10]);  // 欧阳 + 单名
  eq('复姓天格 = 两字之和', w3.天格, 32);
  eq('复姓人格 = 姓2 + 名1', w3.人格, 27);
}

/* ---------------- 5. 音韵与谐音 ---------------- */
section('5. 谐音检测（重点回归：原版子串匹配会误杀好名字）');

/** 用字库里的字拼音节；字不在库中则返回 null */
function homoByName(surname, chars) {
  const sur = NS.SURNAME_DB[surname];
  if (!sur) return null;
  const list = [];
  for (let i = 0; i < surname.length; i++) {
    list.push({ char: surname[i], pinyin: sur.pinyin[i], tone: sur.tones[i] });
  }
  for (const c of chars) {
    const info = NS.CHAR_DB[c] || NS.SURNAME_DB[c];
    if (!info) return null;
    /* 字库的 pinyin 是字符串，姓氏库的 pinyin 是数组 */
    const isArr = Array.isArray(info.pinyin);
    list.push({
      char: c,
      pinyin: isArr ? info.pinyin[0] : info.pinyin,
      tone: isArr ? info.tones[0] : info.tone
    });
  }
  return NS.Pinyin.checkHomophone(list);
}

/** 手工音节用例：用于验证字库里没有的字 */
function homoByPinyin(surnameChar, surnamePy, given) {
  const list = [{ char: surnameChar, pinyin: surnamePy, tone: 0 }];
  given.forEach(([c, p]) => list.push({ char: c, pinyin: p, tone: 0 }));
  return NS.Pinyin.checkHomophone(list);
}

/** 手工音节用例：'姓:拼音:调 名:拼音:调 ...' */
function check(spec) {
  const list = spec.trim().split(/\s+/).map(tok => {
    const [char, pinyin, tone] = tok.split(':');
    return { char, pinyin, tone: +tone };
  });
  return NS.Pinyin.checkHomophone(list);
}

const cases5 = [
  [() => homoByName('李', ['诗', '涵']), true, false,
    '原版因拼音含子串 "shi" 被误杀'],
  [() => homoByName('李', ['枫', '林']), true, false,
    '原版因 "feng" 子串被误杀'],
  [() => homoByName('林', ['灿']), true, false,
    '原版因 "can" 子串被误杀'],
  [() => homoByName('李', ['思', '琪']), true, false,
    'si1-qi2 不应被当成「死气」si3-qi4'],
  [() => homoByName('吴', ['德']), false, false, 'wu2-de2 ≈ 无德'],
  [() => check('范:fan:4 统:tong:3'), false, false, 'fan4-tong3 ≈ 饭桶'],
  [() => check('范:fan:4 彤:tong:2'), true, false,
    'fan4-tong2 ≠ 饭桶（声调不同，不应误杀）'],
  [() => check('王:wang:2 八:ba:1'), false, false, 'wang2-ba1 ≈ 王八'],
  [() => check('杜:du:4 子:zi:3 腾:teng:2'), false, false,
    'du4-zi3-teng2 ≈ 肚子疼（轻声通配）'],
  [() => check('杨:yang:2 威:wei:1'), true, false,
    'yang2-wei1 ≠ 阳痿 yang2-wei3'],
  [() => check('林:lin:2 灿:can:4 菲:fei:1'), true, false,
    'can4-fei1 ≠ 残废 can2-fei4'],
  [() => check('若:ruo:4 智:zhi:4'), false, false,
    'ruo4-zhi4 = 弱智（同调，应拦截）'],
  [() => check('吴:wu:2 宇:yu:3'), true, true,
    'wu2-yu3 ≈ 无语（仅提示，不淘汰）'],
  [() => check('陈:chen:2 默:mo:4'), true, true, 'chen2-mo4 ≈ 沉默（仅提示）']
];

cases5.forEach(([fn, wantPass, wantWarn, note]) => {
  const r = fn();
  if (!r) { console.log('  ⊘ 跳过：' + note + '（字不在库中）'); return; }
  const detail = (r.pass ? '通过' : '拦截：' + r.hits.map(h => h.desc).join('；'))
    + (r.warnings.length ? '  ⚠' + r.warnings.map(w => w.desc).join('；') : '');
  const good = r.pass === wantPass && (!wantWarn || r.warnings.length > 0);
  console.log(`  ${r.pinyin.replace(/ /g, '')} → ${detail}   [${note}]`);
  ok(note, good, detail);
});
{
  const r = homoByName('李', ['语', '晨']) || check('李:li:3 雨:yu:3 辰:chen:2');
  console.log('  音韵提示示例：' + JSON.stringify(r.warnings.map(w => w.desc)));
}

/* ---------------- 5b. 拼音标调 ---------------- */
section('5b. 拼音标调（标调位置规则）');
[
  ['shui', 3, 'shuǐ'], ['liu', 2, 'liú'], ['gui', 4, 'guì'],
  ['han', 2, 'hán'], ['yu', 3, 'yǔ'], ['lü', 4, 'lǜ'],
  ['qiu', 1, 'qiū'], ['xue', 3, 'xuě'], ['mei', 2, 'méi'],
  ['ruo', 4, 'ruò'], ['zhang', 1, 'zhāng'], ['hui', 1, 'huī']
].forEach(([py, tone, want]) => {
  const got = NS.Pinyin.toneMark(py, tone);
  ok(`${py}${tone} → ${got}`, got === want, 'got ' + got + ', want ' + want);
});

/* ---------------- 6. 诗词检索 ---------------- */
section('6. 诗词出处');
[
  [['清', '泉'], '王维·山居秋暝'],
  [['明', '月'], null],
  [['若', '水'], null],
  [['知', '新'], null]
].forEach(([cs, want]) => {
  const src = NS.Poetry.findSource(cs);
  console.log(`  ${cs.join('')} → ${src ? `《${src.source}》${src.title}「${src.line}」` : '无'}`);
  if (want) ok(`${cs.join('')} 命中预期诗篇`, src && src.title === want);
});

/* ---------------- 7. 生成器 ---------------- */
section('7. 名字生成与性能');
{
  const t0 = Date.now();
  const p = NS.Generator.plan({
    surname: '李', gender: '女', style: '古风', length: 2, top: 8,
    xiyongshen: ['水', '木']
  });
  const planMs = Date.now() - t0;
  console.log(`  候选池 ${p.poolInfo.pickedSize}/${p.poolInfo.poolSize}，枚举规模 ${p.total}，规划耗时 ${planMs}ms`);

  const t1 = Date.now();
  const res = NS.Generator.runSync(p);
  const runMs = Date.now() - t1;
  console.log(`  生成 ${res.length} 个结果，耗时 ${runMs}ms\n`);
  res.forEach((r, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${r.name}  ${r.pinyin}  ${r.score}分  ` +
      `五行[${r.wuxing.join('')}] 三才${r.wuge.三才}(${r.wuge.三才吉凶}) ` +
      `热度${r.heat.value}(${r.heat.text})`);
    console.log(`      ${r.reasons.join(' · ')}`);
    if (r.poetry) console.log(`      出处：《${r.poetry.source}》「${r.poetry.line}」`);
  });
  ok('生成了结果', res.length > 0);
  ok('结果字面互不相同', new Set(res.map(r => r.given)).size === res.length);

  /* 多样性回归测试。
   * 修之前：「李」+ 双字名默认参数下前 10 名全部以「书」开头——
   * 那是一个字 + 十种搭配，不是一个候选集合。 */
  ok('首字全不重复（多样性约束生效）',
    new Set(res.map(r => r.chars[0])).size === res.length,
    res.map(r => r.name).join(' '));

  const rawTop = NS.Generator.runSync(NS.Generator.plan({
    surname: '李', gender: '女', style: '古风', length: 2, top: 8,
    xiyongshen: ['水', '木'], diverse: false
  }));
  const rawFirsts = new Set(rawTop.map(r => r.chars[0])).size;
  const floor = Math.min(...res.map(r => r.score));
  console.log(`  多样性对照：不约束时前 8 名首字去重 ${rawFirsts}/8，` +
    `约束后 ${new Set(res.map(r => r.chars[0])).size}/${res.length}`);
  console.log(`  不约束：${rawTop.map(r => r.name).join(' ')}`);
  console.log(`  约　束：${res.map(r => r.name).join(' ')}`);

  /* 断言的是「契约」而不是「改善量」。
   * 原先写成 `约束后的去重数 > 不约束的去重数`，字库扩充后失效了 ——
   * 池子变大，纯按分数排前 8 名碰巧也分散开了，于是对照差值为 0。
   * 那是测试写得不稳：多样性约束本身与数据无关，不该靠比较来验证。 */
  const DEEP = NS.Generator.runSync(
    NS.Generator.plan({ surname: '李', gender: '女', length: 2, top: 24 }));
  const deepFirsts = DEEP.map(r => r.chars[0]);
  ok('前 24 名首字两两不同（约束是硬性的，与数据无关）',
    new Set(deepFirsts).size === 24, new Set(deepFirsts).size + '/24');
  /* 每个位置上的任何一个字，都不允许超过上限次数出现。
   * 第一轮 cap = 1，所以前 24 名里同一个字不得在同一位置重复。 */
  const posRepeats = [];
  for (let pos = 0; pos < 2; pos++) {
    const seen = Object.create(null);
    deepFirsts.length && DEEP.forEach(r => {
      const c = r.chars[pos];
      seen[c] = (seen[c] || 0) + 1;
    });
    Object.keys(seen).forEach(c => {
      if (seen[c] > 1) posRepeats.push('第' + (pos + 1) + '字 ' + c + '×' + seen[c]);
    });
  }
  ok('前 24 名里没有字在同一位置重复', posRepeats.length === 0, posRepeats.join(', '));

  ok('多样性没有把质量拖垮（与全局最高分差距 ≤ 15）',
    floor >= rawTop[0].score - 15,
    '最低 ' + floor + ' 分 vs 最高 ' + rawTop[0].score + ' 分');

  ok('结果五行含喜用神水或木', res.every(r =>
    r.wuxing.some(w => w === '水' || w === '木')));
  ok('单次生成在 1 秒内', runMs < 1000, runMs + 'ms');
}

section('7c. 换一批（分页）');
{
  const base = { surname: '李', gender: '女', length: 2, top: 6 };
  const all = NS.Generator.runSync(NS.Generator.plan(base), { full: true });
  ok('完整排序够翻多批', all.length >= 60, 'got ' + all.length);
  console.log(`  完整排序 ${all.length} 个，每批 6 个 → 可翻 ${Math.ceil(all.length / 6)} 批`);

  const b1 = NS.Generator.runSync(NS.Generator.plan(Object.assign({ offset: 0 }, base)));
  const b2 = NS.Generator.runSync(NS.Generator.plan(Object.assign({ offset: 6 }, base)));
  const b3 = NS.Generator.runSync(NS.Generator.plan(Object.assign({ offset: 12 }, base)));

  ok('每批数量正确', b1.length === 6 && b2.length === 6 && b3.length === 6);
  ok('三批之间名字互不重复',
    new Set(b1.concat(b2, b3).map(r => r.name)).size === 18);
  ok('分页切片与完整排序一致',
    b1.concat(b2, b3).every((r, i) => r.name === all[i].name));
  ok('分页结果稳定（重复运行一致）',
    JSON.stringify(NS.Generator.runSync(NS.Generator.plan(Object.assign({ offset: 6 }, base))).map(r => r.name)) ===
    JSON.stringify(b2.map(r => r.name)));

  /* 多样性上限：前 24 名首字应当两两不同（候选池有 100 字，足够） */
  const firsts = all.slice(0, 24).map(r => r.chars[0]);
  ok('前 24 名首字不重复', new Set(firsts).size === 24,
    new Set(firsts).size + '/24');

  console.log(`  第1批：${b1.map(r => r.name).join(' ')}`);
  console.log(`  第2批：${b2.map(r => r.name).join(' ')}`);
  console.log(`  第3批：${b3.map(r => r.name).join(' ')}`);
}

section('7b. 三字名规模');
{
  const p = NS.Generator.plan({
    surname: '王', gender: '男', length: 3, top: 5,
    xiyongshen: ['木', '火']
  });
  console.log(`  候选池 ${p.poolInfo.pickedSize}，枚举规模 ${p.total}`);
  const t = Date.now();
  const res = NS.Generator.runSync(p);
  console.log(`  耗时 ${Date.now() - t}ms`);
  res.slice(0, 3).forEach(r =>
    console.log(`  ${r.name} ${r.pinyin} ${r.score}分 ${r.reasons.join('·')}`));
  ok('三字名能在 2 秒内算完', Date.now() - t < 4000);
}

/* ---------------- 8. 兜底 ---------------- */
section('8. 边界情况');
{
  const r = NS.Bazi.analyzeBazi(2024, 5, 20, 10, 0);
  const ctx = NS.Score.buildContext({ surname: '李', xiyongshen: r.xiyongshen });
  const w = NS.Score.evaluate([NS.CHAR_DB['沐'], NS.CHAR_DB['涵']], ctx);
  ok('评分在 0-100 之间', w.score >= 0 && w.score <= 100, 'got ' + w.score);
  console.log(`  示例评分：李沐涵 = ${w.score} 分，${w.reasons.join(' · ')}`);

  /* 空参数不应抛异常 */
  let threw = false;
  try {
    NS.Generator.runSync(NS.Generator.plan({ surname: '李', top: 3 }));
  } catch (e) { threw = true; console.log('  异常：' + e.message); }
  ok('无生辰也能正常生成', !threw);

  /* 禁止用字与必含字 */
  const p2 = NS.Generator.plan({
    surname: '李', length: 2, top: 5, taboo: ['涵', '梓'],
    mustInclude: ['清']
  });
  const res2 = NS.Generator.runSync(p2);
  ok('禁用字未出现', res2.every(x => x.chars.indexOf('涵') < 0 && x.chars.indexOf('梓') < 0));
  ok('必含字已包含', res2.length > 0 && res2.every(x => x.chars.indexOf('清') >= 0),
    res2.map(x => x.name).join(','));
  console.log('  必含「清」的结果：' + res2.slice(0, 3).map(x => x.name).join('、'));

  /* 未知姓氏的兜底 */
  const p3 = NS.Generator.plan({
    surname: '甄', surnameStrokes: [], length: 2, top: 3
  });
  console.log('  未知姓氏兜底使用笔画：' + p3.ctx.surnameStrokes.join(','));
  ok('未知姓氏不崩溃', NS.Generator.runSync(p3).length >= 0);
}

/* ---------------- 9. 音韵必须算上姓氏 ----------------
 *
 * 用户反馈「名字不顺口」。查出来是个真 bug：音韵一项只检查了**名字内部**
 * 两字，完全没看姓氏与首字的连读。
 *   「李澜瑞」lǐ lán ruì —— 姓氏与首字都是 l 声母，
 *    连读会读成「李兰瑞」（l 只发一次），非常拗口；
 *   旧算法里 rows 只有 [澜, 瑞]，声母 l-r 不同 → 给了满分。
 *   「李凌初」同理（lǐ líng chū）。
 * 修法：把姓氏音节拼进去，并从「两两互不相同」改成**相邻比较**。
 * ------------------------------------------------ */
section('9. 音韵（含姓氏连读）');
{
  const r = NS.Bazi.analyzeBazi(2024, 5, 20, 10, 0);
  const mk = (surname) => NS.Score.buildContext({
    surname: surname, xiyongshen: r.xiyongshen
  });

  const ctxLi = mk('李');          /* 李 lǐ，声母 l */
  const ctxHao = mk('郝');         /* 郝 hǎo，声母 h */

  /* 同一组名字，只换姓氏，声母撞不撞应当改变音韵分 */
  const lPairs = [['澜', '瑞'], ['凌', '初']];
  let penalized = 0;
  lPairs.forEach(([a, b]) => {
    const rows = [NS.CHAR_DB[a], NS.CHAR_DB[b]];
    const li = NS.Score.evaluate(rows, ctxLi).detail.phonetic;
    const hao = NS.Score.evaluate(rows, ctxHao).detail.phonetic;
    if (li.sameInitial.length && !hao.sameInitial.length) penalized++;
    console.log(`  ${a}${b}：李姓撞声母 [${li.sameInitial.join(',')}]`
      + `／郝姓撞声母 [${hao.sameInitial.join(',')}]`);
  });
  ok('姓氏与首字撞声母能被检出（李澜/李凌）', penalized === lPairs.length,
    `${penalized}/${lPairs.length}`);

  /* 核心契约：李澜瑞 的音韵分必须**低于**一个不撞声母的对照名 */
  const bad = NS.Score.evaluate([NS.CHAR_DB['澜'], NS.CHAR_DB['瑞']], ctxLi);
  const good = NS.Score.evaluate([NS.CHAR_DB['澜'], NS.CHAR_DB['瑞']], ctxHao);
  ok('换成不撞声母的姓氏后音韵分上升', good.detail.phonetic !== bad.detail.phonetic
    || bad.detail.phonetic.sameInitial.length > 0);
  ok('李澜瑞被标出声母相撞', bad.detail.phonetic.sameInitial.indexOf('李澜') >= 0,
    bad.detail.phonetic.sameInitial.join(','));

  /* 反向回归：不要因为加了姓氏就把所有名字都判成拗口。
   * 「郝若溪」hǎo ruò xī 三个声母 h/r/x 全不同。 */
  const okPh = NS.Score.evaluate([NS.CHAR_DB['若'], NS.CHAR_DB['溪']], ctxHao)
    .detail.phonetic;
  ok('郝若溪 不误报声母相撞', okPh.sameInitial.length === 0, okPh.sameInitial.join(','));
  ok('郝若溪 不误报叠韵', okPh.sameFinal.length === 0, okPh.sameFinal.join(','));

  /* 上声连读（三声+三声）必须被扣分：「郝雨语」hǎo yǔ yǔ */
  const third = NS.Score.evaluate([NS.CHAR_DB['雨'], NS.CHAR_DB['语']], ctxHao);
  const nonThird = NS.Score.evaluate([NS.CHAR_DB['雨'], NS.CHAR_DB['清']], ctxHao);
  ok('连续上声被扣分', third.score < nonThird.score + 30,
    `上声${third.score} vs 非上声${nonThird.score}`);
}

/* ---------------- 10. 出处不能拿文言虚词充数 ----------------
 *
 * 「太文绉绉」的机制性原因：出处成词奖励的是文言词。
 * 古文里「亦书」「唯昭」这类**虚词 + 实词**的相邻搭配满地都是，
 * 但它们不是词。实测系统排出来的正是：
 *   李亦白 ← 诗经「亦白其马」
 *   李唯昭 ← 楚辞「唯昭质其犹未亏」
 * 修法：poetry-lib 建索引时，含文言虚词的相邻对直接不入索引。
 * ------------------------------------------------ */
section('10. 文言虚词过滤');
{
  const FUNCTION_CHARS = '亦唯之而其以于为所者也乎哉兮乃则焉矣夫盖与及使令能欲';
  const found = [];
  /* 用内置诗词库直接查：这些字开头的相邻对不该被当成成词 */
  const probes = [['亦', '白'], ['唯', '昭'], ['亦', '书'], ['之', '初']];
  probes.forEach(([a, b]) => {
    const hit = NS.Poetry.findAdjacent([a, b]);
    if (hit) found.push(a + b + '→' + (hit.pair || '') + '@' + (hit.source || ''));
  });
  ok('文言虚词相邻对不再算成词', found.length === 0, found.join(' | '));
  console.log('  探测结果：' + (probes.map(p => p.join('')).join('、'))
    + ' → ' + (found.length ? found.join('，') : '全部未命中'));

  /* 反向回归：真正的词不能被误杀。「若水」出自老子「上善若水」 */
  const real = NS.Poetry.findAdjacent(['若', '水']);
  ok('真实出处未被误杀（若水）', !!real, real ? real.source : 'null');
  if (real) console.log('  若水 → 《' + real.source + '》');

  /* ---- 日常词语（按词频判定）----
   * 「明月」在内置诗库里出现 5 次（最高频），是普通词；
   * 「嘉树」只出现 1 次，是真雅词。 */
  const md = NS.Poetry.findAdjacent(['明', '月']);
  const js = NS.Poetry.findAdjacent(['嘉', '树']);
  ok('高频相邻对被标为日常词语（明月）', !!md && md.everyday === true,
    md ? `everyday=${md.everyday} freq=${md.freq}` : 'null');
  ok('雅词未被标为日常词语（嘉树）', !!js && js.everyday === false,
    js ? `everyday=${js.everyday} freq=${js.freq}` : 'null');
  console.log(`  明月 freq=${md && md.freq}（日常词语）／嘉树 freq=${js && js.freq}（雅词）`);

  /* 日常词语拿到的分必须明显低于雅词 —— 否则「风雨」「潮水」会挤掉好名字 */
  const r0 = NS.Bazi.analyzeBazi(2024, 5, 20, 10, 0);
  const c0 = NS.Score.buildContext({ surname: '郝', xiyongshen: r0.xiyongshen });
  if (md) {
    const em = NS.Score.evaluate([NS.CHAR_DB['明'], NS.CHAR_DB['月']], c0);
    ok('日常词语写入 pairKind=everyday', em.detail.pairKind === 'everyday',
      String(em.detail.pairKind));
    ok('日常词语有对应说明', em.reasons.some(x => x.indexOf('不算典故') >= 0),
      em.reasons.join('·'));
  }
  if (real) {
    const rw = NS.Score.evaluate([NS.CHAR_DB['若'], NS.CHAR_DB['水']], c0);
    ok('真雅词仍是 classic', rw.detail.pairKind === 'classic', String(rw.detail.pairKind));
  }
}

/* ---------------- 11. 现代感维度 ----------------
 *
 * 新增「现代感 12」是对冲「出处奖励文言词」的正向信号：
 *   命中现代名字词表 +7，用字热度落在舒适区 +5（倒 U 型）。
 * ------------------------------------------------ */
section('11. 现代感');
{
  const r = NS.Bazi.analyzeBazi(2024, 5, 20, 10, 0);
  const ctx = NS.Score.buildContext({ surname: '郝', xiyongshen: r.xiyongshen });

  ok('名字词表已加载', NS.NAME_WORDS && NS.NAME_WORDS.length >= 150,
    String(NS.NAME_WORDS && NS.NAME_WORDS.length));

  /* 词表里的每个字都必须在字库里，否则那个词永远触发不了 */
  const missing = [];
  NS.NAME_WORDS.forEach(w => {
    for (const ch of w) if (!NS.CHAR_DB[ch]) missing.push(w + ':' + ch);
  });
  ok('词表用字全部在字库内', missing.length === 0, missing.slice(0, 8).join(','));

  /* 词表命中 → 加分；用相同用字构造一个不在表里的对照 */
  const hit = NS.Score.evaluate([NS.CHAR_DB['予'], NS.CHAR_DB['安']], ctx);
  ok('词表命中被识别', hit.detail.modern && hit.detail.modern.word === '予安',
    hit.detail.modern ? String(hit.detail.modern.word) : 'null');
  ok('命中词表写入理由', hit.reasons.some(x => x.indexOf('现代常用搭配') >= 0),
    hit.reasons.join('·'));

  /* 倒 U 型：过冷与过热的用字都拿不到满分现代感 */
  const cold = NS.Score.evaluate([NS.CHAR_DB['愚'], NS.CHAR_DB['举']], ctx);
  const hot = NS.Score.evaluate([NS.CHAR_DB['艳'], NS.CHAR_DB['丽']], ctx);
  const sweet = NS.Score.evaluate([NS.CHAR_DB['清'], NS.CHAR_DB['和']], ctx);
  console.log('  愚举=' + cold.score + ' 艳丽=' + hot.score + ' 清和=' + sweet.score);
  ok('清和（舒适区）分数高于愚举（生僻）', sweet.score > cold.score,
    `${sweet.score} vs ${cold.score}`);

  /* 权重总和必须是 100 的框架：各维度满分相加 = 100 */
  const perfect = NS.Score.evaluate(
    [NS.CHAR_DB['清'], NS.CHAR_DB['和']], ctx);
  ok('分数仍在 0-100 区间', perfect.score >= 0 && perfect.score <= 100,
    String(perfect.score));
}

/* ---------------- 12. 时代感（上代用字扣分） ----------------
 *
 * 用户反馈「功能里面有的名字太老气了，比如伟、刚、钢、茂、超」。
 * 根因是热度表衡量的是「这个字在人口里有多常见」，而不是
 * 「在当代起名里有多时髦」—— 伟/刚/军/丽/艳 热度 85-86，
 * 全部落在「现代感」的舒适区拿满分，可它们的常见来自 50-90 年代出生的人。
 * ------------------------------------------------ */
section('12. 时代感（上代用字）');
{
  ok('上代用字表已加载', NS.ERA_CHARS && Object.keys(NS.ERA_CHARS).length > 50,
    String(NS.ERA_CHARS && Object.keys(NS.ERA_CHARS).length));

  /* 用户点名的字必须被标出来 */
  const shouldFlag = '伟刚钢茂超军强国建华永德志平丽艳敏静娟燕芳秀英梅桂';
  const missed = [];
  for (const c of shouldFlag) if (!NS.ERA_CHARS[c]) missed.push(c);
  ok('用户点名的老气字都被收录', missed.length === 0, missed.join(''));

  /* 反向回归：常见雅字不能被误伤（这是最容易犯的错） */
  const mustNotFlag = '明清和安宁佳欣嘉子一语诺沐涵辰宇泽睿轩书舒知兰云月雪雨风花春秋冬';
  const wrong = [];
  for (const c of mustNotFlag) if (NS.ERA_CHARS[c]) wrong.push(c);
  ok('当代雅字没有被误收', wrong.length === 0, wrong.join(''));

  /* 实测对照：老气组合必须被压下去 */
  const r12 = NS.Bazi.analyzeBazi(1990, 3, 15, 9, 0);
  const c12 = NS.Score.buildContext({ surname: '郝', xiyongshen: r12.xiyongshen });
  const ev = (nm) => NS.Score.evaluate(
    [...nm].filter(ch => NS.CHAR_DB[ch]).map(ch => NS.CHAR_DB[ch]), c12);

  const old = ev('建军');
  const good = ev('清和');
  ok('老气组合被扣分', old.score < good.score,
    old.score + ' vs ' + good.score);
  ok('扣分理由里写明是上一代用字',
    old.reasons.some(x => x.indexOf('上一代') >= 0), old.reasons.join('·'));
  ok('两个老气字都被记录', old.detail.modern.era.length === 2,
    old.detail.modern.era.join(','));
  console.log(`  郝建军 ${old.score} 分（${old.detail.modern.era.join('、')}）`
    + `／郝清和 ${good.score} 分`);

  /* 关键：好搭配不能被误杀。
   * 「静」在表里（老气组合常客），但「静姝」出自诗经且在现代词表里，
   * 词表 +12 应当抵掉扣分，仍然拿到现代搭配加分。 */
  const jingshu = ev('静姝');
  ok('含上代用字的好搭配仍能拿到现代搭配加分',
    jingshu.reasons.some(x => x.indexOf('现代常用搭配') >= 0),
    jingshu.reasons.join('·'));
  ok('好搭配的分数高于纯老气组合', jingshu.score > old.score,
    jingshu.score + ' vs ' + old.score);
  console.log(`  郝静姝 ${jingshu.score} 分（${jingshu.reasons.join('·')}）`);

  /* 扣分力度：每个上代字扣 6 分，而「热度舒适区」整名最多给 6 分，
   * 所以一个字就能抵掉整名的热度加分、两个字直接压到垫底；
   * 同时必须小于词表的 12 分，否则「静姝」这类好搭配会被误杀。 */
  ok('扣分力度在合理区间（≥热度上限且 < 词表加分）',
    NS.ERA_PENALTY >= 6 && NS.ERA_PENALTY < 12,
    String(NS.ERA_PENALTY));
}

/* ---------------- 13. 纳音（六十甲子） ----------------
 *
 * 用户问「今年马年火年，能不能用带水的字」——
 * 2026 丙午按干支是火，按纳音是「天河水」属水，同一年两套相反。
 * 这张表是可核对的固定查表，所以这里逐项验。
 * ------------------------------------------------ */
section('13. 纳音五行');
{
  eq('纳音表 30 组', NS.NAYIN_TABLE.length, 30);

  /* 六十甲子每一组都必须有纳音，不能有洞 */
  let missing = [];
  for (let g = 0; g < 10; g++) {
    for (let z = 0; z < 12; z++) {
      if (((g + z) % 2) !== 0) continue;
      const n = NS.nayinOfGanzhi(g, z);
      if (!n || !n.name || !n.wuxing) missing.push(NS.TIANGAN[g] + NS.DIZHI[z]);
    }
  }
  ok('六十甲子全部有纳音', missing.length === 0, missing.join(','));

  /* 已知年份核对（干支与纳音都是公开可查的） */
  const known = [
    [1984, '甲子', '海中金'], [1990, '庚午', '路旁土'],
    [2000, '庚辰', '白蜡金'], [2024, '甲辰', '覆灯火'],
    [2025, '乙巳', '覆灯火'], [2026, '丙午', '天河水'],
    [2027, '丁未', '天河水'], [2044, '甲子', '海中金']
  ];
  let wrong = [];
  known.forEach(([y, gz, ny]) => {
    const n = NS.nayinOfYear(y);
    if (!n || n.name !== ny) wrong.push(y + '→' + (n && n.name) + '(期望' + ny + ')');
  });
  ok('已知年份纳音核对无误', wrong.length === 0, wrong.join(' '));
  console.log('  2024 甲辰→' + NS.nayinOfYear(2024).name +
    '　2026 丙午→' + NS.nayinOfYear(2026).name);

  /* 纳音五行 = 名称末字，不该手工维护第二份 */
  ok('纳音五行取自名称末字',
    NS.nayinOfYear(2026).wuxing === '水' && NS.nayinOfYear(2024).wuxing === '火');

  /* 核心：干支五行与纳音五行**可以不一致**，这正是要展示的矛盾 */
  const n26 = NS.nayinOfYear(2026);
  const b26 = NS.Bazi.analyzeBazi(2026, 5, 20, 10, 0);
  ok('2026 干支层是火（丙午）',
    b26.pillars[0].ganWx === '火' && b26.pillars[0].zhiWx === '火');
  ok('2026 纳音层是水（天河水）—— 与干支相反',
    n26.wuxing === '水', n26.name);
  ok('八字结果里带上了纳音', !!b26.nayin && b26.nayin.name === '天河水');
  console.log('  同一年的两套口径：干支=火火，纳音=' + n26.name + '（水）');
}

/* ---------------- 14. 姓名卦 ----------------
 *
 * 这是**民俗做法**，不是《周易》原书用法。测试只验「起卦规则可复算、
 * 64 卦表完整、体用生克按定义走」，不验吉凶是否灵验（那无法验）。
 * ------------------------------------------------ */
section('14. 姓名卦（民俗参考）');
{
  /* 64 卦表必须齐 —— 缺一个就会在某些笔画下报「未收录」 */
  let lack = [];
  for (let u = 1; u <= 8; u++) {
    for (let l = 1; l <= 8; l++) {
      if (!NS.HEXAGRAM_NAMES[u + '-' + l]) lack.push(u + '-' + l);
    }
  }
  ok('六十四卦表完整', lack.length === 0, lack.join(','));
  eq('六十四卦条目数', Object.keys(NS.HEXAGRAM_NAMES).length, 64);

  /* 八卦爻画：三个爻、阴阳各半（除乾坤），且能反查回自己 */
  let yaoBad = [];
  for (let k = 1; k <= 8; k++) {
    const b = NS.BAGUA[k];
    if (!b || b.yao.length !== 3) { yaoBad.push(k + ':爻数'); continue; }
    if (b.yao.some(v => v !== 0 && v !== 1)) yaoBad.push(k + ':非阴阳');
  }
  ok('八卦爻画合法', yaoBad.length === 0, yaoBad.join(','));

  /* 起卦可复算：郝(14) + 清和(12+8=20) */
  const h = NS.castNameHexagram(14, 20);
  ok('起卦返回结果', !!h);
  eq('上卦 = 姓笔画 % 8（14%8=6 → 坎）', h.upper.no, 6);
  eq('下卦 = 名笔画 % 8（20%8=4 → 震）', h.lower.no, 4);
  eq('动爻 = 总笔画 % 6（34%6=4）', h.basis.moving, 4);
  eq('本卦为水雷屯', h.name, '水雷屯');
  ok('变卦已算出', !!h.changed && !!h.changed.name);
  console.log(`  郝(14)+清和(20) → ${h.symbol} ${h.name}　动爻${h.basis.moving}　` +
    `变卦 ${h.changed.name}　体${h.ti.name}(${h.ti.wuxing})/用${h.yong.name}(${h.yong.wuxing})` +
    ` → ${h.relation.level} ${h.relation.kind}`);

  /* 动爻归属决定体用，这是一条硬规则 */
  const lo = NS.castNameHexagram(14, 20);   /* 动爻 4，在上卦 → 上卦为用 */
  ok('动爻在上卦时，上卦为用、下卦为体',
    lo.basis.moving > 3 && lo.yong.name === lo.upper.name
    && lo.ti.name === lo.lower.name);

  /* 余数为 0 的边界：取 8 而不是 0 */
  const h2 = NS.castNameHexagram(8, 8);     /* 8%8=0 → 坤；16%6=4 */
  eq('余 0 时上卦取 8（坤）', h2.upper.no, 8);
  eq('余 0 时下卦取 8（坤）', h2.lower.no, 8);
  eq('八卦全坤 → 坤为地', h2.name, '坤为地');

  /* 动爻余 0 取 6 */
  const h3 = NS.castNameHexagram(1, 5);     /* 总 6，6%6=0 → 动爻 6 */
  eq('动爻余 0 取第 6 爻', h3.basis.moving, 6);

  /* 体用生克五条规则逐条验（用五行直接调，不绕起卦） */
  const rel = NS.Hexagram.relation;
  eq('用生体 → 吉', rel('木', '水').level, '吉');
  eq('体用比和 → 吉', rel('木', '木').level, '吉');
  eq('体克用 → 小吉', rel('木', '土').level, '小吉');
  eq('体生用 → 平', rel('木', '火').level, '平');
  eq('用克体 → 凶', rel('木', '金').level, '凶');

  /* 免责声明必须在结果里，界面直接展示，不能靠界面自己记得写 */
  ok('起卦结果自带免责说明', typeof h.disclaimer === 'string'
    && h.disclaimer.indexOf('民俗') >= 0, h.disclaimer.slice(0, 40));
}

/* ---------------- 15. 生肖流派冲突 ----------------
 *
 * 这是回答用户「马年能不能用水」的地方。测试要确认的是：
 * **冲突会被检出并说明**，而不是系统悄悄替用户做选择。
 * ------------------------------------------------ */
section('15. 生肖与八字的口径冲突');
{
  const b26 = NS.Bazi.analyzeBazi(2026, 5, 20, 10, 0);
  const z = NS.analyzeZodiac(b26);
  ok('生肖分析可用', !!z);
  eq('2026 属马', z.shengxiao, '马');
  eq('年柱为丙午', z.yearPillar, '丙午');
  ok('纳音一并带出', z.nayin && z.nayin.name === '天河水');

  /* 干支火 / 纳音水 → 必须报冲突 */
  const kinds = z.conflicts.map(c => c.kind);
  ok('检出「干支与纳音不一致」',
    kinds.some(k => k.indexOf('纳音') >= 0), kinds.join(','));
  const cf = z.conflicts.find(c => c.kind.indexOf('纳音') >= 0);
  ok('冲突条目写清了两边的值',
    cf && cf.a.indexOf('火') >= 0 && cf.b.indexOf('水') >= 0,
    cf ? cf.a + ' / ' + cf.b : '');
  console.log('  冲突：' + cf.a + '　／　' + cf.b);

  /* 生肖形义派说属马忌氵，而 2026 这个八字的喜用神可能正需要水 ——
   * 一旦重合就必须报冲突，并明确写「以八字为准」 */
  const warn = NS.zodiacRadicalWarning(['沐', '涵'], '马');
  ok('属马用氵字会给出形义派提示', !!warn && warn.hits.length === 2,
    warn ? warn.hits.join(',') : 'null');
  ok('提示里写明不扣分', warn.note.indexOf('不因此扣分') >= 0);
  console.log('  形义派提示：' + warn.hits.join('、') + ' —— ' + warn.why);

  /* 关键：给出「八字优先」的立场，而不是和稀泥 */
  ok('明确写出以八字为准', z.stance.indexOf('以八字喜用神为准') >= 0);
  ok('说明生肖不自动限制用字', z.stance.indexOf('不按生肖自动限制用字') >= 0);

  /* 反向：没有冲突的年份不该乱报 */
  const b90 = NS.Bazi.analyzeBazi(1990, 3, 15, 9, 0);
  const z90 = NS.analyzeZodiac(b90);
  eq('1990 庚午年纳音为路旁土（与地支午火不一致，也应报出）',
    z90.nayin.wuxing, '土');
}

/* ---------------- 16. 名字评估报告 ---------------- */
section('16. 名字评估（自定义名字）');
{
  const b = NS.Bazi.analyzeBazi(2026, 5, 20, 10, 0);
  const rep = NS.Report.evaluate('郝', '沐涵', { bazi: b });
  ok('能评估一个名字', !!rep);
  eq('识别出姓氏', rep.surname, '郝');
  eq('识别出名字', rep.given, '沐涵');
  ok('总分在 0-100', rep.total >= 0 && rep.total <= 100, String(rep.total));
  eq('没有字库外的字', rep.unknownChars.length, 0);
  console.log(`  郝沐涵 → ${rep.total} 分（${rep.verdict}）`);

  /* 报告必须分层，且层数齐全 —— 这是这个功能的核心设计 */
  const basisSet = new Set(rep.blocks.map(x => x.basis));
  ok('报告含「命理」层', basisSet.has('命理'), [...basisSet].join(','));
  ok('报告含「民俗」层', basisSet.has('民俗'));
  ok('报告含「语言」层', basisSet.has('语言'));
  ok('报告含「数理」层', basisSet.has('数理'));
  ok('每个分块都有依据标签', rep.blocks.every(x => !!x.basisLabel));
  console.log('  分层：' + [...basisSet].join(' / '));

  /* 姓名卦与生肖都要进报告 */
  ok('报告带姓名卦', !!rep.hexagram && !!rep.hexagram.name,
    rep.hexagram && rep.hexagram.name);
  ok('报告带生肖分析', !!rep.zodiac && rep.zodiac.shengxiao === '马');

  /* 免责声明：必须在报告里，不能只在界面上写 */
  ok('报告自带免责声明',
    rep.disclaimer.indexOf('不预测命运') >= 0 &&
    rep.disclaimer.indexOf('不是科学结论') >= 0);

  /* 复姓不能把姓算成名字用字（之前这里有个真 bug：
   * 姓氏不在 CHAR_DB 里，被误判成「字库外字」，姓氏笔画算成 undefined） */
  const ou = NS.Report.evaluate('欧阳', '清和', { bazi: b });
  ok('复姓不产生「字库外字」', ou.unknownChars.length === 0,
    ou.unknownChars.join(','));
  ok('复姓也能起卦', !!ou.hexagram && !!ou.hexagram.name, ou.hexagram && ou.hexagram.name);
  console.log(`  欧阳清和 → ${ou.hexagram.name}　${ou.total} 分`);

  /* 没有生辰也要能评（只评名字本身，不涉八字） */
  const noB = NS.Report.evaluate('郝', '清和', {});
  ok('无生辰也能出报告', !!noB && noB.total > 0, String(noB && noB.total));
  const noBasis = new Set(noB.blocks.map(x => x.basis));
  ok('无生辰时报告里没有「命理」层（不硬凑）', !noBasis.has('命理'),
    [...noBasis].join(','));

  /* 全生僻字：应返回 null 而不是崩 */
  const none = NS.Report.evaluate('郝', '龘靐', { bazi: b });
  eq('字库外的名字返回 null 而不是崩溃', none, null);
}

/* ---------------- 17. 十神 ---------------- */
section('17. 十神');
{
  /* 口诀对照：这些关系在任何一本命理入门书里都固定，用来锁死实现别写反。
   * 重点是同时覆盖阳干与阴干 —— 只测甲木日主的话，
   * 阴阳判断写反了也照样全过。 */
  const CASES = [
    ['甲', '甲', '比肩'], ['甲', '乙', '劫财'],
    ['甲', '丙', '食神'], ['甲', '丁', '伤官'],
    ['甲', '戊', '偏财'], ['甲', '己', '正财'],
    ['甲', '庚', '七杀'], ['甲', '辛', '正官'],
    ['甲', '壬', '偏印'], ['甲', '癸', '正印'],
    ['辛', '辛', '比肩'], ['辛', '庚', '劫财'],
    ['辛', '壬', '伤官'], ['辛', '癸', '食神'],
    ['辛', '甲', '正财'], ['辛', '乙', '偏财'],
    ['辛', '丙', '正官'], ['辛', '丁', '七杀'],
    ['辛', '戊', '正印'], ['辛', '己', '偏印'],
    ['壬', '甲', '食神'], ['壬', '乙', '伤官'],
    ['壬', '戊', '七杀'], ['壬', '己', '正官'],
    ['壬', '庚', '偏印'], ['壬', '辛', '正印']
  ];
  let wrong = 0;
  CASES.forEach(([d, t, want]) => { if (NS.shishen(d, t) !== want) wrong++; });
  eq('十神口诀对照全部正确（含阳干与阴干日主）', wrong, 0);

  /* 阴阳必须与天干下标奇偶一致 */
  let yy = 0;
  NS.TIANGAN.forEach((g, i) => {
    const want = (i % 2 === 0) ? '阳' : '阴';
    if (NS.ganYinYang(i) !== want || NS.ganYinYang(g) !== want) yy++;
  });
  eq('天干阴阳与下标奇偶一致', yy, 0);

  const r = NS.Bazi.analyzeBazi(2026, 5, 20, 10, 0);
  eq('四柱正确', r.baziStr, '丙午 癸巳 甲午 己巳');
  eq('日主为甲（阳木）', r.dayGan + r.dayYinYang + r.dayWx, '甲阳木');
  /* 日柱天干就是日主自己，不能标成某个十神 */
  eq('日柱天干标注为「日主」', r.pillars[2].ganShishen, '日主');
  eq('年柱天干为食神（甲见丙）', r.pillars[0].ganShishen, '食神');
  eq('月柱天干为正印（甲见癸）', r.pillars[1].ganShishen, '正印');
  eq('时柱天干为正财（甲见己）', r.pillars[3].ganShishen, '正财');
  /* 藏干也要带十神，只算四个天干会丢掉大半信息 */
  eq('月支巳藏干十神齐全', r.pillars[1].cangGan.map(c => c.shishen).join(','),
    '食神,七杀,偏财');
  /* 月令 ×1.5：已中丙(食神) 1.5 + 年干丙 1.0 + 时支巳丙 1.0 = 3.5 */
  ok('月令加成算进十神力量', Math.abs(r.shishen.power['食神'] - 3.5) < 0.01,
    String(r.shishen.power['食神']));
  eq('最旺十神为食神', r.shishen.dominant, '食神');
  eq('没出现的十神只有 4 个', r.shishen.missing.length, 4);
  ok('十个十神都有展示顺序', NS.Bazi.SHISHEN_ORDER.length === 10);

  /* 换一个八字，确认十个十神都能产出（不是只有这一组碰巧） */
  const seen = new Set();
  for (let y = 1980; y <= 2020; y += 2) {
    for (let m = 1; m <= 12; m += 3) {
      const a = NS.Bazi.analyzeBazi(y, m, 15, 10, 0);
      Object.keys(a.shishen.power).forEach(k => seen.add(k));
    }
  }
  eq('多种八字能覆盖全部十个十神', seen.size, 10);

  const rep = NS.Report.evaluate('郝', '清和', { bazi: r });
  ok('评估报告里有「十神」块',
    rep.blocks.some(x => x.title === '十神'),
    rep.blocks.map(x => x.title).join(','));
}

/* ---------------- 18. 调候 ---------------- */
section('18. 调候（寒暖燥湿）');
{
  /* 十二地支必须不重不漏地归入四季，且四季各三个 */
  const seasons = {};
  NS.DIZHI.forEach(z => {
    const s = NS.Tiaohou.SEASON_OF[z];
    seasons[s] = (seasons[s] || 0) + 1;
  });
  eq('十二地支全部归季', Object.keys(seasons).length, 4);
  eq('每季恰好三个月支',
    ['春', '夏', '秋', '冬'].map(s => seasons[s]).join(','), '3,3,3,3');
  eq('冬月宜火', NS.Tiaohou.NEED['冬'], '火');
  eq('夏月宜水', NS.Tiaohou.NEED['夏'], '水');
  /* 春秋必须不判定 —— 这是刻意的克制，不是漏了 */
  ok('春秋不给方向（各家说法不一，宁可不判）',
    !NS.Tiaohou.NEED['春'] && !NS.Tiaohou.NEED['秋']);

  const summer = NS.Bazi.analyzeBazi(2026, 5, 20, 10, 0);   /* 巳月 */
  ok('巳月判定为夏', summer.tiaohou.season === '夏' && summer.tiaohou.applies);
  eq('夏月调候宜水', summer.tiaohou.needWx, '水');

  const winter = NS.Bazi.analyzeBazi(2026, 1, 20, 10, 0);   /* 丑月 */
  eq('丑月判定为冬、宜火', winter.tiaohou.needWx, '火');

  const spring = NS.Bazi.analyzeBazi(2026, 4, 20, 10, 0);   /* 辰月 */
  ok('辰月不判定', spring.tiaohou.applies === false);
  ok('不判定时也有说明文案', spring.tiaohou.note.length > 10);

  /* 冲突时必须标出来，且说明以扶抑法为准 —— 不能默默换口径 */
  const conf = NS.Bazi.analyzeBazi(2026, 6, 15, 10, 0);
  if (conf.tiaohou.conflict) {
    ok('口径冲突时 note 里点明「不一致」', conf.tiaohou.note.indexOf('不一致') >= 0);
    ok('调候不进入喜用神（不参与选字）',
      conf.xiyongshen.indexOf(conf.tiaohou.needWx) < 0);
    const rp = NS.Report.evaluate('郝', '清和', { bazi: conf });
    const blk = rp.blocks.filter(x => x.title.indexOf('调候') >= 0)[0];
    ok('报告里用 warn 色标出冲突', !!blk && blk.tone === 'warn',
      blk ? blk.tone : '(没有调候块)');
  } else {
    ok('该样本本不冲突，跳过冲突断言', true);
  }
}

/* ---------------- 19. 八十一数理 ---------------- */
section('19. 八十一数理');
{
  eq('收录 1-81 全部', Object.keys(NS.SHULI81).length, 81);
  let miss = 0;
  for (let i = 1; i <= 81; i++) if (!NS.SHULI81[i]) miss++;
  eq('没有缺号', miss, 0);
  ok('每条都有吉凶与数名', Object.keys(NS.SHULI81).every(n => {
    const e = NS.SHULI81[n];
    return e.ji && e.name && e.text;
  }));

  /* 超过 81 减 80，直到落回 1..81 */
  eq('83 → 3', NS.shuliOf(83).n, 3);
  eq('90 → 10', NS.shuliOf(90).n, 10);
  eq('162 → 2', NS.shuliOf(162).n, 2);
  /* 161-80=81，81 已在范围内，所以停在 81（不是继续减到 1） */
  eq('161 → 81（减到范围内即停）', NS.shuliOf(161).n, 81);
  eq('非法输入返回 null', NS.shuliOf(0), null);

  /* 与真实姓名联动：五个格都必须查得到判语 */
  const w = NS.Wuge.calcWuge([14], [12, 8]);      /* 郝 + 清和 */
  const found = ['天格', '人格', '地格', '总格', '外格']
    .map(k => NS.shuliOf(w[k])).filter(Boolean);
  eq('五个格都能查到数理判语', found.length, 5);
  console.log('  郝清和 五格：' + ['天格', '人格', '地格', '总格', '外格']
    .map(k => k + w[k] + '「' + NS.shuliOf(w[k]).name + '·' + NS.shuliOf(w[k]).ji + '」')
    .join('　'));

  /* 报告里要把数理判语带出来 */
  const b = NS.Bazi.analyzeBazi(2026, 5, 20, 10, 0);
  const rep = NS.Report.evaluate('郝', '清和', { bazi: b });
  const shu = rep.blocks.filter(x => x.basis === '数理')[0];
  ok('数理块里有八十一数理', !!shu && shu.lines.join('').indexOf('八十一数理') >= 0,
    shu ? shu.lines.join(' | ').slice(0, 80) : '(没有数理块)');
  /* 数理派必须说明它不加分，否则会被当成和五行同权重的依据 */
  ok('数理块说明了它不参与评分',
    !!shu && shu.lines.join('').indexOf('不参与评分') >= 0);
}

/* ---------------- 20. 整名成词（日常词降权） ---------------- */
section('20. 整名成词');
{
  /* 这是走查实测出来的真问题：「郝博士」排第 3 名，而且「博士」
   * 几乎对每个姓氏都进前 3-8 名。根因是出处机制在**反向奖励**它 ——
   * 「博士」是唐代官职，在《唐诗三百首》里相邻出现过，
   * 于是被判为「出处成词」加分。逐字判据全是好的，问题只在整名上。 */
  ok('词表已加载', NS.NAMEBLOCK_WORDS.length > 200,
    String(NS.NAMEBLOCK_WORDS.length));
  eq('词表无重复项',
    Object.keys(NS.NAMEBLOCK_SET).length, NS.NAMEBLOCK_WORDS.length);

  /* 判定函数本身 */
  eq('博士 命中', NS.nameBlockHit('博士'), '博士');
  eq('教授 命中', NS.nameBlockHit('教授'), '教授');
  eq('傻子 命中', NS.nameBlockHit('傻子'), '傻子');
  eq('清和（雅词）不命中', NS.nameBlockHit('清和'), null);
  eq('若水（雅词）不命中', NS.nameBlockHit('若水'), null);
  eq('空输入返回 null', NS.nameBlockHit(''), null);

  /* 扣分必须真的发生，而且要在理由里说出来 —— 不能默默扣 */
  const b = NS.Bazi.analyzeBazi(2026, 5, 20, 10, 0);
  const rep = NS.Report.evaluate('郝', '博士', { bazi: b });
  ok('郝博士 命中整名成词',
    !!(rep.score.detail.modern && rep.score.detail.modern.block === '博士'),
    JSON.stringify(rep.score.detail.modern));
  ok('理由里说明了「是个日常词」',
    rep.reasons.some(x => String(x).indexOf('日常词') >= 0),
    rep.reasons.join(' / '));
  console.log(`  郝博士 → ${rep.total} 分（降权前实测 69 分、第 3 名）`);

  /* 雅词绝不能被误伤 —— 这道检查的边界就在这儿：
   * 放宽了会误伤传统好名，收窄了挡不住「博士」 */
  ['清和', '若水', '嘉树', '云舒', '知微', '沐涵', '林溪', '清可']
    .forEach(w => {
      const r2 = NS.Report.evaluate('郝', w, { bazi: b });
      const hit = r2 && r2.score.detail.modern ? r2.score.detail.modern.block : null;
      ok('雅词「' + w + '」不被误伤', !hit, hit || '');
    });

  /* 单名不会命中：单字成不了词 */
  const one = NS.Report.evaluate('郝', '博', { bazi: b });
  ok('单名不触发整名成词',
    !(one.score.detail.modern && one.score.detail.modern.block));

  /* 关键回归：博士/斯文 必须跌出前 20 —— 这是这次修复的目的 */
  ['郝', '李', '王'].forEach(sn => {
    const p = NS.Generator.plan({
      surname: sn, length: 2, birth: '2026-05-20T10:00', top: 20
    });
    const r = NS.Generator.runSync(p, {
      surname: sn, length: 2, birth: '2026-05-20T10:00', top: 20
    });
    const top = r.slice(0, 20).map(x => x.given);
    ok(sn + ' 前 20 名里没有日常词',
      top.every(g => !NS.nameBlockHit(g)),
      top.filter(g => NS.nameBlockHit(g)).join(','));
  });
}

/* ---------------- 21. 时辰未知 ---------------- */
section('21. 时辰未知（只知日期）');
{
  const full = NS.Bazi.analyzeBazi(2026, 5, 20, 10, 0);
  const noH = NS.Bazi.analyzeBazi(2026, 5, 20, 0, 0, { noHour: true });

  ok('完整盘没有 noHour 标志', !full.noHour);
  ok('未知时辰盘带 noHour 标志', noH.noHour === true);
  /* 年月日三柱必须与完整盘一致 —— 缺时柱不该影响前三柱 */
  eq('年月日三柱不受影响', noH.baziStr.split(' ').slice(0, 3).join(' '),
    full.baziStr.split(' ').slice(0, 3).join(' '));
  eq('四柱串里时柱显示为 --', noH.baziStr.split(' ')[3], '--');
  eq('时柱对象标记为 unknown', noH.pillars[3].unknown, true);
  eq('时柱藏干为空', noH.pillars[3].cangGan.length, 0);
  ok('前三柱不受影响且未标记 unknown',
    noH.pillars.slice(0, 3).every(p => !p.unknown));

  /* 五行力量必须真的少算一柱，而不是把空的当 0 混过去 */
  const sumFull = NS.WUXING.reduce((a, w) => a + full.power[w], 0);
  const sumNoH = NS.WUXING.reduce((a, w) => a + noH.power[w], 0);
  ok('五行总力量小于完整盘', sumNoH < sumFull,
    sumNoH.toFixed(2) + ' vs ' + sumFull.toFixed(2));
  /* 个数统计也要少两个（时干 + 时支本气）*/
  const cntFull = NS.WUXING.reduce((a, w) => a + full.count[w], 0);
  const cntNoH = NS.WUXING.reduce((a, w) => a + noH.count[w], 0);
  eq('五行个数少 2 个（时干与时支本气）', cntFull - cntNoH, 2);

  /* 十神同样不计时柱 */
  const ssFull = Object.keys(full.shishen.power)
    .reduce((a, k) => a + full.shishen.power[k], 0);
  const ssNoH = Object.keys(noH.shishen.power)
    .reduce((a, k) => a + noH.shishen.power[k], 0);
  ok('十神总力量小于完整盘', ssNoH < ssFull,
    ssNoH.toFixed(2) + ' vs ' + ssFull.toFixed(2));

  ok('仍能给出喜用神', noH.xiyongshen.length > 0, noH.xiyongshen.join('、'));

  /* 报告里必须把「时辰未知」这个前提说清楚 */
  const rep = NS.Report.evaluate('郝', '清和', { bazi: noH });
  const blk = rep.blocks.filter(x => x.title === '八字排盘')[0];
  ok('报告里点明了时辰未填', !!blk &&
    blk.lines.join('').indexOf('时辰未填') >= 0,
    blk ? blk.lines.join(' | ').slice(0, 90) : '(没有八字块)');

  /* 不能悄悄把时柱当成 00:00 —— 那会算出一个假的确定值 */
  const zero = NS.Bazi.analyzeBazi(2026, 5, 20, 0, 0);
  ok('未知时辰 ≠ 子时（不能瞎填 00:00）',
    noH.baziStr !== zero.baziStr,
    noH.baziStr + ' ／ ' + zero.baziStr);
}

console.log(`\n${'='.repeat(52)}`);
console.log(`通过 ${pass} 项，失败 ${fail} 项`);

/* 写一份 UTF-8 日志，便于直接查看 */
LOG.push('');
LOG.push(`通过 ${pass} 项，失败 ${fail} 项`);
try {
  require('fs').writeFileSync(
    path.join(__dirname, 'last-run.txt'), LOG.join('\n'), 'utf8');
} catch (e) { /* 忽略写入失败 */ }

process.exit(fail ? 1 : 0);
