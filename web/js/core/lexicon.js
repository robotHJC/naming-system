/* =========================================================================
 * lexicon.js —— 联网词库：解析、合并、持久化
 *
 * 数据流：
 *   联网下载 → 解析成统一结构 → 合并进运行时（NS.CHAR_DB / NS.Poetry）
 *            → 持久化到 NS.Store（IndexedDB）→ 下次打开自动恢复
 *
 * 三个数据源各自的作用：
 *   pinyin  给任意汉字补「拼音 + 声调」 —— 谐音检测依赖它
 *   xinhua  给任意汉字补「部首 + 简体笔画 + 释义」 —— 用于把新字加进字库
 *   poetry  扩充诗词出处库 —— 提高「出自某诗」的命中率
 * ========================================================================= */
(function (global) {
  'use strict';
  var NS = (global.NS = global.NS || {});

  var MAX_POEMS = 40000;      /* 诗词总量上限，保护内存 */
  var MEANING_MAX = 70;       /* 字典释义入库前截断长度 */

  /**
   * 只收 BMP 范围内的汉字：扩展A区 + 基本区 + 兼容区。
   * 扩展B 及以上（U+20000+）需要代理对，而本系统其它地方都按
   * 「一个汉字 = 一个 UTF-16 码元」处理（charAt / length 判断），
   * 收进来会造成长度判断错乱，因此明确不收。
   */
  function isCJKIdeograph(cp) {
    return (cp >= 0x3400 && cp <= 0x4dbf) ||   /* 扩展 A */
      (cp >= 0x4e00 && cp <= 0x9fff) ||        /* 基本区 */
      (cp >= 0xf900 && cp <= 0xfaff);          /* 兼容汉字 */
  }

  /* 每个读音最多留几条释义、每条多长。
   * 释义原始文件 13MB，不截断会把本地存储撑得很大、读一次很慢，
   * 而界面上也只需要「一眼看懂这个字什么意思」。 */
  var MAX_EXP_PER_READING = 3;
  var MAX_EXP_LEN = 90;

  /**
   * 解析 mapull/chinese-dictionary 的两种 JSON 形态。
   *
   * char_base.json 与 char_detail.json 是**逗号分隔的对象序列**，
   * 没有外层方括号（char_base 有 21057 行对象）；
   * polyphone.json 与 char_common.json 则是标准 JSON 数组。
   * 两种都要能吃，所以先看首字符再决定怎么解。
   */
  function parseJsonSeq(text) {
    var t = String(text || '').trim();
    if (!t) return [];
    if (t.charAt(0) === '[') return JSON.parse(t);
    return JSON.parse('[' + t.replace(/[\s,]+$/, '') + ']');
  }

  /**
   * 拆掉开头那个**配平**的括号，返回括号内内容与括号之后的剩余。
   *
   * 为什么不能用正则：`/^[（(][^）)]*[）)]/` 会在**内层**括号的 `)` 上提前收尾。
   * 「苟」的释义是
   *   (形声。从艸,句(勾)声。本义:草名。又:菜名) 同本义。
   * 正则只吃到「句(勾)」的 `)`，于是释义被切成
   *   「声。本义:草名。又:菜名) 同本义。」
   * 这种半截话，还带一个孤零零的右括号。必须按嵌套深度配平。
   *
   * @returns {{text:string, rest:string}|null} null = 不以括号开头、或括号不闭合
   */
  function splitParen(t) {
    var c0 = t.charAt(0);
    if (c0 !== '(' && c0 !== '（') return null;
    var depth = 0;
    for (var i = 0; i < t.length; i++) {
      var c = t.charAt(i);
      if (c === '(' || c === '（') depth++;
      else if (c === ')' || c === '）') {
        depth--;
        if (depth === 0) {
          return {
            text: t.slice(1, i).trim(),
            rest: t.slice(i + 1).replace(/^[。，、;；:：\s]+/, '').trim()
          };
        }
      }
    }
    return null;   /* 括号不闭合，不动它 */
  }

  /**
   * 释义清洗：压成一行、拆掉字典的六书说明括号、超长截断。
   *
   * 父注（六书说明）的两种形态：
   *   「(指事。“一”是汉字部首之一。本义:数词…)」—— 括号里就是全部内容 → 拆括号留内容
   *   「（形声。从辵，也声）曲折连绵」—— 括号只是开头 → 丢掉括号，留后面的正文
   *
   * 但括号后面若是「同本义。」「同上。」这类**没有信息量**的话，
   * 真正的内容反而在括号里 —— 这时取括号内。实测「苇」的释义是
   * 「(形声。从艸,韦声。本义:芦苇) 同本义。」，取后者等于什么都没说。
   */
  var CONTENTLESS = /^(同本义|同前|同上|见上|亦作|参见|详见)/;

  function cleanExp(s) {
    if (!s) return '';
    var t = String(s).replace(/\s+/g, ' ').trim();
    var p = splitParen(t);
    if (p) {
      if (p.rest && !CONTENTLESS.test(p.rest)) t = p.rest;
      else if (p.text) t = p.text;
      else t = p.rest;
    }
    if (t.length > MAX_EXP_LEN) t = t.slice(0, MAX_EXP_LEN) + '…';
    return t;
  }

  /**
   * 拼音归一化 —— 必须在**入库时**做，不能等到用的时候。
   *
   * 上游数据把 ASCII 的 g 写成拉丁小写字母 ɡ (U+0261) ——
   * mapull 字表里「工」就是 "ɡōnɡ"，两个字母都是 U+0261，20928 字里有 2574 字中招。
   * 这类同形字母会让声母判断和鼻韵母识别（ang/eng/ong 一个都认不出来）
   * 静默失效：不报错，只是「音韵分」莫名偏低。
   * 顺带把 ɑ (U+0251) 换成 a；实测三份数据里只出现 1 次。
   *
   * 带调元音（ā á ǎ à …）本来就不在 ASCII 区，不受影响。
   */
  function normPinyin(p) {
    var s = String(p == null ? '' : p).trim();
    if (!s) return '';
    s = s.replace(/\u0261/g, 'g').replace(/\u0251/g, 'a');
    /* 上游个别条目拼音字段里混进了汉字（实测 char_detail 有 2 条），
     * 拼音必须是字母串，出现汉字就整条丢弃 —— 留着比丢掉更糟，
     * 后面按首字母取声母会拿到一个汉字。 */
    if (/[\u3400-\u9fff\uf900-\ufaff]/.test(s)) return '';
    return s;
  }

  /* 快照内置繁简表：load 顺序保证此刻 NS.FAN_JIAN 还是内置版本，
   * 「清空联网数据」时要还原到它。 */
  var FAN_JIAN_BUILTIN = Object.create(null);
  Object.keys(NS.FAN_JIAN || {}).forEach(function (k) {
    FAN_JIAN_BUILTIN[k] = NS.FAN_JIAN[k];
  });

  /* 联网词库占用的存储键。
   *
   * 必须显式列出来传给 Store.clear(keys) —— 早先调的是无参 clear()，
   * 那是整个 object store 清空，会把**候选池**（跟联网词库毫无关系的
   * 用户数据）也一并删掉。用户一个个挑出来的名字丢了是真损失。 */
  var STORE_KEYS = ['pinyinMap', 'dict', 'poems', 'customChars',
    'meta', 'fantiMap', 'shupinMap', 'dialectWords',
    /* 下面四个来自 mapull/chinese-dictionary 的新华字典源 */
    'pinyinAll', 'polyMap', 'commonSet', 'meanings'];

  var Lexicon = {
    pinyinMap: null,      /* { 字: {pinyin, tone} } */
    dict: null,           /* { 字: [简体笔画, 部首, 带调拼音, 释义] } */
    customChars: [],      /* 用户/联网加入字库的字 */
    /* —— 以下四份来自新华字典字表，解决「旧源信息不够」的问题 —— */
    /* { 字: [全部读音] }。旧源只给第一个读音，多音字根本看不出来。 */
    pinyinAll: null,
    /* { 字: [全部读音] }，只收录**多音字**。
     * 与 pinyinAll 的区别：pinyinAll 是「所有字的读音」，
     * 这个是「确实是多音字的那些字」—— 界面上要标「多音字」徽标，
     * 拿长度 > 1 去判也能得到同样结果，但单独一份更直白、也更省一次遍历。 */
    polyMap: null,
    /* { 字: 1 } —— 《通用规范汉字表》一级字表（3500 字）。
     * 这是判断「这个字常不常见」的权威依据，用来当字典取名的质量闸门。
     * 光靠它不够（实测 茬/芭/苞 在表内但不是好名字，
     * 而 芷/菡/芸/芮 不在表内却是好名字），要与诗歌语料组合用。 */
    commonSet: null,
    /* { 字: [{pinyin, exp:[释义…]}] } —— **逐读音**的释义。
     * 旧源的释义是一整块文本、分不出哪个读音对应哪条义项。 */
    meanings: null,
    /* 每次字库数据变化就 +1。依赖字库的派生索引（如同音替换的反查表）
     * 靠它判断缓存是否失效，不必在每次取用时重算一遍。 */
    dataVersion: 0,
    fantiMap: null,       /* 联网的 OpenCC 繁→简对照 */
    meta: null,           /* { lastSync, schema, sources: {id: {...}} } */
    /* 上一次启动时丢弃了不兼容的本地数据（用于界面提示），null 表示没发生 */
    discardNotice: null,

    /* ---------------- 查询 ---------------- */

    /** 某字的全部读音；没有多读音数据时退回单读音字典 */
    readingsOf: function (ch) {
      if (Lexicon.pinyinAll && Lexicon.pinyinAll[ch]) {
        return Lexicon.pinyinAll[ch].slice();
      }
      var d = Lexicon.dict && Lexicon.dict[ch];
      if (d && d[2]) return [d[2]];
      var py = Lexicon.pinyinMap && Lexicon.pinyinMap[ch];
      return py ? [py.pinyin] : [];
    },

    /** 是不是多音字（需要多音字表或字表里读音数 > 1） */
    isPolyphone: function (ch) {
      if (Lexicon.polyMap && Lexicon.polyMap[ch]) return true;
      var r = Lexicon.readingsOf(ch);
      return r.length > 1;
    },

    /** 是不是《通用规范汉字表》一级字表的常用字 */
    isCommon: function (ch) {
      return !!(Lexicon.commonSet && Lexicon.commonSet[ch]);
    },

    /** 某字的逐读音释义；没有就返回空数组 */
    meaningsOf: function (ch) {
      return (Lexicon.meanings && Lexicon.meanings[ch]) || [];
    },

    /**
     * 公一版释义清洗，供界面 / 部首浏览复用**同一套规则**。
     * 之前 radical.fromDict 自己用正则去括号，且又叠了一层
     * Infer.cleanExplanation（它会按第一个句号截断、还带 slice(0,40) 的
     * 兵方案），结果把「苟」的释义切成了半截话。规则只留一份。
     */
    cleanMeaning: function (s) {
      return cleanExp(s);
    },

    /**
     * 取某字某个读音的简短释义（拼成一行，用于列表里显示一句话）。
     *
     * 为什么要指定读音：字表（char_base）与释义（char_detail）的读音**排序不一致**
     * —— 行 在字表里首读音是 xíng，在释义里第一条却是 háng。
     * 不按读音去匹配，列表里就会出现「首读音 xíng，释义却是 háng 的」这种错位。
     * 匹配不到时退回第一条。
     */
    briefMeaning: function (ch, pinyin) {
      var prons = (Lexicon.meanings && Lexicon.meanings[ch]) || [];
      if (!prons.length) return '';
      var hit = null;
      for (var i = 0; i < prons.length; i++) {
        if (pinyin && prons[i].pinyin === pinyin) { hit = prons[i]; break; }
      }
      if (!hit) hit = prons[0];
      var exp = hit.exp || [];
      /* 「同本义。」「同上。」这类条目在列表里没有信息量（它的先行词在上一条
       * 义项里），所以往后找第一条真正有内容的。全都没有就用第一条。 */
      var one = '';
      for (var j = 0; j < exp.length; j++) {
        if (!/^(同本义|同上|见上|亦作)/.test(exp[j])) { one = exp[j]; break; }
      }
      if (!one) one = exp[0] || '';
      /* 列表里只占一行，压到 60 字以内 */
      if (one.length > 60) one = one.slice(0, 60) + '…';
      return one;
    },

    /* ---------------- 解析 ---------------- */

    /**
     * 解析 OpenCC 的 TSCharacters.txt
     * 格式：  '乾\t干 乾'   —— 制表符分隔，右侧可能有多个候选，取第一个
     *        以 # 开头的是注释
     */
    parseFanti: function (text) {
      var map = Object.create(null);
      var count = 0;
      String(text).split('\n').forEach(function (line) {
        if (!line || line.charAt(0) === '#') return;
        var parts = line.split('\t');
        if (parts.length < 2) return;
        var fan = parts[0].trim();
        var vals = parts[1].trim().split(/\s+/);
        if (fan.length !== 1 || !vals.length) return;
        var jian = vals[0];
        if (jian.length !== 1 || jian === fan) return;
        map[fan] = jian;
        count++;
      });
      return { map: map, count: count };
    },

    /**
     * 解析 mozillazg/pinyin-data 的 pinyin.txt
     * 格式： U+4E00: yī  # 一      或    U+3007: líng,yuán,xīng # 〇
     */
    parsePinyin: function (text) {
      var map = Object.create(null);
      var count = 0;
      var lines = String(text).split('\n');
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.charAt(0) !== 'U' && line.charAt(0) !== 'u') continue;
        var m = line.match(/^U\+([0-9A-Fa-f]+)\s*:\s*([^#]*)/);
        if (!m) continue;
        var cp = parseInt(m[1], 16);
        if (!isFinite(cp) || !isCJKIdeograph(cp)) continue;
        var ch = String.fromCharCode(cp);
        var readings = m[2].split(/[,，]/).map(function (s) {
          return s.trim();
        }).filter(Boolean);
        if (!readings.length) continue;
        var p = NS.Pinyin.stripTone(normPinyin(readings[0]));
        if (!p.plain) continue;
        map[ch] = { pinyin: p.plain, tone: p.tone };
        count++;
      }
      return { map: map, count: count };
    },

    /* =================================================================
     * 新华字典（mapull/chinese-dictionary）
     *
     * 四份数据，各管一件事：
     *   xhbase   字表   → dict（笔画/部首/首读音）+ pinyinAll（**全部读音**）
     *   xhpoly   多音字 → polyMap
     *   xhcommon 常用字 → commonSet
     *   xhdetail 释义   → meanings（逐读音）+ dict 的释义字段
     * ================================================================= */

    /**
     * 字表（character/char_base.json）
     * 字段：char / strokes / pinyin[] / radicals / structure
     *
     * **必须保留已有释义**：同步按体积从大到小排，释义（13MB）会先入库，
     * 这里直接覆盖 dict 会把刚存好的释义清掉。
     */
    parseXhBase: function (text) {
      var arr = parseJsonSeq(text);
      var map = Object.create(null);
      var all = Object.create(null);
      var count = 0;
      arr.forEach(function (item) {
        var ch = String(item.char || '');
        if (ch.length !== 1 || !isCJKIdeograph(ch.charCodeAt(0))) return;
        if (map[ch]) return;
        var pys = (item.pinyin || []).map(normPinyin).filter(Boolean);
        map[ch] = [
          parseInt(item.strokes, 10) || 0,
          String(item.radicals || '').slice(0, 2),
          pys[0] || '',
          ''                       /* 释义留给 xhdetail 填 */
        ];
        if (pys.length) all[ch] = pys;
        count++;
      });
      return { map: map, all: all, count: count };
    },

    /**
     * 多音字表（character/polyphone.json）
     * 字段：char / strokes / pinyin[] / frequency
     * 只有音数 >= 2 的才会收进来。
     */
    parseXhPoly: function (text) {
      var arr = parseJsonSeq(text);
      var m = Object.create(null);
      arr.forEach(function (item) {
        var ch = String(item.char || '');
        if (ch.length !== 1) return;
        var pys = (item.pinyin || []).map(normPinyin).filter(Boolean);
        if (pys.length < 2) return;
        m[ch] = pys;
      });
      return { map: m, count: Object.keys(m).length };
    },

    /** 常用字表（character/common/char_common.json）——《通用规范汉字表》一级字表 */
    parseXhCommon: function (text) {
      var arr = parseJsonSeq(text);
      var m = Object.create(null);
      arr.forEach(function (item) {
        var ch = String(item.char || '');
        if (ch.length === 1) m[ch] = 1;
      });
      return { map: m, count: Object.keys(m).length };
    },

    /**
     * 逐读音释义（character/char_detail.json）
     * 结构：{ char, pronunciations: [ { pinyin, explanations:[{content}], words:[…] } ] }
     *
     * 这是比旧源强的地方：**释义按读音分列** ——
     * 旧源是一整块文本，分不出哪个读音对应哪条义项。
     */
    parseXhDetail: function (text) {
      var arr = parseJsonSeq(text);
      var map = Object.create(null);
      var count = 0;
      arr.forEach(function (item) {
        var ch = String(item.char || '');
        if (ch.length !== 1) return;
        var out = [];
        (item.pronunciations || []).forEach(function (pr) {
          var exps = (pr.explanations || []).map(function (e) {
            return cleanExp(e && e.content);
          }).filter(Boolean).slice(0, MAX_EXP_PER_READING);
          if (!exps.length) return;
          out.push({ pinyin: normPinyin(pr.pinyin), exp: exps });
        });
        if (!out.length) return;
        map[ch] = out;
        count++;
      });
      return { map: map, count: count };
    },

    /**
     * 解析 pwxcoo/chinese-xinhua 的 word.json
     * 字段：word / strokes / pinyin / radicals / explanation
     * 为省空间，入库时压缩成 [简体笔画, 部首, 带调拼音, 释义]
     * （旧源，保留解析器以便兼容已同步过的本地数据）
     */
    parseXinhua: function (text) {
      var arr = JSON.parse(text);
      var map = Object.create(null);
      var count = 0;
      arr.forEach(function (item) {
        var w = String(item.word || '');
        if (w.length !== 1) return;
        if (!isCJKIdeograph(w.charCodeAt(0))) return;
        if (map[w]) return;
        map[w] = [
          parseInt(item.strokes, 10) || 0,
          String(item.radicals || '').slice(0, 2),
          normPinyin(String(item.pinyin || '').split(/[,，]/)[0]),
          NS.Infer.cleanExplanation(item.explanation).slice(0, MEANING_MAX)
        ];
        count++;
      });
      return { map: map, count: count };
    },

    /**
     * 解析 chinese-poetry 的诗篇。
     * 该仓库各分卷结构不统一（有的扁平、有的三层嵌套；键名有
     * paragraphs / para / content 三种），所以用一个递归收集器统一处理。
     * 同时把繁体归一化成简体，否则「白日依山盡」里的「盡」永远匹配不到简体字。
     */
    parsePoems: function (text, src) {
      var data = JSON.parse(text);
      var out = [];
      collect(data, out, { source: src.name, title: '', author: '' }, src);
      return { poems: out, count: out.length };
    },

    /* ---------------- 应用 ---------------- */

    /** 合并繁→简对照表，并把已入库的繁体诗篇重新转一遍 */
    applyFanti: function (map) {
      ensureLoaded();
      var n = 0, skipped = 0;
      Object.keys(map).forEach(function (fan) {
        /* 受保护的字不合并：这些字按字面硬转会污染原文
         * （例如 OpenCC 把「乾」首选成「干」，「乾坤」就成了「干坤」） */
        if (NS.FAN_JIAN_PROTECT && NS.FAN_JIAN_PROTECT[fan]) {
          skipped++;
          return;
        }
        if (!NS.FAN_JIAN[fan]) n++;
        NS.FAN_JIAN[fan] = map[fan];
        Lexicon.fantiMap[fan] = map[fan];
      });
      Lexicon.fantiSkipped = skipped;
      return n;
    },

    /**
     * 把已存储的联网诗篇重新转成简体。
     * 场景：先同步了诗词（当时繁简表还不全），之后才补上繁简表——
     * 这时旧数据里会残留繁体，需要重转一次。
     * toSimplified 是幂等的，重复处理简体文本不会出错。
     */
    reconvertPoems: function () {
      var start = NS.Poetry.builtinCount;
      var changed = 0;
      for (var i = start; i < NS.RAW_POEMS.length; i++) {
        var p = NS.RAW_POEMS[i];
        var c = NS.toSimplified(p[2]);
        var t = NS.toSimplified(p[1]);
        if (c !== p[2] || t !== p[1]) {
          p[1] = t;
          p[2] = c;
          changed++;
        }
      }
      if (changed) NS.Poetry.rebuild();
      return changed;
    },

    /** 把联网拼音补进「字典里有、但拼音表缺」的场景，并登记到 pinyinMap */
    applyPinyin: function (map) {
      ensureLoaded();
      var n = 0;
      Object.keys(map).forEach(function (ch) {
        Lexicon.pinyinMap[ch] = map[ch];
        n++;
      });
      Lexicon.dataVersion++;
      return n;
    },

    applyDict: function (map) {
      ensureLoaded();
      var n = 0;
      Object.keys(map).forEach(function (ch) {
        if (!Lexicon.dict[ch]) n++;
        Lexicon.dict[ch] = map[ch];
      });
      Lexicon.dataVersion++;
      Lexicon.applySimplifiedStrokes();
      return n;
    },

    /**
     * 把新华字典的**简体笔画**回填到字库条目上（strokesSC）。
     *
     * 内置 490 字的 strokes 字段是**康熙笔画**（人工核定，供三才五格用）。
     * 「字形均衡/可读性」要用的是简体笔画 —— 两者对「听→聽」「时→時」
     * 这类字差得很远（听 7 画 vs 聽 22 画），必须分开存。
     * 字典同步过之后才有简体值可回填；没同步时 strokesSC 为空，
     * 读取走 NS.strokesSC() 退回康熙笔画。
     *
     * 幂等：重复调用不会反复覆盖，也不会改变 dataVersion。
     * @returns {number} 实际回填了几个字
     */
    applySimplifiedStrokes: function () {
      var dict = Lexicon.dict;
      if (!dict) return 0;
      var n = 0;
      (NS.CHAR_LIST || []).forEach(function (c) {
        var d = dict[c.char];
        var sc = d ? parseInt(d[0], 10) : 0;
        if (sc > 0 && c.strokesSC !== sc) { c.strokesSC = sc; n++; }
      });
      return n;
    },

    applyPoems: function (poems) {
      var room = MAX_POEMS - NS.Poetry.poems.length;
      if (room <= 0) return 0;
      return NS.Poetry.addPoems(poems.slice(0, room));
    },

    /* ---- 新华字典四份数据入库 ---- */

    /**
     * 字表：填 dict（笔画/部首/首读音）与 pinyinAll（全部读音）。
     * **保留已有释义** —— 同步按体积从大到小排，释义（13MB）先入库，
     * 直接覆盖会把刚存好的释义清掉。
     */
    applyXhBase: function (res) {
      ensureLoaded();
      var n = 0;
      Object.keys(res.map).forEach(function (ch) {
        var e = res.map[ch];
        var prev = Lexicon.dict[ch];
        if (prev && prev[3]) e[3] = prev[3];
        /* 有逐读音释义时，按**本字的主体读音**重取一句，
         * 避面「首读音 xíng、释义却是 háng 的」错位 */
        var brief = Lexicon.briefMeaning(ch, e[2]);
        if (brief) e[3] = brief;
        if (!prev) n++;
        Lexicon.dict[ch] = e;
      });
      Object.keys(res.all).forEach(function (ch) {
        Lexicon.pinyinAll[ch] = res.all[ch];
      });
      Lexicon.dataVersion++;
      Lexicon.applySimplifiedStrokes();
      return n;
    },

    /** 多音字表：填 polyMap（顺带补 pinyinAll，字表没同步时也能拿到全部读音） */
    applyXhPoly: function (res) {
      ensureLoaded();
      var n = 0;
      Object.keys(res.map).forEach(function (ch) {
        if (!Lexicon.polyMap[ch]) n++;
        Lexicon.polyMap[ch] = res.map[ch];
        if (!Lexicon.pinyinAll[ch]) Lexicon.pinyinAll[ch] = res.map[ch];
      });
      Lexicon.dataVersion++;
      return n;
    },

    /** 常用字表：填 commonSet */
    applyXhCommon: function (res) {
      ensureLoaded();
      var n = 0;
      Object.keys(res.map).forEach(function (ch) {
        if (!Lexicon.commonSet[ch]) n++;
        Lexicon.commonSet[ch] = 1;
      });
      return n;
    },

    /**
     * 逐读音释义：填 meanings，并把第一读音的释义写进 dict ——
     * 这样「按部首找字」在只下载了释义、没下载字表时也有一句话可看。
     */
    applyXhDetail: function (res) {
      ensureLoaded();
      var n = 0;
      Object.keys(res.map).forEach(function (ch) {
        var prons = res.map[ch];
        Lexicon.meanings[ch] = prons;
        var first = prons[0];
        if (!first || !first.exp.length) return;
        var prev = Lexicon.dict[ch];
        /* 字表已入库时，dict[2] 才是字的主体读音，按它对齐；
         * 字表还没到时用释义的第一条。 */
        var brief = Lexicon.briefMeaning(ch, prev && prev[2]) ||
          first.exp.slice(0, 2).join('；');
        if (prev) prev[3] = brief;
        else {
          Lexicon.dict[ch] = [0, '', first.pinyin || '', brief];
        }
        n++;
      });
      Lexicon.dataVersion++;
      return n;
    },

    /** 把自定义字（联网加入的）挂进字库，让取名流程能用上 */
    applyCustomChars: function () {
      Lexicon.customChars.forEach(function (entry) {
        if (!NS.CHAR_DB[entry.char]) {
          NS.CHAR_DB[entry.char] = entry;
          NS.CHAR_LIST.push(entry);
        } else {
          /* 已存在则覆盖，保留用户改过的属性 */
          NS.CHAR_DB[entry.char] = entry;
          for (var i = 0; i < NS.CHAR_LIST.length; i++) {
            if (NS.CHAR_LIST[i].char === entry.char) {
              NS.CHAR_LIST[i] = entry;
              break;
            }
          }
        }
      });
      Lexicon.dataVersion++;
      return Lexicon.customChars.length;
    },

    /* ---------------- 单字查询与入库 ---------------- */

    /**
     * 查询一个字的可用信息（不落库，只返回候选）
     * @returns {{char, pinyin, tone, wuxing, strokes, radical, meaning,
     *            inferred, sources:string[]}}
     */
    lookupChar: function (ch) {
      var py = (Lexicon.pinyinMap && Lexicon.pinyinMap[ch]) || null;
      var d = (Lexicon.dict && Lexicon.dict[ch]) || null;
      var sources = [];
      if (py) sources.push('拼音表');
      if (d) sources.push('新华字典');

      var dictEntry = d ? {
        strokes: d[0], radicals: d[1], pinyin: d[2], explanation: d[3]
      } : null;

      if (!dictEntry && !py) {
        return { char: ch, sources: sources, inferred: null, missing: true };
      }
      var entry = NS.Infer.buildCharEntry(ch, dictEntry, py);
      entry.sources = sources;
      entry.missing = false;
      return entry;
    },

    /** 加入字库（可覆盖推断出来的字段） */
    addCustomChar: function (entry) {
      if (!entry || !entry.char) return false;
      /* 去掉旧的同字条目 */
      Lexicon.customChars = Lexicon.customChars.filter(function (c) {
        return c.char !== entry.char;
      });
      entry.__inferred = entry.__inferred || { source: 'manual' };
      Lexicon.customChars.push(entry);
      Lexicon.applyCustomChars();
      return NS.Store.set('customChars', Lexicon.customChars);
    },

    removeCustomChar: function (ch) {
      Lexicon.customChars = Lexicon.customChars.filter(function (c) {
        return c.char !== ch;
      });
      delete NS.CHAR_DB[ch];
      NS.CHAR_LIST = NS.CHAR_LIST.filter(function (c) { return c.char !== ch; });
      return NS.Store.set('customChars', Lexicon.customChars);
    },

    /* ---------------- 同步编排 ---------------- */

    /**
     * 按选中源同步
     * @param {string[]} ids
     * @param {Object} hooks { onSourceStart, onSourceDone, onSourceError, onProgress }
     * @returns {Promise<Object>} 汇总报告
     */
    sync: function (ids, hooks) {
      hooks = hooks || {};
      var sources = (ids || []).map(function (id) {
        return NS.SOURCE_BY_ID[id];
      }).filter(Boolean);

      if (!sources.length) {
        return Promise.reject(new Error('没有选择任何数据源'));
      }

      /* 诗词、蒙学、经部这些文本源**全都是繁体**，必须靠繁简对照表转成简体，
       * 否则入库的出处是繁体，跟简体名字永远匹配不上 —— 而且不会报错。
       *
       * 这里做一条通用规则：只要选了任意文本源，就自动把繁简对照表带上。
       * 不用每个源各自声明依赖，也就不会漏；以后新增文本源自动受保护。
       * 判断依据是「不是那几种特殊格式」，而不是「是诗词」——
       * 这样新格式也会被覆盖到。 */
      function isTextSource(s) {
        return !(s.format === 'fanti' || s.format === 'pinyin' ||
          s.format === 'xinhua' || s.format === 'shupin' ||
          s.format === 'fangyan' ||
          /* 新华字典四份数据也都不是「诗文」，
           * 不排除的话会被当成「文本源」而自动勾上繁简表 */
          s.format === 'xhbase' || s.format === 'xhpoly' ||
          s.format === 'xhcommon' || s.format === 'xhdetail');
      }
      var autoAdded = [];
      if (sources.some(isTextSource) &&
        !sources.some(function (s) { return s.id === 'fanti'; })) {
        var ft = NS.SOURCE_BY_ID['fanti'];
        if (ft) { sources.push(ft); autoAdded.push('fanti'); }
      }

      /* 大文件先下载，避免小文件下完在等大文件时误以为卡住；
       * 但标记了 first 的源（繁简表）必须最先处理，
       * 否则诗词会以「繁简表还不全」的状态被解析入库。 */
      sources.sort(function (a, b) {
        if (!!b.first !== !!a.first) return b.first ? 1 : -1;
        return (b.size || 0) - (a.size || 0);
      });

      ensureLoaded();
      var report = { success: [], failed: [], added: {}, autoAdded: autoAdded };

      return sources.reduce(function (chain, src) {
        return chain.then(function () {
          if (hooks.onSourceStart) hooks.onSourceStart(src);
          var t0 = Date.now();
          return NS.Net.fetchText(src, {
            onProgress: function (rec, total, pct) {
              if (hooks.onProgress) hooks.onProgress(src, rec, total, pct);
            }
          }).then(function (r) {
            var res = Lexicon.applyOne(src, r.text);
            report.success.push({
              id: src.id, name: src.name, added: res.added,
              ms: Date.now() - t0, bytes: r.bytes
            });
            report.added[src.id] = res.added;
            if (hooks.onSourceDone) hooks.onSourceDone(src, res, Date.now() - t0);
            return persist();
          }).catch(function (err) {
            report.failed.push({ id: src.id, name: src.name, error: err.message });
            if (hooks.onSourceError) hooks.onSourceError(src, err);
          });
        });
      }, Promise.resolve()).then(function () {
        Lexicon.meta = Lexicon.meta || {};
        Lexicon.meta.lastSync = new Date().toISOString();
        Lexicon.meta.sources = Lexicon.meta.sources || {};
        report.success.forEach(function (s) {
          Lexicon.meta.sources[s.id] = {
            at: Lexicon.meta.lastSync, added: s.added, name: s.name
          };
        });
        return persist().then(function () { return report; });
      });
    },

    /** 处理单个源并应用到运行时 */
    applyOne: function (src, text) {
      var added = 0;
      if (src.format === 'fanti') {
        var ft = Lexicon.parseFanti(text);
        added = Lexicon.applyFanti(ft.map);
        /* 繁简表补全后，把之前可能残留繁体的诗篇重转一次 */
        if (added) Lexicon.reconvertPoems();
      } else if (src.format === 'pinyin') {
        var py = Lexicon.parsePinyin(text);
        added = Lexicon.applyPinyin(py.map);
      } else if (src.format === 'xinhua') {
        var xh = Lexicon.parseXinhua(text);
        added = Lexicon.applyDict(xh.map);
        /* applyDict 内部已经回填过简体笔画，这里不必再叫一次 */
      } else if (src.format === 'xhbase') {
        added = Lexicon.applyXhBase(Lexicon.parseXhBase(text));
      } else if (src.format === 'xhpoly') {
        added = Lexicon.applyXhPoly(Lexicon.parseXhPoly(text));
      } else if (src.format === 'xhcommon') {
        added = Lexicon.applyXhCommon(Lexicon.parseXhCommon(text));
      } else if (src.format === 'xhdetail') {
        added = Lexicon.applyXhDetail(Lexicon.parseXhDetail(text));
      } else if (src.format === 'shupin') {
        var sp = NS.Dialect.parseShupin(text);
        added = NS.Dialect.applyShupin(sp.map);
      } else if (src.format === 'fangyan') {
        var fy = NS.Dialect.parseFangyan(text);
        added = NS.Dialect.applyFangyan(fy.words);
      } else {
        var pm = Lexicon.parsePoems(text, src);
        added = Lexicon.applyPoems(pm.poems);
      }
      return { added: added };
    },

    /* ---------------- 持久化与恢复 ---------------- */

    restore: function () {
      return NS.Store.ready.then(function () {
        /* 先查本地数据的格式版本。
         *
         * 用户反馈：「如果我有多个版本更新，上一个版本下载的联网词库
         * 要么保留合并，要么就给清理掉；不要每次打开网页或者更新版本
         * 都给我把手机内存占满了。」
         *
         * 在这之前没有任何版本判断，restore() 无条件读入本地数据 ——
         * 旧格式数据会被直接当成有效数据用，既可能产生怪结果，
         * 又永远占着空间没人清。
         *
         * 现在的规则（见 store.js 的 DATA_SCHEMA / MIN_COMPAT_SCHEMA）：
         *   兼容 → 原样沿用，只把版本号补上
         *   不兼容 → 清掉联网数据，保留用户自定义字，并留一条提示 */
        return NS.Store.get('meta').then(function (meta) {
          /* 完全没有本地数据（全新环境）→ 没有东西需要作废，直接跳过。
           * persist() 永远是把 meta 和其余数据一起写的，所以
           * meta 为空就等价于「本地没有任何可保留的数据」。 */
          if (!meta) return null;
          var st = NS.Store.schemaState(meta.schema);
          if (st.state === 'ok') return null;
          return Lexicon.discardIncompatible(st);
        });
      }).then(function () {
        return Promise.all([
          NS.Store.get('pinyinMap'), NS.Store.get('dict'),
          NS.Store.get('poems'), NS.Store.get('customChars'),
          NS.Store.get('meta'), NS.Store.get('fantiMap'),
          NS.Store.get('shupinMap'), NS.Store.get('dialectWords'),
          NS.Store.get('pinyinAll'), NS.Store.get('polyMap'),
          NS.Store.get('commonSet'), NS.Store.get('meanings')
        ]);
      }).then(function (r) {
        Lexicon.pinyinMap = r[0] || Object.create(null);
        Lexicon.dict = r[1] || Object.create(null);
        Lexicon.customChars = r[3] || [];
        Lexicon.meta = r[4] || {};
        Lexicon.fantiMap = r[5] || Object.create(null);
        /* 新华字典四份数据。老版本存过的是 undefined，
         * 这里给空对象，下面的读取一律走 isPolyphone/isCommon，
         * 它们能正确处理空表。 */
        Lexicon.pinyinAll = r[8] || Object.create(null);
        Lexicon.polyMap = r[9] || Object.create(null);
        Lexicon.commonSet = r[10] || Object.create(null);
        Lexicon.meanings = r[11] || Object.create(null);

        /* 方言数据：蜀拼字表与方言词汇 */
        if (r[6] && Object.keys(r[6]).length) NS.Dialect.applyShupin(r[6]);
        if (r[7] && r[7].length) NS.Dialect.applyFangyan(r[7]);

        /* 繁简表必须先合并，再让诗篇入库 */
        var fk = Object.keys(Lexicon.fantiMap);
        if (fk.length) {
          fk.forEach(function (k) { NS.FAN_JIAN[k] = Lexicon.fantiMap[k]; });
        }
        if (r[2] && r[2].length) NS.Poetry.addPoems(r[2]);
        /* 幂等：把可能残留繁体的旧数据再转一次 */
        if (fk.length) Lexicon.reconvertPoems();
        Lexicon.applyCustomChars();
        /* 字典是从本地存储恢复的，没走过 applyDict ——
         * 不上这一步，重启后 strokesSC 就全丢了，
         * 字形均衡会静默退回康熙笔画。 */
        Lexicon.applySimplifiedStrokes();
        return Lexicon.status();
      });
    },

    /**
     * 本地数据格式与当前程序不兼容：清掉**联网数据**，但保留用户自定义字。
     *
     * 为什么单独保留 customChars：那是用户在「按部首找字」里一个个手工挑进
     * 字库的，丢了是真实的损失；而联网数据（字典/诗词/拼音表）随时能重新同步，
     * 清掉只是麻烦一次。这个取舍对用户最有利。
     *
     * @param {Object} st schemaState() 的返回
     */
    discardIncompatible: function (st) {
      var keep = [];
      return NS.Store.get('customChars').then(function (cc) {
        keep = cc || [];
        /* 只删联网数据本身那几个键。**不能**用无参 clear()——
         * 那会连候选池一起删掉，而候选池跟数据格式版本毫无关系。 */
        var toClear = STORE_KEYS.filter(function (k) {
          return k !== 'customChars';
        });
        return NS.Store.clear(toClear);
      }).then(function () {
        /* clear 会把所有键删光，把自定义字放回去 */
        return keep.length ? NS.Store.set('customChars', keep) : null;
      }).then(function () {
        Lexicon.discardNotice = {
          state: st.state,             /* 'stale' | 'future' */
          saved: st.saved,
          current: st.current,
          keptCustomChars: keep.length
        };
        return null;
      });
    },

    /** 本地存储占用（字节），用于界面提示与判断是否需要清理 */
    usage: function () {
      return NS.Store.usage();
    },

    status: function () {
      return {
        poems: NS.Poetry.poems.length,
        builtinPoems: NS.Poetry.builtinCount,
        pinyinCount: Lexicon.pinyinMap ? Object.keys(Lexicon.pinyinMap).length : 0,
        dictCount: Lexicon.dict ? Object.keys(Lexicon.dict).length : 0,
        customChars: Lexicon.customChars ? Lexicon.customChars.length : 0,
        fantiCount: Lexicon.fantiMap ? Object.keys(Lexicon.fantiMap).length : 0,
        shupinCount: NS.Dialect.status().shupinCount,
        dialectWords: NS.Dialect.status().dialectWords,
        /* 新华字典四份数据的覆盖量 —— 界面靠它判断
         * 「能不能按部首浏览」「要不要提示去下载释义」 */
        pinyinAllCount: Lexicon.pinyinAll
          ? Object.keys(Lexicon.pinyinAll).length : 0,
        polyCount: Lexicon.polyMap
          ? Object.keys(Lexicon.polyMap).length : 0,
        commonCount: Lexicon.commonSet
          ? Object.keys(Lexicon.commonSet).length : 0,
        meaningCount: Lexicon.meanings
          ? Object.keys(Lexicon.meanings).length : 0,
        dialectReady: NS.Dialect.status().available,
        lastSync: (Lexicon.meta && Lexicon.meta.lastSync) || null,
        backend: NS.Store.getBackend(),
        /* 数据格式版本，界面用来解释「为什么本地数据被清了」 */
        schema: {
          saved: (Lexicon.meta && Lexicon.meta.schema) || null,
          current: NS.Store.DATA_SCHEMA
        },
        discardNotice: Lexicon.discardNotice
      };
    },

    /** 清空所有联网数据，回到内置字库状态 */
    reset: function () {
      /* 传键列表而不是用无参 clear()：候选池（namePool）不是联网词库，
       * 不该因为点了一下「清空联网词库」就没了。 */
      return NS.Store.clear(STORE_KEYS).then(function () {
        Lexicon.customChars.forEach(function (c) { delete NS.CHAR_DB[c.char]; });
        NS.CHAR_LIST = NS.CHAR_LIST.filter(function (c) {
          return !c.__inferred;
        });
        Lexicon.pinyinMap = Object.create(null);
        Lexicon.dict = Object.create(null);
        Lexicon.customChars = [];
        Lexicon.fantiMap = Object.create(null);
        Lexicon.pinyinAll = Object.create(null);
        Lexicon.polyMap = Object.create(null);
        Lexicon.commonSet = Object.create(null);
        Lexicon.meanings = Object.create(null);
        NS.Dialect.reset();
        Lexicon.meta = {};
        Lexicon.discardNotice = null;
        Lexicon.dataVersion++;
        /* 繁简表还原成内置版本 */
        NS.FAN_JIAN = Object.create(null);
        Object.keys(FAN_JIAN_BUILTIN).forEach(function (k) {
          NS.FAN_JIAN[k] = FAN_JIAN_BUILTIN[k];
        });
        /* 诗词回到内置篇目 */
        NS.RAW_POEMS.length = NS.Poetry.builtinCount;
        NS.Poetry.rebuild();
        /* 写回一个带当前 schema 的空 meta。
         * 不写的话下次启动会看到「有 meta 但版本缺失」，被判成旧数据走一遍
         * 清理流程 —— 虽然清的是空数据，但会给用户弹一条莫名其妙的
         * 「本地数据已清空，请重新同步」提示。 */
        return NS.Store.set('meta', { schema: NS.Store.DATA_SCHEMA });
      }).then(function () {
        return Lexicon.status();
      });
    }
  };

  function ensureLoaded() {
    if (!Lexicon.pinyinMap) Lexicon.pinyinMap = Object.create(null);
    if (!Lexicon.dict) Lexicon.dict = Object.create(null);
    if (!Lexicon.customChars) Lexicon.customChars = [];
    if (!Lexicon.fantiMap) Lexicon.fantiMap = Object.create(null);
    if (!Lexicon.pinyinAll) Lexicon.pinyinAll = Object.create(null);
    if (!Lexicon.polyMap) Lexicon.polyMap = Object.create(null);
    if (!Lexicon.commonSet) Lexicon.commonSet = Object.create(null);
    if (!Lexicon.meanings) Lexicon.meanings = Object.create(null);
  }

  function persist() {
    ensureLoaded();
    return Promise.all([
      NS.Store.set('pinyinMap', Lexicon.pinyinMap),
      NS.Store.set('dict', Lexicon.dict),
      NS.Store.set('customChars', Lexicon.customChars),
      NS.Store.set('fantiMap', Lexicon.fantiMap),
      NS.Store.set('pinyinAll', Lexicon.pinyinAll),
      NS.Store.set('polyMap', Lexicon.polyMap),
      NS.Store.set('commonSet', Lexicon.commonSet),
      NS.Store.set('meanings', Lexicon.meanings),
      NS.Store.set('shupinMap', NS.Dialect.shupinMap || Object.create(null)),
      NS.Store.set('dialectWords', NS.Dialect.dialectWords || []),
      NS.Store.set('poems', NS.RAW_POEMS.slice(NS.Poetry.builtinCount)
        .map(function (p) {
          return { source: p[0], title: p[1], content: p[2] };
        })),
      /* 盖上数据格式版本戳。下次启动靠它判断本地数据能不能沿用；
       * 不写这个字段的话，将来改了格式就只能靠容错去猜。 */
      NS.Store.set('meta', Object.assign({}, Lexicon.meta || {}, {
        schema: NS.Store.DATA_SCHEMA
      }))
    ]);
  }

  /* ---------------- 递归收集诗篇 ---------------- */

  /** 从节点里找出「段落数组」 */
  function paragraphArray(node) {
    var cands = [node.paragraphs, node.para, node.content];
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (typeof c === 'string' && c.trim()) return [c];
      if (Array.isArray(c) && c.length && typeof c[0] === 'string') return c;
    }
    return null;
  }

  function collect(node, out, ctx) {
    if (Array.isArray(node)) {
      node.forEach(function (n) { collect(n, out, ctx); });
      return;
    }
    if (!node || typeof node !== 'object') return;

    var paras = paragraphArray(node);
    if (paras) {
      var raw = paras.join('');
      var content = NS.toSimplified(raw);
      /* 丢掉空条目和零星碎片即可，阈值不能定高：
       * 《千字文》《声律启蒙》这类蒙书整篇都是四字、五字短句，
       * 阈值定高了会把整个数据源悄悄丢光。 */
      if (content.replace(/[^\u4e00-\u9fff]/g, '').length < 5) return;
      out.push({
        source: ctx.source,
        title: NS.toSimplified(node.title || node.chapter || node.rhythmic ||
          ctx.title || ''),
        author: NS.toSimplified(node.author || ctx.author || ''),
        content: content
      });
      return;
    }

    var childCtx = {
      source: ctx.source,
      title: node.title || ctx.title || '',
      author: node.author || ctx.author || ''
    };
    if (Array.isArray(node.content)) {
      node.content.forEach(function (c) { collect(c, out, childCtx); });
    } else if (node.content && typeof node.content === 'object') {
      collect(node.content, out, childCtx);
    }
  }

  /* ---------------- 导出 ---------------- */

  /** 导出成可直接内联的预置数据（打包固化用） */
  Lexicon.exportBaked = function () {
    ensureLoaded();
    var poems = NS.RAW_POEMS.slice(NS.Poetry.builtinCount)
      .map(function (p) {
        return { source: p[0], title: p[1], content: p[2] };
      });
    return {
      version: 1,
      meta: Lexicon.meta || {},
      pinyinMap: Lexicon.pinyinMap,
      dict: Lexicon.dict,
      customChars: Lexicon.customChars,
      fantiMap: Lexicon.fantiMap,
      shupinMap: NS.Dialect.shupinMap,
      dialectWords: NS.Dialect.dialectWords,
      poems: poems
    };
  };

  NS.Lexicon = Lexicon;
})(typeof window !== 'undefined' ? window : globalThis);
