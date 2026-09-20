/* =========================================================================
 * nickname.js —— 小名（乳名）建议
 *
 * 不做独立的小名用字库，而是**从已选中的大名里衍生**：
 * 用户认可了大名（字义、五行都合适），小名只要好叫、亲切、无谐音就够了。
 *
 * 候选 = 大名的每个用字 × 各构词法
 *   （叠字 / 小X / X宝 / 阿X / X儿 / X子 / X妹 / X仔 / X妞 / X哥 /
 *     单字 / 直接叫大名 / 小+两字 / 小+叠字）
 *
 * 评分因素：
 *   构词法常见度、用字是否小名友好、是否取末字（更常见）、性别是否相符
 *   普通话谐音（会淘汰）、姓氏连读谐音（扣分）、四川话谐音（扣分并提示）
 *
 * 为什么是「一组」而不是「一个」
 * ---------------------------------------------------------------
 * 用户反馈「小名也可以多样化，也不一定是叠词」。
 * 旧版返回分数最高的**一个**，而叠字权重最高（1.0），
 * 于是无论什么名字，建议永远只有叠词 —— 那不是「最合适」，
 * 是评分把其他构词法全压住了。
 *
 * 现在返回最多 5 个，并保证：
 *   1. 构词法互不重复（不会 5 个都是叠字）
 *   2. 两个用字都被覆盖（不会 5 个都是「和和 / 小和 / 和宝 / 阿和」）
 * 实现见 pickDiverse。
 * ========================================================================= */
(function (global) {
  'use strict';
  var NS = (global.NS = global.NS || {});

  /** 造一个附属字音节（小/阿/儿/宝/妹/仔/妞/哥/子）。
   *  这些字不在字库里，读音要自带，否则谐音检测拿不到音节。 */
  function affixSyllable(ch) {
    var a = NS.NICKNAME_AFFIX_PINYIN[ch];
    return a ? { char: ch, pinyin: a.pinyin, tone: a.tone }
      : { char: ch, pinyin: '', tone: 0 };
  }

  function cloneSyllable(s) {
    return { char: s.char, pinyin: s.pinyin, tone: s.tone };
  }

  /**
   * 取候选小名的音节序列（用于谐音检测与拼音显示）
   * @param {Object} pattern 构词模板
   * @param {Object} info 当前用字的字库条目（双字构词法时为 null）
   * @param {Array} fullSyllables 整个大名的音节序列
   */
  function syllablesFor(pattern, info, fullSyllables) {
    var base = info
      ? { char: info.char, pinyin: info.pinyin, tone: info.tone }
      : null;
    var full = (fullSyllables || []).map(cloneSyllable);

    /* 带后缀的（X宝 / X妹 / X仔 …）统一走这里 */
    if (pattern.suffix) return [base, affixSyllable(pattern.suffix)];

    switch (pattern.id) {
      case 'repeat': return [base, cloneSyllable(base)];
      case 'xiaoDie': return [affixSyllable('小'), base, cloneSyllable(base)];
      case 'xiao': return [affixSyllable('小'), base];
      case 'a': return [affixSyllable('阿'), base];
      case 'er': return [base, affixSyllable('儿')];
      case 'full': return full;
      case 'xiaofull': return [affixSyllable('小')].concat(full);
      default: return [base];
    }
  }

  function pinyinText(syllables) {
    return syllables.map(function (s) {
      return NS.Pinyin.toneMark(s.pinyin, s.tone);
    }).join(' ');
  }

  /**
   * 从用字推断性别倾向，用于筛掉明显性别不符的构词法。
   * 不该给女孩推「X仔」、给男孩推「X妞」。
   * 判定不明确（男女字都有 / 全是中性）时返回 null，表示不筛。
   */
  function inferGender(givenChars) {
    var hasF = false, hasM = false;
    givenChars.forEach(function (info) {
      if (info.gender === '女') hasF = true;
      else if (info.gender === '男') hasM = true;
    });
    if (hasF && !hasM) return '女';
    if (hasM && !hasF) return '男';
    return null;
  }

  /**
   * 多样性挑选：同时保证「构词法不重复」和「两个用字都被覆盖」。
   *
   * 只按分数取前 N 个会得到「和和 / 清和 / 小和 / 和宝」——
   * 四种构词法但全来自同一个字，等于没多样。
   * 所以分三轮：
   *   1. 按用字轮流取，每个字配一个还没用过的构词法（覆盖两个用字）
   *   2. 补足剩余构词法（覆盖更多说法）
   *   3. 还不够就放宽（候选本来就少时，比如单字名）
   */
  function pickDiverse(sorted, limit) {
    var out = [], usedP = Object.create(null), i;

    /* 第一轮：每个用字先各拿一个 */
    var order = [], seenChar = Object.create(null);
    for (i = 0; i < sorted.length; i++) {
      if (seenChar[sorted[i].baseChar]) continue;
      seenChar[sorted[i].baseChar] = 1;
      order.push(sorted[i].baseChar);
    }
    order.forEach(function (ch) {
      if (out.length >= limit) return;
      for (var j = 0; j < sorted.length; j++) {
        var r = sorted[j];
        if (r.baseChar !== ch || usedP[r.pattern]) continue;
        usedP[r.pattern] = 1;
        out.push(r);
        return;
      }
    });

    /* 第二轮：补足剩余构词法 */
    for (i = 0; i < sorted.length && out.length < limit; i++) {
      if (usedP[sorted[i].pattern]) continue;
      usedP[sorted[i].pattern] = 1;
      out.push(sorted[i]);
    }

    /* 第三轮：放宽 */
    for (i = 0; i < sorted.length && out.length < limit; i++) {
      if (out.indexOf(sorted[i]) >= 0) continue;
      out.push(sorted[i]);
    }

    out.sort(function (a, b) { return b.score - a.score; });
    return out;
  }

  /**
   * 为一个大名推荐小名（**一组**候选，不是单个）
   * @param {Array<Object>} givenChars 名字用字（CHAR_DB 条目）
   * @param {string} surname 姓氏原文
   * @param {Object} [ctx] { surnameSyllables, sichuan, limit, gender }
   * @returns {Array<Object>} 按分数降序，构词法与用字都已做多样性约束
   */
  function suggest(givenChars, surname, ctx) {
    ctx = ctx || {};
    if (!givenChars || !givenChars.length) return [];

    /* 姓氏读音：没传就从姓氏库自己查。
     * 依赖调用方传好容易漏，漏了就静默不做「姓+小名」的谐音检查。 */
    var surnameSyllables = ctx.surnameSyllables;
    if (!surnameSyllables) {
      var sur = surname ? NS.SURNAME_DB[surname] : null;
      surnameSyllables = sur
        ? sur.pinyin.map(function (p, i) {
          return { char: surname[i], pinyin: p, tone: sur.tones[i] };
        })
        : [];
    }

    var wantSichuan = !!ctx.sichuan && NS.Dialect.available();
    var limit = ctx.limit || 5;
    var gender = ctx.gender || inferGender(givenChars);
    var fullStr = givenChars.map(function (i) { return i.char; }).join('');
    var fullSyllables = givenChars.map(function (i) {
      return { char: i.char, pinyin: i.pinyin, tone: i.tone };
    });
    var results = [];

    /** 给单个候选打分并收集 */
    function addCandidate(pattern, info, isLast) {
      /* 双字构词法（直接叫 / 小+两字）不绑定单个用字，
       * 用字取末字来判「小名友好度」——小名习惯取末字。 */
      var baseInfo = info || givenChars[givenChars.length - 1];
      var name = pattern.build(baseInfo.char, fullStr);
      var syllables = syllablesFor(pattern, info, fullSyllables);

      var score = 0;
      var reasons = [];

      /* 构词法常见度 */
      score += pattern.weight * 20;

      /* 用字友好度 */
      if (NS.NICKNAME_FRIENDLY[baseInfo.char]) {
        score += 26;
        reasons.push('「' + baseInfo.char + '」是小名常用字');
      }
      if (NS.NICKNAME_AWKWARD[baseInfo.char]) {
        score -= 28;
        reasons.push('「' + baseInfo.char + '」叠叫偏生硬');
      }

      /* 取末字更符合习惯 */
      if (isLast && givenChars.length > 1) score += 6;

      /* 单字小名只在名字本身够亲切时才考虑 */
      if (pattern.id === 'single' && !NS.NICKNAME_FRIENDLY[baseInfo.char]) {
        score -= 10;
      }

      /* 性别不明的名字，带性别倾向的后缀（X妹/X仔）适当降权，
       * 不是排除 —— 用户没选性别时也可能就想要「X妹」。 */
      if (pattern.gender && !gender) score -= 6;

      /* 性别相符时反过来给奖励。
       * 不加这一条的话，X妹/X仔/X妞/X哥 这几个「地域叫法」的权重
       * 本来就低（0.44-0.54），永远进不了 top 5 —— 等于加了白加。
       * 而名字性别明确时，「雪妹」比「阿雪」更贴切，值得往上排。 */
      if (pattern.gender && gender && pattern.gender === gender) score += 6;

      /* 普通话谐音：小名单独念 */
      var homo = NS.Pinyin.checkHomophone(syllables);
      if (!homo.pass) {
        score -= 60;
      } else {
        score += 12;
        reasons.push('普通话无谐音');
      }

      /* 姓氏连读（有人会连姓一起叫） */
      var withSurname = null;
      if (surnameSyllables.length) {
        withSurname = NS.Pinyin.checkHomophone(
          surnameSyllables.concat(syllables));
        if (!withSurname.pass) {
          score -= 26;
          reasons.push('与姓氏连读有谐音风险');
        }
      }

      /* 四川话：只提示不淘汰 */
      var sichuan = null;
      if (wantSichuan) {
        sichuan = NS.Dialect.check(name);
        if (sichuan.hits && sichuan.hits.length) {
          score -= 20;
        }
      }

      results.push({
        name: name,
        pattern: pattern.id,
        patternLabel: pattern.label,
        baseChar: baseInfo.char,
        pinyin: pinyinText(syllables),
        score: Math.round(score),
        reasons: reasons,
        homophone: homo,
        homophoneWithSurname: withSurname,
        sichuan: sichuan,
        excluded: !homo.pass
      });
    }

    NS.NICKNAME_PATTERNS.forEach(function (pattern) {
      /* 双字构词法（直接叫 / 小+两字）只算一次，否则会按用字数重复 */
      if (pattern.needFull) {
        if (givenChars.length < 2) return;
        if (pattern.gender && gender && pattern.gender !== gender) return;
        addCandidate(pattern, null, true);
        return;
      }
      givenChars.forEach(function (info, idx) {
        /* 性别不符的后缀直接不生成：不该给女孩推「X仔」、给男孩推「X妞」 */
        if (pattern.gender && gender && pattern.gender !== gender) return;
        addCandidate(pattern, info, idx === givenChars.length - 1);
      });
    });

    var usable = results.filter(function (r) { return !r.excluded; });
    if (!usable.length) {
      /* 全部有谐音问题：把最高分的几个标上风险返回，让用户自己判断 */
      results.sort(function (a, b) { return b.score - a.score; });
      var risky = pickDiverse(results, limit);
      risky.forEach(function (r) { r.risky = true; });
      return risky;
    }
    usable.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      /* 同分优先叠字（最常见） */
      return a.pattern === 'repeat' ? -1 : 1;
    });
    return pickDiverse(usable, limit);
  }

  /**
   * 给一批名字结果补充小名建议
   * @param {Array} items 生成结果
   * @param {Object} opts { surname, surnameSyllables, sichuan, gender, limit }
   */
  function attach(items, opts) {
    var count = 0;
    (items || []).forEach(function (item) {
      var chars = (item.chars || []).map(function (c) {
        return NS.CHAR_DB[c];
      }).filter(Boolean);
      if (!chars.length) return;
      var list = suggest(chars, opts.surname, opts);
      item.nicknames = list;           /* 一组候选 */
      item.nickname = list[0] || null; /* 首个，兼容旧调用方 */
      if (list.length) count++;
    });
    return count;
  }

  NS.Nickname = {
    suggest: suggest,
    attach: attach,
    pinyinText: pinyinText
  };
})(typeof window !== 'undefined' ? window : globalThis);
