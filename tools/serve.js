/* =========================================================================
 * serve.js —— 本地起一个静态服务，预览部署产物
 *
 * 两个用途：
 *   1. 验证「部署后的运行环境」——页面在 http 源下跑，
 *      IndexedDB 与 CORS 都是正常行为，和 file:// 打开不是一回事。
 *   2. 手机实测——绑定 0.0.0.0 并打印局域网地址，
 *      手机连同一个 Wi-Fi 就能打开，不用先部署到 GitHub。
 *
 * 用法：
 *   node tools/serve.js            # 默认 8080，服务 docs/
 *   node tools/serve.js 9000       # 换端口
 *   node tools/serve.js 9000 dist/取名系统-完整版/src
 *
 * 只用 Node 内置模块，不装任何依赖。
 * ========================================================================= */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = parseInt(process.argv[2], 10) || 8080;
const ROOT = path.resolve(__dirname, '..', process.argv[3] || 'docs');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

if (!fs.existsSync(ROOT)) {
  console.error('目录不存在：' + ROOT);
  console.error('请先：node tools/build-dist.js && node tools/sync-pages.js');
  process.exit(1);
}
if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  console.error('目录里没有 index.html：' + ROOT);
  process.exit(1);
}

function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  Object.keys(ifaces).forEach(name => {
    (ifaces[name] || []).forEach(a => {
      if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
    });
  });
  return out;
}

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';

  /* 防目录穿越：解析后必须仍在 ROOT 之内 */
  const full = path.resolve(ROOT, '.' + rel);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end('403');
    return;
  }

  fs.readFile(full, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 ' + rel);
      console.log('  404 ' + rel);
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'   /* 预览时不缓存，改了刷新就能看到 */
    });
    res.end(buf);
    console.log('  200 ' + rel + '  ' + (buf.length / 1024).toFixed(1) + ' KB');
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const size = fs.statSync(path.join(ROOT, 'index.html')).size;
  console.log('');
  console.log('  正在服务  ' + ROOT);
  console.log('  入口      index.html  ' + (size / 1024).toFixed(1) + ' KB');
  console.log('');
  console.log('  本机    http://localhost:' + PORT + '/');
  lanAddresses().forEach(a =>
    console.log('  手机    http://' + a.address + ':' + PORT + '/   (' + a.name + ')'));
  console.log('');
  console.log('  手机需与电脑连同一个 Wi-Fi。若打不开，多半是 Windows 防火墙');
  console.log('  拦了 Node 的入站连接，在弹窗里选「允许专用网络」即可。');
  console.log('');
  console.log('  Ctrl+C 停止');
  console.log('');
});
