/* =========================================================================
 * prefs.js —— 界面填写记录（表单草稿）
 *
 * 用户需求：「加一个填写缓存，不然每次打开都要重新填写信息」
 *
 * 存什么、不存什么
 * ---------------------------------------------------------------
 * 存**用户填的条件**：姓氏、生辰、性别、名字字数、风格、寓意关键词、
 * 避用字、必含字、偏好/避用部首、手工指定的喜用神、经度与真太阳时开关。
 *
 * **不存结果**。生成出来的名字列表每次打开都重新算 ——
 * 一来结果依赖当时的数据（联网同步过词库就不一样了），
 * 二来把上次的结果原样端出来，用户会以为那是「按现在条件算的」。
 * 条件记住就够了，这是他真正不想每次重填的东西。
 *
 * 为什么单独一个键
 * ---------------------------------------------------------------
 * 与联网词库（pinyinMap/dict/poems…）和候选池（namePool）分开存。
 * 早先踩过「清空联网词库把候选池一起删了」的坑，所以这里从一开始
 * 就把 prefs 列为**不属于联网词库**的独立键，Lexicon.reset() 不会碰它。
 *
 * 生辰八字会存在本地浏览器里 —— 这一点在界面上明说，
 * 并提供「清除填写记录」。表单里本来就已经有生辰，不存下来
 * 就等于每次都要重新输一遍，得不偿失。
 * ========================================================================= */
(function (global) {
  'use strict';

  var NS = (global.NS = global.NS || {});

  var KEY = 'prefs';
  var cache = null;
  var loadPromise = null;

  /* 只认识这些键 —— 防止历史上写进去的脏字段被一路带下去。
   * 加新字段时记得同时加到这里，否则存了也读不回来。 */
  var ALLOWED = {
    /* 主表单 */
    surname: 1, strokes: 1, birth: 1, longitude: 1, useTST: 1, city: 1,
    style: 1, top: 1, keywords: 1, taboo: 1, mustInclude: 1, useSC: 1,
    /* 「只知日期、不知时辰」开关 */
    birthNoHour: 1,
    /* 状态（不在 input 里，单独存） */
    gender: 1, givenLength: 1, xiManual: 1, radPicked: 1, radCustom: 1,
    radMode: 1,
    /* 结果列表的「简洁模式」开关（名字卡片默认折叠，一屏能多看好几个） */
    compact: 1,
    /* 候选池 / 评估页的生辰输入，按前缀区分 */
    evBirth: 1, evLongitude: 1, evUseTST: 1, evGender: 1,
    plBirth: 1, plLongitude: 1, plUseTST: 1, plGender: 1,
    /* 元信息 */
    savedAt: 1
  };

  function sanitize(obj) {
    var out = {};
    Object.keys(obj || {}).forEach(function (k) {
      if (ALLOWED[k] && obj[k] !== undefined) out[k] = obj[k];
    });
    return out;
  }

  /**
   * 读取全部填写记录
   * @returns {Promise<Object>} 空对象表示没有记录
   */
  function load() {
    if (cache) return Promise.resolve(cache);
    if (loadPromise) return loadPromise;
    loadPromise = NS.Store.get(KEY).then(function (v) {
      cache = (v && typeof v === 'object') ? sanitize(v) : {};
      return cache;
    }).catch(function () {
      cache = {};
      return cache;
    });
    return loadPromise;
  }

  /**
   * 合并保存（只覆盖传入的字段，其余保留）
   * @param {Object} patch
   */
  function save(patch) {
    var clean = sanitize(patch);
    return load().then(function () {
      Object.keys(clean).forEach(function (k) { cache[k] = clean[k]; });
      cache.savedAt = new Date().toISOString();
      return NS.Store.set(KEY, cache);
    }).then(function () { return cache; });
  }

  /** 整份覆盖（用于调用方已经拼好完整对象时） */
  function replace(obj) {
    cache = sanitize(obj);
    cache.savedAt = new Date().toISOString();
    return NS.Store.set(KEY, cache).then(function () { return cache; });
  }

  function clear() {
    cache = {};
    loadPromise = null;
    return NS.Store.del(KEY).then(function () { return true; });
  }

  /** 有没有存过东西（界面据此决定要不要显示「已恢复填写记录」） */
  function hasData() {
    return load().then(function () {
      return Object.keys(cache).filter(function (k) {
        return k !== 'savedAt';
      }).length > 0;
    });
  }

  /* ---------------- 防抖 ---------------- */

  var timer = null;

  /**
   * 防抖保存。表单每次 input 都触发，不防抖会把存储写爆
   * （IndexedDB 写入是异步事务，连续写会排队）。
   * @param {Function} collect 返回要保存的对象
   * @param {number} [wait=600]
   */
  function saveSoon(collect, wait) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      var patch;
      try { patch = collect(); } catch (e) { return; }
      save(patch);
    }, wait === undefined ? 600 : wait);
  }

  /** 立即 flush（离开页面时用，避免最后一次输入丢失） */
  function flush(collect) {
    if (timer) { clearTimeout(timer); timer = null; }
    if (collect) {
      try { return save(collect()); } catch (e) { /* 忽略 */ }
    }
    return Promise.resolve(cache);
  }

  function _resetCache() {
    cache = null;
    loadPromise = null;
    if (timer) { clearTimeout(timer); timer = null; }
  }

  NS.Prefs = {
    load: load,
    save: save,
    replace: replace,
    clear: clear,
    hasData: hasData,
    saveSoon: saveSoon,
    flush: flush,
    ALLOWED: ALLOWED,
    _resetCache: _resetCache
  };

})(typeof window !== 'undefined' ? window : globalThis);
