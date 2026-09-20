#!/usr/bin/env node
/* =========================================================================
 * probe-sources.js —— 联网数据源体检工具
 *
 * 用途：
 *   1. 检查本机能否访问各个公开数据源
 *   2. 检查对方是否返回 `Access-Control-Allow-Origin`（决定纯前端能否直连）
 *   3. 打印数据规模与结构样例，便于排查
 *
 * 运行：node tools/probe-sources.js
 *   加 --full 会真实下载并统计条目数（较慢，chinese-xinhua 有 27MB）
 * ========================================================================= */
'use strict';

/* 数据源清单**统一从 web/js/data/sources.js 读**，这里不再维护副本。
 *
 * 这里原来硬编码了一份，结果和 sources.js 漂移得很厉害，三处都是
 * 「从没成功过、但也没人发现」：
 *   · 「道德经」用的是 .../道德经/daodejing.json —— 该仓库根本没这个目录
 *   · 「宋词三百首」用的是 songci300.json —— 真实文件名是 宋词三百首.json
 *   · 「唐诗三百首」用的是 .../json/tangshisanbaishou.json —— 实际在 蒙学/ 下
 * 复用同一个清单，就不会再出现这种漂移。 */
const path = require('path');
require(path.join(__dirname, '..', 'web', 'js', 'data', 'sources.js'));
const NS = globalThis.NS;
const SOURCES = NS.SOURCES;

const TIMEOUT_MS = 20000;
const FULL = process.argv.includes('--full');

function fmtSize(n) {
  if (n > 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  if (n > 1024) return (n / 1024).toFixed(0) + ' KB';
  return n + ' B';
}

async function probeUrl(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      /* 模拟 file:// 页面发起的请求：浏览器在这种情况会带 Origin: null */
      headers: { Origin: 'null', 'User-Agent': 'naming-system-probe' }
    });
    const acao = res.headers.get('access-control-allow-origin');
    const len = res.headers.get('content-length');
    let body = null;

    if (res.ok && FULL) {
      body = await res.text();
    } else if (res.body && res.body.cancel) {
      /* 只看响应头，不下载正文（chinese-xinhua 有 27MB，全下会很慢） */
      res.body.cancel().catch(function () {});
    }

    return {
      url, status: res.status, ok: res.ok, acao,
      size: len ? Number(len) : (body ? body.length : null),
      body, ms: Date.now() - t0,
      corsOk: acao === '*' || acao === 'null'
    };
  } catch (e) {
    return { url, ok: false, error: e.name === 'AbortError' ? '超时' : e.message,
      ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

/** 依次尝试主地址与镜像地址，返回第一个成功的 —— 顺便验证镜像真的可用 */
async function probe(src) {
  const urls = src.urls || [];
  let last = null;
  for (let i = 0; i < urls.length; i++) {
    const r = await probeUrl(urls[i]);
    if (r.ok) { r.mirror = (i > 0); return r; }
    last = r;
  }
  return last || { ok: false, error: '该源没有配置任何地址' };
}

/** 粗略统计条目数，让使用者知道数据够不够用 */
function summarize(id, text) {
  if (!text) return '';
  try {
    if (id === 'pinyin') {
      const lines = text.split('\n').filter(l => /^U\+/.test(l.trim()));
      return `${lines.length} 个汉字拼音条目`;
    }
    const data = JSON.parse(text);
    const arr = Array.isArray(data) ? data
      : (data.content || data.paragraphs ? [data] : Object.values(data).find(Array.isArray));
    if (!arr) return '结构未知';
    if (id === 'xinhua') {
      const withPy = arr.filter(x => x.pinyin).length;
      return `${arr.length} 个汉字，其中 ${withPy} 个带拼音`;
    }
    return `${arr.length} 条`;
  } catch (e) {
    return '解析失败：' + e.message;
  }
}

(async function main() {
  console.log('联网数据源体检');
  console.log('='.repeat(72));
  console.log(FULL ? '（--full：真实下载全部内容）' : '（默认只探测头部信息）');
  console.log('');

  let okCount = 0, corsCount = 0;

  for (const src of SOURCES) {
    const r = await probe(src);
    const tag = r.ok ? '\u2713' : '\u2717';
    if (r.ok) okCount++;
    if (r.corsOk) corsCount++;

    console.log(`${tag} ${src.name}`);
    if (r.ok) {
      console.log(`    状态 ${r.status}   大小 ${r.size ? fmtSize(r.size) : '未知'}` +
        `   耗时 ${r.ms}ms   CORS ${r.acao || '（未返回）'}` +
        (r.corsOk ? '  → 纯前端可直连' : '  → 纯前端无法直连，需要本地服务代理'));
      if (r.mirror) console.log('    注意：主地址不可用，实际走的是镜像地址');
      const s = summarize(src.id, r.body);
      if (s) console.log(`    数据量：${s}`);
    } else {
      console.log(`    失败：${r.error || ('HTTP ' + r.status)}   耗时 ${r.ms}ms`);
    }
    console.log(`    说明：${src.desc || ''}`);
    console.log('');
  }

  console.log('='.repeat(72));
  console.log(`可达 ${okCount}/${SOURCES.length}；支持跨域直连 ${corsCount}/${SOURCES.length}`);
  console.log('');
  console.log('注：康熙笔画与姓名学五行没有可靠的公开数据源，');
  console.log('    本系统对新增汉字采用「部首规则推断 + 明确标注」的方式处理。');

  process.exit(okCount === 0 ? 1 : 0);
})();
