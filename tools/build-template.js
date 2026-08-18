/* 从根目录「驻站记录表【日期】.xlsx」生成内置模板 js/template-data.js
   用法：node tools/build-template.js
   输出：js/template-data.js（不压缩 ZIP 的 base64，供导出时逐字节复用模板其余部分） */
'use strict';

var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var ROOT = path.resolve(__dirname, '..');
var SRC = path.join(ROOT, '驻站记录表【日期】.xlsx');
var OUT = path.join(ROOT, 'js', 'template-data.js');

// ---------- CRC32 ----------
var CRC_TABLE = (function () {
  var t = new Uint32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  var c = 0xFFFFFFFF;
  for (var i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ---------- 读取 ZIP ----------
function parseZip(buf) {
  var eocd = -1;
  for (var i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP 文件');
  var count = buf.readUInt16LE(eocd + 10);
  var cdOffset = buf.readUInt32LE(eocd + 16);
  var pos = cdOffset;
  var entries = [];
  for (var n = 0; n < count; n++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) throw new Error('ZIP 中央目录损坏');
    var method = buf.readUInt16LE(pos + 10);
    var compSize = buf.readUInt32LE(pos + 20);
    var nameLen = buf.readUInt16LE(pos + 28);
    var extraLen = buf.readUInt16LE(pos + 30);
    var commentLen = buf.readUInt16LE(pos + 32);
    var localOffset = buf.readUInt32LE(pos + 42);
    var name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
    var lNameLen = buf.readUInt16LE(localOffset + 26);
    var lExtraLen = buf.readUInt16LE(localOffset + 28);
    var dataStart = localOffset + 30 + lNameLen + lExtraLen;
    var data = buf.subarray(dataStart, dataStart + compSize);
    if (method === 8) {
      data = zlib.inflateRawSync(data);
    } else if (method !== 0) {
      throw new Error('不支持的压缩方式：' + name + ' method=' + method);
    }
    entries.push({ name: name, data: data });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// ---------- 结构校验 ----------
function validate(entries) {
  var sheet = null;
  var sst = null;
  entries.forEach(function (e) {
    if (e.name === 'xl/worksheets/sheet1.xml') sheet = e;
    if (e.name === 'xl/sharedStrings.xml') sst = e;
  });
  if (!sheet || !sst) throw new Error('模板缺少 xl/worksheets/sheet1.xml 或 xl/sharedStrings.xml');

  var sheetXml = sheet.data.toString('utf8');
  var sstXml = sst.data.toString('utf8');
  [
    '驻站站名:', '驻站人:', '日期',
    '序号', '线路', '车号', '过站时间', '上客人数',
    '进出站规范', '售票员招呼', '检查情况', '整改措施', '备注'
  ].forEach(function (s) {
    if (sstXml.indexOf(s) === -1) throw new Error('模板缺少文本「' + s + '」，请确认使用的是《驻站记录表【日期】》');
  });
  ['A2', 'E2', 'J2', 'B5', 'J34'].forEach(function (ref) {
    if (sheetXml.indexOf('<c r="' + ref + '"') === -1) {
      throw new Error('模板缺少单元格 ' + ref + '，请确认使用的是《驻站记录表【日期】》');
    }
  });
  return entries;
}

// ---------- 重打包为不压缩 ZIP ----------
function buildStoredZip(entries) {
  var now = new Date();
  var dosTime = ((now.getHours() & 0x1F) << 11) |
    ((now.getMinutes() & 0x3F) << 5) |
    ((now.getSeconds() >> 1) & 0x1F);
  var dosDate = (((now.getFullYear() - 1980) & 0x7F) << 9) |
    (((now.getMonth() + 1) & 0xF) << 5) |
    (now.getDate() & 0x1F);

  var chunks = [];
  var central = [];
  var offset = 0;
  entries.forEach(function (e) {
    var nameBuf = Buffer.from(e.name, 'utf8');
    var data = e.data;
    var crc = crc32(data);

    var lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(0, 8); // 存储
    lh.writeUInt16LE(dosTime, 10);
    lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    chunks.push(Buffer.concat([lh, nameBuf, data]));

    var ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(dosTime, 12);
    ch.writeUInt16LE(dosDate, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([ch, nameBuf]));
    offset += 30 + nameBuf.length + data.length;
  });

  var cdSize = central.reduce(function (s, b) { return s + b.length; }, 0);
  var eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat(chunks.concat(central).concat([eocd]));
}

// ---------- 主流程 ----------
var src = fs.readFileSync(SRC);
var entries = validate(parseZip(src));
var stored = buildStoredZip(entries);
var b64 = stored.toString('base64');

var js = '/* 内置模板：由 tools/build-template.js 从「驻站记录表【日期】.xlsx」自动生成，请勿手改。\n' +
  '   如更换模板，请重新运行 node tools/build-template.js。 */\n' +
  '(function (global) {\n' +
  "  'use strict';\n" +
  '  global.StationTemplate = { base64: ' + JSON.stringify(b64) + ' };\n' +
  "})(typeof window !== 'undefined' ? window : globalThis);\n";

fs.writeFileSync(OUT, js, 'utf8');
console.log('已生成 ' + path.relative(ROOT, OUT) + '（' + stored.length + ' 字节，base64 ' + b64.length + ' 字符）');
