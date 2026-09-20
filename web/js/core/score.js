/* =========================================================================
 * score.js —— 名字评分
 *
 * 总分 100，维度与权重：
 *   五行 30 · 音韵 15 · 寓意 15 · 性别 5 · 风格 5 · 三才五格 8
 *   出处与搭配 17 · 谐音 5
 *
 * 为什么权重这么调（实测驱动，不是拍脑袋）：
 *   旧版是三才五格 15 / 出处 10（固定分），实测默认参数下前 20 名**全部 80 分**，
 *   理由一模一样（五行不重复+声调错落+三才大吉+有出处）。
 *   分数在 80 处封顶且人人都满分，排序就失去了区分度 ——
 *   「李书云」和「李栗冬」得分完全相同，用户看到的是任意 20 个满足条件的组合，
 *   而不是最好的 20 个。这就是「生搬硬套」的机制。
 *
 *   两处修正：
 *   1. 三才五格 15 → 8。它属「数理派」，与名字好不好听基本不相关。
 *   2. 出处从「固定 10 分」改成**分级**（见下）。诗词库扩到上千首后，
 *      「两个字都出现在同一首诗里」实测命中率 100%，等于没有信息。
 *
 * 出处分级（这是新的区分度来源）：
 *   相邻成词 17 —— 两个相邻的字在某一「句」里紧挨着出现过（望舒/静姝/琼琚）
 *   同句　   9 —— 同一句里都有，但不挨着
 *   同篇　   2 —— 只是同时出现在一首诗里（信号很弱，给一点点）
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
      /* 部首偏好：至少一个字带所选部首（默认 any），或每个字都要（all） */
      preferRadicals: (opts.preferRadicals || []).filter(Boolean),
      avoidRadicals: (opts.avoidRadicals || []).filter(Boolean),
      radicalMode: opts.radicalMode === 'all' ? 'all' : 'any',
      taboo: {},
      mustInclude: {},
      rowCache: Object.create(null),
      wugeCache: Object.create(null),
      poetryCache: Object.create(null)
    };
    (opts.taboo || []).forEach(function (c) { if (c) ctx.taboo[c] = 1; });
    (opts.mustInclude || []).forEach(function (c) { if (c) ctx.mustInclude[c] = 1; });

    /* 避用部首 = 硬排除。用户说「不要草字头」就该一个都不出现，
     * 而不是靠扣分——扣分挡不住它照样出现在高分组合里。 */
    if (ctx.avoidRadicals.length && NS.Radical) {
      ctx.avoidRadicals.forEach(function (name) {
        NS.Radical.charsOf(name).forEach(function (ch) { ctx.taboo[ch] = 1; });
      });
    }
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
      score += 6; reasons.push('声调错落');
    } else if (uniq(tones) >= 2) {
      score += 3;
    }
    if (uniq(sms) === sms.length) score += 3;
    if (uniq(yms) === yms.length) score += 3;

    /* 平仄相间：汉语读起来顺口的根本。
     * 声调 1、2 为平，3、4 为仄（轻声按仄处理）。
     * 「思远」= 平仄、「静姝」= 仄平，都是好搭配；
     * 「书云」= 平平、「栗冬」= 仄平…平平的名字读着偏平。 */
    var pingze = tones.map(function (t) { return t === 1 || t === 2; });
    var alternated = 0;
    for (i = 1; i < pingze.length; i++) {
      if (pingze[i] !== pingze[i - 1]) alternated++;
    }
    if (alternated === pingze.length - 1) {
      score += 3;
      reasons.push('平仄相间');
    } else if (alternated > 0) {
      score += 1.5;
    }

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

    /* ---- 6. 三才五格（8）----
     * 旧版给 15，实测它把「五行/音韵/寓意」这些真需求盖过去了。
     * 它属于「数理派」，与八字喜用神不同源，也不是「好不好听」的指标，
     * 因此降权到 8，只作为参考。 */
    var givenStrokes = rows.map(function (r) { return r.obj.strokes; });
    var wk = ctx.surnameStrokes.join(',') + '|' + givenStrokes.join(',');
    var wuge = ctx.wugeCache[wk];
    if (!wuge) {
      wuge = NS.Wuge.calcWuge(ctx.surnameStrokes, givenStrokes);
      ctx.wugeCache[wk] = wuge;
    }
    detail.wuge = wuge;
    if (wuge.三才吉凶 === '大吉') {
      score += 8; reasons.push('三才' + wuge.三才 + '大吉');
    } else if (wuge.三才吉凶 === '中吉') {
      score += 5;
    } else {
      score += 2;
    }

    /* ---- 7. 出处与搭配（17）---- */
    var charsKey = rows.map(function (r) { return r.char; }).join('');
    var given = charsKey.split('');
    var adj, sameLine, samePoem;

    if (charsKey in ctx.poetryCache) {
      var cached = ctx.poetryCache[charsKey];
      adj = cached.adj; sameLine = cached.line; samePoem = cached.poem;
    } else {
      /* 从强到弱依次查，命中就停 */
      adj = NS.Poetry.findAdjacent(given);
      sameLine = adj ? null : NS.Poetry.findLine(given);
      samePoem = (adj || sameLine) ? null : NS.Poetry.findSource(given);
      cached = { adj: adj, line: sameLine, poem: samePoem };
      ctx.poetryCache[charsKey] = cached;
    }

    if (adj) {
      /* 经典来源（诗经/楚辞/唐诗/宋词/千家诗…）才算满分的「出处成词」；
       * 蒙书与散文里凑出来的词只给一半 —— 实测「亦书」来自古文观止、
       * 「念一」来自「每一念」，都不是词。见 NON_CLASSIC_SOURCES。 */
      var full = adj.classic !== false;
      score += full ? 17 : 9;
      detail.poetry = adj;
      detail.pairKind = full ? 'classic' : 'weak';
      reasons.push(full
        ? '出处成词「' + adj.pair + '」'
        : '疑似成词「' + adj.pair + '」（非诗词类出处）');
    } else if (sameLine) {
      score += 5;
      detail.poetry = sameLine;
      detail.pairKind = 'line';
      reasons.push('出自《' + sameLine.source + '》同句');
    } else if (samePoem) {
      score += 1;
      detail.poetry = samePoem;
      detail.pairKind = 'poem';
      reasons.push('出自《' + samePoem.source + '》');
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
