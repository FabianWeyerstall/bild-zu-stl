# Bild zu STL

Web-App, die aus einem Bild eine 3D-druckbare **Schablone** macht. Die Schablone wird auf Fenster oder Wand gelegt und mit einem Kreidemarker (1, 3 oder 6 mm) nachgemalt.

**App öffnen:** https://fabianweyerstall.github.io/bild-zu-stl/

Alles läuft im Browser, das Bild wird nirgendwo hochgeladen.

## So funktioniert's

1. Bild hochladen (PNG, JPG, …). Dunkle Bereiche werden zu Öffnungen, durch die gemalt wird (umkehrbar).
2. Breite in mm einstellen (Zahl oder Schieberegler), die Höhe folgt dem Seitenverhältnis. Die App zeigt, wie viele Druckplatten das ergibt, und bietet Knöpfe für die größte Breite je Plattenzahl. Optional einen Rand um das Bild.
3. Dicke (0,2, 0,4 oder 0,6 mm) und Markerbreite wählen.
4. Vorschau prüfen, dann **STL exportieren**.

Die App passt das Bild automatisch an:

- **Öffnungen** schmaler als der Marker werden weggelassen oder auf Markerbreite verbreitert (einstellbar).
- **Stege** zwischen Öffnungen werden nicht schmaler als die Mindest-Stegbreite (Standard 2 mm).
- **Inseln** (z. B. das Innere eines „O“) bekommen automatisch einen kurzen, geraden Haltesteg zur nächstgelegenen Kante, genau einen pro Insel.
- **Ecken** werden abgerundet (Standard 1 mm), damit der Marker nirgends hängen bleibt, z. B. dort, wo ein Steg auf eine Linie trifft.
- **Kanten glätten** (Standard an): Die Konturen werden im Netz als glatte Kurven statt als Pixelstufen ausgegeben. Falls eine Kontur dabei nicht sauber schließt, nimmt die App für dieses Teil automatisch die Pixelkontur.
- **Einstellungen** werden im Browser gespeichert und beim nächsten Besuch wiederhergestellt („Einstellungen zurücksetzen“ unter „Erweitert“).
- **Stege bearbeiten:** Klick auf einen Steg setzt ihn an die nächstbeste Stelle, Ziehen von Kante zu Kante setzt einen eigenen Steg.
- **Klebelaschen** am Außenrand zum Festkleben mit Malerkrepp (optional, standardmäßig aus).
- **Große Bilder** werden in Kacheln aufgeteilt, die auf die Druckplatte passen (Standard max. 240 mm, Bambu Lab X1C hat 256 × 256 mm). Die Schnitte werden dorthin gelegt, wo sie möglichst wenige Linien kreuzen. Die Kacheln haben Puzzle-Verbinder und kommen als ZIP mit einer STL pro Kachel, einer Übersicht und einer kurzen Anleitung.

Farben in der Vorschau: blau = Schablone, weiß = Öffnung, orange = entfällt weil zu schmal, grün = verbreitert, rot = Haltesteg.

## Drucken

In Bambu Studio die STL(s) öffnen, Schichthöhe 0,2 mm, keine Stützen. Kacheln sind mit R (Reihe, von oben) und S (Spalte, von links) benannt. Jede Kachel trägt ihre Nummer als kleinen Ausschnitt, z. B. „1-2“ für Reihe 1, Spalte 2.

## Entwicklung

Reines HTML/JavaScript ohne Build-Schritt. Die Kernlogik liegt in `stencil.js`, die Oberfläche in `app.js`.

```
node test/test.js   # prüft u. a., dass alle erzeugten Netze geschlossen sind
```

Export wahlweise als 3MF-Projekt für Bambu Studio (jede Kachel auf einer eigenen Platte) oder als STL bzw. ZIP mit STLs.

Verwendete Bibliotheken (im Ordner `vendor/`): [earcut](https://github.com/mapbox/earcut) (ISC) und [JSZip](https://github.com/Stuk/jszip) (MIT).
