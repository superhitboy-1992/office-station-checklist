/* Excel 导入解析：懒加载 SheetJS，按表头自动识别 站点/线路/驻站人 */
(function (global) {
  'use strict';

  var _xLoading = false;
  var _xQueue = [];

  function getXLSX() {
    return global.XLSX || null;
  }

  // 首次导入前懒加载 SheetJS（仅浏览器环境）
  function ensureSheetJS(cb) {
    if (getXLSX()) { if (cb) cb(); return; }
    if (!global.document) { if (cb) cb(); return; }
    if (_xLoading) { if (cb) _xQueue.push(cb); return; }
    _xLoading = true;
    var s = global.document.createElement('script');
    s.src = 'js/vendor/xlsx.full.min.js';
    s.onload = function () {
      _xLoading = false;
      var q = _xQueue;
      _xQueue = [];
      if (cb) cb();
      q.forEach(function (f) { f(); });
    };
    s.onerror = function () {
      _xLoading = false;
      var q = _xQueue;
      _xQueue = [];
      if (cb) cb();
      q.forEach(function (f) { f(); });
    };
    global.document.head.appendChild(s);
  }

  // 站点名规范化：去开头 *、统一全角括号、去掉空白
  function normalizeStation(s) {
    return String(s === null || s === undefined ? '' : s)
      .trim()
      .replace(/^\*+/, '')
      .replace(/\(/g, '（')
      .replace(/\)/g, '）')
      .replace(/\s+/g, '');
  }

  function normalizeSimple(s) {
    return String(s === null || s === undefined ? '' : s).trim();
  }

  var STATION_HEAD = /站名|站点|车站|驻站站名|线路站点|全部/;
  var CHECKER_HEAD = /驻站人|检查人|人员|姓名/;
  var ROUTE_HEAD = /线路|路线|线名|公交线路/;
  var ANY_HEAD = /站名|站点|车站|驻站站名|线路站点|全部|驻站人|检查人|人员|姓名|线路|路线|线名|公交线路/;

  // rows: 二维数组（字符串），来自 sheet_to_json(ws, {header:1, raw:false, defval:''})
  function parseFile(rows) {
    var grid = [];
    (rows || []).forEach(function (r) {
      var row = [];
      (r || []).forEach(function (v) {
        row.push(String(v === null || v === undefined ? '' : v).trim());
      });
      grid.push(row);
    });

    var headerIdx = -1;
    for (var i = 0; i < Math.min(grid.length, 5); i++) {
      var hit = grid[i].some(function (cell) {
        return cell && (STATION_HEAD.test(cell) || CHECKER_HEAD.test(cell) || ROUTE_HEAD.test(cell));
      });
      if (hit) { headerIdx = i; break; }
    }

    var checkers = [];
    var checkerCol = -1;
    if (headerIdx >= 0) {
      for (var cc = 0; cc < grid[headerIdx].length; cc++) {
        if (CHECKER_HEAD.test(grid[headerIdx][cc])) { checkerCol = cc; break; }
      }
    }
    if (checkerCol >= 0) {
      var seenChecker = {};
      for (var rc = headerIdx + 1; rc < grid.length; rc++) {
        var vc = normalizeSimple(grid[rc][checkerCol]);
        if (vc && !seenChecker[vc]) {
          seenChecker[vc] = 1;
          checkers.push(vc);
        }
      }
    } else {
      // 兜底：只有一列有数据时按整列导入
      var nonEmptyCols = [];
      for (var ci = 0; ci < (grid[0] ? grid[0].length : 0); ci++) {
        var n = 0;
        for (var rn = dataStart; rn < grid.length; rn++) {
          if (normalizeSimple(grid[rn][ci])) n++;
        }
        if (n > 0) nonEmptyCols.push(ci);
      }
      if (nonEmptyCols.length === 1) {
        var seenC = {};
        for (var rw = dataStart; rw < grid.length; rw++) {
          var vw = normalizeSimple(grid[rw][nonEmptyCols[0]]);
          if (vw && !seenC[vw]) {
            seenC[vw] = 1;
            checkers.push(vw);
          }
        }
      }
    }

    // 跳过列：驻站人列、以及“全部”汇总列（内容与各线路列重复）
    var skipCols = {};
    if (checkerCol >= 0) skipCols[checkerCol] = 1;
    if (headerIdx >= 0) {
      grid[headerIdx].forEach(function (cell, c) {
        if (normalizeSimple(cell) === '全部') skipCols[c] = 1;
      });
    }

    var stations = [];
    var seenStation = {};
    var dataStart = headerIdx >= 0 ? headerIdx + 1 : 0;
    for (var r = dataStart; r < grid.length; r++) {
      for (var c = 0; c < grid[r].length; c++) {
        if (skipCols[c]) continue;
        var v = normalizeStation(grid[r][c]);
        if (v && !seenStation[v]) {
          seenStation[v] = 1;
          stations.push(v);
        }
      }
    }

    var routes = [];
    var seenRoute = {};
    if (headerIdx >= 0) {
      grid[headerIdx].forEach(function (cell) {
        var v = normalizeSimple(cell);
        if (v && !ANY_HEAD.test(v) && !seenRoute[v]) {
          seenRoute[v] = 1;
          routes.push(v);
        }
      });
    }
    var hasAnyHeader = headerIdx >= 0 && grid[headerIdx].some(function (cell) {
      return cell && ANY_HEAD.test(cell);
    });
    if (!routes.length && !hasAnyHeader) {
      // 兜底：无表头时取第一列数据
      for (var rr = dataStart; rr < grid.length; rr++) {
        var vv = normalizeSimple(grid[rr][0]);
        if (vv && !seenRoute[vv]) {
          seenRoute[vv] = 1;
          routes.push(vv);
        }
      }
    }

    return { stations: stations, routes: routes, checkers: checkers };
  }

  // 合并统计：existing 为数组，incoming 为数组
  function mergeStats(existing, incoming) {
    var set = {};
    (existing || []).forEach(function (v) { set[v] = 1; });
    var added = [];
    var dup = 0;
    (incoming || []).forEach(function (v) {
      if (set[v]) dup++;
      else { set[v] = 1; added.push(v); }
    });
    return { total: (incoming || []).length, added: added, duplicate: dup };
  }

  global.StationImport = {
    ensureSheetJS: ensureSheetJS,
    normalizeStation: normalizeStation,
    parseFile: parseFile,
    mergeStats: mergeStats
  };
})(typeof window !== 'undefined' ? window : globalThis);
