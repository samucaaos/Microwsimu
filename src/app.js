(function () {
  'use strict';
  const MW = window.MW;
  const P = MW.clone(MW.DEFAULTS);

  // [caminho, rótulo, unidade, passo, mínimo]
  const SCHEMA = [
    ['Magnetron / frequência', [
      ['src.pav', 'Potência disponível', 'W', 100, 0],
      ['src.f', 'Frequência', 'GHz', 0.005, 1.8],
    ]],
    ['Launcher WR340', [
      ['wg.a', 'Guia: largura a', 'mm', 0.01, 50],
      ['wg.b', 'Guia: altura b', 'mm', 0.01, 10],
      ['wg.sigma', 'Condutividade do guia', 'S/m', 1e6, 1e6],
      ['launcher.d', 'Backshort (d)', 'mm', 0.5, 1],
      ['launcher.h', 'Antena/probe (h)', 'mm', 0.5, 1],
    ]],
    ['Guia de onda 1', [['L1', 'Comprimento', 'mm', 5, 0]]],
    ['Isolador 3 vias + water load', [
      ['circ.ilDb', 'Perda de inserção', 'dB', 0.01, 0],
      ['circ.isoDb', 'Isolação', 'dB', 1, 5],
      ['circ.rlDb', 'Perda de retorno das portas', 'dB', 1, 5],
      ['water.rlDb', 'Perda de retorno da water load', 'dB', 1, 5],
      ['water.flow', 'Vazão de água', 'L/min', 0.5, 0],
    ]],
    ['Guia de onda 2', [['L2', 'Comprimento', 'mm', 5, 0]]],
    ['Transição WR340 → coaxial', [
      ['trans.d', 'Backshort (d)', 'mm', 0.5, 1],
      ['trans.h', 'Probe (h)', 'mm', 0.5, 1],
      ['trans.ilDb', 'Perda extra', 'dB', 0.01, 0],
    ]],
    ['Tubo coaxial', [
      ['coax.Do', 'Ø interno do externo', 'mm', 0.1, 5],
      ['coax.Di', 'Ø do condutor interno', 'mm', 0.1, 1],
      ['coax.L', 'Comprimento', 'mm', 5, 0],
      ['coax.epsr', 'εr do dielétrico', '', 0.1, 1],
      ['coax.tand', 'tan δ do dielétrico', '', 0.0001, 0],
    ]],
    ['Ressonador (ponta)', [
      ['res.Do', 'Ø da cavidade', 'mm', 0.5, 5],
      ['res.Di', 'Ø do condutor central', 'mm', 0.5, 1],
      ['res.l', 'Comprimento do stub', 'mm', 0.1, 0.5],
      ['res.gap', 'Gap capacitivo', 'mm', 0.1, 0.2],
      ['res.fill', 'Fração do gap com amostra', '', 0.05, 0],
      ['res.n', 'Acoplamento (razão n:1)', '', 0.1, 0.01],
    ]],
    ['Amostra / térmica', [
      ['sample.epsr', "ε' da amostra", '', 0.1, 1],
      ['sample.tand', 'tan δ da amostra', '', 0.001, 0],
      ['sample.kEps', "d(ε')/dT relativo", '1/K', 0.0005, -1],
      ['sample.kTand', 'd(tan δ)/dT relativo', '1/K', 0.0005, -1],
      ['sample.mass', 'Massa', 'g', 10, 0.1],
      ['sample.cp', 'Calor específico', 'J/kg·K', 100, 1],
      ['sample.hA', 'Perda térmica hA', 'W/K', 0.05, 0],
      ['sample.T0', 'Temperatura inicial', '°C', 1, -50],
      ['sample.Tamb', 'Temperatura ambiente', '°C', 1, -50],
      ['sim.tmax', 'Tempo simulado', 's', 5, 1],
    ]],
  ];

  const $ = (s) => document.querySelector(s);
  const inputs = {};
  let tab = 'freq';
  const view = {
    freq: { f0: 2.44, f1: 2.48 },
    par: { path: 'L2', v0: 200, v1: 600 },
  };

  // --------------------------------------------------------------- parâmetros
  function buildParams() {
    const host = $('#params');
    SCHEMA.forEach(([title, rows], gi) => {
      const d = document.createElement('details');
      if (gi < 2 || title.startsWith('Ressonador')) d.open = true;
      d.innerHTML = '<summary>' + title + '</summary>';
      if (title.startsWith('Magnetron')) {
        const sel = document.createElement('div');
        sel.className = 'grid';
        sel.innerHTML = '<select id="magSel" style="grid-column:1/4"></select>';
        d.append(sel);
        const info = document.createElement('div');
        info.id = 'magInfo'; info.className = 'note'; info.style.padding = '0 14px 8px';
        d.append(info);
      }
      const g = document.createElement('div');
      g.className = 'grid';
      rows.forEach(([path, label, unit, step, min]) => {
        const l = document.createElement('label'); l.textContent = label;
        const i = document.createElement('input');
        i.type = 'number'; i.step = step; i.min = min; i.value = MW.getPath(P, path);
        i.addEventListener('input', () => {
          const v = parseFloat(i.value);
          if (!isNaN(v)) { MW.setPath(P, path, v); schedule(); }
        });
        const u = document.createElement('span'); u.className = 'u'; u.textContent = unit;
        inputs[path] = i;
        g.append(l, i, u);
      });
      d.append(g);
      if (title.startsWith('Ressonador')) {
        const b = document.createElement('div'); b.className = 'btns';
        b.innerHTML = '<button id="bTune">Sintonizar comprimento</button><button id="bCoup">Acoplamento crítico</button>';
        d.append(b);
      }
      if (title.startsWith('Magnetron')) {
        const b = document.createElement('div'); b.className = 'btns';
        b.innerHTML = '<button id="bReset">Restaurar padrões</button>';
        d.append(b);
      }
      host.append(d);
    });
    const ms = $('#magSel');
    Object.keys(MW.MAGNETRONS).forEach((k) => {
      const o = document.createElement('option'); o.value = k; o.textContent = MW.MAGNETRONS[k].name; ms.append(o);
    });
    ms.value = P.src.model;
    ms.onchange = () => { applyMagnetron(ms.value, true); };
    applyMagnetron(P.src.model, false);
    $('#bTune').onclick = () => {
      // sintoniza com a amostra à temperatura inicial
      setParam('res.l', +MW.tuneResonatorLength(P).toFixed(3));
    };
    $('#bCoup').onclick = () => setParam('res.n', +MW.criticalCoupling(P).toFixed(3));
    $('#bReset').onclick = () => {
      const d = MW.clone(MW.DEFAULTS);
      Object.keys(inputs).forEach((k) => setParam(k, MW.getPath(d, k), true));
      $('#magSel').value = d.src.model; applyMagnetron(d.src.model, false);
      schedule();
    };
  }
  function applyMagnetron(key, load) {
    const m = MW.MAGNETRONS[key];
    P.src.model = key;
    if (load) { setParam('src.pav', m.pav, true); setParam('src.f', m.fNom, true); }
    const pdc = m.vaPk * 1e3 * m.iaMean;               // W (aprox., tensão de pico x corrente média)
    const pAnode = pdc - m.pav;
    const dTw = pAnode / (m.water / 60 * 0.997 * 4186);
    $('#magInfo').innerHTML =
      'Faixa ' + m.fMin.toFixed(2) + '–' + m.fMax.toFixed(2) + ' GHz (típ. ' + m.fNom.toFixed(2) + ') · ' +
      (m.pav / 1e3) + ' kW com isolador / ' + (m.pavNoIso / 1e3) + ' kW sem · η ' + (m.eff * 100).toFixed(0) + '%<br>' +
      'Va ' + m.vaPk + ' kV · Ia ' + (m.iaMean * 1e3).toFixed(0) + ' mA (pico ' + (m.iaPk * 1e3).toFixed(0) + ') · filamento ' + m.vfStart +
      ' V / ' + m.ifStart + ' A · eletroímã ' + m.imag + ' A<br>' +
      'Água ' + m.water + ' L/min · VSWR de carga típico ≤ ' + m.vswrMax + '<br>' +
      'Dissipação no anodo ≈ ' + (pAnode / 1e3).toFixed(1) + ' kW → ΔT água ≈ ' + dTw.toFixed(1) + ' K';
    if (load) schedule();
  }
  function setParam(path, v, silent) {
    MW.setPath(P, path, v);
    inputs[path].value = v;
    if (!silent) schedule();
  }

  let timer = null;
  function schedule() { clearTimeout(timer); timer = setTimeout(update, 60); }

  // ----------------------------------------------------------------- formatação
  const fW = (w) => (Math.abs(w) >= 1000 ? (w / 1000).toFixed(3) + ' kW' : w.toFixed(Math.abs(w) < 10 ? 2 : 1) + ' W');
  const fPct = (w, ref) => (100 * w / Math.max(ref, 1e-9)).toFixed(1) + '%';

  // ----------------------------------------------------------------- resultados
  function renderChain(r) {
    const ref = r.pLaunch;
    const blk = (cls, name, val, sub) => '<div class="blk ' + cls + '"><b>' + name + '</b><div class="v">' + val + '</div><div class="s">' + sub + '</div></div>';
    const A = '<span class="arrow">➜</span>';
    $('#chain').innerHTML =
      blk('src', 'Magnetron + launcher', fW(r.pLaunch), '|Γ| launcher ' + r.gammaLauncher.toFixed(3)) + A +
      blk('', 'Guia 1', '−' + fW(r.pG1), 'λg ' + (r.lambdaG * 1e3).toFixed(1) + ' mm') + A +
      '<div class="stack">' +
        blk('', 'Isolador 3 vias', '−' + fW(r.pCirc), 'ao magnetron: ' + fW(r.pBackMag)) +
        blk('wl', 'Water load', fW(r.pWater), 'ΔT água ' + (isFinite(r.waterDeltaT) ? r.waterDeltaT.toFixed(2) + ' K' : '—')) +
      '</div>' + A +
      blk('', 'Guia 2', '−' + fW(r.pG2), 'VSWR carga ' + fmtV(r.vswrLoad)) + A +
      blk('', 'Transição WR340/coax', '−' + fW(r.pTr), '|Γ| ' + r.gammaTransition.toFixed(3)) + A +
      blk('', 'Coaxial', '−' + fW(r.pCoax), 'Z0 ' + r.z0coax.toFixed(1) + ' Ω') + A +
      blk('sink', 'Ressonador', fW(r.pRes), 'amostra ' + fW(r.pSample) + ' · parede ' + fW(r.pWall));
    void ref;
  }
  const fmtV = (v) => (isFinite(v) ? v.toFixed(2) : '∞');

  function renderKpis(r) {
    const eff = r.pSample / P.src.pav * 100;
    const eMarg = r.eBreakdown / Math.max(r.eCoax, 1);
    const k = (l, n, s, cls) => '<div class="panel kpi"><div class="l">' + l + '</div><div class="n ' + (cls || '') + '">' + n + (s ? ' <small>' + s + '</small>' : '') + '</div></div>';
    $('#kpis').innerHTML =
      k('Potência na amostra', fW(r.pSample), eff.toFixed(1) + '% da disponível', eff > 80 ? 'good' : eff < 50 ? 'bad' : '') +
      k('Refletida ao magnetron', fW(r.pBackMag), 'VSWR ' + r.vswrMag.toFixed(2), r.pBackMag > 0.05 * P.src.pav ? 'bad' : '') +
      k('Dissipada na water load', fW(r.pWater), fPct(r.pWater, r.pLaunch)) +
      k('VSWR do ressonador', fmtV(r.vswrRes), '|Γ| ' + r.gammaRes.toFixed(3), r.vswrRes < 1.5 ? 'good' : 'bad') +
      k('Q carregado (amostra)', r.qSampleLoaded.toFixed(0), 'Q0 ' + r.qUnloaded.toFixed(0)) +
      k('E máx. no coax', (r.eCoax / 1e3).toFixed(0) + ' kV/m', 'margem ×' + eMarg.toFixed(0), eMarg < 3 ? 'bad' : '') +
      k('E máx. no guia', (r.eWg / 1e3).toFixed(0) + ' kV/m', 'fc ' + (r.fc / 1e9).toFixed(3) + ' GHz');
    const w = [];
    if (eMarg < 3) w.push('Campo no coaxial próximo da ruptura do ar (~3 MV/m): risco de arco.');
    if (r.pBackMag > 0.05 * P.src.pav) w.push('Mais de 5% da potência volta ao magnetron: ajuste launcher/comprimentos.');
    if (r.vswrLoad > 3) w.push('VSWR alto na carga: o isolador está desviando muita potência para a water load.');
    const mg = MW.MAGNETRONS[P.src.model];
    if (mg) {
      if (P.src.f < mg.fMin || P.src.f > mg.fMax) w.push('Frequência fora da faixa do ' + mg.name.split(' ')[0] + ' (' + mg.fMin + '–' + mg.fMax + ' GHz).');
      if (r.vswrMag > mg.vswrMax) w.push('VSWR visto pelo magnetron (' + r.vswrMag.toFixed(2) + ') acima do típico (' + mg.vswrMax + '): risco de pulling e sobreaquecimento do anodo.');
      if (P.src.pav > mg.pav) w.push('Potência acima da especificada para o ' + mg.name.split(' ')[0] + ' (' + mg.pav + ' W).');
    }
    if (P.res.Di >= P.res.Do) w.push('Ressonador: Ø central ≥ Ø da cavidade.');
    if (P.coax.Di >= P.coax.Do) w.push('Coax: Ø do condutor interno ≥ Ø do externo.');
    showWarn(w);
  }
  function showWarn(list) {
    const el = $('#warn');
    el.style.display = list.length ? 'block' : 'none';
    el.innerHTML = list.map((s) => '⚠ ' + s).join('<br>');
  }

  // ------------------------------------------------------------------- gráficos
  function colors() {
    const s = getComputedStyle(document.documentElement);
    const g = (n) => s.getPropertyValue(n).trim();
    return { ink: g('--ink'), muted: g('--muted'), line: g('--line'), series: [g('--accent'), g('--a2'), g('--a3'), g('--a4')] };
  }
  function plot(canvas, series, o) {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const c = canvas.getContext('2d'); c.scale(dpr, dpr);
    const col = colors();
    const m = { l: 62, r: 14, t: 14, b: 62 };
    let x0 = Infinity, x1 = -Infinity, y0 = o.ymin != null ? o.ymin : Infinity, y1 = o.ymax != null ? o.ymax : -Infinity;
    series.forEach((s) => s.pts.forEach(([x, y]) => {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      if (o.ymin == null) y0 = Math.min(y0, y);
      if (o.ymax == null) y1 = Math.max(y1, y);
    }));
    if (!(y1 > y0)) { y1 = y0 + 1; }
    if (o.ymin == null) y0 = y0 - (y1 - y0) * 0.05;
    if (o.ymax == null) y1 = y1 + (y1 - y0) * 0.05;
    const X = (x) => m.l + (x - x0) / (x1 - x0 || 1) * (W - m.l - m.r);
    const Y = (y) => H - m.b - (y - y0) / (y1 - y0) * (H - m.t - m.b);
    c.font = '12px system-ui'; c.fillStyle = col.muted; c.strokeStyle = col.line; c.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = y0 + (y1 - y0) * i / 5, py = Y(y);
      c.beginPath(); c.moveTo(m.l, py); c.lineTo(W - m.r, py); c.stroke();
      c.textAlign = 'right'; c.fillText(nice(y), m.l - 6, py + 4);
      const x = x0 + (x1 - x0) * i / 5, px = X(x);
      c.textAlign = 'center'; c.fillText(nice(x), px, H - m.b + 16);
    }
    c.fillStyle = col.ink; c.textAlign = 'center';
    c.fillText(o.xlabel, m.l + (W - m.l - m.r) / 2, H - m.b + 34);
    c.save(); c.translate(14, m.t + (H - m.t - m.b) / 2); c.rotate(-Math.PI / 2); c.fillText(o.ylabel, 0, 0); c.restore();
    series.forEach((s, i) => {
      c.strokeStyle = s.color || col.series[i % 4]; c.lineWidth = 2; c.beginPath();
      s.pts.forEach(([x, y], j) => (j ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y))));
      c.stroke();
      c.fillStyle = c.strokeStyle; c.textAlign = 'left';
      const lx = m.l + 10 + i * 170, ly = H - 10;
      c.fillRect(lx, ly - 8, 14, 3); c.fillStyle = col.ink; c.fillText(s.label, lx + 20, ly - 2);
    });
    if (o.marker != null && o.marker >= x0 && o.marker <= x1) {
      c.strokeStyle = col.muted; c.setLineDash([4, 4]); c.beginPath();
      c.moveTo(X(o.marker), m.t); c.lineTo(X(o.marker), H - m.b); c.stroke(); c.setLineDash([]);
    }
  }
  function nice(v) {
    const a = Math.abs(v);
    if (a === 0) return '0';
    if (a >= 1000) return (v / 1000).toFixed(1) + 'k';
    if (a >= 100) return v.toFixed(0);
    if (a >= 10) return v.toFixed(1);
    if (a >= 1) return v.toFixed(2);
    return v.toFixed(3);
  }

  // --------------------------------------------------------------------- abas
  const PARAM_LIST = [
    ['L1', 'Comprimento guia 1 (mm)'], ['L2', 'Comprimento guia 2 (mm)'], ['coax.L', 'Comprimento coax (mm)'],
    ['launcher.d', 'Backshort launcher (mm)'], ['launcher.h', 'Probe launcher (mm)'],
    ['trans.d', 'Backshort transição (mm)'], ['trans.h', 'Probe transição (mm)'],
    ['res.l', 'Stub ressonador (mm)'], ['res.gap', 'Gap ressonador (mm)'], ['res.n', 'Acoplamento n'],
    ['sample.tand', 'tan δ da amostra'], ['sample.epsr', "ε' da amostra"], ['src.f', 'Frequência (GHz)'],
    ['wg.a', 'Largura a (mm)'], ['wg.b', 'Altura b (mm)'],
  ];

  function renderTab() {
    const body = $('#tabbody');
    if (tab === 'freq') {
      body.innerHTML = '<div class="ctl"><label>De <input type="number" id="f0" step="0.005" value="' + view.freq.f0 + '"> GHz</label>' +
        '<label>até <input type="number" id="f1" step="0.005" value="' + view.freq.f1 + '"> GHz</label></div><canvas id="cv"></canvas>';
      ['f0', 'f1'].forEach((id) => $('#' + id).addEventListener('input', (e) => { view.freq[id] = parseFloat(e.target.value); drawTab(); }));
    } else if (tab === 'par') {
      body.innerHTML = '<div class="ctl"><label>Parâmetro <select id="pp">' +
        PARAM_LIST.map(([k, n]) => '<option value="' + k + '"' + (k === view.par.path ? ' selected' : '') + '>' + n + '</option>').join('') +
        '</select></label><label>de <input type="number" id="pv0" step="any" value="' + view.par.v0 + '"></label>' +
        '<label>até <input type="number" id="pv1" step="any" value="' + view.par.v1 + '"></label></div><canvas id="cv"></canvas>';
      $('#pp').addEventListener('change', (e) => {
        view.par.path = e.target.value;
        const cur = MW.getPath(P, view.par.path);
        view.par.v0 = +(cur * 0.6).toPrecision(4); view.par.v1 = +(cur * 1.4).toPrecision(4);
        renderTab(); drawTab();
      });
      ['pv0', 'pv1'].forEach((id) => $('#' + id).addEventListener('input', (e) => { view.par[id.slice(1)] = parseFloat(e.target.value); drawTab(); }));
    } else if (tab === 'heat') {
      body.innerHTML = '<canvas id="cv"></canvas><canvas id="cv2"></canvas>';
    } else {
      body.innerHTML = '<table id="bal"></table>';
    }
    drawTab();
  }

  function drawTab() {
    const cv = $('#cv');
    if (tab === 'freq') {
      const { f0, f1 } = view.freq;
      if (!(f1 > f0)) return;
      const rs = MW.sweepFrequency(P, f0, f1, 241);
      const pts = (fn) => rs.map((r) => [r.f / 1e9, r.propagating ? fn(r) : 0]);
      plot(cv, [
        { label: 'Amostra', pts: pts((r) => r.pSample) },
        { label: 'Water load', pts: pts((r) => r.pWater) },
        { label: 'Retorno ao magnetron', pts: pts((r) => r.pBackMag) },
      ], { xlabel: 'Frequência (GHz)', ylabel: 'Potência (W)', ymin: 0, marker: P.src.f });
    } else if (tab === 'par') {
      const { path, v0, v1 } = view.par;
      if (!(v1 > v0)) return;
      const rs = MW.sweepParam(P, path, v0, v1, 241);
      const pts = (fn) => rs.map((r) => [r.x, r.propagating ? fn(r) : 0]);
      plot(cv, [
        { label: 'Amostra', pts: pts((r) => r.pSample) },
        { label: 'Water load', pts: pts((r) => r.pWater) },
        { label: 'Retorno ao magnetron', pts: pts((r) => r.pBackMag) },
      ], { xlabel: PARAM_LIST.find((x) => x[0] === path)[1], ylabel: 'Potência (W)', ymin: 0, marker: MW.getPath(P, path) });
    } else if (tab === 'heat') {
      const rows = MW.simulateHeating(P);
      plot(cv, [{ label: 'Temperatura da amostra', pts: rows.map((r) => [r.t, r.T]) }],
        { xlabel: 'Tempo (s)', ylabel: 'Temperatura (°C)' });
      plot($('#cv2'), [
        { label: 'Amostra', pts: rows.map((r) => [r.t, r.pSample]) },
        { label: 'Water load', pts: rows.map((r) => [r.t, r.pWater]) },
        { label: 'Retorno ao magnetron', pts: rows.map((r) => [r.t, r.pBackMag]) },
      ], { xlabel: 'Tempo (s)', ylabel: 'Potência (W)', ymin: 0 });
    } else {
      const r = MW.simulate(P, P.src.f * 1e9, P.sample.T0);
      if (!r.propagating) return;
      const rowsT = [
        ['Potência disponível (magnetron)', P.src.pav],
        ['Entregue ao launcher', r.pLaunch],
        ['− perda guia 1', r.pG1], ['− perda no isolador', r.pCirc], ['− absorvida na water load', r.pWater],
        ['− perda guia 2', r.pG2], ['− perda na transição', r.pTr], ['− perda no coaxial', r.pCoax],
        ['− perda nas paredes do ressonador', r.pWall], ['= absorvida na amostra', r.pSample],
      ];
      $('#bal').innerHTML = '<tr><th>Etapa</th><th class="r">Potência</th><th class="r">% do entregue</th></tr>' +
        rowsT.map(([n, v]) => '<tr><td>' + n + '</td><td class="r">' + fW(v) + '</td><td class="r">' + fPct(v, r.pLaunch) + '</td></tr>').join('') +
        '<tr><td>Resíduo de conservação</td><td class="r">' + r.closure.toExponential(1) + ' W</td><td></td></tr>';
    }
  }

  function update() {
    const r = MW.simulate(P, P.src.f * 1e9, P.sample.T0);
    if (!r.propagating) { showWarn([r.warn]); $('#chain').innerHTML = ''; $('#kpis').innerHTML = ''; return; }
    renderChain(r); renderKpis(r); drawTab();
  }

  document.addEventListener('DOMContentLoaded', () => {
    buildParams();
    $('#tabs').addEventListener('click', (e) => {
      const t = e.target.closest('.tab'); if (!t) return;
      tab = t.dataset.t;
      document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === t));
      renderTab();
    });
    window.addEventListener('resize', drawTab);
    renderTab(); update();
  });
})();
