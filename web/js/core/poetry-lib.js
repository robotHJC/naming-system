/* =========================================================================
 * poetry-lib.js —— 诗词出处检索（支持联网动态扩充）
 *
 * 查找策略（联网扩充后可能有上万首诗，必须优化）：
 *   1. 优先从「诗篇列表最短」的那个字开始求交集，先把候选压到最小；
 *   2. 按参与字排序后的组合做记忆化，同一组合不重复计算；
 *   3. 找不到就返回 null，不猜、不编。
 * ========================================================================= */
(function (global) {
  'use strict';
  var NS = (global.NS = global.NS || {});

  var SPLIT_RE = /[，。！？；、\n\r]/;
  var CACHE_LIMIT = 300000;

  function isCJK(ch) {
    return ch >= '\u4e00' && ch <= '\u9fff';
  }

  /* 否定词：如果一对相邻字的前一个字是这些，说明它们是词组的后半截，
   * 不能当成独立的二字词。
   * 实测：楚辞「终刚强兮不可凌」会被切成「可凌」并当成出处，
   * 于是排出了一个叫「李可凌」的名字 —— 那其实是「不可 + 凌」。 */
  var NEGATION = {
    '不': 1, '无': 1, '未': 1, '非': 1, '莫': 1, '勿': 1,
    '弗': 1, '毋': 1, '蓞': 1, '岂': 1, '奚': 1, '亡': 1
  };

  var Poetry = {
    poems: [],
    index: Object.create(null),
    /* 句内相邻二字 → 首次出现的诗篇下标。
     * 这是「出处」真正有区分度的那一层：
     * 光是「两个字都出现在某一首诗里」在诗词库扩到上千首之后几乎必然命中
     * （实测默认参数下 20/20 全部有出处），等于没有信息；
     * 而两个字在某一「句」里紧挨着出现，基本就是一个现成的词
     * （「静姝」「思齐」「望舒」「琼琚」都是这种）。 */
    bigrams: Object.create(null),
    bigramCount: 0,
    builtinCount: 0,
    _cache: Object.create(null),
    _cacheSize: 0,
    _lineCache: Object.create(null),
    _lineCacheSize: 0,

    rebuild: function () {
      this.poems = (NS.RAW_POEMS || []).map(function (p) {
        return { source: p[0], title: p[1], content: p[2] };
      });
      this.index = Object.create(null);
      this.bigrams = Object.create(null);
      this.bigramCount = 0;
      this.bigramClassic = 0;

      /* 每个集合算不算「适合取名的经典来源」，预先算好避免内层重复判断 */
      var classic = this.poems.map(function (p) {
        return NS.isClassicSource ? NS.isClassicSource(p.source) : true;
      });

      for (var i = 0; i < this.poems.length; i++) {
        var content = this.poems[i].content;
        var seen = Object.create(null);
        for (var j = 0; j < content.length; j++) {
          var ch = content.charAt(j);
          if (!isCJK(ch)) continue;
          if (seen[ch]) continue;
          seen[ch] = 1;
          (this.index[ch] || (this.index[ch] = [])).push(i);
        }
        /* 建「句内相邻二字」索引：按标点切句，只在句内取相邻对 */
        var lines = content.split(SPLIT_RE);
        for (var li = 0; li < lines.length; li++) {
          var line = lines[li].trim();
          for (var m = 0; m + 1 < line.length; m++) {
            var a = line.charAt(m), b = line.charAt(m + 1);
            if (!isCJK(a) || !isCJK(b)) continue;
            /* 前一个字是否定词 → 这一对是词组的后半截，不入索引 */
            if (m > 0 && NEGATION[line.charAt(m - 1)]) continue;
            var key = a + b;
            if (this.bigrams[key] === undefined) {
              this.bigrams[key] = i;
              this.bigramCount++;
              if (classic[i]) this.bigramClassic++;
            } else if (classic[i] && !classic[this.bigrams[key]]) {
              /* 已经收录过，但来源是蒙书/散文类；换成经典出处。
               * 只存一个下标，所以内存不因此翻倍。 */
              this.bigrams[key] = i;
            }
          }
        }
      }
      this._cache = Object.create(null);
      this._cacheSize = 0;
      this._lineCache = Object.create(null);
      this._lineCacheSize = 0;
      return this;
    },

    /** 追加诗篇（联网同步用），返回实际新增数量 */
    addPoems: function (list) {
      if (!list || !list.length) return 0;
      var existing = Object.create(null);
      this.poems.forEach(function (p) {
        existing[p.content.slice(0, 32)] = 1;
      });
      var added = 0;
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        if (!p || !p.content) continue;
        var key = p.content.slice(0, 32);
        if (existing[key]) continue;
        existing[key] = 1;
        NS.RAW_POEMS.push([p.source || '', p.title || '', p.content]);
        added++;
      }
      if (added) this.rebuild();
      return added;
    },

    /** 找出同时包含 chars 全部字的诗 → {source,title,line} | null */
    findSource: function (chars) {
      if (!chars || !chars.length) return null;
      if (chars.length === 1) return this._one(chars[0]);

      var key = chars.slice().sort().join('');
      if (key in this._cache) return this._cache[key];

      var result = this._search(chars);

      if (this._cacheSize > CACHE_LIMIT) {
        this._cache = Object.create(null);
        this._cacheSize = 0;
      }
      this._cache[key] = result;
      this._cacheSize++;
      return result;
    },

    _one: function (ch) {
      var ids = this.index[ch];
      if (!ids || !ids.length) return null;
      var poem = this.poems[ids[0]];
      return {
        source: poem.source, title: poem.title,
        line: this.extractLine(poem.content, [ch])
      };
    },

    /**
     * 句内相邻成词：名字里有一对**顺序相同**且紧挨着的字在诗里也这样出现过。
     * 两字名查一次，三字名依次查两个相邻对。
     *
     * 只认正序。早期版本允许反向（查 b+a）来多凑命中，结果把「望林」变成了
     * 「林望」、「白水」变成了「水白」、「每一念」变成了「念一」——
     * 字序一反词义就完全变了，那不是出处，是巧合。如今宁可少给。
     *
     * @returns {{source,title,line,pair,classic}|null}
     */
    findAdjacent: function (chars) {
      if (!chars || chars.length < 2) return null;
      for (var i = 0; i + 1 < chars.length; i++) {
        var hit = this._pair(chars[i], chars[i + 1]);
        if (hit) return hit;
      }
      return null;
    },

    _pair: function (a, b) {
      var idx = this.bigrams[a + b];
      if (idx === undefined) return null;
      var poem = this.poems[idx];
      return {
        source: poem.source,
        title: poem.title,
        line: this._lineWith(poem.content, a + b),
        pair: a + b,
        classic: NS.isClassicSource ? NS.isClassicSource(poem.source) : true
      };
    },

    /** 在诗里找「含这个二字词」的那一句原文 */
    _lineWith: function (content, pair) {
      var lines = content.split(SPLIT_RE);
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].indexOf(pair) >= 0) return lines[i].trim();
      }
      return this.extractLine(content, pair.split(''));
    },

    /**
     * 同一句里同时含全部字（比「同篇」强，比「相邻」弱）。
     * 只扫前若干个候选篇，避免在大诗词库上退化成全量扫描。
     */
    findLine: function (chars) {
      if (!chars || chars.length < 2) return null;
      var key = 'L' + chars.slice().sort().join('');
      if (key in this._lineCache) return this._lineCache[key];
      var result = this._findLine(chars);
      if (this._lineCacheSize > CACHE_LIMIT) {
        this._lineCache = Object.create(null);
        this._lineCacheSize = 0;
      }
      this._lineCache[key] = result;
      this._lineCacheSize++;
      return result;
    },

    _findLine: function (chars) {
      var cands = this._candidates(chars);
      if (!cands) return null;
      var LIMIT = 40;
      for (var i = 0; i < cands.length && i < LIMIT; i++) {
        var poem = this.poems[cands[i]];
        var lines = poem.content.split(SPLIT_RE);
        for (var j = 0; j < lines.length; j++) {
          var line = lines[j].trim();
          if (!line) continue;
          var ok = true;
          for (var k = 0; k < chars.length; k++) {
            if (line.indexOf(chars[k]) < 0) { ok = false; break; }
          }
          if (ok) {
            return { source: poem.source, title: poem.title, line: line };
          }
        }
      }
      return null;
    },

    /** 同时含全部字的诗篇下标数组；无则 null */
    _candidates: function (chars) {
      var lists = [];
      for (var i = 0; i < chars.length; i++) {
        var ids = this.index[chars[i]];
        if (!ids) return null;
        lists.push(ids);
      }
      lists.sort(function (a, b) { return a.length - b.length; });
      var candidates = lists[0];
      for (var k = 1; k < lists.length; k++) {
        var set = Object.create(null);
        for (var s = 0; s < lists[k].length; s++) set[lists[k][s]] = 1;
        var next = [];
        for (var c = 0; c < candidates.length; c++) {
          if (set[candidates[c]]) next.push(candidates[c]);
        }
        candidates = next;
        if (!candidates.length) return null;
      }
      return candidates;
    },

    _search: function (chars) {
      var cands = this._candidates(chars);
      if (!cands) return null;
      var poem = this.poems[cands[0]];
      return {
        source: poem.source,
        title: poem.title,
        line: this.extractLine(poem.content, chars)
      };
    },

    extractLine: function (content, chars) {
      var lines = content.split(SPLIT_RE);
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        var ok = true;
        for (var j = 0; j < chars.length; j++) {
          if (line.indexOf(chars[j]) < 0) { ok = false; break; }
        }
        if (ok) return line;
      }
      /* 退化：返回含第一个字的句子 */
      for (var k = 0; k < lines.length; k++) {
        if (lines[k].trim() && lines[k].indexOf(chars[0]) >= 0) {
          return lines[k].trim();
        }
      }
      return content.slice(0, 50);
    }
  };

  NS.Poetry = Poetry.rebuild();
  NS.Poetry.builtinCount = NS.Poetry.poems.length;

  NS.PoetryFind = function (chars) {
    return NS.Poetry.findSource(chars);
  };
})(typeof window !== 'undefined' ? window : globalThis);
