# Abnahme auf den drei Betriebssystemen

Grundlage von PRD Abschnitt 8.1 und NF-13. Das Werkzeug soll unter **Windows, macOS und Linux** laufen. Behauptet ist das schnell; belegt ist es erst, wenn der Abnahmelauf auf allen dreien einmal durchgelaufen ist.

```bash
npm run abnahme            # diesen Rechner prüfen und das Protokoll schreiben
npm run abnahme -- --zeigen   # nur zeigen, was bisher belegt ist
```

Der Lauf schreibt `<plattform>-<architektur>.json` in dieses Verzeichnis. **Diese Dateien werden versioniert** — sie sind der Beleg. Wer wissen will, ob das Werkzeug unter Windows je gelaufen ist, sieht nach, ob dort eine Datei liegt und was in ihr steht.

## Was geprüft wird

Von der Voraussetzung zum Erzeugnis — jede Stufe setzt die vorige voraus:

| | Probe | Warum plattformabhängig |
|---|---|---|
| 1 | Node-Laufzeit, Speicherorte beschreibbar | Rechte und Pfadtrennzeichen unterscheiden sich |
| 2 | Katalog, Prompts, Abdeckungsmatrix | Zeichenkodierung beim Lesen |
| 3 | Datenbank samt Schema | `better-sqlite3` ist nativ und braucht je Plattform eine eigene Binärdatei |
| 4 | Chromium startet und lädt eine Seite | Playwright lädt den Browser je Plattform selbst |
| 5 | Alle sechs Engines an einer echten Seite | Hier schlägt am meisten durch: `tesseract.js` lädt WebAssembly nach, die Pixelanalyse schreibt Bilddateien, und die Schriftmaße fallen je Betriebssystem anders aus |
| 6 | Bericht als HTML und PDF | Die PDF-Erzeugung läuft über Chromium; Zeilenumbruch und Schriftauswahl sind plattformabhängig |
| 7 | Hardware-Erkennung, Ollama | Einer der drei gekapselten Adapter; Apple Silicon ist ausdrücklich **nicht** wie „ohne Grafikkarte“ zu behandeln |

Genau eine Probe darf fehlschlagen, ohne die Abnahme zu kippen: **Ollama.** Stufe 2 ist optional, und ein Rechner ohne Sprachmodell ist ein vollständig brauchbarer Rechner. Die Abdeckungsmatrix darf ebenfalls fehlen — sie entsteht erst mit `npm run verifikation`.

## Stand

| Betriebssystem | Stand |
|---|---|
| macOS (arm64) | bestanden — siehe `darwin-arm64.json` |
| Windows | steht aus |
| Linux | steht aus |

Solange zwei Plattformen ausstehen, ist die Zusage „läuft unter Windows, macOS und Linux“ für diese Fassung **nicht belegt.** Der Lauf dauert wenige Minuten und braucht nur `npm run einrichten` davor.

## Wenn eine Probe fehlschlägt

Der Befund steht im Protokoll und in der Ausgabe. Die drei häufigsten Fälle:

- **Datenbank** — `better-sqlite3` hat keine vorgefertigte Binärdatei für diese Node-Fassung. Abhilfe: Node auf eine LTS-Fassung setzen oder `npm rebuild better-sqlite3`.
- **Chromium** — `npx playwright install chromium` wurde nicht ausgeführt. `npm run einrichten` erledigt beides.
- **Engines** — findet der Lauf auf `mangelhaft.html` deutlich weniger Verstöße als sonst, liegt das fast immer an fehlenden Schriften: Kontrast- und Zuschnittsmessungen brauchen eine gerenderte Seite. Unter Linux gehören die Basisschriften des Systems dazu.
