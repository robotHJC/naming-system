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

  /** 某字是否属于给定的任一分组名 */
  function matchAny(ch, names) {
    if (!names || !names.length) return false;
    var idx = buildIndex();
    var hit = idx[ch];
    if (!hit) return false;
    for (var i = 0; i < hit.length; i++) {
      if (names.indexOf(NS.RADICAL_GROUPS[hit[i]].name) >= 0) return true;
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
   * 联网查询：从已同步的《新华字典》里列出某个部首下的字。
   *
   * 这是「联网找最合适的字」的实现方式 —— 字典给出了每个字的部首与简体笔画，
   * 因此可以按部首反查。返回的候选带着素材（笔画/拼音/释义），
   * 让用户自己判断要不要收进字库。
   *
   * @param {string} name 分组名（如 '艹'）
   * @param {Object} [opt] { minStrokes, maxStrokes, limit, excludeInLib }
   * @returns {{available:boolean, items:Array, total:number}}
   */
  function fromDict(name, opt) {
    opt = opt || {};
    var min = opt.minStrokes === undefined ? 4 : opt.minStrokes;
    var max = opt.maxStrokes === undefined ? 16 : opt.maxStrokes;
    var limit = opt.limit || 120;

    var lex = NS.Lexicon;
    var dict = lex && lex.dict;
    /* 注意：ensureLoaded() 之后 lex.dict 是个**空对象**而不是 null，
     * 所以不能只判真假 —— 必须看里面实际有没有字，
     * 否则没同步字典时会提示「字典里没找到这个部首」而不是
     * 「还没同步字典」，把用户往错误方向引。 */
    var dictCount = (lex && lex.status) ? (lex.status().dictCount || 0) : 0;
    if (!dict || !dictCount) {
      return { available: false, items: [], total: 0, suitableTotal: 0 };
    }

    var want = aliasOf(name);
    var looks = [];
    Object.keys(dict).forEach(function (ch) {
      if (ch.length !== 1) return;
      var d = dict[ch];
      if (!d) return;
      var rad = d[1];
      if (!rad || want.indexOf(rad) < 0) return;
      /* 字库里已有的不重复列出 */
      if (opt.excludeInLib !== false && NS.CHAR_DB[ch]) return;
      var py = (lex.pinyinMap && lex.pinyinMap[ch]) || null;
      /* 字典自己就带拼音（d[2]），拼音表只是用来补声调数字。
       * 早期版本要求「拼音表里必须有这个字」才算适合起名，
       * 结果只同步字典、没同步拼音表时，全部候选都被划成不适合（实测 0/92）。 */
      var pinyin = d[2] || (py ? py.pinyin : '');
      var strokes = d[0];
      var meaning = NS.Infer && NS.Infer.cleanExplanation
        ? NS.Infer.cleanExplanation(d[3] || '') : (d[3] || '');
      /* 字典释义常以「（形声。从辵…)」这类六书说明开头，对选字没帮助，
       * 而且会把界面上的释义占满（实测全是「(形声」）。 */
      meaning = String(meaning).replace(/^\s*[（(][^）)]*[）)]\s*/, '').trim();
      looks.push({
        char: ch,
        strokes: strokes,
        radical: rad,
        pinyin: pinyin,
        tone: py ? py.tone : 0,
        meaning: meaning,
        /* 适不适合起名：笔画 4–16、有读音、有释义 */
        suitable: strokes >= min && strokes <= max && !!meaning && !!pinyin
      });
    });

    looks.sort(function (a, b) {
      if (a.suitable !== b.suitable) return a.suitable ? -1 : 1;
      if (a.strokes !== b.strokes) return a.strokes - b.strokes;
      return a.char.localeCompare(b.char);
    });

    return {
      available: true,
      total: looks.length,
      suitableTotal: looks.filter(function (x) { return x.suitable; }).length,
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
    fromDict: fromDict,
    reset: reset
  };

})(typeof window !== 'undefined' ? window : globalThis);
