/* =========================================================================
 * radical.js —— 偏旁重复检测
 *
 * 「李浅涵」三字全带氵、「李诗语」两字全带讠，这类名字念着不别扭，
 * 但写在纸上一排同偏旁会显得笨重，是取名时的常见忌讳。
 *
 * 只做提示，不参与评分、不淘汰结果：
 *   偏旁表只覆盖内置字库（278 字），联网扩充的字查不到。
 *   若拿它扣分，会让「联网加字」这件事暗中拉低分数，属于数据缺陷污染排序，
 *   因此这里只报告事实，是否在意由用户决定。
 * ========================================================================= */
(function (global) {
  'use strict';

  var NS = (global.NS = global.NS || {});

  var _index = null;   /* 字 → [分组下标, ...] */

  function buildIndex() {
    if (_index) return _index;
    _index = Object.create(null);
    var groups = NS.RADICAL_GROUPS || [];
    for (var g = 0; g < groups.length; g++) {
      var chars = groups[g].chars || '';
      for (var i = 0; i < chars.length; i++) {
        var c = chars.charAt(i);
        if (!_index[c]) _index[c] = [];
        if (_index[c].indexOf(g) < 0) _index[c].push(g);
      }
    }
    return _index;
  }

  /** 某字属于哪些偏旁分组，返回分组对象数组（通常 0 或 1 个） */
  function groupsOf(ch) {
    var idx = buildIndex();
    var hit = idx[ch];
    if (!hit) return [];
    return hit.map(function (g) { return NS.RADICAL_GROUPS[g]; });
  }

  /**
   * 检测偏旁重复。
   * @param {string[]|string} chars 名字用字（不含姓氏——姓氏是既定的，不参与挑选）
   * @returns {{dupes: Array, unknown: string[], covered: number, total: number}}
   *   dupes   —— [{name, label, chars:[...]}]，同一偏旁出现 ≥2 次的那些分组
   *   unknown —— 不在偏旁表里的字（联网扩充的字会出现在这里）
   */
  function check(chars) {
    var list = typeof chars === 'string' ? chars.split('') : (chars || []);
    var idx = buildIndex();
    var bucket = Object.create(null);
    var order = [];
    var unknown = [];
    var covered = 0;

    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var hit = idx[c];
      if (!hit || !hit.length) {
        if (unknown.indexOf(c) < 0) unknown.push(c);
        continue;
      }
      covered++;
      for (var k = 0; k < hit.length; k++) {
        var g = NS.RADICAL_GROUPS[hit[k]];
        if (!bucket[g.name]) {
          bucket[g.name] = { name: g.name, label: g.label, chars: [] };
          order.push(g.name);
        }
        bucket[g.name].chars.push(c);
      }
    }

    var dupes = [];
    for (var j = 0; j < order.length; j++) {
      if (bucket[order[j]].chars.length >= 2) dupes.push(bucket[order[j]]);
    }

    return {
      dupes: dupes,
      unknown: unknown,
      covered: covered,
      total: list.length
    };
  }

  /** 提示文案，例如「氵 重复（浅、涵）」 */
  function describe(res) {
    if (!res || !res.dupes.length) return '';
    return res.dupes.map(function (d) {
      return d.name + ' 重复（' + d.chars.join('、') + '）';
    }).join('；');
  }

  /** 偏旁表对内置字库的覆盖率，用于界面如实说明检测范围 */
  function coverage() {
    var idx = buildIndex();
    var list = NS.CHAR_LIST || [];
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      if (idx[list[i].char]) n++;
    }
    return { covered: n, total: list.length };
  }

  /* 判别用的部首名集合缓存：分组名 → {names:{...}, chars:{...}} */
  var _nameCache = null;

  function nameIndex() {
    if (_nameCache) return _nameCache;
    _nameCache = Object.create(null);
    (NS.RADICAL_GROUPS || []).forEach(function (g) {
      _nameCache[g.name] = {
        label: g.label || g.name,
        chars: g.chars || ''
      };
    });
    return _nameCache;
  }

  function isValidName(name) {
    return !!nameIndex()[name];
  }

  /**
   * 某字是否属于给定的任一分组名。
   *
   * **两个来源都要查**：
   *   1. RADICAL_GROUPS 手写表 —— 只覆盖内置 278 字，但精确
   *   2. Lexicon.dict 新华字典的「部首」字段 —— 覆盖约 1.6 万字
   *
   * 只查前者的话，从字典补进来的字（见 generator.expandByDictRadicals）
   * 一个都匹配不上，后续的 forceIn 会把它们全剪掉，等于白补。
   * 实测字典的部首字段用的就是简体形式（艹 / 氵 / 钅），
   * 与分组名直接相等，所以 aliasOf 同时兼顾了繁体变体。
   */
  function matchAny(ch, names) {
    if (!names || !names.length) return false;
    var idx = buildIndex();
    var hit = idx[ch];
    if (hit) {
      for (var i = 0; i < hit.length; i++) {
        if (names.indexOf(NS.RADICAL_GROUPS[hit[i]].name) >= 0) return true;
      }
    }
    var lex = NS.Lexicon;
    var d = lex && lex.dict ? lex.dict[ch] : null;
    if (d && d[1]) {
      for (var j = 0; j < names.length; j++) {
        if (aliasOf(names[j]).indexOf(d[1]) >= 0) return true;
      }
    }
    return false;
  }

  /** 给定字表里属于某分组的字 */
  function charsOf(name, list) {
    var g = nameIndex()[name];
    if (!g) return [];
    var src = list || (NS.CHAR_LIST || []).map(function (c) { return c.char; });
    var out = [];
    for (var i = 0; i < src.length; i++) {
      if (g.chars.indexOf(src[i]) >= 0) out.push(src[i]);
    }
    return out;
  }

  /** 每个分组在字库里有多少字 —— 界面上要如实告诉用户选择空间有多大 */
  function poolCounts() {
    var counts = Object.create(null);
    (NS.RADICAL_GROUPS || []).forEach(function (g) {
      counts[g.name] = charsOf(g.name).length;
    });
    return counts;
  }

  /**
   * 从字库反推「五行 → 部首」。
   *
   * 为什么不硬编码：字库里各偏旁组的五行并不都是齐的。
   * 统计全库后主导五行占比：
   *   氵 木 艹 钅 日 山 土 雨 竹 刂 冫 鸟 贝 禾 彳 辶 囗   → 全部 100%
   *   王 96%（瑛 是土）   火 93%（然 是金）
   *   女 78%   忄 67%   宀 50%   亻 44%   口 40%   心/彡/讠 混杂
   * 也就是说「喜用神是土 → 建议单人旁」在数据上站不住脚，
   * 所以这里按阈值筛，只把真正齐整的分组拿出来推荐（默认 ≥90%）。
   *
   * @param {number} [threshold] 主导五行占比下限，默认 0.9
   * @returns {Object} { 金:[{name,label,share,n}...], 木:[...], ... }
   */
  function wuxingMap(threshold) {
    var th = threshold === undefined ? 0.9 : threshold;
    var map = { '金': [], '木': [], '水': [], '火': [], '土': [] };
    (NS.RADICAL_GROUPS || []).forEach(function (g) {
      var dist = Object.create(null);
      var total = 0;
      for (var i = 0; i < g.chars.length; i++) {
        var info = NS.CHAR_DB && NS.CHAR_DB[g.chars.charAt(i)];
        if (!info) continue;
        dist[info.wuxing] = (dist[info.wuxing] || 0) + 1;
        total++;
      }
      if (!total) return;
      var best = null, bestN = 0;
      Object.keys(dist).forEach(function (w) {
        if (dist[w] > bestN) { bestN = dist[w]; best = w; }
      });
      if (best && map[best] && bestN / total >= th) {
        map[best].push({
          name: g.name, label: g.label,
          share: bestN / total, n: total
        });
      }
    });
    Object.keys(map).forEach(function (w) {
      map[w].sort(function (a, b) {
        if (b.share !== a.share) return b.share - a.share;
        return b.n - a.n;
      });
    });
    return map;
  }

  /** 按「字库内字数从多到少」排好的候选部首列表，供界面出选项 */
  function pickerList() {
    var counts = poolCounts();
    var order = NS.RADICAL_PICKER_ORDER || [];
    var names = order.filter(function (n) { return counts[n] > 0; });
    /* 没列进 order 但确实有字的分组也补上，避免漏掉 */
    (NS.RADICAL_GROUPS || []).forEach(function (g) {
      if (names.indexOf(g.name) < 0 && counts[g.name] > 0) names.push(g.name);
    });
    return names.map(function (n) {
      return { name: n, label: nameIndex()[n].label, count: counts[n] };
    }).sort(function (a, b) { return b.count - a.count; });
  }

  /* ---------------- 联网字典里的部首 ---------------- */

  /* 字典的部首字段用的是传统部首字（水 而非 氵、玉 而非 王），
   * 所以按分组名查字典时必须把两种写法都试一遍。 */
  var RADICAL_ALIAS = {
    '氵': ['水'], '忄': ['心'], '讠': ['言'], '钅': ['金', '釒'],
    '王': ['玉'], '亻': ['人'], '辶': ['辵'], '刂': ['刀'],
    '纟': ['糸', '糹'], '贝': ['貝'], '鸟': ['鳥'], '艹': ['艸'],
    '竹': ['竹'], '月': ['月'], '阝': ['阜', '邑'], '灬': ['火'],
    '扌': ['手'], '犭': ['犬'], '饣': ['食'], '车': ['車'],
    '马': ['馬'], '鱼': ['魚'], '页': ['頁'], '见': ['見'], '门': ['門']
  };

  function aliasOf(name) {
    var extra = RADICAL_ALIAS[name] || [];
    return [name].concat(extra);
  }

  /**
   * 把「分组名」或「界面标签」都归一成分组名。
   * 界面上偏旁选择器用的是 label（草字头 / 三点水），
   * 而字典里的部首字段是 艹 / 水，中间必须转一道。
   *
   * 标签并不总是干净的一个词 ——「氵」的标签是**「三点水 / 水字底」**
   * （带斜杠和第二种写法），「火」是「火字旁 / 四点底」。
   * 实测只做字符串相等比较时，传「三点水」查不到任何字
   * （返回 0 个，而「氵」能查到 1027 个）。所以拆斜杠、生成多种写法备选。
   */
  function labelKeys(label) {
    var out = [];
    String(label || '').split(/[\/／、|·]/).forEach(function (raw) {
      var s = raw.replace(/\s+/g, '');
      if (!s) return;
      if (out.indexOf(s) < 0) out.push(s);
      /* 「水字底」→「水」、「草字头」→「草」：两种写法都留着，
       * 因为上层可能传「草字头」也可能传「草」 */
      var t = s.replace(/字?[旁头底]$/, '');
      if (t && t !== s && out.indexOf(t) < 0) out.push(t);
    });
    return out;
  }

  function resolveName(name) {
    var idx = nameIndex();
    if (idx[name]) return name;
    var groups = NS.RADICAL_GROUPS || [];
    var want = String(name || '').replace(/\s+/g, '');
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      if (g.label === name) return g.name;
      /* 精确标签对不上时才拆写法 —— 放在最后一道，
       * 免得「草」这类短写法误匹配到别的分组 */
      if (labelKeys(g.label).indexOf(want) >= 0) return g.name;
    }
    return name;
  }

  /** 这个字在已同步的诗词里出现过吗 —— 区分「苯」与「兰」的唯一可用信号 */
  function hasLiteraryUse(ch) {
    var P = NS.Poetry;
    if (!P || !P.index) return false;
    var ids = P.index[ch];
    return !!(ids && ids.length);
  }

  /**
   * 从新华字典挑候选字 —— 「按部首找字」与「只在新华字典里取名」
   * 共用这**同一套**逻辑。
   *
   * 分开写两份必然跑偏：一边按「笔画少」排、一边按「热门」排，
   * 用户会看到同一个部首在两个地方给出完全不同的字。
   *
   * 排序：适不适合起名 → 有没有依据（一级常用字 / 诗词里出现过）→ 笔画少 → 码位。
   * 艹 部在字典里有 932 字，按码位排前排全是 艽芁艻艿 这种没人用的字；
   * 有依据的排前面，前 20 个就正好是 艺节芒芋芭芬芙花芥芦芹苇芜芯芽苞范苟茄茎苛苦茅苗。
   *
   * @param {Object} [opt]
   *   aliases      部首写法集合（已用 aliasOf 展开）；不传 = 不限部首
   *   excludeInLib 排除字库里已有的字（默认 true）
   *   minStrokes / maxStrokes  适不适合起名的笔画区间（默认 4–16）
   *   order        'strokes'（默认，浏览用）| 'heat'（整本字典当来源时用）
   * @returns {{available:boolean, items:Array}}
   */
  function dictCandidates(opt) {
    opt = opt || {};
    var min = opt.minStrokes === undefined ? 4 : opt.minStrokes;
    var max = opt.maxStrokes === undefined ? 16 : opt.maxStrokes;
    var lex = NS.Lexicon;
    var dict = lex && lex.dict;
    /* 注意：ensureLoaded() 之后 lex.dict 是个**空对象**而不是 null，
     * 所以不能只判真假 —— 必须看里面实际有没有字，
     * 否则没同步字典时会提示「字典里没找到这个部首」而不是
     * 「还没同步字典」，把用户往错误方向引。 */
    var dictCount = (lex && lex.status) ? (lex.status().dictCount || 0) : 0;
    if (!dict || !dictCount) return { available: false, items: [] };

    var want = opt.aliases || null;
    var looks = [];
    Object.keys(dict).forEach(function (ch) {
      if (ch.length !== 1) return;
      var d = dict[ch];
      if (!d) return;
      var rad = d[1];
      if (want && (!rad || want.indexOf(rad) < 0)) return;
      /* 字库里已有的不重复列出 */
      if (opt.excludeInLib !== false && NS.CHAR_DB[ch]) return;
      var py = (lex.pinyinMap && lex.pinyinMap[ch]) || null;
      /* 字典自己就带拼音（d[2]），拼音表只是用来补声调数字。
       * 早期版本要求「拼音表里必须有这个字」才算适合起名，
       * 结果只同步字典、没同步拼音表时，全部候选都被划成不适合（实测 0/92）。 */
      var pinyin = d[2] || (py ? py.pinyin : '');
      var strokes = d[0];
      /* 释义清洗只走 Lexicon.cleanMeaning 一套规则（配平拆括号 + 压行 + 截断）。
       * 以前这里先跑 Infer.cleanExplanation 再自己拿正则去括号：
       * 前者会按第一个句号截断，后者会在内层括号的 ) 上提前收尾，
       * 「苟」的释义就被切成了「声。本义:草名。又:菜名) 同本义。」 */
      var meaning = lex.cleanMeaning
        ? lex.cleanMeaning(d[3] || '')
        : String(d[3] || '').replace(/\s+/g, ' ').trim();

      var allPy = (lex.readingsOf && lex.readingsOf(ch)) || [];
      var poly = !!(lex.isPolyphone && lex.isPolyphone(ch));
      var common = !!(lex.isCommon && lex.isCommon(ch));
      var lit = hasLiteraryUse(ch);
      /* 冷热度：内置热度表只盖 490 字，其余靠诗词频次估。 */
      var heat = NS.heatOf ? NS.heatOf(ch) : 0;
      /* 「不宜入名」人工表（data/namefilter.js）。
       * 「不」「把」「办」「抱」这些字在诗词里出现次数极高、又是一级常用字，
       * 任何统计量都拦不住 —— 实测不做这一步，整本字典取名会输出
       * 「李层抱」「李悲到」。 */
      var blk = NS.nameCharBlock ? NS.nameCharBlock(ch) : { blocked: false };

      looks.push({
        char: ch,
        strokes: strokes,
        radical: rad,
        pinyin: pinyin,
        tone: py ? py.tone : 0,
        meaning: meaning,
        /* 多音字：这是旧字典源给不出的信息，现在能如实标出来 */
        poly: poly,
        allPinyin: allPy.length > 1 ? allPy : null,
        /* 《通用规范汉字表》一级字表（3500 字）—— 注意它只是参考，不是门槛：
         * 芷/菡/萏/茹/芸/芮/芊/萱 都不在这个表里，却都是好名字用字。 */
        common: common,
        /* 诗词里出现过 —— 与上一列构成「有没有依据」 */
        literary: lit,
        /* 逐读音释义，界面上展开看细节用 */
        meanings: (lex.meaningsOf && lex.meaningsOf(ch)) || [],
        heat: heat,
        blocked: blk.blocked,
        blockReason: blk.reason || '',
        hasMeaning: !!meaning,
        notable: common || lit,
        /* 适不适合起名：笔画 4–16、有读音、不在「不宜入名」表里。
         *
         * **刻意不要求有释义**：释义是 13MB 的可选数据，很多人不会下载。
         * 要求它会导致没下释义时「字典当用字来源」静默失效 ——
         * 实测就是这样：整本字典补不进一个字，用户看到的是名字毫无变化，
         * 完全不知道是少了哪份数据。所以释义只作为显示信息，
         * 质量筛选交给 notable 与人工的不宜入名表。
         *
         * blocked 单独留一份，界面可以显示「为什么没推荐它」。 */
        suitable: !blk.blocked && strokes >= min && strokes <= max && !!pinyin
      });
    });

    /* order='heat' 用于「整本字典当用字来源」：
     * 那时没有部首约束，按笔画排会挑出一堆「一丁七丈上不」这类。
     * 按热排才能得到 涵轩萱桸桦… 这样真正像名字的字。 */
    var byHeat = opt.order === 'heat';
    looks.sort(function (a, b) {
      if (a.suitable !== b.suitable) return a.suitable ? -1 : 1;
      /* 有依据的排前面：一级常用字 / 诗词里出现过 */
      if (a.notable !== b.notable) return a.notable ? -1 : 1;
      if (byHeat && b.heat !== a.heat) return b.heat - a.heat;
      if (a.strokes !== b.strokes) return a.strokes - b.strokes;
      return a.char.localeCompare(b.char);
    });

    return { available: true, items: looks };
  }

  /**
   * 联网查询：列出某个部首下的字。
   *
   * @param {string} name 分组名（'艹'）或界面标签（'草字头'）
   * @param {Object} [opt] { minStrokes, maxStrokes, limit, excludeInLib }
   * @returns {{available:boolean, items:Array, total:number}}
   */
  function fromDict(name, opt) {
    opt = opt || {};
    var limit = opt.limit || 120;
    var resolved = resolveName(name);
    var r = dictCandidates({
      aliases: aliasOf(resolved),
      excludeInLib: opt.excludeInLib,
      minStrokes: opt.minStrokes,
      maxStrokes: opt.maxStrokes
    });
    if (!r.available) {
      return { available: false, items: [], total: 0, suitableTotal: 0 };
    }
    var looks = r.items;
    return {
      available: true,
      name: resolved,
      total: looks.length,
      suitableTotal: looks.filter(function (x) { return x.suitable; }).length,
      notableTotal: looks.filter(function (x) { return x.suitable && x.notable; })
        .length,
      polyTotal: looks.filter(function (x) { return x.poly; }).length,
      blockedTotal: looks.filter(function (x) { return x.blocked; }).length,
      items: looks.slice(0, limit)
    };
  }

  function reset() { _index = null; _nameCache = null; }

  NS.Radical = {
    groupsOf: groupsOf,
    check: check,
    describe: describe,
    coverage: coverage,
    isValidName: isValidName,
    matchAny: matchAny,
    charsOf: charsOf,
    poolCounts: poolCounts,
    wuxingMap: wuxingMap,
    pickerList: pickerList,
    aliasOf: aliasOf,
    resolveName: resolveName,
    fromDict: fromDict,
    dictCandidates: dictCandidates,
    hasLiteraryUse: hasLiteraryUse,
    reset: reset
  };

})(typeof window !== 'undefined' ? window : globalThis);
