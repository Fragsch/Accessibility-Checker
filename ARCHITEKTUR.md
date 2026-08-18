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
│   └── 4-robustheit.json         ✓  3 Kriterien
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
│   └── verifikation.ts     ✓ misst gegen test/referenzseiten/soll.json
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
│   ├── stufe2/
│   │   ├── adapter/
│   │   │   ├── ollama.ts
│   │   │   └── cloud.ts        ← optional
│   │   ├── einrichtung.ts      ← Erkennung, Installation, Messung (6.3.1)
│   │   ├── buendel.ts
│   │   └── pruefungen.ts
│   ├── stufe3/                 ← Fragenerzeugung, Antwortspeicherung
│   ├── bericht/                ← WCAG-EM/ACR-Erzeugung, HTML, PDF, EARL
│   ├── db/
│   │   ├── index.ts        ✓ Öffnen, Migrationen
│   │   ├── scan-speichern.ts ✓
│   │   ├── schema.sql      ✓
│   │   └── migrationen/    ✓
│   ├── plattform/              ← Die drei gekapselten Adapter (8.1)
│   │   ├── ollama-installation.ts
│   │   ├── hardware.ts
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
│   └── referenzseiten/     ✓ Testseiten mit bekannten Fehlern (Phase 8)
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

## 6. Schnittstelle zwischen Oberfläche und Server

Fastify, JSON, kein Authentifizierungsverfahren — das Werkzeug lauscht nur auf `127.0.0.1`.

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/katalog?standard=2.1` | Kriterien des gewählten Standards |
| `GET` | `/api/profile` | Prüfprofile auflisten |
| `POST` | `/api/profile` | Profil anlegen |
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
| `POST` | `/api/scan/:id/anmeldung-fertig` | Bestätigung nach der Anmeldung (S-02) |
| `GET` | `/api/scan/:id/bericht?format=html\|pdf\|earl` | Bericht erzeugen |
| `GET` | `/api/system/hardware` | Erkannte Ausstattung, Modellvorschlag (L-42) |
| `GET` | `/api/system/ollama` | Zustand der Ollama-Installation (L-40) |
| `POST` | `/api/system/ollama/einrichten` | Geführte Einrichtung (L-41) |

### Stand nach Phase 2

Gebaut sind `GET /api/katalog`, `POST /api/scan`, `GET /api/scan/:id`, `GET /api/scan/:id/ereignisse`, `POST /api/scan/:id/abbrechen`, `DELETE /api/scan/:id` sowie ergänzend `GET /api/scans`.

Die übrigen Routen der Tabelle sind angelegt und antworten mit **501** samt Angabe der Phase, die sie bringt. Das hält die Schnittstelle sichtbar, ohne etwas vorzutäuschen — und die Oberfläche kann die Meldung unverändert anzeigen.

**Zwei Fallstricke, die Zeit gekostet haben:**

- Die Weiterleitung im Entwicklungsbetrieb muss auf `^/api/` verankert sein, nicht auf `/api`. Als bloßes Präfix fängt sie auch `web/api.ts` ab; der Browser bekommt dann HTML statt eines Moduls und die Oberfläche bleibt leer — ohne verwertbare Fehlermeldung.
- Die Datenbank kennt neben `befund` eine Tabelle `hinweis`. Abschnitt 4.2 führt sie nicht auf, 5.6 verlangt sie aber: „konnte nicht geprüft werden" muss in der Oberfläche beim Kriterium erscheinen. Ohne eigene Tabelle geht diese Ebene beim Speichern verloren.

**Server-Sent Events statt Abfrage im Takt.** Ein Scan läuft minutenlang, auf schwacher Hardware länger. Die Oberfläche muss Ergebnisse der Stufe 1 sofort zeigen und die der Stufe 2 nachreichen (NF-10) — das ist mit einem Ereignisstrom sauber lösbar und mit wiederholten Abfragen nicht.

Ereignistypen: `seite-begonnen`, `seite-fertig`, `befund`, `stufe-fertig`, `fortschritt`, `anmeldung-noetig`, `sitzung-verloren`, `fehler`, `fertig`.

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
