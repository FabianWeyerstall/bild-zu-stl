(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const ui = {
    file: $('file'), drop: $('drop'), dropText: $('dropText'),
    width: $('width'), height: $('height'), border: $('border'), sizeInfo: $('sizeInfo'),
    thin: $('thin'), threshold: $('threshold'), thresholdOut: $('thresholdOut'),
    invert: $('invert'), smooth: $('smooth'),
    minSteg: $('minSteg'), corner: $('corner'), bridge: $('bridge'), maxTile: $('maxTile'), clearance: $('clearance'),
    exportBtn: $('export'), status: $('status'), info: $('info'),
    overlay: $('overlay'), canvas: $('canvas'), empty: $('empty'),
    tabs: $('tabs'), drag: $('drag'), resetEdits: $('resetEdits'), busy: $('busy'), busyText: $('busyText'),
  };

  const KNOB = { knobR: 3.5, neckW: 3.5, neckL: 2, knobSpacing: 40 };
  const MAX_GRID = 3500;

  let image = null;
  let imageName = 'schablone';
  let result = null; // { st, tiles, settings }
  let timer = null;
  let running = false;
  let pending = false;
  let base = null, baseKey = '';
  // Änderungen an Stegen, relativ zur Bildfläche (0..1), damit sie Größenänderungen überstehen
  let edits = { removed: [], added: [] };

  const num = (el, def) => {
    const v = parseFloat(String(el.value).replace(',', '.'));
    return Number.isFinite(v) ? v : def;
  };
  const radio = (name) => parseFloat(document.querySelector(`input[name=${name}]:checked`).value);
  const fmt = (v, d = 0) => v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

  function readSettings() {
    const s = {
      widthMM: Math.max(20, num(ui.width, 400)),
      heightMM: Math.max(20, num(ui.height, 300)),
      borderMM: Math.max(0, num(ui.border, 10)),
      tabMM: ui.tabs.checked ? 12 : 0,
      thickness: radio('thick'),
      markerMM: radio('marker'),
      widenThin: ui.thin.value === 'widen',
      threshold: parseInt(ui.threshold.value, 10),
      invert: ui.invert.checked,
      smoothMM: Math.max(0, num(ui.smooth, 0.3)),
      minStegMM: Math.max(0.8, num(ui.minSteg, 2)),
      bridgeMM: Math.max(0.8, num(ui.bridge, 2)),
      cornerMM: Math.max(0, num(ui.corner, 1)),
      maxTileMM: Math.min(Math.min(...bed()), Math.max(60, num(ui.maxTile, 240))),
      clearanceMM: Math.max(0.05, num(ui.clearance, 0.2)),
    };
    const totalW = s.widthMM + 2 * s.borderMM, totalH = s.heightMM + 2 * s.borderMM;
    const finest = Math.min(s.markerMM, s.minStegMM, s.bridgeMM);
    s.px = Math.max(finest / 8, Math.max(totalW, totalH) / MAX_GRID, 0.1);
    s.px = Math.round(s.px * 1000) / 1000;
    return s;
  }

  // --- Bild laden ---------------------------------------------------------

  function loadFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      setStatus('Bitte eine Bilddatei wählen (PNG, JPG, …).');
      return;
    }
    imageName = file.name.replace(/\.[^.]+$/, '').replace(/[^\w\-äöüÄÖÜß]+/g, '_') || 'schablone';
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      image = img;
      base = null;
      edits = { removed: [], added: [] };
      ui.dropText.textContent = `${file.name} (${img.naturalWidth} × ${img.naturalHeight} px)`;
      ui.empty.style.display = 'none';
      syncHeight();
      schedule(0);
    };
    img.onerror = () => setStatus('Das Bild konnte nicht gelesen werden.');
    img.src = url;
  }

  ui.file.addEventListener('change', () => loadFile(ui.file.files[0]));
  ['dragenter', 'dragover'].forEach((ev) => ui.drop.addEventListener(ev, (e) => { e.preventDefault(); ui.drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => ui.drop.addEventListener(ev, (e) => { e.preventDefault(); ui.drop.classList.remove('over'); }));
  ui.drop.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));

  // --- Seitenverhältnis halten -------------------------------------------

  const aspect = () => (image ? image.naturalHeight / image.naturalWidth : 0.75);
  function syncHeight() { ui.height.value = Math.round(num(ui.width, 400) * aspect()); syncPlates(); }
  function syncWidth() { ui.width.value = Math.round(num(ui.height, 300) / aspect()); syncPlates(); }
  ui.width.addEventListener('input', () => { syncHeight(); schedule(); });
  ui.height.addEventListener('input', () => { syncWidth(); schedule(); });
  $('widthRange').addEventListener('input', (e) => { ui.width.value = e.target.value; syncHeight(); saveSettings(); schedule(); });

  // --- Plattenaufteilung: wie viele Druckplatten ergibt welche Breite? ----

  // Druckbett des gewählten Bambu-Druckers (Breite × Tiefe in mm)
  const bed = () => $('printer').value.split(':')[0].split('x').map(Number);
  // Bambu-Projektvorlage je Drucker, sonst die des X1C
  const PROJECTS = { a1: self.BAMBU_PROJECT_SETTINGS_A1, a1mini: self.BAMBU_PROJECT_SETTINGS_A1MINI, h2d: self.BAMBU_PROJECT_SETTINGS_H2D };
  const ownProject = () => PROJECTS[$('printer').value.split(':')[1]];
  const projectSettings = () => ownProject() || self.BAMBU_PROJECT_SETTINGS;
  const tileForBed = () => Math.min(...bed()) - 16;
  $('printer').addEventListener('change', () => { ui.maxTile.value = tileForBed(); saveSettings(); });
  function plateGeometry() {
    const s = readSettings();
    const margin = s.borderMM + s.tabMM;
    const knobLen = KNOB.neckL + 2 * KNOB.knobR;
    const tiles = (size) => (size <= s.maxTileMM ? 1 : Math.ceil(size / (s.maxTileMM - knobLen)));
    // größte Gesamtlänge, die noch in n Kacheln passt (1 mm Reserve für Rundung)
    const cap = (n) => (n === 1 ? s.maxTileMM : n * (s.maxTileMM - knobLen)) - 1;
    return { s, margin, tiles, cap };
  }
  function platesFor(width) {
    const { margin, tiles } = plateGeometry();
    const tw = width + 2 * margin, th = width * aspect() + 2 * margin;
    const nx = tiles(tw), ny = tiles(th);
    return { nx, ny, n: nx * ny, use: (tw * th) / (nx * ny * bed()[0] * bed()[1]) };
  }
  function sweetSpots() {
    const { margin, cap } = plateGeometry();
    const a = aspect();
    const best = new Map();
    for (let c = 1; c <= 8; c++) {
      for (let r = 1; r <= 8; r++) {
        const w = Math.floor(Math.min(cap(c) - 2 * margin, (cap(r) - 2 * margin) / a));
        if (w < 30) continue;
        const p = platesFor(w);
        if (p.n > 36) continue;
        if (!best.has(p.n) || best.get(p.n).w < w) best.set(p.n, { w, ...p });
      }
    }
    // nur Stufen, bei denen mehr Platten auch mehr Größe bringen
    const list = [...best.values()].sort((x, y) => x.n - y.n);
    const out = [];
    for (const e of list) if (!out.length || e.w > out[out.length - 1].w * 1.05) out.push(e);
    return out;
  }
  function syncPlates() {
    const w = num(ui.width, 400);
    const range = $('widthRange');
    range.max = Math.max(1500, Math.ceil(w));
    range.value = w;
    const p = platesFor(w);
    $('plateInfo').textContent = `${p.nx} × ${p.ny} = ${p.n} Platte${p.n === 1 ? '' : 'n'} · Platten zu ${Math.round(p.use * 100)} % genutzt`;
    const spots = sweetSpots();
    $('sweetSpots').innerHTML = spots.map((e) => `<option value="${e.w}"></option>`).join('');
    const box = $('fitButtons');
    box.innerHTML = '';
    for (const e of spots) {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `<b>${e.n}</b> ${e.n === 1 ? 'Platte' : 'Platten'}: ${e.w} mm`;
      b.title = `${e.n} ${e.n === 1 ? 'Platte' : 'Platten'} (${e.nx} × ${e.ny}), Breite bis ${e.w} mm`;
      if (e.n === p.n) b.classList.add('active');
      b.addEventListener('click', () => { ui.width.value = e.w; syncHeight(); saveSettings(); schedule(0); });
      box.appendChild(b);
    }
  }

  ui.threshold.addEventListener('input', () => { ui.thresholdOut.textContent = ui.threshold.value; schedule(); });
  document.querySelectorAll('#settings input, #settings select').forEach((el) => {
    if (el === ui.width || el === ui.height || el === ui.threshold || el === ui.file || el.id === 'format' || el.id === 'widthRange' || el.id === 'vector') return;
    el.addEventListener('change', () => { syncPlates(); schedule(); });
  });
  ui.overlay.addEventListener('change', () => result && render());

  // --- Einstellungen im Browser merken -----------------------------------

  const STORE = 'bild-zu-stl:einstellungen';
  const storable = () => [...document.querySelectorAll('#settings input, #settings select')]
    .filter((el) => el !== ui.file && el !== ui.height && el.id !== 'widthRange');
  const key = (el) => (el.type === 'radio' ? el.name + '=' + el.value : el.id);
  function saveSettings() {
    const data = {};
    for (const el of storable()) data[key(el)] = el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value;
    try { localStorage.setItem(STORE, JSON.stringify(data)); } catch (e) { /* privates Fenster o. ä. */ }
  }
  function restoreSettings() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { data = null; }
    if (!data) return;
    for (const el of storable()) {
      const v = data[key(el)];
      if (v === undefined) continue;
      if (el.type === 'checkbox' || el.type === 'radio') el.checked = !!v;
      else el.value = v;
      if (el.tagName === 'SELECT' && el.selectedIndex < 0) el.selectedIndex = 0; // Eintrag gibt es nicht mehr
    }
    ui.thresholdOut.textContent = ui.threshold.value;
  }
  restoreSettings();
  syncHeight();
  storable().forEach((el) => { el.addEventListener('change', saveSettings); el.addEventListener('input', saveSettings); });
  $('resetSettings').addEventListener('click', () => {
    try { localStorage.removeItem(STORE); } catch (e) { /* egal */ }
    location.reload();
  });
  syncPlates();
  const syncThinHint = () => { $('thinHint').hidden = radio('thick') > 0.25; };
  document.querySelectorAll('input[name=thick]').forEach((el) => el.addEventListener('change', syncThinHint));
  syncThinHint();

  // --- Berechnung ---------------------------------------------------------

  function setStatus(t) { ui.status.textContent = t; }

  function setBusy(on, text) {
    ui.busy.hidden = !on || !image;
    if (text) ui.busyText.textContent = text;
  }

  function schedule(delay = 450) {
    setBusy(true, 'Bild wird angepasst …');
    clearTimeout(timer);
    timer = setTimeout(run, delay);
  }

  function rasterize(s) {
    const iw = Math.max(1, Math.round(s.widthMM / s.px));
    const ih = Math.max(1, Math.round(s.heightMM / s.px));
    const c = document.createElement('canvas');
    c.width = iw;
    c.height = ih;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, iw, ih);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, iw, ih);
    const d = ctx.getImageData(0, 0, iw, ih).data;
    const gray = new Uint8Array(iw * ih);
    for (let i = 0; i < iw * ih; i++) gray[i] = Math.round(0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2]);
    return { gray, iw, ih };
  }

  async function run() {
    if (!image) return;
    if (running) { pending = true; return; }
    running = true;
    ui.exportBtn.disabled = true;
    setStatus('Berechne Vorschau …');
    await new Promise((r) => setTimeout(r, 30));
    try {
      const s = readSettings();
      const t0 = performance.now();
      const key = JSON.stringify([s.px, s.widthMM, s.heightMM, s.borderMM, s.tabMM, s.markerMM, s.widenThin, s.threshold, s.invert, s.smoothMM, s.minStegMM]);
      if (!base || key !== baseKey) {
        const { gray, iw, ih } = rasterize(s);
        base = Stencil.prepareStencil(gray, iw, ih, s);
        baseKey = key;
      }
      const st = Stencil.finishStencil(base, s, gridEdits(base));
      const tiles = Stencil.makeTiles(st, { ...s, ...KNOB });
      result = { st, tiles, s };
      render();
      describe(performance.now() - t0);
      ui.exportBtn.disabled = false;
    } catch (err) {
      console.error(err);
      setStatus('Fehler bei der Berechnung: ' + err.message);
    }
    running = false;
    if (pending) { pending = false; run(); }
    else setBusy(false);
  }

  // --- Stege von Hand bearbeiten -----------------------------------------

  function toGrid(g, u, v) {
    const b = g.border;
    return [b + u * (g.W - 2 * b), b + v * (g.H - 2 * b)];
  }
  function toUnit(g, x, y) {
    const b = g.border;
    return [(x - b) / (g.W - 2 * b), (y - b) / (g.H - 2 * b)];
  }
  function gridEdits(g) {
    return {
      removed: edits.removed.map(([u, v]) => toGrid(g, u, v)),
      added: edits.added.map(([u1, v1, u2, v2]) => toGrid(g, u1, v1).concat(toGrid(g, u2, v2))),
    };
  }
  function eventToGrid(e) {
    const r = ui.canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * ui.canvas.width, ((e.clientY - r.top) / r.height) * ui.canvas.height];
  }
  function segDist(px, py, [ax, ay, bx, by]) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    return Math.hypot(ax + t * dx - px, ay + t * dy - py);
  }

  let dragStart = null;
  ui.canvas.addEventListener('pointerdown', (e) => {
    if (!result) return;
    if (running) { setStatus('Moment, die Vorschau wird noch berechnet …'); return; }
    e.preventDefault();
    try { ui.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ältere Browser */ }
    dragStart = { grid: eventToGrid(e), x: e.clientX, y: e.clientY };
  });
  ui.canvas.addEventListener('pointermove', (e) => {
    if (!dragStart) return;
    const [x, y] = eventToGrid(e);
    const [ax, ay] = dragStart.grid;
    const { st, s } = result;
    ui.drag.setAttribute('viewBox', `0 0 ${st.W} ${st.H}`);
    ui.drag.innerHTML = `<line x1="${ax}" y1="${ay}" x2="${x}" y2="${y}" stroke="#d64545" stroke-opacity="0.8" stroke-linecap="round" stroke-width="${Math.max(2, s.bridgeMM / st.px)}"/>`;
  });
  ui.canvas.addEventListener('pointerup', (e) => {
    if (!dragStart) return;
    const start = dragStart;
    dragStart = null;
    ui.drag.innerHTML = '';
    const { st, s } = result;
    const end = eventToGrid(e);
    const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
    if (moved > 6) {
      edits.added.push(toUnit(st, ...start.grid).concat(toUnit(st, ...end)));
      setStatus('Steg gesetzt, berechne neu …');
      schedule(0);
      return;
    }
    // Klick: nächstgelegenen Steg suchen
    const [px, py] = end;
    // Trefferradius: mindestens 14 Bildschirmpixel, damit auch kleine Stege gut zu treffen sind
    const screenPx = ui.canvas.width / ui.canvas.getBoundingClientRect().width;
    let best = null, bestD = Math.max(s.bridgeMM / st.px / 2 + 2.5 / st.px, 14 * screenPx);
    for (const b of st.bridges) {
      const d = segDist(px, py, b.seg);
      if (d < bestD) { bestD = d; best = b; }
    }
    if (!best) {
      setStatus('Kein Steg an dieser Stelle. Klicke direkt auf einen roten Steg oder ziehe eine Linie für einen neuen.');
      return;
    }
    const [ax, ay, bx, by] = best.seg;
    if (best.manual) {
      const k = st.bridges.filter((b) => b.manual).indexOf(best);
      edits.added.splice(k, 1);
    } else {
      edits.removed.push(toUnit(st, (ax + bx) / 2, (ay + by) / 2));
    }
    setStatus('Steg verschoben, berechne neu …');
    schedule(0);
  });
  ui.canvas.addEventListener('pointercancel', () => { dragStart = null; ui.drag.innerHTML = ''; });
  ui.resetEdits.addEventListener('click', () => {
    edits = { removed: [], added: [] };
    schedule(0);
  });

  function describe(ms) {
    const { st, tiles, s } = result;
    const totalW = st.W * st.px, totalH = st.H * st.px;
    ui.sizeInfo.textContent = `Gesamtgröße mit Rand: ${fmt(totalW)} × ${fmt(totalH)} mm`;
    const n = tiles.tiles.length;
    const biggest = tiles.tiles.reduce((m, t) => Math.max(m, t.widthMM, t.heightMM), 0);
    const loose = tiles.tiles.reduce((m, t) => m + Math.max(0, t.pieces - 1), 0);
    const parts = [
      n === 1 ? '1 Teil' : `${n} Kacheln (${tiles.ny} Reihen × ${tiles.nx} Spalten), größte Seite ${fmt(biggest)} mm`,
      `${st.bridged} Haltesteg${st.bridged === 1 ? '' : 'e'}`,
      n > 1 ? `${tiles.knobs.length} Puzzle-Verbinder` : null,
      `Raster ${fmt(st.px, 2)} mm`,
    ].filter(Boolean);
    let text = parts.join(' · ');
    if (edits.added.length) text += ` · ${edits.added.length} eigene${edits.added.length === 1 ? 'r' : ''} Steg${edits.added.length === 1 ? '' : 'e'}`;
    if (st.loose) text += ` · Achtung: ${st.loose} Teil${st.loose === 1 ? '' : 'e'} ohne Halt, setze dort einen Steg von Hand`;
    ui.resetEdits.disabled = !edits.added.length && !edits.removed.length;
    if (loose) text += ` · Hinweis: ${loose} lose${loose === 1 ? 's' : ''} Einzelteil${loose === 1 ? '' : 'e'} an Kachelkanten`;
    ui.info.textContent = text;
    setStatus(`Fertig in ${fmt(ms / 1000, 1)} s. Prüfe die Vorschau und exportiere dann.`);
  }

  // --- Vorschau -----------------------------------------------------------

  function cssColor(name) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const m = v.match(/^#([0-9a-f]{6})$/i);
    const n = m ? parseInt(m[1], 16) : 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function render() {
    const { st, tiles } = result;
    const { W, H, mat, holes0, bridgeMask, border } = st;
    const cv = ui.canvas;
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(W, H);
    const d = img.data;
    const C = {
      mat: cssColor('--mat'), lost: cssColor('--lost'), added: cssColor('--added'), bridge: cssColor('--bridge'),
      hole: [255, 255, 255], gap: [30, 34, 44],
    };
    const gap = tiles.gap;
    for (let i = 0; i < W * H; i++) {
      let c;
      if (st.markMask[i] || (gap[i] && mat[i])) c = C.gap;
      else if (bridgeMask[i] && mat[i]) c = C.bridge;
      else if (mat[i]) c = holes0[i] ? C.lost : C.mat;
      else c = holes0[i] ? C.hole : C.added;
      d[4 * i] = c[0]; d[4 * i + 1] = c[1]; d[4 * i + 2] = c[2];
      d[4 * i + 3] = !mat[i] && !st.area[i] ? 0 : 255;
    }
    ctx.putImageData(img, 0, 0);
    if (ui.overlay.checked && image) {
      ctx.globalAlpha = 0.35;
      ctx.drawImage(image, border, border, W - 2 * border, H - 2 * border);
      ctx.globalAlpha = 1;
    }
    if (tiles.tiles.length > 1) {
      ctx.font = `bold ${Math.max(14, Math.round(Math.min(W, H) / 30))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const t of tiles.tiles) {
        const x = (tiles.cutX[t.col] + tiles.cutX[t.col + 1]) / 2, y = (tiles.cutY[t.row] + tiles.cutY[t.row + 1]) / 2;
        const label = tileName(t);
        ctx.lineWidth = Math.max(3, W / 400);
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.strokeText(label, x, y);
        ctx.fillStyle = '#1d2330';
        ctx.fillText(label, x, y);
      }
    }
  }

  const tileName = (t) => `R${t.row + 1}-S${t.col + 1}`;

  // --- Export -------------------------------------------------------------

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  ui.exportBtn.addEventListener('click', async () => {
    if (!result) return;
    ui.exportBtn.disabled = true;
    const as3mf = $('format').value === '3mf';
    setBusy(true, as3mf ? '3MF wird erzeugt …' : 'STL-Dateien werden erzeugt …');
    const { st, tiles, s } = result;
    const single = tiles.tiles.length === 1;
    try {
      const parts = [];
      for (let k = 0; k < tiles.tiles.length; k++) {
        const t = tiles.tiles[k];
        setStatus(`Erzeuge Kachel ${k + 1} von ${tiles.tiles.length} …`);
        await new Promise((r) => setTimeout(r, 15));
        const tris = Stencil.maskToTriangles(t.mask, t.w, t.h, st.px, s.thickness, 0.7, $('vector').checked);
        parts.push({ name: single ? imageName : tileName(t), tris, width: t.widthMM, height: t.heightMM });
      }
      if (as3mf) {
        setStatus('Packe 3MF …');
        const zip = new JSZip();
        const files = ThreeMF.build(parts, imageName, projectSettings());
        for (const [path, text] of Object.entries(files)) zip.file(path, text);
        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: 'model/3mf' });
        download(blob, `${imageName}.3mf`);
        const other = !ownProject() && bed()[0] !== 256 ? ' Die Datei ist für den X1C eingerichtet: In Bambu Studio oben links deinen Drucker wählen und kurz prüfen, ob jede Kachel auf ihrer Platte liegt.' : '';
        setStatus((single ? '3MF heruntergeladen.' : `3MF mit ${parts.length} Platten heruntergeladen. In Bambu Studio öffnen und „Alle Platten slicen“.`) + other);
      } else if (single) {
        download(new Blob([Stencil.trianglesToSTL(parts[0].tris, parts[0].name)], { type: 'model/stl' }), `${imageName}.stl`);
        setStatus('STL heruntergeladen.');
      } else {
        setStatus('Packe ZIP …');
        const zip = new JSZip();
        for (const p of parts) zip.file(`${imageName}_${p.name}.stl`, Stencil.trianglesToSTL(p.tris, p.name));
        const png = await new Promise((r) => ui.canvas.toBlob(r, 'image/png'));
        zip.file('uebersicht.png', png);
        zip.file('anleitung.txt', instructions(tiles, st, s));
        download(await zip.generateAsync({ type: 'blob' }), `${imageName}_kacheln.zip`);
        setStatus(`ZIP mit ${parts.length} STL-Dateien heruntergeladen.`);
      }
    } catch (err) {
      console.error(err);
      setStatus('Fehler beim Export: ' + err.message);
    }
    setBusy(false);
    ui.exportBtn.disabled = false;
  });

  function instructions(tiles, st, s) {
    const lines = [
      'Bild zu STL - Schablone',
      '',
      `Gesamtgröße: ${fmt(st.W * st.px)} x ${fmt(st.H * st.px)} mm, Dicke ${fmt(s.thickness, 1)} mm, Marker ${fmt(s.markerMM)} mm`,
      `Kacheln: ${tiles.ny} Reihen x ${tiles.nx} Spalten. R = Reihe (von oben), S = Spalte (von links).`,
      'Die Lage jeder Kachel siehst du in uebersicht.png.',
      'Jede Kachel hat ihre Nummer als kleinen Ausschnitt: "1-2" heißt Reihe 1, Spalte 2.',
      '',
      'Drucken (Bambu Studio):',
      '- Jede STL einzeln oder mehrere zusammen auf die Platte legen.',
      '- Schichthöhe 0,2 mm, keine Stützen nötig.',
      '',
      'Zusammensetzen: Die Puzzle-Verbinder an den Kanten ineinander drücken.',
      s.tabMM ? 'Die Laschen am Außenrand sind zum Festkleben mit Malerkrepp gedacht.' : '',
    ];
    for (const t of tiles.tiles) lines.push(`${tileName(t)}: ${fmt(t.widthMM, 1)} x ${fmt(t.heightMM, 1)} mm`);
    return lines.join('\r\n');
  }
})();
