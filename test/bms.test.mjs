import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  frame, crc16, mbFrame, FrameBuffer,
  decodeD2Poll, decode81Poll, decodeA5Poll, decodeA5Serial, decodeFaults
} from '../src/proto.js';
import { CHEM, clampDt, estIR, evaluateChecks } from '../src/math.js';
import { esc, csvCell, buildCsv } from '../src/store.js';

function makeA5Reply(cmd, payload) {
  const f = new Uint8Array(13);
  f[0] = 0xA5;
  f[1] = 0x01;
  f[2] = cmd;
  f[3] = 8;
  for (let i = 0; i < 8 && i < payload.length; i++) f[4 + i] = payload[i];
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += f[i];
  f[12] = sum & 255;
  return f;
}

function makeModbusReadReply(addr, byteCount, fillFn) {
  const f = new Uint8Array(byteCount + 5);
  f[0] = addr;
  f[1] = 0x03;
  f[2] = byteCount;
  if (fillFn) fillFn(f.subarray(3, 3 + byteCount));
  const c = crc16(f, f.length - 2);
  f[f.length - 2] = c & 255;
  f[f.length - 1] = c >> 8;
  return f;
}

function setU16(buf, offset, val) {
  buf[offset] = (val >> 8) & 255;
  buf[offset + 1] = val & 255;
}

test('FrameBuffer reassembles fragmented A5 frames amidst garbage and >1024B burst', () => {
  const fb = new FrameBuffer(1024);
  const f90 = makeA5Reply(0x90, [0x01, 0x0A, 0, 0, 0x75, 0x30, 0x01, 0xF4]);
  const f95 = makeA5Reply(0x95, [1, 0x0C, 0xE4, 0x0C, 0xE5, 0x0C, 0xE6, 0]);

  // Burst > 1024 bytes of noise followed by fragmented valid frames
  const noise = new Uint8Array(1300).fill(0x55);
  fb.push(noise);
  assert.equal(fb.length, 1024);

  fb.push(new Uint8Array([0xAA, 0xA5, 0x99])); // fake 0xA5 header with bad checksum
  fb.push(f90.subarray(0, 5));
  assert.deepEqual(fb.extract('a5'), []);
  fb.push(f90.subarray(5));
  fb.push(f95.subarray(0, 7));
  const firstBatch = fb.extract('a5');
  assert.equal(firstBatch.length, 1);
  assert.equal(firstBatch[0][2], 0x90);

  fb.push(f95.subarray(7));
  const secondBatch = fb.extract('a5');
  assert.equal(secondBatch.length, 1);
  assert.equal(secondBatch[0][2], 0x95);
  assert.equal(fb.length, 0);
});

test('FrameBuffer parses D2, 81 (0x51/0x81) and Modbus 0x83 exception frames', () => {
  const fb = new FrameBuffer(1024);
  const exc = new Uint8Array([0xD2, 0x83, 0x02, 0, 0]);
  const c = crc16(exc, 3);
  exc[3] = c & 255;
  exc[4] = c >> 8;

  fb.push(exc.subarray(0, 2));
  assert.deepEqual(fb.extract('d2'), []);
  fb.push(exc.subarray(2));
  const got = fb.extract('d2');
  assert.equal(got.length, 1);
  assert.equal(got[0][1], 0x83);

  const f81 = makeModbusReadReply(0x51, 128, p => {
    setU16(p, 120, 8);
    setU16(p, 112, 266);
    setU16(p, 114, 30100);
    setU16(p, 116, 550);
  });
  fb.reset();
  fb.push(f81.subarray(0, 40));
  fb.push(f81.subarray(40));
  const got81 = fb.extract('81');
  assert.equal(got81.length, 1);
  assert.equal(got81[0][0], 0x51);
});

test('decodeD2Poll & decode81Poll reject short frames; decodeA5Poll uses prevN fallback', () => {
  const shortD2 = makeModbusReadReply(0xD2, 10, null);
  assert.throws(() => decodeD2Poll(shortD2, 1000), /SHORT_RESPONSE/);

  const validD2 = makeModbusReadReply(0xD2, 124, p => {
    for (let i = 0; i < 8; i++) setU16(p, i * 2, 3320 + i);
    setU16(p, 64, 65); // 25 C
    setU16(p, 80, 266); // 26.6 V
    setU16(p, 82, 30150); // +15.0 A
    setU16(p, 84, 700); // 70.0%
    setU16(p, 98, 8);
    setU16(p, 100, 1);
    setU16(p, 106, 1);
    setU16(p, 108, 1);
  });
  const d2 = decodeD2Poll(validD2, 1000);
  assert.equal(d2.n, 8);
  assert.equal(d2.cells.length, 8);
  assert.equal(d2.V, 26.6);
  assert.equal(d2.I, 15);
  assert.equal(d2.tmin, 25);

  const short81 = makeModbusReadReply(0x81, 20, null);
  assert.throws(() => decode81Poll(short81, short81, 1000), /SHORT_RESPONSE/);

  const f90 = makeA5Reply(0x90, [0x01, 0x0A, 0, 0, 0x75, 0x30, 0x01, 0xF4]);
  const cells = Array.from({ length: 16 }, (_, i) => 3300 + i);
  const f95 = [];
  for (let idx = 0; idx < 6; idx++) {
    const p = [idx + 1];
    for (let k = 0; k < 3; k++) {
      const v = cells[idx * 3 + k] || 0;
      p.push((v >> 8) & 255, v & 255);
    }
    p.push(0);
    f95.push(makeA5Reply(0x95, p));
  }
  const a5 = decodeA5Poll({ f90, f95, prevN: 16, t: 1000 });
  assert.equal(a5.cells.length, 16);
});

test('estIR supports both LiFePO4 and NMC voltages and clampDt blocks negative jumps', () => {
  assert.equal(clampDt(100, 105), 0);
  assert.equal(clampDt(120, 100), 10);

  const makeHist = (baseMv) => {
    const hist = [];
    for (let k = 0; k < 20; k++) {
      const I = k % 2 === 0 ? 5 : 25;
      const cells = [0, 1, 2, 3].map(c => Math.round(baseMv + I * (1.2 + c * 0.1)));
      hist.push({ t: 1000 + k * 2, I, cells });
    }
    return hist;
  };

  const lfpHist = makeHist(3300);
  const lfpIr = estIR(lfpHist, lfpHist[lfpHist.length - 1], CHEM.lfp);
  assert.ok(Array.isArray(lfpIr) && lfpIr.every(x => x >= 1 && x <= 2));

  const nmcHist = makeHist(3900); // >3600 mV — previously failed
  const nmcIr = estIR(nmcHist, nmcHist[nmcHist.length - 1], CHEM.nmc);
  assert.ok(Array.isArray(nmcIr) && nmcIr.every(x => x >= 1 && x <= 2));
});

test('evaluateChecks catches dead balance lead, mirror tap swing, stuck MOSFET, spread, and overtemp', () => {
  const ctx = { lang: 'en', tr: (_ru, en) => en, uV: 'V', uA: 'A', umV: 'mV', now: 1000 };
  const d = {
    t: 200,
    V: 26.0,
    I: 12.0,
    sum: 26.0,
    tmax: 58,
    tmin: 25,
    chg: 0,
    dis: 1,
    charger: 1,
    cells: [3300, 400, 3450, 3150, 3300, 3300, 3300, 3300],
    bal: [0, 0, 0, 0, 0, 0, 0, 0],
    fault: [0, 0, 0, 0, 0, 0, 0, 0],
    asleep: false
  };
  const hSample = { t: 196, I: 12, chg: 0, dis: 1, cells: d.cells, sum: 26.0 };
  const dev = {
    C: CHEM.lfp,
    chem: 'lfp',
    cap: 105,
    hist: [hSample, { ...hSample, t: 198 }, { ...d }],
    lim: null,
    ir: null,
    badUntil: 0
  };
  const checks = evaluateChecks(dev, d, ctx);
  const byName = Object.fromEntries(checks.map(c => [c.name, c]));
  assert.equal(byName['Open balance lead'].level, 2);
  assert.equal(byName['Charge switch'].level, 2);
  assert.equal(byName['Temperature'].level, 2);
  assert.equal(byName['Cell spread'].level, 2);
});

test('esc, csvCell, buildCsv and decodeA5Serial neutralize XSS and CSV formula injection', () => {
  assert.equal(esc('<img src="x" onerror=\'1\'>'), '&lt;img src=&quot;x&quot; onerror=&#39;1&#39;&gt;');
  assert.equal(csvCell('=CMD("calc")'), '"\'=CMD(""calc"")"');
  const csv = buildCsv([[1700000000, 10, [3300, 3305], [0, 0], {}]], [{ t: '2026-01-01 00:00:00', level: 2, text: '+1+1,"bad"' }]);
  assert.ok(csv.includes('"\'+1+1,""bad"""'));

  const s1 = makeA5Reply(0x57, [1, ...Array.from('DL<img').map(c => c.charCodeAt(0)), 0x20]);
  assert.equal(esc(decodeA5Serial([s1])), 'DL&lt;img');
  assert.deepEqual(decodeFaults([1, 0, 0, 0, 0, 0, 0, 0], 'en'), ['cell overvoltage (lvl 1)']);
});

test('sw.js FILES entries exist on disk and app.css braces are balanced', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const match = /const FILES = \[([\s\S]*?)\];/.exec(sw);
  assert.ok(match, 'FILES array found in sw.js');
  const entries = [...match[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  assert.ok(entries.includes('src/app.js'));
  for (const entry of entries) {
    if (entry === './') continue;
    const rel = entry.split('?')[0];
    assert.ok(fs.existsSync(path.join(root, rel)), `Missing precache target: ${rel}`);
  }

  const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');
  assert.equal((css.match(/\{/g) || []).length, (css.match(/\}/g) || []).length);
});
