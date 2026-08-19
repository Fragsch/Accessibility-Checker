# Accessibility-Checker

Lokales Prüfwerkzeug für digitale Barrierefreiheit nach **WCAG 2.1 Level AA**, umschaltbar auf WCAG 2.2.

Prüft Webseiten und Webanwendungen gegen alle Erfolgskriterien, zeigt je Kriterium einen von vier Status und liefert zu jedem Mangel eine konkrete Handlungsempfehlung. Läuft vollständig auf dem eigenen Rechner — geprüfte Inhalte verlassen ihn nicht.

## Stand

**Phase 8 abgeschlossen — die Genauigkeit ist gemessen, nicht behauptet.** Aus jeder Prüfung entsteht ein Bericht nach WCAG-EM mit der Bewertungssprache des ACR: als eigenständige HTML-Datei, als PDF, als EARL-Rohdaten für die maschinelle Weiterverarbeitung und als Entwurf der Erklärung zur Barrierefreiheit nach § 12b BGG. Dazu kommt eine Abdeckungsmatrix, die offenlegt, wo das Werkzeug zuverlässig ist und wo nicht.

```bash
npm run einrichten       # einmalig
npm run build
npm start                # http://127.0.0.1:3000
```

Der Prüfumfang ist wahlweise eine Einzelseite, ein gespeichertes Prüfprofil oder eine Gesamtprüfung per Crawl. Geschützte Bereiche sind prüfbar: Das Werkzeug öffnet ein sichtbares Browserfenster und wartet, bis Sie sich selbst angemeldet haben — Zugangsdaten sieht es dabei nie.

Was die Automatik und das Sprachmodell nicht entscheiden können, landet in einer geführten Prüfliste. Antworten bleiben je Adresse gespeichert; ein späterer Scan derselben Seite übernimmt sie, solange sich der Inhalt der betroffenen Stellen nicht geändert hat.

Die Sprachmodell-Stufe ist **abschaltbar und standardmäßig aus**; jedes ihrer unsicheren Urteile wandert samt Begründung in die Prüfliste. Einrichtung: `ANLEITUNG-OLLAMA.md`.

Gemessen an zwölf Referenzseiten und zwei mehrseitigen Angeboten: **81 % der eingebauten Verstöße belegt erkannt, kein einziger Fehlalarm, kein einziges übersehenes Kriterium.** 46 der 55 Kriterien haben einen Testfall; die übrigen neun haben keinen Automatikanteil, dort könnte eine Referenzseite nichts belegen. Nachzuvollziehen mit `npm run verifikation` — die Zahlen stehen in der Anwendung unter „Was dieses Werkzeug findet“ und im Methodikteil jedes Berichts.

Drei Dinge stehen aus und werden nicht verschwiegen:

- **Der Modellvergleich ist unvollständig.** Gemessen wurde bislang nur ein 3,8-B-Modell — mit dem Ergebnis, dass diese Größenordnung für Stufe 2 nicht genügt (32 % Trefferquote, 52 % „unsicher“). Ein 8-B- und ein 12–14-B-Modell fehlen; sie sind Downloads von mehreren Gigabyte und werden nicht ungefragt nachgeladen.
- **Die Abnahme lief bisher nur unter macOS.** Windows und Linux stehen aus; bis dahin ist „läuft auf drei Betriebssystemen“ für diese Fassung nicht belegt. `npm run abnahme` zeigt den Stand.
- **Die W3C Before-and-After-Demonstration** ist nicht eingebunden, weil die Verifikation wie das Werkzeug selbst ohne Netzzugriff läuft.

## Was das Werkzeug können soll

| | |
|---|---|
| **Prüfumfang** | Einzelseite · gespeichertes Prüfprofil · Gesamtprüfung per Crawl |
| **Geschützte Bereiche** | ja — Anmeldung erfolgt durch den Menschen im sichtbaren Browserfenster |
| **Prüfstufen** | automatisch · lokales Sprachmodell · geführt manuell |
| **Abdeckung** | gemessen: 46 von 55 Kriterien mit Testfall, 81 % der Verstöße belegt erkannt |
| **Bericht** | Aufbau nach WCAG-EM, Bewertungssprache nach VPAT 2.5 / ACR, auf Deutsch — als HTML, PDF, EARL und Entwurf der Erklärung zur Barrierefreiheit |
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

katalog/          Der Prüfkatalog als Daten: 56 Kriterien, Schema, gemessene Abdeckung
prompts/          Prompts der Sprachmodell-Stufe
src/              Server, Prüflogik, Datenbank
web/              Oberfläche
werkzeuge/        Prüfskripte und Befehlszeilenwerkzeuge
test/             Referenzseiten, Modellsatz, Abnahmeprotokolle, Tests
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
| `npm run verifikation` | Trefferquote und Fehlalarme messen, Abdeckungsmatrix schreiben |
| `npm run modellvergleich` | Sprachmodelle gegen den Testsatz messen (braucht Ollama) |
| `npm run abnahme` | Abnahme auf diesem Betriebssystem, siehe `test/abnahme/` |
| `node werkzeuge/katalog-pruefen.mjs` | Katalog prüfen — läuft ohne Installation |

Der Katalog-Prüfer braucht nur Node und ist die schnellste Probe, ob die Grundlage unversehrt ist.

Die Bauabfolge steht in `ARCHITEKTUR.md` Abschnitt 9.

## Abgrenzung

Das Werkzeug ersetzt **keine** zertifizierte Prüfung. Für rechtsverbindliche Aussagen nach BFSG, BITV oder EN 301 549 ist weiterhin eine Prüfung durch qualifizierte Personen nötig. Es bereitet eine solche Prüfung vor, verkürzt sie erheblich und deckt den Großteil der Mängel vorab auf.

Solange Kriterien den Status ⚠️ tragen, ist der Bericht ausdrücklich ein Entwurf. Ungeprüfte Kriterien werden nie als konform ausgegeben.

Der erzeugte Entwurf der **Erklärung zur Barrierefreiheit** ist ein Entwurf und nichts weiter. Sie ist eine rechtsverbindliche Aussage der veröffentlichenden Stelle; alles, was das Werkzeug nicht wissen kann, steht darin in eckigen Klammern und ist von einer verantwortlichen Person zu ergänzen.
