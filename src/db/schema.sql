-- Grundschema des Werkzeugs. Fassung 1.
--
-- Unveraendert uebernommen aus ARCHITEKTUR.md 4.2, ergaenzt um Indizes und
-- Fremdschluesselschalter. Aenderungen am Schema kommen nicht hierher, sondern
-- als neue Datei nach src/db/migrationen/ — siehe dortige README.

PRAGMA foreign_keys = ON;

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
  url           TEXT NOT NULL,                  -- vollstaendig, S-30
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

-- Ein Hinweis haelt fest, dass etwas nicht geprueft werden konnte
-- (ARCHITEKTUR 5.6, zweite Ebene). Er gehoert zur Bewertung, ist aber kein
-- Befund: er belegt keinen Verstoss, sondern eine Luecke.
CREATE TABLE hinweis (
  id            INTEGER PRIMARY KEY,
  bewertung_id  INTEGER NOT NULL REFERENCES bewertung(id) ON DELETE CASCADE,
  text          TEXT NOT NULL,
  herkunft      TEXT NOT NULL
);

CREATE INDEX idx_profil_seite_profil ON profil_seite(profil_id);
CREATE INDEX idx_scan_seite_scan     ON scan_seite(scan_id);
CREATE INDEX idx_bewertung_seite     ON bewertung(scan_seite_id);
CREATE INDEX idx_bewertung_kriterium ON bewertung(kriterium);
CREATE INDEX idx_befund_bewertung    ON befund(bewertung_id);
CREATE INDEX idx_hinweis_bewertung   ON hinweis(bewertung_id);
