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

const SOURCES = [
  {
    id: 'pinyin',
    name: '拼音数据（含声调）· mozillazg/pinyin-data',
    url: 'https://raw.githubusercontent.com/mozillazg/pinyin-data/master/pinyin.txt',
    kind: 'text',
    note: 'U+4E00: yī  # 一 —— 覆盖基本区全部汉字，可用来补全拼音与声调'
  },
  {
    id: 'xinhua',
    name: '汉字字典（拼音/部首/笔画/释义）· pwxcoo/chinese-xinhua',
    url: 'https://raw.githubusercontent.com/pwxcoo/chinese-xinhua/master/data/word.json',
    kind: 'json',
    note: '约 27MB，含 word/oldword/strokes/pinyin/radicals/explanation'
  },
  {
    id: 'shijing',
    name: '诗经 · chinese-poetry',
    url: 'https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master/%E8%AF%97%E7%BB%8F/shijing.json',
    kind: 'json',
    note: '约 157KB，含 title/chapter/content'
  },
  {
    id: 'tangshi',
    name: '唐诗三百首 · chinese-poetry',
    url: 'https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master/json/tangshisanbaishou.json',
    kind: 'json',
    note: '含 author/paragraphs'
  },
  {
    id: 'songci',
    name: '宋词三百首 · chinese-poetry',
    url: 'https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master/%E5%AE%8B%E8%AF%8D/songci300.json',
    kind: 'json',
    note: '含 author/rhythmic/paragraphs'
  },
  {
    id: 'lunyu',
    name: '论语 · chinese-poetry',
    url: 'https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master/%E8%AE%BA%E8%AF%AD/lunyu.json',
    kind: 'json',
    note: '含 chapter/paragraphs'
  },
  {
    id: 'daodejing',
    name: '道德经 · chinese-poetry',
    url: 'https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master/%E9%81%93%E5%BE%B7%E7%BB%8F/daodejing.json',
    kind: 'json',
    note: '含 chapter/paragraphs'
  },
  {
    id: 'chuci',
    name: '楚辞 · chinese-poetry',
    url: 'https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master/%E6%A5%9A%E8%BE%9E/chuci.json',
    kind: 'json',
    note: '含 title/section/author/content'
  }
];

const TIMEOUT_MS = 20000;
const FULL = process.argv.includes('--full');

function fmtSize(n) {
  if (n > 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  if (n > 1024) return (n / 1024).toFixed(0) + ' KB';
  return n + ' B';
}

async function probe(src) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(src.url, {
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
      src, status: res.status, ok: res.ok, acao,
      size: len ? Number(len) : (body ? body.length : null),
      body, ms: Date.now() - t0,
      corsOk: acao === '*' || acao === 'null'
    };
  } catch (e) {
    return { src, ok: false, error: e.name === 'AbortError' ? '超时' : e.message,
      ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
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
      const s = summarize(src.id, r.body);
      if (s) console.log(`    数据量：${s}`);
    } else {
      console.log(`    失败：${r.error || ('HTTP ' + r.status)}   耗时 ${r.ms}ms`);
    }
    console.log(`    说明：${src.note}`);
    console.log('');
  }

  console.log('='.repeat(72));
  console.log(`可达 ${okCount}/${SOURCES.length}；支持跨域直连 ${corsCount}/${SOURCES.length}`);
  console.log('');
  console.log('注：康熙笔画与姓名学五行没有可靠的公开数据源，');
  console.log('    本系统对新增汉字采用「部首规则推断 + 明确标注」的方式处理。');

  process.exit(okCount === 0 ? 1 : 0);
})();
