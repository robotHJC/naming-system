/* =========================================================================
 * nickname.js —— 小名（乳名）建议
 *
 * 不做独立的小名用字库，而是**从已选中的大名里衍生**：
 * 用户认可了大名（字义、五行都合适），小名只要好叫、亲切、无谐音就够了。
 *
 * 候选 = 大名的每个用字 × 五种构词法（叠字 / 小X / 阿X / X儿 / 单字）
 * 评分因素：
 *   构词法常见度、用字是否小名友好、是否取末字（更常见）
 *   普通话谐音（会淘汰）、姓氏连读谐音（扣分）、四川话谐音（扣分并提示）
 * ========================================================================= */
(function (global) {
  'use strict';
  var NS = (global.NS = global.NS || {});

  function el(obj, key, def) {
    return obj && obj[key] !== undefined ? obj[key] : def;
  }

  /**
   * 取候选小名的音节序列（用于谐音检测与拼音显示）
   * @param {Object} pattern
   * @param {Object} charInfo 字库条目
   */
  function syllablesFor(pattern, charInfo) {
    var affix = NS.NICKNAME_AFFIX_PINYIN;
    var base = { char: charInfo.char, pinyin: charInfo.pinyin, tone: charInfo.tone };
    switch (pattern.id) {
      case 'repeat':
        return [base, { char: charInfo.char, pinyin: charInfo.pinyin, tone: charInfo.tone }];
      case 'xiao':
        return [{ char: '小', pinyin: affix['小'].pinyin, tone: affix['小'].tone }, base];
      case 'a':
        return [{ char: '阿', pinyin: affix['阿'].pinyin, tone: affix['阿'].tone }, base];
      case 'er':
        return [base, { char: '儿', pinyin: affix['儿'].pinyin, tone: affix['儿'].tone }];
      default:
        return [base];
    }
  }

  function pinyinText(syllables) {
    return syllables.map(function (s) {
      return NS.Pinyin.toneMark(s.pinyin, s.tone);
    }).join(' ');
  }

  /**
   * 为一个大名推荐小名
   * @param {Array<Object>} givenChars 名字用字（CHAR_DB 条目）
   * @param {string} surname 姓氏原文
   * @param {Object} [ctx] { surnameSyllables, sichuan:boolean }
   * @returns {Object|null}
   */
  function suggest(givenChars, surname, ctx) {
    ctx = ctx || {};
    if (!givenChars || !givenChars.length) return null;

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
    var results = [];

    givenChars.forEach(function (info, idx) {
      var isLast = idx === givenChars.length - 1;
      NS.NICKNAME_PATTERNS.forEach(function (pattern) {
        var name = pattern.build(info.char);
        var syllables = syllablesFor(pattern, info);

        var score = 0;
        var reasons = [];

        /* 构词法常见度 */
        score += pattern.weight * 20;

        /* 用字友好度 */
        if (NS.NICKNAME_FRIENDLY[info.char]) {
          score += 26;
          reasons.push('「' + info.char + '」是小名常用字');
        }
        if (NS.NICKNAME_AWKWARD[info.char]) {
          score -= 28;
          reasons.push('「' + info.char + '」叠叫偏生硬');
        }

        /* 取末字更符合习惯 */
        if (isLast && givenChars.length > 1) score += 6;

        /* 单字小名只在名字本身够亲切时才考虑 */
        if (pattern.id === 'single' && !NS.NICKNAME_FRIENDLY[info.char]) {
          score -= 10;
        }

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
          baseChar: info.char,
          pinyin: pinyinText(syllables),
          score: Math.round(score),
          reasons: reasons,
          homophone: homo,
          homophoneWithSurname: withSurname,
          sichuan: sichuan,
          excluded: !homo.pass
        });
      });
    });

    var usable = results.filter(function (r) { return !r.excluded; });
    if (!usable.length) {
      /* 全部有谐音问题：返回分数最高但标记风险，让用户自己判断 */
      results.sort(function (a, b) { return b.score - a.score; });
      var fallback = results[0];
      if (fallback) fallback.risky = true;
      return fallback || null;
    }
    usable.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      /* 同分优先叠字（最常见） */
      return a.pattern === 'repeat' ? -1 : 1;
    });
    return usable[0];
  }

  /**
   * 给一批名字结果补充小名建议
   * @param {Array} items 生成结果
   * @param {Object} opts { surname, surnameSyllables, sichuan }
   */
  function attach(items, opts) {
    var count = 0;
    (items || []).forEach(function (item) {
      var chars = (item.chars || []).map(function (c) {
        return NS.CHAR_DB[c];
      }).filter(Boolean);
      if (!chars.length) return;
      item.nickname = suggest(chars, opts.surname, opts);
      if (item.nickname) count++;
    });
    return count;
  }

  NS.Nickname = {
    suggest: suggest,
    attach: attach,
    pinyinText: pinyinText
  };
})(typeof window !== 'undefined' ? window : globalThis);
