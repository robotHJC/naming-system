#!/usr/bin/env node
/* =========================================================================
 * _gen-chars.js —— 生成「候选新增字」的属性表
 *
 * 为什么不手填康熙笔画：
 *   chars-extra.js 的文件头写明了「只收录繁体写法与简体相同的字」，
 *   因为只有这类字才有 康熙笔画 = 简体笔画 + 部首修正 这个精确关系。
 *   凭记忆手填 150 个字的康熙笔画，错一个就会静默污染三才五格与姓名卦，
 *   而且不会有任何报错。
 *
 * 这个脚本改成「可复算」：
 *   1. 新华字典（pwxcoo/chinese-xinhua）给权威的 部首 + 简体笔画
 *   2. OpenCC TSCharacters 判断该字是否有不同写法的繁体
 *        —— 有（庆→慶、莲→蓮、骏→駿）：**直接剔除**，算不准就别硬算
 *        —— 没有（皓、湛、栩、信）：康熙笔画 = 简体笔画 + 部首修正
 *   3. 输出成表，人工再补 拼音/声调/五行/性别/风格/寓意
 *
 * 运行：node tools/_gen-chars.js           （会联网，xinhua 约 27MB）
 *       node tools/_gen-chars.js --cached  （用本地缓存，不重新下载）
 * 输出：tools/_gen-chars-out.txt
 * ========================================================================= */
'use strict';

const path = require('path');
const fs = require('fs');
const https = require('https');

const BASE = path.join(__dirname, '..', 'web', 'js');
require(path.join(BASE, 'data/chars-extra.js'));
require(path.join(BASE, 'data/chars.js'));
require(path.join(BASE, 'core/infer.js'));

const NS = globalThis.NS;
const CACHE = path.join(__dirname, '_gen-cache');
const cached = process.argv.indexOf('--cached') >= 0;

/* ---------------- 候选字 ---------------- */
/* 只收「当代起名真的会用」的字。宁缺毋滥：
 * 字库自称「精选用字」，掺进 长/高/香/罗/美 这类泛用字只会稀释它。 */
const CANDIDATES = (
  /* 光明 / 时间 */
  '皓 昶 晓 曙 晟 晔' +
  /* 火 / 光热 */
  '熠 煊 炅 焱 焜 炫' +
  /* 玉 / 珍宝 */
  '玟 璟 琮 瑀 璎 珺' +
  /* 水 */
  '澄 湛 浚 淮 津 沅 溯 淏 泓 潇 汀' +
  /* 木 / 草 */
  '栩 芃 蕊 荞 茴 蓁 芸 菱 茗' +
  /* 金 */
  '铉 钰 铭 锴' +
  /* 山 / 土 */
  '崧 巽 堃 峥 峻' +
  /* 人 / 品德 */
  '佑 信 儒 允 卓 卿 善 彬 惟 敬 元 侃 徵 修 逸' +
  /* 心 */
  '惜 慕 慈 憧 憬 忻 忱 恪' +
  /* 言 / 文采 */
  '韶 音 谨 谧 谚 谊' +
  /* 女 */
  '媛 姚 妤 妮 婕 妩' +
  /* 竹 */
  '笙 竺 筠 筱 篁 篆 箐 笛 箫' +
  /* 马 / 鸟 / 祥兽 */
  '麟 麒 翎 翀 翼 鸢 骐' +
  /* 通用美德 */
  '宏 尚 展 序 庆 康 成 拓 政 斌 斯 新 春 期 敬' +
  /* 自然 */
  '朴 杉 梧 楚 槐 檀 泉 浦 深 渤 滨 瀚 洪' +
  /* 其他高频 */
  '祥 科 童 章 聪 育 良 艺 艾 莉 菊 虹 誉 采 闻 阳 隆 雄 雷 霜 霞 黎 龄 骏 鹤 鸾 莲 萧 丰 达 曜 曦 晗 熙'
).split(/\s+/).join('');

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchText(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject);
  });
}

async function load(url, cacheName) {
  const p = path.join(CACHE, cacheName);
  if (cached && fs.existsSync(p)) {
    process.stderr.write('用缓存 ' + cacheName + '\n');
    return fs.readFileSync(p, 'utf8');
  }
  process.stderr.write('下载 ' + cacheName + ' …\n');
  const txt = await fetchText(url);
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(p, txt, 'utf8');
  return txt;
}

(async function main() {
  const xinhuaTxt = await load(
    'https://raw.githubusercontent.com/pwxcoo/chinese-xinhua/master/data/word.json',
    'xinhua-word.json');
  const fantiTxt = await load(
    'https://raw.githubusercontent.com/BYVoid/OpenCC/master/data/dictionary/TSCharacters.txt',
    'opencc-ts.txt');

  const dict = JSON.parse(xinhuaTxt);
  const byChar = new Map();
  dict.forEach((e) => {
    const w = (e.word || '').trim();
    if (w.length === 1 && !byChar.has(w)) byChar.set(w, e);
  });

  /* OpenCC 是「繁 → 简」。某个简体字的繁体写法与它自己不同 ⇒ 该字被简化过，
   * 康熙笔画不能靠「简体 + 部首修正」推，必须查真正的繁体写法。 */
  const simplifiedFrom = new Map();     /* 简体字 → 繁体写法 */
  fantiTxt.split('\n').forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const parts = t.split(/\s+/);
    if (parts.length !== 2) return;
    const [trad, simp] = parts;
    if (trad.length !== 1 || simp.length !== 1) return;
    if (trad === simp) return;
    if (!simplifiedFrom.has(simp)) simplifiedFrom.set(simp, trad);
  });

  const db = NS.CHAR_DB;
  const seen = new Set();
  const ok = [], needManual = [], notFound = [];

  Array.from(CANDIDATES).forEach((c) => {
    if (seen.has(c)) return;
    seen.add(c);
    if (db[c]) { return; }               /* 已在库中 */

    const e = byChar.get(c);
    if (!e) { notFound.push(c + '（字典无此字）'); return; }

    const simp = parseInt(e.strokes, 10);
    const radical = (e.radicals || '').trim();

    const trad = simplifiedFrom.get(c);
    if (trad) {
      needManual.push(c + '  部首=' + radical + '  简体=' + simp +
        ' 繁体=' + trad + '（需按繁体笔画人工核定）');
      return;
    }
    if (!isFinite(simp) || simp <= 0) { notFound.push(c + '（无笔画）'); return; }

    const est = NS.Infer.estimateKangxi(simp, c, radical);
    ok.push({
      char: c, radical, simp, kangxi: est.strokes, delta: est.delta,
      pinyin: (e.pinyin || '').trim(),
      expl: (e.explanation || '').replace(/\s+/g, '').slice(0, 40)
    });
  });

  const pad = (s, n) => {
    let w = 0;
    for (const ch of String(s)) w += ch.charCodeAt(0) > 0x2e80 ? 2 : 1;
    return String(s) + ' '.repeat(Math.max(0, n - w));
  };

  const L = [];
  L.push('候选（去重、去掉已在库中）: ' + seen.size);
  L.push('可安全生成                : ' + ok.length);
  L.push('繁体不同、需人工核定      : ' + needManual.length);
  L.push('字典里查不到              : ' + notFound.length);
  L.push('');
  L.push('========== 可安全生成（康熙笔画 = 简体 + 部首修正，已复算） ==========');
  L.push(pad('字', 4) + pad('部首', 6) + pad('简体', 6) + pad('修正', 6) +
    pad('康熙', 6) + pad('字典拼音', 14) + '释义片段');
  ok.sort((a, b) => a.kangxi - b.kangxi);
  ok.forEach((o) => {
    L.push(pad(o.char, 4) + pad(o.radical, 6) + pad(o.simp, 6) +
      pad(o.delta ? '+' + o.delta : '0', 6) + pad(o.kangxi, 6) +
      pad(o.pinyin, 14) + o.expl);
  });
  L.push('');
  L.push('========== 被简化过，不能按简体推（要按繁体笔画） ==========');
  needManual.forEach((s) => L.push('  ' + s));
  L.push('');
  if (notFound.length) {
    L.push('========== 字典无记录 ==========');
    notFound.forEach((s) => L.push('  ' + s));
  }

  fs.writeFileSync(path.join(__dirname, '_gen-chars-out.txt'), L.join('\n'), 'utf8');
  console.log('可安全生成 ' + ok.length + ' 个，需人工核定 ' + needManual.length +
    ' 个，查不到 ' + notFound.length + ' 个');
  console.log('详见 tools/_gen-chars-out.txt');
})().catch((e) => { console.error(e.message); process.exit(1); });
