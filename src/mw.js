/*
 * mw.js — motor de física do simulador de aquecimento por micro-ondas
 *
 * Cadeia: Magnetron -> Launcher WR340 -> Guia 1 -> Isolador 3 vias (circulador)
 *         + water load -> Guia 2 -> Transição WR340/coaxial -> Linha coaxial
 *         -> Ressonador coaxial com amostra na ponta.
 *
 * Método: cascata de matrizes de espalhamento (ondas de potência) em regime
 * senoidal permanente. Unidades internas: SI (m, Hz, W, S, ohm).
 * Os parâmetros de entrada (objeto `params`) usam mm, GHz, dB etc.
 *
 * Modelos empíricos (launcher, transição e acoplamento do ressonador) são
 * aproximações de 1ª ordem para estudo de sensibilidade — o projeto final deve
 * ser validado com solver eletromagnético (CST/HFSS) ou medição.
 */
(function (root) {
  'use strict';

  const C0 = 299792458;
  const MU0 = 4e-7 * Math.PI;
  const EPS0 = 1 / (MU0 * C0 * C0);
  const ETA0 = MU0 * C0;

  // ---------------------------------------------------------------- complexos
  class Cx {
    constructor(re, im) { this.re = re; this.im = im || 0; }
    add(o) { return new Cx(this.re + o.re, this.im + o.im); }
    sub(o) { return new Cx(this.re - o.re, this.im - o.im); }
    mul(o) { return new Cx(this.re * o.re - this.im * o.im, this.re * o.im + this.im * o.re); }
    div(o) {
      const d = o.re * o.re + o.im * o.im;
      return new Cx((this.re * o.re + this.im * o.im) / d, (this.im * o.re - this.re * o.im) / d);
    }
    scale(k) { return new Cx(this.re * k, this.im * k); }
    conj() { return new Cx(this.re, -this.im); }
    abs() { return Math.hypot(this.re, this.im); }
    abs2() { return this.re * this.re + this.im * this.im; }
    static exp(z) { const m = Math.exp(z.re); return new Cx(m * Math.cos(z.im), m * Math.sin(z.im)); }
    static tanh(z) {
      // tanh(x+jy) = (sinh2x + j sin2y) / (cosh2x + cos2y)
      const d = Math.cosh(2 * z.re) + Math.cos(2 * z.im);
      return new Cx(Math.sinh(2 * z.re) / d, Math.sin(2 * z.im) / d);
    }
  }
  const cx = (re, im) => new Cx(re, im);
  const ONE = cx(1, 0);
  const ZERO = cx(0, 0);
  const fromPolar = (m, ph) => cx(m * Math.cos(ph), m * Math.sin(ph));
  const dB10 = (x) => 10 * Math.log10(Math.max(x, 1e-300));
  const dbToPow = (db) => Math.pow(10, db / 10);
  const vswrFromGamma = (g) => (g >= 0.999999 ? Infinity : (1 + g) / (1 - g));

  // ------------------------------------------------------ biblioteca de magnetrons
  // Fontes: Toshiba E3327 spec. E200012-L935 (22/10/2020) e National Electronics/Richardson
  // YJ1600 (Rev. 6/2019). YJ1600 = E3327 (CW, 2460 MHz, anodo a água, eletroímã integrado).
  // Pulling/pushing de frequência não consta nos datasheets e não é modelado.
  const MAGNETRONS = {
    yj1600: {
      name: 'YJ1600 / E3327 (6 kW, 2460 MHz, água)',
      fNom: 2.46, fMin: 2.45, fMax: 2.47, fMinEol: 2.44, fMaxEol: 2.48, // GHz (teste / fim de vida)
      vaPk: 7.2, vaPkMax: 8, vaSurgeMax: 10,                  // kV
      iaNom: 1150, iaMin: 100, iaMax: 1150, iaPkMax: 1400,    // mA (média / pico)
      pdcMax: 9000,                                           // W (entrada média máx. no anodo)
      pavNom: 6000,                                           // W típico a 1150 mA, com circulador
      pMinAt950: 4300, pMinAt1150: 5500,                      // W garantidos (VSWR 1,1 / 2,5 sink)
      vfPre: 5, preheatS: 10, ifTyp: 33, ifSurge: 85, rCold: 0.023, // V, s, A, A, ohm
      imagMin: -2, imagMax: 0, imagAbsMax: 5,                 // A (teste / absoluto)
      waterFlowMin: 2.5, waterPmax: 0.49, waterOutOpen: 65, waterOutClosed: 75, tAnodeMax: 85, // L/min, MPa, °C
      airAntenna: 60, airFilter: 120,                         // L/min de ar forçado
      vswrTest: 1.1, vswrGuar: 2.5, vswrMax: 4,               // VSWR de carga
      weight: 4.3,
      antennaH: 28,   // mm, altura efetiva da antena no guia — ESTIMATIVA (Fig. 3 do datasheet ausente)
    },
  };

  // Potência RF típica (Va = 7,2 kV mantida pelo eletroímã) e mínimo garantido, em função de Ia.
  function magnetronPower(m, iaMA) {
    const typ = m.pavNom * iaMA / m.iaNom;
    const g = m.pMinAt950 + (m.pMinAt1150 - m.pMinAt950) * (iaMA - 950) / (1150 - 950);
    return { typ, guaranteed: iaMA >= 950 ? g : null };
  }
  // Tensão de filamento de operação (Fig. 4 do datasheet, reta ajustada; ±0,2 V)
  const filamentVoltage = (iaMA) => Math.max(0, 4.0 - 0.0036 * iaMA);

  // -------------------------------------------------------- parâmetros padrão
  const DEFAULTS = {
    src: { model: 'yj1600', ia: 1150, pav: 6000, f: 2.46, waterFlow: 2.5, waterIn: 25 }, // mA, W, GHz, L/min, °C
    wg: { a: 86.36, b: 43.18, sigma: 3.5e7 },         // WR340, mm; alumínio
    launcher: {                                       // backshort (mm); h = fallback (a antena vem do magnetron)
      d: 33.5, h: 28,
      cap: { on: 1, dia: 12, thick: 2, x: -23.5, cExtra: 0.2 }, // peça capacitiva flutuante (mm), x<0 = rumo ao backshort, e C adicional (pF)
    },
    L1: 300,                                          // guia 1 (mm)
    circ: { ilDb: 0.15, isoDb: 25, rlDb: 25 },        // perda de inserção, isolação, RL das portas
    water: { rlDb: 30, flow: 4 },                     // RL da carga, vazão (L/min)
    L2: 400,                                          // guia 2 (mm)
    trans: { d: 43, h: 30, ilDb: 0.1 },               // backshort, probe (mm), perda extra
    coax: { Do: 40, Di: 17.4, L: 500, epsr: 1, tand: 0, sigma: 5.8e7 }, // mm; ~1-5/8" EIA 50 ohm
    res: {                                            // ressonador coaxial reentrante
      Do: 40, Di: 20, l: 11.76, gap: 5, fill: 0.6, n: 6.21, sigma: 5.8e7,
    },
    sample: {                                         // amostra no gap
      epsr: 5, tand: 0.02, kEps: 0, kTand: 0.004,     // coef. por K
      mass: 1000, cp: 3000, hA: 0.5, T0: 25, Tamb: 25, // g, J/kg/K, W/K, °C
    },
    sim: { tmax: 60, dt: 0.1 },
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // -------------------------------------------------------------------- guias
  function waveguide(f, a_mm, b_mm, sigma) {
    const a = a_mm * 1e-3, b = b_mm * 1e-3;
    const k = 2 * Math.PI * f / C0;
    const kc = Math.PI / a;
    const fc = C0 / (2 * a);
    if (f <= fc) return { fc, propagating: false, beta: 0, alpha: 50, zte: Infinity, lambdaG: Infinity, a, b, k };
    const beta = Math.sqrt(k * k - kc * kc);
    const r = (fc / f) * (fc / f);
    const Rs = Math.sqrt(Math.PI * f * MU0 / sigma);
    const alpha = Rs / (b * ETA0 * Math.sqrt(1 - r)) * (1 + (2 * b / a) * r); // Np/m (TE10)
    return { fc, propagating: true, beta, alpha, zte: ETA0 * k / beta, lambdaG: 2 * Math.PI / beta, a, b, k };
  }

  function lineT(g, L_mm) { // transmissão complexa de um trecho uniforme
    return Cx.exp(cx(-g.alpha * L_mm * 1e-3, -g.beta * L_mm * 1e-3));
  }

  // ------------------------------------------------- modelo de probe/backshort
  // Circuito: porta coax —(jXp série)— transformador 1:n — nó no guia, onde se somam
  // o guia à frente (admitância 1, casado) e a susceptância traseira jb (backshort ± peça).
  //   n² = geo·sin²(kh)·zNorm   (acoplamento da sonda; geo ∝ Zte/(a·b)), Xp = −0,5·cot(kh)
  //   Sem peça: jb = −cot(βd) → máximo acoplamento em d = λg/4.
  // Normalizado para casar (n²=1, Xp=0) em d=λg/4, kh=π/2 no WR340 a 2,45 GHz.
  // Modelo empírico de 1ª ordem; validar com solver EM/medição.
  const REF = (function () {
    const g = waveguide(2.45e9, 86.36, 43.18, 3.5e7);
    return { zte: g.zte, a: g.a, b: g.b };
  })();
  const cot = (x) => Math.cos(x) / (Math.abs(Math.sin(x)) < 1e-9 ? 1e-9 : Math.sin(x));

  // back = { s, u, b }: peça entre antena e backshort — s = distância backshort→peça (mm),
  // u = distância peça→antena (mm), b = susceptância shunt normalizada da peça.
  function probeS(f, g, d_mm, h_mm, zNorm, back) {
    if (!g.propagating) return { s11: ONE, s22: ONE };
    const h = h_mm * 1e-3;
    const kh = g.k * h;
    const geo = (g.zte / (g.a * g.b)) / (REF.zte / (REF.a * REF.b));
    const n2 = Math.max(geo * Math.pow(Math.sin(kh), 2) * zNorm, 1e-9);
    const xp = -0.5 * cot(kh);
    let bb = -cot(g.beta * d_mm * 1e-3);
    if (back) {
      const y1 = -cot(g.beta * Math.max(back.s, 0) * 1e-3) + back.b;
      const t = Math.tan(g.beta * back.u * 1e-3);
      let den = 1 - y1 * t;
      if (Math.abs(den) < 1e-9) den = 1e-9;
      bb = (y1 + t) / den;
    }
    const jx = cx(0, xp), jb = cx(0, bb);
    const yGuide = jb.add(cx(n2, 0).div(ONE.add(jx)));        // visto do guia
    const zCoax = jx.add(cx(n2, 0).div(ONE.add(jb)));         // visto da coax
    return {
      s11: ONE.sub(yGuide).div(ONE.add(yGuide)),
      s22: zCoax.sub(ONE).div(zCoax.add(ONE)),
    };
  }

  // Dois-portas recíproco sem perda (exceto IL) a partir de S11 e S22 (fase de S21 por unitariedade).
  function twoPortFromS(s11, s22, ilDb) {
    const t = Math.sqrt(Math.max(0, 1 - s11.abs2()) * dbToPow(-ilDb));
    const ph = (Math.atan2(s11.im, s11.re) + Math.atan2(s22.im, s22.re) - Math.PI) / 2;
    const s21 = fromPolar(t, ph);
    return { s11, s22, s12: s21, s21 };
  }

  // Peça capacitiva flutuante (latão prateado em haste de teflon), móvel ao longo do guia.
  // Disco flutuante entre as paredes: C = ε0·A/(b−t) em série top/bottom (a folga ao teto se cancela);
  // o acréscimo sobre o guia vazio é ΔC = ε0·A·(1/(b−t) − 1/b). cExtra (pF) soma o acoplamento
  // com a antena não capturado pelo modelo — calibrar com CST/VNA.
  function launcherCap(g, cap) {
    if (!cap || !cap.on || !g.propagating) return { c: 0, b: 0 };
    const A = Math.PI * Math.pow(cap.dia * 0.5e-3, 2);
    const bt = Math.max(g.b - cap.thick * 1e-3, 1e-4);
    const c = Math.max(0, EPS0 * A * (1 / bt - 1 / g.b)) + (cap.cExtra || 0) * 1e-12;
    const zw = Math.PI / 2 * (g.b / g.a) * g.zte;              // impedância tensão-corrente do TE10
    return { c, b: g.k * C0 * c * zw };
  }

  // Launcher: Γ visto do plano de saída olhando para a fonte.
  //  x < 0 (peça entre antena e backshort): entra na susceptância traseira; plano de saída = antena.
  //  x > 0 (peça entre antena e saída): shunt no plano x; a guia 1 vai da peça ao circulador (L1 − x),
  //  pois L1 é medido a partir do plano da antena (posição física do circulador não muda).
  function launcherGamma(f, g, p) {
    const L = p.launcher, cap = L.cap || { on: 0 };
    const mg = MAGNETRONS[p.src.model];
    const h = mg ? mg.antennaH : L.h;
    const on = !!cap.on && g.propagating;
    const x = on ? Math.max(-L.d, Math.min(cap.x, p.L1)) : 0;   // limites físicos
    const cp = launcherCap(g, cap);
    const back = on && x <= 0 ? { s: L.d + x, u: -x, b: cp.b } : null;
    const ps = probeS(f, g, L.d, h, 1, back);
    if (!on || x <= 0) return { gamma: ps.s11, xFwd: 0, x, clamped: on && x !== cap.x };
    const gam = ps.s11.mul(Cx.exp(cx(0, -2 * g.beta * x * 1e-3)));
    const y = ONE.sub(gam).div(ONE.add(gam)).add(cx(0, cp.b));
    return { gamma: ONE.sub(y).div(ONE.add(y)), xFwd: x, x, clamped: x !== cap.x };
  }

  // Busca conjunta backshort × posição da peça (varre 1 período de d e x ∈ [−min(200,d), min(200,L1)])
  function tuneLauncherDX(p) {
    const f = p.src.f * 1e9, g = waveguide(f, p.wg.a, p.wg.b, p.wg.sigma);
    const q = clone(p);
    let best = { d: null, x: null, g: Infinity };
    const dHi = 5 + g.lambdaG * 500;
    for (let d = 5; d <= dHi; d += 0.5) {
      q.launcher.d = d;
      const xLo = -Math.min(200, d), xHi = Math.min(200, p.L1);
      for (let x = xLo; x <= xHi; x += 1) {
        q.launcher.cap.x = x;
        const m = launcherGamma(f, g, q).gamma.abs();
        if (m < best.g - 1e-9) best = { d, x, g: m };
      }
    }
    return best;
  }

  // Varre um parâmetro do launcher minimizando |Γ| na frequência de operação
  function tuneLauncher(p, what) {
    const f = p.src.f * 1e9, g = waveguide(f, p.wg.a, p.wg.b, p.wg.sigma);
    const q = clone(p);
    const spec = what === 'c' ? { set: (v) => { q.launcher.cap.cExtra = v; }, lo: 0, hi: 5, n: 1001 }
      : what === 'x' ? { set: (v) => { q.launcher.cap.x = v; }, lo: -Math.min(200, p.launcher.d), hi: Math.min(200, p.L1), n: 1001 }
      : { set: (v) => { q.launcher.d = v; }, lo: 5, hi: 5 + g.lambdaG * 500, n: 1001 }; // 1 período (λg/2)
    let best = { v: null, g: Infinity };
    for (let i = 0; i < spec.n; i++) {
      const v = spec.lo + (spec.hi - spec.lo) * i / (spec.n - 1);
      spec.set(v);
      const m = launcherGamma(f, g, q).gamma.abs();
      if (m < best.g - 1e-9) best = { v, g: m };
    }
    return best;
  }

  // ------------------------------------------------------------------- coaxial
  function coaxLine(f, c) {
    const ri = c.Di * 0.5e-3, ro = c.Do * 0.5e-3;
    const er = c.epsr || 1;
    const z0 = ETA0 / (2 * Math.PI * Math.sqrt(er)) * Math.log(ro / ri);
    const Rs = Math.sqrt(Math.PI * f * MU0 / c.sigma);
    const ac = Rs / (4 * Math.PI * z0) * (1 / ri + 1 / ro);
    const ad = Math.PI * f * Math.sqrt(er) * (c.tand || 0) / C0;
    const beta = 2 * Math.PI * f * Math.sqrt(er) / C0;
    return { z0, ri, ro, alpha: ac + ad, beta, er };
  }

  // -------------------------------------------------------------- ressonador
  // Admitância no gap (referida ao gap) e coeficiente de reflexão na linha coaxial.
  function resonatorAdmittance(f, r, s, T) {
    const w = 2 * Math.PI * f;
    const ri = r.Di * 0.5e-3, ro = r.Do * 0.5e-3, gap = r.gap * 1e-3;
    const zr = ETA0 / (2 * Math.PI) * Math.log(ro / ri);
    const Rs = Math.sqrt(Math.PI * f * MU0 / r.sigma);
    const ac = Rs / (4 * Math.PI * zr) * (1 / ri + 1 / ro);
    const beta = w / C0;
    const dT = T - s.T0;
    const eps = s.epsr * (1 + s.kEps * dT);
    const tand = Math.max(0, s.tand * (1 + s.kTand * dT));
    const area = Math.PI * ri * ri;
    const cAir = EPS0 * area / gap * (1 - r.fill);
    const cSam = EPS0 * area / gap * r.fill * eps;
    const cFr = 4 * EPS0 * ri;                              // franjamento (empírico)
    const yGap = cx(w * cSam * tand, w * (cAir + cSam + cFr)); // G_d + jωC
    const gD = w * cSam * tand;
    const yStub = ONE.div(cx(zr, 0).mul(Cx.tanh(cx(ac * r.l * 1e-3, beta * r.l * 1e-3))));
    const y = yGap.add(yStub);
    return { y, gD, gStub: yStub.re, zr, ac, beta, cTot: cAir + cSam + cFr };
  }

  function resonatorGamma(f, r, s, T, z0) {
    const ra = resonatorAdmittance(f, r, s, T);
    const ySeen = ra.y.scale(r.n * r.n);                    // tap ideal n:1
    const yn = ySeen.scale(z0);                             // normalizada a Y0=1/z0
    const gamma = ONE.sub(yn).div(ONE.add(yn));
    return { gamma, ra };
  }

  // Comprimento do stub que ressoa em f (forma fechada: Zr·tan(βl) = 1/ωC)
  function tuneResonatorLength(p, T) {
    const f = p.src.f * 1e9, r = p.res, s = p.sample;
    const ra = resonatorAdmittance(f, r, s, T == null ? s.T0 : T);
    const w = 2 * Math.PI * f;
    const bl = Math.atan(1 / (w * ra.cTot * ra.zr));
    return bl / ra.beta * 1e3; // mm
  }

  // Acoplamento crítico: n tal que Re(Y_seen)=Y0 na ressonância
  function criticalCoupling(p, T) {
    const f = p.src.f * 1e9;
    const co = coaxLine(f, p.coax);
    const ra = resonatorAdmittance(f, p.res, p.sample, T == null ? p.sample.T0 : T);
    // usa condutância total a pequena detonação; assume ressonância
    return Math.sqrt(1 / (co.z0 * Math.max(ra.y.re, 1e-12)));
  }

  // ------------------------------------------------------------- solução total
  /**
   * Resolve o sistema em uma frequência f (Hz) e temperatura de amostra T (°C).
   * Retorna potências (W) por elemento e métricas de descasamento.
   */
  function simulate(p, f, T) {
    const wg = waveguide(f, p.wg.a, p.wg.b, p.wg.sigma);
    if (T == null) T = p.sample.T0;
    const out = { f, T, wg, propagating: wg.propagating };
    if (!wg.propagating) {
      out.warn = 'Frequência abaixo do corte do guia (fc = ' + (wg.fc / 1e9).toFixed(3) + ' GHz).';
      return out;
    }

    // --- fonte: magnetron + launcher (probe + backshort) ---
    const lg = launcherGamma(f, wg, p);
    const gs0 = lg.gamma;                                    // Γ do launcher visto do guia
    const bs0 = Math.sqrt(p.src.pav * (1 - gs0.abs2()));
    const t1 = lineT(wg, Math.max(0, p.L1 - lg.xFwd));
    const t1sq = t1.mul(t1);

    // --- circulador (S cíclica 1→2→3→1) ---
    const S = circulatorS(p.circ);

    // --- carga (lado 2): guia 2 -> transição -> coax -> ressonador ---
    const co = coaxLine(f, p.coax);
    const ps = probeS(f, wg, p.trans.d, p.trans.h, 50 / co.z0, null);
    const tp = twoPortFromS(ps.s11, ps.s22, p.trans.ilDb);
    const rr = resonatorGamma(f, p.res, p.sample, T, co.z0);
    const tc2 = Cx.exp(cx(-co.alpha * p.coax.L * 1e-3, -co.beta * p.coax.L * 1e-3));
    const gc0 = rr.gamma.mul(tc2).mul(tc2);                  // Γ no início do coax
    const gTr = tp.s11.add(tp.s12.mul(tp.s21).mul(gc0).div(ONE.sub(tp.s22.mul(gc0))));
    const t2 = lineT(wg, p.L2);
    const gL2 = gTr.mul(t2).mul(t2);                         // Γ na porta 2 do circulador

    // --- carga de água (porta 3) ---
    const gw = cx(Math.sqrt(dbToPow(-p.water.rlDb)), 0);

    // --- sistema linear: b = S a; a1 = bs + Γs' b1; a2 = ΓL2 b2; a3 = Γw b3 ---
    const bs1 = t1.scale(bs0);
    const gs1 = gs0.mul(t1sq);
    // incógnitas b1,b2,b3:  b_i - Σ_j S_ij Γ_j b_j = S_i1 bs1  (Γ_1=gs1, Γ_2=gL2, Γ_3=gw)
    const gam = [gs1, gL2, gw];
    const A = [0, 1, 2].map((i) => [0, 1, 2].map((j) => {
      const v = S[i][j].mul(gam[j]).scale(-1);
      return i === j ? v.add(ONE) : v;
    }));
    const rhs = [S[0][0].mul(bs1), S[1][0].mul(bs1), S[2][0].mul(bs1)];
    const b = solve3(A, rhs);
    const a1 = bs1.add(gs1.mul(b[0]));
    const a2 = gL2.mul(b[1]);
    const a3 = gw.mul(b[2]);

    // --- balanço de potências ---
    const aL = a1.div(t1), bL = b[0].mul(t1);                // ondas no plano do launcher
    const pLaunch = aL.abs2() - bL.abs2();                   // entregue pelo magnetron
    const pG1 = pLaunch - (a1.abs2() - b[0].abs2());         // perda guia 1
    const pCirc = a1.abs2() + a2.abs2() + a3.abs2() - b[0].abs2() - b[1].abs2() - b[2].abs2();
    const pWater = b[2].abs2() - a3.abs2();                  // absorvida na carga de água
    const pBackMag = b[0].abs2();                            // retornando ao magnetron
    const pToLoad = b[1].abs2() - a2.abs2();                 // potência líquida p/ lado da carga
    const w1 = b[1].mul(t2);                                 // onda incidente na transição
    const pTrIn = w1.abs2() - w1.mul(gTr).abs2();
    const pG2 = pToLoad - pTrIn;                             // perda guia 2
    const c1 = tp.s21.mul(w1).div(ONE.sub(tp.s22.mul(gc0))); // onda incidente no início do coax
    const pCoaxIn = c1.abs2() - c1.mul(gc0).abs2();
    const pTr = pTrIn - pCoaxIn;                             // perda na transição
    const cEnd = c1.mul(tc2);
    const pRes = cEnd.abs2() - cEnd.mul(rr.gamma).abs2();    // potência no ressonador
    const pCoax = pCoaxIn - pRes;                            // perda no coax
    const gT = rr.ra.gD + rr.ra.gStub;
    const pSample = pRes * rr.ra.gD / gT;
    const pWall = pRes - pSample;

    // --- campos / limites ---
    const vPk = Math.sqrt(2 * pRes * co.z0);                 // tensão de pico no coax (casado)
    const gCoax = rr.gamma.abs();
    const eCoax = vPk * (1 + gCoax) / (co.ri * Math.log(co.ro / co.ri));
    const eWg = Math.sqrt(4 * wg.zte * Math.max(pLaunch, 0) / (wg.a * wg.b));
    const gG1 = a1.abs() > 0 ? b[0].abs() / a1.abs() : 0;
    const gG2 = gTr.abs();

    Object.assign(out, {
      pav: p.src.pav, pLaunch, pG1, pCirc, pWater, pBackMag, pToLoad, pG2, pTr, pCoax, pRes,
      pWall, pSample,
      pLoss: pG1 + pCirc + pG2 + pTr + pCoax + pWall,
      closure: pLaunch - (pG1 + pCirc + pWater + pG2 + pTr + pCoax + pWall + pSample),
      vswrMag: vswrFromGamma(bL.abs() / aL.abs()),
      gammaLauncher: gs0.abs(), gammaSrcSide: gG1, gammaTransition: gG2,
      gammaLoadAtCirc: gL2.abs(), gammaRes: gCoax, gammaResC: rr.gamma,
      vswrLoad: vswrFromGamma(gL2.abs()), vswrRes: vswrFromGamma(gCoax),
      rlMagDb: -dB10(pBackMag / Math.max(pLaunch, 1e-9)),
      z0coax: co.z0, eCoax, eWg, eBreakdown: 3e6,
      qUnloaded: rr.ra.cTot * 2 * Math.PI * f / Math.max(rr.ra.gStub, 1e-15),
      qSampleLoaded: rr.ra.cTot * 2 * Math.PI * f / Math.max(gT, 1e-15),
      lambdaG: wg.lambdaG, fc: wg.fc,
      waterDeltaT: p.water.flow > 0 ? pWater / ((p.water.flow / 60) * 0.997 * 4186) : Infinity, // K
    });
    return out;
  }

  // S cíclica 1→2→3→1 (circulante). Fases (+isolação, −reflexão) zeram a parte real
  // dos autovalores em 1ª ordem; se ainda houver autovalor > 1 normaliza (passividade).
  function circulatorS(c) {
    const t = Math.sqrt(dbToPow(-c.ilDb));
    const i = Math.sqrt(dbToPow(-c.isoDb));
    const g = -Math.sqrt(dbToPow(-c.rlDb));
    let lmax = 0;
    for (let k = 0; k < 3; k++) {
      const w1 = fromPolar(1, 2 * Math.PI * k / 3), w2 = fromPolar(1, 4 * Math.PI * k / 3);
      lmax = Math.max(lmax, cx(g, 0).add(w1.scale(i)).add(w2.scale(t)).abs());
    }
    const kk = lmax > 1 ? 1 / lmax : 1;
    const T_ = cx(t * kk, 0), I_ = cx(i * kk, 0), G_ = cx(g * kk, 0);
    return [[G_, I_, T_], [T_, G_, I_], [I_, T_, G_]];
  }

  function solve3(A, r) { // eliminação de Gauss complexa 3x3 com pivoteamento parcial
    const n = 3;
    const M = A.map((row, i) => row.concat([r[i]]));
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let i = c + 1; i < n; i++) if (M[i][c].abs() > M[piv][c].abs()) piv = i;
      [M[c], M[piv]] = [M[piv], M[c]];
      for (let i = c + 1; i < n; i++) {
        const k = M[i][c].div(M[c][c]);
        for (let j = c; j <= n; j++) M[i][j] = M[i][j].sub(k.mul(M[c][j]));
      }
    }
    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let s = M[i][n];
      for (let j = i + 1; j < n; j++) s = s.sub(M[i][j].mul(x[j]));
      x[i] = s.div(M[i][i]);
    }
    return x;
  }

  // ------------------------------------------------------------------ varreduras
  function sweepFrequency(p, f0, f1, n) {
    const res = [];
    for (let i = 0; i < n; i++) {
      const f = (f0 + (f1 - f0) * i / (n - 1)) * 1e9;
      res.push(simulate(p, f, p.sample.T0));
    }
    return res;
  }

  function setPath(obj, path, v) {
    const k = path.split('.');
    let o = obj;
    for (let i = 0; i < k.length - 1; i++) o = o[k[i]];
    o[k[k.length - 1]] = v;
  }
  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => o[k], obj);
  }

  function sweepParam(p, path, v0, v1, n) {
    const res = [];
    for (let i = 0; i < n; i++) {
      const q = clone(p);
      const v = v0 + (v1 - v0) * i / (n - 1);
      setPath(q, path, v);
      const r = simulate(q, q.src.f * 1e9, q.sample.T0);
      r.x = v;
      res.push(r);
    }
    return res;
  }

  // ----------------------------------------------------------- aquecimento
  function simulateHeating(p) {
    const s = p.sample, f = p.src.f * 1e9;
    const m = s.mass * 1e-3;
    const C = m * s.cp;
    const tmax = p.sim.tmax, dt = p.sim.dt;
    const nSteps = Math.max(1, Math.round(tmax / dt));
    const pw = (T) => simulate(p, f, T);
    let T = s.T0;
    const rows = [];
    for (let i = 0; i <= nSteps; i++) {
      const r1 = pw(T);
      const q1 = (r1.pSample || 0) - s.hA * (T - s.Tamb);
      rows.push({
        t: i * dt, T, pSample: r1.pSample || 0, pWater: r1.pWater || 0, pBackMag: r1.pBackMag || 0,
        gammaRes: r1.gammaRes || 1, pRes: r1.pRes || 0,
      });
      if (i === nSteps) break;
      // Heun (RK2)
      const Tp = T + q1 / C * dt;
      const r2 = pw(Tp);
      const q2 = (r2.pSample || 0) - s.hA * (Tp - s.Tamb);
      T += (q1 + q2) * 0.5 / C * dt;
    }
    return rows;
  }

  const api = {
    DEFAULTS, MAGNETRONS, launcherGamma, launcherCap, tuneLauncher, tuneLauncherDX, magnetronPower, filamentVoltage, clone, Cx, simulate, sweepFrequency, sweepParam, simulateHeating,
    waveguide, coaxLine, probeS, twoPortFromS, resonatorAdmittance,
    tuneResonatorLength, criticalCoupling, setPath, getPath, constants: { C0, MU0, EPS0, ETA0 },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MW = api;
})(typeof self !== 'undefined' ? self : this);
