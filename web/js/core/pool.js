/* =========================================================================
 * pool.js —— 候选池（孕期备选，出生后按真实八字重筛）
 *
 * 用户需求：「由于这个人名大多都是为了新生儿准备的，那么很多都是进行预估；
 * 需要增加一个功能，可以先放着备用，然后等真正出生了，
 * 就按照当时的生辰八字男女进行筛选使用。」
 *
 * 这个功能的实际意义在于：**取名这件事通常发生在出生之前。**
 * 预产期前后差几天，四柱就全变了，所以「现在算出来的喜用神」很可能
 * 不是孩子真正的喜用神。硬按预估八字排出来的名字，出生后可能完全不对路。
 *
 * 所以工作流应该是：
 *   孕期：按姓氏 + 风格偏好挑一批中意的，**存进候选池**（不锁死八字）
 *   出生：填真实生辰（精确到分钟）+ 性别 → 一键用真实八字重新评分排序
 *
 * 池子里存的是**名字本身**（和加入时的快照），不是分数 ——
 * 分数必须用真实八字重算。这一点是刻意设计的：
 * 把预估八字下的分数存起来当结论，正是这个功能要避免的错误。
 * ========================================================================= */
(function (global) {
  'use strict';

  var NS = (global.NS = global.NS || {});

  var KEY = 'namePool';
  var MAX_ITEMS = 200;   /* 保护存储，一个人不会真需要 200 个备选 */

  var cache = null;

  function ensure() {
    if (cache) return Promise.resolve(cache);
    return NS.Store.get(KEY).then(function (v) {
      cache = Array.isArray(v) ? v : [];
      return cache;
    });
  }

  function persist() {
    return NS.Store.set(KEY, cache).then(function () { return cache; });
  }

  /**
   * 加入候选池
   * @param {Object} item { surname, given, gender, baziStr, note }
   * @returns {Promise<{added:boolean, reason?:string, size:number}>}
   */
  function add(item) {
    if (!item || !item.given) {
      return Promise.resolve({ added: false, reason: '名字为空', size: 0 });
    }
    return ensure().then(function () {
      var full = (item.surname || '') + item.given;
      var dup = cache.some(function (x) { return x.full === full; });
      if (dup) {
        return { added: false, reason: '已经在候选池里了', size: cache.length };
      }
      if (cache.length >= MAX_ITEMS) {
        return { added: false, reason: '候选池已满（' + MAX_ITEMS + ' 个）',
          size: cache.length };
      }
      cache.push({
        full: full,
        surname: item.surname || '',
        given: item.given,
        gender: item.gender || '',
        /* 加入时用的八字（可能是预估的），仅作记录，
         * **不用它算分** —— 重筛时一律用传入的真实八字 */
        baziStrAtAdd: item.baziStr || '',
        addedAt: new Date().toISOString(),
        note: item.note || ''
      });
      return persist().then(function () {
        return { added: true, size: cache.length };
      });
    });
  }

  function remove(full) {
    return ensure().then(function () {
      var before = cache.length;
      cache = cache.filter(function (x) { return x.full !== full; });
      if (cache.length === before) return { removed: false, size: cache.length };
      return persist().then(function () {
        return { removed: true, size: cache.length };
      });
    });
  }

  function clear() {
    cache = [];
    return persist().then(function () { return true; });
  }

  function list() {
    return ensure().then(function () { return cache.slice(); });
  }

  function has(full) {
    return ensure().then(function () {
      return cache.some(function (x) { return x.full === full; });
    });
  }

  function size() {
    return ensure().then(function () { return cache.length; });
  }

  /**
   * 用**真实**八字重新评分并排序。
   *
   * 这是候选池的核心动作：出生后填上真实生辰，一键看哪个备选最合适。
   * 每个条目会带上与「加入时的预估」相比的变化说明，
   * 但变化本身不做数值对比（预估分数没有存，也不该存）。
   *
   * @param {Object} bazi NS.Bazi.analyzeBazi() 的结果
   * @param {string} gender 性别（可选，用于重新过滤性别风格）
   * @returns {Promise<Array>} 按新分数降序
   */
  function rescore(bazi, gender) {
    return ensure().then(function () {
      var out = cache.map(function (x) {
        var rep = NS.Report.evaluate(x.surname, x.given, {
          bazi: bazi, gender: gender || x.gender
        });
        return {
          entry: x,
          report: rep,
          score: rep ? rep.total : -1,
          /* 加入时的八字和现在不同 → 说明是出生后重筛过，
           * 界面要把这一点标出来，避免用户误以为分数一直是这个 */
          baziChanged: !!(x.baziStrAtAdd && bazi &&
            x.baziStrAtAdd !== bazi.baziStr),
          baziWasEstimated: !x.baziStrAtAdd
        };
      });
      out.sort(function (a, b) { return b.score - a.score; });
      return out;
    });
  }

  /** 导出（打包固化 / 换手机时带走） */
  function exportAll() {
    return ensure().then(function () {
      return {
        kind: 'name-pool', version: 1,
        exportedAt: new Date().toISOString(),
        items: cache.slice()
      };
    });
  }

  /** 导入（与已有条目合并，按 full 去重） */
  function importAll(data) {
    if (!data || data.kind !== 'name-pool' || !Array.isArray(data.items)) {
      return Promise.reject(new Error('不是候选池数据文件'));
    }
    return ensure().then(function () {
      var have = Object.create(null);
      cache.forEach(function (x) { have[x.full] = 1; });
      var added = 0;
      data.items.forEach(function (x) {
        if (!x || !x.full || have[x.full]) return;
        if (cache.length >= MAX_ITEMS) return;
        have[x.full] = 1;
        cache.push(x);
        added++;
      });
      return persist().then(function () {
        return { added: added, size: cache.length };
      });
    });
  }

  /** 仅供测试与重置用 */
  function _resetCache() { cache = null; }

  NS.Pool = {
    add: add,
    remove: remove,
    clear: clear,
    list: list,
    has: has,
    size: size,
    rescore: rescore,
    exportAll: exportAll,
    importAll: importAll,
    MAX_ITEMS: MAX_ITEMS,
    _resetCache: _resetCache
  };

})(typeof window !== 'undefined' ? window : globalThis);
