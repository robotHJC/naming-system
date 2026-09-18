#!/usr/bin/env node
/* =========================================================================
 * inspect-sources.js —— 打印各数据源的真实结构与样例
 *
 * 写解析器之前必须先看真实数据长什么样，避免凭猜测写坏解析逻辑。
 * 运行：node tools/inspect-sources.js [源id ...]
 *       不带参数则检查全部；数据结构较大时只打印前若干字符。
 * ========================================================================= */
'use strict';

const path = require('path');
const BASE = path.join(__dirname, '..', 'web', 'js');
require(path.join(BASE, 'data', 'sources.js'));
require(path.join(BASE, 'core', 'net.js'));
const NS = globalThis.NS;

process.on('unhandledRejection', function (e) {
  console.error('未捕获的异步异常：', e && (e.stack || e.message || e));
  process.exit(2);
});

const only = process.argv.slice(2);
const list = only.length
  ? NS.SOURCES.filter(s => only.includes(s.id))
  : NS.SOURCES;

function show(label, val, max) {
  let s = typeof val === 'string' ? val : JSON.stringify(val, null, 1);
  if (s === undefined) s = String(val);
  s = s.replace(/\s+/g, ' ');
  if (s.length > (max || 320)) s = s.slice(0, max || 320) + ' …';
  console.log(`    ${label}: ${s}`);
}

(async function main() {
  for (const src of list) {
    console.log('='.repeat(74));
    console.log(`${src.id}  ——  ${src.name}   [${src.format}]  ${NS.formatSize(src.size)}`);
    let text = null;
    const t0 = Date.now();
    try {
      let lastPct = 0;
      const r = await NS.Net.fetchText(src, {
        onProgress: function (rec, total, pct) {
          if (pct - lastPct >= 10) {
            lastPct = pct;
            process.stdout.write(`  …已下载 ${pct.toFixed(0)}% (${NS.formatSize(rec)})\n`);
          }
        }
      });
      text = r.text;
      console.log(`  下载成功：${text.length} 字符，耗时 ${Date.now() - t0}ms，来自 ` +
        r.url.split('/')[2]);
    } catch (e) {
      console.log(`  下载失败（${Date.now() - t0}ms）：${e.message}`);
      if (e.details) e.details.forEach(d => console.log(`      · ${d}`));
      continue;
    }

    try {
      switch (src.format) {
        case 'pinyin': {
          const lines = text.split('\n').filter(l => /^\s*U\+/i.test(l));
          console.log(`  符合「U+XXXX:」格式的行数：${lines.length}`);
          lines.slice(0, 6).forEach(l => show('样例行', l, 90));
          break;
        }
        case 'fanti': {
          const lines = text.split('\n').filter(l => l.trim() && l.charAt(0) !== '#');
          console.log(`  对照条数：${lines.length}`);
          lines.slice(0, 4).forEach(l => show('样例行', l, 100));
          /* 逐字映射最容易出问题的是「一繁对多简、且部分读法不该转」的字，
           * 这些字如果转错，会污染诗篇原文（例如「乾坤」被转成「干坤」）。 */
          const tricky = '乾 著 別 制 發 後 里 面 幹 隻 云 於 郁 借 假 復 覆 台 臺 沖 衝 獲 穫 皂';
          console.log('  —— 歧义字解析结果 ——');
          tricky.split(' ').forEach(ch => {
            const line = lines.find(l => l.charAt(0) === ch);
            if (line) show(ch + ' →', line.replace(/\t/g, ' | '), 70);
          });
          break;
        }
        case 'xinhua': {
          const arr = JSON.parse(text);
          console.log(`  数组长度：${arr.length}`);
          show('第一条', arr[0]);
          const withPy = arr.filter(x => x.pinyin).length;
          const withEx = arr.filter(x => x.explanation).length;
          const withSt = arr.filter(x => x.strokes).length;
          console.log(`  带 pinyin: ${withPy} / 带 strokes: ${withSt} / 带 explanation: ${withEx}`);
          const multi = arr.filter(x => String(x.word).length > 1).length;
          console.log(`  多字词条数：${multi}（解析时需过滤，只要单字）`);
          break;
        }
        default: {
          const data = JSON.parse(text);
          console.log(`  顶层类型：${Array.isArray(data) ? '数组' : typeof data}` +
            (Array.isArray(data) ? `，长度 ${data.length}` : ''));
          if (!Array.isArray(data)) show('顶层键', Object.keys(data), 200);
          const first = Array.isArray(data) ? data[0] : data;
          if (first && typeof first === 'object') {
            console.log(`  分条键名：${Object.keys(first).join(', ')}`);
            show('第一条', first, 420);
            if (Array.isArray(data) && data[1]) show('第二条', data[1], 260);
          }
          break;
        }
      }
    } catch (e) {
      console.log(`  解析失败：${e.message}`);
      show('原始开头', text, 260);
    }
    console.log('');
  }
})();
