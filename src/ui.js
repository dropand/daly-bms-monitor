import { calcMetrics } from './math.js';
import { esc, lsGet, lsGetJson, lsSet, cloudLine } from './store.js';
import { renderCharts } from './charts.js';

export const LANG = (() => {
  let l = '';
  const m = /[?&]lang=(en|ru)\b/.exec(location.search);
  l = m ? m[1] : lsGet('daly2:lang', '');
  if (l !== 'en' && l !== 'ru') l = /^(ru|uk|be|kk)\b/i.test(navigator.language || '') ? 'ru' : 'en';
  return l;
})();

export const tr = (ru, en) => (LANG === 'ru' ? ru : en);
export const uV = tr('В', 'V');
export const uA = tr('А', 'A');
export const umV = tr('мВ', 'mV');
export const $ = id => document.getElementById(id);

export const fh = m => (m == null ? '—' : (m >= 60 ? Math.floor(m / 60) + tr(' ч ', ' h ') + String(m % 60).padStart(2, '0') + tr(' мин', ' min') : m + tr(' мин', ' min')));

export const stamp = () => {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

export const L = [
  tr('РАБОТАЕТ ПРАВИЛЬНО', 'WORKING CORRECTLY'),
  tr('ВНИМАНИЕ', 'ATTENTION'),
  tr('НЕИСПРАВНОСТЬ / НЕТ СВЯЗИ', 'FAULT / NO CONNECTION')
];

let ac = null;
export const audio = () => {
  try {
    ac = ac || new AudioContext();
    ac.resume();
  } catch (e) {}
};

export const glog = m => {
  const e = $('log');
  if (!e) return;
  const d = document.createElement('div');
  d.textContent = stamp().slice(11) + ' ' + m;
  e.prepend(d);
  while (e.children.length > 30) e.lastChild.remove();
};

let lastAlarm = 0;
export function alarm(msg) {
  glog(tr('СИГНАЛ: ', 'ALARM: ') + msg);
  if (Date.now() - lastAlarm < 60000) return;
  lastAlarm = Date.now();
  try { navigator.vibrate && navigator.vibrate([400, 150, 400, 150, 400]); } catch (e) {}
  try {
    if (ac) {
      for (let i = 0; i < 5; i++) {
        const o = ac.createOscillator(), g = ac.createGain();
        o.frequency.value = i % 2 ? 880 : 660;
        o.connect(g);
        g.connect(ac.destination);
        g.gain.value = 0.25;
        o.start(ac.currentTime + i * 0.35);
        o.stop(ac.currentTime + i * 0.35 + 0.28);
      }
    }
  } catch (e) {}
  try {
    if (Notification.permission === 'granted' && navigator.serviceWorker) {
      navigator.serviceWorker.ready.then(r => r.showNotification('Daly BMS', { body: msg, vibrate: [300, 100, 300], tag: 'daly' }));
    }
  } catch (e) {}
}

export async function lock() {
  try {
    await navigator.wakeLock.request('screen');
  } catch (e) {}
}

export function toast(msg, kind) {
  const t = $('toast'), d = document.createElement('div');
  d.textContent = msg;
  if (kind) d.className = kind;
  t.appendChild(d);
  setTimeout(() => d.remove(), 4500);
  while (t.children.length > 3) t.firstChild.remove();
}

export const DICT = {
  'Daly BMS монитор': 'Daly BMS Monitor',
  'Подключите Daly BMS': 'Connect your Daly BMS',
  'Включите BMS и закройте приложение Smart BMS.': 'Turn the BMS on and close the Smart BMS app.',
  '⚡ Ячейки': '⚡ Cells',
  '⏱ CC / CV': '⏱ CC / CV',
  '🛡 Защиты': '🛡 Protections',
  'Подключить BMS': 'Connect BMS',
  'Демо без BMS': 'Demo without a BMS',
  'Все Bluetooth-устройства': 'All Bluetooth devices',
  'Журнал': 'Log',
  'заряд, ≈%': 'charge, ≈%',
  'Заряд: идеал и сейчас': 'Charge: ideal vs now',
  'сейчас': 'now',
  'идеал': 'ideal',
  'предел ячейки': 'cell limit',
  'Ячейки и балансировка': 'Cells and balancing',
  '■ выше среднего': '■ above average',
  '■ ниже среднего': '■ below average',
  '⚖ балансир работает': '⚖ balancing active',
  'Перекос ячеек': 'Cell spread',
  '■ цель ≤30 мВ': '■ target ≤30 mV',
  '■ допуск ≤150': '■ limit ≤150',
  'Ресурс': 'Lifetime',
  'Настройки и данные': 'Settings and data',
  'Химия': 'Chemistry',
  'Ёмкость, А·ч': 'Capacity, Ah',
  'Скачать CSV': 'Download CSV',
  'Поделиться': 'Share',
  'Отправить сейчас': 'Upload now',
  'Очистить историю': 'Clear history',
  'Отключить': 'Disconnect',
  'Управление BMS:': 'BMS control:',
  'Ключ заряда': 'Charge switch',
  'Ключ разряда': 'Discharge switch',
  'Сброс BMS': 'Reset BMS',
  'Ёмкость нужна для оценки времени до конца заряда и «идеальной» кривой. Химия задаёт предел ячейки (3,65 В для LiFePO4, 4,2 В для NMC).': 'Capacity is used for the time-to-full estimate and the "ideal" curve. Chemistry sets the cell limit (3.65 V for LiFePO4, 4.2 V for NMC).',
  'События': 'Events'
};

export function trDom(root) {
  if (LANG === 'ru') return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const s = n.nodeValue.trim();
    if (DICT[s]) n.nodeValue = n.nodeValue.replace(s, DICT[s]);
  }
}

export function createPanel(dv, { devs, panels, uploadDevice }) {
  const el = $('tpl').content.firstElementChild.cloneNode(true);
  $('root').appendChild(el);
  const q = s => el.querySelector(s);

  q('.chem').value = dv.chem;
  q('.cap').value = dv.cap;
  q('.chem').onchange = () => { dv.chem = q('.chem').value; dv.dirty = true; dv.save(); updatePanel(dv, panels, true); };
  q('.cap').onchange = () => { dv.cap = Math.max(1, +q('.cap').value || 105); dv.dirty = true; dv.save(); updatePanel(dv, panels, true); };
  q('.bcloud').onclick = () => uploadDevice(dv, true, { tr, toast, glog });
  q('.bdis').onclick = () => {
    if (dv.want) {
      dv.want = false;
      dv.running = false;
      try { dv.dev.gatt.disconnect(); } catch (e) {}
      dv.setOnline(false, tr('отключено пользователем', 'disconnected by user'));
    } else {
      dv.want = true;
      dv.err = tr('подключение…', 'connecting…');
      dv.dirty = true;
      dv.connect().catch(e => {
        dv.err = String(e.message || e);
        dv.dirty = true;
        dv.reconnect();
      });
    }
    updatePanel(dv, panels, true);
  };
  q('.bclr').onclick = () => {
    if (confirm(tr('Стереть историю и события этой BMS?', 'Erase the history and events of this BMS?'))) {
      dv.long = [];
      dv.events = [];
      dv.ahIn = dv.ahOut = 0;
      dv.t0 = Date.now();
      dv.dirty = true;
      dv.save();
      updatePanel(dv, panels, true);
    }
  };
  q('.bchg').onclick = () => {
    if (!dv.last || dv.last.chg == null) {
      toast(tr('Сначала дождитесь данных от BMS', 'Wait for BMS data first'), 'bad');
      return;
    }
    const on = !dv.last.chg;
    if (confirm(on ? tr('Включить (открыть) ключ заряда на BMS?', 'Turn ON (enable) the charge switch on BMS?') : tr('Выключить (закрыть) ключ заряда? Зарядка прекратится.', 'Turn OFF (disable) the charge switch? Charging will stop.'))) {
      dv.cmd(0xDA, on ? 1 : 0, tr('команда: ключ заряда ', 'command: charge switch ') + (on ? tr('вкл', 'on') : tr('выкл', 'off')));
    }
  };
  q('.bdisw').onclick = () => {
    if (!dv.last || dv.last.dis == null) {
      toast(tr('Сначала дождитесь данных от BMS', 'Wait for BMS data first'), 'bad');
      return;
    }
    const on = !dv.last.dis;
    if (confirm(on ? tr('Включить (открыть) ключ разряда на BMS?', 'Turn ON (enable) the discharge switch on BMS?') : tr('Выключить (закрыть) ключ разряда? Нагрузка будет обесточена.', 'Turn OFF (disable) the discharge switch? Load will be disconnected.'))) {
      dv.cmd(0xD9, on ? 1 : 0, tr('команда: ключ разряда ', 'command: discharge switch ') + (on ? tr('вкл', 'on') : tr('выкл', 'off')));
    }
  };
  q('.brst').onclick = () => {
    if (confirm(tr('Перезагрузить (сбросить) BMS? Связь кратковременно прервётся.', 'Reboot (reset) the BMS? Connection will briefly drop.'))) {
      dv.cmd(0x00, 0, tr('команда: сброс BMS', 'command: BMS reset'));
    }
  };

  const file = () => new File([dv.csv()], `daly_${dv.name.replace(/[^\w.-]+/g, '_')}_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`, { type: 'text/csv' });
  q('.bcsv').onclick = () => {
    const f = file(), a = document.createElement('a'), u = URL.createObjectURL(f);
    a.href = u;
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  };
  q('.bshare').onclick = async () => {
    const f = file();
    try {
      if (navigator.canShare && navigator.canShare({ files: [f] })) await navigator.share({ files: [f], title: 'Daly BMS' });
      else q('.bcsv').click();
    } catch (e) {}
  };

  const SH = lsGetJson('daly2:shut', {}) || {};
  el.querySelectorAll('.card>h2').forEach(h => {
    const c = h.parentElement, k = h.textContent.trim();
    if (SH[k] === undefined ? (/Перекос|Ресурс/.test(k) && matchMedia('(max-width:600px)').matches) : SH[k]) {
      c.classList.add('shut');
    }
    h.onclick = () => {
      c.classList.toggle('shut');
      SH[k] = c.classList.contains('shut');
      lsSet('daly2:shut', JSON.stringify(SH));
      if (!c.classList.contains('shut')) devs.forEach(d => updatePanel(d, panels, true));
    };
  });

  trDom(el);
  const P = { el, q };
  panels.set(dv.id, P);
  return P;
}

export function updatePanel(dv, panels, force = false, deps = null) {
  let P = panels.get(dv.id);
  if (!P) {
    if (!deps) return;
    P = createPanel(dv, deps);
    force = true;
  }
  if (!force && !dv.dirty) return;
  dv.dirty = false;

  const q = P.q, d = dv.last, I = calcMetrics(dv, tr), lv = !dv.online ? 2 : (dv.last ? dv.level : 3);
  q('.ban').className = 'ban l' + lv;
  q('.nm').textContent = dv.name;
  q('.st').textContent = !dv.last && dv.online ? tr('ЖДУ ДАННЫЕ', 'WAITING FOR DATA') : L[lv === 3 ? 1 : lv];
  q('.pc').textContent = I ? I.soc : '–';
  q('.g1').setAttribute('stroke-dasharray', (I ? I.soc : 0) + ' 100');
  q('.eta').textContent = !dv.online
    ? (tr('Нет связи', 'No connection') + (dv.err ? ': ' + dv.err : '') + tr(' — закройте Smart BMS, поднесите телефон ближе или подключите зарядку на 2 с', ' — close Smart BMS app, move closer, or connect charger for 2 s'))
    : (I && I.eta != null ? `${tr('До конца заряда', 'Time to full')} ≈ ${fh(I.eta)} (${tr('к', 'by')} ${new Date(Date.now() + I.eta * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}) · ${I.phase}` : (I ? I.phase : ''));
  q('.kp').innerHTML = d ? `<div><b>${d.V.toFixed(1)} ${uV}</b>${tr('сборка', 'pack')}</div><div><b>${d.I.toFixed(1)} ${uA}</b>${tr('ток', 'current')}</div><div><b>${d.tmax ?? '—'} °C</b>${tr('температура', 'temperature')}</div>` : '';
  q('.cloud').textContent = cloudLine(dv, tr);
  if (!dv.demo) q('.bdis').textContent = dv.want ? tr('Отключить', 'Disconnect') : tr('Подключить', 'Reconnect');
  q('.bchg').textContent = tr('Ключ заряда', 'Charge switch') + (d && d.chg != null ? ': ' + (d.chg ? tr('ВКЛ', 'ON') : tr('ВЫКЛ', 'OFF')) : '');
  q('.bdisw').textContent = tr('Ключ разряда', 'Discharge switch') + (d && d.dis != null ? ': ' + (d.dis ? tr('ВКЛ', 'ON') : tr('ВЫКЛ', 'OFF')) : '');
  q('.chips').innerHTML = dv.checks.map(c => `<span class="chip c${c.level}"><i></i>${esc(c.name)}</span>`).join('');
  q('.issues').innerHTML = dv.checks.filter(c => c.level > 0).map(c => `<div class="i${c.level}">${esc(c.name)}: ${esc(c.text)}</div>`).join('');

  if (d && d.cells.length) {
    const C = dv.C, cs = d.cells, mx = Math.max(...cs), mn = Math.min(...cs);
    const m = cs.reduce((a, v) => a + v, 0) / cs.length, lo = C.loBad + 200, hi = C.vmax + 50;
    const pos = v => Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100));
    q('.bats').innerHTML = cs.map((v, i) => `<div class="b1 ${v === mx && mx !== mn ? 'mx' : v === mn && mx !== mn ? 'mn' : ''}"><div class="tube"><i style="height:${pos(v)}%"></i><u style="bottom:${pos(m)}%"></u></div><b>${(v / 1000).toFixed(3)}</b><span>${i + 1}${d.bal && d.bal[i] ? ' <em class="bal">⚖</em>' : ''}</span></div>`).join('');
  }

  q('.res').innerHTML = I
    ? `<div><b>${I.cycles ?? '—'}</b>${tr('циклов (типовой ресурс ~3000)', 'cycles (typical life ~3000)')}<div class="rb"><i style="width:${Math.min(100, (I.cycles || 0) / 3000 * 100)}%"></i></div></div><div><b>${I.ahIn.toFixed(2)}</b>${tr('принято А·ч', 'charged, Ah')}</div><div><b>${I.ahOut.toFixed(2)}</b>${tr('отдано А·ч', 'discharged, Ah')}</div><div><b>${I.capBms ?? '—'}</b>${tr('остаток по BMS, А·ч', 'remaining per BMS, Ah')}</div>`
      + (dv.ir ? `<div><b>${dv.ir.map(r => r ?? '—').join(' / ')}</b>${tr('R_вн ячеек, мОм', 'cell IR, mΩ')}</div>` : '')
      + (dv.lim ? `<div><b>${dv.lim.uv2}–${dv.lim.ov2}</b>${tr('пороги BMS, мВ', 'BMS limits, mV')}</div>` : '')
      + (dv.rcap || dv.sn ? `<div><b>${[dv.rcap ? dv.rcap + ' А·ч' : '', dv.sn ? esc(dv.sn) : ''].filter(Boolean).join(' · ')}</b>${tr('паспорт BMS', 'BMS info')}</div>` : '')
    : '';
  q('.evl').innerHTML = dv.events.slice(0, 15).map(e => `<div class="e${e.level}">${esc(e.t.slice(5))}  ${esc(e.text)}</div>`).join('') || tr('пока нет', 'none yet');
  renderCharts(dv, I, P, { tr, uV, uA, umV });
}
