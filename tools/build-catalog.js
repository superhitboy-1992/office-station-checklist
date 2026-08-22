/* 从 database/*.xlsx 与《车队线路信息.xlsx》重新生成 js/catalog-data.js（内置初始资料库）
   用法：node tools/build-catalog.js
   依赖：项目内 vendor 的 SheetJS 与 js/xlsx-import.js（同一套解析逻辑） */
'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('../js/vendor/xlsx.full.min.js');
require('../js/xlsx-import.js');

const Import = globalThis.StationImport;

function readRows(file) {
  const wb = XLSX.read(fs.readFileSync(file), { type: 'buffer' });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
}

// 线路名历史替换：老名单里的旧名称统一改为《车队线路信息.xlsx》里的新名称
const RENAME_MAP = { 'DZ乐张线': '乐张专线', '廊下3路A': '廊下3路', '廊下3路B': '廊下3路' };

// 《车队线路信息.xlsx》：第一行为车队名，每列向下为该车队线路
function readFleets(file) {
  const rows = readRows(file);
  const fleets = [];
  if (!rows.length) return fleets;
  rows[0].forEach((cell, ci) => {
    const name = String(cell || '').trim();
    if (!name) return;
    const routes = [];
    for (let ri = 1; ri < rows.length; ri++) {
      const v = String(rows[ri][ci] || '').trim();
      if (v && routes.indexOf(v) < 0) routes.push(v);
    }
    fleets.push({ name, routes });
  });
  return fleets;
}

// 合并线路名单：应用改名映射、去重，保持出现顺序
function mergeRoutes(...lists) {
  const seen = {};
  const out = [];
  lists.forEach(list => {
    (list || []).forEach(r => {
      const v = RENAME_MAP[r] || r;
      if (v && !seen[v]) { seen[v] = 1; out.push(v); }
    });
  });
  return out;
}

const stationFile = path.join(__dirname, '..', 'database', '各线路站点.xlsx');
const checkerFile = path.join(__dirname, '..', 'database', '驻站人姓名.xlsx');
const fleetFile = path.join(__dirname, '..', '车队线路信息.xlsx');

const fromStations = Import.parseFile(readRows(stationFile));
const fromCheckers = Import.parseFile(readRows(checkerFile));
const fleetSeed = fs.existsSync(fleetFile) ? readFleets(fleetFile) : [];
const fleetRoutes = [];
fleetSeed.forEach(f => fleetRoutes.push(...f.routes));

const seed = {
  stations: fromStations.stations,
  routes: mergeRoutes(fromStations.routes, fleetRoutes),
  checkers: fromCheckers.checkers,
  fleets: fleetSeed
};

if (!seed.stations.length || !seed.routes.length || !seed.checkers.length) {
  console.error('生成失败：解析结果为空', {
    stations: seed.stations.length,
    routes: seed.routes.length,
    checkers: seed.checkers.length
  });
  process.exit(1);
}

const json = JSON.stringify(seed, null, 0)
  .replace(/</g, '\\u003c')
  .replace(/>/g, '\\u003e');

const out = [
  '/* 内置初始资料库：由 database/*.xlsx 与《车队线路信息.xlsx》生成，请勿手改；',
  '   更新 Excel 后运行 node tools/build-catalog.js 重新生成 */',
  '(function (global) {',
  "  'use strict';",
  '  global.CatalogSeed = ' + json + ';',
  "})(typeof window !== 'undefined' ? window : globalThis);",
  ''
].join('\n');

const outFile = path.join(__dirname, '..', 'js', 'catalog-data.js');
fs.writeFileSync(outFile, out, 'utf8');
console.log('已生成 js/catalog-data.js：站点', seed.stations.length, '线路', seed.routes.length, '驻站人', seed.checkers.length);
