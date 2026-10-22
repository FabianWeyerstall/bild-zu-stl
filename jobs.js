/*
 * Rechenaufträge für Stencilio Print. Läuft als Web Worker, damit die Seite während
 * der Berechnung bedienbar bleibt. Wird auch normal eingebunden: Falls kein Worker
 * startet (z. B. lokal per file://), rechnet app.js dieselben Aufträge direkt.
 */
(function () {
  const inWorker = typeof importScripts === 'function' && typeof window === 'undefined';
  if (inWorker) importScripts('vendor/earcut.min.js' + self.location.search, 'stencil.js' + self.location.search);

  // Die vorbereitete Schablone bleibt hier liegen, solange sich Bild und Grundeinstellungen nicht ändern
  let base = null, baseKey = '';
  const toGrid = (g, u, v) => [g.border + u * (g.W - 2 * g.border), g.border + v * (g.H - 2 * g.border)];

  const jobs = {
    // Vorschau: liefert null, wenn das Rasterbild fehlt (dann schickt app.js es mit)
    stencil({ key, raster, s, edits, knob }) {
      if (raster) { base = Stencil.prepareStencil(raster.gray, raster.iw, raster.ih, s); baseKey = key; }
      if (!base || key !== baseKey) return null;
      const grid = {
        removed: edits.removed.map(([u, v]) => toGrid(base, u, v)),
        added: edits.added.map(([u1, v1, u2, v2]) => toGrid(base, u1, v1).concat(toGrid(base, u2, v2))),
      };
      const st = Stencil.finishStencil(base, s, grid);
      const tiles = Stencil.makeTiles(st, { ...s, ...knob });
      return { st, tiles };
    },
    loss({ gray, w, h, s }) {
      return Stencil.paintLoss(gray, w, h, s);
    },
    // Kachel als Netz. Die Nummer (labels = Pixel) wird in die Oberseite eingeprägt: unten eine volle
    // Lage, oben eine Lage mit ausgesparten Ziffern. Beide überlappen 0,1 mm, damit der Slicer sie verschmilzt.
    mesh({ mask, w, h, px, thickness, smooth, shrink, labels }) {
      const depth = Math.min(0.4, thickness - 0.2);
      if (!labels || !labels.length || depth < 0.15) return Stencil.maskToTriangles(mask, w, h, px, thickness, 0.7, smooth, shrink);
      const z = thickness - depth;
      const lower = Stencil.maskToTriangles(mask, w, h, px, z + 0.05, 0.7, smooth, shrink);
      const topMask = mask.slice();
      for (const k of labels) topMask[k] = 0;
      const upper = Stencil.maskToTriangles(topMask, w, h, px, depth + 0.05, 0.7, smooth, shrink);
      for (let k = 2; k < upper.length; k += 3) upper[k] += z - 0.05;
      const out = new Float32Array(lower.length + upper.length);
      out.set(lower);
      out.set(upper, lower.length);
      return out;
    },
  };

  if (inWorker) {
    self.onmessage = (e) => {
      const { id, job, arg } = e.data;
      try {
        const value = jobs[job](arg);
        const transfer = value instanceof Float32Array ? [value.buffer] : [];
        self.postMessage({ id, ok: true, value }, transfer);
      } catch (err) {
        self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
      }
    };
  } else {
    // Ein Rechner pro Aufgabe (Vorschau, Malbarkeit), jeweils ein eigener Worker
    self.StencilJobs = {
      runner(url) {
        let worker = null;
        let seq = 0;
        const waiting = new Map();
        const local = (job, arg) => new Promise((resolve, reject) => {
          setTimeout(() => { try { resolve(jobs[job](arg)); } catch (err) { reject(err); } }, 0);
        });
        try { worker = new Worker(url); } catch (e) { worker = null; }
        if (worker) {
          worker.onmessage = (e) => {
            const w = waiting.get(e.data.id);
            if (!w) return;
            waiting.delete(e.data.id);
            if (e.data.ok) w.resolve(e.data.value); else w.reject(new Error(e.data.error));
          };
          // Startet der Worker nicht, rechnen offene und künftige Aufträge direkt auf der Seite
          worker.onerror = (e) => {
            e.preventDefault();
            worker = null;
            for (const w of waiting.values()) local(w.job, w.arg).then(w.resolve, w.reject);
            waiting.clear();
          };
        }
        return (job, arg) => {
          if (!worker) return local(job, arg);
          return new Promise((resolve, reject) => {
            const id = ++seq;
            waiting.set(id, { job, arg, resolve, reject });
            worker.postMessage({ id, job, arg });
          });
        };
      },
    };
  }
})();
