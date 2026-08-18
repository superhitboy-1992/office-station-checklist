/* 驻站检查登记系统 Service Worker
   版本化缓存：发布新版时修改 CACHE_NAME 或直接覆盖本文件（文件内容变化即触发更新）。
   策略：导航请求网络优先（离线回退缓存页面），静态资源缓存优先 + 后台更新。 */
'use strict';

var CACHE_NAME = 'zzjc-cache-v6';
var APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/core.js',
  './js/catalog-data.js',
  './js/search.js',
  './js/xlsx-import.js',
  './js/template-data.js',
  './js/xlsx-writer.js',
  './js/app.js',
  './js/vendor/xlsx.full.min.js',
  './js/vendor/pinyin-pro.min.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(APP_SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(
          keys.filter(function (k) { return k !== CACHE_NAME; })
              .map(function (k) { return caches.delete(k); })
        );
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(function (res) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put('./index.html', copy);
          });
          return res;
        })
        .catch(function () { return caches.match('./index.html'); })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(function (cached) {
      var network = fetch(req)
        .then(function (res) {
          if (res && res.status === 200) {
            var copy = res.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(req, copy);
            });
          }
          return res;
        })
        .catch(function () { return cached; });
      return cached || network;
    })
  );
});
