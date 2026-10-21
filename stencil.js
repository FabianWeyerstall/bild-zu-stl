/*
 * Bild zu STL: Kernlogik (läuft im Browser und in Node).
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
  function addBridges(mat, W, H, radius, allowed) {
    const bridgeMask = new Uint8Array(W * H);
    const { lab, n } = label(mat, W, H);
    if (n <= 1) return { bridgeMask, bridged: 0 };
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
      if (!cur || cost < cur[0]) best.set(key, [cost, fi, fj, A, B]);
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
      const line = [];
      const crossed = new Set();
      let ok = true;
      for (let s = 0; s <= steps; s++) {
        const x = Math.round(ax + ((bx - ax) * s) / steps), y = Math.round(ay + ((by - ay) * s) / steps);
        const q = y * W + x;
        if (mat[q]) crossed.add(lab[q]);
        else if (allowed && !allowed[q]) { ok = false; break; }
        line.push(q);
      }
      if (!ok) continue;
      for (const q0 of line) {
        const x = q0 % W, y = (q0 - x) / W;
        for (const [dx, dy] of disk) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const q = yy * W + xx;
          if (!mat[q] && (!allowed || allowed[q])) { mat[q] = 1; bridgeMask[q] = 1; }
        }
      }
      for (const L of crossed) union(A, L);
      union(A, B);
      bridged++;
    }
    return { bridgeMask, bridged };
  }

  // ---------------------------------------------------------------------------
  // Bild -> Schablonenmaske
  // ---------------------------------------------------------------------------

  /*
   * gray: Uint8Array (iw*ih), Bild bereits auf das Raster (px mm pro Pixel) skaliert.
   * opts: { px, threshold, invert, markerMM, minStegMM, bridgeMM, borderMM, widenThin, smoothMM }
   */
  function buildStencil(gray, iw, ih, opts) {
    const p = opts.px;
    const b = Math.max(0, Math.round(opts.borderMM / p));
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

    // 1) Öffnungen mindestens so breit wie der Marker
    const r = opts.markerMM / p / 2;
    let holes = opening(holes0, W, H, r);
    if (opts.widenThin) {
      const thin = new Uint8Array(W * H);
      let any = false;
      for (let i = 0; i < W * H; i++) if (holes0[i] && !holes[i]) thin[i] = 1;
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
    let mat = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) mat[i] = holes[i] ? 0 : 1;
    mat = opening(mat, W, H, opts.minStegMM / p / 2);

    // 3) Inseln mit Haltestegen anbinden
    const { bridgeMask, bridged } = addBridges(mat, W, H, opts.bridgeMM / p / 2);

    // 4) Diagonale Berührungen schließen
    fixDiagonals(mat, W, H, true);

    return { W, H, px: p, border: b, mat, holes0, bridgeMask, bridged };
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

    for (let c = 1; c < nx; c++) {
      for (let r = 0; r < ny; r++) {
        const y0 = cutY[r] + edgeKeep, y1 = cutY[r + 1] - edgeKeep;
        if (y1 <= y0) continue;
        const n = Math.max(1, Math.floor((y1 - y0) / spacing));
        let k = 0;
        for (let s = 0; s < n; s++) {
          const pos = y0 + ((s + 0.5) * (y1 - y0)) / n;
          const dir = k % 2 === 0 ? 1 : -1;
          const src = r * nx + (dir > 0 ? c - 1 : c);
          if (tryKnob(true, cutX[c], pos, dir, src)) k++;
        }
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
          const dir = k % 2 === 0 ? 1 : -1;
          const src = (dir > 0 ? r - 1 : r) * nx + c;
          if (tryKnob(false, cutY[r], pos, dir, src)) k++;
        }
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
        const tb = addBridges(m, w, h, (opts.bridgeMM || 2) / p / 2, allowed);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (!tb.bridgeMask[y * w + x]) continue;
            const i = (y + y0) * W + (x + x0);
            mat[i] = 1;
            st.bridgeMask[i] = 1;
          }
        }
        st.bridged += tb.bridged;
        fixDiagonals(m, w, h, false);
        const { lab, n, sizes } = label(m, w, h);
        let pieces = 0;
        for (let k = 1; k <= n; k++) if (sizes[k] >= minArea) pieces++;
        for (let i = 0; i < w * h; i++) if (m[i] && sizes[lab[i]] < minArea) m[i] = 0;
        fixDiagonals(m, w, h, false);
        tiles.push({ row: r, col: c, x0, y0, w, h, mask: m, pieces, widthMM: w * p, heightMM: h * p });
      }
    }
    return { nx, ny, cutX, cutY, tiles, knobs, assign, gap };
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
      if (!comps.has(L)) comps.set(L, []);
      comps.get(L).push(pts);
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

  function maskToTriangles(m, w, h, p, heightMM, tolPx) {
    const comps = traceLoops(m, w, h);
    const tris = [];
    const H = heightMM;
    for (const loops of comps.values()) {
      let polys = loops.map((l) => {
        const s = simplifyClosed(l, tolPx);
        const a0 = signedArea(l), a1 = signedArea(s);
        return Math.sign(a0) === Math.sign(a1) && Math.abs(a1) > 0.25 * Math.abs(a0) ? s : l;
      });
      let oi = 0, best = -Infinity;
      polys.forEach((pl, i) => { const a = signedArea(pl); if (a > best) { best = a; oi = i; } });
      if (best <= 0) continue;
      const ordered = [polys[oi]].concat(polys.filter((_, i) => i !== oi && signedArea(polys[i]) < 0));
      const flat = [];
      const holeIdx = [];
      for (let k = 0; k < ordered.length; k++) {
        if (k > 0) holeIdx.push(flat.length / 2);
        for (const v of ordered[k]) flat.push(v);
      }
      const tri = fixTJunctions(earcut(flat, holeIdx, 2), flat);
      for (let i = 0; i < flat.length; i++) flat[i] *= p;
      for (const [a, b0, c0] of tri) {
        let b = b0, c = c0;
        if (cross(flat, a, b, c) < 0) { const tmp = b; b = c; c = tmp; }
        tris.push(flat[2 * a], flat[2 * a + 1], H, flat[2 * b], flat[2 * b + 1], H, flat[2 * c], flat[2 * c + 1], H);
        tris.push(flat[2 * a], flat[2 * a + 1], 0, flat[2 * c], flat[2 * c + 1], 0, flat[2 * b], flat[2 * b + 1], 0);
      }
      for (const pl of ordered) {
        const n = pl.length / 2;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const ax = pl[2 * i] * p, ay = pl[2 * i + 1] * p, bx = pl[2 * j] * p, by = pl[2 * j + 1] * p;
          tris.push(ax, ay, 0, bx, by, 0, bx, by, H);
          tris.push(ax, ay, 0, bx, by, H, ax, ay, H);
        }
      }
    }
    return new Float32Array(tris);
  }

  function trianglesToSTL(tris, name) {
    const n = tris.length / 9;
    const buf = new ArrayBuffer(84 + n * 50);
    const dv = new DataView(buf);
    const header = ('Bild zu STL - ' + (name || 'schablone')).slice(0, 80);
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
    buildStencil, planTiles, makeTiles, maskToTriangles, trianglesToSTL,
    // für Tests
    _internal: { opening, erode, dilate, label, fixDiagonals, traceLoops, simplifyClosed, signedArea, addBridges },
  };
});
