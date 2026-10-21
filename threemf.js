/*
 * 3MF-Export für Bambu Studio: alle Kacheln in einer Projektdatei, jede auf ihrer eigenen Platte.
 * Die Plattenzuordnung steht in Metadata/model_settings.config (Bambu-Format),
 * die Lage der Platten folgt dem Raster, das Bambu Studio selbst verwendet.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ThreeMF = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_BED = [256, 256]; // Bambu Lab X1C

  // Druckbett aus den Projekteinstellungen ("0x0","256x0","256x256","0x256")
  function bedSize(settings) {
    const area = settings && settings.printable_area;
    if (!Array.isArray(area) || !area.length) return DEFAULT_BED;
    const pts = area.map((p) => String(p).split('x').map(Number));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    return w > 0 && h > 0 ? [w, h] : DEFAULT_BED;
  }

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const num = (v) => (Math.round(v * 10000) / 10000).toString();

  function plateColumns(count) {
    const v = Math.sqrt(count);
    const r = Math.round(v);
    return v > r ? r + 1 : r;
  }

  // Dreiecksliste (x,y,z je Ecke) -> indiziertes Netz
  function indexMesh(tris) {
    const map = new Map();
    const verts = [];
    const idx = new Uint32Array(tris.length / 3);
    for (let i = 0; i < tris.length; i += 3) {
      const key = tris[i] + ',' + tris[i + 1] + ',' + tris[i + 2];
      let k = map.get(key);
      if (k === undefined) {
        k = verts.length / 3;
        map.set(key, k);
        verts.push(tris[i], tris[i + 1], tris[i + 2]);
      }
      idx[i / 3] = k;
    }
    return { verts, idx };
  }

  /*
   * parts: [{ name, tris: Float32Array, width, height }]  (Maße in mm, Netz ab Ursprung)
   * Liefert die Dateien des 3MF-Pakets als { pfad: text }.
   */
  function build(parts, title, settings) {
    const version = (settings && settings.version) || '02.07.01.62';
    const cols = plateColumns(parts.length);
    const [bedW, bedH] = bedSize(settings);
    // Bambu Studio: Abstand der Platten = Plattengröße + 1/5
    const strideX = bedW * 1.2, strideY = bedH * 1.2;
    const boxes = excludeBoxes(settings);
    const misfits = [];
    const objects = [];
    const items = [];
    const cfgObjects = [];
    const plates = [];

    parts.forEach((part, k) => {
      const id = k + 1;
      const { verts, idx } = indexMesh(part.tris);
      const v = [];
      for (let i = 0; i < verts.length; i += 3) v.push(`<vertex x="${num(verts[i])}" y="${num(verts[i + 1])}" z="${num(verts[i + 2])}"/>`);
      const t = [];
      for (let i = 0; i < idx.length; i += 3) t.push(`<triangle v1="${idx[i]}" v2="${idx[i + 1]}" v3="${idx[i + 2]}"/>`);
      objects.push(`<object id="${id}" name="${esc(part.name)}" type="model"><mesh><vertices>${v.join('')}</vertices><triangles>${t.join('')}</triangles></mesh></object>`);

      // Auf die Mitte der eigenen Platte setzen
      const col = k % cols, row = Math.floor(k / cols);
      const spot = placeOnPlate(part.width, part.height, bedW, bedH, boxes);
      if (!spot.fits) misfits.push(part.name);
      const tx = col * strideX + spot.x;
      const ty = -row * strideY + spot.y;
      items.push(`<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${num(tx)} ${num(ty)} 0" printable="1"/>`);

      cfgObjects.push(`  <object id="${id}">\n    <metadata key="name" value="${esc(part.name)}"/>\n    <metadata key="extruder" value="1"/>\n  </object>`);
      plates.push(`  <plate>\n    <metadata key="plater_id" value="${id}"/>\n    <metadata key="plater_name" value="${esc(part.name)}"/>\n    <metadata key="locked" value="false"/>\n    <metadata key="filament_map_mode" value="Auto For Flush"/>\n    <model_instance>\n      <metadata key="object_id" value="${id}"/>\n      <metadata key="instance_id" value="0"/>\n      <metadata key="identify_id" value="${id}"/>\n    </model_instance>\n  </plate>`);
    });

    const model = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">\n' +
      ` <metadata name="Application">BambuStudio-${esc(version)}</metadata>\n` +
      ' <metadata name="BambuStudio:3mfVersion">1</metadata>\n' +
      ` <metadata name="Title">${esc(title || 'Schablone')}</metadata>\n` +
      ' <metadata name="Designer">Bild zu STL</metadata>\n' +
      ` <resources>\n${objects.join('\n')}\n </resources>\n` +
      ` <build>\n${items.join('\n')}\n </build>\n` +
      '</model>\n';

    const config = '<?xml version="1.0" encoding="UTF-8"?>\n<config>\n' + cfgObjects.join('\n') + '\n' + plates.join('\n') + '\n</config>\n';

    const files = {
      '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
        '<Default Extension="config" ContentType="text/xml"/>' +
        '<Default Extension="png" ContentType="image/png"/></Types>\n',
      '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>\n',
      '3D/3dmodel.model': model,
      'Metadata/model_settings.config': config,
      'Metadata/slice_info.config': '<?xml version="1.0" encoding="UTF-8"?>\n<config>\n  <header>\n    <header_item key="X-BBL-Client-Type" value="slicer"/>\n' +
        `    <header_item key="X-BBL-Client-Version" value="${esc(version)}"/>\n  </header>\n</config>\n`,
    };
    // Ohne Projekteinstellungen lädt Bambu Studio nur die Geometrie und legt alles auf Platte 1
    if (settings) files['Metadata/project_settings.config'] = JSON.stringify(settings, null, 4) + '\n';
    Object.defineProperty(files, 'misfits', { value: misfits, enumerable: false, configurable: true });
    return files;
  }

  // Gesperrte Bereiche des Betts (X1C/P1: Ecke vorne links für den Abstreifer)
  function excludeBoxes(settings) {
    const area = settings && settings.bed_exclude_area;
    if (!Array.isArray(area) || area.length < 3) return [];
    const pts = area.map((p) => String(p).split('x').map(Number));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    return box.x1 > box.x0 && box.y1 > box.y0 ? [box] : [];
  }

  // Lage auf der Platte: möglichst mittig, aber außerhalb gesperrter Bereiche
  function placeOnPlate(w, h, bedW, bedH, boxes) {
    const M = 1; // Abstand zum Plattenrand
    const xs = [(bedW - w) / 2, bedW - w - M, M], ys = [(bedH - h) / 2, bedH - h - M, M];
    const hits = (x, y) => boxes.some((b) => x < b.x1 && x + w > b.x0 && y < b.y1 && y + h > b.y0);
    for (const y of ys) for (const x of xs) {
      if (x < 0 || y < 0 || x + w > bedW || y + h > bedH) continue;
      if (!hits(x, y)) return { x, y, fits: true };
    }
    return { x: (bedW - w) / 2, y: (bedH - h) / 2, fits: false };
  }

  return { build, plateColumns, bedSize, placeOnPlate };
});
