/* =========================================================================
 * lexicon.test.js —— 联网词库相关逻辑的回归测试
 *
 * 覆盖的是最容易写错的部分：
 *   1. 拼音表 / 新华字典 的解析
 *   2. chinese-poetry 八种不同分卷结构（实测得来）的解析
 *   3. 繁体 → 简体 归一化
 *   4. 部首推断五行 / 康熙笔画估算
 *   5. 预置数据（打包固化）在新环境下的灌入
 *   6. 诗词库扩充后的检索正确性与「最短列表优先」优化
 *
 * 全部使用内联固件，不依赖网络，可离线重复运行。
 * 运行：node tests/lexicon.test.js
 * ========================================================================= */
'use strict';
const path = require('path');

const BASE = path.join(__dirname, '..', 'web', 'js');
[
  'data/chars-extra.js', 'data/chars.js', 'data/surnames.js', 'data/poetry.js',
  'data/homophone.js',
  'data/popularity.js', 'data/fanti.js', 'data/sources.js',
  'data/cities.js', 'data/sichuan.js', 'data/nickname.js', 'data/radicals.js',
  'data/radical-hints.js',
  'core/wuxing.js', 'core/calendar.js', 'core/bazi.js', 'core/wuge.js',
  'core/pinyin.js', 'core/poetry-lib.js', 'core/score.js', 'core/generator.js',
  'core/net.js', 'core/infer.js', 'core/dialect.js',
  'core/lexicon.js', 'core/radical.js', 'core/variant.js'
].forEach(f => require(path.join(BASE, f)));

const NS = globalThis.NS;

/* 预置数据必须在 store.js 之前挂上，模拟打包固化后的首次打开 */
NS.BAKED_DATA = {
  version: 1,
  meta: { lastSync: '2026-01-01T00:00:00.000Z' },
  pinyinMap: { '昶': { pinyin: 'chang', tone: 3 }, '璇': { pinyin: 'xuan', tone: 2 } },
  dict: {
    '昶': [9, '日', 'chǎng', '白天时间长'],
    '璇': [15, '王', 'xuán', '美玉']
  },
  customChars: [{
    char: '昶', pinyin: 'chang', tone: 3, wuxing: '火', gender: '中性',
    styles: ['古风'], meaning: '白天时间长，寓意舒展长久', strokes: 9,
    __inferred: { source: 'net', radical: '日' }
  }],
  poems: [
    { source: '固化测试', title: '其一', content: '昶日初升，璇玑在天。' }
  ]
};

require(path.join(BASE, 'core', 'store.js'));
require(path.join(BASE, 'core', 'lexicon.js'));
require(path.join(BASE, 'core', 'nickname.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (extra ? '  → ' + extra : '')); }
}
function eq(name, a, b) { ok(name, a === b, 'got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b)); }
function section(t) { console.log('\n' + t); }

const LOG = [];
const _log = console.log.bind(console);
console.log = function () {
  const line = Array.prototype.map.call(arguments, String).join(' ');
  LOG.push(line); _log(line);
};

/* ---------------- 1. 拼音解析 ---------------- */
section('1. 拼音表解析（mozillazg/pinyin-data 格式）');
{
  const fixture = [
    '# version: 0.15.0',
    'U+4E50: lè,yuè,yào  # 乐（多音字，只取第一读音）',
    'U+4E00: yī  # 一',
    'U+4E71: luàn  # 乱',
    'U+5F8B: lǜ  # 律',
    'U+3400: qiū  # 㐀（扩展A区，取名偶尔会用到，应收录）',
    'U+FF01: quán  # ！（全角标点，应被忽略）',
    'U+20000: x  # 𠀀（扩展B区，非BMP，应被忽略）'
  ].join('\n');
  const r = NS.Lexicon.parsePinyin(fixture);
  eq('收录数量（基本区4 + 扩展A1）', r.count, 5);
  eq('多音字取第一个读音', r.map['乐'].pinyin, 'le');
  eq('多音字声调取自第一读音', r.map['乐'].tone, 4);
  eq('单音字解析', r.map['一'].pinyin + r.map['一'].tone, 'yi1');
  eq('ü 韵母正确保留', r.map['律'].pinyin + r.map['律'].tone, 'lü4');
  eq('扩展A区被收录', r.map['㐀'] && r.map['㐀'].pinyin, 'qiu');
  ok('全角标点被过滤', r.map['！'] === undefined);
  ok('非BMP字符被过滤（系统按一字一码元处理）', r.map['𠀀'] === undefined);
}

section('1b. 声调拆分 stripTone');
[
  ['yī', 'yi', 1], ['lǜ', 'lü', 4], ['yi2', 'yi', 2],
  ['nv', 'nü', 0], ['lu:', 'lü', 0], ['de', 'de', 0]
].forEach(([input, plain, tone]) => {
  const r = NS.Pinyin.stripTone(input);
  ok(`${input} → ${r.plain}${r.tone}`, r.plain === plain && r.tone === tone,
    'got ' + r.plain + r.tone);
});

/* ---------------- 2. 字典解析 ---------------- */
section('2. 新华字典解析（pwxcoo/chinese-xinhua 格式）');
{
  const fixture = JSON.stringify([
    { word: '昶', oldword: '昶', strokes: '9', pinyin: 'chǎng',
      radicals: '日', explanation: '白天时间长。引申为舒展。', more: 'xxx' },
    { word: '璇', oldword: '璇', strokes: '15', pinyin: 'xuán',
      radicals: '王', explanation: '美玉。', more: 'xxx' },
    { word: '词条', oldword: '', strokes: '15', pinyin: 'cí tiáo',
      radicals: '讠', explanation: '多字词，应被过滤。', more: '' }
  ]);
  const r = NS.Lexicon.parseXinhua(fixture);
  eq('只收录单字', r.count, 2);
  ok('多字词条被过滤', r.map['词条'] === undefined);
  eq('简体笔画', r.map['昶'][0], 9);
  eq('部首', r.map['昶'][1], '日');
  eq('带调拼音', r.map['昶'][2], 'chǎng');
  ok('释义被清理', r.map['昶'][3].indexOf('白天时间长') === 0,
    r.map['昶'][3]);
}

/* ---------------- 3. 八种诗词结构 ---------------- */
section('3. 诗词解析：实测到的 8 种分卷结构都要能解析');

function parseFixture(json, name) {
  return NS.Lexicon.parsePoems(JSON.stringify(json), { name: name }).poems;
}

/* 注意：本节只验证「结构解析是否正确」，不做繁简转换的断言——
 * 那是第 4 节的事。这里刻意选取繁简同形的片段来断言，避免两件事耦合。 */
const shapes = [
  {
    label: '诗经式：{title, chapter, section, content:[str]}',
    name: '诗经',
    data: [{ title: '关雎', chapter: '国风', section: '周南',
      content: ['关关雎鸠，在河之洲。窈窕淑女，君子好逑。'] }],
    expect: { n: 1, title: '关雎', has: '窈窕淑女' }
  },
  {
    label: '论语式：{chapter, paragraphs:[str]}（无 title，用章节名当标题）',
    name: '论语',
    data: [{ chapter: '学而篇',
      paragraphs: ['子曰：学而时习之，不亦说乎？有朋自远方来，不亦乐乎？'] }],
    expect: { n: 1, title: '学而篇', has: '有朋自远方来' }
  },
  {
    label: '纳兰式：{title, para:[str], author}（键名是 para）',
    name: '纳兰性德词集',
    data: [{ title: '长相思·山一程', author: '纳兰性德',
      para: ['山一程，水一程，身向榆关那畔行，夜深千帐灯'] }],
    expect: { n: 1, title: '长相思·山一程', has: '夜深千帐灯' }
  },
  {
    label: '幽梦影式：{content: str, comment:[str]}（content 是字符串）',
    name: '幽梦影',
    data: [{ content: '读经宜冬，其神专也；读史宜夏，其时久也。',
      comment: ['曹秋岳曰：可想见其南面百城时。'] }],
    expect: { n: 1, title: '', has: '读经宜冬' }
  },
  {
    label: '唐诗三百首式：三层嵌套 {title, content:[{type, content:[{chapter, paragraphs}]}]}',
    name: '唐诗三百首',
    data: [{ title: '唐詩三百首', content: [
      { type: '五言絕句', content: [
        { chapter: '登鸛雀樓', subchapter: null, author: '王之渙',
          paragraphs: ['白日依山盡，黃河入海流。', '欲窮千里目，更上一層樓。'] }
      ] }
    ] }],
    /* 标题要取到最内层的 chapter，而不是最外层的书名 */
    expect: { n: 1, titleHas: '雀樓', has: '白日依山', authorHas: '王之' }
  },
  {
    label: '声律启蒙式：{title, author, abstract, content:[{title, content:[{chapter, paragraphs}]}]}',
    name: '声律启蒙',
    data: [{ title: '聲律啓蒙', author: '車萬育',
      abstract: '这是一段摘要说明文字，不应该被当成诗篇。',
      content: [{ title: '上卷', content: [
        { chapter: '一 東', paragraphs: ['雲對雨，雪對風，晚照對晴空。'] }
      ] }] }],
    expect: { n: 1, titleHas: '一', has: '晚照' }
  },
  {
    label: '水墨唐诗式：扁平数组 {author, title, paragraphs, prologue}',
    name: '水墨唐诗',
    data: [{ author: '刘禹锡', title: '蜀先主庙',
      paragraphs: ['天地英雄气，千秋尚凛然。'],
      prologue: '这是一段白话译文，不应混入正文。' }],
    expect: { n: 1, title: '蜀先主庙', has: '天地英雄气' }
  },
  {
    label: '宋词式：{author, paragraphs, rhythmic}（标题在 rhythmic）',
    name: '宋词',
    data: [{ author: '和岘', rhythmic: '导引',
      paragraphs: ['气和玉烛，睿化著鸿明。', '缇管一阳生。'] }],
    expect: { n: 1, title: '导引', has: '缇管一阳生' }
  }
];

shapes.forEach(s => {
  const poems = parseFixture(s.data, s.name);
  const p = poems[0] || {};
  ok(s.label, poems.length === s.expect.n,
    '解析出 ' + poems.length + ' 篇');
  if (!p.content) return;
  if (s.expect.title !== undefined) {
    eq('  ' + s.name + ' 标题', p.title, s.expect.title);
  }
  if (s.expect.titleHas) {
    ok('  ' + s.name + ' 标题取自最内层（含「' + s.expect.titleHas + '」）',
      p.title.indexOf(s.expect.titleHas) >= 0, p.title);
  }
  if (s.expect.authorHas) {
    ok('  ' + s.name + ' 作者传递正确',
      p.author.indexOf(s.expect.authorHas) >= 0, p.author);
  }
  ok('  ' + s.name + ' 正文含「' + s.expect.has + '」',
    p.content.indexOf(s.expect.has) >= 0, p.content.slice(0, 40));
  /* 译文/摘要不能混进正文 */
  ok('  ' + s.name + ' 未混入译文或摘要',
    p.content.indexOf('白话译文') < 0 && p.content.indexOf('摘要说明') < 0);
});

section('3b. 过短片段应被丢弃（但阈值不能高到把四字句蒙书整源丢掉）');
{
  const junk = parseFixture([{ chapter: 'x', paragraphs: ['短句。'] }], '测试');
  eq('3 字碎片被过滤', junk.length, 0);
  const mono = parseFixture([{ chapter: 'x', paragraphs: ['空'] }], '测试');
  eq('单字被过滤', mono.length, 0);
  const mengxue = parseFixture(
    [{ chapter: '天地玄黄', paragraphs: ['天地玄黄，宇宙洪荒。'] }], '千字文');
  eq('四字句蒙书被保留', mengxue.length, 1);
}

/* ---------------- 4. 繁体归一化 ---------------- */
section('4. 繁体 → 简体（否则繁体分卷永远匹配不到简体名字）');

section('4a. 内置表必须覆盖「字库用字的繁体形式」');
/* 这是内置表唯一必须保证的不变量：
 * 用户用繁体输入姓氏或必含字时，得能正确认出来。 */
[
  ['詩', '诗'], ['風', '风'], ['雲', '云'], ['夢', '梦'], ['葉', '叶'],
  ['蘇', '苏'], ['榮', '荣'], ['書', '书'], ['靜', '静'], ['錦', '锦'],
  ['陽', '阳'], ['遠', '远'], ['寧', '宁'], ['靈', '灵'], ['禮', '礼'],
  ['悅', '悦'], ['瀾', '澜'], ['濤', '涛'], ['鴻', '鸿'], ['鵬', '鹏'],
  ['鳴', '鸣'], ['學', '学'], ['賢', '贤'], ['興', '兴'], ['貝', '贝'],
  ['飛', '飞'], ['銳', '锐'], ['銘', '铭'], ['鐵', '铁'], ['劍', '剑'],
  ['楓', '枫'], ['蘊', '蕴'], ['簡', '简'], ['謙', '谦'], ['權', '权'],
  ['燦', '灿'], ['嵐', '岚'], ['聖', '圣'], ['優', '优'], ['維', '维']
].forEach(([fan, jian]) => {
  const got = NS.toSimplified(fan);
  eq(`「${fan}」→「${got}」`, got, jian);
});
ok('简体文本不会被误改', NS.toSimplified('白日依山尽') === '白日依山尽');

section('4b. 保护字：逐字转换会转错，必须原样保留');
[
  ['乾坤', '乾坤', '乾 不能被转成 干'],
  ['宫商角徵羽', '宫商角徵羽', '徵 不能被转成 征'],
  ['慰藉', '慰藉', '藉 不能被转成 借'],
  ['著名', '著名', '著 不能被转成 着'],
  ['沈约', '沈约', '沈 保留（只有「瀋」才转）']
].forEach(([input, want, note]) => {
  const got = NS.toSimplified(input);
  eq(`${note}：「${input}」`, got, want);
});
ok('保护名单已导出到 NS.FAN_JIAN_PROTECT', !!NS.FAN_JIAN_PROTECT['乾']);

section('4c. 合并联网繁简表后，覆盖面才完整');
{
  /* 内置表是精简的兜底；完整覆盖靠 OpenCC 的 TSCharacters 联网同步。
   * 这里模拟同步结果，验证合并后确实能转更多字。 */
  const before = ['窮', '對', '鶴', '尋', '衆', '層', '樓', '鸛'].map(NS.toSimplified);
  ok('合并前这些字转不了（漏匹配但不误转）',
    before.every((c, i) => c === ['窮', '對', '鶴', '尋', '衆', '層', '樓', '鸛'][i]),
    before.join(''));

  /* 故意让「乾」在表里指向「干」，验证保护名单会拦下来 */
  const added = NS.Lexicon.applyFanti({
    '窮': '穷', '對': '对', '鶴': '鹤', '尋': '寻', '衆': '众',
    '層': '层', '樓': '楼', '鸛': '鹳', '乾': '干'
  });
  ok('合并计入新增条数', added >= 8, 'added=' + added);
  ok('「乾」被保护名单拦下，未合并',
    NS.Lexicon.fantiSkipped >= 1 && NS.FAN_JIAN['乾'] === undefined);

  eq('合并后 窮→穷', NS.toSimplified('窮'), '穷');
  eq('合并后 衆裏尋他千百度 → 众里寻他千百度',
    NS.toSimplified('衆裏尋他千百度'), '众里寻他千百度');
  eq('合并后 登鸛雀樓 → 登鹳雀楼', NS.toSimplified('登鸛雀樓'), '登鹳雀楼');
  eq('保护字在合并后依然不被转换（乾坤）',
    NS.toSimplified('乾坤'), '乾坤');
}

section('4d. 诗篇解析时会做归一化');
{
  const poems = parseFixture(
    [{ title: '測試', content: ['白日依山盡，黃河入海流。'] }], '测试');
  const p = poems[0] || {};
  ok('正文已转简体', p.content === '白日依山尽，黄河入海流。', p.content);
  const t = parseFixture([{ title: '登鸛雀樓', content: ['晴空一鶴排雲上'] }], '测试');
  ok('合并表后连标题一起转', t[0] && t[0].title === '登鹳雀楼',
    t[0] && t[0].title);
}

/* ---------------- 5. 推断 ---------------- */
section('5. 五行与康熙笔画推断（无权威数据源，必须带置信度）');
[
  ['氵', '水'], ['木', '木'], ['火', '火'], ['钅', '金'], ['土', '土'],
  ['艹', '木'], ['竹', '木'], ['日', '火'], ['忄', '火'], ['月', '土'],
  ['贝', '金'], ['雨', '水'], ['鱼', '水'], ['马', '火']
].forEach(([r, wx]) => {
  const got = NS.Infer.inferWuxingByRadical(r);
  eq(`部首「${r}」→ ${got.wuxing}`, got.wuxing, wx);
});
{
  const unknown = NS.Infer.inferWuxingByRadical('龘');
  eq('未知部首返回 null 而不是瞎猜', unknown.wuxing, null);
  ok('未知部首给出说明', unknown.basis.indexOf('需人工指定') >= 0, unknown.basis);
}
[
  ['澜', '氵', 20, 21, '氵 +1，康熙 瀾 = 21'],
  ['芳', '艹', 7, 10, '艹 +3，康熙 芳 = 10'],
  ['诗', '讠', 8, 13, '讠 +5，康熙 詩 = 13'],
  ['铄', '钅', 12, 15, '钅 +3 得 15，但康熙 鑠 实为 23（整体简化的局限，所以必须提醒人工核对）']
].forEach(([ch, radical, simplified, want, note]) => {
  const r = NS.Infer.estimateKangxi(simplified, ch, radical);
  eq(`${ch}：简体 ${simplified} → ${r.strokes}（${note}）`, r.strokes, want);
  ok(`${ch} 的说明里带「人工核对」提醒`, r.basis.indexOf('人工核对') >= 0, r.basis);
});
{
  const r = NS.Infer.buildCharEntry('澜', { strokes: 20, radicals: '氵', explanation: '大波浪。' },
    { pinyin: 'lan', tone: 2 });
  eq('推断出五行', r.wuxing, '水');
  eq('拼音取拼音表', r.pinyin + r.tone, 'lan2');
  ok('带 __inferred 标记', !!r.__inferred);
  ok('带五行依据', r.__inferred.wuxingBasis.indexOf('部首') >= 0);
  ok('带笔画依据', r.__inferred.strokesBasis.length > 0);
}

section('5b. 「字本身就是部首」时不能加偏旁修正');
/* 单写「月」「王」时康熙笔画就是 4 画；只有作偏旁（朗、珠）才按肉部/玉部加。
 * 这是偏旁修正最容易被搞错的地方。 */
[
  ['月', 4, 4, '单写「月」= 4 画，不加'],
  ['王', 4, 4, '单写「王」= 4 画，不加'],
  ['珠', 10, 11, '「珠」的部首是王(玉部 5 画) → +1'],
  ['朗', 10, 12, '「朗」的部首是月(肉部 6 画) → +2']
].forEach(([ch, simplified, want, note]) => {
  const radical = { 月: '月', 王: '王', 珠: '王', 朗: '月' }[ch];
  const r = NS.Infer.estimateKangxi(simplified, ch, radical);
  eq(`${note}：${ch} ${simplified} → ${r.strokes}`, r.strokes, want);
});

/* ---------------- 6. 诗词扩充后的检索 ---------------- */
section('6. 诗词库扩充后的检索');
{
  const before = NS.Poetry.poems.length;
  const added = NS.Poetry.addPoems([
    { source: '扩充', title: '甲', content: '明月照高楼，流光正徘徊。' },
    { source: '扩充', title: '乙', content: '清泉石上流，明月松间照。' },
    { source: '扩充', title: '甲', content: '明月照高楼，流光正徘徊。' }   /* 重复 */
  ]);
  eq('重复诗篇被去重', added, 2);
  eq('诗篇总数增加', NS.Poetry.poems.length, before + 2);

  const hit = NS.Poetry.findSource(['明', '月', '高', '楼']);
  ok('能检索到扩充后的诗篇', !!hit, JSON.stringify(hit));
  eq('来源正确', hit && hit.source, '扩充');

  const miss = NS.Poetry.findSource(['龘', '靐']);
  eq('查不到就返回 null，不瞎编', miss, null);

  /* 记忆化：同一组合两次调用应返回相同结果 */
  const a = NS.Poetry.findSource(['明', '月']);
  const b = NS.Poetry.findSource(['月', '明']);
  eq('乱序查询走同一缓存且结果一致',
    a && a.source, b && b.source);
}
{
  /* 上万首诗时「最短列表优先」必须仍然正确 */
  const bulked = [];
  for (let i = 0; i < 3000; i++) {
    bulked.push({ source: '压测', title: 'p' + i, content: '山林水木火土金玉石田风力雨云' + i });
  }
  bulked.push({ source: '压测', title: 'rare',
    content: '曦光初照罕字相见' });
  NS.Poetry.addPoems(bulked);
  const t0 = Date.now();
  const hit = NS.Poetry.findSource(['曦', '罕']);
  const ms = Date.now() - t0;
  ok('四千首诗下仍能精确命中稀有组合', !!hit && hit.title === 'rare',
    JSON.stringify(hit));
  ok('单次查找在 50ms 内', ms < 50, ms + 'ms');
}

/* ---------------- 6b. 城市经纬度 ---------------- */
section('6b. 城市经纬度表（用于自动填经度做真太阳时）');
{
  ok('城市数量足够日常使用', NS.CITY_LIST.length >= 120, NS.CITY_LIST.length + ' 个');
  const lonOk = NS.CITY_LIST.every(c => c.longitude >= 73 && c.longitude <= 136);
  ok('经度都在中国范围内（73°E–136°E）', lonOk,
    NS.CITY_LIST.filter(c => c.longitude < 73 || c.longitude > 136)
      .map(c => c.name).join(','));
  eq('成都经度', NS.CITY_BY_NAME['成都'].longitude, 104.07);
  eq('北京经度', NS.CITY_BY_NAME['北京'].longitude, 116.41);
  eq('乌鲁木齐经度', NS.CITY_BY_NAME['乌鲁木齐'].longitude, 87.62);
  ok('每个城市都有省份', NS.CITY_LIST.every(c => !!c.province));

  ok('成都属西南官话区', NS.isSichuanArea('成都') === true);
  ok('重庆属西南官话区', NS.isSichuanArea('重庆') === true);
  ok('北京不属西南官话区', NS.isSichuanArea('北京') === false);
  ok('未知城市不误报', NS.isSichuanArea('不存在市') === false);

  const near = NS.cityByLongitude(104.0);
  ok('按经度反查城市能命中成都', near && near.name === '成都', near && near.name);
  ok('经度偏离太远时不返回城市', NS.cityByLongitude(100) === null ||
    Math.abs(NS.cityByLongitude(100).longitude - 100) <= 1.5);
}

/* ---------------- 6c. 四川话（蜀拼）检测 ---------------- */
section('6c. 四川话谐音检测');

/* 固件：一小张蜀拼字表。用真实数据要联网，这里验证的是逻辑本身。
 * 特意包含「心/星」同音、「范/统/彤」这类关键用字。 */
const SHUPIN_FIXTURE = [
  '范\tfan4', '统\ttong3', '彤\ttong1', '饭\tfan4', '桶\ttong3',
  '心\txin1', '星\txin1', '新\txin1', '金\tjin1', '京\tjin1',
  '吴\twu2', '无\twu2', '德\tde5', '得\tde5',
  '林\tlin2', '凌\tlin2', '冷\tlen3',
  '扯\tce3', '霍\tho2', '闪\tsan3',
  '李\tli3', '沐\tmu5', '涵\than2', '铁\ttie5'
].join('\n');

{
  const r = NS.Dialect.parseShupin(SHUPIN_FIXTURE);
  eq('蜀拼表解析条数', r.count, 24);
  eq('声母韵母分开存', r.map['范'].syllable + r.map['范'].tone, 'fan4');
  eq('入声标记为第 5 声', r.map['德'].tone, 5);
  eq('v 归一化为 ü', NS.Dialect.parseShupin('女\tnv3').map['女'].syllable, 'nü');

  NS.Dialect.applyShupin(r.map);
  ok('应用后可检测', NS.Dialect.available() === true);

  const syl = NS.Dialect.syllablesOf('范统');
  ok('能转出名字的四川话读音',
    !!syl && syl.map(s => s.raw).join(' ') === 'fan4 tong3',
    syl && syl.map(s => s.raw).join(' '));
  ok('有字缺读音时返回 null 而不是瞎凑',
    NS.Dialect.syllablesOf('范龘') === null);

  /* 前后鼻音归并：这是四川话检测的核心价值 */
  eq('心 与 星 在四川话里同音',
    NS.Dialect.syllablesOf('心')[0].syllable,
    NS.Dialect.syllablesOf('星')[0].syllable);
  eq('金 与 京 在四川话里同音',
    NS.Dialect.syllablesOf('金')[0].syllable,
    NS.Dialect.syllablesOf('京')[0].syllable);
  eq('林 与 凌 在四川话里声母韵母相同',
    NS.Dialect.syllablesOf('林')[0].syllable,
    NS.Dialect.syllablesOf('凌')[0].syllable);

  /* 负面词命中：饭桶 fan4 tong3 */
  const hit = NS.Dialect.check('范统');
  ok('范统 命中四川话负面词「饭桶」',
    hit.hits.length > 0 && hit.hits[0].word === '饭桶',
    JSON.stringify(hit.hits));
  ok('命中结果带声调相符度',
    hit.hits.length > 0 && hit.hits[0].severity === 1,
    hit.hits.length ? String(hit.hits[0].severity) : '(无)');

  /* 声调不同则不应误报：范彤 fan4 tong1 vs 饭桶 fan4 tong3 */
  const noHit = NS.Dialect.check('范彤');
  ok('范彤 不报「饭桶」（声调不符）',
    noHit.hits.every(h => h.word !== '饭桶'),
    JSON.stringify(noHit.hits));

  /* 入声（第 5 声）按通配处理：吴德 wu2 de5 vs 无德 wu2 de5 */
  const wude = NS.Dialect.check('吴德');
  ok('吴德 命中「无德」', wude.hits.some(h => h.word === '无德'),
    JSON.stringify(wude.hits.map(h => h.word)));

  /* 总是只提示、不淘汰 */
  ok('检测结果不提供「淘汰」字段，只给提示',
    wude.hits.every(h => h.level === 'vulgar' || h.level === 'bad'));

  /* 方言词汇匹配（非负面） */
  const fy = NS.Dialect.parseFangyan(
    '扯霍闪\tce3ho2san3\t打闪。\n打霜\tda3suang1\t降霜。\n乱行\t\t空行应跳过');
  eq('方言词汇解析条数', fy.count, 2);
  eq('方言词释义', fy.words[0].meaning, '打闪。');
  eq('方言词音节拆分', fy.words[0].syllables.join(' '), 'ce ho san');
  NS.Dialect.applyFangyan(fy.words);

  const fw = NS.Dialect.check('扯霍闪');
  ok('名字撞上方言词时会给出提示', fw.notes.length > 0,
    JSON.stringify(fw.notes));

  /* 不可用时要能优雅降级 */
  const saved = NS.Dialect.shupinMap;
  NS.Dialect.reset();
  const off = NS.Dialect.check('范统');
  ok('未同步蜀拼表时不报错、明确标记不可用',
    off.available === false && off.hits.length === 0);
  NS.Dialect.applyShupin(saved);
}

/* ---------------- 6d. 小名建议 ---------------- */
section('6d. 小名建议（从大名用字衍生）');
{
  const two = [NS.CHAR_DB['沐'], NS.CHAR_DB['涵']];
  const n1 = NS.Nickname.suggest(two, '李', {});
  ok('两个字的名字能给出小名', !!n1, JSON.stringify(n1 && n1.name));
  ok('小名用字来自大名', n1 && n1.name.indexOf('沐') >= 0 || n1.name.indexOf('涵') >= 0,
    n1 && n1.name);
  ok('叠字被优先考虑（最常见）', n1 && n1.pattern === 'repeat',
    n1 && (n1.pattern + ' / ' + n1.reasons.join('、')));
  ok('小名带拼音标注', !!(n1 && n1.pinyin), n1 && n1.pinyin);
  if (n1) console.log('  李沐涵 → 小名「' + n1.name + '」' + n1.pinyin +
    '（' + n1.patternLabel + '，' + n1.score + '分）');

  /* 亲切字应优于生硬字：涵 vs 铁 */
  const friendly = NS.Nickname.suggest([NS.CHAR_DB['涵']], '李', {});
  const harsh = NS.Nickname.suggest([NS.CHAR_DB['铁']], '李', {});
  ok('亲切字的小名得分高于生硬字',
    friendly && harsh && friendly.score > harsh.score,
    (friendly && friendly.score) + ' vs ' + (harsh && harsh.score));

  /* 有谐音风险的候选不能被当成首选 */
  const all = NS.Nickname.suggest(two, '李', {});
  ok('返回的小名自身谐音检查通过（或已标记风险）',
    !all || all.homophone.pass || all.risky === true,
    all && JSON.stringify({ pass: all.homophone.pass, risky: all.risky }));

  /* 姓氏连读也要查 */
  ok('会检查与姓氏连读的谐音',
    !!all && all.homophoneWithSurname !== null);

  /* 批量附加到结果上 */
  const items = [{ chars: ['沐', '涵'] }, { chars: ['若', '水'] }];
  const n = NS.Nickname.attach(items, { surname: '李', surnameSyllables: [] });
  eq('批量附加小名到每个结果', n, 2);
  ok('结果对象上确实挂上了小名', items.every(it => !!it.nickname));

  /* 空输入不应崩 */
  eq('空输入返回 null', NS.Nickname.suggest([], '李', {}), null);
  eq('未定义输入返回 null', NS.Nickname.suggest(null, '李', {}), null);
}

/* ---------------- 6e. 偏旁重复 ---------------- */
section('6e. 偏旁重复检测');
{
  const cov = NS.Radical.coverage();
  console.log(`  偏旁表覆盖内置字库 ${cov.covered}/${cov.total} 字`);
  ok('偏旁表覆盖面够用（≥60%）', cov.covered / cov.total >= 0.6,
    (cov.covered / cov.total * 100).toFixed(0) + '%');

  const r1 = NS.Radical.check('澜波');
  ok('两字同为氵能检出', r1.dupes.length === 1 && r1.dupes[0].name === '氵',
    JSON.stringify(r1.dupes));

  const r2 = NS.Radical.check('澜沐涵');
  eq('三字同偏旁只报一条', r2.dupes.length, 1);
  eq('条目里列出全部同偏旁字', r2.dupes[0].chars.join(''), '澜沐涵');

  const r3 = NS.Radical.check('梓楠');
  ok('木字旁也能检出', r3.dupes.length === 1 && r3.dupes[0].name === '木');

  eq('不同偏旁不报', NS.Radical.check('澜桐').dupes.length, 0);
  eq('同偏旁不同字也报', NS.Radical.check('澜清').dupes.length, 1);
  eq('单字不会自己跟自己重复', NS.Radical.check('澜').dupes.length, 0);

  /* 歧义字必须按传统部首归组，否则会造成误报 */
  eq('「梁」部首为木（不归氵）',
    NS.Radical.groupsOf('梁').map(g => g.name).join(','), '木');
  eq('「荣」部首为艹（不归木）',
    NS.Radical.groupsOf('荣').map(g => g.name).join(','), '艹');
  eq('「寒」部首为宀（不归冫）',
    NS.Radical.groupsOf('寒').map(g => g.name).join(','), '宀');
  eq('「霖」部首为雨（不归木）',
    NS.Radical.groupsOf('霖').map(g => g.name).join(','), '雨');
  eq('「蕾」部首为艹（不归雨）',
    NS.Radical.groupsOf('蕾').map(g => g.name).join(','), '艹');

  /* 表外的字（联网加入的）必须如实报告，不能猜 */
  const r6 = NS.Radical.check('昶澜');
  ok('表外字进入 unknown 而不是被猜',
    r6.unknown.indexOf('昶') >= 0, JSON.stringify(r6.unknown));

  ok('提示文案含偏旁与用字',
    NS.Radical.describe(r2).indexOf('氵') >= 0 &&
    NS.Radical.describe(r2).indexOf('澜') >= 0, NS.Radical.describe(r2));

  /* 同一个字出现在两个组会造成误报，必须杜绝 */
  const owner = Object.create(null);
  let dupCount = 0;
  NS.RADICAL_GROUPS.forEach(g => {
    for (const ch of g.chars) {
      if (owner[ch]) {
        dupCount++;
        console.log(`  ! 重复收录：${ch} 同时在「${owner[ch]}」与「${g.name}」`);
      }
      owner[ch] = g.name;
    }
  });
  eq('一个字不得同时归入两个偏旁组', dupCount, 0);

  /* 表里不能出现字库里没有的字（说明表是按真实字库写的，不是凭空编的） */
  const libSet = new Set(NS.CHAR_LIST.map(c => c.char));
  const ghosts = Object.keys(owner).filter(c => !libSet.has(c));
  eq('偏旁表里没有字库外的字', ghosts.length, 0, ghosts.join(''));

  /* 高频起名用字必须已归组，否则检测会静默漏报。
   * 「梓」是字库里的第一个字，当初就是漏了它——这条断言就是为它加的。 */
  const MUST_GROUP = ['梓', '楠', '森', '林', '澜', '沐', '涵', '萱', '瑞', '琪',
    '悦', '思', '念', '秋', '秀', '律', '德', '彤', '彦', '安', '宇',
    '峰', '铭', '锦', '心', '忆', '金', '水', '叶', '诗',
    /* 字库扩充后新增的高频字，同样不能漏。
     * 不列「航」「轩」—— 它们的部首（舟/车）在字库里没有第二个同族字，
     * 强行建一个只有一个字的分组永远不会触发，没有意义。 */
    '芝', '芳', '萌', '萍', '蓝', '瑜', '琳', '琦', '晨', '星',
    '宸', '翠', '翔', '浩', '温', '棠', '语', '诺'];
  /* 不在名单里但应该已归组的，单独报告一下，避免静默漏掉 */
  const SHOULD_GROUP = MUST_GROUP.concat(['菲', '茜', '荷', '蓉', '茗', '洲', '淇',
    '淳', '泠', '槿', '榆', '梵', '琬', '珩', '璇', '璐', '玥', '瑄', '琅',
    '旻', '晞']);
  const missingGroup = SHOULD_GROUP.filter(
    c => libSet.has(c) && NS.Radical.groupsOf(c).length === 0);
  eq('新增用字应当都已归入偏旁组', missingGroup.length, 0,
    '漏了：' + missingGroup.join(''));
  const ungrouped = MUST_GROUP.filter(
    c => libSet.has(c) && NS.Radical.groupsOf(c).length === 0);
  eq('高频起名用字必须已归组', ungrouped.length, 0,
    '漏了：' + ungrouped.join(''));

  /* 关键设计约束：**偏旁重复检测**只提示、不参与评分。
   * 偏旁表只覆盖字库里的常用字，若拿它扣分，会让「联网加字」暗中拉低分数。
   *
   * 注意别把约束写粗了：score.js 的 buildContext 里确实用了 NS.Radical，
   * 那是「避用部首」的硬排除（用户显式要求「不要草字头」），属于筛选不是扣分。
   * 所以要守的是 evaluate() 本体，而不是整个文件 —— 最初写成整文件断言，
   * 加避用部首功能时就误报了。 */
  const scoreSrc = require('fs').readFileSync(
    path.join(BASE, 'core', 'score.js'), 'utf8');
  const evStart = scoreSrc.indexOf('function evaluate(');
  const evEnd = scoreSrc.indexOf('function uniq(', evStart);
  const evSrc = (evStart >= 0 && evEnd > evStart)
    ? scoreSrc.slice(evStart, evEnd) : '';
  ok('evaluate() 本体不引用偏旁检测（偏旁重复不参与打分）',
    evSrc.length > 200 && evSrc.indexOf('Radical') < 0 && evSrc.indexOf('偏旁') < 0,
    'evaluate 片段长度 ' + evSrc.length);
  ok('避用部首走 buildContext 的硬排除，不是扣分',
    scoreSrc.indexOf('NS.Radical') >= 0 &&
    scoreSrc.indexOf('NS.Radical') < evStart,
    'NS.Radical 出现在 ' + scoreSrc.indexOf('NS.Radical') + '，evaluate 在 ' + evStart);
}

/* ---------------- 6f. 同音替换 ---------------- */
section('6f. 同音替换建议');
{
  const plan = NS.Generator.plan({
    surname: '李', length: 2, top: 12, xiyongshen: ['金', '水']
  });
  const res = NS.Generator.runSync(plan);
  /* 优先挑含「书」的样本——它正是「读音好但字被用滥」的典型 */
  const item = res.filter(r => r.chars.indexOf('书') >= 0)[0] || res[0];
  const groups = NS.Variant.forName(item, plan.ctx, { limit: 3 });

  console.log(`  样本：${item.name}（${item.score} 分），给出 ${groups.length} 组建议`);
  groups.forEach(g => {
    console.log(`    ${g.from}（热度 ${g.fromHeat ? g.fromHeat.value : '?'}）→ ` +
      g.options.map(o => `${o.char}(热度${o.heat.value} ${o.score}分 ` +
        `${o.delta >= 0 ? '+' : ''}${o.delta})`).join('  '));
  });

  ok('能给出同音替换建议', groups.length > 0);

  let samePinyin = true, selfRef = false, nameOk = true;
  groups.forEach(g => {
    const target = NS.CHAR_DB[g.from];
    g.options.forEach(o => {
      if (o.pinyin !== target.pinyin) samePinyin = false;
      if (o.char === g.from) selfRef = true;
      if (o.name.indexOf(o.char) < 0) nameOk = false;
      if (item.chars.indexOf(o.char) >= 0) selfRef = true;   /* 不能换成名字里已有的字 */
    });
  });
  ok('替换字与原名读音相同（忽略声调）', samePinyin);
  ok('不会把原字或名中已有的字推荐回来', !selfRef);
  ok('给出的新名字确实用上了替换字', nameOk);

  /* 硬性过滤：换字后若撞上新谐音，该候选必须被丢弃 */
  let noBad = true;
  groups.forEach(g => {
    g.options.forEach(o => {
      const swapped = item.chars.map(c => (c === g.from) ? o.char : c);
      const ev = NS.Score.evaluate(swapped.map(c => NS.CHAR_DB[c]), plan.ctx);
      if (!ev.detail.homophone.pass) noBad = false;
    });
  });
  ok('推荐出来的组合都不触发谐音拦截', noBad);

  /* 排序：同声调优先 */
  const first = groups[0].options;
  ok('同声调的候选排在更前面', first[0].sameTone === true,
    first[0].char + ' tone=' + first[0].tone);
  /* 排序：同声调 + 同五行的前提下，热度更低的排在前面 */
  let heatOrder = true;
  groups.forEach(g => {
    for (let i = 1; i < g.options.length; i++) {
      const a = g.options[i - 1], b = g.options[i];
      if (a.sameTone === b.sameTone && a.sameWuxing === b.sameWuxing &&
        a.heat.value > b.heat.value) heatOrder = false;
    }
  });
  ok('同条件下热度更低者优先（这正是换字的目的）', heatOrder);

  /* 没有同音字时不应报错 */
  const none = NS.Variant.forName({ chars: ['亍'], name: '李亍', score: 1 }, plan.ctx, { limit: 3 });
  eq('没有同音字时安静返回空', none.length, 0);
}

/* ---------------- 6g. 词库外的同音字 ---------------- */
section('6g. 词库外同音字（联网拼音表）');
{
  /* 这两个是「测试用」字：人为塞进热度表，模拟「热度表认得、但字库没有」。
   * 不能依赖真实数据里还剩几个这样的字 —— 字库补齐后会是 0 个，
   * 用例就会失败在「数据」上而不是「逻辑」上（补齐最后一个缺字「蓝」时就踩到了）。 */
  const OUT_A = '昶', OUT_B = '翀';
  ok('测试用字确实不在字库里（前提成立）',
    !NS.CHAR_DB[OUT_A] && !NS.CHAR_DB[OUT_B],
    OUT_A + '/' + OUT_B);
  NS.HEAT[OUT_A] = 60;
  NS.HEAT[OUT_B] = 65;

  /* 顺带如实报告：热度表里的起名用字还有多少没进字库 */
  const stillOut = Object.keys(NS.HEAT)
    .filter(ch => !NS.CHAR_DB[ch] && /^[\u4e00-\u9fff]$/.test(ch));
  console.log('  热度表里仍未进字库的起名用字：' + stillOut.length + ' 个' +
    (stillOut.length ? '（' + stillOut.join('') + '）' : ' —— 已全部收录'));

  eq('未同步拼音表时外层为空',
    NS.Variant.outerCandidates(NS.CHAR_DB['书'], []).length, 0);

  /* 造拼音表：OUT_A / OUT_B 挂到 shu 上；
   * 澍 / 疋 / 鲭 是**热度表不认得**的字，必须被门槛挡掉。 */
  const pyFixture = {}, dictFixture = {};
  pyFixture[OUT_A] = { pinyin: 'shu', tone: 1 };
  pyFixture[OUT_B] = { pinyin: 'shu', tone: 4 };
  pyFixture['澍'] = { pinyin: 'shu', tone: 4 };
  pyFixture['疋'] = { pinyin: 'shu', tone: 1 };
  pyFixture['鲭'] = { pinyin: 'qing', tone: 1 };
  dictFixture[OUT_A] = [10, '氵', 'shū', '测试释义 A'];
  dictFixture[OUT_B] = [13, '氵', 'shù', '测试释义 B'];
  dictFixture['澍'] = [15, '氵', 'shù', '及时雨'];
  dictFixture['疋'] = [5, '疋', 'shū', '同「匹」'];
  dictFixture['鲭'] = [19, '鱼', 'qīng', '鲭鱼'];
  NS.Lexicon.applyPinyin(pyFixture);
  NS.Lexicon.applyDict(dictFixture);

  /* 索引是带缓存的，必须靠 dataVersion 失效，否则同步完仍推荐不出字 */
  const v0 = NS.Lexicon.dataVersion;
  NS.Lexicon.applyPinyin({ '杼': { pinyin: 'zhu', tone: 4 } });
  ok('写入拼音表会推进数据版本号', NS.Lexicon.dataVersion > v0);

  const inner = NS.Variant.candidates(NS.CHAR_DB['书'], []);
  const out = NS.Variant.outerCandidates(NS.CHAR_DB['书'], []);
  console.log(`  书 → 内层 ${inner.length} 个（${inner.map(o => o.char).join('')}），` +
    `外层 ${out.length} 个（${out.map(o => o.char).join(' ')}）`);

  ok('外层能找到字库外的同音字', out.length >= 2, out.map(o => o.char).join(''));
  ok('外层候选全部标记为推断', out.every(o => o.approx === true));
  ok('字库内的字不会重复出现在外层', out.every(o => !NS.CHAR_DB[o.char]));
  ok('外层只取同音字', out.every(o => o.pinyin === 'shu'),
    out.map(o => o.pinyin).join(','));
  eq('外层同声调的排前面', out[0].sameTone, true);

  /* 关键门槛：只推荐热度表认得的字。
   * 不设这个门，拼音表里两万字都会进来，实测会把「儖」（异体字）
   * 和「鲭」（鱼名）推给用户——生僻字拿的是「默认热度」，
   * 看上去反而像「很冷门」，会被排到前面，比不给建议更糟。 */
  ok('热度表不认得的字一律不推荐',
    out.every(o => o.heatKnown === true),
    out.map(o => o.char + (o.heatKnown ? '' : '(不认识)')).join(' '));
  ok('异体字「澍」被挡在外面', out.every(o => o.char !== '澍'));
  ok('生僻字「疋」被挡在外面', out.every(o => o.char !== '疋'));
  ok('鱼名「鲭」不会被当成清的同音替换',
    NS.Variant.outerCandidates(NS.CHAR_DB['清'], [])
      .every(o => o.char !== '鲭'));

  const aOpt = out.filter(o => o.char === OUT_A)[0];
  ok('外层五行按部首推断（字典部首 氵 → 水）', aOpt && aOpt.wuxing === '水',
    aOpt ? aOpt.wuxing : '(缺)');
  /* 字典里的 10 是简体笔画，康熙笔画要加上部首增量：氵 → 水 多 1 画，所以是 11。
   * 这条断言同时锁住「字典只给简体、康熙靠推断」这个事实。 */
  ok('外层笔画 = 字典简体 10 + 氵部首增量 1 = 康熙 11',
    aOpt && aOpt.strokes === 11, aOpt ? String(aOpt.strokes) : '(缺)');

  /* 整名替换：内层（分数可靠）必须排在外层之前 */
  const plan = NS.Generator.plan({ surname: '李', length: 2, top: 12 });
  const item = { name: '李书云', chars: ['书', '云'], score: 70 };
  const groups = NS.Variant.forName(item, plan.ctx, { limit: 1, outerLimit: 2 });
  const g0 = groups.filter(g => g.from === '书')[0];
  ok('整名替换会混入外层建议', !!(g0 && g0.hasApprox));
  if (g0) {
    console.log('  书 → ' + g0.options.map(o =>
      o.char + (o.approx ? '*(推断)' : '') + ' ' + o.score + '分').join('  '));
    const iIdx = g0.options.findIndex(o => !o.approx);
    const oIdx = g0.options.findIndex(o => o.approx);
    ok('可靠建议排在外层（推断）建议之前',
      iIdx >= 0 && iIdx < oIdx, g0.options.map(o =>
        o.char + (o.approx ? '*' : '')).join(' '));
    ok('外层建议也算出了参考分',
      g0.options.filter(o => o.approx).every(o => o.score > 0));
    ok('新名字确实用上了替换字',
      g0.options.every(o => o.name.indexOf(o.char) >= 0));
  }
}

/* ---------------- 6h. 部首偏好 ---------------- */
section('6h. 部首偏好（选偏旁限定用字）');
{
  const list = NS.Radical.pickerList();
  console.log('  可选部首 ' + list.length + ' 个，前 8：' +
    list.slice(0, 8).map(x => x.name + '(' + x.count + ')').join(' '));
  ok('部首候选表非空', list.length > 5);
  ok('候选表按字库内字数降序',
    list.every((x, i) => i === 0 || list[i - 1].count >= x.count));
  ok('每个候选都标了字库内字数', list.every(x => x.count > 0));
  ok('「艹」在候选中且字数不少', list.some(x => x.name === '艹' && x.count >= 30));

  /* 用户点名的走之底：原来字库里只有 2 个字，做成选项没意义，已补到 10 个以上 */
  const zouzhi = NS.Radical.charsOf('辶');
  console.log('  走之底：' + zouzhi.length + ' 字 ' + zouzhi.join(''));
  ok('走之底至少 8 个字可供选择', zouzhi.length >= 8, zouzhi.join(''));

  ok('matchAny 能识别单字所属部首',
    NS.Radical.matchAny('芝', ['艹']) === true &&
    NS.Radical.matchAny('芝', ['氵']) === false);
  ok('matchAny 支持多个部首任选',
    NS.Radical.matchAny('芝', ['氵', '艹']) === true);
  ok('认不出不存在的部首名', NS.Radical.isValidName('不存在的部首') === false);

  /* 五行→部首表现在是**从字库实时推导**的（以前硬编码，硬编码版本会推荐
   * 「喜用神土 → 单人旁」，而字库里单人旁 44% 是土、33% 是金，站不住脚）。
   * 断言两件事：①按阈值筛出来的组确实达标；②几个公认的映射必须存在。 */
  const wxMap = NS.Radical.wuxingMap();
  const wxRows = [];
  Object.keys(wxMap).forEach(wx => wxMap[wx].forEach(x => wxRows.push({ wx, ...x })));
  console.log('  五行→部首推导结果：' + Object.keys(wxMap).map(wx =>
    wx + ':' + wxMap[wx].map(x => x.name + '(' + Math.round(x.share * 100) + '%)').join('/')
  ).join('  '));
  ok('推导出的每个部首组，主导五行占比都 ≥90%',
    wxRows.length > 0 && wxRows.every(x => x.share >= 0.9),
    wxRows.filter(x => x.share < 0.9).map(x => x.name + '=' + x.share).join(','));
  ok('每个推导项都带样本数，避免小组凭运气达标',
    wxRows.every(x => x.n > 0));
  const mustHave = [['水', '氵'], ['木', '艹'], ['木', '木'], ['金', '钅'], ['火', '日']];
  const wxNames = {};
  Object.keys(wxMap).forEach(wx => { wxNames[wx] = wxMap[wx].map(x => x.name); });
  ok('公认映射存在（氵→水、艹→木、钅→金、日→火）',
    mustHave.every(([w, r]) => wxNames[w] && wxNames[w].indexOf(r) >= 0),
    JSON.stringify(wxNames));
  /* 混杂的分组不能被推荐出去 */
  ok('混杂分组不会被推荐（亻/宀/口/忄 至少不在土与火的推荐里）',
    !(wxNames['土'] || []).includes('宀') &&
    !(wxNames['土'] || []).includes('亻') &&
    !(wxNames['火'] || []).includes('忄'),
    '土=' + (wxNames['土'] || []).join('/') + ' 火=' + (wxNames['火'] || []).join('/'));

  /* NS.WUXING_RADICALS 是 wuxingMap 的便捷视图，两者必须一致 */
  ok('NS.WUXING_RADICALS 与 wuxingMap 一致',
    NS.WUXING_RADICALS && NS.WUXING_RADICALS['水'].indexOf('氵') >= 0 &&
    NS.WUXING_RADICALS['金'].indexOf('钅') >= 0,
    JSON.stringify(NS.WUXING_RADICALS && NS.WUXING_RADICALS['水']));

  /* 生肖表只能引用真实存在的部首，且界面上要标明是民俗 */
  const zoBad = [];
  Object.keys(NS.ZODIAC_RADICALS).forEach(z => {
    NS.ZODIAC_RADICALS[z].forEach(name => {
      if (!NS.Radical.isValidName(name)) zoBad.push(z + '→' + name);
    });
  });
  ok('生肖→部首表只引用真实存在的部首', zoBad.length === 0, zoBad.join('、'));

  /* --- 真正参与生成 --- */
  const base = { surname: '李', length: 2, top: 8 };

  const zou = NS.Generator.runSync(NS.Generator.plan(
    Object.assign({ preferRadicals: ['辶'] }, base)));
  console.log('  限定走之底 → ' + zou.map(r => r.name).join(' '));
  ok('限定「走之底」时结果非空', zou.length > 0);
  ok('每个结果都含走之底的字',
    zou.every(r => r.chars.some(c => NS.Radical.matchAny(c, ['辶']))),
    zou.map(r => r.name).join(' '));

  const two = NS.Generator.runSync(NS.Generator.plan(
    Object.assign({ preferRadicals: ['艹', '氵'] }, base)));
  ok('多个部首任选其一也生效',
    two.every(r => r.chars.some(c => NS.Radical.matchAny(c, ['艹', '氵']))),
    two.map(r => r.name).join(' '));

  const allMust = NS.Generator.runSync(NS.Generator.plan(
    Object.assign({ preferRadicals: ['艹'], radicalMode: 'all' }, base)));
  console.log('  要求每个字都带艹 → ' + allMust.map(r => r.name).join(' '));
  ok('「每个字都要带」模式下两个字都有该部首',
    allMust.length > 0 &&
    allMust.every(r => r.chars.every(c => NS.Radical.matchAny(c, ['艹']))),
    allMust.map(r => r.name).join(' '));

  const avoided = NS.Generator.runSync(NS.Generator.plan(
    Object.assign({ avoidRadicals: ['艹'] }, base)));
  console.log('  避用草字头 → ' + avoided.slice(0, 6).map(r => r.name).join(' '));
  ok('避用部首是硬排除，一个字都不出现',
    avoided.length > 0 &&
    avoided.every(r => r.chars.every(c => !NS.Radical.matchAny(c, ['艹']))),
    avoided.map(r => r.name).join(' '));

  /* 不设偏好时行为与以前一致（不该凭空少结果） */
  const plain = NS.Generator.runSync(NS.Generator.plan(base));
  ok('未设部首偏好时结果不受影响', plain.length === base.top);

  /* 联网字典未同步时，部首找字要如实说「不可用」，不能假装有结果。
   * 这里必须连 dictCount 一起置 0 —— ensureLoaded() 之后 dict 是**空对象**而非 null，
   * 只把 dict 置 null 是测不出这个 bug 的（实测漏过一次，界面上报的是
   * 「字典里没找到这个部首」而不是「还没同步字典」，把用户往错误方向引）。 */
  const savedDict = NS.Lexicon.dict;
  NS.Lexicon.dict = Object.create(null);   /* dictCount 由它算出来，会跟着变 0 */
  const q0 = NS.Radical.fromDict('辶');
  NS.Lexicon.dict = savedDict;
  ok('未同步字典时 fromDict 标记为不可用',
    q0.available === false && q0.items.length === 0,
    JSON.stringify(q0).slice(0, 60));

  /* 造一份字典夹具，验证按部首反查（字典的部首字段用传统部首字：辵 而非 辶） */
  NS.Lexicon.applyDict({
    '迤': [10, '辵', 'yǐ', '（形声。从辵，也声）曲折连绵'],
    '迢': [8, '辵', 'tiáo', '遥远'],
    '蓬': [13, '艹', 'péng', '蓬草']
  });
  NS.Lexicon.applyPinyin({
    '迤': { pinyin: 'yi', tone: 3 },
    '迢': { pinyin: 'tiao', tone: 2 }
  });
  const q1 = NS.Radical.fromDict('辶');
  console.log('  按走之底查字典 → ' + q1.items.map(x => x.char).join(' ') +
    '（可用 ' + q1.available + '）');
  ok('字典里用传统部首「辵」也能被「辶」查到',
    q1.items.some(x => x.char === '迤') && q1.items.some(x => x.char === '迢'),
    q1.items.map(x => x.char).join(''));
  ok('查出来的候选带齐笔画/拼音/释义',
    q1.items.every(x => x.strokes > 0 && x.meaning && x.radical));
  /* 字典释义常以「（形声。从辵…）」开头，占满界面且对选字没帮助，要去掉 */
  const yiItem = q1.items.filter(x => x.char === '迤')[0];
  ok('释义头部的六书说明被去掉',
    yiItem && yiItem.meaning.indexOf('形声') < 0 &&
    yiItem.meaning.indexOf('曲折连绵') >= 0,
    yiItem ? yiItem.meaning : '(缺)');
  ok('不相关的部首不会被带进来',
    q1.items.every(x => x.char !== '蓬'));
  /* 只同步字典、没同步拼音表时，候选也必须被正确判为「适合」。
   * 字典自己带拼音（d[2]），早期版本却要求拼音表里也有这个字，
   * 实测导致 0/92 全部被划成不适合。
   * 注意这段必须放在字典夹具**之后** —— 放到前面就是在测空字典。 */
  const dictOnly = NS.Radical.fromDict('辶');
  const suitableN = dictOnly.items.filter(x => x.suitable).length;
  console.log('  只看字典（无拼音表）→ ' + dictOnly.items.length +
    ' 个候选，其中 ' + suitableN + ' 个笔画适中');
  ok('只有字典时也能判定「适合起名」', suitableN > 0,
    suitableN + '/' + dictOnly.items.length);
  ok('候选都带上了字典提供的拼音',
    dictOnly.items.every(x => !!x.pinyin));

  /* 已经在字库里的字不该再列一遍，否则用户会重复入库 */
  ok('字库里已有的字不重复列出',
    NS.Radical.fromDict('艹').items.every(x => !NS.CHAR_DB[x.char]));
}

/* ---------------- 7. 预置数据灌入 ---------------- */
section('7. 打包固化的预置数据（模拟新电脑首次打开）');
(async function () {
  await NS.Store.ready;
  const backend = NS.Store.getBackend();
  console.log('  当前存储后端：' + backend + '（Node 环境无 IndexedDB，走降级路径）');

  /* 关键：必须调用 restore() 才会把持久化/预置数据装进运行时。
   * 浏览器里由 SyncUI.init / app.boot 调用。 */
  await NS.Lexicon.restore();

  const st = NS.Lexicon.status();
  ok('预置拼音表已灌入', st.pinyinCount >= 2, 'pinyinCount=' + st.pinyinCount);
  ok('预置字典已灌入', st.dictCount >= 1, 'dictCount=' + st.dictCount);
  ok('预置自建字已灌入', st.customChars >= 1, 'customChars=' + st.customChars);
  ok('预置诗篇已灌入（且确实是固化那首）',
    NS.Poetry.poems.some(p => p.source === '固化测试' && p.content.indexOf('昶日初升') >= 0),
    '共 ' + NS.Poetry.poems.length + ' 首');

  const baked = NS.CHAR_DB['昶'];
  ok('固化字已进入字库', !!baked);
  if (baked) {
    eq('固化字五行', baked.wuxing, '火');
    eq('固化字笔画', baked.strokes, 9);
    eq('固化字拼音', baked.pinyin + baked.tone, 'chang3');
  }

  /* 固化字能真正参与取名 */
  const plan = NS.Generator.plan({
    surname: '李', length: 2, top: 5, mustInclude: ['昶']
  });
  const res = NS.Generator.runSync(plan);
  ok('固化字能参与取名且「必含」生效',
    res.length > 0 && res.every(r => r.chars.indexOf('昶') >= 0),
    res.map(r => r.name).join(',') || '(无结果)');
  if (res[0]) console.log('  示例：' + res[0].name + ' ' + res[0].pinyin +
    ' ' + res[0].score + '分');

  /* 未同步字典时查询应给出明确指引，而不是静默失败 */
  const lookHit = NS.Lexicon.lookupChar('璇');   /* 固化的字典里有这个字 */
  ok('字典里有该字时能查到', lookHit.missing !== true, JSON.stringify(lookHit.missing));
  eq('查到的五行按部首推断', lookHit.wuxing, '土');   /* 王(玉部) → 土 */
  const lookNone = NS.Lexicon.lookupChar('龘');
  ok('查不到时返回 missing 标记', lookNone.missing === true);

  /* 推断字的五行与笔画都不可靠，不该被推荐去替换一个已经确定的好字 */
  ok('固化的推断字确实带上了 __inferred 标记',
    !!(NS.CHAR_DB['昶'] && NS.CHAR_DB['昶'].__inferred));
  const alt = NS.Variant.candidates(NS.CHAR_DB['璇'] || NS.CHAR_DB['昶'], []);
  ok('推断字不进入同音替换建议',
    alt.every(o => !o.obj.__inferred),
    alt.map(o => o.char).join('') || '(无候选)');

  /* 清空后应回到内置状态，且保护名单里的字不能残留 */
  await NS.Lexicon.reset();
  const after = NS.Lexicon.status();
  eq('清空后自建字归零', after.customChars, 0);
  eq('清空后诗词回到内置篇数', after.poems, NS.Poetry.builtinCount);
  ok('清空后字库里不再有固化字', !NS.CHAR_DB['昶']);
  eq('清空后繁简表回到内置状态（保护字未残留）',
    NS.toSimplified('乾坤'), '乾坤');

  console.log('\n' + '='.repeat(52));
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  LOG.push('', `通过 ${pass} 项，失败 ${fail} 项`);
  try {
    require('fs').writeFileSync(
      path.join(__dirname, 'lexicon-last-run.txt'), LOG.join('\n'), 'utf8');
  } catch (e) { /* 忽略 */ }
  process.exit(fail ? 1 : 0);
})();
