/* =========================================================================
 * infer.js —— 为新字推断五行与康熙笔画
 *
 * ⚠️ 重要前提：康熙笔画与姓名学五行没有可靠的公开数据源。
 *    (已在 GitHub 上核查过：不存在可用的「康熙笔画 + 五行」开放数据集)
 *    因此联网加进来的字只能**推断**，本模块的所有输出都带 confidence 标记，
 *    界面上会显示「推断」徽标，并允许用户手工校正。
 *
 * 五行推断依据「部首派」（姓名学主流做法之一）：氵→水、木→木、火→火、
 * 钅→金、土→土。但同一字在「字义派」「音韵派」下可能不同，故仅供参考。
 *
 * 康熙笔画估算 = 简体笔画 + 部首修正。
 *    仅对「简体偏旁与康熙部首笔画差异确定」的偏旁做修正（如 艹 3→6、氵 3→4）。
 *    对「整体简化的字」（如 庆→慶、学→學）无法修正，误差可能很大，
 *    所以只用于新增字，内置字库仍是人工核定的康熙笔画。
 * ========================================================================= */
(function (global) {
  'use strict';
  var NS = (global.NS = global.NS || {});

  /* ---------------- 部首 → 五行 ---------------- */
  /* 值：[五行, 置信度]  置信度 'high' = 各派基本一致；'mid' = 流派间有分歧 */
  var RADICAL_TABLE = (function () {
    var t = Object.create(null);
    function add(wx, conf, chars) {
      chars.split(' ').forEach(function (r) { t[r] = [wx, conf]; });
    }
    /* 木 */
    add('木', 'high', '木 艹 艸 竹 禾 米 麥 麻 韭 瓜 果 林 森 東 甲 乙 寅 卯 桑');
    add('木', 'mid', '青 其 舟');   /* 舟 有水木两说，此处归木 */
    /* 火 */
    add('火', 'high', '火 灬 日 曰 光 赤 丁 丙 午 巳 马 馬 鸟 鳥 心 忄 ');
    add('火', 'mid', '目 小 亦 弋 丶');
    /* 土 */
    add('土', 'high', '土 山 石 田 阜 阝 邑 圭 瓦 里 辰 戌 丑 未 己 戊 谷 穴 厂 广');
    add('土', 'mid', '王 玉 玊 黃 黄 匚 廾 月');
    /* 金 */
    add('金', 'high', '金 钅 釒 刀 刂 斤 戈 矛 匕 贝 貝 辛 白 西 酉 皿 申 兑');
    add('金', 'mid', '车 車 十 七 寸 士');
    /* 水 */
    add('水', 'high', '水 氵 氺 冫 川 巛 泉 雨 云 雲 鱼 魚 子 亥 壬 癸 北 冬');
    add('水', 'mid', '冖 亠 又');
    return t;
  })();

  /**
   * 按部首推断五行
   * @param {string} radical 部首字
   * @returns {{wuxing:string|null, confidence:string, basis:string}}
   */
  function inferWuxingByRadical(radical) {
    if (!radical) {
      return { wuxing: null, confidence: 'none', basis: '无部首信息' };
    }
    var hit = RADICAL_TABLE[radical];
    if (!hit) {
      return {
        wuxing: null, confidence: 'none',
        basis: '部首「' + radical + '」不在五行对照表内，需人工指定'
      };
    }
    return {
      wuxing: hit[0],
      confidence: hit[1],
      basis: '部首「' + radical + '」' +
        (hit[1] === 'high' ? '（各派基本一致）' : '（流派间有分歧，仅供参考）')
    };
  }

  /* ---------------- 康熙笔画估算 ---------------- */
  /* 简体偏旁 → 康熙对应部首的笔画差 */
  var RADICAL_DELTA = {
    '艹': 3,   /* 艸 6 */
    '氵': 1,   /* 水 4 */
    '忄': 1,   /* 心 4 */
    '扌': 1,   /* 手 4 */
    '犭': 1,   /* 犬 4 */
    '辶': 4,   /* 辵 7 */
    '讠': 5,   /* 言 7 */
    '钅': 3,   /* 金 8 */
    '纟': 3,   /* 糸 6 */
    '饣': 6,   /* 食 9 */
    '贝': 3,   /* 貝 7 */
    '车': 3,   /* 車 7 */
    '见': 3,   /* 見 7 */
    '门': 5,   /* 門 8 */
    '马': 7,   /* 馬 10 */
    '鸟': 6,   /* 鳥 11 */
    '鱼': 3,   /* 魚 11 */
    '页': 3,   /* 頁 9 */
    '风': 5,   /* 風 9 */
    '长': 4,   /* 長 8 */
    '龙': 11,  /* 龍 16 */
    '韦': 5,   /* 韋 9 */
    '齐': 8,   /* 齊 14 */
    '王': 1,   /* 玉 5，王作偏旁时按玉部计 */
    '阝': 6,   /* 阜 8（左）／邑 7（右），取左形 */
    '月': 2,   /* 肉 6，月作偏旁多为肉部 */
    '凫': 0
  };

  /**
   * 估算康熙笔画
   * @param {number} simplified 新华字典给的简体笔画
   * @param {string} char
   * @param {string} radical 部首
   * @returns {{strokes:number, confidence:string, basis:string, delta:number}}
   */
  function estimateKangxi(simplified, char, radical) {
    var n = parseInt(simplified, 10);
    if (!isFinite(n) || n <= 0) {
      return {
        strokes: 0, confidence: 'none', delta: 0,
        basis: '缺少简体笔画，无法估算'
      };
    }
    /* 部首是「简体偏旁」时，康熙写法用的是完整部首，笔画要相应增加。
     *
     * 两个容易写错的点：
     *  1. 不能用 char.charAt(0) === radical 来判断——单个汉字的 charAt(0)
     *     永远是它自己，不可能等于部首，那样写等于整个修正永不生效。
     *  2. char === radical 时不能加：单独写「月」「王」时康熙笔画就是 4 画，
     *     只有它们作偏旁（朗、珠）时才按 肉部 6 画、玉部 5 画计。 */
    var delta = 0, used = '';
    if (radical && char && char !== radical &&
      RADICAL_DELTA[radical] !== undefined) {
      delta = RADICAL_DELTA[radical];
      used = radical;
    }

    var total = n + delta;
    /* 即便是「有偏旁可修正」的情况也要带提醒：
     * 像 铄(12画)→康熙 鑠(23画) 这种整体简化的字，加偏旁修正后仍有 8 画误差，
     * 不给提醒会让人误以为算准了。 */
    var caveat = '；若该字是整体简化（如 铄→鑠、庆→慶），此估算误差可能很大，务必人工核对';
    return {
      strokes: total,
      delta: delta,
      confidence: used ? 'mid' : 'low',
      basis: used
        ? '简体 ' + n + ' 画 + 偏旁「' + used + '」修正 ' + delta + ' 画 = ' +
        total + ' 画' + caveat
        : '简体 ' + n + ' 画（无已知偏旁差异，直接用简体笔画近似）' + caveat
    };
  }

  /**
   * 综合推断：给一个字生成「可加入字库」的条目
   * @param {string} char
   * @param {Object} dictEntry 新华字典条目 {strokes, pinyin, radicals, explanation}
   * @param {Object} pyEntry   拼音表条目 {pinyin, tone}
   * @returns {Object} 字库格式的候选条目（带 __inferred 标记）
   */
  function buildCharEntry(char, dictEntry, pyEntry) {
    dictEntry = dictEntry || {};
    pyEntry = pyEntry || {};

    var radical = dictEntry.radicals || '';
    var wx = inferWuxingByRadical(radical);
    var kj = estimateKangxi(dictEntry.strokes, char, radical);

    /* 拼音优先用拼音表（更权威且一定带声调），退回字典 */
    var pinyin = pyEntry.pinyin || '';
    var tone = pyEntry.tone || 0;
    if (!pinyin && dictEntry.pinyin) {
      var parsed = NS.Pinyin.stripTone(String(dictEntry.pinyin).split(/[,，]/)[0]);
      pinyin = parsed.plain;
      tone = parsed.tone;
    }

    /* 释义：取第一句，去掉字典里的注音符号噪音 */
    var meaning = cleanExplanation(dictEntry.explanation || '');

    return {
      char: char,
      pinyin: pinyin,
      tone: tone,
      wuxing: wx.wuxing || '',
      gender: '中性',
      styles: [],
      meaning: meaning || '（联网词库未提供释义）',
      /* —— 两种笔画，用途完全不同，必须分开存 ——
       *   strokes  康熙笔画 —— 三才五格、姓名卦用（本处是**推断值**）
       *   strokesSC 简体笔画 —— 字形均衡/可读性、书写难度用（**可靠值**）
       * 新华字典给的就是简体笔画，所以这里 strokesSC 是准的，
       * 而康熙笔画是拿它推算出来的，带 __inferred.strokesConfidence。 */
      strokes: kj.strokes,
      strokesSC: parseInt(dictEntry.strokes, 10) || 0,
      /* —— 以下是推断元信息，界面据此显示「推断」徽标 —— */
      __inferred: {
        source: 'net',
        radical: radical,
        wuxingBasis: wx.basis,
        wuxingConfidence: wx.confidence,
        strokesBasis: kj.basis,
        strokesConfidence: kj.confidence
      }
    };
  }

  /** 把字典释义清理成一句可读的短句 */
  function cleanExplanation(text) {
    if (!text) return '';
    var s = String(text)
      .replace(/\[[^\]]*\]/g, '')          /* 去掉 [ ] 注 */
      .replace(/〈[^〉]*〉/g, '')           /* 去掉 〈 〉 词性 */
      .replace(/\s+/g, ' ')
      .trim();
    /* 取到第一个句号/分号为止 */
    var m = s.match(/^([^。；;]{4,60})/);
    s = m ? m[1] : s.slice(0, 40);
    return s.replace(/^[\s,，、:：]+/, '').trim();
  }

  NS.Infer = {
    RADICAL_TABLE: RADICAL_TABLE,
    RADICAL_DELTA: RADICAL_DELTA,
    inferWuxingByRadical: inferWuxingByRadical,
    estimateKangxi: estimateKangxi,
    buildCharEntry: buildCharEntry,
    cleanExplanation: cleanExplanation
  };
})(typeof window !== 'undefined' ? window : globalThis);
