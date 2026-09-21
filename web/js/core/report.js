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
      /* 传原始整名：评估的名字可能含字库外的字，
       * 靠 score.js 从 rows 拼会拼错，导致「整名成词」检查失效 */
      given: given,
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
      /* 生辰模糊是**必须前置说明**的前提：同一个日期换个时辰，
       * 整张盘的五行强弱就可能翻转，不能让人以为这是完整四柱。
       * 三档由粗到细写，只说最粗的那一档，避免堆成一片。 */
      if (bazi.noMonth) {
        l1.push('**只知道出生年份** —— 月柱、日柱、时柱都无法确定，' +
          '上面的五行分布只计入了年柱。年柱本身也是按「立春后」推定的：' +
          '若生于当年 1 月 1 日到 2 月初之间，年柱与生肖应当退一年。');
      } else if (bazi.noDay) {
        l1.push('**只知道出生年月** —— 日柱与时柱无法确定，' +
          '上面的五行分布只计入了年柱与月柱。月柱是按**该月 15 日**推定的：' +
          '每个月的「节」落在 3–9 日，所以只有生于该月 1–8 日左右才可能有差异。');
      } else if (bazi.noHour) {
        l1.push('**时辰未填** —— 时柱无法确定，上面的五行力量与十神' +
          '都没有计入时柱，喜用神是按年、月、日三柱推的。' +
          '这只代表大概方向；若能问到出生时辰，填上后结果会准很多。');
      }
      /* 没有日柱就没有日主。这一句必须紧跟上面那段 ——
       * 否则用户会以为「喜用神」那行为什么是空的。 */
      if (bazi.dayGan === null) {
        l1.push('日主：**未知**（缺少日柱）—— 身强身弱、十神、喜用神' +
          '都是以日主为参照物推出来的，没有日柱就一个都算不了。' +
          '所以本系统**不做喜用神判断**，选字只按名字本身的五行搭配评分。' +
          '若能问到具体出生日期，结果会完整得多。');
      } else {
        l1.push('日主 ' + bazi.dayGan + '（' + bazi.dayWx + '），' +
          bazi.strength + '（同党 ' + (bazi.ratio * 100).toFixed(0) + '%）');
      }
      var cnt = NS.WUXING.map(function (w) {
        return w + ' ' + (bazi.count[w] || 0);
      }).join('　');
      l1.push('五行分布：' + cnt);
      l1.push('喜用神：' + (bazi.xiyongshen.join('、') || '未能推断'));
      if (bazi.missing.length) {
        l1.push('八字中不显的五行：' + bazi.missing.join('、') +
          '（注意：「缺」不等于「需要补」，要看喜用神，' +
          '身旺时缺的往往正是该泄的）');
      }
      add('命理', '八字排盘', l1);

      /* 6a-2. 十神。
       * 与「五行分布」是同一批能量的两种说法：五行讲属性，
       * 十神讲这股能量相对日主扮演什么角色（同辈／长辈／子女／财／官）。
       * 列全十个而不是只列有的 —— 「十神齐不齐」本身就有人看。 */
      if (bazi.shishen) {
        var l2 = [];
        l2.push('日主 ' + bazi.dayGan + '（' + bazi.dayYinYang + bazi.dayWx + '）' +
          '　日柱天干即日主本身，不属十神');
        var ssLine = NS.Bazi.SHISHEN_ORDER.map(function (n) {
          var v = bazi.shishen.power[n] || 0;
          return n + ' ' + (v ? v.toFixed(1) : '—');
        }).join('　');
        l2.push('十神力量：' + ssLine);
        l2.push('按天干 1.0、藏干本气 1.0 / 中气 0.5 / 余气 0.3、月令 ×1.5 加权。' +
          '日柱天干是日主自己，不计入。');
        if (bazi.shishen.missing.length) {
          l2.push('八字里没有出现的十神：' + bazi.shishen.missing.join('、') +
            '。与「五行缺」同理 —— **缺什么不等于该补什么**，' +
            '要看它对日主是喜是忌，本系统不因「缺某个十神」而改推荐。');
        }
        add('命理', '十神', l2);
      }

      /* 6a-3. 调候（寒暖燥湿）。
       * 只做「冬宜火、夏宜水」这条无争议的核心原则 ——
       * 春秋不判定（见 core/tiaohou.js 头部的说明）。
       * 与扶抑法不一致时并列指出，不改推荐。 */
      if (bazi.tiaohou && bazi.tiaohou.applies) {
        var l3 = [];
        l3.push('月支 ' + bazi.tiaohou.monthZhi + '（' + bazi.tiaohou.seasonLabel +
          '），调候上宜见 **' + bazi.tiaohou.needWx + '**；' +
          '本命局该五行占 ' + (bazi.tiaohou.ratio * 100).toFixed(0) + '%，' +
          (bazi.tiaohou.weak ? '偏虚。' : '不虚，无需特别调候。'));
        if (bazi.tiaohou.conflict) {
          l3.push('**两种口径不一致**：扶抑法取「' + bazi.xiyongshen.join('、') +
            '」，调候法取「' + bazi.tiaohou.needWx + '」。');
          l3.push('本系统默认以**扶抑法**为准 —— 调候只是多给一个视角，' +
            '不因此改动推荐结果。两者本来就不是一套体系：' +
            '扶抑看的是全局力量对比，调候看的只是寒暖燥湿。' +
            '真要取舍，建议找真人命理师按全盘定夺。');
          add('命理', '调候（与扶抑法口径不一致）', l3, 'warn');
        } else {
          l3.push('与扶抑法取的喜用神方向一致。');
          add('命理', '调候', l3);
        }
      }

      /* 6a-4. 地支刑冲合害。**只展示、不改推荐** ——
       * 按地支关系去修正五行力量（合化/冲损）是有流派分歧的做法，
       * 详见 core/branches.js 头部。 */
      if (bazi.branchRel) {
        var br = bazi.branchRel;
        var l4 = [];
        l4.push('四支：' + br.pillars.map(function (p) { return p.zhi; }).join(' '));
        var parts = [];
        br.chong.forEach(function (c) { parts.push(c.a + c.b + ' 冲（' + c.where + '）'); });
        br.he.forEach(function (c) { parts.push(c.a + c.b + ' 合（' + c.where + '）'); });
        br.xing.forEach(function (c) {
          parts.push(c.full
            ? c.a + ' ' + c.name
            : c.a + c.b + ' ' + (c.a === c.b ? '自刑' : c.name) +
              '（' + c.where + '）');
        });
        br.hai.forEach(function (c) { parts.push(c.a + c.b + ' 害（' + c.where + '）'); });
        l4.push(parts.length ? '关系：' + parts.join('　') : '四支之间没有冲/合/刑/害');
        br.sanhe.concat(br.sanhui).forEach(function (g) {
          l4.push(g.label + '　' + (g.complete
            ? '三支齐全'
            : '已有 ' + g.present.join('、') + '，独缺「' + g.missing.join('、') + '」'));
        });
        if (br.note) l4.push(br.note);
        br.advice.forEach(function (a) {
          l4.push('**' + a.title + '**　' + a.text);
        });
        l4.push('说明：地支的冲合刑害是传统命理判断命局松紧的基本依据，' +
          '这里如实列出。但**按地支关系去修正五行力量（合化、冲损）各家说法不一** —— ' +
          '三合成局要不要真化成那个五行，要看月令、透干、有没有被冲破，' +
          '各本条件不同，所以本系统**不拿它改喜用神，也不因此调分**。' +
          '上面给的选字思路是可选参考，不是必须。');
        add('命理', '地支刑冲合害', l4);
      }
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
    /* 拿不到喜用神有两种原因，说法必须分开 ——
     * 「没填生辰」与「填了但缺日柱推不出日主」对用户的意思完全不同，
     * 混成一句话，填了模糊生辰的人会以为是系统没读到他填的东西。 */
    var noXiWhy = (bazi && bazi.dayGan === null)
      ? '生辰信息不足（缺日柱 → 没有日主）→ 推不出喜用神，'
      : '没有填生辰 → 无法判断喜用神，';
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
      l2.concat(xiyongshen.length ? [] : ['', noXiWhy +
        '上面只列出了每个字本身的五行与笔画，'
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
    /* 四呼格局：v2 新增，直接刻画「口型打开没有」。
     * 这一句是整块音韵里最该被读到的 —— 它解释的正是
     * 「声母韵母声调都不撞、却依然不好听」那个最让人困惑的情况。 */
    if (ph.kaidu && ph.kaidu.length && ph.dullRatio !== undefined) {
      var kdTxt = ph.kaidu.join('-');
      if (ph.dullRatio >= 1) {
        l5.push('开口度：' + kdTxt + '　**全名没有一个开口音**' +
          '（a/o/e/ai/an/ang…），口型始终没打开，读起来是闷的。' +
          '**这是「声母韵母都不撞却依然不好听」最常见的原因。**');
      } else if (ph.dullRatio >= 0.67) {
        l5.push('开口度：' + kdTxt + '　开口音偏少，读起来略闷。');
      } else {
        l5.push('开口度：' + kdTxt + '　开口音足够，读起来是明亮的。');
      }
    }
    if (ph.nasalSame) {
      l5.push('鼻音韵尾**同型**连用（都是' +
        (ph.nasalType === 'ng' ? '后鼻音' : '前鼻音') +
        '），读起来含糊。（前鼻接后鼻反而有变化，不算问题）');
    }
    if (ph.zeroRun) {
      l5.push('相邻两字都是零声母（y/w 起头），中间没有辅音起头，连读容易粘连。');
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
    if (!l5.length) l5.push('声母、韵母、声调均无相撞，开口度也足够。');
    l5.push('（音韵与命理无关，但名字每天都要被念，实际影响不比五行小）');
    add('语言', '音韵与谐音', l5,
      homo && !homo.pass ? 'warn' : 'neutral');

    /* 6f. 笔画数理（数理派） */
    if (score.detail.wuge) {
      var w = score.detail.wuge;
      var lw = [
        '天格 ' + w['天格'] + '　人格 ' + w['人格'] + '　地格 ' + w['地格'] +
        '　总格 ' + w['总格'] + '　外格 ' + w['外格'],
        '三才 ' + w['三才'] + '（' + w['三才关系'] + '）→ ' + w['三才吉凶']
      ];
      /* 八十一数理判语。这是姓名学里最常被引用的内容，
       * 但各家印本对少数数的吉凶分级有出入（26/27/30/38/51/55/58/71/73/75/77/78），
       * 本表取了较通行的一种，因此只作展示、不加分。 */
      if (NS.shuliOf) {
        var sl = ['天格', '人格', '地格', '总格', '外格'].map(function (k) {
          var s = NS.shuliOf(w[k]);
          return s ? k + ' ' + w[k] + '「' + s.name + '·' + s.ji + '」' : null;
        }).filter(Boolean);
        if (sl.length) {
          lw.push('八十一数理：' + sl.join('　'));
          var jiCount = sl.filter(function (x) { return x.indexOf('·吉') >= 0; }).length;
          var xiongCount = sl.filter(function (x) { return x.indexOf('·凶') >= 0; }).length;
          lw.push('其中吉 ' + jiCount + ' 格、凶 ' + xiongCount + ' 格。' +
            '五格剖象法认为**人格与总格最重要** —— ' +
            '总格看一生总运，人格看一生命运与性格。');
        }
      }
      lw.push('说明：三才五格与八十一数理都是**数理派**（源自五格剖象法），' +
        '按康熙笔画取数，与八字五行不同源；' +
        '八十一数的吉凶分级各家印本还略有出入，本表取了较通行的一种。' +
        '本系统只给三才五格 6 分（满分 100），权重远低于五行与音韵，' +
        '八十一数理只作展示、不参与评分。');
      add('数理', '三才五格', lw);
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
