export const SVC = 0xfff0;
export const SVC2 = 0xff00;

export const u16 = (f, i) => (f[i] << 8) | f[i + 1];

export const frame = (cmd, b0 = 0, fill = 0) => {
  const f = [0xA5, 0x40, cmd, 8, b0, fill, fill, fill, fill, fill, fill, fill];
  f.push(f.reduce((a, b) => a + b) & 255);
  return new Uint8Array(f);
};

export const crc16 = (b, n = b.length) => {
  let c = 0xFFFF;
  for (let i = 0; i < n; i++) {
    c ^= b[i];
    for (let j = 0; j < 8; j++) c = (c & 1) ? (c >>> 1) ^ 0xA001 : c >>> 1;
  }
  return c;
};

export const mbFrame = (a, fn, reg, val) => {
  const b = [a, fn, reg >> 8, reg & 255, val >> 8, val & 255];
  const c = crc16(b);
  b.push(c & 255, c >> 8);
  return new Uint8Array(b);
};

export class FrameBuffer {
  constructor(max = 1024) {
    this.MAX = max;
    this.buf = new Uint8Array(max);
    this.head = 0;
    this.tail = 0;
  }

  reset() {
    this.head = 0;
    this.tail = 0;
  }

  get length() {
    return this.tail - this.head;
  }

  push(bytes) {
    if (!bytes || !bytes.length) return;
    const len = bytes.length;
    if (len >= this.MAX) {
      this.buf.set(bytes.subarray(len - this.MAX), 0);
      this.head = 0;
      this.tail = this.MAX;
      return;
    }
    if (this.tail + len > this.MAX) {
      const active = this.tail - this.head;
      if (active > 0) this.buf.copyWithin(0, this.head, this.tail);
      this.head = 0;
      this.tail = active;
      if (this.tail + len > this.MAX) {
        const drop = this.tail + len - this.MAX;
        this.buf.copyWithin(0, drop, this.tail);
        this.tail -= drop;
      }
    }
    this.buf.set(bytes, this.tail);
    this.tail += len;
  }

  extract(proto) {
    const out = [];
    const b = this.buf;
    if (proto === 'd2' || proto === '81') {
      const okA = a => (proto === 'd2' ? a === 0xD2 : (a === 0x51 || a === 0x81));
      while (this.tail - this.head >= 3) {
        if (!okA(b[this.head])) {
          this.head++;
          continue;
        }
        const fn = b[this.head + 1];
        const len = fn === 0x03 ? b[this.head + 2] + 5 : fn === 0x06 ? 8 : (fn & 0x80) ? 5 : 0;
        if (!len || len > 260) {
          this.head++;
          continue;
        }
        if (this.tail - this.head < len) break;
        const expectedCrc = b[this.head + len - 2] | (b[this.head + len - 1] << 8);
        if (crc16(b.subarray(this.head, this.head + len - 2)) !== expectedCrc) {
          this.head++;
          continue;
        }
        out.push(b.slice(this.head, this.head + len));
        this.head += len;
      }
    } else {
      while (this.tail - this.head >= 13) {
        const idx = b.indexOf(0xA5, this.head);
        if (idx < 0 || idx >= this.tail) {
          this.head = 0;
          this.tail = 0;
          break;
        }
        this.head = idx;
        if (this.tail - this.head < 13) break;
        let sum = 0;
        for (let k = 0; k < 12; k++) sum += b[this.head + k];
        if ((sum & 255) !== b[this.head + 12]) {
          this.head++;
          continue;
        }
        out.push(b.slice(this.head, this.head + 13));
        this.head += 13;
      }
    }
    if (this.head >= this.tail) {
      this.head = 0;
      this.tail = 0;
    }
    return out;
  }
}

export const FAULTS = [
  [0, [0, 1], 'перенапряжение ячейки'], [0, [2, 3], 'недонапряжение ячейки'],
  [0, [4, 5], 'перенапряжение сборки'], [0, [6, 7], 'недонапряжение сборки'],
  [1, [0, 1], 'перегрев при заряде'], [1, [2, 3], 'холод при заряде'],
  [1, [4, 5], 'перегрев при разряде'], [1, [6, 7], 'холод при разряде'],
  [2, [0, 1], 'перегрузка заряда'], [2, [2, 3], 'перегрузка разряда'],
  [2, [4, 5], 'SOC высокий'], [2, [6, 7], 'SOC низкий'],
  [3, [0, 1], 'перекос напряжений'], [3, [2, 3], 'перекос температур'],
  [4, [0], 'перегрев ключа заряда'], [4, [1], 'перегрев ключа разряда'],
  [4, [2], 'датчик ключа заряда'], [4, [3], 'датчик ключа разряда'],
  [4, [4], 'залип ключ заряда'], [4, [5], 'залип ключ разряда'],
  [4, [6], 'обрыв ключа заряда'], [4, [7], 'обрыв ключа разряда'],
  [5, [0], 'сбой AFE'], [5, [1], 'ячейка не читается'],
  [5, [2], 'датчик температуры'], [5, [3], 'EEPROM'],
  [5, [4], 'RTC'], [5, [5], 'предзаряд'],
  [5, [6], 'связь'], [5, [7], 'внутренняя связь'],
  [6, [0], 'датчик тока'], [6, [1], 'датчик напряжения'],
  [6, [2], 'короткое замыкание'], [6, [3], 'заряд запрещён: низкое напряжение']
];

export const FEN = {
  'перенапряжение ячейки': 'cell overvoltage',
  'недонапряжение ячейки': 'cell undervoltage',
  'перенапряжение сборки': 'pack overvoltage',
  'недонапряжение сборки': 'pack undervoltage',
  'перегрев при заряде': 'overtemperature (charge)',
  'холод при заряде': 'undertemperature (charge)',
  'перегрев при разряде': 'overtemperature (discharge)',
  'холод при разряде': 'undertemperature (discharge)',
  'перегрузка заряда': 'charge overcurrent',
  'перегрузка разряда': 'discharge overcurrent',
  'SOC высокий': 'SOC high',
  'SOC низкий': 'SOC low',
  'перекос напряжений': 'voltage imbalance',
  'перекос температур': 'temperature imbalance',
  'перегрев ключа заряда': 'charge MOSFET overheat',
  'перегрев ключа разряда': 'discharge MOSFET overheat',
  'датчик ключа заряда': 'charge MOSFET sensor',
  'датчик ключа разряда': 'discharge MOSFET sensor',
  'залип ключ заряда': 'charge MOSFET stuck',
  'залип ключ разряда': 'discharge MOSFET stuck',
  'обрыв ключа заряда': 'charge MOSFET open',
  'обрыв ключа разряда': 'discharge MOSFET open',
  'сбой AFE': 'AFE failure',
  'ячейка не читается': 'cell read failure',
  'датчик температуры': 'temperature sensor',
  EEPROM: 'EEPROM',
  RTC: 'RTC',
  'предзаряд': 'precharge',
  'связь': 'communication',
  'внутренняя связь': 'internal communication',
  'датчик тока': 'current sensor',
  'датчик напряжения': 'voltage sensor',
  'короткое замыкание': 'short circuit',
  'заряд запрещён: низкое напряжение': 'charging inhibited: low voltage'
};

export function decodeFaults(b, lang = 'ru') {
  const out = [];
  if (!b) return out;
  const tf = n => (lang === 'ru' ? n : (FEN[n] || n));
  FAULTS.forEach(([by, bits, n]) => {
    bits.forEach((bit, l) => {
      if (by < b.length && ((b[by] >> bit) & 1)) {
        out.push(tf(n) + (bits.length > 1 ? (lang === 'ru' ? ' (ур. ' : ' (lvl ') + (l + 1) + ')' : ''));
      }
    });
  });
  if (b.length > 7 && b[7]) {
    out.push((lang === 'ru' ? 'код ошибки: ' : 'fault code: ') + b[7]);
  }
  return out;
}

export function decodeD2Poll(f, t = Date.now() / 1000) {
  if (!f || f[2] < 110 || f.length < f[2] + 5) throw new Error('SHORT_RESPONSE');
  const p = f.slice(3, -2);
  const n = Math.min(u16(p, 98) || 8, 32);
  const nt = Math.min(u16(p, 100) || 0, 8);
  const cells = [];
  for (let i = 0; i < n; i++) cells.push(u16(p, i * 2));
  const ts = [];
  for (let i = 0; i < nt; i++) {
    const temp = u16(p, 64 + i * 2);
    if (temp > 0 && temp < 255) ts.push(temp - 40);
  }
  const d = {
    t,
    n,
    cells,
    V: u16(p, 80) / 10,
    I: (u16(p, 82) - 30000) / 10,
    soc: u16(p, 84) / 10,
    state: u16(p, 94),
    cap: u16(p, 96) / 10,
    cycles: u16(p, 102),
    chg: u16(p, 106) ? 1 : 0,
    dis: u16(p, 108) ? 1 : 0,
    charger: null,
    load: null,
    bal: [],
    fault: []
  };
  if (ts.length) {
    d.tmax = Math.max(...ts);
    d.tmin = Math.min(...ts);
  }
  d.asleep = d.V === 0 && (!d.cells.length || !d.cells.some(x => x));
  return d;
}

export function decode81Poll(f1, f2, t = Date.now() / 1000) {
  if (!f1 || !f2 || f1[2] < 124 || f1.length < f1[2] + 5 || f2[2] < 38 || f2.length < f2[2] + 5) {
    throw new Error('SHORT_RESPONSE');
  }
  const p1 = f1.slice(3, -2);
  const p2 = f2.slice(3, -2);
  const n = Math.min(u16(p1, 120) || 8, 48);
  const nt = Math.min(u16(p1, 122) || 0, 8);
  const cells = [];
  for (let i = 0; i < n; i++) cells.push(u16(p1, i * 2));
  const ts = [];
  for (let i = 0; i < nt; i++) {
    const temp = u16(p1, 96 + i * 2);
    if (temp > 0 && temp < 255) ts.push(temp - 40);
  }
  const I = (u16(p1, 114) - 30000) / 10;
  const d = {
    t,
    n,
    cells,
    V: u16(p1, 112) / 10,
    I,
    soc: u16(p1, 116) / 10,
    cap: u16(p2, 20) / 10,
    cycles: u16(p2, 22),
    chg: u16(p2, 34) ? 1 : 0,
    dis: u16(p2, 36) ? 1 : 0,
    state: I > 0.3 ? 1 : (I < -0.3 ? 2 : 0),
    charger: null,
    load: null,
    bal: [],
    fault: []
  };
  if (ts.length) {
    d.tmax = Math.max(...ts);
    d.tmin = Math.min(...ts);
  }
  d.asleep = d.V === 0 && (!d.cells.length || !d.cells.some(x => x));
  return d;
}

export function decodeA5Poll({ f90, f92, f93, f94, f95 = [], f97, f98, prevN = 8, prevFault = [], t = Date.now() / 1000 }) {
  if (!f90) throw new Error('NO_RESPONSE');
  const d = { t };
  d.V = u16(f90, 4) / 10;
  d.I = (u16(f90, 8) - 30000) / 10;
  d.soc = u16(f90, 10) / 10;
  if (f92) {
    d.tmax = f92[4] - 40;
    d.tmin = f92[6] - 40;
  }
  if (f93) {
    d.state = f93[4];
    d.chg = f93[5];
    d.dis = f93[6];
    d.cap = (((f93[8] << 24) | (f93[9] << 16) | (f93[10] << 8) | f93[11]) >>> 0) / 1000;
  }
  if (f94) {
    d.n = f94[4];
    d.charger = f94[6];
    d.load = f94[7];
    d.cycles = u16(f94, 9);
  }
  const n = d.n || prevN || 8;
  const byIdx = new Map();
  f95.forEach(g => {
    if (g[4] !== 0xFF && g[4] > 0 && !byIdx.has(g[4])) byIdx.set(g[4], g);
  });
  const cells = [];
  [...byIdx.entries()].sort((a, b) => a[0] - b[0]).forEach(([, g]) => {
    for (let k = 0; k < 3; k++) cells.push(u16(g, 5 + 2 * k));
  });
  d.cells = cells.slice(0, n);
  d.bal = d.cells.length && f97 ? d.cells.map((_, i) => (f97[4 + (i >> 3)] >> (i & 7)) & 1) : [];
  d.fault = f98 ? Array.from(f98.slice(4, 12)) : prevFault;
  d.asleep = d.V === 0 && (!d.cells.length || !d.cells.some(x => x));
  return d;
}

export function decodeA5Limits(f59) {
  if (!f59) return null;
  const ov1 = u16(f59, 4), ov2 = u16(f59, 6), uv1 = u16(f59, 8), uv2 = u16(f59, 10);
  if (uv2 >= 2000 && uv2 <= uv1 && uv1 < ov1 && ov1 <= ov2 && ov2 <= 4500) {
    return { ov1, ov2, uv1, uv2 };
  }
  return null;
}

export function decodeA5RatedCap(f50) {
  if (!f50) return null;
  const rc = (((f50[4] << 24) | (f50[5] << 16) | (f50[6] << 8) | f50[7]) >>> 0) / 1000;
  return rc >= 1 && rc <= 2000 ? Math.round(rc * 10) / 10 : null;
}

export function decodeA5Serial(frames) {
  if (!frames || !frames.length) return '';
  return [...frames]
    .sort((a, b) => a[4] - b[4])
    .map(f => Array.from(f.slice(5, 12)).filter(c => c >= 32 && c <= 126).map(c => String.fromCharCode(c)).join(''))
    .join('')
    .trim();
}
