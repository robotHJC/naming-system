#!/usr/bin/env node
/* =========================================================================
 * build-dist.js —— 打包发布
 *
 * 产出 dist/ 下三样东西：
 *   1. 取名系统.html          单文件版：CSS/JS/数据全部内联，拷到任何电脑双击即用
 *   2. 取名系统-完整版/       文件夹版：保留可编辑源码 + 启动器，便于后续改字库
 *   3. 取名系统.zip           上面那个文件夹的压缩包，直接发给人
 *
 * 可选「固化联网数据」：把已经同步好的词库（拼音表/字典/诗词/自建字）
 * 一起打包进去，别人拿到就是「词库已扩充」的状态，不必重新下载。
 *
 * 用法：
 *   node tools/build-dist.js                         自动寻找数据文件
 *   node tools/build-dist.js --bake path/to/x.json   指定数据文件
 *   node tools/build-dist.js --no-dict               固化时不含字典（文件更小）
 *   node tools/build-dist.js --no-zip                跳过压缩包
 * ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const DIST = path.join(ROOT, 'dist');

const argv = process.argv.slice(2);
function flag(name) { return argv.includes('--' + name); }
function opt(name) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}

const SINGLE_NAME = '取名系统.html';
const FOLDER_NAME = '取名系统-完整版';
const ZIP_NAME = '取名系统.zip';

/* ---------------- 工具 ---------------- */

function readFile(p) { return fs.readFileSync(p, 'utf8'); }

function fmtSize(n) {
  if (n > 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + ' MB';
  if (n > 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}

/** 内联 JS 时防止内容里的 </script 提前闭合标签 */
function safeScript(js) {
  return js.replace(/<\/script/gi, '<\\/script');
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function walk(dir, base, out) {
  base = base || dir; out = out || [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach(d => {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full));
  });
  return out;
}

/* ---------------- 自动寻找数据文件 ---------------- */

function findBakeFile() {
  const explicit = opt('bake');
  if (explicit) {
    const p = path.isAbsolute(explicit) ? explicit : path.join(ROOT, explicit);
    if (!fs.existsSync(p)) throw new Error('指定的数据文件不存在：' + p);
    return p;
  }
  /* 常见位置：tools/naming-lexicon-*.json（浏览器导出的默认文件名）、data/synced.json */
  const cands = [];
  [path.join(ROOT, 'tools'), path.join(ROOT, 'data'), ROOT].forEach(dir => {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(f => {
      if (/^naming-lexicon-.*\.json$/i.test(f) || /^(synced|baked).*\.json$/i.test(f)) {
        cands.push(path.join(dir, f));
      }
    });
  });
  if (!cands.length) return null;
  /* 取最新的一个 */
  cands.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return cands[0];
}

function prepareBaked(file) {
  if (!file) return null;
  const data = JSON.parse(readFile(file));
  const stats = {
    file: path.relative(ROOT, file),
    pinyin: data.pinyinMap ? Object.keys(data.pinyinMap).length : 0,
    dict: data.dict ? Object.keys(data.dict).length : 0,
    poems: data.poems ? data.poems.length : 0,
    customChars: data.customChars ? data.customChars.length : 0,
    droppedDict: 0
  };
  if (flag('no-dict') && data.dict) {
    stats.droppedDict = Object.keys(data.dict).length;
    delete data.dict;
  }
  stats.js = 'window.NS = window.NS || {};\nwindow.NS.BAKED_DATA = ' +
    JSON.stringify(data).replace(/<\//g, '<\\/') + ';\n';
  stats.bytes = stats.js.length;
  return stats;
}

/* ---------------- 内联构建 ---------------- */

function inlineHtml(html, bakedJs) {
  let out = html;

  /* 样式表 */
  out = out.replace(/<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/?>/gi,
    (m, href) => {
      const file = path.join(WEB, href);
      if (!fs.existsSync(file)) throw new Error('找不到样式文件：' + href);
      return '<style>\n' + readFile(file).trim() + '\n</style>';
    });

  /* 脚本 */
  out = out.replace(/<script\s+src="([^"]+)"\s*><\/script>/gi, (m, src) => {
    const file = path.join(WEB, src);
    if (!fs.existsSync(file)) throw new Error('找不到脚本文件：' + src);
    return '<script>\n' + safeScript(readFile(file).trim()) + '\n</script>';
  });

  /* 固化数据要放在所有脚本之前，store.js 启动时才会读到 */
  if (bakedJs) {
    out = out.replace('<body>', '<body>\n<!-- 固化词库数据（打包时写入） -->\n' +
      '<script>\n' + safeScript(bakedJs).trim() + '\n</script>');
  }

  if (/<script\s+src=/i.test(out)) {
    throw new Error('仍有未内联的 <script src>，请检查 index.html');
  }
  return out;
}

/* ---------------- 启动器 ---------------- */

function launcherBat(htmlName, withSrc) {
  const lines = [
    '@echo off',
    'chcp 65001 >nul',
    'title 取名系统',
    'cd /d "%~dp0"',
    '',
    'set "PAGE=%CD%\\' + htmlName + '"',
    'if not exist "%PAGE%" (',
    '    echo [错误] 找不到 ' + htmlName,
    '    pause',
    '    exit /b 1',
    ')',
    '',
    'echo.',
    'echo   正在打开取名系统...',
    'echo   若没有自动弹出，请手动双击 ' + htmlName,
    'echo.'
  ];
  if (withSrc) {
    lines.push('echo   直接改 src\\ 下的文件即可自定义字库，改完重新打开本文件。');
  }
  lines.push('');
  lines.push('start "" "%PAGE%"');
  lines.push('exit /b 0');
  /* 批处理必须用 CRLF，否则 cmd 会解析错乱 */
  return lines.join('\r\n') + '\r\n';
}

function readmeText(info) {
  const lines = [
    '取名系统 · 五行八字',
    '='.repeat(40),
    '',
    '怎么用：',
    '  双击「' + SINGLE_NAME + '」即可（或双击 启动.bat）。',
    '  纯前端实现，不需要安装 Python / Node / 任何运行环境。',
    '  换电脑：把整个文件夹拷过去就行；只拷 ' + SINGLE_NAME + ' 一个文件也能用。',
    '',
    '联网更新词库：',
    '  打开后点顶部「词库管理」，勾选数据源再点「开始联网更新」。',
    '  数据会缓存在浏览器本地，更新一次之后离线也能用。',
    '  联网需要能访问 raw.githubusercontent.com 或 cdn.jsdelivr.net。',
    '',
    '打包信息：',
    '  构建时间：' + new Date().toLocaleString('zh-CN'),
    '  内置用字：' + info.chars + ' 字',
    '  内置诗篇：' + info.builtinPoems + ' 首'
  ];
  if (info.baked) {
    lines.push('');
    lines.push('已固化联网数据（来自 ' + info.baked.file + '）：');
    lines.push('  拼音表 ' + info.baked.pinyin + ' 字');
    lines.push('  字典 ' + info.baked.dict + ' 字' +
      (info.baked.droppedDict ? '（打包时已剔除）' : ''));
    lines.push('  诗篇 ' + info.baked.poems + ' 首');
    lines.push('  自建字 ' + info.baked.customChars + ' 个');
    lines.push('  拿到手就是「词库已扩充」状态，无需重新下载。');
  } else {
    lines.push('');
    lines.push('未固化联网数据（未找到导出文件）。');
    lines.push('  想固化：先在浏览器「词库管理」里点「导出数据文件」，');
    lines.push('  把 json 放到 tools/ 目录下，再重新运行打包脚本。');
  }
  if (info.withSrc) {
    lines.push('');
    lines.push('自定义字库：',
      '  src/js/data/chars.js 里按「字|拼音|声调|五行|性别|风格|寓意|康熙笔画」',
      '  的格式追加即可，解析规则与内置一致。');
  }
  lines.push('');
  lines.push('说明：康熙笔画与姓名学五行没有权威公开数据源，');
  lines.push('      联网加入的字按部首推断，界面会标注「推断」，请人工核对。');
  lines.push('');
  return lines.join('\r\n') + '\r\n';
}

/* ---------------- 主流程 ---------------- */

(function main() {
  console.log('打包取名系统');
  console.log('='.repeat(60));

  const htmlPath = path.join(WEB, 'index.html');
  if (!fs.existsSync(htmlPath)) {
    console.error('✗ 找不到 web/index.html');
    process.exit(1);
  }

  /* 先加载数据文件，取得统计信息 */
  require(path.join(WEB, 'js', 'data', 'chars.js'));
  require(path.join(WEB, 'js', 'data', 'poetry.js'));
  const NS = globalThis.NS;
  const info = {
    chars: Object.keys(NS.CHAR_DB).length,
    builtinPoems: NS.RAW_POEMS.length
  };

  /* 固化数据 */
  let baked = null;
  try {
    const bakeFile = findBakeFile();
    baked = prepareBaked(bakeFile);
  } catch (e) {
    console.error('✗ 固化数据失败：' + e.message);
    process.exit(1);
  }
  info.baked = baked;

  if (baked) {
    console.log(`固化数据：${baked.file}`);
    console.log(`  拼音表 ${baked.pinyin} 字 · 字典 ${baked.dict} 字` +
      (baked.droppedDict ? `（已按要求剔除 ${baked.droppedDict} 条）` : '') +
      ` · 诗篇 ${baked.poems} 首 · 自建字 ${baked.customChars} 个`);
    console.log(`  内联体积约 ${fmtSize(baked.bytes)}`);
  } else {
    console.log('固化数据：未找到导出文件，将打包为纯内置字库版本');
    console.log('  （想要固化：先在「词库管理」导出数据文件到 tools/ 再打包）');
  }

  mkdirp(DIST);

  /* ---- 1. 单文件版 ---- */
  const html = readFile(htmlPath);
  const single = inlineHtml(html, baked ? baked.js : null);
  const singlePath = path.join(DIST, SINGLE_NAME);
  fs.writeFileSync(singlePath, single, 'utf8');
  console.log('\n✓ 单文件版  dist/' + SINGLE_NAME +
    '  ' + fmtSize(Buffer.byteLength(single, 'utf8')));

  /* ---- 2. 文件夹版 ---- */
  const folder = path.join(DIST, FOLDER_NAME);
  fs.rmSync(folder, { recursive: true, force: true });
  mkdirp(folder);

  const srcDir = path.join(folder, 'src');
  walk(WEB).forEach(rel => {
    const dest = path.join(srcDir, rel);
    mkdirp(path.dirname(dest));
    fs.copyFileSync(path.join(WEB, rel), dest);
  });

  /* 文件夹版保留源码结构，把固化数据写成单独的 js 文件并挂进 html */
  let srcHtml = readFile(path.join(srcDir, 'index.html'));
  if (baked) {
    fs.writeFileSync(path.join(srcDir, 'js', 'data', 'baked.js'),
      baked.js, 'utf8');
    srcHtml = srcHtml.replace('<body>',
      '<body>\n<!-- 固化词库数据（打包时写入） -->\n' +
      '<script src="js/data/baked.js"></script>');
  }
  fs.writeFileSync(path.join(folder, SINGLE_NAME), srcHtml, 'utf8');
  fs.writeFileSync(path.join(folder, '启动.bat'),
    launcherBat(SINGLE_NAME, true), 'utf8');
  fs.writeFileSync(path.join(folder, '说明.txt'),
    readmeText(Object.assign({}, info, { withSrc: true })), 'utf8');

  const folderFiles = walk(folder);
  const folderBytes = folderFiles.reduce((a, f) =>
    a + fs.statSync(path.join(folder, f)).size, 0);
  console.log('✓ 文件夹版  dist/' + FOLDER_NAME + '/  ' +
    folderFiles.length + ' 个文件，' + fmtSize(folderBytes));

  /* ---- 3. 压缩包 ---- */
  if (!flag('no-zip')) {
    const zipPath = path.join(DIST, ZIP_NAME);
    try {
      fs.rmSync(zipPath, { force: true });
      execFileSync('powershell', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
        'Compress-Archive -Path "' + folder + '\\*" -DestinationPath "' +
        zipPath + '" -Force'
      ], { stdio: 'pipe' });
      console.log('✓ 压缩包    dist/' + ZIP_NAME + '  ' +
        fmtSize(fs.statSync(zipPath).size));
    } catch (e) {
      console.log('△ 压缩包生成失败（可忽略，手动压缩 ' + FOLDER_NAME +
        ' 即可）：' + (e.message || '').split('\n')[0]);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('打包完成。移植步骤：');
  console.log('  1. 把 dist/' + SINGLE_NAME + ' 或整个 dist/' + FOLDER_NAME);
  console.log('     拷到目标电脑（U 盘 / 网盘均可）');
  console.log('  2. 双击打开即可用，无需安装任何环境');
  if (!baked) {
    console.log('  3. 需要更多字词时，在目标电脑上点「词库管理」联网更新');
  }
})();
