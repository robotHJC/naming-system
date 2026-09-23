/* =========================================================================
 * generator.js —— 候选名字生成
 *
 * Python 版对全部用字做 itertools.product，双字名约 6.8 万组合，
 * 三字名则超过 1700 万，实际会卡死。
 * 这里改为两阶段：
 *   ① 先用「单字基础分」排序剪枝，只保留最有希望的一批字（默认双字 100，三字 42）；
 *   ② 再对保留字做全排列枚举，并用分块 + 定时器让界面保持可交互。
 * 之所以能这样剪枝：五行/性别/风格/关键词这几项都是「逐字相加后再封顶」，
 * 单字分高的字一定更容易组合出高分名字，剪枝方向与最终排序一致。
 * ========================================================================= */
(function (global) {
  'use strict';
  var NS = (global.NS = global.NS || {});

  /* 不同字数的候选池上限（控制枚举规模） */
  var POOL_LIMIT = { 1: 300, 2: 100, 3: 42, 4: 26 };

  /* ---------------- 组合枚举器 ---------------- */

  function ComboIterator(n, len) {
    this.n = n;
    this.len = len;
    this.idx = null;
    this.done = n < len || n === 0;
  }

  ComboIterator.prototype.valid = function () {
    for (var i = 1; i < this.len; i++) {
      for (var j = 0; j < i; j++) {
        if (this.idx[i] === this.idx[j]) return false;
      }
    }
    return true;
  };

  ComboIterator.prototype.next = function () {
    if (this.done) return null;
    if (this.idx === null) {
      this.idx = new Array(this.len);
      for (var z = 0; z < this.len; z++) this.idx[z] = 0;
      if (this.valid()) return this.idx.slice();
    }
    for (;;) {
      var k = this.len - 1;
      while (k >= 0) {
        this.idx[k]++;
        if (this.idx[k] < this.n) break;
        this.idx[k] = 0;
        k--;
      }
      if (k < 0) { this.done = true; return null; }
      if (this.valid()) return this.idx.slice();
    }
  };

  /** 排列总数 n! / (n-len)! */
  function permCount(n, len) {
    var r = 1;
    for (var i = 0; i < len; i++) r *= (n - i);
    return r > 0 ? r : 0;
  }

  /* ---------------- 多样性挑选 ---------------- */

  /*
   * 为什么需要这一步：
   * 「李」+ 双字名的默认参数下，按分数取前 10 名，结果全部以「书」开头——
   * 书云 书亦 书凌 书叶 书和 书园 书寒 书平 书忆 书文。
   * 原因是纯按分数排序时，一个字只要分高就会霸占所有位置，
   * 而且大量组合分数相同（并列），稳定排序会把同前缀的名字聚在一起。
   * 用户拿到的是「1 个字 + 10 种搭配」，不是一个候选集合。
   *
   * 做法：按分数从高到低扫描，限制「同一个字在同一个位置上出现的次数」。
   * 上限从 1 开始逐级放宽（1 → 2 → 3 → 5），第一轮就能给出首字全不重复的
   * 一批结果；位次用尽后再逐级放宽，保证名次靠前的一直是最优组合。
   *
   * 注意：输出的顺序不再严格按分数递减。这是有意的取舍——
   * 名字工具的价值在于给出多样、可挑的候选，而不是把某个字的十种搭配排成一列。
   */
  var CAP_STEPS = [1, 2, 3, 5];

  function bumpUsed(used, item) {
    for (var i = 0; i < item.chars.length; i++) {
      if (!used[i]) used[i] = Object.create(null);
      used[i][item.chars[i]] = (used[i][item.chars[i]] || 0) + 1;
    }
  }

  function fitsCap(used, item, cap) {
    for (var i = 0; i < item.chars.length; i++) {
      if (used[i] && used[i][item.chars[i]] >= cap) return false;
    }
    return true;
  }

  /**
   * 按「同位不重字」约束重排候选。
   * @param {Array} entries [{score, item}]，会被就地按分数排序
   * @param {number} quota 最多挑几个
   * @returns {Array} 新数组，顺序即推荐顺序
   */
  function diversify(entries, quota) {
    entries.sort(byScoreDesc);
    if (quota >= entries.length) quota = entries.length;

    var out = [];
    var taken = Object.create(null);
    var ci, i;

    for (ci = 0; ci < CAP_STEPS.length && out.length < quota; ci++) {
      var cap = CAP_STEPS[ci];
      var used = [];
      for (i = 0; i < out.length; i++) bumpUsed(used, out[i].item);
      for (i = 0; i < entries.length && out.length < quota; i++) {
        var it = entries[i].item;
        if (taken[it.given]) continue;
        if (!fitsCap(used, it, cap)) continue;
        taken[it.given] = 1;
        bumpUsed(used, it);
        out.push(entries[i]);
      }
    }

    /* 上限全放宽后仍不够（候选本身就不多），按分数顺序补满 */
    for (i = 0; i < entries.length && out.length < quota; i++) {
      var rest = entries[i].item;
      if (taken[rest.given]) continue;
      taken[rest.given] = 1;
      out.push(entries[i]);
    }
    return out;
  }

  function byScoreDesc(a, b) { return b.score - a.score; }

  /**
   * 把已收集的候选裁到 quota 条。
   * 开启多样性时不能简单取前 quota 名——那正是「前十名全以书开头」的成因，
   * 所以裁剪本身也要走多样化，否则被裁掉的恰恰是别的偏旁/别的字开头的组合。
   */
  function cull(entries, quota, diverse) {
    entries.sort(byScoreDesc);
    if (!diverse) {
      return entries.slice(0, quota);
    }
    return diversify(entries, quota);
  }

  /* 保留带宽：既要够翻若干批（每批 top 个），也不能无限占内存 */
  function bandOf(top) { return Math.max(top * 12, 240); }

  /* ---------------- 候选池 ---------------- */

  /**
   * 用字来源里有没有勾《新华字典》。
   *
   * 勾了才走「只在新华字典里取名」那条路 —— 那是从两万字的字典里挑字，
   * 跟「按部首补几个字」不是一回事：前者是**整本字典当候选池**，
   * 后者只是给一个部首多凑几个候选。必须分清，否则用户勾了字典
   * 却只多出 120 个艹部字，跟他要的「简单在新华字典里面组合」不符。
   */
  function dictSourceSelected(sourceIds) {
    if (!sourceIds || !sourceIds.length) return false;
    for (var i = 0; i < sourceIds.length; i++) {
      var s = NS.SOURCE_BY_ID ? NS.SOURCE_BY_ID[sourceIds[i]] : null;
      if (s && (s.dictPool || s.format === 'xhbase')) return true;
    }
    return false;
  }

  /**
   * 把「按词库筛选用字」的源 id 列表解析成一个字集。
   *
   * 语义：**用字必须出现在所选源里**（用户选的是这个）。
   * 多个源之间是「并集」—— 勾《诗经》和《三字经》就是两本书的字都能用；
   * 与「偏好部首」之间才是交集（两个约束都要满足）。
   *
   * 《新华字典》这一源特殊：它不是一个「出处」，而是整个汉字表。
   * 勾上它等于说「用字不必出自诗文，字典里有就行」——
   * 这时字集就是字典的全部两万字，真正的裁剪交给下游的
   * 热/常用字/诗词依据三重排序（见 expandByDict）。
   *
   * @param {string[]} sourceIds
   * @returns {Object|null} { 字: 1 }；null 表示不筛
   */
  function resolveCharPool(sourceIds) {
    if (!sourceIds || !sourceIds.length) return null;
    var bySrc = (NS.Poetry && NS.Poetry.charsBySource)
      ? NS.Poetry.charsBySource() : null;
    var pool = Object.create(null);
    var hitAny = false;
    sourceIds.forEach(function (id) {
      var src = NS.SOURCE_BY_ID ? NS.SOURCE_BY_ID[id] : null;
      /* 新华字典：整本字典都是它的「用字」 */
      if (src && (src.dictPool || src.format === 'xhbase')) {
        var lex = NS.Lexicon;
        if (lex && lex.dict) {
          var n = 0;
          Object.keys(lex.dict).forEach(function (ch) { pool[ch] = 1; n++; });
          if (n) hitAny = true;
        }
        return;
      }
      if (!bySrc) return;
      /* 诗篇里存的是**显示名**（「诗经」），不是 id */
      var name = src ? src.name : id;
      var set = bySrc[name];
      if (!set) return;
      hitAny = true;
      Object.keys(set).forEach(function (ch) { pool[ch] = 1; });
    });
    /* 一个源都没同步过时不能返回空集 —— 那会让结果为空，
     * 而用户看到的是「没有符合条件的名」，会以为是名字太少。 */
    return hitAny ? pool : null;
  }

  /**
   * 从《新华字典》补字进候选池时，最多补多少个。
   *
   * 为什么两种模式数字差这么多：
   *   · 部首模式（120）：偏旁字动辄几百个（实测字典里艹部 932 字，
   *     而内置手写表只有 48 个），全塞进候选池会让组合数爆炸 ——
   *     每个组合都要走一次 evaluate。120 个字够选，而且 fromDict 已按
   *     「有依据 + 笔画少」排过序，留下的正是简单好用那批。
   *   · 来源模式（400）：用户明确说了「只在新华字典里面取名」，
   *     200 的池子太小会让名字翻来覆去就那几个。400 个字 × 每个都要
   *     charRow 一遍，实测开销可接受，而组合裁剪由 POOL_LIMIT 兜底，
   *     真正参与组合的还是前 100 个字。
   */
  var DICT_RADICAL_LIMIT = 120;
  var DICT_SOURCE_LIMIT = 400;

  /* 已经补过的「部首 + 模式」组合。
   *
   * 必须记住，否则每次 plan() 都会再补一批新字 ——
   * fromDict 会把「已在字库」的字排除掉，所以第二次调用捞到的
   * 是**另一批**艹字，字库就这样无限膨胀下去。
   * 只在字典确实可用时才标记，否则字典后同步上就再也补不上了。 */
  var _expandedRadicals = Object.create(null);

  /**
   * 这个字有没有「文学使用证据」—— 在已同步的诗词里至少出现过一次。
   *
   * 这是判断字典字能不能当名字用的**唯一可用依据**：
   * 热度表只覆盖内置 490 字；对表外的字，诗歌语料
   * （诗经/楚辞/唐诗/宋词…）是唯一能区分「苯」与「兰」的信号。
   */
  function hasLiteraryUse(ch) {
    var P = NS.Poetry;
    if (!P || !P.index) return false;
    var ids = P.index[ch];
    return !!(ids && ids.length);
  }

  /**
   * 从《新华字典》补字进候选池。两种触发方式，共用一套挑选逻辑
   * （Radical.dictCandidates）：
   *
   *   1. **来源模式**：用户把「新华字典」勾成了用字来源（ctx.dictPool）
   *      → 从整本字典里挑，这才是真正的「只在新华字典里取名」。
   *      没有别的来源约束，按热度排（按笔画排会挑出一堆「一丁七丈上不」）。
   *   2. **部首模式**：用户只选了偏好部首 → 按部首挑，按笔画排。
   *      为什么必须补：radicals.js 的 RADICAL_GROUPS 是**手写表，只覆盖
   *      内置 278 字**，于是「草字头」只有 48 个可选字 ——
   *      全是 芊芷菡茉茵菁萱蕙蕴薇蕾 这类古风字。用户的需求是
   *      「带某些偏旁部首、但不要太古文」，只靠内置表永远做不到，
   *      而字典里艹部有 932 字，才是真正的候选池。
   *
   * 两种同时成立时是**交集**：整本字典 ∩ 部首。
   *
   * 质量门（两道，缺一不可）：
   *   · suitable —— 简体笔画 4–16、有读音、有释义；
   *   · notable  —— 一级常用字 或 在已同步的诗词里出现过。
   * 字典是两万字的全量汉字表，含「苯」「苊」「芤」这类化学/医药专用字。
   * 实测不放这道门，立刻会输出「李苛苯」「李苞苊」这种名字。
   * notable 必须两选一而不是只看常用字表：实测 芷/菡/萏/茹/芸/芮/芊/萱
   * 都不在 3500 一级字表里（它们在二级字表），却是公认的好名字用字；
   * 反过来 茬/芭/苞 在表里却不是好名字用字。两个信号互补。
   * 代价：只同步字典、没同步诗词时能补的字会少很多 —— 这是诚实的，
   * 那种情况下确实缺少依据。
   *
   * 字典字**只在内存里**进字库（不落盘）：想留下来就去
   * 「词库管理 → 按部首找字」手工确认加入。这样既能生成名字，
   * 又不会把未核对的字（康熙笔画是推算的）静默写进持久字库。
   *
   * 本轮**实际想要**的字集记在 ctx.dictCharSet 上。buildPool 用它
   * 反过来把上一轮补的、这一轮不再需要的临时字排除掉 ——
   * 用户把「草字头」改成「三点水」时，旧那批艹字必须立刻退出，
   * 否则名字会从用户已经取消的部首里冒出来。
   *
   * @returns {number} 本次新补进字库的字数
   */
  function expandByDict(ctx) {
    var R = NS.Radical;
    var lex = NS.Lexicon;
    ctx.dictCharSet = Object.create(null);
    if (!R || !R.dictCandidates || !lex || !lex.dict) return 0;

    var rads = ctx.preferRadicals || [];
    var asPool = !!ctx.dictPool;
    if (!asPool && !rads.length) return 0;   /* 没触发条件：保持内置字库 */

    var key = (asPool ? 'P' : '') + '|' + rads.slice().sort().join(',');
    var budget = asPool ? DICT_SOURCE_LIMIT : DICT_RADICAL_LIMIT;
    var available = false;
    var items = [];
    var seen = Object.create(null);

    if (rads.length) {
      /* 每个部首单独取够配额再合并 —— 一次取前 N 条会被第一个部首占满 */
      var per = asPool
        ? Math.ceil(budget / rads.length) : DICT_RADICAL_LIMIT;
      rads.forEach(function (name) {
        var res;
        try { res = R.fromDict(name, { limit: per }); }
        catch (e) { return; }
        /* available=false 表示字典还没同步 —— 这时保持内置表的行为，
         * 不报错也不静默失败（界面上另有「还没同步字典」的提示）。 */
        if (!res || !res.available) return;
        available = true;
        (res.items || []).forEach(function (it) {
          if (seen[it.char]) return;
          seen[it.char] = 1;
          items.push(it);
        });
      });
    } else {
      var c = R.dictCandidates({ order: 'heat' });
      available = c.available;
      items = c.items || [];
    }
    if (!available) return 0;

    /* 这一组（模式 + 部首）是否已经补过字。
     * 补过就只**重建本轮想要的字集**，不再往字库里添字 ——
     * 否则每次 plan() 都会再捞一批新字进来。 */
    var already = !!_expandedRadicals[key];
    var added = 0;
    var wantedN = 0;
    var skippedNoEvidence = 0;
    items.forEach(function (it) {
      if (wantedN >= budget) return;
      ctx.dictCharSet[it.char] = 1;
      wantedN++;
      if (NS.CHAR_DB[it.char]) return;   /* 已在库里（含上一轮补的） */
      if (!it.suitable) return;
      /* 质量门三关：
       *  1. suitable —— 笔画 4–16、有读音、有释义、**不在不宜入名表里**；
       *  2. notable  —— 一级常用字 或 诗词里出现过；
       *  3. 没给部首（整本字典当来源）时**必须**有诗词依据。
       *
       * 第 3 关是实测调出来的：一级字表里有 2755 个字「有依据但从来没在
       * 诗词里出现过」（凹 叭 办 币 电 订 叼 歹 邓 队…），
       * 放它们进来会把 400 个名额占掉一大半，池子立刻变脏。
       * 反过来，给了部首时不能再要求诗词依据 —— 部首本身已经把范围
       * 收得很窄（艹 部 932 字里只有 7 个是「仅在诗词里出现过」），
       * 再卡就没有字可用了。
       */
      if (!it.notable) { skippedNoEvidence++; return; }
      if (!rads.length && !it.literary) { skippedNoEvidence++; return; }
      if (already) return;
      var entry = NS.Lexicon.lookupChar(it.char);
      if (!entry || entry.missing) return;
      entry.gender = '中性';
      entry.styles = [];
      /* 界面据此提示「这个字来自新华字典，还没加入字库」。
       * 用户真去「加入字库」后这个标记会随新条目一起被覆盖掉，
       * 所以它同时也是「临时字」的标记。 */
      entry.__fromDict = true;
      entry.__dictPool = true;
      NS.CHAR_DB[it.char] = entry;
      NS.CHAR_LIST.push(entry);
      added++;
    });
    _expandedRadicals[key] = 1;

    ctx.dictRadicalInfo = {
      added: added,
      skippedNoEvidence: skippedNoEvidence,
      dictAvailable: available,
      mode: asPool ? 'source' : 'radical',
      wanted: wantedN
    };
    return added;
  }

  function buildPool(ctx, length) {
    var limit = POOL_LIMIT[length] || 40;

    /* 必须在下面对 CHAR_LIST 的遍历之前 —— 它会往 CHAR_LIST 里添字 */
    ctx.dictRadicalAdded = expandByDict(ctx);

    var rows = [];
    var surnameChars = ctx.surname.split('');

    NS.CHAR_LIST.forEach(function (c) {
      if (ctx.taboo[c.char]) return;
      /* 字典补进来的临时字：只有本轮还想要的才参与。
       * 用户把部首从「草字头」换成「三点水」时，上一轮那批艹字
       * 已经躺在 CHAR_LIST 里了，不拦的话名字会从用户
       * 已经取消的部首里冒出来。 */
      if (c.__dictPool && !ctx.dictCharSet[c.char]) return;
      if (surnameChars.indexOf(c.char) >= 0) return;
      /* 按词库筛选用字：勾了《诗经》就只从《诗经》出现过的字里选。
       * 放在性别判断之前 —— 它是**来源限制**，不是打分项。 */
      if (ctx.charPool && !ctx.charPool[c.char]) return;
      if (!(c.gender === ctx.gender || c.gender === '中性' ||
        ctx.gender === '中性')) return;
      var row = NS.Score.charRow(c, ctx);
      /* 关键词模式下，没命中关键词的字基础分低，会被自然挤掉 */
      rows.push(row);
    });

    rows.sort(function (a, b) {
      if (b.base !== a.base) return b.base - a.base;
      return a.char.localeCompare(b.char);
    });

    var picked = rows.slice(0, limit);

    /* 关键词命中的字与「必含字」必须进入候选池，
     * 否则用户填的关键词可能因为单字基础分不够而被剪掉。 */
    var inPool = Object.create(null);
    picked.forEach(function (r) { inPool[r.char] = 1; });

    function forceIn(r) {
      if (!inPool[r.char]) { inPool[r.char] = 1; picked.push(r); }
    }
    rows.forEach(function (r) { if (r.kwHits.length) forceIn(r); });
    rows.forEach(function (r) { if (ctx.mustInclude[r.char]) forceIn(r); });

    /* 偏好部首的字必须进池。
     * 候选池是按「单字基础分」剪枝的（双字名只留 100 字），
     * 而走之底、鸟字旁这类字基础分未必排得进前 100——
     * 不强制的话，用户选了「走之底」却一个候选都没有，约束直接被剪枝剪死。 */
    if (ctx.preferRadicals && ctx.preferRadicals.length && NS.Radical) {
      rows.forEach(function (r) {
        if (NS.Radical.matchAny(r.char, ctx.preferRadicals)) forceIn(r);
      });
    }

    return {
      rows: picked,
      poolSize: rows.length,
      pickedSize: picked.length,
      limit: limit
    };
  }

  /* ---------------- 计划 ---------------- */

  function plan(opts) {
    opts = opts || {};
    var ctx = NS.Score.buildContext(opts);
    /* 用字来源筛选在这里解析，不在 buildContext 里 ——
     * 要扫全部诗篇，而 buildContext 每次评分都会被叫到。 */
    ctx.charPool = resolveCharPool(ctx.charSources);
    /* 「只在新华字典里取名」：整本字典当候选池，见 expandByDict */
    ctx.dictPool = dictSourceSelected(ctx.charSources);
    var length = Math.max(1, Math.min(opts.length || 2, 4));
    var built = buildPool(ctx, length);

    var mustList = Object.keys(ctx.mustInclude);
    if (mustList.length > length) {
      mustList = [];
      ctx.mustInclude = Object.create(null);
    }

    return {
      ctx: ctx,
      length: length,
      pool: built.rows,
      poolInfo: built,
      top: Math.max(1, Math.min(opts.top || 10, 200)),
      /* 分页：offset 为起始位次，「换一批」时递增 */
      offset: Math.max(0, opts.offset || 0),
      /* diverse=false 可关闭多样性约束，用于对照与测试 */
      diverse: opts.diverse !== false,
      total: permCount(built.rows.length, length)
    };
  }

  /* ---------------- 结果组装 ---------------- */

  function toResult(combo, ev, ctx) {
    var chars = combo.map(function (c) { return c.char; });
    var syllables = ctx.surnameSyllables.concat(combo.map(function (c) {
      return { char: c.char, pinyin: c.pinyin, tone: c.tone };
    }));
    return {
      name: ctx.surname + chars.join(''),
      given: chars.join(''),
      chars: chars,
      wuxing: combo.map(function (c) { return c.wuxing; }),
      strokes: combo.map(function (c) { return c.strokes; }),
      pinyin: syllables.map(function (s) {
        return NS.Pinyin.toneMark(s.pinyin, s.tone);
      }).join(' '),
      pinyinPlain: syllables.map(function (s) { return s.pinyin; }).join(' '),
      score: ev.score,
      reasons: ev.reasons,
      meaning: combo.map(function (c) { return c.meaning; }).join('；'),
      genders: combo.map(function (c) { return c.gender; }),
      styles: combo.map(function (c) { return c.styles; }),
      wuge: ev.detail.wuge,
      poetry: ev.detail.poetry,
      pairKind: ev.detail.pairKind,
      homophone: ev.detail.homophone,
      heat: ev.detail.heat
    };
  }

  /* ---------------- 同步运行（小规模用） ---------------- */

  function runSync(p, opt) {
    var it = new ComboIterator(p.pool.length, p.length);
    var band = bandOf(p.top);
    var best = [];
    var combo, rows, ev;

    while ((combo = it.next()) !== null) {
      rows = combo.map(function (i) { return p.pool[i]; });
      if (!passMust(rows, p)) continue;
      if (!passRadical(rows, p)) continue;
      ev = NS.Score.evaluate(rows.map(function (r) { return r.obj; }), p.ctx);
      if (!ev.detail.homophone.pass) continue;
      best.push({ score: ev.score, item: toResult(rows.map(function (r) { return r.obj; }), ev, p.ctx) });
      if (best.length > band * 3) best = cull(best, band, p.diverse);
    }

    var ranking = cull(best, band, p.diverse).map(function (x) { return x.item; });
    /* opt.full 用于取完整排序（测试与分页需要），默认只返回当前窗口 */
    if (opt && opt.full) return ranking;
    var off = p.offset || 0;
    return ranking.slice(off, off + p.top);
  }

  /** 部首偏好：至少一个字带所选部首，或每个字都要带 */
  function passRadical(rows, p) {
    var want = p.ctx.preferRadicals;
    if (!want || !want.length) return true;
    if (!NS.Radical) return true;
    var hit = 0;
    for (var i = 0; i < rows.length; i++) {
      if (NS.Radical.matchAny(rows[i].char, want)) hit++;
    }
    return p.ctx.radicalMode === 'all' ? hit === rows.length : hit >= 1;
  }

  /** rows 为候选行数组（含 .char） */
  function passMust(rows, p) {
    var keys = Object.keys(p.ctx.mustInclude);
    if (!keys.length) return true;
    for (var i = 0; i < keys.length; i++) {
      var found = false;
      for (var j = 0; j < rows.length; j++) {
        if (rows[j].char === keys[i]) { found = true; break; }
      }
      if (!found) return false;
    }
    return true;
  }

  /* ---------------- 分块异步运行（默认用这个） ---------------- */

  /**
   * @param {Object} p plan()
   * @param {Object} cb { onProgress(done,total,elapsedMs), onDone(results,stats) }
   * @returns {function} cancel
   */
  function runAsync(p, cb) {
    cb = cb || {};
    var it = new ComboIterator(p.pool.length, p.length);
    var best = [];
    var band = bandOf(p.top);
    var done = 0;
    var total = p.total;
    var t0 = now();
    var cancelled = false;
    var BUDGET = 24;            /* 每帧最多占用 24ms，保证界面不卡 */

    function step() {
      if (cancelled) return;
      var frameStart = now();
      var combo;
      while ((combo = it.next()) !== null) {
        done++;
        var rows = combo.map(function (i) { return p.pool[i]; });
        if (!passMust(rows, p)) continue;
        if (!passRadical(rows, p)) continue;
        var chars = rows.map(function (r) { return r.obj; });
        var ev = NS.Score.evaluate(chars, p.ctx);
        if (!ev.detail.homophone.pass) continue;
        best.push({ score: ev.score, item: toResult(chars, ev, p.ctx) });
        if (best.length > band * 3) best = cull(best, band, p.diverse);
        if (now() - frameStart > BUDGET) break;
      }

      if (cb.onProgress) cb.onProgress(done, total, now() - t0);

      if (it.done) {
        var ranking = cull(best, band, p.diverse).map(function (x) { return x.item; });
        if (cb.onDone) {
          cb.onDone(ranking.slice(0, p.top), {
            scanned: done,
            total: total,
            elapsed: now() - t0,
            poolSize: p.poolInfo.pickedSize,
            poolTotal: p.poolInfo.poolSize,
            kept: best.length,
            /* 完整排序交给界面做分页，「换一批」不必重新枚举 */
            ranking: ranking
          });
        }
        return;
      }
      setTimeout(step, 0);
    }

    setTimeout(step, 0);
    return function () { cancelled = true; };
  }

  function now() {
    return (global.performance && global.performance.now)
      ? global.performance.now() : Date.now();
  }

  NS.Generator = {
    POOL_LIMIT: POOL_LIMIT,
    CAP_STEPS: CAP_STEPS,
    DICT_RADICAL_LIMIT: DICT_RADICAL_LIMIT,
    DICT_SOURCE_LIMIT: DICT_SOURCE_LIMIT,
    plan: plan,
    buildPool: buildPool,
    /* 导出给界面用：显示「按当前词库筛选，可用 X 字」，
     * 以及给测试直接验证筛选语义。 */
    resolveCharPool: resolveCharPool,
    dictSourceSelected: dictSourceSelected,
    expandByDict: expandByDict,
    hasLiteraryUse: hasLiteraryUse,
    /** 清掉「已扩过的部首」记录 —— 测试与「重新同步字典后想再扩」时需要 */
    resetDictRadicals: function () {
      _expandedRadicals = Object.create(null);
    },
    runSync: runSync,
    runAsync: runAsync,
    diversify: diversify,
    bandOf: bandOf,
    ComboIterator: ComboIterator,
    permCount: permCount
  };
})(typeof window !== 'undefined' ? window : globalThis);
