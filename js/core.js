/* 纯逻辑工具：格式化、分组、生成导出行数据（与 DOM 无关，便于测试） */
(function (global) {
  'use strict';

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function nowTime() {
    var d = new Date();
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  // "2026-08-16" -> "8月16日"
  function dateLabel(dateStr) {
    if (!dateStr) return '';
    var p = String(dateStr).split('-');
    if (p.length !== 3) return String(dateStr);
    return Number(p[1]) + '月' + Number(p[2]) + '日';
  }

  // "2026-08-16" -> "8.16"（文件名用，月份/日期不补零）
  function dateDot(dateStr) {
    if (!dateStr) return '';
    var p = String(dateStr).split('-');
    if (p.length !== 3) return String(dateStr);
    return Number(p[1]) + '.' + Number(p[2]);
  }

  function normalize(s) {
    return String(s === null || s === undefined ? '' : s).trim();
  }

  // 文件名安全化（去掉 Windows 不允许的字符）
  function safeName(s) {
    return normalize(s).replace(/[\\/:*?"<>|]/g, '_');
  }

  // 按 日期+站点 分组，组内按时间排序
  function groupRecords(records) {
    var map = new Map();
    (records || []).forEach(function (r) {
      var key = r.date + '|' + normalize(r.station);
      if (!map.has(key)) {
        map.set(key, { date: r.date, station: normalize(r.station), records: [] });
      }
      map.get(key).records.push(r);
    });
    var groups = Array.from(map.values());
    groups.forEach(function (g) {
      g.records.sort(function (a, b) {
        return normalize(a.time).localeCompare(normalize(b.time));
      });
      g.count = g.records.length;
      g.dateLabel = dateLabel(g.date);
      g.checker = g.records[0] ? normalize(g.records[0].checker) : '';
    });
    groups.sort(function (a, b) {
      return (b.date || '').localeCompare(a.date || '');
    });
    return groups;
  }

  // 将一组记录转为模板 30 行需要的行数据
  function toRecordRows(records) {
    var rows = [];
    for (var i = 0; i < 30; i++) {
      var r = records[i];
      rows.push(r ? {
        route: normalize(r.route),
        plate: normalize(r.plate),
        time: normalize(r.time),
        boarding: (r.boarding === '' || r.boarding === null || r.boarding === undefined) ? '' : Number(r.boarding),
        stationNorms: normalize(r.stationNorms),
        conductorCall: normalize(r.conductorCall),
        checkResult: normalize(r.checkResult),
        rectification: normalize(r.rectification),
        remark: normalize(r.remark)
      } : null);
    }
    return rows;
  }

  function validRecord(r) {
    return !!(r && normalize(r.station) && normalize(r.checker) && normalize(r.date) &&
      normalize(r.route) && normalize(r.plate));
  }

  global.Core = {
    pad2: pad2,
    todayStr: todayStr,
    nowTime: nowTime,
    dateLabel: dateLabel,
    dateDot: dateDot,
    normalize: normalize,
    safeName: safeName,
    groupRecords: groupRecords,
    toRecordRows: toRecordRows,
    validRecord: validRecord
  };
})(typeof window !== 'undefined' ? window : globalThis);
