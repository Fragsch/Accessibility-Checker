# Architektur und technische Festlegungen

**Bezug:** [PRD.md](./PRD.md) Version 2.0
**Zweck:** Dieses Dokument legt fest, *womit* gebaut wird. Das PRD legt fest, *was* und *warum*.

Wo das PRD eine Anforderung stellt, steht hier die technische Entscheidung dazu — verbindlich, damit sie nicht bei der Umsetzung neu erfunden wird.

---

## 1. Laufzeitumgebung

| Festlegung | Wert | Begründung |
|---|---|---|
| Laufzeit | **Node.js 24 LTS** | Aktuelles LTS, eingebautes Testframework, stabile ESM-Unterstützung |
| Sprache | **TypeScript 5.x**, `strict: true` | |
| Modulformat | **ESM** (`"type": "module"`) | |
| Paketmanager | **npm** | Ohne Zusatzinstallation vorhanden — relevant für NF-07 |
| Zielsysteme | Windows, macOS, Linux | NF-13 |

**Keine weitere Laufzeitumgebung.** Insbesondere kein Java, kein Python, keine systemweit zu installierenden Binärdateien (NF-14).

## 2. Bibliotheken

### Verbindliche Wahl

| Zweck | Paket | Anmerkung |
|---|---|---|
| Browsersteuerung | `playwright` | Nur Chromium wird geladen — spart ~500 MB |
| Prüf-Engine 1 | `axe-core` + `@axe-core/playwright` | Hauptquelle |
| ~~Prüf-Engine 2~~ | ~~`accessibility-checker` (IBM equal-access)~~ | **Gestrichen in Phase 3** — siehe unten |
| HTML-Gültigkeit | `html-validate` | **Reines JavaScript.** Ersetzt den Nu-Validator, der Java bräuchte |
| Spracherkennung | `franc-min` | Reines JavaScript. Nicht `cld3` (native Bindings) |
| Texterkennung | `tesseract.js` | WebAssembly, keine Systeminstallation |
| Bildauswertung | `sharp` | Vorgefertigte Binärdateien für alle drei Systeme |
| Backend | `fastify` | |
| Datenbank | `better-sqlite3` | Synchron, einfach, vorgefertigte Binärdateien |
| Oberfläche | `react` + `vite` | |
| Gestaltung | Eigenes CSS, **kein** UI-Framework | Barrierefreiheit muss kontrolliert werden (NF-01); fremde Komponenten bringen oft Verstöße mit |
| Sprachmodell | `ollama` (JS-Client) | |
| Validierung | `zod` | Schema für Modellantworten und Konfiguration |
| Tests | `node:test` + `playwright/test` | Eingebaut, keine zusätzliche Abhängigkeit |

### Installation

`package.json` führt bewusst **keine festen Versionsnummern**. Die Fassungen werden bei der Ersteinrichtung ermittelt, damit keine veralteten Angaben aus der Planung übernommen werden.

```bash
# Phase 1 und 2 — das Nötigste
npm install playwright axe-core @axe-core/playwright \
            fastify better-sqlite3 zod
npm install -D typescript @types/node

# Oberfläche
npm install react react-dom
npm install -D vite @vitejs/plugin-react @types/react @types/react-dom

# Phase 3 — weitere Prüfungen
npm install html-validate franc-min tesseract.js sharp @tesseract.js-data/deu

# Phase 4 — Sprachmodell
npm install ollama

npx playwright install chromium
```

Prüfen Sie nach der Installation die tatsächlichen Hauptversionen und halten Sie sie hier fest. Weicht eine Bibliothek grundlegend von dem ab, was hier beschrieben ist, ist das ein Fall für eine Rückfrage — siehe `CLAUDE.md`.

### Tatsächlich installiert (Stand Phase 1)

| Paket | Fassung | Anmerkung |
|---|---|---|
| Node.js | 24.18.1 | |
| `typescript` | 5.9.3 | Auf 5.x festgelegt. npm bietet inzwischen TypeScript 7 an — ein neu geschriebener Compiler, nicht bloß eine höhere Nummer. Wechsel nur bewusst |
| `playwright` | 1.62.x | |
| `axe-core` | 4.13.0 | 105 Regeln, davon 76 im Katalog zugeordnet |
| `@axe-core/playwright` | 4.13.x | Namentlich einbinden: `import { AxeBuilder }`. Der Vorgabe-Export lässt sich unter `verbatimModuleSyntax` nicht aufrufen |
| `better-sqlite3` | 13.0.3 | Braucht einen freigegebenen Installationsschritt, siehe unten |
| `fastify` | 5.12.x | ab Phase 2 in Gebrauch |
| `zod` | 4.4.x | |
| `@types/better-sqlite3` | 9.6.x | `better-sqlite3` bringt keine eigenen Typen mit |
| `html-validate` | 10.x | Ab Phase 3. Reines JavaScript, prüft den **Quelltext**, nicht das DOM |
| `franc-min` | 6.x | Ab Phase 3 |
| `tesseract.js` | 7.x | Ab Phase 3 |
| `@tesseract.js-data/deu` | 1.0.0 | **Notwendig.** Ohne dieses Paket lädt tesseract.js seine Sprachdaten aus dem Netz — ein Datenabfluss (NF-02) |
| `sharp` | 0.34.x | Ab Phase 3 |
| `ollama` | 0.6.x | Ab Phase 4. Der Adapter spricht die HTTP-Schnittstelle direkt an; das Paket liegt für den Cloud-Adapter bereit |
| ~~`zod-to-json-schema`~~ | — | **Nicht nötig.** Zod 4 erzeugt das Schema über `z.toJSONSchema()` |
| ~~`tsx`~~ | — | **Entfernt in Phase 3** — siehe unten |

**npm gibt Installationsskripte nicht mehr von selbst frei.** `better-sqlite3` und `esbuild` bauen beim Installieren native Teile. Ohne Freigabe bleiben sie unvollständig und brechen erst zur Laufzeit ab:

```bash
npm approve-scripts better-sqlite3 esbuild
```

Die Freigabe steht in `package.json` unter `allowScripts` und gilt damit auch auf anderen Rechnern.

**IBM equal-access ist gestrichen.** Das Paket `accessibility-checker` 4.0.30 hängt an `puppeteer` — das dieses Dokument unter „Ausdrücklich nicht verwenden" führt — und an `chromedriver` (16 MB, ein zweiter Browser-Unterbau neben Playwright). Sein `postinstall` startet `ibmtelemetry` und sendet an `www-api.ibm.com`, was der Zusage „läuft vollständig lokal" widerspricht. Der Nutzen wog das nicht auf: Der Katalog setzte IBM bei genau einem Kriterium ein (4.1.2), das axe dort mit 28 Regeln abdeckt. Die Prüfung ist aus dem Katalog entfernt, die Engine `ibm` bleibt im Schema zulässig.

**tsx darf keinen Browser steuern.** esbuild — und damit tsx — baut in benannte Funktionen einen Hilfsaufruf `__name()` ein. Der existiert im Browser nicht, und jeder `page.evaluate`-Aufruf mit einer inneren Funktion scheitert dort mit `ReferenceError: __name is not defined`. Da die Fehler abgefangen wurden, sah das aus wie „keine Beanstandung": **Prüfungen liefen ins Leere, ohne dass es auffiel.** Deshalb laufen Tests, Befehlszeile und Selbstprüfung seit Phase 3 ausschließlich über den kompilierten Stand (`node --run build:node` als Vorstufe). `tsx` ist entfernt. Was geprüft wird, ist damit dasselbe, was ausgeliefert wird.

**axe meldet auf Deutsch.** axe-core liefert unter `locales/de.json` eine Übersetzung mit. Sie wird beim Einspritzen über `axe.configure` gesetzt (`src/stufe1/axe.ts`), weil Befundtexte in Oberfläche und Bericht erscheinen und deutsch sein müssen (NF-05).

### Ausdrücklich nicht verwenden

| Nicht verwenden | Grund |
|---|---|
| Nu HTML Validator (`vnu.jar`) | Java-Abhängigkeit, verstößt gegen NF-14 |
| `cld3`, `node-tesseract-ocr` | Native Systemabhängigkeiten |
| Tailwind, Bootstrap, MUI u. ä. | Siehe NF-01; Barrierefreiheit der eigenen Oberfläche ist Abnahmekriterium |
| `puppeteer` | Playwright ist gesetzt |
| Jede Cloud-KI als Voreinstellung | NF-02; Cloud nur als ausdrücklich zu aktivierender Adapter |
| `accessibility-checker` (IBM equal-access) | Hängt an `puppeteer` und `chromedriver` und sendet beim Installieren Telemetrie an IBM — siehe unten |

## 3. Ordnerstruktur

Vorhandenes ist mit **✓** gekennzeichnet, alles Übrige entsteht beim Bau.

```
accessibility-checker/
├── README.md               ✓ Einstieg für Menschen
├── PRD.md                  ✓ Was und warum
├── ARCHITEKTUR.md          ✓ Womit — dieses Dokument
├── CLAUDE.md               ✓ Arbeitsanweisung
├── ANLEITUNG-OLLAMA.md     ✓ Sprachmodell einrichten und anbinden
├── package.json            ✓ Skripte; Abhängigkeiten bei Einrichtung ergänzen
├── tsconfig.json           ✓
├── .gitignore              ✓ schließt Betriebsdaten und Belege aus
│
├── katalog/                ✓ Prüfkatalog als Daten, kein Code
│   ├── README.md           ✓
│   ├── schema.json         ✓
│   ├── 1-wahrnehmbarkeit.json    ✓ 20 Kriterien
│   ├── 2-bedienbarkeit.json      ✓ 20 Kriterien
│   ├── 3-verstaendlichkeit.json  ✓ 13 Kriterien
│   ├── 4-robustheit.json         ✓  3 Kriterien
│   └── abdeckung.json      ✓ gemessene Abdeckung — erzeugt, aber versioniert
│
├── prompts/
│   └── stufe2.md           ✓ 11 Klassifikationsprompts
│
├── werkzeuge/
│   ├── katalog-pruefen.mjs ✓ lauffähig, ohne Abhängigkeiten
│   ├── axe-abgleich.mjs    ✓ lauffähig, sobald axe-core installiert ist
│   ├── beiwerk-kopieren.mjs ✓ kopiert SQL-Dateien nach dist/
│   ├── scan.ts             ✓ Scan von der Befehlszeile
│   ├── selbstpruefung.ts   ✓ prüft die eigene Oberfläche
│   ├── verifikation.ts     ✓ misst gegen test/referenzseiten/soll.json
│   ├── modellvergleich.ts  ✓ misst Modelle gegen test/modellsatz/ (10.1)
│   └── abnahme.ts          ✓ Abnahme je Betriebssystem (8.1, NF-13)
│
├── vite.config.ts          ✓ Bau der Oberfläche
├── tsconfig.web.json       ✓ eigene Typprüfung für den Browser-Teil
│
├── src/
│   ├── protokoll.ts        ✓ Technisches Protokoll (5.6)
│   ├── server/             ✓ Fastify, Routen
│   │   ├── index.ts        ✓
│   │   └── scanverwaltung.ts ✓ laufende Scans, Ereignisstrom
│   ├── katalog/            ✓ Laden, Validieren, Filtern nach Standard
│   │   ├── laden.ts        ✓
│   │   ├── abdeckung.ts    ✓ liest katalog/abdeckung.json (PRD 10)
│   │   └── schema.ts       ✓ Laufzeitschema, gespiegelt aus katalog/schema.json
│   ├── scan/
│   │   ├── runner.ts       ✓ Ablaufsteuerung eines Scans
│   │   ├── browser.ts      ✓ Playwright-Kapselung
│   │   ├── anwendbarkeit.ts ✓ Auswertung von anwendbarWenn (5.5)
│   │   ├── statusableitung.ts ✓ Status, Verdichtung, ACR (5.2–5.4)
│   │   ├── crawl.ts
│   │   └── anmeldung.ts        ← Übergabe an den Nutzer (6.1.1)
│   ├── stufe1/             ✓ Automatische Prüfungen
│   │   ├── engine.ts       ✓ Gemeinsamer Vertrag aller Engines
│   │   ├── index.ts        ✓ Verzeichnis, Ausführungsreihenfolge
│   │   ├── axe.ts          ✓
│   │   ├── html.ts         ✓ html-validate, prüft den Quelltext
│   │   ├── sprache.ts      ✓ franc-min
│   │   ├── ocr.ts          ✓ tesseract.js, Sprachdaten lokal
│   │   ├── pixel.ts        ✓ sharp, Kontrast auf Verlauf und Bild
│   │   ├── normalisierung.ts ✓ Zusammenführen, Entdoppeln, Zuordnen
│   │   └── eigen/          ✓ Was keine Bibliothek abdeckt: Verhalten
│   │       ├── index.ts    ✓
│   │       ├── dom.ts      ✓ 12 Regeln in einem Durchgang
│   │       ├── tastatur.ts ✓ Tab-Durchlauf vor und zurück
│   │       ├── darstellung.ts ✓ Reflow, Zoom, Textabstand
│   │       ├── formulare.ts ✓ Zustands-Traversierung (A-07)
│   │       └── mehrseitig.ts ✓ Vergleiche über Seiten hinweg
│   ├── stufe2/             ✓ Sprachmodell-Stufe
│   │   ├── adapter/
│   │   │   ├── typ.ts      ✓ Vertrag, austauschbar (L-27)
│   │   │   ├── ollama.ts   ✓
│   │   │   └── cloud.ts        ← optional, nach 1.0
│   │   ├── einrichtung.ts  ✓ Erkennung, Vorschlag, Messung (6.3.1)
│   │   ├── prompts.ts      ✓ liest prompts/stufe2.md
│   │   ├── sammler.ts      ✓ Elemente je Prompt
│   │   ├── vorfilter.ts    ✓ spart Modellaufrufe
│   │   ├── cache.ts        ✓ Inhaltshash (L-28)
│   │   └── pruefungen.ts   ✓ Ablauf
│   ├── stufe3/             ✓ Gefuehrte manuelle Pruefliste
│   │   ├── fragen.ts       ✓ Erzeugung, Kennung, Zusammenfassung (M-01, M-07)
│   │   ├── antworten.ts    ✓ Ablage je Adresse (M-03)
│   │   └── uebernahme.ts   ✓ Status nach einer Antwort neu ableiten
│   ├── bericht/            ✓ WCAG-EM/ACR-Erzeugung
│   │   ├── daten.ts        ✓ die sieben Abschnitte als Datenmodell
│   │   ├── html.ts         ✓ eigenständige HTML-Datei, zugleich Druckstil
│   │   ├── pdf.ts          ✓ derselbe Baum, gedruckt von Chromium
│   │   ├── earl.ts         ✓ Rohdaten im EARL-Vokabular (X-04)
│   │   ├── erklaerung.ts   ✓ Entwurf der Erklärung nach § 12b BGG (X-06)
│   │   └── muster.ts       ✓ Musterkennung und Seitenrangliste (E-24 bis E-26)
│   ├── db/
│   │   ├── index.ts        ✓ Öffnen, Migrationen
│   │   ├── scan-speichern.ts ✓
│   │   ├── schema.sql      ✓
│   │   └── migrationen/    ✓
│   ├── plattform/              ← Die drei gekapselten Adapter (8.1)
│   │   ├── ollama-installation.ts  ← entfällt: es wird nichts installiert (L-41)
│   │   ├── hardware.ts     ✓ Erkennung und Modellvorschlag (L-42)
│   │   └── pfade.ts        ✓
│   └── typen/              ✓ Gemeinsame TypeScript-Typen
│
├── web/                    ✓ React-Oberfläche
│   ├── App.tsx             ✓ Auftrag → Fortschritt → Ergebnis
│   ├── api.ts              ✓ Zugriff auf die Schnittstelle, SSE
│   ├── stil.css            ✓ eigenes CSS, kein Rahmenwerk
│   └── bausteine/          ✓
│
├── test/
│   ├── *.test.ts           ✓ Tests, laufen über `npm test`
│   ├── beispielseiten/     ✓ Kleine Seiten für einzelne Ablaufregeln
│   │   ├── ohne-medien.html ✓ für die Anwendbarkeitserkennung
│   │   └── verhalten.html  ✓ für die Prüfungen der Engine „eigen"
│   ├── referenzseiten/     ✓ 12 Seiten und 2 Gruppen mit bekannter Fehlerlage
│   ├── modellsatz/         ✓ Testsatz und Messergebnisse des Modellvergleichs
│   └── abnahme/            ✓ Abnahmeprotokolle je Betriebssystem
│
└── daten/                      ← Datenbank, Belege und Protokoll; nicht versioniert
```

## 4. Datenmodell

### 4.1 Gemeinsame Typen

```ts
type Standard = '2.1' | '2.2';
type Level = 'A' | 'AA';
type Prinzip = 'wahrnehmbarkeit' | 'bedienbarkeit'
             | 'verstaendlichkeit' | 'robustheit';

type Stufe = 'auto' | 'llm' | 'manuell';

type Status = 'erfuellt' | 'nicht_erfuellt'
            | 'pruefung_erforderlich' | 'nicht_anwendbar';

type AcrBewertung = 'unterstuetzt' | 'teilweise_unterstuetzt'
                  | 'unterstuetzt_nicht' | 'nicht_anwendbar'
                  | 'nicht_abschliessend_bewertet';
```

### 4.2 Datenbankschema

```sql
CREATE TABLE profil (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  standard      TEXT NOT NULL DEFAULT '2.1',   -- K-13
  viewports     TEXT NOT NULL,                  -- JSON-Array
  angelegt_am   TEXT NOT NULL
);

CREATE TABLE profil_seite (
  id            INTEGER PRIMARY KEY,
  profil_id     INTEGER NOT NULL REFERENCES profil(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,                  -- vollständig, S-30
  bezeichnung   TEXT NOT NULL,                  -- K-04
  zweck         TEXT,
  reihenfolge   INTEGER NOT NULL
);

CREATE TABLE scan (
  id                INTEGER PRIMARY KEY,
  profil_id         INTEGER REFERENCES profil(id) ON DELETE SET NULL,
  betriebsart       TEXT NOT NULL,              -- einzelseite | profil | gesamt
  standard          TEXT NOT NULL,
  gestartet_am      TEXT NOT NULL,
  beendet_am        TEXT,
  stufe2_aktiv      INTEGER NOT NULL,           -- L-46
  stufe2_modell     TEXT,
  geschuetzt        INTEGER NOT NULL DEFAULT 0, -- S-22
  werkzeug_version  TEXT NOT NULL
);

CREATE TABLE scan_seite (
  id            INTEGER PRIMARY KEY,
  scan_id       INTEGER NOT NULL REFERENCES scan(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  bezeichnung   TEXT,
  titel         TEXT,
  status        TEXT NOT NULL                   -- offen | fertig | fehler
);

CREATE TABLE bewertung (
  id              INTEGER PRIMARY KEY,
  scan_seite_id   INTEGER NOT NULL REFERENCES scan_seite(id) ON DELETE CASCADE,
  kriterium       TEXT NOT NULL,                -- "1.1.1"
  status          TEXT NOT NULL,
  herkunft        TEXT NOT NULL                 -- E-05: auto/llm/manuell + Engine
);

CREATE TABLE befund (
  id              INTEGER PRIMARY KEY,
  bewertung_id    INTEGER NOT NULL REFERENCES bewertung(id) ON DELETE CASCADE,
  selektor        TEXT,
  html_ausschnitt TEXT,
  screenshot      BLOB,
  beschreibung    TEXT NOT NULL,
  schwere         TEXT NOT NULL,
  muster_hash     TEXT                          -- E-25: Musterkennung
);

CREATE TABLE manuelle_antwort (
  id            INTEGER PRIMARY KEY,
  url           TEXT NOT NULL,
  kriterium     TEXT NOT NULL,
  frage_hash    TEXT NOT NULL,                  -- M-03: Wiederverwendung
  antwort       TEXT NOT NULL,
  notiz         TEXT,
  beantwortet_am TEXT NOT NULL,
  UNIQUE (url, kriterium, frage_hash)
);

CREATE TABLE llm_cache (
  inhalt_hash   TEXT PRIMARY KEY,               -- L-28
  pruefung      TEXT NOT NULL,
  modell        TEXT NOT NULL,
  urteil        TEXT NOT NULL,
  begruendung   TEXT,
  erzeugt_am    TEXT NOT NULL
);
```

Zwei Tabellen sind seither dazugekommen, beide über `src/db/migrationen/`:

- `hinweis` (siehe 5.6): „konnte nicht geprüft werden" gehört zur Bewertung, ist aber kein Befund.
- `qualitaetshinweis` (X-21, Fassung 2): ein Mangel, für den es im gewählten Standard **kein Erfolgskriterium mehr gibt**. Er hängt an der Seite und nicht an einer Bewertung — genau das ist seine Eigenschaft, und ein Fremdschlüssel auf `bewertung` würde sie verwischen.

## 5. Verbindliche Ablaufregeln

### 5.1 Zuordnung Engine-Befund → Erfolgskriterium

Engines melden Regelverstöße, das Werkzeug bewertet Erfolgskriterien. Die Zuordnung steht **im Katalog**, nicht im Code (NF-06). Ein Engine-Befund ohne Zuordnung im Katalog wird protokolliert und verworfen — nie geraten.

### 5.2 Statusableitung je Kriterium und Seite

```
1. Anwendbarkeitsbedingung ausgewertet → falsch?  → nicht_anwendbar
2. Mindestens ein automatischer Verstoß?          → nicht_erfuellt
3. Offene manuelle Frage oder LLM-Urteil
   "problem"/"unsicher"?                          → pruefung_erforderlich
4. Sonst                                          → erfuellt
```

Reihenfolge ist bindend. Ein automatischer Verstoß schlägt jedes andere Ergebnis.

### 5.3 Verdichtung auf Projektebene (E-21)

```
nicht_anwendbar        wenn auf allen Seiten nicht anwendbar
nicht_erfuellt         wenn auf mindestens einer Seite nicht erfüllt
pruefung_erforderlich  wenn sonst mindestens eine Seite offen ist
erfuellt               sonst
```

### 5.4 Abbildung auf die ACR-Bewertung (X-11, X-13)

```
erfuellt                                       → unterstuetzt
nicht_erfuellt, alle geprüften Vorkommen       → unterstuetzt_nicht
nicht_erfuellt, nur ein Teil betroffen         → teilweise_unterstuetzt
nicht_anwendbar                                → nicht_anwendbar
pruefung_erforderlich                          → nicht_abschliessend_bewertet
```

`pruefung_erforderlich` darf **niemals** auf `unterstuetzt` abgebildet werden (X-14).

### 5.5 Auswertung von `anwendbarWenn`

Das Katalogfeld `anwendbarWenn` ist ein CSS-Selektor. Die Auswertung ist bewusst einfach gehalten:

```
anwendbarWenn === null           → immer anwendbar
Selektor findet ≥ 1 Element      → anwendbar
Selektor findet 0 Elemente       → nicht_anwendbar
Selektor ist ungültig            → anwendbar, Warnung protokollieren
```

Ausgewertet wird im gerenderten DOM **nach** dem Laden und nach dem Ausführen von JavaScript — nicht im Quelltext. Elemente in `iframe`-Inhalten zählen mit, sofern zugänglich.

Bei mehrseitigen Scans gilt die Anwendbarkeit **je Seite**. Ein Kriterium ist auf Projektebene nur dann `nicht_anwendbar`, wenn es das auf allen Seiten ist (siehe 5.3).

Kriterien mit `nurMehrseitig: true` sind bei der Betriebsart Einzelseite grundsätzlich `nicht_anwendbar` — sie lassen sich an einer Seite allein nicht beurteilen. Betroffen sind 2.4.5, 3.2.3, 3.2.4 und 3.2.6.

### 5.6 Protokollierung und Fehlerbehandlung

**Drei Ebenen, klar getrennt:**

| Ebene | Wofür | Sichtbar |
|---|---|---|
| `befund` | Ergebnis einer Prüfung | in der Oberfläche |
| `hinweis` | Etwas konnte nicht geprüft werden | in der Oberfläche, beim Kriterium |
| `protokoll` | Technische Vorgänge | nur in der Protokolldatei |

**Grundsatz: Ein Fehler bei der Prüfung darf nie zu `erfuellt` führen.** Scheitert eine Prüfung — Zeitüberschreitung, Absturz der Engine, ungültige Modellantwort —, erhält das Kriterium `pruefung_erforderlich` mit einem `hinweis`, der den Grund nennt. Ein stiller Fehlschlag, der wie ein bestandener Test aussieht, ist der gefährlichste Zustand des Werkzeugs.

**Verbindlich zu protokollieren:**

- Jeder Engine-Befund ohne Katalogzuordnung, mit Regel-ID und Engine (Regel 8)
- Jeder ungültige Selektor aus `anwendbarWenn`
- Jede Modellantwort, die dem Schema nicht entspricht
- Jeder Abbruch einer Seitenprüfung samt Ursache

**Eine Seite, die nicht geladen werden kann,** bricht den Scan nicht ab. Sie erhält den Status `fehler`, der Scan läuft weiter, der Bericht führt sie unter den nicht geprüften Seiten auf.

### 5.7 Sprachmodell-Aufrufe

- Immer gebündelt, Richtwert 20 Elemente je Aufruf (L-05)
- Immer mit erzwungenem JSON-Schema über Ollamas `format`-Parameter (L-02)
- Antwort gegen `zod` prüfen; bei Schemaverstoß gilt das Ergebnis als `unsicher`, nicht als Fehler
- Vor jedem Aufruf `llm_cache` über den Inhaltshash befragen (L-28)
- `temperature: 0`
- **`num_ctx` ausdrücklich setzen** (8192 bei Bündeln von 20). Der Standardwert ist zu klein; eine Überschreitung schneidet die Anfrage stillschweigend ab, ohne Fehlermeldung
- **`keep_alive` setzen** (30 Minuten), sonst wird das Modell zwischen den Aufrufen entladen und muss jedes Mal neu geladen werden

Einrichtung, Modellwahl je Hardware, Adaptergerüst und Fallstricke stehen ausführlich in **`ANLEITUNG-OLLAMA.md`**.

## 5.8 Die Engines der Stufe 1

Alle Engines erfüllen denselben Vertrag (`src/stufe1/engine.ts`): Sie melden **Regelverstöße**, keine Erfolgskriterien. Welches Kriterium betroffen ist, entscheidet ausschließlich der Katalog (5.1).

| Engine | Bibliothek | Regeln | Deckt ab |
|---|---|---|---|
| `axe` | axe-core | 87 | Hauptquelle |
| `html` | html-validate | 6 | 4.1.1, 1.3.1 — Gültigkeit des **Quelltexts** |
| `sprache` | franc-min | 1 | 3.1.2 |
| `pixel` | sharp | 4 | 1.4.3, 1.4.11 auf Verläufen und Bildern |
| `ocr` | tesseract.js | 1 | 1.4.5 |
| `eigen` | — | 25 | Verhalten: Tastatur, Viewports, Formulare, Vergleiche |

**Die Reihenfolge ist bindend.** Zuerst laufen die Engines, die nur lesen; `eigen` kommt zuletzt. Der Tastatur-Durchlauf verschiebt den Fokus, die Formularprüfung löst Zustandsänderungen aus, die Darstellungsprüfung verändert den Viewport. Wer danach misst, prüft eine Seite, die das Werkzeug selbst umgebaut hat.

### Zwei Verfahren müssen sich einig sein

Bei 1.4.11 wird der Kontrast eines Bedienelements aus **Bildpunkten** gemessen *und* aus den **CSS-Werten** gerechnet. Ein Befund entsteht nur, wenn beide durchfallen. Grund: Eine Seite kann während des Scans ihre Höhe ändern, dann passen Bild und Koordinaten nicht mehr genau zusammen, und ein sauber umrandetes Eingabefeld fällt mit 1,00:1 durch. Was die Stilwerte für ausreichend halten, wird nicht gemeldet.

### Was nicht beurteilt werden konnte, bleibt offen

Die Spracherkennung braucht rund 120 Zeichen für ein belastbares Urteil. Findet sie auf einer Seite keinen einzigen ausreichend langen Abschnitt, entsteht ein **Hinweis** — nicht `erfuellt`. Dasselbe gilt für Bilder, die nicht geladen werden konnten (OCR), und für Formulare, die sich nicht gefahrlos absenden lassen. Diese Fälle sind bei der Verifikation aufgefallen: Ohne den Hinweis meldete das Werkzeug „erfüllt", obwohl nichts geprüft worden war.

### Grenzen, die bleiben

- **Kurze fremdsprachige Einschübe** (Zitate, Slogans, Fachbegriffe) erkennt keine statistische Spracherkennung verlässlich. Sie gehen als Hinweis in die manuelle Stufe.
- **Quelltext ist keine Sprache.** Codebeispiele werden von der Spracherkennung ausgenommen — sonst gelten sie reihenweise als französisch oder portugiesisch.
- **`title`-Attribute** werden bei 1.4.13 grundsätzlich beanstandet. Das ist streng, aber sachlich richtig: Der Browser-Tooltip lässt sich weder mit Escape schließen noch mit dem Zeiger erreichen.

## 5.9 Die Sprachmodell-Stufe

Aufbau je Prüfung: **sammeln → vorfiltern → Zwischenspeicher → bündeln → fragen → zuordnen.**

| Baustein | Datei | Zweck |
|---|---|---|
| Prompts | `src/stufe2/prompts.ts` | liest `prompts/stufe2.md`; die Prompts bleiben Daten |
| Adapter | `src/stufe2/adapter/` | austauschbar (L-27); Ollama ist der Standard |
| Sammler | `src/stufe2/sammler.ts` | holt je Prompt genau die Angaben, die seine Vorlage braucht |
| Vorfilter | `src/stufe2/vorfilter.ts` | entscheidet ohne Modell, was ohne Modell entscheidbar ist |
| Zwischenspeicher | `src/stufe2/cache.ts` | Inhaltshash über Prüfung, Inhalt und **Modellname** (L-28) |
| Ablauf | `src/stufe2/pruefungen.ts` | fügt es zusammen |
| Einrichtung | `src/stufe2/einrichtung.ts` | Erkennung, Modellvorschlag, Messung (L-40 bis L-45) |

### Ein „problem" ist kein Verstoß

Das ist die wichtigste Zusage der Stufe. Ein Modellurteil führt **nie** zu `nicht_erfuellt`, sondern immer zu `pruefung_erforderlich` (L-25). Stünde im Bericht eine Feststellung, die kein Mensch geprüft hat, wäre die Grundidee des Werkzeugs verletzt — und ein 3,8B-Modell ist dafür ohnehin die falsche Instanz.

### Was schiefgehen kann, geht nach „unsicher"

Kein Ollama, kaputtes JSON, Schemaverstoß, Zeitüberschreitung, ein vom Modell ausgelassener Index: In jedem dieser Fälle gilt das betroffene Element als `unsicher` und wandert in die manuelle Liste (L-23, L-26). Es gibt **keinen zweiten Versuch** — bei Temperatur 0 käme dasselbe heraus.

### Der Modellname gehört in den Hash

Ein anderes Modell urteilt anders. Ein Ergebnis von `phi4-mini` unter der Flagge von `phi4:14b` weiterzuverwenden wäre eine stille Fälschung — und machte den Modellvergleich in Phase 8 wertlos.

### Was nicht an das Modell geht

Ausschließlich Text. Keine Bilder, keine Screenshots. **Passwortfelder werden nicht eingesammelt**, und Feldwerte gehen nie mit — nur Beschriftungen (Regel 2, S-03).

## 5.10 Die geführte manuelle Prüfliste

| Baustein | Datei | Zweck |
|---|---|---|
| Fragen | `src/stufe3/fragen.ts` | Erzeugung samt Kontext, Kennung, Zusammenfassung |
| Antworten | `src/stufe3/antworten.ts` | Ablage je Adresse und Fragekennung |
| Übernahme | `src/stufe3/uebernahme.ts` | rechnet den Status nach einer Antwort neu |

### Die Fragekennung enthält den Kontext, aber nicht die Adresse

Beides ist Absicht.

**Ohne Adresse**, weil dieselbe Frage auf zwanzig Seiten dieselbe Frage ist. Nur so lassen sich gleichlautende Fragen zusammenfassen (M-07) — und eine Liste über 25 Seiten wird von unbearbeitbar zu erledigbar.

**Mit Kontext**, weil eine Antwort nur so lange gilt, wie sie sich auf denselben Inhalt bezieht. Ändert sich der Text, entsteht eine neue Kennung und die alte Antwort greift nicht mehr (M-04). Ein Urteil über einen Text, den es nicht mehr gibt, wäre schlimmer als gar keines.

### Eine Antwort kann die Automatik nicht überstimmen

Die Reihenfolge aus 5.2 bleibt unangetastet: **Ein belegter Verstoß schlägt alles.** Eine Antwort kann hinzufügen, was die Automatik nicht sieht — sie kann nichts wegräumen, was diese belegt hat. Wer einen Befund loswerden will, ändert die Seite.

Neu dazugekommen sind zwei Schritte zwischen Befund und offener Frage:

```
1. nicht anwendbar                                → nicht_anwendbar
2. mindestens ein automatischer Verstoss          → nicht_erfuellt
3. eine Antwort "nicht erfuellt"                  → nicht_erfuellt
4. alle Fragen mit "nicht anwendbar" beantwortet  → nicht_anwendbar
5. offene Frage, Hinweis, LLM "problem"/"unsicher"→ pruefung_erforderlich
6. sonst                                          → erfuellt
```

Eine gegebene Antwort zählt dabei als gelaufene Prüfung: Wer hingesehen und „erfüllt" gesagt hat, hat geprüft.

### Antworten wirken sofort

Nach jeder Antwort wird der Status neu abgeleitet, ohne neuen Scan. Ein Scan dauert Minuten, eine Antwort Sekunden; beides zu koppeln wäre der sicherste Weg, die Liste unbenutzbar zu machen.

## 6. Schnittstelle zwischen Oberfläche und Server

Fastify, JSON, kein Authentifizierungsverfahren — das Werkzeug lauscht nur auf `127.0.0.1`.

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/katalog?standard=2.1` | Kriterien des gewählten Standards |
| `GET` | `/api/abdeckung` | Gemessene Abdeckung je Kriterium (PRD 10) |
| `GET` | `/api/profile` | Prüfprofile auflisten |
| `GET` | `/api/profile/:id` | Ein Profil samt Austauschform (K-07) |
| `POST` | `/api/profile` | Profil anlegen |
| `POST` | `/api/profile/import` | Profil aus einer JSON-Datei übernehmen (K-07) |
| `PUT` | `/api/profile/:id` | Profil ändern |
| `DELETE` | `/api/profile/:id` | Profil löschen |
| `POST` | `/api/profile/vorschlag` | Crawl für die Seitenauswahl (K-06) |
| `POST` | `/api/scan` | Scan starten, liefert `scanId` |
| `GET` | `/api/scan/:id` | Ergebnis, Fortschritt, Status |
| `GET` | `/api/scan/:id/ereignisse` | **SSE** — Fortschritt und eintreffende Befunde |
| `POST` | `/api/scan/:id/abbrechen` | Laufenden Scan abbrechen (K-11) |
| `DELETE` | `/api/scan/:id` | Scan samt Belegen löschen (S-24) |
| `GET` | `/api/scan/:id/fragen` | Offene manuelle Fragen |
| `POST` | `/api/scan/:id/antwort` | Manuelle Frage beantworten |
| `GET` | `/api/scan/:id/projekt` | Projektebene, Muster und Seitenrangliste (E-20 bis E-26) |
| `GET` | `/api/scan/:id/anmeldung` | Wartet dieser Scan auf eine Anmeldung? (S-01) |
| `POST` | `/api/scan/:id/anmeldung-fertig` | Bestätigung nach der Anmeldung (S-02) |
| `GET` | `/api/adresse/bereinigt?url=…` | Adresse ohne Sitzungskennungen (S-07, S-33) |
| `GET` | `/api/scan/:id/bericht?format=html\|pdf\|earl\|erklaerung\|daten&umfang=projekt\|seite&url=…` | Bericht erzeugen |
| `GET` | `/api/system/hardware` | Erkannte Ausstattung, Modellvorschlag (L-42) |
| `GET` | `/api/system/ollama` | Zustand der Ollama-Installation (L-40) |
| `POST` | `/api/system/ollama/einrichten` | Geführte Einrichtung (L-41) |

### Stand nach Phase 2

Gebaut sind `GET /api/katalog`, `POST /api/scan`, `GET /api/scan/:id`, `GET /api/scan/:id/ereignisse`, `POST /api/scan/:id/abbrechen`, `DELETE /api/scan/:id` sowie ergänzend `GET /api/scans`.

Mit Phase 4 kamen `GET /api/system/hardware`, `GET /api/system/ollama` und `POST /api/system/ollama/einrichten` dazu, mit Phase 5 `GET /api/scan/:id/fragen`, `POST /api/scan/:id/antwort`, `DELETE /api/scan/:id/antwort` und ergänzend `GET /api/antworten`.

### Stand nach Phase 6

Gebaut sind alle Profil-Routen, `POST /api/profile/vorschlag`, `POST /api/scan/:id/anmeldung-fertig` sowie ergänzend `GET /api/profile/:id`, `POST /api/profile/import`, `GET /api/scan/:id/anmeldung`, `GET /api/scan/:id/projekt` und `GET /api/adresse/bereinigt`.

`POST /api/scan` nimmt seither drei Formen von Auftrag an: freie Adressen, `profilId` oder `crawl`. Beim Profil stammt der **Prüfstandard aus dem Profil** und überschreibt die Angabe im Auftrag (K-13). Mit `anmeldung: { url }` öffnet der Lauf zuerst ein sichtbares Browserfenster, meldet `anmeldung-noetig` und wartet auf `POST /api/scan/:id/anmeldung-fertig` (S-01, S-02).

Damit blieb als spätere Route nur noch `GET /api/scan/:id/bericht`; sie kam mit Phase 7. **Seither antwortet keine Route mehr mit 501.**

**Ein Umweg, der sich nicht gelohnt hätte:** Die Anmeldung zunächst als eigene Betriebsmittel-Route (`POST /api/anmeldung`, dann Übergabe der Kennung an den Scan) zu führen, erzeugte einen Zustand ohne Besitzer — ein offenes Browserfenster, zu dem kein Scan gehört. Am Scan aufgehängt stirbt die Sitzung mit ihm, und genau das verlangt S-04.

**Zwei Fallstricke, die Zeit gekostet haben:**

- Die Weiterleitung im Entwicklungsbetrieb muss auf `^/api/` verankert sein, nicht auf `/api`. Als bloßes Präfix fängt sie auch `web/api.ts` ab; der Browser bekommt dann HTML statt eines Moduls und die Oberfläche bleibt leer — ohne verwertbare Fehlermeldung.
- Die Datenbank kennt neben `befund` eine Tabelle `hinweis`. Abschnitt 4.2 führt sie nicht auf, 5.6 verlangt sie aber: „konnte nicht geprüft werden" muss in der Oberfläche beim Kriterium erscheinen. Ohne eigene Tabelle geht diese Ebene beim Speichern verloren.

**Server-Sent Events statt Abfrage im Takt.** Ein Scan läuft minutenlang, auf schwacher Hardware länger. Die Oberfläche muss Ergebnisse der Stufe 1 sofort zeigen und die der Stufe 2 nachreichen (NF-10) — das ist mit einem Ereignisstrom sauber lösbar und mit wiederholten Abfragen nicht.

Ereignistypen: `seite-begonnen`, `seite-fertig`, `befund`, `stufe-fertig`, `fortschritt`, `anmeldung-noetig`, `sitzung-verloren`, `fehler`, `fertig`.

### Stand nach Phase 7

`GET /api/scan/:id/bericht` ist gebaut. Sie nimmt drei Angaben: `format` (`html`, `pdf`, `earl`, `erklaerung`, `daten`), `umfang` (`projekt` oder `seite` samt `url`, X-05) und `person` für das Deckblatt.

**Ein Modell, vier Ausgaben.** `src/bericht/daten.ts` baut die sieben Abschnitte als Daten; HTML, PDF, EARL und der Entwurf der Erklärung greifen alle darauf zu. Vier Ausgabewege, die jeder für sich aus dem Scanergebnis rechnen, laufen unweigerlich auseinander — dann steht im PDF eine andere Zahl als in der HTML-Fassung, und der Bericht ist als Aussage gegenüber Dritten wertlos.

**Das PDF entsteht aus demselben HTML.** Chromium ist ohnehin installiert und druckt selbst; eine PDF-Bibliothek hieße eine zweite Schriftbehandlung und ein zweites Ergebnis bei gleichem Zweck. Der einzige Unterschied ist `alleAufgeklappt`: Gedruckt gibt es kein Aufklappen, und ein zugeklappter Abschnitt wäre im Druck verloren.

**Die Konformitätstabelle entsteht aus dem Katalog, nicht aus der gespeicherten Verdichtung.** Unter WCAG 2.2 müssen genau 55 Zeilen erscheinen — auch dort, wo keine Bewertung vorliegt, dann eben als „nicht abschließend bewertet" (X-19). Ein stillschweigend fehlendes Kriterium wäre im fertigen Bericht nicht zu bemerken.

**`format=daten` ist die Zugabe:** dasselbe Modell als JSON, damit die Oberfläche Kennzahlen und Vermerke anzeigen kann, ohne den ganzen Bericht zu erzeugen und wieder zu zerlegen.

**Ein laufender Scan liefert keinen Bericht** (409). Ein Zwischenstand sähe aus wie ein Ergebnis, und ein noch nicht geprüftes Kriterium wie ein erfülltes.

**Qualitätshinweise (X-21).** Unter WCAG 2.2 entfällt 4.1.1, und die Regeln zur HTML-Gültigkeit verlieren ihre Zuordnung. Sie werden trotzdem ausgeführt: `Katalog.qualitaetsRegeln(standard)` nennt die Regeln ohne Kriterium im gewählten Standard, der Runner hängt sie an die Anfrage an die Engine, und `normalisiere` gibt die verworfenen Rohbefunde heraus. Regel 8 bleibt unangetastet — zugeordnet wird nichts, die Befunde stehen außerhalb der Konformitätstabelle und ohne Einfluss auf die Bewertung. Unter 2.1 ist die Menge leer und am Ablauf ändert sich nichts.

**Drei Mängel im eigenen Erzeugnis, gefunden von der eigenen Prüfung:**

- Quelltextblöcke scrollen waagerecht und brauchen deshalb `tabindex="0"` (2.1.1). Ein `role="region"` dazu wäre falsch: Der Bericht enthält Dutzende davon, und jeder erschiene als eigene Landmarke mit gleichlautendem Namen (2.4.1).
- **Chromium meldet für Elemente in einem zugeklappten `details` weiterhin Maße.** Ein Verweis oder ein fokussierbarer Block darin sieht für jede Prüfung wie ein Sprung in der Lesereihenfolge aus (1.3.2). Das trifft nicht nur diesen Bericht: Aufklappbare Navigationen und FAQ-Listen sind Alltag. Der Sichtbarkeitstest in `src/stufe1/eigen/dom.ts` schließt diesen Fall jetzt aus — ein Fehlalarm, der auf jeder zweiten Seite gefeuert hätte.
- Adressen und Selektoren sind lange Zeichenfolgen ohne Leerzeichen. Ohne `overflow-wrap: break-word` sprengen sie bei 320 Pixeln die Seite (1.4.10).

### Stand nach Phase 8

`GET /api/abdeckung` ist gebaut. Sie liefert die gemessene Abdeckungsmatrix aus `katalog/abdeckung.json` — oder `matrix: null` samt Hinweis, wenn nie gemessen wurde. **Antwortet immer mit 200:** „nicht gemessen" ist kein Fehler, sondern eine Auskunft.

**Die Matrix ist erzeugt und trotzdem versioniert.** Beides ist Absicht. `npm run verifikation` schreibt sie; wer den Katalog ändert, ohne neu zu messen, sieht im Vergleich der Fassungen sofort, dass die Aussage über die Abdeckung veraltet ist. Fehlt die Datei, sagen Oberfläche und Bericht das ausdrücklich — eine unbelegte Zahl wäre schlimmer als keine.

**Eine gemessene Lücke schlägt jede andere Einstufung** (`leiteEinstufungAb`). Ein Kriterium, bei dem einmal etwas übersehen wurde, ist nicht „teilweise belegt" — es ist eine Lücke, auch wenn neun andere Testfälle sauber liefen. Wer das umdreht, bekommt eine Matrix, die genau dort beruhigend aussieht, wo ein Verstoß durchgewunken wurde.

**Die Zeilen der Matrix entstehen aus dem Katalog, nicht aus den Messungen.** Sonst fehlten genau die Kriterien, zu denen es keinen Testfall gibt — und über die eine Abdeckungsmatrix am dringendsten Auskunft geben muss. Dasselbe Muster wie X-19 bei der Konformitätstabelle, aus demselben Grund.

**Mehrseitige Kriterien brauchen mehrseitige Referenzen.** 2.4.5, 3.2.3 und 3.2.6 tragen `nurMehrseitig: true` und sind an einer Einzelseite zu Recht nicht anwendbar. `soll.json` kennt deshalb neben `seiten` auch `gruppen`: Eine Gruppe läuft als **ein** Scan über alle ihre Seiten, gemessen wird die Projektebene. Ohne diesen Teil stünden die drei in der Matrix als „ungemessen", obwohl das Werkzeug sie prüft.

**Vier Fehlalarme, gefunden durch die neuen Referenzseiten:**

- **Der Fokusring eines `<audio controls>` steckt im Schattenbaum des Browsers.** Von außen ändert sich kein einziger gerechneter Stil, und die Messung in `tastatur.ts` sieht nichts. Der Halt trägt jetzt `eigeneFokusanzeige` und wird bei 2.4.7 übersprungen — sonst hätte die Regel auf jeder Seite mit eingebautem Abspieler gefeuert.
- **`role="note"` ist die Auskunft, dass hier stehender Inhalt steht.** Erläuterungskästen heißen im Markup fast immer „meldung", „hinweis" oder „info"; ohne diese Ausnahme meldete die Regel zu 4.1.3 jeden einzelnen von ihnen. Gefunden an der eigenen Abdeckungsansicht.
- **„unvollständig" fehlte im Wortschatz der Fehlererkennung.** Die Referenzseite `fehlerempfehlung-sauber.html` meldet vorbildlich „Die Buchung ist unvollständig. So wird sie vollständig: …" — und wurde trotzdem als 3.3.1 geführt. Ein Fehlalarm, der ausgerechnet die saubere Lösung bestraft hätte.
- **Eine Drehung des ganzen `main` löst 1.4.4 mit aus.** Das ist kein Fehler des Werkzeugs, sondern der Referenzseite: Die Ausrichtungssperre steht jetzt auf einem kleinen Kasten. Ein Element, ein Verstoß — sonst ist die Messung nicht mehr eindeutig zuzuordnen.

**Der Modellvergleich benutzt denselben Prompt wie der Betrieb.** `werkzeuge/modellvergleich.ts` baut die Aufgabe mit `setzeEin` aus derselben Vorlage und hält die Bündelgröße des Prompts ein. Ein eigener, „sauberer" Prompt für die Messung wäre wertlos — gemessen wird, was die Anwendung tatsächlich fragt.

**`unsicher` ist nie ein Sollwert.** Es ist eine Kenngröße: Sie bestimmt, wie viel manuelle Nacharbeit anfällt (L-23). Die schlechte Zahl ist das **falsche `ok`** — ein Verstoß, den das Modell durchwinkt. Er wird gesondert ausgewiesen, aus demselben Grund wie „übersehen" bei den Referenzseiten: Beides sieht aus wie ein bestandener Test.

**Die Abnahmeprotokolle sind der Beleg für NF-13.** `werkzeuge/abnahme.ts` prüft die Stellen, an denen Plattformunterschiede tatsächlich durchschlagen — native Datenbankbibliothek, Chromium, nachgeladenes WebAssembly, Schriftmaße, PDF-Druck — und schreibt `test/abnahme/<plattform>-<architektur>.json`. Wer wissen will, ob das Werkzeug unter Windows je gelaufen ist, sieht nach, ob dort eine Datei liegt. Eine Zusage im Fließtext beweist nichts.

## 7. Barrierefreiheit der eigenen Oberfläche (NF-01)

Verbindlich von Anfang an, nicht nachträglich:

- Semantisches HTML vor ARIA
- Jede Funktion per Tastatur erreichbar, sichtbarer Fokus
- Kontrastverhältnis mindestens 4,5:1
- Statusmeldungen über `aria-live`
- Keine reine Farbcodierung — die vier Status tragen zusätzlich Form und Text
- Der eigene Scanner prüft die eigene Oberfläche als Teil der Abnahme in Phase 8

**Das Werkzeug dafür steht bereits:** `npm run pruefe:selbst` (`werkzeuge/selbstpruefung.ts`). Es bedient die Oberfläche, statt nur ihre Startadresse zu laden — Auftrag ausfüllen, Fehlermeldung erzwingen, Prüfung starten, alle Kriterien aufklappen — und misst in jedem dieser Zustände. Eine Prüfung der bloßen Startadresse sähe nur das Formular und damit den kleinsten Teil des Markups.

Der Lauf hat sich sofort bezahlt gemacht. Gefunden wurden:

- `<pre>`-Blöcke mit seitlichem Scrollen: ein scrollbarer Bereich muss mit der Tastatur erreichbar sein (2.1.1). Behoben durch Umbruch statt Scrollen — das hilft zugleich bei 1.4.10
- `aria-errormessage` ohne Möglichkeit, die Meldung anzusagen: wirkungslos ohne `role="alert"` (3.3.1)
- eine große, fette Zahl in einem Absatz, die axe als verkleidete Überschrift wertet (1.3.1). Behoben durch eine Definitionsliste — die richtige Auszeichnung für Begriff und Wert

Alle drei waren echte Mängel, keine Fehlalarme.

Mit Phase 8 kam die elfte Ansicht dazu: **„Was dieses Werkzeug findet"** — die Abdeckungsmatrix. Sie ist von der Auftragsansicht und vom Ergebnis aus erreichbar, weil sie beides betrifft: Wer eine Prüfung beauftragt, soll wissen, was sie leisten kann; wer ein Ergebnis liest, soll wissen, wie weit es trägt. Der dort gefundene Mangel — ein Erläuterungskasten ohne Live-Bereich — war ein Fehlalarm und hat die Regel zu 4.1.3 geschärft.

## 8. Bereits vorhandene Werkzeuge

Zwei Skripte in `werkzeuge/` liegen fertig vor und laufen ohne Projektabhängigkeiten:

| Skript | Zweck | Zustand |
|---|---|---|
| `katalog-pruefen.mjs` | Katalog gegen Schema und Sollzahlen prüfen, Prompt-IDs abgleichen | lauffähig, geprüft |
| `axe-abgleich.mjs` | Katalog-Regel-IDs gegen die installierte axe-core-Fassung abgleichen | lauffähig, wartet auf axe-core |

Beide sind in `package.json` als `npm run katalog:pruefen` und `npm run axe:abgleich` eingebunden und laufen über `npm test` mit.

**Der axe-Abgleich ist kein Nebenschauplatz.** Er prüft in beide Richtungen:

1. *Katalog → axe:* Eine Regel-ID im Katalog, die es in der installierten Fassung nicht gibt, führt zu einer stillschweigend ausgelassenen Prüfung. Das Kriterium erscheint dann als `erfuellt`, obwohl nichts geprüft wurde — der gefährlichste Fehlerfall überhaupt. **Beendet sich mit Code 1.**
2. *axe → Katalog:* Eine axe-Regel ohne Zuordnung erzeugt Befunde, die nach Regel 8 verworfen werden. Solche Regeln müssen entweder zugeordnet oder in `BEWUSST_OHNE_ZUORDNUNG` aufgenommen werden. **Nur Meldung, kein Abbruch.**

Solange axe-core nicht installiert ist, beendet sich das Skript mit Code 0 und einem Hinweis — es blockiert die Phasen vor Phase 1 also nicht.

## 9. Reihenfolge der Umsetzung

Die Phasen aus PRD Abschnitt 9 sind bindend. Innerhalb von Phase 0–2 gilt:

| # | Schritt | Fertig, wenn |
|---|---|---|
| 1 | `katalog/` einlesen und gegen `schema.json` validieren | `npm run katalog:pruefen` läuft grün |
| 2 | Typen aus Abschnitt 4.1 anlegen | `tsc` läuft ohne Fehler |
| 3 | Datenbankschema anlegen | Schema aus 4.2 angelegt, Migration vorhanden |
| 4 | Playwright-Kapselung, eine Seite laden | Eine URL wird gerendert, Screenshot entsteht |
| 5 | **axe-Abgleich einrichten** | `npm run axe:abgleich` läuft grün |
| 6 | axe-core anbinden, Befunde normalisieren, Kriterien zuordnen | Befunde tragen Kriteriums-IDs, nicht zuordenbare werden protokolliert |
| 7 | Anwendbarkeitserkennung nach 5.5 | Seite ohne Video meldet 1.2.x als `nicht_anwendbar` |
| 8 | Statusableitung nach 5.2 | Jedes Kriterium trägt genau einen der vier Status |
| 9 | Fastify-Routen nach Abschnitt 6 | `POST /api/scan` liefert ein vollständiges Ergebnis |
| 10 | Oberfläche: Übersicht → Detail → Empfehlung | Ein Mensch kann eine URL eingeben und das Ergebnis lesen |

**Schritt 5 kommt bewusst vor Schritt 6.** Erst wissen, welche Regeln es wirklich gibt — dann anbinden. Umgekehrt baut man auf Annahmen und merkt den Fehler erst, wenn Befunde ausbleiben.

**Nach Schritt 10 muss das Werkzeug eine echte Webseite prüfen und ein Ergebnis anzeigen können.** Alles Weitere ist Ausbau.

### Abnahme von Phase 1 und 2

Nicht „läuft durch“, sondern nachweisbar richtig:

- `test/referenzseiten/` wird geprüft, die Befunde entsprechen der dort hinterlegten Sollliste
- Eine echte Webseite wird geprüft und liefert ein plausibles Ergebnis
- Kein Kriterium trägt `erfuellt`, ohne dass eine Prüfung tatsächlich gelaufen ist
- `npm test` läuft grün, einschließlich Katalog-Prüfung und axe-Abgleich

## 10. Was ohne Rückfrage nicht geändert werden darf

- Der Prüfkatalog bleibt Daten. Keine Kriterien, Regelzuordnungen oder Empfehlungstexte im Code
- Keine Zugangsdaten erfassen, speichern oder in Formulare eintragen (S-03)
- Kein Cloud-Dienst als Voreinstellung (NF-02)
- Keine Java- oder Python-Abhängigkeit (NF-14)
- `pruefung_erforderlich` nie als konform ausgeben (X-14)
- Kein UI-Framework mit fremden Komponenten (NF-01)
