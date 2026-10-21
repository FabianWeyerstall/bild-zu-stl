const S = require('../stencil.js');
// synthetisches Bild: Text-ähnlich: Ring ("O") + dünne Linie + Rauschen
const p = 0.25, iw = 1200, ih = 900; // 300 x 225 mm
const g = new Uint8Array(iw * ih).fill(255);
for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) {
  const dx = x - 300, dy = y - 300, r = Math.hypot(dx, dy);
  if (r > 120 && r < 200) g[y * iw + x] = 0;            // Ring -> Insel innen
  if (Math.abs(y - 700) < 2 && x > 100 && x < 1100) g[y * iw + x] = 0; // dünne Linie 1mm
  if (x > 700 && x < 1000 && y > 100 && y < 500 && ((x >> 4) + (y >> 4)) % 2) g[y * iw + x] = 0; // Schachbrett 4mm
  if (Math.random() < 0.01) g[y * iw + x] = 0;
}
let t = Date.now();
const st = S.buildStencil(g, iw, ih, { px: p, threshold: 128, invert: false, markerMM: 3, minStegMM: 2, bridgeMM: 2, borderMM: 10, tabMM: 12, widenThin: true, smoothMM: 0, cornerMM: 1 });
console.log('stencil', st.W, st.H, 'bridged', st.bridged, Date.now() - t, 'ms');
const { label } = S._internal;
console.log('components', label(st.mat, st.W, st.H).n);
t = Date.now();
const tl = S.makeTiles(st, { maxTileMM: 240, clearanceMM: 0.2, knobR: 3.5, neckW: 3.5, neckL: 2, knobSpacing: 40, bridgeMM: 2, markerMM: 3, minStegMM: 2, cornerMM: 1 });
console.log('tiles', tl.nx, tl.ny, 'knobs', tl.knobs.length, Date.now() - t, 'ms');
let bad = 0;
for (const tile of tl.tiles) {
  const tris = S.maskToTriangles(tile.mask, tile.w, tile.h, p, 0.4, 0.7, process.env.SMOOTH !== "0");
  // Mannigfaltigkeit: jede gerichtete Kante genau einmal, Gegenkante genau einmal
  const E = new Map();
  const key = (i) => tris[i].toFixed(4) + ',' + tris[i + 1].toFixed(4) + ',' + tris[i + 2].toFixed(4);
  let vol = 0;
  for (let k = 0; k < tris.length; k += 9) {
    const v = [key(k), key(k + 3), key(k + 6)];
    for (let e = 0; e < 3; e++) { const kk = v[e] + '|' + v[(e + 1) % 3]; E.set(kk, (E.get(kk) || 0) + 1); }
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = tris.slice(k, k + 9);
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  let errs = 0;
  for (const [kk, c] of E) { const [a, b] = kk.split('|'); if (c !== 1 || E.get(b + '|' + a) !== 1) errs++; }
  let area = 0; for (const v of tile.mask) area += v;
  console.log(`tile r${tile.row}c${tile.col} ${tile.widthMM.toFixed(1)}x${tile.heightMM.toFixed(1)}mm pieces=${tile.pieces} tris=${tris.length / 9} edgeErrs=${errs} vol=${vol.toFixed(0)} expected=${(area * p * p * 0.4).toFixed(0)}`);
  bad += errs;
  require('fs').writeFileSync(require('os').tmpdir() + `/tile_${tile.row}_${tile.col}.stl`, Buffer.from(S.trianglesToSTL(tris, 't')));
}
process.exit(bad ? 1 : 0);
