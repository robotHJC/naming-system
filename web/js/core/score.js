/* =========================================================================
 * score.js —— 名字评分
 *
 * 评分维度与总分与 Python 版保持一致（总分 100），便于对照：
 *   五行 30 · 音韵 15 · 寓意 15 · 性别 5 · 风格 5 · 三才五格 15 · 诗词 10 · 谐音 5
 *
 * 改进：
 *   1. 谐音改为音节边界匹配（原版子串匹配会误杀「李诗涵」这类好名字）。
 *   2. 未提供生辰时，五行项按「名字内部五行搭配」给分，避免该项恒为 0、
 *      导致所有候选分数被拉平。
 *   3. 拆出「单字基础分」，让生成器可以先剪枝再枚举，性能提升几个数量级。
 * ========================================================================= */
(function (global) {
  'use strict';
  var NS = (global.NS = global.NS || {});

  /* ---------------- 上下文 ---------------- */

  function buildContext(opts) {
    opts = opts || {};
    var surname = opts.surname || '';
    var surnameInfo = NS.SURNAME_DB[surname] || null;

    var surnameStrokes = (opts.surnameStrokes && opts.surnameStrokes.length)
      ? opts.surnameStrokes.slice()
      : (surnameInfo ? surnameInfo.strokes.slice() : [8]);

    var surnameSyllables = (opts.surnameSyllables && opts.surnameSyllables.length)
      ? opts.surnameSyllables.slice()
      : (surnameInfo
        ? surnameInfo.pinyin.map(function (p, i) {
          return { char: surname[i], pinyin: p, tone: surnameInfo.tones[i] };
        })
        : surname.split('').map(function (c) {
          return { char: c, pinyin: '', tone: 0 };
        }));

    var ctx = {
      surname: surname,
      surnameStrokes: surnameStrokes,
      surnameSyllables: surnameSyllables,
      gender: opts.gender || '中性',
      style: opts.style || '',
      keywords: (opts.keywords || []).filter(Boolean),
      xiyongshen: opts.xiyongshen || [],
      taboo: {},
      mustInclude: {},
      rowCache: Object.create(null),
      wugeCache: Object.create(null),
      poetryCache: Object.create(null)
    };
    (opts.taboo || []).forEach(function (c) { if (c) ctx.taboo[c] = 1; });
    (opts.mustInclude || []).forEach(function (c) { if (c) ctx.mustInclude[c] = 1; });
    return ctx;
  }

  /**
   * 单字基础分（与其它字无关的部分）：
   * 五行原始分 + 性别 + 风格 + 关键词命中
   * 这些分数可以叠加后在组合层再封顶，因此剪枝排序与最终评分方向一致。
   */
  function charRow(c, ctx) {
    if (ctx.rowCache[c.char]) return ctx.rowCache[c.char];
    var reasons = [];
    var wx = 0, kwHits = [];
    var i;

    if (ctx.xiyongshen.length) {
      if (c.wuxing === ctx.xiyongshen[0]) wx = 20;
      else if (cx2(ctx, c.wuxing)) wx = 10;
    }

    var genderScore = (c.gender === ctx.gender || c.gender === '中性') ? 2.5 : 0;

    var styleScore = (ctx.style && c.styles.indexOf(ctx.style) >= 0) ? 2.5 : 0;

    var kwScore = 0;
    for (i = 0; i < ctx.keywords.length; i++) {
      if (c.meaning.indexOf(ctx.keywords[i]) >= 0) {
        kwHits.push(ctx.keywords[i]);
        kwScore += 8;
      }
    }
    kwScore = Math.min(kwScore, 15);

    var row = {
      char: c.char,
      obj: c,
      wx: wx,
      genderScore: genderScore,
      styleScore: styleScore,
      kwScore: kwScore,
      kwHits: kwHits,
      base: wx + genderScore + styleScore + kwScore,
      reasons: reasons
    };
    ctx.rowCache[c.char] = row;
    return row;
  }

  function cx2(ctx, wx) {
    for (var i = 1; i < ctx.xiyongshen.length; i++) {
      if (ctx.xiyongshen[i] === wx) return true;
    }
    return false;
  }

  /* ---------------- 组合评分 ---------------- */

  function evaluate(chars, ctx) {
    var rows = chars.map(function (c) { return charRow(c, ctx); });
    var score = 0;
    var reasons = [];
    var detail = {};
    var i, j;

    /* ---- 1. 五行（30）---- */
    var wxScore = 0;
    if (ctx.xiyongshen.length) {
      rows.forEach(function (r) {
        if (r.obj.wuxing === ctx.xiyongshen[0]) wxScore += 20;
        else if (cx2(ctx, r.obj.wuxing)) wxScore += 10;
      });
      wxScore = Math.min(wxScore, 30);
      if (wxScore >= 20) {
        reasons.push('五行补' + ctx.xiyongshen[0]);
      } else if (wxScore > 0) {
        reasons.push('五行得助');
      }
    } else {
      /* 无生辰：按名字内部五行搭配评价 */
      var wxs = rows.map(function (r) { return r.obj.wuxing; });
      var distinct = wxs.filter(function (w, k) { return wxs.indexOf(w) === k; });
      wxScore += Math.min(distinct.length * 10, 20);
      for (i = 1; i < wxs.length; i++) {
        var a = wxs[i - 1], b = wxs[i];
        if (NS.SHENG[a] === b || NS.SHENG[b] === a) wxScore += 10;
        else if (a === b) wxScore += 4;
      }
      wxScore = Math.min(wxScore, 30);
      if (distinct.length === wxs.length) reasons.push('五行搭配不重复');
    }
    score += wxScore;

    /* ---- 2. 音韵（15）---- */
    var tones = rows.map(function (r) { return r.obj.tone; });
    var sms = rows.map(function (r) {
      return NS.Pinyin.splitSyllable(r.obj.pinyin).initial;
    });
    var yms = rows.map(function (r) {
      return NS.Pinyin.splitSyllable(r.obj.pinyin).final;
    });
    if (uniq(tones) === tones.length) {
      score += 8; reasons.push('声调错落');
    } else if (uniq(tones) >= 2) {
      score += 4;
    }
    if (uniq(sms) === sms.length) score += 4;
    if (uniq(yms) === yms.length) score += 3;

    /* ---- 3. 寓意 / 关键词（15）---- */
    var kwTotal = rows.reduce(function (a, r) { return a + r.kwScore; }, 0);
    kwTotal = Math.min(kwTotal, 15);
    score += kwTotal;
    var hitWords = [];
    rows.forEach(function (r) { hitWords = hitWords.concat(r.kwHits); });
    if (hitWords.length) reasons.push('含关键词「' + hitWords.join('、') + '」');

    /* ---- 4. 性别（5）---- */
    score += Math.min(rows.reduce(function (a, r) {
      return a + r.genderScore;
    }, 0), 5);

    /* ---- 5. 风格（5）---- */
    var styleTotal = Math.min(rows.reduce(function (a, r) {
      return a + r.styleScore;
    }, 0), 5);
    score += styleTotal;
    if (styleTotal >= 2.5 && ctx.style) reasons.push(ctx.style + '风格');

    /* ---- 6. 三才五格（15）---- */
    var givenStrokes = rows.map(function (r) { return r.obj.strokes; });
    var wk = ctx.surnameStrokes.join(',') + '|' + givenStrokes.join(',');
    var wuge = ctx.wugeCache[wk];
    if (!wuge) {
      wuge = NS.Wuge.calcWuge(ctx.surnameStrokes, givenStrokes);
      ctx.wugeCache[wk] = wuge;
    }
    detail.wuge = wuge;
    if (wuge.三才吉凶 === '大吉') {
      score += 15; reasons.push('三才' + wuge.三才 + '大吉');
    } else if (wuge.三才吉凶 === '中吉') {
      score += 10;
    } else {
      score += 3;
    }

    /* ---- 7. 诗词出处（10）---- */
    var charsKey = rows.map(function (r) { return r.char; }).join('');
    var src;
    if (charsKey in ctx.poetryCache) {
      src = ctx.poetryCache[charsKey];
    } else {
      src = NS.Poetry.findSource(charsKey.split(''));
      ctx.poetryCache[charsKey] = src;
    }
    if (src) {
      score += 10;
      detail.poetry = src;
      reasons.push('出自《' + src.source + '》');
    }

    /* ---- 8. 谐音（5）---- */
    var syllables = ctx.surnameSyllables.concat(rows.map(function (r) {
      return { char: r.char, pinyin: r.obj.pinyin, tone: r.obj.tone };
    }));
    var homo = NS.Pinyin.checkHomophone(syllables);
    detail.homophone = homo;
    if (homo.pass) {
      score += 5;
    } else {
      score -= 20;
      reasons.push('谐音风险');
    }

    /* ---- 重名热度（不参与主分，仅作参考）---- */
    detail.heat = NS.estimateHeat(rows.map(function (r) { return r.char; }));

    score = Math.max(0, Math.round(score * 10) / 10);

    return {
      score: score,
      reasons: reasons,
      detail: detail,
      rows: rows
    };
  }

  function uniq(arr) {
    var s = Object.create(null), n = 0;
    for (var i = 0; i < arr.length; i++) {
      if (!s[arr[i]]) { s[arr[i]] = 1; n++; }
    }
    return n;
  }

  NS.Score = {
    buildContext: buildContext,
    charRow: charRow,
    evaluate: evaluate,
    uniq: uniq
  };
})(typeof window !== 'undefined' ? window : globalThis);
