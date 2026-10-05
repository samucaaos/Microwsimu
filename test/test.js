const MW = require('../src/mw.js');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const p = MW.clone(MW.DEFAULTS);
const f = p.src.f * 1e9;

// guia WR340
const g = MW.waveguide(f, 86.36, 43.18, 3.5e7);
ok(Math.abs(g.fc / 1e9 - 1.736) < 0.005, 'fc WR340 = ' + (g.fc / 1e9).toFixed(4) + ' GHz');
const lg = (299792458 / f) / Math.sqrt(1 - Math.pow(g.fc / f, 2)) * 1e3;
ok(Math.abs(g.lambdaG * 1e3 - lg) < 0.01, 'λg = ' + (g.lambdaG * 1e3).toFixed(1) + ' mm');
console.log('     atenuação Al = ' + (g.alpha * 8.686).toFixed(4) + ' dB/m');

// coax 50 ohm
const co = MW.coaxLine(f, p.coax);
ok(Math.abs(co.z0 - 50) < 0.5, 'Z0 coax = ' + co.z0.toFixed(2));

// sintonia + acoplamento crítico
p.res.l = MW.tuneResonatorLength(p);
p.res.n = MW.criticalCoupling(p);
console.log('     l_res =', p.res.l.toFixed(2), 'mm, n =', p.res.n.toFixed(2));
let r = MW.simulate(p, f, p.sample.T0);
console.log(JSON.stringify(r, (k, v) => (typeof v === 'number' ? +v.toPrecision(5) : (k === 'wg' || k === 'gammaResC' ? undefined : v))));
ok(Math.abs(r.closure) < 1e-6 * p.src.pav, 'balanço de potência fecha (resíduo ' + r.closure.toExponential(2) + ' W)');
ok(r.gammaRes < 0.05, '|Γ| ressonador crítico = ' + r.gammaRes.toFixed(4));
ok(r.pSample > 0.5 * p.src.pav, 'amostra recebe ' + r.pSample.toFixed(0) + ' W');

// sem amostra/perda: carga totalmente refletida -> maior parte vai à water load
const q = MW.clone(p); q.res.n = 0.001;
const r2 = MW.simulate(q, f, 25);
ok(Math.abs(r2.closure) < 1e-6 * p.src.pav, 'fecha também com ressonador desacoplado');
ok(r2.pWater > r2.pSample, 'ressonador desacoplado: water load = ' + r2.pWater.toFixed(0) + ' W');

// conservação em muitos pontos aleatórios
let worst = 0;
for (let i = 0; i < 300; i++) {
  const z = MW.clone(p);
  z.L1 = Math.random() * 800; z.L2 = Math.random() * 800; z.coax.L = Math.random() * 1000;
  z.launcher.d = 20 + Math.random() * 60; z.launcher.h = 10 + Math.random() * 33;
  z.trans.d = 20 + Math.random() * 60; z.trans.h = 10 + Math.random() * 33;
  z.res.n = Math.exp(Math.random() * 6 - 2);
  const rr = MW.simulate(z, (2.4 + Math.random() * 0.1) * 1e9, 25 + Math.random() * 70);
  worst = Math.max(worst, Math.abs(rr.closure) / z.src.pav);
  if (rr.pSample < -1e-9 || rr.pWater < -1e-9 || rr.pCirc < -1e-9) { ok(false, 'potência negativa'); break; }
}
ok(worst < 1e-9, 'conservação em 300 casos aleatórios, pior resíduo relativo = ' + worst.toExponential(2));

// aquecimento
const h = MW.simulateHeating(p);
console.log('     T final =', h[h.length - 1].T.toFixed(1), '°C');
ok(h[h.length - 1].T > p.sample.T0, 'amostra aquece');
// abaixo do corte
const rc = MW.simulate(p, 1.5e9, 25);
ok(!rc.propagating, 'f < fc não propaga');
// peça capacitiva do launcher
const f2 = p.src.f * 1e9, gw = MW.waveguide(f2, p.wg.a, p.wg.b, p.wg.sigma);
const geoCap = MW.clone(p.launcher.cap); geoCap.cExtra = 0;
const cp0 = MW.launcherCap(gw, geoCap);
console.log('     peça flutuante: C = ' + (cp0.c * 1e15).toFixed(2) + ' fF, b = ' + cp0.b.toFixed(3));
ok(cp0.c > 0 && cp0.b < 0.2, 'disco flutuante: efeito pequeno (ΔC positivo)');
const g0 = MW.launcherGamma(f2, gw, p).gamma.abs();
const tun = MW.tuneLauncher(p, 'd');
ok(tun.g <= g0 + 1e-12, '|Γ| launcher otimizado (d=' + tun.v.toFixed(1) + ' mm) = ' + tun.g.toExponential(2));
const q2 = MW.clone(p); q2.launcher.cap.cExtra = 1.5; q2.launcher.d = tun.v;
const tc = MW.tuneLauncher(q2, 'c');
ok(tc.g <= MW.launcherGamma(f2, gw, q2).gamma.abs() + 1e-12, 'otimização de C adicional: C=' + tc.v.toFixed(2) + ' pF');
const rr3 = MW.simulate(q2, f2, 25);
ok(Math.abs(rr3.closure) < 1e-6, 'balanço fecha com peça capacitiva');
// unitariedade da sonda e peça móvel (±200 mm)
let uw = 0;
for (let i = 0; i < 200; i++) {
  const d = 10 + Math.random() * 120, h = 10 + Math.random() * 33;
  const bk = Math.random() < 0.5 ? null : { s: d * Math.random(), u: 0, b: Math.random() * 3 };
  if (bk) bk.u = d - bk.s;
  const ps = MW.probeS(f2, gw, d, h, 1, bk);
  uw = Math.max(uw, Math.abs(ps.s11.abs() - ps.s22.abs()));
}
ok(uw < 1e-9, 'sonda sem perda: |S11| = |S22| (dif. máx ' + uw.toExponential(1) + ')');
const qd = MW.clone(p); const tdx = MW.tuneLauncherDX(qd);
console.log('     d,x ótimos:', tdx.d.toFixed(1), tdx.x.toFixed(0), '|Γ| =', tdx.g.toExponential(2));
ok(tdx.g < 0.05, '|Γ| launcher otimizado em d e x < 0,05');
const qx = MW.clone(p); qx.launcher.cap.x = -500;
ok(MW.launcherGamma(f2, gw, qx).clamped, 'x < −d é limitado ao backshort');
let wx = 0;
for (let x = -200; x <= 200; x += 10) { const qq = MW.clone(p); qq.launcher.cap.x = x; const rr = MW.simulate(qq, f2, 25); wx = Math.max(wx, Math.abs(rr.closure)); }
ok(wx < 1e-6, 'balanço fecha ao mover a peça de −200 a +200 mm');
process.exit(fail ? 1 : 0);
