/* =========================================================================
 * report.js —— 名字评估报告（自定义名字 / 已有名字的命理批注）
 *
 * 用户需求：「增加一个输入自定义名字的功能，你根据输入的名字时辰年份八字等
 * 进行评估，并输出详细的命理批注等信息。」
 *
 * 设计要点
 * ---------------------------------------------------------------
 * 1. **不联网。** 用户提到「评估可以进行联网评估」，但这里如实说明：
 *    命理评估需要的数据（八字、五行、康熙笔画、音韵、诗词）全在本地，
 *    联网只能补充字典与诗词库，对命理判断没有帮助。
 *    所以评估**完全离线**，结果稳定可复现，也不会把生辰八字发到网上 ——
 *    这一点反而更该强调。
 *
 * 2. **分层输出，各层标注依据强度。** 报告中每个维度都带 `basis` 字段：
 *      '命理'  —— 八字五行喜用（正统八字，权重最高）
 *      '数理'  —— 康熙笔画三才五格（数理派，与八字不同源）
 *      '民俗'  —— 生肖、纳音、姓名卦（民俗流派，仅参考）
 *      '语言'  —— 音韵、谐音（不涉命理，纯语言学）
 *    这样用户能看清哪一条是硬的、哪一条是软的。
 *
 * 3. **不做命运预测。** 报告只评价「这个用字组合与这个生辰是否相配」，
 *    不预测祸福。措辞上避免「大吉」「必富贵」这类断言。
 * ========================================================================= */
(function (global) {
  'use strict';

  var NS = (global.NS = global.NS || {});

  /* 依据强度标签，界面据此分组显示与配色 */
  var BASIS_LABEL = {
    '命理': '命理（八字五行）',
    '用字': '用字（字义·五行·笔画）',
    '数理': '数理（笔画三才五格）',
    '民俗': '民俗参考',
    '语言': '语言（音韵谐音）'
  };

  function W(wuxing, best, good, level) {
    return { wuxing: wuxing, best: best, good: good, level: level };
  }

  /**
   * 评估一个名字
   *
   * @param {string} surname 姓氏（支持复姓）
   * @param {string} given   名字（不含姓）
   * @param {Object} opts
   *   @param {Object} opts.bazi  NS.Bazi.analyzeBazi() 的返回值；不传则按名字内部五行评
   *   @param {string} opts.gender 性别（可选）
   *   @param {string[]} opts.taboo 避用字
   * @returns {Object|null}
   */
  NS.evaluateName = function (surname, given, opts) {
    opts = opts || {};
    if (!surname || !given) return null;

    var surnameChars = surname.split('');
    var givenChars = given.split('');
    var unknown = [];
    var givenRows = [];

    /* 只查**名字**用字。
     * 姓氏不在 CHAR_DB 里（它走 SURNAME_DB），早先把姓名混在一起查，
     * 结果「郝」被判成「字库外字」，姓氏笔画也算成了 undefined。 */
    givenChars.forEach(function (c) {
      var d = NS.CHAR_DB[c];
      if (d) givenRows.push({ ch: c, obj: d });
      else unknown.push(c);
    });
    if (!givenRows.length) return null;

    /* 名字里有字库外的字：照样出报告，但要标出来哪些字是推断的，
     * 因为康熙笔画与五行是拿部首推的，不准。 */
    var inferred = givenRows.filter(function (r) { return r.obj.__inferred; })
      .map(function (r) { return r.ch; });

    var xiyongshen = (opts.bazi && opts.bazi.xiyongshen) || [];
    var ctx = NS.Score.buildContext({
      surname: surname,
      xiyongshen: xiyongshen,
      taboo: opts.taboo || []
    });

    /* ---- 1. 八字排盘（若有生辰）---- */
    var bazi = opts.bazi || null;

    /* ---- 2. 逐字用字分析 ---- */
    var chars = givenRows.map(function (r) {
      var wx = r.obj.wuxing;
      var level = '平';
      if (xiyongshen.length) {
        if (wx === xiyongshen[0]) level = 'best';
        else if (xiyongshen.indexOf(wx) >= 0) level = 'good';
        else level = 'idle';
      }
      return {
        char: r.ch,
        pinyin: NS.Pinyin.toneMark(r.obj.pinyin, r.obj.tone),
        wuxing: wx,
        strokes: r.obj.strokes,
        meaning: r.obj.meaning || '',
        styles: r.obj.styles || [],
        heat: NS.HEAT[r.ch] !== undefined ? NS.HEAT[r.ch] : NS.DEFAULT_HEAT,
        eraChar: !!(NS.ERA_CHARS && NS.ERA_CHARS[r.ch] === 1),
        inferred: !!r.obj.__inferred,
        wxLevel: level
      };
    });

    /* ---- 3. 姓名卦 ---- */
    /* 姓氏笔画取自 ctx（它已按 SURNAME_DB 解析过，含复姓与兜底），
     * 不要自己从 CHAR_DB 求和 —— 姓氏根本不在字库里。 */
    var surnameStrokes = (ctx.surnameStrokes || []).reduce(function (a, b) {
      return a + b;
    }, 0);
    var givenStrokes = chars.reduce(function (a, c) { return a + c.strokes; }, 0);
    var hexagram = NS.castNameHexagram
      ? NS.castNameHexagram(surnameStrokes, givenStrokes) : null;

    /* ---- 4. 生肖冲突 ---- */
    var zodiac = bazi ? NS.analyzeZodiac(bazi) : null;
    var zodiacWarn = zodiac
      ? NS.zodiacRadicalWarning(givenChars, zodiac.shengxiao) : null;

    /* ---- 5. 走通用评分（音韵/谐音/三才五格/出处/现代感）---- */
    var score = NS.Score.evaluate(givenRows.map(function (r) { return r.obj; }), ctx);

    /* ---- 6. 生成批注 ---- */
    var blocks = [];
    function add(basis, title, lines, tone) {
      if (!lines || !lines.length) return;
      blocks.push({
        basis: basis,
        basisLabel: BASIS_LABEL[basis] || basis,
        title: title,
        lines: lines.filter(Boolean),
        tone: tone || 'neutral'
      });
    }

    /* 6a. 八字总览 */
    if (bazi) {
      var l1 = [];
      l1.push('四柱：' + bazi.baziStr);
      l1.push('日主 ' + bazi.dayGan + '（' + bazi.dayWx + '），' +
        bazi.strength + '（同党 ' + (bazi.ratio * 100).toFixed(0) + '%）');
      var cnt = NS.WUXING.map(function (w) {
        return w + ' ' + (bazi.count[w] || 0);
      }).join('　');
      l1.push('五行分布：' + cnt);
      l1.push('喜用神：' + (bazi.xiyongshen.join('、') || '—'));
      if (bazi.missing.length) {
        l1.push('八字中不显的五行：' + bazi.missing.join('、') +
          '（注意：「缺」不等于「需要补」，要看喜用神，' +
          '身旺时缺的往往正是该泄的）');
      }
      add('命理', '八字排盘', l1);
    }

    /* 6b. 用字与喜用神
     *
     * 有生辰才把它归在「命理」下 —— 没有生辰就没有喜用神，
     * 一个字属什么五行是字本身的属性，不是命理判断。
     * 早先不论有没有生辰都标成「命理」，是虚张声势，已改。 */
    var l2 = chars.map(function (c) {
      var mark = c.wxLevel === 'best' ? '（正合首用神）'
        : c.wxLevel === 'good' ? '（属喜用）'
          : xiyongshen.length ? '（非喜用）' : '';
      return c.char + '　' + c.pinyin + '　五行' + c.wuxing + '　' +
        c.strokes + '画' + mark +
        (c.meaning ? '　' + c.meaning : '') +
        (c.inferred ? '　［推断值，需人工核对］' : '') +
        (c.eraChar ? '　［偏上一代用字］' : '');
    });
    if (xiyongshen.length) {
      var hitN = chars.filter(function (c) { return c.wxLevel !== 'idle'; }).length;
      l2.push('');
      l2.push(hitN === chars.length
        ? '两个字五行都属喜用，补益方向一致。'
        : hitN > 0 ? '有一个字属喜用，补益方向部分吻合。'
          : '两个字都不在喜用神里 —— 从这个生辰看，五行上帮不上忙。');
    }
    add(xiyongshen.length ? '命理' : '用字',
      xiyongshen.length ? '用字五行' : '用字五行（未与八字比对）',
      l2.concat(xiyongshen.length ? [] : [''
        , '没有填生辰 → 无法判断喜用神，上面只列出了每个字本身的五行与笔画，'
        + '**没有**说它们与该补什么相配。']),
      xiyongshen.length && chars.every(function (c) { return c.wxLevel === 'idle'; })
        ? 'warn' : 'neutral');

    /* 6c. 纳音与生肖（民俗） */
    if (zodiac) {
      var l3 = [];
      l3.push('生肖：' + zodiac.shengxiao + '（' + zodiac.zhi + '），' +
        '年柱 ' + zodiac.yearPillar);
      l3.push('年柱干支五行：' + zodiac.yearGanWx + '、' + zodiac.yearZhiWx);
      if (zodiac.nayin) {
        l3.push('年柱纳音：' + zodiac.nayin.name + '（属' + zodiac.nayin.wuxing +
          '）' + (zodiac.nayin.note ? '　' + zodiac.nayin.note : ''));
      }
      add('民俗', '纳音与生肖', l3);

      /* 冲突要单独突出，这是整个报告里最该被看到的一段 */
      if (zodiac.conflicts.length) {
        var lc = [];
        zodiac.conflicts.forEach(function (cf) {
          lc.push('【' + cf.kind + '】');
          lc.push('　· ' + cf.a);
          lc.push('　· ' + cf.b);
          lc.push('　→ ' + cf.verdict);
        });
        add('民俗', '口径冲突（请重点看这段）', lc, 'warn');
      }
      if (zodiacWarn) {
        add('民俗', '生肖形义派提示', [
          '按生肖形义派，属' + zodiac.shengxiao + '的忌用「' +
          zodiacWarn.hits.join('、') + '」（' + zodiacFolkWhy(zodiac) + '）。',
          '**这一派与八字五行不是一套体系**，本系统不因此扣分。' +
          '若与喜用神冲突，以八字为准。'
        ], 'warn');
      }
    }

    /* 6d. 姓名卦（民俗） */
    if (hexagram) {
      add('民俗', '姓名卦', [
        '起卦：' + hexagram.basis.rule,
        '上卦 ' + hexagram.upper.symbol + ' ' + hexagram.upper.name + '（' +
          hexagram.upper.wuxing + '·' + hexagram.upper.image + '）　' +
          '下卦 ' + hexagram.lower.symbol + ' ' + hexagram.lower.name + '（' +
          hexagram.lower.wuxing + '·' + hexagram.lower.image + '）',
        '本卦：' + hexagram.symbol + ' ' + hexagram.name + '　' + hexagram.meaning,
        '动爻：第 ' + hexagram.basis.moving + ' 爻' +
          (hexagram.changed ? '　变卦：' + hexagram.changed.name : ''),
        '体用：体 ' + hexagram.ti.name + '（' + hexagram.ti.wuxing + '）　用 ' +
          hexagram.yong.name + '（' + hexagram.yong.wuxing + '）',
        '体用生克：' + hexagram.relation.level + '　' + hexagram.relation.kind +
          ' —— ' + hexagram.relation.why,
        '说明：' + hexagram.disclaimer
      ], hexagram.relation.level === '凶' ? 'warn' : 'neutral');
    }

    /* 6e. 音韵与谐音（语言） */
    var l5 = [];
    var ph = score.detail.phonetic || {};
    if (ph.sameInitial && ph.sameInitial.length) {
      l5.push('声母相撞：' + ph.sameInitial.join('、') +
        '　连读会发懒音，是比较明显的拗口问题。');
    }
    if (ph.sameFinal && ph.sameFinal.length) {
      l5.push('叠韵：' + ph.sameFinal.join('、') + '　两个字的音会糊在一起。');
    }
    var homo = score.detail.homophone;
    if (homo) {
      l5.push(homo.pass
        ? '谐音检查：通过（' + homo.pinyin + '）'
        : '谐音检查：**有风险**（' + homo.pinyin + '）' +
          (homo.hits && homo.hits.length
            ? '，近似「' + homo.hits.map(function (h) { return h.word; }).join('、') + '」'
            : ''));
    }
    if (!l5.length) l5.push('声母、韵母、声调均无相撞。');
    l5.push('（音韵与命理无关，但名字每天都要被念，实际影响不比五行小）');
    add('语言', '音韵与谐音', l5,
      homo && !homo.pass ? 'warn' : 'neutral');

    /* 6f. 笔画数理（数理派） */
    if (score.detail.wuge) {
      var w = score.detail.wuge;
      add('数理', '三才五格', [
        '天格 ' + w['天格'] + '　人格 ' + w['人格'] + '　地格 ' + w['地格'] +
          '　总格 ' + w['总格'] + '　外格 ' + w['外格'],
        '三才 ' + w['三才'] + '（' + w['三才关系'] + '）→ ' + w['三才吉凶'],
        '说明：三才五格是**数理派**，按康熙笔画取数，与八字五行不同源。' +
        '本系统只给它 6 分（满分 100），权重远低于五行与音韵。'
      ]);
    }

    /* 6g. 出处与现代感 */
    var l7 = [];
    var kindLabel = {
      classic: '出处成词', weak: '疑似成词（非诗词类出处）',
      everyday: '常见词语，不算典故', line: '同句出处', poem: '同篇出处'
    };
    if (score.detail.poetry && score.detail.poetry.source) {
      l7.push((kindLabel[score.detail.pairKind] || '出处') + '：' +
        (score.detail.poetry.pair ? '「' + score.detail.poetry.pair + '」' : '') +
        '　《' + score.detail.poetry.source + '》' +
        (score.detail.poetry.line ? '「' + score.detail.poetry.line + '」' : ''));
    }
    if (score.detail.modern) {
      if (score.detail.modern.word) {
        l7.push('现代常用搭配：' + score.detail.modern.word);
      }
      if (score.detail.modern.era && score.detail.modern.era.length) {
        l7.push('偏上一代的用字：' + score.detail.modern.era.join('、') +
          '　（这是时代感判断，不是命理问题）');
      }
    }
    var era = chars.filter(function (c) { return c.eraChar; }).map(function (c) {
      return c.char;
    });
    if (era.length && !(score.detail.modern && score.detail.modern.era)) {
      l7.push('偏上一代的用字：' + era.join('、'));
    }
    if (l7.length) add('语言', '出处与时代感', l7);

    /* ---- 7. 汇总 ---- */
    var total = score.score;
    var verdict;
    if (total >= 75) verdict = '综合来看是个好名字。';
    else if (total >= 65) verdict = '整体不错，个别维度还能再调。';
    else if (total >= 55) verdict = '中规中矩，有明显的可改进之处。';
    else verdict = '从这个生辰看，这个名字的匹配度偏低。';

    var highlights = [];
    if (xiyongshen.length) {
      var idle = chars.filter(function (c) { return c.wxLevel === 'idle'; });
      if (idle.length === chars.length) {
        highlights.push('两个字都不补喜用神 —— 通常这是最值得改的一点');
      }
      if (idle.length === 2 && total >= 65) {
        highlights.push('不过其余维度（音韵、寓意、数理）补偿得不错');
      }
    }
    if (homo && !homo.pass) highlights.push('谐音风险需要优先处理');
    if (era.length) highlights.push('用字偏上一代风格');
    if (inferred.length) highlights.push('含推断字，笔画与五行不保证准确');
    if (zodiac && zodiac.conflicts.length) {
      highlights.push('存在口径冲突（见上），取舍时以八字为准');
    }

    return {
      surname: surname,
      given: given,
      fullName: surname + given,
      pinyin: (score.detail.homophone && score.detail.homophone.pinyin) || '',
      chars: chars,
      unknownChars: unknown,
      inferredChars: inferred,
      bazi: bazi,
      zodiac: zodiac,
      hexagram: hexagram,
      score: score,
      total: total,
      reasons: score.reasons,
      blocks: blocks,
      highlights: highlights,
      verdict: verdict,
      /* 报告末尾的总体声明，必须每次都带上 */
      disclaimer: '本报告只做「用字与生辰是否相配」的分析，**不预测命运**。' +
        '其中八字五行属正统命理，三才五格属数理派，生肖/纳音/姓名卦属民俗流派，' +
        '三者在报告中已分别标注；彼此冲突时以八字五行为主，' +
        '但它们都**不是科学结论**，请当作参考而非依据。' +
        '（评估完全在本地完成，生辰八字不会上传到任何服务器。）'
    };
  };

  function zodiacFolkWhy(zodiac) {
    return (zodiac.folkAvoid && zodiac.folkAvoid.why) || '';
  }

  NS.Report = {
    evaluate: NS.evaluateName,
    BASIS_LABEL: BASIS_LABEL
  };

})(typeof window !== 'undefined' ? window : globalThis);
