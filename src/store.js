export const CLOUD_URL = 'https://script.google.com/macros/s/AKfycby54kxPT5gWs_qx9VQ2ik9eq3DkxZ-ZsE5iaYbGoaHodTINODHj-A5DSdcxjROeEwHftA/exec';
export const MIN_GAP = 60000;

export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const csvCell = s => {
  let v = String(s);
  if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
  return '"' + v.replace(/"/g, '""') + '"';
};

export function buildCsv(long, events) {
  const nc = Math.max(0, ...long.map(x => x[2].length));
  const h = 'time,I,sum_V,' + Array.from({ length: nc }, (_, i) => 'c' + (i + 1)).join(',') + ',V_bms,soc_bms,tmin,tmax,state,chg,dis,charger,load,cap_bms,bal,fault_hex\n';
  const rows = long.map(x => {
    const m = x[4] || {};
    const b = (x[3] || []).map((v, i) => (v ? i + 1 : 0)).filter(Boolean).join(';');
    return [
      new Date(x[0] * 1000).toISOString(), x[1], (x[2].reduce((a, c) => a + c, 0) / 1000).toFixed(3),
      ...x[2], m.V ?? '', m.soc ?? '', m.tmin ?? '', m.tmax ?? '', m.st ?? '', m.chg ?? '',
      m.dis ?? '', m.chgr ?? '', m.load ?? '', m.cap ?? '', b, m.flt ?? ''
    ].join(',');
  }).join('\n');
  const evs = events.map(e => [e.t, e.level, csvCell(e.text)].join(',')).join('\n');
  return h + rows + '\n\nevents\n' + evs;
}

export function lsGet(k, fb = '') {
  try {
    return typeof localStorage !== 'undefined' ? (localStorage.getItem(k) ?? fb) : fb;
  } catch (e) {
    return fb;
  }
}

export function lsSet(k, v) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(k, v);
  } catch (e) {}
}

export function lsGetJson(k, fb = null) {
  try {
    if (typeof localStorage === 'undefined') return fb;
    const raw = localStorage.getItem(k);
    return raw ? JSON.parse(raw) : fb;
  } catch (e) {
    return fb;
  }
}

export const cloudUrl = () => CLOUD_URL || lsGet('daly2:cloudurl', '');
export const cloudOn = () => !!cloudUrl();

let cachedAnon = '';
export function getAnonId() {
  if (cachedAnon) return cachedAnon;
  let a = lsGet('daly2:anon', '');
  if (!a) {
    a = [...crypto.getRandomValues(new Uint8Array(6))].map(x => x.toString(16).padStart(2, '0')).join('');
    lsSet('daly2:anon', a);
  }
  cachedAnon = a;
  return a;
}

export const hash6 = s => {
  let h = 5381;
  for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0;
  return h.toString(16).padStart(8, '0');
};

export const pendingCounts = dv => ({
  rows: dv.long.filter(x => x[0] > dv.upT).length,
  evs: dv.events.filter(e => e.t > dv.upE).length
});

export function cloudLine(dv, tr) {
  if (dv.demo) return tr('☁ демо: данные никуда не отправляются', '☁ demo: nothing is sent anywhere');
  if (!cloudOn()) return tr('☁ облако не настроено', '☁ cloud not configured');
  const p = pendingCounts(dv);
  const when = dv.sentAt ? new Date(dv.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const st = dv.sentOk === false
    ? tr('последняя попытка не удалась', 'last attempt failed')
    : dv.sentAt
      ? tr('последняя отправка ', 'last upload ') + when + (dv.sentOk === true ? tr(' ✓ подтверждена', ' ✓ confirmed') : tr(' (без подтверждения)', ' (unconfirmed)'))
      : tr('ещё не отправляли', 'nothing uploaded yet');
  return tr(`☁ отправлено ${dv.sent} замеров · ждёт отправки ${p.rows} · ${st}`, `☁ uploaded ${dv.sent} samples · pending ${p.rows} · ${st}`);
}

export async function uploadDevice(dv, manual, { tr, toast, glog }) {
  if (dv.demo) {
    if (manual) toast(tr('В демо ничего не отправляется', 'Nothing is sent in demo mode'));
    return;
  }
  if (!cloudOn()) {
    if (manual) toast(tr('Облако не настроено', 'Cloud not configured'));
    return;
  }
  if (dv.sending) return;
  const wait = MIN_GAP - (Date.now() - dv.lastTry);
  if (wait > 0) {
    if (manual) toast(tr(`Слишком часто: подождите ${Math.ceil(wait / 1000)} с`, `Too often: wait ${Math.ceil(wait / 1000)} s`), 'bad');
    return;
  }
  const p = pendingCounts(dv);
  if (!p.rows && !p.evs) {
    if (manual) toast(tr('Всё уже отправлено, новых данных нет', 'Everything is already uploaded'), 'ok');
    return;
  }
  const rows = dv.long.filter(x => x[0] > dv.upT).slice(0, 500);
  const evs = dv.events.filter(e => e.t > dv.upE).reverse().slice(0, 100);
  const body = JSON.stringify({
    v: 1,
    sid: getAnonId() + '-' + hash6(dv.id),
    chem: dv.chem,
    cap: dv.cap,
    cycles: dv.last && dv.last.cycles,
    lim: dv.lim,
    ir: dv.ir,
    sn: dv.sn,
    rcap: dv.rcap,
    rows: rows.map(x => [x[0], x[1], ...x[2]]),
    x: rows.map(x => {
      const m = x[4] || {};
      const b = (x[3] || []).map((v, i) => (v ? i + 1 : 0)).filter(Boolean).join(',');
      return { V: m.V, soc: m.soc, tmin: m.tmin, tmax: m.tmax, st: m.st, chg: m.chg, dis: m.dis, chgr: m.chgr, load: m.load, cap: m.cap, bal: b, flt: m.flt || '' };
    }),
    events: evs.map(e => [e.t, e.level, e.text])
  });
  dv.sending = true;
  dv.lastTry = Date.now();
  try {
    const r = await fetch(cloudUrl(), { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, referrerPolicy: 'no-referrer', credentials: 'omit' });
    const t = (await r.text()).trim();
    if (!r.ok || t !== 'ok') throw new Error(t.slice(0, 80) || tr('пустой ответ', 'empty response'));
    if (rows.length) dv.upT = rows[rows.length - 1][0];
    if (evs.length) dv.upE = evs[evs.length - 1].t;
    dv.sent += rows.length;
    dv.sentAt = Date.now();
    dv.sentOk = true;
    dv.dirty = true;
    dv.save();
    if (manual || !dv.toasted) {
      dv.toasted = true;
      toast(tr(`☁ Отправлено: ${rows.length} замеров, ${evs.length} событий · подтверждено`, `☁ Uploaded: ${rows.length} samples, ${evs.length} events · confirmed`), 'ok');
    }
    glog(tr(`отправлено в облако: ${rows.length} замеров, ${evs.length} событий`, `uploaded: ${rows.length} samples, ${evs.length} events`));
  } catch (e) {
    dv.sentOk = false;
    dv.dirty = true;
    if (manual || !dv.failToast || Date.now() - dv.failToast > 600000) {
      dv.failToast = Date.now();
      toast(tr('☁ Не отправлено: ', '☁ Not uploaded: ') + (e.message || e), 'bad');
    }
    glog(tr('облако: ', 'cloud: ') + (e.message || e));
  } finally {
    dv.sending = false;
  }
}
