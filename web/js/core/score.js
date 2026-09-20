/* =========================================================================
 * score.js —— 名字评分
 *
 * 总分 100，维度与权重：
 *   五行 28 · 音韵 15 · 寓意 14 · 性别 4 · 风格 4
 *   三才五格 6 · 出处与搭配 6 · 现代感 18 · 谐音 5
 *
 * 本轮改动的动机：用户反馈「名字不顺口、太文绉绉」。
 * 两件事分开看，权重也分开调：
 *
 *   「不顺口」是 bug——音韵只算了名字、没算姓氏（见第 2 项注释）。
 *   「太文绉绉」是**权重设计问题**：出处与搭配原本独占 17 分，
 *   而它奖励的恰恰就是文言词。于是系统越「有文化」，名字越像古文摘句。
 *
 * 出处权重 17 → 12 → 10 → 6，一路降到「只当故事看」。降权依据：
 *
 *   1. 「两个字在古诗里相邻」是个**很弱的代理指标**。它确实能命中
 *      望舒、静姝、嘉树这类雅词，但同样会命中「风雨」「潮水」「江潮」
 *      —— 实测郝姓喜用水木时，前十名里五个都是这样的水旁普通名词。
 *      它们不算文言，但根本不像名字。
 *   2. 想用「词频高 = 日常词语」来排除它们（见 poetry-lib 的
 *      COMMON_PAIR_THRESHOLD），但实测发现：**离线只有 35 首诗时全部失效**，
 *      风雨的词频也是 1。联网同步到上千首后才有效。
 *      不能把排序建立在这么不稳定的信号上，所以直接降权。
 *   3. 相对地，「现代感」是**直接信号**（人工整理的现代起名用字搭配）。
 *
 * 于是把出处降到 6、现代感提到 18。副作用是离线时也会输出词表里的名字，
 * 这正是想要的效果 —— 用户要的就是「听起来舒服」，不是「查得出典故」。
 *
 * 另外三才五格 8 → 6：它属「数理派」，与八字喜用神不同源，
 * 也与「好不好听」无关，继续降权。
 *
 * 为什么权重这么调（实测驱动，不是拍脑袋）：
 *   旧版是三才五格 15 / 出处 10（固定分），实测默认参数下前 20 名**全部 80 分**，
 *   理由一模一样（五行不重复+声调错落+三才大吉+有出处）。
 *   分数在 80 处封顶且人人都满分，排序就失去了区分度 ——
 *   「李书云」和「李栗冬」得分完全相同，用户看到的是任意 20 个满足条件的组合，
 *   而不是最好的 20 个。这就是「生搬硬套」的机制。
 *
 * 出处分级：
 *   相邻成词 6  —— 两个相邻的字在某一「句」里紧挨着出现过（望舒/静姝/琼琚）
 *   日常词语 2  —— 相邻但词频过高（风雨/明月），不算是典故
 *   疑似成词 3  —— 相邻但出自蒙书/散文（古文观止等）
 *   同句　   2  —— 同一句里都有，但不挨着
 *   同篇　 0.5 —— 只是同时出现在一首诗里（信号很弱）
 *
 * 现代感（详见第 8 项）：
 *   命中现代名字词表 12 + 用字热度落在舒适区 6
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
      /* 调用方给的**原始整名**（不含姓）。
       * 取名流程里它就是候选名，评估流程里是用户输入的任意名字 ——
       * 后者可能含字库外的字，这时靠 rows 拼是拼不出原名的
       * （比如「傻子」里的「傻」不在字库，rows 只剩「子」），
       * 导致「整名成词」检查静默失效。所以优先用这个字段。 */
      given: opts.given || '',
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

  /* 用字热度的「舒适区」评分（0~1，供第 8 项「现代感」用）。
   *
   * 这是一条**倒 U 型**曲线，不是「越常见越好」：
   *
   *   热度          评分   理由
   *   > 91         0.60   烂大街（「爱华」「艳丽」）
   *   55 ~ 91      1.00   当代起名的主流区间，既熟悉又不撞名
   *   40 ~ 54      0.50   偏冷门（「芮」「芊」「芷」）
   *   < 40         0.15   生僻到大多数人读不出来（「铄」「珏」「仟」）
   *
   * 下半支对应「太文绉绉」：古籍用字热度普遍偏低，
   * 这条曲线让「唯」「亦」「愚」这类字拿不到现代感的分。
   */
  function comfort(heat) {
    if (heat > 91) return 0.6;
    if (heat >= 55) return 1;
    if (heat >= 40) return 0.5;
    return 0.15;
  }

  /* ---------------- 组合评分 ---------------- */

  function evaluate(chars, ctx) {
    var rows = chars.map(function (c) { return charRow(c, ctx); });
    var score = 0;
    var reasons = [];
    var detail = {};
    var i, j;

    /* ---- 1. 五行（28）---- */
    var wxScore = 0;
    if (ctx.xiyongshen.length) {
      rows.forEach(function (r) {
        if (r.obj.wuxing === ctx.xiyongshen[0]) wxScore += 18;
        else if (cx2(ctx, r.obj.wuxing)) wxScore += 9;
      });
      wxScore = Math.min(wxScore, 28);
      if (wxScore >= 18) {
        reasons.push('五行补' + ctx.xiyongshen[0]);
      } else if (wxScore > 0) {
        reasons.push('五行得助');
      }
    } else {
      /* 无生辰：按名字内部五行搭配评价 */
      var wxs = rows.map(function (r) { return r.obj.wuxing; });
      var distinct = wxs.filter(function (w, k) { return wxs.indexOf(w) === k; });
      wxScore += Math.min(distinct.length * 9, 18);
      for (i = 1; i < wxs.length; i++) {
        var a = wxs[i - 1], b = wxs[i];
        if (NS.SHENG[a] === b || NS.SHENG[b] === a) wxScore += 9;
        else if (a === b) wxScore += 4;
      }
      wxScore = Math.min(wxScore, 28);
      if (distinct.length === wxs.length) reasons.push('五行搭配不重复');
    }
    score += wxScore;

    /* ---- 2. 音韵（15）----
     *
     * 关键：**必须把姓氏算进来**。
     * 早期版本只检查名字内部（rows），于是「郝澜瑞」l-án-ruì 的
     * 声母 l 与姓氏「郝」并不冲突……但「李澜瑞」lǐ-lán 是 l-l 相撞，
     * 念起来是「李兰瑞」，非常拗口，旧算法却给了满分。
     * 同类的还有「李凌初」（l-l）、「林洛林」（l-l-l）。
     * 单姓只有姓氏与首字这一对相邻，但这一对恰恰最关键 ——
     * 名字是连姓一起念的。
     *
     * 判定方式也从「全名内两两互不相同」改成**相邻比较**：
     * 拗口与否取决于相邻音节，隔着一个字同声母（如「郝明兰」）并不别扭。
     */
    var full = ctx.surnameSyllables.concat(rows.map(function (r) {
      return { char: r.char, pinyin: r.obj.pinyin, tone: r.obj.tone };
    }));
    var tones = full.map(function (s) { return s.tone; });
    var sms = full.map(function (s) {
      return NS.Pinyin.splitSyllable(s.pinyin || '').initial;
    });
    var yms = full.map(function (s) {
      return NS.Pinyin.splitSyllable(s.pinyin || '').final;
    });

    /* 相邻声母相同 → 连读发懒音（李澜→李兰、郝涵→郝安），最难听 */
    var sameInitial = [];
    for (i = 1; i < sms.length; i++) {
      if (sms[i] && sms[i] === sms[i - 1]) sameInitial.push(full[i - 1].char + full[i].char);
    }
    if (!sameInitial.length) score += 4;
    else if (sameInitial.length === 1 && sms.length > 2) score += 2;

    /* 相邻韵母相同 → 叠韵，两个字的音糊在一起 */
    var sameFinal = [];
    for (i = 1; i < yms.length; i++) {
      if (yms[i] && yms[i] === yms[i - 1]) sameFinal.push(full[i - 1].char + full[i].char);
    }
    if (!sameFinal.length) score += 3;
    else if (sameFinal.length === 1 && yms.length > 2) score += 1.5;

    /* 相邻声调相同 → 声调单调 */
    var sameTone = 0;
    for (i = 1; i < tones.length; i++) {
      if (tones[i] === tones[i - 1]) sameTone++;
    }
    if (sameTone === 0) {
      score += 4; reasons.push('声调错落');
    } else if (sameTone < tones.length - 1) {
      score += 2;
    }

    /* 平仄相间：汉语读起来顺口的根本。
     * 声调 1、2 为平，3、4 为仄（轻声按仄处理）。
     * 「思远」= 平仄、「静姝」= 仄平，都是好搭配；
     * 「书云」= 平平，读着偏平。 */
    var pingze = tones.map(function (t) { return t === 1 || t === 2; });
    var alternated = 0;
    for (i = 1; i < pingze.length; i++) {
      if (pingze[i] !== pingze[i - 1]) alternated++;
    }
    if (alternated === pingze.length - 1) {
      score += 4;
      reasons.push('平仄相间');
    } else if (alternated > 0) {
      score += 2;
    }

    /* 上声（三声）连读要变调，是最费力的组合：「郝雨语」得上声→阳平→上声 */
    var thirdRun = false;
    for (i = 1; i < tones.length; i++) {
      if (tones[i] === 3 && tones[i - 1] === 3) thirdRun = true;
    }
    if (thirdRun) score -= 2;

    detail.phonetic = { sameInitial: sameInitial, sameFinal: sameFinal };

    /* ---- 3. 寓意 / 关键词（14）---- */
    var kwTotal = rows.reduce(function (a, r) { return a + r.kwScore; }, 0);
    kwTotal = Math.min(kwTotal, 14);
    score += kwTotal;
    var hitWords = [];
    rows.forEach(function (r) { hitWords = hitWords.concat(r.kwHits); });
    if (hitWords.length) reasons.push('含关键词「' + hitWords.join('、') + '」');

    /* ---- 4. 性别（4）---- */
    score += Math.min(rows.reduce(function (a, r) {
      return a + r.genderScore;
    }, 0), 4);

    /* ---- 5. 风格（4）---- */
    var styleTotal = Math.min(rows.reduce(function (a, r) {
      return a + r.styleScore;
    }, 0), 4);
    score += styleTotal;
    if (styleTotal >= 2 && ctx.style) reasons.push(ctx.style + '风格');

    /* ---- 6. 三才五格（6）----
     * 旧版给 15，上一版降到 8，这一版降到 6。
     * 它属于「数理派」，与八字喜用神不同源，也不是「好不好听」的指标，
     * 继续保留只是为了不让它干扰真正影响观感的维度。 */
    var givenStrokes = rows.map(function (r) { return r.obj.strokes; });
    var wk = ctx.surnameStrokes.join(',') + '|' + givenStrokes.join(',');
    var wuge = ctx.wugeCache[wk];
    if (!wuge) {
      wuge = NS.Wuge.calcWuge(ctx.surnameStrokes, givenStrokes);
      ctx.wugeCache[wk] = wuge;
    }
    detail.wuge = wuge;
    if (wuge.三才吉凶 === '大吉') {
      score += 6; reasons.push('三才' + wuge.三才 + '大吉');
    } else if (wuge.三才吉凶 === '中吉') {
      score += 4;
    } else {
      score += 2;
    }

    /* ---- 7. 出处与搭配（6）---- */
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
      /* 日常词语（风雨/明月）不算典故，只给很少的分。
       * 这个标记由 poetry-lib 按词频给，离线时基本不会触发（那里有说明）。 */
      if (adj.everyday) {
        score += 2;
        detail.poetry = adj;
        detail.pairKind = 'everyday';
        reasons.push('「' + adj.pair + '」是常见词语，不算典故');
      } else {
        /* 经典来源（诗经/楚辞/唐诗/宋词/千家诗…）才算「出处成词」；
         * 蒙书与散文里凑出来的词只给一半 —— 实测「亦书」来自古文观止、
         * 「念一」来自「每一念」，都不是词。见 NON_CLASSIC_SOURCES。 */
        var full = adj.classic !== false;
        score += full ? 6 : 3;
        detail.poetry = adj;
        detail.pairKind = full ? 'classic' : 'weak';
        reasons.push(full
          ? '出处成词「' + adj.pair + '」'
          : '疑似成词「' + adj.pair + '」（非诗词类出处）');
      }
    } else if (sameLine) {
      score += 2;
      detail.poetry = sameLine;
      detail.pairKind = 'line';
      reasons.push('出自《' + sameLine.source + '》同句');
    } else if (samePoem) {
      score += 0.5;
      detail.poetry = samePoem;
      detail.pairKind = 'poem';
      reasons.push('出自《' + samePoem.source + '》');
    }

    /* ---- 8. 现代感（18）----
     * 这是整个评分里**唯一一个直接信号**（其余都是代理指标：
     * 五行代理命理、出处代理文化、热度代理流行度）。
     *
     * 它解决的问题：「出处成词」奖励的是文言词，也是普通名词，
     * 两者都不能保证名字好听。而这一项直接对着目标 ——
     * 「这个名字现代人念出来顺不顺、听起来舒不舒服」。
     *
     * 两个分量：
     *   1. 命中现代名字词表（data/namewords.js，195 个词）→ +12
     *      词表收录的是当代起名用字的搭配习惯：予安、知微、云舒、若溪、
     *      星辰、景明、瑾瑜……两个字说得通、念得顺，不用冷僻字和文言虚词。
     *   2. 用字热度落在「舒适区」→ 最多 +6（倒 U 型，见 comfort）
     *      两头都不好：太冷门（<40）读起来生僻难认，
     *      太烂大街（>91）则重名率高。中间段（55-91）最适合起名。
     *      这一步同时解决「文绉绉」：古籍用字热度普遍偏低。
     */
    var mnChars = rows.map(function (r) { return r.char; });
    var mnScore = 0;
    var hitWord = null;
    for (i = 0; i + 1 < mnChars.length; i++) {
      var pair = mnChars[i] + mnChars[i + 1];
      if (NS.NAME_WORD_SET && NS.NAME_WORD_SET[pair]) { hitWord = pair; break; }
    }
    if (hitWord) {
      mnScore += 12;
      reasons.push('现代常用搭配「' + hitWord + '」');
    }
    var comfortSum = 0;
    mnChars.forEach(function (c) {
      var h = NS.HEAT[c] !== undefined ? NS.HEAT[c] : NS.DEFAULT_HEAT;
      comfortSum += comfort(h);
    });
    mnScore += comfortSum / mnChars.length * 6;

    /* 时代感扣分（见 data/era-chars.js）。
     *
     * 上面的「热度舒适区」有个结构性缺陷：热度表衡量的是
     * 「这个字在**人口**里有多常见」，而不是「在**当代起名**里有多时髦」。
     * 于是「伟 86 / 刚 86 / 军 86 / 丽 86 / 艳 86」这批 50-90 年代的
     * 主流取名用字全部落在舒适区，拿到满分 —— 用户实测反馈
     * 「有的名字太老气了，比如伟、刚、钢、茂」就是这个原因。
     *
     * 这张表按**字**查，与字库来源无关，所以对联网加入的字同样生效。 */
    var eraHits = [];
    mnChars.forEach(function (c) {
      if (NS.ERA_CHARS && NS.ERA_CHARS[c] === 1) eraHits.push(c);
    });
    if (eraHits.length) {
      mnScore -= eraHits.length * (NS.ERA_PENALTY || 6);
      reasons.push('「' + eraHits.join('、') + '」偏上一代的取名用字');
    }

    /* 整名是个常用词（见 data/nameblock.js）。
     *
     * 这是走查时实测出来的真问题：「郝博士」排第 3 名，而且
     * 「博士」几乎对每个姓氏都进前 3-8 名。根因是**出处机制在反向奖励它** ——
     * 「博士」是唐代真实官职，在《唐诗三百首》里相邻出现过，
     * 于是被判为「出处成词」+6 分，专门找典故的机制把它当成了典故。
     *
     * 逐字判据全是好的（博 89 舒适区、士 70 舒适区、五行水金、声调错落、
     * 三才大吉），问题只出在整名上 —— 所以这里必须按**整名**查。
     *
     * 注意这里查的是**整名**，不是逐个 pair。
     * 优先用 ctx.given（调用方给的原始名）—— 评估含字库外字的名字时，
     * rows 里只剩认得的字，拼出来的不是原名，检查会静默失效。
     * 取名流程里 ctx.given 为空，则回退到 rows 拼。
     * 单名不会命中，这是对的：单字成不了词。 */
    var givenName = ctx.given || mnChars.join('');
    var blockWord = NS.nameBlockHit ? NS.nameBlockHit(givenName) : null;
    if (blockWord) {
      mnScore -= (NS.NAMEBLOCK_PENALTY || 16);
      reasons.push('「' + blockWord + '」是个日常词，用作名字容易闹误会');
    }

    detail.modern = {
      word: hitWord,
      era: eraHits,
      block: blockWord,
      heat: NS.HEAT[mnChars[0]] !== undefined ? NS.HEAT[mnChars[0]] : NS.DEFAULT_HEAT
    };
    score += mnScore;

    /* ---- 9. 谐音（5）---- */
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
