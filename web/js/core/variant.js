/* =========================================================================
 * variant.js —— 同音替换建议
 *
 * 场景：用户喜欢「李书云」的读音，但嫌「书」这几年被用滥了，
 *       想知道有没有读音一样、五行一样、但更冷门的字。
 *
 * 分两层给出建议，因为两层的数据可靠度完全不同：
 *
 *   内层（可靠）：字库里的字。五行、康熙笔画、声调都是校验过的，
 *                因此能给出「换成之后名字得几分」，分数是可信的。
 *
 *   外层（推断）：只在联网同步来的拼音表里、还没进字库的字。
 *                读音可靠（公开拼音数据），但五行与笔画只能按部首推断，
 *                释义来自新华字典。这些字给「参考分」，界面必须标注「推断」。
 *                并且**只保留「重名热度表认得的字」**，理由见 outerIndex()。
 *
 * 硬性过滤：替换后如果触发谐音拦截，直接丢弃这个候选。
 *           读音变了就可能产生新谐音，宁可少给建议，也不能推荐坏名字。
 * ========================================================================= */
(function (global) {
  'use strict';

  var NS = (global.NS = global.NS || {});

  var CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;

  /* ---------------- 内层：字库内的同音字 ---------------- */

  var _inner = null;
  var _innerVer = -1;

  function innerIndex() {
    var ver = NS.Lexicon ? NS.Lexicon.dataVersion : 0;
    if (_inner && _innerVer === ver) return _inner;

    _inner = Object.create(null);
    _innerVer = ver;

    var list = NS.CHAR_LIST || [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      /* 联网/手工加入的推断字五行与笔画都不可靠，
       * 拿它们去替换一个已经确定的好字，会把分数算错，所以不进内层。 */
      if (c.__inferred) continue;
      if (!c.pinyin) continue;
      if (!_inner[c.pinyin]) _inner[c.pinyin] = [];
      _inner[c.pinyin].push(c);
    }
    return _inner;
  }

  /* ---------------- 外层：拼音表里、字库外的同音字 ---------------- */

  var _outer = null;
  var _outerVer = -1;
  var _entryCache = Object.create(null);

  function outerIndex() {
    var ver = NS.Lexicon ? NS.Lexicon.dataVersion : 0;
    if (_outer && _outerVer === ver) return _outer;

    _outer = Object.create(null);
    _entryCache = Object.create(null);
    _outerVer = ver;

    var lex = NS.Lexicon;
    var map = (lex && lex.pinyinMap) || null;
    if (!map || !NS.Infer) return _outer;

    Object.keys(map).forEach(function (ch) {
      if (ch.length !== 1 || !CJK.test(ch)) return;
      if (NS.CHAR_DB[ch]) return;              /* 字库内的走内层，不重复 */
      /* 只推荐「重名热度表认得的字」。
       * 热度表是从当代起名用字整理的，认得就说明它确实是个起名用字。
       * 不设这个门，拼音表里两万字都能进来，实测会把「儖」（异体字）
       * 和「鲭」（鱼名）推给用户——那比不给建议更糟。
       * 代价是漏掉一些好用但没被热度表收录的字，宁可少给。
       * 实测这个门槛只筛掉 51 个字，而它们全部是可用字：
       * 轩 浩 宸 子 欣 嘉 怡 玥 诺 奕 语 妍 瑜 晨 俊 雅 琳 婷 娴 淑 姝 蓝 青 … */
      if (!NS.HEAT || NS.HEAT[ch] === undefined) return;
      var py = map[ch];
      if (!py || !py.pinyin) return;
      if (!_outer[py.pinyin]) _outer[py.pinyin] = [];
      _outer[py.pinyin].push(ch);
    });
    return _outer;
  }

  /** 把外层的一个字组装成字库格式的条目（带 __inferred 标记），逐字缓存 */
  function outerEntry(ch) {
    if (_entryCache[ch]) return _entryCache[ch];
    var lex = NS.Lexicon || {};
    var py = (lex.pinyinMap && lex.pinyinMap[ch]) || null;
    var d = (lex.dict && lex.dict[ch]) || null;
    var dictEntry = d ? {
      strokes: d[0], radicals: d[1], pinyin: d[2], explanation: d[3]
    } : null;

    var e = NS.Infer.buildCharEntry(ch, dictEntry, py);
    e.__inferred = e.__inferred || { source: 'variant' };
    e.__outer = true;
    _entryCache[ch] = e;
    return e;
  }

  /* ---------------- 通用排序 ---------------- */

  function heatOf(ch) {
    var h = NS.estimateHeat([ch]);
    return h || { value: NS.DEFAULT_HEAT || 35, level: 'rare', text: '偏冷门' };
  }

  /**
   * 排序权重：同声调 > 同五行 > 更冷门。
   *
   * 声调一致才叫「真同音」；五行一致则换完八字的补益关系不变，分数不塌；
   * 同样条件下热度低的排前面——这正是用户想换字的原因。
   */
  function rankOf(sameTone, sameWuxing, heatValue) {
    return (sameTone ? 100 : 0) + (sameWuxing ? 60 : 0) +
      (100 - heatValue) * 0.3;
  }

  function buildOption(obj, target, exclude) {
    if (obj.char === target.char) return null;
    if (exclude.indexOf(obj.char) >= 0) return null;
    var heat = heatOf(obj.char);
    var known = NS.HEAT ? (NS.HEAT[obj.char] !== undefined) : true;
    var sameTone = obj.tone === target.tone;
    var sameWuxing = obj.wuxing === target.wuxing;
    return {
      obj: obj,
      char: obj.char,
      pinyin: obj.pinyin,
      tone: obj.tone,
      wuxing: obj.wuxing,
      strokes: obj.strokes,
      meaning: obj.meaning,
      heat: heat,
      heatKnown: known,
      sameTone: sameTone,
      sameWuxing: sameWuxing,
      approx: !!obj.__outer,
      rank: rankOf(sameTone, sameWuxing, heat.value)
    };
  }

  function sortOptions(list) {
    list.sort(function (a, b) {
      if (b.rank !== a.rank) return b.rank - a.rank;
      return a.char.localeCompare(b.char);
    });
    return list;
  }

  /* ---------------- 对外接口 ---------------- */

  /**
   * 内层：字库内（五行/笔画可靠）的同音字。
   * @returns {Array} 已按「同声调 > 同五行 > 更冷门」排序
   */
  function candidates(target, exclude) {
    if (!target || !target.pinyin) return [];
    var pool = innerIndex()[target.pinyin];
    if (!pool || pool.length < 2) return [];
    var skip = exclude || [];
    var out = [];
    for (var i = 0; i < pool.length; i++) {
      var o = buildOption(pool[i], target, skip);
      if (o) out.push(o);
    }
    return sortOptions(out);
  }

  /**
   * 外层：拼音表里、字库外的同音字。
   * 五行与笔画是按部首推断的，返回项的 approx 为 true。
   * 只有联网同步过拼音表（两万字级）之后才有数据，否则返回空数组。
   */
  function outerCandidates(target, exclude) {
    if (!target || !target.pinyin) return [];
    var pool = outerIndex()[target.pinyin];
    if (!pool || !pool.length) return [];
    var skip = exclude || [];
    var out = [];
    for (var i = 0; i < pool.length; i++) {
      var o = buildOption(outerEntry(pool[i]), target, skip);
      if (o) out.push(o);
    }
    return sortOptions(out);
  }

  /**
   * 为一个结果名字逐字给出替换建议，并重算替换后的总分。
   * @param {Object} item 生成器的结果对象
   * @param {Object} ctx  NS.Score.buildContext 的结果（复用它的缓存）
   * @param {Object} [opt] { limit, outerLimit, allowApprox }
   * @returns {Array} [{at, from, fromHeat, options:[...], hasApprox}]
   */
  function forName(item, ctx, opt) {
    opt = opt || {};
    var limit = opt.limit || 3;
    /* 外层字五行靠推断，默认少给几个，避免把不确定的建议堆满界面 */
    var outerLimit = (opt.allowApprox === false) ? 0 : (opt.outerLimit || 2);
    if (!item || !item.chars || !ctx) return [];

    var out = [];

    /**
     * 试换某个位置的字，收集能通过谐音检查的候选。
     * @param {number} at 要替换的位置下标
     */
    function collect(at, target, inner, outer) {
      var picked = [];

      function take(list, sink, cap) {
        for (var k = 0; k < list.length && sink.length < cap; k++) {
          var cand = list[k];
          var swapped = item.chars.map(function (ch, j) {
            return j === at ? cand.obj : NS.CHAR_DB[ch];
          });
          if (swapped.some(function (x) { return !x; })) continue;

          var ev = NS.Score.evaluate(swapped, ctx);
          /* 换了字就产生新谐音的话，不能推荐 */
          if (!ev.detail.homophone.pass) continue;

          sink.push({
            char: cand.char,
            pinyin: cand.pinyin,
            tone: cand.tone,
            wuxing: cand.wuxing,
            strokes: cand.strokes,
            meaning: cand.meaning,
            heat: cand.heat,
            heatKnown: cand.heatKnown,
            sameTone: cand.sameTone,
            sameWuxing: cand.sameWuxing,
            approx: cand.approx,
            score: ev.score,
            delta: Math.round((ev.score - item.score) * 10) / 10,
            name: item.name.replace(target.char, cand.char)
          });
        }
      }

      /* 内层（分数可信）排前面，最多 limit 个 */
      take(inner, picked, limit);
      var innerCount = picked.length;

      /* 外层：先补足 limit，再多给 outerLimit 个供参考。
       * 外层五行是推断的，所以宁可少给，且必须标「推断」。 */
      var outerBox = [];
      take(outer, outerBox, Math.max(0, limit - innerCount) + outerLimit);

      return picked.concat(outerBox);
    }

    for (var i = 0; i < item.chars.length; i++) {
      var target = NS.CHAR_DB[item.chars[i]];
      if (!target) continue;

      var inner = candidates(target, item.chars);
      var outer = outerCandidates(target, item.chars);
      if (!inner.length && !outer.length) continue;

      var picked = collect(i, target, inner, outer);
      if (picked.length) {
        out.push({
          at: i,
          from: target.char,
          fromHeat: heatOf(target.char),
          options: picked,
          hasApprox: picked.some(function (o) { return o.approx; })
        });
      }
    }
    return out;
  }

  function reset() {
    _inner = null; _innerVer = -1;
    _outer = null; _outerVer = -1;
    _entryCache = Object.create(null);
  }

  NS.Variant = {
    candidates: candidates,
    outerCandidates: outerCandidates,
    forName: forName,
    reset: reset
  };

})(typeof window !== 'undefined' ? window : globalThis);
