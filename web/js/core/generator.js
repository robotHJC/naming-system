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

  function buildPool(ctx, length) {
    var limit = POOL_LIMIT[length] || 40;
    var rows = [];
    var surnameChars = ctx.surname.split('');

    NS.CHAR_LIST.forEach(function (c) {
      if (ctx.taboo[c.char]) return;
      if (surnameChars.indexOf(c.char) >= 0) return;
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
    plan: plan,
    buildPool: buildPool,
    runSync: runSync,
    runAsync: runAsync,
    diversify: diversify,
    bandOf: bandOf,
    ComboIterator: ComboIterator,
    permCount: permCount
  };
})(typeof window !== 'undefined' ? window : globalThis);
