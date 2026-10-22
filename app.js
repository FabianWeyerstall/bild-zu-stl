(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const tr = I18N.tr;
  // Testumgebung (dev-Zweig unter /test/): sichtbar markiert, Einstellungen getrennt von der Live-Seite
  const TEST = /\/test\//.test(location.pathname);
  if (TEST) {
    document.title = 'TEST · ' + document.title;
    const badge = document.createElement('span');
    badge.className = 'testBadge';
    badge.textContent = 'TEST';
    document.querySelector('header h1').append(' ', badge);
  }
  let busyOn = false, lastMs = 0, dropLabel = null;
  const ui = {
    file: $('file'), drop: $('drop'), dropText: $('dropText'),
    width: $('width'), height: $('height'), border: $('border'), sizeInfo: $('sizeInfo'),
    thin: $('thin'), threshold: $('threshold'), thresholdOut: $('thresholdOut'),
    invert: $('invert'), smooth: $('smooth'),
    minSteg: $('minSteg'), corner: $('corner'), bridge: $('bridge'), maxTile: $('maxTile'), clearance: $('clearance'),
    exportBtn: $('export'), pdfBtn: $('pdf'), status: $('status'), info: $('info'),
    overlay: $('overlay'), canvas: $('canvas'), empty: $('empty'),
    tabs: $('tabs'), drag: $('drag'), resetEdits: $('resetEdits'), busy: $('busy'), busyText: $('busyText'),
  };

  const KNOB = { knobR: 3.5, neckW: 3.5, neckL: 2, knobSpacing: 40 };
  const MAX_GRID = 3500;

  let image = null;     // Bild, mit dem gerechnet wird (ggf. zugeschnitten)
  let original = null, originalName = '';
  let imageName = 'schablone';
  let result = null; // { st, tiles, settings }
  let timer = null;
  let running = false;
  let pending = false;
  let baseKey = ''; // Grundeinstellungen, mit denen der Rechner zuletzt vorbereitet wurde
  // Rechnen im Hintergrund: ein Worker für Vorschau und Export, einer für die Malbarkeit
  const VERSION = ((document.querySelector('script[src^="app.js"]') || {}).src || '').replace(/^[^?]*/, '');
  const WORKER_URL = 'jobs.js' + VERSION;
  const calc = StencilJobs.runner(WORKER_URL);
  const calcLoss = StencilJobs.runner(WORKER_URL);
  // Änderungen an Stegen, relativ zur Bildfläche (0..1), damit sie Größenänderungen überstehen
  let edits = { removed: [], added: [] };

  const num = (el, def) => {
    const v = parseFloat(String(el.value).replace(',', '.'));
    return Number.isFinite(v) ? v : def;
  };
  const radio = (name) => parseFloat(document.querySelector(`input[name=${name}]:checked`).value);
  const fmt = (v, d = 0) => v.toLocaleString(I18N.lang === 'en' ? 'en-US' : 'de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

  function readSettings() {
    const s = {
      widthMM: Math.max(20, num(ui.width, 400)),
      heightMM: Math.max(20, num(ui.height, 300)),
      borderMM: Math.max(0, num(ui.border, 10)),
      tabMM: ui.tabs.checked && !$('saveMaterial').checked ? 12 : 0,
      thickness: radio('thick'),
      markerMM: radio('marker'),
      widenThin: ui.thin.value === 'widen',
      slimMM: $('slim').value === 'slim' ? radio('marker') + 0.5 : 0,
      threshold: parseInt(ui.threshold.value, 10),
      invert: ui.invert.checked,
      smoothMM: Math.max(0, num(ui.smooth, 0.3)),
      minStegMM: Math.max(0.8, num(ui.minSteg, 2)),
      bridgeMM: Math.max(0.8, num(ui.bridge, 2)),
      cornerMM: Math.max(0, num(ui.corner, 1)),
      maxTileMM: Math.min(tileLimit(), Math.max(60, num(ui.maxTile, 240))),
      clearanceMM: Math.max(0, num(ui.clearance, 0.1)),
      alignCuts: $('alignCuts').checked,
      saveMaterial: $('saveMaterial').checked,
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
      setStatus(tr('Bitte eine Bilddatei wählen (PNG, JPG, …).', 'Please choose an image file (PNG, JPG, …).'));
      return;
    }
    imageName = file.name.replace(/\.[^.]+$/, '').replace(/[^\w\-äöüÄÖÜß]+/g, '_') || 'schablone';
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      original = img;
      originalName = file.name;
      ui.empty.style.display = 'none';
      useImage();
    };
    img.onerror = () => setStatus(tr('Das Bild konnte nicht gelesen werden.', 'The image could not be read.'));
    img.src = url;
  }

  // Bild übernehmen, auf Wunsch ohne leeren Rand
  function useImage() {
    if (!original) return;
    const W = original.naturalWidth, H = original.naturalHeight;
    const box = $('crop').checked ? contentBox(original) : null;
    if (box) {
      const c = document.createElement('canvas');
      c.width = box.w; c.height = box.h;
      c.getContext('2d').drawImage(original, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
      c.naturalWidth = box.w; c.naturalHeight = box.h;
      image = c;
      dropLabel = () => `${originalName} (${W} × ${H} px, ${tr('Rand abgeschnitten', 'border cropped')}: ${box.w} × ${box.h} px)`;
    } else {
      image = original;
      dropLabel = () => `${originalName} (${W} × ${H} px)`;
    }
    ui.dropText.textContent = dropLabel();
    baseKey = '';
    analysis = new Map();
    lossCache = new Map();
    edits = { removed: [], added: [] };
    syncHeight();
    schedule(0);
  }

  // Bereich mit Motiv finden: alles, was sich deutlich von der Farbe der Bildecken abhebt.
  // Lässt etwas Luft (2 % der Motivgröße) und schneidet nur, wenn es sich lohnt.
  function contentBox(img) {
    const W = img.naturalWidth, H = img.naturalHeight;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, W, H).data;
    const gray = (i) => 0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2];
    const bg = (gray(0) + gray(W - 1) + gray((H - 1) * W) + gray(H * W - 1)) / 4;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (Math.abs(gray(y * W + x) - bg) < 48) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return null;
    const pad = Math.max(2, Math.round(0.02 * Math.max(x1 - x0, y1 - y0)));
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (w * h > 0.97 * W * H) return null;
    return { x: x0, y: y0, w, h };
  }
  $('crop').addEventListener('change', useImage);

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
  const PROJECTS = { a1mini: self.BAMBU_PROJECT_SETTINGS_A1MINI, h2d: self.BAMBU_PROJECT_SETTINGS_H2D, h2s: self.BAMBU_PROJECT_SETTINGS_H2S };
  const ownProject = () => PROJECTS[$('printer').value.split(':')[1]];
  const projectSettings = () => ownProject() || self.BAMBU_PROJECT_SETTINGS;
  // Größte Kachel für den gewählten Drucker; X1C und P1 haben vorne links eine gesperrte Ecke (18 × 28 mm)
  const tileForBed = () => +($('printer').selectedOptions[0]?.dataset.tile || Math.min(...bed()) - 16);
  const tileLimit = () => ($('printer').selectedOptions[0]?.dataset.tile ? tileForBed() : Math.min(...bed()));
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
    $('plateInfo').textContent = tr(`${p.nx} × ${p.ny} = ${p.n} Platte${p.n === 1 ? '' : 'n'} · Platten zu ${Math.round(p.use * 100)} % genutzt`, `${p.nx} × ${p.ny} = ${p.n} plate${p.n === 1 ? '' : 's'} · plates ${Math.round(p.use * 100)} % used`);
    const spots = sweetSpots();
    $('sweetSpots').innerHTML = spots.map((e) => `<option value="${e.w}"></option>`).join('');
    const box = $('fitButtons');
    box.innerHTML = '';
    for (const e of spots) {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `<b>${e.n}</b> ${e.n === 1 ? tr('Platte', 'plate') : tr('Platten', 'plates')}: ${e.w} mm`;
      b.title = tr(`${e.n} ${e.n === 1 ? 'Platte' : 'Platten'} (${e.nx} × ${e.ny}), Breite bis ${e.w} mm`, `${e.n} ${e.n === 1 ? 'plate' : 'plates'} (${e.nx} × ${e.ny}), width up to ${e.w} mm`);
      if (e.n === p.n) b.classList.add('active');
      b.dataset.w = e.w;
      b.addEventListener('click', () => { ui.width.value = e.w; syncHeight(); saveSettings(); schedule(0); });
      box.appendChild(b);
    }
    scheduleDetail();
  }

  // --- Beispielbilder ------------------------------------------------------

  document.querySelectorAll('#examples [data-example]').forEach((b) => b.addEventListener('click', async () => {
    const name = b.dataset.example;
    const label = b.querySelector('span').textContent.trim();
    try {
      const res = await fetch(`examples/${name}.png`);
      if (!res.ok) throw new Error(res.status);
      const blob = await res.blob();
      loadFile(new File([blob], `${label}.png`, { type: 'image/png' }));
      document.querySelectorAll('#examples [data-example]').forEach((x) => x.classList.toggle('active', x === b));
      $('examples').open = false;
    } catch (err) {
      setStatus(tr('Das Beispiel konnte nicht geladen werden.', 'The example could not be loaded.'));
    }
  }));
  ui.file.addEventListener('change', () => {
    document.querySelectorAll('#examples [data-example]').forEach((x) => x.classList.remove('active'));
    $('examples').open = false;
  });

  // --- Malbarkeit: geht bei dieser Breite zu viel vom Bild verloren? ------
  // Schnelle Abschätzung auf einem kleinen Raster des Bildes; das Ergebnis je Breite wird gemerkt.

  const LOSS_BAD = 0.5, LOSS_WARN = 0.25;
  // Das Analyseraster wächst mit der Breite mit, damit Marker und Stege darauf mindestens
  // etwa 4 Pixel breit sind (sonst wirkt eine große Schablone fälschlich verlustfrei).
  const ANALYSIS_STEPS = [400, 600, 800, 1000];
  let analysis = new Map(); // Rasterbreite -> { gray, w, h }
  let lossCache = new Map(), lossKey = '';
  let detailTimer = null, detailGen = 0;

  function analysisImage(width, s) {
    if (!image) return null;
    const need = width / (Math.min(s.markerMM, s.minStegMM || s.markerMM) / 4);
    const step = ANALYSIS_STEPS.find((n) => n >= need) || ANALYSIS_STEPS[ANALYSIS_STEPS.length - 1];
    const w = Math.min(step, image.naturalWidth);
    if (analysis.has(w)) return analysis.get(w);
    const h = Math.max(1, Math.round(w * aspect()));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const gray = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) gray[i] = Math.round(0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2]);
    const a = { gray, w, h };
    analysis.set(w, a);
    return a;
  }

  function lossAt(width) {
    const s = readSettings();
    const key = JSON.stringify([s.markerMM, s.minStegMM, s.widenThin, s.slimMM, s.threshold, s.invert, s.smoothMM]);
    if (key !== lossKey) { lossCache = new Map(); lossKey = key; }
    const w = Math.round(width);
    if (!lossCache.has(w)) {
      const a = analysisImage(w, s);
      const job = calcLoss('loss', { gray: a.gray, w: a.w, h: a.h, s: { ...s, px: w / a.w } });
      job.catch(() => lossCache.delete(w));
      lossCache.set(w, job);
    }
    return lossCache.get(w);
  }

  function scheduleDetail() {
    clearTimeout(detailTimer);
    detailGen++;
    if (!image) return;
    detailTimer = setTimeout(updateDetail, 250);
  }

  const pause = () => new Promise((r) => setTimeout(r, 0));

  async function updateDetail() {
    const gen = detailGen;
    const s = readSettings();
    const marker = tr(`den ${fmt(s.markerMM)}-mm-Marker`, `the ${fmt(s.markerMM)} mm marker`);
    const el = $('detailInfo');
    const cur = num(ui.width, 400);
    const show = async (minW) => {
      const l = await lossAt(cur);
      if (gen !== detailGen) return;
      el.hidden = false;
      el.classList.toggle('bad', l > LOSS_BAD);
      el.classList.toggle('warn', l > LOSS_WARN && l <= LOSS_BAD);
      if (l > LOSS_BAD) el.textContent = tr(`Zu klein für ${marker}: ${Math.round(l * 100)} % des Bildes werden verändert.`, `Too small for ${marker}: ${Math.round(l * 100)} % of the image changes.`) + (minW ? tr(` Malbar ab etwa ${minW} mm Breite.`, ` Paintable from about ${minW} mm width.`) : '');
      else if (l > LOSS_WARN) el.textContent = tr(`Grob: ${Math.round(l * 100)} % des Bildes werden durch Markerbreite und Stege verändert. Feiner wird es mit mehr Breite oder dünnerem Marker.`, `Coarse: ${Math.round(l * 100)} % of the image changes because of marker width and webs. More width or a thinner marker gives finer results.`);
      else el.textContent = tr(`Gut malbar: ${Math.round(100 - l * 100)} % des Bildes bleiben erhalten.`, `Easy to paint: ${Math.round(100 - l * 100)} % of the image is kept.`);
    };
    // 1) aktuelle Breite bewerten
    await show(0);
    await pause();
    if (gen !== detailGen) return;
    // 2) Plattenstufen prüfen und zu kleine sperren
    for (const b of document.querySelectorAll('#fitButtons button')) {
      const l = await lossAt(+b.dataset.w);
      if (gen !== detailGen) return;
      b.classList.toggle('bad', l > LOSS_BAD);
      b.classList.toggle('warn', l > LOSS_WARN && l <= LOSS_BAD);
      b.disabled = l > LOSS_BAD;
      if (l > LOSS_BAD) b.title = tr(`Zu klein für ${marker}: ${Math.round(l * 100)} % des Bildes würden verändert.`, `Too small for ${marker}: ${Math.round(l * 100)} % of the image would change.`);
      else if (l > LOSS_WARN) b.title += tr(` · grob: ${Math.round(l * 100)} % des Bildes werden verändert`, ` · coarse: ${Math.round(l * 100)} % of the image changes`);
      await pause();
      if (gen !== detailGen) return;
    }
    // 3) kleinste noch malbare Breite suchen (Verlust höchstens 50 %), auf etwa 3 % genau
    let lo = 30, hi = 3000;
    if ((await lossAt(hi)) > LOSS_BAD) lo = hi;
    while (hi / lo > 1.03) {
      const mid = Math.round(Math.sqrt(lo * hi));
      if ((await lossAt(mid)) > LOSS_BAD) lo = mid; else hi = mid;
      await pause();
      if (gen !== detailGen) return;
    }
    if (gen !== detailGen) return;
    $('widthRange').min = Math.min(hi, cur);
    await show(hi);
  }

  ui.threshold.addEventListener('input', () => { ui.thresholdOut.textContent = ui.threshold.value; scheduleDetail(); schedule(); });
  document.querySelectorAll('#settings input, #settings select').forEach((el) => {
    if (el === ui.width || el === ui.height || el === ui.threshold || el === ui.file || el.id === 'format' || el.id === 'widthRange' || el.id === 'vector' || el.id === 'crop') return;
    el.addEventListener('change', () => { syncPlates(); schedule(); });
  });
  ui.overlay.addEventListener('change', () => result && render());

  // --- Einstellungen im Browser merken -----------------------------------

  const STORE = 'bild-zu-stl:einstellungen' + (TEST ? ':test' : '');
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
    if (data.clearance === '0.2') data.clearance = '0.1'; // alter Standard, seit dem Testdruck 0,1 mm
    if (data.printer === '340x320') data.printer = '340x320:h2s'; // H2S hat jetzt eine eigene Vorlage
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

  // --- Abschnitte einklappen (Zustand wird gemerkt) ------------------------

  const FOLD_STORE = 'bild-zu-stl:eingeklappt' + (TEST ? ':test' : '');
  let folded = [];
  try { folded = JSON.parse(localStorage.getItem(FOLD_STORE) || '[]'); } catch (e) { folded = []; }
  document.querySelectorAll('#settings > section:not(.actions) > h2').forEach((h, idx) => {
    const sec = h.parentElement;
    const id = 'abschnitt-' + (idx + 1);
    h.classList.add('fold');
    h.tabIndex = 0;
    h.setAttribute('role', 'button');
    const set = (c) => { sec.classList.toggle('collapsed', c); h.setAttribute('aria-expanded', String(!c)); };
    set(folded.includes(id));
    const toggle = () => {
      set(!sec.classList.contains('collapsed'));
      folded = folded.filter((x) => x !== id);
      if (sec.classList.contains('collapsed')) folded.push(id);
      try { localStorage.setItem(FOLD_STORE, JSON.stringify(folded)); } catch (e) { /* egal */ }
    };
    h.addEventListener('click', toggle);
    h.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  });
  if (num(ui.maxTile, 240) > tileLimit()) ui.maxTile.value = tileLimit();
  syncHeight();
  storable().forEach((el) => { el.addEventListener('change', saveSettings); el.addEventListener('input', saveSettings); });
  // Zurücksetzen: Standardwerte aus dem HTML übernehmen, das geladene Bild bleibt
  $('resetSettings').addEventListener('click', () => {
    try { localStorage.removeItem(STORE); } catch (e) { /* egal */ }
    const changed = [];
    for (const el of storable()) {
      if (el.type === 'checkbox' || el.type === 'radio') {
        if (el.checked !== el.defaultChecked) { el.checked = el.defaultChecked; changed.push(el); }
      } else if (el.tagName === 'SELECT') {
        const i = Math.max(0, [...el.options].findIndex((o) => o.defaultSelected));
        if (el.selectedIndex !== i) { el.selectedIndex = i; changed.push(el); }
      } else if (el.value !== el.defaultValue) { el.value = el.defaultValue; changed.push(el); }
    }
    ui.thresholdOut.textContent = ui.threshold.value;
    for (const el of changed) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    syncThinHint();
    if (image) { syncHeight(); scheduleDetail(); schedule(); }
    saveSettings();
    setStatus(tr('Einstellungen zurückgesetzt.', 'Settings reset.'));
  });
  syncPlates();
  const syncThinHint = () => { $('thinHint').hidden = radio('thick') > 0.25; };
  const syncSaveHint = () => { $('saveHint').hidden = !$('saveMaterial').checked; };
  $('saveMaterial').addEventListener('change', syncSaveHint);
  document.querySelectorAll('input[name=thick]').forEach((el) => el.addEventListener('change', syncThinHint));
  syncThinHint();
  syncSaveHint();

  // --- Berechnung ---------------------------------------------------------

  function setStatus(t) { ui.status.textContent = t; }

  function setBusy(on, text) {
    busyOn = on;
    ui.busy.hidden = !on || !image;
    if (text) ui.busyText.textContent = text;
  }

  function schedule(delay = 450) {
    setBusy(true, tr('Bild wird angepasst …', 'Adjusting image …'));
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
    ui.pdfBtn.disabled = true;
    setStatus(tr('Berechne Vorschau …', 'Calculating preview …'));
    await new Promise((r) => setTimeout(r, 30));
    try {
      const s = readSettings();
      const t0 = performance.now();
      const key = JSON.stringify([s.px, s.widthMM, s.heightMM, s.borderMM, s.tabMM, s.markerMM, s.widenThin, s.slimMM, s.threshold, s.invert, s.smoothMM, s.minStegMM]);
      const job = { key, s, edits, knob: KNOB };
      let res = key === baseKey ? await calc('stencil', job) : null;
      if (!res) {
        res = await calc('stencil', { ...job, raster: rasterize(s) });
        baseKey = key;
      }
      const { st, tiles } = res;
      result = { st, tiles, s };
      render();
      describe(performance.now() - t0);
      ui.exportBtn.disabled = false;
      ui.pdfBtn.disabled = false;
    } catch (err) {
      console.error(err);
      setStatus(tr('Fehler bei der Berechnung: ', 'Calculation error: ') + err.message);
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
    if (running) { setStatus(tr('Moment, die Vorschau wird noch berechnet …', 'One moment, the preview is still being calculated …')); return; }
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
      setStatus(tr('Steg gesetzt, berechne neu …', 'Bridge added, recalculating …'));
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
      setStatus(tr('Kein Steg an dieser Stelle. Klicke direkt auf einen roten Steg oder ziehe eine Linie für einen neuen.', 'No bridge here. Click directly on a red bridge or drag a line to add a new one.'));
      return;
    }
    const [ax, ay, bx, by] = best.seg;
    if (best.manual) {
      const k = st.bridges.filter((b) => b.manual).indexOf(best);
      edits.added.splice(k, 1);
    } else {
      edits.removed.push(toUnit(st, (ax + bx) / 2, (ay + by) / 2));
    }
    setStatus(tr('Steg verschoben, berechne neu …', 'Bridge moved, recalculating …'));
    schedule(0);
  });
  ui.canvas.addEventListener('pointercancel', () => { dragStart = null; ui.drag.innerHTML = ''; });
  ui.resetEdits.addEventListener('click', () => {
    edits = { removed: [], added: [] };
    schedule(0);
  });

  // Geschätzter Filamentbedarf (PLA, 1,24 g/cm³) aus der Fläche aller Kacheln; beim Materialsparen
  // dazu, was ohne Sparen gedruckt würde (weggefallene Pixel aus st.cut).
  function filamentText(st, tiles, s) {
    let px = 0;
    for (const t of tiles.tiles) for (let i = 0; i < t.mask.length; i++) px += t.mask[i];
    const grams = (pixels) => (pixels * st.px * st.px * s.thickness * 1.24) / 1000;
    const g = grams(px);
    const round = (v) => fmt(v < 10 ? Math.round(v * 10) / 10 : Math.round(v), v < 10 ? 1 : 0);
    let text = tr(`ca. ${round(g)} g Filament`, `approx. ${round(g)} g filament`);
    if (s.saveMaterial && st.cut) {
      let saved = 0;
      for (let i = 0; i < st.cut.length; i++) if (st.cut[i] && !st.mat[i]) saved++;
      const gs = grams(saved), pct = Math.round((100 * gs) / (g + gs));
      if (gs > 0) text += tr(` (spart ca. ${round(gs)} g, ${pct} %)`, ` (saves approx. ${round(gs)} g, ${pct} %)`);
    }
    return text;
  }

  function describe(ms) {
    lastMs = ms;
    const { st, tiles, s } = result;
    const totalW = st.W * st.px, totalH = st.H * st.px;
    ui.sizeInfo.textContent = tr('Gesamtgröße mit Rand', 'Total size with border') + `: ${fmt(totalW)} × ${fmt(totalH)} mm`;
    const n = tiles.tiles.length;
    const biggest = tiles.tiles.reduce((m, t) => Math.max(m, t.widthMM, t.heightMM), 0);
    const loose = tiles.tiles.reduce((m, t) => m + Math.max(0, t.pieces - 1), 0);
    const parts = [
      n === 1 ? tr('1 Teil', '1 part') : tr(`${n} Kacheln (${tiles.ny} Reihen × ${tiles.nx} Spalten), größte Seite ${fmt(biggest)} mm`, `${n} tiles (${tiles.ny} rows × ${tiles.nx} columns), largest side ${fmt(biggest)} mm`),
      tr(`${st.bridged} Haltesteg${st.bridged === 1 ? '' : 'e'}`, `${st.bridged} holding bridge${st.bridged === 1 ? '' : 's'}`),
      n > 1 ? tr(`${tiles.knobs.length} Puzzle-Verbinder`, `${tiles.knobs.length} puzzle connector${tiles.knobs.length === 1 ? '' : 's'}`) + (tiles.bareSeams ? tr(` (${tiles.bareSeams} Naht${tiles.bareSeams === 1 ? '' : 'e'} ohne Verbinder, dort mit Klebeband fixieren)`, ` (${tiles.bareSeams} seam${tiles.bareSeams === 1 ? '' : 's'} without connectors, tape them there)`) : '') : null,
      filamentText(st, tiles, s),
      tr('Raster', 'Grid') + ` ${fmt(st.px, 2)} mm`,
    ].filter(Boolean);
    let text = parts.join(' · ');
    if (edits.added.length) text += tr(` · ${edits.added.length} eigene${edits.added.length === 1 ? 'r' : ''} Steg${edits.added.length === 1 ? '' : 'e'}`, ` · ${edits.added.length} custom bridge${edits.added.length === 1 ? '' : 's'}`);
    if (st.loose) text += tr(` · Achtung: ${st.loose} Teil${st.loose === 1 ? '' : 'e'} ohne Halt, setze dort einen Steg von Hand`, ` · Warning: ${st.loose} part${st.loose === 1 ? '' : 's'} without support, add a bridge there by hand`);
    ui.resetEdits.disabled = !edits.added.length && !edits.removed.length;
    if (loose) text += tr(` · Hinweis: ${loose} lose${loose === 1 ? 's' : ''} Einzelteil${loose === 1 ? '' : 'e'} an Kachelkanten`, ` · Note: ${loose} loose piece${loose === 1 ? '' : 's'} at tile edges`);
    ui.info.textContent = text;
    setStatus(tr(`Fertig in ${fmt(ms / 1000, 1)} s. Prüfe die Vorschau und exportiere dann.`, `Done in ${fmt(ms / 1000, 1)} s. Check the preview, then export.`));
  }

  // Sprache gewechselt: alle von hier gesetzten Texte neu schreiben
  I18N.onChange(() => {
    syncPlates();
    scheduleDetail();
    if (dropLabel) ui.dropText.textContent = dropLabel();
    if (result) { describe(lastMs); render(); }
    else if (!image) setStatus(tr('Noch kein Bild geladen.', 'No image loaded yet.'));
    if (busyOn) setBusy(true, tr('Bild wird angepasst …', 'Adjusting image …'));
  });

  // --- Vorschau -----------------------------------------------------------

  function cssColor(name) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const m = v.match(/^#([0-9a-f]{6})$/i);
    const n = m ? parseInt(m[1], 16) : 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function render() { drawStencil(ui.canvas, ui.overlay.checked); }

  function drawStencil(cv, overlay) {
    const { st, tiles } = result;
    const { W, H, mat, holes0, bridgeMask, border } = st;
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
      d[4 * i + 3] = !mat[i] && (!st.area[i] || (st.cut && st.cut[i])) ? 0 : 255;
    }
    ctx.putImageData(img, 0, 0);
    if (overlay && image) {
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

  const tileName = (t) => tr(`R${t.row + 1}-S${t.col + 1}`, `R${t.row + 1}-C${t.col + 1}`);

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
    setBusy(true, as3mf ? tr('3MF wird erzeugt …', 'Creating 3MF …') : tr('STL-Dateien werden erzeugt …', 'Creating STL files …'));
    const { st, tiles, s } = result;
    const single = tiles.tiles.length === 1;
    try {
      const parts = [];
      for (let k = 0; k < tiles.tiles.length; k++) {
        const t = tiles.tiles[k];
        setStatus(tr(`Erzeuge Kachel ${k + 1} von ${tiles.tiles.length} …`, `Creating tile ${k + 1} of ${tiles.tiles.length} …`));
        await new Promise((r) => setTimeout(r, 15));
        const tris = await calc('mesh', { mask: t.mask, w: t.w, h: t.h, px: st.px, thickness: s.thickness, smooth: $('vector').checked, shrink: single ? 0 : s.clearanceMM / 2, labels: t.labels });
        parts.push({ name: single ? imageName : tileName(t), tris, width: t.widthMM, height: t.heightMM });
      }
      if (as3mf) {
        setStatus(tr('Packe 3MF …', 'Packing 3MF …'));
        const zip = new JSZip();
        const files = ThreeMF.build(parts, imageName, projectSettings());
        const misfit = files.misfits || [];
        delete files.misfits;
        for (const [path, text] of Object.entries(files)) zip.file(path, text);
        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: 'model/3mf' });
        download(blob, `${imageName}.3mf`);
        const other = !ownProject() && bed()[0] !== 256 ? tr(' Die Datei ist für den X1C eingerichtet: In Bambu Studio oben links deinen Drucker wählen und kurz prüfen, ob jede Kachel auf ihrer Platte liegt.', ' The file is set up for the X1C: choose your printer at the top left in Bambu Studio and check that each tile sits on its plate.') : '';
        setStatus((single ? tr('3MF heruntergeladen.', '3MF downloaded.') : tr(`3MF mit ${parts.length} Platten heruntergeladen. In Bambu Studio öffnen und „Alle Platten slicen“.`, `3MF with ${parts.length} plates downloaded. Open it in Bambu Studio and choose “Slice all plates”.`)) + other);
        if (misfit.length) setStatus(tr(`Achtung: ${misfit.join(', ')} ${misfit.length === 1 ? 'passt' : 'passen'} nicht ganz aufs Druckbett. Bitte „Max. Kachelgröße“ unter „Erweitert“ verkleinern und neu exportieren.`, `Warning: ${misfit.join(', ')} ${misfit.length === 1 ? 'does' : 'do'} not fully fit on the build plate. Please reduce “Max. tile size” under “Advanced” and export again.`));
      } else if (single) {
        download(new Blob([Stencil.trianglesToSTL(parts[0].tris, parts[0].name)], { type: 'model/stl' }), `${imageName}.stl`);
        setStatus(tr('STL heruntergeladen.', 'STL downloaded.'));
      } else {
        setStatus(tr('Packe ZIP …', 'Packing ZIP …'));
        const zip = new JSZip();
        for (const p of parts) zip.file(`${imageName}_${p.name}.stl`, Stencil.trianglesToSTL(p.tris, p.name));
        const png = await new Promise((r) => ui.canvas.toBlob(r, 'image/png'));
        zip.file(tr('uebersicht.png', 'overview.png'), png);
        zip.file(tr('anleitung.txt', 'instructions.txt'), instructions(tiles, st, s));
        download(await zip.generateAsync({ type: 'blob' }), `${imageName}_${tr('kacheln', 'tiles')}.zip`);
        setStatus(tr(`ZIP mit ${parts.length} STL-Dateien heruntergeladen.`, `ZIP with ${parts.length} STL files downloaded.`));
      }
    } catch (err) {
      console.error(err);
      setStatus(tr('Fehler beim Export: ', 'Export error: ') + err.message);
    }
    setBusy(false);
    ui.exportBtn.disabled = false;
  });

  // --- Plan als PDF: Originalbild, Puzzle-/Schnittplan, Stellen zum Nachmalen ---------

  let jspdfLoad = null;
  const loadJsPDF = () => jspdfLoad || (jspdfLoad = new Promise((resolve, reject) => {
    if (self.jspdf) { resolve(self.jspdf); return; }
    const sc = document.createElement('script');
    sc.src = 'vendor/jspdf.umd.min.js' + VERSION;
    sc.onload = () => resolve(self.jspdf);
    sc.onerror = () => { jspdfLoad = null; reject(new Error(tr('PDF-Bibliothek konnte nicht geladen werden.', 'Could not load the PDF library.'))); };
    document.head.appendChild(sc);
  }));

  // Canvas verkleinern (für eine handliche PDF-Größe) und als JPEG liefern
  function jpeg(cv, maxSide = 2400) {
    const k = Math.min(1, maxSide / Math.max(cv.width, cv.height));
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(cv.width * k));
    out.height = Math.max(1, Math.round(cv.height * k));
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cv, 0, 0, out.width, out.height);
    return { url: out.toDataURL('image/jpeg', 0.88), w: out.width, h: out.height };
  }

  // Wo man nach dem Abnehmen von Hand nacharbeiten muss: Haltestege (rot) und zu schmale Linien (orange)
  function touchUpCanvas() {
    const { st } = result;
    const { W, H, mat, holes0, bridgeMask, border } = st;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 0.4;
    ctx.drawImage(image, border, border, W - 2 * border, H - 2 * border);
    ctx.globalAlpha = 1;
    const marks = document.createElement('canvas');
    marks.width = W;
    marks.height = H;
    const mctx = marks.getContext('2d');
    const img = mctx.createImageData(W, H);
    const d = img.data;
    const lost = cssColor('--lost'), bridge = cssColor('--bridge');
    for (let i = 0; i < W * H; i++) {
      if (!mat[i] || !holes0[i]) continue;
      const c = bridgeMask[i] ? bridge : lost;
      d[4 * i] = c[0]; d[4 * i + 1] = c[1]; d[4 * i + 2] = c[2]; d[4 * i + 3] = 255;
    }
    mctx.putImageData(img, 0, 0);
    ctx.drawImage(marks, 0, 0);
    // Kreise um die Stege, damit man sie auch klein ausgedruckt findet
    ctx.strokeStyle = `rgb(${bridge.join(',')})`;
    ctx.lineWidth = Math.max(2, Math.min(W, H) / 400);
    const r = Math.max(8, Math.min(W, H) / 60);
    for (const b of st.bridges || []) {
      const [ax, ay, bx, by] = b.seg;
      ctx.beginPath();
      ctx.arc((ax + bx) / 2, (ay + by) / 2, r, 0, 2 * Math.PI);
      ctx.stroke();
    }
    return cv;
  }

  async function buildPDF() {
    const { st, tiles, s } = result;
    const { jsPDF } = await loadJsPDF();
    const landscape = st.W > st.H * 1.15;
    const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
    const PW = doc.internal.pageSize.getWidth(), PH = doc.internal.pageSize.getHeight(), M = 14;
    const multi = tiles.tiles.length > 1;
    const header = (title, sub) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(17);
      doc.text(title, M, M + 4);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(90);
      doc.text(sub, M, M + 10);
      doc.setTextColor(0);
      return M + 16;
    };
    // Bild in den freien Bereich einpassen, Textzeilen darunter
    const page = (title, sub, pic, notes) => {
      const top = header(title, sub);
      doc.setFontSize(10);
      const text = notes.flatMap((n) => doc.splitTextToSize(n, PW - 2 * M));
      const textH = text.length * 4.6;
      const boxW = PW - 2 * M, boxH = PH - top - M - textH - 4;
      const k = Math.min(boxW / pic.w, boxH / pic.h);
      const w = pic.w * k, h = pic.h * k;
      doc.addImage(pic.url, 'JPEG', M + (boxW - w) / 2, top, w, h);
      doc.setDrawColor(200);
      doc.rect(M + (boxW - w) / 2, top, w, h);
      doc.text(text, M, top + h + 7);
    };
    const size = `${fmt(st.W * st.px)} × ${fmt(st.H * st.px)} mm`;
    const date = new Date().toLocaleDateString(I18N.lang === 'en' ? 'en-GB' : 'de-DE');
    const sub = `Stencilio Print · ${imageName} · ${date}`;

    // 1) Originalbild
    const orig = document.createElement('canvas');
    orig.width = image.naturalWidth || image.width;
    orig.height = image.naturalHeight || image.height;
    orig.getContext('2d').drawImage(image, 0, 0);
    page(tr('Vorlage', 'Original'), sub, jpeg(orig), [
      tr(`Gesamtgröße der Schablone: ${size} (mit Rand), Höhe ${fmt(s.thickness, 1)} mm, Marker ${fmt(s.markerMM)} mm.`,
        `Total stencil size: ${size} (with border), height ${fmt(s.thickness, 1)} mm, marker ${fmt(s.markerMM)} mm.`),
      multi ? tr(`${tiles.tiles.length} Kacheln (${tiles.ny} Reihen × ${tiles.nx} Spalten), ${st.bridged} Haltestege.`, `${tiles.tiles.length} tiles (${tiles.ny} rows × ${tiles.nx} columns), ${st.bridged} holding bridges.`)
        : tr(`Eine Druckplatte, ${st.bridged} Haltestege.`, `One build plate, ${st.bridged} holding bridges.`),
      tr('Seite 2: Puzzle- und Schnittplan. Seite 3: Stellen, die du nach dem Abnehmen von Hand nachmalst.', 'Page 2: puzzle and cutting plan. Page 3: spots to touch up by hand after removing the stencil.'),
    ]);

    // 2) Puzzle- und Schnittplan
    doc.addPage();
    const plan = document.createElement('canvas');
    drawStencil(plan, false);
    const list = tiles.tiles.map((t) => `${tileName(t)}: ${fmt(t.widthMM, 1)} × ${fmt(t.heightMM, 1)} mm`).join('   ');
    page(tr('Puzzle- und Schnittplan', 'Puzzle and cutting plan'), sub, jpeg(plan), multi ? [
      tr('So gehören die Kacheln zusammen. R = Reihe (von oben), S = Spalte (von links). Die Nummer ist in jede Kachel eingeprägt, z. B. „1-2“ = Reihe 1, Spalte 2. Die Puzzle-Verbinder an den dunklen Fugen ineinander drücken.',
        'How the tiles fit together. R = row (from the top), C = column (from the left). Each tile has its number pressed in, e.g. "1-2" = row 1, column 2. Press the puzzle connectors at the dark seams together.'),
      list,
      tr('Blau: Schablone · Weiß: Öffnung zum Malen · Rot: Haltesteg · Orange: zu schmal, entfällt · Grün: auf Markerbreite verbreitert.', 'Blue: stencil · White: opening to paint · Red: holding bridge · Orange: too narrow, left out · Green: widened to marker width.'),
    ] : [
      tr('Blau: Schablone · Weiß: Öffnung zum Malen · Rot: Haltesteg · Orange: zu schmal, entfällt · Grün: auf Markerbreite verbreitert.', 'Blue: stencil · White: opening to paint · Red: holding bridge · Orange: too narrow, left out · Green: widened to marker width.'),
    ]);

    // 3) Nachmalen
    doc.addPage();
    page(tr('Nach dem Malen von Hand ergänzen', 'Touch up by hand after painting'), sub, jpeg(touchUpCanvas()), [
      tr(`Rot eingekreist: die ${st.bridged} Haltestege. Dort unterbricht die Schablone die Linie, damit Innenteile halten. Nach dem Abnehmen die kurzen Lücken mit dem Stift schließen.`,
        `Red circles: the ${st.bridged} holding bridges. The stencil interrupts the line there so inner parts stay attached. After removing the stencil, close these short gaps with your marker.`),
      tr('Orange: Linien, die für den Marker zu schmal waren und nicht in der Schablone sind. Bei Bedarf frei Hand ergänzen.', 'Orange: lines that were too narrow for the marker and are not in the stencil. Add them freehand if you like.'),
    ]);
    return doc.output('blob');
  }

  ui.pdfBtn.addEventListener('click', async () => {
    if (!result) return;
    ui.pdfBtn.disabled = true;
    setStatus(tr('PDF wird erzeugt …', 'Creating PDF …'));
    try {
      download(await buildPDF(), `${imageName}-${tr('plan', 'plan')}.pdf`);
      setStatus(tr('PDF heruntergeladen.', 'PDF downloaded.'));
    } catch (err) {
      console.error(err);
      setStatus(tr('PDF konnte nicht erzeugt werden: ', 'Could not create the PDF: ') + err.message);
    }
    ui.pdfBtn.disabled = false;
  });

  function instructions(tiles, st, s) {
    const lines = I18N.lang === 'en' ? [
      'Stencilio Print - stencil',
      '',
      `Total size: ${fmt(st.W * st.px)} x ${fmt(st.H * st.px)} mm, height ${fmt(s.thickness, 1)} mm, marker ${fmt(s.markerMM)} mm`,
      `Tiles: ${tiles.ny} rows x ${tiles.nx} columns. R = row (from the top), C = column (from the left).`,
      'The position of each tile is shown in overview.png.',
      'Each tile has its number pressed into the top: "1-2" means row 1, column 2.',
      '',
      'Printing (Bambu Studio):',
      '- Place each STL on the plate on its own or several together.',
      '- 0.2 mm layer height, no supports needed.',
      '',
      'Assembly: press the puzzle connectors at the edges together.',
      s.tabMM ? 'The tabs on the outer edge are meant for taping with painter\'s tape.' : '',
    ] : [
      'Stencilio Print - Schablone',
      '',
      `Gesamtgröße: ${fmt(st.W * st.px)} x ${fmt(st.H * st.px)} mm, Höhe ${fmt(s.thickness, 1)} mm, Marker ${fmt(s.markerMM)} mm`,
      `Kacheln: ${tiles.ny} Reihen x ${tiles.nx} Spalten. R = Reihe (von oben), S = Spalte (von links).`,
      'Die Lage jeder Kachel siehst du in uebersicht.png.',
      'Jede Kachel hat ihre Nummer in die Oberseite eingeprägt: "1-2" heißt Reihe 1, Spalte 2.',
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
