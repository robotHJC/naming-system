/* =========================================================================
 * store.js —— 联网数据的本地持久化
 *
 * 三级降级策略，适配不同浏览器/打开方式（尤其 file:// 直开）：
 *   1. IndexedDB  —— 首选，能存下 26MB 级字典
 *   2. localStorage —— IndexedDB 不可用时退而求其次（约 5MB 上限，字典可能存不下）
 *   3. 内存 —— 最后兜底，当次会话有效，刷新即丢
 *
 * 另外支持「预置数据」（NS.BAKED_DATA）：
 * 打包脚本可以把已同步的数据直接内联进 HTML，首次打开时自动灌入，
 * 这样拷到别的电脑就是「已扩充词库」的状态，无需重新下载。
 * ========================================================================= */
(function (global) {
  'use strict';
  var NS = (global.NS = global.NS || {});

  var DB_NAME = 'naming-system';
  var DB_VERSION = 1;
  var STORE = 'kv';
  var LS_PREFIX = 'ns:';

  var backend = 'none';       /* 'idb' | 'ls' | 'memory' */
  var db = null;
  var mem = Object.create(null);
  var readyResolve;
  var ready = new Promise(function (r) { readyResolve = r; });

  /* ---------------- 初始化 ---------------- */

  function init() {
    return openIDB().then(function (d) {
      db = d; backend = 'idb';
    }).catch(function (e) {
      console.warn('[store] IndexedDB 不可用，改用 localStorage：', e && e.message);
      if (lsAvailable()) {
        backend = 'ls';
        return;
      }
      backend = 'memory';
      console.warn('[store] localStorage 也不可用，数据只保存在内存中');
    }).then(function () {
      /* 无论用哪种后端都要灌入预置数据：
       * 「新电脑首次打开」恰恰是最需要固化数据生效的场景，
       * 不能因为 IndexedDB 不可用就把预置数据丢掉。 */
      return seedIfNeeded();
    }).catch(function (e) {
      console.warn('[store] 预置数据灌入失败：', e && e.message);
    }).then(function () {
      readyResolve(backend);
      return backend;
    });
  }

  function openIDB() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) return reject(new Error('无 indexedDB'));
      var req;
      try {
        req = global.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) { return reject(e); }
      var settled = false;
      setTimeout(function () {
        if (!settled) { settled = true; reject(new Error('打开超时')); }
      }, 4000);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      };
      req.onsuccess = function () {
        if (settled) return;
        settled = true;
        resolve(req.result);
      };
      req.onerror = function () {
        if (settled) return;
        settled = true;
        reject(req.error || new Error('打开失败'));
      };
      req.onblocked = function () {
        if (settled) return;
        settled = true;
        reject(new Error('被其它标签页占用'));
      };
    });
  }

  function lsAvailable() {
    try {
      global.localStorage.setItem(LS_PREFIX + '__t', '1');
      global.localStorage.removeItem(LS_PREFIX + '__t');
      return true;
    } catch (e) { return false; }
  }

  /* ---------------- 读写 ---------------- */

  function get(key) {
    return ready.then(function () {
      if (backend === 'idb') {
        return new Promise(function (resolve) {
          try {
            var tx = db.transaction(STORE, 'readonly');
            var req = tx.objectStore(STORE).get(key);
            req.onsuccess = function () {
              resolve(req.result === undefined ? null : req.result);
            };
            req.onerror = function () { resolve(null); };
          } catch (e) { resolve(null); }
        });
      }
      if (backend === 'ls') {
        try {
          var raw = global.localStorage.getItem(LS_PREFIX + key);
          return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
      }
      return mem[key] === undefined ? null : mem[key];
    });
  }

  function set(key, value) {
    return ready.then(function () {
      if (backend === 'idb') {
        return new Promise(function (resolve) {
          try {
            var tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put(value, key);
            tx.oncomplete = function () { resolve(true); };
            tx.onerror = function () { resolve(false); };
            tx.onabort = function () { resolve(false); };
          } catch (e) { resolve(false); }
        });
      }
      if (backend === 'ls') {
        try {
          global.localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
          return true;
        } catch (e) {
          /* 多半是超出配额 */
          console.warn('[store] localStorage 写入失败（可能超出配额）：', e && e.name);
          return false;
        }
      }
      mem[key] = value;
      return true;
    });
  }

  function del(key) {
    return ready.then(function () {
      if (backend === 'idb') {
        return new Promise(function (resolve) {
          try {
            var tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).delete(key);
            tx.oncomplete = function () { resolve(true); };
            tx.onerror = function () { resolve(false); };
          } catch (e) { resolve(false); }
        });
      }
      if (backend === 'ls') {
        try { global.localStorage.removeItem(LS_PREFIX + key); } catch (e) {}
        return true;
      }
      delete mem[key];
      return true;
    });
  }

  function clear() {
    return ready.then(function () {
      if (backend === 'idb') {
        return new Promise(function (resolve) {
          try {
            var tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).clear();
            tx.oncomplete = function () { resolve(true); };
            tx.onerror = function () { resolve(false); };
          } catch (e) { resolve(false); }
        });
      }
      if (backend === 'ls') {
        try {
          Object.keys(global.localStorage).forEach(function (k) {
            if (k.indexOf(LS_PREFIX) === 0) global.localStorage.removeItem(k);
          });
        } catch (e) {}
        return true;
      }
      mem = Object.create(null);
      return true;
    });
  }

  /* ---------------- 导出 / 导入 ---------------- */

  /** 导出全部联网数据，用于「保存为数据文件」或打包固化 */
  function exportAll() {
    return ready.then(function () {
      var keys = ['meta', 'pinyinMap', 'dict', 'poems', 'customChars',
        'fantiMap', 'shupinMap', 'dialectWords'];
      return Promise.all(keys.map(function (k) {
        return get(k).then(function (v) { return [k, v]; });
      })).then(function (pairs) {
        var out = { version: 1, exportedAt: new Date().toISOString() };
        pairs.forEach(function (p) { out[p[0]] = p[1]; });
        return out;
      });
    });
  }

  /** 导入数据（会覆盖同名键） */
  function importAll(data) {
    if (!data || typeof data !== 'object') {
      return Promise.reject(new Error('数据格式不正确'));
    }
    var keys = ['meta', 'pinyinMap', 'dict', 'poems', 'customChars',
      'fantiMap', 'shupinMap', 'dialectWords'];
    return ready.then(function () {
      return keys.reduce(function (chain, k) {
        return chain.then(function () {
          return data[k] === undefined || data[k] === null
            ? null : set(k, data[k]);
        });
      }, Promise.resolve());
    }).then(function () { return true; });
  }

  /* ---------------- 不依赖 ready 的底层读写 ----------------
   * 仅供初始化阶段（灌入预置数据）使用。
   * 必须存在这样一组函数：seedIfNeeded() 若调用 get()/set()，
   * 就会变成「seed 等 ready、ready 等 seed」的循环等待而死锁。 */

  function rawGet(key) {
    if (backend === 'idb') {
      return new Promise(function (resolve) {
        try {
          var req = db.transaction(STORE, 'readonly')
            .objectStore(STORE).get(key);
          req.onsuccess = function () {
            resolve(req.result === undefined ? null : req.result);
          };
          req.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
    }
    if (backend === 'ls') {
      try {
        var raw = global.localStorage.getItem(LS_PREFIX + key);
        return Promise.resolve(raw ? JSON.parse(raw) : null);
      } catch (e) { return Promise.resolve(null); }
    }
    return Promise.resolve(mem[key] === undefined ? null : mem[key]);
  }

  function rawSet(key, value) {
    if (backend === 'idb') {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(value, key);
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { resolve(false); };
          tx.onabort = function () { resolve(false); };
        } catch (e) { resolve(false); }
      });
    }
    if (backend === 'ls') {
      try {
        global.localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
        return Promise.resolve(true);
      } catch (e) { return Promise.resolve(false); }
    }
    mem[key] = value;
    return Promise.resolve(true);
  }

  /* ---------------- 预置数据（打包固化） ---------------- */

  function seedIfNeeded() {
    var baked = NS.BAKED_DATA;
    if (!baked) return Promise.resolve(false);
    return rawGet('meta').then(function (meta) {
      /* 已有更新过的数据就不覆盖，避免把用户后来同步的成果冲掉 */
      if (meta && meta.bakedSeedVersion >= (baked.version || 1)) return false;
      /* 注意：这里的键必须与 exportAll/importAll 一致。
       * 曾经漏掉 fantiMap，导致「固化数据后分发」时繁简对照表被静默丢弃。 */
      var keys = ['pinyinMap', 'dict', 'poems', 'customChars',
        'fantiMap', 'shupinMap', 'dialectWords'];
      return keys.reduce(function (chain, k) {
        return chain.then(function () {
          return (baked[k] === undefined || baked[k] === null)
            ? null : rawSet(k, baked[k]);
        });
      }, Promise.resolve()).then(function () {
        return rawSet('meta', Object.assign({}, baked.meta || {}, {
          bakedSeedVersion: baked.version || 1,
          seededAt: new Date().toISOString()
        }));
      }).then(function () { return true; });
    });
  }

  NS.Store = {
    ready: ready,
    init: init,
    getBackend: function () { return backend; },
    get: get,
    set: set,
    del: del,
    clear: clear,
    exportAll: exportAll,
    importAll: importAll
  };
  NS.Store.init();
})(typeof window !== 'undefined' ? window : globalThis);
