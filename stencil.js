/*
 * Stencilio Print: Kernlogik (läuft im Browser und in Node).
 *
 * Masken sind Uint8Array der Größe W*H (Zeile für Zeile, y nach unten).
 * 1 = Material (Kunststoff), 0 = Öffnung (dort wird mit dem Marker gemalt).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./vendor/earcut.min.js'));
  } else {
    root.Stencil = factory(root.earcut);
  }
})(typeof self !== 'undefined' ? self : this, function (earcut) {
  'use strict';

  const INF = 1e20;

  // ---------------------------------------------------------------------------
  // Euklidische Distanztransformation (Felzenszwalb & Huttenlocher)
  // ---------------------------------------------------------------------------

  function dt1d(f, n, d, v, z, arg) {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      const dq = q - v[k];
      d[q] = dq * dq + f[v[k]];
      if (arg) arg[q] = v[k];
    }
  }

  // Quadrierter Abstand jedes Pixels zum nächsten Pixel mit mask == val.
  function sqDist(mask, W, H, val) {
    const D = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) D[i] = mask[i] === val ? 0 : INF;
    const n = Math.max(W, H);
    const f = new Float64Array(n);
    const d = new Float64Array(n);
    const v = new Int32Array(n);
    const z = new Float64Array(n + 1);
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) f[y] = D[y * W + x];
      dt1d(f, H, d, v, z);
      for (let y = 0; y < H; y++) D[y * W + x] = d[y];
    }
    for (let y = 0; y < H; y++) {
      const o = y * W;
      for (let x = 0; x < W; x++) f[x] = D[o + x];
      dt1d(f, W, d, v, z);
      for (let x = 0; x < W; x++) D[o + x] = d[x];
    }
    return D;
  }

  function erode(A, W, H, r) {
    const D = sqDist(A, W, H, 0);
    const r2 = r * r;
    const out = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) out[i] = A[i] && D[i] > r2 ? 1 : 0;
    return out;
  }

  function dilate(A, W, H, r) {
    const D = sqDist(A, W, H, 1);
    const r2 = r * r;
    const out = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) out[i] = D[i] <= r2 ? 1 : 0;
    return out;
  }

  // Entfernt alle Teile von A, die schmaler als 2r Pixel sind.
  function opening(A, W, H, r) {
    if (r <= 0.5) return A.slice();
    return dilate(erode(A, W, H, r), W, H, r);
  }

  // Füllt Lücken und Einbuchtungen, die schmaler als 2r Pixel sind (rundet Innenecken).
  function closing(A, W, H, r) {
    if (r <= 0.5) return A.slice();
    return erode(dilate(A, W, H, r), W, H, r);
  }

  // Rundet Ecken mit Radius r ab, ohne Öffnungen schmaler als den Marker zu machen.
  // Schließen rundet die Ecken der Öffnungen (z. B. wo ein Steg auf eine Linie trifft),
  // Öffnen rundet spitze Ecken des Materials.
  function roundCorners(mat, W, H, opts, allowed) {
    const p = opts.px;
    const r = (opts.cornerMM || 0) / p;
    if (r <= 0.5) return mat;
    const rHole = Math.min(r, (0.45 * opts.markerMM) / p);
    const rMat = Math.min(r, (0.45 * Math.min(opts.minStegMM, opts.bridgeMM)) / p);
    let m = closing(mat, W, H, rHole);
    if (!allowed) m = opening(m, W, H, rMat);
    for (let i = 0; i < W * H; i++) {
      if (allowed && !allowed[i]) m[i] = 0;
      mat[i] = m[i];
    }
    return mat;
  }

  // ---------------------------------------------------------------------------
  // Zusammenhangskomponenten (4er-Nachbarschaft)
  // ---------------------------------------------------------------------------

  function label(mask, W, H) {
    const lab = new Int32Array(W * H);
    const stack = new Int32Array(W * H);
    const sizes = [0];
    let n = 0;
    for (let s = 0; s < W * H; s++) {
      if (!mask[s] || lab[s]) continue;
      n++;
      let size = 0;
      let sp = 0;
      stack[sp++] = s;
      lab[s] = n;
      while (sp) {
        const p = stack[--sp];
        size++;
        const x = p % W;
        if (x > 0 && mask[p - 1] && !lab[p - 1]) { lab[p - 1] = n; stack[sp++] = p - 1; }
        if (x < W - 1 && mask[p + 1] && !lab[p + 1]) { lab[p + 1] = n; stack[sp++] = p + 1; }
        if (p >= W && mask[p - W] && !lab[p - W]) { lab[p - W] = n; stack[sp++] = p - W; }
        if (p < W * H - W && mask[p + W] && !lab[p + W]) { lab[p + W] = n; stack[sp++] = p + W; }
      }
      sizes.push(size);
    }
    return { lab, n, sizes };
  }

  // ---------------------------------------------------------------------------
  // Diagonale Berührungen entfernen (sonst wird das Netz nicht-mannigfaltig)
  // ---------------------------------------------------------------------------

  function fixDiagonals(m, W, H, fill) {
    let changed = true;
    let guard = 0;
    while (changed && guard++ < 50) {
      changed = false;
      for (let y = 0; y < H - 1; y++) {
        for (let x = 0; x < W - 1; x++) {
          const i = y * W + x;
          const a = m[i], b = m[i + 1], c = m[i + W], d = m[i + W + 1];
          if (a && d && !b && !c) {
            if (fill) { m[i + 1] = 1; m[i + W] = 1; } else m[i] = 0;
            changed = true;
          } else if (b && c && !a && !d) {
            if (fill) { m[i] = 1; m[i + W + 1] = 1; } else m[i + 1] = 0;
            changed = true;
          }
        }
      }
    }
  }

  function diskOffsets(r, W) {
    const offs = [];
    const R = Math.ceil(r);
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++)
        if (dx * dx + dy * dy <= r * r + 0.25) offs.push([dx, dy]);
    return offs;
  }

  // ---------------------------------------------------------------------------
  // Haltestege: gerade, kurze Verbindungen (minimaler Spannbaum der Teile)
  // ---------------------------------------------------------------------------

  // Abstand (quadriert) und Index des nächsten Materialpixels für jedes Pixel.
  function featureTransform(mat, W, H) {
    const n = Math.max(W, H);
    const f = new Float64Array(n), d = new Float64Array(n), z = new Float64Array(n + 1);
    const v = new Int32Array(n), arg = new Int32Array(n);
    const D = new Float32Array(W * H), NY = new Int32Array(W * H), F = new Int32Array(W * H);
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) f[y] = mat[y * W + x] ? 0 : INF;
      dt1d(f, H, d, v, z, arg);
      for (let y = 0; y < H; y++) { D[y * W + x] = d[y]; NY[y * W + x] = arg[y]; }
    }
    for (let y = 0; y < H; y++) {
      const o = y * W;
      for (let x = 0; x < W; x++) f[x] = D[o + x];
      dt1d(f, W, d, v, z, arg);
      for (let x = 0; x < W; x++) { D[o + x] = d[x]; F[o + x] = NY[o + arg[x]] * W + arg[x]; }
    }
    return { D, F };
  }

  /*
   * Verbindet alle Materialteile mit möglichst kurzen, geraden Stegen.
   * Kandidaten sind die engsten Stellen zwischen benachbarten Teilen (Voronoi-Grenzen),
   * daraus wird wie bei Kruskal der kürzeste Spannbaum gewählt: genau so viele Stege
   * wie nötig, und eine Insel in einer Insel wird an die nächstgelegene angebunden.
   * allowed (optional): nur dort dürfen Stege entstehen.
   */
  function segDist2(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const ex = ax + t * dx - px, ey = ay + t * dy - py;
    return ex * ex + ey * ey;
  }

  // Zeichnet einen Steg (Linie mit Radius) in die Maske. Liefert die getroffenen Pixel.
  function drawBridge(mat, W, H, ax, ay, bx, by, disk, allowed, bridgeMask) {
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(len * 2));
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(ax + ((bx - ax) * s) / steps), y = Math.round(ay + ((by - ay) * s) / steps);
      for (const [dx, dy] of disk) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const q = yy * W + xx;
        if (!mat[q] && (!allowed || allowed[q])) { mat[q] = 1; bridgeMask[q] = 1; }
      }
    }
  }

  /*
   * excluded: Liste [x, y] (Rasterkoordinaten). Stege, die näher als exR an einem
   * dieser Punkte vorbeiführen würden, werden nicht gesetzt (vom Nutzer entfernt).
   */
  function addBridges(mat, W, H, radius, allowed, excluded, exR, bridgeMask) {
    bridgeMask = bridgeMask || new Uint8Array(W * H);
    const segments = [];
    const { lab, n } = label(mat, W, H);
    if (n <= 1) return { bridgeMask, bridged: 0, segments, loose: 0 };
    const ex = excluded || [];
    const exR2 = (exR || 0) * (exR || 0);
    const isExcluded = (fi, fj) => {
      if (!ex.length) return false;
      const ax = fi % W, ay = (fi - ax) / W, bx = fj % W, by = (fj - bx) / W;
      for (const [px, py] of ex) if (segDist2(px, py, ax, ay, bx, by) < exR2) return true;
      return false;
    };
    const { D, F } = featureTransform(mat, W, H);

    const best = new Map();
    const consider = (i, j) => {
      if (allowed && (!allowed[i] || !allowed[j])) return;
      const fi = F[i], fj = F[j];
      const A = lab[fi], B = lab[fj];
      if (A === B) return;
      const cost = Math.sqrt(D[i]) + Math.sqrt(D[j]);
      const key = A < B ? A * (n + 1) + B : B * (n + 1) + A;
      const cur = best.get(key);
      if ((!cur || cost < cur[0]) && !isExcluded(fi, fj)) best.set(key, [cost, fi, fj, A, B]);
    };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (x < W - 1) consider(i, i + 1);
        if (y < H - 1) consider(i, i + W);
      }
    }
    const edges = [...best.values()].sort((a, b) => a[0] - b[0]);

    const parent = new Int32Array(n + 1);
    for (let k = 0; k <= n; k++) parent[k] = k;
    const find = (k) => { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
    const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };

    const disk = diskOffsets(Math.max(1, radius), W);
    let bridged = 0;
    for (const [, fi, fj, A, B] of edges) {
      if (find(A) === find(B)) continue;
      const ax = fi % W, ay = (fi - ax) / W, bx = fj % W, by = (fj - bx) / W;
      const len = Math.hypot(bx - ax, by - ay);
      const steps = Math.max(1, Math.ceil(len * 2));
      const crossed = new Set();
      let ok = true;
      for (let s = 0; s <= steps; s++) {
        const x = Math.round(ax + ((bx - ax) * s) / steps), y = Math.round(ay + ((by - ay) * s) / steps);
        const q = y * W + x;
        if (mat[q]) crossed.add(lab[q]);
        else if (allowed && !allowed[q]) { ok = false; break; }
      }
      if (!ok) continue;
      drawBridge(mat, W, H, ax, ay, bx, by, disk, allowed, bridgeMask);
      segments.push([ax, ay, bx, by]);
      for (const L of crossed) union(A, L);
      union(A, B);
      bridged++;
    }
    const roots = new Set();
    for (let k = 1; k <= n; k++) roots.add(find(k));
    return { bridgeMask, bridged, segments, loose: roots.size - 1 };
  }

  // ---------------------------------------------------------------------------
  // Bild -> Schablonenmaske
  // ---------------------------------------------------------------------------

  /*
   * gray: Uint8Array (iw*ih), Bild bereits auf das Raster (px mm pro Pixel) skaliert.
   * opts: { px, threshold, invert, markerMM, minStegMM, bridgeMM, borderMM, tabMM, widenThin, smoothMM, cornerMM }
   * edits (optional): { removed: [[x, y]], added: [[ax, ay, bx, by]] } in Rasterkoordinaten
   */
  function buildStencil(gray, iw, ih, opts, edits) {
    return finishStencil(prepareStencil(gray, iw, ih, opts), opts, edits);
  }

  // Verschmälert Linien auf etwa 'width' Pixel, indem ihre Ränder von beiden Seiten
  // gleichmäßig abgetragen werden (Erosion). Die häufigste Linienstärke im Bild gilt als
  // „Linie“ und bestimmt, wie viel abgetragen wird; überall gleich viel, damit Linien gleichmäßig
  // bleiben und Ecken spitz. R(x) = Radius des größten Kreises in der Öffnung, der x enthält.
  // Schmalere Linien werden entsprechend weniger abgetragen, deutlich dickere Formen
  // (ausgemalte Flächen, Gesichter) gar nicht.
  function slimLines(holes, W, H, width, maxR, step) {
    const N = W * H;
    const half = width / 2;
    const D = sqDist(holes, W, H, 0);
    // Stärkenkarte auf einem gröberen Raster (mind. 3 Pixel je halber Zielbreite), das spart Zeit
    const k = Math.max(1, Math.floor(half / 3));
    const w = Math.ceil(W / k), h = Math.ceil(H / k), n = w * h;
    const small = new Uint8Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) small[y * w + x] = holes[Math.min(H - 1, y * k + (k >> 1)) * W + Math.min(W - 1, x * k + (k >> 1))];
    const Ds = k === 1 ? D : sqDist(small, w, h, 0);
    const Rs = new Float32Array(n);
    const levels = [];
    for (let r = half; r < maxR; r += Math.max(step, r * 0.08)) levels.push(r);
    levels.push(maxR);
    for (const r of levels) {
      const rk = r / k, r2 = rk * rk;
      const core = new Uint8Array(n);
      let any = false;
      for (let i = 0; i < n; i++) if (Ds[i] > r2) { core[i] = 1; any = true; }
      if (!any) break;
      const cover = dilate(core, w, h, rk);
      // ab maxR gilt alles als Fläche
      for (let i = 0; i < n; i++) if (cover[i] && small[i]) Rs[i] = r >= maxR ? Infinity : r;
    }
    const R = new Float32Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!holes[i]) continue;
      const cy = Math.floor(y / k), cx = Math.floor(x / k);
      let v = Rs[cy * w + cx];
      // Randpixel, deren grobe Zelle außerhalb lag, übernehmen den Wert der Nachbarzellen
      if (!v) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = cy + dy, xx = cx + dx;
        if (yy >= 0 && xx >= 0 && yy < h && xx < w && Rs[yy * w + xx] > v) v = Rs[yy * w + xx];
      }
      R[i] = v;
    }
    // häufigste Linienstärke (nach Fläche)
    const hist = new Map();
    for (let i = 0; i < N; i++) if (R[i] > 0 && R[i] < Infinity) hist.set(R[i], (hist.get(R[i]) || 0) + 1);
    let lineR = 0, best = 0;
    for (const [r, n] of hist) if (n > best) { best = n; lineR = r; }
    if (!lineR) return;
    // Abzweigungen sind etwas dicker als die Linie selbst, erst ab knapp doppelter Stärke gilt es als Fläche
    const areaR = lineR * 1.8 + step;
    const delta = lineR - half;
    if (delta <= 0) return;
    for (let i = 0; i < N; i++) {
      if (!holes[i] || !R[i] || R[i] >= areaR) continue;
      // nie unter die Zielbreite: dünnere Linien werden nur so weit beschnitten, wie sie breiter sind
      const cut = Math.min(delta, R[i] - half);
      if (cut > 0 && Math.sqrt(D[i]) <= cut) holes[i] = 0;
    }
  }

  // Teurer Teil: Bild -> Material/Öffnungen mit Marker- und Stegbreite (ohne Haltestege).
  function prepareStencil(gray, iw, ih, opts) {
    const p = opts.px;
    const tm = Math.max(0, Math.round((opts.tabMM || 0) / p));
    const b = Math.max(0, Math.round(opts.borderMM / p)) + tm;
    const W = iw + 2 * b, H = ih + 2 * b;

    let g = gray;
    const sr = Math.round((opts.smoothMM || 0) / p);
    if (sr > 0) g = boxBlur(boxBlur(gray, iw, ih, sr), iw, ih, sr);

    const inner = new Uint8Array(W * H);
    const holes0 = new Uint8Array(W * H);
    for (let y = 0; y < ih; y++) {
      for (let x = 0; x < iw; x++) {
        const dark = g[y * iw + x] < opts.threshold;
        const i = (y + b) * W + (x + b);
        inner[i] = 1;
        holes0[i] = dark !== !!opts.invert ? 1 : 0;
      }
    }

    // 0) Breite Linien auf Markerbreite (+0,5 mm) verschmälern, ausgemalte Flächen bleiben
    const raw = opts.slimMM > 0 ? holes0.slice() : null;
    if (opts.slimMM > 0) slimLines(holes0, W, H, opts.slimMM / p, Math.max(8, 3 * opts.slimMM) / p, Math.max(0.25, opts.markerMM / 6) / p);

    // 1) Öffnungen mindestens so breit wie der Marker
    const r = opts.markerMM / p / 2;
    let holes = opening(holes0, W, H, r);
    if (opts.widenThin) {
      const thin = new Uint8Array(W * H);
      let any = false;
      // Beim Verschmälern zählen nur Linien, die schon im Original zu schmal waren; die neuen
      // Kanten der verschmälerten Linien sollen nicht wieder aufgeblasen werden.
      const rawOpen = raw ? opening(raw, W, H, r) : null;
      for (let i = 0; i < W * H; i++) if (holes0[i] && !holes[i] && (!rawOpen || !rawOpen[i])) thin[i] = 1;
      // Kleine Sprenkel (Bildrauschen) nicht verbreitern, nur echte Linien
      const tl = label(thin, W, H);
      const minArea = (opts.markerMM * opts.markerMM) / 4 / (p * p);
      for (let i = 0; i < W * H; i++) {
        if (!thin[i]) continue;
        if (tl.sizes[tl.lab[i]] < minArea) thin[i] = 0;
        else any = true;
      }
      if (any) {
        const wide = dilate(thin, W, H, r);
        for (let i = 0; i < W * H; i++) if (wide[i] && inner[i]) holes[i] = 1;
        holes = opening(holes, W, H, r);
      }
    }

    // 2) Stege mindestens so breit wie die Mindest-Stegbreite
    // Außerhalb des Rahmens (Platz für Klebelaschen) ist kein Material
    const area = new Uint8Array(W * H);
    for (let y = tm; y < H - tm; y++) for (let x = tm; x < W - tm; x++) area[y * W + x] = 1;
    let mat = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) mat[i] = holes[i] || !area[i] ? 0 : 1;
    mat = opening(mat, W, H, opts.minStegMM / p / 2);

    return { W, H, px: p, border: b, tab: tm, mat, holes0, area };
  }

  // Wie gut bleibt das Bild bei dieser Größe erhalten? Anteil der Malfläche, der sich durch
  // Markerbreite und Mindeststeg verändert (0 = unverändert, 1 = Bild verloren).
  function paintLoss(gray, iw, ih, opts) {
    const st = prepareStencil(gray, iw, ih, { ...opts, borderMM: 0, tabMM: 0 });
    let orig = 0, diff = 0;
    for (let i = 0; i < st.W * st.H; i++) {
      const want = st.holes0[i], got = !st.mat[i];
      if (want) orig++;
      if (want !== (got ? 1 : 0)) diff++;
    }
    return orig ? Math.min(1, diff / orig) : 0;
  }

  // Günstiger Teil: Haltestege (inkl. Änderungen von Hand), Ecken abrunden.
  function finishStencil(base, opts, edits) {
    const { W, H, px: p, area } = base;
    const mat = base.mat.slice();
    const radius = opts.bridgeMM / p / 2;
    const disk = diskOffsets(Math.max(1, radius), W);
    const bridgeMask = new Uint8Array(W * H);
    const manual = [];
    for (const [ax, ay, bx, by] of (edits && edits.added) || []) {
      drawBridge(mat, W, H, ax, ay, bx, by, disk, area, bridgeMask);
      manual.push([ax, ay, bx, by]);
    }

    // 3) Inseln mit Haltestegen anbinden
    const res = addBridges(mat, W, H, radius, area, (edits && edits.removed) || [], radius + 3 / p, bridgeMask);

    // 4) Ecken abrunden, damit der Marker nirgends hängen bleibt
    roundCorners(mat, W, H, opts);

    // 5) Diagonale Berührungen schließen
    fixDiagonals(mat, W, H, true);

    return {
      W, H, px: p, border: base.border, tab: base.tab, area, removed: (edits && edits.removed) || [], markMask: new Uint8Array(W * H), mat, holes0: base.holes0, bridgeMask,
      bridged: res.bridged + manual.length, loose: res.loose,
      bridges: res.segments.map((sg) => ({ seg: sg, manual: false })).concat(manual.map((sg) => ({ seg: sg, manual: true }))),
    };
  }

  function boxBlur(src, W, H, r) {
    const tmp = new Float32Array(W * H);
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      let acc = 0, cnt = 0;
      const o = y * W;
      for (let x = -r; x < W; x++) {
        if (x + r < W) { acc += src[o + x + r]; cnt++; }
        if (x - r - 1 >= 0) { acc -= src[o + x - r - 1]; cnt--; }
        if (x >= 0) tmp[o + x] = acc / cnt;
      }
    }
    for (let x = 0; x < W; x++) {
      let acc = 0, cnt = 0;
      for (let y = -r; y < H; y++) {
        if (y + r < H) { acc += tmp[(y + r) * W + x]; cnt++; }
        if (y - r - 1 >= 0) { acc -= tmp[(y - r - 1) * W + x]; cnt--; }
        if (y >= 0) out[y * W + x] = Math.round(acc / cnt);
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Kacheln mit Puzzle-Verbindern
  // ---------------------------------------------------------------------------

  /*
   * opts: { maxTileMM, clearanceMM, knobR, neckW, neckL, knobSpacing }  (alles in mm)
   */
  function planTiles(st, opts) {
    const { W, H, px: p, mat } = st;
    const knobLen = opts.neckL + 2 * opts.knobR;
    const count = (sizeMM) => sizeMM <= opts.maxTileMM ? 1 : Math.ceil(sizeMM / (opts.maxTileMM - knobLen));
    const nx = count(W * p), ny = count(H * p);
    const maxPx = Math.floor((nx * ny > 1 ? opts.maxTileMM - knobLen : opts.maxTileMM) / p);

    // Schnittlinien dorthin legen, wo sie möglichst wenige Linien kreuzen.
    // Kosten einer Spalte/Zeile = Anzahl der Wechsel Material <-> Öffnung.
    function cuts(n, len, vertical) {
      const cost = new Float64Array(len);
      const other = vertical ? H : W;
      for (let a = 0; a < len; a++) {
        let c = 0, prev = 1;
        for (let b = 0; b < other; b++) {
          const m = vertical ? mat[b * W + a] : mat[a * W + b];
          if (m !== prev) c++;
          prev = m;
        }
        cost[a] = c;
      }
      const out = [0];
      const ideal = len / n;
      const window = Math.round(ideal * 0.2);
      for (let k = 1; k < n; k++) {
        const target = Math.round((k * len) / n);
        const prev = out[k - 1];
        const lo = Math.max(target - window, prev + 1, len - (n - k) * maxPx);
        const hi = Math.min(target + window, prev + maxPx, len - 1);
        let bestA = Math.min(Math.max(target, lo), hi), bestC = Infinity;
        for (let a = lo; a <= hi; a++) {
          const c = cost[a] + Math.abs(a - target) / (window + 1) * 0.5;
          if (c < bestC) { bestC = c; bestA = a; }
        }
        out.push(bestA);
      }
      out.push(len);
      return out;
    }
    return { nx, ny, cutX: cuts(nx, W, true), cutY: cuts(ny, H, false) };
  }

  function makeTiles(st, opts) {
    const { W, H, px: p, mat } = st;
    const { nx, ny, cutX, cutY } = planTiles(st, opts);
    const assign = new Int32Array(W * H);
    for (let y = 0, r = 0; y < H; y++) {
      while (y >= cutY[r + 1]) r++;
      for (let x = 0, c = 0; x < W; x++) {
        while (x >= cutX[c + 1]) c++;
        assign[y * W + x] = r * nx + c;
      }
    }

    const R = opts.knobR / p, NW = opts.neckW / p / 2, NL = opts.neckL / p;
    const reach = NL + 2 * R;
    const margin = 1.0 / p;
    const edgeKeep = R + 3 / p;
    const spacing = opts.knobSpacing / p;
    const knobs = [];
    let bareSeams = 0; // Nähte, an denen kein Verbinder Platz fand

    // Knopf an Schnittlinie 'cut' (entlang der Achse), Mittelpunkt 'pos' quer dazu.
    // vertical=true: Schnitt ist eine senkrechte Linie bei x=cut.
    function tryKnob(vertical, cut, pos, dir, src) {
      const inShape = (u, w, grow) => {
        // u: Abstand von der Schnittlinie in Richtung dir, w: Abstand quer
        const hx = NL + R;
        if (u >= -grow && u <= hx && Math.abs(w) <= NW + grow) return true;
        const du = u - hx;
        return du * du + w * w <= (R + grow) * (R + grow);
      };
      const ext = Math.ceil(reach + margin + 1);
      const wide = Math.ceil(R + margin + 1);
      const cells = [];
      for (let a = -ext; a <= ext; a++) {
        for (let w = -wide; w <= wide; w++) {
          const along = Math.floor(cut + a);
          const across = Math.floor(pos + w);
          const x = vertical ? along : across;
          const y = vertical ? across : along;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const uu = (x + 0.5 - (vertical ? cut : 0)) * (vertical ? dir : 0) + (y + 0.5 - (vertical ? 0 : cut)) * (vertical ? 0 : dir);
          const ww = vertical ? y + 0.5 - pos : x + 0.5 - pos;
          if (inShape(uu, ww, margin)) {
            if (!mat[y * W + x]) return false;
            if (inShape(uu, ww, 0) && uu > 0) cells.push(y * W + x);
          }
        }
      }
      for (const i of cells) assign[i] = src;
      knobs.push({ vertical, cut, pos, dir });
      return true;
    }

    // Liegt an der Wunschstelle eine Linie im Weg, den Knopf innerhalb seines Abschnitts
    // verschieben und notfalls in die andere Richtung zeigen lassen.
    function placeKnob(vertical, cut, centre, half, prefDir, srcFor) {
      const room = Math.max(0, half - R - margin);
      const step = Math.max(1, 1 / p);
      for (let off = 0; off <= room; off += step) {
        for (const o of off ? [off, -off] : [0]) {
          for (const dir of [prefDir, -prefDir]) {
            if (tryKnob(vertical, cut, centre + o, dir, srcFor(dir))) return true;
          }
        }
      }
      return false;
    }

    for (let c = 1; c < nx; c++) {
      for (let r = 0; r < ny; r++) {
        const y0 = cutY[r] + edgeKeep, y1 = cutY[r + 1] - edgeKeep;
        if (y1 <= y0) continue;
        const n = Math.max(1, Math.floor((y1 - y0) / spacing));
        let k = 0;
        for (let s = 0; s < n; s++) {
          const pos = y0 + ((s + 0.5) * (y1 - y0)) / n;
          const half = (y1 - y0) / n / 2;
          if (placeKnob(true, cutX[c], pos, half, k % 2 === 0 ? 1 : -1, (dir) => r * nx + (dir > 0 ? c - 1 : c))) k++;
        }
        if (!k) bareSeams++;
      }
    }
    for (let r = 1; r < ny; r++) {
      for (let c = 0; c < nx; c++) {
        const x0 = cutX[c] + edgeKeep, x1 = cutX[c + 1] - edgeKeep;
        if (x1 <= x0) continue;
        const n = Math.max(1, Math.floor((x1 - x0) / spacing));
        let k = 0;
        for (let s = 0; s < n; s++) {
          const pos = x0 + ((s + 0.5) * (x1 - x0)) / n;
          const half = (x1 - x0) / n / 2;
          if (placeKnob(false, cutY[r], pos, half, k % 2 === 0 ? 1 : -1, (dir) => (dir > 0 ? r - 1 : r) * nx + c)) k++;
        }
        if (!k) bareSeams++;
      }
    }

    // Klebelaschen an den Außenkanten, je Kachel mindestens eine pro Außenkante
    const tm = st.tab || 0;
    if (tm > 0) {
      const tw = (opts.tabWidthMM || 20) / p / 2;
      const rr = Math.min(4 / p, tm / 2, tw);
      const keep = tw + 3 / p;
      const drawTab = (side, centre, tile) => {
        // side: 0 oben, 1 unten, 2 links, 3 rechts; centre: Position entlang der Kante
        for (let a = Math.floor(centre - tw); a <= Math.ceil(centre + tw); a++) {
          for (let d = 0; d < tm + 2; d++) {
            // d: Abstand von der äußeren Gitterkante nach innen
            const x = side < 2 ? a : side === 2 ? d : W - 1 - d;
            const y = side < 2 ? (side === 0 ? d : H - 1 - d) : a;
            if (x < 0 || y < 0 || x >= W || y >= H) continue;
            const i = y * W + x;
            if (st.area && st.area[i]) continue;
            const u = a + 0.5 - centre;
            if (Math.abs(u) > tw) continue;
            // äußere Ecken abrunden
            const cu = Math.abs(u) - (tw - rr), cd = rr - (d + 0.5);
            if (cu > 0 && cd > 0 && cu * cu + cd * cd > rr * rr) continue;
            mat[i] = 1;
            assign[i] = tile;
          }
        }
      };
      const along = (lo, hi, side, tileOf) => {
        const len = hi - lo;
        if (len < 2 * keep) return;
        const k = Math.max(1, Math.round((len * p) / 120));
        for (let j = 0; j < k; j++) drawTab(side, lo + keep + ((j + 0.5) * (len - 2 * keep)) / k, tileOf);
      };
      for (let c = 0; c < nx; c++) {
        along(cutX[c], cutX[c + 1], 0, c);
        along(cutX[c], cutX[c + 1], 1, (ny - 1) * nx + c);
      }
      for (let r = 0; r < ny; r++) {
        along(cutY[r], cutY[r + 1], 2, r * nx);
        along(cutY[r], cutY[r + 1], 3, r * nx + nx - 1);
      }
    }

    // Spalt zwischen den Kacheln (immer auf Seite der höheren Kachelnummer)
    const gapPx = Math.max(1, Math.round(opts.clearanceMM / p));
    const gap = new Uint8Array(W * H);
    if (nx * ny > 1) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x, a = assign[i];
          if ((x > 0 && assign[i - 1] < a) || (x < W - 1 && assign[i + 1] < a) ||
              (y > 0 && assign[i - W] < a) || (y < H - 1 && assign[i + W] < a)) gap[i] = 1;
        }
      }
      for (let g = 1; g < gapPx; g++) {
        const add = [];
        for (let i = 0; i < W * H; i++) {
          if (gap[i]) continue;
          const x = i % W, a = assign[i];
          if ((x > 0 && gap[i - 1] && assign[i - 1] === a) || (x < W - 1 && gap[i + 1] && assign[i + 1] === a) ||
              (i >= W && gap[i - W] && assign[i - W] === a) || (i < W * H - W && gap[i + W] && assign[i + W] === a)) add.push(i);
        }
        for (const i of add) gap[i] = 1;
      }
    }

    const tiles = [];
    for (let r = 0; r < ny; r++) {
      for (let c = 0; c < nx; c++) {
        const t = r * nx + c;
        let x0 = W, y0 = H, x1 = -1, y1 = -1;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            if (assign[y * W + x] !== t) continue;
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
        if (x1 < 0) continue;
        const w = x1 - x0 + 1, h = y1 - y0 + 1;
        const m = new Uint8Array(w * h);
        const allowed = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = (y + y0) * W + (x + x0);
            allowed[y * w + x] = !gap[i] && assign[i] === t ? 1 : 0;
            m[y * w + x] = mat[i] && allowed[y * w + x] ? 1 : 0;
          }
        }
        // Winzige Splitter entfernen (< 2 mm²), dann abgetrennte Teile innerhalb der Kachel anbinden
        const minArea = 2 / (p * p);
        const pre = label(m, w, h);
        for (let i = 0; i < w * h; i++) if (m[i] && pre.sizes[pre.lab[i]] < minArea) m[i] = 0;
        const br = (opts.bridgeMM || 2) / p / 2;
        const excl = (st.removed || []).map(([x, y]) => [x - x0, y - y0]);
        const tb = addBridges(m, w, h, br, allowed, excl, br + 3 / p);
        if (st.bridges) for (const [ax, ay, bx, by] of tb.segments) st.bridges.push({ seg: [ax + x0, ay + y0, bx + x0, by + y0], manual: false });
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (!tb.bridgeMask[y * w + x]) continue;
            const i = (y + y0) * W + (x + x0);
            mat[i] = 1;
            st.bridgeMask[i] = 1;
          }
        }
        st.bridged += tb.bridged;
        if (tb.bridged) roundCorners(m, w, h, { ...opts, px: p }, allowed);
        fixDiagonals(m, w, h, false);
        const { lab, n, sizes } = label(m, w, h);
        let pieces = 0;
        for (let k = 1; k <= n; k++) if (sizes[k] >= minArea) pieces++;
        for (let i = 0; i < w * h; i++) if (m[i] && sizes[lab[i]] < minArea) m[i] = 0;
        fixDiagonals(m, w, h, false);
        let labelled = false;
        if (nx * ny > 1) {
          const area = new Uint8Array(w * h);
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) area[y * w + x] = !st.area || st.area[(y + y0) * W + x + x0] ? 1 : 0;
          const cut = stampNumber(m, w, h, p, `${r + 1}-${c + 1}`, area);
          if (cut) {
            labelled = true;
            for (const k of cut) {
              const x = k % w, y = (k - x) / w;
              const i = (y + y0) * W + (x + x0);
              mat[i] = 0;
              if (st.markMask) st.markMask[i] = 1;
            }
          }
        }
        tiles.push({ row: r, col: c, x0, y0, w, h, mask: m, pieces, labelled, widthMM: w * p, heightMM: h * p });
      }
    }
    return { nx, ny, cutX, cutY, tiles, knobs, assign, gap, bareSeams };
  }

  // ---------------------------------------------------------------------------
  // Kachelnummer als Ausschnitt (Segmentziffern ohne geschlossene Formen,
  // damit keine Inseln entstehen)
  // ---------------------------------------------------------------------------

  const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g' };

  function numberRects(text) {
    const cw = 4, ch = 6, t = 0.8, g = 0.45, space = 1.2;
    const rects = [];
    let x = 0;
    for (const chr of text) {
      const segs = SEG[chr] || '';
      if (chr === '-') {
        rects.push([x + 0.3, (ch - t) / 2, x + 2.1, (ch + t) / 2]);
        x += 2.4 + space;
        continue;
      }
      const R = {
        a: [t + g, 0, cw - t - g, t],
        g: [t + g, (ch - t) / 2, cw - t - g, (ch + t) / 2],
        d: [t + g, ch - t, cw - t - g, ch],
        f: [0, 0, t, ch / 2 - g / 2],
        b: [cw - t, 0, cw, ch / 2 - g / 2],
        e: [0, ch / 2 + g / 2, t, ch],
        c: [cw - t, ch / 2 + g / 2, cw, ch],
      };
      for (const sname of segs) {
        const [a, b, c2, d] = R[sname];
        rects.push([x + a, b, x + c2, d]);
      }
      x += cw + space;
    }
    return { rects, width: x - space, height: ch };
  }

  // Sucht eine volle Materialfläche (möglichst oben links) und schneidet die Nummer aus.
  function stampNumber(m, w, h, p, text, area) {
    const { rects, width, height } = numberRects(text);
    const margin = 1.5;
    const bw = Math.ceil((width + 2 * margin) / p), bh = Math.ceil((height + 2 * margin) / p);
    if (bw >= w || bh >= h) return null;
    const S = new Int32Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += m[y * w + x] && area[y * w + x] ? 1 : 0;
        S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + row;
      }
    }
    const full = bw * bh;
    const step = Math.max(1, Math.round(0.5 / p));
    let best = null, bestD = Infinity;
    for (let y = 0; y + bh <= h; y += step) {
      for (let x = 0; x + bw <= w; x += step) {
        if (x + y >= bestD) break;
        const sum = S[(y + bh) * (w + 1) + x + bw] - S[y * (w + 1) + x + bw] - S[(y + bh) * (w + 1) + x] + S[y * (w + 1) + x];
        if (sum === full) { best = [x, y]; bestD = x + y; }
      }
    }
    if (!best) return null;
    const ox = best[0] * p + margin, oy = best[1] * p + margin;
    const cut = [];
    for (const [a, b, c, d] of rects) {
      for (let y = Math.floor((oy + b) / p); y < Math.ceil((oy + d) / p); y++) {
        for (let x = Math.floor((ox + a) / p); x < Math.ceil((ox + c) / p); x++) {
          const cxm = (x + 0.5) * p, cym = (y + 0.5) * p;
          if (cxm < ox + a || cxm > ox + c || cym < oy + b || cym > oy + d) continue;
          const k = y * w + x;
          if (m[k]) { m[k] = 0; cut.push(k); }
        }
      }
    }
    return cut;
  }

  // ---------------------------------------------------------------------------
  // Maske -> Dreiecksnetz (wasserdicht)
  // ---------------------------------------------------------------------------

  function simplifyClosed(pts, tol) {
    const n = pts.length / 2;
    if (n < 8 || tol <= 0) return pts;
    // zweiten Ankerpunkt: am weitesten von Punkt 0 entfernt
    let far = 0, best = -1;
    for (let i = 1; i < n; i++) {
      const dx = pts[2 * i] - pts[0], dy = pts[2 * i + 1] - pts[1];
      const d = dx * dx + dy * dy;
      if (d > best) { best = d; far = i; }
    }
    const keep = new Uint8Array(n);
    keep[0] = 1;
    keep[far] = 1;
    const tol2 = tol * tol;
    const stack = [[0, far], [far, n]];
    while (stack.length) {
      const [a, bb] = stack.pop();
      const b = bb % n;
      const ax = pts[2 * a], ay = pts[2 * a + 1], bx = pts[2 * b], by = pts[2 * b + 1];
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy || 1e-12;
      let maxD = -1, idx = -1;
      for (let i = a + 1; i < bb; i++) {
        const px = pts[2 * i] - ax, py = pts[2 * i + 1] - ay;
        const cr = px * dy - py * dx;
        const d = (cr * cr) / len2;
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (idx >= 0 && maxD > tol2) {
        keep[idx] = 1;
        stack.push([a, idx], [idx, bb]);
      }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[2 * i], pts[2 * i + 1]);
    return out.length >= 6 ? out : pts;
  }

  function signedArea(pts) {
    let a = 0;
    const n = pts.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) a += pts[2 * j] * pts[2 * i + 1] - pts[2 * i] * pts[2 * j + 1];
    return a / 2;
  }

  // Liefert Konturen je Komponente in Rasterkoordinaten (y nach oben).
  function traceLoops(m, w, h) {
    const { lab } = label(m, w, h);
    const VW = w + 1;
    const next = new Int32Array(VW * (h + 1)).fill(-1);
    const owner = new Int32Array(VW * (h + 1));
    const set = (a, b, L) => { next[a] = b; owner[a] = L; };
    for (let y = 0; y < h; y++) {
      const j = h - 1 - y;
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!m[i]) continue;
        const L = lab[i];
        if (y === h - 1 || !m[i + w]) set(j * VW + x, j * VW + x + 1, L);
        if (x === w - 1 || !m[i + 1]) set(j * VW + x + 1, (j + 1) * VW + x + 1, L);
        if (y === 0 || !m[i - w]) set((j + 1) * VW + x + 1, (j + 1) * VW + x, L);
        if (x === 0 || !m[i - 1]) set((j + 1) * VW + x, j * VW + x, L);
      }
    }
    const comps = new Map();
    for (let s = 0; s < next.length; s++) {
      if (next[s] < 0) continue;
      const L = owner[s];
      const raw = [];
      let v = s;
      while (next[v] >= 0) {
        raw.push(v);
        const nv = next[v];
        next[v] = -1;
        v = nv;
      }
      // kollineare Punkte entfernen
      const n = raw.length;
      const pts = [];
      for (let k = 0; k < n; k++) {
        const a = raw[(k + n - 1) % n], b = raw[k], c = raw[(k + 1) % n];
        const ax = a % VW, ay = (a - ax) / VW, bx = b % VW, by = (b - bx) / VW, cx = c % VW, cy = (c - cx) / VW;
        if ((bx - ax) * (cy - by) - (by - ay) * (cx - bx) !== 0) pts.push(bx, by);
      }
      if (pts.length < 6) continue;
      const dense = [];
      for (const v0 of raw) { const x = v0 % VW; dense.push(x, (v0 - x) / VW); }
      if (!comps.has(L)) comps.set(L, []);
      comps.get(L).push({ pts, dense });
    }
    return comps;
  }

  function cross(f, a, b, c) {
    return (f[2 * b] - f[2 * a]) * (f[2 * c + 1] - f[2 * a + 1]) - (f[2 * b + 1] - f[2 * a + 1]) * (f[2 * c] - f[2 * a]);
  }

  // earcut erzeugt gelegentlich Kanten, auf denen weitere Eckpunkte liegen (T-Stöße),
  // und Dreiecke ohne Fläche. Solche Dreiecke werden an den Punkten geteilt bzw.
  // verworfen, damit Ober-/Unterseite exakt an die Seitenwände anschließen.
  // ip: ganzzahlige Rasterkoordinaten (x0, y0, x1, y1, ...)
  function fixTJunctions(idx, ip) {
    const at = new Map();
    for (let i = 0; i < ip.length / 2; i++) at.set(ip[2 * i] * 1048576 + ip[2 * i + 1], i);
    const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) { const t = a % b; a = b; b = t; } return a; };
    const pointOn = (a, b) => {
      const dx = ip[2 * b] - ip[2 * a], dy = ip[2 * b + 1] - ip[2 * a + 1];
      const g = gcd(dx, dy);
      if (g < 2) return -1;
      const sx = dx / g, sy = dy / g;
      for (let k = 1; k < g; k++) {
        const v = at.get((ip[2 * a] + k * sx) * 1048576 + ip[2 * a + 1] + k * sy);
        if (v !== undefined) return v;
      }
      return -1;
    };
    const out = [];
    const stack = [];
    for (let t = 0; t < idx.length; t += 3) stack.push([idx[t], idx[t + 1], idx[t + 2]]);
    let guard = 0;
    while (stack.length) {
      const t = stack.pop();
      if (t[0] === t[1] || t[1] === t[2] || t[0] === t[2]) continue;
      let split = false;
      if (guard++ < 2000000) {
        for (let e = 0; e < 3 && !split; e++) {
          const x = t[e], y = t[(e + 1) % 3], o = t[(e + 2) % 3];
          const m = pointOn(x, y);
          if (m >= 0) {
            stack.push([x, m, o], [m, y, o]);
            split = true;
          }
        }
      }
      if (!split && cross(ip, t[0], t[1], t[2]) !== 0) out.push(t);
    }
    return out;
  }

  // Glättet eine Pixelkontur: Mittelpunkte der Pixelkanten, dann einige Durchgänge
  // eines kleinen Binomialfilters. Treppen werden zu glatten Linien und Kurven,
  // gerade Kanten bleiben gerade, Ecken werden um etwa einen Pixel gerundet.
  function smoothLoop(dense, iters) {
    const n = dense.length / 2;
    let m = new Float64Array(2 * n);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      m[2 * i] = (dense[2 * i] + dense[2 * j]) / 2;
      m[2 * i + 1] = (dense[2 * i + 1] + dense[2 * j + 1]) / 2;
    }
    let t = new Float64Array(2 * n);
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < n; i++) {
        const a = (i + n - 1) % n, b = (i + 1) % n;
        t[2 * i] = 0.25 * m[2 * a] + 0.5 * m[2 * i] + 0.25 * m[2 * b];
        t[2 * i + 1] = 0.25 * m[2 * a + 1] + 0.5 * m[2 * i + 1] + 0.25 * m[2 * b + 1];
      }
      const tmp = m; m = t; t = tmp;
    }
    return Array.from(m);
  }

  // Trianguliert eine Komponente (Außenkontur + Löcher) zu einem geschlossenen Körper.
  // Liefert null, wenn das Ergebnis nicht wasserdicht wäre.
  function triangulateComponent(polys, p, H, latticeFix) {
    let oi = 0, best = -Infinity;
    polys.forEach((pl, i) => { const a = signedArea(pl); if (a > best) { best = a; oi = i; } });
    if (best <= 0) return [];
    const ordered = [polys[oi]].concat(polys.filter((_, i) => i !== oi && signedArea(polys[i]) < 0));
    const flat = [];
    const holeIdx = [];
    const starts = [];
    for (let k = 0; k < ordered.length; k++) {
      if (k > 0) holeIdx.push(flat.length / 2);
      starts.push(flat.length / 2);
      for (const v of ordered[k]) flat.push(v);
    }
    const nv = flat.length / 2;
    let tri = earcut(flat, holeIdx, 2);
    if (latticeFix) tri = fixTJunctions(tri, flat);
    else {
      const g = [];
      for (let t = 0; t < tri.length; t += 3) g.push([tri[t], tri[t + 1], tri[t + 2]]);
      tri = g;
    }

    // Prüfen: jede gerichtete Kante genau einmal, ihre Gegenkante ebenfalls genau einmal
    const edges = new Map();
    const addE = (a, b) => { const k = a * 2 * nv + b; edges.set(k, (edges.get(k) || 0) + 1); };
    const faces = [];
    for (const [a, b0, c0] of tri) {
      let b = b0, c = c0;
      const cr = cross(flat, a, b, c);
      if (cr === 0) return null;
      if (cr < 0) { const tmp = b; b = c; c = tmp; }
      faces.push([a + nv, b + nv, c + nv], [a, c, b]);
    }
    for (let k = 0; k < ordered.length; k++) {
      const s0 = starts[k], n = ordered[k].length / 2;
      for (let i = 0; i < n; i++) {
        const a = s0 + i, b = s0 + ((i + 1) % n);
        faces.push([a, b, b + nv], [a, b + nv, a + nv]);
      }
    }
    for (const [a, b, c] of faces) { addE(a, b); addE(b, c); addE(c, a); }
    for (const [k, cnt] of edges) {
      const a = Math.floor(k / (2 * nv)), b = k - a * 2 * nv;
      if (cnt !== 1 || edges.get(b * 2 * nv + a) !== 1) return null;
    }
    const out = [];
    const P = (v) => (v < nv ? [flat[2 * v] * p, flat[2 * v + 1] * p, 0] : [flat[2 * (v - nv)] * p, flat[2 * (v - nv) + 1] * p, H]);
    for (const [a, b, c] of faces) out.push(...P(a), ...P(b), ...P(c));
    return out;
  }

  /*
   * smooth: Konturen glätten (sonst exakte Pixelkanten). Wenn eine geglättete
   * Komponente nicht sauber trianguliert, wird für sie die Pixelkontur verwendet.
   */
  function maskToTriangles(m, w, h, p, heightMM, tolPx, smooth) {
    const comps = traceLoops(m, w, h);
    const tris = [];
    let fallbacks = 0;
    for (const loops of comps.values()) {
      let res = null;
      if (smooth) {
        const polys = loops.map((l) => {
          const sm = simplifyClosed(smoothLoop(l.dense, 4), 0.12);
          const a0 = signedArea(l.pts), a1 = signedArea(sm);
          return Math.sign(a0) === Math.sign(a1) && Math.abs(a1 - a0) < 0.2 * Math.abs(a0) + 2 ? sm : null;
        });
        if (polys.every(Boolean)) res = triangulateComponent(polys, p, heightMM, false);
        if (!res) fallbacks++;
      }
      if (!res) {
        const polys = loops.map((l) => {
          const sm = simplifyClosed(l.pts, tolPx);
          const a0 = signedArea(l.pts), a1 = signedArea(sm);
          return Math.sign(a0) === Math.sign(a1) && Math.abs(a1) > 0.25 * Math.abs(a0) ? sm : l.pts;
        });
        res = triangulateComponent(polys, p, heightMM, true) || [];
      }
      for (const v of res) tris.push(v);
    }
    const out = new Float32Array(tris);
    out.fallbacks = fallbacks;
    return out;
  }

  function trianglesToSTL(tris, name) {
    const n = tris.length / 9;
    const buf = new ArrayBuffer(84 + n * 50);
    const dv = new DataView(buf);
    const header = ('Stencilio Print - ' + (name || 'schablone')).slice(0, 80);
    for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i) & 0x7f);
    dv.setUint32(80, n, true);
    let o = 84;
    for (let t = 0; t < n; t++) {
      const k = t * 9;
      const ux = tris[k + 3] - tris[k], uy = tris[k + 4] - tris[k + 1], uz = tris[k + 5] - tris[k + 2];
      const vx = tris[k + 6] - tris[k], vy = tris[k + 7] - tris[k + 1], vz = tris[k + 8] - tris[k + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
      o += 12;
      for (let q = 0; q < 9; q++) { dv.setFloat32(o, tris[k + q], true); o += 4; }
      dv.setUint16(o, 0, true);
      o += 2;
    }
    return buf;
  }

  return {
    buildStencil, prepareStencil, finishStencil, planTiles, makeTiles, maskToTriangles, trianglesToSTL,
    // für Tests
    paintLoss,
    _internal: { opening, erode, dilate, label, fixDiagonals, traceLoops, simplifyClosed, signedArea, addBridges },
  };
});
