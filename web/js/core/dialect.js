/* =========================================================================
 * dialect.js —— 四川话（西南官话）谐音检测
 *
 * 原理：
 *   1. 「蜀拼」字表给出每个汉字的四川话读音（声母+韵母+声调）
 *   2. 把名字逐字转成四川话读音序列
 *   3. 与「四川话负面词库」的读音序列比对（词库用汉字写，运行时转读音）
 *   4. 也顺带匹配真实四川方言词汇，命中就告诉用户「听着像某个词」
 *
 * 为什么不能只查普通话：四川话有系统性的读音归并，
 *   前后鼻音不分（金=京、心=星、陈=程）、n/l 部分相混，
 *   于是「普通话没问题的名字」在四川话里可能撞词。
 *
 * ⚠️ 只做提示、不淘汰。原因：
 *   - shupin 数据来自第三方项目且未声明授权，个别读音与成都话实际有出入
 *   - 方言内部差异大（成渝片 / 岷江片读音不同），无法一概而论
 * ========================================================================= */
(function (global) {
  'use strict';
  var NS = (global.NS = global.NS || {});

  var WARN_SEVERITY = 0.6;    /* 声调相符比例达到这个值才提示 */

  var Dialect = {
    shupinMap: null,      /* { 字: {syllable, tone, raw} } */
    dialectWords: null,   /* [{word, syllables, tones, meaning}] */
    badIndex: null,       /* 蜀拼音节序列 → 负面词 */
    skippedWords: 0,      /* 因缺读音而跳过的词数 */

    /* ---------------- 解析 ---------------- */

    /**
     * 解析 shupin 蜀拼字表
     * 格式： '啊\ta1'  /  '吖\ta1\t2\t#\t2'（多列用制表符分隔）
     */
    parseShupin: function (text) {
      var map = Object.create(null);
      var count = 0;
      String(text).split('\n').forEach(function (line) {
        if (!line || line.charAt(0) === '#') return;
        var cols = line.split('\t');
        if (cols.length < 2) return;
        var ch = cols[0].trim();
        var py = (cols[1] || '').trim();
        if (ch.length !== 1 || !py) return;
        if (map[ch]) return;
        var m = py.match(/^([a-zü]+)([1-5]?)$/i);
        if (!m) return;
        map[ch] = {
          syllable: m[1].toLowerCase().replace(/v/g, 'ü'),
          tone: m[2] ? parseInt(m[2], 10) : 0,
          raw: py
        };
        count++;
      });
      return { map: map, count: count };
    },

    /**
     * 解析四川方言词汇表
     * 格式： '扯霍闪\tce3ho2san3\t打闪。'  （词 / 读音 / 释义）
     */
    parseFangyan: function (text) {
      var words = [];
      String(text).split('\n').forEach(function (line) {
        var cols = String(line).replace(/\r/g, '').split('\t');
        if (cols.length < 2) return;
        var word = (cols[0] || '').trim();
        var py = (cols[1] || '').trim();
        var meaning = (cols[2] || '').trim();
        if (!word || !py) return;
        /* 有些条目含变读，如 mian2mian2yu3→mian2mian1yu3，取箭头前 */
        py = py.split('→')[0];
        var syllables = [], tones = [];
        var re = /([a-zü]+)([1-5]?)/gi, mm;
        while ((mm = re.exec(py)) !== null) {
          syllables.push(mm[1].toLowerCase().replace(/v/g, 'ü'));
          tones.push(mm[2] ? parseInt(mm[2], 10) : 0);
        }
        if (!syllables.length) return;
        words.push({
          word: word, syllables: syllables, tones: tones, meaning: meaning
        });
      });
      return { words: words, count: words.length };
    },

    /* ---------------- 应用 ---------------- */

    applyShupin: function (map) {
      if (!Dialect.shupinMap) Dialect.shupinMap = Object.create(null);
      var n = 0;
      Object.keys(map).forEach(function (ch) {
        if (!Dialect.shupinMap[ch]) n++;
        Dialect.shupinMap[ch] = map[ch];
      });
      Dialect.badIndex = null;      /* 字表变了，索引要重建 */
      return n;
    },

    applyFangyan: function (words) {
      if (!Dialect.dialectWords) Dialect.dialectWords = [];
      var existing = Object.create(null);
      Dialect.dialectWords.forEach(function (w) { existing[w.word] = 1; });
      var n = 0;
      words.forEach(function (w) {
        if (existing[w.word]) return;
        existing[w.word] = 1;
        Dialect.dialectWords.push(w);
        n++;
      });
      return n;
    },

    /** 是否具备检测条件 */
    available: function () {
      return !!(Dialect.shupinMap && Object.keys(Dialect.shupinMap).length);
    },

    /* ---------------- 读音转换 ---------------- */

    /** 汉字串 → 蜀拼音节数组；任一字缺读音则返回 null */
    syllablesOf: function (text) {
      if (!Dialect.available() || !text) return null;
      var out = [];
      for (var i = 0; i < text.length; i++) {
        var ch = text.charAt(i);
        var s = Dialect.shupinMap[ch];
        if (!s) return null;
        out.push({ char: ch, syllable: s.syllable, tone: s.tone, raw: s.raw });
      }
      return out;
    },

    /* ---------------- 负面词索引 ---------------- */

    buildBadIndex: function () {
      if (Dialect.badIndex) return Dialect.badIndex;
      var idx = Object.create(null);
      var skipped = 0;

      function add(list, level) {
        (list || []).forEach(function (word) {
          var syl = Dialect.syllablesOf(word);
          if (!syl) { skipped++; return; }
          var key = syl.map(function (s) { return s.syllable; }).join('-');
          var tones = syl.map(function (s) { return s.tone; });
          if (!idx[key]) idx[key] = [];
          idx[key].push({ word: word, tones: tones, level: level });
        });
      }
      add(NS.SICHUAN_VULGAR, 'vulgar');
      add(NS.SICHUAN_BAD, 'bad');

      Dialect.badIndex = idx;
      Dialect.skippedWords = skipped;
      return idx;
    },

    /* ---------------- 检测 ---------------- */

    /**
     * 检测名字在四川话里的谐音
     * @param {string} text 名字（可含姓氏）
     * @returns {{available:boolean, syllables:Array, hits:Array, notes:Array}}
     */
    check: function (text) {
      if (!Dialect.available()) {
        return { available: false, syllables: null, hits: [], notes: [] };
      }
      var syl = Dialect.syllablesOf(text);
      if (!syl) {
        return {
          available: true, syllables: null, hits: [], notes: [],
          incomplete: true,
          reason: '有字缺四川话读音（字表未收录），无法完整检测'
        };
      }

      var hits = [];
      var notes = [];
      var idx = Dialect.buildBadIndex();
      var pys = syl.map(function (s) { return s.syllable; });
      var tones = syl.map(function (s) { return s.tone; });
      var seen = Object.create(null);

      /* 1) 负面词比对（长度 2-4 的连续片段） */
      for (var start = 0; start < pys.length; start++) {
        for (var len = 2; len <= 4 && start + len <= pys.length; len++) {
          var key = pys.slice(start, start + len).join('-');
          if (seen[key]) continue;
          seen[key] = 1;
          var cands = idx[key];
          if (!cands) continue;

          var best = null;
          for (var i = 0; i < cands.length; i++) {
            var sv = toneSeverity(cands[i].tones, tones, start);
            if (!best || sv > best.severity) best = { severity: sv, cand: cands[i] };
          }
          if (best && best.severity >= WARN_SEVERITY) {
            hits.push({
              word: best.cand.word,
              level: best.cand.level,
              syllables: pys.slice(start, start + len).join(' '),
              severity: best.severity,
              desc: '四川话连读近似「' + best.cand.word + '」'
            });
          }
        }
      }

      /* 2) 真实四川方言词汇比对（仅告知，非负面） */
      if (Dialect.dialectWords && Dialect.dialectWords.length) {
        var dseen = Object.create(null);
        for (var s2 = 0; s2 < pys.length; s2++) {
          for (var l2 = 2; l2 <= 4 && s2 + l2 <= pys.length; l2++) {
            var k2 = pys.slice(s2, s2 + l2).join('-');
            if (dseen[k2]) continue;
            dseen[k2] = 1;
            for (var w = 0; w < Dialect.dialectWords.length; w++) {
              var dw = Dialect.dialectWords[w];
              if (dw.syllables.join('-') !== k2) continue;
              if (toneSeverity(dw.tones, tones, s2) < WARN_SEVERITY) continue;
              notes.push({
                word: dw.word,
                meaning: dw.meaning,
                desc: '四川话里「' + dw.word + '」' +
                  (dw.meaning ? '（' + trimMeaning(dw.meaning) + '）' : '')
              });
              break;
            }
          }
        }
      }

      return {
        available: true,
        syllables: syl,
        pinyin: syl.map(function (s) { return s.raw; }).join(' '),
        hits: hits,
        notes: notes.slice(0, 3),
        skippedWords: Dialect.skippedWords
      };
    },

    /** 清空（「清空联网数据」时调用） */
    reset: function () {
      Dialect.shupinMap = null;
      Dialect.dialectWords = null;
      Dialect.badIndex = null;
      Dialect.skippedWords = 0;
    },

    status: function () {
      return {
        available: Dialect.available(),
        shupinCount: Dialect.shupinMap ? Object.keys(Dialect.shupinMap).length : 0,
        dialectWords: Dialect.dialectWords ? Dialect.dialectWords.length : 0,
        skippedWords: Dialect.skippedWords
      };
    }
  };

  /** 声调相符比例；声调 0（未知）与 5（入声标记）按通配处理 */
  function toneSeverity(badTones, nameTones, start) {
    var n = badTones.length;
    if (!n) return 0;
    var hit = 0;
    for (var i = 0; i < n; i++) {
      var nt = nameTones[start + i] || 0;
      var bt = badTones[i] || 0;
      if (nt === 0 || bt === 0 || bt === 5 || nt === 5 || nt === bt) hit++;
    }
    return hit / n;
  }

  function trimMeaning(m) {
    m = String(m).replace(/\s+/g, ' ').trim();
    return m.length > 24 ? m.slice(0, 24) + '…' : m;
  }

  NS.Dialect = Dialect;
})(typeof window !== 'undefined' ? window : globalThis);
