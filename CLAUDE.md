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
npm run verifikation     # gegen die Referenzseiten messen, Abdeckungsmatrix schreiben
npm run pruefe:selbst    # die eigene Oberfläche mit dem eigenen Werkzeug prüfen
npm run modellvergleich  # Sprachmodelle gegen test/modellsatz/ messen (braucht Ollama)
npm run abnahme          # Abnahme auf diesem Betriebssystem

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

Die Phasen aus `PRD.md` Abschnitt 9 sind bindend. Aktueller Stand: **Phase 1 bis 8 abgeschlossen**, mit drei benannten Rückständen bei der Abnahme.

| Phase | Stand | Wo |
|---|---|---|
| 1 | ✓ Erster vollständiger Scan | `src/katalog/`, `src/scan/`, `src/db/` |
| 2 | ✓ Server und Oberfläche | `src/server/`, `web/` |
| 3 | ✓ Automatik ausgereizt — sechs Engines, 124 Regeln | `src/stufe1/` |
| 4 | ✓ Sprachmodell-Stufe über Ollama, optional zuschaltbar | `src/stufe2/` |
| 5 | ✓ Geführte manuelle Prüfliste mit Persistenz | `src/stufe3/` |
| 6 | ✓ Mehrseitig und WebApp-fähig | `src/profil/`, `src/scan/crawl.ts`, `src/scan/anmeldung.ts`, `src/bericht/muster.ts` |
| 7 | ✓ Bericht nach WCAG-EM/ACR, PDF, EARL, Erklärung | `src/bericht/`, `web/bausteine/Berichtsansicht.tsx` |
| 8 | ✓ Verifikation, Abdeckungsmatrix, Modellvergleich, Abnahme | `werkzeuge/verifikation.ts`, `werkzeuge/modellvergleich.ts`, `werkzeuge/abnahme.ts`, `katalog/abdeckung.json` |

**Stand der Messung (Phase 8):** 12 Referenzseiten und 2 mehrseitige Gruppen, 46 der 55 Kriterien mit Testfall, **81 % der eingebauten Verstöße belegt erkannt, 0 übersehen, 0 Fehlalarme.** Die neun Kriterien ohne Testfall haben keinen Automatikanteil — dort könnte eine Referenzseite nichts belegen.

**Drei Rückstände, die offen benannt gehören:**

1. **Modellvergleich unvollständig.** Gemessen wurde nur phi4-mini (3,8 B) — das einzige lokal vorhandene Modell. Ergebnis: 32 % Trefferquote, 52 % `unsicher`, 10 durchgewunkene Verstöße. Damit ist belegt, dass diese Größenordnung für Stufe 2 nicht genügt. PRD 10.1 verlangt zusätzlich ein 8B-, ein 12–14B- und ein Cloud-Modell. Nach `ollama pull <modell>` misst `npm run modellvergleich` sie ohne weitere Änderung mit; für das Cloud-Modell fehlt ein zweiter Adapter.
2. **Abnahme nur auf macOS.** `npm run abnahme` ist gebaut und auf darwin/arm64 bestanden. Windows und Linux stehen aus; solange sie fehlen, ist NF-13 für diese Fassung nicht belegt.
3. **W3C Before-and-After und eine extern geprüfte Seite** sind nicht eingebunden — beide brauchen Netzzugriff, die Verifikation läuft wie das Werkzeug ohne Datenabfluss. Wer sie heranzieht, spiegelt sie lokal und trägt sie als weiteres Paar in `soll.json` ein.

**Keine Route antwortet mehr mit 501.** Die Schnittstelle aus `ARCHITEKTUR.md` 6 ist vollständig gebaut.

### Vierzehn Regeln aus Phase 3 bis 8, die weitergelten

1. **Kein `tsx` in einem Pfad, der einen Browser steuert.** esbuild baut `__name()` in benannte Funktionen ein; im Browser gibt es das nicht, und jeder `page.evaluate`-Aufruf scheitert stumm. Tests und Befehlszeile laufen über den kompilierten Stand.
2. **Nach jeder Änderung an einer Engine: `npm run verifikation`.** Sie misst gegen `test/referenzseiten/soll.json` und schreibt `katalog/abdeckung.json` neu. Zwei Zahlen zählen — *übersehen* muss 0 bleiben, *Fehlalarme* müssen 0 bleiben. Die erzeugte Matrix gehört in denselben Commit: Wer die Engine ändert und die alte Messung stehen lässt, behauptet eine Abdeckung, die nicht mehr gemessen ist.
3. **Nach jeder Änderung an der Oberfläche: `npm run pruefe:selbst`.** Der eigene Scanner läuft über alle elf Ansichten — seit Phase 7 gehören der erzeugte Bericht und der Entwurf der Erklärung dazu, seit Phase 8 die Abdeckungsmatrix. Neue Ansicht heißt: neuer Eintrag in `ANSICHTEN` in `werkzeuge/selbstpruefung.ts` — sonst wird sie nie geprüft. **Der Lauf schreibt nach `daten/selbstpruefung.db`, nicht in die Betriebsdatenbank**, und verwirft diese Datei zu Beginn jedes Laufs. Wer ein weiteres Werkzeug baut, das Scans anlegt, gibt `baueServer({ db })` mit — sonst landen dessen Läufe zwischen den Prüfungen des Menschen (`ARCHITEKTUR.md` 3).
4. **Ein Urteil des Sprachmodells ist nie ein Verstoß.** `problem` und `unsicher` führen beide zu `pruefung_erforderlich`, niemals zu `nicht_erfuellt` (L-25). Wer das ändert, stellt Feststellungen in den Bericht, die niemand geprüft hat. **Dasselbe gilt seither für die Engine `ocr`:** 1.4.5 nimmt Bilder aus, bei denen die bildliche Darstellung wesentlich ist — Logos, Wortmarken, Bildschirmfotos —, und ob ein Bild darunter fällt, sieht eine Texterkennung nicht. Sie legt vor, sie belegt nicht.
5. **Eine manuelle Antwort kann keinen belegten Verstoß wegräumen.** Sie kann hinzufügen, was die Automatik nicht sieht — nicht überstimmen, was diese belegt hat. Die Reihenfolge aus `ARCHITEKTUR.md` 5.2 bleibt bindend.
6. **Der angemeldete Browserkontext gehört der Anmeldung, nicht dem Scan.** `Browser.starten({ angemeldeterKontext })` startet keinen eigenen Browser und schließt den fremden Kontext nicht; je Seite wird nur die Seite geschlossen. Wer das umdreht, verliert die Sitzung nach der ersten Seite.
7. **Bei Sitzungsverlust wird angehalten, nicht weitergeprüft (S-05).** Sonst prüft das Werkzeug Anmeldemasken und meldet deren Mängel als Mängel der Anwendung — ein vollständig aussehendes, falsches Ergebnis.
8. **`beendet_am` wird geschrieben, bevor aufgeräumt wird.** Der Lauf steht zu diesem Zeitpunkt schon auf `fertig`; ein `await` davor reißt ein Fenster auf, in dem ein abgefragter Scan fertig ist, aber keinen Endzeitpunkt trägt.
9. **Alle vier Ausgabewege des Berichts speisen sich aus `src/bericht/daten.ts`.** Wer für eine Ausgabe direkt aus dem Scanergebnis rechnet, erzeugt Zahlen, die im PDF anders lauten als im HTML — und macht den Bericht als Aussage gegenüber Dritten wertlos.
10. **Die Konformitätstabelle entsteht aus dem Katalog, nicht aus der gespeicherten Verdichtung.** Sonst fehlt unter einem gewechselten Standard stillschweigend ein Kriterium, und im fertigen Bericht ist das nicht zu bemerken (X-19).
11. **Nach jeder Änderung an `src/bericht/html.ts`: `npm run pruefe:selbst`.** Der erzeugte Bericht ist ein Erzeugnis dieses Werkzeugs und wird von der Selbstprüfung mitgeprüft — ein Bericht über Barrierefreiheit, den ein Teil seiner Leser nicht lesen kann, widerlegt sich selbst.
12. **Eine gemessene Lücke schlägt jede andere Einstufung der Abdeckung.** Ein Kriterium, bei dem einmal etwas übersehen wurde, ist nicht „teilweise belegt", auch wenn neun andere Testfälle sauber liefen. Wer das aufweicht, baut eine Matrix, die genau dort beruhigend aussieht, wo ein Verstoß durchgewunken wurde.
13. **Neue Prüfung heißt neuer Testfall.** Eine Regel ohne Eintrag in `soll.json` ist unbelegt und erscheint in der Matrix zu Recht als „ungemessen". Umgekehrt gilt: Wer einen Fehlalarm abstellt, prüft an der sauberen Gegenprobe nach — nicht am Einzelfall.
14. **`unsicher` ist im Modellvergleich nie ein Sollwert.** Es ist eine Kenngröße für die anfallende Nacharbeit (L-23). Die schlechte Zahl ist das falsche `ok`: ein Verstoß, den das Modell durchwinkt. Wer `unsicher` als Soll zulässt, macht aus dem Ausweichen des Modells ein bestandenes Ergebnis.

## Wichtig beim Einstieg

**Die axe-Regel-IDs im Katalog sind ein geprüfter Ausgangspunkt, keine garantierte Endfassung.** axe-core benennt Regeln zwischen Versionen gelegentlich um. Bauen Sie früh `npm run axe:abgleich`: Regeln über `axe.getRules()` auslesen, gegen den Katalog abgleichen, Abweichungen in beide Richtungen als Warnung melden. Der Abgleich läuft als Test mit.

**Der Katalog enthält 56 Kriterien.** 50 gelten unter WCAG 2.1, 55 unter WCAG 2.2 — der gewählte Standard wirkt als Filter über die Vermerke `standard.eingefuehrtMit` und `standard.entfallenAb`. 4.1.1 ist das einzige Kriterium, das in 2.2 entfällt.

**Alle Engines der Stufe 1 sind seit Phase 3 gebaut:** `axe`, `html`, `sprache`, `pixel`, `ocr`, `eigen`. Die im Schema noch zulässige Engine `ibm` wird nicht verwendet — die Begründung steht in `ARCHITEKTUR.md` 2. Prüfungen mit `typ: "llm"` laufen seit Phase 4 über die Sprachmodell-Stufe; ist sie abgeschaltet oder Ollama nicht erreichbar, erzeugen sie einen Hinweis und damit `pruefung_erforderlich`. Das ist richtig so und darf nicht durch ein vorschnelles `erfuellt` ersetzt werden.

**Die Gestaltung liegt als SCSS in `web/stil/`.** Alle Stellschrauben — Farben, Typografie, Abstände, Radien, Schatten, Trefferflächen — stehen in `web/stil/_variablen.scss` und werden in `_wurzel.scss` als CSS-Eigenschaften ausgegeben. Die Bausteindateien enthalten **keine** eigenen Farbwerte. Hinter jeder Schriftfarbe steht ihr gemessenes Kontrastverhältnis; wer eine ändert, rechnet nach und lässt anschließend `npm run pruefe:selbst` laufen. Näheres in `ARCHITEKTUR.md` 7.1.

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
