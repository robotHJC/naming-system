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

  var Poetry = {
    poems: [],
    index: Object.create(null),
    builtinCount: 0,
    _cache: Object.create(null),
    _cacheSize: 0,

    rebuild: function () {
      this.poems = (NS.RAW_POEMS || []).map(function (p) {
        return { source: p[0], title: p[1], content: p[2] };
      });
      this.index = Object.create(null);
      for (var i = 0; i < this.poems.length; i++) {
        var content = this.poems[i].content;
        var seen = Object.create(null);
        for (var j = 0; j < content.length; j++) {
          var ch = content.charAt(j);
          if (ch < '\u4e00' || ch > '\u9fff') continue;
          if (seen[ch]) continue;
          seen[ch] = 1;
          (this.index[ch] || (this.index[ch] = [])).push(i);
        }
      }
      this._cache = Object.create(null);
      this._cacheSize = 0;
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

    _search: function (chars) {
      /* 先按「诗篇列表长度」升序，最短的先求交，代价最小 */
      var lists = [];
      for (var i = 0; i < chars.length; i++) {
        var ids = this.index[chars[i]];
        if (!ids) return null;
        lists.push(ids);
      }
      lists.sort(function (a, b) { return a.length - b.length; });

      var candidates = lists[0];
      for (var k = 1; k < lists.length; k++) {
        var other = lists[k];
        var set = Object.create(null);
        for (var s = 0; s < other.length; s++) set[other[s]] = 1;
        var next = [];
        for (var c = 0; c < candidates.length; c++) {
          if (set[candidates[c]]) next.push(candidates[c]);
        }
        candidates = next;
        if (!candidates.length) return null;
      }

      var poem = this.poems[candidates[0]];
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
