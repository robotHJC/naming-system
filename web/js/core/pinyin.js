/* =========================================================================
 * pinyin.js —— 拼音切分、音韵分析与谐音检测
 * ========================================================================= */
(function (global) {
  'use strict';
  var NS = (global.NS = global.NS || {});

  /* 声母表：注意 zh/ch/sh 必须排在 z/c/s 之前 */
  var INITIALS = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l',
    'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's', 'y', 'w'];

  function splitSyllable(py) {
    py = String(py || '').toLowerCase();
    for (var i = 0; i < INITIALS.length; i++) {
      if (py.indexOf(INITIALS[i]) === 0) {
        return { initial: INITIALS[i], final: py.slice(INITIALS[i].length) };
      }
    }
    return { initial: '', final: py };
  }

  /** 去声调、归一化，用于谐音比较 */
  function normalize(py) {
    return String(py || '')
      .toLowerCase()
      .replace(/u:/g, 'ü')
      .replace(/v/g, 'ü')
      .replace(/[1-5]/g, '');
  }

  /* ---------------- 谐音检测 ---------------- */

  /**
   * @param {Array<{char:string, pinyin:string, tone:number}>} syllables
   *        顺序：姓（1-2 字）+ 名（1-2 字）
   * @param {string} surnameText 姓氏原文
   * @returns {{pass:boolean, hits:Array, warnings:Array, pinyin:string}}
   */
  function checkHomophone(syllables) {
    var hits = [];
    var warnings = [];

    /* 1) 字面不雅字 */
    for (var i = 0; i < syllables.length; i++) {
      if (NS.BAD_CHARS.indexOf(syllables[i].char) >= 0) {
        hits.push({ type: '字面', word: syllables[i].char, desc: '含不雅字' });
      }
    }

    var pys = syllables.map(function (s) { return normalize(s.pinyin); });
    var tones = syllables.map(function (s) { return s.tone || 0; });

    /* 2) 音节序列匹配：先按无声调粗略筛出候选，再比声调算匹配度 */
    var seen = Object.create(null);
    for (var start = 0; start < pys.length; start++) {
      for (var len = 2; len <= 4 && start + len <= pys.length; len++) {
        var key = pys.slice(start, start + len).join('-');
        if (seen[key]) continue;
        seen[key] = true;

        var cands = NS.HOMO_INDEX[key];
        if (!cands) continue;

        var best = null;
        for (var ci = 0; ci < cands.length; ci++) {
          var sev = severity(cands[ci], tones, start);
          if (!best || sev > best.severity) {
            best = { severity: sev, cand: cands[ci] };
          }
        }
        if (!best) continue;

        var entry = best.cand;
        var isBlock = !entry.soft && best.severity >= NS.HOMO_BLOCK_SEVERITY;
        var isWarn = !isBlock && best.severity >= NS.HOMO_WARN_SEVERITY
          && (entry.soft || len >= 3);
        if (!isBlock && !isWarn) continue;

        (isBlock ? hits : warnings).push({
          type: isBlock ? '连读' : '轻度谐音',
          word: pys.slice(start, start + len).join(' '),
          desc: '连读近似「' + entry.word + '」',
          severity: best.severity
        });
      }
    }

    /* 4) 拗口 / 音韵提示（不影响通过与否） */
    if (syllables.length >= 2) {
      var parts = syllables.map(function (s) { return splitSyllable(s.pinyin); });
      var initials = parts.map(function (p) { return p.initial; });
      var finals = parts.map(function (p) { return p.final; });
      var tones = syllables.map(function (s) { return s.tone; });

      if (uniqueness(initials) === 1) {
        warnings.push({ type: '音韵', desc: '各字声母相同，读起来略拗口' });
      }
      if (uniqueness(finals) === 1) {
        warnings.push({ type: '音韵', desc: '各字韵母相同，缺少变化' });
      }
      if (uniqueness(tones) === 1 && syllables.length > 1) {
        warnings.push({ type: '音韵', desc: '声调完全相同，缺少抑扬顿挫' });
      }
      /* 姓末字与名首字声母相同 */
      if (initials.length >= 2 && initials[0] &&
        initials[0] === initials[1]) {
        warnings.push({ type: '音韵', desc: '姓名交接处声母相同，衔接略生硬' });
      }
    }

    return {
      pass: hits.length === 0,
      hits: hits,
      warnings: warnings,
      pinyin: pys.join(' ')
    };
  }

  function uniqueness(arr) {
    var s = Object.create(null), n = 0;
    arr.forEach(function (x) { if (!s[x]) { s[x] = 1; n++; } });
    return n;
  }

  /**
   * 声调匹配度：命中音节数 / 总音节数
   * 声调 0（未知）与 5（轻声）视为通配；候选词本身声调未知(0)也通配。
   */
  function severity(cand, tones, start) {
    var n = cand.syllables.length;
    if (!n || cand.tones.length !== n) return 0;
    var hit = 0;
    for (var i = 0; i < n; i++) {
      var nt = tones[start + i] || 0;
      var bt = cand.tones[i];
      if (nt === 0 || bt === 0 || bt === 5 || nt === bt) hit++;
    }
    return hit / n;
  }

  /* ---------------- 声调符号 ---------------- */

  var TONE_MAP = {
    a: 'āáǎà', o: 'ōóǒò', e: 'ēéěè',
    i: 'īíǐì', u: 'ūúǔù', 'ü': 'ǖǘǚǜ'
  };

  /**
   * 按标准标调规则给拼音加声调符号
   * 优先 a → o → e；iu 标 u，ui 标 i；其余标最后一个元音。
   */
  function toneMark(py, tone) {
    py = String(py || '');
    if (!tone || tone < 1 || tone > 4) return py;
    var target = -1;
    var lower = py.toLowerCase();

    if (lower.indexOf('a') >= 0) {
      target = lower.indexOf('a');
    } else if (lower.indexOf('o') >= 0) {
      target = lower.indexOf('o');
    } else if (lower.indexOf('e') >= 0) {
      target = lower.indexOf('e');
    } else if (lower.indexOf('iu') >= 0) {
      target = lower.indexOf('iu') + 1;   /* iu 标在 u 上：liú */
    } else if (lower.indexOf('ui') >= 0) {
      target = lower.indexOf('ui') + 1;   /* ui 标在 i 上：shuǐ */
    } else {
      for (var i = py.length - 1; i >= 0; i--) {
        var ch = lower.charAt(i);
        if (ch === 'i' || ch === 'u' || ch === 'ü' || ch === 'ü') {
          target = i; break;
        }
      }
    }
    if (target < 0) return py;

    var vowel = lower.charAt(target);
    var marks = TONE_MAP[vowel];
    if (!marks) return py;
    return py.slice(0, target) + marks.charAt(tone - 1) + py.slice(target + 1);
  }

  /**
   * 把带调拼音拆成「无调拼音 + 声调数字」
   *   'yī' → {plain:'yi', tone:1}
   *   'lǜ' → {plain:'lü', tone:4}
   *   'yi2' → {plain:'yi', tone:2}
   *   'nv'  → {plain:'nü', tone:0}
   * 用于把联网拼音表的数据转成本字库的存储格式。
   */
  var TONE_STRIP = {
    'ā': ['a', 1], 'á': ['a', 2], 'ǎ': ['a', 3], 'à': ['a', 4],
    'ē': ['e', 1], 'é': ['e', 2], 'ě': ['e', 3], 'è': ['e', 4],
    'ī': ['i', 1], 'í': ['i', 2], 'ǐ': ['i', 3], 'ì': ['i', 4],
    'ō': ['o', 1], 'ó': ['o', 2], 'ǒ': ['o', 3], 'ò': ['o', 4],
    'ū': ['u', 1], 'ú': ['u', 2], 'ǔ': ['u', 3], 'ù': ['u', 4],
    'ǖ': ['ü', 1], 'ǘ': ['ü', 2], 'ǚ': ['ü', 3], 'ǜ': ['ü', 4],
    'ü': ['ü', 0], 'ń': ['n', 2], 'ň': ['n', 3], 'ǹ': ['n', 4]
  };

  function stripTone(py) {
    py = String(py || '').trim().toLowerCase().replace(/u:/g, 'ü');
    var tone = 0;
    var out = '';
    for (var i = 0; i < py.length; i++) {
      var ch = py.charAt(i);
      var hit = TONE_STRIP[ch];
      if (hit) {
        out += hit[0];
        if (hit[1] && !tone) tone = hit[1];
      } else if (ch >= '1' && ch <= '5') {
        if (ch !== '5' && !tone) tone = parseInt(ch, 10);
      } else if (ch === 'v') {
        out += 'ü';
      } else {
        out += ch;
      }
    }
    return { plain: out, tone: tone };
  }

  NS.Pinyin = {
    INITIALS: INITIALS,
    splitSyllable: splitSyllable,
    normalize: normalize,
    toneMark: toneMark,
    stripTone: stripTone,
    checkHomophone: checkHomophone
  };
})(typeof window !== 'undefined' ? window : globalThis);
