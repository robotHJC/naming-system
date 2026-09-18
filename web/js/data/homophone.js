/* =========================================================================
 * homophone.js —— 谐音 / 不雅用字数据
 *
 * 数据格式：'拼音+声调|拼音+声调=谐音词'，声调 0 或 5 表示「任意调 / 轻声」通配。
 *
 * 为什么必须带声调：
 *   Python 原版用「拼音子串包含」判断，会把「李诗涵」(li-shi-han) 判成含 "shi"、
 *   把「李枫」判成含 "feng" 而直接淘汰，误杀大量好名字。
 *   只比对音节序列仍不够——「李思琪」(si1 qi2) 会被当成「死气」(si3 qi4)。
 *   加上声调后：「范统」(fan4 tong3) 仍能命中「饭桶」(fan4 tong3)，
 *   而「范彤」(fan4 tong2)、「李思琪」「杨威」这些正常名字不会再被误杀。
 *
 * 匹配度（severity）= 音节中声调相符的比例：
 *   severity = 1      → 判定为谐音（BLOCK 表直接淘汰，SOFT 表仅提示）
 *   severity ≥ 0.6 且音节数 ≥ 3 → 仅提示
 *   其余              → 忽略
 * 谐音本身带有主观性，所以这里遵循「宁可提示、不可误杀」的保守原则。
 * ========================================================================= */
(function (global) {
  'use strict';
  var NS = (global.NS = global.NS || {});

  /* ---- 1. 字面不雅字（直接出现在姓名中即拦截） ---- */
  NS.BAD_CHARS = ('死屎尿病毒穷蠢笨傻呆疯癫残废凶恶祸灾霉衰龟鳖蛋屁粪尸鬼妖魔邪'
    + '淫娼嫖赌贼盗匪寇丧亡妓贱乞丐殡棺墓囚牢狱刑斩剁'
    + '丑陋卑劣耻辱骂吵闹哭泣愁苦难惨血腥臭腐烂蛆疮癌瘫')
    .split('');

  /* ---- 2. 拦截级谐音（真不雅 / 凶险，且不太可能与好名字撞车） ---- */
  NS.BAD_SEQUENCES_RAW = [
    'wu2|de2=无德',
    'wu2|qing2=无情',
    'wu2|neng2=无能',
    'si3|wang2=死亡',
    'si3|shi1=死尸',
    'si3|lu4=死路',
    'bai2|chi1=白痴',
    'bai2|dai4=白带',
    'fan4|tong3=饭桶',
    'qin2|shou4=禽兽',
    'chu4|sheng5=畜生',
    'dong4|wu5=动物',
    'sha3|zi5=傻子',
    'sha3|gua1=傻瓜',
    'sha3|bi1=傻逼',
    'sha3|mao4=傻帽',
    'ben4|dan4=笨蛋',
    'ben4|zhu1=笨猪',
    'chun3|zhu1=蠢猪',
    'chun3|huo4=蠢货',
    'dai1|zi5=呆子',
    'feng1|zi5=疯子',
    'feng1|gou3=疯狗',
    'er4|bi1=二逼',
    'er4|huo4=二货',
    'dou4|bi1=逗比',
    'fei4|wu4=废物',
    'can2|fei4=残废',
    'ruo4|zhi4=弱智',
    'nao3|can2=脑残',
    'bian4|tai4=变态',
    'se4|lang2=色狼',
    'liu2|mang2=流氓',
    'e4|gun4=恶棍',
    'wang2|ba1=王八',
    'gou3|dan4=狗蛋',
    'zhu1|tou2=猪头',
    'zhu1|nao3=猪脑',
    'niu2|fen4=牛粪',
    'fen4|bian4=粪便',
    'niao4|su4=尿素',
    'niao4|ye4=尿液',
    'qiong2|dan4=穷蛋',
    'qi3|gai4=乞丐',
    'nu2|cai2=奴才',
    'nu2|li4=奴隶',
    'yao1|mo2=妖魔',
    'gui3|zi5=鬼子',
    'huo4|huan4=祸患',
    'zai1|nan4=灾难',
    'zao1|nan4=遭难',
    'wan2|gu4=亡故',
    'sang1|ming4=丧命',
    'sang4|shi1=丧失',
    'san1|ba1=三八',
    'ma3|huang2=蚂蟥',
    'yang2|wei3=阳痿',
    'zao3|xie4=早泄',
    'ji4|nv3=妓女',
    'du2|qi4=毒气',
    'du2|yao4=毒药',
    'la1|ji1=垃圾',
    'shen1|bing4=生病',
    'jue2|wang4=绝望',
    'liu2|lang4=流浪',
    'fan4|zui4=犯罪',
    'qi2|tu2=歧途',
    'huang2|quan2=黄泉',
    'yin1|jian1=阴间',
    'chu1|bin4=出殡',
    /* 三字：姓 + 双字名 连读，最经典的谐音笑话 */
    'shi3|zhen1|xiang1=屎真香',
    'du4|zi5|teng2=肚子疼',
    'zhu1|yi1|qun2=猪一群',
    'gui3|men2|guan1=鬼门关'
  ];

  /* ---- 2b. 提示级谐音（偏负面 / 容易被取笑，但不淘汰） ---- */
  NS.SOFT_SEQUENCES_RAW = [
    'wu2|yu3=无语',
    'wu2|ming2=无名',
    'wu2|li4=无力',
    'wu2|zhi4=无智',
    'wu2|yi4=无义',
    'wu2|xiao4=无效',
    'wu2|wei4=无味',
    'wu2|yong4=无用',
    'gu1|du2=孤独',
    'si1|ren2=私人',
    'hen2|ji4=痕迹',
    'chong2|fu4=重复',
    'ping2|fan2=平凡',
    'pu3|tong1=普通',
    'mo4|mo4=默默',
    'chen2|mo4=沉默',
    'chen2|ji4=沉寂',
    'leng3|mo4=冷漠',
    'leng3|dan4=冷淡',
    'shou4|yi1=寿衣',
    'bo1|zhe2=波折',
    'ma2|fan2=麻烦',
    'wei2|ji1=危机',
    'wei1|xian3=危险',
    'pian1|pi4=偏僻',
    'pian1|cha1=偏差',
    'cuo4|wu4=错误',
    'sun3|shang1=损伤',
    'sun3|shi1=损失',
    'shang1|hen2=伤痕',
    'kan3|ke3=坎坷',
    'bei1|shang1=悲伤',
    'tong4|ku3=痛苦',
    'dao4|mei2=倒霉',
    'shuai1|bai4=衰败',
    'shi1|bai4=失败',
    'pin2|kun4=贫困',
    'qiong2|kun4=穷困',
    'ke3|nan4=苦难',
    'po4|chan3=破产',
    'fu4|zhai4=负债',
    'ji4|mo4=寂寞',
    'you1|yu4=忧郁',
    'dan3|xiao3=胆小',
    'ya1|yi4=压抑',
    'xiao3|chou3=小丑',
    'chou3|lou4=丑陋',
    'ju3|sang4=沮丧',
    'tui2|fei4=颓废',
    'qi2|guai4=奇怪',
    'ma2|zui4=麻醉'
  ];

  /* ---- 3. 解析 ---- */

  /** 'wu2|de2=无德' → { syllables:['wu','de'], tones:[2,2], word:'无德' } */
  function parse(list, soft) {
    var out = [];
    (list || []).forEach(function (line) {
      var p = String(line).split('=');
      if (p.length !== 2) return;
      var syllables = [], tones = [];
      p[0].split('|').filter(Boolean).forEach(function (s) {
        var m = s.match(/^([a-zü]+)(\d?)$/i);
        if (!m) return;
        syllables.push(m[1].toLowerCase());
        tones.push(m[2] === '' ? 0 : parseInt(m[2], 10));
      });
      if (!syllables.length) return;
      out.push({
        syllables: syllables,
        tones: tones,
        word: p[1].trim(),
        soft: !!soft,
        key: syllables.join('-')
      });
    });
    return out;
  }

  NS.HOMO_SEQUENCES = parse(NS.BAD_SEQUENCES_RAW, false)
    .concat(parse(NS.SOFT_SEQUENCES_RAW, true));

  /* 按「无声调音节序列」建索引，匹配时先粗筛再比声调 */
  NS.HOMO_INDEX = (function () {
    var m = Object.create(null);
    NS.HOMO_SEQUENCES.forEach(function (s) {
      (m[s.key] || (m[s.key] = [])).push(s);
    });
    return m;
  })();

  /* 谐音判定阈值 */
  NS.HOMO_BLOCK_SEVERITY = 1.0;   /* 声调全符 → 判为谐音 */
  NS.HOMO_WARN_SEVERITY = 0.6;    /* 三字以上、多数相符 → 仅提示 */
})(typeof window !== 'undefined' ? window : globalThis);
