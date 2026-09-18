/* =========================================================================
 * net.js —— 联网下载层
 *
 * 设计要点：
 *   1. 主地址失败自动回退镜像（raw.githubusercontent → jsDelivr）。
 *   2. 用 ReadableStream 读进度；进度分母优先用登记表里的实测大小，
 *      因为浏览器拿到的 content-length 是压缩后大小，而流里是解压后的字节，
 *      直接用 content-length 会算出一个超过 100% 的百分比。
 *   3. 单次超时 + 有限重试；所有失败都返回结构化原因，不抛到界面外。
 *   4. file:// 页面可直接使用：已验证数据源均返回 Access-Control-Allow-Origin: *
 * ========================================================================= */
(function (global) {
  'use strict';
  var NS = (global.NS = global.NS || {});

  var TIMEOUT_MS = 120000;   /* 大文件（字典 26MB）需要更长时间 */
  var META_TIMEOUT_MS = 20000;

  function now() {
    return (global.performance && global.performance.now)
      ? global.performance.now() : Date.now();
  }

  /**
   * 下载文本
   * @param {Object} src 登记表条目
   * @param {Object} [opt] { onProgress(received, total, pct), timeoutMs }
   * @returns {Promise<{text:string, url:string, ms:number, bytes:number}>}
   */
  function fetchText(src, opt) {
    opt = opt || {};
    var urls = (src.urls || []).slice();
    var errors = [];

    function tryOne(i) {
      if (i >= urls.length) {
        var e = new Error('全部地址都失败：' + errors.join(' / '));
        e.details = errors;
        return Promise.reject(e);
      }
      return fetchWithProgress(urls[i], src, opt).catch(function (err) {
        errors.push(err.message);
        return tryOne(i + 1);
      });
    }
    return tryOne(0);
  }

  function fetchWithProgress(url, src, opt) {
    var ctrl = new AbortController();
    var timeoutMs = opt.timeoutMs ||
      (src.big ? TIMEOUT_MS : META_TIMEOUT_MS * 3);
    var timer = setTimeout(function () { ctrl.abort(); }, timeoutMs);
    var t0 = now();

    return fetch(url, {
      cache: 'no-store',
      signal: ctrl.signal,
      /* file:// 页面会自动带 Origin: null，无需手动设置 */
      headers: { 'Accept': 'application/json, text/plain, */*' }
    }).then(function (res) {
      if (!res.ok) {
        throw new Error('HTTP ' + res.status + ' ' + url.split('/')[2]);
      }

      /* 进度分母：优先用登记表实测大小（未压缩） */
      var headerLen = parseInt(res.headers.get('content-length'), 10);
      var total = src.size || (isFinite(headerLen) ? headerLen : 0);

      if (!res.body || !res.body.getReader) {
        return res.text().then(function (text) {
          return { text: text, url: url, ms: now() - t0, bytes: text.length };
        });
      }

      var reader = res.body.getReader();
      var chunks = [];
      var received = 0;

      return (function pump() {
        return reader.read().then(function (r) {
          if (r.done) {
            clearTimeout(timer);
            /* 合并字节流后按 UTF-8 解码，避免多字节字符被切断 */
            var buf = new Uint8Array(received);
            var off = 0;
            chunks.forEach(function (c) { buf.set(c, off); off += c.length; });
            var text = new TextDecoder('utf-8').decode(buf);
            return { text: text, url: url, ms: now() - t0, bytes: received };
          }
          chunks.push(r.value);
          received += r.value.length;
          if (opt.onProgress && total) {
            var pct = Math.min(100, received / total * 100);
            opt.onProgress(Math.min(received, total), total, pct);
          }
          return pump();
        });
      })();
    }).catch(function (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        throw new Error('超时（' + Math.round(timeoutMs / 1000) + 's）');
      }
      if (err instanceof TypeError) {
        /* fetch 在网络层失败时抛 TypeError，最常见的是跨域被拦或断网 */
        throw new Error('网络不可达或被浏览器拦截');
      }
      throw err;
    });
  }

  /**
   * 下载 JSON
   */
  function fetchJSON(src, opt) {
    return fetchText(src, opt).then(function (r) {
      try {
        r.json = JSON.parse(r.text);
      } catch (e) {
        throw new Error('返回内容不是合法 JSON：' + e.message);
      }
      return r;
    });
  }

  /**
   * 逐个下载多个源，把结果汇总
   * @param {Array} sources
   * @param {Object} hooks { onSourceStart(src), onSourceDone(src, result),
   *                         onSourceError(src, err), onProgress(src, rec, total, pct) }
   * @returns {Promise<{ok:Array, failed:Array}>}
   */
  function fetchAll(sources, hooks) {
    hooks = hooks || {};
    var ok = [], failed = [];
    var chain = Promise.resolve();

    sources.forEach(function (src) {
      chain = chain.then(function () {
        if (hooks.onSourceStart) hooks.onSourceStart(src);
        var t0 = now();
        return fetchText(src, {
          onProgress: function (rec, total, pct) {
            if (hooks.onProgress) hooks.onProgress(src, rec, total, pct);
          }
        }).then(function (r) {
          ok.push({ src: src, text: r.text, bytes: r.bytes, ms: now() - t0 });
          if (hooks.onSourceDone) {
            hooks.onSourceDone(src, r, now() - t0);
          }
        }).catch(function (err) {
          failed.push({ src: src, error: err.message });
          if (hooks.onSourceError) hooks.onSourceError(src, err);
        });
      });
    });

    return chain.then(function () {
      return { ok: ok, failed: failed };
    });
  }

  NS.Net = {
    fetchText: fetchText,
    fetchJSON: fetchJSON,
    fetchAll: fetchAll
  };
})(typeof window !== 'undefined' ? window : globalThis);
