import { calcIdeal } from './math.js';

const col = k => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
const isVisibleCanvas = c => !!c && !c.closest('.card')?.classList.contains('shut');

export function plot(c, o) {
  if (!isVisibleCanvas(c)) return;
  const r = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  if (!w) return;
  c.width = w * r;
  c.height = h * r;
  const g = c.getContext('2d');
  g.scale(r, r);
  const P = { l: 42, r: 8, t: 8, b: 20 }, W = w - P.l - P.r, H = h - P.t - P.b;
  const X = x => P.l + (x - o.x[0]) / (o.x[1] - o.x[0] || 1) * W;
  const Y = y => P.t + H - (y - o.y[0]) / (o.y[1] - o.y[0] || 1) * H;
  g.font = '10px system-ui';
  (o.bands || []).forEach(b => {
    g.fillStyle = b.c;
    const y1 = Y(Math.min(b.y1, o.y[1])), y0 = Y(Math.max(b.y0, o.y[0]));
    g.fillRect(P.l, y1, W, y0 - y1);
  });
  const ty = o.yt || 4;
  for (let i = 0; i <= ty; i++) {
    const v = o.y[0] + (o.y[1] - o.y[0]) * i / ty, y = Y(v);
    g.strokeStyle = col('--bd');
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(P.l, y);
    g.lineTo(P.l + W, y);
    g.stroke();
    g.fillStyle = col('--mut');
    g.textAlign = 'right';
    g.fillText((o.yf || (val => val.toFixed(1)))(v), P.l - 4, y + 4);
  }
  const tx = o.xt || 4;
  for (let i = 0; i <= tx; i++) {
    const v = o.x[0] + (o.x[1] - o.x[0]) * i / tx;
    g.fillStyle = col('--mut');
    g.textAlign = i === tx ? 'right' : i === 0 ? 'left' : 'center';
    g.fillText(v.toFixed(1) + o.xUnit, X(v), h - 5);
  }
  (o.lines || []).forEach(l => {
    if (!l.pts || l.pts.length < 2) return;
    g.beginPath();
    g.strokeStyle = l.c.startsWith('--') ? col(l.c) : l.c;
    g.lineWidth = l.w || 2;
    g.setLineDash(l.d || []);
    l.pts.forEach((p, i) => {
      const x = X(p[0]), y = Y(p[1]);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.stroke();
    g.setLineDash([]);
  });
  if (o.now != null) {
    g.strokeStyle = col('--fg');
    g.globalAlpha = 0.4;
    g.setLineDash([2, 4]);
    g.beginPath();
    g.moveTo(X(o.now), P.t);
    g.lineTo(X(o.now), P.t + H);
    g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 1;
  }
}

export function heat(c, pts, n) {
  if (!isVisibleCanvas(c)) return;
  const r = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  if (!w) return;
  c.width = w * r;
  c.height = h * r;
  const g = c.getContext('2d');
  g.scale(r, r);
  const L0 = 42, W = w - L0 - 8, rh = (h - 6) / n;
  g.font = '10px system-ui';
  for (let i = 0; i < n; i++) {
    g.fillStyle = col('--mut');
    g.textAlign = 'right';
    g.fillText(i + 1, L0 - 6, 3 + i * rh + rh / 2 + 3);
  }
  if (pts.length < 2) return;
  const cw = W / pts.length;
  pts.forEach((p, k) => {
    const cs = p[2], m = cs.reduce((a, b) => a + b, 0) / cs.length;
    cs.forEach((v, i) => {
      const d = v - m, a = Math.min(1, Math.abs(d) / 70);
      g.fillStyle = d >= 0 ? `rgba(239,83,80,${a})` : `rgba(100,181,246,${a})`;
      g.fillRect(L0 + k * cw, 3 + i * rh, cw + 0.6, rh - 1.5);
    });
  });
  g.strokeStyle = col('--bd');
  g.strokeRect(L0, 3, W, h - 6);
}

export function renderCharts(dv, I, P, { tr, uV, uA, umV }) {
  const q = P.q, lg = dv.long;
  if (!I || lg.length < 2) return;
  const C = dv.C, t0 = lg[0][0], sum = p => p[2].reduce((a, v) => a + v, 0) / 1000;
  const act = lg.map(p => [(p[0] - t0) / 3600, sum(p)]);
  const cur = lg.map(p => [(p[0] - t0) / 3600, p[1]]);
  const spr = lg.map(p => [(p[0] - t0) / 3600, Math.max(...p[2]) - Math.min(...p[2])]);
  const id = calcIdeal(I, C), xn = act[act.length - 1][0], xmax = Math.max(id.tEnd, xn) * 1.03 || 1;
  const n = I.n, vm = C.vmax / 1000, vlo = C.ocv[0][0], xUnit = tr(' ч', ' h');
  const iVals = cur.map(p => p[1]);
  const sprMax = Math.max(200, Math.ceil(Math.max(0, ...spr.map(p => p[1])) / 50) * 50);

  plot(q('.cV'), {
    x: [0, xmax],
    y: [n * vlo, n * (vm + 0.1)],
    xUnit,
    yf: v => v.toFixed(0) + ' ' + uV,
    now: xn,
    bands: [{ y0: n * vm, y1: n * (vm + 0.1), c: 'rgba(198,40,40,.10)' }],
    lines: [{ pts: [[0, n * vm], [xmax, n * vm]], c: '--bad', w: 1, d: [6, 4] }, { pts: id.V, c: '--acc2', d: [7, 5], w: 2 }, { pts: act, c: '--acc', w: 2.5 }]
  });
  plot(q('.cI'), {
    x: [0, xmax],
    y: [Math.min(0, ...iVals), Math.max(id.iset * 1.25, ...iVals, 1)],
    xUnit,
    yf: v => v.toFixed(0) + ' ' + uA,
    now: xn,
    yt: 3,
    lines: [{ pts: id.A, c: '--acc2', d: [7, 5], w: 2 }, { pts: cur, c: '--acc', w: 2.5 }]
  });
  heat(q('.heat'), lg, n);
  plot(q('.spr'), {
    x: [0, xmax],
    y: [0, sprMax],
    xUnit,
    yf: v => v.toFixed(0) + ' ' + umV,
    now: xn,
    bands: [{ y0: 0, y1: 30, c: 'rgba(46,125,50,.18)' }, { y0: 30, y1: 150, c: 'rgba(194,122,0,.10)' }, { y0: 150, y1: sprMax, c: 'rgba(198,40,40,.12)' }],
    lines: [{ pts: [[0, 100], [id.tEnd * 0.7, 100], [id.tEnd, 30]], c: '--acc2', d: [7, 5], w: 2 }, { pts: spr, c: '--acc', w: 2.5 }]
  });
}
