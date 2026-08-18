(function () {
  'use strict';

  var Core = window.Core;
  var StationXlsx = window.StationXlsx;

  var LS_RECORDS = 'zzjc_records_v1';
  var LS_SETTINGS = 'zzjc_settings_v1';
  var LS_LAST = 'zzjc_last_v1';
  var LS_REMINDER = 'zzjc_reminder_v1';
  var LS_GUIDE = 'zzjc_guide_v1';
  var LS_INSTALL = 'zzjc_install_v1';
  var LS_CATALOG_SEEDED = 'zzjc_catalog_seeded_v1';

  var DEFAULT_SETTINGS = { stations: [], checkers: [], routes: [], plates: [] };

  var RESULT_PRESETS = ['正常', '未按规定进出站', '未打招呼', '其他问题'];
  var PICK_NAMES = { station: '站点', checker: '驻站人', route: '线路', plate: '车号' };
  var TICK_SEQ = ['', '√', '×'];
  var TICK_LABEL = { '': '留空', '√': '√ 正常', '×': '× 异常' };
  var FIELD_ORDER = ['f-station', 'f-checker', 'f-date', 'f-time', 'f-route', 'f-plate', 'f-boarding', 'f-result', 'f-rectify', 'f-remark'];

  var state = {
    records: [],
    settings: clone(DEFAULT_SETTINGS),
    editingId: null,
    tick: { norm: '', call: '' },
    last: { station: '', checker: '', date: '' },
    reminder: { lastBackupAt: 0, lastBackupCount: 0 },
    deferredPrompt: null,
    activePick: null
  };

  // ---------- 工具 ----------
  function $(id) { return document.getElementById(id); }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function unique(arr) {
    var seen = {};
    var out = [];
    arr.forEach(function (s) {
      var v = Core.normalize(s);
      if (v && !seen[v]) { seen[v] = 1; out.push(v); }
    });
    return out;
  }

  function isMobile() {
    return window.matchMedia('(max-width: 767px)').matches;
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator.standalone === true);
  }

  // ---------- 本地存储 ----------
  var memStore = {};
  var storageOk = true;

  function loadJSON(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      if (memStore[key] !== undefined) return memStore[key];
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      memStore[key] = value;
      storageOk = false;
    }
  }

  // ---------- 提示 / 弹窗 ----------
  var toastTimer = null;
  function toast(msg, isError) {
    var el = $('toast');
    el.textContent = msg;
    el.className = 'toast' + (isError ? ' error' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2600);
  }

  function askConfirm(text, onOk) {
    $('modal-text').textContent = text;
    $('modal-overlay').hidden = false;
    $('modal-ok').onclick = function () {
      $('modal-overlay').hidden = true;
      if (onOk) onOk();
    };
    $('modal-cancel').onclick = function () {
      $('modal-overlay').hidden = true;
    };
  }

  // ---------- 选项卡 ----------
  function switchTab(name) {
    closePicker();
    document.querySelectorAll('.tab-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === name);
    });
    document.querySelectorAll('.tab-panel').forEach(function (p) {
      p.classList.toggle('active', p.id === 'tab-' + name);
    });
    if (name === 'catalog') renderCatalog();
    if (name === 'list') renderList();
    if (name === 'export') renderGroups();
    if (name === 'settings') loadSettingsForm();
  }

  // ---------- √/× 两态按钮（留空 → √ → × → 留空） ----------
  function setTick(key, v) {
    state.tick[key] = v;
    var btn = $('tick-' + key);
    btn.textContent = TICK_LABEL[v] || '留空';
    btn.classList.toggle('ok', v === '√');
    btn.classList.toggle('bad', v === '×');
  }

  function initTicks() {
    ['norm', 'call'].forEach(function (key) {
      var btn = $('tick-' + key);
      btn.addEventListener('click', function () {
        var cur = state.tick[key];
        var next = TICK_SEQ[(TICK_SEQ.indexOf(cur) + 1) % TICK_SEQ.length];
        setTick(key, next);
      });
    });
  }

  // ---------- 上客人数步进 ----------
  function initStepper() {
    function bump(delta) {
      var el = $('f-boarding');
      var v = parseInt(el.value, 10);
      if (isNaN(v)) v = 0;
      v = Math.max(0, v + delta);
      el.value = String(v);
    }
    $('board-minus').addEventListener('click', function () { bump(-1); });
    $('board-plus').addEventListener('click', function () { bump(1); });
  }

  // ---------- 检查情况快捷短语 ----------
  function syncResultChips(v) {
    var box = $('chips-result');
    box.querySelectorAll('.chip').forEach(function (c) {
      c.classList.toggle('active', c.dataset.v === v);
    });
  }

  function initChips() {
    var box = $('chips-result');
    box.addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;
      box.querySelectorAll('.chip').forEach(function (c) {
        c.classList.toggle('active', c === chip);
      });
      $('f-result').value = chip.dataset.v;
    });
  }

  // ---------- 快捷选择弹层（站点/驻站人/线路/车号） ----------
  function pickSettingsKey(key) { return key + 's'; }

  function openPicker(key) {
    state.activePick = key;
    $('picker-title').textContent = '选择' + PICK_NAMES[key];
    $('picker-search').value = $('f-' + key).value || '';
    renderPickerList();
    Search.ensurePinyin(function () {
      if (state.activePick === key) renderPickerList();
    });
    $('picker-overlay').hidden = false;
    $('picker-search').focus();
  }

  function closePicker() {
    $('picker-overlay').hidden = true;
    state.activePick = null;
  }

  function renderPickerList() {
    if (!state.activePick) return;
    var arr = state.settings[pickSettingsKey(state.activePick)] || [];
    var out = Search.search(arr, $('picker-search').value, 50).map(function (m) {
      return m.value;
    });

    var box = $('picker-list');
    box.innerHTML = '';
    if (!out.length) {
      var tip = document.createElement('div');
      tip.className = 'picker-empty';
      tip.textContent = '没有匹配项，可直接在上方输入后点「使用输入内容」';
      box.appendChild(tip);
      return;
    }
    out.forEach(function (v) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'picker-item';
      b.textContent = v;
      b.addEventListener('click', function () { applyPick(v); });
      box.appendChild(b);
    });
  }

  // ---------- 桌面端输入联想（登记/筛选字段） ----------
  function initInlineSuggest() {
    var specs = [
      { input: 'f-station', list: function () { return state.settings.stations; } },
      { input: 'f-checker', list: function () { return state.settings.checkers; } },
      { input: 'f-route', list: function () { return state.settings.routes; } },
      { input: 'f-plate', list: function () { return state.settings.plates; } },
      { input: 'lf-station', list: function () { return state.settings.stations; } },
      { input: 'lf-route', list: function () { return state.settings.routes; } },
      { input: 'ef-station', list: function () { return state.settings.stations; } }
    ];
    specs.forEach(function (sp) {
      var el = $(sp.input);
      if (!el) return;
      var wrap = el.closest('.pick-wrap') || el.parentElement;
      var box = document.createElement('div');
      box.className = 'suggest';
      box.hidden = true;
      wrap.appendChild(box);
      var pinyinReady = false;
      function show() {
        if (!pinyinReady) {
          pinyinReady = true;
          Search.ensurePinyin(show);
          return;
        }
        var out = Search.search(sp.list(), el.value, 8);
        box.innerHTML = '';
        if (!out.length) {
          box.hidden = true;
          return;
        }
        out.forEach(function (m) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'suggest-item';
          b.textContent = m.value;
          b.addEventListener('click', function () {
            el.value = m.value;
            box.hidden = true;
            el.focus();
          });
          box.appendChild(b);
        });
        box.hidden = false;
      }
      function hideSoon() {
        setTimeout(function () { box.hidden = true; }, 150);
      }
      el.addEventListener('focus', function () {
        // 移动端登记字段走底部选择层，这里只处理桌面端与筛选字段
        if (isMobile() && el.id.indexOf('f-') === 0) return;
        show();
      });
      el.addEventListener('input', show);
      el.addEventListener('blur', hideSoon);
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') box.hidden = true;
      });
    });
  }

  function applyPick(v) {
    var key = state.activePick;
    if (key) {
      $('f-' + key).value = v;
    }
    closePicker();
  }

  function initPicker() {
    document.querySelectorAll('[data-pick]').forEach(function (btn) {
      btn.addEventListener('click', function () { openPicker(btn.dataset.pick); });
    });
    // 移动端：点字段直接弹出快捷选择，减少一次点击
    if (isMobile()) {
      Object.keys(PICK_NAMES).forEach(function (key) {
        $('f-' + key).addEventListener('focus', function () { openPicker(key); });
      });
    }
    $('picker-search').addEventListener('input', renderPickerList);
    $('picker-search').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var v = Core.normalize($('picker-search').value);
        if (v) applyPick(v);
      }
      if (e.key === 'Escape') closePicker();
    });
    $('picker-apply').addEventListener('click', function () {
      var v = Core.normalize($('picker-search').value);
      if (v) applyPick(v);
    });
    $('picker-clear').addEventListener('click', function () {
      var key = state.activePick;
      if (key) $('f-' + key).value = '';
      closePicker();
    });
    $('picker-close').addEventListener('click', closePicker);
    $('picker-overlay').addEventListener('click', function (e) {
      if (e.target === $('picker-overlay')) closePicker();
    });
  }

  // ---------- 资料库（站点/驻站人/线路） ----------
  var _catalogPyEnsured = false;

  function catEl(k, suffix) {
    return $('cat-' + k + '-' + suffix);
  }

  function catalogLabel(k) {
    if (k === 'stations') return '站点';
    if (k === 'checkers') return '驻站人';
    return '线路';
  }

  function renderCatalog() {
    if (!_catalogPyEnsured) {
      _catalogPyEnsured = true;
      Search.ensurePinyin(renderCatalog);
    }
    ['stations', 'checkers', 'routes'].forEach(function (k) {
      var arr = state.settings[k] || [];
      catEl(k, 'count').textContent = arr.length + ' 条';
      var q = catEl(k, 'search').value || '';
      var box = catEl(k, 'list');
      box.innerHTML = '';
      if (!arr.length) {
        var empty = document.createElement('div');
        empty.className = 'catalog-empty';
        empty.textContent = '暂无数据，可点「导入 Excel」或手动添加';
        box.appendChild(empty);
        return;
      }
      var matches = Search.search(arr, q, 200);
      matches.forEach(function (m) {
        var row = document.createElement('div');
        row.className = 'catalog-item';
        var name = document.createElement('span');
        name.textContent = m.value;
        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'del';
        del.dataset.cat = k;
        del.dataset.value = m.value;
        del.textContent = '删除';
        row.appendChild(name);
        row.appendChild(del);
        box.appendChild(row);
      });
      if (arr.length > 200) {
        var more = document.createElement('div');
        more.className = 'catalog-more';
        more.textContent = '共 ' + arr.length + ' 条，仅显示前 200 条，输入关键字可缩小范围';
        box.appendChild(more);
      }
    });
  }

  function addCatalogItem(k) {
    var raw = catEl(k, 'add').value || '';
    var v = k === 'stations' ? StationImport.normalizeStation(raw) : raw.trim();
    if (!v) {
      toast('请输入' + catalogLabel(k) + '名称', true);
      return;
    }
    var arr = state.settings[k];
    if (arr.indexOf(v) >= 0) {
      toast('「' + v + '」已存在', true);
      return;
    }
    arr.unshift(v);
    persist();
    renderCatalog();
    catEl(k, 'add').value = '';
    toast('已添加');
  }

  function deleteCatalogItem(k, v) {
    askConfirm('确定从资料库删除「' + v + '」吗？已保存的记录不受影响。', function () {
      state.settings[k] = state.settings[k].filter(function (x) { return x !== v; });
      persist();
      renderCatalog();
      toast('已删除');
    });
  }

  function clearCatalog(k) {
    var label = catalogLabel(k);
    askConfirm('确定清空全部' + label + '吗？此操作不可恢复，已保存的记录不受影响。', function () {
      askConfirm('再次确认：真的要清空全部' + label + '吗？', function () {
        state.settings[k] = [];
        persist();
        renderCatalog();
        toast('已清空' + label);
      });
    });
  }

  function importCatalog(k, file) {
    StationImport.ensureSheetJS(function () {
      var XLSX = window.XLSX;
      if (!XLSX) {
        toast('Excel 解析组件加载失败，请重试', true);
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var wb = XLSX.read(reader.result, { type: 'array' });
          var ws = wb.Sheets[wb.SheetNames[0]];
          var rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
          var parsed = StationImport.parseFile(rows);
          var incoming = parsed[k];
          if (!incoming.length) {
            toast('未从文件中识别到' + catalogLabel(k) + '，请确认文件格式', true);
            return;
          }
          var stats = StationImport.mergeStats(state.settings[k], incoming);
          askConfirm(
            '从文件识别到' + catalogLabel(k) + ' ' + stats.total + ' 条，' +
            '其中新增 ' + stats.added.length + ' 条、已存在 ' + stats.duplicate + ' 条。\n确认导入？',
            function () {
              if (stats.added.length) {
                state.settings[k] = state.settings[k].concat(stats.added);
                persist();
                renderCatalog();
              }
              toast('已导入，新增 ' + stats.added.length + ' 条');
            }
          );
        } catch (e) {
          toast('文件解析失败，请确认是有效的 Excel/CSV 文件', true);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  function initCatalog() {
    var panel = $('tab-catalog');
    ['stations', 'checkers', 'routes'].forEach(function (k) {
      panel.querySelector('[data-act="add"][data-cat="' + k + '"]')
        .addEventListener('click', function () { addCatalogItem(k); });
      panel.querySelector('[data-act="import"][data-cat="' + k + '"]')
        .addEventListener('click', function () { catEl(k, 'file').click(); });
      panel.querySelector('[data-act="clear"][data-cat="' + k + '"]')
        .addEventListener('click', function () { clearCatalog(k); });
      catEl(k, 'add').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); addCatalogItem(k); }
      });
      catEl(k, 'search').addEventListener('input', renderCatalog);
      catEl(k, 'file').addEventListener('change', function () {
        if (this.files && this.files[0]) importCatalog(k, this.files[0]);
        this.value = '';
      });
    });
    panel.addEventListener('click', function (e) {
      var del = e.target.closest('.catalog-item .del');
      if (del) deleteCatalogItem(del.dataset.cat, del.dataset.value);
    });
  }

  // ---------- Enter 顺序跳转（车号 / 备注回车即保存） ----------
  function submitForm() {
    var form = $('record-form');
    if (form.requestSubmit) form.requestSubmit();
    else form.dispatchEvent(new Event('submit', { cancelable: true }));
  }

  function initEnterNav() {
    FIELD_ORDER.forEach(function (id, i) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (id === 'f-plate' || i >= FIELD_ORDER.length - 1) {
          submitForm();
        } else {
          $(FIELD_ORDER[i + 1]).focus();
        }
      });
    });
  }

  // ---------- 登记表单 ----------
  function resetForm() {
    $('f-time').value = Core.nowTime();
    $('f-route').value = '';
    $('f-plate').value = '';
    $('f-boarding').value = '';
    $('f-result').value = '';
    $('f-rectify').value = '';
    $('f-remark').value = '';
    setTick('norm', '');
    setTick('call', '');
    syncResultChips('');
  }

  // ---------- 开始新检查：清空本次检查固定信息 ----------
  function clearFixedInfo() {
    $('f-station').value = '';
    $('f-checker').value = '';
    $('f-date').value = Core.todayStr();
    state.last = { station: '', checker: '', date: '' };
    saveJSON(LS_LAST, state.last);
    toast('已开始新检查，请填写站点、驻站人、日期');
  }

  function fillForm(rec) {
    $('f-station').value = rec.station || '';
    $('f-checker').value = rec.checker || '';
    $('f-date').value = rec.date || Core.todayStr();
    $('f-time').value = rec.time || Core.nowTime();
    $('f-route').value = rec.route || '';
    $('f-plate').value = rec.plate || '';
    $('f-boarding').value = rec.boarding === null || rec.boarding === undefined ? '' : rec.boarding;
    $('f-result').value = rec.checkResult || '';
    $('f-rectify').value = rec.rectification || '';
    $('f-remark').value = rec.remark || '';
    setTick('norm', rec.stationNorms || '');
    setTick('call', rec.conductorCall || '');
    syncResultChips(rec.checkResult || '');
  }

  function collectForm() {
    return {
      station: Core.normalize($('f-station').value),
      checker: Core.normalize($('f-checker').value),
      date: $('f-date').value,
      time: Core.normalize($('f-time').value),
      route: Core.normalize($('f-route').value),
      plate: Core.normalize($('f-plate').value),
      boarding: $('f-boarding').value === '' ? '' : $('f-boarding').value,
      stationNorms: state.tick.norm,
      conductorCall: state.tick.call,
      checkResult: Core.normalize($('f-result').value),
      rectification: Core.normalize($('f-rectify').value),
      remark: Core.normalize($('f-remark').value)
    };
  }

  function setEditing(id) {
    state.editingId = id;
    var isEdit = !!id;
    $('btn-save').textContent = isEdit ? '保存修改' : '保存记录';
    $('btn-cancel-edit').hidden = !isEdit;
    $('editing-tag').hidden = !isEdit;
    $('form-title').textContent = isEdit ? '编辑记录' : '登记新记录';
  }

  function saveRecord(e) {
    e.preventDefault();
    var rec = collectForm();
    if (!Core.validRecord(rec)) {
      toast('请填写：站点、驻站人、日期、线路、车号', true);
      return;
    }
    if (state.editingId) {
      var idx = state.records.findIndex(function (r) { return r.id === state.editingId; });
      if (idx >= 0) {
        var old = state.records[idx];
        state.records[idx] = Object.assign({}, old, rec);
        learnValues(rec);
      }
      setEditing(null);
      toast('修改已保存');
    } else {
      rec.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      rec.createdAt = new Date().toISOString();
      state.records.unshift(rec);
      learnValues(rec);
      toast('已保存，可继续登记下一辆');
    }
    state.last = { station: rec.station, checker: rec.checker, date: rec.date };
    saveJSON(LS_LAST, state.last);
    persist();
    renderStats();
    renderList();
    checkBackupReminder();
    resetForm();
  }

  function cancelEdit() {
    setEditing(null);
    $('f-station').value = '';
    $('f-checker').value = '';
    $('f-date').value = Core.todayStr();
    resetForm();
  }

  // ---------- 联想选项（登记时自动学习，供快捷选择使用） ----------
  function learnValues(rec) {
    ['station', 'checker', 'route', 'plate'].forEach(function (k) {
      var arr = state.settings[k + 's'];
      arr.unshift(rec[k]);
      state.settings[k + 's'] = unique(arr).slice(0, k === 'plate' ? 300 : 5000);
    });
  }

  // ---------- 统计 ----------
  function renderStats() {
    var today = Core.todayStr();
    var todayCount = 0;
    var days = {};
    state.records.forEach(function (r) {
      if (r.date === today) todayCount++;
      if (r.date) days[r.date] = 1;
    });
    $('stat-today').textContent = todayCount;
    $('stat-total').textContent = state.records.length;
    $('stat-days').textContent = Object.keys(days).length;
  }

  // ---------- 记录查询 ----------
  function filteredRecords() {
    var from = $('lf-from').value;
    var to = $('lf-to').value;
    var station = Core.normalize($('lf-station').value);
    var route = Core.normalize($('lf-route').value);
    var kw = Core.normalize($('lf-keyword').value);
    return state.records.filter(function (r) {
      if (from && r.date < from) return false;
      if (to && r.date > to) return false;
      if (station && r.station !== station) return false;
      if (route && r.route !== route) return false;
      if (kw) {
        var hay = [r.plate, r.checkResult, r.remark, r.rectification, r.station, r.route, r.checker].join(' ');
        if (hay.indexOf(kw) < 0) return false;
      }
      return true;
    }).sort(function (a, b) {
      var d = (b.date || '').localeCompare(a.date || '');
      if (d !== 0) return d;
      return (b.time || '').localeCompare(a.time || '');
    });
  }

  function badge(v) {
    if (v === '√') return '<span class="badge ok">√</span>';
    if (v === '×') return '<span class="badge bad">×</span>';
    return '';
  }

  function escapeHtml(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderTableRows(list) {
    var tbody = $('record-tbody');
    tbody.innerHTML = '';
    list.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + (r.date || '') + '</td>' +
        '<td>' + (r.time || '') + '</td>' +
        '<td>' + escapeHtml(r.station) + '</td>' +
        '<td>' + escapeHtml(r.route) + '</td>' +
        '<td>' + escapeHtml(r.plate) + '</td>' +
        '<td>' + (r.boarding === '' || r.boarding === null ? '' : r.boarding) + '</td>' +
        '<td>' + badge(r.stationNorms) + '</td>' +
        '<td>' + badge(r.conductorCall) + '</td>' +
        '<td class="text-left">' + escapeHtml(r.checkResult) + '</td>' +
        '<td class="text-left">' + escapeHtml(r.rectification) + '</td>' +
        '<td class="text-left">' + escapeHtml(r.remark) + '</td>' +
        '<td><div class="row-actions">' +
        '<button type="button" class="edit" data-act="edit" data-id="' + r.id + '">编辑</button>' +
        '<button type="button" class="del" data-act="del" data-id="' + r.id + '">删除</button>' +
        '</div></td>';
      tbody.appendChild(tr);
    });
  }

  function renderCards(list) {
    var wrap = $('record-cards');
    wrap.innerHTML = '';
    var map = {};
    var groups = [];
    list.forEach(function (r) {
      var d = r.date || '未填日期';
      if (!map[d]) {
        map[d] = { date: d, records: [] };
        groups.push(map[d]);
      }
      map[d].records.push(r);
    });
    groups.forEach(function (g) {
      var h = document.createElement('div');
      h.className = 'date-group-title';
      h.textContent = g.date + ' · ' + g.records.length + ' 辆';
      wrap.appendChild(h);
      g.records.forEach(function (r) {
        var card = document.createElement('div');
        card.className = 'record-card';
        var boarding = (r.boarding === '' || r.boarding === null || r.boarding === undefined)
          ? '—' : escapeHtml(String(r.boarding));
        card.innerHTML =
          '<button type="button" class="card-main" data-id="' + r.id + '">' +
            '<span class="card-time">' + escapeHtml(r.time || '--:--') + '</span>' +
            '<span class="card-route">' + escapeHtml(r.route || '') + '</span>' +
            '<span class="card-plate">' + escapeHtml(r.plate || '') + '</span>' +
            '<span class="card-boarding">上客 ' + boarding + '</span>' +
            '<span class="card-badges">' + badge(r.stationNorms) + badge(r.conductorCall) + '</span>' +
            '<span class="card-arrow">▾</span>' +
          '</button>' +
          '<div class="card-detail">' +
            '<div class="detail-row"><label>检查情况</label><span>' + escapeHtml(r.checkResult || '—') + '</span></div>' +
            '<div class="detail-row"><label>整改措施</label><span>' + escapeHtml(r.rectification || '—') + '</span></div>' +
            '<div class="detail-row"><label>备注</label><span>' + escapeHtml(r.remark || '—') + '</span></div>' +
          '</div>' +
          '<div class="card-actions">' +
            '<button type="button" class="edit" data-act="edit" data-id="' + r.id + '">编辑</button>' +
            '<button type="button" class="del" data-act="del" data-id="' + r.id + '">删除</button>' +
          '</div>';
        wrap.appendChild(card);
      });
    });
  }

  function renderList() {
    var list = filteredRecords();
    $('list-count').textContent = '共 ' + list.length + ' 条记录';
    $('list-empty').hidden = list.length > 0;
    renderTableRows(list);
    renderCards(list);
  }

  function startEdit(id) {
    var rec = state.records.find(function (r) { return r.id === id; });
    if (!rec) return;
    fillForm(rec);
    setEditing(id);
    switchTab('reg');
    $('f-route').focus();
  }

  function deleteRecord(id) {
    var rec = state.records.find(function (r) { return r.id === id; });
    if (!rec) return;
    askConfirm('确定删除这条记录吗？\n' + (rec.date || '') + ' ' + (rec.time || '') + ' ' + rec.plate + ' ' + rec.route, function () {
      state.records = state.records.filter(function (r) { return r.id !== id; });
      persist();
      renderStats();
      renderList();
      checkBackupReminder();
      toast('已删除');
    });
  }

  // ---------- 导出 ----------
  function exportGroups() {
    var from = $('ef-from').value;
    var to = $('ef-to').value;
    var station = Core.normalize($('ef-station').value);
    var list = state.records.filter(function (r) {
      if (from && r.date < from) return false;
      if (to && r.date > to) return false;
      if (station && r.station !== station) return false;
      return true;
    });
    return Core.groupRecords(list);
  }

  function renderGroups() {
    var groups = exportGroups();
    $('group-count').textContent = '共 ' + groups.length + ' 个分组';
    var tbody = $('group-tbody');
    tbody.innerHTML = '';
    $('group-empty').hidden = groups.length > 0;
    groups.forEach(function (g) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + g.date + '</td>' +
        '<td>' + escapeHtml(g.station) + '</td>' +
        '<td>' + escapeHtml(g.checker) + '</td>' +
        '<td>' + g.count + '</td>' +
        '<td><div class="row-actions">' +
        '<button type="button" class="edit" data-act="export" data-key="' + g.date + '|' + escapeAttr(g.station) + '">导出表格</button>' +
        '</div></td>';
      tbody.appendChild(tr);
    });
    renderGroupCards(groups);
  }

  // 手机端：导出分组以卡片展示（桌面端保持表格）
  function renderGroupCards(groups) {
    var wrap = $('group-cards');
    if (!wrap) return;
    wrap.innerHTML = '';
    groups.forEach(function (g) {
      var card = document.createElement('div');
      card.className = 'record-card group-card';
      var key = g.date + '|' + escapeAttr(g.station);
      card.innerHTML =
        '<div class="card-main">' +
          '<span class="card-time">' + escapeHtml(g.date) + '</span>' +
          '<span class="card-route">' + escapeHtml(g.station) + '</span>' +
          '<span class="card-plate">驻站人：' + escapeHtml(g.checker) + '</span>' +
          '<span class="card-boarding">' + g.count + ' 条</span>' +
        '</div>' +
        '<div class="card-actions">' +
          '<button type="button" class="edit" data-act="export" data-key="' + key + '">导出表格</button>' +
        '</div>';
      wrap.appendChild(card);
    });
  }

  // 日期输入框：有值后放大显示（移动端导出页）
  function initDateFill() {
    ['ef-from', 'ef-to'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      function sync() {
        el.classList.toggle('filled', !!el.value);
      }
      el.addEventListener('input', sync);
      el.addEventListener('change', sync);
      sync();
    });
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }

  function downloadBlob(blob, filename) {
    var a = document.createElement('a');
    var url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1200);
  }

  // 移动端优先走系统分享（微信/邮件等），不可用时降级为下载
  function shareOrDownload(blob, filename, mime) {
    if (isMobile() && navigator.share && navigator.canShare) {
      try {
        var file = new File([blob], filename, { type: mime });
        if (navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: filename }).catch(function (err) {
            if (err && err.name !== 'AbortError') downloadBlob(blob, filename);
          });
          return;
        }
      } catch (e) { /* 继续走下载 */ }
    }
    downloadBlob(blob, filename);
  }

  function buildGroupFile(group) {
    var header = {
      station: group.station,
      checker: group.checker,
      dateLabel: group.dateLabel
    };
    return StationXlsx.generate(header, Core.toRecordRows(group.records));
  }

  function exportGroupByKey(key) {
    var groups = exportGroups();
    var g = groups.find(function (x) { return (x.date + '|' + x.station) === key; });
    if (!g) return;
    if (g.count > 30) {
      toast('该分组有 ' + g.count + ' 条记录，模板最多 30 行，已按时间取前 30 条', true);
    }
    var bin = buildGroupFile(g);
    var filename = '驻站记录表【' + Core.dateDot(g.date) + '】.xlsx';
    shareOrDownload(
      new Blob([bin], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      filename,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    toast('已导出：' + filename);
  }

  function exportAllZip() {
    var groups = exportGroups();
    if (!groups.length) {
      toast('当前条件下没有可导出的记录', true);
      return;
    }
    var used = {};
    var entries = groups.map(function (g) {
      var base = '驻站记录表【' + Core.dateDot(g.date) + '】';
      var name = base + '.xlsx';
      var n = 0;
      while (used[name]) {
        n++;
        name = base + '_' + Core.safeName(g.station) + (n > 1 ? n : '') + '.xlsx';
      }
      used[name] = true;
      return { name: name, data: buildGroupFile(g) };
    });
    var bin = StationXlsx.zip(entries);
    var from = $('ef-from').value || '起始';
    var to = $('ef-to').value || '结束';
    downloadBlob(new Blob([bin], { type: 'application/zip' }), '驻站记录表_' + from + '_' + to + '.zip');
    toast('已导出 ' + entries.length + ' 张表格（ZIP）');
  }

  // ---------- 设置 ----------
  function loadSettingsForm() {
    $('set-plates').value = state.settings.plates.join('\n');
  }

  function saveSettings() {
    state.settings.plates = unique($('set-plates').value.split('\n'));
    persist();
    toast('选项已保存');
  }

  function backupData() {
    var data = {
      app: '驻站检查登记系统',
      version: 1,
      exportedAt: new Date().toISOString(),
      records: state.records,
      settings: state.settings
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var d = new Date();
    var stamp = '' + d.getFullYear() + Core.pad2(d.getMonth() + 1) + Core.pad2(d.getDate());
    shareOrDownload(blob, '驻站检查数据备份_' + stamp + '.json', 'application/json');
    state.reminder = { lastBackupAt: Date.now(), lastBackupCount: state.records.length };
    saveJSON(LS_REMINDER, state.reminder);
    checkBackupReminder();
    toast('备份文件已生成');
  }

  function restoreData(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!data || !Array.isArray(data.records) || !data.settings) {
          toast('备份文件格式不正确', true);
          return;
        }
        state.records = data.records.filter(function (r) { return r && r.id; });
        state.settings = Object.assign(clone(DEFAULT_SETTINGS), data.settings);
        ['stations', 'checkers', 'routes', 'plates'].forEach(function (k) {
          state.settings[k] = unique(state.settings[k] || []);
        });
        persist();
        renderStats();
        renderList();
        renderGroups();
        loadSettingsForm();
        toast('导入成功，共 ' + state.records.length + ' 条记录');
      } catch (err) {
        toast('备份文件读取失败', true);
      }
    };
    reader.readAsText(file);
  }

  function clearAll() {
    askConfirm('确定要清空全部数据吗？此操作不可恢复，请先备份！', function () {
      askConfirm('再次确认：真的要清空全部数据和选项吗？', function () {
        state.records = [];
        state.settings = clone(DEFAULT_SETTINGS);
        setEditing(null);
        persist();
        renderStats();
        renderList();
        renderGroups();
        loadSettingsForm();
        checkBackupReminder();
        toast('已清空全部数据');
      });
    });
  }

  function persist() {
    saveJSON(LS_RECORDS, state.records);
    saveJSON(LS_SETTINGS, state.settings);
  }

  // 首次使用：把内置的站点/驻站人/线路资料填充进资料库（只合并缺失项，不覆盖手动修改）
  function seedCatalog() {
    try {
      if (localStorage.getItem(LS_CATALOG_SEEDED) === '1') return;
    } catch (e) {
      return;
    }
    var seed = window.CatalogSeed;
    if (!seed) return;
    ['stations', 'checkers', 'routes'].forEach(function (k) {
      var arr = state.settings[k];
      (seed[k] || []).forEach(function (v) {
        if (arr.indexOf(v) < 0) arr.push(v);
      });
    });
    try {
      localStorage.setItem(LS_CATALOG_SEEDED, '1');
    } catch (e) { /* 存储不可用时忽略 */ }
    persist();
  }

  // ---------- 备份提醒 ----------
  function checkBackupReminder() {
    var banner = $('backup-banner');
    var text = $('backup-text');
    var show = false;
    var msg = '';
    if (state.reminder.lastBackupAt) {
      var newCount = state.records.length - (state.reminder.lastBackupCount || 0);
      var days = (Date.now() - state.reminder.lastBackupAt) / 86400000;
      if (newCount >= 50) {
        show = true;
        msg = '已有 ' + newCount + ' 条新记录未备份，建议立即导出 JSON 备份。';
      } else if (days >= 7) {
        show = true;
        msg = '距上次备份已 ' + Math.floor(days) + ' 天，建议导出 JSON 备份。';
      }
    } else if (state.records.length >= 20) {
      show = true;
      msg = '已登记 ' + state.records.length + ' 条记录，建议先导出一次备份。';
    }
    banner.hidden = !show;
    if (show) text.textContent = msg;
  }

  // ---------- PWA 安装提示与首启引导 ----------
  function hideInstallBanner() {
    $('install-banner').hidden = true;
  }

  function initInstall() {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      state.deferredPrompt = e;
      if (localStorage.getItem(LS_INSTALL) !== '1' && !isStandalone()) {
        $('install-banner').hidden = false;
      }
    });
    window.addEventListener('appinstalled', function () {
      localStorage.setItem(LS_INSTALL, '1');
      hideInstallBanner();
    });
    $('btn-install').addEventListener('click', function () {
      if (!state.deferredPrompt) return;
      state.deferredPrompt.prompt();
      state.deferredPrompt.userChoice.then(function (choice) {
        if (choice && choice.outcome === 'accepted') {
          localStorage.setItem(LS_INSTALL, '1');
        }
        state.deferredPrompt = null;
        hideInstallBanner();
      });
    });
    $('btn-install-close').addEventListener('click', function () {
      localStorage.setItem(LS_INSTALL, '1');
      hideInstallBanner();
    });

    // 非安卓浏览器（无 beforeinstallprompt）：首启显示安装指引
    var supportsInstallPrompt = ('onbeforeinstallprompt' in window);
    if (isMobile() && !isStandalone() && !supportsInstallPrompt && localStorage.getItem(LS_GUIDE) !== '1') {
      $('guide-overlay').hidden = false;
    }
    $('guide-close').addEventListener('click', function () {
      localStorage.setItem(LS_GUIDE, '1');
      $('guide-overlay').hidden = true;
    });
    $('guide-dismiss').addEventListener('click', function () {
      localStorage.setItem(LS_GUIDE, '1');
      $('guide-overlay').hidden = true;
    });
  }

  // ---------- Service Worker ----------
  function initSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol === 'file:') return;
    navigator.serviceWorker.register('./sw.js').catch(function () { /* 静默失败，不影响使用 */ });
  }

  // ---------- 初始化 ----------
  function init() {
    state.records = loadJSON(LS_RECORDS, []);
    state.settings = Object.assign(clone(DEFAULT_SETTINGS), loadJSON(LS_SETTINGS, {}));
    state.last = Object.assign({ station: '', checker: '', date: '' }, loadJSON(LS_LAST, {}));
    state.reminder = Object.assign({ lastBackupAt: 0, lastBackupCount: 0 }, loadJSON(LS_REMINDER, {}));
    ['stations', 'checkers', 'routes', 'plates'].forEach(function (k) {
      state.settings[k] = unique(state.settings[k] || []);
    });
    seedCatalog();

    var today = Core.todayStr();
    $('f-date').value = today;
    $('f-station').value = state.last.station || '';
    $('f-checker').value = state.last.checker || '';
    $('f-time').value = Core.nowTime();

    document.querySelectorAll('.tab-btn').forEach(function (b) {
      b.addEventListener('click', function () { switchTab(b.dataset.tab); });
    });

    initTicks();
    initStepper();
    initChips();
    initPicker();
    initInlineSuggest();
    initCatalog();
    initEnterNav();

    $('record-form').addEventListener('submit', saveRecord);
    $('btn-cancel-edit').addEventListener('click', cancelEdit);
    $('btn-clear-fixed').addEventListener('click', clearFixedInfo);
    $('btn-filter').addEventListener('click', renderList);
    $('btn-filter-reset').addEventListener('click', function () {
      $('lf-from').value = '';
      $('lf-to').value = '';
      $('lf-station').value = '';
      $('lf-route').value = '';
      $('lf-keyword').value = '';
      renderList();
    });
    $('btn-filter-toggle').addEventListener('click', function () {
      var bar = $('filter-bar');
      var open = bar.classList.toggle('open');
      $('btn-filter-toggle').textContent = open ? '收起筛选' : '展开筛选';
    });
    $('btn-groups').addEventListener('click', renderGroups);
    $('btn-export-all').addEventListener('click', exportAllZip);
    initDateFill();

    $('record-tbody').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-act]');
      if (!btn) return;
      if (btn.dataset.act === 'edit') startEdit(btn.dataset.id);
      if (btn.dataset.act === 'del') deleteRecord(btn.dataset.id);
    });
    $('record-cards').addEventListener('click', function (e) {
      var main = e.target.closest('.card-main');
      if (main) {
        main.parentElement.classList.toggle('open');
        return;
      }
      var btn = e.target.closest('button[data-act]');
      if (!btn) return;
      if (btn.dataset.act === 'edit') startEdit(btn.dataset.id);
      if (btn.dataset.act === 'del') deleteRecord(btn.dataset.id);
    });
    $('group-cards').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-act="export"]');
      if (!btn) return;
      exportGroupByKey(btn.dataset.key);
    });
    $('group-tbody').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-act="export"]');
      if (!btn) return;
      exportGroupByKey(btn.dataset.key);
    });

    $('btn-save-settings').addEventListener('click', saveSettings);
    $('btn-backup').addEventListener('click', backupData);
    $('btn-restore').addEventListener('click', function () { $('restore-file').click(); });
    $('restore-file').addEventListener('change', function () {
      if (this.files && this.files[0]) restoreData(this.files[0]);
      this.value = '';
    });
    $('btn-clear-all').addEventListener('click', clearAll);
    $('btn-backup-now').addEventListener('click', function () { switchTab('settings'); });
    $('btn-backup-close').addEventListener('click', function () { $('backup-banner').hidden = true; });

    // 日期/时间默认值：进入新的一天或切回登记页时刷新
    window.addEventListener('focus', function () {
      if (!$('f-date').value) $('f-date').value = Core.todayStr();
    });

    renderStats();
    renderCatalog();
    renderList();
    renderGroups();
    checkBackupReminder();
    initInstall();
    initSW();

    if (!storageOk) {
      toast('浏览器本地存储不可用，数据将只在本次使用期间保留', true);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
