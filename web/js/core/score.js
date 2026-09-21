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
   *   > 93         0.45   极烫（梓 98、涵 97、轩 97）
   *   85 ~ 93      0.75   偏烫（悦 90、琪 90、诗 89、若 88、昊 85）
   *   55 ~ 84      1.00   当代起名的主流区间，既熟悉又不撞名
   *   40 ~ 54      0.50   偏冷门（「芮」「芈」「芷」）
   *   < 40         0.15   生僻到大多数人读不出来（「铄」「珏」「仟」）
   *
   * 85~93 这一档是**反网红**改动的核心：原来的分界线在 91，
   * 实测下来 85–91 这一段藏了大量高撞名字（用户点名的 31 个「网红字」里，
   * 有 18 个落在这里拿满分：依91 妍91 悦90 琪90 莎89 诗89 佳89 雅89 若88 昊85）。
   * 分界线提到 85 后，整张表覆盖 80 个字（占字库 16%），
   * 而 80–84 仍归主流区间 —— 那一段（紫82、璐83）是否该罚有争议，
   * 宁可漏收不错杀。
   *
   * 下半支对应「太文绉绉」：古籍用字热度普遍偏低，
   * 这条曲线让「唯」「亦」「愚」这类字拿不到现代感的分。
   */
  function comfort(heat) {
    if (heat > 93) return 0.45;
    if (heat >= 85) return 0.75;
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

    /* ---- 2. 音韵（19）—— 音韵评分 v2 ----
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
     *
     * v2 的核心改动：**「不一样」不等于「顺口」**。
     * 旧版只问「撞没撞」，可三个维度全不撞的名字照样会闷 ——
     * 「李知微 zhī-wēi」声母/韵母/声调都不撞，读起来却发闷，
     * 因为两个字都是齐齿呼，口型一直没张开。所以新增两项：
     *   2c 四呼开口度 —— 直接刻画「口型打开没有」
     *   2i 零声母相邻 —— 两字都 y/w 起头会粘连
     * 并把 2h 的鼻音检测从「一律罚」改成「**只罚同型**」：
     * 前鼻接后鼻（听南 tīng-nán）是有变化的，不该和三个 -ng 同罚。
     *
     * 权重重新配平（总分仍是 19，不动 100 分大盘）：
     *   2c 四呼 6　2a 声母撞 2　2b 叠韵 2　2d 声调错落 3
     *   2e 平仄 2　2g 送气 1　2h 鼻音同型 2　2i 零声母 1
     *   2f 上声连读 -2
     * 6+2+2+3+2+1+2+1 = 19
     *
     * 2c 拿到最大权重（6 分）是实测定的：它的判别力（坏组 0.86 vs
     * 好组 0.25）远高于其余各项；而且初版给 4 分时实测压不住别的加分项 ——
     * 「李桐月」（齐-合-撮，全闷）仍然排第 1。提到 6 分后才沉下去。
     */
    var full = ctx.surnameSyllables.concat(rows.map(function (r) {
      return { char: r.char, pinyin: r.obj.pinyin, tone: r.obj.tone };
    }));
    var tones = full.map(function (s) { return s.tone; });
    /* 音韵特征只算一次，下面几项共用 */
    var ph = full.map(function (s) {
      return NS.Pinyin.phonology(s.pinyin || '');
    });
    var sms = ph.map(function (p) { return p.initial; });
    var yms = ph.map(function (p) { return p.final; });

    /* 2a. 相邻声母相同 → 连读发懒音（李澜→李兰、郝涵→郝安），最难听 */
    var sameInitial = [];
    for (i = 1; i < sms.length; i++) {
      if (sms[i] && sms[i] === sms[i - 1]) sameInitial.push(full[i - 1].char + full[i].char);
    }
    if (!sameInitial.length) score += 2;
    else if (sameInitial.length === 1 && sms.length > 2) score += 1;

    /* 2b. 相邻韵母相同 → 叠韵，两个字的音糊在一起 */
    var sameFinal = [];
    for (i = 1; i < yms.length; i++) {
      if (yms[i] && yms[i] === yms[i - 1]) sameFinal.push(full[i - 1].char + full[i].char);
    }
    if (!sameFinal.length) score += 2;
    else if (sameFinal.length === 1 && yms.length > 2) score += 1;

    /* 2c. 四呼开口度 —— v2 新增，音韵里**最能区分「闷」与「亮」**的一项
     *
     * 上面两项问的是「撞没撞」，这一项问的是「口型打开没有」。
     * 「李知微 zhī-wēi」声母不同、韵母不同、声调也不同，三项全过，
     * 读起来照样发闷 —— 因为两个字都是齐齿呼，口型一直没张开。
     *
     * 阈值不是拍脑袋定的：把一批公认「闷」的名字（沁芸 齐+撮、
     * 知微 齐+合、芷萱 齐+合、若薇 合+合、婉婷 合+齐）与一批公认
     * 「好念」的名字（澄 开、亦然 齐+开）放一起算「闷音音节占比」，
     * 前者平均 0.86、后者平均 0.25。分档就按这个实测区间切。
     *
     * 口径：zhi/chi/shi/ri/zi/ci/si 的韵母写作 i，实际是舌尖元音，
     * 音位学上属开口呼，但听感偏暗，本层按「偏闷」处理（听感口径）。
     */
    var dullN = 0;
    for (i = 0; i < ph.length; i++) if (ph[i].dull) dullN++;
    var dullRatio = ph.length ? dullN / ph.length : 0;
    if (dullRatio >= 1) {
      reasons.push('全名没有一个开口音，口型始终没打开，读起来发闷');
    } else if (dullRatio >= 0.67) {
      score += 1.5;
      reasons.push('开口音偏少，读起来略闷');
    } else if (dullRatio >= 0.34) {
      score += 4;
    } else {
      score += 6;
      reasons.push('开口音为主，读起来明亮');
    }

    /* 2d. 相邻声调相同 → 声调单调 */
    var sameTone = 0;
    for (i = 1; i < tones.length; i++) {
      if (tones[i] === tones[i - 1]) sameTone++;
    }
    if (sameTone === 0) {
      score += 3; reasons.push('声调错落');
    } else if (sameTone < tones.length - 1) {
      score += 1.5;
    }

    /* 2e. 平仄相间：汉语读起来顺口的根本。
     * 声调 1、2 为平，3、4 为仄（轻声按仄处理）。
     * 「思远」= 平仄、「静姝」= 仄平，都是好搭配；
     * 「书云」= 平平，读着偏平。 */
    var pingze = tones.map(function (t) { return t === 1 || t === 2; });
    var alternated = 0;
    for (i = 1; i < pingze.length; i++) {
      if (pingze[i] !== pingze[i - 1]) alternated++;
    }
    if (alternated === pingze.length - 1) {
      score += 2;
      reasons.push('平仄相间');
    } else if (alternated > 0) {
      score += 1;
    }

    /* 2f. 上声（三声）连读要变调，是最费力的组合：「郝雨语」得上声→阳平→上声 */
    var thirdRun = false;
    for (i = 1; i < tones.length; i++) {
      if (tones[i] === 3 && tones[i - 1] === 3) thirdRun = true;
    }
    if (thirdRun) score -= 2;

    /* 2g. 送气声母连用。
     *
     * 与上面的「相邻声母相同」是两回事：这里声母并不相同，但都是送气音
     * （p t k q ch c），连着两个就会有「喷麦」感 ——「谭天琪」tán-tiān-qí。
     * 不送气音（b d g zh z 等）连着没这个问题，所以必须分开判。 */
    var ASPIRATED = { p: 1, t: 1, k: 1, q: 1, ch: 1, c: 1 };
    var aspRun = false;
    for (i = 1; i < sms.length; i++) {
      if (ASPIRATED[sms[i]] && ASPIRATED[sms[i - 1]]) aspRun = true;
    }
    if (!aspRun) score += 1;
    else reasons.push('送气音连读偏冲');

    /* 2h. 鼻音韵尾连用 —— v2 改为**只罚同型**
     *
     * 旧版一律用 /(ng|n)$/ 判，把前鼻音与后鼻音一视同仁。
     * 但两者连用其实是**有变化**的：「听南 tīng-nán」后鼻接前鼻，
     * 口型有交代，读起来是响的；真正含糊的是**同型连用** ——
     * 「张明光 zhāng-míng-guāng」三个 -ng，「婉婷 wǎn-tíng」一前一后
     * 但都收在鼻子里。所以按鼻音类型分组比较，异型不扣分。 */
    var nasalSameType = '', nasalMix = false;
    for (i = 1; i < yms.length; i++) {
      var na = NS.Pinyin.nasalType(yms[i - 1]);
      var nb = NS.Pinyin.nasalType(yms[i]);
      if (na && nb) {
        if (na === nb) nasalSameType = na;
        else nasalMix = true;
      }
    }
    if (!nasalSameType) score += 2;
    else {
      reasons.push('鼻音韵尾同型连用（都是' +
        (nasalSameType === 'ng' ? '后鼻音' : '前鼻音') + '），读起来含糊');
    }

    /* 2i. 零声母相邻 —— v2 新增
     * 两个零声母字连读（都以 y/w 开头，如「望月 wàng-yuè」），
     * 中间没有辅音起头，两字会粘在一起，缺一个「落脚点」。 */
    var zeroRun = false;
    for (i = 1; i < sms.length; i++) {
      if (ph[i].pos === '零声母' && ph[i - 1].pos === '零声母') zeroRun = true;
    }
    if (!zeroRun) score += 1;
    else reasons.push('相邻两字都是零声母（y/w 起头），连读容易粘连');

    detail.phonetic = {
      sameInitial: sameInitial, sameFinal: sameFinal,
      aspiratedRun: aspRun,
      nasalSame: !!nasalSameType, nasalMix: nasalMix, nasalType: nasalSameType,
      zeroRun: zeroRun, dullRatio: dullRatio,
      kaidu: ph.map(function (p) { return p.kd; }),
      pos: ph.map(function (p) { return p.pos; })
    };

    /* ---- 2b. 字形均衡（3）——「可读性」的直接指标 ----
     *
     * 名字是要写一辈子的。这一项不看意思、也不看读音，只看字形：
     *   · 两字笔画相差太大（一个字 4 画一个字 22 画）视觉轻重失衡
     *   · 两字笔画都很少（如「丁一」）显得单薄
     *   · 都很多则难写难认，低龄儿童尤其吃力
     * 阈值取的是一般书法课上「疏密均匀」的经验区间，不是精确美学度量。
     *
     * 只给 3 分：它是次要信号，主要权重还是给了直接决定听感的音韵。
     * （这几项的权重是配平过的：音韵 +4、字形 +3、现代感 −7，总分仍是 100。） */
    var st = rows.map(function (r) { return r.obj.strokes || 0; });
    if (st.length >= 2) {
      var sdiff = Math.abs(st[0] - st[1]);
      if (sdiff <= 6) score += 2;
      else if (sdiff <= 12) score += 1;
      else reasons.push('笔画相差 ' + sdiff + ' 画，字形轻重悬殊');

      var ssum = st[0] + st[1];
      if (ssum >= 14 && ssum <= 32) score += 1;
      else if (ssum < 10 || ssum > 40) {
        reasons.push('笔画' + (ssum < 10 ? '偏少、字形单薄' : '偏多、书写吃力'));
      }
    } else {
      /* 单名：没有「两字对比」可言，给中间值 */
      score += 2;
    }
    detail.strokes = st;

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
      /* 12 → 5。
       *
       * 这张白名单实测 **268 条**（原始数组 296 条里含 28 个重复项），
       * 而它原来价值 12 分（占本项 18 分的 2/3），
       * 于是「不在表里」= 白丢 12 分 —— 等于用一张小表代替「好听」打分，
       * 把代理指标当成了目标本身。白名单仍然有意义（命中说明是公认的
       * 好搭配），但降为加分项，不再是硬门槛。
       *
       * 再加一层**反网红**：这张表是按「当代用字习惯」整理的，
       * 里面混进了大量**撞名率极高**的搭配 —— 沐涵(96.5)、宇轩(96.5)、
       * 涵宇(96.5)、芷萱、雨萱、梦涵、一诺、浩然……给它们加分，
       * 等于系统在主动推荐烂大街的名字。
       *
       * 但**手工拉黑是错的**：上一版用了一张 268 条的手写名单当门槛，
       * 实测只命中 21 个真实流行名里的 1 个 —— 说明「我以为的网红」不可信。
       * 所以这里**用数据判**：取两个字热度的均值当撞名率的代理指标。
       *   均值 >= 92 → 不加分（沐涵/宇轩/浩宇 这一档）
       *   均值 >= 88 → 加 2
       *   否则       → 加 5
       * 阈值来自实测：268 个词里均值 >=92 的有 21 个、>=88 的有 64 个。 */
      var hh = function (c) {
        return NS.HEAT[c] !== undefined ? NS.HEAT[c] : NS.DEFAULT_HEAT;
      };
      var avgWordHeat = (hh(hitWord.charAt(0)) + hh(hitWord.charAt(1))) / 2;
      /* 两条判据：手写的组合表（抓「芷萱」这种单字热度不高的）
       * + 数据驱动的热度均值（抓「沐涵」这种确实很烫的）。
       * 组合表在前 —— 它更准，命中就不必再看热度了。 */
      var isCliche = NS.NAME_CLICHE_SET && NS.NAME_CLICHE_SET[hitWord];
      if (isCliche || avgWordHeat >= 92) {
        reasons.push('「' + hitWord + '」是近年高撞名搭配，不加分');
      } else if (avgWordHeat >= 88) {
        mnScore += 2;
        reasons.push('现代常用搭配「' + hitWord + '」（偏常见）');
      } else {
        mnScore += 5;
        reasons.push('现代常用搭配「' + hitWord + '」');
      }
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
