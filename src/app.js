import {
  SVC, SVC2, u16, frame, mbFrame, FrameBuffer, decodeFaults,
  decodeD2Poll, decode81Poll, decodeA5Poll, decodeA5Limits, decodeA5RatedCap, decodeA5Serial
} from './proto.js';
import { CHEM, DROP_V, clampDt, estIR, evaluateChecks } from './math.js';
import { lsGetJson, lsSet, buildCsv, uploadDevice } from './store.js';
import { LANG, tr, uV, uA, umV, $, stamp, trDom, audio, glog, alarm, lock, toast, updatePanel } from './ui.js';
import { setupDemo } from './demo.js';

const PERIOD = 2000;
const LONG_STEP = 30;
const MAXLONG = 5760;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SOFT = ['SOC низкий', 'SOC высокий'].map(n => tr(n, n === 'SOC низкий' ? 'SOC low' : 'SOC high'));

export class Dev {
  constructor(device) {
    this.dev = device;
    this.id = device.id;
    this.name = device.name || device.id;
    this.key = 'daly2:' + device.id;
    this.fb = new FrameBuffer(1024);
    this.frames = [];
    this.waiter = null;
    this.rx = null;
    this._onData = e => this.onData(e);
    this.q = Promise.resolve();
    this.hist = [];
    this.long = [];
    this.events = [];
    this.chem = 'lfp';
    this.cap = 105;
    this.last = null;
    this.prev = null;
    this.online = false;
    this.err = tr('подключение…', 'connecting…');
    this.want = true;
    this.running = false;
    this.dirty = true;
    this.badUntil = 0;
    this.ahIn = 0;
    this.ahOut = 0;
    this.t0 = Date.now();
    this.longT = 0;
    this.checks = [];
    this.level = 3;
    this.lim = null;
    this.ir = null;
    this.sn = '';
    this.rcap = null;
    this.limDone = false;
    this.limTries = 0;
    this.proto = null;
    this.upT = 0;
    this.upE = '';
    this.sent = 0;
    this.sentAt = 0;
    this.sentOk = null;
    this.lastTry = 0;
    this.sending = false;
    this.reconnecting = false;
    this.connGen = 0;

    const s = lsGetJson(this.key, {}) || {};
    if (CHEM[s.chem]) this.chem = s.chem;
    if (Number.isFinite(s.cap)) this.cap = Math.min(2000, Math.max(1, s.cap));
    const num = x => typeof x === 'number' && Number.isFinite(x);
    this.long = (Array.isArray(s.long) ? s.long : [])
      .filter(x => Array.isArray(x) && num(x[0]) && num(x[1]) && Array.isArray(x[2]) && x[2].length > 0 && x[2].length <= 32 && x[2].every(c => num(c) && c >= 0 && c < 6000))
      .slice(-MAXLONG);
    this.events = (Array.isArray(s.events) ? s.events : [])
      .filter(e => e && typeof e.t === 'string' && typeof e.text === 'string')
      .slice(0, 200)
      .map(e => ({ t: e.t.slice(0, 25), level: e.level | 0, text: e.text.slice(0, 200) }));
    this.upT = num(s.upT) ? s.upT : 0;
    this.upE = typeof s.upE === 'string' ? s.upE.slice(0, 25) : '';
    this.sent = num(s.sent) ? s.sent : 0;
    this.sentAt = num(s.sentAt) ? s.sentAt : 0;
    this.longT = this.long.length ? this.long[this.long.length - 1][0] : 0;

    device.addEventListener('gattserverdisconnected', () => {
      this.running = false;
      this.fb.reset();
      this.frames = [];
      if (this.waiter) this.waiter();
      this.setOnline(false, tr('связь потеряна', 'connection lost'));
      uploadDevice(this, false, { tr, toast, glog });
      if (this.want) this.reconnect();
    });
  }

  get C() {
    return CHEM[this.chem];
  }

  save() {
    try {
      lsSet(this.key, JSON.stringify({
        chem: this.chem, cap: this.cap, long: this.long.slice(-MAXLONG), events: this.events.slice(0, 200),
        upT: this.upT, upE: this.upE, sent: this.sent, sentAt: this.sentAt
      }));
    } catch (e) {
      glog('история не сохраняется: ' + e);
    }
  }

  event(level, text) {
    this.events.unshift({ t: stamp(), level, text });
    if (this.events.length > 200) this.events.pop();
    this.dirty = true;
    if (level === 2) alarm(this.name + ': ' + text);
  }

  setOnline(on, err) {
    if (on !== this.online) {
      this.event(on ? 0 : 1, on ? tr('связь установлена', 'connected') : tr('связь потеряна: ', 'connection lost: ') + (err || ''));
    }
    this.online = on;
    if (!on) this.err = err || '';
    this.dirty = true;
  }

  async reconnect() {
    if (this.reconnecting) return;
    this.reconnecting = true;
    try {
      for (let i = 0; this.want && !this.running; i++) {
        await sleep(Math.min(3000 + i * 1000, 10000));
        if (!this.want || this.running) return;
        try {
          await this.connect();
        } catch (e) {
          this.err = tr('переподключаюсь… (', 'reconnecting… (') + (i + 1) + ')';
          this.dirty = true;
        }
      }
    } finally {
      this.reconnecting = false;
    }
  }

  async connect() {
    const srv = await this.dev.gatt.connect();
    const s = await srv.getPrimaryService(SVC).catch(() => srv.getPrimaryService(SVC2));
    let cs = [];
    for (let i = 0; i < 4 && !cs.length; i++) {
      try { cs = await s.getCharacteristics(); } catch (e) { await sleep(1000); }
    }
    const rx = cs.find(c => c.uuid.startsWith('0000fff1') || c.uuid.startsWith('0000ff01')) || cs.find(c => c.properties.notify);
    this.tx = cs.find(c => c.uuid.startsWith('0000fff2') || c.uuid.startsWith('0000ff02')) || cs.find(c => c.properties.writeWithoutResponse || c.properties.write);
    if (!rx || !this.tx) {
      throw new Error(tr('нет нужных характеристик (удалите устройство в настройках Bluetooth телефона и добавьте заново)', "required characteristics not found (remove the device in your phone's Bluetooth settings and add it again)"));
    }
    if (this.rx && this.rx !== rx) this.rx.removeEventListener('characteristicvaluechanged', this._onData);
    rx.removeEventListener('characteristicvaluechanged', this._onData);
    rx.addEventListener('characteristicvaluechanged', this._onData);
    this.rx = rx;
    await rx.startNotifications();
    await sleep(200);
    const gen = ++this.connGen;
    this.fb.reset();
    this.frames = [];
    this.running = true;
    this.setOnline(true);
    lock();
    if (!this.proto) await this.detectProto();
    this.loop(gen);
  }

  onData(ev) {
    const dv = ev.target.value;
    const v = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
    this.fb.push(v);
    const extracted = this.fb.extract(this.proto || 'a5');
    if (extracted.length) {
      this.frames.push(...extracted);
      if (this.waiter) this.waiter();
    }
  }

  enqueue(fn) {
    const p = this.q.then(fn, fn);
    this.q = p.catch(() => {});
    return p;
  }

  async _write(pkt) {
    if (this.tx.properties.writeWithoutResponse && this.tx.writeValueWithoutResponse) {
      try {
        await this.tx.writeValueWithoutResponse(pkt);
      } catch (e) {
        if (this.tx.properties.write && this.tx.writeValueWithResponse) await this.tx.writeValueWithResponse(pkt);
        else throw e;
      }
    } else {
      await this.tx.writeValueWithResponse(pkt);
    }
  }

  async _wait(pred, to) {
    const end = Date.now() + to;
    for (;;) {
      const got = this.frames.filter(pred);
      if (got.length || Date.now() >= end || !this.running) return got;
      await new Promise(r => {
        const done = () => { clearTimeout(t); this.waiter = null; r(); };
        const t = setTimeout(done, Math.max(50, end - Date.now()));
        this.waiter = done;
      });
    }
  }

  async _ask(cmd, n = 1, b0 = 0, fill = 0, to = 1500) {
    if (!this.running || !this.tx) return [];
    this.frames = [];
    await this._write(frame(cmd, b0, fill));
    const end = Date.now() + to;
    for (;;) {
      const got = this.frames.filter(f => f[2] === cmd);
      if (got.length >= n || Date.now() >= end || !this.running) return got;
      await new Promise(r => {
        const done = () => { clearTimeout(t); this.waiter = null; r(); };
        const t = setTimeout(done, Math.max(50, end - Date.now()));
        this.waiter = done;
      });
    }
  }

  async _mb(addr, fn, reg, val, to = 1500) {
    if (!this.running || !this.tx) return null;
    this.frames = [];
    await this._write(mbFrame(addr, fn, reg, val));
    const got = await this._wait(
      f => (this.proto === '81' ? (f[0] === 0x51 || f[0] === 0x81) : f[0] === addr) && (f[1] === fn || f[1] === (fn | 0x80)),
      to
    );
    if (!got.length || (got[0][1] & 0x80)) return null;
    return got[0];
  }

  async detectProto() {
    return this.enqueue(async () => {
      this.proto = 'a5';
      this.fb.reset();
      if ((await this._ask(0x90, 1, 0, 0, 600)).length) return;
      this.proto = 'd2';
      this.fb.reset();
      if (await this._mb(0xD2, 3, 0x0000, 0x003E, 600)) return;
      this.proto = '81';
      this.fb.reset();
      if (await this._mb(0x81, 3, 0x0000, 0x0040, 600)) return;
      this.proto = 'a5';
      this.fb.reset();
    });
  }

  ask(cmd, n = 1, b0 = 0) {
    return this.enqueue(() => this._ask(cmd, n, b0));
  }

  async cmd(c, b0, label) {
    if (this.demo) {
      toast(tr('В демо управление BMS недоступно', 'BMS control is unavailable in demo'));
      return;
    }
    if (!this.running || !this.tx) {
      toast(tr('Сначала подключитесь к BMS', 'Connect to BMS first'), 'bad');
      return;
    }
    if (this.proto !== 'a5' && c === 0x00) {
      toast(tr('Сброс недоступен для Modbus BMS', 'Reset is unavailable on Modbus BMS'), 'bad');
      return;
    }
    return this.enqueue(async () => {
      try {
        let ok = false;
        if (this.proto === 'd2') {
          const reg = c === 0xDA ? 0x00A5 : 0x00A6;
          ok = !!(await this._mb(0xD2, 6, reg, b0));
        } else if (this.proto === '81') {
          const reg = c === 0xDA ? 0x0121 : 0x0122;
          ok = !!(await this._mb(0x81, 6, reg, b0));
        } else {
          ok = !!(await this._ask(c, 1, b0)).length;
        }
        if (!ok) throw new Error(tr('нет ответа', 'no response'));
        this.event(1, label);
        glog(label);
        toast(label, 'ok');
        if (c !== 0x00) this.update(await this._poll());
      } catch (e) {
        toast(tr('Команда не выполнена: ', 'Command failed: ') + (e.message || e), 'bad');
        glog(label + ': ' + (e.message || e));
      }
    });
  }

  async _poll() {
    const t = Date.now() / 1000;
    if (this.proto === 'd2') {
      const f = await this._mb(0xD2, 3, 0x0000, 0x003E);
      if (!f) throw new Error(tr('нет ответа', 'no response'));
      try { return decodeD2Poll(f, t); } catch (e) { throw new Error(tr('короткий ответ BMS', 'short BMS response')); }
    }
    if (this.proto === '81') {
      const f1 = await this._mb(0x81, 3, 0x0000, 0x0040);
      const f2 = await this._mb(0x81, 3, 0x0041, 0x003E);
      if (!f1 || !f2) throw new Error(tr('нет ответа', 'no response'));
      try { return decode81Poll(f1, f2, t); } catch (e) { throw new Error(tr('короткий ответ BMS', 'short BMS response')); }
    }

    const r90 = await this._ask(0x90);
    if (!r90.length) throw new Error(tr('нет ответа', 'no response'));
    const r92 = await this._ask(0x92);
    const r93 = await this._ask(0x93);
    const r94 = await this._ask(0x94);
    const nHint = (r94.length && r94[0][4]) || (this.last && this.last.n) || 8;
    const r95 = await this._ask(0x95, Math.ceil(nHint / 3));
    const r97 = await this._ask(0x97);
    const r98 = await this._ask(0x98);
    const d = decodeA5Poll({
      f90: r90[0],
      f92: r92[0],
      f93: r93[0],
      f94: r94[0],
      f95: r95,
      f97: r97[0],
      f98: r98[0],
      prevN: this.last && this.last.n,
      prevFault: this.last ? this.last.fault : [],
      t
    });

    if (!this.limDone && !d.asleep) {
      this.limTries++;
      let gotAny = false;
      const l = await this._ask(0x59, 1, 0xAA, 0xAA, 500);
      const lim = decodeA5Limits(l[0]);
      if (lim) {
        gotAny = true;
        this.lim = lim;
        glog(tr(`пороги BMS: ${lim.uv2}–${lim.ov2} мВ`, `BMS limits: ${lim.uv2}–${lim.ov2} mV`));
      } else if (l.length) gotAny = true;

      const p0 = await this._ask(0x50, 1, 0xAA, 0xAA, 500);
      const rcap = decodeA5RatedCap(p0[0]);
      if (rcap) {
        gotAny = true;
        this.rcap = rcap;
        glog(tr(`паспорт BMS: ${this.rcap} А·ч`, `BMS rated cap: ${this.rcap} Ah`));
      } else if (p0.length) gotAny = true;

      const s57 = await this._ask(0x57, 5, 0xAA, 0xAA, 500);
      if (s57.length) {
        gotAny = true;
        const sn = decodeA5Serial(s57);
        if (sn) {
          this.sn = sn;
          glog(tr('код BMS: ', 'BMS code: ') + sn);
        }
      }
      if (gotAny || this.limTries >= 3) this.limDone = true;
    }
    return d;
  }

  poll() {
    return this.enqueue(() => this._poll());
  }

  async loop(gen) {
    while (this.running && gen === this.connGen) {
      const t0 = Date.now();
      try {
        this.update(await this.poll());
      } catch (e) {
        if (this.running && gen === this.connGen) {
          this.err = String(e.message || e);
          this.dirty = true;
        }
      }
      await sleep(Math.max(100, PERIOD - (Date.now() - t0)));
    }
  }

  detect(d) {
    const p = this.prev;
    if (p && !d.asleep && !p.asleep) {
      [['chg', tr('ключ заряда', 'charge switch')], ['dis', tr('ключ разряда', 'discharge switch')], ['charger', tr('зарядное', 'charger')]].forEach(([k, nm]) => {
        if (d[k] !== p[k] && d[k] != null) {
          this.event(k !== 'chg' || d[k] ? 1 : 2, `${nm}: ${d[k] ? tr('вкл', 'on') : tr('выкл', 'off')}`);
        }
      });
      if (String(d.fault) !== String(p.fault)) {
        const fl = decodeFaults(d.fault, LANG);
        this.event(fl.some(x => !SOFT.some(k => x.startsWith(k))) ? 2 : 1, tr('защиты: ', 'protections: ') + (fl.join('; ') || tr('сняты', 'cleared')));
      }
      const old = this.hist.find(h => h.sum && h.t >= d.t - 70 && h.t <= d.t - 50);
      const sm = d.cells.length ? d.cells.reduce((a, b) => a + b, 0) / 1000 : 0;
      if (d.cells.length && old && old.sum - sm >= DROP_V && (p.chg || d.I > 0.3 || p.I > 0.3)) {
        this.event(2, tr(`заряд оборвался: сумма ячеек упала на ${(old.sum - sm).toFixed(2)} В за минуту`, `charging interrupted: cell sum dropped by ${(old.sum - sm).toFixed(2)} V in a minute`));
        this.badUntil = Date.now() + 600000;
      }
    }
    if (p && d.asleep !== p.asleep) {
      this.event(1, d.asleep ? tr('BMS уснула', 'BMS fell asleep') : tr('BMS проснулась', 'BMS woke up'));
    }
  }

  update(d, silent = false) {
    d.sum = d.cells.length ? d.cells.reduce((a, b) => a + b, 0) / 1000 : 0;
    if (this.prev && !d.asleep) {
      const dt = clampDt(d.t, this.prev.t);
      if (d.I > 0) this.ahIn += d.I * dt / 3600;
      else this.ahOut += -d.I * dt / 3600;
    }
    if (!silent) this.detect(d);
    this.hist.push(d);
    if (this.hist.length > 1800) this.hist.shift();
    if (!silent) {
      if (!d.asleep && d.cells.length) {
        const ir = estIR(this.hist, d, this.C);
        if (ir) this.ir = ir;
      }
      this.checks = evaluateChecks(this, d, { lang: LANG, tr, uV, uA, umV });
      this.level = Math.max(...this.checks.map(c => c.level));
    }
    if (!d.asleep && d.cells.length && d.t - this.longT >= LONG_STEP) {
      this.longT = d.t;
      const flt = (d.fault || []).map(b => b.toString(16).padStart(2, '0')).join('');
      this.long.push([Math.round(d.t), d.I, d.cells, d.bal, {
        V: d.V, soc: d.soc, tmin: d.tmin, tmax: d.tmax, st: d.state,
        chg: d.chg, dis: d.dis, chgr: d.charger, load: d.load, cap: d.cap,
        flt: /^0*$/.test(flt) ? '' : flt
      }]);
      if (this.long.length > MAXLONG) this.long.shift();
      if (!silent && this.long.length % 4 === 0) this.save();
    }
    this.prev = this.last = d;
    this.err = '';
    this.dirty = true;
  }

  csv() {
    return buildCsv(this.long, this.events);
  }
}

const devs = new Map();
const panels = new Map();

async function addDevice(all) {
  audio();
  try { Notification.requestPermission && Notification.requestPermission(); } catch (e) {}
  try {
    const opt = all
      ? { acceptAllDevices: true, optionalServices: [SVC, SVC2] }
      : { filters: [{ namePrefix: 'DL-' }, { services: [SVC] }, { services: [SVC2] }], optionalServices: [SVC, SVC2] };
    const device = await navigator.bluetooth.requestDevice(opt);
    if (devs.has(device.id)) {
      const o = devs.get(device.id);
      if (!o.running) {
        o.want = true;
        o.dirty = true;
        o.reconnect();
      }
      glog(tr('уже добавлена: ', 'already added: ') + o.name);
      return;
    }
    const dv = new Dev(device);
    devs.set(device.id, dv);
    $('hero').style.display = 'none';
    updatePanel(dv, panels, true, { devs, panels, uploadDevice });
    glog(tr('подключаю ', 'connecting ') + dv.name + tr(', в истории ', ', history: ') + dv.long.length + tr(' точек', ' points'));
    try {
      await dv.connect();
    } catch (e) {
      dv.err = String(e.message || e);
      dv.dirty = true;
      glog(dv.name + ': ' + dv.err);
      dv.reconnect();
    }
  } catch (e) {
    glog(tr('не подключилось: ', 'could not connect: ') + e.message);
    if (/not supported on this platform/i.test(e.message)) {
      $('sup').innerHTML = tr('<b>Этот браузер не поддерживает Bluetooth.</b> Откройте ссылку в Google Chrome (не во встроенном браузере телефона, не в Яндексе, Samsung Internet или Telegram). В Android включите Bluetooth и геолокацию, дайте Chrome разрешение «Устройства поблизости».', '<b>This browser does not support Bluetooth.</b> Open the link in Google Chrome (not in an in-app browser, Yandex, Samsung Internet or Telegram). On Android turn on Bluetooth and location and allow Chrome the "Nearby devices" permission.');
    }
  }
}

$('add').onclick = () => addDevice(false);
$('addall').onclick = () => addDevice(true);

const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const badBrowser = isIOS || !navigator.bluetooth || !/Chrome\/|Edg\//i.test(ua) || /SamsungBrowser|YaBrowser|OPR\/|UCBrowser|MiuiBrowser|VivoBrowser|; wv\)|Telegram|FB_IAB|FBAN/i.test(ua);

document.documentElement.lang = LANG;
trDom(document.body);
if (LANG === 'en') {
  document.title = 'Daly BMS Monitor';
  const m = document.querySelector('meta[name=description]');
  if (m) m.content = 'Daly Smart BMS monitor over Bluetooth: charge charts, cells, balancing, checks.';
}
$('lang').textContent = LANG === 'ru' ? 'EN' : 'RU';
$('lang').onclick = () => {
  lsSet('daly2:lang', LANG === 'ru' ? 'en' : 'ru');
  const q = new URLSearchParams(location.search);
  q.delete('lang');
  location.search = q.toString();
};

if (badBrowser) {
  const msg = isIOS
    ? tr('На iPhone и iPad работа с Bluetooth (Web Bluetooth) в браузерах, включая Chrome, не поддерживается. Откройте сайт в Google Chrome на Android или в Chrome / Edge на компьютере. Демо-режим работает и здесь.', 'On iPhone and iPad, Web Bluetooth is not supported in browsers (including Chrome). Open this site in Google Chrome on Android or in Chrome / Edge on a computer. Demo mode still works here.')
    : tr('Этот браузер не поддерживает Bluetooth. Откройте сайт в Google Chrome на Android или в Chrome / Edge на компьютере. Демо-режим работает и здесь.', 'This browser does not support Bluetooth. Open this site in Google Chrome on Android or in Chrome / Edge on a computer. Demo mode still works here.');
  $('add').disabled = true;
  $('addall').disabled = true;
  $('sup').innerHTML = `<b>${tr('Откройте в Google Chrome для BMS', 'Open in Google Chrome for BMS')}</b><br>${msg}`;
}

setupDemo({ devs, panels, DevClass: Dev, updatePanel, uploadDevice, toast });

setInterval(() => devs.forEach(d => uploadDevice(d, false, { tr, toast, glog })), 60000);
setInterval(() => { if (!document.hidden) devs.forEach(d => updatePanel(d, panels, false, { devs, panels, uploadDevice })); }, 2000);
addEventListener('beforeunload', () => devs.forEach(d => d.save()));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && devs.size) {
    lock();
    devs.forEach(d => updatePanel(d, panels, true, { devs, panels, uploadDevice }));
  }
});

const updClock = () => {
  if (document.hidden) return;
  const d = new Date(), p = n => String(n).padStart(2, '0');
  $('clock').textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
updClock();
setInterval(updClock, 1000);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
