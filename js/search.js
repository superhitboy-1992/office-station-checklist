/* 模糊搜索：汉字子串 + 拼音首字母/全拼（pinyin-pro 懒加载，离线可用） */
(function (global) {
  'use strict';

  var _pyLoading = false;
  var _pyQueue = [];

  function getPinyinPro() {
    return global.pinyinPro || null;
  }

  // 首次使用前懒加载 pinyin-pro（仅浏览器环境）
  function ensurePinyin(cb) {
    if (getPinyinPro()) { if (cb) cb(); return; }
    if (!global.document) { if (cb) cb(); return; }
    if (_pyLoading) { if (cb) _pyQueue.push(cb); return; }
    _pyLoading = true;
    var s = global.document.createElement('script');
    s.src = 'js/vendor/pinyin-pro.min.js';
    s.onload = function () {
      _pyLoading = false;
      var q = _pyQueue;
      _pyQueue = [];
      if (cb) cb();
      q.forEach(function (f) { f(); });
    };
    s.onerror = function () {
      _pyLoading = false;
      var q = _pyQueue;
      _pyQueue = [];
      if (cb) cb();
      q.forEach(function (f) { f(); });
    };
    global.document.head.appendChild(s);
  }

  function normQuery(s) {
    return String(s === null || s === undefined ? '' : s).toLowerCase().trim();
  }

  // 匹配键：统一括号、去掉空白、转小写（不改变展示名称）
  function keyOf(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/（/g, '(')
      .replace(/）/g, ')')
      .replace(/\s+/g, '')
      .toLowerCase();
  }

  var _pyCache = {};

  function pinyinInfo(name) {
    var py = getPinyinPro();
    if (!py || !name) return null;
    if (_pyCache[name]) return _pyCache[name];
    var arr;
    try {
      arr = py.pinyin(name, { toneType: 'none', type: 'array', nonZh: 'consecutive', v: false });
    } catch (e) {
      arr = [];
    }
    var full = arr.join('');
    var initial = arr.map(function (p) { return p.charAt(0); }).join('');
    var info = { initial: initial, full: full };
    _pyCache[name] = info;
    return info;
  }

  // 返回 [{ value, score }]，优先级：精确 > 前缀 > 子串 > 拼音首字母 > 全拼
  function search(list, query, max) {
    var q = normQuery(query);
    var results = [];
    if (!q) {
      (list || []).forEach(function (v, i) {
        results.push({ value: v, score: 0, order: i });
      });
    } else {
      var qKey = keyOf(q);
      var asciiQuery = /^[a-z0-9]+$/.test(q);
      (list || []).forEach(function (v, i) {
        var k = keyOf(v);
        var score = -1;
        if (k === qKey) score = 0;
        else if (k.indexOf(qKey) === 0) score = 1;
        else if (k.indexOf(qKey) > 0) score = 2;
        else if (asciiQuery) {
          var info = pinyinInfo(v);
          if (info) {
            if (info.initial.indexOf(q) === 0) score = 3;
            else if (info.initial.indexOf(q) > 0) score = 4;
            else if (info.full.indexOf(q) >= 0) score = 5;
          }
        }
        if (score >= 0) results.push({ value: v, score: score, order: i });
      });
    }
    results.sort(function (a, b) {
      if (a.score !== b.score) return a.score - b.score;
      if (a.value.length !== b.value.length) return a.value.length - b.value.length;
      return a.order - b.order;
    });
    if (max > 0 && results.length > max) results = results.slice(0, max);
    return results;
  }

  global.Search = {
    search: search,
    ensurePinyin: ensurePinyin,
    keyOf: keyOf,
    pinyinInfo: pinyinInfo
  };
})(typeof window !== 'undefined' ? window : globalThis);
