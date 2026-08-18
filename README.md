# Accessibility-Checker

Lokales Prüfwerkzeug für digitale Barrierefreiheit nach **WCAG 2.1 Level AA**, umschaltbar auf WCAG 2.2.

Prüft Webseiten und Webanwendungen gegen alle Erfolgskriterien, zeigt je Kriterium einen von vier Status und liefert zu jedem Mangel eine konkrete Handlungsempfehlung. Läuft vollständig auf dem eigenen Rechner — geprüfte Inhalte verlassen ihn nicht.

## Stand

**Phase 2 abgeschlossen — das Werkzeug ist nutzbar.** Adresse eingeben, Prüfung starten, Ergebnis lesen. Je Kriterium gibt es Status, Fundstellen und eine Handlungsempfehlung mit Code-Beispiel.

```bash
npm run einrichten       # einmalig
npm run build
npm start                # http://127.0.0.1:3000
```

Oder ohne Oberfläche, direkt auf der Befehlszeile:

```bash
npm run scan -- https://example.org
npm run scan -- https://example.org --standard 2.2 --ausfuehrlich --speichern
```

Die Oberfläche prüft sich selbst: `npm run pruefe:selbst` lässt den eigenen Scanner über alle drei Ansichten laufen.

Noch nicht gebaut: weitere Prüf-Engines (Phase 3), Sprachmodell-Stufe (Phase 4), geführte manuelle Liste (Phase 5), Prüfprofile und Crawl (Phase 6), Bericht (Phase 7). Kriterien, die davon abhängen, tragen bis dahin `Prüfung erforderlich` — sie verschwinden nicht und gelten nie als erfüllt.

## Was das Werkzeug können soll

| | |
|---|---|
| **Prüfumfang** | Einzelseite · gespeichertes Prüfprofil · Gesamtprüfung per Crawl |
| **Geschützte Bereiche** | ja — Anmeldung erfolgt durch den Menschen im sichtbaren Browserfenster |
| **Prüfstufen** | automatisch · lokales Sprachmodell · geführt manuell |
| **Abdeckung** | rund 85 % der Kriterien belastbar bewertet, ohne Sprachmodell rund 60 % |
| **Bericht** | Aufbau nach WCAG-EM, Bewertungssprache nach VPAT 2.5 / ACR, auf Deutsch |
| **Betriebssysteme** | Windows, macOS, Linux |

## Die vier Status

| | |
|---|---|
| ✅ **erfüllt** | Automatisch bestätigt, nichts offen |
| ❌ **nicht erfüllt** | Belegter Verstoß, mit Fundstelle und Empfehlung |
| ⚠️ **Prüfung erforderlich** | Modellhinweis oder offene manuelle Frage |
| ➖ **nicht anwendbar** | Auf dieser Seite gegenstandslos |

## Aufbau des Ordners

```
PRD.md              Was gebaut wird und warum — alle Entscheidungen samt Begründung
ARCHITEKTUR.md      Womit gebaut wird — Bibliotheken, Struktur, Datenbank, Ablaufregeln
CLAUDE.md           Arbeitsanweisung für die Umsetzung
ANLEITUNG-OLLAMA.md Sprachmodell einrichten und anbinden

katalog/          Der Prüfkatalog als Daten: 56 Kriterien, Schema, Pflegeanleitung
prompts/          Prompts der Sprachmodell-Stufe
src/              Server, Prüflogik, Datenbank
web/              Oberfläche
werkzeuge/        Prüfskripte und Befehlszeilenwerkzeuge
test/             Referenz- und Beispielseiten, Tests
daten/            Datenbank, Belege, Protokoll — nicht versioniert
```

## Befehle

| Befehl | Wofür |
|---|---|
| `npm run einrichten` | Abhängigkeiten und Chromium installieren |
| `npm run build` | Server und Oberfläche bauen |
| `npm start` | Werkzeug starten, `http://127.0.0.1:3000` |
| `npm run dev` | Entwicklungsbetrieb, Oberfläche auf `localhost:5173` |
| `npm run scan -- <URL>` | Prüfen ohne Oberfläche |
| `npm test` | Katalog, axe-Abgleich, Typen und Tests |
| `npm run pruefe:selbst` | Die eigene Oberfläche mit dem eigenen Werkzeug prüfen |
| `node werkzeuge/katalog-pruefen.mjs` | Katalog prüfen — läuft ohne Installation |

Der Katalog-Prüfer braucht nur Node und ist die schnellste Probe, ob die Grundlage unversehrt ist.

Die Bauabfolge steht in `ARCHITEKTUR.md` Abschnitt 9.

## Abgrenzung

Das Werkzeug ersetzt **keine** zertifizierte Prüfung. Für rechtsverbindliche Aussagen nach BFSG, BITV oder EN 301 549 ist weiterhin eine Prüfung durch qualifizierte Personen nötig. Es bereitet eine solche Prüfung vor, verkürzt sie erheblich und deckt den Großteil der Mängel vorab auf.

Solange Kriterien den Status ⚠️ tragen, ist der Bericht ausdrücklich ein Entwurf. Ungeprüfte Kriterien werden nie als konform ausgegeben.
