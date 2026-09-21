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

  /* =================================================================
   * 音韵分类层（音韵评分 v2 的基础设施）
   *
   * 旧的音韵检查只问「声母一样吗 / 韵母一样吗 / 声调一样吗」，
   * 但**「不一样」不等于「顺口」**。「李知微 zhī-wēi」三项全不撞，
   * 读起来依然发闷 —— 因为两个字都是齐齿呼，口型一直没打开。
   * 这一层补上两个维度：
   *   1. 发音部位（唇／舌尖中／舌根／舌面／舌尖后／舌尖前／零声母）
   *   2. 四呼开口度（开／齐／合／撮）—— 决定明亮还是发闷
   * ================================================================= */

  /* 声母按发音部位分类。
   * y/w 归「零声母」—— 它们不是真正的辅音声母，
   * 书写上只是介音 i/u 的改写（ya = ia、wu = u）。 */
  var POS = {
    b: '唇', p: '唇', m: '唇', f: '唇',
    d: '舌尖中', t: '舌尖中', n: '舌尖中', l: '舌尖中',
    g: '舌根', k: '舌根', h: '舌根',
    j: '舌面', q: '舌面', x: '舌面',
    zh: '舌尖后', ch: '舌尖后', sh: '舌尖后', r: '舌尖后',
    z: '舌尖前', c: '舌尖前', s: '舌尖前',
    y: '零声母', w: '零声母', '': '零声母'
  };

  /* 四呼开口度：开 = 明亮，齐/合/撮/舌尖 = 偏闷。
   * 键名用**书写省略式**（ui/iu/un），与字库里的拼音写法一致。 */
  var KAIDU = {};
  (function () {
    var put = function (kind, list) {
      for (var i = 0; i < list.length; i++) KAIDU[list[i]] = kind;
    };
    put('开', ['a', 'o', 'e', 'ai', 'ei', 'ao', 'ou', 'an', 'en',
      'ang', 'eng', 'er']);
    put('齐', ['i', 'ia', 'ie', 'iao', 'iu', 'ian', 'in', 'iang', 'ing']);
    put('合', ['u', 'ua', 'uo', 'uai', 'ui', 'uan', 'un', 'uang', 'ong']);
    put('撮', ['v', 've', 'van', 'vn', 'iong']);
    /* 舌尖元音：zhi/chi/shi/ri/zi/ci/si 的韵母写作 i，
     * 但实际读 [ɿ]/[ʅ]，**不是** [i]。音位学上属开口呼，
     * 听感上比 a/o/e 暗、比真 i 更闷。
     * 本层按「偏闷」处理 —— 这是**听感口径**，不是音位学分类；
     * 取名场景下用户反馈「李知微 zhī-wēi 闷」走的正是这个口径。 */
    put('舌尖', ['-i']);
  })();

  /* j/q/x 后面写的 u 实际都是 ü（ju=jü、xuan=xüan、que=qüe） */
  var JQX = { j: 1, q: 1, x: 1 };
  /* 舌尖元音的前接声母 */
  var ZHI_GROUP = { zh: 1, ch: 1, sh: 1, r: 1, z: 1, c: 1, s: 1 };
  /* 音位式 → 书写省略式（四呼表的键名） */
  var ALIAS = { uei: 'ui', iou: 'iu', uen: 'un', ueng: 'ong' };

  /**
   * 把「书写拼音的韵母」还原成「实际音位的韵母」。
   *
   * 为什么必须做：拼音里 y/w 不是声母，而是介音 i/u/ü 的改写。
   * 直接按书写形式查四呼表会**大面积判反**，共 17 种组合：
   *   ya   → 写成 a，   实际 ia（齐齿）   ← 会误判成「开口=明亮」
   *   yan  → 写成 an，  实际 ian（齐齿）  ← 同上，结论正好反了
   *   yu   → 写成 u，   实际 ü（撮口）
   *   wei  → 写成 ei，  实际 uei（合口）
   *   wo   → 写成 o，   实际 uo（合口）
   *   wang → 写成 ang， 实际 uang（合口） ← 也是会判反的一类
   * 所以必须先还原，再查表。
   */
  function realFinal(initial, final) {
    var f = final;
    /* j/q/x 后的 u 一律是 ü —— 不处理的话「萱 xuan」会被判成合口
     * 而不是撮口（虽然都算「闷」，但标签是错的） */
    if (JQX[initial] && f.charAt(0) === 'u') f = 'v' + f.slice(1);

    if (initial === 'y') {
      if (f.charAt(0) === 'i') { /* yi yin ying：本来就是 i 开头 */ }
      else if (f === 'u') f = 'v';          /* yu    → ü */
      else if (f === 'ue') f = 've';        /* yue   → üe */
      else if (f === 'uan') f = 'van';      /* yuan  → üan */
      else if (f === 'un') f = 'vn';        /* yun   → ün */
      else if (f === 'ong') f = 'iong';     /* yong  → iong */
      else if (f === 'e') f = 'ie';         /* ye    → ie */
      else if (f === 'ou') f = 'iou';       /* you   → iou */
      else f = 'i' + f;                     /* ya yao yan yang */
    } else if (initial === 'w') {
      if (f === 'u') { /* wu → u */ }
      else if (f === 'eng') f = 'ueng';     /* weng  → ueng */
      else f = 'u' + f;                     /* wa wo wai wei wan wen wang */
    }
    return ALIAS[f] || f;
  }

  /**
   * 一个音节的音韵特征
   * @param {string} py 无调拼音，如 'zhang' 'wei' 'nv'
   * @returns {{initial:string, final:string, real:string,
   *            pos:string, kd:string, dull:boolean}}
   *   initial/final 书写形式；real 音位形式的韵母
   *   pos  发音部位；kd 四呼；dull 是否「偏闷」（非开口）
   */
  function phonology(py) {
    /* 不借用 normalize()：它会把 ü 转成 'ü'，而四呼表的键名用 'v' */
    var s = String(py || '').toLowerCase()
      .replace(/u:/g, 'v').replace(/ü/g, 'v').replace(/[1-5]/g, '');
    var sp = splitSyllable(s);
    var rf = realFinal(sp.initial, sp.final);
    if (rf === 'i' && ZHI_GROUP[sp.initial]) rf = '-i';
    var kd = KAIDU[rf] || '';
    return {
      initial: sp.initial, final: sp.final, real: rf,
      pos: POS[sp.initial] || '?',
      kd: kd, dull: kd !== '开'
    };
  }

  /**
   * 鼻音韵尾的类型。前鼻 -n 与后鼻 -ng 分开 ——
   * 同型连用（-ng + -ng）才含糊，异型（-ng + -n）反而有变化。
   */
  function nasalType(final) {
    if (/ng$/.test(final || '')) return 'ng';
    if (/n$/.test(final || '')) return 'n';
    return '';
  }

  NS.Pinyin = {
    INITIALS: INITIALS,
    splitSyllable: splitSyllable,
    normalize: normalize,
    toneMark: toneMark,
    stripTone: stripTone,
    checkHomophone: checkHomophone,
    POS: POS,
    KAIDU: KAIDU,
    realFinal: realFinal,
    phonology: phonology,
    nasalType: nasalType
  };
})(typeof window !== 'undefined' ? window : globalThis);
