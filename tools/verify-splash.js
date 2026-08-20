/* 启动页全屏 GIF 集成验证：双视口截图 + 隐藏时机 + 控制台错误。
用法：NODE_PATH=<runtime node_modules> node tools/verify-splash.js
运行前先把 runtime node 的 node_modules 挂到 NODE_PATH（含 playwright）。 */
'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const outDir = process.env.VIS_OUT || process.env.TEMP;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(root, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(root)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

async function shot(page, name) {
  await page.screenshot({ path: path.join(outDir, name) });
  console.log('saved', name);
}

async function checkSplash(page, viewportName) {
  const info = await page.evaluate(() => {
    const splash = document.getElementById('splash');
    const img = document.querySelector('.splash-img');
    const cs = getComputedStyle(splash);
    const title = document.querySelector('.splash-title');
    return {
      hidden: splash.classList.contains('hide'),
      opacity: cs.opacity,
      visibility: cs.visibility,
      imgSrc: img ? img.getAttribute('src') : null,
      imgRect: img ? img.getBoundingClientRect().toJSON() : null,
      imgLoaded: img ? img.complete && img.naturalWidth > 0 : false,
      titleVisible: title ? title.getBoundingClientRect().toJSON() : null,
    };
  });
  console.log(viewportName, JSON.stringify(info));
}

(async () => {
  const serverReady = new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  await serverReady;
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/index.html`;
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const errors = [];

  for (const [name, viewport] of [
    ['desktop', { width: 1280, height: 800 }],
    ['mobile', { width: 390, height: 844 }],
  ]) {
    const page = await browser.newPage({ viewport });
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(800);
    await shot(page, `splash-${name}-early.png`);
    await page.waitForTimeout(700);
    await checkSplash(page, name);
    await shot(page, `splash-${name}.png`);
    await page.waitForTimeout(2200); // 累计约 3.7s，应已隐藏
    await checkSplash(page, `${name}-later`);
    await page.close();

    const earlyHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(outDir, `splash-${name}-early.png`))).digest('hex');
    const midHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(outDir, `splash-${name}.png`))).digest('hex');
    console.log(name, 'animation advanced:', earlyHash !== midHash);
  }

  await browser.close();
  server.close();
  if (errors.length) {
    console.log('ERRORS:');
    errors.forEach((e) => console.log(' -', e));
    process.exitCode = 1;
  } else {
    console.log('no console/page errors');
  }
})();
