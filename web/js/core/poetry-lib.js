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

  /* 「日常词语」判定阈值：相邻二字在整个诗库里出现到这么多次，
   * 就认为它是日常词语而不是雅词，不再算「出处成词」（见 score.js 第 7 项）。
   *
   * 阈值 3 是看**实测分布**定的，不是拍的（见 tests/audit-pairfreq.js）：
   *
   *   35 首内置诗（388 个相邻对）：
   *      明月 5 次、君子/疑是/花落 2 次、其余 384 个各 1 次
   *   联网同步到约 1900 首后，日常词会升到几十次，而《诗经》《楚辞》里的
   *   雅词基本仍是 1-3 次。
   *
   * 必须说清楚的一点：**这个机制只在联网同步后才真正生效**。
   * 只有 35 首内置诗时，「风雨」「潮水」「江潮」的词频都只有 1，
   * 一个都不会被判为日常词语 —— 我原本在注释里写了一套更漂亮的分布数字，
   * 实测后发现是错的，已按真实数据改正。
   * 所以离线状态下「普通名词被当成出处」的问题只能靠
   * score.js 里的「现代感」权重来对冲，不能指望这里。 */
  var COMMON_PAIR_THRESHOLD = 3;

  function isCJK(ch) {
    return ch >= '\u4e00' && ch <= '\u9fff';
  }

  /* 否定词：如果一对相邻字的前一个字是这些，说明它们是词组的后半截，   * 不能当成独立的二字词。
   * 实测：楚辞「终刚强兮不可凌」会被切成「可凌」并当成出处，
   * 于是排出了一个叫「李可凌」的名字 —— 那其实是「不可 + 凌」。 */
  var NEGATION = {
    '不': 1, '无': 1, '未': 1, '非': 1, '莫': 1, '勿': 1,
    '弗': 1, '毋': 1, '蓞': 1, '岂': 1, '奚': 1, '亡': 1
  };
  /* 文言虚词：只要一对相邻字里出现这些字，就**不算**成词。
   *
   * 这是「名字太文绉绉」的根源之一。古文里「亦书」「唯昭」「而且」这类
   * 相邻搭配随处可见，但它们不是词，只是虚词连着实词。
   * 早期没有这层过滤，实测排出来的正是：
   *   李亦白 ← 诗经「亦白其马」      李唯昭 ← 楚辞「唯昭质其犹未亏」
   * 读起来一股文言腔，不是现代人取名的语感。
   *
   * 注意这张表只影响「算不算成词拿加分」，**不影响这些字能否被选用** ——
   * 想用「亦」「唯」起名完全可以，只是系统不会再拿古文里的虚词搭配
   * 给它背书。 */
  var FUNCTION_WORD = {
    '之': 1, '而': 1, '其': 1, '以': 1, '于': 1, '於': 1, '为': 1, '爲': 1,
    '所': 1, '者': 1, '也': 1, '乎': 1, '哉': 1, '兮': 1, '乃': 1, '则': 1,
    '焉': 1, '矣': 1, '夫': 1, '盖': 1, '蓋': 1, '唯': 1, '惟': 1, '且': 1,
    '与': 1, '與': 1, '及': 1, '犹': 1, '猶': 1, '尚': 1, '苟': 1, '使': 1,
    '令': 1, '俾': 1, '敢': 1, '请': 1, '請': 1, '愿': 1, '願': 1, '得': 1,
    '能': 1, '欲': 1, '亦': 1, '不': 1, '无': 1, '無': 1, '未': 1, '非': 1,
    '莫': 1, '勿': 1, '弗': 1, '毋': 1, '岂': 1, '豈': 1, '奚': 1, '曷': 1,
    '乎': 1, '耶': 1, '邪': 1, '耳': 1, '云': 0   /* 云 是常用名字，保留 */
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
    /* 「按来源聚字」的缓存。诗篇数量一变就失效（联网同步会改变它）。 */
    _charsBySrc: null,
    _charsBySrcN: -1,

    rebuild: function () {
      this.poems = (NS.RAW_POEMS || []).map(function (p) {
        return { source: p[0], title: p[1], content: p[2] };
      });
      this.index = Object.create(null);
      this.bigrams = Object.create(null);
      this.bigramCount = 0;
      this.bigramClassic = 0;
      /* 相邻二字的出现次数。
       *
       * 为什么要统计这个：「两个字在古诗里相邻」本身只是好名字的**代理指标**，
       * 它同样会命中「风雨」「潮水」「江潮」这类**日常词语** ——
       * 这些词在几千首诗里反复出现，作为出处毫无信息量，
       * 而真正的雅词（望舒、琼珈、静姝）全库里只出现一两次。
       *
       * 实测（郝姓 + 木水喜用）：「郝风雨」「郝潮水」「郝江潮」原本都靠
       * 出处满 12 分挤进前八，但它们其实只是普通名词，根本不像名字。
       * 有了词频就能把两者分开（见 COMMON_PAIR_THRESHOLD）。 */
      this.pairFreq = Object.create(null);

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
            /* 含文言虚词 → 不是词，只是虚词连着实词（亦书／唯昭） */
            if (FUNCTION_WORD[a] || FUNCTION_WORD[b]) continue;
            var key = a + b;
            this.pairFreq[key] = (this.pairFreq[key] || 0) + 1;
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
      /* 标出「日常词语」：出现次数达到阈值的相邻对。
       * 它们仍然可用于「同句/同篇」判定，但不再算「出处成词」。
       * 阈值是看分布定的，不是拍的，见 tests/poetry-freq.test.js。 */
      this.commonPairs = Object.create(null);
      this.commonPairCount = 0;
      var self = this;
      Object.keys(this.pairFreq).forEach(function (k) {
        if (self.pairFreq[k] >= COMMON_PAIR_THRESHOLD) {
          self.commonPairs[k] = 1;
          self.commonPairCount++;
        }
      });
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

    /**
     * 按来源聚出「这个源里出现过哪些字」。
     *
     * 用途：「按词库筛选名字」—— 勾了《诗经》就只从《诗经》出现过的
     * 字里选字。用户需求原文：「允许用户可以指定在某一个或者某几个
     * 词库里面筛选名字」。
     *
     * 为什么要缓存在这里：要扫完全部诗篇（几千首 × 每首几十字）。
     * 放在评分里算会被每个候选组合重算一遍；缓存后只在诗篇数量
     * 变化时重算。
     *
     * 注意 poems 里存的 source 是**显示名**（「诗经」），不是源 id ——
     * 调用方自己做 id → 显示名 的映射（见 generator 的 resolveCharPool）。
     *
     * @returns {Object} { 源名: { 字: 1 } }
     */
    charsBySource: function () {
      if (this._charsBySrc && this._charsBySrcN === this.poems.length) {
        return this._charsBySrc;
      }
      var map = Object.create(null);
      this.poems.forEach(function (p) {
        var s = p.source || '(未标注出处)';
        var set = map[s] || (map[s] = Object.create(null));
        var t = p.content || '';
        for (var i = 0; i < t.length; i++) {
          var ch = t.charAt(i);
          if (isCJK(ch)) set[ch] = 1;
        }
      });
      this._charsBySrc = map;
      this._charsBySrcN = this.poems.length;
      return map;
    },

    /** 列出实际含诗篇的来源名（供界面只显示「已同步、可用」的源） */
    availableSourceNames: function () {
      return Object.keys(this.charsBySource());
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
      var key = a + b;
      var idx = this.bigrams[key];
      if (idx === undefined) return null;
      var poem = this.poems[idx];
      return {
        source: poem.source,
        title: poem.title,
        line: this._lineWith(poem.content, key),
        pair: key,
        classic: NS.isClassicSource ? NS.isClassicSource(poem.source) : true,
        /* 日常词语标记。true 表示这一对在诗库里反复出现，
         * 作为「出处」没有信息量（风雨／潮水／明月）。 */
        everyday: this.commonPairs[key] === 1 ? true : false,
        freq: this.pairFreq[key] || 0
      };
    },

    /** 相邻二字词频排行（调阈值 / 写测试用） */
    topPairs: function (n) {
      var self = this;
      return Object.keys(this.pairFreq)
        .map(function (k) { return { pair: k, freq: self.pairFreq[k] }; })
        .sort(function (x, y) { return y.freq - x.freq; })
        .slice(0, n || 40);
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
