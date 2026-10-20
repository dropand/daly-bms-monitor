/**
 * Приём данных заряда от приложения «Daly BMS монитор» в Google Таблицу.
 * Приложение шлёт анонимно: случайный идентификатор сессии, напряжения ячеек, ток, события, химию и ёмкость.
 * Имён устройств, геолокации и контактов в данных нет.
 *
 * Листы создаются сами:
 *   samples  — по строке на замер (раз в 30 с): сессия, время, ток, число ячеек, c1…c16
 *   events   — события и тревоги
 *   sessions — по строке на сессию: сводка и вердикт «норма / перекос / перенапряжение / …»
 */
var MAX_BODY = 300000;   // байт на запрос
var MAX_ROWS = 600;      // замеров за один запрос

function sheet_(name, header) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(header);
    sh.setFrozenRows(1);
  }
  return sh;
}

function verdict_(s) {
  var vmax = s.chem === 'nmc' ? 4200 : 3650, lo = s.chem === 'nmc' ? 2800 : 2500, out = [];
  if (s.maxCell >= vmax) out.push('перенапряжение ячейки');
  if (s.minCell <= lo) out.push('глубокий разряд ячейки');
  if (s.spread >= 300) out.push('сильный перекос');
  else if (s.spread >= 150) out.push('перекос');
  if (s.alarms > 0) out.push('были тревоги: ' + s.alarms);
  return out.length ? out.join('; ') : 'норма';
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var raw = e.postData ? e.postData.contents : '';
    if (!raw || raw.length > MAX_BODY) return ContentService.createTextOutput('too big');
    var b = JSON.parse(raw);
    if (b.v !== 1 || !b.sid || !/^[A-Za-z0-9-]{8,64}$/.test(b.sid)) return ContentService.createTextOutput('bad');
    var rows = (b.rows || []).slice(0, MAX_ROWS), evs = (b.events || []).slice(0, 100);
    var now = new Date(), n = 0, maxCell = 0, minCell = 99999, last = null, sumI = 0, maxI = 0;

    if (rows.length) {
      var hdr = ['server_time', 'session', 'time', 'I_A', 'cells'];
      for (var i = 1; i <= 16; i++) hdr.push('c' + i);
      var sh = sheet_('samples', hdr), out = [];
      rows.forEach(function (r) {
        var cells = r.slice(2, 18).map(Number);
        if (!cells.length || cells.some(isNaN)) return;
        out.push([now, b.sid, new Date(r[0] * 1000), Number(r[1]), cells.length].concat(cells));
        maxCell = Math.max(maxCell, Math.max.apply(null, cells));
        minCell = Math.min(minCell, Math.min.apply(null, cells));
        sumI += Number(r[1]); maxI = Math.max(maxI, Number(r[1]));
        last = {t: r[0], cells: cells};
        n++;
      });
      if (out.length) {
        var w = Math.max.apply(null, out.map(function (o) { return o.length; }));
        out.forEach(function (o) { while (o.length < w) o.push(''); });
        sh.getRange(sh.getLastRow() + 1, 1, out.length, w).setValues(out);
      }
    }

    var alarms = 0;
    if (evs.length) {
      var se = sheet_('events', ['server_time', 'session', 'time', 'level', 'text']);
      var eo = evs.map(function (x) {
        if (Number(x[1]) === 2) alarms++;
        return [now, b.sid, String(x[0]).slice(0, 25), Number(x[1]), String(x[2]).slice(0, 200)];
      });
      se.getRange(se.getLastRow() + 1, 1, eo.length, 5).setValues(eo);
    }

    var ss = sheet_('sessions', ['session', 'first_seen', 'updated', 'rows', 'chem', 'cap_Ah', 'cycles', 'cells', 'I_mean_A',
      'I_max_A', 'max_cell_mV', 'min_cell_mV', 'spread_last_mV', 'last_data', 'alarms', 'verdict']);
    var ids = ss.getRange(2, 1, Math.max(1, ss.getLastRow() - 1), 1).getValues().map(function (r) { return r[0]; });
    var idx = ids.indexOf(b.sid), row = idx >= 0 ? ss.getRange(idx + 2, 1, 1, 16).getValues()[0] : null;
    var s = row ? {rows: Number(row[3]), sumI: Number(row[8]) * Number(row[3]), maxI: Number(row[9]), maxCell: Number(row[10]),
      minCell: Number(row[11]), alarms: Number(row[14]), first: row[1]} : {rows: 0, sumI: 0, maxI: 0, maxCell: 0, minCell: 99999, alarms: 0, first: now};
    s.rows += n; s.sumI += sumI; s.maxI = Math.max(s.maxI, maxI);
    if (n) { s.maxCell = Math.max(s.maxCell, maxCell); s.minCell = Math.min(s.minCell, minCell); }
    s.alarms += alarms;
    s.chem = b.chem === 'nmc' ? 'nmc' : 'lfp';
    s.spread = last ? Math.max.apply(null, last.cells) - Math.min.apply(null, last.cells) : (row ? Number(row[12]) : 0);
    var rec = [b.sid, s.first, now, s.rows, s.chem, Number(b.cap) || '', b.cycles == null ? '' : Number(b.cycles), last ? last.cells.length : (row ? row[7] : ''),
      s.rows ? Math.round(s.sumI / s.rows * 10) / 10 : 0, s.maxI, s.maxCell, s.minCell === 99999 ? '' : s.minCell, s.spread,
      last ? new Date(last.t * 1000) : (row ? row[13] : ''), s.alarms, verdict_(s)];
    if (idx >= 0) ss.getRange(idx + 2, 1, 1, 16).setValues([rec]); else ss.appendRow(rec);
    return ContentService.createTextOutput('ok');
  } catch (err) {
    return ContentService.createTextOutput('error: ' + err);
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

function doGet() {
  return ContentService.createTextOutput('Daly BMS монитор: приём данных работает (используйте POST).');
}
