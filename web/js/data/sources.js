/* =========================================================================
 * sources.js —— 联网数据源登记表
 *
 * 同时被浏览器和 Node 工具使用（Node 端用 require 加载，见 tools/）。
 * 每个源都列出「主地址 + 镜像地址」，主地址失败时自动回退。
 *
 * size 是实测的文件字节数（未压缩），用于在界面上标出下载量。
 * ========================================================================= */
(function (global) {
  'use strict';
  var NS = (global.NS = global.NS || {});

  var GH = 'https://raw.githubusercontent.com/';
  var JSD = 'https://cdn.jsdelivr.net/gh/';

  /** 生成 raw.githubusercontent 与 jsDelivr 两个地址 */
  function gh(ownerRepo, ref, path) {
    return [
      GH + ownerRepo + '/' + ref + '/' + path,
      JSD + ownerRepo + '@' + ref + '/' + path
    ];
  }

  NS.SOURCES = [
    /* ---------------- 核心：繁简对照（必须最先处理） ---------------- */
    {
      id: 'fanti',
      group: 'core',
      name: '繁简对照表（OpenCC）',
      format: 'fanti',
      size: 83830,
      defaultOn: true,
      first: true,   /* 必须在诗词之前处理，否则繁体诗会匹配不上简体名 */
      desc: '权威繁→简对照（约 3000 组，Apache-2.0）。' +
        '《唐诗三百首》《千家诗》等分卷是繁体，需要它转成简体才能匹配简体名字。' +
        '内置表只覆盖字库用字，联网后覆盖全部汉字。',
      urls: gh('BYVoid/OpenCC', 'master', 'data/dictionary/TSCharacters.txt')
    },

    /* ---------------- 核心：汉字拼音 ---------------- */
    {
      id: 'pinyin',
      group: 'core',
      name: '汉字拼音表（含声调）',
      format: 'pinyin',
      size: 840665,
      defaultOn: true,
      desc: '覆盖基本汉字区全部 2 万余字。用于给字库之外的字补拼音与声调，' +
        '这样谐音检测才能覆盖到所有用字。',
      urls: gh('mozillazg/pinyin-data', 'master', 'pinyin.txt')
    },

    /* ---------------- 诗词：chinese-poetry ---------------- */
    {
      id: 'shijing',
      group: 'poetry',
      name: '诗经',
      format: 'classic',
      size: 156972,
      defaultOn: true,
      desc: '最经典的取名出处（「关关雎鸠」「桃之夭夭」等）。',
      urls: gh('chinese-poetry/chinese-poetry', 'master', '%E8%AF%97%E7%BB%8F/shijing.json')
    },
    {
      id: 'chuci',
      group: 'poetry',
      name: '楚辞',
      format: 'classic',
      size: 141832,
      defaultOn: true,
      desc: '离骚、九歌、九章等，古风用字的出处宝库。',
      urls: gh('chinese-poetry/chinese-poetry', 'master', '%E6%A5%9A%E8%BE%9E/chuci.json')
    },
    {
      id: 'lunyu',
      group: 'poetry',
      name: '论语',
      format: 'classic',
      size: 31729,
      defaultOn: true,
      desc: '「温故而知新」「岁寒然后知松柏之后凋」等。',
      urls: gh('chinese-poetry/chinese-poetry', 'master', '%E8%AE%BA%E8%AF%AD/lunyu.json')
    },
    {
      id: 'tangshi300',
      group: 'poetry',
      name: '唐诗三百首',
      format: 'mengxue',
      size: 148829,
      defaultOn: true,
      desc: '覆盖面最广的唐诗选本。',
      urls: gh('chinese-poetry/chinese-poetry', 'master', '%E8%92%99%E5%AD%A6/tangshisanbaishou.json')
    },
    {
      id: 'qianjiashi',
      group: 'poetry',
      name: '千家诗',
      format: 'mengxue',
      size: 69087,
      defaultOn: true,
      desc: '宋人编选的启蒙诗集，多为写景咏物，适合取字。',
      urls: gh('chinese-poetry/chinese-poetry', 'master', '%E8%92%99%E5%AD%A6/qianjiashi.json')
    },
    {
      id: 'shuimo',
      group: 'poetry',
      name: '水墨唐诗',
      format: 'mengxue',
      size: 95878,
      defaultOn: false,
      desc: '精选唐诗配水墨画意，与唐诗三百首部分重叠。',
      urls: gh('chinese-poetry/chinese-poetry', 'master', '%E6%B0%B4%E5%A2%A8%E5%94%90%E8%AF%97/shuimotangshi.json')
    },
    {
      id: 'nalan',
      group: 'poetry',
      name: '纳兰性德词集',
      format: 'mengxue',
      size: 79626,
      defaultOn: false,
      desc: '清词代表作，辞藻清丽，适合偏柔美的用字。',
      urls: gh('chinese-poetry/chinese-poetry', 'master', '%E7%BA%B3%E5%85%B0%E6%80%A7%E5%BE%B7/%E7%BA%B3%E5%85%B0%E6%80%A7%E5%BE%B7%E8%AF%97%E9%9B%86.json')
    },
    {
      id: 'youmengying',
      group: 'poetry',
      name: '幽梦影',
      format: 'mengxue',
      size: 97571,
      defaultOn: false,
      desc: '清人张潮的文言小品，短句雅致，出处置评很合取名场景。',
      urls: gh('chinese-poetry/chinese-poetry', 'master', '%E5%B9%BD%E6%A2%A6%E5%BD%B1/youmengying.json')
    },
    {
      id: 'shenglv',
      group: 'poetry',
      name: '声律启蒙',
      format: 'mengxue',
      size: 30154,
      defaultOn: false,
      desc: '「云对雨，雪对风」，对仗工稳，用字讲究。',
      urls: gh('chinese-poetry/chinese-poetry', 'master', '%E8%92%99%E5%AD%A6/shenglvqimeng.json')
    },
    {
      id: 'zengguang',
      group: 'poetry',
      name: '增广贤文',
      format: 'mengxue',
      size: 39622,
      defaultOn: false,
      desc: '民间格言集，含大量劝学励志句。',
      urls: gh('chinese-poetry/chinese-poetry', 'master', '%E8%92%99%E5%AD%A6/zengguangxianwen.json')
    },
    {
      id: 'qianziwen',
      group: 'poetry',
      name: '千字文',
      format: 'mengxue',
      size: 11983,
      defaultOn: false,
      desc: '一千个不重复字组成的韵文，用字密度极高。',
      urls: gh('chinese-poetry/chinese-poetry', 'master', '%E8%92%99%E5%AD%A6/qianziwen.json')
    },
    {
      id: 'youxue',
      group: 'poetry',
      name: '幼学琼林',
      format: 'mengxue',
      size: 70535,
      defaultOn: false,
      desc: '古代百科式蒙书，典故丰富。',
      urls: gh('chinese-poetry/chinese-poetry', 'master', '%E8%92%99%E5%AD%A6/youxueqionglin.json')
    },
    {
      id: 'guwen',
      group: 'poetry',
      name: '古文观止',
      format: 'mengxue',
      size: 475985,
      defaultOn: false,
      desc: '历代散文精选，篇幅较长，命中率低于韵文。',
      urls: gh('chinese-poetry/chinese-poetry', 'master', '%E8%92%99%E5%AD%A6/guwenguanzhi.json')
    },
    {
      id: 'songci0',
      group: 'poetry',
      name: '宋词（第一卷 · 约千首）',
      format: 'songci',
      size: 406936,
      defaultOn: false,
      desc: '含苏轼、辛弃疾、李清照等。宋词全量有 250+ 卷、上百 MB，' +
        '浏览器端只取第一卷。',
      urls: gh('chinese-poetry/chinese-poetry', 'master', '%E5%AE%8B%E8%AF%8D/ci.song.0.json')
    },
    {
      id: 'songci300',
      group: 'poetry',
      name: '宋词三百首',
      format: 'songci',
      size: 151283,
      defaultOn: true,
      desc: '上疆村民编选的宋词精选本，与「宋词第一卷」不同 ——' +
        '这是选家挑过的名篇，用字比全量分卷讲究。含 黄孝迈、周邦彦、姜夔 等。',
      urls: gh('chinese-poetry/chinese-poetry', 'master',
        '%E5%AE%8B%E8%AF%8D/%E5%AE%8B%E8%AF%8D%E4%B8%89%E7%99%BE%E9%A6%96.json')
    },

    /* ---------------- 蒙学：三字经 ----------------
     * 三字经、弟子规都是繁体、三字一句的韵文，
     * 靠 fanti 源转成简体后才能匹配；fanti 标了 first:true，会最先处理。
     *
     * 这里曾经还打算收「朱子家训」和「文字蒙求」，实测后放弃了：
     * 「句内相邻二字」这个抽取方式对它们几乎完全失效 ——
     *   朱子家训：「明即 即起 要內 外整 既昏 昏便 自檢」，几乎全是碎词
     *   文字蒙求：「省聲(101) 從人(54) 從又(49) 從口(43)」+「二卷 卷刻 字率 帳簿」，
     *               是文字学术语堆砌
     * 两者的「相邻二字落在内置字库内」的比例只有 1.8% / 1.6%，
     * 比已经被拉黑的「古文观止」（4.1%）还低。收进来只是凑数。
     * 实测脚本见 tools/_src-quality.js。 */
    {
      id: 'sanzijing',
      group: 'poetry',
      name: '三字经',
      format: 'mengxue',
      size: 7430,
      defaultOn: true,
      desc: '王应麟撰，最通行的蒙学韵文。「玉不琢，不成器」「为人子，方少时」' +
        '「勤有功，戏无益」等句都常被取名引用。原文为繁体，由繁简表自动转简体。',
      urls: gh('chinese-poetry/chinese-poetry', 'master', '%E8%92%99%E5%AD%A6/sanzijing-new.json')
    },
    {
      id: 'dizigui',
      group: 'poetry',
      name: '弟子规',
      format: 'mengxue',
      size: 5378,
      defaultOn: false,
      desc: '李毓秀撰，三字一句的言行规范。偏训诫语气，' +
        '而且「母呼」「母命」「母責」这类碎词偏多，取名可引的雅句不如三字经。',
      urls: gh('chinese-poetry/chinese-poetry', 'master', '%E8%92%99%E5%AD%A6/dizigui.json')
    },

    /* ---------------- 四书 ----------------
     * 「四书」里论语已单独收录（chinese-poetry 有独立的「论语」目录），
     * 这里补大学、中庸、孟子。大学与中庸都很短且名句密度极高。 */
    {
      id: 'daxue',
      group: 'poetry',
      name: '大学',
      format: 'mengxue',
      size: 6767,
      defaultOn: true,
      desc: '「苟日新，日日新，又日新」「在明明德」「在止于至善」' +
        '「修身齐家治国平天下」—— 名句密度最高的短篇。',
      urls: gh('chinese-poetry/chinese-poetry', 'master', '%E5%9B%9B%E4%B9%A6%E4%BA%94%E7%BB%8F/daxue.json')
    },
    {
      id: 'zhongyong',
      group: 'poetry',
      name: '中庸',
      format: 'mengxue',
      size: 13889,
      defaultOn: true,
      desc: '「博学之，审问之，慎思之，明辨之，笃行之」' +
        '「君子之道，淡而不厌」等。',
      urls: gh('chinese-poetry/chinese-poetry', 'master', '%E5%9B%9B%E4%B9%A6%E4%BA%94%E7%BB%8F/zhongyong.json')
    },
    {
      id: 'mengzi',
      group: 'poetry',
      name: '孟子',
      format: 'mengxue',
      size: 146745,
      defaultOn: false,
      desc: '「浩然之气」「富贵不能淫，贫贱不能移」「老吾老以及人之老」等。' +
        '散文体，句内相邻二字里虚词搭配较多。',
      urls: gh('chinese-poetry/chinese-poetry', 'master', '%E5%9B%9B%E4%B9%A6%E4%BA%94%E7%BB%8F/mengzi.json')
    },

    /* ---------------- 五代词与曹操诗 ---------------- */
    {
      id: 'nantang',
      group: 'poetry',
      name: '南唐二主词（李璟·李煜）',
      format: 'mengxue',
      size: 71500,
      defaultOn: true,
      desc: '李煜、李璟全部词作。「一江春水向东流」「林花谢了春红」' +
        '「梦里不知身是客」—— 用字清丽，是取名的上等出处。',
      urls: gh('chinese-poetry/chinese-poetry', 'master',
        '%E4%BA%94%E4%BB%A3%E8%AF%97%E8%AF%8D/nantang/poetrys.json')
    },
    {
      id: 'huajianji1',
      group: 'poetry',
      name: '花间集（卷一）',
      format: 'mengxue',
      size: 28137,
      defaultOn: true,
      desc: '温庭筠、韦庄等，最早的文人词总集。辞藻浓艳，' +
        '偏柔美一路（「明灭」「鬓云」「蛾眉」）。全十卷共约 250KB，这里只取第一卷。',
      urls: gh('chinese-poetry/chinese-poetry', 'master',
        '%E4%BA%94%E4%BB%A3%E8%AF%97%E8%AF%8D/huajianji/huajianji-1-juan.json')
    },
    {
      id: 'caocao',
      group: 'poetry',
      name: '曹操诗集',
      format: 'mengxue',
      size: 16894,
      defaultOn: true,
      desc: '「对酒当歌，人生几何」「日月之行，若出其中」' +
        '「老骥伏枥，志在千里」—— 四言诗气象开阔，适合取大气一路的字。',
      urls: gh('chinese-poetry/chinese-poetry', 'master', '%E6%9B%B9%E6%93%8D%E8%AF%97%E9%9B%86/caocao.json')
    },

    /* 这里原本还打算收「元曲」（4 MB）。实测放弃：
     * 10800 篇、抽出 188514 个相邻二字，但落在内置字库内的只有 2.9%
     * ——比已拉黑的千字文（3.9%）、古文观止（4.1%）都低。
     * 而且要占掉诗篇上限（MAX_POEMS=40000）的 27%，产出比最差。
     * 同批被实测否掉的还有朱子家训（1.8%）与文字蒙求（1.6%），理由见上文。 */

    /* ---------------- 方言：四川话 ---------------- */
    {
      id: 'shupin',
      group: 'dialect',
      name: '蜀拼字表（四川话读音）',
      format: 'shupin',
      size: 412617,
      defaultOn: false,
      licenseNote: '来源仓库未声明授权，故默认不勾选、不打进安装包',
      desc: '1.3 万个汉字的四川话读音（声母+韵母+声调），字库覆盖率 100%。' +
        '用于检测「普通话没问题、四川话难听或撞词」的名字。' +
        '注意：数据来自第三方个人项目，个别读音与成都话实际有出入，仅作提示。',
      urls: gh('AlienKevin/sichuanhua', 'main', 'shupin.simp.dict.yaml')
    },
    {
      id: 'sichuanWords',
      group: 'dialect',
      name: '四川方言词汇表',
      format: 'fangyan',
      size: 133665,
      defaultOn: false,
      licenseNote: '来源仓库未声明授权，故默认不勾选、不打进安装包',
      desc: '300 余条四川方言词及释义（如「扯霍闪」= 打闪）。' +
        '名字若在四川话里听着像某个方言词，会提示出来供参考。',
      urls: gh('AlienKevin/sichuanhua', 'main', 'fangyan.tsv')
    },

    /* ---------------- 字典：汉字属性 ----------------
     *
     * 数据源从 pwxcoo/chinese-xinhua 换成了 mapull/chinese-dictionary。
     * 换的原因（都是实测出来的）：
     *   1. 旧源的 pinyin 字段**只有单读音**，16142 条里 0 条带多读音分隔符 ——
     *      「行」只有 xínɡ 没有 háng，所以「是不是多音字」这个信息
     *      在旧数据里根本不存在，无法满足「标注多音字」的需求。
     *   2. 旧源的拼音用了 U+0261（ɡ，拉丁字母）而不是 ASCII 的 g，
     *      这会让鼻音韵尾检测（/(ng|n)$/）静默失效。
     *   3. 新源 21057 字（旧源 14809），且多一份《通用规范汉字表》
     *      常用字表 —— 那是判断「这个字常不常见」的权威依据。
     *   4. 总体积更小（字表 2.8MB + 多音字 0.24MB + 常用字 0.18MB，
     *      释义 13MB 且可选；旧源是单个 27MB）。
     *
     * 拆成四个源而不是一个，是为了：
     *   · 复用现有的「一个源一个文件 + 多镜像」机制，不必改下载层；
     *   · 用户可以只下载前三项（约 3.2MB）就能取名，
     *     释义（13MB）纯粹是「按部首找字」时查看用的，可以不下。
     */
    {
      id: 'xhbase',
      group: 'dict',
      name: '新华字典·字表（2.1 万字）',
      format: 'xhbase',
      size: 2891776,
      defaultOn: true,
      big: true,
      desc: '约 2.1 万个汉字的**全部读音**、部首、笔画与字形结构。' +
        '这是「按部首找字」与「从字典取名」的基础。体积约 2.8 MB。',
      urls: gh('mapull/chinese-dictionary', 'master',
        'character/char_base.json')
    },
    {
      id: 'xhpoly',
      group: 'dict',
      name: '新华字典·多音字表（2495 字）',
      format: 'xhpoly',
      size: 253952,
      defaultOn: true,
      desc: '2495 个多音字及其全部读音（行 → xíng/háng/hàng/héng，' +
        '若 → ruò/rě，菲 → fēi/fěi）。用来标注「这个字有几种读法」——' +
        '读法多且都常用的字容易被念错，取名时应避开。很小，建议开着。',
      urls: gh('mapull/chinese-dictionary', 'master',
        'character/polyphone.json')
    },
    {
      id: 'xhcommon',
      group: 'dict',
      name: '新华字典·常用字表（3500 字）',
      format: 'xhcommon',
      size: 184320,
      defaultOn: true,
      desc: '《通用规范汉字表》一级字表 3500 字。' +
        '字典里有 2 万多字，不筛的话会挑出「苯」「苊」「芤」这类' +
        '化学、医药专用字 —— 它们确实在字典里，但根本不是名字。' +
        '很小，建议开着。',
      urls: gh('mapull/chinese-dictionary', 'master',
        'character/common/char_common.json')
    },
    {
      id: 'xhdetail',
      group: 'dict',
      name: '新华字典·释义（逐读音，13 MB）',
      format: 'xhdetail',
      size: 13032448,
      defaultOn: false,
      big: true,
      desc: '每个字**按读音分列**的释义与例词，供「按部首找字」时查看字义。' +
        '体积约 13 MB，首次下载较慢。' +
        '**只取名字的话可以不下载** —— 前三项就够了。',
      urls: gh('mapull/chinese-dictionary', 'master',
        'character/char_detail.json')
    }
  ];

  NS.SOURCE_BY_ID = (function () {
    var m = Object.create(null);
    NS.SOURCES.forEach(function (s) { m[s.id] = s; });
    return m;
  })();

  NS.GROUP_NAMES = {
    core: '核心数据',
    poetry: '诗词出处',
    dialect: '方言读音（四川话）',
    dict: '汉字字典'
  };

  /* 这些集合产出的「句内相邻二字」不算真正的取名出处。
   * 用黑名单而不是白名单：诗词与诸子典籍都适合取名，只有这几种是噪声源。
   *
   * 实测依据（未过滤时确实排进了前 30）：
   *   古文观止「而史官亦书之於其傳」 → 产出「亦书」（虚词搭配，不是词）
   *   古文观止「望林巒而有失」       → 产出「林望」（诗里其实是「望林」）
   *   幼学琼林 / 千字文              → 四字格堆砌，任意两字都能凑
   *   声律启蒙                        → 本身就是为对仗拼字的读物
   *   幽梦影                          → 清代小品，格言体
   */
  NS.NON_CLASSIC_SOURCES = {
    '古文观止': 1,
    '幽梦影': 1,
    '幼学琼林': 1,
    '增广贤文': 1,
    '声律启蒙': 1,
    '千字文': 1
  };

  NS.isClassicSource = function (name) {
    return !NS.NON_CLASSIC_SOURCES[name];
  };

  NS.formatSize = function (n) {
    if (!n && n !== 0) return '未知';
    if (n > 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    if (n > 1024) return (n / 1024).toFixed(0) + ' KB';
    return n + ' B';
  };
})(typeof window !== 'undefined' ? window : globalThis);
