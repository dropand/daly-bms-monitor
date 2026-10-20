/**
 * Приём данных заряда от приложения «Daly BMS монитор» в Google Таблицу.
 * Приложение шлёт анонимно: случайный идентификатор сессии, напряжения ячеек, ток, события, химию и ёмкость.
 * Имён устройств, геолокации и контактов в данных нет.
 *
 * Защита (адрес приёма публичный, поэтому скрипт не доверяет входу):
 *  - строгая проверка формата и диапазонов, всё лишнее отбрасывается;
 *  - не чаще одного запроса в 20 с с одной сессии и не более 1500 запросов в час на весь скрипт;
 *  - повторная отправка тех же замеров не создаёт дублей (водяной знак по времени и ключи событий);
 *  - текст событий очищается от управляющих символов и от начала с «=», «+», «-», «@» (формулы в таблице);
 *  - ответ всегда одно слово: ok / limit / bad.
 *
 * Листы создаются сами: samples, events, sessions (по строке на сессию: сводка и вердикт).
 */
var MAX_BODY = 300000, MAX_ROWS = 600, MAX_EVENTS = 100, RATE_SEC = 20, HOUR_LIMIT = 1500;

function sheet_(name, header) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(header); sh.setFrozenRows(1); }
  return sh;
}

function safe_(s, n) {
  s = String(s).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, n);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function num_(x, lo, hi) {
  x = Number(x);
  return isFinite(x) && x >= lo && x <= hi ? x : null;
}

function verdict_(s) {
  var vmax = s.chem === 'nmc' ? 4200 : 3650, lo = s.chem === 'nmc' ? 2800 : 2500, out = [];
  if (s.maxCell >= vmax) out.push('перенапряжение ячейки');
  if (s.minCell <= lo) out.push('глубокий разряд ячейки');
  if (s.spread >= 300) out.push('сильный перекос'); else if (s.spread >= 150) out.push('перекос');
  if (s.alarms > 0) out.push('были тревоги: ' + s.alarms);
  return out.length ? out.join('; ') : 'норма';
}

function limited_(sid) {
  var c = CacheService.getScriptCache(), now = new Date();
  if (c.get('rl_' + sid)) return true;
  c.put('rl_' + sid, '1', RATE_SEC);
  var k = 'h_' + Utilities.formatDate(now, 'UTC', 'yyyyMMddHH'), n = Number(c.get(k) || 0) + 1;
  c.put(k, String(n), 3600);
  return n > HOUR_LIMIT;
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var raw = e && e.postData ? e.postData.contents : '';
    if (!raw || raw.length > MAX_BODY) return out_('bad');
    var b = JSON.parse(raw);
    if (!b || b.v !== 1 || typeof b.sid !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(b.sid)) return out_('bad');
    if (limited_(b.sid)) return out_('limit');
    lock.waitLock(20000);

    var now = new Date(), nowS = now.getTime() / 1000, chem = b.chem === 'nmc' ? 'nmc' : 'lfp';
    var cap = num_(b.cap, 1, 2000), cycles = num_(b.cycles, 0, 100000);

    var ss = sheet_('sessions', ['session', 'first_seen', 'updated', 'rows', 'chem', 'cap_Ah', 'cycles', 'cells', 'I_mean_A',
      'I_max_A', 'max_cell_mV', 'min_cell_mV', 'spread_last_mV', 'last_data', 'alarms', 'verdict']);
    var ids = ss.getLastRow() > 1 ? ss.getRange(2, 1, ss.getLastRow() - 1, 1).getValues().map(function (r) { return r[0]; }) : [];
    var idx = ids.indexOf(b.sid), row = idx >= 0 ? ss.getRange(idx + 2, 1, 1, 16).getValues()[0] : null;
    var water = row && row[13] instanceof Date ? row[13].getTime() / 1000 : 0;

    var good = [], seen = {}, i;
    (Array.isArray(b.rows) ? b.rows : []).slice(0, MAX_ROWS).forEach(function (r) {
      if (!Array.isArray(r) || r.length < 3 || r.length > 18) return;
      var t = num_(r[0], nowS - 7 * 86400, nowS + 3600), I = num_(r[1], -500, 500);
      if (t === null || I === null || t <= water || seen[t]) return;
      var cells = [];
      for (i = 2; i < r.length; i++) { var c = num_(r[i], 0, 6000); if (c === null) return; cells.push(Math.round(c)); }
      seen[t] = 1;
      good.push({t: Math.round(t), I: I, cells: cells});
    });
    good.sort(function (x, y) { return x.t - y.t; });

    var n = good.length, maxCell = 0, minCell = 99999, sumI = 0, maxI = -999, last = null;
    if (n) {
      var hdr = ['server_time', 'session', 'time', 'I_A', 'cells'];
      for (i = 1; i <= 16; i++) hdr.push('c' + i);
      var sh = sheet_('samples', hdr), w = 5 + 16, outRows = good.map(function (g) {
        maxCell = Math.max(maxCell, Math.max.apply(null, g.cells));
        minCell = Math.min(minCell, Math.min.apply(null, g.cells));
        sumI += g.I; maxI = Math.max(maxI, g.I); last = g;
        var r = [now, b.sid, new Date(g.t * 1000), g.I, g.cells.length].concat(g.cells);
        while (r.length < w) r.push('');
        return r;
      });
      sh.getRange(sh.getLastRow() + 1, 1, outRows.length, w).setValues(outRows);
    }

    var alarms = 0, cache = CacheService.getScriptCache(), ek = 'ev_' + b.sid, known = {};
    try { (JSON.parse(cache.get(ek) || '[]')).forEach(function (k) { known[k] = 1; }); } catch (e2) {}
    var evOut = [];
    (Array.isArray(b.events) ? b.events : []).slice(0, MAX_EVENTS).forEach(function (x) {
      if (!Array.isArray(x) || x.length < 3) return;
      var ts = String(x[0]).slice(0, 25), lv = num_(x[1], 0, 2);
      if (!/^[0-9: -]+$/.test(ts) || lv === null) return;
      var text = safe_(x[2], 200), key = ts + '|' + text;
      if (known[key]) return;
      known[key] = 1;
      if (lv === 2) alarms++;
      evOut.push([now, b.sid, ts, lv, text]);
    });
    if (evOut.length) {
      var se = sheet_('events', ['server_time', 'session', 'time', 'level', 'text']);
      se.getRange(se.getLastRow() + 1, 1, evOut.length, 5).setValues(evOut);
      cache.put(ek, JSON.stringify(Object.keys(known).slice(-200)), 21600);
    }

    var s = row ? {rows: Number(row[3]) || 0, sumI: (Number(row[8]) || 0) * (Number(row[3]) || 0), maxI: Number(row[9]) || -999,
      maxCell: Number(row[10]) || 0, minCell: Number(row[11]) || 99999, alarms: Number(row[14]) || 0, first: row[1]}
      : {rows: 0, sumI: 0, maxI: -999, maxCell: 0, minCell: 99999, alarms: 0, first: now};
    s.rows += n; s.sumI += sumI; s.maxI = Math.max(s.maxI, maxI); s.alarms += alarms; s.chem = chem;
    if (n) { s.maxCell = Math.max(s.maxCell, maxCell); s.minCell = Math.min(s.minCell, minCell); }
    s.spread = last ? Math.max.apply(null, last.cells) - Math.min.apply(null, last.cells) : (row ? Number(row[12]) || 0 : 0);
    var rec = [b.sid, s.first, now, s.rows, chem, cap === null ? '' : cap, cycles === null ? (row ? row[6] : '') : cycles,
      last ? last.cells.length : (row ? row[7] : ''), s.rows ? Math.round(s.sumI / s.rows * 10) / 10 : 0, s.maxI === -999 ? '' : s.maxI,
      s.maxCell, s.minCell === 99999 ? '' : s.minCell, s.spread, last ? new Date(last.t * 1000) : (row ? row[13] : ''), s.alarms, verdict_(s)];
    if (idx >= 0) ss.getRange(idx + 2, 1, 1, 16).setValues([rec]); else ss.appendRow(rec);
    return out_('ok');
  } catch (err) {
    return out_('bad');
  } finally {
    try { lock.releaseLock(); } catch (e3) {}
  }
}

function out_(t) { return ContentService.createTextOutput(t); }

function doGet() {
  return out_('Daly BMS монитор: приём данных работает (используйте POST).');
}
