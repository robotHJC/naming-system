/* =========================================================================
 * sync-pages.js —— 把单文件版同步到 docs/，用于 GitHub Pages 部署
 *
 * 为什么部署单文件版而不是完整版文件夹：
 *   1. 只有一个请求，没有相对路径问题（目录名是中文，避免任何编码意外）
 *   2. 部署只需要覆盖一个文件，不会出现「改了源码忘了同步某个 js」的情况
 *   3. 页面在 HTTP 源下运行，IndexedDB 与 CORS 都是正常行为，
 *      联网扩充词库比 file:// 更可靠
 *
 * 用法：node tools/sync-pages.js
 *      （打包.bat 之后运行；或 node tools/build-dist.js && node tools/sync-pages.js）
 * ========================================================================= */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'dist', '取名系统.html');
const OUT_DIR = path.join(ROOT, 'docs');
const OUT = path.join(OUT_DIR, 'index.html');

if (!fs.existsSync(SRC)) {
  console.error('找不到 ' + path.relative(ROOT, SRC));
  console.error('请先运行打包：cmd /c "打包.bat < NUL"');
  process.exit(1);
}

const html = fs.readFileSync(SRC);

/* 自检：单文件版必须没有任何外部引用，否则部署上去会 404 */
const external = html.toString('utf8').match(/<(script|link)[^>]+(src|href)\s*=\s*["'](?!#)[^"']+["']/gi) || [];
if (external.length) {
  console.error('单文件版里仍有 ' + external.length + ' 处外部引用，部署后会 404：');
  external.slice(0, 5).forEach(e => console.error('  ' + e));
  process.exit(1);
}

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, html);

/* .nojekyll：让 GitHub Pages 跳过 Jekyll 处理。
 * 不跳过的话 Pages 会跑一遍 Jekyll 构建，既慢又可能因为特殊字符失败。 */
fs.writeFileSync(path.join(OUT_DIR, '.nojekyll'), '');

console.log('✓ docs/index.html  ' + (html.length / 1024).toFixed(1) + ' KB（零外部引用）');
console.log('✓ docs/.nojekyll');
console.log('');
console.log('接下来：');
console.log('  git add docs && git commit -m "更新部署产物" && git push');
