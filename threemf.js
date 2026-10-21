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

  const BED = 256; // Bambu Lab X1C
  const PLATE_STRIDE = BED * 1.2; // Bambu Studio: Abstand der Platten = Plattengröße + 1/5

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
  function build(parts, title) {
    const cols = plateColumns(parts.length);
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
      const tx = col * PLATE_STRIDE + BED / 2 - part.width / 2;
      const ty = -row * PLATE_STRIDE + BED / 2 - part.height / 2;
      items.push(`<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${num(tx)} ${num(ty)} 0" printable="1"/>`);

      cfgObjects.push(`  <object id="${id}">\n    <metadata key="name" value="${esc(part.name)}"/>\n    <metadata key="extruder" value="1"/>\n  </object>`);
      plates.push(`  <plate>\n    <metadata key="plater_id" value="${id}"/>\n    <metadata key="plater_name" value="${esc(part.name)}"/>\n    <metadata key="locked" value="false"/>\n    <model_instance>\n      <metadata key="object_id" value="${id}"/>\n      <metadata key="instance_id" value="0"/>\n      <metadata key="identify_id" value="${id}"/>\n    </model_instance>\n  </plate>`);
    });

    const model = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">\n' +
      ' <metadata name="Application">BambuStudio-01.09.00.00</metadata>\n' +
      ' <metadata name="BambuStudio:3mfVersion">1</metadata>\n' +
      ` <metadata name="Title">${esc(title || 'Schablone')}</metadata>\n` +
      ' <metadata name="Designer">Bild zu STL</metadata>\n' +
      ` <resources>\n${objects.join('\n')}\n </resources>\n` +
      ` <build>\n${items.join('\n')}\n </build>\n` +
      '</model>\n';

    const config = '<?xml version="1.0" encoding="UTF-8"?>\n<config>\n' + cfgObjects.join('\n') + '\n' + plates.join('\n') + '\n</config>\n';

    return {
      '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
        '<Default Extension="config" ContentType="text/xml"/>' +
        '<Default Extension="png" ContentType="image/png"/></Types>\n',
      '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>\n',
      '3D/3dmodel.model': model,
      'Metadata/model_settings.config': config,
    };
  }

  return { build, plateColumns };
});
