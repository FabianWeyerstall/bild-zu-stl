# Stencilio Print

Stencilio Print macht aus einem Bild eine **Schablone für den 3D-Drucker**. Die Schablone wird aufgelegt und nachgemalt: mit Kreidemarker am Fenster, Filzstift auf Papier, Farbe an der Wand, Textilstift auf Stoff und vielem mehr.

**👉 App öffnen: https://fabianweyerstall.github.io/stencilio-print/**

Kostenlos, ohne Konto. Alles läuft im Browser, deine Bilder werden nirgendwo hochgeladen. Deutsch und Englisch.

## Wofür?

- Fensterbilder mit Kreidemarker für Halloween, Weihnachten, Ostern oder den Geburtstag
- Malvorlagen für Kinder: mit Filz- oder Buntstift aufs Papier übertragen und ausmalen
- Buchstaben, Zahlen und Formen zum Nachfahren
- Wandmotive und Bordüren mit Acrylfarbe, Schwamm oder Sprühdose
- T-Shirts, Taschen und Kissen mit Textilstift oder Stoffmalfarbe
- Holzschilder, Grußkarten, Geschenkpapier, Party- und Hochzeitsdeko
- Straßenkreide-Bilder und Vorlagen zum Kürbisschnitzen

## So funktioniert's

1. **Bild** hochladen (PNG, JPG, …) oder ein Beispielmotiv wählen. Dunkle Bereiche werden zu Öffnungen, durch die gemalt wird (umkehrbar).
2. **Stift** wählen: Die Markerbreite (1, 3 oder 6 mm) bestimmt die kleinste Öffnung.
3. **Größe & Drucker** einstellen. Die App zeigt, wie viele Druckplatten das ergibt, und bietet Knöpfe für die größte Breite je Plattenzahl.
4. **Exportieren** und in Bambu Studio „Alle Platten slicen“, drucken.
5. Schablone auflegen, durchmalen, abziehen. Fertig.

## Funktionen

- **Öffnungen** schmaler als der Marker werden weggelassen oder auf Markerbreite verbreitert (einstellbar).
- **Stege** zwischen Öffnungen werden nicht schmaler als die Mindest-Stegbreite (Standard 2 mm).
- **Inseln** (z. B. das Innere eines „O“) bekommen automatisch einen kurzen, geraden Haltesteg zur nächstgelegenen Kante, genau einen pro Insel.
- **Ecken** werden abgerundet (Standard 1 mm), damit der Marker nirgends hängen bleibt, z. B. dort, wo ein Steg auf eine Linie trifft.
- **Kanten glätten** (Standard an): Die Konturen werden im Netz als glatte Kurven statt als Pixelstufen ausgegeben. Falls eine Kontur dabei nicht sauber schließt, nimmt die App für dieses Teil automatisch die Pixelkontur.
- **Leerer Rand** ums Motiv wird beim Laden automatisch abgeschnitten (abschaltbar), damit die Druckfläche fürs eigentliche Bild genutzt wird.
- **Malbarkeit:** Die App schätzt, wie viel vom Bild bei der gewählten Breite durch Markerbreite und Mindeststeg verändert wird. Plattenstufen, bei denen mehr als die Hälfte verloren ginge, sind gesperrt, und die App nennt die kleinste noch malbare Breite.
- **Einstellungen** werden im Browser gespeichert und beim nächsten Besuch wiederhergestellt („Einstellungen zurücksetzen“ unter „Erweitert“).
- **Übersichtlich:** Die Abschnitte links lassen sich per Klick auf die Überschrift einklappen, und die Vorschau bleibt beim Scrollen am Bildschirm stehen.
- **Deutsch/Englisch:** Oben rechts per Flagge umschalten (Standard Deutsch, die Wahl wird gemerkt). Texte stehen in `i18n.js`, Laufzeittexte in `app.js` über `tr(deutsch, englisch)`.
- **Anleitung:** Beim ersten Besuch erklärt ein Intro-Fenster, was die App macht, wie sie funktioniert und worauf man achten sollte. Über „Anleitung“ oben rechts lässt es sich jederzeit wieder öffnen.
- **Beispielbilder:** Unter „1. Bild“ gibt es zehn eigene Motive (Halloween, für Kinder, Sterne & Winter) zum Ausprobieren ohne eigenes Bild. Sie liegen in `examples/` und dürfen frei verwendet werden.
- **Breite Linien verschmälern** (Abschnitt 3, „Stift“): Wird ein Bild groß skaliert, werden auch seine Linien dick. Die App erkennt die übliche Linienstärke im Bild und zieht diese Linien auf Markerbreite + 0,5 mm zusammen. Deutlich dickere, ausgemalte Formen (Gesichter, Fledermäuse, Ringe) bleiben unverändert.
- **Stege bearbeiten:** Klick auf einen Steg setzt ihn an die nächstbeste Stelle, Ziehen von Kante zu Kante setzt einen eigenen Steg.
- **Klebelaschen** am Außenrand zum Festkleben mit Malerkrepp (optional, standardmäßig aus).
- **Große Bilder** werden in Kacheln aufgeteilt, die auf die Druckplatte passen (Drucker wählbar: X1C/X1E/P1S/P1P/P2S und A1 mit 256 × 256 mm, A1 mini mit 180 × 180 mm, H2S und H2D; die Kachel ist die kürzere Bettseite minus 16 mm, beim H2D zählt der Bereich beider Düsen). Die Schnitte werden dorthin gelegt, wo sie möglichst wenige Linien kreuzen. Die Kacheln haben Puzzle-Verbinder und werden als 3MF-Projekt (eine Platte pro Kachel) oder als ZIP mit einer STL pro Kachel exportiert.

Farben in der Vorschau: blau = Schablone, weiß = Öffnung, orange = entfällt weil zu schmal, grün = verbreitert, rot = Haltesteg.

## Drucken

- Höhe der Schablone: 0,6 mm empfohlen (stabiler), 0,4 mm geht auch. Das ist die Höhe des Druckteils, nicht die Düse; jede Düse passt. PLA oder PETG, keine Stützen.
- Auf der glatten PEI-Platte (Smooth Plate) gedruckt, haftet die glatte Unterseite meist ganz ohne Klebeband am Glas.
- Kacheln sind mit R (Reihe, von oben) und S (Spalte, von links) benannt. Jede Kachel trägt ihre Nummer als kleinen Ausschnitt, z. B. „1-2“ für Reihe 1, Spalte 2.
- Stift oder Farbe zuerst an einer unauffälligen Stelle testen.

## Entwicklung

Reines HTML/JavaScript ohne Build-Schritt. Die Kernlogik liegt in `stencil.js`, die Oberfläche in `app.js`.

```
node test/test.js   # prüft u. a., dass alle erzeugten Netze geschlossen sind
```

Verwendete Bibliotheken (im Ordner `vendor/`): [earcut](https://github.com/mapbox/earcut) (ISC) und [JSZip](https://github.com/Stuk/jszip) (MIT).

## Lizenz

MIT. Die Beispielmotive in `examples/` sind eigene Motive und dürfen frei verwendet werden. Verwende in der App nur Bilder, die du nutzen darfst.
