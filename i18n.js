// Sprachumschaltung Deutsch/Englisch. Deutsch ist Standard und steht direkt im HTML;
// für Englisch werden Texte und einige Attribute über die Tabelle unten ersetzt.
// Texte, die app.js zur Laufzeit setzt, laufen über I18N.tr(deutsch, englisch).
(function () {
  const STORE = 'bild-zu-stl:sprache';
  const EN = {
    'Schablonen aus dem 3D-Drucker für jedes Motiv: zum Nachmalen mit Kreidemarker am Fenster, mit Filzstift auf Papier, mit Farbe an der Wand und vielem mehr. Alles läuft in deinem Browser, nichts wird hochgeladen.':
      '3D-printed stencils for any design: trace with chalk markers on windows, felt pens on paper, paint on walls and much more. Everything runs in your browser, nothing is uploaded.',
    '1. Bild': '1. Image',
    'Oder mit einem Beispiel starten': 'Or start with an example',
    'Für Kinder': 'For kids',
    'Sterne & Winter': 'Stars & winter',
    'Kürbisse': 'Pumpkins',
    'Gespenst': 'Ghost',
    'Katze': 'Cat',
    'Hexenregal': 'Witch shelf',
    'Schmetterling': 'Butterfly',
    'Fisch': 'Fish',
    'Haus': 'House',
    'Sternenhimmel': 'Starry sky',
    'Sternschnuppen': 'Shooting stars',
    'Schneeflocken': 'Snowflakes',
    'Alle Beispiele sind eigene Motive und dürfen frei verwendet werden.': 'All examples are original designs and free to use.',
    'Bild hierher ziehen oder klicken': 'Drop an image here or click',
    'Leeren Rand ums Motiv abschneiden': 'Crop empty border around the subject',
    '2. Was wird gemalt': '2. What gets painted',
    'Helligkeits-Schwelle': 'Brightness threshold',
    'Helle Bereiche ausmalen statt dunkle': 'Paint light areas instead of dark ones',
    'Glätten (mm)': 'Smoothing (mm)',
    '3. Stift': '3. Marker',
    'Markerbreite (kleinste Öffnung)': 'Marker width (smallest opening)',
    'Dünne Linien': 'Thin lines',
    'auf Markerbreite verbreitern': 'widen to marker width',
    'weglassen': 'leave out',
    'Breite Linien': 'Wide lines',
    'so lassen': 'keep as they are',
    'auf Markerbreite (+0,5 mm) verschmälern': 'narrow to marker width (+0.5 mm)',
    'Verschmälern macht dicke Konturen (z. B. bei großen Schablonen) wieder zu Linien, die man in einem Zug nachzieht. Große Flächen ab etwa 15 mm bleiben ausgefüllt.':
      'Narrowing turns thick outlines (e.g. on large stencils) back into lines you can trace in one stroke. Filled areas from about 15 mm stay filled.',
    '4. Größe & Drucker': '4. Size & printer',
    'Drucker': 'Printer',
    'Bambu Lab H2D (300 × 320 mm, Bereich beider Düsen)': 'Bambu Lab H2D (300 × 320 mm, area of both nozzles)',
    'Breite (mm)': 'Width (mm)',
    'Höhe (mm)': 'Height (mm)',
    'Breite': 'Width',
    'An Druckplatten anpassen (größte Breite je Plattenzahl):': 'Fit to build plates (largest width per plate count):',
    '5. Druckteil': '5. Printed part',
    'Dicke': 'Thickness',
    '0,2 mm': '0.2 mm',
    '0,4 mm': '0.4 mm',
    '0,6 mm': '0.6 mm',
    '0,2 mm ist nur eine Druckschicht: sehr biegsam, aber empfindlich. Schichthöhe 0,2 mm, glatte PEI-Platte, vorsichtig ablösen. Breitere Stege (2,5–3 mm) unter „Erweitert“ helfen.':
      '0.2 mm is a single layer: very flexible but fragile. Use 0.2 mm layer height and a smooth PEI plate, and peel it off carefully. Wider bridges (2.5–3 mm) under “Advanced” help.',
    'Rand um das Bild (mm)': 'Border around the image (mm)',
    'Klebelaschen am Außenrand': 'Tape tabs on the outer edge',
    'Ecken abrunden (mm)': 'Round corners (mm)',
    'Kanten glätten (statt Pixelstufen)': 'Smooth edges (instead of pixel steps)',
    'Erweitert': 'Advanced',
    'Mindest-Stegbreite (mm)': 'Minimum web width (mm)',
    'Breite der Haltestege (mm)': 'Width of holding bridges (mm)',
    'Max. Kachelgröße (mm)': 'Max. tile size (mm)',
    'Spiel der Puzzle-Verbinder (mm)': 'Puzzle connector clearance (mm)',
    'Wird bei der Druckerauswahl gesetzt: kürzere Bettseite minus 16 mm Rand (X1C/P1: 236 mm wegen der gesperrten Ecke vorne links).':
      'Set by the printer choice: shorter bed side minus a 16 mm margin (X1C/P1: 236 mm because of the excluded front-left corner).',
    'Deine Einstellungen werden in diesem Browser gespeichert.': 'Your settings are saved in this browser.',
    'Einstellungen zurücksetzen': 'Reset settings',
    '3MF für Bambu Studio, jede Kachel auf eigener Platte': '3MF for Bambu Studio, each tile on its own plate',
    'STL (ZIP bei mehreren Kacheln)': 'STL (ZIP for several tiles)',
    'Exportieren': 'Export',
    'Noch kein Bild geladen.': 'No image loaded yet.',
    'Original überlagern': 'Overlay original',
    'Schablone': 'Stencil',
    'Öffnung (malen)': 'Opening (paint)',
    'entfällt (zu schmal)': 'dropped (too narrow)',
    'verbreitert': 'widened',
    'Haltesteg': 'Holding bridge',
    'Bild wird angepasst …': 'Adjusting image …',
    'Lade ein Bild, um die Vorschau zu sehen.': 'Load an image to see the preview.',
    'Stege bearbeiten:': 'Edit bridges:',
    'Klick auf einen roten Steg setzt ihn an die nächstbeste Stelle. Ziehen von Kante zu Kante setzt einen eigenen Steg, ein Klick darauf entfernt ihn wieder.':
      'Click a red bridge to move it to the next best spot. Drag from edge to edge to add your own bridge; click it to remove it again.',
    'Stege zurücksetzen': 'Reset bridges',
    'Tipp für Bambu Studio: Schichthöhe 0,2 mm, erste Schicht 0,2 mm. Die Kacheln stecken mit den Puzzle-Verbindern zusammen.':
      'Tip for Bambu Studio: 0.2 mm layer height, 0.2 mm first layer. The tiles snap together with the puzzle connectors.',
    'Quellcode': 'Source code',
    'Erzeugt aus einem Bild eine 3D-druckbare Schablone zum Nachmalen, für Fenster, Papier, Wände, Stoff und mehr.':
      'Turns an image into a 3D-printable stencil for tracing on windows, paper, walls, fabric and more.',
  };
  const ATTRS = ['title', 'aria-label', 'placeholder', 'content'];

  let lang = 'de';
  try { if (localStorage.getItem(STORE) === 'en') lang = 'en'; } catch (e) { /* egal */ }

  const origText = new WeakMap(); // Textknoten -> deutscher Text
  const origAttr = new WeakMap(); // Element -> { attr: deutscher Wert }

  function swap(de) {
    if (lang === 'de') return de;
    const key = de.trim().replace(/\s+/g, ' ');
    const en = EN[key];
    return en === undefined ? de : de.replace(de.trim(), en);
  }

  function translatePage() {
    document.documentElement.lang = lang;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.nodeValue.trim() || n.parentElement.closest('script, style, [data-no-i18n]')) continue;
      if (!origText.has(n)) {
        // Nur Texte aus der Tabelle merken; was app.js später setzt, bleibt unberührt
        if (EN[n.nodeValue.trim().replace(/\s+/g, ' ')] === undefined) continue;
        origText.set(n, n.nodeValue);
      }
      n.nodeValue = swap(origText.get(n));
    }
    for (const el of document.querySelectorAll('[title], [aria-label], [placeholder], meta[name=description]')) {
      if (el.closest('[data-no-i18n]')) continue;
      let o = origAttr.get(el);
      if (!o) {
        o = {};
        for (const a of ATTRS) if (el.hasAttribute(a) && EN[el.getAttribute(a)] !== undefined) o[a] = el.getAttribute(a);
        origAttr.set(el, o);
      }
      for (const a in o) el.setAttribute(a, swap(o[a]));
    }
    document.title = 'Stencilio Print';
    document.querySelectorAll('.lang button[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  }

  const listeners = [];
  window.I18N = {
    get lang() { return lang; },
    tr: (de, en) => (lang === 'en' ? en : de),
    onChange: (fn) => listeners.push(fn),
    set(l) {
      lang = l === 'en' ? 'en' : 'de';
      try { localStorage.setItem(STORE, lang); } catch (e) { /* egal */ }
      translatePage();
      listeners.forEach((fn) => fn(lang));
    },
  };

  document.querySelectorAll('.lang button[data-lang]').forEach((b) => b.addEventListener('click', () => I18N.set(b.dataset.lang)));
  translatePage();
})();
