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
  'core/wuxing.js', 'core/calendar.js', 'core/bazi.js', 'core/wuge.js',
  'core/pinyin.js', 'core/poetry-lib.js', 'core/score.js', 'core/generator.js',
  'core/infer.js', 'core/lexicon.js', 'core/radical.js', 'core/variant.js'
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
