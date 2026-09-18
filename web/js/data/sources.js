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

    /* ---------------- 字典：汉字属性 ---------------- */
    {
      id: 'xinhua',
      group: 'dict',
      name: '新华字典（部首/笔画/释义）',
      format: 'xinhua',
      size: 27354320,
      defaultOn: false,
      big: true,
      desc: '约 1.6 万个汉字的部首、简体笔画、释义。' +
        '用于把字库之外的字联网加进来。体积较大，首次下载约需 30 秒～2 分钟。',
      urls: gh('pwxcoo/chinese-xinhua', 'master', 'data/word.json')
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
