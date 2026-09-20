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

  /* =========================================================================
   * 应用层「数据格式版本」
   *
   * 用户反馈：「如果我有多个版本更新，上一个版本下载的联网词库要么保留合并，
   * 要么就给清理掉；不要每次打开网页或者更新版本都给我把手机内存占满了。」
   *
   * 在这之前**完全没有版本概念** —— restore() 无条件读入本地数据，
   * 不管它是哪个版本的程序写的。改了数据格式后旧数据照读，
   * 结果是难以排查的诡异行为，而且旧数据永远占着空间没人清。
   *
   * 凡改了下列结构就要把 DATA_SCHEMA +1：
   *   · 诗词条目的字段与解析方式（poems）
   *   · 字典条目 [简体笔画, 部首, 带调拼音, 释义] 的数组顺序（dict）
   *   · 拼音表 / 繁简表 / 蜀拼表的形状（pinyinMap / fantiMap / shupinMap）
   *   · 自定义字条目的字段（customChars）
   *
   * 注意与 DB_VERSION 的区别：DB_VERSION 管的是 **IndexedDB 的库结构**
   * （有几个 object store），DATA_SCHEMA 管的是**存进去的数据长什么样**。
   * 两者独立变化。
   * ========================================================================= */
  var DATA_SCHEMA = 1;

  /* 能直接沿用的最低版本。
   *
   * 当前 DATA_SCHEMA = MIN_COMPAT_SCHEMA = 1，含义是：
   *   **这一版没有改数据格式**，所以本地已有数据一律沿用，不打扰用户。
   * 我特意没有把 DATA_SCHEMA 填成一个好看的大数字（比如 2）去「装作
   * 升级过格式」—— 那是不诚实的，而且会让用户在毫无必要的情况下
   * 白白重新下载 20MB 字典。
   *
   * 将来真改了格式（比如诗词字段变了）：
   *   1. 把 DATA_SCHEMA 和 MIN_COMPAT_SCHEMA 一起提到新值（如都改成 2）；
   *   2. 那么 schema < 2 的本地数据会被自动清掉，并要求重新同步；
   *   3. 没有 schema 字段的更老数据（按 1 处理）同样会被清掉。
   * 「保留合并」还是「清理掉」就由这两个常量决定，是**明确开关**。
   *
   * 另外：完全没有本地数据（全新环境）时不走这套判断 ——
   * 没有东西需要作废，不该弹「数据已清空」的提示。 */
  var MIN_COMPAT_SCHEMA = 1;

  /* 导出数据文件（「保存为数据文件」/ 打包固化）的格式版本。
   * 与 DATA_SCHEMA 分开是因为两者变化时机不同：
   * 导出文件格式可能长期不变，而内部存储格式会调整。 */
  var EXPORT_FORMAT_VERSION = 1;

  /**
   * 判断本地数据与当前程序是否兼容
   * @param {number|undefined} saved 本地 meta.schema
   * @returns {{state:string, saved:number, current:number}}
   *   'ok'    可以直接沿用
   *   'stale' 太旧，格式可能已变 → 清掉并重新同步
   *   'future' 比程序还新（用户回退了程序版本）→ 同样不用，避免误读
   */
  function schemaState(saved) {
    var v = saved || 1;
    var state = 'ok';
    if (v > DATA_SCHEMA) state = 'future';
    else if (v < MIN_COMPAT_SCHEMA) state = 'stale';
    return { state: state, saved: v, current: DATA_SCHEMA };
  }

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
        var out = { version: EXPORT_FORMAT_VERSION, exportedAt: new Date().toISOString() };
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
    /* 校验数据文件自身的版本。
     * 导出文件里的 version 字段一直写着，但从来没人检查 —— 结果
     * 导入一个老版本导出的数据文件会静默产生错格式的数据。
     * 这里至少要把「比程序新」的文件挡下来。 */
    var fv = data.version;
    if (typeof fv === 'number' && fv > EXPORT_FORMAT_VERSION) {
      return Promise.reject(new Error(
        '这个数据文件来自更新的版本（格式 v' + fv + '，当前支持 v' +
        EXPORT_FORMAT_VERSION + '），请先升级程序再导入'));
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

  /**
   * 估算本地数据占用（字节）。
   *
   * 用 JSON 序列化后的长度近似 —— IndexedDB 实际存储会更紧凑一些，
   * 但量级正确，足够回答用户那个问题：「是不是快把手机内存占满了」。
   * 分开返回各键的大小，好看出大头是谁（通常是 dict，字典约 20MB+）。
   */
  function usage() {
    var keys = ['dict', 'poems', 'pinyinMap', 'fantiMap', 'shupinMap',
      'dialectWords', 'customChars', 'meta'];
    return ready.then(function () {
      return Promise.all(keys.map(function (k) {
        return get(k).then(function (v) {
          var n = 0;
          if (v !== null && v !== undefined) {
            try { n = JSON.stringify(v).length; } catch (e) { n = 0; }
          }
          return [k, n];
        });
      }));
    }).then(function (pairs) {
      var total = 0;
      var byKey = Object.create(null);
      pairs.forEach(function (p) { byKey[p[0]] = p[1]; total += p[1]; });
      return {
        totalBytes: total,
        byKey: byKey,
        backend: backend,
        schema: schemaState(null).current
      };
    });
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
    importAll: importAll,
    usage: usage,
    /* 数据格式版本：lexicon 启动时用它判断本地数据能不能沿用 */
    DATA_SCHEMA: DATA_SCHEMA,
    MIN_COMPAT_SCHEMA: MIN_COMPAT_SCHEMA,
    schemaState: schemaState
  };
  NS.Store.init();
})(typeof window !== 'undefined' ? window : globalThis);
