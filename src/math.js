import { decodeFaults, FEN } from './proto.js';

export const CHEM = {
  lfp: {
    name: 'LiFePO4',
    vmax: 3650,
    hiWarn: 3600,
    loWarn: 2800,
    loBad: 2500,
    top: 3450,
    ocv: [[2.50, 0], [3.00, 2], [3.15, 8], [3.20, 15], [3.25, 25], [3.28, 35], [3.30, 45], [3.32, 60], [3.33, 70], [3.35, 80], [3.40, 90], [3.45, 95], [3.60, 100]]
  },
  nmc: {
    name: 'Li-ion NMC',
    vmax: 4200,
    hiWarn: 4150,
    loWarn: 3200,
    loBad: 2800,
    top: 4100,
    ocv: [[3.00, 0], [3.30, 5], [3.50, 20], [3.60, 35], [3.70, 50], [3.80, 65], [3.90, 77], [4.00, 88], [4.10, 95], [4.20, 100]]
  }
};

export const NEN = {
  'BMS отвечает': 'BMS responds',
  'Сумма ячеек = сборка': 'Cells sum = pack',
  'Ячейки в пределах': 'Cells in range',
  'Пороги BMS': 'BMS thresholds',
  'Сопротивление ячеек': 'Cell impedance',
  'Перекос ячеек': 'Cell spread',
  'Температура': 'Temperature',
  'Защиты BMS': 'BMS protections',
  'Ключ заряда': 'Charge switch',
  'Ключ разряда': 'Discharge switch',
  'Контакт балансира': 'Balance tap',
  'Обрыв отвода ячейки': 'Open balance lead',
  'Малый ток (мёртвая зона)': 'Low-current deadband',
  'Заряд идёт': 'Charging',
  'Обрыв заряда': 'Charge interruption',
  'Ток заряда': 'Charge current',
  'Балансировка у верха': 'Top balancing'
};

export const SPREAD_WARN = 150;
export const SPREAD_BAD = 300;
export const TOP_SPREAD = 60;
export const T_WARN = 45;
export const T_BAD = 55;
export const SUM_TOL = 0.5;
export const RISE_MIN = 2;
export const DROP_V = 0.3;

export const clampDt = (currT, prevT) => Math.max(0, Math.min(currT - prevT, 10));

export const ocvSoc = (tab, v) => {
  if (v <= tab[0][0]) return 0;
  for (let i = 1; i < tab.length; i++) {
    if (v <= tab[i][0]) {
      const a = tab[i - 1], b = tab[i];
      return a[1] + (b[1] - a[1]) * (v - a[0]) / (b[0] - a[0]);
    }
  }
  return 100;
};

export const ocvV = (tab, s) => {
  if (s <= 0) return tab[0][0];
  for (let i = 1; i < tab.length; i++) {
    if (s <= tab[i][1]) {
      const a = tab[i - 1], b = tab[i];
      return a[0] + (b[0] - a[0]) * (s - a[1]) / (b[1] - a[1]);
    }
  }
  return tab[tab.length - 1][0];
};

export function calcSlope(hist, t) {
  const p = hist.filter(h => h.t >= t - 300 && h.sum);
  if (p.length < 2 || p[p.length - 1].t - p[0].t < 120) return null;
  return (p[p.length - 1].sum - p[0].sum) * 1000 / ((p[p.length - 1].t - p[0].t) / 60);
}

export function estIR(hist, d, C) {
  const pts = hist.filter(
    h => h.t >= d.t - 150 &&
      h.cells.length === d.cells.length &&
      Math.min(...h.cells) >= C.loWarn - 100 &&
      Math.max(...h.cells) <= C.hiWarn
  );
  if (pts.length < 15) return null;
  const iv = pts.map(h => h.I);
  const im = iv.reduce((a, b) => a + b, 0) / iv.length;
  const rng = Math.max(...iv) - Math.min(...iv);
  const sxx = iv.reduce((s, x) => s + (x - im) * (x - im), 0);
  const std = Math.sqrt(sxx / iv.length);
  if (rng < 8 || std < 2 || !sxx) return null;

  const res = d.cells.map((_, ci) => {
    const vv = pts.map(h => h.cells[ci]);
    const vm = vv.reduce((a, b) => a + b, 0) / vv.length;
    let syy = 0, sxy = 0;
    for (let k = 0; k < pts.length; k++) {
      const dx = iv[k] - im;
      const dy = vv[k] - vm;
      syy += dy * dy;
      sxy += dx * dy;
    }
    if (!syy || sxy <= 0 || (sxy * sxy) / (sxx * syy) < 0.75) return null;
    const r = ((syy - sxx) + Math.sqrt((syy - sxx) * (syy - sxx) + 4 * sxy * sxy)) / (2 * sxy);
    return r >= 0.1 && r <= 15 ? +r.toFixed(2) : null;
  });

  return res.filter(x => x != null).length >= Math.ceil(d.cells.length / 2) ? res : null;
}

export function evaluateChecks(dev, d, { lang, tr, uV, uA, umV, now = Date.now() }) {
  const ck = [];
  const C = dev.C;
  const add = (name, level, text) => ck.push({ name: lang === 'ru' ? name : (NEN[name] || name), level, text });

  if (d.asleep) {
    add('BMS отвечает', 1, tr('BMS спит: подключите зарядку на 2 с или нажмите кнопку пробуждения на BMS', 'BMS is asleep: connect charger for 2 s or press the BMS wake button'));
    return ck;
  }
  if (!d.cells.length) {
    add('BMS отвечает', 1, tr('нет данных по ячейкам', 'no cell data'));
    return ck;
  }

  add('BMS отвечает', 0, tr('данные получены', 'data received'));
  const cs = d.cells, mx = Math.max(...cs), mn = Math.min(...cs), sm = cs.reduce((a, b) => a + b, 0) / 1000, sp = mx - mn;
  const h3 = dev.hist.slice(-3);
  const p30 = dev.hist.filter(h => h.t >= d.t - 30);
  const atRest = p30.length >= 10 && d.t - p30[0].t >= 28 && p30.every(h => Math.abs(h.I) < 0.5);
  const underLoad = Math.abs(d.I) > 10;

  const mirrorIdx = c => {
    if (c.length < 2) return -1;
    const m = c.reduce((a, b) => a + b, 0) / c.length;
    for (let i = 0; i < c.length - 1; i++) {
      const a = c[i] - m, b = c[i + 1] - m;
      if (a * b < 0 && Math.abs(a) > 80 && Math.abs(b) > 80 && Math.abs((c[i] + c[i + 1]) / 2 - m) < 30) return i;
    }
    return -1;
  };

  const mp = mirrorIdx(cs);
  const dead = d.V > 16 ? cs.map((v, i) => (v <= 500 ? i + 1 : 0)).filter(Boolean) : [];
  if (dead.length) {
    add('Обрыв отвода ячейки', 2, tr(`яч. ${dead.join(', ')} ≤500 мВ при сборке ${d.V.toFixed(1)} В — обрыв балансирного провода или мёртвый канал`, `cell ${dead.join(', ')} ≤500 mV at ${d.V.toFixed(1)} V pack — open balance lead or dead AFE channel`));
  }
  if (mp >= 0 && h3.length === 3 && h3.every(h => mirrorIdx(h.cells) === mp)) {
    add('Контакт балансира', 2, tr(`зеркальный сдвиг яч. ${mp + 1} и ${mp + 2} (±>80 мВ при среднем <30 мВ) — плохой контакт отвода балансира`, `mirror swing on cells ${mp + 1} & ${mp + 2} (±>80 mV, pair avg <30 mV) — loose balance tap`));
  }

  add('Сумма ячеек = сборка', Math.abs(sm - d.V) <= SUM_TOL ? 0 : 1, `${sm.toFixed(2)} ${uV} ${tr('против', 'vs')} ${d.V.toFixed(1)} ${uV}`);
  const hi2 = dev.lim ? dev.lim.ov2 : C.vmax, hi1 = dev.lim ? dev.lim.ov1 : C.hiWarn;
  const lo2 = dev.lim ? dev.lim.uv2 : C.loBad, lo1 = dev.lim ? dev.lim.uv1 : C.loWarn;
  add('Ячейки в пределах', mx >= hi2 || mn <= lo2 ? 2 : (mx >= hi1 || mn <= lo1 ? 1 : 0), `${(mn / 1000).toFixed(3)}…${(mx / 1000).toFixed(3)} ${uV}` + (dev.lim ? ` (BMS ${lo2}…${hi2} ${umV})` : ''));

  if (dev.lim && ((dev.chem === 'lfp' && dev.lim.ov2 > 3800) || (dev.chem === 'nmc' && dev.lim.ov2 < 3900))) {
    add('Пороги BMS', 1, tr(`в BMS ${dev.lim.uv2}–${dev.lim.ov2} мВ — не похоже на ${C.name}`, `BMS ${dev.lim.uv2}–${dev.lim.ov2} mV does not match ${C.name}`));
  }

  const spTag = atRest
    ? tr(' (в покое ≥30 с)', ' (at rest ≥30 s)')
    : (underLoad ? tr(` (под нагрузкой ${d.I.toFixed(1)} А — возможен вклад R_вн)`, ` (under ${d.I.toFixed(1)} A load — IR drop possible)`) : '');
  add('Перекос ячеек', sp >= SPREAD_BAD ? 2 : sp >= SPREAD_WARN ? 1 : 0, tr(`${sp} мВ (макс яч. ${cs.indexOf(mx) + 1}, мин яч. ${cs.indexOf(mn) + 1})`, `${sp} mV (max cell ${cs.indexOf(mx) + 1}, min cell ${cs.indexOf(mn) + 1})`) + spTag);

  if (dev.ir) {
    const v = dev.ir.filter(x => x != null);
    if (v.length) {
      const s = [...v].sort((a, b) => a - b);
      const med = s[s.length >> 1];
      const bad = dev.ir.map((r, i) => (r != null && r > 1.5 && r > med * 2 ? i + 1 : 0)).filter(Boolean);
      if (bad.length) {
        add('Сопротивление ячеек', 1, tr(`повышено на яч. ${bad.join(', ')}: ${bad.map(i => dev.ir[i - 1] + ' мОм').join(', ')} (медиана ${med.toFixed(2)})`, `high on cell ${bad.join(', ')}: ${bad.map(i => dev.ir[i - 1] + ' mΩ').join(', ')} (median ${med.toFixed(2)})`));
      }
    }
  }

  if (d.tmax != null) add('Температура', d.tmax >= T_BAD || d.tmin < 0 ? 2 : d.tmax >= T_WARN ? 1 : 0, `${d.tmin}…${d.tmax} °C`);

  const soft = ['SOC низкий', 'SOC высокий'].map(n => (lang === 'ru' ? n : (FEN[n] || n)));
  const fl = decodeFaults(d.fault, lang);
  const hard = fl.filter(x => !soft.some(k => x.startsWith(k)));
  add('Защиты BMS', hard.length ? 2 : 0, fl.length ? fl.join('; ') + (hard.length ? '' : tr(' (SOC не откалиброван, не критично)', ' (SOC not calibrated, not critical)')) : tr('нет', 'none'));

  const sl = calcSlope(dev.hist, d.t);
  const stuckChg = h3.length === 3 && h3.every(h => h.chg === 0 && h.I > 1);
  const stuckDis = h3.length === 3 && h3.every(h => h.dis === 0 && h.I < -1);
  if (stuckChg) {
    add('Ключ заряда', 2, tr(`ключ заряда ВЫКЛ, но ток заряда ${d.I.toFixed(1)} А — возможно пробит/залип ключ`, `charge switch is OFF, yet charge current is ${d.I.toFixed(1)} A — MOSFET may be shorted/stuck`));
  } else if (d.charger && !d.chg) {
    add('Ключ заряда', 2, tr('зарядное подключено, а ключ заряда ВЫКЛ', 'charger is connected but the charge switch is OFF'));
  } else {
    add('Ключ заряда', d.chg ? 0 : 1, d.chg ? tr('вкл', 'on') : tr('выкл (зарядное не обнаружено)', 'off (no charger detected)'));
  }
  if (stuckDis) {
    add('Ключ разряда', 2, tr(`ключ разряда ВЫКЛ, но ток разряда ${(-d.I).toFixed(1)} А — возможно пробит/залип ключ`, `discharge switch is OFF, yet discharge current is ${(-d.I).toFixed(1)} A — MOSFET may be shorted/stuck`));
  }

  if (d.I > 0.3) add('Заряд идёт', 0, tr(`ток ${d.I.toFixed(1)} А`, `current ${d.I.toFixed(1)} A`));
  else if (!d.charger) add('Заряд идёт', 0, d.I < -0.3 ? tr(`разряд ${(-d.I).toFixed(1)} А`, `discharging ${(-d.I).toFixed(1)} A`) : tr('покой (зарядное не подключено)', 'idle (no charger)'));
  else if (sl == null) add('Заряд идёт', 0, tr('копится история (нужно 2 мин)', 'collecting history (needs 2 min)'));
  else if (sl >= RISE_MIN) add('Заряд идёт', 0, tr(`сумма ячеек растёт +${sl.toFixed(1)} мВ/мин`, `cell sum rising +${sl.toFixed(1)} mV/min`));
  else if (mx >= C.top) add('Заряд идёт', 0, tr('ячейки у верха, рост остановился (CV или конец)', 'cells are at the top, rise has stopped (CV or finished)'));
  else add('Заряд идёт', 1, tr(`нет роста напряжения за 5 мин (${sl.toFixed(1)} мВ/мин): заряд не идёт или завершён`, `no voltage rise in 5 min (${sl.toFixed(1)} mV/min): not charging or finished`));

  const p120 = dev.hist.filter(h => h.t >= d.t - 120);
  const dvPack = (p120.length >= 30 && d.t - p120[0].t >= 115 && p120.every(h => h.I === 0)) ? Math.abs(d.sum - p120[0].sum) * 1000 : 0;
  if (dvPack > 80) {
    add('Малый ток (мёртвая зона)', 1, tr(`ток 0 А ≥2 мин, но напряжение сборки изменилось на ${dvPack.toFixed(0)} мВ — возможен скрытый ток ниже порога датчика`, `current 0 A for ≥2 min, yet pack voltage shifted by ${dvPack.toFixed(0)} mV — hidden current below shunt deadband`));
  }

  add('Обрыв заряда', now < dev.badUntil ? 2 : 0, now < dev.badUntil ? tr('недавно напряжение упало: заряд оборвался (см. события)', 'voltage dropped recently: charging was interrupted (see events)') : tr('не было', 'none'));

  if (d.I > 0.3) {
    const cr = d.I / dev.cap;
    add('Ток заряда', d.I > 60 ? 2 : cr > 0.5 ? 1 : 0, tr(`${d.I.toFixed(1)} А = ${cr.toFixed(2)}C (норма 0,1–0,3C = ${(0.1 * dev.cap).toFixed(0)}–${(0.3 * dev.cap).toFixed(0)} А)`, `${d.I.toFixed(1)} A = ${cr.toFixed(2)}C (normal 0.1–0.3C = ${(0.1 * dev.cap).toFixed(0)}–${(0.3 * dev.cap).toFixed(0)} A)`));
  }
  if (mx >= C.top) {
    add('Балансировка у верха', sp <= TOP_SPREAD ? 0 : 1, tr(`перекос ${sp} мВ, цель ≤${TOP_SPREAD}; балансир ${d.bal.some(x => x) ? 'работает' : 'не включён'}`, `spread ${sp} mV, target ≤${TOP_SPREAD}; balancer ${d.bal.some(x => x) ? 'active' : 'off'}`));
  }
  return ck;
}

export function calcMetrics(dev, tr) {
  const d = dev.last;
  if (!d || d.asleep || !d.cells.length) return null;
  const C = dev.C, cs = d.cells, I = d.I, mvA = 735 / dev.cap;
  const avg = cs.reduce((a, b) => a + b, 0) / cs.length;
  const soc = ocvSoc(C.ocv, (avg - mvA * Math.max(I, 0)) / 1000);
  const pts = dev.hist.filter(h => h.t >= d.t - 900);
  let phase = tr('нет заряда', 'not charging'), eta = null;
  if (I > 0.3) {
    phase = tr('CC (постоянный ток)', 'CC (constant current)');
    const rem = (100 - soc) / 100 * dev.cap;
    eta = rem / I * 60 + 60;
    if (pts.length >= 40) {
      const a = pts.slice(0, 10).reduce((x, h) => x + h.I, 0) / 10;
      const b = pts.slice(-10).reduce((x, h) => x + h.I, 0) / 10;
      if (b < a * 0.9 && Math.max(...cs) >= C.top - 50 && b > 0) {
        phase = tr('CV (ток падает)', 'CV (current falling)');
        const k = Math.log(b / a) / ((pts[pts.length - 1].t - pts[0].t) / 60);
        const end = 0.03 * dev.cap;
        eta = b > end && k < 0 ? Math.max(0, Math.log(end / b) / k) : 0;
      }
    }
  }
  const f = dev.long[0], first = f ? f[2] : null, i0 = f ? f[1] : 0;
  const s0 = f ? ocvSoc(C.ocv, (first.reduce((a, b) => a + b, 0) / first.length - mvA * Math.max(i0, 0)) / 1000) : 0;
  const cur = dev.long.map(x => x[1]).filter(x => x > 0.3).sort((a, b) => a - b);
  return {
    phase,
    soc: Math.round(soc),
    eta: eta == null ? null : Math.round(eta),
    cycles: d.cycles,
    cap: dev.cap,
    n: cs.length,
    s0,
    iset: cur.length ? cur[cur.length >> 1] : 0,
    ahIn: dev.ahIn,
    ahOut: dev.ahOut,
    capBms: d.cap
  };
}

export function calcIdeal(I, C) {
  const n = I.n, cap = I.cap, iset = I.iset > 0.3 ? I.iset : 0.1 * cap;
  const vmax = C.vmax / 1000, iend = 0.03 * cap, off = (735 / cap) / 1000, dt = 0.05;
  const V = [], A = [];
  let t = 0, s = Math.min(I.s0 || 0, 95), tcv = null;
  while (t < 80) {
    const vc = ocvV(C.ocv, s) + off * iset;
    if (vc >= vmax) { tcv = t; break; }
    V.push([t, n * vc]);
    A.push([t, iset]);
    s += iset * dt / cap * 100;
    t += dt;
    if (s >= 100) break;
  }
  if (tcv == null) tcv = t;
  const rem = Math.max(0.5, (100 - s) / 100 * cap), tau = rem / iset;
  let tt = tcv;
  for (;;) {
    const i = iset * Math.exp(-(tt - tcv) / tau);
    V.push([tt, n * vmax]);
    A.push([tt, i]);
    if (i <= iend || tt - tcv > 14) break;
    tt += dt;
  }
  return { V, A, tEnd: tt, iset };
}
