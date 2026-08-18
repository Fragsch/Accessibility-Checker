# Accessibility-Checker

Lokales Prüfwerkzeug für digitale Barrierefreiheit nach WCAG 2.1 (umschaltbar auf 2.2), Level AA.
**Alles auf Deutsch** — Code-Bezeichner, Kommentare, Oberfläche, Berichte.

## Vor der Arbeit lesen

| Datei | Wofür |
|---|---|
| `PRD.md` | Was gebaut wird und warum. Alle Entscheidungen samt Begründung |
| `ARCHITEKTUR.md` | Womit gebaut wird. Bibliotheken, Ordnerstruktur, Datenbankschema, Ablaufregeln |
| `katalog/README.md` | Aufbau des Prüfkatalogs |
| `prompts/stufe2.md` | Prompts der Sprachmodell-Stufe |
| `ANLEITUNG-OLLAMA.md` | Einrichtung und Anbindung von Ollama — vor Phase 4 lesen |
| `werkzeuge/katalog-pruefen.mjs` | Lauffähiger Katalog-Prüfer, ohne Abhängigkeiten |

Bei Widersprüchen gilt: `PRD.md` schlägt `ARCHITEKTUR.md` schlägt Code.

## Das Werkzeug in fünf Sätzen

Es prüft Webseiten gegen die Erfolgskriterien der WCAG und zeigt je Kriterium einen von vier Status an. Geprüft wird in drei Stufen: automatisch über Prüf-Engines, textbewertend über ein lokales Sprachmodell, und über gezielte Fragen an den Menschen. Prüfumfang ist wahlweise eine Einzelseite, ein gespeichertes Prüfprofil aus mehreren Seiten oder ein Crawl über die Domain. Ergebnis ist eine Übersicht mit Handlungsempfehlungen und ein Bericht nach WCAG-EM mit ACR-Bewertungssprache. Alles läuft lokal, ohne Datenabfluss.

## Die vier Status

| Status | Bedeutung |
|---|---|
| `erfuellt` | Automatisch bestätigt, nichts offen |
| `nicht_erfuellt` | Belegter Verstoß |
| `pruefung_erforderlich` | Modellhinweis oder offene manuelle Frage |
| `nicht_anwendbar` | Auf dieser Seite gegenstandslos |

Ableitungsregeln stehen in `ARCHITEKTUR.md` 5.2 bis 5.4 und sind **bindend**.

## Befehle

```bash
npm install              # Abhängigkeiten
npx playwright install chromium
npm run dev              # Entwicklung, Oberfläche auf localhost:5173
npm run build
npm start                # Werkzeug starten
npm test                 # Tests
npm run axe:abgleich     # Katalog-Regel-IDs gegen installiertes axe-core prüfen

node werkzeuge/katalog-pruefen.mjs   # Katalog prüfen — läuft ohne Abhängigkeiten
```

`werkzeuge/katalog-pruefen.mjs` ist bereits vorhanden und lauffähig. Binden Sie es als `npm run katalog:pruefen` ein und lassen Sie es im Testlauf mitlaufen.

## Neun Regeln, die nicht gebrochen werden

1. **Der Prüfkatalog bleibt Daten.** Keine Kriterien, Regelzuordnungen oder Empfehlungstexte im Code. Änderungen gehen in `katalog/*.json`.
2. **Keine Zugangsdaten.** Nie erfassen, nie speichern, nie in Formulare eintragen. Die Anmeldung macht der Mensch im sichtbaren Browserfenster.
3. **Kein Cloud-Dienst als Voreinstellung.** Ollama lokal ist Standard.
4. **`pruefung_erforderlich` wird nie als konform ausgegeben.** Solange offene Kriterien bestehen, ist der Bericht ein Entwurf.
5. **Keine Java-, Python- oder sonstige Fremdlaufzeit.** Nur Node.
6. **Kein UI-Framework mit fremden Komponenten.** Die eigene Oberfläche muss WCAG 2.1 AA erfüllen und wird am Ende selbst geprüft.
7. **Stufe 2 ist optional.** Das Werkzeug muss ohne Sprachmodell vollständig nutzbar bleiben. Betroffene Kriterien wandern dann in die manuelle Liste — sie verschwinden nicht.
8. **Ein Engine-Befund ohne Katalogzuordnung wird protokolliert und verworfen.** Nie raten.
9. **Sprachmodell-Aufrufe immer gebündelt, immer mit erzwungenem JSON-Schema, Temperatur 0.**

## Reihenfolge der Umsetzung

Die Phasen aus `PRD.md` Abschnitt 9 sind bindend. Aktueller Stand: **Phase 1 bis 3 abgeschlossen**.

| Phase | Stand | Wo |
|---|---|---|
| 1 | ✓ Erster vollständiger Scan | `src/katalog/`, `src/scan/`, `src/db/` |
| 2 | ✓ Server und Oberfläche | `src/server/`, `web/` |
| 3 | ✓ Automatik ausgereizt — sechs Engines, 124 Regeln | `src/stufe1/` |
| 4 | ✓ Sprachmodell-Stufe über Ollama, optional zuschaltbar | `src/stufe2/` |

**Als Nächstes Phase 5:** die geführte manuelle Prüfliste mit Persistenz. Die Anschlussstellen stehen: `OffeneFrage` in `src/typen/`, die Tabelle `manuelle_antwort` in `src/db/schema.sql`, und die Routen `GET /api/scan/:id/fragen` und `POST /api/scan/:id/antwort` antworten heute mit 501.

### Vier Regeln aus Phase 3 und 4, die weitergelten

### Drei Regeln aus Phase 3, die weitergelten

1. **Kein `tsx` in einem Pfad, der einen Browser steuert.** esbuild baut `__name()` in benannte Funktionen ein; im Browser gibt es das nicht, und jeder `page.evaluate`-Aufruf scheitert stumm. Tests und Befehlszeile laufen über den kompilierten Stand.
2. **Nach jeder Änderung an einer Engine: `npm run verifikation`.** Sie misst gegen `test/referenzseiten/soll.json`. Zwei Zahlen zählen — *übersehen* muss 0 bleiben, *Fehlalarme* müssen 0 bleiben.
3. **Nach jeder Änderung an der Oberfläche: `npm run pruefe:selbst`.** Der eigene Scanner läuft über alle drei Ansichten.
4. **Ein Urteil des Sprachmodells ist nie ein Verstoß.** `problem` und `unsicher` führen beide zu `pruefung_erforderlich`, niemals zu `nicht_erfuellt` (L-25). Wer das ändert, stellt Feststellungen in den Bericht, die niemand geprüft hat.

## Wichtig beim Einstieg

**Die axe-Regel-IDs im Katalog sind ein geprüfter Ausgangspunkt, keine garantierte Endfassung.** axe-core benennt Regeln zwischen Versionen gelegentlich um. Bauen Sie früh `npm run axe:abgleich`: Regeln über `axe.getRules()` auslesen, gegen den Katalog abgleichen, Abweichungen in beide Richtungen als Warnung melden. Der Abgleich läuft als Test mit.

**Der Katalog enthält 56 Kriterien.** 50 gelten unter WCAG 2.1, 55 unter WCAG 2.2 — der gewählte Standard wirkt als Filter über die Vermerke `standard.eingefuehrtMit` und `standard.entfallenAb`. 4.1.1 ist das einzige Kriterium, das in 2.2 entfällt.

**Alle Engines der Stufe 1 sind seit Phase 3 gebaut:** `axe`, `html`, `sprache`, `pixel`, `ocr`, `eigen`. Die im Schema noch zulässige Engine `ibm` wird nicht verwendet — die Begründung steht in `ARCHITEKTUR.md` 2. Prüfungen mit `typ: "llm"` gehören zu Phase 4; sie erzeugen bis dahin einen Hinweis und damit `pruefung_erforderlich`. Das ist richtig so und darf nicht durch ein vorschnelles `erfuellt` ersetzt werden.

## Sprache im Code

Bezeichner auf Deutsch, ohne Umlaute in Bezeichnern:

```ts
// so
const kriterium = katalog.findeKriterium('1.1.1');
function leiteStatusAb(befunde: Befund[]): Status { … }
type Pruefstufe = 'auto' | 'llm' | 'manuell';

// nicht so
const criterion = catalog.findCriterion('1.1.1');
function deriveStatus(findings: Finding[]): Status { … }
```

In Anzeigetexten, Kommentaren und Berichten werden Umlaute normal geschrieben.

## Wann nachfragen

Fragen Sie den Nutzer, statt selbst zu entscheiden, wenn:

- eine der neun Regeln im Weg steht und es keinen offensichtlichen Weg drumherum gibt
- eine Bibliothek aus `ARCHITEKTUR.md` sich als ungeeignet erweist
- der Katalog inhaltlich falsch erscheint — eine falsche Zuordnung ist schlimmer als eine fehlende
- eine Anforderung aus dem PRD unklar oder in sich widersprüchlich ist

Nicht nachfragen bei üblichen Umsetzungsdetails — dort entscheiden und weitermachen.
