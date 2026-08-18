/* 从 database/*.xlsx 重新生成 js/catalog-data.js（内置初始资料库）
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

const stationFile = path.join(__dirname, '..', 'database', '各线路站点.xlsx');
const checkerFile = path.join(__dirname, '..', 'database', '驻站人姓名.xlsx');

const fromStations = Import.parseFile(readRows(stationFile));
const fromCheckers = Import.parseFile(readRows(checkerFile));

const seed = {
  stations: fromStations.stations,
  routes: fromStations.routes,
  checkers: fromCheckers.checkers
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
  '/* 内置初始资料库：由 database/*.xlsx 生成，请勿手改；',
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
